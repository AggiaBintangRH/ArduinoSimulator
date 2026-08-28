/**
 * Ties a diagram, its parts, and the MCU into one runnable simulation.
 *
 * Wokwi supports a single microcontroller per project (docs/wokwi/01-core.md
 * section 7), and this follows that: exactly one board part becomes the clock
 * master, everything else is a peripheral driven by pin events.
 */

import type { Diagram, DiagramPart } from '../diagram/types.js';
import { parsePinRef } from '../diagram/parse.js';
import { ATmega328P, UNO_PINS } from '../mcu/atmega328p.js';
import { NetList, Pin } from './net.js';
import { Scheduler } from './scheduler.js';
import { PartRuntime, type Part, type PartEvent } from './part.js';
import { getPartDefinition } from './registry.js';

/** Diagram part types that are the microcontroller rather than a peripheral. */
export const BOARD_TYPES = new Set(['wokwi-arduino-uno', 'wokwi-arduino-nano']);

export interface SimulationProblem {
  severity: 'error' | 'warning';
  message: string;
  partId?: string;
}

export interface PartInstance {
  id: string;
  type: string;
  part: Part;
  runtime: PartRuntime;
}

export type PartEventListener = (partId: string, event: PartEvent) => void;

export class Simulation {
  readonly netlist = new NetList();
  readonly scheduler = new Scheduler();
  readonly problems: SimulationProblem[] = [];
  readonly parts = new Map<string, PartInstance>();

  board: ATmega328P | null = null;
  boardId: string | null = null;

  /** Serial bytes emitted by the sketch. */
  onSerialByte: ((byte: number) => void) | null = null;
  /** Visual state updates from parts. */
  onPartEvent: PartEventListener | null = null;
  /**
   * Most recent event from each part, including any emitted during init().
   *
   * Parts suppress duplicate events, so a listener attached after construction
   * would otherwise never learn the current state. The renderer seeds itself
   * from this map on attach.
   */
  readonly latestPartEvents = new Map<string, PartEvent>();
  /** Lines written to the parts console. */
  onPartLog: ((partId: string, message: string) => void) | null = null;
  /**
   * A problem raised while running, as opposed to while building.
   * Without this a run-time failure stops the simulation silently and the UI
   * goes on claiming it is running.
   */
  onProblem: ((problem: SimulationProblem) => void) | null = null;

  private pinsByPart = new Map<string, Map<string, Pin>>();
  private running = false;
  private rafHandle: ReturnType<typeof setTimeout> | null = null;
  private speedRatio = 1;
  private headroomRatio = 1;

  constructor(diagram: Diagram) {
    this.build(diagram);
  }

  private build(diagram: Diagram): void {
    const boards = diagram.parts.filter((p) => BOARD_TYPES.has(p.type));
    if (boards.length === 0) {
      this.problems.push({
        severity: 'error',
        message: 'diagram has no microcontroller (expected wokwi-arduino-uno or wokwi-arduino-nano)',
      });
    } else if (boards.length > 1) {
      this.problems.push({
        severity: 'error',
        message:
          'diagram has more than one microcontroller; only a single MCU per project is supported',
      });
    }

    const boardPart = boards[0];
    if (boardPart) this.createBoard(boardPart);

    for (const part of diagram.parts) {
      if (BOARD_TYPES.has(part.type)) continue;
      this.createPart(part);
    }

    this.wire(diagram);

    // Everything is connected now; force one propagation pass so parts that
    // sampled a floating net during init() see the real levels.
    this.netlist.invalidateAll();
    this.safeSettle();
  }

  private createBoard(part: DiagramPart): void {
    const frequency = part.attrs?.frequency;
    const frequencyHz = frequency ? parseFrequency(frequency) : 16_000_000;
    this.board = new ATmega328P(this.netlist, this.scheduler, {
      frequencyHz,
      pinNames: UNO_PINS,
    });
    this.boardId = part.id;
    this.board.onSerialByte = (b) => this.onSerialByte?.(b);

    const map = new Map<string, Pin>();
    for (const [name, pin] of this.board.pins) map.set(name, pin);
    this.pinsByPart.set(part.id, map);
  }

  private createPart(spec: DiagramPart): void {
    const def = getPartDefinition(spec.type);
    if (!def) {
      this.problems.push({
        severity: 'warning',
        partId: spec.id,
        message: `unknown part type ${JSON.stringify(spec.type)}; it will not be simulated`,
      });
      return;
    }

    const attrs = { ...(def.defaults ?? {}), ...(spec.attrs ?? {}) };
    const pinMap = new Map<string, Pin>();
    const runtime = new PartRuntime(
      spec.id,
      spec.type,
      attrs,
      this.scheduler,
      (pin) => {
        pinMap.set(pin.name, pin);
        this.netlist.isolate(pin);
      },
      (partId, event) => {
        this.latestPartEvents.set(partId, event);
        this.onPartEvent?.(partId, event);
      },
      (partId, message) => this.onPartLog?.(partId, message),
    );

    const part = def.create();
    try {
      part.init(runtime);
    } catch (e) {
      this.problems.push({
        severity: 'error',
        partId: spec.id,
        message: `part failed to initialise: ${(e as Error).message}`,
      });
      return;
    }

    this.pinsByPart.set(spec.id, pinMap);
    this.parts.set(spec.id, { id: spec.id, type: spec.type, part, runtime });
  }

  private wire(diagram: Diagram): void {
    for (const [from, to] of diagram.connections) {
      const a = this.resolvePin(from);
      const b = this.resolvePin(to);
      if (!a || !b) continue;
      this.netlist.connect(a, b);
    }
  }

  private resolvePin(ref: string): Pin | null {
    let parsed;
    try {
      parsed = parsePinRef(ref);
    } catch (e) {
      this.problems.push({ severity: 'error', message: (e as Error).message });
      return null;
    }
    const map = this.pinsByPart.get(parsed.partId);
    if (!map) {
      // An unsimulated part already produced a warning; skip quietly.
      return null;
    }
    const pin = map.get(parsed.pin);
    if (!pin) {
      this.problems.push({
        severity: 'error',
        partId: parsed.partId,
        message: `part ${JSON.stringify(parsed.partId)} has no pin ${JSON.stringify(parsed.pin)}`,
      });
      return null;
    }
    return pin;
  }

  /** Settle the net list, converting an oscillation into a reported problem. */
  private safeSettle(): void {
    try {
      this.netlist.settle();
    } catch (e) {
      this.raise({ severity: 'error', message: (e as Error).message });
    }
  }

  get hasErrors(): boolean {
    return this.problems.some((p) => p.severity === 'error');
  }

  loadHexFirmware(hex: string): void {
    if (!this.board) throw new Error('simulation has no microcontroller');
    this.board.loadHexFirmware(hex);
  }

  loadBinary(data: Uint8Array): void {
    if (!this.board) throw new Error('simulation has no microcontroller');
    this.board.loadBinary(data);
  }

  /** Send a control input to a part (button press, slider move, ...). */
  setControl(partId: string, control: string, value: number | string | boolean): void {
    const instance = this.parts.get(partId);
    if (!instance) throw new Error(`no part with id ${JSON.stringify(partId)}`);
    instance.part.control?.(control, value);
    this.safeSettle();
  }

  /** Push a byte into the sketch's serial input. */
  writeSerialByte(byte: number): void {
    this.board?.writeSerialByte(byte);
  }

  writeSerial(text: string): void {
    for (const byte of new TextEncoder().encode(text)) this.writeSerialByte(byte);
  }

  /** Advance the simulation by a fixed amount of simulated time. */
  runSimNanos(nanos: bigint): void {
    if (!this.board) {
      // Without an MCU the scheduler still drives part timers.
      this.scheduler.advance(nanos);
      this.safeSettle();
      return;
    }
    try {
      this.board.advanceNanos(nanos);
    } catch (e) {
      this.pause();
      this.raise({ severity: 'error', message: (e as Error).message });
    }
  }

  /** Record a problem and push it to any listener. */
  private raise(problem: SimulationProblem): void {
    this.problems.push(problem);
    this.onProblem?.(problem);
  }

  runSimMillis(ms: number): void {
    this.runSimNanos(BigInt(Math.round(ms * 1_000_000)));
  }

  get simNanos(): bigint {
    return this.scheduler.simNanos;
  }

  get simMillis(): number {
    return this.scheduler.simMillis;
  }

  /**
   * Achieved ratio of simulated time to wall-clock time. 1 = realtime.
   *
   * Measured across whole frames including the pacing delay, so a machine with
   * spare capacity reads ~1.0 rather than reporting its headroom.
   */
  get speed(): number {
    return this.speedRatio;
  }

  /**
   * How much faster than realtime this machine could run, if unpaced.
   * Useful for a "this diagram is too heavy" warning; >1 means spare capacity.
   */
  get headroom(): number {
    return this.headroomRatio;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Start free-running with real-time pacing.
   *
   * Each frame runs at most `frameMillis` of simulated time, then yields. If a
   * frame takes longer in wall time than it simulated, the simulation is
   * running slower than realtime and `speed` reports the shortfall rather than
   * trying to catch up (which would spiral on a slow machine).
   */
  start(frameMillis = 5): void {
    if (this.running) return;
    this.running = true;

    let lastWall = now();
    let lastSim = this.scheduler.simNanos;

    const tick = () => {
      if (!this.running) return;
      const wallStart = now();
      this.runSimMillis(frameMillis);
      const wallEnd = now();
      const busy = wallEnd - wallStart;

      // Headroom: how much sim time we produced per unit of busy time.
      if (busy > 0) {
        this.headroomRatio = frameMillis / busy;
      }

      // Achieved speed: sim time advanced against real elapsed time, measured
      // across the full frame (work + pacing delay) so a fast machine that is
      // deliberately sleeping reads as 1.0, not as its headroom.
      const wallDelta = wallEnd - lastWall;
      if (wallDelta >= 250) {
        const simDelta = Number(this.scheduler.simNanos - lastSim) / 1e6;
        this.speedRatio = simDelta / wallDelta;
        lastWall = wallEnd;
        lastSim = this.scheduler.simNanos;
      }

      // Yield to the host, leaving room for rendering.
      const delay = Math.max(0, frameMillis - busy);
      this.rafHandle = setTimeout(tick, delay);
    };
    this.rafHandle = setTimeout(tick, 0);
  }

  pause(): void {
    this.running = false;
    if (this.rafHandle !== null) {
      clearTimeout(this.rafHandle);
      this.rafHandle = null;
    }
  }

  stop(): void {
    this.pause();
  }

  dispose(): void {
    this.pause();
    for (const instance of this.parts.values()) {
      instance.part.dispose?.();
      instance.runtime.stopAllTimers();
    }
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Parse a frequency attribute like "16m", "8m", "1000000". */
export function parseFrequency(raw: string): number {
  const m = /^(-?\d*\.?\d+)\s*([kKmM])?$/.exec(raw.trim());
  if (!m) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 16_000_000;
  }
  const value = Number(m[1]);
  switch (m[2]?.toLowerCase()) {
    case 'k':
      return value * 1e3;
    case 'm':
      return value * 1e6;
    default:
      return value;
  }
}
