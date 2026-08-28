/**
 * wokwi-led, wokwi-rgb-led, wokwi-led-bar-graph
 * Pins and attributes per docs/wokwi/02-parts.md.
 */

import { registerPart } from '../sim/registry.js';
import { Edge, HIGH, PinMode, type DigitalValue } from '../sim/net.js';
import type { Part, PartContext } from '../sim/part.js';

/** Default emitted-light color for each body color. */
const LIGHT_COLORS: Record<string, string> = {
  red: '#ff2d2d',
  green: '#2dff2d',
  blue: '#4d9dff',
  yellow: '#ffee2d',
  orange: '#ffa32d',
  white: '#ffffff',
  purple: '#c34dff',
};

export function lightColorFor(color: string): string {
  return LIGHT_COLORS[color.toLowerCase()] ?? color;
}

/**
 * Brightness tracker.
 *
 * A PWM-driven LED toggles far faster than the display refreshes, so sampling
 * the instantaneous pin level would alias badly. This integrates time-at-HIGH
 * over each reporting window to recover the real duty cycle.
 */
export class BrightnessMeter {
  private lastChange: bigint;
  private highNanos = 0n;
  private windowStart: bigint;
  private value: DigitalValue;

  constructor(now: bigint, initial: DigitalValue = 0) {
    this.lastChange = now;
    this.windowStart = now;
    this.value = initial;
  }

  /** Record a level change at time `now`. */
  update(now: bigint, value: DigitalValue): void {
    if (this.value === HIGH) this.highNanos += now - this.lastChange;
    this.lastChange = now;
    this.value = value;
  }

  /** Duty cycle over the window since the last call, then start a new window. */
  sample(now: bigint): number {
    if (this.value === HIGH) this.highNanos += now - this.lastChange;
    this.lastChange = now;
    const span = now - this.windowStart;
    const duty = span > 0n ? Number(this.highNanos) / Number(span) : this.value === HIGH ? 1 : 0;
    this.windowStart = now;
    this.highNanos = 0n;
    return Math.min(Math.max(duty, 0), 1);
  }
}

/** Apply gamma correction so mid duty cycles look right on screen. */
export function applyGamma(duty: number, gamma: number): number {
  if (duty <= 0) return 0;
  if (duty >= 1) return 1;
  return Math.pow(duty, 1 / gamma);
}

class LedPart implements Part {
  private ctx!: PartContext;
  private meter!: BrightnessMeter;
  private gamma = 2.8;
  private lastReported = -1;

  init(ctx: PartContext): void {
    this.ctx = ctx;
    this.gamma = ctx.attrNumber('gamma', 2.8);

    const anode = ctx.pinInit('A', PinMode.Input);
    ctx.pinInit('C', PinMode.Input);

    this.meter = new BrightnessMeter(ctx.simNanos, anode.read());

    // Edges only accumulate time; sampling happens on the frame timer.
    // Reporting here instead would restart the integration window on every
    // edge, so a PWM or blink signal would read as a flat 0 or 1.
    ctx.pinWatch('A', Edge.Both, (value) => {
      this.meter.update(this.ctx.simNanos, value);
    });

    // The LED lights when the anode is high relative to the cathode. Wokwi does
    // not simulate current, so cathode-side switching is handled by treating a
    // driven-high cathode as an off state.
    ctx.pinWatch('C', Edge.Both, () => {});

    const fps = ctx.attrNumber('fps', 80);
    const timer = ctx.timerInit(() => this.report());
    ctx.timerStart(timer, Math.max(1000, Math.round(1_000_000 / fps)), true);

    this.report();
  }

  private report(): void {
    const anodeHigh = this.ctx.pinRead('A') === HIGH;
    const cathodeHigh = this.ctx.pinRead('C') === HIGH;
    const duty = this.meter.sample(this.ctx.simNanos);
    // Both terminals high means no potential difference: the LED is dark.
    const gated = cathodeHigh && anodeHigh ? 0 : duty;
    const brightness = applyGamma(gated, this.gamma);
    const rounded = Math.round(brightness * 100) / 100;
    if (rounded === this.lastReported) return;
    this.lastReported = rounded;
    this.ctx.emit({ brightness: rounded, on: rounded > 0.02 });
  }
}

registerPart({
  type: 'wokwi-led',
  pins: ['A', 'C'],
  defaults: { color: 'red', gamma: '2.8', fps: '80' },
  create: () => new LedPart(),
});

class RgbLedPart implements Part {
  private ctx!: PartContext;
  private meters: Record<'R' | 'G' | 'B', BrightnessMeter> | null = null;
  private commonAnode = true;

  init(ctx: PartContext): void {
    this.ctx = ctx;
    this.commonAnode = ctx.attr('common', 'anode') === 'anode';

    for (const name of ['R', 'G', 'B', 'COM'] as const) ctx.pinInit(name, PinMode.Input);

    const now = ctx.simNanos;
    this.meters = {
      R: new BrightnessMeter(now, ctx.pinRead('R')),
      G: new BrightnessMeter(now, ctx.pinRead('G')),
      B: new BrightnessMeter(now, ctx.pinRead('B')),
    };

    for (const name of ['R', 'G', 'B'] as const) {
      ctx.pinWatch(name, Edge.Both, (value) => {
        this.meters![name].update(this.ctx.simNanos, value);
      });
    }

    const timer = ctx.timerInit(() => this.report());
    ctx.timerStart(timer, 1000000 / 60, true);
  }

  private report(): void {
    const now = this.ctx.simNanos;
    const raw = {
      r: this.meters!.R.sample(now),
      g: this.meters!.G.sample(now),
      b: this.meters!.B.sample(now),
    };
    // With a common anode the channel pins sink current, so a LOW pin lights it.
    const level = (v: number) => Math.round((this.commonAnode ? 1 - v : v) * 255);
    this.ctx.emit({ r: level(raw.r), g: level(raw.g), b: level(raw.b) });
  }
}

registerPart({
  type: 'wokwi-rgb-led',
  pins: ['R', 'G', 'B', 'COM'],
  defaults: { common: 'anode' },
  create: () => new RgbLedPart(),
});

class LedBarGraphPart implements Part {
  private ctx!: PartContext;
  private states: boolean[] = new Array(10).fill(false);

  init(ctx: PartContext): void {
    this.ctx = ctx;
    for (let i = 1; i <= 10; i++) {
      ctx.pinInit(`A${i}`, PinMode.Input);
      ctx.pinInit(`C${i}`, PinMode.Input);
      const index = i - 1;
      ctx.pinWatch(`A${i}`, Edge.Both, () => this.refresh(index));
      ctx.pinWatch(`C${i}`, Edge.Both, () => this.refresh(index));
    }
    this.report();
  }

  private refresh(index: number): void {
    const anode = this.ctx.pinRead(`A${index + 1}`) === HIGH;
    const cathode = this.ctx.pinRead(`C${index + 1}`) === HIGH;
    const on = anode && !cathode;
    if (this.states[index] === on) return;
    this.states[index] = on;
    this.report();
  }

  private report(): void {
    this.ctx.emit({ segments: [...this.states] });
  }
}

registerPart({
  type: 'wokwi-led-bar-graph',
  pins: [
    'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10',
    'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10',
  ],
  defaults: { color: 'red' },
  create: () => new LedBarGraphPart(),
});
