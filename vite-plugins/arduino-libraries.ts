/**
 * Dev-server middleware for managing Arduino libraries with a locally
 * installed `arduino-cli`.
 *
 * Libraries land in the CLI's own library directory - the same one the
 * Arduino IDE uses - so a library installed here is a library the compile
 * endpoint can already find. Nothing is bundled with this project.
 *
 * Like the compile endpoint, this runs only under `vite dev`, on the
 * developer's own machine.
 */

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  run,
  detect,
  sendJson,
  readBody,
  readJsonBody,
  RequestBodyError,
  parseLibList,
  parseLibSearch,
  isLibrarySpec,
  splitLibrarySpec,
  addedLibraries,
  LIBRARY_TIMEOUT_MS,
  type CliStatus,
} from './arduino-cli.js';

/** A library zip is a source tree; anything past this is not one. */
const MAX_ZIP_BYTES = 25_000_000;

/**
 * `lib install --zip-path` refuses to run unless this is set: the CLI cannot
 * check a hand-supplied archive against the index, so it makes you say you
 * meant it. Set per-command rather than written into the user's arduino-cli
 * config, which is theirs and not ours to edit.
 */
const UNSAFE_INSTALL_ENV = { ARDUINO_LIBRARY_ENABLE_UNSAFE_INSTALL: 'true' };

function cliOutput(result: { stdout: string; stderr: string; timedOut: boolean }): string {
  const text = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return result.timedOut ? `${text}\n\narduino-cli timed out`.trim() : text;
}

async function listInstalled(): Promise<
  { ok: true; libraries: ReturnType<typeof parseLibList> } | { ok: false; output: string }
> {
  const result = await run('arduino-cli', ['lib', 'list', '--format', 'json'], {
    timeoutMs: 30_000,
  });
  if (result.code !== 0) return { ok: false, output: cliOutput(result) };
  try {
    return { ok: true, libraries: parseLibList(result.stdout) };
  } catch (e) {
    return { ok: false, output: `could not read the library list: ${(e as Error).message}` };
  }
}

/** Install by name from the Arduino library index. */
async function installByName(spec: string): Promise<{ ok: boolean; output: string }> {
  const result = await run('arduino-cli', ['lib', 'install', spec], {
    timeoutMs: LIBRARY_TIMEOUT_MS,
  });
  return { ok: result.code === 0, output: cliOutput(result) };
}

/**
 * Install from a zip the user supplied.
 *
 * The bytes are written to a temp file because the CLI takes a path, not a
 * stream. The name on the temp file is fixed: arduino-cli derives the library
 * name from the folder inside the archive, not from the file name, so nothing
 * the browser sent is used to build a path.
 */
async function installFromZip(zip: Buffer): Promise<{ ok: boolean; output: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'arduino-lib-'));
  const path = join(dir, 'library.zip');
  try {
    await writeFile(path, zip);
    const result = await run('arduino-cli', ['lib', 'install', '--zip-path', path], {
      timeoutMs: LIBRARY_TIMEOUT_MS,
      env: UNSAFE_INSTALL_ENV,
    });
    return { ok: result.code === 0, output: cliOutput(result) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // A leftover temp dir is harmless; never fail the request over cleanup.
    });
  }
}

async function uninstall(name: string): Promise<{ ok: boolean; output: string }> {
  const result = await run('arduino-cli', ['lib', 'uninstall', name], { timeoutMs: 30_000 });
  return { ok: result.code === 0, output: cliOutput(result) };
}

async function search(query: string): Promise<{ ok: boolean; results?: unknown; output: string }> {
  const result = await run('arduino-cli', ['lib', 'search', query, '--format', 'json'], {
    timeoutMs: 60_000,
  });
  if (result.code !== 0) return { ok: false, output: cliOutput(result) };
  try {
    return { ok: true, results: parseLibSearch(result.stdout), output: '' };
  } catch (e) {
    return { ok: false, output: `could not read the search results: ${(e as Error).message}` };
  }
}

export function arduinoLibrariesPlugin(): Plugin {
  let cachedStatus: CliStatus | null = null;

  const handle = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
    cachedStatus ??= await detect();
    if (!cachedStatus.available) {
      // 200, not an error status: "no toolchain here" is a state the app knows
      // how to show, not a request that went wrong.
      sendJson(res, 200, {
        ok: false,
        available: false,
        libraries: [],
        output: `${cachedStatus.reason}.\n\nInstall arduino-cli and restart the dev server to manage libraries here.`,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/libraries/search') {
      const query = (url.searchParams.get('q') ?? '').trim();
      if (query.length < 2) {
        sendJson(res, 200, { ok: true, available: true, results: [], output: '' });
        return;
      }
      sendJson(res, 200, { available: true, ...(await search(query)) });
      return;
    }

    if (req.method === 'GET') {
      const listed = await listInstalled();
      sendJson(res, 200, {
        available: true,
        ok: listed.ok,
        libraries: listed.ok ? listed.libraries : [],
        output: listed.ok ? '' : listed.output,
      });
      return;
    }

    if (req.method === 'DELETE') {
      const name = (url.searchParams.get('name') ?? '').trim();
      if (!isLibrarySpec(name)) {
        sendJson(res, 400, { ok: false, output: `not a library name: ${name}` });
        return;
      }
      const removed = await uninstall(splitLibrarySpec(name).name);
      const listed = await listInstalled();
      sendJson(res, 200, {
        available: true,
        ok: removed.ok,
        output: removed.output,
        libraries: listed.ok ? listed.libraries : [],
      });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, output: 'use GET, POST or DELETE' });
      return;
    }

    /*
     * The body is read first, before anything slow: the request is still open
     * while arduino-cli runs, and a browser should not be left holding an
     * unread upload for the length of a `lib list`.
     */
    let install: () => Promise<{ ok: boolean; output: string }>;
    if (url.pathname === '/api/libraries/zip') {
      const zip = await readBody(req, MAX_ZIP_BYTES);
      // A zip starts with "PK\x03\x04". Checking here turns "you picked the
      // wrong file" into a sentence instead of a CLI stack trace.
      if (zip.length < 4 || zip[0] !== 0x50 || zip[1] !== 0x4b) {
        sendJson(res, 400, { ok: false, output: 'that file is not a zip archive' });
        return;
      }
      install = () => installFromZip(zip);
    } else {
      const body = (await readJsonBody(req)) as { name?: unknown };
      const spec = typeof body.name === 'string' ? body.name.trim() : '';
      if (!isLibrarySpec(spec)) {
        sendJson(res, 400, { ok: false, output: `not a library name: ${spec}` });
        return;
      }
      install = () => installByName(spec);
    }

    // Taken before the install so the answer can say what actually arrived.
    const wasInstalled = await listInstalled();
    const installed = await install();

    // The fresh list goes back with the result, so the UI never has to guess
    // what the install actually produced - a zip names its own library, which
    // is often not what the file was called.
    const listed = await listInstalled();
    const libraries = listed.ok ? listed.libraries : [];
    sendJson(res, 200, {
      available: true,
      ok: installed.ok,
      output: installed.output,
      libraries,
      added: wasInstalled.ok ? addedLibraries(wasInstalled.libraries, libraries) : [],
    });
  };

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const raw = req.url ?? '';
    if (!raw.startsWith('/api/libraries')) return next();
    const url = new URL(raw, 'http://localhost');

    void handle(req, res, url).catch((e: unknown) => {
      if (res.headersSent) return;
      const error = e as Error;
      const status = error instanceof RequestBodyError ? error.statusCode : 500;
      sendJson(res, status, { ok: false, output: error.message });
    });
  };

  return {
    name: 'arduino-libraries',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
