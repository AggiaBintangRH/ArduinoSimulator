/**
 * SVG canvas: draws the diagram, routes wires, and applies live part state.
 *
 * Kept free of editing logic - the editor layer (Phase 7) drives this through
 * its public methods so the renderer stays testable on its own.
 */

import type { Diagram, DiagramPart } from '../diagram/types.js';
import { parsePinRef } from '../diagram/parse.js';
import { routeWire, toSvgPoints, type Point } from '../diagram/router.js';
import { getVisual, GRID, type PinLayout } from './shapes.js';
import { pinLookup } from '../sim/registry.js';
import type { PartEvent } from '../sim/part.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface CanvasOptions {
  showGrid?: boolean;
  /** Called when a pin is clicked, for wire drawing. */
  onPinClick?: (partId: string, pin: string, at: Point) => void;
  onPartClick?: (partId: string) => void;
  onBackgroundClick?: () => void;
}

interface RenderedPart {
  spec: DiagramPart;
  group: SVGGElement;
  liveGroup: SVGGElement;
  pins: Map<string, PinLayout>;
  width: number;
  height: number;
}

export class DiagramCanvas {
  readonly svg: SVGSVGElement;
  private viewport: SVGGElement;
  private gridPattern: SVGGElement;
  private wireLayer: SVGGElement;
  private partLayer: SVGGElement;
  private overlayLayer: SVGGElement;

  private rendered = new Map<string, RenderedPart>();
  private diagram: Diagram = { version: 1, parts: [], connections: [] };
  private options: CanvasOptions;

  private panX = 40;
  private panY = 40;
  private zoom = 1;
  private selectedId: string | null = null;

  constructor(private host: HTMLElement, options: CanvasOptions = {}) {
    this.options = options;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'diagram-canvas');
    this.svg.style.width = '100%';
    this.svg.style.height = '100%';
    this.svg.style.display = 'block';
    this.svg.style.touchAction = 'none';

    this.gridPattern = document.createElementNS(SVG_NS, 'g');
    this.viewport = document.createElementNS(SVG_NS, 'g');
    this.wireLayer = document.createElementNS(SVG_NS, 'g');
    this.partLayer = document.createElementNS(SVG_NS, 'g');
    this.overlayLayer = document.createElementNS(SVG_NS, 'g');

    this.viewport.append(this.wireLayer, this.partLayer, this.overlayLayer);
    this.svg.append(this.gridPattern, this.viewport);
    host.append(this.svg);

    this.installViewControls();
    this.applyTransform();
  }

  /** Replace the whole diagram and redraw. */
  setDiagram(diagram: Diagram): void {
    this.diagram = diagram;
    this.redraw();
  }

  getDiagram(): Diagram {
    return this.diagram;
  }

  redraw(): void {
    this.partLayer.replaceChildren();
    this.wireLayer.replaceChildren();
    this.rendered.clear();

    for (const spec of this.diagram.parts) {
      if (spec.hide) continue;
      this.renderPart(spec);
    }
    this.renderWires();
    this.drawGrid();
  }

  private renderPart(spec: DiagramPart): void {
    const pinNames = pinLookup(spec.type) ?? [];
    const visual = getVisual(spec.type, pinNames);
    const attrs = spec.attrs ?? {};

    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'part');
    group.dataset.partId = spec.id;
    const left = spec.left ?? 0;
    const top = spec.top ?? 0;
    const rotate = spec.rotate ?? 0;
    group.setAttribute(
      'transform',
      `translate(${left} ${top}) rotate(${rotate} ${visual.width / 2} ${visual.height / 2})`,
    );

    const bodyGroup = document.createElementNS(SVG_NS, 'g');
    bodyGroup.innerHTML = visual.body(attrs);

    const liveGroup = document.createElementNS(SVG_NS, 'g');
    liveGroup.setAttribute('class', 'part-live');

    const pinGroup = document.createElementNS(SVG_NS, 'g');
    pinGroup.setAttribute('class', 'part-pins');
    const pinMap = new Map<string, PinLayout>();
    for (const pin of visual.pins) {
      pinMap.set(pin.name, pin);
      const hit = document.createElementNS(SVG_NS, 'circle');
      hit.setAttribute('cx', String(pin.x));
      hit.setAttribute('cy', String(pin.y));
      hit.setAttribute('r', '4');
      hit.setAttribute('class', 'pin');
      hit.dataset.pin = pin.name;
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${spec.id}:${pin.name}`;
      hit.append(title);
      hit.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        this.options.onPinClick?.(spec.id, pin.name, this.pinPosition(spec.id, pin.name)!);
      });
      pinGroup.append(hit);
    }

    group.append(bodyGroup, liveGroup, pinGroup);
    group.addEventListener('pointerdown', () => this.options.onPartClick?.(spec.id));
    this.partLayer.append(group);

    this.rendered.set(spec.id, {
      spec,
      group,
      liveGroup,
      pins: pinMap,
      width: visual.width,
      height: visual.height,
    });
  }

  /** Absolute position of a pin, accounting for the part's rotation. */
  pinPosition(partId: string, pinName: string): Point | null {
    const part = this.rendered.get(partId);
    if (!part) return null;
    const pin = part.pins.get(pinName);
    if (!pin) return null;

    const left = part.spec.left ?? 0;
    const top = part.spec.top ?? 0;
    const rotate = ((part.spec.rotate ?? 0) * Math.PI) / 180;
    if (rotate === 0) return { x: left + pin.x, y: top + pin.y };

    const cx = part.width / 2;
    const cy = part.height / 2;
    const dx = pin.x - cx;
    const dy = pin.y - cy;
    const cos = Math.cos(rotate);
    const sin = Math.sin(rotate);
    return {
      x: left + cx + dx * cos - dy * sin,
      y: top + cy + dx * sin + dy * cos,
    };
  }

  private renderWires(): void {
    for (const [from, to, color, route] of this.diagram.connections) {
      if (color === '') continue; // empty colour hides the wire
      let a: Point | null = null;
      let b: Point | null = null;
      try {
        const refA = parsePinRef(from);
        const refB = parsePinRef(to);
        a = this.pinPosition(refA.partId, refA.pin);
        b = this.pinPosition(refB.partId, refB.pin);
      } catch {
        continue;
      }
      if (!a || !b) continue;

      let points: Point[];
      try {
        points = routeWire(a, b, route);
      } catch {
        points = [a, b];
      }

      const line = document.createElementNS(SVG_NS, 'polyline');
      line.setAttribute('points', toSvgPoints(points));
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-linejoin', 'round');
      line.setAttribute('class', 'wire');
      this.wireLayer.append(line);
    }
  }

  /** Apply the latest simulation state for one part. */
  updatePartState(partId: string, state: PartEvent): void {
    const part = this.rendered.get(partId);
    if (!part) return;
    const pinNames = pinLookup(part.spec.type) ?? [];
    const visual = getVisual(part.spec.type, pinNames);
    if (!visual.live) return;
    part.liveGroup.innerHTML = visual.live(state, part.spec.attrs ?? {});
  }

  /** Re-apply a whole batch of part states, e.g. after a redraw. */
  applyStates(states: Map<string, PartEvent>): void {
    for (const [id, state] of states) this.updatePartState(id, state);
  }

  select(partId: string | null): void {
    if (this.selectedId) {
      this.rendered.get(this.selectedId)?.group.classList.remove('selected');
    }
    this.selectedId = partId;
    if (partId) this.rendered.get(partId)?.group.classList.add('selected');
  }

  get selected(): string | null {
    return this.selectedId;
  }

  /** Draw a wire preview while the user is picking the second pin. */
  showPendingWire(from: Point, to: Point): void {
    this.overlayLayer.replaceChildren();
    const line = document.createElementNS(SVG_NS, 'polyline');
    line.setAttribute('points', toSvgPoints(routeWire(from, to, [])));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#38bdf8');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '4 3');
    this.overlayLayer.append(line);
  }

  clearPendingWire(): void {
    this.overlayLayer.replaceChildren();
  }

  // ---- view controls -------------------------------------------------

  private installViewControls(): void {
    let panning = false;
    let startX = 0;
    let startY = 0;

    this.svg.addEventListener('pointerdown', (ev) => {
      // Middle button, or left button on empty canvas, pans.
      if (ev.button === 1 || (ev.button === 0 && ev.target === this.svg)) {
        panning = true;
        startX = ev.clientX - this.panX;
        startY = ev.clientY - this.panY;
        this.svg.setPointerCapture(ev.pointerId);
        if (ev.target === this.svg) this.options.onBackgroundClick?.();
      }
    });

    this.svg.addEventListener('pointermove', (ev) => {
      if (!panning) return;
      this.panX = ev.clientX - startX;
      this.panY = ev.clientY - startY;
      this.applyTransform();
    });

    const endPan = (ev: PointerEvent) => {
      if (!panning) return;
      panning = false;
      try {
        this.svg.releasePointerCapture(ev.pointerId);
      } catch {
        // The pointer may already be released; nothing to do.
      }
    };
    this.svg.addEventListener('pointerup', endPan);
    this.svg.addEventListener('pointercancel', endPan);

    this.svg.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const rect = this.svg.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const my = ev.clientY - rect.top;
        const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
        const next = Math.min(Math.max(this.zoom * factor, 0.2), 4);
        // Keep the point under the cursor fixed while zooming.
        this.panX = mx - ((mx - this.panX) * next) / this.zoom;
        this.panY = my - ((my - this.panY) * next) / this.zoom;
        this.zoom = next;
        this.applyTransform();
      },
      { passive: false },
    );
  }

  private applyTransform(): void {
    this.viewport.setAttribute(
      'transform',
      `translate(${this.panX} ${this.panY}) scale(${this.zoom})`,
    );
    this.drawGrid();
  }

  setZoom(zoom: number): void {
    this.zoom = Math.min(Math.max(zoom, 0.2), 4);
    this.applyTransform();
  }

  get currentZoom(): number {
    return this.zoom;
  }

  /** Convert a client-space point into diagram coordinates. */
  toDiagramPoint(clientX: number, clientY: number): Point {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.panX) / this.zoom,
      y: (clientY - rect.top - this.panY) / this.zoom,
    };
  }

  /** Snap to the 0.1in grid Wokwi uses. */
  snap(point: Point, fine = false): Point {
    const step = fine ? GRID / 2 : GRID;
    return {
      x: Math.round(point.x / step) * step,
      y: Math.round(point.y / step) * step,
    };
  }

  private drawGrid(): void {
    if (this.options.showGrid === false) {
      this.gridPattern.replaceChildren();
      return;
    }
    const rect = this.host.getBoundingClientRect();
    const step = GRID * this.zoom;
    if (step < 6) {
      // Too dense to be useful; hide rather than draw mush.
      this.gridPattern.replaceChildren();
      return;
    }
    const dots: string[] = [];
    const startX = this.panX % step;
    const startY = this.panY % step;
    for (let x = startX; x < rect.width; x += step) {
      for (let y = startY; y < rect.height; y += step) {
        dots.push(`M${x.toFixed(1)} ${y.toFixed(1)}h0.6`);
      }
    }
    this.gridPattern.innerHTML = `<path d="${dots.join('')}" stroke="var(--grid)"
        stroke-width="1.2" stroke-linecap="round" fill="none"/>`;
  }

  resize(): void {
    this.drawGrid();
  }
}
