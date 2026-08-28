/**
 * Part runtime API.
 *
 * Deliberately shaped like the Wokwi custom-chips C API (docs/wokwi/01-core.md
 * section 3) so that models port across almost mechanically:
 *
 *   pin_init/pin_mode/pin_read/pin_write/pin_watch   -> ctx.pinInit(...) etc.
 *   timer_init/timer_start/timer_stop                -> ctx.timerInit(...)
 *   attr_init/attr_read                              -> ctx.attr(...)
 *   get_sim_nanos()                                  -> ctx.simNanos
 */

import { Edge, Pin, PinMode, type DigitalValue, type PinChangeCallback } from './net.js';
import type { Scheduler } from './scheduler.js';

/** Visual/audible state a part pushes to the UI. Free-form per part type. */
export type PartEvent = Record<string, unknown>;

export interface PartContext {
  readonly id: string;
  readonly type: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly simNanos: bigint;
  readonly simMillis: number;

  /** Declare a pin. Call during `init()`, matching the Wokwi restriction. */
  pinInit(name: string, mode?: PinMode): Pin;
  pin(name: string): Pin;

  pinMode(name: string, mode: PinMode): void;
  pinRead(name: string): DigitalValue;
  pinWrite(name: string, value: DigitalValue): void;
  pinWatch(name: string, edge: Edge, callback: PinChangeCallback): boolean;
  pinWatchStop(name: string): void;

  adcRead(name: string): number;
  dacWrite(name: string, volts: number | null): void;
  /** True when nothing on the pin's net is driving it. */
  pinFloating(name: string): boolean;

  timerInit(callback: () => void): number;
  timerStart(timerId: number, micros: number, repeat?: boolean): void;
  timerStartNanos(timerId: number, nanos: bigint, repeat?: boolean): void;
  timerStop(timerId: number): void;

  /** Read an attribute as a string. */
  attr(name: string, fallback?: string): string;
  /** Read an attribute as a number, tolerating "10k"/"1.3m" suffixes. */
  attrNumber(name: string, fallback: number): number;
  attrBool(name: string): boolean;

  /** Push visual state to the UI layer. */
  emit(event: PartEvent): void;
  /** Log a line to the parts console (the Wokwi "Chips Console" equivalent). */
  log(message: string): void;
}

export interface Part {
  /** Wire up pins, timers and watches. Called once per instance. */
  init(ctx: PartContext): void;
  /** Called when the user changes an attribute while the sim is running. */
  attrChanged?(name: string, value: string): void;
  /** Interactive control from the UI (button press, slider, …). */
  control?(name: string, value: number | string | boolean): void;
  /** Release audio nodes, intervals, etc. */
  dispose?(): void;
}

export interface PartDefinition {
  /** The diagram.json `type` string, e.g. "wokwi-led". */
  type: string;
  /** Pin names exactly as they appear in diagram.json connections. */
  pins: readonly string[];
  /** Default attribute values. */
  defaults?: Readonly<Record<string, string>>;
  create(): Part;
}

/**
 * Parse the numeric formats that appear in Wokwi attributes:
 * plain numbers, hex ("0x27"), and k/m suffixes ("10k", "1.3m", "16m").
 */
export function parseAttrNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const s = raw.trim();
  if (s === '') return fallback;
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
  const m = /^(-?\d*\.?\d+)\s*([kKmM])?$/.exec(s);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  }
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return fallback;
  switch (m[2]?.toLowerCase()) {
    case 'k':
      return value * 1e3;
    case 'm':
      return value * 1e6;
    default:
      return value;
  }
}

/** Concrete PartContext bound to one part instance. */
export class PartRuntime implements PartContext {
  readonly id: string;
  readonly type: string;
  readonly attrs: Record<string, string>;

  private pins = new Map<string, Pin>();
  private timerIds: number[] = [];

  constructor(
    id: string,
    type: string,
    attrs: Record<string, string>,
    private scheduler: Scheduler,
    private onPinCreated: (pin: Pin) => void,
    private onEvent: (partId: string, event: PartEvent) => void,
    private onLog: (partId: string, message: string) => void,
  ) {
    this.id = id;
    this.type = type;
    this.attrs = attrs;
  }

  get simNanos(): bigint {
    return this.scheduler.simNanos;
  }

  get simMillis(): number {
    return this.scheduler.simMillis;
  }

  pinInit(name: string, mode: PinMode = PinMode.Input): Pin {
    const existing = this.pins.get(name);
    if (existing) {
      existing.setMode(mode);
      return existing;
    }
    const pin = new Pin(this.id, name, mode);
    this.pins.set(name, pin);
    this.onPinCreated(pin);
    return pin;
  }

  pin(name: string): Pin {
    const pin = this.pins.get(name);
    if (!pin) throw new Error(`part ${this.id} has no pin ${JSON.stringify(name)}`);
    return pin;
  }

  /** Pins created so far, for the netlist builder. */
  declaredPins(): Pin[] {
    return [...this.pins.values()];
  }

  pinMode(name: string, mode: PinMode): void {
    this.pin(name).setMode(mode);
  }

  pinRead(name: string): DigitalValue {
    return this.pin(name).read();
  }

  pinWrite(name: string, value: DigitalValue): void {
    this.pin(name).write(value);
  }

  pinWatch(name: string, edge: Edge, callback: PinChangeCallback): boolean {
    return this.pin(name).watchPin(edge, callback);
  }

  pinWatchStop(name: string): void {
    this.pin(name).watchStop();
  }

  adcRead(name: string): number {
    return this.pin(name).adcRead();
  }

  dacWrite(name: string, volts: number | null): void {
    this.pin(name).dacWrite(volts);
  }

  pinFloating(name: string): boolean {
    return this.pin(name).net?.floating ?? true;
  }

  timerInit(callback: () => void): number {
    const id = this.scheduler.timerInit({ callback });
    this.timerIds.push(id);
    return id;
  }

  timerStart(timerId: number, micros: number, repeat = false): void {
    this.scheduler.timerStart(timerId, micros, repeat);
  }

  timerStartNanos(timerId: number, nanos: bigint, repeat = false): void {
    this.scheduler.timerStartNanos(timerId, nanos, repeat);
  }

  timerStop(timerId: number): void {
    this.scheduler.timerStop(timerId);
  }

  attr(name: string, fallback = ''): string {
    const v = this.attrs[name];
    return v === undefined || v === '' ? fallback : v;
  }

  attrNumber(name: string, fallback: number): number {
    return parseAttrNumber(this.attrs[name], fallback);
  }

  attrBool(name: string): boolean {
    const v = this.attrs[name];
    return v === '1' || v === 'true';
  }

  emit(event: PartEvent): void {
    this.onEvent(this.id, event);
  }

  log(message: string): void {
    this.onLog(this.id, message);
  }

  stopAllTimers(): void {
    for (const id of this.timerIds) this.scheduler.timerStop(id);
    this.timerIds = [];
  }
}
