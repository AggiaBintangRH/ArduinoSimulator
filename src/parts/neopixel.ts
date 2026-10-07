/**
 * WS2812 "NeoPixel" parts: wokwi-neopixel, wokwi-led-strip,
 * wokwi-led-ring, wokwi-led-matrix.
 *
 * The protocol is timing-encoded on a single wire, so this decodes pulse
 * widths rather than clocked bits. The documented colour order is GRB at 800kHz.
 */

import { registerPart } from '../sim/registry.js';
import { Edge, HIGH, PinMode } from '../sim/net.js';
import type { Part, PartContext } from '../sim/part.js';

/** WS2812B timing, in nanoseconds. */
export const T0H = 400;
export const T1H = 800;
/** A low period this long or longer latches the frame. */
export const RESET_NANOS = 50_000;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Decodes the WS2812 one-wire protocol from pin transitions.
 *
 * A bit is measured by how long the line stays high: short pulse = 0,
 * long pulse = 1. The boundary sits between T0H and T1H.
 */
export class Ws2812Decoder {
  private bits: number[] = [];
  private riseAt: bigint | null = null;
  private fallAt: bigint | null = null;
  /** Completed pixels for the frame being received. */
  private pixels: Rgb[] = [];

  constructor(
    private pixelCount: number,
    private onFrame: (pixels: Rgb[]) => void,
  ) {}

  /** Feed a transition. `value` is the new level, `now` the sim time in ns. */
  edge(now: bigint, value: number): void {
    if (value === HIGH) {
      // A long low period before this rise latches the previous frame.
      if (this.fallAt !== null && Number(now - this.fallAt) >= RESET_NANOS) {
        this.latch();
      }
      this.riseAt = now;
      return;
    }

    if (this.riseAt === null) return;
    const highNanos = Number(now - this.riseAt);
    this.riseAt = null;
    this.fallAt = now;

    // Midpoint between the nominal 0 and 1 high times.
    const bit = highNanos >= (T0H + T1H) / 2 ? 1 : 0;
    this.bits.push(bit);

    if (this.bits.length === 24) {
      this.pixels.push(bitsToRgb(this.bits));
      this.bits = [];
      // A strip forwards surplus data to the next device; for a single part we
      // simply stop collecting once it is full.
      if (this.pixels.length >= this.pixelCount) this.latch();
    }
  }

  /** Called when the reset gap arrives, or when the strip is full. */
  latch(): void {
    if (this.pixels.length === 0) return;
    const frame = this.pixels.slice(0, this.pixelCount);
    while (frame.length < this.pixelCount) frame.push({ r: 0, g: 0, b: 0 });
    this.pixels = [];
    this.bits = [];
    this.onFrame(frame);
  }

  /** Force a latch if the line has been idle long enough. */
  tick(now: bigint): void {
    if (this.fallAt === null) return;
    if (Number(now - this.fallAt) >= RESET_NANOS) {
      this.fallAt = null;
      this.latch();
    }
  }
}

/** WS2812 sends green first, then red, then blue, MSB first. */
export function bitsToRgb(bits: readonly number[]): Rgb {
  let value = 0;
  for (const bit of bits) value = (value << 1) | bit;
  return {
    g: (value >> 16) & 0xff,
    r: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

interface StripOptions {
  pinNames: readonly string[];
  dataIn: string;
  defaultPixels: number;
}

class NeopixelStripPart implements Part {
  private ctx!: PartContext;
  private decoder!: Ws2812Decoder;
  private pixels: Rgb[] = [];

  constructor(private options: StripOptions) {}

  init(ctx: PartContext): void {
    this.ctx = ctx;
    for (const name of this.options.pinNames) ctx.pinInit(name, PinMode.Input);

    const count = this.pixelCount(ctx);
    this.pixels = Array.from({ length: count }, () => ({ r: 0, g: 0, b: 0 }));

    this.decoder = new Ws2812Decoder(count, (frame) => {
      this.pixels = frame;
      this.report();
    });

    ctx.pinWatch(this.options.dataIn, Edge.Both, (value) => {
      this.decoder.edge(this.ctx.simNanos, value);
    });

    // The decoder latches on a reset gap, but a sketch that stops updating
    // leaves the last frame pending; poll so it still reaches the display.
    const timer = ctx.timerInit(() => {
      this.decoder.tick(this.ctx.simNanos);
    });
    ctx.timerStart(timer, 1000, true);

    this.report();
  }

  private pixelCount(ctx: PartContext): number {
    const rows = Math.round(ctx.attrNumber('rows', 0));
    const cols = Math.round(ctx.attrNumber('cols', 0));
    if (rows > 0 && cols > 0) return rows * cols;
    return Math.max(1, Math.round(ctx.attrNumber('pixels', this.options.defaultPixels)));
  }

  private report(): void {
    this.ctx.emit({ pixels: this.pixels.map((p) => ({ ...p })) });
  }
}

registerPart({
  type: 'wokwi-neopixel',
  pins: ['VDD', 'DOUT', 'VSS', 'DIN'],
  create: () => new NeopixelStripPart({
    pinNames: ['VDD', 'DOUT', 'VSS', 'DIN'],
    dataIn: 'DIN',
    defaultPixels: 1,
  }),
});

registerPart({
  type: 'wokwi-led-strip',
  pins: ['VDD', 'DIN', 'VSS', 'VDD.2', 'DOUT', 'VSS.2'],
  defaults: { pixels: '8', pixelSize: '5050' },
  create: () => new NeopixelStripPart({
    pinNames: ['VDD', 'DIN', 'VSS', 'VDD.2', 'DOUT', 'VSS.2'],
    dataIn: 'DIN',
    defaultPixels: 8,
  }),
});

registerPart({
  type: 'wokwi-led-ring',
  pins: ['GND', 'VCC', 'DIN', 'DOUT'],
  defaults: { pixels: '16' },
  create: () => new NeopixelStripPart({
    pinNames: ['GND', 'VCC', 'DIN', 'DOUT'],
    dataIn: 'DIN',
    defaultPixels: 16,
  }),
});

registerPart({
  type: 'wokwi-led-matrix',
  pins: ['DIN', 'VDD', 'VSS', 'DOUT'],
  defaults: { rows: '8', cols: '8', pixelSize: '5050' },
  create: () => new NeopixelStripPart({
    pinNames: ['DIN', 'VDD', 'VSS', 'DOUT'],
    dataIn: 'DIN',
    defaultPixels: 64,
  }),
});
