import { describe, it, expect } from 'vitest';
import '../src/parts/index.js';
import { swatchesFor, swatchColor } from '../src/ui/palette.js';
import { lightColorFor, LED_COLORS } from '../src/parts/led.js';
import { registeredTypes, getPartDefinition } from '../src/sim/registry.js';

describe('swatchesFor', () => {
  it('offers the LED body colours for a colour attribute', () => {
    expect(swatchesFor('wokwi-led', 'color')).toEqual(LED_COLORS);
    expect(swatchesFor('wokwi-rgb-led', 'color')).toEqual(LED_COLORS);
    expect(swatchesFor('wokwi-7segment', 'color')).toEqual(LED_COLORS);
    expect(swatchesFor('wokwi-neopixel', 'color')).toEqual(LED_COLORS);
  });

  it('offers only colours the simulation actually models', () => {
    /*
     * `lightColorFor` falls back to the body colour when it does not know one,
     * which lights the part in its own unlit colour. Offering a colour outside
     * that map would put that wrong result one click away.
     */
    for (const color of swatchesFor('wokwi-led', 'color')!) {
      expect(lightColorFor(color)).not.toBe(color);
    }
  });

  it('reads `color` as the text colour on an LCD, not a body colour', () => {
    // The attribute name is shared; what it colours is not. An LCD's own
    // default is black, which is not a colour an LED body comes in.
    expect(swatchesFor('wokwi-lcd1602', 'color')).toEqual(['black', 'white']);
    expect(swatchesFor('wokwi-lcd1602', 'color')).not.toEqual(LED_COLORS);
  });

  it('offers the backlights a character LCD is made in', () => {
    expect(swatchesFor('wokwi-lcd1602', 'background')).toEqual(['green', 'blue']);
    expect(swatchesFor('wokwi-lcd2004', 'background')).toEqual(['green', 'blue']);
  });

  it('leaves `background` alone on a part that is not an LCD', () => {
    expect(swatchesFor('wokwi-led', 'background')).toBeNull();
  });

  it('leaves everything that is not a colour as a text field', () => {
    for (const attr of ['gamma', 'fps', 'value', 'digits', 'common', 'bounce']) {
      expect(swatchesFor('wokwi-led', attr)).toBeNull();
    }
  });

  it('hands back a copy, so a caller cannot edit the palette', () => {
    const first = swatchesFor('wokwi-led', 'color')!;
    first.push('chartreuse');
    expect(swatchesFor('wokwi-led', 'color')).toEqual(LED_COLORS);
  });

  it('covers the colour attribute of every part that has one', () => {
    // A part whose colour stayed a text field would be the odd one out.
    for (const type of registeredTypes()) {
      const defaults = getPartDefinition(type)?.defaults ?? {};
      for (const attr of ['color', 'background']) {
        if (!(attr in defaults)) continue;
        expect(swatchesFor(type, attr), `${type}.${attr}`).not.toBeNull();
      }
    }
  });

  it('includes whatever the part defaults to, so something starts selected', () => {
    for (const type of registeredTypes()) {
      const defaults = getPartDefinition(type)?.defaults ?? {};
      for (const [attr, value] of Object.entries(defaults)) {
        const choices = swatchesFor(type, attr);
        if (!choices) continue;
        expect(choices, `${type}.${attr} = ${value}`).toContain(value);
      }
    }
  });
});

describe('swatchColor', () => {
  it('passes a colour through', () => {
    expect(swatchColor('red')).toBe('red');
  });

  it('paints an unset value as transparent rather than as nothing', () => {
    // An empty attribute would otherwise give a swatch with no background at
    // all, which reads as a rendering fault.
    expect(swatchColor('')).toBe('transparent');
    expect(swatchColor('   ')).toBe('transparent');
  });
});
