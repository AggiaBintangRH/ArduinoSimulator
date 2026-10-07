/**
 * Catalog of the boards a diagram may use as its microcontroller.
 *
 * A chip (`avr-chip.ts`) says what the silicon is. A board says how that
 * silicon is wired to the headers a diagram connects to: which port bit is
 * "D13", which ADC channel is "A7", what the toolchain calls it.
 *
 * Pin names follow Wokwi's `diagram.json` conventions so projects stay
 * interchangeable: digital pins are bare numbers, analog pins are `A<n>`, and
 * repeated power pins are suffixed (`GND.1`, `GND.2`, ...).
 */

import { ATMEGA328P, ATMEGA2560, type AvrChip } from './avr-chip.js';

/** Port letter -> port bit -> board pin name. */
export type GpioMap = Record<string, Record<number, string>>;

export interface BoardDefinition {
  /** `diagram.json` part type. */
  readonly type: string;
  readonly label: string;
  readonly chip: AvrChip;
  /** Fully-qualified board name for `arduino-cli`. */
  readonly fqbn: string;
  readonly defaultFrequencyHz: number;
  /** Every header pin, in the order the part exposes them. */
  readonly pins: readonly string[];
  readonly gpio: GpioMap;
  /** ADC channel index -> board pin name. */
  readonly adcChannels: Record<number, string>;
  /**
   * Header pins that are the same copper as another pin, e.g. the Mega's
   * dedicated SCL/SDA pads next to AREF are D21/D20 brought out twice. Both
   * names exist as pins and are tied into one net.
   */
  readonly aliases?: Readonly<Record<string, string>>;
  /** Pins a timer can drive with `analogWrite`. Informational. */
  readonly pwmPins: readonly string[];
  /** Pin wired to the on-board LED. */
  readonly builtinLed: string;
}

/**
 * Power rails, keyed by the pin name with any `.n` duplicate suffix removed.
 * The value is the level the rail is held at, or null for a reference pin that
 * drives nothing.
 *
 * These are real drivers: a button wired to GND only pulls its net low because
 * GND is actually held low, so leaving them floating would silently break
 * every switch and pull-down in a diagram.
 */
export const POWER_RAILS: Record<string, 'high' | 'low' | null> = {
  GND: 'low',
  '5V': 'high',
  '3.3V': 'high',
  VIN: 'high',
  IOREF: 'high',
  // AREF is a reference input, not a supply.
  AREF: null,
};

/** Strip the `.1`/`.2` suffix a board uses for repeated pins. */
export function basePinName(name: string): string {
  return name.replace(/\.\d+$/, '');
}

export function isPowerPin(name: string): boolean {
  return basePinName(name) in POWER_RAILS;
}

// ---------------------------------------------------------------------------
// Arduino Uno
// ---------------------------------------------------------------------------

export const UNO_PINS: readonly string[] = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5',
  'VIN', '5V', '3.3V', 'GND.1', 'GND.2', 'GND.3', 'RESET', 'AREF',
];

const UNO_GPIO: GpioMap = {
  D: { 0: '0', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7' },
  B: { 0: '8', 1: '9', 2: '10', 3: '11', 4: '12', 5: '13' },
  C: { 0: 'A0', 1: 'A1', 2: 'A2', 3: 'A3', 4: 'A4', 5: 'A5' },
};

const UNO_ADC: Record<number, string> = {
  0: 'A0', 1: 'A1', 2: 'A2', 3: 'A3', 4: 'A4', 5: 'A5',
};

export const ARDUINO_UNO: BoardDefinition = {
  type: 'wokwi-arduino-uno',
  label: 'Arduino Uno',
  chip: ATMEGA328P,
  fqbn: 'arduino:avr:uno',
  defaultFrequencyHz: 16_000_000,
  pins: UNO_PINS,
  gpio: UNO_GPIO,
  adcChannels: UNO_ADC,
  pwmPins: ['3', '5', '6', '9', '10', '11'],
  builtinLed: '13',
};

// ---------------------------------------------------------------------------
// Arduino Mega 2560
// ---------------------------------------------------------------------------

const MEGA_ANALOG = Array.from({ length: 16 }, (_, i) => `A${i}`);

/**
 * Header pins in the order Wokwi's `wokwi-arduino-mega` element declares them.
 *
 * The names come from upstream verbatim, duplicates and all, because a
 * `diagram.json` written on Wokwi refers to pins by these exact strings:
 * `GND.1` is the ground beside AREF, `GND.2`/`GND.3` are on the power header,
 * `GND.4`/`GND.5` close the digital header, plain `5V` is on the power header
 * while `5V.1`/`5V.2` open the digital header, and `SCL`/`SDA` are the
 * dedicated I2C pads that repeat D21/D20.
 */
export const MEGA_PINS: readonly string[] = [
  // Top edge, left to right.
  'SCL', 'SDA', 'AREF', 'GND.1',
  '13', '12', '11', '10', '9', '8',
  '7', '6', '5', '4', '3', '2', '1', '0',
  '14', '15', '16', '17', '18', '19', '20', '21',
  // The 2x18 digital header down the right edge.
  '5V.1', '5V.2',
  ...Array.from({ length: 32 }, (_, i) => String(22 + i)),
  'GND.4', 'GND.5',
  // Bottom edge: power header then the two analog banks.
  'IOREF', 'RESET', '3.3V', '5V', 'GND.2', 'GND.3', 'VIN',
  ...MEGA_ANALOG,
];

/** SCL/SDA are D21/D20 brought out a second time, not extra port bits. */
const MEGA_ALIASES = { SCL: '21', SDA: '20' } as const;

/**
 * Port bit -> header pin, from the Mega 2560 schematic. Gaps are deliberate:
 * PD4-PD6, PE2, PE6-PE7, PG3-PG4 and PH2/PH7 have no header pin.
 */
const MEGA_GPIO: GpioMap = {
  A: { 0: '22', 1: '23', 2: '24', 3: '25', 4: '26', 5: '27', 6: '28', 7: '29' },
  B: { 0: '53', 1: '52', 2: '51', 3: '50', 4: '10', 5: '11', 6: '12', 7: '13' },
  C: { 0: '37', 1: '36', 2: '35', 3: '34', 4: '33', 5: '32', 6: '31', 7: '30' },
  D: { 0: '21', 1: '20', 2: '19', 3: '18', 7: '38' },
  E: { 0: '0', 1: '1', 3: '5', 4: '2', 5: '3' },
  F: { 0: 'A0', 1: 'A1', 2: 'A2', 3: 'A3', 4: 'A4', 5: 'A5', 6: 'A6', 7: 'A7' },
  G: { 0: '41', 1: '40', 2: '39', 5: '4' },
  H: { 0: '17', 1: '16', 3: '6', 4: '7', 5: '8', 6: '9' },
  J: { 0: '15', 1: '14' },
  K: { 0: 'A8', 1: 'A9', 2: 'A10', 3: 'A11', 4: 'A12', 5: 'A13', 6: 'A14', 7: 'A15' },
  L: { 0: '49', 1: '48', 2: '47', 3: '46', 4: '45', 5: '44', 6: '43', 7: '42' },
};

const MEGA_ADC: Record<number, string> = Object.fromEntries(
  MEGA_ANALOG.map((name, channel) => [channel, name]),
);

export const ARDUINO_MEGA: BoardDefinition = {
  type: 'wokwi-arduino-mega',
  label: 'Arduino Mega 2560',
  chip: ATMEGA2560,
  fqbn: 'arduino:avr:mega',
  defaultFrequencyHz: 16_000_000,
  pins: MEGA_PINS,
  gpio: MEGA_GPIO,
  aliases: MEGA_ALIASES,
  adcChannels: MEGA_ADC,
  // Timers 0-5, compare outputs A/B/C. 44-46 are timer 5.
  pwmPins: ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '44', '45', '46'],
  builtinLed: '13',
};

// ---------------------------------------------------------------------------

const BOARDS: readonly BoardDefinition[] = [ARDUINO_UNO, ARDUINO_MEGA];

const BY_TYPE = new Map(BOARDS.map((b) => [b.type, b]));

/** Diagram part types that are the microcontroller rather than a peripheral. */
export const BOARD_TYPES: ReadonlySet<string> = new Set(BY_TYPE.keys());

export function getBoardDefinition(type: string): BoardDefinition | undefined {
  return BY_TYPE.get(type);
}

export function boardDefinitions(): readonly BoardDefinition[] {
  return BOARDS;
}

/**
 * The board a diagram uses, or null if it has none. The first board wins;
 * a diagram with several is an error the simulation reports separately.
 */
export function findBoard(parts: readonly { type: string }[]): BoardDefinition | null {
  for (const part of parts) {
    const board = BY_TYPE.get(part.type);
    if (board) return board;
  }
  return null;
}

/** Header pin names for a board type, or null if it is not a board. */
export function boardPins(type: string): readonly string[] | null {
  return BY_TYPE.get(type)?.pins ?? null;
}
