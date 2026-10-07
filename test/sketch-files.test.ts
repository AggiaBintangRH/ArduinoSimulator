import { describe, it, expect } from 'vitest';
import {
  fileNameError,
  isValidFileName,
  suggestFileName,
  addFile,
  removeFile,
  findFile,
  parseFiles,
  MAIN_FILE,
  type SketchFile,
} from '../src/build/sketch-files.js';
import { isSketchFileName, acceptedSketchFiles } from '../vite-plugins/arduino-cli.js';
import { CachingCompiler, type Compiler, type CompileResult } from '../src/build/compiler.js';
import { serializeProject, deserializeProject, type Project } from '../src/storage.js';

describe('fileNameError', () => {
  it('accepts the headers a sketch actually has', () => {
    for (const name of ['pitches.h', 'notes.hpp', 'helper.cpp', 'driver.c', 'boot.S']) {
      expect(fileNameError(name), name).toBeNull();
    }
  });

  it('accepts an extension in capitals, which is still a header', () => {
    expect(fileNameError('Pitches.H')).toBeNull();
  });

  it('still refuses lowercase .s, which gcc treats differently', () => {
    // `.S` runs through the preprocessor and `.s` does not; arduino-cli only
    // builds the former.
    expect(fileNameError('boot.s')).toContain('not a source file');
  });

  it('refuses a path rather than treating it as a name', () => {
    /*
     * These become real files in the sketch directory on the machine running
     * the toolchain, so a name that walks out of it must never get that far.
     */
    for (const bad of ['../pitches.h', 'src/pitches.h', 'a\\b.h', '/etc/passwd', 'C:\\x.h']) {
      expect(fileNameError(bad), bad).toContain('path');
    }
  });

  it('asks for an extension instead of guessing one', () => {
    expect(fileNameError('pitches')).toContain('pitches.h');
  });

  it('refuses a file the toolchain would not compile', () => {
    expect(fileNameError('notes.txt')).toContain('not a source file');
  });

  it('will not let a second file claim the main sketch name', () => {
    // The main sketch is written under this name; a duplicate would replace
    // the code being built.
    expect(fileNameError(MAIN_FILE)).toContain('main sketch');
    expect(fileNameError('Sketch.INO')).toContain('main sketch');
  });

  it('refuses a name already in the sketch, whatever its case', () => {
    // Windows and macOS treat these as one file.
    const existing: SketchFile[] = [{ name: 'pitches.h', content: '' }];
    expect(fileNameError('Pitches.H', existing)).toContain('already');
  });

  it('says something for an empty name', () => {
    expect(fileNameError('   ')).toContain('name');
    expect(isValidFileName('')).toBe(false);
  });
});

describe('suggestFileName', () => {
  it('makes a bare word a header', () => {
    expect(suggestFileName('pitches')).toBe('pitches.h');
  });

  it('leaves a name that already has an extension alone', () => {
    expect(suggestFileName('pitches.cpp')).toBe('pitches.cpp');
  });

  it('has nothing to suggest for nothing', () => {
    expect(suggestFileName('  ')).toBe('');
  });
});

describe('the file list', () => {
  it('keeps files in name order', () => {
    const files = addFile(addFile([], 'zoo.h'), 'alpha.h');
    expect(files.map((f) => f.name)).toEqual(['alpha.h', 'zoo.h']);
  });

  it('removes and finds without minding case', () => {
    const files = addFile([], 'pitches.h', '#define NOTE_C4 262');
    expect(findFile(files, 'PITCHES.H')?.content).toBe('#define NOTE_C4 262');
    expect(removeFile(files, 'PITCHES.H')).toEqual([]);
  });
});

describe('parseFiles', () => {
  it('reads a saved list', () => {
    expect(parseFiles([{ name: 'pitches.h', content: 'x' }])).toEqual([
      { name: 'pitches.h', content: 'x' },
    ]);
  });

  it('gives an older project with no files an empty list', () => {
    expect(parseFiles(undefined)).toEqual([]);
  });

  it('drops anything that is not a usable file', () => {
    /*
     * An imported project is a file someone was given. Its names end up on
     * disk, so a bad one is dropped rather than trusted.
     */
    expect(
      parseFiles([
        { name: '../escape.h', content: 'x' },
        { name: 'ok.h', content: 'y' },
        { name: 'nocontent.h' },
        'not an object',
      ]),
    ).toEqual([{ name: 'ok.h', content: 'y' }]);
  });
});

describe('the server-side name check', () => {
  it('agrees with the browser about ordinary names', () => {
    for (const name of ['pitches.h', 'helper.cpp', 'boot.S']) {
      expect(isSketchFileName(name), name).toBe(true);
    }
  });

  it('refuses paths, traversal and the main sketch', () => {
    for (const bad of ['../x.h', 'a/b.h', 'a\\b.h', 'sketch.ino', 'x..h', 'notes.txt', '']) {
      expect(isSketchFileName(bad), bad).toBe(false);
    }
  });

  it('keeps one of a pair that differ only in case', () => {
    // Written into one directory, the second would overwrite the first, and
    // the sketch would build against whichever happened to land last.
    const files = acceptedSketchFiles([
      { name: 'pitches.h', content: 'first' },
      { name: 'Pitches.H', content: 'second' },
    ]);
    expect(files).toEqual([{ name: 'pitches.h', content: 'first' }]);
  });

  it('drops what it will not write instead of failing the whole build', () => {
    expect(acceptedSketchFiles([{ name: '../evil.h', content: 'x' }])).toEqual([]);
    expect(acceptedSketchFiles('not a list')).toEqual([]);
  });
});

describe('the build cache and sketch files', () => {
  /*
   * The cache key used to be the sketch, the board and the libraries. Editing
   * a header changes none of those, so the second Start served the firmware
   * built before the edit - and the change looked like it had done nothing.
   */
  function counting(): { compiler: Compiler; calls: () => number } {
    let calls = 0;
    const inner: Compiler = {
      status: async () => ({ available: true }),
      compile: async (): Promise<CompileResult> => {
        calls += 1;
        return { ok: true, hex: ':00000001FF', diagnostics: [], output: '' };
      },
    };
    return { compiler: inner, calls: () => calls };
  }

  it('rebuilds when a header changed', async () => {
    const { compiler, calls } = counting();
    const cache = new CachingCompiler(compiler);
    const sketch = 'void setup(){} void loop(){}';
    await cache.compile(sketch, { files: [{ name: 'pitches.h', content: 'A' }] });
    await cache.compile(sketch, { files: [{ name: 'pitches.h', content: 'B' }] });
    expect(calls()).toBe(2);
  });

  it('still serves the cache when nothing changed', async () => {
    const { compiler, calls } = counting();
    const cache = new CachingCompiler(compiler);
    const options = { files: [{ name: 'pitches.h', content: 'A' }] };
    await cache.compile('void setup(){}', options);
    await cache.compile('void setup(){}', options);
    expect(calls()).toBe(1);
  });
});

describe('files in a saved project', () => {
  const project: Project = {
    name: 'Piano',
    sketch: '#include "pitches.h"',
    diagram: { version: 1, parts: [{ id: 'uno', type: 'wokwi-arduino-uno' }], connections: [] },
    libraries: [],
    files: [{ name: 'pitches.h', content: '#define NOTE_C4 262' }],
  };

  it('travels with the project', () => {
    expect(deserializeProject(serializeProject(project)).files).toEqual(project.files);
  });

  it('opens a project written before files existed', () => {
    const older = JSON.stringify({ name: 'Old', sketch: '', diagram: project.diagram });
    expect(deserializeProject(older).files).toEqual([]);
  });
});
