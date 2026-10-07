/**
 * Diagram editing: add / move / rotate / delete parts, draw and remove wires.
 *
 * Operates on a Diagram value and reports changes; the canvas redraws from the
 * new value. Keeping mutation here (rather than in the renderer) means every
 * operation is testable without a DOM.
 */

import type { Diagram, DiagramConnection, DiagramPart } from '../diagram/types.js';
import { parsePinRef } from '../diagram/parse.js';
import { pinLookup } from '../sim/registry.js';
import { parseRoute } from '../diagram/router.js';
import {
  WIRE_JUNCTION_CENTER,
  WIRE_JUNCTION_PIN,
  WIRE_JUNCTION_TYPE,
} from '../parts/wire-junction.js';
import type { Point } from '../diagram/router.js';

/** Wokwi assigns wire colours by pin function: black ground, red 5V, green other. */
export function defaultWireColor(refA: string, refB: string): string {
  const pins = [refA, refB].map((r) => {
    try {
      return parsePinRef(r).pin;
    } catch {
      return '';
    }
  });
  if (pins.some((p) => /^GND(\.\d+)?$/.test(p) || p === 'VSS')) return 'black';
  if (pins.some((p) => p === '5V' || p === 'VCC' || p === 'VDD' || p === '3.3V' || p === 'VIN')) {
    return 'red';
  }
  return 'green';
}

/** Generate an id like "led1" that does not collide with an existing part. */
export function makePartId(diagram: Diagram, type: string): string {
  const base = type.replace(/^wokwi-|^board-/, '').replace(/[^a-z0-9]/gi, '') || 'part';
  const taken = new Set(diagram.parts.map((p) => p.id));
  for (let i = 1; ; i++) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface EditorEvents {
  onChange?: (diagram: Diagram) => void;
  onSelect?: (partId: string | null) => void;
  onError?: (message: string) => void;
}

export class DiagramEditor {
  private diagram: Diagram;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private selectedId: string | null = null;
  /** First pin of a wire being drawn. */
  private pendingPin: { partId: string; pin: string } | null = null;

  constructor(diagram: Diagram, private events: EditorEvents = {}) {
    this.diagram = structuredClone(diagram);
  }

  get value(): Diagram {
    return this.diagram;
  }

  get selected(): string | null {
    return this.selectedId;
  }

  get pending(): { partId: string; pin: string } | null {
    return this.pendingPin;
  }

  /** Replace the whole diagram, e.g. from the JSON text view. */
  replace(diagram: Diagram, recordUndo = true): void {
    if (recordUndo) this.pushUndo();
    this.diagram = structuredClone(diagram);
    if (this.selectedId && !this.findPart(this.selectedId)) this.select(null);
    this.changed();
  }

  private pushUndo(): void {
    this.undoStack.push(JSON.stringify(this.diagram));
    // A deep history is rarely useful and keeps memory bounded.
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private changed(): void {
    this.events.onChange?.(this.diagram);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (previous === undefined) return;
    this.redoStack.push(JSON.stringify(this.diagram));
    this.diagram = JSON.parse(previous) as Diagram;
    if (this.selectedId && !this.findPart(this.selectedId)) this.select(null);
    this.changed();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(JSON.stringify(this.diagram));
    this.diagram = JSON.parse(next) as Diagram;
    this.changed();
  }

  findPart(id: string): DiagramPart | undefined {
    return this.diagram.parts.find((p) => p.id === id);
  }

  select(partId: string | null): void {
    this.selectedId = partId;
    this.events.onSelect?.(partId);
  }

  addPart(type: string, left = 0, top = 0, attrs?: Record<string, string>): string {
    this.pushUndo();
    const id = makePartId(this.diagram, type);
    const part: DiagramPart = { id, type, left, top };
    if (attrs && Object.keys(attrs).length) part.attrs = { ...attrs };
    this.diagram.parts.push(part);
    this.changed();
    this.select(id);
    return id;
  }

  movePart(id: string, left: number, top: number, recordUndo = true): void {
    const part = this.findPart(id);
    if (!part) return;
    if (recordUndo) this.pushUndo();
    part.left = left;
    part.top = top;
    this.changed();
  }

  /** Move a selected group in one undoable editor operation. */
  moveParts(moves: readonly { id: string; left: number; top: number }[]): void {
    const valid = moves.filter((move) => this.findPart(move.id));
    if (valid.length === 0) return;
    this.pushUndo();
    for (const move of valid) {
      const part = this.findPart(move.id)!;
      part.left = move.left;
      part.top = move.top;
    }
    this.changed();
  }

  /** Rotate by 90 degrees, matching the "R" shortcut. */
  rotatePart(id: string, degrees = 90): void {
    const part = this.findPart(id);
    if (!part) return;
    this.pushUndo();
    part.rotate = (((part.rotate ?? 0) + degrees) % 360 + 360) % 360;
    this.changed();
  }

  /** Rotate a selected group once around each component's own center. */
  rotateParts(ids: readonly string[], degrees = 90): void {
    const parts = ids.map((id) => this.findPart(id)).filter((part): part is DiagramPart => Boolean(part));
    if (parts.length === 0) return;
    this.pushUndo();
    for (const part of parts) {
      part.rotate = (((part.rotate ?? 0) + degrees) % 360 + 360) % 360;
    }
    this.changed();
  }

  /** Remove a part and every wire attached to it. */
  deletePart(id: string): void {
    if (!this.findPart(id)) return;
    this.pushUndo();
    this.diagram.parts = this.diagram.parts.filter((p) => p.id !== id);
    this.diagram.connections = this.diagram.connections.filter(
      ([from, to]) => !refBelongsTo(from, id) && !refBelongsTo(to, id),
    );
    this.removeOrphanWireJunctions();
    if (this.selectedId === id) this.select(null);
    this.changed();
  }

  /** Remove a selected group and all attached connections in one undo step. */
  deleteParts(ids: readonly string[]): void {
    const targets = new Set(ids.filter((id) => this.findPart(id)));
    if (targets.size === 0) return;
    this.pushUndo();
    this.diagram.parts = this.diagram.parts.filter((part) => !targets.has(part.id));
    this.diagram.connections = this.diagram.connections.filter(
      ([from, to]) =>
        ![from, to].some((ref) => {
          try {
            return targets.has(parsePinRef(ref).partId);
          } catch {
            return false;
          }
        }),
    );
    this.removeOrphanWireJunctions();
    if (this.selectedId && targets.has(this.selectedId)) this.select(null);
    this.changed();
  }

  duplicatePart(id: string): string | null {
    const part = this.findPart(id);
    if (!part) return null;
    this.pushUndo();
    const copy: DiagramPart = structuredClone(part);
    copy.id = makePartId(this.diagram, part.type);
    copy.left = (part.left ?? 0) + 20;
    copy.top = (part.top ?? 0) + 20;
    this.diagram.parts.push(copy);
    this.changed();
    this.select(copy.id);
    return copy.id;
  }

  setAttr(id: string, name: string, value: string): void {
    const part = this.findPart(id);
    if (!part) return;
    this.pushUndo();
    part.attrs = { ...(part.attrs ?? {}) };
    if (value === '') delete part.attrs[name];
    else part.attrs[name] = value;
    if (Object.keys(part.attrs).length === 0) delete part.attrs;
    this.changed();
  }

  // ---- wiring --------------------------------------------------------

  /**
   * Click a pin. The first click starts a wire, the second completes it.
   * Clicking the same pin twice cancels.
   */
  clickPin(partId: string, pin: string): void {
    if (!this.pendingPin) {
      this.pendingPin = { partId, pin };
      return;
    }
    if (this.pendingPin.partId === partId && this.pendingPin.pin === pin) {
      this.pendingPin = null;
      return;
    }
    const from = `${this.pendingPin.partId}:${this.pendingPin.pin}`;
    const to = `${partId}:${pin}`;
    this.pendingPin = null;
    this.connect(from, to);
  }

  cancelWire(): void {
    this.pendingPin = null;
  }

  /** Add a wire, rejecting duplicates and self-connections. */
  connect(from: string, to: string, color?: string, route: string[] = []): boolean {
    if (from === to) {
      this.events.onError?.('cannot wire a pin to itself');
      return false;
    }
    for (const ref of [from, to]) {
      const parsed = parsePinRef(ref);
      const part = this.findPart(parsed.partId);
      if (!part) {
        this.events.onError?.(`no part with id "${parsed.partId}"`);
        return false;
      }
      const pins = pinLookup(part.type);
      if (pins && !pins.includes(parsed.pin)) {
        this.events.onError?.(`${part.type} has no pin "${parsed.pin}"`);
        return false;
      }
    }
    if (this.hasConnection(from, to)) {
      this.events.onError?.('those pins are already connected');
      return false;
    }
    this.pushUndo();
    const wire: DiagramConnection = [from, to, color ?? defaultWireColor(from, to), route];
    this.diagram.connections.push(wire);
    this.changed();
    return true;
  }

  /** Split an existing wire and connect a pending pin at its new junction. */
  branchWireAt(
    index: number,
    source: { partId: string; pin: string },
    at: Point,
    splitRoutes: [string[], string[]],
    branchRoute: string[],
  ): boolean {
    const wire = this.diagram.connections[index];
    if (!wire) return false;
    const sourceRef = `${source.partId}:${source.pin}`;
    const sourcePart = this.findPart(source.partId);
    const sourcePins = sourcePart ? pinLookup(sourcePart.type) : null;
    if (!sourcePart || (sourcePins && !sourcePins.includes(source.pin))) {
      this.events.onError?.(`cannot branch from missing pin "${sourceRef}"`);
      return false;
    }
    try {
      for (const route of [...splitRoutes, branchRoute]) parseRoute(route);
    } catch (error) {
      this.events.onError?.((error as Error).message);
      return false;
    }

    const junctionId = makePartId(this.diagram, WIRE_JUNCTION_TYPE);
    const junctionRef = `${junctionId}:${WIRE_JUNCTION_PIN}`;
    const junctionPart: DiagramPart = {
      id: junctionId,
      type: WIRE_JUNCTION_TYPE,
      left: at.x - WIRE_JUNCTION_CENTER,
      top: at.y - WIRE_JUNCTION_CENTER,
    };
    const [from, to, color] = wire;
    this.pushUndo();
    this.pendingPin = null;
    this.diagram.parts.push(junctionPart);
    this.diagram.connections.splice(
      index,
      1,
      [from, junctionRef, color, [...splitRoutes[0]]],
      [junctionRef, to, color, [...splitRoutes[1]]],
      [sourceRef, junctionRef, defaultWireColor(sourceRef, junctionRef), [...branchRoute]],
    );
    this.changed();
    return true;
  }

  hasConnection(from: string, to: string): boolean {
    return this.diagram.connections.some(
      ([a, b]) => (a === from && b === to) || (a === to && b === from),
    );
  }

  disconnect(from: string, to: string): boolean {
    const before = this.diagram.connections.length;
    const filtered = this.diagram.connections.filter(
      ([a, b]) => !((a === from && b === to) || (a === to && b === from)),
    );
    if (filtered.length === before) return false;
    this.pushUndo();
    this.diagram.connections = filtered;
    this.removeOrphanWireJunctions();
    this.changed();
    return true;
  }

  deleteConnectionAt(index: number): boolean {
    if (index < 0 || index >= this.diagram.connections.length) return false;
    this.pushUndo();
    this.diagram.connections.splice(index, 1);
    this.removeOrphanWireJunctions();
    this.changed();
    return true;
  }

  /** Remove internal branch markers after their final wire is deleted. */
  private removeOrphanWireJunctions(): void {
    const connectedPartIds = new Set<string>();
    for (const [from, to] of this.diagram.connections) {
      for (const ref of [from, to]) {
        try {
          connectedPartIds.add(parsePinRef(ref).partId);
        } catch {
          // Malformed references are handled by diagram validation; they must
          // not keep an otherwise unused internal marker alive.
        }
      }
    }
    this.diagram.parts = this.diagram.parts.filter(
      (part) => part.type !== WIRE_JUNCTION_TYPE || connectedPartIds.has(part.id),
    );
  }

  setWireColor(index: number, color: string): void {
    const wire = this.diagram.connections[index];
    if (!wire) return;
    this.pushUndo();
    wire[2] = color;
    this.changed();
  }

  /**
   * Replace a wire's route instructions.
   *
   * The route is the only record of a wire's shape, so whoever reshapes it -
   * today, the canvas drag - hands the finished instructions here rather than
   * an offset this class would have to turn into geometry it cannot see.
   * Call this once per gesture: it records an undo step.
   */
  setWireRoute(index: number, route: string[]): void {
    const wire = this.diagram.connections[index];
    if (!wire) return;
    try {
      parseRoute(route);
    } catch (e) {
      this.events.onError?.((e as Error).message);
      return;
    }
    this.pushUndo();
    wire[3] = [...route];
    this.changed();
  }
}

function refBelongsTo(ref: string, partId: string): boolean {
  try {
    return parsePinRef(ref).partId === partId;
  } catch {
    return false;
  }
}
