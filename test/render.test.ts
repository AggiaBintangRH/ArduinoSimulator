// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/parts/index.js';
import { DiagramCanvas } from '../src/render/canvas.js';
import { getVisual, hasVisual, genericVisual, GRID } from '../src/render/shapes.js';
import type { Diagram } from '../src/diagram/types.js';

function makeHost(): HTMLElement {
  const host = document.createElement('div');
  Object.defineProperty(host, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
  });
  document.body.append(host);
  return host;
}

const BLINK: Diagram = {
  version: 1,
  parts: [
    { id: 'uno', type: 'wokwi-arduino-uno', left: 0, top: 0 },
    { id: 'led1', type: 'wokwi-led', left: 400, top: 100, attrs: { color: 'red' } },
    { id: 'r1', type: 'wokwi-resistor', left: 400, top: 200, attrs: { value: '220' } },
  ],
  connections: [
    ['uno:13', 'led1:A', 'green', ['v20']],
    ['led1:C', 'uno:GND.1', 'black', []],
  ],
};

describe('shapes', () => {
  it('has dedicated artwork for the core parts', () => {
    for (const type of [
      'wokwi-arduino-uno',
      'wokwi-led',
      'wokwi-resistor',
      'wokwi-pushbutton',
      'wokwi-potentiometer',
      'wokwi-lcd1602',
      'wokwi-7segment',
      'wokwi-buzzer',
    ]) {
      expect(hasVisual(type)).toBe(true);
    }
  });

  it('falls back to a generic body for unknown parts', () => {
    expect(hasVisual('wokwi-nonexistent')).toBe(false);
    const visual = getVisual('wokwi-nonexistent', ['A', 'B', 'C']);
    expect(visual.pins).toHaveLength(3);
    expect(visual.body({})).toContain('nonexistent');
  });

  it('lays out generic pins on both rows', () => {
    const visual = genericVisual('wokwi-x', ['1', '2', '3', '4']);
    const ys = new Set(visual.pins.map((p) => p.y));
    expect(ys.size).toBe(2);
  });

  it('gives the LED an anode and a cathode', () => {
    const visual = getVisual('wokwi-led');
    expect(visual.pins.map((p) => p.name).sort()).toEqual(['A', 'C']);
  });

  it('gives the Uno every documented digital and analog pin', () => {
    const names = new Set(getVisual('wokwi-arduino-uno').pins.map((p) => p.name));
    for (let d = 0; d <= 13; d++) expect(names.has(String(d))).toBe(true);
    for (let a = 0; a <= 5; a++) expect(names.has(`A${a}`)).toBe(true);
    expect(names.has('GND.1')).toBe(true);
    expect(names.has('5V')).toBe(true);
  });

  it('renders LED light only when it is on', () => {
    const visual = getVisual('wokwi-led');
    expect(visual.live!({ brightness: 0 }, { color: 'red' })).toBe('');
    expect(visual.live!({ brightness: 1 }, { color: 'red' })).toContain('opacity="1"');
  });

  it('renders LCD text into the live layer', () => {
    const visual = getVisual('wokwi-lcd1602');
    const svg = visual.live!({ text: ['Hello', 'World'], displayOn: true }, {});
    expect(svg).toContain('Hello');
    expect(svg).toContain('World');
  });

  it('renders nothing for an LCD that is switched off', () => {
    const visual = getVisual('wokwi-lcd1602');
    expect(visual.live!({ text: ['Hi'], displayOn: false }, {})).toBe('');
  });

  it('escapes markup in text attributes', () => {
    const visual = getVisual('wokwi-text');
    const svg = visual.body({ text: '<script>x</script>' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('renders neopixel colours', () => {
    const visual = getVisual('wokwi-led-strip');
    const svg = visual.live!({ pixels: [{ r: 255, g: 0, b: 0 }] }, {});
    expect(svg).toContain('rgb(255,0,0)');
  });

  it('lights only the requested 7-segment segments', () => {
    const visual = getVisual('wokwi-7segment');
    // Segment A on, everything else off.
    const lit = [true, false, false, false, false, false, false, false];
    const svg = visual.live!({ digits: [lit] }, { color: 'red' });
    expect(svg.match(/opacity="1"/g)).toHaveLength(1);
  });
});

describe('DiagramCanvas', () => {
  let host: HTMLElement;
  let canvas: DiagramCanvas;

  beforeEach(() => {
    document.body.replaceChildren();
    host = makeHost();
    canvas = new DiagramCanvas(host);
    canvas.setDiagram(BLINK);
  });

  it('creates an svg element in the host', () => {
    expect(host.querySelector('svg')).not.toBeNull();
  });

  it('renders one group per visible part', () => {
    expect(canvas.svg.querySelectorAll('g.part')).toHaveLength(3);
  });

  it('skips hidden parts', () => {
    canvas.setDiagram({
      ...BLINK,
      parts: [...BLINK.parts, { id: 'ghost', type: 'wokwi-led', hide: true }],
    });
    expect(canvas.svg.querySelector('[data-part-id="ghost"]')).toBeNull();
  });

  it('renders a polyline per visible wire', () => {
    expect(canvas.svg.querySelectorAll('polyline.wire')).toHaveLength(2);
  });

  it('hides wires whose colour is empty', () => {
    canvas.setDiagram({
      ...BLINK,
      connections: [['uno:13', 'led1:A', '', []]],
    });
    expect(canvas.svg.querySelectorAll('polyline.wire')).toHaveLength(0);
  });

  it('skips a wire referencing a missing part', () => {
    canvas.setDiagram({
      ...BLINK,
      connections: [['uno:13', 'ghost:A', 'green', []]],
    });
    expect(canvas.svg.querySelectorAll('polyline.wire')).toHaveLength(0);
  });

  it('computes an absolute pin position', () => {
    const p = canvas.pinPosition('led1', 'A');
    // The LED sits at (400,100) and its anode is at (6,38) within the body.
    expect(p).toEqual({ x: 406, y: 138 });
  });

  it('rotates pin positions with the part', () => {
    canvas.setDiagram({
      ...BLINK,
      parts: [
        { id: 'uno', type: 'wokwi-arduino-uno', left: 0, top: 0 },
        { id: 'led1', type: 'wokwi-led', left: 400, top: 100, rotate: 90 },
      ],
      connections: [],
    });
    const rotated = canvas.pinPosition('led1', 'A')!;
    const unrotated = { x: 406, y: 138 };
    expect(rotated).not.toEqual(unrotated);
    // A 90-degree turn about the body centre keeps the pin the same distance
    // from that centre.
    const centre = { x: 400 + 10, y: 100 + 20 };
    const before = Math.hypot(unrotated.x - centre.x, unrotated.y - centre.y);
    const after = Math.hypot(rotated.x - centre.x, rotated.y - centre.y);
    expect(after).toBeCloseTo(before, 6);
  });

  it('returns null for an unknown pin', () => {
    expect(canvas.pinPosition('led1', 'ZZ')).toBeNull();
    expect(canvas.pinPosition('nope', 'A')).toBeNull();
  });

  it('applies live state to the live layer', () => {
    canvas.updatePartState('led1', { brightness: 1 });
    const live = canvas.svg.querySelector('[data-part-id="led1"] .part-live')!;
    expect(live.innerHTML).toContain('opacity');
  });

  it('clears live state when the part goes dark', () => {
    canvas.updatePartState('led1', { brightness: 1 });
    canvas.updatePartState('led1', { brightness: 0 });
    const live = canvas.svg.querySelector('[data-part-id="led1"] .part-live')!;
    expect(live.innerHTML).toBe('');
  });

  it('applies a batch of states', () => {
    canvas.applyStates(new Map([['led1', { brightness: 1 }]]));
    const live = canvas.svg.querySelector('[data-part-id="led1"] .part-live')!;
    expect(live.innerHTML).not.toBe('');
  });

  it('ignores state for a part that is not rendered', () => {
    expect(() => canvas.updatePartState('ghost', { brightness: 1 })).not.toThrow();
  });

  it('marks the selected part', () => {
    canvas.select('led1');
    expect(canvas.svg.querySelector('[data-part-id="led1"]')!.classList.contains('selected')).toBe(
      true,
    );
    expect(canvas.selected).toBe('led1');
  });

  it('moves the selection', () => {
    canvas.select('led1');
    canvas.select('r1');
    expect(canvas.svg.querySelector('[data-part-id="led1"]')!.classList.contains('selected')).toBe(
      false,
    );
  });

  it('snaps to the 0.1in grid', () => {
    expect(canvas.snap({ x: GRID * 2 + 3, y: GRID * 3 - 4 })).toEqual({
      x: GRID * 2,
      y: GRID * 3,
    });
  });

  it('snaps to the fine grid when asked', () => {
    const snapped = canvas.snap({ x: GRID * 0.5 + 1, y: 0 }, true);
    expect(snapped.x).toBeCloseTo(GRID / 2, 6);
  });

  it('clamps zoom to a usable range', () => {
    canvas.setZoom(100);
    expect(canvas.currentZoom).toBe(4);
    canvas.setZoom(0);
    expect(canvas.currentZoom).toBe(0.2);
  });

  it('converts client coordinates into diagram space', () => {
    canvas.setZoom(1);
    // The canvas starts panned to (40,40).
    expect(canvas.toDiagramPoint(140, 140)).toEqual({ x: 100, y: 100 });
  });

  it('accounts for zoom when converting coordinates', () => {
    canvas.setZoom(2);
    expect(canvas.toDiagramPoint(140, 140)).toEqual({ x: 50, y: 50 });
  });

  it('reports pin clicks with the part and pin name', () => {
    const seen: string[] = [];
    const c = new DiagramCanvas(makeHost(), {
      onPinClick: (partId, pin) => seen.push(`${partId}:${pin}`),
    });
    c.setDiagram(BLINK);
    const pin = c.svg.querySelector('[data-part-id="led1"] .pin[data-pin="A"]')!;
    pin.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
    expect(seen).toEqual(['led1:A']);
  });

  it('draws and clears a pending wire', () => {
    canvas.showPendingWire({ x: 0, y: 0 }, { x: 50, y: 50 });
    expect(canvas.svg.querySelectorAll('polyline')).toHaveLength(3); // 2 wires + preview
    canvas.clearPendingWire();
    expect(canvas.svg.querySelectorAll('polyline')).toHaveLength(2);
  });

  it('survives a diagram with no parts', () => {
    expect(() =>
      canvas.setDiagram({ version: 1, parts: [], connections: [] }),
    ).not.toThrow();
    expect(canvas.svg.querySelectorAll('g.part')).toHaveLength(0);
  });
});
