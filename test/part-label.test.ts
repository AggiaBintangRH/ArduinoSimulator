import { describe, it, expect } from 'vitest';
import '../src/parts/index.js';
import { partLabel } from '../src/ui/part-label.js';
import { registeredTypes } from '../src/sim/registry.js';
import { boardDefinitions } from '../src/mcu/boards.js';

describe('partLabel', () => {
  it('drops the vendor prefix', () => {
    expect(partLabel('wokwi-buzzer')).toBe('Buzzer');
    expect(partLabel('wokwi-resistor')).toBe('Resistor');
  });

  it('leaves initialisms upper-case', () => {
    expect(partLabel('wokwi-led')).toBe('LED');
    expect(partLabel('wokwi-rgb-led')).toBe('RGB LED');
    expect(partLabel('wokwi-ntc-temperature-sensor')).toBe('NTC temperature sensor');
    expect(partLabel('wokwi-dip-switch-8')).toBe('DIP switch 8');
  });

  it('keeps an initialism joined to its model number', () => {
    expect(partLabel('wokwi-lcd1602')).toBe('LCD1602');
    expect(partLabel('wokwi-lcd2004')).toBe('LCD2004');
  });

  it('reads a number glued to a word as two', () => {
    expect(partLabel('wokwi-7segment')).toBe('7-segment');
  });

  it('keeps a measurement with its number', () => {
    expect(partLabel('wokwi-pushbutton-6mm')).toBe('Pushbutton 6mm');
  });

  it('writes the rest as a phrase, not Title Case', () => {
    expect(partLabel('wokwi-slide-potentiometer')).toBe('Slide potentiometer');
    expect(partLabel('wokwi-led-bar-graph')).toBe('LED bar graph');
  });

  it('uses a board its own name, so the model number survives', () => {
    // "wokwi-arduino-mega" would otherwise come out as "Arduino mega".
    expect(partLabel('wokwi-arduino-mega')).toBe('Arduino Mega 2560');
    expect(partLabel('wokwi-arduino-uno')).toBe('Arduino Uno');
  });

  it('names a part nobody has thought about yet', () => {
    // The rule is mechanical on purpose: a lookup table would go stale the
    // moment a part is added.
    expect(partLabel('wokwi-servo-motor')).toBe('Servo motor');
    expect(partLabel('wokwi-ir-receiver')).toBe('IR receiver');
  });

  it('falls back to the type when there is nothing else', () => {
    expect(partLabel('wokwi-')).toBe('wokwi-');
    expect(partLabel('unprefixed')).toBe('Unprefixed');
  });

  it('gives every part in the picker a name with no prefix left in it', () => {
    const types = [...boardDefinitions().map((b) => b.type), ...registeredTypes()];
    expect(types.length).toBeGreaterThan(10);
    for (const type of types) {
      const label = partLabel(type);
      expect(label).not.toContain('wokwi');
      expect(label).not.toContain('-arduino');
      expect(label.trim()).toBe(label);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('gives each part a distinct name', () => {
    // Two parts reading the same in the menu would be unpickable.
    const types = [...boardDefinitions().map((b) => b.type), ...registeredTypes()];
    const labels = types.map(partLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
