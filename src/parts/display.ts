/**
 * wokwi-7segment and wokwi-buzzer.
 * Pins and attributes follow the Wokwi part reference.
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
 * The note in a window of measured periods.
 *
 * The median, not the mean. A window that straddles a note change holds
 * periods from both notes, and their mean is a pitch that was never played:
 * 440 changing to 880 reported ~859 for one window, which is heard as a wrong
 * note in front of the right one. The median of a mostly-new window is the
 * new note.
 */
export function dominantFrequency(periodsNanos: readonly number[]): number {
  // Too few edges to call it a pitch at all.
  if (periodsNanos.length < 3) return 0;
  const sorted = [...periodsNanos].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  if (median <= 0) return 0;

  /*
   * A tone is periodic; a switch bouncing is not.
   *
   * Contact bounce makes a sketch call `tone()` and `noTone()` a dozen times
   * in a millisecond, and the burst of ragged edges that leaves has a median
   * like any other set of numbers. Reported as a pitch, it became a chirp in
   * front of every note - a 20ms tone somewhere around 1kHz, which no buzzer
   * would ever produce from a 1ms scuffle. So the window has to look periodic
   * before it is called a note: most of it close to the median.
   *
   * Kept loose enough that a window straddling a note change still reports
   * the new note, because most of that window really is the new note.
   */
  const close = sorted.filter((p) => Math.abs(p - median) <= median * 0.2).length;
  if (close < periodsNanos.length * 0.6) return 0;
  return Math.round(1e9 / median);
}

/**
 * wokwi-buzzer.
 *
 * Measures the frequency of the square wave across its pins and reports it.
 * The sound itself is made in `ui/audio.ts`, from these reports; the part
 * stays headless so it can be tested without a browser.
 */
class BuzzerPart implements Part {
  private ctx!: PartContext;
  private lastEdge: bigint | null = null;
  private periods: number[] = [];
  private currentFreq = 0;
  /*
   * Held rather than read back out of `ctx` at each report: the attributes a
   * part is built with are the ones it keeps, so re-reading them after an edit
   * returns the old value. `attrChanged` is handed the new one.
   */
  private volume = 1;
  private mode = 'smooth';

  init(ctx: PartContext): void {
    this.ctx = ctx;
    this.volume = ctx.attrNumber('volume', 1);
    this.mode = ctx.attr('mode', 'smooth');
    ctx.pinInit('1', PinMode.Input);
    ctx.pinInit('2', PinMode.Input);

    // Pin 2 is the driven side in the documented wiring (pin 1 to GND).
    ctx.pinWatch('2', Edge.Rising, () => this.onRisingEdge());

    const timer = ctx.timerInit(() => this.report());
    /*
     * 50Hz. At the 20Hz this used to run, a note in a fast melody could be
     * over before it was ever reported, and every note started up to 50ms
     * late - enough to hear a tune limp.
     */
    ctx.timerStart(timer, 20_000, true);
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
      freq = dominantFrequency(this.periods);
      this.periods.length = 0;
    } else {
      // No edges in the window: the tone has stopped.
      this.lastEdge = null;
    }
    if (freq === this.currentFreq) return;
    this.currentFreq = freq;
    this.emitState();
  }

  private emitState(): void {
    this.ctx.emit({
      frequency: this.currentFreq,
      playing: this.currentFreq > 0,
      volume: this.volume,
      // Wokwi's two modes: "smooth" shapes the note edges, "accurate" switches
      // instantly and clicks, which is what a driven piezo really does.
      mode: this.mode,
    });
  }

  /*
   * Volume and mode are read at the moment a tone is reported, and a held note
   * reports nothing further - so without this, turning the volume down did
   * nothing until the sketch happened to change the pitch.
   */
  attrChanged(name: string, value: string): void {
    if (name === 'volume') this.volume = parseFloat(value) || 0;
    else if (name === 'mode') this.mode = value || 'smooth';
    else return;
    this.emitState();
  }
}

registerPart({
  type: 'wokwi-buzzer',
  pins: ['1', '2'],
  defaults: { mode: 'smooth', volume: '1.0' },
  create: () => new BuzzerPart(),
});
