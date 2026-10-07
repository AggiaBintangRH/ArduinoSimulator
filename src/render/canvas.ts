/**
 * SVG canvas: draws the diagram, routes wires, and applies live part state.
 *
 * Kept free of editing logic - the editor layer (Phase 7) drives this through
 * its public methods so the renderer stays testable on its own.
 */

import type { Diagram, DiagramPart } from '../diagram/types.js';
import { parsePinRef } from '../diagram/parse.js';
import {
  routeWire,
  toSvgPoints,
  offsetSegment,
  routeFromPoints,
  perpendicular,
  roundedPath,
  nearestSegment,
  type Point,
} from '../diagram/router.js';
import { getVisual, GRID, type PartVisual, type PinLayout } from './shapes.js';
import { layoutPinLabels, rotatePartPoint } from './pin-labels.js';
import { pinLookup } from '../sim/registry.js';
import type { PartEvent } from '../sim/part.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface CanvasOptions {
  showGrid?: boolean;
  /** Called when a pin is clicked, for wire drawing. */
  onPinClick?: (partId: string, pin: string, at: Point) => void;
  /** Called when a pressable spot on a part's artwork is used. */
  onControl?: (partId: string, control: string, value: boolean) => void;
  onPartClick?: (partId: string) => void;
  /** Called when click or marquee selection changes. */
  onPartsSelected?: (partIds: string[]) => void;
  /**
   * Called once, when a part drag finishes, with the part's new position.
   * Nothing is reported mid-drag: one gesture is one edit.
   */
  onPartMoved?: (partId: string, left: number, top: number) => void;
  /** Called once when a group move finishes. */
  onPartsMoved?: (moves: Array<{ id: string; left: number; top: number }>) => void;
  onBackgroundClick?: () => void;
  /** Called when a wire is selected/deselected by clicking on it. */
  onWireSelect?: (index: number | null) => void;
  /**
   * Called once, when a wire drag finishes, with the wire's new route
   * instructions. Nothing is reported mid-drag: one gesture is one edit.
   */
  onWireRouted?: (index: number, route: string[]) => void;
  /** Called when a pending wire is dropped onto an existing wire. */
  onWireBranch?: (
    index: number,
    from: Point,
    at: Point,
    splitRoutes: [string[], string[]],
    branchRoute: string[],
  ) => void;
}

/** How wide a wire's invisible grab area is, in diagram px. */
const WIRE_HIT_WIDTH = 12;

/** Corner radius where a wire changes direction. */
const WIRE_CORNER = 7;

/** Half the drawn width of a wire, used to sit its end blob on the pin. */
const WIRE_WIDTH = 3.5;

/** Screen pixels within which a dragged lane aligns with a connected pin. */
const WIRE_PIN_SNAP_DISTANCE = 8;

/** Space around the component artwork reserved for its selection frame. */
const PART_SELECTION_PADDING = 6;

interface PartDrag {
  parts: Array<{ partId: string; origin: Point }>;
  /** Where the pointer was, in diagram coordinates. */
  start: Point;
  /** How far the part has been moved from `origin`, snapped. */
  offset: Point;
}

interface Marquee {
  start: Point;
  current: Point;
  additive: boolean;
  moved: boolean;
}

interface WireDrag {
  wireIndex: number;
  segIndex: number;
  /** The polyline as it was when the drag started. */
  base: Point[];
  /** Unit normal of the dragged segment. */
  perp: Point;
  start: Point;
  offset: number;
}

interface RenderedPart {
  spec: DiagramPart;
  group: SVGGElement;
  selectionGroup: SVGGElement;
  liveGroup: SVGGElement;
  labelGroup: SVGGElement | null;
  nativeLabels: boolean;
  pins: Map<string, PinLayout>;
  width: number;
  height: number;
  /** The part's last reported state, so a latching control can flip it. */
  state?: PartEvent;
}

export class DiagramCanvas {
  readonly svg: SVGSVGElement;
  private viewport: SVGGElement;
  private gridPattern: SVGGElement;
  private wireLayer: SVGGElement;
  private partLayer: SVGGElement;
  private hitLayer: SVGGElement;
  private pinLabelLayer: SVGGElement;
  private selectionLayer: SVGGElement;
  private overlayLayer: SVGGElement;

  private rendered = new Map<string, RenderedPart>();
  private diagram: Diagram = { version: 1, parts: [], connections: [] };
  private options: CanvasOptions;

  private panX = 40;
  private panY = 40;
  private zoom = 1;
  private selectedParts = new Set<string>();
  private wiringFrom: Point | null = null;
  private selectedWire: number | null = null;
  private hoveredWire: number | null = null;
  /** The polyline each wire is currently drawn as, by connection index. */
  private wireGeometry = new Map<number, Point[]>();
  private wireDrag: WireDrag | null = null;
  private partDrag: PartDrag | null = null;
  private marquee: Marquee | null = null;
  private editingEnabled = true;

  constructor(private host: HTMLElement, options: CanvasOptions = {}) {
    this.options = options;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'diagram-canvas');
    this.svg.style.width = '100%';
    this.svg.style.height = '100%';
    this.svg.style.display = 'block';
    this.svg.style.touchAction = 'none';

    this.gridPattern = document.createElementNS(SVG_NS, 'g');
    this.gridPattern.setAttribute('pointer-events', 'none');
    this.viewport = document.createElementNS(SVG_NS, 'g');
    this.wireLayer = document.createElementNS(SVG_NS, 'g');
    this.partLayer = document.createElementNS(SVG_NS, 'g');
    this.hitLayer = document.createElementNS(SVG_NS, 'g');
    this.pinLabelLayer = document.createElementNS(SVG_NS, 'g');
    this.pinLabelLayer.setAttribute('class', 'pin-label-layer');
    this.selectionLayer = document.createElementNS(SVG_NS, 'g');
    this.selectionLayer.setAttribute('class', 'part-selection-layer');
    this.selectionLayer.setAttribute('pointer-events', 'none');
    this.overlayLayer = document.createElementNS(SVG_NS, 'g');

    /*
     * Three layers, in this order for a reason:
     *
     *   partLayer  board and component artwork
     *   wireLayer  cables, which lie over the boards they connect
     *   hitLayer   pin and control hit-boxes
     *
     * A wire's grab area is far wider than the line drawn, so with wires on
     * top they swallowed presses meant for the pins underneath. Lifting the
     * (invisible, tiny) hit-boxes above the wires instead keeps the cables
     * looking right and every pin reachable.
     */
    this.viewport.append(
      this.partLayer,
      this.wireLayer,
      this.pinLabelLayer,
      this.hitLayer,
      this.selectionLayer,
      this.overlayLayer,
    );
    this.svg.append(this.gridPattern, this.viewport);
    host.append(this.svg);

    this.installViewControls();
    this.installWirePreview();
    this.installWireDrag();
    this.installPartDrag();
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

  /** Lock diagram gestures while the simulation runs; part controls stay live. */
  setEditingEnabled(enabled: boolean): void {
    if (this.editingEnabled === enabled) return;
    this.editingEnabled = enabled;
    if (!enabled) {
      const partDrag = this.partDrag;
      this.partDrag = null;
      if (partDrag) {
        for (const part of partDrag.parts) this.previewPart(part.partId, { x: 0, y: 0 });
      }

      const wireDrag = this.wireDrag;
      this.wireDrag = null;
      if (wireDrag) this.previewWire(wireDrag.wireIndex, wireDrag.base);

      this.marquee = null;
      this.overlayLayer.replaceChildren();
      this.clearPendingWire();
    }
    // Rebuild just this layer so selected-wire handles follow the lock state.
    this.renderWires();
  }

  redraw(): void {
    this.partLayer.replaceChildren();
    this.wireLayer.replaceChildren();
    this.hitLayer.replaceChildren();
    this.pinLabelLayer.replaceChildren();
    this.selectionLayer.replaceChildren();
    this.rendered.clear();

    for (const spec of this.diagram.parts) {
      if (spec.hide) continue;
      this.renderPart(spec);
    }
    this.selectedParts = new Set([...this.selectedParts].filter((id) => this.rendered.has(id)));
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
    if (this.selectedParts.has(spec.id)) group.classList.add('selected');
    const left = spec.left ?? 0;
    const top = spec.top ?? 0;
    const rotate = spec.rotate ?? 0;
    group.setAttribute(
      'transform',
      `translate(${left} ${top}) rotate(${rotate} ${visual.width / 2} ${visual.height / 2})`,
    );

    // Keep selection feedback above wires without intercepting pin or control
    // gestures. An explicit SVG frame also works for parts with no lead artwork.
    const selectionGroup = document.createElementNS(SVG_NS, 'g');
    selectionGroup.setAttribute('class', 'part-selection');
    selectionGroup.dataset.selectionPartId = spec.id;
    selectionGroup.setAttribute('transform', group.getAttribute('transform')!);
    selectionGroup.setAttribute('aria-hidden', 'true');
    selectionGroup.classList.toggle('selected', this.selectedParts.has(spec.id));
    const selectionFrame = document.createElementNS(SVG_NS, 'rect');
    selectionFrame.setAttribute('x', String(-PART_SELECTION_PADDING));
    selectionFrame.setAttribute('y', String(-PART_SELECTION_PADDING));
    selectionFrame.setAttribute('width', String(visual.width + PART_SELECTION_PADDING * 2));
    selectionFrame.setAttribute('height', String(visual.height + PART_SELECTION_PADDING * 2));
    selectionFrame.setAttribute('rx', '5');
    selectionFrame.setAttribute('vector-effect', 'non-scaling-stroke');
    selectionGroup.append(selectionFrame);
    this.selectionLayer.append(selectionGroup);

    const bodyGroup = document.createElementNS(SVG_NS, 'g');
    bodyGroup.innerHTML = visual.body(attrs);

    const liveGroup = document.createElementNS(SVG_NS, 'g');
    liveGroup.setAttribute('class', 'part-live');

    /*
     * Leads go under the body and pads over it, so a lead can run well into
     * the part without a stub showing on top of it.
     */
    const leadGroup = document.createElementNS(SVG_NS, 'g');
    leadGroup.setAttribute('class', 'pin-leads');
    if (!visual.drawsOwnPins && !visual.drawsOwnLeads) {
      leadGroup.innerHTML = pinLeads(visual);
    }

    // A solder pad and a name at every pin, unless the artwork already says
    // what its pins are. Drawn from the same table the hit-boxes come from,
    // so a label cannot end up naming the wrong pad.
    const markGroup = document.createElementNS(SVG_NS, 'g');
    markGroup.setAttribute('class', 'pin-marks');
    if (!visual.drawsOwnPins) {
      markGroup.innerHTML = pinMarks(visual);
    }

    // Pin names live above cables so crossings cannot hide them. Solder pads
    // stay with the artwork, below the wires, to preserve the cable layering.
    const nativeLabels = Boolean(visual.pinLabels);
    let labelGroup: SVGGElement | null = null;
    if (nativeLabels || !visual.drawsOwnPins) {
      labelGroup = document.createElementNS(SVG_NS, 'g');
      labelGroup.setAttribute('class', 'pin-label-overlay');
      labelGroup.dataset.partId = spec.id;
      labelGroup.setAttribute(
        'transform',
        nativeLabels ? group.getAttribute('transform')! : `translate(${left} ${top})`,
      );
      labelGroup.innerHTML = visual.pinLabels?.() ?? pinLabels(visual, rotate);
      this.pinLabelLayer.append(labelGroup);
    }

    const transform = group.getAttribute('transform')!;

    const pinGroup = document.createElementNS(SVG_NS, 'g');
    pinGroup.setAttribute('class', 'part-pins');
    pinGroup.setAttribute('transform', transform);
    pinGroup.dataset.partId = spec.id;
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
        if (!this.editingEnabled) return;
        ev.stopPropagation();
        this.options.onPinClick?.(spec.id, pin.name, this.pinPosition(spec.id, pin.name)!);
      });
      pinGroup.append(hit);
    }

    // Controls ride in the hit layer with the pins, for the same reason: a
    // wire crossing the reset button must not be able to absorb the press.
    const controlGroup = document.createElementNS(SVG_NS, 'g');
    controlGroup.setAttribute('class', 'part-controls');
    controlGroup.setAttribute('transform', transform);
    controlGroup.dataset.partId = spec.id;
    for (const control of visual.controls ?? []) {
      const hit = document.createElementNS(SVG_NS, 'circle');
      hit.setAttribute('cx', String(control.x));
      hit.setAttribute('cy', String(control.y));
      hit.setAttribute('r', String(control.r));
      hit.setAttribute('class', 'part-control');
      hit.dataset.control = control.name;
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = control.label;
      hit.append(title);

      const send = (value: boolean) => this.options.onControl?.(spec.id, control.name, value);
      hit.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        // Report the press before capturing: setPointerCapture can throw for a
        // pointer the element does not own, and losing the press that way
        // would leave a momentary control stuck down.
        //
        // A latching control sends the opposite of what the part last
        // reported; sending `true` every time would let a switch be flipped
        // once and never back.
        send(control.toggle ? !control.value?.(this.rendered.get(spec.id)?.state ?? {}) : true);
        try {
          hit.setPointerCapture(ev.pointerId);
        } catch {
          // Without capture a release outside the circle is missed; the
          // pointerleave fallback below covers it.
        }
      });
      if (control.momentary) {
        const release = (ev: PointerEvent) => {
          try {
            hit.releasePointerCapture(ev.pointerId);
          } catch {
            // Already released; nothing to do.
          }
          send(false);
        };
        hit.addEventListener('pointerup', release);
        hit.addEventListener('pointercancel', release);
        hit.addEventListener('pointerleave', release);
      }
      controlGroup.append(hit);
    }

    group.append(leadGroup, bodyGroup, markGroup, liveGroup);
    group.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      if (ev.shiftKey) {
        this.selectParts([...this.selectedParts, spec.id], true);
      } else if (!this.selectedParts.has(spec.id)) {
        this.selectParts([spec.id], true);
      }
      this.options.onPartClick?.(spec.id);
      // Board artwork is covered in silkscreen text; without this the press
      // starts a text selection and the browser's own drag takes the pointer.
      ev.preventDefault();
      this.beginPartDrag(spec.id, ev);
    });
    this.partLayer.append(group);
    this.hitLayer.append(controlGroup, pinGroup);

    /*
     * Pins show themselves while the part is under the cursor. They used to be
     * children of the part, so plain CSS `:hover` did it; from their own layer
     * they have to be told. Moving between the part and one of its pins fires
     * a leave before the matching enter, so the flag ends up right either way.
     */
    const showPins = () => pinGroup.classList.add('pins-visible');
    const hidePins = () => pinGroup.classList.remove('pins-visible');
    for (const el of [group, pinGroup]) {
      el.addEventListener('pointerenter', showPins);
      el.addEventListener('pointerleave', hidePins);
    }

    this.rendered.set(spec.id, {
      spec,
      group,
      selectionGroup,
      liveGroup,
      labelGroup,
      nativeLabels,
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

    /*
     * A drag in progress is an offset, not a write. Adding it here rather than
     * editing the part means the diagram - and so the undo stack - still holds
     * where the part was when the gesture started.
     */
    const drag = this.partDrag?.parts.some((item) => item.partId === partId)
      ? this.partDrag.offset
      : null;
    const left = (part.spec.left ?? 0) + (drag?.x ?? 0);
    const top = (part.spec.top ?? 0) + (drag?.y ?? 0);
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
    this.wireGeometry.clear();
    for (let wireIndex = 0; wireIndex < this.diagram.connections.length; wireIndex++) {
      const [from, to, color, route] = this.diagram.connections[wireIndex];
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
      // The route is the only record of a wire's shape. Keeping the resulting
      // polyline here lets a drag start from what is on screen without
      // recomputing it, and without a second store that could disagree with it.
      this.wireGeometry.set(wireIndex, points);

      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('class', 'wire-group');
      group.dataset.wireIndex = String(wireIndex);

      // A transparent stroke wide enough to grab, under the visible one. It
      // stays a straight polyline: rounding corners would only make the grab
      // area disagree with itself at the bends.
      const hit = document.createElementNS(SVG_NS, 'polyline');
      hit.setAttribute('points', toSvgPoints(points));
      hit.setAttribute('fill', 'none');
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', String(WIRE_HIT_WIDTH));
      hit.setAttribute('stroke-linecap', 'round');
      hit.setAttribute('stroke-linejoin', 'round');
      hit.setAttribute('class', 'wire-hit');

      const d = roundedPath(points, WIRE_CORNER);

      // A dark casing a shade wider than the wire lifts it off the board and
      // reads as the shadow a real jumper casts.
      const casing = document.createElementNS(SVG_NS, 'path');
      casing.setAttribute('d', d);
      casing.setAttribute('fill', 'none');
      casing.setAttribute('class', 'wire-casing');

      const line = document.createElementNS(SVG_NS, 'path');
      line.setAttribute('d', d);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', String(WIRE_WIDTH));
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-linejoin', 'round');
      line.setAttribute('class', 'wire');

      // A blob at each end so the wire reads as terminated on the pad rather
      // than stopping near it.
      const ends = [points[0], points[points.length - 1]].map((end) => {
        const blob = document.createElementNS(SVG_NS, 'circle');
        blob.setAttribute('cx', String(end.x));
        blob.setAttribute('cy', String(end.y));
        blob.setAttribute('r', String(WIRE_WIDTH / 2 + 0.6));
        blob.setAttribute('fill', color);
        blob.setAttribute('class', 'wire-end');
        return blob;
      });

      hit.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        ev.preventDefault();
        if (this.wiringFrom) {
          const pointer = this.toDiagramPoint(ev.clientX, ev.clientY);
          const junction = this.projectToWire(wireIndex, pointer);
          const points = this.wireGeometry.get(wireIndex);
          if (junction && points) {
            const segment = nearestSegment(points, junction);
            const first = routeFromPoints([...points.slice(0, segment + 1), junction]);
            const second = routeFromPoints([junction, ...points.slice(segment + 1)]);
            const branch = routeFromPoints(routeWire(this.wiringFrom, junction, []));
            this.options.onWireBranch?.(
              wireIndex,
              this.wiringFrom,
              junction,
              [first, second],
              branch,
            );
            this.clearPendingWire();
          }
          return;
        }
        // The wire body only selects the route. Its handles appear on redraw;
        // reshaping is an explicit second action on one of those handles.
        this.selectParts([], true);
        this.selectWire(wireIndex);
      });
      group.append(hit, casing, line, ...ends);
      this.applyWireClass(wireIndex, line);

      // Only an exposed handle can reshape a selected wire.
      if (this.editingEnabled && this.selectedWire === wireIndex) {
        for (let seg = 0; seg < points.length - 1; seg++) {
          const handle = document.createElementNS(SVG_NS, 'circle');
          handle.setAttribute('cx', String((points[seg].x + points[seg + 1].x) / 2));
          handle.setAttribute('cy', String((points[seg].y + points[seg + 1].y) / 2));
          handle.setAttribute('r', '5');
          handle.setAttribute('class', 'wire-handle');
          handle.dataset.segIndex = String(seg);
          handle.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0 || this.selectedWire !== wireIndex) return;
            ev.stopPropagation();
            this.beginWireDrag(wireIndex, seg, ev);
          });
          group.append(handle);
        }
      }

      this.wireLayer.append(group);
    }

    // Selection redraws the whole wire layer. Restore the active wire's
    // stacking order so its handles and visible stroke stay above crossings.
    const activeWire = this.hoveredWire ?? this.selectedWire;
    if (activeWire !== null) {
      const group = this.wireLayer.querySelector<SVGGElement>(
        `g[data-wire-index="${activeWire}"]`,
      );
      if (group) this.wireLayer.append(group);
    }
  }

  selectWire(index: number | null): void {
    if (this.selectedWire === index) return;
    this.selectedWire = index;
    this.options.onWireSelect?.(index);
    this.redraw();
  }

  get selectedWireIndex(): number | null {
    return this.selectedWire;
  }

  private applyWireClass(wireIndex: number, line: SVGElement): void {
    const classes = ['wire'];
    if (this.selectedWire === wireIndex) classes.push('wire-selected');
    else if (this.hoveredWire === wireIndex) classes.push('wire-hover');
    line.setAttribute('class', classes.join(' '));
  }

  // ---- part dragging -------------------------------------------------

  /** The transform that places a part, optionally shifted by a drag. */
  private partTransform(part: RenderedPart, offset: Point): string {
    const left = (part.spec.left ?? 0) + offset.x;
    const top = (part.spec.top ?? 0) + offset.y;
    const rotate = part.spec.rotate ?? 0;
    return `translate(${left} ${top}) rotate(${rotate} ${part.width / 2} ${part.height / 2})`;
  }

  /**
   * Move a part's drawn position without touching the diagram.
   *
   * Its pin and control hit-boxes live in their own layer, above the wires, so
   * they have to be moved alongside it or they stay behind and the part stops
   * being wirable where it looks.
   */
  private previewPart(partId: string, offset: Point): void {
    const part = this.rendered.get(partId);
    if (!part) return;
    const transform = this.partTransform(part, offset);
    part.group.setAttribute('transform', transform);
    part.selectionGroup.setAttribute('transform', transform);
    part.labelGroup?.setAttribute(
      'transform',
      part.nativeLabels
        ? transform
        : `translate(${(part.spec.left ?? 0) + offset.x} ${(part.spec.top ?? 0) + offset.y})`,
    );
    for (const hit of this.hitLayer.querySelectorAll<SVGGElement>(
      `[data-part-id="${partId}"]`,
    )) {
      hit.setAttribute('transform', transform);
    }
    this.previewWiresOn(partId);
  }

  /** Redraw just the wires that land on this part, at their new ends. */
  private previewWiresOn(partId: string): void {
    for (let i = 0; i < this.diagram.connections.length; i++) {
      const [from, to, color, route] = this.diagram.connections[i];
      if (color === '') continue;
      let a: Point | null = null;
      let b: Point | null = null;
      let touches = false;
      try {
        const refA = parsePinRef(from);
        const refB = parsePinRef(to);
        touches = refA.partId === partId || refB.partId === partId;
        if (!touches) continue;
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
      this.previewWire(i, points);
    }
  }

  private beginPartDrag(partId: string, ev: PointerEvent): void {
    if (!this.editingEnabled) return;
    if (!this.selectedParts.has(partId)) return;
    const parts = [...this.selectedParts].flatMap((id) => {
      const part = this.rendered.get(id);
      return part ? [{ partId: id, origin: { x: part.spec.left ?? 0, y: part.spec.top ?? 0 } }] : [];
    });
    if (parts.length === 0) return;
    this.partDrag = {
      parts,
      start: this.toDiagramPoint(ev.clientX, ev.clientY),
      offset: { x: 0, y: 0 },
    };
    try {
      this.svg.setPointerCapture(ev.pointerId);
    } catch {
      // Without capture the drag still tracks; it just ends early if the
      // pointer leaves the canvas.
    }
  }

  private installPartDrag(): void {
    this.svg.addEventListener('pointermove', (ev) => {
      const drag = this.partDrag;
      if (!drag) return;
      const at = this.toDiagramPoint(ev.clientX, ev.clientY);
      // Snap where the part lands, not how far it travelled: a part dropped
      // from anywhere should sit on the grid its pins are spaced on.
      const first = drag.parts[0];
      const landing = this.snap(
        {
          x: first.origin.x + (at.x - drag.start.x),
          y: first.origin.y + (at.y - drag.start.y),
        },
        ev.shiftKey,
      );
      const offset = { x: landing.x - first.origin.x, y: landing.y - first.origin.y };
      if (offset.x === drag.offset.x && offset.y === drag.offset.y) return;
      drag.offset = offset;
      for (const part of drag.parts) this.previewPart(part.partId, offset);
    });

    const end = (ev: PointerEvent) => {
      const drag = this.partDrag;
      if (!drag) return;
      this.partDrag = null;
      try {
        this.svg.releasePointerCapture(ev.pointerId);
      } catch {
        // Already released; nothing to do.
      }
      if (drag.offset.x === 0 && drag.offset.y === 0) {
        // A press that moved nothing is a selection, not an edit.
        for (const part of drag.parts) this.previewPart(part.partId, { x: 0, y: 0 });
        return;
      }
      const moves = drag.parts.map(({ partId, origin }) => ({
        id: partId,
        left: origin.x + drag.offset.x,
        top: origin.y + drag.offset.y,
      }));
      if (this.options.onPartsMoved) this.options.onPartsMoved(moves);
      else if (moves.length === 1) {
        this.options.onPartMoved?.(moves[0].id, moves[0].left, moves[0].top);
      }
    };
    this.svg.addEventListener('pointerup', end);
    this.svg.addEventListener('pointercancel', end);
  }

  // ---- wire dragging -------------------------------------------------

  /**
   * Start sliding one segment of a wire sideways.
   *
   * Nothing is written to the diagram until the pointer is released: a drag is
   * one edit, not one edit per pixel of mouse movement.
   */
  private beginWireDrag(wireIndex: number, segIndex: number, ev: PointerEvent): void {
    if (!this.editingEnabled) return;
    const base = this.wireGeometry.get(wireIndex);
    if (!base || segIndex < 0 || segIndex >= base.length - 1) return;
    // Board artwork is full of silkscreen text. Without this the press starts
    // a text selection, and dragging a selection is a native drag that takes
    // the pointer with it - so the second drag of a wire did nothing.
    ev.preventDefault();
    this.wireDrag = {
      wireIndex,
      segIndex,
      base: base.map((p) => ({ ...p })),
      perp: perpendicular(base[segIndex], base[segIndex + 1]),
      start: this.toDiagramPoint(ev.clientX, ev.clientY),
      offset: 0,
    };
    try {
      this.svg.setPointerCapture(ev.pointerId);
    } catch {
      // Without capture the drag still tracks; it just ends early if the
      // pointer leaves the canvas.
    }
  }

  private installWireDrag(): void {
    this.svg.addEventListener('pointermove', (ev) => {
      const drag = this.wireDrag;
      if (!drag) return;
      const at = this.toDiagramPoint(ev.clientX, ev.clientY);
      // Only the movement along the segment's normal counts: the segment
      // slides sideways, it does not follow the cursor.
      const along =
        (at.x - drag.start.x) * drag.perp.x + (at.y - drag.start.y) * drag.perp.y;
      drag.offset = this.snapOffset(drag, along, ev.shiftKey);
      this.previewWire(
        drag.wireIndex,
        offsetSegment(drag.base, drag.segIndex, drag.offset),
      );
    });

    const end = (ev: PointerEvent) => {
      const drag = this.wireDrag;
      if (!drag) return;
      this.wireDrag = null;
      try {
        this.svg.releasePointerCapture(ev.pointerId);
      } catch {
        // Already released; nothing to do.
      }
      if (drag.offset === 0) {
        // A press that moved nothing is a selection, not an edit.
        this.previewWire(drag.wireIndex, drag.base);
        return;
      }
      const points = offsetSegment(drag.base, drag.segIndex, drag.offset);
      this.options.onWireRouted?.(drag.wireIndex, routeFromPoints(points));
    };
    this.svg.addEventListener('pointerup', end);
    this.svg.addEventListener('pointercancel', end);
  }

  /**
   * Prefer the connected pins' axes near a pad, even when they are off grid.
   * Away from those axes, snap the lane to the grid (half pitch with Shift).
   */
  private snapOffset(drag: WireDrag, along: number, fine: boolean): number {
    const movesInX = drag.perp.x !== 0;
    const direction = movesInX ? drag.perp.x : drag.perp.y;
    const from = movesInX ? drag.base[drag.segIndex].x : drag.base[drag.segIndex].y;
    const step = fine ? GRID / 2 : GRID;
    const raw = from + direction * along;
    const tolerance = Math.min(step / 2, WIRE_PIN_SNAP_DISTANCE / this.zoom);
    let landing = Math.round(raw / step) * step;
    let closestPinDistance = Infinity;
    for (const pin of [drag.base[0], drag.base[drag.base.length - 1]]) {
      const coordinate = movesInX ? pin.x : pin.y;
      const distance = Math.abs(raw - coordinate);
      if (distance <= tolerance && distance < closestPinDistance) {
        landing = coordinate;
        closestPinDistance = distance;
      }
    }
    return (landing - from) / direction;
  }

  /** Move one wire's drawn shape without touching the diagram. */
  private previewWire(wireIndex: number, points: Point[]): void {
    const group = this.wireLayer.querySelector<SVGGElement>(
      `g[data-wire-index="${wireIndex}"]`,
    );
    if (!group) return;
    const svgPoints = toSvgPoints(points);
    for (const line of group.querySelectorAll('polyline')) {
      line.setAttribute('points', svgPoints);
    }
    const d = roundedPath(points, WIRE_CORNER);
    for (const path of group.querySelectorAll('path')) {
      path.setAttribute('d', d);
    }
    // The ends are pinned to the pins, but a redraw-free preview still has to
    // move them when the wire they cap is re-shaped.
    const blobs = group.querySelectorAll<SVGCircleElement>('.wire-end');
    const caps = [points[0], points[points.length - 1]];
    blobs.forEach((blob, i) => {
      if (!caps[i]) return;
      blob.setAttribute('cx', String(caps[i].x));
      blob.setAttribute('cy', String(caps[i].y));
    });
    for (const handle of group.querySelectorAll<SVGCircleElement>('.wire-handle')) {
      const seg = Number(handle.dataset.segIndex);
      if (!(seg >= 0 && seg < points.length - 1)) continue;
      handle.setAttribute('cx', String((points[seg].x + points[seg + 1].x) / 2));
      handle.setAttribute('cy', String((points[seg].y + points[seg + 1].y) / 2));
    }
  }

  /** Apply the latest simulation state for one part. */
  updatePartState(partId: string, state: PartEvent): void {
    const part = this.rendered.get(partId);
    if (!part) return;
    // Kept so a latching control can flip what the part actually reports
    // rather than a second copy of it kept alongside.
    part.state = state;
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
    this.selectParts(partId ? [partId] : []);
  }

  /** Apply a selection without triggering the selection callback by default. */
  selectParts(partIds: readonly string[], notify = false): void {
    const next = new Set(partIds.filter((id) => this.rendered.has(id)));
    for (const id of this.selectedParts) {
      if (!next.has(id)) {
        const part = this.rendered.get(id);
        part?.group.classList.remove('selected');
        part?.selectionGroup.classList.remove('selected');
      }
    }
    for (const id of next) {
      const part = this.rendered.get(id);
      part?.group.classList.add('selected');
      part?.selectionGroup.classList.add('selected');
    }
    this.selectedParts = next;
    if (notify) this.options.onPartsSelected?.([...next]);
  }

  get selected(): string | null {
    return this.selectedPartIds[0] ?? null;
  }

  get selectedPartIds(): string[] {
    return [...this.selectedParts].filter((id) => this.rendered.has(id));
  }

  setWiring(active: boolean, from?: Point): void {
    this.svg.classList.toggle('wiring', active);
    if (active && from) {
      this.wiringFrom = from;
    } else if (!active) {
      this.wiringFrom = null;
    }
  }

  showPendingWire(from: Point, to: Point): void {
    this.overlayLayer.replaceChildren();
    const line = document.createElementNS(SVG_NS, 'polyline');
    line.setAttribute('points', toSvgPoints(routeWire(from, to, [])));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#38bdf8');
    line.setAttribute('stroke-width', '4');
    line.setAttribute('stroke-dasharray', '4 3');
    this.overlayLayer.append(line);
  }

  clearPendingWire(): void {
    this.setWiring(false);
    this.wiringFrom = null;
    this.overlayLayer.replaceChildren();
  }

  /** Project a pointer onto a wire when it is inside the visible grab radius. */
  private projectToWire(wireIndex: number, point: Point): Point | null {
    const points = this.wireGeometry.get(wireIndex);
    if (!points || points.length < 2) return null;
    const segment = nearestSegment(points, point);
    const projected = projectOntoSegment(point, points[segment], points[segment + 1]);
    return Math.hypot(projected.x - point.x, projected.y - point.y) <=
      WIRE_HIT_WIDTH / (2 * this.zoom)
      ? projected
      : null;
  }

  private projectToNearbyWire(point: Point): Point | null {
    let nearest: Point | null = null;
    let distance = Infinity;
    for (const wireIndex of this.wireGeometry.keys()) {
      const projected = this.projectToWire(wireIndex, point);
      if (!projected) continue;
      const candidateDistance = Math.hypot(projected.x - point.x, projected.y - point.y);
      if (candidateDistance < distance) {
        nearest = projected;
        distance = candidateDistance;
      }
    }
    return nearest;
  }

  /** Show a dashed preview line while drawing a wire. */
  private installWirePreview(): void {
    this.svg.addEventListener('pointermove', (ev) => {
      const point = this.toDiagramPoint(ev.clientX, ev.clientY);
      this.updateHoveredWire(point);
      if (this.wiringFrom) {
        this.showPendingWire(this.wiringFrom, this.projectToNearbyWire(point) ?? point);
      }
    });
    this.svg.addEventListener('pointerleave', () => this.updateHoveredWire(null));
  }

  /** Keep the wire under the pointer above crossings without requiring a click. */
  private updateHoveredWire(point: Point | null): void {
    const previous = this.hoveredWire;
    let next: number | null = null;
    let nearestDistance = Infinity;

    if (point) {
      // Prefer the visually upper wire when two hit areas overlap equally.
      const indices = [...this.wireGeometry.keys()].reverse();
      for (const index of indices) {
        const projected = this.projectToWire(index, point);
        if (!projected) continue;
        const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
        if (distance < nearestDistance) {
          next = index;
          nearestDistance = distance;
        }
      }
    }

    if (previous === next) return;
    this.hoveredWire = next;
    for (const index of [previous, next]) {
      if (index === null) continue;
      const group = this.wireLayer.querySelector<SVGGElement>(
        `g[data-wire-index="${index}"]`,
      );
      const line = group?.querySelector<SVGElement>('.wire');
      if (line) this.applyWireClass(index, line);
    }

    // The hovered wire wins above crossings; keep the selected wire raised
    // only when the pointer is not over another wire.
    const active = next ?? this.selectedWire;
    if (active !== null) {
      const group = this.wireLayer.querySelector<SVGGElement>(
        `g[data-wire-index="${active}"]`,
      );
      if (group) this.wireLayer.append(group);
    }
  }

  // ---- view controls -------------------------------------------------

  private installViewControls(): void {
    let panning = false;
    let startX = 0;
    let startY = 0;

    this.svg.addEventListener('pointerdown', (ev) => {
      if (ev.button === 1) {
        panning = true;
        startX = ev.clientX - this.panX;
        startY = ev.clientY - this.panY;
        try {
          this.svg.setPointerCapture(ev.pointerId);
        } catch {
          // A pointer that cannot be captured still pans; more importantly, a
          // throw here used to swallow the background click below it.
        }
      } else if (ev.button === 0 && ev.target === this.svg) {
        // Left-drag on empty canvas draws a selection box; middle-drag pans.
        this.marquee = {
          start: this.toDiagramPoint(ev.clientX, ev.clientY),
          current: this.toDiagramPoint(ev.clientX, ev.clientY),
          additive: ev.shiftKey,
          moved: false,
        };
        ev.preventDefault();
        try {
          this.svg.setPointerCapture(ev.pointerId);
        } catch {
          // Pointer movement still works inside the canvas without capture.
        }
      }
    });

    this.svg.addEventListener('pointermove', (ev) => {
      if (this.marquee) {
        const marquee = this.marquee;
        marquee.current = this.toDiagramPoint(ev.clientX, ev.clientY);
        marquee.moved ||= Math.hypot(
          (marquee.current.x - marquee.start.x) * this.zoom,
          (marquee.current.y - marquee.start.y) * this.zoom,
        ) >= 3;
        if (marquee.moved) this.drawMarquee(marquee);
      } else if (panning) {
        this.panX = ev.clientX - startX;
        this.panY = ev.clientY - startY;
        this.applyTransform();
      }
    });

    const endGesture = (ev: PointerEvent) => {
      if (panning) {
        panning = false;
        try {
          this.svg.releasePointerCapture(ev.pointerId);
        } catch {
          // The pointer may already be released; nothing to do.
        }
        return;
      }
      const marquee = this.marquee;
      if (!marquee) return;
      this.marquee = null;
      this.overlayLayer.replaceChildren();
      try {
        this.svg.releasePointerCapture(ev.pointerId);
      } catch {
        // The pointer may already be released; nothing to do.
      }

      if (!marquee.moved) {
        this.options.onBackgroundClick?.();
        this.selectWire(null);
        this.selectParts([], true);
        return;
      }

      const box = {
        left: Math.min(marquee.start.x, marquee.current.x),
        right: Math.max(marquee.start.x, marquee.current.x),
        top: Math.min(marquee.start.y, marquee.current.y),
        bottom: Math.max(marquee.start.y, marquee.current.y),
      };
      const hits = [...this.rendered.values()]
        .filter((part) => {
          const bounds = this.partBounds(part);
          return bounds.left <= box.right && bounds.right >= box.left &&
            bounds.top <= box.bottom && bounds.bottom >= box.top;
        })
        .map((part) => part.spec.id);
      const selected = marquee.additive ? [...new Set([...this.selectedParts, ...hits])] : hits;
      this.selectParts(selected, true);
      this.selectWire(null);
      if (selected.length === 0 && !marquee.additive) this.options.onBackgroundClick?.();
    };
    this.svg.addEventListener('pointerup', endGesture);
    this.svg.addEventListener('pointercancel', endGesture);

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

  private drawMarquee(marquee: Marquee): void {
    const left = Math.min(marquee.start.x, marquee.current.x);
    const top = Math.min(marquee.start.y, marquee.current.y);
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', 'marquee-selection');
    rect.setAttribute('x', String(left));
    rect.setAttribute('y', String(top));
    rect.setAttribute('width', String(Math.abs(marquee.current.x - marquee.start.x)));
    rect.setAttribute('height', String(Math.abs(marquee.current.y - marquee.start.y)));
    this.overlayLayer.replaceChildren(rect);
  }

  private partBounds(part: RenderedPart): { left: number; top: number; right: number; bottom: number } {
    const visual = getVisual(part.spec.type, [...part.pins.keys()]);
    const rotate = part.spec.rotate ?? 0;
    const left = part.spec.left ?? 0;
    const top = part.spec.top ?? 0;
    const corners = [
      { x: 0, y: 0 },
      { x: visual.width, y: 0 },
      { x: 0, y: visual.height },
      { x: visual.width, y: visual.height },
    ].map((point) => rotatePartPoint(point, visual, rotate));
    return {
      left: left + Math.min(...corners.map((point) => point.x)),
      right: left + Math.max(...corners.map((point) => point.x)),
      top: top + Math.min(...corners.map((point) => point.y)),
      bottom: top + Math.max(...corners.map((point) => point.y)),
    };
  }

  private applyTransform(): void {
    this.viewport.setAttribute(
      'transform',
      `translate(${this.panX} ${this.panY}) scale(${this.zoom})`,
    );
    this.drawGrid();
  }

  /**
   * Bounding box of everything drawn, in diagram coordinates, or null when the
   * diagram is empty. Parts are measured from their own artwork rather than a
   * fixed guess, so a Mega is treated as the 776px board it is.
   */
  contentBounds(): { x: number; y: number; width: number; height: number } | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const include = (x: number, y: number) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };
    for (const part of this.rendered.values()) {
      const left = part.spec.left ?? 0;
      const top = part.spec.top ?? 0;
      const rotate = part.spec.rotate ?? 0;
      const visual = getVisual(part.spec.type, [...part.pins.keys()]);
      const margin = part.nativeLabels && !visual.pinLabelsInsideBody ? 56 : 0;
      for (const point of [
        { x: -margin, y: -margin },
        { x: part.width + margin, y: -margin },
        { x: -margin, y: part.height + margin },
        { x: part.width + margin, y: part.height + margin },
      ]) {
        const at = rotatePartPoint(point, visual, rotate);
        include(left + at.x, top + at.y);
      }
      if (!visual.drawsOwnPins) {
        for (const label of layoutPinLabels(visual, rotate)) {
          include(left + label.x - label.width / 2, top + label.y - label.height / 2);
          include(left + label.x + label.width / 2, top + label.y + label.height / 2);
        }
      }
    }
    for (const points of this.wireGeometry.values()) {
      for (const point of points) include(point.x, point.y);
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  /**
   * Frame the whole diagram in the view.
   *
   * Without this the view always started at 1x from a fixed corner, which
   * happened to suit a 300px Uno and cut a 776px Mega in half.
   */
  fitToContent(padding = 32): void {
    const bounds = this.contentBounds();
    // Measure the host: the svg fills it, and asking the svg for its own box
    // reports zero in environments that do not lay SVG out.
    const rect = this.host.getBoundingClientRect();
    if (!bounds || rect.width === 0 || rect.height === 0) return;

    const scaleX = (rect.width - padding * 2) / bounds.width;
    const scaleY = (rect.height - padding * 2) / bounds.height;
    // Never zoom past 1: a lone small part should not fill the screen.
    this.zoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.2), 1);

    this.panX = (rect.width - bounds.width * this.zoom) / 2 - bounds.x * this.zoom;
    this.panY = (rect.height - bounds.height * this.zoom) / 2 - bounds.y * this.zoom;
    this.applyTransform();
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

  /**
   * The middle of what is on screen, in diagram coordinates.
   *
   * Somewhere to put a new part: a fixed spot drops it off-screen as soon as
   * the view has been panned or zoomed anywhere.
   */
  viewportCenter(): Point {
    const rect = this.host.getBoundingClientRect();
    return this.toDiagramPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
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

interface Edge {
  gap: number;
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
}

function projectOntoSegment(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { ...a };
  const fraction = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  );
  return { x: a.x + dx * fraction, y: a.y + dy * fraction };
}

/** Which side of the part a pin is nearest, and so which way its name reads. */
function nearestEdge(pin: PinLayout, visual: PartVisual): Edge {
  const edges: Edge[] = [
    { gap: pin.y, dx: 0, dy: -1 },
    { gap: visual.height - pin.y, dx: 0, dy: 1 },
    { gap: pin.x, dx: -1, dy: 0 },
    { gap: visual.width - pin.x, dx: 1, dy: 0 },
  ];
  return edges.reduce((a, b) => (b.gap < a.gap ? b : a));
}

/**
 * How far a generated lead runs from its pad into the part.
 *
 * Long enough to reach the body on every part that has one; the overshoot is
 * hidden because leads are drawn underneath the artwork.
 */
const LEAD_LENGTH = 10;

/**
 * The legs between a part's body and its pads.
 *
 * Parts whose leads have a shape of their own - an LED's splay, a resistor's
 * run straight through - draw them in their artwork and set `drawsOwnLeads`.
 * For the rest this puts a straight lead at every pin, so no pad is left
 * floating beside its body with nothing joining the two.
 */
function pinLeads(visual: PartVisual): string {
  return visual.pins
    .map((pin) => {
      const edge = nearestEdge(pin, visual);
      // Inward: the opposite way from the edge the pin sits on.
      const x = pin.x - edge.dx * LEAD_LENGTH;
      const y = pin.y - edge.dy * LEAD_LENGTH;
      return `<line class="pin-lead" x1="${pin.x}" y1="${pin.y}" x2="${x}" y2="${y}"/>`;
    })
    .join('');
}

/** Solder pads follow the part's artwork; label layout has its own layer. */
function pinMarks(visual: PartVisual): string {
  return visual.pins
    .map((pin) => `<circle class="pin-pad" cx="${pin.x}" cy="${pin.y}" r="2.6"/>`)
    .join('');
}

/** Render upright names from already transformed pin coordinates. */
function pinLabels(visual: PartVisual, rotate: number): string {
  return layoutPinLabels(visual, rotate)
    .map(({ pin, side, x, y, width, height }) => {
      const left = x - width / 2;
      const top = y - height / 2;
      const sign = side === 'top' || side === 'left' ? -1 : 1;
      const horizontal = side === 'left' || side === 'right';
      const startX = pin.x + (horizontal ? sign * 4.5 : 0);
      const startY = pin.y + (horizontal ? 0 : sign * 4.5);
      const endX = horizontal ? x - sign * width / 2 : x;
      const endY = horizontal ? y : y - sign * height / 2;
      const name = escapeText(pin.name).replace(/"/g, '&quot;');
      return (
        `<g class="pin-name">` +
        `<line class="pin-label-leader" x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}"/>` +
        `<rect class="pin-label-background" x="${left}" y="${top}" width="${width}" height="${height}" rx="3"/>` +
        `<text class="pin-label" data-pin="${name}" x="${x}" y="${y}" ` +
        `text-anchor="middle" dominant-baseline="middle">${escapeText(pin.name)}</text></g>`
      );
    })
    .join('');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
