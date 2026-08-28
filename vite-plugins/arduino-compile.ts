/**
 * Dev-server middleware that compiles sketches with a locally installed
 * `arduino-cli`.
 *
 * Runs only on the developer's own machine and only during `vite dev`. If
 * arduino-cli is not installed the endpoint reports that plainly and the app
 * falls back to loading prebuilt .hex files.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

const DEFAULT_FQBN = 'arduino:avr:uno';
/** Compilation is slow but must not hang the dev server forever. */
const COMPILE_TIMEOUT_MS = 120_000;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(command: string, args: string[], timeoutMs = COMPILE_TIMEOUT_MS): Promise<RunResult> {
  return new Promise((resolve) => {
    // shell:false and an argument array keep sketch text out of shell parsing.
    const child = spawn(command, args, { shell: false });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (d) => (stdout += String(d)));
    child.stderr?.on('data', (d) => (stderr += String(d)));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

async function detect(): Promise<{ available: boolean; version?: string; reason?: string }> {
  const result = await run('arduino-cli', ['version'], 10_000);
  if (result.code === 0) {
    return { available: true, version: result.stdout.trim().split('\n')[0] };
  }
  return {
    available: false,
    reason: 'arduino-cli is not installed or not on PATH',
  };
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      // A sketch is text; anything this large is not a legitimate request.
      if (size > 2_000_000) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function compileSketch(
  sketch: string,
  fqbn: string,
): Promise<{ ok: boolean; hex?: string; output: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'arduino-sim-'));
  const sketchDir = join(dir, 'sketch');
  const buildDir = join(dir, 'build');
  try {
    await mkdtempSafe(sketchDir);
    await writeFile(join(sketchDir, 'sketch.ino'), sketch, 'utf8');

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

async function mkdtempSafe(path: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path, { recursive: true });
}

export function arduinoCompilePlugin(): Plugin {
  let cachedStatus: Awaited<ReturnType<typeof detect>> | null = null;

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

        const body = (await readJsonBody(req)) as { sketch?: unknown; fqbn?: unknown };
        if (typeof body.sketch !== 'string') {
          sendJson(res, 400, { error: 'sketch must be a string' });
          return;
        }
        // Restrict the board to a known-good identifier rather than passing
        // arbitrary text to the CLI.
        const fqbn =
          typeof body.fqbn === 'string' && /^[\w:.-]+$/.test(body.fqbn) ? body.fqbn : DEFAULT_FQBN;

        const result = await compileSketch(body.sketch, fqbn);
        sendJson(res, 200, result);
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message, output: (e as Error).message });
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
