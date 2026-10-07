/**
 * Colour choices for the inspector.
 *
 * A colour attribute is a colour, not a string to be spelled correctly. The
 * inspector offers the choices as swatches so there is nothing to type and
 * nothing to get wrong.
 *
 * The LED list is the simulator's own: `lightColorFor` knows what light each
 * body colour emits, and anything outside that map falls back to using the
 * body colour as the light, which looks wrong. Offering exactly the colours
 * the simulation models keeps the picker honest.
 */

import { LED_COLORS } from '../parts/led.js';

/** Backlights a character LCD is actually made in. */
const LCD_BACKGROUNDS = ['green', 'blue'];

/**
 * Character colours for an LCD.
 *
 * `color` does not mean the same thing on every part: on an LED it is the
 * body, on an LCD it is the text printed on the backlight. Offering the LED
 * palette here would leave the LCD's own default - black - missing from its
 * own picker.
 */
const LCD_TEXT = ['black', 'white'];

function isLcd(partType: string): boolean {
  return partType.startsWith('wokwi-lcd');
}

/**
 * The colours to offer for an attribute, or null when it is not a colour and
 * should stay a text field.
 */
export function swatchesFor(partType: string, attr: string): string[] | null {
  if (attr === 'background') return isLcd(partType) ? [...LCD_BACKGROUNDS] : null;
  if (attr === 'color') return isLcd(partType) ? [...LCD_TEXT] : [...LED_COLORS];
  if (attr === 'lightColor') return [...LED_COLORS];
  return null;
}

/**
 * A CSS colour to paint a swatch with.
 *
 * The values are already CSS colour names, so this is only here to keep the
 * one that is not - an empty attribute meaning "unset" - from painting a
 * transparent swatch that looks like a rendering fault.
 */
export function swatchColor(value: string): string {
  return value.trim() === '' ? 'transparent' : value;
}
