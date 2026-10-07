/**
 * Readable names for part types.
 *
 * `diagram.json` calls parts things like `wokwi-ntc-temperature-sensor`. That
 * string has to stay exactly as it is - it is what makes a project portable -
 * but there is no reason to make anyone read it in a menu.
 *
 * The rule is mechanical rather than a lookup table of every part: strip the
 * vendor prefix, then title-case the words, leaving the ones that are
 * initialisms alone. A table would go stale the moment a part is added; this
 * gives a sensible name for a part nobody has thought about yet.
 */

import { getBoardDefinition } from '../mcu/boards.js';

/** Words that are initialisms or product names, not words to capitalise. */
const KEEP_UPPER = new Set([
  'led',
  'lcd',
  'rgb',
  'ntc',
  'hc',
  'sr04',
  'dht',
  'dip',
  'ir',
  'tft',
  'oled',
  'usb',
  'ntsc',
  'pir',
]);

/** Words that read better joined to the number that follows them. */
const UNITS = new Set(['mm', 'segment']);

function word(part: string): string {
  if (KEEP_UPPER.has(part)) return part.toUpperCase();
  // "lcd1602", "7segment", "hc-sr04" - a run of letters glued to digits.
  const split = /^([a-z]+)(\d.*)$/.exec(part);
  if (split && KEEP_UPPER.has(split[1])) return `${split[1].toUpperCase()}${split[2]}`;
  return part.charAt(0).toUpperCase() + part.slice(1);
}

/**
 * A name to show in a menu.
 *
 * Boards use the name their definition already carries, so "Arduino Mega 2560"
 * does not come out as "Arduino Mega".
 */
export function partLabel(type: string): string {
  const board = getBoardDefinition(type);
  if (board) return board.label;

  const bare = type.replace(/^wokwi-/, '').trim();
  if (bare === '') return type;

  const words = bare.split('-').filter(Boolean);
  const out: string[] = [];
  for (const raw of words) {
    // "pushbutton-6mm" reads better as "Pushbutton 6mm" than "6 Mm".
    const unit = /^(\d+)(mm)$/.exec(raw);
    if (unit) {
      out.push(`${unit[1]}${unit[2]}`);
      continue;
    }
    // "7segment" is one token, but reads as two.
    const glued = /^(\d+)([a-z]+)$/.exec(raw);
    if (glued && UNITS.has(glued[2])) {
      out.push(`${glued[1]}-${glued[2]}`);
      continue;
    }
    if (UNITS.has(raw) && out.length > 0 && /\d$/.test(out[out.length - 1])) {
      out[out.length - 1] += `-${raw}`;
      continue;
    }
    out.push(word(raw));
  }
  // Only the first word is capitalised; the rest read as a phrase, except the
  // initialisms which `word` has already left upper-case.
  return out
    .map((w, i) => (i === 0 || w === w.toUpperCase() || /^\d/.test(w) ? w : w.toLowerCase()))
    .join(' ');
}
