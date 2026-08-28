/**
 * wokwi-7segment and wokwi-buzzer.
 * Pins and attributes per docs/wokwi/02-parts.md.
 */

import { registerPart } from '../sim/registry.js';
import { Edge, HIGH, PinMode } from '../sim/net.js';
import type { Part, PartContext } from '../sim/part.js';

const SEGMENTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'] as const;

/**
 * wokwi-7segment.
 *
 * Multi-digit displays are multiplexed: the sketch lights one digit at a time
 * far faster than the eye (or the renderer) can follow. Each digit therefore
 * accumulates per-segment on-time and reports a persistence-weighted value, so
 * a multiplexed display reads as steady rather than flickering.
 */
class SevenSegmentPart implements Part {
  private ctx!: PartContext;
  private digits = 1;
  private commonAnode = true;
  private hasColon = false;
  /** Accumulated on-time per digit per segment, in nanoseconds. */
  private accum: number[][] = [];
  private lastSample = 0n;

  init(ctx: PartContext): void {
    this.ctx = ctx;
    this.digits = Math.min(Math.max(Math.round(ctx.attrNumber('digits', 1)), 1), 4);
    this.commonAnode = ctx.attr('common', 'anode') === 'anode';
    this.hasColon = ctx.attr('colon', '') === '1';

    for (const seg of SEGMENTS) ctx.pinInit(seg, PinMode.Input);
    if (this.digits === 1) {
      ctx.pinInit('COM', PinMode.Input);
    } else {
      for (let d = 1; d <= this.digits; d++) ctx.pinInit(`DIG${d}`, PinMode.Input);
    }
    if (this.hasColon) ctx.pinInit('CLN', PinMode.Input);

    this.accum = Array.from({ length: this.digits }, () => new Array(SEGMENTS.length).fill(0));
    this.lastSample = ctx.simNanos;

    for (const seg of SEGMENTS) {
      ctx.pinWatch(seg, Edge.Both, () => this.integrate());
    }
    if (this.digits > 1) {
      for (let d = 1; d <= this.digits; d++) {
        ctx.pinWatch(`DIG${d}`, Edge.Both, () => this.integrate());
      }
    }

    const timer = ctx.timerInit(() => this.report());
    ctx.timerStart(timer, 1_000_000 / 60, true); // 60fps
  }

  /** Whether a segment is lit right now, accounting for common polarity. */
  private segmentLit(seg: string): boolean {
    const level = this.ctx.pinRead(seg) === HIGH;
    // Common anode: the segment pin sinks current, so LOW lights it.
    return this.commonAnode ? !level : level;
  }

  /** Whether a digit is currently selected in a multiplexed display. */
  private digitActive(index: number): boolean {
    if (this.digits === 1) return true;
    const level = this.ctx.pinRead(`DIG${index + 1}`) === HIGH;
    // Common anode drives the digit pin high to select it.
    return this.commonAnode ? level : !level;
  }

  /** Add elapsed time to whichever segments are lit right now. */
  private integrate(): void {
    const now = this.ctx.simNanos;
    const elapsed = Number(now - this.lastSample);
    this.lastSample = now;
    if (elapsed <= 0) return;
    for (let d = 0; d < this.digits; d++) {
      if (!this.digitActive(d)) continue;
      for (let s = 0; s < SEGMENTS.length; s++) {
        if (this.segmentLit(SEGMENTS[s])) this.accum[d][s] += elapsed;
      }
    }
  }

  private report(): void {
    this.integrate();
    const now = this.ctx.simNanos;
    void now;
    const frames = this.accum.map((segs) => {
      const peak = Math.max(...segs, 1);
      // Normalise against the brightest segment so a multiplexed digit at 1/4
      // duty still reads as fully on.
      return segs.map((v) => v / peak > 0.25);
    });
    this.ctx.emit({ digits: frames, common: this.commonAnode ? 'anode' : 'cathode' });
    for (const row of this.accum) row.fill(0);
  }
}

function sevenSegmentPins(digits: number, colon: boolean): string[] {
  const pins: string[] = [...SEGMENTS];
  if (digits <= 1) pins.push('COM');
  else for (let d = 1; d <= digits; d++) pins.push(`DIG${d}`);
  if (colon) pins.push('CLN');
  return pins;
}

registerPart({
  type: 'wokwi-7segment',
  // The pin set varies with the `digits` attribute; advertise the superset so
  // diagram validation accepts any documented wiring.
  pins: [...sevenSegmentPins(4, true), 'COM'],
  defaults: { common: 'anode', digits: '1', colon: '', color: 'red' },
  create: () => new SevenSegmentPart(),
});

/**
 * wokwi-buzzer.
 *
 * Measures the frequency of the square wave across its pins and reports it.
 * The renderer owns WebAudio; the part stays headless so it is testable.
 */
class BuzzerPart implements Part {
  private ctx!: PartContext;
  private lastEdge: bigint | null = null;
  private periods: number[] = [];
  private currentFreq = 0;

  init(ctx: PartContext): void {
    this.ctx = ctx;
    ctx.pinInit('1', PinMode.Input);
    ctx.pinInit('2', PinMode.Input);

    // Pin 2 is the driven side in the documented wiring (pin 1 to GND).
    ctx.pinWatch('2', Edge.Rising, () => this.onRisingEdge());

    const timer = ctx.timerInit(() => this.report());
    ctx.timerStart(timer, 50_000, true); // 20Hz reporting
  }

  private onRisingEdge(): void {
    const now = this.ctx.simNanos;
    if (this.lastEdge !== null) {
      const periodNanos = Number(now - this.lastEdge);
      if (periodNanos > 0) this.periods.push(periodNanos);
    }
    this.lastEdge = now;
  }

  private report(): void {
    let freq = 0;
    if (this.periods.length > 0) {
      const mean = this.periods.reduce((a, b) => a + b, 0) / this.periods.length;
      freq = Math.round(1e9 / mean);
      this.periods.length = 0;
    } else {
      // No edges in the window: the tone has stopped.
      this.lastEdge = null;
    }
    if (freq === this.currentFreq) return;
    this.currentFreq = freq;
    this.ctx.emit({
      frequency: freq,
      playing: freq > 0,
      volume: this.ctx.attrNumber('volume', 1),
    });
  }
}

registerPart({
  type: 'wokwi-buzzer',
  pins: ['1', '2'],
  defaults: { mode: 'smooth', volume: '1.0' },
  create: () => new BuzzerPart(),
});
