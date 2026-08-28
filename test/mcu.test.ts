import { describe, it, expect } from 'vitest';
import { makeBoard, Probe, Driver, asm } from './helpers/board.js';
import { HIGH, LOW, PinMode } from '../src/sim/net.js';
import { toHex } from '../src/mcu/hex.js';

// I/O-space addresses (data space minus 0x20)
//   PINB 0x03  DDRB 0x04  PORTB 0x05
//   PINC 0x06  DDRC 0x07  PORTC 0x08
//   PIND 0x09  DDRD 0x0a  PORTD 0x0b

describe('ATmega328P digital output', () => {
  it('drives pin 13 HIGH', () => {
    const ctx = makeBoard(`
      ldi r16, 0x20
      out 0x04, r16   ; DDRB bit5 = output
      out 0x05, r16   ; PORTB bit5 = 1
    halt:
      rjmp halt
    `);
    const probe = new Probe(ctx, '13');
    ctx.board.advanceMillis(1);
    expect(probe.value).toBe(HIGH);
    expect(ctx.board.pin('13').mode).toBe(PinMode.Output);
  });

  it('drives pin 13 LOW', () => {
    const ctx = makeBoard(`
      ldi r16, 0x20
      out 0x04, r16
      ldi r16, 0x00
      out 0x05, r16
    halt:
      rjmp halt
    `);
    const probe = new Probe(ctx, '13');
    ctx.board.advanceMillis(1);
    expect(probe.value).toBe(LOW);
  });

  it('leaves an unconfigured pin as an input', () => {
    const ctx = makeBoard(`
    halt:
      rjmp halt
    `);
    ctx.board.advanceMillis(1);
    expect(ctx.board.pin('13').mode).toBe(PinMode.Input);
  });

  it('enables the internal pull-up', () => {
    const ctx = makeBoard(`
      ldi r16, 0x00
      out 0x0a, r16   ; DDRD = input
      ldi r16, 0x04
      out 0x0b, r16   ; PORTD bit2 = 1 -> pull-up on D2
    halt:
      rjmp halt
    `);
    ctx.board.advanceMillis(1);
    expect(ctx.board.pin('2').mode).toBe(PinMode.InputPullup);
    expect(ctx.board.pin('2').read()).toBe(HIGH);
  });

  it('drives pins on port D', () => {
    const ctx = makeBoard(`
      ldi r16, 0xff
      out 0x0a, r16
      ldi r16, 0x80
      out 0x0b, r16   ; only D7 high
    halt:
      rjmp halt
    `);
    ctx.board.advanceMillis(1);
    expect(ctx.board.pin('7').read()).toBe(HIGH);
    expect(ctx.board.pin('6').read()).toBe(LOW);
  });

  it('drives analog pins used as digital outputs', () => {
    const ctx = makeBoard(`
      ldi r16, 0x3f
      out 0x07, r16   ; DDRC all output
      ldi r16, 0x01
      out 0x08, r16   ; A0 high
    halt:
      rjmp halt
    `);
    ctx.board.advanceMillis(1);
    expect(ctx.board.pin('A0').read()).toBe(HIGH);
    expect(ctx.board.pin('A1').read()).toBe(LOW);
  });
});

describe('ATmega328P digital input', () => {
  it('reads an externally driven HIGH', () => {
    // Copy D2 into D13 continuously.
    const ctx = makeBoard(`
      ldi r16, 0x20
      out 0x04, r16   ; pin13 output
    loop:
      in r17, 0x09    ; read PIND
      andi r17, 0x04  ; isolate D2
      breq off
      ldi r18, 0x20
      out 0x05, r18
      rjmp loop
    off:
      ldi r18, 0x00
      out 0x05, r18
      rjmp loop
    `);
    const driver = new Driver(ctx, '2');
    const probe = new Probe(ctx, '13');

    driver.set(LOW);
    ctx.board.advanceMillis(1);
    expect(probe.value).toBe(LOW);

    driver.set(HIGH);
    ctx.board.advanceMillis(1);
    expect(probe.value).toBe(HIGH);

    driver.set(LOW);
    ctx.board.advanceMillis(1);
    expect(probe.value).toBe(LOW);
  });

  it('an external LOW driver overrides the internal pull-up', () => {
    const ctx = makeBoard(`
      ldi r16, 0x00
      out 0x0a, r16
      ldi r16, 0x04
      out 0x0b, r16   ; pull-up on D2
    halt:
      rjmp halt
    `);
    const driver = new Driver(ctx, '2');
    ctx.board.advanceMillis(1);
    expect(ctx.board.pin('2').read()).toBe(HIGH);

    driver.set(LOW);
    ctx.board.advanceMillis(1);
    expect(ctx.board.pin('2').read()).toBe(LOW);
  });
});

describe('ATmega328P timing', () => {
  it('toggles pin 13 at the cycle count the program implies', () => {
    // Per iteration: in(1) eor(1) out(1) ldi(1) + delay(767) + rjmp(2) = 773
    const ctx = makeBoard(`
      ldi r16, 0x20
      out 0x04, r16
    loop:
      in r17, 0x05
      eor r17, r16
      out 0x05, r17
      ldi r18, 0x00
    delay:
      dec r18
      brne delay
      rjmp loop
    `);
    const probe = new Probe(ctx, '13');
    ctx.board.advanceMillis(2);

    expect(probe.transitions.length).toBeGreaterThan(5);
    // Drop the first interval: it includes the one-time setup before the loop.
    const intervals = probe.intervals().slice(1);
    for (const gap of intervals) {
      expect(gap).toBe(773);
    }
  });

  it('derives simulation time from the CPU clock', () => {
    const ctx = makeBoard(`
    halt:
      rjmp halt
    `);
    ctx.board.advanceMillis(10);
    // 10ms at 16MHz = 160000 cycles
    expect(ctx.board.cycles).toBeGreaterThanOrEqual(160_000);
    expect(ctx.scheduler.simMillis).toBe(10);
  });

  it('runs at half the rate when the clock is 8MHz', () => {
    const source = `
    halt:
      rjmp halt
    `;
    const fast = makeBoard(source, 16_000_000);
    const slow = makeBoard(source, 8_000_000);
    fast.board.advanceMillis(10);
    slow.board.advanceMillis(10);
    expect(slow.board.cycles).toBeCloseTo(fast.board.cycles / 2, -3);
  });

  it('converts between cycles and nanoseconds', () => {
    const { board } = makeBoard(undefined, 16_000_000);
    expect(board.cyclesToNanos(16_000_000)).toBe(1_000_000_000n);
    expect(board.nanosToCycles(1_000_000_000n)).toBe(16_000_000);
  });

  it('interleaves part timers with CPU execution', () => {
    const ctx = makeBoard(`
    halt:
      rjmp halt
    `);
    const firedAtCycles: number[] = [];
    const id = ctx.scheduler.timerInit({
      callback: () => firedAtCycles.push(ctx.board.cycles),
    });
    ctx.scheduler.timerStart(id, 1000, true); // every 1ms
    ctx.board.advanceMillis(5);

    expect(firedAtCycles).toHaveLength(5);
    // Each 1ms tick is 16000 cycles at 16MHz.
    firedAtCycles.forEach((c, i) => {
      expect(c).toBeGreaterThanOrEqual(16_000 * (i + 1));
      expect(c).toBeLessThan(16_000 * (i + 1) + 100);
    });
  });
});

describe('ATmega328P PWM', () => {
  /**
   * Fast PWM on Timer0 / OC0A, which is Arduino pin 6.
   * TCCR0A=0x24 TCCR0B=0x25 OCR0A=0x27 in I/O space.
   */
  function pwmProgram(duty: number): string {
    return `
      ldi r16, 0x40
      out 0x0a, r16    ; DDRD bit6 = output
      ldi r16, 0x83    ; COM0A1 | WGM01 | WGM00 -> fast PWM, non-inverting
      out 0x24, r16
      ldi r16, ${duty}
      out 0x27, r16    ; OCR0A
      ldi r16, 0x01    ; prescaler /1
      out 0x25, r16
    halt:
      rjmp halt
    `;
  }

  /** Fraction of the observed window during which the probe was HIGH. */
  function dutyCycle(probe: Probe, endCycles: number): number {
    const t = probe.transitions;
    if (t.length < 2) return probe.value === HIGH ? 1 : 0;
    // Measure between the first and last transition so partial periods at the
    // edges do not skew the average.
    const start = t[0].cycles;
    const stop = t[t.length - 1].cycles;
    let high = 0;
    for (let i = 0; i < t.length - 1; i++) {
      if (t[i].value === HIGH) high += t[i + 1].cycles - t[i].cycles;
    }
    void endCycles;
    return high / (stop - start);
  }

  it('produces a ~50% duty cycle at OCR0A=128', () => {
    const ctx = makeBoard(pwmProgram(128));
    const probe = new Probe(ctx, '6');
    ctx.board.advanceMillis(2);
    expect(probe.transitions.length).toBeGreaterThan(20);
    expect(dutyCycle(probe, ctx.board.cycles)).toBeCloseTo(0.5, 1);
  });

  it('produces a ~25% duty cycle at OCR0A=64', () => {
    const ctx = makeBoard(pwmProgram(64));
    const probe = new Probe(ctx, '6');
    ctx.board.advanceMillis(2);
    expect(dutyCycle(probe, ctx.board.cycles)).toBeCloseTo(0.25, 1);
  });

  it('runs the PWM carrier at 16MHz/256', () => {
    const ctx = makeBoard(pwmProgram(128));
    const probe = new Probe(ctx, '6');
    ctx.board.advanceMillis(2);
    // One full period spans two transitions; fast PWM with /1 wraps every 256 cycles.
    const t = probe.transitions;
    const period = t[4].cycles - t[2].cycles;
    expect(period).toBe(256);
  });

  it('produces a very narrow pulse at OCR0A=1', () => {
    const ctx = makeBoard(pwmProgram(1));
    const probe = new Probe(ctx, '6');
    ctx.board.advanceMillis(2);
    expect(dutyCycle(probe, ctx.board.cycles)).toBeLessThan(0.02);
    expect(probe.transitions.length).toBeGreaterThan(20);
  });

  /**
   * Known divergence from real silicon, inherited from avr8js: at OCR0A=0 in
   * fast PWM the pin is held HIGH with no transitions, where hardware emits a
   * one-tick spike (~0% duty).
   *
   * This is unreachable from normal Arduino code, because the core special-cases
   * the endpoints - analogWrite(pin, 0) calls digitalWrite(pin, LOW) and never
   * writes OCR=0 while PWM is enabled. The test pins the current behavior so a
   * future avr8js upgrade that fixes it shows up here rather than silently.
   */
  it('holds the pin HIGH at OCR0A=0 (avr8js divergence, unreachable via analogWrite)', () => {
    const ctx = makeBoard(pwmProgram(0));
    const probe = new Probe(ctx, '6');
    ctx.board.advanceMillis(2);
    expect(probe.value).toBe(HIGH);
    expect(probe.transitions.length).toBeLessThanOrEqual(1);
  });

  it('the path analogWrite(0) actually takes leaves the pin LOW', () => {
    // The Arduino core disconnects the compare output and drives the pin
    // directly, which is what this models.
    const ctx = makeBoard(`
      ldi r16, 0x40
      out 0x0a, r16    ; DDRD bit6 = output
      ldi r16, 0x00
      out 0x24, r16    ; TCCR0A: COM0A disconnected
      ldi r16, 0x01
      out 0x25, r16
      ldi r16, 0x00
      out 0x0b, r16    ; PORTD bit6 = 0
    halt:
      rjmp halt
    `);
    const probe = new Probe(ctx, '6');
    ctx.board.advanceMillis(2);
    expect(probe.value).toBe(LOW);
    expect(probe.transitions.length).toBe(0);
  });
});

describe('ATmega328P USART', () => {
  it('emits bytes the sketch writes to Serial', () => {
    // Configure USART0 for 9600 baud @16MHz (UBRR = 103) and send 'A' then 'B'.
    // UBRR0L=0xc4 UBRR0H=0xc5 UCSR0A=0xc0 UCSR0B=0xc1 UCSR0C=0xc2 UDR0=0xc6 (data space)
    const ctx = makeBoard(`
      ldi r16, 103
      sts 0xc4, r16    ; UBRR0L
      ldi r16, 0
      sts 0xc5, r16    ; UBRR0H
      ldi r16, 0x08
      sts 0xc1, r16    ; UCSR0B: TXEN
      ldi r16, 0x06
      sts 0xc2, r16    ; UCSR0C: 8N1

      ldi r17, 65      ; 'A'
      rcall send
      ldi r17, 66      ; 'B'
      rcall send
    halt:
      rjmp halt

    send:
      lds r18, 0xc0    ; UCSR0A
      sbrs r18, 5      ; skip if UDRE set
      rjmp send
      sts 0xc6, r17    ; UDR0
      ret
    `);

    const received: number[] = [];
    ctx.board.onSerialByte = (b) => received.push(b);
    ctx.board.advanceMillis(20);

    expect(received).toEqual([65, 66]);
  });

  it('accepts bytes written into the sketch', () => {
    // Echo: read UDR0 when RXC set, write it back out.
    const ctx = makeBoard(`
      ldi r16, 103
      sts 0xc4, r16
      ldi r16, 0
      sts 0xc5, r16
      ldi r16, 0x18    ; RXEN | TXEN
      sts 0xc1, r16
      ldi r16, 0x06
      sts 0xc2, r16
    loop:
      lds r18, 0xc0
      sbrs r18, 7      ; RXC
      rjmp loop
      lds r17, 0xc6    ; read received byte
    wait:
      lds r18, 0xc0
      sbrs r18, 5      ; UDRE
      rjmp wait
      sts 0xc6, r17
      rjmp loop
    `);

    const received: number[] = [];
    ctx.board.onSerialByte = (b) => received.push(b);

    ctx.board.advanceMillis(1);
    ctx.board.writeSerialByte(0x37);
    ctx.board.advanceMillis(20);

    expect(received).toEqual([0x37]);
  });
});

describe('ATmega328P ADC', () => {
  it('reads a voltage applied to A0', () => {
    // Start a conversion on ADC0, wait for it, copy ADCH to PORTB.
    // ADMUX=0x7c ADCSRA=0x7a ADCL=0x78 ADCH=0x79
    const ctx = makeBoard(`
      ldi r16, 0xff
      out 0x04, r16     ; PORTB all outputs
      ldi r16, 0x40     ; AVCC reference, channel 0
      sts 0x7c, r16
      ldi r16, 0x87     ; ADEN + prescaler 128
      sts 0x7a, r16
    loop:
      lds r16, 0x7a
      ori r16, 0x40     ; ADSC: start conversion
      sts 0x7a, r16
    wait:
      lds r16, 0x7a
      sbrc r16, 6       ; skip when ADSC clears
      rjmp wait
      lds r17, 0x78     ; ADCL first
      lds r18, 0x79     ; then ADCH
      out 0x05, r18     ; expose the high byte on PORTB
      rjmp loop
    `);

    const driver = new Driver(ctx, 'A0');

    // 5V on A0 -> 1023 -> ADCH (right-adjusted) = 1023>>8 = 3
    driver.setVoltage(5);
    ctx.board.advanceMillis(5);
    expect(ctx.board.pin('8').read()).toBe(HIGH); // bit0 of ADCH
    expect(ctx.board.pin('9').read()).toBe(HIGH); // bit1 of ADCH

    // 0V -> 0 -> ADCH = 0
    driver.setVoltage(0);
    ctx.board.advanceMillis(5);
    expect(ctx.board.pin('8').read()).toBe(LOW);
    expect(ctx.board.pin('9').read()).toBe(LOW);
  });
});

describe('ATmega328P firmware loading', () => {
  it('loads firmware from Intel HEX', () => {
    const bytes = asm(`
      ldi r16, 0x20
      out 0x04, r16
      out 0x05, r16
    halt:
      rjmp halt
    `);
    const ctx = makeBoard();
    expect(ctx.board.firmwareLoaded).toBe(false);
    ctx.board.loadHexFirmware(toHex(bytes));
    expect(ctx.board.firmwareLoaded).toBe(true);

    ctx.board.advanceMillis(1);
    expect(ctx.board.pin('13').read()).toBe(HIGH);
  });

  it('rejects firmware larger than flash', () => {
    const ctx = makeBoard();
    expect(() => ctx.board.loadBinary(new Uint8Array(40_000))).toThrow(/flash holds/);
  });

  it('reset returns the cycle counter to zero', () => {
    const ctx = makeBoard(`
    halt:
      rjmp halt
    `);
    ctx.board.advanceMillis(1);
    expect(ctx.board.cycles).toBeGreaterThan(0);
    ctx.board.reset();
    expect(ctx.board.cycles).toBe(0);
  });
});
