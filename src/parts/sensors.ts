/** Common environmental and distance sensors. */

import { registerPart } from '../sim/registry.js';
import { Edge, PinMode } from '../sim/net.js';
import type { Part, PartContext } from '../sim/part.js';

const MICROSECOND = 1_000n;
const DHT_START_MIN_NANOS = 1_000_000n;
const DHT_RESPONSE_DELAY_NANOS = 30_000n;

/** HC-SR04 pulse-width model: 58 microseconds per centimetre. */
class HcSr04Part implements Part {
  private ctx!: PartContext;
  private distance = 400;
  private triggerTimer = -1;
  private echoTimer = -1;

  init(ctx: PartContext): void {
    this.ctx = ctx;
    ctx.pinInit('VCC');
    ctx.pinInit('GND');
    ctx.pinInit('TRIG');
    ctx.pinInit('ECHO', PinMode.Output);
    this.distance = this.clampDistance(ctx.attrNumber('distance', 400));
    this.triggerTimer = ctx.timerInit(() => this.beginEcho());
    this.echoTimer = ctx.timerInit(() => this.endEcho());
    ctx.pinWatch('TRIG', Edge.Rising, () => {
      ctx.timerStop(this.triggerTimer);
      ctx.timerStop(this.echoTimer);
      ctx.pinWrite('ECHO', 0);
      // Ignore glitches and accept the measurement only if TRIG is still high
      // after the HC-SR04's required 10 microsecond start pulse.
      ctx.timerStartNanos(this.triggerTimer, 10n * MICROSECOND);
    });
    this.emit();
  }

  private clampDistance(value: number): number {
    return Math.min(400, Math.max(2, Number.isFinite(value) ? value : 400));
  }

  private beginEcho(): void {
    if (this.ctx.pin('TRIG').read() !== 1) return;
    this.ctx.pinWrite('ECHO', 1);
    this.ctx.timerStartNanos(
      this.echoTimer,
      BigInt(Math.round(this.distance * 58)) * MICROSECOND,
    );
  }

  private endEcho(): void {
    this.ctx.pinWrite('ECHO', 0);
    this.emit();
  }

  private emit(): void {
    this.ctx.emit({ distance: this.distance, echoMicros: Math.round(this.distance * 58) });
  }

  control(name: string, value: number | string | boolean): void {
    if (name !== 'distance') return;
    this.distance = this.clampDistance(Number(value));
    this.emit();
  }

  attrChanged(name: string, value: string): void {
    if (name !== 'distance') return;
    this.distance = this.clampDistance(Number(value));
    this.emit();
  }
}

registerPart({
  type: 'wokwi-hc-sr04',
  pins: ['VCC', 'TRIG', 'ECHO', 'GND'],
  defaults: { distance: '400' },
  create: () => new HcSr04Part(),
});

/** DHT22 single-wire timing protocol, including the 40-bit response frame. */
class Dht22Part implements Part {
  private ctx!: PartContext;
  private temperature = 24;
  private humidity = 40;
  private hostLowAt: bigint | null = null;
  private responding = false;
  private frame: number[] = [];
  private bitIndex = 0;
  private phase: 'response-delay' | 'response-low' | 'response-high' | 'bit-low' | 'bit-high' =
    'response-delay';
  private timer = -1;

  init(ctx: PartContext): void {
    this.ctx = ctx;
    ctx.pinInit('VCC');
    // The module's data line is pulled high while idle, so the host's start
    // pulse is observable even when the diagram has no separate pull-up.
    ctx.pinInit('SDA', PinMode.InputPullup);
    ctx.pinInit('NC');
    ctx.pinInit('GND');
    this.temperature = this.clampTemperature(ctx.attrNumber('temperature', 24));
    this.humidity = this.clampHumidity(ctx.attrNumber('humidity', 40));
    this.timer = ctx.timerInit(() => this.advanceFrame());
    ctx.pinWatch('SDA', Edge.Both, (value) => this.observeHost(value));
    this.emit();
  }

  private observeHost(value: 0 | 1): void {
    if (this.responding) return;
    if (value === 0) {
      this.hostLowAt = this.ctx.simNanos;
      return;
    }
    if (this.hostLowAt === null) return;

    const duration = this.ctx.simNanos - this.hostLowAt;
    this.hostLowAt = null;
    if (duration < DHT_START_MIN_NANOS) return;
    this.prepareFrame();
    this.responding = true;
    this.ctx.timerStartNanos(this.timer, DHT_RESPONSE_DELAY_NANOS);
  }

  private prepareFrame(): void {
    const humidity = Math.round(this.humidity * 10);
    const rawTemperature = Math.round(Math.abs(this.temperature) * 10) |
      (this.temperature < 0 ? 0x8000 : 0);
    const bytes = [humidity >> 8, humidity & 0xff, rawTemperature >> 8, rawTemperature & 0xff];
    bytes.push(bytes.reduce((sum, byte) => (sum + byte) & 0xff, 0));
    this.frame = bytes.flatMap((byte) =>
      Array.from({ length: 8 }, (_, bit) => (byte >> (7 - bit)) & 1),
    );
    this.bitIndex = 0;
    this.phase = 'response-delay';
  }

  private advanceFrame(): void {
    if (this.phase === 'response-delay') {
      this.drive(0);
      this.phase = 'response-low';
      this.ctx.timerStartNanos(this.timer, 80_000n);
      return;
    }
    if (this.phase === 'response-low') {
      this.drive(1);
      this.phase = 'response-high';
      this.ctx.timerStartNanos(this.timer, 80_000n);
      return;
    }
    if (this.phase === 'response-high') {
      this.drive(0);
      this.phase = 'bit-low';
      this.ctx.timerStartNanos(this.timer, 50_000n);
      return;
    }
    if (this.phase === 'bit-low') {
      this.drive(1);
      this.phase = 'bit-high';
      this.ctx.timerStartNanos(this.timer, this.frame[this.bitIndex] ? 70_000n : 26_000n);
      return;
    }

    this.bitIndex++;
    if (this.bitIndex >= this.frame.length) {
      this.responding = false;
      this.ctx.pinMode('SDA', PinMode.InputPullup);
      return;
    }
    this.drive(0);
    this.phase = 'bit-low';
    this.ctx.timerStartNanos(this.timer, 50_000n);
  }

  private drive(value: 0 | 1): void {
    this.ctx.pinMode('SDA', PinMode.Output);
    this.ctx.pinWrite('SDA', value);
  }

  private clampTemperature(value: number): number {
    return Math.min(80, Math.max(-40, Number.isFinite(value) ? value : 24));
  }

  private clampHumidity(value: number): number {
    return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 40));
  }

  private emit(): void {
    this.ctx.emit({ temperature: this.temperature, humidity: this.humidity });
  }

  control(name: string, value: number | string | boolean): void {
    if (name === 'temperature') this.temperature = this.clampTemperature(Number(value));
    else if (name === 'humidity') this.humidity = this.clampHumidity(Number(value));
    else return;
    this.emit();
  }

  attrChanged(name: string, value: string): void {
    if (name === 'temperature') this.temperature = this.clampTemperature(Number(value));
    else if (name === 'humidity') this.humidity = this.clampHumidity(Number(value));
    else return;
    this.emit();
  }
}

registerPart({
  type: 'wokwi-dht22',
  pins: ['VCC', 'SDA', 'NC', 'GND'],
  defaults: { temperature: '24', humidity: '40' },
  create: () => new Dht22Part(),
});
