/**
 * ATmega328P board (Arduino Uno / Nano).
 *
 * The runtime itself is board-agnostic and lives in `avr-board.ts`; this is the
 * Uno-shaped entry point, kept because it is the board most code and tests
 * reach for by name.
 */

import { AvrBoard, type AvrBoardOptions } from './avr-board.js';
import { ARDUINO_UNO, UNO_PINS } from './boards.js';
import type { NetList } from '../sim/net.js';
import type { Scheduler } from '../sim/scheduler.js';

export { UNO_PINS };
export type ATmega328POptions = AvrBoardOptions;

export const FLASH_BYTES = ARDUINO_UNO.chip.flashBytes;
export const SRAM_BYTES = ARDUINO_UNO.chip.sramBytes;
export const DEFAULT_FREQUENCY = ARDUINO_UNO.defaultFrequencyHz;

/** Digital pins that the timers can drive in PWM mode on the Uno. */
export const PWM_PINS = ARDUINO_UNO.pwmPins;

export class ATmega328P extends AvrBoard {
  constructor(netlist: NetList, scheduler: Scheduler, options: ATmega328POptions = {}) {
    super(ARDUINO_UNO, netlist, scheduler, options);
  }

  /** Kept for callers that reach for the ports by their AVR letter. */
  get portB() {
    return this.ports.get('B')!;
  }
  get portC() {
    return this.ports.get('C')!;
  }
  get portD() {
    return this.ports.get('D')!;
  }
  get timer0() {
    return this.timers[0];
  }
  get timer1() {
    return this.timers[1];
  }
  get timer2() {
    return this.timers[2];
  }
}
