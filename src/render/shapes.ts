/**
 * SVG artwork for each part type, plus pin positions.
 *
 * Coordinates are in pixels, matching diagram.json's `left`/`top`. Wokwi snaps
 * to a 2.54mm (0.1in) grid; at the scale used here that is GRID px.
 */

import type { PartEvent } from '../sim/part.js';
import { ledLightColor } from '../util/color.js';
import {
  MEGA_ART_BODY,
  MEGA_ART_WIDTH,
  MEGA_ART_HEIGHT,
  MEGA_LED_L,
  MEGA_PIN_LAYOUT,
  MEGA_PIN_LABELS,
  MEGA_RESET_BUTTON,
} from './boards/arduino-mega-art.js';
import {
  UNO_ART_BODY,
  UNO_ART_WIDTH,
  UNO_ART_HEIGHT,
  UNO_LED_L,
  UNO_PIN_LAYOUT,
  UNO_PIN_LABELS,
} from './boards/arduino-uno-art.js';
import { BOARD_PIN_PITCH } from './boards/header-art.js';
import {
  WIRE_JUNCTION_CENTER,
  WIRE_JUNCTION_PIN,
  WIRE_JUNCTION_SIZE,
  WIRE_JUNCTION_TYPE,
} from '../parts/wire-junction.js';

/** One grid square: 0.1 inch, the standard pin pitch. */
export const GRID = BOARD_PIN_PITCH;

/** How far a pin sits in from the edge of the part's box. */
export const PIN_INSET = 2;

/**
 * How much lead shows between a pad and the body it belongs to.
 *
 * Every part whose leads are generated insets its body by `BODY_INSET` from
 * the edge of its box, so that gap - and therefore every lead in the diagram -
 * comes out the same length. Left to each part to decide, they came out at 4,
 * 6 and 8px, and one part had its pads buried in its body entirely.
 */
export const LEAD_GAP = 6;
export const BODY_INSET = PIN_INSET + LEAD_GAP;

export interface PinLayout {
  name: string;
  x: number;
  y: number;
  /** Shown on hover. */
  label?: string;
}

/**
 * A spot on the artwork the user can press, like the board's reset button.
 *
 * `momentary` controls send `true` on press and `false` on release, so a part
 * can model "held down" rather than just "clicked".
 */
export interface PartControl {
  /** Control name passed to `Simulation.setControl`. */
  name: string;
  label: string;
  x: number;
  y: number;
  r: number;
  momentary?: boolean;
  /**
   * Set for a control that latches: each press sends the opposite of what the
   * part last reported. A switch is not momentary - it stays where it is put -
   * and without this a press could only ever send `true`, so a switch could be
   * flipped once and never back.
   */
  toggle?: boolean;
  /**
   * Reads the control's current value out of the part's last event.
   *
   * A toggle flips what the part itself reports rather than a copy kept
   * alongside it, so the two cannot drift apart - and a switch whose starting
   * position came from its attributes flips the right way on the first press.
   */
  value?: (state: PartEvent) => boolean;
}

export interface PartVisual {
  width: number;
  height: number;
  pins: PinLayout[];
  /** Pressable spots drawn over the artwork. */
  controls?: PartControl[];
  /** Static artwork. */
  body(attrs: Record<string, string>): string;
  /** Overlay redrawn from simulation state. */
  live?(state: PartEvent, attrs: Record<string, string>): string;
  /** Dedicated board pin-name artwork, rendered above wires in board coordinates. */
  pinLabels?(): string;
  /** Pin artwork is a small marker inside the part bounds, not a label outside it. */
  pinLabelsInsideBody?: boolean;
  /**
   * Set when artwork draws its own sockets or pads. These parts supply their
   * names through `pinLabels`; other parts get generated pads and names.
   */
  drawsOwnPins?: boolean;
  /**
   * Set when the artwork draws its own leads - the legs between the body and
   * the pads - because their shape is part of the part: an LED's splay out,
   * a resistor's run straight through. Everything else gets a straight lead
   * drawn from the pin table, so no pad is left floating beside its body.
   */
  drawsOwnLeads?: boolean;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function servoHorn(angle: number, color: string, style: string): string {
  const arms = style === 'cross'
    ? '<rect x="33" y="12" width="6" height="44" rx="3"/>' +
      '<rect x="15" y="32" width="42" height="4" rx="2"/>'
    : style === 'double'
      ? '<rect x="33" y="14" width="6" height="40" rx="3"/>' +
        '<rect x="13" y="31" width="46" height="6" rx="3"/>'
      : '<rect x="13" y="31" width="46" height="6" rx="3"/>';
  return `<g class="servo-horn" transform="rotate(${angle} 36 34)" fill="${esc(color)}" stroke="#656b70">` +
    `${arms}<circle cx="36" cy="34" r="4" fill="#f6f7f8"/></g>`;
}

const VISUALS: Record<string, PartVisual> = {
  [WIRE_JUNCTION_TYPE]: {
    drawsOwnPins: true,
    drawsOwnLeads: true,
    pinLabelsInsideBody: true,
    width: WIRE_JUNCTION_SIZE,
    height: WIRE_JUNCTION_SIZE,
    pins: [{ name: WIRE_JUNCTION_PIN, x: WIRE_JUNCTION_CENTER, y: WIRE_JUNCTION_CENTER }],
    body: () => '',
    pinLabels: () =>
      '<circle class="wire-junction-mark" cx="' + WIRE_JUNCTION_CENTER +
      '" cy="' + WIRE_JUNCTION_CENTER + '" r="3.5"/>',
  },

  'wokwi-arduino-uno': {
    drawsOwnPins: true,
    width: UNO_ART_WIDTH,
    height: UNO_ART_HEIGHT,
    pins: UNO_PIN_LAYOUT,
    body: () => UNO_ART_BODY,
    pinLabels: () => UNO_PIN_LABELS,
    live: (state) => {
      const on = state.builtinLed === true;
      return on
        ? `<circle cx="${UNO_LED_L.x}" cy="${UNO_LED_L.y}" r="${UNO_LED_L.r}" fill="#ffd23f"/>`
        : '';
    },
  },

  'wokwi-arduino-mega': {
    drawsOwnPins: true,
    width: MEGA_ART_WIDTH,
    height: MEGA_ART_HEIGHT,
    pins: MEGA_PIN_LAYOUT,
    controls: [
      {
        name: 'reset',
        label: 'Reset',
        momentary: true,
        ...MEGA_RESET_BUTTON,
      },
    ],
    body: () => MEGA_ART_BODY,
    pinLabels: () => MEGA_PIN_LABELS,
    live: (state) => {
      // The upstream artwork leaves the LED windows empty; the glow is ours.
      const on = state.builtinLed === true;
      if (!on) return '';
      // The artwork draws the L indicator dark; lighting it is the live layer's
      // job, so the two cannot disagree about whether the sketch is running.
      const cx = MEGA_LED_L.x + 7;
      const cy = MEGA_LED_L.y + 4;
      return `<rect x="${MEGA_LED_L.x}" y="${MEGA_LED_L.y}" width="14" height="8"
                    rx="1.5" fill="#ff6b6b"/>
              <circle cx="${cx}" cy="${cy}" r="13" fill="#ff8080" opacity="0.35"/>`;
    },
  },

  /*
   * A 5mm LED, seen from the front.
   *
   * The legs are one pin pitch apart, as on the real part. At the 8px they
   * were, no two pins on the board could ever line up with them, and there
   * was not room to print which leg was which.
   *
   * The insides are drawn because they are how you tell the legs apart
   * without reading anything: the anode is the thin post, the cathode the
   * broad anvil holding the cup the die sits in. That is the same cue the
   * real part gives, and it survives being scaled down to a thumbnail.
   */
  'wokwi-led': {
    drawsOwnLeads: true,
    width: 32,
    height: 40,
    pins: [
      { name: 'A', x: 6.4, y: 38, label: 'anode' },
      { name: 'C', x: 25.6, y: 38, label: 'cathode' },
    ],
    body: (attrs) => {
      const color = attrs.color ?? 'red';
      return `
        <line x1="13" y1="27" x2="6.4" y2="38" stroke="#a8adb4" stroke-width="2"
              stroke-linecap="round"/>
        <line x1="19" y1="27" x2="25.6" y2="38" stroke="#a8adb4" stroke-width="2"
              stroke-linecap="round"/>

        <!--
          The frame, in a dark metal so it still reads through the tinted
          envelope drawn over it. Anode on the left: a thin post. Cathode on
          the right: the broad anvil, and the cup its die sits in.
        -->
        <rect x="12.1" y="15" width="1.8" height="11" fill="#5b636b"/>
        <path d="M17.6 26 L21.4 26 L21.4 17 L22.6 17 L23 11 L16 11 L16.4 17 L17.6 17 Z"
              fill="#5b636b"/>
        <path d="M17.5 12.2 L21.5 12.2 L20.9 16.4 L18.1 16.4 Z" fill="#31373d"/>
        <rect x="18.4" y="13" width="2.2" height="2.4" rx="0.4" fill="${esc(color)}"/>
        <path d="M13 15.4 Q12.2 9.6 19 13.4" fill="none" stroke="#dfe3e8"
              stroke-width="0.7" stroke-linecap="round"/>

        <!-- Envelope, then the flange it stands on. -->
        <path d="M8 27 L8 13 A8 8 0 0 1 24 13 L24 27 Z" fill="${esc(color)}"
              opacity="0.34"/>
        <path d="M10.6 25 L10.6 13.8 A5.4 5.4 0 0 1 13.4 9.2" fill="none"
              stroke="#fff" stroke-width="1.2" opacity="0.4" stroke-linecap="round"/>
        <rect x="6.6" y="25.6" width="18.8" height="3.4" rx="1.4"
              fill="${esc(color)}" opacity="0.5"/>
      `;
    },
    live: (state, attrs) => {
      const brightness = typeof state.brightness === 'number' ? state.brightness : 0;
      // A lit LED is brighter than its body, so the light is worked out from
      // the body colour rather than being it. `lightColor` overrides.
      const color = attrs.lightColor ?? ledLightColor(attrs.color ?? 'red');
      if (brightness <= 0.02) return '';
      return `
        <path d="M8 27 L8 13 A8 8 0 0 1 24 13 L24 27 Z" fill="${esc(color)}"
              opacity="${brightness}"/>
        <circle cx="16" cy="16" r="${12 + brightness * 8}" fill="${esc(color)}"
                opacity="${brightness * 0.35}" filter="blur(3px)"/>
      `;
    },
  },

  'wokwi-resistor': {
    drawsOwnLeads: true,
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
    drawsOwnLeads: true,
    width: 40,
    height: 32,
    /*
     * The cap is the control. Without this the part had no pressable spot at
     * all: `PushbuttonPart.control` existed and nothing ever called it, so
     * clicking the button only selected it.
     *
     * Momentary, like the real thing: it conducts while held. A sketch that
     * wants a button to toggle something latches it itself, which is what the
     * sketch on the bench has to do too.
     */
    controls: [{ name: 'pressed', label: 'Press', x: 20, y: 16, r: 9, momentary: true }],
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
    drawsOwnLeads: true,
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
    drawsOwnLeads: true,
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

  'wokwi-hc-sr04': {
    drawsOwnLeads: true,
    width: 76,
    height: 52,
    pins: [
      { name: 'VCC', x: 8, y: 50 },
      { name: 'TRIG', x: 28, y: 50 },
      { name: 'ECHO', x: 48, y: 50 },
      { name: 'GND', x: 68, y: 50 },
    ],
    body: () => `
      <rect x="3" y="4" width="70" height="40" rx="5" fill="#236b74" stroke="#174d55"/>
      <circle cx="23" cy="23" r="13" fill="#d7e0e5" stroke="#123b43" stroke-width="2"/>
      <circle cx="53" cy="23" r="13" fill="#d7e0e5" stroke="#123b43" stroke-width="2"/>
      <circle cx="23" cy="23" r="8" fill="#607d8b"/>
      <circle cx="53" cy="23" r="8" fill="#607d8b"/>
      <line x1="8" y1="43" x2="8" y2="50" stroke="#c0c0c0" stroke-width="2"/>
      <line x1="28" y1="43" x2="28" y2="50" stroke="#c0c0c0" stroke-width="2"/>
      <line x1="48" y1="43" x2="48" y2="50" stroke="#c0c0c0" stroke-width="2"/>
      <line x1="68" y1="43" x2="68" y2="50" stroke="#c0c0c0" stroke-width="2"/>
    `,
    live: (state) => {
      const distance = typeof state.distance === 'number' ? state.distance : 400;
      return `<text x="38" y="8" text-anchor="middle" fill="#e2e8f0" font-size="5">${distance.toFixed(0)} cm</text>`;
    },
  },

  'wokwi-dht22': {
    drawsOwnLeads: true,
    width: 80,
    height: 58,
    pins: [
      { name: 'VCC', x: 10, y: 56 },
      { name: 'SDA', x: 30, y: 56 },
      { name: 'NC', x: 50, y: 56 },
      { name: 'GND', x: 70, y: 56 },
    ],
    body: () => `
      <rect x="4" y="4" width="72" height="46" rx="6" fill="#e8f0f2" stroke="#84969b"/>
      <rect x="12" y="10" width="56" height="25" rx="3" fill="#d9e5e7" stroke="#aab9bc"/>
      ${[17, 23, 29].map((y) => `<line x1="17" y1="${y}" x2="63" y2="${y}" stroke="#b5c3c6" stroke-width="2"/>`).join('')}
      <text x="40" y="44" text-anchor="middle" fill="#34454a" font-size="6" font-family="monospace">DHT22</text>
      <line x1="10" y1="49" x2="10" y2="56" stroke="#c0c0c0" stroke-width="2"/>
      <line x1="30" y1="49" x2="30" y2="56" stroke="#c0c0c0" stroke-width="2"/>
      <line x1="50" y1="49" x2="50" y2="56" stroke="#c0c0c0" stroke-width="2"/>
      <line x1="70" y1="49" x2="70" y2="56" stroke="#c0c0c0" stroke-width="2"/>
    `,
    live: (state) => {
      const temperature = typeof state.temperature === 'number' ? state.temperature : 24;
      const humidity = typeof state.humidity === 'number' ? state.humidity : 40;
      return `<text x="40" y="8" text-anchor="middle" fill="#263238" font-size="5">${temperature.toFixed(1)}°C · ${humidity.toFixed(0)}%</text>`;
    },
  },

  'wokwi-servo': {
    drawsOwnLeads: true,
    width: 72,
    height: 84,
    pins: [
      { name: 'PWM', x: 16, y: 82 },
      { name: 'V+', x: 36, y: 82 },
      { name: 'GND', x: 56, y: 82 },
    ],
    body: (attrs) => `
      <path d="M12 34 Q12 18 25 15 L47 15 Q60 18 60 34 L60 69 Q60 76 53 76 L19 76 Q12 76 12 69 Z"
            fill="#f4f4f5" stroke="#8b929b" stroke-width="2"/>
      <rect x="20" y="35" width="32" height="28" rx="4" fill="#2f353b"/>
      <circle cx="36" cy="34" r="12" fill="#d7dce0" stroke="#747d84" stroke-width="2"/>
      ${servoHorn(90, attrs.hornColor ?? '#ccc', attrs.horn ?? 'single')}
      <line x1="16" y1="76" x2="16" y2="82" stroke="#d9534f" stroke-width="2"/>
      <line x1="36" y1="76" x2="36" y2="82" stroke="#e0bd39" stroke-width="2"/>
      <line x1="56" y1="76" x2="56" y2="82" stroke="#333" stroke-width="2"/>
    `,
    live: (state, attrs) => {
      const angle = typeof state.angle === 'number' ? state.angle : 90;
      return `<circle cx="36" cy="34" r="12" fill="#d7dce0" stroke="#747d84" stroke-width="2"/>
      ${servoHorn(angle, attrs.hornColor ?? '#ccc', attrs.horn ?? 'single')}`;
    },
  },
};

/** Character LCD, sized from its attributes. */
function lcdVisual(rows: number, cols: number): PartVisual {
  const charW = 11;
  const charH = 18;
  const padX = 14;
  const padY = 14;
  const pinX = 10;
  const parallelPinCount = 16;
  const displayWidth = cols * charW;
  const pinRowWidth = Math.ceil(pinX + (parallelPinCount - 1) * GRID + GRID);
  const width = Math.max(padX * 2 + displayWidth, pinRowWidth);
  const displayX = (width - displayWidth) / 2;
  const height = padY * 2 + rows * charH;
  return {
    width,
    height,
    pins: [
      { name: 'GND', x: 10, y: height - PIN_INSET },
      { name: 'VCC', x: 10 + GRID, y: height - PIN_INSET },
      { name: 'SDA', x: 10 + GRID * 2, y: height - PIN_INSET },
      { name: 'SCL', x: 10 + GRID * 3, y: height - PIN_INSET },
      { name: 'VSS', x: 10, y: PIN_INSET },
      { name: 'VDD', x: 10 + GRID, y: PIN_INSET },
      { name: 'V0', x: 10 + GRID * 2, y: PIN_INSET },
      { name: 'RS', x: 10 + GRID * 3, y: PIN_INSET },
      { name: 'RW', x: 10 + GRID * 4, y: PIN_INSET },
      { name: 'E', x: 10 + GRID * 5, y: PIN_INSET },
      { name: 'D0', x: 10 + GRID * 6, y: PIN_INSET },
      { name: 'D1', x: 10 + GRID * 7, y: PIN_INSET },
      { name: 'D2', x: 10 + GRID * 8, y: PIN_INSET },
      { name: 'D3', x: 10 + GRID * 9, y: PIN_INSET },
      { name: 'D4', x: 10 + GRID * 10, y: PIN_INSET },
      { name: 'D5', x: 10 + GRID * 11, y: PIN_INSET },
      { name: 'D6', x: 10 + GRID * 12, y: PIN_INSET },
      { name: 'D7', x: 10 + GRID * 13, y: PIN_INSET },
      { name: 'A', x: 10 + GRID * 14, y: PIN_INSET },
      { name: 'K', x: 10 + GRID * 15, y: PIN_INSET },
    ],
    body: (attrs) => `
      <rect x="0" y="${BODY_INSET}" width="${width}" height="${height - BODY_INSET * 2}"
            rx="4" fill="#1f3a1f" stroke="#162816"/>
      <rect x="${displayX - 4}" y="${padY - 4}" width="${displayWidth + 8}" height="${rows * charH + 8}"
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
            `<text x="${displayX}" y="${padY + r * charH + 13}" font-family="monospace" font-size="14"
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

/*
 * Two rows of five, a pin pitch apart. The pins used to be 8px apart, which
 * is off the grid everything else snaps to and too tight to print a name
 * like "DIG1" beside - so there was no way to tell where a wire should go.
 * The body is wider to suit; the digit is centred in it rather than redrawn.
 */
const SEVEN_SEG_PITCH = GRID;
const SEVEN_SEG_X0 = 6;
const SEVEN_SEG_WIDTH = SEVEN_SEG_X0 * 2 + 4 * SEVEN_SEG_PITCH;
/** The segment artwork is drawn 46 wide; slide it into the middle. */
const SEVEN_SEG_DIGIT_X = Math.round((SEVEN_SEG_WIDTH - 46) / 2);
const SEVEN_SEG_BODY_Y = BODY_INSET;
const SEVEN_SEG_BODY_H = 60 - BODY_INSET * 2;

const sevenSegPin = (name: string, column: number, y: number): PinLayout => ({
  name,
  x: SEVEN_SEG_X0 + column * SEVEN_SEG_PITCH,
  y,
});

VISUALS['wokwi-7segment'] = {
  width: SEVEN_SEG_WIDTH,
  height: 60,
  pins: [
    sevenSegPin('A', 0, 60 - PIN_INSET),
    sevenSegPin('B', 1, 60 - PIN_INSET),
    sevenSegPin('C', 2, 60 - PIN_INSET),
    sevenSegPin('D', 3, 60 - PIN_INSET),
    sevenSegPin('E', 4, 60 - PIN_INSET),
    sevenSegPin('F', 0, PIN_INSET),
    sevenSegPin('G', 1, PIN_INSET),
    sevenSegPin('DP', 2, PIN_INSET),
    sevenSegPin('COM', 3, PIN_INSET),
    sevenSegPin('DIG1', 4, PIN_INSET),
  ],
  /*
   * The body is inset from both pin rows, so the leads show on both sides the
   * way they do on the real part - and the way the LED's do. Sat flush at the
   * top, the upper pads looked embedded in the case.
   */
  body: () =>
    `<rect x="0" y="${SEVEN_SEG_BODY_Y}" width="${SEVEN_SEG_WIDTH}" ` +
    `height="${SEVEN_SEG_BODY_H}" rx="3" fill="#1a1a1a"/>`,
  live: (state, attrs) => {
    const digits = Array.isArray(state.digits) ? (state.digits as boolean[][]) : [];
    const lit = digits[0] ?? [];
    const color = esc(ledLightColor(attrs.color ?? 'red'));
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const segs = names
      .map((n, i) => `<path d="${SEG_PATHS[n]}" fill="${color}" opacity="${lit[i] ? 1 : 0.08}"/>`)
      .join('');
    const dp = `<circle cx="34" cy="40" r="2.5" fill="${color}" opacity="${lit[7] ? 1 : 0.08}"/>`;
    return `<g transform="translate(${SEVEN_SEG_DIGIT_X} ${SEVEN_SEG_BODY_Y})">${segs}${dp}</g>`;
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
            { name: 'GND', x: 4, y: 40 - PIN_INSET },
            { name: 'VCC', x: 16, y: 40 - PIN_INSET },
            { name: 'DIN', x: 28, y: 40 - PIN_INSET },
            { name: 'DOUT', x: 40, y: 40 - PIN_INSET },
          ]
        : [
            { name: 'VDD', x: 4, y: 40 - PIN_INSET },
            { name: 'DIN', x: 16, y: 40 - PIN_INSET },
            { name: 'VSS', x: 28, y: 40 - PIN_INSET },
            { name: 'DOUT', x: 40, y: 40 - PIN_INSET },
          ],
    // Pins along the bottom only, so the body runs from the top of the box to
    // one lead gap above them.
    body: () =>
      `<rect x="0" y="0" width="200" height="${40 - PIN_INSET - LEAD_GAP}" rx="3"
             fill="#111" stroke="#000"/>`,
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
  drawsOwnLeads: true,
  width: 40,
  height: 30,
  /*
   * A switch stays where it is put, so this latches rather than springing
   * back. The value comes from the part's own last event, so the first press
   * moves it away from wherever its `value` attribute started it.
   */
  controls: [
    {
      name: 'value',
      label: 'Flip the switch',
      x: 20,
      y: 12,
      r: 11,
      toggle: true,
      value: (state) => state.position === 'right',
    },
  ],
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

/*
 * The 6mm tactile button is the same switch in a different package: the same
 * four pins, and the same thing to press. Sharing the artwork gives it the cap
 * control too - on the generic fallback drawing there was nothing to press.
 */
VISUALS['wokwi-pushbutton-6mm'] = VISUALS['wokwi-pushbutton'];

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
  const words = type.replace(/^wokwi-|^board-/, '').split('-');
  const maxCharacters = Math.max(1, Math.floor((width - 16) / 5.4));
  const nameLines: string[] = [];
  for (const word of words) {
    const last = nameLines.length - 1;
    if (last >= 0 && nameLines[last].length + word.length + 1 <= maxCharacters) {
      nameLines[last] += ` ${word}`;
    } else {
      nameLines.push(word);
    }
  }
  const lineHeight = 11;
  const labelY = height / 2 - ((nameLines.length - 1) * lineHeight) / 2 + 3;
  const pins: PinLayout[] = pinNames.map((name, i) => {
    const top = i < Math.ceil(pinNames.length / 2);
    const idx = top ? i : i - Math.ceil(pinNames.length / 2);
    return {
      name,
      x: 10 + idx * GRID,
      y: top ? PIN_INSET : height - PIN_INSET,
      label: name,
    };
  });
  return {
    width,
    height,
    pins,
    body: () => `
      <rect x="0" y="${BODY_INSET}" width="${width}" height="${height - BODY_INSET * 2}"
            rx="4" fill="#3f4a5a" stroke="#2b3441"/>
      ${nameLines.map((line, i) =>
        `<text x="${width / 2}" y="${labelY + i * lineHeight}" text-anchor="middle" fill="#dbe4f0" ` +
        `font-size="9" font-family="monospace">${esc(line)}</text>`,
      ).join('')}
    `,
  };
}

/**
 * Rewrite the element ids in an SVG fragment so a second copy of the same
 * artwork can share the document.
 *
 * SVG references like `fill="url(#pins-female)"` resolve against the whole
 * document and take the *first* matching id. Two copies of a board - one on
 * the canvas, one previewing it elsewhere - therefore fight over the same
 * ids, and if the winner sits in a hidden subtree it paints nothing at all.
 */
export function withIdPrefix(markup: string, prefix: string): string {
  return markup
    .replace(/id="([^"]+)"/g, (_, id: string) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${prefix}${id})`)
    .replace(/href="#([^"]+)"/g, (_, id: string) => `href="#${prefix}${id}"`);
}

export function getVisual(type: string, pinNames: readonly string[] = []): PartVisual {
  return VISUALS[type] ?? genericVisual(type, pinNames);
}

export function hasVisual(type: string): boolean {
  return type in VISUALS;
}
