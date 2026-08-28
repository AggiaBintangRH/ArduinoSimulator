import { describe, it, expect } from 'vitest';
import {
  parseDiagram,
  parsePinRef,
  stringifyDiagram,
  assertNoErrors,
  DiagramParseError,
} from '../src/diagram/parse.js';
import { parseRoute, routeWire, dedupe, RouteParseError } from '../src/diagram/router.js';

const BLINK = {
  version: 1,
  author: 'test',
  editor: 'wokwi',
  parts: [
    { id: 'uno', type: 'wokwi-arduino-uno', top: 0, left: 0 },
    { id: 'led1', type: 'wokwi-led', top: -50, left: 100, attrs: { color: 'red' } },
    { id: 'r1', type: 'wokwi-resistor', top: 20, left: 100, attrs: { value: '220' } },
  ],
  connections: [
    ['uno:13', 'r1:1', 'green', ['v10', 'h20']],
    ['r1:2', 'led1:A', 'green', []],
    ['led1:C', 'uno:GND.1', 'black', ['v0', '*', 'h-10']],
  ],
};

const PINS: Record<string, string[]> = {
  'wokwi-arduino-uno': ['13', 'GND.1', 'GND.2', 'GND.3', 'A0'],
  'wokwi-led': ['A', 'C'],
  'wokwi-resistor': ['1', '2'],
};
const lookup = (type: string) => PINS[type] ?? null;

describe('parsePinRef', () => {
  it('splits a simple reference', () => {
    expect(parsePinRef('uno:13')).toEqual({ partId: 'uno', pin: '13' });
  });

  it('keeps dots that belong to the pin name', () => {
    expect(parsePinRef('uno:GND.2')).toEqual({ partId: 'uno', pin: 'GND.2' });
  });

  it('rejects malformed references', () => {
    expect(() => parsePinRef('uno')).toThrow(DiagramParseError);
    expect(() => parsePinRef(':13')).toThrow(DiagramParseError);
    expect(() => parsePinRef('uno:')).toThrow(DiagramParseError);
  });
});

describe('parseDiagram', () => {
  it('parses a valid diagram with no diagnostics', () => {
    const { diagram, diagnostics } = parseDiagram(BLINK, lookup);
    expect(diagnostics).toEqual([]);
    expect(diagram.parts).toHaveLength(3);
    expect(diagram.connections).toHaveLength(3);
    expect(diagram.parts[1].attrs).toEqual({ color: 'red' });
  });

  it('accepts a JSON string', () => {
    const { diagram } = parseDiagram(JSON.stringify(BLINK), lookup);
    expect(diagram.parts[0].id).toBe('uno');
  });

  it('defaults an omitted route to an empty array', () => {
    const { diagram } = parseDiagram({
      version: 1,
      parts: [{ id: 'a', type: 'wokwi-led' }, { id: 'b', type: 'wokwi-led' }],
      connections: [['a:A', 'b:C', 'green']],
    });
    expect(diagram.connections[0][3]).toEqual([]);
  });

  it('coerces non-string attribute values', () => {
    const { diagram } = parseDiagram({
      version: 1,
      parts: [{ id: 'l', type: 'wokwi-led', attrs: { fps: 80, flip: true } }],
      connections: [],
    });
    expect(diagram.parts[0].attrs).toEqual({ fps: '80', flip: 'true' });
  });

  it('rejects duplicate part ids', () => {
    expect(() =>
      parseDiagram({
        version: 1,
        parts: [{ id: 'x', type: 'wokwi-led' }, { id: 'x', type: 'wokwi-led' }],
        connections: [],
      }),
    ).toThrow(/duplicate/i);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseDiagram('{ not json')).toThrow(DiagramParseError);
  });

  it('rejects a part without an id', () => {
    expect(() =>
      parseDiagram({ version: 1, parts: [{ type: 'wokwi-led' }], connections: [] }),
    ).toThrow(/id must be/);
  });

  it('flags a connection to a missing part', () => {
    const { diagnostics } = parseDiagram(
      {
        version: 1,
        parts: [{ id: 'led1', type: 'wokwi-led' }],
        connections: [['led1:A', 'ghost:1', 'green', []]],
      },
      lookup,
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('ghost') }),
    );
  });

  it('flags a pin the part does not have', () => {
    const { diagnostics } = parseDiagram(
      {
        version: 1,
        parts: [
          { id: 'uno', type: 'wokwi-arduino-uno' },
          { id: 'led1', type: 'wokwi-led' },
        ],
        connections: [['uno:13', 'led1:Z', 'green', []]],
      },
      lookup,
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('no pin "Z"') }),
    );
  });

  it('warns (not errors) on an unknown part type', () => {
    const { diagnostics } = parseDiagram(
      {
        version: 1,
        parts: [{ id: 'x', type: 'wokwi-mystery' }],
        connections: [],
      },
      lookup,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
  });

  it('warns on an unknown serialMonitor display mode', () => {
    const { diagnostics, diagram } = parseDiagram({
      version: 1,
      parts: [],
      connections: [],
      serialMonitor: { display: 'hologram' },
    });
    expect(diagram.serialMonitor?.display).toBeUndefined();
    expect(diagnostics[0].severity).toBe('warning');
  });

  it('keeps valid serialMonitor options', () => {
    const { diagram } = parseDiagram({
      version: 1,
      parts: [],
      connections: [],
      serialMonitor: { display: 'terminal', newline: 'crlf', convertEol: true },
    });
    expect(diagram.serialMonitor).toEqual({
      display: 'terminal',
      newline: 'crlf',
      convertEol: true,
    });
  });

  it('assertNoErrors throws only on errors, not warnings', () => {
    const warnOnly = parseDiagram(
      { version: 1, parts: [{ id: 'x', type: 'wokwi-mystery' }], connections: [] },
      lookup,
    );
    expect(() => assertNoErrors(warnOnly)).not.toThrow();

    const withError = parseDiagram(
      {
        version: 1,
        parts: [{ id: 'led1', type: 'wokwi-led' }],
        connections: [['led1:A', 'ghost:1', 'green', []]],
      },
      lookup,
    );
    expect(() => assertNoErrors(withError)).toThrow(DiagramParseError);
  });

  it('round-trips through stringifyDiagram', () => {
    const { diagram } = parseDiagram(BLINK, lookup);
    const again = parseDiagram(stringifyDiagram(diagram), lookup);
    expect(again.diagram).toEqual(diagram);
  });
});

describe('parseRoute', () => {
  it('splits on the anchor', () => {
    expect(parseRoute(['v10', 'h5', '*', 'v-15', 'h10'])).toEqual({
      fromSource: [
        { axis: 'v', delta: 10 },
        { axis: 'h', delta: 5 },
      ],
      fromTarget: [
        { axis: 'v', delta: -15 },
        { axis: 'h', delta: 10 },
      ],
    });
  });

  it('treats a route with no anchor as all source-side', () => {
    const r = parseRoute(['v10']);
    expect(r.fromSource).toHaveLength(1);
    expect(r.fromTarget).toHaveLength(0);
  });

  it('accepts an empty route', () => {
    expect(parseRoute([])).toEqual({ fromSource: [], fromTarget: [] });
  });

  it('rejects a second anchor', () => {
    expect(() => parseRoute(['*', '*'])).toThrow(RouteParseError);
  });

  it('rejects garbage instructions', () => {
    expect(() => parseRoute(['x10'])).toThrow(RouteParseError);
    expect(() => parseRoute(['v'])).toThrow(RouteParseError);
  });
});

describe('routeWire', () => {
  const A = { x: 0, y: 0 };

  it('connects aligned pins with a straight line', () => {
    expect(routeWire(A, { x: 0, y: 100 }, [])).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ]);
  });

  it('always starts at the source and ends at the target', () => {
    const pts = routeWire(A, { x: 80, y: 60 }, ['v10', 'h5', '*', 'v-15']);
    expect(pts[0]).toEqual(A);
    expect(pts[pts.length - 1]).toEqual({ x: 80, y: 60 });
  });

  it('keeps every segment axis-aligned', () => {
    const pts = routeWire(A, { x: 120, y: -40 }, ['v20', '*', 'h-30']);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it('follows explicit source-side steps', () => {
    const pts = routeWire(A, { x: 200, y: 200 }, ['v10', 'h20']);
    expect(pts[1]).toEqual({ x: 0, y: 10 });
    expect(pts[2]).toEqual({ x: 20, y: 10 });
  });

  it('walks target-side steps back into the target pin', () => {
    const target = { x: 80, y: 60 };
    const pts = routeWire(A, target, ['*', 'v-15', 'h10']);
    // Target-side steps are measured from the target, so the vertex before it
    // is target + v(-15).
    expect(pts[pts.length - 2]).toEqual({ x: 80, y: 45 });
    expect(pts[pts.length - 1]).toEqual(target);
    // ...and the one before that adds h(10) on top.
    expect(pts[pts.length - 3]).toEqual({ x: 90, y: 45 });
  });

  it('collapses a target-side vertex that lands on the approach line', () => {
    // ['*','h-10'] into (100,100) puts a vertex at (90,100), but the wire
    // already arrives horizontally along y=100, so it is redundant.
    const pts = routeWire(A, { x: 100, y: 100 }, ['*', 'h-10']);
    expect(pts).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ]);
  });
});

describe('dedupe', () => {
  it('removes repeated points', () => {
    expect(dedupe([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }])).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
  });

  it('collapses collinear runs', () => {
    expect(
      dedupe([
        { x: 0, y: 0 },
        { x: 0, y: 5 },
        { x: 0, y: 10 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
    ]);
  });
});
