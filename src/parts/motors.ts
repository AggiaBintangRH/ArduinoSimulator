/** Small motor models driven by the simulator's digital pin timing. */

import { registerPart } from '../sim/registry.js';
import { Edge, PinMode } from '../sim/net.js';
import type { Part, PartContext } from '../sim/part.js';

const NANOSECONDS_PER_MICROSECOND = 1_000n;
const SERVO_MIN_PULSE_US = 544;
const SERVO_MAX_PULSE_US = 2_400;

class ServoPart implements Part {
  private ctx!: PartContext;
  private pulseStartedAt: bigint | null = null;
  private angle = 90;

  init(ctx: PartContext): void {
    this.ctx = ctx;
    ctx.pinInit('PWM');
    ctx.pinInit('V+', PinMode.Input);
    ctx.pinInit('GND', PinMode.Input);
    this.angle = this.clampAngle(ctx.attrNumber('angle', 90));
    ctx.pinWatch('PWM', Edge.Both, (level) => {
      if (level === 1) {
        this.pulseStartedAt = ctx.simNanos;
        return;
      }
      if (this.pulseStartedAt === null) return;
      const pulseNanos = ctx.simNanos - this.pulseStartedAt;
      this.pulseStartedAt = null;
      const pulseMicros = Number(pulseNanos) / Number(NANOSECONDS_PER_MICROSECOND);
      if (pulseMicros < SERVO_MIN_PULSE_US || pulseMicros > SERVO_MAX_PULSE_US) return;
      const fraction = (pulseMicros - SERVO_MIN_PULSE_US) /
        (SERVO_MAX_PULSE_US - SERVO_MIN_PULSE_US);
      this.angle = this.clampAngle(fraction * 180);
      this.emit();
    });
    this.emit();
  }

  private clampAngle(value: number): number {
    return Math.min(180, Math.max(0, Number.isFinite(value) ? value : 90));
  }

  private emit(): void {
    this.ctx.emit({ angle: this.angle });
  }

  control(name: string, value: number | string | boolean): void {
    if (name !== 'angle') return;
    this.angle = this.clampAngle(Number(value));
    this.emit();
  }

  attrChanged(name: string, value: string): void {
    if (name !== 'angle') return;
    this.angle = this.clampAngle(Number(value));
    this.emit();
  }
}

registerPart({
  type: 'wokwi-servo',
  pins: ['PWM', 'V+', 'GND'],
  defaults: { angle: '90', horn: 'single', hornColor: '#ccc' },
  create: () => new ServoPart(),
});
