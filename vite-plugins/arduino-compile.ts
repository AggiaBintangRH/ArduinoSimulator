/**
 * Dev-server middleware that compiles sketches with a locally installed
 * `arduino-cli`.
 *
 * Runs only on the developer's own machine and only during `vite dev`. If
 * arduino-cli is not installed the endpoint reports that plainly and the app
 * falls back to loading prebuilt .hex files.
 */

import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin, Connect } from 'vite';
import {
  run,
  detect,
  sendJson,
  readJsonBody,
  parseLibList,
  missingLibraries,
  isLibrarySpec,
  acceptedSketchFiles,
  RequestBodyError,
  type SketchFile,
  type CliStatus,
} from './arduino-cli.js';

const DEFAULT_FQBN = 'arduino:avr:uno';

/**
 * Which of the sketch's libraries the toolchain does not have.
 *
 * arduino-cli finds installed libraries by itself, so the project's list is
 * not passed to it - it is checked against it. Without this a missing library
 * surfaces as `No such file or directory` on an `#include`, which reads like
 * a mistake in the sketch rather than a library that was never installed.
 */
async function findMissingLibraries(libraries: readonly string[]): Promise<string[]> {
  if (libraries.length === 0) return [];
  const result = await run('arduino-cli', ['lib', 'list', '--format', 'json'], {
    timeoutMs: 30_000,
  });
  if (result.code !== 0) return [];
  try {
    return missingLibraries(libraries, parseLibList(result.stdout));
  } catch {
    // An unreadable list is no reason to block a build that might well work.
    return [];
  }
}

async function compileSketch(
  sketch: string,
  fqbn: string,
  libraries: readonly string[],
  files: readonly SketchFile[],
): Promise<{ ok: boolean; hex?: string; output: string }> {
  const missing = await findMissingLibraries(libraries);
  if (missing.length > 0) {
    return {
      ok: false,
      output:
        `This project needs ${missing.length === 1 ? 'a library' : 'libraries'} that ` +
        `${missing.length === 1 ? 'is' : 'are'} not installed:\n` +
        missing.map((name) => `  - ${name}`).join('\n') +
        `\n\nInstall ${missing.length === 1 ? 'it' : 'them'} with the Libraries button, then build again.`,
    };
  }

  const dir = await mkdtemp(join(tmpdir(), 'arduino-sim-'));
  const sketchDir = join(dir, 'sketch');
  const buildDir = join(dir, 'build');
  try {
    await mkdir(sketchDir, { recursive: true });
    await writeFile(join(sketchDir, 'sketch.ino'), sketch, 'utf8');
    /*
     * A sketch is a directory, so `#include "pitches.h"` resolves as long as
     * the header sits beside the .ino. The names were checked before getting
     * here; `join` is given a bare file name, never a path from the request.
     */
    for (const file of files) {
      await writeFile(join(sketchDir, file.name), file.content, 'utf8');
    }

    const result = await run('arduino-cli', [
      'compile',
      '--fqbn',
      fqbn,
      '--output-dir',
      buildDir,
      sketchDir,
    ]);

    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (result.timedOut) {
      return { ok: false, output: `${output}\n\ncompilation timed out` };
    }
    if (result.code !== 0) {
      return { ok: false, output };
    }

    try {
      const hex = await readFile(join(buildDir, 'sketch.ino.hex'), 'utf8');
      return { ok: true, hex, output };
    } catch {
      return { ok: false, output: `${output}\n\nbuild succeeded but no .hex was produced` };
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // A leftover temp dir is harmless; never fail the request over cleanup.
    });
  }
}

export function arduinoCompilePlugin(): Plugin {
  let cachedStatus: CliStatus | null = null;

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/compile')) return next();

    void (async () => {
      try {
        if (url.startsWith('/api/compile/status')) {
          cachedStatus ??= await detect();
          sendJson(res, 200, cachedStatus);
          return;
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'use POST to compile' });
          return;
        }

        cachedStatus ??= await detect();
        if (!cachedStatus.available) {
          sendJson(res, 200, {
            ok: false,
            output: `${cachedStatus.reason}.\n\nInstall arduino-cli and restart the dev server, or load a prebuilt .hex.`,
          });
          return;
        }

        const body = (await readJsonBody(req)) as {
          sketch?: unknown;
          fqbn?: unknown;
          libraries?: unknown;
          files?: unknown;
        };
        if (typeof body.sketch !== 'string') {
          sendJson(res, 400, { error: 'sketch must be a string' });
          return;
        }
        // Restrict the board to a known-good identifier rather than passing
        // arbitrary text to the CLI.
        const fqbn =
          typeof body.fqbn === 'string' && /^[\w:.-]+$/.test(body.fqbn) ? body.fqbn : DEFAULT_FQBN;
        const files = acceptedSketchFiles(body.files);
        const libraries = Array.isArray(body.libraries)
          ? body.libraries.filter((l): l is string => typeof l === 'string' && isLibrarySpec(l))
          : [];

        const result = await compileSketch(body.sketch, fqbn, libraries, files);
        sendJson(res, 200, result);
      } catch (e) {
        const error = e as Error;
        const status = error instanceof RequestBodyError ? error.statusCode : 500;
        sendJson(res, status, { error: error.message, output: error.message });
      }
    })();
  };

  return {
    name: 'arduino-compile',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
