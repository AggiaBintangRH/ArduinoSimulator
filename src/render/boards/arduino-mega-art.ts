/**
 * Arduino Mega 2560 board artwork.
 *
 * Drawn here rather than adapted from someone else's SVG, and the reason is
 * labelling. On a faithful copy of the real board the 2x18 end header sits
 * hard against a notched right edge with 27.8px of bare PCB beside it, and
 * there is nowhere to print 36 pin numbers legibly - two columns only fit at
 * 8px, half the size of the rest of the silkscreen. Printing them off the
 * board worked, but then they read as a diagram annotation rather than as a
 * board.
 *
 * So this board is a little longer than the real one - 864px against 767 -
 * and the extra length is spent on a labelled strip either side of the end
 * header. Everything else keeps the real board's proportions and, more
 * importantly, its 2.54mm pin pitch: PITCH below is one 0.1in step, the same
 * grid the canvas snaps to, so a part placed against a header lands on pads.
 *
 * Pin positions and silkscreen are generated from one layout table. That is
 * the point of drawing it ourselves: a number cannot drift away from the pad
 * it names, because both come from the same row of data.
 */

import type { PinLayout } from '../shapes.js';
import {
  BOARD_PIN_PITCH,
  SOCKET_HALF,
  headerBlock,
  headerLabels,
  headerLabelGroup,
  plastic,
  rowPins,
  socket,
  type HeaderPin,
  type HeaderRow,
} from './header-art.js';

/** One 0.1in pin pitch, matching the canvas grid. */
const PITCH = BOARD_PIN_PITCH;

export const MEGA_ART_WIDTH = 832;
export const MEGA_ART_HEIGHT = 404;

/**
 * Where the first digital header starts.
 *
 * Everything else is placed a whole number of pitches from it, so the whole
 * board sits on one 0.1in grid and a part snapped to the canvas lines up with
 * any pad on it - not just the ones on the header it was dropped beside.
 */
const HEADER_ORIGIN = 180;

const PCB_FILL = '#2b6b99';
const PCB_EDGE = '#1d4f73';

const SILK = '#e8eef5';
const SILK_DIM = '#b9cbdc';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * A socket in a header row. `null` is a hole the board has but nothing is
 * wired to - the real Mega's power header starts with one, and leaving it out
 * makes that header a socket short of the board it is drawing.
 */
type HeaderSlot = HeaderPin | null;

const p = (name: string, label?: string): HeaderPin => ({ name, label });

/** A drilled hole with no pin behind it. */
const NC: HeaderSlot = null;

/**
 * Top edge: the digital headers, left to right, spaced as on the real board -
 * the two Uno-shaped groups, then the Mega's own 14-21 group, running most of
 * the way to the end header rather than bunched up at one end.
 */
const TOP_Y = 26;
const TOP_HEADERS: HeaderRow[] = [
  {
    x: HEADER_ORIGIN,
    y: TOP_Y,
    labels: 'below',
    slots: [
      p('SCL'),
      p('SDA'),
      p('AREF'),
      p('GND.1', 'GND'),
      p('13'),
      p('12'),
      p('11'),
      p('10'),
      p('9'),
      p('8'),
    ],
  },
  {
    x: HEADER_ORIGIN + 11 * PITCH,
    y: TOP_Y,
    labels: 'below',
    slots: [p('7'), p('6'), p('5'), p('4'), p('3'), p('2'), p('1'), p('0')],
  },
  {
    x: HEADER_ORIGIN + 20 * PITCH,
    y: TOP_Y,
    labels: 'below',
    slots: [p('14'), p('15'), p('16'), p('17'), p('18'), p('19'), p('20'), p('21')],
  },
];

/**
 * Bottom edge: power, then the two analog banks.
 *
 * Every header row sits a whole number of pitches from every other, so a part
 * snapped to the canvas grid lines up with any pad on the board, not just the
 * ones on the header it was dropped next to.
 *
 * It runs one pitch below the end header's last row, as on the real board.
 * Level with it, the analog bank's plastic and the end header's GND marking
 * ran into each other in the corner.
 */
const BOTTOM_Y = TOP_Y + 18 * PITCH;
const BOTTOM_HEADERS: HeaderRow[] = [
  {
    x: HEADER_ORIGIN + 2 * PITCH,
    y: BOTTOM_Y,
    labels: 'above',
    slots: [
      // The board has eight holes here; the first is not connected.
      NC,
      p('IOREF'),
      p('RESET'),
      p('3.3V'),
      p('5V'),
      p('GND.2', 'GND'),
      p('GND.3', 'GND'),
      p('VIN'),
    ],
  },
  {
    x: HEADER_ORIGIN + 11 * PITCH,
    y: BOTTOM_Y,
    labels: 'above',
    slots: [p('A0'), p('A1'), p('A2'), p('A3'), p('A4'), p('A5'), p('A6'), p('A7')],
  },
  {
    x: HEADER_ORIGIN + 20 * PITCH,
    y: BOTTOM_Y,
    labels: 'above',
    slots: [p('A8'), p('A9'), p('A10'), p('A11'), p('A12'), p('A13'), p('A14'), p('A15')],
  },
];

/**
 * The 2x18 end header, at the far end of the board as on the real one.
 *
 * Its left column is printed to its left and its right column to its right,
 * so every number sits beside the pad it belongs to and neither column has to
 * share a strip with the other. The board carries on past it far enough for
 * that second strip: on the real board there are 34px there and the edge is
 * notched away above y=110, which is what left nowhere to print them.
 */
const END_HEADER_Y = TOP_Y;
const END_HEADER_ROWS = 18;
const END_LEFT_X = HEADER_ORIGIN + 30 * PITCH;
const END_RIGHT_X = END_LEFT_X + PITCH;

/**
 * The end header's two columns, exported so callers can tell its pads from
 * the ones on the top and bottom edges without guessing at a coordinate.
 */
export const MEGA_END_HEADER_COLUMNS = { left: END_LEFT_X, right: END_RIGHT_X };

/** Rows of the end header: outer column first, then inner. */
const END_HEADER: [HeaderPin, HeaderPin][] = [
  [p('5V.1', '5V'), p('5V.2', '5V')],
  ...Array.from({ length: 16 }, (_, i): [HeaderPin, HeaderPin] => [
    p(String(22 + i * 2)),
    p(String(23 + i * 2)),
  ]),
  [p('GND.4', 'GND'), p('GND.5', 'GND')],
];

// ---------------------------------------------------------------------------
// Pin positions, generated
// ---------------------------------------------------------------------------

function endHeaderPins(): PinLayout[] {
  const out: PinLayout[] = [];
  END_HEADER.forEach(([outer, inner], row) => {
    const y = END_HEADER_Y + row * PITCH;
    const pairs: [HeaderPin, number][] = [
      [outer, END_LEFT_X],
      [inner, END_RIGHT_X],
    ];
    for (const [pin, x] of pairs) {
      out.push({ name: pin.name, x, y, ...(pin.label ? { label: pin.label } : {}) });
    }
  });
  return out;
}

/**
 * Every pin, in the order `MEGA_PINS` lists them.
 *
 * The order matters as much as the positions: it is the order an imported
 * Wokwi diagram expects, and `boards.ts` is checked against this table.
 */
export const MEGA_PIN_LAYOUT: PinLayout[] = [
  ...TOP_HEADERS.flatMap(rowPins),
  ...endHeaderPins(),
  ...BOTTOM_HEADERS.flatMap(rowPins),
];

/** The reset button, as a pressable spot on the artwork. */
export const MEGA_RESET_BUTTON = { x: 148, y: 62, r: 15 };

/** The built-in LED on pin 13, so the live layer knows where to glow. */
export const MEGA_LED_L = { x: 300, y: 96 };

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The end header, plus a number either side of every row. */
function endHeaderMarkup(): { block: string; labels: string } {
  const pad = 3.5;
  const left = END_LEFT_X - SOCKET_HALF - pad;
  const right = END_RIGHT_X + SOCKET_HALF + pad;
  const top = END_HEADER_Y - SOCKET_HALF - pad;
  const bottom = END_HEADER_Y + (END_HEADER_ROWS - 1) * PITCH + SOCKET_HALF + pad;

  const holes: string[] = [];
  const labels: string[] = [];
  END_HEADER.forEach(([outer, inner], row) => {
    const y = END_HEADER_Y + row * PITCH;
    holes.push(socket(END_LEFT_X, y), socket(END_RIGHT_X, y));
    const baseline = round2(y);
    labels.push(
      `<text class="board-pin-label" x="${round2(left - 7)}" y="${baseline}" text-anchor="end" dominant-baseline="central">` +
        `${outer.label ?? outer.name}</text>`,
      `<text class="board-pin-label" x="${round2(right + 7)}" y="${baseline}" text-anchor="start" dominant-baseline="central">` +
        `${inner.label ?? inner.name}</text>`,
    );
  });

  return {
    block: plastic(left, top, right - left, bottom - top) + holes.join(''),
    labels: labels.join('\n      '),
  };
}

function led(x: number, y: number, colour: string, name: string): string {
  return (
    `<rect x="${x}" y="${y}" width="14" height="8" rx="1.5" fill="${colour}"/>` +
    `<text x="${x + 20}" y="${y + 7.5}" fill="${SILK_DIM}" font-size="10">${name}</text>`
  );
}

const endHeader = endHeaderMarkup();

/** Pin names remain above wires without lifting the board's socket artwork. */
export const MEGA_PIN_LABELS = `
${headerLabelGroup([...TOP_HEADERS, ...BOTTOM_HEADERS].map(headerLabels).join(''), 'mega-pin-labels', PCB_FILL)}
<g class="mega-end-header-labels" fill="${SILK}" font-family="var(--font-mono)" font-size="11"
   stroke="${PCB_FILL}" stroke-width="2.5" stroke-linejoin="round" paint-order="stroke">
  ${endHeader.labels}
</g>`;

/**
 * The board.
 *
 * Everything is in the same pixel space as the pin layout - no scaling
 * wrapper - so the two cannot drift apart.
 */
export const MEGA_ART_BODY = `
<g font-family="ui-monospace, 'SF Mono', Consolas, monospace">
  <rect x="0" y="0" width="${MEGA_ART_WIDTH}" height="${MEGA_ART_HEIGHT}"
        rx="14" fill="${PCB_FILL}" stroke="${PCB_EDGE}" stroke-width="2"/>

  <g fill="#f2f6fa" stroke="${PCB_EDGE}" stroke-width="1.5">
    <circle cx="22" cy="22" r="8"/>
    <circle cx="22" cy="382" r="8"/>
    <circle cx="735" cy="16" r="8"/>
    <circle cx="735" cy="388" r="8"/>
  </g>

  <!--
    USB-B and the power jack, seen from above like the rest of the board.
    Their openings face off the left edge, so from here you see the shell and
    the mouth edge-on at the board's edge - not the front of the connector.
  -->
  <g>
    <rect x="-8" y="30" width="70" height="76" rx="3" fill="#b6bcc4"
          stroke="#8d949c" stroke-width="1.5"/>
    <line x1="36" y1="30" x2="36" y2="106" stroke="#a2a9b0" stroke-width="1"/>
    <line x1="8" y1="30" x2="8" y2="106" stroke="#a2a9b0" stroke-width="1"/>
    <rect x="-8" y="30" width="16" height="76" rx="3" fill="#9ba2a9"/>
    <rect x="-5" y="44" width="10" height="48" rx="2" fill="#2f343a"/>
  </g>

  <g>
    <rect x="-8" y="258" width="66" height="86" rx="6" fill="#1c1c1c"
          stroke="#0a0a0a" stroke-width="1.5"/>
    <rect x="-8" y="258" width="14" height="86" rx="6" fill="#101010"/>
    <ellipse cx="-1" cy="301" rx="6" ry="20" fill="#000"/>
    <ellipse cx="-1" cy="301" rx="2.4" ry="8" fill="#3d3d3d"/>
  </g>

  <g>
    <rect x="380" y="150" width="112" height="112" rx="4" fill="#171717"
          stroke="#050505" stroke-width="1.5"/>
    <circle cx="396" cy="166" r="5" fill="#333"/>
    <text x="436" y="202" fill="#8e8e8e" font-size="11" text-anchor="middle">ATmega</text>
    <text x="436" y="218" fill="#8e8e8e" font-size="11" text-anchor="middle">2560</text>
  </g>

  <rect x="522" y="150" width="46" height="24" rx="10" fill="#c3c8ce"
        stroke="#8d949c" stroke-width="1.2"/>

  <g>
    ${plastic(88, 150, 46, 32)}
    ${[0, 1, 2]
      .flatMap((c) =>
        [0, 1].map(
          (r) =>
            `<rect x="${95 + c * 13}" y="${157 + r * 13}" width="7" height="7" ` +
            `rx="1" fill="#d8c27a"/>`,
        ),
      )
      .join('\n    ')}
    <text x="111" y="196" fill="${SILK_DIM}" font-size="9"
          text-anchor="middle">ICSP1</text>
  </g>

  <g>
    ${plastic(640, 176, 46, 32)}
    ${[0, 1, 2]
      .flatMap((c) =>
        [0, 1].map(
          (r) =>
            `<rect x="${647 + c * 13}" y="${183 + r * 13}" width="7" height="7" ` +
            `rx="1" fill="#d8c27a"/>`,
        ),
      )
      .join('\n    ')}
    <text x="663" y="222" fill="${SILK_DIM}" font-size="9"
          text-anchor="middle">ICSP</text>
  </g>

  <g>
    <rect x="${MEGA_RESET_BUTTON.x - 19}" y="${MEGA_RESET_BUTTON.y - 19}"
          width="38" height="38" rx="3" fill="#9aa1a8" stroke="#6f767d" stroke-width="1.2"/>
    <circle cx="${MEGA_RESET_BUTTON.x}" cy="${MEGA_RESET_BUTTON.y}" r="13" fill="#a8323a"/>
    <circle cx="${MEGA_RESET_BUTTON.x}" cy="${MEGA_RESET_BUTTON.y}" r="9" fill="#c8434c"/>
    <text x="${MEGA_RESET_BUTTON.x}" y="${MEGA_RESET_BUTTON.y + 36}" fill="${SILK_DIM}"
          font-size="10" text-anchor="middle">RESET</text>
  </g>

  <g>
    ${led(MEGA_LED_L.x, MEGA_LED_L.y, '#6d2a2a', 'L')}
    ${led(MEGA_LED_L.x, MEGA_LED_L.y + 20, '#6d5f2a', 'TX')}
    ${led(MEGA_LED_L.x, MEGA_LED_L.y + 40, '#6d5f2a', 'RX')}
    ${led(200, 292, '#2b6d38', 'ON')}
  </g>

  <g>
    ${TOP_HEADERS.map(headerBlock).join('\n    ')}
    ${BOTTOM_HEADERS.map(headerBlock).join('\n    ')}
    ${endHeader.block}
  </g>

  <g fill="${SILK_DIM}" font-size="11" text-anchor="middle">
    <text x="440" y="88">DIGITAL (PWM ~)</text>
    <text x="285" y="312">POWER</text>
    <text x="545" y="312">ANALOG IN</text>
  </g>

  <text x="610" y="252" fill="${SILK}" font-size="24" font-weight="bold"
        text-anchor="middle" letter-spacing="1.5">ARDUINO MEGA</text>
</g>
`;
