/**
 * Analog-lite sensor parts.
 *
 * Wokwi does not solve circuits: each of these computes an output voltage from
 * an attribute and drives it onto its output pin with dacWrite. That is exactly
 * how the real Wokwi parts behave (docs/wokwi/02-parts.md).
 */

import { registerPart } from '../sim/registry.js';
import { PinMode, VCC_VOLTS } from '../sim/net.js';
import type { Part, PartContext } from '../sim/part.js';

/** Convert a 0..1023 position into a voltage against the 5V reference. */
export function positionToVolts(position: number): number {
  return (Math.min(Math.max(position, 0), 1023) / 1023) * VCC_VOLTS;
}

/** wokwi-potentiometer: GND / SIG / VCC, `value` 0..1023. */
class PotentiometerPart implements Part {
  private ctx!: PartContext;
  private position = 0;

  init(ctx: PartContext): void {
    this.ctx = ctx;
    ctx.pinInit('GND', PinMode.Input);
    ctx.pinInit('VCC', PinMode.Input);
    ctx.pinInit('SIG', PinMode.Analog);
    this.position = ctx.attrNumber('value', 0);
    this.apply();
  }

  private apply(): void {
    this.ctx.dacWrite('SIG', positionToVolts(this.position));
    this.ctx.emit({ position: this.position, volts: positionToVolts(this.position) });
  }

  control(name: string, value: number | string | boolean): void {
    if (name === 'position') {
      // Automation scenarios express the position as 0.0..1.0.
      this.position = Math.round(Number(value) * 1023);
      this.apply();
    } else if (name === 'value') {
      this.position = Number(value);
      this.apply();
    }
  }

  attrChanged(name: string, value: string): void {
    if (name !== 'value') return;
    this.position = Number(value);
    this.apply();
  }
}

registerPart({
  type: 'wokwi-potentiometer',
  pins: ['GND', 'SIG', 'VCC'],
  defaults: { value: '0' },
  create: () => new PotentiometerPart(),
});

registerPart({
  type: 'wokwi-slide-potentiometer',
  pins: ['GND', 'SIG', 'VCC'],
  defaults: { value: '0', travelLength: '30' },
  create: () => new PotentiometerPart(),
});

/**
 * wokwi-ntc-temperature-sensor.
 *
 * The module is a 10K NTC in series with a 10K resistor. Resistance follows the
 * beta equation, and the output is the divider voltage.
 */
export function ntcVoltage(tempC: number, beta: number, r25 = 10_000, series = 10_000): number {
  const t0 = 298.15; // 25C in kelvin
  const t = tempC + 273.15;
  const resistance = r25 * Math.exp(beta * (1 / t - 1 / t0));
  // The NTC sits on the high side, so the output rises as temperature rises.
  return (VCC_VOLTS * series) / (series + resistance);
}

class NtcPart implements Part {
  private ctx!: PartContext;
  private temperature = 24;
  private beta = 3950;

  init(ctx: PartContext): void {
    this.ctx = ctx;
    ctx.pinInit('VCC', PinMode.Input);
    ctx.pinInit('GND', PinMode.Input);
    ctx.pinInit('OUT', PinMode.Analog);
    this.temperature = ctx.attrNumber('temperature', 24);
    this.beta = ctx.attrNumber('beta', 3950);
    this.apply();
  }

  private apply(): void {
    const volts = ntcVoltage(this.temperature, this.beta);
    this.ctx.dacWrite('OUT', volts);
    this.ctx.emit({ temperature: this.temperature, volts });
  }

  control(name: string, value: number | string | boolean): void {
    if (name !== 'temperature') return;
    this.temperature = Number(value);
    this.apply();
  }

  attrChanged(name: string, value: string): void {
    if (name === 'temperature') this.temperature = Number(value);
    else if (name === 'beta') this.beta = Number(value);
    else return;
    this.apply();
  }
}

registerPart({
  type: 'wokwi-ntc-temperature-sensor',
  pins: ['VCC', 'OUT', 'GND'],
  defaults: { temperature: '24', beta: '3950' },
  create: () => new NtcPart(),
});

/**
 * wokwi-photoresistor-sensor.
 *
 * LDR resistance from the lux/gamma model, divided against a fixed 10k.
 * Per the docs the digital output goes HIGH in the dark, LOW in light.
 */
export function ldrResistance(lux: number, rl10: number, gamma: number): number {
  const safeLux = Math.max(lux, 0.001);
  // rl10 is the resistance in kilo-ohms at 10 lux.
  return rl10 * 1000 * Math.pow(10 / safeLux, gamma);
}

class PhotoresistorPart implements Part {
  private ctx!: PartContext;
  private lux = 500;

  init(ctx: PartContext): void {
    this.ctx = ctx;
    ctx.pinInit('VCC', PinMode.Input);
    ctx.pinInit('GND', PinMode.Input);
    ctx.pinInit('AO', PinMode.Analog);
    ctx.pinInit('DO', PinMode.Output);
    this.lux = ctx.attrNumber('lux', 500);
    this.apply();
  }

  private apply(): void {
    const rl10 = this.ctx.attrNumber('rl10', 50);
    const gamma = this.ctx.attrNumber('gamma', 0.7);
    const threshold = this.ctx.attrNumber('threshold', 2.5);
    const r = ldrResistance(this.lux, rl10, gamma);
    const volts = (VCC_VOLTS * 10_000) / (10_000 + r);
    this.ctx.dacWrite('AO', volts);
    // Dark -> low voltage -> DO high.
    this.ctx.pinWrite('DO', volts < threshold ? 1 : 0);
    this.ctx.emit({ lux: this.lux, volts });
  }

  control(name: string, value: number | string | boolean): void {
    if (name !== 'lux') return;
    this.lux = Number(value);
    this.apply();
  }

  attrChanged(name: string, value: string): void {
    if (name === 'lux') this.lux = Number(value);
    this.apply();
  }
}

registerPart({
  type: 'wokwi-photoresistor-sensor',
  pins: ['VCC', 'GND', 'DO', 'AO'],
  defaults: { lux: '500', threshold: '2.5', rl10: '50', gamma: '0.7' },
  create: () => new PhotoresistorPart(),
});
