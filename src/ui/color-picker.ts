/**
 * A colour wheel, a brightness slider and a hex box.
 *
 * The wheel is a CSS `conic-gradient` for hue with a white `radial-gradient`
 * over it for saturation - the same arrangement as the pickers people already
 * know - so there is no canvas to keep in step with the value.
 *
 * Angle and distance are read back from the pointer, which means the maths
 * here has to agree with the way that gradient is painted: the conic gradient
 * starts at twelve o'clock and runs clockwise, so `hueAt` measures the same
 * way. `wheelPosition` is its inverse, and a test holds the two together.
 */

import { hsvToRgb, parseColor, rgbToHsv, toHex, type Hsv } from '../util/color.js';

export interface ColorPickerOptions {
  value: string;
  /** Quick picks shown under the wheel. */
  presets?: string[];
  /** Called as the colour changes, with a `#rrggbb` string. */
  onChange: (hex: string) => void;
}

/** Hue, in degrees, at a point on the wheel. `dy` grows downward. */
export function hueAt(dx: number, dy: number): number {
  return (((Math.atan2(dx, -dy) * 180) / Math.PI) + 360) % 360;
}

/** Saturation at a point on a wheel of this radius, clamped to its edge. */
export function saturationAt(dx: number, dy: number, radius: number): number {
  if (radius <= 0) return 0;
  return Math.min(1, Math.hypot(dx, dy) / radius);
}

/** Where on the wheel a hue and saturation sit, as an offset from centre. */
export function wheelPosition(h: number, s: number, radius: number): { dx: number; dy: number } {
  const angle = (h * Math.PI) / 180;
  const r = Math.min(1, Math.max(0, s)) * radius;
  return { dx: Math.sin(angle) * r, dy: -Math.cos(angle) * r };
}

const WHEEL_SIZE = 132;

export function createColorPicker(options: ColorPickerOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = 'color-picker';

  const start = parseColor(options.value) ?? { r: 255, g: 0, b: 0 };
  let hsv: Hsv = rgbToHsv(start);

  // --- wheel ---------------------------------------------------------------
  const wheel = document.createElement('div');
  wheel.className = 'color-wheel';
  wheel.setAttribute('role', 'slider');
  wheel.setAttribute('aria-label', 'Hue and saturation');
  wheel.tabIndex = 0;

  const marker = document.createElement('div');
  marker.className = 'color-marker';
  wheel.append(marker);

  // --- brightness ----------------------------------------------------------
  const value = document.createElement('input');
  value.type = 'range';
  value.className = 'color-value';
  value.min = '0';
  value.max = '100';
  value.setAttribute('aria-label', 'Brightness');

  // --- hex -----------------------------------------------------------------
  const hex = document.createElement('input');
  hex.className = 'color-hex';
  hex.spellcheck = false;
  hex.setAttribute('aria-label', 'Hex colour');

  root.append(wheel, value, hex);

  // --- presets -------------------------------------------------------------
  if (options.presets?.length) {
    const row = document.createElement('div');
    row.className = 'color-presets';
    for (const preset of options.presets) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch';
      swatch.style.background = preset;
      swatch.title = preset;
      swatch.setAttribute('aria-label', preset);
      swatch.dataset.color = preset;
      swatch.addEventListener('click', () => {
        const rgb = parseColor(preset);
        if (!rgb) return;
        hsv = rgbToHsv(rgb);
        paint();
        options.onChange(toHex(rgb));
      });
      row.append(swatch);
    }
    root.append(row);
  }

  /** Push the current colour into every part of the control. */
  function paint(updateHex = true): void {
    const radius = WHEEL_SIZE / 2;
    const { dx, dy } = wheelPosition(hsv.h, hsv.s, radius);
    marker.style.left = `${radius + dx}px`;
    marker.style.top = `${radius + dy}px`;
    const current = toHex(hsvToRgb(hsv));
    marker.style.background = current;
    // The wheel is painted at full brightness; dimming it with the slider
    // shows what the chosen value actually looks like.
    wheel.style.filter = `brightness(${0.35 + hsv.v * 0.65})`;
    value.value = String(Math.round(hsv.v * 100));
    if (updateHex) hex.value = current;
  }

  function pick(ev: PointerEvent): void {
    const rect = wheel.getBoundingClientRect();
    // jsdom and a hidden panel both report a zero-sized box; without this the
    // first press would set saturation from a division by zero.
    const radius = (rect.width || WHEEL_SIZE) / 2;
    const dx = ev.clientX - rect.left - radius;
    const dy = ev.clientY - rect.top - radius;
    hsv = { h: hueAt(dx, dy), s: saturationAt(dx, dy, radius), v: hsv.v };
    paint();
    options.onChange(toHex(hsvToRgb(hsv)));
  }

  let dragging = false;
  wheel.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    dragging = true;
    try {
      wheel.setPointerCapture(ev.pointerId);
    } catch {
      // Without capture the drag still tracks until the pointer leaves.
    }
    pick(ev);
  });
  wheel.addEventListener('pointermove', (ev) => {
    if (dragging) pick(ev);
  });
  const stop = (ev: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try {
      wheel.releasePointerCapture(ev.pointerId);
    } catch {
      // Already released.
    }
  };
  wheel.addEventListener('pointerup', stop);
  wheel.addEventListener('pointercancel', stop);

  value.addEventListener('input', () => {
    hsv = { ...hsv, v: Number(value.value) / 100 };
    paint();
    options.onChange(toHex(hsvToRgb(hsv)));
  });

  hex.addEventListener('input', () => {
    const rgb = parseColor(hex.value);
    // Typing is incremental: "#ff" is on the way to something valid, so an
    // unparseable box is left alone rather than being corrected under the
    // cursor.
    if (!rgb) return;
    hsv = rgbToHsv(rgb);
    paint(false);
    options.onChange(toHex(rgb));
  });
  hex.addEventListener('change', () => paint());

  paint();
  return root;
}
