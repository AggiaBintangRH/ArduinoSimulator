/**
 * Test helpers: assemble AVR programs and observe board pins.
 *
 * The assembler ships inside avr8js but is not re-exported from its index, so
 * it is imported by path. That keeps test fixtures deterministic and removes
 * any dependency on an installed Arduino toolchain.
 */

import { assemble } from '../../node_modules/avr8js/dist/esm/utils/assembler.js';
import { ATmega328P } from '../../src/mcu/atmega328p.js';
import { NetList, Pin, PinMode, Edge, type DigitalValue } from '../../src/sim/net.js';
import { Scheduler } from '../../src/sim/scheduler.js';

export function asm(source: string): Uint8Array {
  const { bytes, errors } = assemble(source);
  if (errors.length) {
    throw new Error(`assembly failed:\n${errors.join('\n')}`);
  }
  return bytes;
}

export interface TestBoard {
  board: ATmega328P;
  netlist: NetList;
  scheduler: Scheduler;
}

export function makeBoard(source?: string, frequencyHz = 16_000_000): TestBoard {
  const netlist = new NetList();
  const scheduler = new Scheduler();
  const board = new ATmega328P(netlist, scheduler, { frequencyHz });
  if (source !== undefined) board.loadBinary(asm(source));
  return { board, netlist, scheduler };
}

export interface Transition {
  cycles: number;
  value: DigitalValue;
}

/**
 * Attach a probe to a board pin.
 *
 * The MCU already holds the single allowed watch on its own pins, so the probe
 * is a separate pin wired onto the same net - exactly how a real part observes
 * the board.
 */
export class Probe {
  readonly pin: Pin;
  readonly transitions: Transition[] = [];

  constructor(ctx: TestBoard, pinName: string) {
    this.pin = new Pin('__probe__', `probe_${pinName}`, PinMode.Input);
    ctx.netlist.connect(this.pin, ctx.board.pin(pinName));
    this.pin.watchPin(Edge.Both, (value) => {
      this.transitions.push({ cycles: ctx.board.cycles, value });
    });
  }

  get value(): DigitalValue {
    return this.pin.read();
  }

  /** Cycle gaps between consecutive transitions. */
  intervals(): number[] {
    const out: number[] = [];
    for (let i = 1; i < this.transitions.length; i++) {
      out.push(this.transitions[i].cycles - this.transitions[i - 1].cycles);
    }
    return out;
  }

  clear(): void {
    this.transitions.length = 0;
  }
}

/**
 * Drive a board pin from outside, as a switch or sensor would.
 *
 * Starts passive: an unconfigured driver must not hold the net LOW, or it would
 * silently defeat the MCU's internal pull-up before the test does anything.
 */
export class Driver {
  readonly pin: Pin;

  constructor(ctx: TestBoard, pinName: string, mode: PinMode = PinMode.Input) {
    this.pin = new Pin('__driver__', `drv_${pinName}`, mode);
    ctx.netlist.connect(this.pin, ctx.board.pin(pinName));
  }

  set(value: DigitalValue): void {
    this.pin.setMode(PinMode.Output);
    this.pin.write(value);
  }

  release(): void {
    this.pin.setMode(PinMode.Input);
  }

  setVoltage(volts: number | null): void {
    this.pin.setMode(PinMode.Analog);
    this.pin.dacWrite(volts);
  }
}
