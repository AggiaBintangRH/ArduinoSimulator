/**
 * ATmega2560 / Arduino Mega 2560.
 *
 * The register map for this chip is written by hand (src/mcu/avr-chip.ts), so
 * these tests exist to catch a wrong address or interrupt vector - the kind of
 * mistake that makes a sketch look like it runs while doing nothing.
 *
 * I/O-space addresses are data-space minus 0x20. Anything at or above 0x60
 * (ports H/J/K/L, timers 1 and 3-5, USARTs, ADC) is extended I/O and can only
 * be reached with LDS/STS.
 *   PINA 0x00  DDRA 0x01  PORTA 0x02
 *   PINB 0x03  DDRB 0x04  PORTB 0x05
 */

import { describe, it, expect } from 'vitest';
import '../src/parts/index.js';
import { makeBoard, Probe, Driver, asm } from './helpers/board.js';
import { Simulation } from '../src/sim/simulation.js';
import { ARDUINO_MEGA } from '../src/mcu/boards.js';
import { getVisual } from '../src/render/shapes.js';
import {
  MEGA_PIN_LAYOUT,
  MEGA_END_HEADER_COLUMNS,
} from '../src/render/boards/arduino-mega-art.js';

const onEndHeader = (x: number) =>
  x === MEGA_END_HEADER_COLUMNS.left || x === MEGA_END_HEADER_COLUMNS.right;

/** Monospace advance is about 0.6em; the silkscreen is set at 11px. */
const LABEL_ADVANCE = 6.6;
import { HIGH, LOW, PinMode } from '../src/sim/net.js';

function mega(source?: string) {
  return makeBoard(source, 16_000_000, ARDUINO_MEGA);
}

/**
 * Build a program whose interrupt vector at `vector` (a word address, matching
 * the datasheet's vector table) jumps to the `isr` label. The Mega's table
 * uses 2-word JMP entries, so the padding is measured in words.
 */
function withVector(vector: number, body: string): string {
  const padding = Array.from({ length: vector - 2 }, () => 'nop').join('\n');
  return `
    jmp start
    ${padding}
    jmp isr
    ${body}
  `;
}

describe('ATmega2560 chip shape', () => {
  it('has 256K of flash and a 22-bit program counter', () => {
    const { board } = mega();
    expect(board.flashBytes).toBe(256 * 1024);
    expect(board.cpu.pc22Bits).toBe(true);
  });

  it('reserves data space up to the top of SRAM', () => {
    const { board } = mega();
    // SRAM ends at 0x21FF; the stack pointer resets to the last usable byte.
    expect(board.cpu.data.length).toBe(0x2200);
    expect(board.cpu.dataView.getUint16(93, true)).toBe(0x21ff);
  });

  it('exposes all 54 digital and 16 analog header pins', () => {
    const { board } = mega();
    for (let i = 0; i <= 53; i++) expect(board.hasPin(String(i))).toBe(true);
    for (let i = 0; i <= 15; i++) expect(board.hasPin(`A${i}`)).toBe(true);
    expect(board.hasPin('54')).toBe(false);
  });

  it('holds every power rail at its level', () => {
    const { board } = mega();
    for (const name of ['5V', '5V.1', '5V.2', '3.3V', 'VIN', 'IOREF']) {
      expect([name, board.pin(name).read()]).toEqual([name, HIGH]);
    }
    for (const name of ['GND.1', 'GND.2', 'GND.3', 'GND.4', 'GND.5']) {
      expect([name, board.pin(name).read()]).toEqual([name, LOW]);
    }
  });

  it('names its pins exactly as the Wokwi element does', () => {
    // A diagram.json written on Wokwi refers to pins by these strings, so a
    // rename here silently breaks every imported project.
    const { board } = mega();
    for (const name of ['SCL', 'SDA', 'AREF', 'GND.1', '5V', '5V.1', '5V.2', 'IOREF']) {
      expect([name, board.hasPin(name)]).toEqual([name, true]);
    }
    expect(board.hasPin('3V3')).toBe(false);
    expect(board.hasPin('GND')).toBe(false);
  });

  it('ties the dedicated SCL/SDA pads to D21/D20', () => {
    const ctx = mega(`
      ldi r16, 0x03
      out 0x0a, r16   ; DDRD bits 0,1 = output (D21/SCL, D20/SDA)
      ldi r16, 0x01
      out 0x0b, r16   ; PORTD bit0 = 1 -> D21 high, D20 low
    halt:
      rjmp halt
    `);
    const scl = new Probe(ctx, 'SCL');
    const sda = new Probe(ctx, 'SDA');
    ctx.board.advanceMillis(1);
    expect(scl.value).toBe(HIGH);
    expect(sda.value).toBe(LOW);
  });
});

describe('ATmega2560 digital I/O', () => {
  it('drives D13 from PORTB bit 7', () => {
    const ctx = mega(`
      ldi r16, 0x80
      out 0x04, r16   ; DDRB bit7 = output
      out 0x05, r16   ; PORTB bit7 = 1
    halt:
      rjmp halt
    `);
    const probe = new Probe(ctx, '13');
    ctx.board.advanceMillis(1);
    expect(probe.value).toBe(HIGH);
  });

  it('drives D22 from PORTA, a port the Uno does not have', () => {
    const ctx = mega(`
      ldi r16, 0x01
      out 0x01, r16   ; DDRA bit0 = output
      out 0x02, r16   ; PORTA bit0 = 1
    halt:
      rjmp halt
    `);
    const probe = new Probe(ctx, '22');
    ctx.board.advanceMillis(1);
    expect(probe.value).toBe(HIGH);
  });

  it('drives D49 through the extended-I/O PORTL', () => {
    const ctx = mega(`
      ldi r16, 0x01
      sts 0x10a, r16  ; DDRL bit0 = output
      sts 0x10b, r16  ; PORTL bit0 = 1
    halt:
      rjmp halt
    `);
    const probe = new Probe(ctx, '49');
    ctx.board.advanceMillis(1);
    expect(probe.value).toBe(HIGH);
  });

  it('drives D9 through the extended-I/O PORTH', () => {
    const ctx = mega(`
      ldi r16, 0x40
      sts 0x101, r16  ; DDRH bit6 = output
      sts 0x102, r16  ; PORTH bit6 = 1
    halt:
      rjmp halt
    `);
    const probe = new Probe(ctx, '9');
    ctx.board.advanceMillis(1);
    expect(probe.value).toBe(HIGH);
  });

  it('enables the internal pull-up on D22', () => {
    const ctx = mega(`
      ldi r16, 0x00
      out 0x01, r16   ; DDRA = input
      ldi r16, 0x01
      out 0x02, r16   ; PORTA bit0 = 1 -> pull-up
    halt:
      rjmp halt
    `);
    ctx.board.advanceMillis(1);
    expect(ctx.board.pin('22').mode).toBe(PinMode.InputPullup);
    expect(ctx.board.pin('22').read()).toBe(HIGH);
  });

  it('mirrors an outside level into the PIN register', () => {
    const ctx = mega(`
    halt:
      rjmp halt
    `);
    const driver = new Driver(ctx, '23'); // PA1
    driver.set(HIGH);
    ctx.board.advanceMillis(1);
    expect(ctx.board.cpu.data[0x20] & 0x02).toBe(0x02);
    driver.set(LOW);
    ctx.board.advanceMillis(1);
    expect(ctx.board.cpu.data[0x20] & 0x02).toBe(0);
  });
});

describe('ATmega2560 timers', () => {
  it('drives PWM on D11 from timer 1', () => {
    const ctx = mega(`
      ldi r16, 0x20
      out 0x04, r16   ; DDRB bit5 = output (OC1A -> D11)
      ldi r16, 0x81
      sts 0x80, r16   ; TCCR1A = COM1A1 | WGM10  (fast PWM, 8-bit)
      ldi r16, 0x09
      sts 0x81, r16   ; TCCR1B = WGM12 | CS10    (no prescaler)
      ldi r16, 0x00
      sts 0x89, r16   ; OCR1AH
      ldi r16, 0x40
      sts 0x88, r16   ; OCR1AL = 64 -> 25% duty
    halt:
      rjmp halt
    `);
    const probe = new Probe(ctx, '11');
    ctx.board.advanceMillis(0.2);
    // Fast PWM 8-bit at /1: one period is 256 cycles, high for OCR1A of them.
    const intervals = probe.intervals().slice(2, 8);
    expect(intervals.length).toBeGreaterThan(3);
    for (let i = 0; i < intervals.length; i++) {
      expect([64, 192]).toContain(intervals[i]);
    }
  });

  it('drives PWM on D46 from timer 5, whose registers only exist here', () => {
    const ctx = mega(`
      ldi r16, 0x08
      sts 0x10a, r16  ; DDRL bit3 = output (OC5A -> D46)
      ldi r16, 0x81
      sts 0x120, r16  ; TCCR5A = COM5A1 | WGM50
      ldi r16, 0x09
      sts 0x121, r16  ; TCCR5B = WGM52 | CS50
      ldi r16, 0x00
      sts 0x129, r16  ; OCR5AH
      ldi r16, 0x80
      sts 0x128, r16  ; OCR5AL = 128 -> 50% duty
    halt:
      rjmp halt
    `);
    const probe = new Probe(ctx, '46');
    ctx.board.advanceMillis(0.2);
    const intervals = probe.intervals().slice(2, 8);
    expect(intervals.length).toBeGreaterThan(3);
    for (const gap of intervals) expect(gap).toBe(128);
  });

  it('runs the timer 0 overflow interrupt from its vector', () => {
    const ctx = mega(
      withVector(
        0x2e,
        `
    isr:
      inc r20
      out 0x02, r20   ; PORTA = counter, so D22 toggles every overflow
      reti
    start:
      ldi r16, 0xff
      out 0x01, r16   ; DDRA = all outputs
      ldi r16, 0x01
      out 0x25, r16   ; TCCR0B = CS00 (no prescaler)
      ldi r16, 0x01
      sts 0x6e, r16   ; TIMSK0 = TOIE0
      sei
    halt:
      rjmp halt
        `,
      ),
    );
    const probe = new Probe(ctx, '22');
    ctx.board.advanceMillis(0.5);
    const intervals = probe.intervals().slice(1, 6);
    expect(intervals.length).toBeGreaterThan(3);
    // Timer 0 is 8-bit and unprescaled: an overflow every 256 cycles.
    for (const gap of intervals) expect(gap).toBe(256);
  });
});

describe('ATmega2560 ADC', () => {
  it('reads A0 through the plain mux channels', () => {
    const ctx = mega(`
      ldi r16, 0x40
      sts 0x7c, r16   ; ADMUX = AVCC reference, channel 0
      ldi r16, 0xc7
      sts 0x7a, r16   ; ADCSRA = ADEN | ADSC | /128
    halt:
      rjmp halt
    `);
    new Driver(ctx, 'A0').setVoltage(2.5);
    ctx.board.advanceMillis(1);
    const value = ctx.board.cpu.data[0x78] | (ctx.board.cpu.data[0x79] << 8);
    expect(value).toBeGreaterThan(500);
    expect(value).toBeLessThan(524);
  });

  it('reads A8, which needs the MUX5 bit in ADCSRB', () => {
    const ctx = mega(`
      ldi r16, 0x40
      sts 0x7c, r16   ; ADMUX = AVCC reference, MUX[4:0] = 0
      ldi r16, 0x08
      sts 0x7b, r16   ; ADCSRB MUX5 = 1 -> channel 8 (A8)
      ldi r16, 0xc7
      sts 0x7a, r16   ; ADCSRA = ADEN | ADSC | /128
    halt:
      rjmp halt
    `);
    // A0 is left at a different voltage so a mux mix-up cannot pass by luck.
    new Driver(ctx, 'A0').setVoltage(0);
    new Driver(ctx, 'A8').setVoltage(1.25);
    ctx.board.advanceMillis(1);
    const value = ctx.board.cpu.data[0x78] | (ctx.board.cpu.data[0x79] << 8);
    expect(value).toBeGreaterThan(245);
    expect(value).toBeLessThan(269);
  });
});

describe('ATmega2560 USARTs', () => {
  it('transmits on USART0, which the serial monitor listens to', () => {
    const ctx = mega(`
      ldi r16, 0x08
      sts 0xc1, r16   ; UCSR0B = TXEN0
      ldi r16, 0x41
      sts 0xc6, r16   ; UDR0 = 'A'
    halt:
      rjmp halt
    `);
    const bytes: number[] = [];
    ctx.board.onSerialByte = (b) => bytes.push(b);
    ctx.board.advanceMillis(1);
    expect(bytes).toEqual([0x41]);
  });

  it('transmits on USART1, the Mega-only Serial1', () => {
    const ctx = mega(`
      ldi r16, 0x08
      sts 0xc9, r16   ; UCSR1B = TXEN1
      ldi r16, 0x42
      sts 0xce, r16   ; UDR1 = 'B'
    halt:
      rjmp halt
    `);
    const bytes: number[] = [];
    ctx.board.usarts[1].onByteTransmit = (b) => bytes.push(b);
    // USART0 must stay quiet, or the ports are aliased.
    const serial0: number[] = [];
    ctx.board.onSerialByte = (b) => serial0.push(b);
    ctx.board.advanceMillis(1);
    expect(bytes).toEqual([0x42]);
    expect(serial0).toEqual([]);
  });

  it('offers four USARTs', () => {
    const { board } = mega();
    expect(board.usarts).toHaveLength(4);
  });
});

describe('a Mega diagram', () => {
  it('builds, runs firmware and lights an LED on D22', () => {
    const sim = new Simulation({
      version: 1,
      parts: [
        { id: 'mega', type: 'wokwi-arduino-mega' },
        { id: 'led1', type: 'wokwi-led', attrs: { color: 'red' } },
      ],
      connections: [
        ['mega:22', 'led1:A', 'green', []],
        ['led1:C', 'mega:GND.4', 'black', []],
      ],
    });
    expect(sim.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(sim.boardType).toBe('wokwi-arduino-mega');
    expect(sim.fqbn).toBe('arduino:avr:mega');

    const latest = new Map<string, Record<string, unknown>>();
    sim.onPartEvent = (id, event) => latest.set(id, event as Record<string, unknown>);
    sim.loadBinary(
      asm(`
      ldi r16, 0x01
      out 0x01, r16   ; DDRA bit0 = output
      out 0x02, r16   ; PORTA bit0 = 1
    halt:
      rjmp halt
    `),
    );
    sim.runSimMillis(50);
    expect(latest.get('led1')?.on).toBe(true);
    sim.dispose();
  });

  it('rejects a diagram that mixes two microcontrollers', () => {
    const sim = new Simulation({
      version: 1,
      parts: [
        { id: 'mega', type: 'wokwi-arduino-mega' },
        { id: 'uno', type: 'wokwi-arduino-uno' },
      ],
      connections: [],
    });
    expect(sim.problems.some((p) => /more than one microcontroller/.test(p.message))).toBe(true);
    sim.dispose();
  });

  it('takes its clock from the frequency attribute', () => {
    const sim = new Simulation({
      version: 1,
      parts: [{ id: 'mega', type: 'wokwi-arduino-mega', attrs: { frequency: '8m' } }],
      connections: [],
    });
    expect(sim.board?.frequencyHz).toBe(8_000_000);
    sim.dispose();
  });
});

describe('the reset button', () => {
  /** Drive D22 high and stop, so the pin shows whether setup ran. */
  const DRIVE_D22 = `
    ldi r16, 0x01
    out 0x01, r16   ; DDRA bit0 = output
    out 0x02, r16   ; PORTA bit0 = 1
  halt:
    rjmp halt
  `;

  it('releases the pins while it is held down', () => {
    const ctx = mega(DRIVE_D22);
    ctx.board.advanceMillis(1);
    expect(ctx.board.pin('22').read()).toBe(HIGH);

    ctx.board.setResetHeld(true);
    expect(ctx.board.inReset).toBe(true);
    expect(ctx.board.pin('22').mode).toBe(PinMode.Input);
  });

  it('runs the firmware again from the top when released', () => {
    const ctx = mega(DRIVE_D22);
    ctx.board.advanceMillis(1);

    ctx.board.setResetHeld(true);
    ctx.board.advanceMillis(1);
    expect(ctx.board.pin('22').read()).not.toBe(HIGH);

    ctx.board.setResetHeld(false);
    ctx.board.advanceMillis(1);
    expect(ctx.board.pin('22').read()).toBe(HIGH);
  });

  it('stops the CPU but not the clock while held', () => {
    const ctx = mega(`
      ldi r16, 0xff
      out 0x01, r16   ; DDRA = outputs
    loop:
      inc r20
      out 0x02, r20   ; D22 toggles as fast as the CPU can go
      rjmp loop
    `);
    const probe = new Probe(ctx, '22');
    ctx.board.advanceMillis(0.1);
    expect(probe.transitions.length).toBeGreaterThan(10);

    ctx.board.setResetHeld(true);
    probe.clear();
    const cyclesBefore = ctx.board.cycles;
    const timeBefore = ctx.scheduler.simNanos;
    ctx.board.advanceMillis(1);

    expect(probe.transitions).toEqual([]);
    // The clock is the MCU's, so it has to keep advancing or the whole
    // simulation - part timers included - would stall while reset is held.
    expect(ctx.scheduler.simNanos).toBeGreaterThan(timeBefore);
    expect(ctx.board.cycles).toBeGreaterThan(cyclesBefore);
  });

  it('leaves timers counting at the right rate afterwards', () => {
    // A reset rewinds each timer's internal cycle mark, so this checks the
    // timer picks its rate back up rather than racing or stalling. (avr8js
    // re-bases the mark itself when the prescaler is next read; this test
    // exists to notice if that ever stops being true.)
    const ctx = mega(
      withVector(
        0x2e,
        `
    isr:
      inc r20
      out 0x02, r20
      reti
    start:
      ldi r16, 0xff
      out 0x01, r16
      ldi r16, 0x01
      out 0x25, r16   ; TCCR0B = CS00
      ldi r16, 0x01
      sts 0x6e, r16   ; TIMSK0 = TOIE0
      sei
    halt:
      rjmp halt
        `,
      ),
    );
    const probe = new Probe(ctx, '22');
    ctx.board.advanceMillis(2);

    ctx.board.setResetHeld(true);
    ctx.board.advanceMillis(0.1);
    ctx.board.setResetHeld(false);

    probe.clear();
    ctx.board.advanceMillis(0.5);
    const intervals = probe.intervals().slice(1, 6);
    expect(intervals.length).toBeGreaterThan(3);
    for (const gap of intervals) expect(gap).toBe(256);
  });

  it('still sees a level the outside world holds across the reset', () => {
    // Clearing the register file wipes the PIN registers too, so a button
    // held down while the user taps reset must be re-read, not forgotten.
    const ctx = mega(`
    halt:
      rjmp halt
    `);
    const driver = new Driver(ctx, '23'); // PA1
    driver.set(HIGH);
    ctx.board.advanceMillis(1);
    expect(ctx.board.cpu.data[0x20] & 0x02).toBe(0x02);

    ctx.board.setResetHeld(true);
    ctx.board.setResetHeld(false);
    expect(ctx.board.cpu.data[0x20] & 0x02).toBe(0x02);
  });

  it('is reachable through the simulation as a board control', () => {
    const sim = new Simulation({
      version: 1,
      parts: [
        { id: 'mega', type: 'wokwi-arduino-mega' },
        { id: 'led1', type: 'wokwi-led', attrs: { color: 'red' } },
      ],
      connections: [
        ['mega:22', 'led1:A', 'green', []],
        ['led1:C', 'mega:GND.4', 'black', []],
      ],
    });
    const latest = new Map<string, Record<string, unknown>>();
    sim.onPartEvent = (id, event) => latest.set(id, event as Record<string, unknown>);
    sim.loadBinary(asm(DRIVE_D22));
    sim.runSimMillis(50);
    expect(latest.get('led1')?.on).toBe(true);

    sim.setControl('mega', 'reset', true);
    sim.runSimMillis(50);
    expect(latest.get('led1')?.on).toBe(false);

    sim.setControl('mega', 'reset', false);
    sim.runSimMillis(50);
    expect(latest.get('led1')?.on).toBe(true);
    sim.dispose();
  });

  it('rejects a control the board does not have', () => {
    const sim = new Simulation({
      version: 1,
      parts: [{ id: 'mega', type: 'wokwi-arduino-mega' }],
      connections: [],
    });
    expect(() => sim.setControl('mega', 'launch', true)).toThrow(/no control/);
    sim.dispose();
  });
});

describe('board artwork', () => {
  /*
   * The board is drawn from the same layout table that gives the pins their
   * positions, so these tests are about that table holding together: every
   * pad named, every name printed, and nothing printed on top of anything
   * else. The previous artwork was a faithful copy of the real board, and its
   * notched right edge left nowhere to print the 36 end-header numbers.
   */
  const visual = getVisual('wokwi-arduino-mega');
  const body = visual.body({});
  const pinNames = visual.pinLabels?.() ?? '';

  const attribute = (markup: string, name: string): string | undefined =>
    new RegExp(`\\b${name}="([^"]*)"`).exec(markup)?.[1];

  // Attribute order and line breaks are formatting choices, not board geometry.
  const read = (markup: string, defaultSize = 11) =>
    [...markup.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((m) => {
      const transform = attribute(m[1], 'transform') ?? '';
      const translation = /translate\((-?[\d.]+)\s+(-?[\d.]+)\)/.exec(transform);
      return {
        x: Number(translation?.[1] ?? attribute(m[1], 'x') ?? 0),
        y: Number(translation?.[2] ?? attribute(m[1], 'y') ?? 0),
        rotation: Number(/rotate\((-?[\d.]+)\)/.exec(transform)?.[1] ?? 0),
        anchor: attribute(m[1], 'text-anchor') ?? 'start',
        centered: attribute(m[1], 'dominant-baseline') === 'central',
        fontSize: Number(attribute(m[1], 'font-size') ?? defaultSize),
        text: m[2].trim(),
      };
    });

  const rowMarkup = /<g class="mega-pin-labels"[\s\S]*?<\/g>/.exec(pinNames)?.[0] ?? '';
  const endMarkup = /<g class="mega-end-header-labels"[\s\S]*?<\/g>/.exec(pinNames)?.[0] ?? '';

  const endLabels = read(endMarkup);

  const rotated = read(rowMarkup, 10);

  it('gives every pin in the board definition a position', () => {
    const placed = new Set(MEGA_PIN_LAYOUT.map((pin) => pin.name));
    for (const name of ARDUINO_MEGA.pins) expect(placed).toContain(name);
    expect(MEGA_PIN_LAYOUT).toHaveLength(ARDUINO_MEGA.pins.length);
  });

  it('lists pins in the order an imported Wokwi diagram expects', () => {
    expect(MEGA_PIN_LAYOUT.map((pin) => pin.name)).toEqual([...ARDUINO_MEGA.pins]);
  });

  it('keeps every pin on the 0.1in grid, relative to the first', () => {
    // Parts snap to that grid, so a header off it cannot be wired to cleanly.
    const [first] = MEGA_PIN_LAYOUT;
    for (const pin of MEGA_PIN_LAYOUT) {
      for (const delta of [pin.x - first.x, pin.y - first.y]) {
        expect(Math.abs(delta / 19.2 - Math.round(delta / 19.2))).toBeLessThan(0.001);
      }
    }
  });

  it('keeps every pin inside the board', () => {
    for (const pin of MEGA_PIN_LAYOUT) {
      expect(pin.x).toBeGreaterThan(0);
      expect(pin.x).toBeLessThan(visual.width);
      expect(pin.y).toBeGreaterThan(0);
      expect(pin.y).toBeLessThan(visual.height);
    }
  });

  it('leaves a clear gap between neighbouring header blocks', () => {
    /*
     * The plastic runs 9.9px past the outermost pad on each side, so two
     * groups one pitch apart butt into each other and draw as a single block.
     * Within a group the pads are one pitch apart; between groups it has to be
     * at least two.
     */
    const rows = new Map<number, number[]>();
    for (const pin of MEGA_PIN_LAYOUT) {
      if (onEndHeader(pin.x)) continue;
      rows.set(pin.y, [...(rows.get(pin.y) ?? []), pin.x]);
    }
    expect(rows.size).toBe(2);
    for (const [, xs] of rows) {
      const sorted = [...xs].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        const gap = (sorted[i] - sorted[i - 1]) / 19.2;
        expect(Math.abs(gap - Math.round(gap))).toBeLessThan(0.001);
        expect(Math.round(gap) === 1 || Math.round(gap) >= 2).toBe(true);
      }
    }
  });

  it('keeps the end header clear of the rows that run into it', () => {
    const rowMax = Math.max(
      ...MEGA_PIN_LAYOUT.filter((pin) => !onEndHeader(pin.x)).map((pin) => pin.x),
    );
    // Both blocks reach 9.9px past their outermost pad.
    expect(MEGA_END_HEADER_COLUMNS.left - rowMax).toBeGreaterThan(19.8);
  });

  it('drills as many header holes as the real board has', () => {
    /*
     * From the A000067 pinout: 26 along the top (SCL, SDA, AREF, GND, D13-D0,
     * D14-D21), 24 along the bottom (an NC, IOREF, RESET, 3V3, 5V, GND, GND,
     * VIN, then A0-A7 and A8-A15) and 36 on the 2x18 end header. That is one
     * more than the 85 pins the board definition names: the power header's
     * first hole is drilled but not connected, and leaving it out left that
     * header a socket short.
     */
    const holes = body.match(/fill="#131313"/g) ?? [];
    expect(holes).toHaveLength(86);
    expect(MEGA_PIN_LAYOUT).toHaveLength(85);
  });

  it('leaves the unconnected hole unnamed', () => {
    // It is a hole, not a pin: nothing may wire to it, and the silkscreen
    // does not label it on the real board either.
    const bottomY = Math.max(...MEGA_PIN_LAYOUT.map((pin) => pin.y));
    const bottom = MEGA_PIN_LAYOUT.filter((pin) => pin.y === bottomY).sort(
      (a, b) => a.x - b.x,
    );
    expect(bottom.slice(0, 7).map((pin) => pin.name)).toEqual([
      'IOREF',
      'RESET',
      '3.3V',
      '5V',
      'GND.2',
      'GND.3',
      'VIN',
    ]);
    // A0 starts the next block, two pitches on.
    expect(bottom[7].name).toBe('A0');
    expect(bottom[7].x - bottom[6].x).toBeCloseTo(2 * 19.2, 6);
    expect(body + pinNames).not.toContain('>NC<');
  });

  it('never lets a marking land on another marking or on a header', () => {
    /*
     * The one that got through by eye: level with the end header's bottom row,
     * the analog bank's plastic ran under its GND marking. Comparing labels
     * only to other labels missed it, because the thing it collided with was
     * a socket block.
     *
     * Boxes approximate the font's 0.6em advance and account for the pin
     * overlay's centered baseline and the board's ordinary text baseline.
     */
    const advance = 0.6;

    interface Box { l: number; r: number; t: number; b: number; what: string }
    const boxes: Box[] = [];

    // Native pin text is painted separately, but must clear the same sockets
    // and other markings as text that remains inside the board artwork.
    for (const label of [...read(body), ...rotated, ...endLabels]) {
      const { x, y, fontSize: em, text, anchor, centered, rotation } = label;
      const width = text.length * em * advance;
      const before = anchor === 'end' ? width : anchor === 'middle' ? width / 2 : 0;
      const up = centered ? em / 2 : em * 0.75;
      const down = centered ? em / 2 : em * 0.25;
      if (rotation === -90) {
        boxes.push({ l: x - up, r: x + down, t: y - (width - before), b: y + before, what: text });
      } else {
        expect(rotation).toBe(0);
        boxes.push({ l: x - before, r: x + width - before, t: y - up, b: y + down, what: text });
      }
    }

    // Socket blocks, which markings must also keep off.
    for (const m of body.matchAll(/<rect\b([^>]*)>/g)) {
      if (attribute(m[1], 'rx') !== '2.5') continue;
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((name) => Number(attribute(m[1], name)));
      boxes.push({ l: x, r: x + w, t: y, b: y + h, what: 'header block' });
    }

    expect(boxes.length).toBeGreaterThan(100);
    const overlaps = (a: Box, b: Box) =>
      a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const found: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        // Two blocks touching is the header sitting next to its neighbour;
        // that has its own test. This one is about markings.
        if (boxes[i].what === 'header block' && boxes[j].what === 'header block') continue;
        if (overlaps(boxes[i], boxes[j])) found.push(`${boxes[i].what} / ${boxes[j].what}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('numbers every socket of the 2x18 end header', () => {
    const printed = endLabels.map((l) => l.text);
    for (let pin = 22; pin <= 53; pin++) expect(printed).toContain(String(pin));
    // Both columns of a power row are the same net, but each pad still gets
    // its own marking here - there is room for it now.
    expect(printed.filter((t) => t === '5V')).toHaveLength(2);
    expect(printed.filter((t) => t === 'GND')).toHaveLength(2);
    expect(endLabels).toHaveLength(36);
  });

  it('prints every end-header number beside its own pad, on the board', () => {
    const pads = MEGA_PIN_LAYOUT.filter((pin) => onEndHeader(pin.x));
    expect(pads).toHaveLength(36);
    for (const label of endLabels) {
      const pad = pads.filter(
        (pin) => (pin.label ?? pin.name) === label.text && Math.abs(pin.y - label.y) < 6,
      ).sort((a, b) => Math.abs(a.x - label.x) - Math.abs(b.x - label.x))[0];
      expect(pad, `no pad for "${label.text}" at y=${label.y}`).toBeDefined();
      // Beside the socket, not over it.
      expect(Math.abs(label.x - pad!.x)).toBeGreaterThan(10);
      // And on the PCB: printing them past the edge was the old problem.
      const ink = label.text.length * LABEL_ADVANCE;
      const left = label.x - (label.x < pad!.x ? ink : 0);
      const right = label.x + (label.x > pad!.x ? ink : 0);
      expect(left).toBeGreaterThan(0);
      expect(right).toBeLessThan(visual.width);
    }
  });

  it('prints a name beside every pin of the top and bottom headers', () => {
    const rowPins = MEGA_PIN_LAYOUT.filter((pin) => !onEndHeader(pin.x));
    expect(rotated).toHaveLength(rowPins.length);
    expect(rotated.every((label) => label.rotation === -90)).toBe(true);
    for (const pin of rowPins) {
      const label = rotated.find(
        (l) => l.text === (pin.label ?? pin.name) && Math.abs(l.x - pin.x) < 8,
      );
      expect(label, `no silkscreen for ${pin.name}`).toBeDefined();
    }
  });

  it('keeps the end-header numbers from colliding with each other', () => {
    // Rows are one pitch apart and the type is 11px, so this is about the
    // columns: each is anchored away from the header, in opposite directions.
    const byRow = new Map<number, typeof endLabels>();
    for (const label of endLabels) {
      const row = Math.round(label.y);
      byRow.set(row, [...(byRow.get(row) ?? []), label]);
    }
    for (const [, pair] of byRow) {
      expect(pair).toHaveLength(2);
      const [a, b] = pair.sort((l, r) => l.x - r.x);
      expect(a.x + a.text.length * LABEL_ADVANCE).toBeLessThan(b.x);
    }
  });

  it('places the reset button and the L indicator on the board', () => {
    const reset = visual.controls?.find((c) => c.name === 'reset');
    expect(reset).toBeDefined();
    expect(reset!.x).toBeGreaterThan(0);
    expect(reset!.x + reset!.r).toBeLessThan(visual.width);
    expect(reset!.y + reset!.r).toBeLessThan(visual.height);
    // No pad may sit under the button, or pressing it would start a wire.
    for (const pin of MEGA_PIN_LAYOUT) {
      expect(Math.hypot(pin.x - reset!.x, pin.y - reset!.y)).toBeGreaterThan(reset!.r);
    }
  });

  it('lights the L indicator only while the sketch drives pin 13', () => {
    expect(visual.live?.({}, {})).toBe('');
    expect(visual.live?.({ builtinLed: true }, {})).toContain('rect');
  });

  it('carries no element ids, so two copies cannot collide', () => {
    // The previous artwork used patterns referenced by id; a second copy on
    // the page won that lookup and the board lost its header fill.
    expect(body).not.toMatch(/\sid="/);
    expect(body).not.toMatch(/url\(#/);
  });
});
