/**
 * Colour maths.
 *
 * Kept out of both the simulation and the UI because both need it: the
 * inspector to run a colour wheel, and the LED to work out what light a body
 * of a given colour emits.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsv {
  /** Degrees, 0-360. */
  h: number;
  /** 0-1. */
  s: number;
  /** 0-1. */
  v: number;
}

/**
 * The colour names this project ships in its own defaults and palettes.
 *
 * Not the whole CSS list: only names that actually appear as a part's default
 * or in a picker need to survive a round trip through the wheel.
 */
const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  pink: '#ffc0cb',
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function byteToHex(n: number): string {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
}

/** Parse `#rgb`, `#rrggbb` or one of the names above. Null if neither. */
export function parseColor(value: string): Rgb | null {
  const text = value.trim().toLowerCase();
  if (text === '') return null;
  const hex = NAMED[text] ?? text;

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex);
  if (long) {
    return {
      r: parseInt(long[1], 16),
      g: parseInt(long[2], 16),
      b: parseInt(long[3], 16),
    };
  }
  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const span = max - min;

  let h = 0;
  if (span !== 0) {
    if (max === rn) h = ((gn - bn) / span) % 6;
    else if (max === gn) h = (bn - rn) / span + 2;
    else h = (rn - gn) / span + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : span / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/**
 * The light a body of this colour emits when lit.
 *
 * A lit LED is brighter and more saturated than its unlit body, so this pushes
 * both up rather than returning the colour unchanged. Returning it unchanged
 * is what made a custom colour look broken: the part "lit" in exactly the
 * shade it already was.
 *
 * A colour with no hue of its own - black, or a grey - has nothing to
 * saturate, so it lights white, the way a clear LED does.
 */
export function emittedColor(value: string): string | null {
  const rgb = parseColor(value);
  if (!rgb) return null;
  const hsv = rgbToHsv(rgb);
  if (hsv.s < 0.05) return '#ffffff';
  return toHex(hsvToRgb({ h: hsv.h, s: clamp(hsv.s * 0.85, 0, 1), v: 1 }));
}

/**
 * Hand-tuned light for the body colours this project ships.
 *
 * Kept because they were chosen by eye; `emittedColor` handles everything
 * else, which is now anything that comes off the colour wheel.
 */
const TUNED_LIGHT: Record<string, string> = {
  red: '#ff2d2d',
  green: '#2dff2d',
  blue: '#4d9dff',
  yellow: '#ffee2d',
  orange: '#ffa32d',
  white: '#ffffff',
  purple: '#c34dff',
};

/** The body colours with a hand-tuned light of their own. */
export const LED_COLORS = Object.keys(TUNED_LIGHT);

/**
 * The colour an LED of this body colour shows when lit.
 *
 * Never the body colour unchanged: a part "lit" in exactly the shade it
 * already was does not look lit at all.
 */
export function ledLightColor(bodyColor: string): string {
  return TUNED_LIGHT[bodyColor.toLowerCase()] ?? emittedColor(bodyColor) ?? bodyColor;
}
