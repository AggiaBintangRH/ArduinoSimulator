/**
 * SVG artwork for each part type, plus pin positions.
 *
 * Coordinates are in pixels, matching diagram.json's `left`/`top`. Wokwi snaps
 * to a 2.54mm (0.1in) grid; at the scale used here that is GRID px.
 */

import type { PartEvent } from '../sim/part.js';

/** One grid square: 0.1 inch, the standard pin pitch. */
export const GRID = 19.2;

export interface PinLayout {
  name: string;
  x: number;
  y: number;
  /** Shown on hover. */
  label?: string;
}

export interface PartVisual {
  width: number;
  height: number;
  pins: PinLayout[];
  /** Static artwork. */
  body(attrs: Record<string, string>): string;
  /** Overlay redrawn from simulation state. */
  live?(state: PartEvent, attrs: Record<string, string>): string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Arduino Uno board outline with headers. */
const UNO_TOP_LEFT = ['8', '9', '10', '11', '12', '13'];
const UNO_TOP_RIGHT = ['0', '1', '2', '3', '4', '5', '6', '7'];
const UNO_BOTTOM_POWER = ['VIN', 'GND.1', 'GND.2', '5V', '3.3V', 'RESET'];
const UNO_BOTTOM_ANALOG = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];

function unoPins(): PinLayout[] {
  const pins: PinLayout[] = [];
  // Top header, right group (digital 8-13 + AREF/GND)
  UNO_TOP_LEFT.forEach((name, i) => {
    pins.push({ name, x: 280 - i * GRID, y: 9, label: name });
  });
  pins.push({ name: 'GND.3', x: 280 - 6 * GRID, y: 9, label: 'GND' });
  pins.push({ name: 'AREF', x: 280 - 7 * GRID, y: 9, label: 'AREF' });
  // Top header, left group (digital 0-7)
  UNO_TOP_RIGHT.forEach((name, i) => {
    pins.push({ name, x: 168 - i * GRID, y: 9, label: name });
  });
  // Bottom headers
  UNO_BOTTOM_POWER.forEach((name, i) => {
    pins.push({ name, x: 100 + i * GRID, y: 191, label: name.replace(/\.\d$/, '') });
  });
  UNO_BOTTOM_ANALOG.forEach((name, i) => {
    pins.push({ name, x: 220 + i * GRID, y: 191, label: name });
  });
  return pins;
}

const VISUALS: Record<string, PartVisual> = {
  'wokwi-arduino-uno': {
    width: 300,
    height: 200,
    pins: unoPins(),
    body: () => `
      <rect x="0" y="0" width="300" height="200" rx="8" fill="#0e7c7b" stroke="#0a5f5e"/>
      <rect x="6" y="6" width="288" height="188" rx="6" fill="none" stroke="#12908f" stroke-width="1"/>
      <rect x="150" y="14" width="60" height="34" rx="3" fill="#2b2b2b"/>
      <text x="180" y="36" text-anchor="middle" fill="#ccc" font-size="11" font-family="monospace">328P</text>
      <rect x="-4" y="30" width="40" height="46" rx="3" fill="#b0b0b0" stroke="#888"/>
      <rect x="-4" y="120" width="36" height="40" rx="3" fill="#111" stroke="#000"/>
      <text x="150" y="120" text-anchor="middle" fill="#e8f5f4" font-size="15"
            font-family="system-ui, sans-serif" font-weight="600">ARDUINO UNO</text>
      <circle cx="248" cy="86" r="4" fill="#3b3"/>
      <text x="258" y="90" fill="#cfe" font-size="9" font-family="monospace">ON</text>
    `,
    live: (state) => {
      const on = state.builtinLed === true;
      return `<circle cx="248" cy="104" r="4" fill="${on ? '#ffd23f' : '#5a5a20'}"/>
              <text x="258" y="108" fill="#cfe" font-size="9" font-family="monospace">L</text>`;
    },
  },

  'wokwi-led': {
    width: 20,
    height: 40,
    pins: [
      { name: 'A', x: 6, y: 38, label: 'anode' },
      { name: 'C', x: 14, y: 38, label: 'cathode' },
    ],
    body: (attrs) => {
      const color = attrs.color ?? 'red';
      return `
        <line x1="6" y1="24" x2="6" y2="38" stroke="#999" stroke-width="1.5"/>
        <line x1="14" y1="24" x2="14" y2="38" stroke="#999" stroke-width="1.5"/>
        <path d="M4 22 L4 12 A6 6 0 0 1 16 12 L16 22 Z" fill="${esc(color)}" opacity="0.55"/>
      `;
    },
    live: (state, attrs) => {
      const brightness = typeof state.brightness === 'number' ? state.brightness : 0;
      const color = attrs.lightColor ?? attrs.color ?? 'red';
      if (brightness <= 0.02) return '';
      return `
        <path d="M4 22 L4 12 A6 6 0 0 1 16 12 L16 22 Z" fill="${esc(color)}" opacity="${brightness}"/>
        <circle cx="10" cy="16" r="${10 + brightness * 8}" fill="${esc(color)}"
                opacity="${brightness * 0.35}" filter="blur(3px)"/>
      `;
    },
  },

  'wokwi-resistor': {
    width: 60,
    height: 16,
    pins: [
      { name: '1', x: 2, y: 8 },
      { name: '2', x: 58, y: 8 },
    ],
    body: (attrs) => `
      <line x1="2" y1="8" x2="58" y2="8" stroke="#b0b0b0" stroke-width="1.5"/>
      <rect x="14" y="2" width="32" height="12" rx="3" fill="#d8c9a3" stroke="#a89878"/>
      <rect x="19" y="2" width="3" height="12" fill="#5b3a1a"/>
      <rect x="25" y="2" width="3" height="12" fill="#111"/>
      <rect x="31" y="2" width="3" height="12" fill="#c33"/>
      <rect x="39" y="2" width="3" height="12" fill="#c9a227"/>
      <title>${esc(attrs.value ?? '1000')} ohm</title>
    `,
  },

  'wokwi-pushbutton': {
    width: 40,
    height: 32,
    pins: [
      { name: '1.l', x: 2, y: 6 },
      { name: '2.l', x: 2, y: 26 },
      { name: '1.r', x: 38, y: 6 },
      { name: '2.r', x: 38, y: 26 },
    ],
    body: (attrs) => `
      <rect x="6" y="2" width="28" height="28" rx="3" fill="#2f2f33" stroke="#1a1a1d"/>
      <line x1="2" y1="6" x2="8" y2="6" stroke="#c0c0c0" stroke-width="2"/>
      <line x1="2" y1="26" x2="8" y2="26" stroke="#c0c0c0" stroke-width="2"/>
      <line x1="32" y1="6" x2="38" y2="6" stroke="#c0c0c0" stroke-width="2"/>
      <line x1="32" y1="26" x2="38" y2="26" stroke="#c0c0c0" stroke-width="2"/>
      <circle cx="20" cy="16" r="9" fill="${esc(attrs.color ?? 'red')}" stroke="#0006"/>
    `,
    live: (state, attrs) => {
      const pressed = state.pressed === true;
      return `<circle cx="20" cy="16" r="${pressed ? 7.5 : 9}"
              fill="${esc(attrs.color ?? 'red')}" stroke="#0008"
              opacity="${pressed ? 0.75 : 1}"/>`;
    },
  },

  'wokwi-potentiometer': {
    width: 60,
    height: 56,
    pins: [
      { name: 'GND', x: 14, y: 54 },
      { name: 'SIG', x: 30, y: 54 },
      { name: 'VCC', x: 46, y: 54 },
    ],
    body: () => `
      <rect x="6" y="6" width="48" height="38" rx="4" fill="#2b6cb0" stroke="#1f4f80"/>
      <circle cx="30" cy="24" r="14" fill="#e2e8f0" stroke="#94a3b8"/>
      <line x1="14" y1="44" x2="14" y2="54" stroke="#c0c0c0" stroke-width="2"/>
      <line x1="30" y1="44" x2="30" y2="54" stroke="#c0c0c0" stroke-width="2"/>
      <line x1="46" y1="44" x2="46" y2="54" stroke="#c0c0c0" stroke-width="2"/>
    `,
    live: (state) => {
      const position = typeof state.position === 'number' ? state.position : 0;
      // Sweep 270 degrees, starting at the 7-o'clock position.
      const angle = -135 + (position / 1023) * 270;
      const rad = ((angle - 90) * Math.PI) / 180;
      return `<line x1="30" y1="24" x2="${30 + Math.cos(rad) * 11}" y2="${24 + Math.sin(rad) * 11}"
              stroke="#1a202c" stroke-width="2.5" stroke-linecap="round"/>`;
    },
  },

  'wokwi-buzzer': {
    width: 40,
    height: 40,
    pins: [
      { name: '1', x: 14, y: 38 },
      { name: '2', x: 26, y: 38 },
    ],
    body: () => `
      <circle cx="20" cy="18" r="16" fill="#1a1a1a" stroke="#000"/>
      <circle cx="20" cy="18" r="3" fill="#333"/>
      <line x1="14" y1="32" x2="14" y2="38" stroke="#888" stroke-width="2"/>
      <line x1="26" y1="32" x2="26" y2="38" stroke="#c33" stroke-width="2"/>
    `,
    live: (state) => {
      if (state.playing !== true) return '';
      return `<circle cx="20" cy="18" r="18" fill="none" stroke="#4ade80" stroke-width="1.5" opacity="0.8"/>
              <circle cx="20" cy="18" r="22" fill="none" stroke="#4ade80" stroke-width="1" opacity="0.4"/>`;
    },
  },
};

/** Character LCD, sized from its attributes. */
function lcdVisual(rows: number, cols: number): PartVisual {
  const charW = 11;
  const charH = 18;
  const padX = 14;
  const padY = 14;
  const width = padX * 2 + cols * charW;
  const height = padY * 2 + rows * charH;
  return {
    width,
    height,
    pins: [
      { name: 'GND', x: 10, y: height - 2 },
      { name: 'VCC', x: 10 + GRID, y: height - 2 },
      { name: 'SDA', x: 10 + GRID * 2, y: height - 2 },
      { name: 'SCL', x: 10 + GRID * 3, y: height - 2 },
      { name: 'VSS', x: 10, y: 2 },
      { name: 'VDD', x: 10 + GRID, y: 2 },
      { name: 'V0', x: 10 + GRID * 2, y: 2 },
      { name: 'RS', x: 10 + GRID * 3, y: 2 },
      { name: 'RW', x: 10 + GRID * 4, y: 2 },
      { name: 'E', x: 10 + GRID * 5, y: 2 },
      { name: 'D0', x: 10 + GRID * 6, y: 2 },
      { name: 'D1', x: 10 + GRID * 7, y: 2 },
      { name: 'D2', x: 10 + GRID * 8, y: 2 },
      { name: 'D3', x: 10 + GRID * 9, y: 2 },
      { name: 'D4', x: 10 + GRID * 10, y: 2 },
      { name: 'D5', x: 10 + GRID * 11, y: 2 },
      { name: 'D6', x: 10 + GRID * 12, y: 2 },
      { name: 'D7', x: 10 + GRID * 13, y: 2 },
      { name: 'A', x: 10 + GRID * 14, y: 2 },
      { name: 'K', x: 10 + GRID * 15, y: 2 },
    ],
    body: (attrs) => `
      <rect x="0" y="0" width="${width}" height="${height}" rx="4" fill="#1f3a1f" stroke="#162816"/>
      <rect x="${padX - 4}" y="${padY - 4}" width="${cols * charW + 8}" height="${rows * charH + 8}"
            rx="2" fill="${esc(attrs.background ?? 'green')}" opacity="0.9"/>
    `,
    live: (state, attrs) => {
      const text = Array.isArray(state.text) ? (state.text as string[]) : [];
      const on = state.displayOn !== false;
      if (!on) return '';
      const color = esc(attrs.color ?? 'black');
      return text
        .map(
          (line, r) =>
            `<text x="${padX}" y="${padY + r * charH + 13}" font-family="monospace" font-size="14"
                   fill="${color}" xml:space="preserve">${esc(line)}</text>`,
        )
        .join('');
    },
  };
}

VISUALS['wokwi-lcd1602'] = lcdVisual(2, 16);
VISUALS['wokwi-lcd2004'] = lcdVisual(4, 20);

/** Seven-segment display. */
const SEG_PATHS: Record<string, string> = {
  A: 'M8 4 L28 4 L24 8 L12 8 Z',
  B: 'M29 5 L29 21 L25 18 L25 9 Z',
  C: 'M29 25 L29 41 L25 37 L25 28 Z',
  D: 'M8 42 L28 42 L24 38 L12 38 Z',
  E: 'M7 25 L7 41 L11 37 L11 28 Z',
  F: 'M7 5 L7 21 L11 18 L11 9 Z',
  G: 'M8 23 L28 23 L24 26 L12 26 L8 23 Z',
};

VISUALS['wokwi-7segment'] = {
  width: 46,
  height: 60,
  pins: [
    { name: 'A', x: 4, y: 58 },
    { name: 'B', x: 12, y: 58 },
    { name: 'C', x: 20, y: 58 },
    { name: 'D', x: 28, y: 58 },
    { name: 'E', x: 36, y: 58 },
    { name: 'F', x: 4, y: 2 },
    { name: 'G', x: 12, y: 2 },
    { name: 'DP', x: 20, y: 2 },
    { name: 'COM', x: 28, y: 2 },
    { name: 'DIG1', x: 36, y: 2 },
  ],
  body: () => `<rect x="0" y="0" width="46" height="52" rx="3" fill="#1a1a1a"/>`,
  live: (state, attrs) => {
    const digits = Array.isArray(state.digits) ? (state.digits as boolean[][]) : [];
    const lit = digits[0] ?? [];
    const color = esc(attrs.color ?? 'red');
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const segs = names
      .map((n, i) => `<path d="${SEG_PATHS[n]}" fill="${color}" opacity="${lit[i] ? 1 : 0.08}"/>`)
      .join('');
    const dp = `<circle cx="34" cy="40" r="2.5" fill="${color}" opacity="${lit[7] ? 1 : 0.08}"/>`;
    return segs + dp;
  },
};

/** Addressable LED strip / ring / matrix. */
function neopixelVisual(kind: 'strip' | 'ring' | 'matrix'): PartVisual {
  return {
    width: 200,
    height: 40,
    pins:
      kind === 'ring'
        ? [
            { name: 'GND', x: 4, y: 38 },
            { name: 'VCC', x: 16, y: 38 },
            { name: 'DIN', x: 28, y: 38 },
            { name: 'DOUT', x: 40, y: 38 },
          ]
        : [
            { name: 'VDD', x: 4, y: 38 },
            { name: 'DIN', x: 16, y: 38 },
            { name: 'VSS', x: 28, y: 38 },
            { name: 'DOUT', x: 40, y: 38 },
          ],
    body: () => `<rect x="0" y="0" width="200" height="30" rx="3" fill="#111" stroke="#000"/>`,
    live: (state) => {
      const pixels = Array.isArray(state.pixels)
        ? (state.pixels as { r: number; g: number; b: number }[])
        : [];
      return pixels
        .map((p, i) => {
          const x = 10 + i * 22;
          const bright = (p.r + p.g + p.b) / 3 / 255;
          return `<rect x="${x}" y="6" width="18" height="18" rx="3"
                  fill="rgb(${p.r},${p.g},${p.b})" stroke="#333"/>
                  ${bright > 0.05 ? `<circle cx="${x + 9}" cy="15" r="14" fill="rgb(${p.r},${p.g},${p.b})" opacity="${bright * 0.4}"/>` : ''}`;
        })
        .join('');
    },
  };
}

VISUALS['wokwi-neopixel'] = neopixelVisual('strip');
VISUALS['wokwi-led-strip'] = neopixelVisual('strip');
VISUALS['wokwi-led-ring'] = neopixelVisual('ring');
VISUALS['wokwi-led-matrix'] = neopixelVisual('matrix');

VISUALS['wokwi-slide-switch'] = {
  width: 40,
  height: 30,
  pins: [
    { name: '1', x: 6, y: 28 },
    { name: '2', x: 20, y: 28 },
    { name: '3', x: 34, y: 28 },
  ],
  body: () => `
    <rect x="2" y="2" width="36" height="20" rx="3" fill="#b8c0c8" stroke="#8a9298"/>
    <line x1="6" y1="22" x2="6" y2="28" stroke="#c0c0c0" stroke-width="2"/>
    <line x1="20" y1="22" x2="20" y2="28" stroke="#c0c0c0" stroke-width="2"/>
    <line x1="34" y1="22" x2="34" y2="28" stroke="#c0c0c0" stroke-width="2"/>
  `,
  live: (state) => {
    const right = state.position === 'right';
    return `<rect x="${right ? 22 : 6}" y="5" width="12" height="14" rx="2" fill="#2d3748"/>`;
  },
};

VISUALS['wokwi-text'] = {
  width: 120,
  height: 20,
  pins: [],
  body: (attrs) =>
    `<text x="0" y="14" font-family="system-ui, sans-serif" font-size="14" fill="var(--fg)">${esc(
      attrs.text ?? '',
    )}</text>`,
};

/** Fallback artwork for a part with no dedicated drawing. */
export function genericVisual(type: string, pinNames: readonly string[]): PartVisual {
  const cols = Math.max(2, Math.ceil(pinNames.length / 2));
  const width = Math.max(80, cols * GRID + 12);
  const height = 60;
  const pins: PinLayout[] = pinNames.map((name, i) => {
    const top = i < Math.ceil(pinNames.length / 2);
    const idx = top ? i : i - Math.ceil(pinNames.length / 2);
    return { name, x: 10 + idx * GRID, y: top ? 2 : height - 2, label: name };
  });
  return {
    width,
    height,
    pins,
    body: () => `
      <rect x="0" y="6" width="${width}" height="${height - 12}" rx="4" fill="#3f4a5a" stroke="#2b3441"/>
      <text x="${width / 2}" y="${height / 2 + 4}" text-anchor="middle" fill="#dbe4f0"
            font-size="10" font-family="monospace">${esc(type.replace(/^wokwi-|^board-/, ''))}</text>
    `,
  };
}

export function getVisual(type: string, pinNames: readonly string[] = []): PartVisual {
  return VISUALS[type] ?? genericVisual(type, pinNames);
}

export function hasVisual(type: string): boolean {
  return type in VISUALS;
}
