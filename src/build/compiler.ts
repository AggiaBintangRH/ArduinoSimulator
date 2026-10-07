/**
 * Sketch compilation.
 *
 * Compiling Arduino C++ needs a real toolchain, which cannot run in the
 * browser. Rather than shipping sketches to a third-party build service, this
 * talks to a local endpoint backed by `arduino-cli` (see
 * vite-plugins/arduino-compile.ts). When no toolchain is installed the app
 * still runs: firmware can be loaded from a prebuilt .hex.
 */

import type { SketchFile } from './sketch-files.js';

export interface CompileDiagnostic {
  file?: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
}

export interface CompileResult {
  ok: boolean;
  /** Intel HEX text, present when ok. */
  hex?: string;
  diagnostics: CompileDiagnostic[];
  /** Raw compiler output, for the build log. */
  output: string;
  /** Wall time in ms. */
  durationMs?: number;
}

export interface CompilerStatus {
  available: boolean;
  /** e.g. "arduino-cli 1.0.4" */
  version?: string;
  reason?: string;
}

/**
 * Parse gcc/arduino-cli diagnostics.
 *
 * Lines look like:
 *   /path/sketch.ino:12:5: error: 'foo' was not declared in this scope
 * Windows paths carry a drive letter, so the split cannot simply be on ':'.
 */
export function parseDiagnostics(output: string): CompileDiagnostic[] {
  const diagnostics: CompileDiagnostic[] = [];
  const re = /^(.*?):(\d+):(?:(\d+):)?\s*(error|warning|note):\s*(.*)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(output)) !== null) {
    const [, file, line, column, severity, message] = match;
    diagnostics.push({
      file: file.trim() || undefined,
      line: Number(line),
      column: column ? Number(column) : undefined,
      severity: severity as CompileDiagnostic['severity'],
      message: message.trim(),
    });
  }
  return diagnostics;
}

/** True when the sketch has at least one hard error. */
export function hasErrors(diagnostics: readonly CompileDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}

/** Everything a build depends on besides the main sketch text. */
export interface CompileOptions {
  fqbn?: string;
  libraries?: string[];
  /** Headers and other sources that go in the sketch directory. */
  files?: SketchFile[];
}

export interface Compiler {
  status(): Promise<CompilerStatus>;
  compile(sketch: string, options?: CompileOptions): Promise<CompileResult>;
}

/** Talks to the dev-server compile endpoint. */
export class HttpCompiler implements Compiler {
  constructor(private baseUrl = '/api/compile') {}

  async status(): Promise<CompilerStatus> {
    try {
      const res = await fetch(`${this.baseUrl}/status`);
      if (!res.ok) {
        return { available: false, reason: `compile service returned ${res.status}` };
      }
      // A production build has no compile endpoint, so the SPA fallback serves
      // index.html here. Report that plainly instead of a JSON parse error.
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        return {
          available: false,
          reason: 'the compile service only runs under "npm run dev"',
        };
      }
      return (await res.json()) as CompilerStatus;
    } catch (e) {
      return { available: false, reason: (e as Error).message };
    }
  }

  async compile(sketch: string, options: CompileOptions = {}): Promise<CompileResult> {
    const started = Date.now();
    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sketch,
          fqbn: options.fqbn ?? 'arduino:avr:uno',
          libraries: options.libraries ?? [],
          files: options.files ?? [],
        }),
      });
      const body = (await res.json()) as Partial<CompileResult> & { error?: string };
      if (!res.ok) {
        return {
          ok: false,
          diagnostics: parseDiagnostics(body.output ?? ''),
          output: body.output ?? body.error ?? `compile failed with status ${res.status}`,
          durationMs: Date.now() - started,
        };
      }
      const output = body.output ?? '';
      const diagnostics = body.diagnostics ?? parseDiagnostics(output);
      return {
        ok: Boolean(body.ok && body.hex),
        hex: body.hex,
        diagnostics,
        output,
        durationMs: Date.now() - started,
      };
    } catch (e) {
      return {
        ok: false,
        diagnostics: [],
        output: `could not reach the compile service: ${(e as Error).message}`,
        durationMs: Date.now() - started,
      };
    }
  }
}

/** Used when no toolchain is available; keeps the app usable with .hex files. */
export class UnavailableCompiler implements Compiler {
  constructor(private reason = 'no local Arduino toolchain found') {}

  async status(): Promise<CompilerStatus> {
    return { available: false, reason: this.reason };
  }

  async compile(): Promise<CompileResult> {
    return {
      ok: false,
      diagnostics: [],
      output:
        `${this.reason}.\n\n` +
        'Install arduino-cli and restart the dev server to compile sketches here,\n' +
        'or load a prebuilt .hex with the "Load .hex" button.',
    };
  }
}

/**
 * Caches results by sketch text, so re-running an unchanged sketch is instant.
 * Compilation is slow enough (seconds) that this is worth having.
 */
export class CachingCompiler implements Compiler {
  private cache = new Map<string, CompileResult>();

  constructor(private inner: Compiler, private limit = 20) {}

  status(): Promise<CompilerStatus> {
    return this.inner.status();
  }

  async compile(sketch: string, options: CompileOptions = {}): Promise<CompileResult> {
    // The extra files are part of the key: editing a header and pressing Start
    // again must rebuild, or the sketch would go on running the old firmware.
    const key = JSON.stringify([
      sketch,
      options.fqbn ?? '',
      options.libraries ?? [],
      options.files ?? [],
    ]);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const result = await this.inner.compile(sketch, options);
    // Only successful builds are worth keeping; errors are cheap to reproduce
    // and the user is usually editing toward a fix.
    if (result.ok) {
      if (this.cache.size >= this.limit) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(key, result);
    }
    return result;
  }

  clear(): void {
    this.cache.clear();
  }
}
