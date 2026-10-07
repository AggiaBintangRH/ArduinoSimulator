// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  librarySpec,
  libraryName,
  addLibrary,
  removeLibrary,
  hasLibrary,
  sketchIncludes,
  librariesForIncludes,
  newlyInstalled,
  HttpLibraryClient,
  type InstalledLibrary,
  type LibraryClient,
  type LibraryResult,
} from '../src/build/libraries.js';
import { createLibraryManager } from '../src/ui/library-manager.js';
import {
  parseLibList,
  parseLibSearch,
  isLibrarySpec,
  splitLibrarySpec,
  missingLibraries,
  addedLibraries,
} from '../vite-plugins/arduino-cli.js';

describe('library specs', () => {
  it('writes a name with and without a version', () => {
    expect(librarySpec('Adafruit NeoPixel')).toBe('Adafruit NeoPixel');
    expect(librarySpec('Adafruit NeoPixel', '1.12.0')).toBe('Adafruit NeoPixel@1.12.0');
  });

  it('reads the name back out', () => {
    expect(libraryName('Adafruit NeoPixel@1.12.0')).toBe('Adafruit NeoPixel');
    expect(libraryName('OneWire')).toBe('OneWire');
  });

  it('keeps a name that starts with @ intact', () => {
    // Not a version separator: there is nothing before it to be a name.
    expect(libraryName('@scoped')).toBe('@scoped');
  });

  it('replaces a library rather than pinning it twice', () => {
    const after = addLibrary(['Foo@1.0.0', 'Bar'], 'Foo@2.0.0');
    expect(after).toEqual(['Bar', 'Foo@2.0.0']);
  });

  it('matches by name whatever the case and version', () => {
    expect(hasLibrary(['Adafruit NeoPixel@1.12.0'], 'adafruit neopixel')).toBe(true);
    expect(removeLibrary(['Adafruit NeoPixel@1.12.0'], 'adafruit neopixel')).toEqual([]);
  });
});

describe('sketchIncludes', () => {
  it('finds both include forms', () => {
    expect(sketchIncludes('#include <OneWire.h>\n#include "Local.h"\n')).toEqual([
      'onewire.h',
      'local.h',
    ]);
  });

  it('leaves out the headers the core already provides', () => {
    // Reporting <Arduino.h> as a missing library would be noise on every sketch.
    expect(sketchIncludes('#include <Arduino.h>\n#include <Wire.h>\n')).toEqual([]);
  });

  it('reads an include written with spaces', () => {
    expect(sketchIncludes('  #  include  <Foo.h>')).toEqual(['foo.h']);
  });

  it('matches an installed library by the header it provides', () => {
    const installed: InstalledLibrary[] = [
      { name: 'OneWire', includes: ['OneWire.h'] },
      { name: 'Unrelated', includes: ['Other.h'] },
    ];
    expect(librariesForIncludes('#include <OneWire.h>', installed)).toEqual(['OneWire']);
  });
});

describe('newlyInstalled', () => {
  it('reports what appeared, since a zip names its own library', () => {
    const before: InstalledLibrary[] = [{ name: 'OneWire' }];
    const after: InstalledLibrary[] = [{ name: 'OneWire' }, { name: 'Adafruit Foo' }];
    expect(newlyInstalled(before, after).map((l) => l.name)).toEqual(['Adafruit Foo']);
  });
});

describe('arduino-cli output', () => {
  it('reads the installed list', () => {
    const json = JSON.stringify({
      installed_libraries: [
        { library: { name: 'Zed', version: '1.0.0', location: 'user' } },
        { library: { name: 'Alpha', provides_includes: ['Alpha.h'] } },
      ],
    });
    const libs = parseLibList(json);
    // Sorted, so the dialog does not reorder itself between requests.
    expect(libs.map((l) => l.name)).toEqual(['Alpha', 'Zed']);
    // A library installed from a zip often has no version at all.
    expect(libs[0].version).toBeUndefined();
    expect(libs[0].includes).toEqual(['Alpha.h']);
  });

  it('skips an entry with no name instead of inventing one', () => {
    expect(parseLibList(JSON.stringify({ installed_libraries: [{ library: {} }] }))).toEqual([]);
  });

  it('reads an empty list', () => {
    expect(parseLibList('{}')).toEqual([]);
  });

  it('keeps only the latest release of each search hit', () => {
    /*
     * The raw answer carries every release ever published - megabytes for a
     * broad query - and the dialog only ever offers the newest.
     */
    const json = JSON.stringify({
      libraries: [
        {
          name: 'OneWire',
          releases: { '1.0.0': {}, '2.3.8': {} },
          latest: { version: '2.3.8', sentence: 'Access 1-wire devices.', author: 'Jim' },
        },
      ],
    });
    expect(parseLibSearch(json)).toEqual([
      { name: 'OneWire', version: '2.3.8', sentence: 'Access 1-wire devices.', author: 'Jim' },
    ]);
  });

  it('stops at the limit', () => {
    const json = JSON.stringify({
      libraries: Array.from({ length: 100 }, (_, i) => ({ name: `Lib${i}`, latest: {} })),
    });
    expect(parseLibSearch(json, 5)).toHaveLength(5);
  });
});

describe('isLibrarySpec', () => {
  it('accepts the names the index actually uses', () => {
    for (const name of ['OneWire', 'Adafruit NeoPixel', 'LiquidCrystal I2C', 'DHT sensor library']) {
      expect(isLibrarySpec(name), name).toBe(true);
    }
    expect(isLibrarySpec('Adafruit NeoPixel@1.12.0')).toBe(true);
  });

  it('refuses anything that would read as a path or an option', () => {
    /*
     * The name reaches `arduino-cli` as an argument. A leading dash would be
     * taken as a flag, and a separator would let a name point outside the
     * library directory.
     */
    for (const bad of ['--config-file=x', '-v', '../../etc', 'a/b', 'a\\b', '', 'a;b', 'a$(x)']) {
      expect(isLibrarySpec(bad), bad).toBe(false);
    }
  });

  it('splits a spec into name and version', () => {
    expect(splitLibrarySpec('Adafruit NeoPixel@1.12.0')).toEqual({
      name: 'Adafruit NeoPixel',
      version: '1.12.0',
    });
    expect(splitLibrarySpec('OneWire')).toEqual({ name: 'OneWire' });
  });
});

describe('missingLibraries', () => {
  const installed: InstalledLibrary[] = [{ name: 'OneWire', version: '2.3.8' }];

  it('says nothing when everything is there', () => {
    expect(missingLibraries(['OneWire'], installed)).toEqual([]);
  });

  it('ignores the pinned version', () => {
    // A different version of the same library still compiles.
    expect(missingLibraries(['OneWire@1.0.0'], installed)).toEqual([]);
  });

  it('names what is not installed, once', () => {
    expect(missingLibraries(['Foo@1', 'foo@2', 'OneWire'], installed)).toEqual(['Foo']);
  });
});

describe('addedLibraries', () => {
  it('names what the install added', () => {
    expect(
      addedLibraries([{ name: 'OneWire' }], [{ name: 'OneWire' }, { name: 'Sim Test Lib' }]).map(
        (l) => l.name,
      ),
    ).toEqual(['Sim Test Lib']);
  });
});

// ---- the dialog -------------------------------------------------------

function fakeClient(overrides: Partial<LibraryClient> = {}): LibraryClient {
  const result = (libraries: InstalledLibrary[]): LibraryResult => ({
    ok: true,
    available: true,
    libraries,
    output: '',
  });
  return {
    list: vi.fn(async () => result([{ name: 'OneWire', version: '2.3.8' }])),
    search: vi.fn(async () => ({ ok: true, results: [], output: '' })),
    install: vi.fn(async () => result([{ name: 'OneWire', version: '2.3.8' }])),
    installZip: vi.fn(async () => result([{ name: 'OneWire', version: '2.3.8' }])),
    uninstall: vi.fn(async () => result([])),
    ...overrides,
  };
}

function manager(options: { libraries?: string[]; client?: LibraryClient } = {}) {
  const root = document.createElement('dialog');
  document.body.append(root);
  let libraries = options.libraries ?? [];
  const installedChanges: number[] = [];
  const api = createLibraryManager({
    root,
    client: options.client ?? fakeClient(),
    libraries: () => libraries,
    onChange: (next) => (libraries = next),
    onInstalledChange: () => installedChanges.push(1),
    searchDelayMs: 0,
  });
  return { root, api, project: () => libraries, installedChanges };
}

const rows = (root: HTMLElement, selector: string) =>
  [...root.querySelectorAll(`${selector} li`)].map((li) => li.textContent ?? '');

const button = (root: HTMLElement, selector: string, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>(`${selector} button`)].find(
    (b) => b.textContent === label,
  );

describe('the Libraries dialog', () => {
  it('lists what is installed on the machine', async () => {
    const { root, api } = manager();
    await api.refresh();
    expect(rows(root, '.library-installed').join()).toContain('OneWire');
  });

  it('says the project needs nothing when it needs nothing', () => {
    const { root } = manager();
    expect(rows(root, '.library-project').join()).toContain('does not need any extra');
  });

  it('marks a library the project wants but the machine does not have', async () => {
    const { root, api } = manager({ libraries: ['Adafruit NeoPixel'] });
    await api.refresh();
    const row = root.querySelector('.library-project li')!;
    expect(row.classList.contains('library-missing')).toBe(true);
    expect(row.textContent).toContain('not installed on this machine');
  });

  it('does not call anything missing while there is no toolchain to check with', async () => {
    /*
     * Without arduino-cli there is no installed list, so every library would
     * otherwise be reported as missing - which is a claim the app cannot make.
     */
    const client = fakeClient({
      list: vi.fn(async () => ({
        ok: false,
        available: false,
        libraries: [],
        output: 'arduino-cli is not installed or not on PATH',
      })),
    });
    const { root, api } = manager({ libraries: ['Adafruit NeoPixel'], client });
    await api.refresh();
    expect(root.querySelector('.library-project li')!.classList.contains('library-missing')).toBe(
      false,
    );
    expect(root.querySelector('.library-status')!.textContent).toContain('not installed');
  });

  it('adds an installed library to the project without reinstalling it', async () => {
    const client = fakeClient();
    const { root, api, project } = manager({ client });
    await api.refresh();
    button(root, '.library-installed', 'Add to project')!.click();
    expect(project()).toEqual(['OneWire']);
    expect(client.install).not.toHaveBeenCalled();
  });

  it('takes a library out of the project without uninstalling it', async () => {
    const client = fakeClient();
    const { root, api, project } = manager({ libraries: ['OneWire'], client });
    await api.refresh();
    button(root, '.library-project', 'Remove')!.click();
    expect(project()).toEqual([]);
    expect(client.uninstall).not.toHaveBeenCalled();
  });

  it('records a library it installs by name', async () => {
    const { api, project } = manager();
    await api.install('Adafruit NeoPixel@1.12.0');
    expect(project()).toEqual(['Adafruit NeoPixel@1.12.0']);
  });

  it('does not record a library whose install failed', async () => {
    const client = fakeClient({
      install: vi.fn(async () => ({
        ok: false,
        available: true,
        libraries: [],
        output: 'Error: library Nope not found',
      })),
    });
    const { root, api, project } = manager({ client });
    await api.install('Nope');
    expect(project()).toEqual([]);
    expect(root.querySelector('.library-status')!.textContent).toContain('not found');
  });

  it('records what a zip installed, not what the file was called', async () => {
    /*
     * `Adafruit_Foo-1.2.3.zip` installs as "Adafruit Foo". Pinning the file
     * name would put something in the project that no toolchain can resolve.
     */
    const client = fakeClient({
      installZip: vi.fn(async () => ({
        ok: true,
        available: true,
        libraries: [{ name: 'OneWire' }, { name: 'Adafruit Foo', version: '1.2.3' }],
        output: 'Installed',
      })),
    });
    const { api, project } = manager({ client });
    await api.refresh();
    await api.installZip(new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'Adafruit_Foo-1.2.3.zip'));
    expect(project()).toEqual(['Adafruit Foo@1.2.3']);
  });

  it('trusts the server about what a zip added, not its own older list', async () => {
    /*
     * The dialog's list is whatever it last fetched, which can be minutes old.
     * When it was, a library that really is new looks like one that was
     * already installed - so the server, which lists either side of the
     * install itself, is what decides.
     */
    const client = fakeClient({
      installZip: vi.fn(async () => ({
        ok: true,
        available: true,
        libraries: [{ name: 'OneWire' }, { name: 'Sim Test Lib', version: '0.1.0' }],
        added: [{ name: 'Sim Test Lib', version: '0.1.0' }],
        output: 'Library installed',
      })),
    });
    const { api, project } = manager({ client });
    await api.refresh();
    // The stale list already claims to hold it, so a local diff would find
    // nothing new.
    await api.installZip(new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'SimTestLib.zip'));
    expect(project()).toEqual(['Sim Test Lib@0.1.0']);
  });

  it('says the installed set changed, so a cached build can be dropped', async () => {
    /*
     * The compile cache is keyed on the sketch, the board and the project's
     * library list - none of which move when a library is uninstalled. Without
     * this the next Start served firmware built while the library was still
     * there, and the build looked like it had succeeded.
     */
    const { api, installedChanges } = manager();
    await api.refresh();
    expect(installedChanges).toHaveLength(1);
    await api.uninstall('OneWire');
    expect(installedChanges).toHaveLength(2);
  });

  it('stays quiet when a request found the same libraries as before', async () => {
    const { api, installedChanges } = manager();
    await api.refresh();
    await api.refresh();
    expect(installedChanges).toHaveLength(1);
  });

  it('hides the search heading until there is something under it', async () => {
    const { root } = manager();
    expect(root.querySelector<HTMLElement>('.library-results-heading')!.hidden).toBe(true);
  });

  it('says so when a zip held a library that was already there', async () => {
    const { root, api, project } = manager();
    await api.refresh();
    await api.installZip(new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'OneWire.zip'));
    expect(root.querySelector('.library-status')!.textContent).toContain('already on this machine');
    expect(project()).toEqual([]);
  });

  it('searches the index and offers to install a hit', async () => {
    const client = fakeClient({
      search: vi.fn(async () => ({
        ok: true,
        results: [{ name: 'Adafruit NeoPixel', version: '1.12.0', sentence: 'Drives LEDs.' }],
        output: '',
      })),
    });
    const { root, api, project } = manager({ client });
    await api.refresh();
    const search = root.querySelector<HTMLInputElement>('.library-search')!;
    search.value = 'neopixel';
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(root.querySelectorAll('.library-results li')).toHaveLength(1));
    button(root, '.library-results', 'Install')!.click();
    await vi.waitFor(() => expect(project()).toEqual(['Adafruit NeoPixel@1.12.0']));
  });

  it('does not search for one letter', async () => {
    // The search shells out to the CLI; a single letter matches most of the index.
    const client = fakeClient();
    const { root } = manager({ client });
    const search = root.querySelector<HTMLInputElement>('.library-search')!;
    search.value = 'a';
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    expect(client.search).not.toHaveBeenCalled();
  });

  it('runs one request at a time', async () => {
    /*
     * Every request redraws the list, and a second install landing mid-redraw
     * would replace the buttons under the pointer.
     */
    let resolve!: (r: LibraryResult) => void;
    const client = fakeClient({ install: vi.fn(() => new Promise<LibraryResult>((r) => (resolve = r))) });
    const { api } = manager({ client });
    const first = api.install('One');
    await api.install('Two');
    expect(client.install).toHaveBeenCalledTimes(1);
    resolve({ ok: true, available: true, libraries: [], output: '' });
    await first;
  });
});

describe('HttpLibraryClient', () => {
  function withFetch(impl: typeof fetch) {
    vi.stubGlobal('fetch', impl);
    return () => vi.unstubAllGlobals();
  }

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

  it('reads the installed list', async () => {
    const done = withFetch(async () =>
      json({ ok: true, available: true, libraries: [{ name: 'OneWire' }] }),
    );
    const result = await new HttpLibraryClient().list();
    expect(result.libraries).toEqual([{ name: 'OneWire' }]);
    done();
  });

  it('sends the zip as its own bytes', async () => {
    let sent: RequestInit | undefined;
    const done = withFetch(async (_url, init) => {
      sent = init;
      return json({ ok: true, available: true, libraries: [] });
    });
    const file = new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'lib.zip');
    await new HttpLibraryClient().installZip(file);
    expect(sent?.method).toBe('POST');
    expect(sent?.body).toBe(file);
    done();
  });

  it('says the service is dev-only when the SPA fallback answers with HTML', async () => {
    /*
     * A production build has no library endpoint, so index.html comes back
     * here. Parsing that as JSON would report a syntax error instead.
     */
    const done = withFetch(
      async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
    );
    const result = await new HttpLibraryClient().list();
    expect(result.available).toBe(false);
    expect(result.output).toContain('npm run dev');
    done();
  });

  it('reports a service it cannot reach at all', async () => {
    const done = withFetch(async () => {
      throw new Error('network down');
    });
    const result = await new HttpLibraryClient().list();
    expect(result.ok).toBe(false);
    expect(result.output).toContain('network down');
    done();
  });
});
