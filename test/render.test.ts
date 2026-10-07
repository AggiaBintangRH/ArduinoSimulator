// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/parts/index.js';
import { DiagramCanvas } from '../src/render/canvas.js';
import { layoutPinLabels } from '../src/render/pin-labels.js';
import { MEGA_PINS } from '../src/mcu/boards.js';
import {
  getVisual,
  hasVisual,
  genericVisual,
  withIdPrefix,
  GRID,
  PIN_INSET,
  LEAD_GAP,
  BODY_INSET,
} from '../src/render/shapes.js';
import { pinLookup, registeredTypes } from '../src/sim/registry.js';
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

  it('gives the Mega a pressable reset button', () => {
    const visual = getVisual('wokwi-arduino-mega');
    const reset = visual.controls?.find((c) => c.name === 'reset');
    expect(reset).toBeDefined();
    expect(reset!.momentary).toBe(true);
    // It has to sit on the artwork's own button, not float somewhere on the
    // PCB. Checking that against the drawn circle rather than a region of the
    // board means redrawing the board cannot quietly leave the two apart.
    const body = visual.body({});
    const buttons = [...body.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]), r: Number(m[3]) }))
      .filter((c) => Math.hypot(c.x - reset!.x, c.y - reset!.y) < 1);
    expect(buttons.length).toBeGreaterThan(0);
    // And the hit area has to cover the cap, not just its centre.
    expect(reset!.r).toBeGreaterThanOrEqual(Math.max(...buttons.map((b) => b.r)));
  });

  it('gives the Mega every header pin the board definition declares', () => {
    const visual = getVisual('wokwi-arduino-mega');
    const names = new Set(visual.pins.map((p) => p.name));
    for (const name of MEGA_PINS) expect(names.has(name)).toBe(true);
    expect(names.size).toBe(MEGA_PINS.length);
  });

  it('keeps every Mega pin inside the board outline and off its neighbours', () => {
    const visual = getVisual('wokwi-arduino-mega');
    const seen = new Set<string>();
    for (const pin of visual.pins) {
      expect(pin.x).toBeGreaterThanOrEqual(0);
      expect(pin.x).toBeLessThanOrEqual(visual.width);
      expect(pin.y).toBeGreaterThanOrEqual(0);
      expect(pin.y).toBeLessThanOrEqual(visual.height);
      const at = `${pin.x},${pin.y}`;
      expect(seen.has(at)).toBe(false);
      seen.add(at);
    }
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

  it('renders a wire per visible connection', () => {
    // The drawn cable is a rounded path; the straight polyline beside it is
    // the grab area.
    expect(canvas.svg.querySelectorAll('path.wire')).toHaveLength(2);
    expect(canvas.svg.querySelectorAll('polyline.wire-hit')).toHaveLength(2);
  });

  it('hides wires whose colour is empty', () => {
    canvas.setDiagram({
      ...BLINK,
      connections: [['uno:13', 'led1:A', '', []]],
    });
    expect(canvas.svg.querySelectorAll('path.wire')).toHaveLength(0);
  });

  it('skips a wire referencing a missing part', () => {
    canvas.setDiagram({
      ...BLINK,
      connections: [['uno:13', 'ghost:A', 'green', []]],
    });
    expect(canvas.svg.querySelectorAll('path.wire')).toHaveLength(0);
  });

  it('computes an absolute pin position', () => {
    // Read the offset from the artwork rather than writing it down here, so
    // redrawing a part does not fail a test about coordinate arithmetic.
    const anode = getVisual('wokwi-led').pins.find((p) => p.name === 'A')!;
    expect(canvas.pinPosition('led1', 'A')).toEqual({
      x: 400 + anode.x,
      y: 100 + anode.y,
    });
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
    const visual = getVisual('wokwi-led');
    const anode = visual.pins.find((p) => p.name === 'A')!;
    const rotated = canvas.pinPosition('led1', 'A')!;
    const unrotated = { x: 400 + anode.x, y: 100 + anode.y };
    expect(rotated).not.toEqual(unrotated);
    // A 90-degree turn about the body centre keeps the pin the same distance
    // from that centre.
    const centre = { x: 400 + visual.width / 2, y: 100 + visual.height / 2 };
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

  it('rewrites artwork ids and every reference to them', () => {
    const out = withIdPrefix(
      '<pattern id="holes"/><rect fill="url(#holes)"/><use xlink:href="#body"/>',
      'copy-',
    );
    expect(out).toContain('id="copy-holes"');
    expect(out).toContain('url(#copy-holes)');
    expect(out).toContain('xlink:href="#copy-body"');
  });

  it('offers pins as targets only while a wire is being drawn', () => {
    // Pins are painted by CSS keyed off this class. They stay hidden the rest
    // of the time so board artwork that draws its own header holes is not
    // buried under 85 dots.
    const c = new DiagramCanvas(makeHost());
    c.setDiagram(BLINK);
    expect(c.svg.classList.contains('wiring')).toBe(false);

    c.setWiring(true);
    expect(c.svg.classList.contains('wiring')).toBe(true);

    c.clearPendingWire();
    expect(c.svg.classList.contains('wiring')).toBe(false);
  });

  it('frames the whole diagram, whatever size the board is', () => {
    // The view used to start at a fixed corner and 1x, which suited a 300px
    // Uno and cut a 776px Mega in half.
    const c = new DiagramCanvas(makeHost());
    c.setDiagram({
      version: 1,
      parts: [{ id: 'mega', type: 'wokwi-arduino-mega', left: 0, top: 0 }],
      connections: [],
    });
    const bounds = c.contentBounds()!;
    expect(bounds.width).toBeGreaterThan(700);

    c.fitToContent();
    // The host reports 800x600, so a 776px board has to be scaled down to fit.
    expect(c.currentZoom).toBeLessThan(1);
    expect(c.currentZoom).toBeGreaterThan(0.2);
  });

  it('never zooms past 1:1 for a small diagram', () => {
    const c = new DiagramCanvas(makeHost());
    c.setDiagram({
      version: 1,
      parts: [{ id: 'led1', type: 'wokwi-led', left: 0, top: 0 }],
      connections: [],
    });
    c.fitToContent();
    expect(c.currentZoom).toBe(1);
  });

  it('leaves the view alone when there is nothing to frame', () => {
    const c = new DiagramCanvas(makeHost());
    c.setDiagram({ version: 1, parts: [], connections: [] });
    expect(c.contentBounds()).toBeNull();
    c.fitToContent();
    expect(c.currentZoom).toBe(1);
  });

  it('reports a control press and release without selecting the part', () => {
    const seen: string[] = [];
    const c = new DiagramCanvas(makeHost(), {
      onControl: (partId, control, value) => seen.push(`${partId}:${control}=${value}`),
      onPartClick: (partId) => seen.push(`select:${partId}`),
    });
    c.setDiagram({
      version: 1,
      parts: [{ id: 'mega', type: 'wokwi-arduino-mega', left: 0, top: 0 }],
      connections: [],
    });
    const button = c.svg.querySelector('[data-part-id="mega"] .part-control')!;
    button.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
    button.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true }));
    // No 'select:mega': pressing the button must not start dragging the board.
    expect(seen).toEqual(['mega:reset=true', 'mega:reset=false']);
  });

  it('gives every part a sketch can be poked through something to poke', () => {
    /*
     * The pushbutton had a `control` handler in the simulation and no control
     * in its artwork, so nothing ever called it: clicking the button only
     * selected the part, and a sketch waiting on a press waited forever.
     */
    for (const type of ['wokwi-pushbutton', 'wokwi-pushbutton-6mm', 'wokwi-slide-switch']) {
      expect(getVisual(type).controls?.length, type).toBeGreaterThan(0);
    }
  });

  it('presses a button while it is held, and lets go on release', () => {
    const seen: string[] = [];
    const c = new DiagramCanvas(makeHost(), {
      onControl: (partId, control, value) => seen.push(`${partId}:${control}=${value}`),
      onPartClick: (partId) => seen.push(`select:${partId}`),
    });
    c.setDiagram({
      version: 1,
      parts: [{ id: 'btn1', type: 'wokwi-pushbutton', left: 0, top: 0 }],
      connections: [],
    });
    const cap = c.svg.querySelector('[data-part-id="btn1"] .part-control')!;
    cap.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
    cap.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true }));
    // A real button conducts while held; it does not latch.
    expect(seen).toEqual(['btn1:pressed=true', 'btn1:pressed=false']);
  });

  it('flips a switch back and forth, rather than only one way', () => {
    /*
     * A latching control has to send the opposite of where the part is. Sending
     * `true` on every press - which is all a momentary control does - would let
     * a switch be flipped once and never back.
     */
    const seen: boolean[] = [];
    const c = new DiagramCanvas(makeHost(), {
      onControl: (_id, _control, value) => seen.push(value),
    });
    c.setDiagram({
      version: 1,
      parts: [{ id: 'sw1', type: 'wokwi-slide-switch', left: 0, top: 0 }],
      connections: [],
    });
    const lever = c.svg.querySelector('[data-part-id="sw1"] .part-control')!;
    lever.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
    // The part reports where it ended up; the next press flips that.
    c.updatePartState('sw1', { position: 'right' });
    lever.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
    c.updatePartState('sw1', { position: 'left' });
    lever.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
    expect(seen).toEqual([true, false, true]);
  });

  it('flips away from the position the diagram started the switch in', () => {
    // A switch saved in its right-hand position must move left on the first
    // press, not send `true` at a switch that is already there.
    const seen: boolean[] = [];
    const c = new DiagramCanvas(makeHost(), {
      onControl: (_id, _control, value) => seen.push(value),
    });
    c.setDiagram({
      version: 1,
      parts: [{ id: 'sw1', type: 'wokwi-slide-switch', left: 0, top: 0, attrs: { value: '1' } }],
      connections: [],
    });
    c.updatePartState('sw1', { position: 'right' });
    c.svg
      .querySelector('[data-part-id="sw1"] .part-control')!
      .dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
    expect(seen).toEqual([false]);
  });

  it('draws and clears a pending wire', () => {
    canvas.showPendingWire({ x: 0, y: 0 }, { x: 50, y: 50 });
    expect(canvas.svg.querySelectorAll('polyline')).toHaveLength(3); // 2 grab areas + preview
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

describe('wire dragging', () => {
  // jsdom has no PointerEvent, and no layout for SVG. The canvas only reads
  // clientX/clientY and getBoundingClientRect, so a MouseEvent carrying a
  // pointerId is enough to drive the real handlers.
  function pointer(type: string, x: number, y: number): Event {
    const ev = new MouseEvent(type, {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(ev, 'pointerId', { value: 1 });
    Object.defineProperty(ev, 'button', { value: 0 });
    return ev;
  }

  function setup() {
    const host = makeHost();
    const routes: { index: number; route: string[] }[] = [];
    const selections: (number | null)[] = [];
    const canvas = new DiagramCanvas(host, {
      onWireRouted: (index, route) => routes.push({ index, route }),
      onWireSelect: (index) => selections.push(index),
    });
    canvas.setDiagram(structuredClone(BLINK));
    return { host, canvas, routes, selections };
  }

  /**
   * How far a coordinate sits from the nearest grid line. Plain `%` reports
   * almost a whole step for a value a hair below a multiple, which is exactly
   * what snapped floats look like.
   */
  function offGrid(value: number, step: number): number {
    return Math.abs(value / step - Math.round(value / step)) * step;
  }

  /** The wire's raw polyline. The drawn path is the same route, rounded. */
  function wireLine(host: HTMLElement, index: number): SVGElement {
    return host.querySelector<SVGElement>(
      `g[data-wire-index="${index}"] .wire-hit`,
    )!;
  }

  function wireHit(host: HTMLElement, index: number): SVGElement {
    return host.querySelector<SVGElement>(
      `g[data-wire-index="${index}"] .wire-hit`,
    )!;
  }

  function selectWire(host: HTMLElement, canvas: DiagramCanvas, index: number): void {
    const hit = wireHit(host, index);
    hit.dispatchEvent(pointer('pointerdown', 200, 60));
    canvas.svg.dispatchEvent(pointer('pointerup', 200, 60));
  }

  function startHandleDrag(host: HTMLElement, canvas: DiagramCanvas, index = 0): void {
    selectWire(host, canvas, index);
    host.querySelector(`g[data-wire-index="${index}"] .wire-handle[data-seg-index="0"]`)!
      .dispatchEvent(pointer('pointerdown', 200, 60));
  }

  function pointsOf(el: Element): { x: number; y: number }[] {
    return (el.getAttribute('points') ?? '')
      .split(' ')
      .filter(Boolean)
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
      });
  }

  it('draws every visible wire with a grab area and an index', () => {
    const { host } = setup();
    const groups = host.querySelectorAll('g[data-wire-index]');
    expect(groups.length).toBe(BLINK.connections.length);
    for (const group of groups) {
      expect(group.querySelector('.wire-hit')).not.toBeNull();
      expect(group.querySelector('.wire')).not.toBeNull();
    }
  });

  it('stacks artwork, then wires, then the pin hit-boxes', () => {
    // A wire's grab area is far wider than the line. Over the pins it stole
    // their presses; under the boards it could not be grabbed where it crossed
    // one. Only the tiny invisible hit-boxes belong on top.
    const { canvas } = setup();
    const art = canvas.svg.querySelector('.part')!;
    const wire = canvas.svg.querySelector('[data-wire-index]')!;
    const pins = canvas.svg.querySelector('.part-pins')!;
    const controls = canvas.svg.querySelector('.part-controls');
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(art, wire)).toBe(true);
    expect(follows(wire, pins)).toBe(true);
    if (controls) expect(follows(wire, controls)).toBe(true);
  });

  it('keeps every pin hit-box aligned with the part it belongs to', () => {
    // Pins live in their own layer now, so they carry the part's transform
    // themselves; a mismatch would put every hit-box in the wrong place.
    const { canvas } = setup();
    for (const part of canvas.svg.querySelectorAll<SVGGElement>('.part')) {
      const id = part.dataset.partId!;
      const pins = canvas.svg.querySelector<SVGGElement>(
        `.part-pins[data-part-id="${id}"]`,
      );
      expect(pins).not.toBeNull();
      expect(pins!.getAttribute('transform')).toBe(part.getAttribute('transform'));
    }
  });

  it('selects a wire on press, and shows one handle per segment', () => {
    const { host, canvas, selections } = setup();
    const before = pointsOf(wireLine(host, 0));
    expect(host.querySelectorAll('.wire-handle')).toHaveLength(0);
    selectWire(host, canvas, 0);
    expect(selections).toEqual([0]);
    expect(canvas.selectedWireIndex).toBe(0);
    const handles = host.querySelectorAll('g[data-wire-index="0"] .wire-handle');
    expect(handles.length).toBe(before.length - 1);
  });

  it('selects the wire body without dragging its route', () => {
    const { host, canvas, routes } = setup();
    const before = pointsOf(wireLine(host, 0));
    const hit = wireHit(host, 0);
    hit.dispatchEvent(pointer('pointerenter', 200, 60));
    expect(host.querySelectorAll('.wire-handle')).toHaveLength(0);
    hit.dispatchEvent(pointer('pointerdown', 200, 60));
    canvas.svg.dispatchEvent(pointer('pointermove', 340, 200));
    canvas.svg.dispatchEvent(pointer('pointerup', 340, 200));
    expect(canvas.selectedWireIndex).toBe(0);
    expect(pointsOf(wireLine(host, 0))).toEqual(before);
    expect(routes).toEqual([]);

    // Even after selection, route edits must start from a visible handle.
    wireHit(host, 0).dispatchEvent(pointer('pointerdown', 200, 60));
    canvas.svg.dispatchEvent(pointer('pointermove', 340, 200));
    canvas.svg.dispatchEvent(pointer('pointerup', 340, 200));
    expect(pointsOf(wireLine(host, 0))).toEqual(before);
    expect(routes).toEqual([]);
  });

  it('raises a hovered wire above wires created later without exposing handles', () => {
    const { host } = setup();
    const first = host.querySelector('g[data-wire-index="0"]')!;
    const layer = first.parentElement!;
    expect(layer.lastElementChild?.getAttribute('data-wire-index')).toBe('1');
    wireHit(host, 0).dispatchEvent(pointer('pointerenter', 200, 60));
    expect(layer.lastElementChild).toBe(first);
    expect(first.querySelector('.wire')?.classList.contains('wire-hover')).toBe(true);
    expect(host.querySelectorAll('.wire-handle')).toHaveLength(0);
  });

  it('keeps a selected wire and its handles above crossings after redraw', () => {
    const { host, canvas } = setup();
    selectWire(host, canvas, 0);
    canvas.setDiagram(structuredClone(BLINK));
    const selected = host.querySelector('g[data-wire-index="0"]')!;
    expect(selected.parentElement?.lastElementChild).toBe(selected);
    expect(selected.querySelectorAll('.wire-handle').length).toBeGreaterThan(0);
  });

  it('reports nothing to the diagram while the pointer is still down', () => {
    // The first version wrote a route on every pointermove, which filled the
    // undo stack with one entry per pixel and redrew the canvas each frame.
    const { host, canvas, routes } = setup();
    startHandleDrag(host, canvas);
    for (let d = 10; d <= 60; d += 10) {
      canvas.svg.dispatchEvent(pointer('pointermove', 200 + d, 60 + d));
    }
    expect(routes).toEqual([]);
  });

  it('reports the finished route exactly once, on release', () => {
    const { host, canvas, routes } = setup();
    startHandleDrag(host, canvas);
    canvas.svg.dispatchEvent(pointer('pointermove', 260, 120));
    canvas.svg.dispatchEvent(pointer('pointermove', 340, 200));
    canvas.svg.dispatchEvent(pointer('pointerup', 340, 200));
    expect(routes.length).toBe(1);
    expect(routes[0].index).toBe(0);
    expect(routes[0].route.length).toBeGreaterThan(0);
  });

  it('reports nothing for a press that did not move', () => {
    const { host, canvas, routes } = setup();
    startHandleDrag(host, canvas);
    canvas.svg.dispatchEvent(pointer('pointerup', 200, 60));
    expect(routes).toEqual([]);
  });

  it('keeps both ends of the wire on their pins while dragging', () => {
    // Offsetting the first or last segment used to move the endpoint itself,
    // leaving the wire hanging in space away from the pin.
    const { host, canvas } = setup();
    const line = () => wireLine(host, 0);
    const before = pointsOf(line());
    startHandleDrag(host, canvas);
    // Diagonal, so the segment moves whichever way round it runs.
    canvas.svg.dispatchEvent(pointer('pointermove', 340, 200));
    const after = pointsOf(line());
    expect(after[0]).toEqual(before[0]);
    expect(after[after.length - 1]).toEqual(before[before.length - 1]);
    expect(after).not.toEqual(before);
  });

  it('produces a route the renderer draws back identically', () => {
    // Round trip: what the drag previews is what the saved route re-draws.
    const { host, canvas, routes } = setup();
    const line = () => wireLine(host, 0);
    startHandleDrag(host, canvas);
    canvas.svg.dispatchEvent(pointer('pointermove', 320, 180));
    canvas.svg.dispatchEvent(pointer('pointerup', 320, 180));
    const previewed = pointsOf(line());

    const diagram = structuredClone(BLINK);
    diagram.connections[0][3] = routes[0].route;
    canvas.setDiagram(diagram);
    expect(pointsOf(line())).toEqual(previewed);
  });

  it('snaps the drag to the pin grid', () => {
    const { host, canvas } = setup();
    const line = () => wireLine(host, 0);
    startHandleDrag(host, canvas);
    // 3px in each axis is under half a snap step whichever way the segment
    // runs, so nothing should have moved yet.
    canvas.svg.dispatchEvent(pointer('pointermove', 203, 63));
    const nudged = pointsOf(line());
    canvas.svg.dispatchEvent(pointer('pointerup', 203, 63));
    expect(nudged).toEqual(pointsOf(line()));
  });

  it('stops the press from starting a text selection', () => {
    // Board artwork is covered in silkscreen text. Without preventDefault the
    // press selected those labels, and dragging a selection is a native drag
    // that takes the pointer with it - so the next drag did nothing at all.
    const { host, canvas } = setup();
    selectWire(host, canvas, 0);
    const down = pointer('pointerdown', 200, 60);
    host.querySelector('g[data-wire-index="0"] .wire-handle')!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('drags the same wire again, and again', () => {
    const { host, canvas, routes } = setup();
    const line = () => wireLine(host, 0);

    const shapes: string[] = [line().getAttribute('points')!];
    for (let round = 0; round < 3; round++) {
      // A different distance each round, so an unchanged shape means the
      // drag was ignored rather than that it happened to land in place.
      const to = 160 + round * 40;
      startHandleDrag(host, canvas);
      canvas.svg.dispatchEvent(pointer('pointermove', 300, to));
      canvas.svg.dispatchEvent(pointer('pointerup', 300, to));
      const diagram = canvas.getDiagram();
      diagram.connections[0][3] = routes[routes.length - 1].route;
      canvas.setDiagram(diagram);
      shapes.push(line().getAttribute('points')!);
    }
    expect(routes.length).toBe(3);
    // Each drag must change the shape it started from. They need not all be
    // distinct: a later drag can legitimately undo an earlier one.
    for (let i = 1; i < shapes.length; i++) {
      expect(shapes[i]).not.toBe(shapes[i - 1]);
    }
  });

  it('lands the dragged segment on the grid, not a grid step from the pin', () => {
    // Snapping the drag distance keeps a wire the same fraction of a pitch off
    // the dots however far it is dragged, because it starts from wherever the
    // pin happens to sit. What has to land on the grid is the segment itself.
    const { host, canvas } = setup();
    const before = pointsOf(wireLine(host, 0));
    // The wire leaves pin 13, which is not itself on a grid line - so a drag
    // measured from it can only land on the grid by being told to.
    expect(offGrid(before[0].x, GRID)).toBeGreaterThan(0.01);

    startHandleDrag(host, canvas);
    canvas.svg.dispatchEvent(pointer('pointermove', 337, 60));
    const after = pointsOf(wireLine(host, 0));

    // The first segment ran down from the pin; it has slid sideways onto a
    // grid line, with a new elbow joining it back to the pad.
    expect(after[0]).toEqual(before[0]);
    expect(after[1].x).not.toBe(before[0].x);
    expect(offGrid(after[1].x, GRID)).toBeLessThan(0.001);
    expect(offGrid(after[2].x, GRID)).toBeLessThan(0.001);
  });

  it('takes half-pitch steps while Shift is held', () => {
    const drag = (shift: boolean) => {
      const { host, canvas } = setup();
      startHandleDrag(host, canvas);
      const move = pointer('pointermove', 218, 60);
      Object.defineProperty(move, 'shiftKey', { value: shift });
      canvas.svg.dispatchEvent(move);
      return pointsOf(wireLine(host, 0))[1].x;
    };
    const coarse = drag(false);
    const fine = drag(true);
    expect(offGrid(coarse, GRID)).toBeLessThan(0.001);
    expect(offGrid(fine, GRID / 2)).toBeLessThan(0.001);
    // The same 18px nudge rounds to a different landing on the finer grid.
    expect(fine).not.toBe(coarse);
  });

  it.each([
    { axis: 'x', end: 'source', route: ['v20'] },
    { axis: 'x', end: 'target', route: ['v20'] },
    { axis: 'y', end: 'source', route: ['h20'] },
    { axis: 'y', end: 'target', route: ['h20'] },
  ] as const)('straightens a displaced lane to the $end pin on $axis after saving', ({ axis, end, route }) => {
    const { host, canvas, routes } = setup();
    const diagram = structuredClone(BLINK);
    // Fractional component positions also exercise precision when saving.
    diagram.parts[0].left = 0.137;
    diagram.parts[0].top = 0.251;
    diagram.parts[1].left = 400.137;
    diagram.parts[1].top = 100.251;
    diagram.connections[0][3] = [...route];
    canvas.setDiagram(diagram);
    const original = pointsOf(wireLine(host, 0));
    const pin = end === 'source' ? original[0] : original[original.length - 1];
    expect(offGrid(pin[axis], GRID)).toBeGreaterThan(0.01);

    const dragSegment = (segment: number, delta: number) => {
      host.querySelector(`g[data-wire-index="0"] .wire-handle[data-seg-index="${segment}"]`)!
        .dispatchEvent(pointer('pointerdown', 200, 60));
      const x = 200 + (axis === 'x' ? delta : 0);
      const y = 60 + (axis === 'y' ? delta : 0);
      canvas.svg.dispatchEvent(pointer('pointermove', x, y));
      canvas.svg.dispatchEvent(pointer('pointerup', x, y));
    };
    selectWire(host, canvas, 0);
    dragSegment(end === 'source' ? 0 : original.length - 2, 137);
    diagram.connections[0][3] = routes[0].route;
    canvas.setDiagram(diagram);

    const displaced = pointsOf(wireLine(host, 0));
    const laneIndex = end === 'source' ? 1 : displaced.length - 3;
    const laneCoordinate = displaced[laneIndex][axis];
    expect(offGrid(laneCoordinate, GRID)).toBeLessThan(0.001);
    // Near the pad, its exact axis must win over the neighbouring grid lines.
    dragSegment(laneIndex, pin[axis] - laneCoordinate + 2);
    const preview = pointsOf(wireLine(host, 0));
    expect(preview).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(preview[i].x).toBeCloseTo(original[i].x, 5);
      expect(preview[i].y).toBeCloseTo(original[i].y, 5);
    }
    expect(routes).toHaveLength(2);
    diagram.connections[0][3] = routes[1].route;
    canvas.setDiagram(diagram);
    const saved = pointsOf(wireLine(host, 0));
    expect(saved).toHaveLength(preview.length);
    for (let i = 0; i < saved.length; i++) {
      expect(saved[i].x).toBeCloseTo(preview[i].x, 5);
      expect(saved[i].y).toBeCloseTo(preview[i].y, 5);
    }
  });

  it('draws the cable as a rounded path over a darker casing', () => {
    const { host } = setup();
    const group = host.querySelector('g[data-wire-index="0"]')!;
    const casing = group.querySelector('path.wire-casing')!;
    const line = group.querySelector('path.wire')!;
    expect(casing).not.toBeNull();
    // Same shape, and the casing is painted first so it sits underneath.
    expect(casing.getAttribute('d')).toBe(line.getAttribute('d'));
    expect(line.getAttribute('d')).toContain('Q');
  });

  it('caps each end of the wire on its pin', () => {
    const { host } = setup();
    const group = host.querySelector('g[data-wire-index="0"]')!;
    const blobs = [...group.querySelectorAll('.wire-end')];
    const points = pointsOf(wireLine(host, 0));
    expect(blobs).toHaveLength(2);
    const at = (el: Element) => ({
      x: Number(el.getAttribute('cx')),
      y: Number(el.getAttribute('cy')),
    });
    expect(at(blobs[0])).toEqual(points[0]);
    expect(at(blobs[1])).toEqual(points[points.length - 1]);
  });

  it('moves the end caps with the wire during a drag', () => {
    const { host, canvas } = setup();
    startHandleDrag(host, canvas);
    canvas.svg.dispatchEvent(pointer('pointermove', 340, 200));
    const group = host.querySelector('g[data-wire-index="0"]')!;
    const blobs = [...group.querySelectorAll('.wire-end')];
    const points = pointsOf(wireLine(host, 0));
    expect(Number(blobs[0].getAttribute('cx'))).toBe(points[0].x);
    expect(Number(blobs[1].getAttribute('cy'))).toBe(points[points.length - 1].y);
  });

  it('clears the selection when the background is pressed', () => {
    const { host, canvas } = setup();
    selectWire(host, canvas, 0);
    expect(canvas.selectedWireIndex).toBe(0);
    canvas.svg.dispatchEvent(pointer('pointerdown', 700, 500));
    expect(canvas.selectedWireIndex).toBeNull();
  });
});

describe('pin marks', () => {
  /*
   * Every part that does not name its own pins gets a solder pad and the pin's
   * name drawn beside it. Without them a part was a plain block with invisible
   * hit-boxes, and there was no way to see where a wire was meant to land.
   */
  function marksFor(type: string): SVGGElement {
    const host = makeHost();
    const canvas = new DiagramCanvas(host);
    canvas.setDiagram({
      version: 1,
      parts: [{ id: 'x', type, left: 0, top: 0 }],
      connections: [],
    });
    return host.querySelector<SVGGElement>('g.part[data-part-id="x"] .pin-marks')!;
  }

  function labelsFor(type: string, rotate = 0): SVGGElement {
    const host = makeHost();
    const canvas = new DiagramCanvas(host);
    canvas.setDiagram({
      version: 1,
      parts: [{ id: 'x', type, left: 0, top: 0, rotate }],
      connections: [],
    });
    return host.querySelector<SVGGElement>('.pin-label-overlay')!;
  }

  function leadsFor(type: string): SVGGElement {
    const host = makeHost();
    const canvas = new DiagramCanvas(host);
    canvas.setDiagram({
      version: 1,
      parts: [{ id: 'x', type, left: 0, top: 0 }],
      connections: [],
    });
    return host.querySelector<SVGGElement>('g.part[data-part-id="x"] .pin-leads')!;
  }

  it('draws a lead from every pad into the body', () => {
    // Without them the pads floated beside the body with nothing joining the
    // two, so there was no telling they belonged to the part at all.
    const visual = getVisual('wokwi-7segment');
    expect(leadsFor('wokwi-7segment').querySelectorAll('.pin-lead')).toHaveLength(
      visual.pins.length,
    );
  });

  it('runs each lead inward from its pad', () => {
    const leads = [...leadsFor('wokwi-7segment').querySelectorAll('.pin-lead')];
    const visual = getVisual('wokwi-7segment');
    for (const lead of leads) {
      const x1 = Number(lead.getAttribute('x1'));
      const y1 = Number(lead.getAttribute('y1'));
      const y2 = Number(lead.getAttribute('y2'));
      const pin = visual.pins.find((p) => p.x === x1 && p.y === y1)!;
      expect(pin).toBeDefined();
      // Towards the middle of the part, never away from it.
      const towardsCentre = pin.y < visual.height / 2 ? y2 > y1 : y2 < y1;
      expect(towardsCentre).toBe(true);
    }
  });

  it('leaves alone the parts whose leads have a shape of their own', () => {
    // An LED's splay out and a resistor's run straight through; a generated
    // straight stub beside them would just be a second, wrong leg.
    for (const type of ['wokwi-led', 'wokwi-resistor', 'wokwi-buzzer', 'wokwi-potentiometer']) {
      expect(leadsFor(type).children).toHaveLength(0);
      // They still get pads and names.
      expect(marksFor(type).querySelectorAll('.pin-pad').length).toBeGreaterThan(0);
    }
  });

  it('gives every generated lead the same length', () => {
    /*
     * A lead shows for the gap between its pad and the body, so the parts have
     * to agree on that gap or the diagram ends up with legs of three different
     * lengths - which is exactly what happened: 4px on the generic parts, 6
     * below the 7-segment and 4 above it, 8 on the neopixels, and the LCD's
     * pads buried in its body altogether.
     *
     * The rule: a pin sits PIN_INSET from the edge of the part's box, and the
     * body starts BODY_INSET in, leaving LEAD_GAP of lead showing.
     */
    const withGeneratedLeads = [
      'wokwi-7segment',
      'wokwi-lcd1602',
      'wokwi-lcd2004',
      'wokwi-neopixel',
      'wokwi-led-matrix',
      'wokwi-dip-switch-8',
      'wokwi-rgb-led',
    ];
    for (const type of withGeneratedLeads) {
      const visual = getVisual(type, pinLookup(type) ?? []);
      expect(visual.drawsOwnLeads, `${type} should use generated leads`).toBeFalsy();

      // The body is the first rect in the artwork.
      const rect = /<rect[^>]*y="([-\d.]+)"[^>]*height="([-\d.]+)"/.exec(visual.body({}));
      expect(rect, `${type} has no body rect to measure`).not.toBeNull();
      const top = Number(rect![1]);
      const bottom = top + Number(rect![2]);

      const ys = visual.pins.map((p) => p.y);
      if (ys.includes(PIN_INSET)) {
        expect(top - PIN_INSET, `${type} top lead`).toBeCloseTo(LEAD_GAP, 6);
      }
      if (ys.includes(visual.height - PIN_INSET)) {
        expect(visual.height - PIN_INSET - bottom, `${type} bottom lead`).toBeCloseTo(
          LEAD_GAP,
          6,
        );
      }
    }
  });

  it('keeps the generic body inset by the same amount', () => {
    const visual = genericVisual('wokwi-x', ['A', 'B', 'C', 'D']);
    const rect = /<rect[^>]*y="([-\d.]+)"[^>]*height="([-\d.]+)"/.exec(visual.body({}))!;
    expect(Number(rect[1])).toBe(BODY_INSET);
    expect(Number(rect[1]) + Number(rect[2])).toBe(visual.height - BODY_INSET);
  });

  it('draws the leads under the body, so an overshoot does not show', () => {
    const host = makeHost();
    const canvas = new DiagramCanvas(host);
    canvas.setDiagram({
      version: 1,
      parts: [{ id: 'x', type: 'wokwi-7segment', left: 0, top: 0 }],
      connections: [],
    });
    const part = host.querySelector('g.part[data-part-id="x"]')!;
    const classes = [...part.children].map((c) => c.getAttribute('class'));
    expect(classes.indexOf('pin-leads')).toBeLessThan(classes.indexOf('pin-marks'));
    // The body is the unclassed group between them.
    expect(classes[0]).toBe('pin-leads');
  });

  it('draws a pad and a name for every pin', () => {
    const visual = getVisual('wokwi-7segment');
    const marks = marksFor('wokwi-7segment');
    expect(marks.querySelectorAll('.pin-pad')).toHaveLength(visual.pins.length);
    expect([...labelsFor('wokwi-7segment').querySelectorAll('.pin-label')].map((t) => t.textContent)).toEqual(
      visual.pins.map((p) => p.name),
    );
  });

  it('puts each pad exactly on its pin', () => {
    const visual = getVisual('wokwi-potentiometer');
    const pads = [...marksFor('wokwi-potentiometer').querySelectorAll('.pin-pad')];
    expect(pads.map((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))])).toEqual(
      visual.pins.map((p) => [p.x, p.y]),
    );
  });

  it('names pins the way a wire refers to them', () => {
    // `label` is the friendlier hover text; a wire is written with `name`.
    const names = [...labelsFor('wokwi-led').querySelectorAll('.pin-label')].map(
      (t) => t.textContent,
    );
    expect(names).toEqual(['A', 'C']);
  });

  it.each(['wokwi-arduino-uno', 'wokwi-arduino-mega'])('keeps %s header names inside the PCB', (type) => {
    const visual = getVisual(type);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.innerHTML = visual.pinLabels!();
    const labels = [...svg.querySelectorAll('text[transform]')];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const match = /translate\(([\d.]+) ([\d.]+)\) rotate\(-90\)/.exec(label.getAttribute('transform')!);
      expect(match).not.toBeNull();
      const x = Number(match![1]);
      const y = Number(match![2]);
      const pin = visual.pins.find((pin) =>
        Math.abs(pin.x - x) < 0.01 && (pin.label ?? pin.name) === label.textContent,
      );
      expect(pin).toBeDefined();
      const inkLength = label.textContent!.length * 10 * 0.6;
      const extendsUp = label.getAttribute('text-anchor') === 'start';
      const top = y - (extendsUp ? inkLength : 0) - 1.25;
      const bottom = y + (extendsUp ? 0 : inkLength) + 1.25;
      expect(top).toBeGreaterThan(0);
      expect(bottom).toBeLessThan(visual.height);
      expect(x - 6.25).toBeGreaterThan(0);
      expect(x + 6.25).toBeLessThan(visual.width);
      expect(pin!.y < visual.height / 2 ? y > pin!.y : y < pin!.y).toBe(true);
    }
  });

  it('leaves the boards alone, since their silkscreen already says', () => {
    // 85 pads and 85 names would bury the artwork they are drawn over.
    expect(marksFor('wokwi-arduino-mega').children).toHaveLength(0);
    expect(marksFor('wokwi-arduino-uno').children).toHaveLength(0);
  });

  it('keeps names horizontal on parts with dense rows and rotated columns', () => {
    for (const type of ['wokwi-7segment', 'wokwi-potentiometer', 'wokwi-lcd1602']) {
      for (const rotate of [0, 90, 180, 270]) {
        const overlay = labelsFor(type, rotate);
        expect(overlay.getAttribute('transform')).toBe('translate(0 0)');
        const labels = [...overlay.querySelectorAll('.pin-label')];
        expect(labels.length).toBeGreaterThan(0);
        for (const label of labels) {
          expect(label.getAttribute('transform')).toBeNull();
          expect(label.getAttribute('text-anchor')).toBe('middle');
        }
      }
    }
  });

  it.each([90, 180, 270])('centers names on the actual pins of a pushbutton rotated %i degrees', (rotate) => {
    const host = makeHost();
    const canvas = new DiagramCanvas(host);
    const left = 100;
    const top = 80;
    canvas.setDiagram({
      version: 1,
      parts: [{ id: 'x', type: 'wokwi-pushbutton', left, top, rotate }],
      connections: [],
    });
    const visual = getVisual('wokwi-pushbutton');
    const overlay = host.querySelector('.pin-label-overlay')!;
    expect(overlay.getAttribute('transform')).toBe(`translate(${left} ${top})`);
    const layout = layoutPinLabels(visual, rotate);
    for (const pin of visual.pins) {
      const position = canvas.pinPosition('x', pin.name)!;
      const label = overlay.querySelector(`.pin-label[data-pin="${pin.name}"]`)!;
      const placed = layout.find((entry) => entry.pin.name === pin.name)!;
      const x = Number(label.getAttribute('x'));
      const y = Number(label.getAttribute('y'));
      expect(label.textContent).toBe(pin.name);
      if (placed.side === 'top' || placed.side === 'bottom') {
        expect(left + x).toBeCloseTo(position.x, 6);
        expect(placed.side === 'top' ? top + y < position.y : top + y > position.y).toBe(true);
        expect(Math.abs(top + y - position.y)).toBeGreaterThan(placed.height / 2);
      } else {
        expect(top + y).toBeCloseTo(position.y, 6);
        expect(placed.side === 'left' ? left + x < position.x : left + x > position.x).toBe(true);
        expect(Math.abs(left + x - position.x)).toBeGreaterThan(placed.width / 2);
      }
    }
  });

  it('places the top names above and bottom names below a quarter-turn pushbutton', () => {
    // A quarter-turn turns the button's original left/right pins into rows.
    // Labelling from the original sides put the names beside the turned pads.
    const visual = getVisual('wokwi-pushbutton');
    for (const rotate of [90, 270]) {
      for (const label of layoutPinLabels(visual, rotate)) {
        const isTop = label.pin.y < visual.height / 2;
        expect(label.side).toBe(isTop ? 'top' : 'bottom');
        expect(label.x).toBeCloseTo(label.pin.x, 6);
        expect(isTop ? label.y < label.pin.y : label.y > label.pin.y).toBe(true);
      }
    }
  });

  it('keeps every generated label box separate after rotating registered parts', () => {
    for (const type of registeredTypes()) {
      const visual = getVisual(type, pinLookup(type) ?? []);
      if (visual.drawsOwnPins) continue;
      for (const rotate of [0, 90, 180, 270]) {
        const labels = layoutPinLabels(visual, rotate);
        expect(labels).toHaveLength(visual.pins.length);
        for (let i = 0; i < labels.length; i++) {
          for (let j = i + 1; j < labels.length; j++) {
            const a = labels[i];
            const b = labels[j];
            const overlapX = Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 0.001;
            const overlapY = Math.abs(a.y - b.y) < (a.height + b.height) / 2 - 0.001;
            expect(overlapX && overlapY, `${type} at ${rotate}: ${a.pin.name}/${b.pin.name}`).toBe(false);
          }
        }
      }
    }
  });

  it('paints pin names above wires that cross the labelled part', () => {
    const host = makeHost();
    const canvas = new DiagramCanvas(host);
    canvas.setDiagram(BLINK);
    const wire = host.querySelector('g[data-wire-index="0"]')!;
    const labels = host.querySelector('.pin-label-layer')!;
    expect(Boolean(wire.compareDocumentPosition(labels) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('puts the LED and the 7-segment on the pin grid', () => {
    /*
     * Both had pins 8px apart, which is off the grid parts and wires snap to -
     * so their pins could never line up with a header - and too tight to print
     * a name beside.
     */
    for (const type of ['wokwi-led', 'wokwi-7segment']) {
      const rows = new Map<number, number[]>();
      for (const pin of getVisual(type).pins) {
        rows.set(pin.y, [...(rows.get(pin.y) ?? []), pin.x]);
      }
      for (const [, xs] of rows) {
        const sorted = [...xs].sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) {
          const gap = sorted[i] - sorted[i - 1];
          expect(Math.abs(gap / GRID - Math.round(gap / GRID))).toBeLessThan(0.001);
        }
      }
    }
  });
});

describe('viewportCenter', () => {
  // Where the Add part button drops a new part. A fixed spot puts it
  // off-screen as soon as the view has been panned or zoomed anywhere.
  it('is the middle of the visible area', () => {
    const host = makeHost(); // reports 800x600 at the origin
    const canvas = new DiagramCanvas(host);
    // Default pan is 40,40 at zoom 1, so the centre is (400-40, 300-40).
    expect(canvas.viewportCenter()).toEqual({ x: 360, y: 260 });
  });

  it('follows the zoom', () => {
    const host = makeHost();
    const canvas = new DiagramCanvas(host);
    canvas.setZoom(2);
    expect(canvas.viewportCenter()).toEqual({ x: 180, y: 130 });
  });

  it('lands on the grid once snapped', () => {
    const host = makeHost();
    const canvas = new DiagramCanvas(host);
    const at = canvas.snap(canvas.viewportCenter());
    for (const v of [at.x, at.y]) {
      expect(Math.abs(v / GRID - Math.round(v / GRID))).toBeLessThan(0.001);
    }
  });
});

describe('part dragging', () => {
  function pointer(type: string, x: number, y: number, shift = false): Event {
    const ev = new MouseEvent(type, {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(ev, 'pointerId', { value: 1 });
    Object.defineProperty(ev, 'button', { value: 0 });
    Object.defineProperty(ev, 'shiftKey', { value: shift });
    return ev;
  }

  function setup() {
    const host = makeHost();
    const moves: { id: string; left: number; top: number }[] = [];
    const canvas = new DiagramCanvas(host, {
      onPartMoved: (id, left, top) => moves.push({ id, left, top }),
    });
    canvas.setDiagram(structuredClone(BLINK));
    return { host, canvas, moves };
  }

  const artwork = (host: HTMLElement, id: string) =>
    host.querySelector<SVGGElement>(`g.part[data-part-id="${id}"]`)!;
  const pins = (host: HTMLElement, id: string) =>
    host.querySelector<SVGGElement>(`.part-pins[data-part-id="${id}"]`)!;

  function drag(canvas: DiagramCanvas, el: Element, dx: number, dy: number, shift = false) {
    el.dispatchEvent(pointer('pointerdown', 100, 100));
    canvas.svg.dispatchEvent(pointer('pointermove', 100 + dx, 100 + dy, shift));
    canvas.svg.dispatchEvent(pointer('pointerup', 100 + dx, 100 + dy, shift));
  }

  it('reports the new position once, on release', () => {
    const { host, canvas, moves } = setup();
    const el = artwork(host, 'led1');
    el.dispatchEvent(pointer('pointerdown', 100, 100));
    for (let d = 20; d <= 100; d += 20) {
      canvas.svg.dispatchEvent(pointer('pointermove', 100 + d, 100 + d));
    }
    expect(moves).toEqual([]);
    canvas.svg.dispatchEvent(pointer('pointerup', 200, 200));
    expect(moves).toHaveLength(1);
    expect(moves[0].id).toBe('led1');
  });

  it('reports nothing for a press that did not move the part', () => {
    const { host, canvas, moves } = setup();
    artwork(host, 'led1').dispatchEvent(pointer('pointerdown', 100, 100));
    canvas.svg.dispatchEvent(pointer('pointerup', 100, 100));
    expect(moves).toEqual([]);
  });

  it('lands the part on the grid', () => {
    const { host, canvas, moves } = setup();
    drag(canvas, artwork(host, 'led1'), 137, 91);
    expect(moves).toHaveLength(1);
    for (const v of [moves[0].left, moves[0].top]) {
      expect(Math.abs(v / GRID - Math.round(v / GRID))).toBeLessThan(0.001);
    }
  });

  it('takes half-grid steps while Shift is held', () => {
    const coarse = () => {
      const { host, canvas, moves } = setup();
      drag(canvas, artwork(host, 'led1'), 29, 0);
      return moves[0]?.left;
    };
    const fine = () => {
      const { host, canvas, moves } = setup();
      drag(canvas, artwork(host, 'led1'), 29, 0, true);
      return moves[0]?.left;
    };
    const c = coarse();
    const f = fine();
    expect(Math.abs(f / (GRID / 2) - Math.round(f / (GRID / 2)))).toBeLessThan(0.001);
    expect(f).not.toBe(c);
  });

  it('carries the pin hit-boxes with the artwork', () => {
    // They live in their own layer above the wires, so nothing moves them
    // unless the drag does - and a pin left behind makes the part unwirable
    // where it is drawn.
    const { host, canvas } = setup();
    const el = artwork(host, 'led1');
    el.dispatchEvent(pointer('pointerdown', 100, 100));
    canvas.svg.dispatchEvent(pointer('pointermove', 200, 200));
    expect(pins(host, 'led1').getAttribute('transform')).toBe(el.getAttribute('transform'));
  });

  it('carries horizontal pin names with a rotated part throughout its drag', () => {
    const { host, canvas } = setup();
    canvas.setDiagram({
      version: 1,
      parts: [{ id: 'btn1', type: 'wokwi-pushbutton', left: 100, top: 80, rotate: 90 }],
      connections: [],
    });
    const part = artwork(host, 'btn1');
    const overlay = host.querySelector('.pin-label-overlay')!;
    const before = overlay.getAttribute('transform');
    part.dispatchEvent(pointer('pointerdown', 100, 100));
    canvas.svg.dispatchEvent(pointer('pointermove', 200, 200));
    expect(overlay.getAttribute('transform')).not.toBe(before);
    const translation = /^translate\(([^)]+)\)/.exec(part.getAttribute('transform')!)![0];
    expect(overlay.getAttribute('transform')).toBe(translation);
    for (const label of overlay.querySelectorAll('.pin-label')) {
      expect(label.getAttribute('transform')).toBeNull();
    }
  });

  it('drags the wires attached to it along', () => {
    const { host, canvas } = setup();
    const wire = () =>
      host.querySelector('g[data-wire-index="0"] .wire-hit')!.getAttribute('points');
    const before = wire();
    artwork(host, 'led1').dispatchEvent(pointer('pointerdown', 100, 100));
    canvas.svg.dispatchEvent(pointer('pointermove', 200, 200));
    expect(wire()).not.toBe(before);
  });

  it('leaves the diagram alone until the drag is committed', () => {
    // The preview is an offset, not a write. Editing the part mid-drag would
    // put the dragged position into the undo snapshot taken on commit.
    const { host, canvas } = setup();
    const part = () => canvas.getDiagram().parts.find((p) => p.id === 'led1')!;
    const at = { left: part().left, top: part().top };
    artwork(host, 'led1').dispatchEvent(pointer('pointerdown', 100, 100));
    canvas.svg.dispatchEvent(pointer('pointermove', 300, 300));
    expect({ left: part().left, top: part().top }).toEqual(at);
  });

  it('puts a grid-aligned part back when a drag ends where it started', () => {
    const { host, canvas, moves } = setup();
    // The Uno sits at (0, 0), which is on the grid.
    const el = artwork(host, 'uno');
    const before = el.getAttribute('transform');
    el.dispatchEvent(pointer('pointerdown', 100, 100));
    canvas.svg.dispatchEvent(pointer('pointermove', 200, 200));
    expect(el.getAttribute('transform')).not.toBe(before);
    canvas.svg.dispatchEvent(pointer('pointermove', 100, 100));
    canvas.svg.dispatchEvent(pointer('pointerup', 100, 100));
    expect(el.getAttribute('transform')).toBe(before);
    expect(moves).toEqual([]);
  });

  it('pulls an off-grid part onto the grid as soon as it is dragged', () => {
    /*
     * The LED starts at (400, 100), which is not a multiple of the pitch.
     * Snapping where the part lands - rather than how far it travelled - means
     * touching it is enough to line it up, so a diagram tidies itself as it is
     * worked on instead of carrying its original offsets forever.
     */
    const { host, canvas, moves } = setup();
    const el = artwork(host, 'led1');
    el.dispatchEvent(pointer('pointerdown', 100, 100));
    canvas.svg.dispatchEvent(pointer('pointermove', 101, 100));
    canvas.svg.dispatchEvent(pointer('pointerup', 101, 100));
    expect(moves).toHaveLength(1);
    expect(moves[0].left).toBeCloseTo(Math.round(400 / GRID) * GRID, 6);
    expect(moves[0].top).toBeCloseTo(Math.round(100 / GRID) * GRID, 6);
  });

  it('stops the press from starting a text selection', () => {
    const { host } = setup();
    const down = pointer('pointerdown', 100, 100);
    artwork(host, 'uno').dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('drags the board itself, not just the small parts', () => {
    const { host, canvas, moves } = setup();
    drag(canvas, artwork(host, 'uno'), 96, 96);
    expect(moves.map((m) => m.id)).toEqual(['uno']);
  });
});
