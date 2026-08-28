import { describe, it, expect, beforeEach } from 'vitest';
import '../src/parts/index.js';
import { Simulation } from '../src/sim/simulation.js';
import { asm } from './helpers/board.js';
import type { Diagram } from '../src/diagram/types.js';
import { HIGH, LOW } from '../src/sim/net.js';
import { applyGamma, BrightnessMeter } from '../src/parts/led.js';
import { ntcVoltage, positionToVolts, ldrResistance } from '../src/parts/analog.js';
import { Hd44780, Pcf8574Backpack } from '../src/parts/lcd1602.js';
import { Ws2812Decoder, bitsToRgb, T0H, T1H, RESET_NANOS } from '../src/parts/neopixel.js';

function diagram(parts: Diagram['parts'], connections: Diagram['connections']): Diagram {
  return { version: 1, parts, connections };
}

/**
 * Collect the latest event emitted by each part, seeded with whatever was
 * emitted during construction.
 */
function trackEvents(sim: Simulation): Map<string, Record<string, unknown>> {
  const latest = new Map<string, Record<string, unknown>>(
    [...sim.latestPartEvents].map(([id, e]) => [id, e as Record<string, unknown>]),
  );
  sim.onPartEvent = (id, event) => latest.set(id, event as Record<string, unknown>);
  return latest;
}

describe('LED', () => {
  const BLINK_FAST = `
    ldi r16, 0x20
    out 0x04, r16
  loop:
    in r17, 0x05
    eor r17, r16
    out 0x05, r17
    rjmp loop
  `;

  it('lights when the MCU drives its anode high', () => {
    const sim = new Simulation(
      diagram(
        [
          { id: 'uno', type: 'wokwi-arduino-uno' },
          { id: 'led1', type: 'wokwi-led', attrs: { color: 'red' } },
        ],
        [
          ['uno:13', 'led1:A', 'green', []],
          ['led1:C', 'uno:GND.1', 'black', []],
        ],
      ),
    );
    const events = trackEvents(sim);
    sim.loadBinary(
      asm(`
      ldi r16, 0x20
      out 0x04, r16
      out 0x05, r16
    halt:
      rjmp halt
    `),
    );
    sim.runSimMillis(50);
    expect(events.get('led1')?.on).toBe(true);
    expect(events.get('led1')?.brightness).toBeCloseTo(1, 1);
  });

  it('stays dark when the pin is low', () => {
    const sim = new Simulation(
      diagram(
        [
          { id: 'uno', type: 'wokwi-arduino-uno' },
          { id: 'led1', type: 'wokwi-led' },
        ],
        [
          ['uno:13', 'led1:A', 'green', []],
          ['led1:C', 'uno:GND.1', 'black', []],
        ],
      ),
    );
    const events = trackEvents(sim);
    sim.loadBinary(
      asm(`
      ldi r16, 0x20
      out 0x04, r16
      ldi r16, 0x00
      out 0x05, r16
    halt:
      rjmp halt
    `),
    );
    sim.runSimMillis(50);
    expect(events.get('led1')?.on).toBe(false);
  });

  it('reports an intermediate brightness for a fast square wave', () => {
    const sim = new Simulation(
      diagram(
        [
          { id: 'uno', type: 'wokwi-arduino-uno' },
          { id: 'led1', type: 'wokwi-led', attrs: { gamma: '1' } },
        ],
        [
          ['uno:13', 'led1:A', 'green', []],
          ['led1:C', 'uno:GND.1', 'black', []],
        ],
      ),
    );
    const events = trackEvents(sim);
    sim.loadBinary(asm(BLINK_FAST));
    sim.runSimMillis(50);
    const brightness = events.get('led1')?.brightness as number;
    // The toggle loop is symmetric, so time-averaged brightness is about half.
    expect(brightness).toBeGreaterThan(0.2);
    expect(brightness).toBeLessThan(0.8);
  });
});

describe('BrightnessMeter', () => {
  it('reports full brightness for a constantly high pin', () => {
    const m = new BrightnessMeter(0n, HIGH);
    expect(m.sample(1_000_000n)).toBeCloseTo(1, 5);
  });

  it('reports zero for a constantly low pin', () => {
    const m = new BrightnessMeter(0n, LOW);
    expect(m.sample(1_000_000n)).toBeCloseTo(0, 5);
  });

  it('reports the duty cycle of a square wave', () => {
    const m = new BrightnessMeter(0n, LOW);
    m.update(250_000n, HIGH);
    m.update(500_000n, LOW);
    m.update(750_000n, HIGH);
    expect(m.sample(1_000_000n)).toBeCloseTo(0.5, 5);
  });

  it('reports a 25% duty cycle', () => {
    const m = new BrightnessMeter(0n, HIGH);
    m.update(250_000n, LOW);
    expect(m.sample(1_000_000n)).toBeCloseTo(0.25, 5);
  });

  it('starts a fresh window after each sample', () => {
    const m = new BrightnessMeter(0n, HIGH);
    m.sample(1_000_000n);
    m.update(1_000_000n, LOW);
    expect(m.sample(2_000_000n)).toBeCloseTo(0, 5);
  });
});

describe('applyGamma', () => {
  it('preserves the endpoints', () => {
    expect(applyGamma(0, 2.8)).toBe(0);
    expect(applyGamma(1, 2.8)).toBe(1);
  });

  it('brightens midtones', () => {
    expect(applyGamma(0.5, 2.8)).toBeGreaterThan(0.5);
  });

  it('is the identity at gamma 1', () => {
    expect(applyGamma(0.5, 1)).toBeCloseTo(0.5, 6);
  });
});

describe('Pushbutton', () => {
  /** Sketch: D2 with pull-up, mirrored to D13. */
  const MIRROR = `
    ldi r16, 0x20
    out 0x04, r16    ; D13 output
    ldi r16, 0x00
    out 0x0a, r16    ; PORTD inputs
    ldi r16, 0x04
    out 0x0b, r16    ; pull-up on D2
  loop:
    in r17, 0x09
    andi r17, 0x04
    breq pressed
    ldi r18, 0x00
    out 0x05, r18
    rjmp loop
  pressed:
    ldi r18, 0x20
    out 0x05, r18
    rjmp loop
  `;

  function buttonSim() {
    const sim = new Simulation(
      diagram(
        [
          { id: 'uno', type: 'wokwi-arduino-uno' },
          { id: 'btn', type: 'wokwi-pushbutton', attrs: { bounce: '0' } },
        ],
        [
          ['uno:2', 'btn:1.l', 'green', []],
          ['btn:2.l', 'uno:GND.1', 'black', []],
        ],
      ),
    );
    sim.loadBinary(asm(MIRROR));
    return sim;
  }

  it('reads high when released (pull-up)', () => {
    const sim = buttonSim();
    sim.runSimMillis(20);
    expect(sim.board!.pin('2').read()).toBe(HIGH);
    expect(sim.board!.pin('13').read()).toBe(LOW);
  });

  it('pulls the pin low when pressed', () => {
    const sim = buttonSim();
    sim.runSimMillis(20);
    sim.setControl('btn', 'pressed', true);
    sim.runSimMillis(20);
    expect(sim.board!.pin('2').read()).toBe(LOW);
    expect(sim.board!.pin('13').read()).toBe(HIGH);
  });

  it('returns high after release', () => {
    const sim = buttonSim();
    sim.setControl('btn', 'pressed', true);
    sim.runSimMillis(20);
    sim.setControl('btn', 'pressed', false);
    sim.runSimMillis(20);
    expect(sim.board!.pin('2').read()).toBe(HIGH);
  });

  it('does not latch the net after the press ends', () => {
    // Press and release repeatedly; the button must never hold the line low.
    const sim = buttonSim();
    for (let i = 0; i < 3; i++) {
      sim.setControl('btn', 'pressed', true);
      sim.runSimMillis(10);
      expect(sim.board!.pin('2').read()).toBe(LOW);
      sim.setControl('btn', 'pressed', false);
      sim.runSimMillis(10);
      expect(sim.board!.pin('2').read()).toBe(HIGH);
    }
  });

  it('bounces by default', () => {
    const sim = new Simulation(
      diagram(
        [
          { id: 'uno', type: 'wokwi-arduino-uno' },
          { id: 'btn', type: 'wokwi-pushbutton' },
        ],
        [
          ['uno:2', 'btn:1.l', 'green', []],
          ['btn:2.l', 'uno:GND.1', 'black', []],
        ],
      ),
    );
    sim.loadBinary(asm(MIRROR));
    sim.runSimMillis(20);

    let transitions = 0;
    let last = sim.board!.pin('2').read();
    sim.setControl('btn', 'pressed', true);
    // Sample finely across the ~1ms bounce window.
    for (let i = 0; i < 400; i++) {
      sim.runSimNanos(5_000n);
      const now = sim.board!.pin('2').read();
      if (now !== last) transitions++;
      last = now;
    }
    expect(transitions).toBeGreaterThan(1);
    // It must still settle low.
    sim.runSimMillis(10);
    expect(sim.board!.pin('2').read()).toBe(LOW);
  });
});

describe('Slide switch', () => {
  it('routes the common pin to the selected throw', () => {
    const sim = new Simulation(
      diagram(
        [
          { id: 'uno', type: 'wokwi-arduino-uno' },
          { id: 'sw', type: 'wokwi-slide-switch' },
        ],
        [
          ['sw:1', 'uno:GND.1', 'black', []],
          ['sw:3', 'uno:5V', 'red', []],
          ['sw:2', 'uno:4', 'green', []],
        ],
      ),
    );
    sim.loadBinary(asm('halt:\n rjmp halt'));
    sim.runSimMillis(5);
    expect(sim.board!.pin('4').read()).toBe(LOW); // left throw = GND

    sim.setControl('sw', 'value', '1');
    sim.runSimMillis(5);
    expect(sim.board!.pin('4').read()).toBe(HIGH); // right throw = 5V
  });
});

describe('Analog parts', () => {
  it('potentiometer maps position to voltage', () => {
    expect(positionToVolts(0)).toBeCloseTo(0, 6);
    expect(positionToVolts(1023)).toBeCloseTo(5, 6);
    expect(positionToVolts(512)).toBeCloseTo(2.5, 1);
  });

  it('potentiometer clamps out-of-range positions', () => {
    expect(positionToVolts(-100)).toBe(0);
    expect(positionToVolts(9999)).toBeCloseTo(5, 6);
  });

  it('potentiometer drives the voltage onto its SIG pin', () => {
    const sim = new Simulation(
      diagram(
        [
          { id: 'uno', type: 'wokwi-arduino-uno' },
          { id: 'pot', type: 'wokwi-potentiometer', attrs: { value: '1023' } },
        ],
        [
          ['pot:SIG', 'uno:A0', 'green', []],
          ['pot:GND', 'uno:GND.1', 'black', []],
          ['pot:VCC', 'uno:5V', 'red', []],
        ],
      ),
    );
    sim.loadBinary(asm('halt:\n rjmp halt'));
    sim.runSimMillis(1);
    expect(sim.board!.pin('A0').adcRead()).toBeCloseTo(5, 2);

    sim.setControl('pot', 'value', 0);
    sim.runSimMillis(1);
    expect(sim.board!.pin('A0').adcRead()).toBeCloseTo(0, 2);
  });

  it('NTC voltage rises with temperature', () => {
    const cold = ntcVoltage(0, 3950);
    const warm = ntcVoltage(25, 3950);
    const hot = ntcVoltage(60, 3950);
    expect(cold).toBeLessThan(warm);
    expect(warm).toBeLessThan(hot);
  });

  it('NTC sits at mid-scale at 25C with a matched series resistor', () => {
    expect(ntcVoltage(25, 3950)).toBeCloseTo(2.5, 2);
  });

  it('LDR resistance falls as light increases', () => {
    expect(ldrResistance(10, 50, 0.7)).toBeGreaterThan(ldrResistance(1000, 50, 0.7));
  });

  it('LDR matches its rl10 rating at 10 lux', () => {
    expect(ldrResistance(10, 50, 0.7)).toBeCloseTo(50_000, 0);
  });
});

describe('HD44780 LCD controller', () => {
  let lcd: Hd44780;
  beforeEach(() => {
    lcd = new Hd44780(2, 16);
  });

  it('starts blank', () => {
    expect(lcd.text()).toEqual(['                ', '                ']);
  });

  it('writes characters at the cursor', () => {
    for (const ch of 'Hi') lcd.writeByte(true, ch.charCodeAt(0));
    expect(lcd.text()[0].trimEnd()).toBe('Hi');
  });

  it('advances the cursor as it writes', () => {
    lcd.writeByte(true, 65);
    expect(lcd.cursorCol).toBe(1);
  });

  it('clears the display', () => {
    lcd.writeByte(true, 65);
    lcd.writeByte(false, 0x01);
    expect(lcd.text()[0]).toBe('                ');
    expect(lcd.cursorCol).toBe(0);
  });

  it('moves the cursor to the second row', () => {
    lcd.writeByte(false, 0x80 | 0x40); // DDRAM address 0x40 = row 1
    lcd.writeByte(true, 88); // 'X'
    expect(lcd.text()[1][0]).toBe('X');
  });

  it('honours the display on/off command', () => {
    lcd.writeByte(false, 0x08); // display off
    expect(lcd.displayOn).toBe(false);
    lcd.writeByte(false, 0x0c); // display on, no cursor
    expect(lcd.displayOn).toBe(true);
  });

  it('assembles bytes from 4-bit nibbles', () => {
    lcd.writeByte(false, 0x28); // set 4-bit mode
    expect(lcd.isFourBit).toBe(true);
    // 'A' = 0x41 -> high nibble 0x4, low nibble 0x1
    expect(lcd.writeNibble(true, 0x4)).toBe(false);
    expect(lcd.writeNibble(true, 0x1)).toBe(true);
    expect(lcd.text()[0][0]).toBe('A');
  });

  it('stores custom characters in CGRAM', () => {
    lcd.writeByte(false, 0x40); // CGRAM address 0
    for (let i = 0; i < 8; i++) lcd.writeByte(true, 0x1f);
    expect(lcd.cgram[0]).toEqual(new Array(8).fill(0x1f));
  });

  it('supports a 20x4 display', () => {
    const big = new Hd44780(4, 20);
    big.writeByte(false, 0x80 | 0x54); // row 3 start on a 20-col display
    big.writeByte(true, 90);
    expect(big.text()[3][0]).toBe('Z');
  });
});

describe('PCF8574 LCD backpack', () => {
  it('latches a nibble on the falling edge of E', () => {
    const lcd = new Hd44780(2, 16);
    lcd.writeByte(false, 0x28); // 4-bit mode
    const bp = new Pcf8574Backpack(lcd);

    // Send 'A' (0x41): high nibble 0x4 then low nibble 0x1, RS=1.
    for (const nibble of [0x4, 0x1]) {
      const base = (nibble << 4) | 0x01; // RS set
      bp.write(base | 0x04); // E high
      bp.write(base); // E low -> latch
    }
    expect(lcd.text()[0][0]).toBe('A');
  });

  it('ignores writes while RW is set', () => {
    const lcd = new Hd44780(2, 16);
    lcd.writeByte(false, 0x28);
    const bp = new Pcf8574Backpack(lcd);
    bp.write(0x40 | 0x02 | 0x04); // RW set, E high
    bp.write(0x40 | 0x02); // E low
    expect(lcd.text()[0][0]).toBe(' ');
  });
});

describe('WS2812 decoder', () => {
  /** Feed one bit at the nominal WS2812 timings. */
  function sendBit(dec: Ws2812Decoder, t: bigint, bit: number): bigint {
    const high = BigInt(bit ? T1H : T0H);
    dec.edge(t, HIGH);
    dec.edge(t + high, LOW);
    return t + high + 450n; // low period between bits
  }

  function sendPixel(dec: Ws2812Decoder, t: bigint, g: number, r: number, b: number): bigint {
    const value = (g << 16) | (r << 8) | b;
    for (let i = 23; i >= 0; i--) t = sendBit(dec, t, (value >> i) & 1);
    return t;
  }

  it('converts a bit array to GRB', () => {
    // 0x00FF00 in GRB = green 0, red 255, blue 0
    const bits = [];
    const value = (0x00 << 16) | (0xff << 8) | 0x00;
    for (let i = 23; i >= 0; i--) bits.push((value >> i) & 1);
    expect(bitsToRgb(bits)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('decodes a single pixel', () => {
    const frames: unknown[] = [];
    const dec = new Ws2812Decoder(1, (p) => frames.push(p));
    sendPixel(dec, 0n, 0x11, 0x22, 0x33);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual([{ r: 0x22, g: 0x11, b: 0x33 }]);
  });

  it('decodes several pixels in one frame', () => {
    const frames: { r: number; g: number; b: number }[][] = [];
    const dec = new Ws2812Decoder(3, (p) => frames.push(p));
    let t = 0n;
    t = sendPixel(dec, t, 255, 0, 0);
    t = sendPixel(dec, t, 0, 255, 0);
    sendPixel(dec, t, 0, 0, 255);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual([
      { r: 0, g: 255, b: 0 },
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 0, b: 255 },
    ]);
  });

  it('latches a short frame on the reset gap', () => {
    const frames: { r: number; g: number; b: number }[][] = [];
    const dec = new Ws2812Decoder(4, (p) => frames.push(p));
    const t = sendPixel(dec, 0n, 10, 20, 30);
    // Only one pixel sent; the reset gap must still latch it.
    dec.tick(t + BigInt(RESET_NANOS) + 1000n);
    expect(frames).toHaveLength(1);
    expect(frames[0][0]).toEqual({ r: 20, g: 10, b: 30 });
    // Remaining pixels are padded to black.
    expect(frames[0][3]).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('distinguishes 0 and 1 by pulse width', () => {
    const frames: { r: number; g: number; b: number }[][] = [];
    const dec = new Ws2812Decoder(1, (p) => frames.push(p));
    let t = 0n;
    // All ones -> 0xFFFFFF
    for (let i = 0; i < 24; i++) t = sendBit(dec, t, 1);
    expect(frames[0]).toEqual([{ r: 255, g: 255, b: 255 }]);
  });
});

describe('Simulation wiring', () => {
  it('reports a diagram with no microcontroller', () => {
    const sim = new Simulation(diagram([{ id: 'led1', type: 'wokwi-led' }], []));
    expect(sim.hasErrors).toBe(true);
    expect(sim.problems[0].message).toMatch(/no microcontroller/);
  });

  it('rejects two microcontrollers, matching the Wokwi limitation', () => {
    const sim = new Simulation(
      diagram(
        [
          { id: 'a', type: 'wokwi-arduino-uno' },
          { id: 'b', type: 'wokwi-arduino-uno' },
        ],
        [],
      ),
    );
    expect(sim.problems.some((p) => /more than one microcontroller/.test(p.message))).toBe(true);
  });

  it('warns about an unknown part type but still runs', () => {
    const sim = new Simulation(
      diagram(
        [
          { id: 'uno', type: 'wokwi-arduino-uno' },
          { id: 'x', type: 'wokwi-does-not-exist' },
        ],
        [],
      ),
    );
    expect(sim.hasErrors).toBe(false);
    expect(sim.problems.some((p) => p.severity === 'warning')).toBe(true);
    sim.loadBinary(asm('halt:\n rjmp halt'));
    expect(() => sim.runSimMillis(1)).not.toThrow();
  });

  it('reports a connection to a pin the part does not have', () => {
    const sim = new Simulation(
      diagram(
        [
          { id: 'uno', type: 'wokwi-arduino-uno' },
          { id: 'led1', type: 'wokwi-led' },
        ],
        [['uno:13', 'led1:NOPE', 'green', []]],
      ),
    );
    expect(sim.problems.some((p) => /has no pin/.test(p.message))).toBe(true);
  });

  it('applies part attribute defaults', () => {
    const sim = new Simulation(
      diagram(
        [
          { id: 'uno', type: 'wokwi-arduino-uno' },
          { id: 'r1', type: 'wokwi-resistor' },
        ],
        [],
      ),
    );
    expect(sim.parts.get('r1')!.runtime.attrs.value).toBe('1000');
  });

  it('lets diagram attrs override defaults', () => {
    const sim = new Simulation(
      diagram(
        [
          { id: 'uno', type: 'wokwi-arduino-uno' },
          { id: 'r1', type: 'wokwi-resistor', attrs: { value: '220' } },
        ],
        [],
      ),
    );
    expect(sim.parts.get('r1')!.runtime.attrs.value).toBe('220');
  });

  it('honours the board frequency attribute', () => {
    const sim = new Simulation(
      diagram([{ id: 'uno', type: 'wokwi-arduino-uno', attrs: { frequency: '8m' } }], []),
    );
    expect(sim.board!.frequencyHz).toBe(8_000_000);
  });

  it('drives GND low and 5V high', () => {
    const sim = new Simulation(diagram([{ id: 'uno', type: 'wokwi-arduino-uno' }], []));
    expect(sim.board!.pin('GND.1').read()).toBe(LOW);
    expect(sim.board!.pin('5V').read()).toBe(HIGH);
  });
});

describe('Serial end to end', () => {
  it('delivers sketch output through the simulation', () => {
    const sim = new Simulation(diagram([{ id: 'uno', type: 'wokwi-arduino-uno' }], []));
    const out: number[] = [];
    sim.onSerialByte = (b) => out.push(b);
    sim.loadBinary(
      asm(`
      ldi r16, 103
      sts 0xc4, r16
      ldi r16, 0
      sts 0xc5, r16
      ldi r16, 0x08
      sts 0xc1, r16
      ldi r16, 0x06
      sts 0xc2, r16
      ldi r17, 72     ; 'H'
      rcall send
      ldi r17, 105    ; 'i'
      rcall send
    halt:
      rjmp halt
    send:
      lds r18, 0xc0
      sbrs r18, 5
      rjmp send
      sts 0xc6, r17
      ret
    `),
    );
    sim.runSimMillis(20);
    expect(String.fromCharCode(...out)).toBe('Hi');
  });
});
