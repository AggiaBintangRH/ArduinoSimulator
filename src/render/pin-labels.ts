import type { PinLayout, PartVisual } from './shapes.js';

export const PIN_LABEL_FONT_SIZE = 8;
const CHARACTER_ADVANCE = PIN_LABEL_FONT_SIZE * 0.6;
const LABEL_PADDING = 2;
const PIN_CLEARANCE = 6;
const PIN_RADIUS = 4;
const LABEL_GAP = 1.5;

export type PinLabelSide = 'top' | 'bottom' | 'left' | 'right';

export interface PinLabelLayout {
  pin: PinLayout;
  side: PinLabelSide;
  /** Center of the padded label box in the rotated part's coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rotate coordinates before placing labels, so their offsets stay upright. */
export function rotatePartPoint(
  point: { x: number; y: number },
  visual: Pick<PartVisual, 'width' | 'height'>,
  rotate: number,
): { x: number; y: number } {
  const angle = (rotate * Math.PI) / 180;
  const cx = visual.width / 2;
  const cy = visual.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  return {
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

function overlaps(a: PinLabelLayout, b: PinLabelLayout): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + LABEL_GAP &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + LABEL_GAP
  );
}

/**
 * Labels align to their transformed pad and stay outside its nearest edge.
 * Crowded names use additional outward lanes, preserving the pin association
 * instead of rotating glyphs or shifting names toward neighboring pads.
 */
export function layoutPinLabels(visual: PartVisual, rotate = 0): PinLabelLayout[] {
  const corners = [
    { x: 0, y: 0 },
    { x: visual.width, y: 0 },
    { x: 0, y: visual.height },
    { x: visual.width, y: visual.height },
  ].map((point) => rotatePartPoint(point, visual, rotate));
  const bounds = {
    left: Math.min(...corners.map((p) => p.x)),
    right: Math.max(...corners.map((p) => p.x)),
    top: Math.min(...corners.map((p) => p.y)),
    bottom: Math.max(...corners.map((p) => p.y)),
  };
  const labels: PinLabelLayout[] = [];
  for (const original of visual.pins) {
    const pin = { ...original, ...rotatePartPoint(original, visual, rotate) };
    const sides: { side: PinLabelSide; distance: number }[] = [
      { side: 'top', distance: Math.abs(pin.y - bounds.top) },
      { side: 'bottom', distance: Math.abs(bounds.bottom - pin.y) },
      { side: 'left', distance: Math.abs(pin.x - bounds.left) },
      { side: 'right', distance: Math.abs(bounds.right - pin.x) },
    ];
    const side = sides.reduce((a, b) => (b.distance < a.distance ? b : a)).side;
    const width = pin.name.length * CHARACTER_ADVANCE + LABEL_PADDING * 2;
    const height = PIN_LABEL_FONT_SIZE + LABEL_PADDING * 2;
    const horizontal = side === 'left' || side === 'right';
    const sign = side === 'top' || side === 'left' ? -1 : 1;
    const clearance = PIN_RADIUS + PIN_CLEARANCE;
    const label: PinLabelLayout = {
      pin,
      side,
      width,
      height,
      x: pin.x + (horizontal ? sign * (clearance + width / 2) : 0),
      y: pin.y + (horizontal ? 0 : sign * (clearance + height / 2)),
    };
    while (labels.some((placed) => overlaps(label, placed))) {
      if (horizontal) label.x += sign * (width + LABEL_GAP);
      else label.y += sign * (height + LABEL_GAP);
    }
    labels.push(label);
  }
  return labels;
}
