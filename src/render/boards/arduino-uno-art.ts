/** Arduino Uno artwork. Header sockets and names share the same layout table. */
import {
  BOARD_PIN_PITCH,
  headerBlock,
  headerLabels,
  headerLabelGroup,
  rowPins,
  type HeaderRow,
} from './header-art.js';

export const UNO_ART_WIDTH = 384;
export const UNO_ART_HEIGHT = 240;
const HEADER_ORIGIN = 48;
const TOP_Y = 20;
const BOTTOM_Y = TOP_Y + 10 * BOARD_PIN_PITCH;
const PCB_FILL = '#0e7c7b';

const TOP_HEADERS: HeaderRow[] = [
  {
    x: HEADER_ORIGIN,
    y: TOP_Y,
    labels: 'below',
    slots: ['AREF', 'GND.3', '13', '12', '11', '10', '9', '8'].map((name) => ({
      name,
      ...(name === 'GND.3' ? { label: 'GND' } : {}),
    })),
  },
  {
    x: HEADER_ORIGIN + 9 * BOARD_PIN_PITCH,
    y: TOP_Y,
    labels: 'below',
    slots: ['7', '6', '5', '4', '3', '2', '1', '0'].map((name) => ({ name })),
  },
];

const BOTTOM_HEADERS: HeaderRow[] = [
  {
    x: HEADER_ORIGIN + 2 * BOARD_PIN_PITCH,
    y: BOTTOM_Y,
    labels: 'above',
    slots: ['RESET', '3.3V', '5V', 'GND.2', 'GND.1', 'VIN'].map((name) => ({
      name,
      label: name.replace(/\.\d$/, ''),
    })),
  },
  {
    x: HEADER_ORIGIN + 9 * BOARD_PIN_PITCH,
    y: BOTTOM_Y,
    labels: 'above',
    slots: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].map((name) => ({ name })),
  },
];

const HEADERS = [...TOP_HEADERS, ...BOTTOM_HEADERS];
export const UNO_PIN_LAYOUT = HEADERS.flatMap(rowPins);
export const UNO_LED_L = { x: 324, y: 112, r: 3.6 };

export const UNO_PIN_LABELS = headerLabelGroup(HEADERS.map(headerLabels).join(''), 'uno-pin-labels', PCB_FILL);

export const UNO_ART_BODY = `
<g font-family="var(--font-mono)">
  <rect x="0" y="0" width="${UNO_ART_WIDTH}" height="${UNO_ART_HEIGHT}" rx="10"
        fill="${PCB_FILL}" stroke="#0a5f5e" stroke-width="1.5"/>
  <rect x="6" y="6" width="${UNO_ART_WIDTH - 12}" height="${UNO_ART_HEIGHT - 12}"
        rx="7" fill="none" stroke="#12908f"/>
  <g fill="#d9eceb" stroke="#0a5f5e">
    <circle cx="16" cy="16" r="5"/><circle cx="16" cy="224" r="5"/>
    <circle cx="368" cy="224" r="5"/>
  </g>

  <g>
    <rect x="-6" y="48" width="52" height="58" rx="3" fill="#b6bcc4" stroke="#8d949c"/>
    <rect x="-6" y="48" width="12" height="58" rx="2" fill="#9ba2a9"/>
    <rect x="-3" y="59" width="6" height="36" rx="1.5" fill="#30343a"/>
    <rect x="-6" y="144" width="44" height="48" rx="4" fill="#161616" stroke="#070707"/>
    <ellipse cx="-1" cy="168" rx="4" ry="12" fill="#000"/>
  </g>

  <rect x="80" y="70" width="58" height="38" rx="3" fill="#202327" stroke="#101114"/>
  <text x="109" y="94" text-anchor="middle" fill="#aab4bc" font-size="10">16U2</text>
  <rect x="180" y="91" width="112" height="48" rx="4" fill="#202327" stroke="#101114"/>
  <text x="236" y="119" text-anchor="middle" fill="#aab4bc" font-size="11">ATmega328P</text>
  <rect x="159" y="151" width="34" height="14" rx="6" fill="#c3c8ce" stroke="#8d949c"/>
  <text x="246" y="179" text-anchor="middle" fill="#e8f5f4" font-family="var(--font-ui)"
        font-size="17" font-weight="600" letter-spacing="1">ARDUINO UNO</text>

  <circle cx="324" cy="89" r="3.6" fill="#3b8f43"/>
  <text x="337" y="93" fill="#cfe9e6" font-size="9">ON</text>
  <circle cx="${UNO_LED_L.x}" cy="${UNO_LED_L.y}" r="${UNO_LED_L.r}" fill="#5a5a20"/>
  <text x="337" y="116" fill="#cfe9e6" font-size="9">L</text>

  <g>${HEADERS.map(headerBlock).join('')}</g>
</g>`;
