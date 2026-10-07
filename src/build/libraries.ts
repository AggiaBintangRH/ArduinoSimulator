/**
 * Arduino library management.
 *
 * Libraries are C++ source, so installing one means unpacking it where the
 * toolchain will look - which the browser cannot do. This talks to the same
 * dev-server endpoint the compiler uses (see vite-plugins/arduino-libraries).
 *
 * A project records the libraries its sketch needs by name; the machine
 * running the toolchain is what actually has them installed. The two are kept
 * apart on purpose: a project file stays portable, and someone opening it on
 * another machine is told what to install rather than silently building
 * against whatever happens to be there.
 */

export interface InstalledLibrary {
  name: string;
  version?: string;
  location?: string;
  sentence?: string;
  includes?: string[];
}

export interface LibrarySearchResult {
  name: string;
  version?: string;
  sentence?: string;
  author?: string;
}

export interface LibraryResult {
  ok: boolean;
  /** False when there is no toolchain on this machine at all. */
  available: boolean;
  libraries: InstalledLibrary[];
  /** Raw arduino-cli output, for the log and for error messages. */
  output: string;
  /**
   * What this install added, worked out by the server across the operation.
   *
   * Absent on a plain listing. Diffing here instead would compare against
   * whatever the dialog last saw, which can be minutes old - and then a
   * library that really is new looks like one that was already installed.
   */
  added?: InstalledLibrary[];
}

/** How a library is written in a project's library list. */
export function librarySpec(name: string, version?: string): string {
  return version ? `${name}@${version}` : name;
}

/** The name half of `Name@1.2.3`. */
export function libraryName(spec: string): string {
  const at = spec.lastIndexOf('@');
  return at > 0 ? spec.slice(0, at).trim() : spec.trim();
}

/**
 * Add a library to a project's list, replacing any other version of it.
 *
 * Keeping both `Foo@1.0.0` and `Foo@2.0.0` would ask the toolchain for a
 * library twice and pin it to two different versions.
 */
export function addLibrary(libraries: readonly string[], spec: string): string[] {
  const name = libraryName(spec).toLowerCase();
  const kept = libraries.filter((l) => libraryName(l).toLowerCase() !== name);
  return [...kept, spec].sort((a, b) => libraryName(a).localeCompare(libraryName(b)));
}

/** Remove a library from a project's list, whatever version it was pinned to. */
export function removeLibrary(libraries: readonly string[], name: string): string[] {
  const wanted = libraryName(name).toLowerCase();
  return libraries.filter((l) => libraryName(l).toLowerCase() !== wanted);
}

/** True when the project already asks for this library, at any version. */
export function hasLibrary(libraries: readonly string[], name: string): boolean {
  const wanted = libraryName(name).toLowerCase();
  return libraries.some((l) => libraryName(l).toLowerCase() === wanted);
}

/**
 * The libraries a sketch includes but the project does not list.
 *
 * Only headers that are not part of the core are worth reporting, and the
 * core's own headers are few enough to name. Matching is by the header a
 * library says it provides, which is how the CLI resolves an include too.
 */
const CORE_HEADERS = new Set([
  'arduino.h',
  'wire.h',
  'spi.h',
  'eeprom.h',
  'softwareserial.h',
  'servo.h',
  'liquidcrystal.h',
  'stdint.h',
  'string.h',
  'stdio.h',
  'math.h',
  'stdlib.h',
  'avr/io.h',
  'avr/interrupt.h',
  'avr/pgmspace.h',
  'avr/sleep.h',
  'avr/wdt.h',
]);

/** Every `#include <...>` / `#include "..."` in a sketch, lowercased. */
export function sketchIncludes(sketch: string): string[] {
  const out: string[] = [];
  const re = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sketch)) !== null) {
    const header = match[1].trim().toLowerCase();
    if (header === '' || CORE_HEADERS.has(header)) continue;
    if (!out.includes(header)) out.push(header);
  }
  return out;
}

/**
 * Which installed libraries provide a sketch's includes.
 *
 * Used to offer "add this to the project" for a library the sketch is clearly
 * already using, rather than making the user match headers to library names
 * by hand.
 */
export function librariesForIncludes(
  sketch: string,
  installed: readonly InstalledLibrary[],
): string[] {
  const wanted = new Set(sketchIncludes(sketch));
  const names: string[] = [];
  for (const lib of installed) {
    const provides = (lib.includes ?? []).map((h) => h.toLowerCase());
    if (provides.some((h) => wanted.has(h)) && !names.includes(lib.name)) {
      names.push(lib.name);
    }
  }
  return names;
}

export interface LibraryClient {
  list(): Promise<LibraryResult>;
  search(query: string): Promise<{ ok: boolean; results: LibrarySearchResult[]; output: string }>;
  install(spec: string): Promise<LibraryResult>;
  installZip(file: File): Promise<LibraryResult>;
  uninstall(name: string): Promise<LibraryResult>;
}

const UNREACHABLE = (e: unknown): LibraryResult => ({
  ok: false,
  available: false,
  libraries: [],
  output: `could not reach the library service: ${(e as Error).message}`,
});

/** Talks to the dev-server library endpoint. */
export class HttpLibraryClient implements LibraryClient {
  constructor(private baseUrl = '/api/libraries') {}

  private async json(url: string, init?: RequestInit): Promise<LibraryResult> {
    try {
      const res = await fetch(url, init);
      // A production build has no library endpoint, so the SPA fallback serves
      // index.html here. Say so, rather than failing on a JSON parse.
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
        return {
          ok: false,
          available: false,
          libraries: [],
          output: 'the library service only runs under "npm run dev"',
        };
      }
      const body = (await res.json()) as Partial<LibraryResult> & { error?: string };
      return {
        ok: Boolean(body.ok),
        available: body.available ?? false,
        libraries: body.libraries ?? [],
        output: body.output ?? body.error ?? '',
        added: body.added,
      };
    } catch (e) {
      return UNREACHABLE(e);
    }
  }

  list(): Promise<LibraryResult> {
    return this.json(this.baseUrl);
  }

  async search(
    query: string,
  ): Promise<{ ok: boolean; results: LibrarySearchResult[]; output: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/search?q=${encodeURIComponent(query)}`);
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
        return { ok: false, results: [], output: 'the library service only runs under "npm run dev"' };
      }
      const body = (await res.json()) as {
        ok?: boolean;
        results?: LibrarySearchResult[];
        output?: string;
      };
      return { ok: Boolean(body.ok), results: body.results ?? [], output: body.output ?? '' };
    } catch (e) {
      return { ok: false, results: [], output: `could not reach the library service: ${(e as Error).message}` };
    }
  }

  install(spec: string): Promise<LibraryResult> {
    return this.json(this.baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: spec }),
    });
  }

  installZip(file: File): Promise<LibraryResult> {
    // The archive goes up as its own bytes: a library zip is already a
    // container, and wrapping it in a form encoding only makes it bigger.
    return this.json(`${this.baseUrl}/zip`, {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: file,
    });
  }

  uninstall(name: string): Promise<LibraryResult> {
    return this.json(`${this.baseUrl}?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
  }
}

/**
 * The libraries that appeared between two listings.
 *
 * A zip names its own library - the folder inside the archive decides, not the
 * file name - so the only reliable way to know what was just installed is to
 * look at what is there now that was not before.
 */
export function newlyInstalled(
  before: readonly InstalledLibrary[],
  after: readonly InstalledLibrary[],
): InstalledLibrary[] {
  const had = new Set(before.map((lib) => lib.name.toLowerCase()));
  return after.filter((lib) => !had.has(lib.name.toLowerCase()));
}
