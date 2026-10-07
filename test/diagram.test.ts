import { describe, it, expect } from 'vitest';
import {
  parseDiagram,
  parsePinRef,
  stringifyDiagram,
  assertNoErrors,
  DiagramParseError,
} from '../src/diagram/parse.js';
import {
  parseRoute,
  routeWire,
  dedupe,
  offsetSegment,
  routeFromPoints,
  nearestSegment,
  perpendicular,
  roundedPath,
  RouteParseError,
} from '../src/diagram/router.js';

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

describe('offsetSegment', () => {
  // A plain elbow: right along the top, then down to the target.
  const source = { x: 0, y: 0 };
  const target = { x: 100, y: 60 };
  const elbow = routeWire(source, target, []);

  it('leaves the polyline alone for a segment index out of range', () => {
    expect(offsetSegment(elbow, -1, 20)).toEqual(elbow);
    expect(offsetSegment(elbow, elbow.length - 1, 20)).toEqual(elbow);
  });

  it('keeps both ends on their pins when the first segment is dragged', () => {
    const moved = offsetSegment(elbow, 0, 24);
    expect(moved[0]).toEqual(source);
    expect(moved[moved.length - 1]).toEqual(target);
  });

  it('keeps both ends on their pins when the last segment is dragged', () => {
    const last = elbow.length - 2;
    const moved = offsetSegment(elbow, last, -24);
    expect(moved[0]).toEqual(source);
    expect(moved[moved.length - 1]).toEqual(target);
  });

  it('keeps both ends on their pins for a straight two-point wire', () => {
    const straight = [source, { x: 0, y: 80 }];
    const moved = offsetSegment(straight, 0, 20);
    expect(moved[0]).toEqual(straight[0]);
    expect(moved[moved.length - 1]).toEqual(straight[1]);
  });

  it('actually moves the segment it was given', () => {
    const straight = [source, { x: 0, y: 80 }];
    const moved = offsetSegment(straight, 0, 20);
    // The vertical run now sits 20px to one side, joined by two new elbows.
    const xs = new Set(moved.map((p) => p.x));
    expect(xs.has(0)).toBe(true);
    expect(xs.has(20) || xs.has(-20)).toBe(true);
  });

  it('stays orthogonal', () => {
    for (const seg of [0, 1]) {
      const moved = offsetSegment(elbow, seg, 19.2);
      for (let i = 0; i < moved.length - 1; i++) {
        const dx = moved[i + 1].x - moved[i].x;
        const dy = moved[i + 1].y - moved[i].y;
        expect(dx === 0 || dy === 0).toBe(true);
      }
    }
  });

  it('is a no-op for a zero offset', () => {
    expect(offsetSegment(elbow, 0, 0)).toEqual(elbow);
  });
});

describe('routeFromPoints', () => {
  it('round-trips a routed wire through routeWire', () => {
    const source = { x: 0, y: 0 };
    const target = { x: 100, y: 60 };
    const points = offsetSegment(routeWire(source, target, []), 0, 24);
    const route = routeFromPoints(points);
    expect(routeWire(source, target, route)).toEqual(points);
  });

  it('survives being stored and parsed as diagram JSON', () => {
    const source = { x: 0, y: 0 };
    const target = { x: 100, y: 60 };
    const points = offsetSegment(routeWire(source, target, []), 1, -19.2);
    const route = routeFromPoints(points);
    const reloaded = JSON.parse(JSON.stringify(route)) as string[];
    expect(() => parseRoute(reloaded)).not.toThrow();
    expect(routeWire(source, target, reloaded)).toEqual(points);
  });

  it('emits no step for a zero-length move', () => {
    expect(routeFromPoints([{ x: 0, y: 0 }, { x: 0, y: 0 }])).toEqual([]);
  });

  it('keeps numbers free of floating-point noise', () => {
    const points = [{ x: 0, y: 0 }, { x: 0.1 + 0.2, y: 0 }];
    expect(routeFromPoints(points)).toEqual(['h0.3']);
  });
});

describe('nearestSegment', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it('picks the horizontal run for a point above it', () => {
    expect(nearestSegment(points, { x: 50, y: 4 })).toBe(0);
  });

  it('picks the vertical run for a point beside it', () => {
    expect(nearestSegment(points, { x: 96, y: 70 })).toBe(1);
  });

  it('reports -1 when there is no segment at all', () => {
    expect(nearestSegment([{ x: 0, y: 0 }], { x: 0, y: 0 })).toBe(-1);
  });
});

describe('perpendicular', () => {
  it('is horizontal for a vertical segment, and vice versa', () => {
    expect(perpendicular({ x: 0, y: 0 }, { x: 0, y: 10 })).toEqual({ x: -1, y: 0 });
    expect(perpendicular({ x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 0, y: 1 });
  });
});

describe('dedupe tolerance', () => {
  it('closes a run that lands a rounding error away from the pin', () => {
    // Route steps are rounded to a tenth of a pixel, so a long chain can end
    // a hair off the target. That used to leave a zero-length segment, which
    // then grew a drag handle of its own.
    const source = { x: 184, y: 9 };
    const target = { x: 386, y: 58 };
    const points = routeWire(source, target, [
      'h19.2',
      'v-115.2',
      'h125.2',
      'v164.2',
      'h57.6',
    ]);
    expect(points[points.length - 1]).toEqual(target);
    for (let i = 0; i < points.length - 1; i++) {
      const length = Math.hypot(
        points[i + 1].x - points[i].x,
        points[i + 1].y - points[i].y,
      );
      expect(length).toBeGreaterThan(0.001);
    }
  });
});

describe('roundedPath', () => {
  const elbow = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it('starts at the first point and ends at the last', () => {
    const d = roundedPath(elbow, 8);
    expect(d.startsWith('M0 0')).toBe(true);
    expect(d.endsWith('L100 100')).toBe(true);
  });

  it('curves through the corner instead of turning square', () => {
    const d = roundedPath(elbow, 8);
    expect(d).toContain('Q100 0');
    // The straight run stops short of the corner by the radius.
    expect(d).toContain('L92 0');
  });

  it('never rounds more than half a segment', () => {
    // A 10px run with a 40px radius would otherwise overshoot the corner and
    // double back on itself.
    const tight = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const d = roundedPath(tight, 40);
    expect(d).toContain('L5 0');
    expect(d).toContain('Q10 0 10 5');
  });

  it('leaves a straight two-point wire alone', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 50, y: 0 }], 8)).toBe('M0 0 L50 0');
  });

  it('handles degenerate input without throwing', () => {
    expect(roundedPath([], 8)).toBe('');
    expect(roundedPath([{ x: 3, y: 4 }], 8)).toBe('M3 4');
  });
});
