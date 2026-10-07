/** Shared header geometry for board artwork and its pin-name overlay. */
import type { PinLayout } from '../shapes.js';

/** One 0.1in step, also used by the component and canvas grid. */
export const BOARD_PIN_PITCH = 19.2;
export const SOCKET_HALF = 6.4;
const HEADER_PADDING = 3.5;
const LABEL_CLEARANCE = 7;

export interface HeaderPin {
  name: string;
  label?: string;
}

export interface HeaderRow {
  x: number;
  y: number;
  slots: readonly (HeaderPin | null)[];
  labels: 'above' | 'below';
}

export function slotX(header: HeaderRow, index: number): number {
  return header.x + index * BOARD_PIN_PITCH;
}

export function rowPins(header: HeaderRow): PinLayout[] {
  return header.slots.flatMap((slot, index) =>
    slot ? [{ ...slot, x: slotX(header, index), y: header.y }] : [],
  );
}

function coordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

export function socket(x: number, y: number): string {
  return `<rect x="${coordinate(x - SOCKET_HALF)}" y="${coordinate(y - SOCKET_HALF)}"
    width="${SOCKET_HALF * 2}" height="${SOCKET_HALF * 2}" rx="1.5" fill="#131313"/>`;
}

export function plastic(left: number, top: number, width: number, height: number): string {
  return `<rect x="${coordinate(left)}" y="${coordinate(top)}" width="${coordinate(width)}"
    height="${coordinate(height)}" rx="2.5" fill="#2a2a2a" stroke="#3f3f3f" stroke-width="0.8"/>`;
}

export function headerBlock(header: HeaderRow): string {
  const xs = header.slots.map((_, index) => slotX(header, index));
  if (!xs.length) return '';
  const halfHeight = SOCKET_HALF + HEADER_PADDING;
  const left = xs[0] - halfHeight;
  const right = xs[xs.length - 1] + halfHeight;
  return (
    plastic(left, header.y - halfHeight, right - left, halfHeight * 2) +
    xs.map((x) => socket(x, header.y)).join('')
  );
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Dense header names run out from the pad, centered on its exact x coordinate. */
export function headerLabels(header: HeaderRow): string {
  const above = header.labels === 'above';
  const labelY = header.y + (above ? -1 : 1) * (SOCKET_HALF + HEADER_PADDING + LABEL_CLEARANCE);
  return header.slots
    .map((slot, index) =>
      slot
        ? `<text class="board-pin-label" transform="translate(${coordinate(slotX(header, index))} ${coordinate(labelY)}) rotate(-90)"
        text-anchor="${above ? 'start' : 'end'}" dominant-baseline="central">${escapeText(slot.label ?? slot.name)}</text>`
        : '',
    )
    .join('');
}

/** PCB silkscreen stays legible over wires with an outline in the board color. */
export function headerLabelGroup(markup: string, className: string, boardColor: string): string {
  return `<g class="${className}" fill="#e8eef5" font-family="var(--font-mono)" font-size="10"
    stroke="${boardColor}" stroke-width="2.5" stroke-linejoin="round" paint-order="stroke">${markup}</g>`;
}
