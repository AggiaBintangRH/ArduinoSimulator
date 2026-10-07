import { describe, it, expect } from 'vitest';
import '../src/parts/index.js';
import {
  serializeProject,
  deserializeProject,
  parseLibrariesTxt,
  formatLibrariesTxt,
  projectFileName,
  ProjectParseError,
  type Project,
} from '../src/storage.js';
import { EXAMPLES, getExample } from '../src/examples.js';
import { BOARD_TYPES } from '../src/mcu/boards.js';
import { Simulation } from '../src/sim/simulation.js';
import { parseDiagram } from '../src/diagram/parse.js';
import { pinLookup } from '../src/sim/registry.js';

const PROJECT: Project = {
  name: 'Test Project',
  sketch: 'void setup() {}\nvoid loop() {}',
  diagram: {
    version: 1,
    parts: [{ id: 'uno', type: 'wokwi-arduino-uno' }],
    connections: [],
  },
  libraries: ['Servo', 'FastLED@3.5.0'],
  files: [{ name: 'pitches.h', content: '#define NOTE_C4 262' }],
};

describe('project serialization', () => {
  it('round-trips a project', () => {
    const back = deserializeProject(serializeProject(PROJECT));
    expect(back.name).toBe(PROJECT.name);
    expect(back.sketch).toBe(PROJECT.sketch);
    expect(back.libraries).toEqual(PROJECT.libraries);
    expect(back.diagram.parts).toHaveLength(1);
  });

  it('rejects invalid JSON', () => {
    expect(() => deserializeProject('{ nope')).toThrow(ProjectParseError);
  });

  it('rejects a project with no diagram', () => {
    expect(() => deserializeProject('{"name":"x"}')).toThrow(/no diagram/);
  });

  it('defaults a missing name and sketch', () => {
    const p = deserializeProject(
      JSON.stringify({ diagram: { version: 1, parts: [], connections: [] } }),
    );
    expect(p.name).toBe('Untitled');
    expect(p.sketch).toBe('');
    expect(p.libraries).toEqual([]);
  });

  it('drops non-string library entries', () => {
    const p = deserializeProject(
      JSON.stringify({
        diagram: { version: 1, parts: [], connections: [] },
        libraries: ['Servo', 42, null],
      }),
    );
    expect(p.libraries).toEqual(['Servo']);
  });
});

describe('libraries.txt', () => {
  it('parses one library per line', () => {
    expect(parseLibrariesTxt('Servo\nFastLED')).toEqual(['Servo', 'FastLED']);
  });

  it('keeps version pins', () => {
    expect(parseLibrariesTxt('MySensors@2.3.0')).toEqual(['MySensors@2.3.0']);
  });

  it('skips comments and blank lines', () => {
    expect(parseLibrariesTxt('# a comment\n\nServo\n\n')).toEqual(['Servo']);
  });

  it('round-trips through the formatter', () => {
    const libs = ['Servo', 'FastLED@3.5.0'];
    expect(parseLibrariesTxt(formatLibrariesTxt(libs))).toEqual(libs);
  });

  it('formats an empty list as an empty string', () => {
    expect(formatLibrariesTxt([])).toBe('');
  });
});

describe('projectFileName', () => {
  it('slugifies the project name', () => {
    expect(projectFileName('My Cool Project')).toBe('my-cool-project.json');
  });

  it('strips punctuation', () => {
    expect(projectFileName('Blink! (v2)')).toBe('blink-v2.json');
  });

  it('falls back when the name is empty', () => {
    expect(projectFileName('   ')).toBe('project.json');
  });

  it('honours a custom extension', () => {
    expect(projectFileName('Blink', 'hex')).toBe('blink.hex');
  });
});

describe('bundled examples', () => {
  it('ships at least the documented set', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(5);
  });

  it('gives every example a unique id', () => {
    const ids = EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('looks an example up by id', () => {
    expect(getExample('blink')?.name).toBe('Blink');
    expect(getExample('nope')).toBeUndefined();
  });

  for (const example of EXAMPLES) {
    describe(example.name, () => {
      it('has a sketch and a description', () => {
        expect(example.sketch.length).toBeGreaterThan(20);
        expect(example.description.length).toBeGreaterThan(10);
      });

      it('has a diagram that parses without errors', () => {
        const { diagnostics } = parseDiagram(example.diagram, pinLookup);
        const errors = diagnostics.filter((d) => d.severity === 'error');
        expect(errors).toEqual([]);
      });

      it('builds a simulation with no errors', () => {
        const sim = new Simulation(example.diagram);
        const errors = sim.problems.filter((p) => p.severity === 'error');
        expect(errors).toEqual([]);
        sim.dispose();
      });

      it('contains exactly one microcontroller', () => {
        const boards = example.diagram.parts.filter((p) => BOARD_TYPES.has(p.type));
        expect(boards).toHaveLength(1);
      });

      it('round-trips through project serialization', () => {
        const project: Project = {
          name: example.name,
          sketch: example.sketch,
          diagram: example.diagram,
          libraries: [],
          files: [],
        };
        const back = deserializeProject(serializeProject(project));
        expect(back.diagram.connections).toEqual(example.diagram.connections);
      });
    });
  }
});
