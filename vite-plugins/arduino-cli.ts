/**
 * Shared plumbing for the dev-server endpoints that shell out to
 * `arduino-cli`.
 *
 * Both the compile endpoint and the library endpoint need the same three
 * things: run the CLI without a shell, read a request body without letting it
 * grow without bound, and answer in JSON.
 *
 * The pure helpers here - the parsers and the validators - are exported so
 * they can be tested without a dev server or a toolchain.
 */

import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Compilation is slow but must not hang the dev server forever. */
export const COMPILE_TIMEOUT_MS = 120_000;
/** Installing pulls from the network, so it gets its own, shorter budget. */
export const LIBRARY_TIMEOUT_MS = 90_000;

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function run(
  command: string,
  args: string[],
  options: { timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    // shell:false and an argument array keep sketch text and library names out
    // of shell parsing.
    const child = spawn(command, args, {
      shell: false,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs ?? COMPILE_TIMEOUT_MS);

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

export interface CliStatus {
  available: boolean;
  version?: string;
  reason?: string;
}

export async function detect(): Promise<CliStatus> {
  const result = await run('arduino-cli', ['version'], { timeoutMs: 10_000 });
  if (result.code === 0) {
    return { available: true, version: result.stdout.trim().split('\n')[0] };
  }
  return { available: false, reason: 'arduino-cli is not installed or not on PATH' };
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

/** An invalid client request that should be returned as a 4xx response. */
export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 413,
  ) {
    super(message);
    this.name = 'RequestBodyError';
  }
}

/** Collect a request body, refusing anything past `limit` bytes. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(
          new RequestBodyError(
            `request body is larger than ${Math.round(limit / 1_000_000)}MB`,
            413,
          ),
        );
        // Keep consuming the request so the server can send the JSON error
        // response instead of closing the socket while the upload is active.
        req.resume();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

export async function readJsonBody(req: IncomingMessage, limit = 2_000_000): Promise<unknown> {
  const text = (await readBody(req, limit)).toString('utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new RequestBodyError(`request body is not valid JSON: ${(error as Error).message}`, 400);
  }
}

// ---- library helpers -------------------------------------------------

export interface InstalledLibrary {
  name: string;
  version?: string;
  /** "user" for a hand-installed library, "platform" for a bundled one. */
  location?: string;
  sentence?: string;
  /** Headers the library offers, so a sketch's `#include` can be matched up. */
  includes?: string[];
}

/**
 * Read `arduino-cli lib list --format json`.
 *
 * A library installed from a zip often has no version at all - the field is
 * simply absent - so this must not require one.
 */
export function parseLibList(json: string): InstalledLibrary[] {
  const parsed = JSON.parse(json) as {
    installed_libraries?: { library?: Record<string, unknown> }[];
  };
  const out: InstalledLibrary[] = [];
  for (const entry of parsed.installed_libraries ?? []) {
    const lib = entry.library;
    if (!lib || typeof lib.name !== 'string') continue;
    out.push({
      name: lib.name,
      version: typeof lib.version === 'string' ? lib.version : undefined,
      location: typeof lib.location === 'string' ? lib.location : undefined,
      sentence: typeof lib.sentence === 'string' ? lib.sentence : undefined,
      includes: Array.isArray(lib.provides_includes)
        ? lib.provides_includes.filter((h): h is string => typeof h === 'string')
        : undefined,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface LibrarySearchResult {
  name: string;
  version?: string;
  sentence?: string;
  author?: string;
}

/**
 * Read `arduino-cli lib search --format json`.
 *
 * The raw answer carries every release of every match - megabytes for a broad
 * query - so only the latest release of each is kept.
 */
export function parseLibSearch(json: string, limit = 40): LibrarySearchResult[] {
  const parsed = JSON.parse(json) as {
    libraries?: {
      name?: unknown;
      latest?: { version?: unknown; sentence?: unknown; author?: unknown };
    }[];
  };
  const out: LibrarySearchResult[] = [];
  for (const lib of parsed.libraries ?? []) {
    if (typeof lib.name !== 'string') continue;
    const latest = lib.latest ?? {};
    out.push({
      name: lib.name,
      version: typeof latest.version === 'string' ? latest.version : undefined,
      sentence: typeof latest.sentence === 'string' ? latest.sentence : undefined,
      author: typeof latest.author === 'string' ? latest.author : undefined,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * A library name the CLI will accept, optionally with `@version`.
 *
 * Names in the index contain spaces, dots and dashes ("Adafruit NeoPixel",
 * "LiquidCrystal I2C"), so this cannot be a bare identifier. What it must not
 * contain is anything that would read as a path or an option: a leading dash
 * would be taken as a flag, and a slash would let a name reach outside the
 * library directory.
 */
export function isLibrarySpec(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,99}(@[A-Za-z0-9][A-Za-z0-9.+-]{0,31})?$/.test(value);
}

/** Split `Name@1.2.3` into its parts. */
export function splitLibrarySpec(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf('@');
  if (at <= 0) return { name: spec.trim() };
  return { name: spec.slice(0, at).trim(), version: spec.slice(at + 1).trim() || undefined };
}

/**
 * Which of the sketch's libraries are not installed.
 *
 * Compared by name only: a project pins `Name@1.2.3`, and a different version
 * of the same library still compiles.
 */
export function missingLibraries(
  wanted: readonly string[],
  installed: readonly InstalledLibrary[],
): string[] {
  const have = new Set(installed.map((lib) => lib.name.toLowerCase()));
  // Reported once each, and matched the same way throughout: comparing the
  // installed set case-insensitively but the report case-sensitively named
  // `Foo` and `foo` as two separate missing libraries.
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const spec of wanted) {
    const { name } = splitLibrarySpec(spec.trim());
    const key = name.toLowerCase();
    if (name === '' || have.has(key) || seen.has(key)) continue;
    seen.add(key);
    missing.push(name);
  }
  return missing;
}

/**
 * The libraries that appeared between two listings.
 *
 * A zip names its own library - the folder inside the archive decides, not
 * the file name - so what was installed can only be known by comparing.
 * Both listings are taken here, either side of the install, rather than in
 * the browser: the browser's idea of what is installed can be minutes old,
 * and a stale "before" makes a new library look like one that was already
 * there.
 */
export function addedLibraries(
  before: readonly InstalledLibrary[],
  after: readonly InstalledLibrary[],
): InstalledLibrary[] {
  const had = new Set(before.map((lib) => lib.name.toLowerCase()));
  return after.filter((lib) => !had.has(lib.name.toLowerCase()));
}

// ---- sketch files ----------------------------------------------------

export interface SketchFile {
  name: string;
  content: string;
}

/**
 * Extensions arduino-cli compiles inside a sketch directory.
 *
 * Mirrors `src/build/sketch-files.ts`; the browser check is a courtesy, this
 * one is the one that matters, because these become real files on disk.
 */
const SKETCH_EXTENSIONS = new Set(['h', 'hpp', 'c', 'cc', 'cpp', 'ino']);

/**
 * A file name that is safe to write into the sketch directory.
 *
 * The name has to be a bare file name: no separator, no drive letter, no `..`.
 * `sketch.ino` is refused because the main sketch is written under that name,
 * and a second file claiming it would silently replace the code being built.
 */
export function isSketchFileName(name: string): boolean {
  const trimmed = name.trim();
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(trimmed)) return false;
  if (trimmed.includes('..')) return false;
  if (trimmed.toLowerCase() === 'sketch.ino') return false;
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0) return false;
  const extension = trimmed.slice(dot + 1);
  // Matched without case, except `.S`: to gcc that is preprocessed assembly
  // and `.s` is not, and only the former is built here.
  return extension === 'S' || SKETCH_EXTENSIONS.has(extension.toLowerCase());
}

/**
 * The files from a request that may be written, with any duplicate dropped.
 *
 * Duplicates are compared without case: on Windows and macOS `Pitches.h` and
 * `pitches.h` are one file, so writing both would leave whichever landed last
 * and quietly discard the other.
 */
export function acceptedSketchFiles(value: unknown): SketchFile[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SketchFile[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, content } = entry as { name?: unknown; content?: unknown };
    if (typeof name !== 'string' || typeof content !== 'string') continue;
    const trimmed = name.trim();
    if (!isSketchFileName(trimmed) || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push({ name: trimmed, content });
  }
  return out;
}
