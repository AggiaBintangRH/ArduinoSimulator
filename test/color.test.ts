// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  parseColor,
  toHex,
  rgbToHsv,
  hsvToRgb,
  emittedColor,
} from '../src/util/color.js';
import { hueAt, saturationAt, wheelPosition, createColorPicker } from '../src/ui/color-picker.js';
import { lightColorFor } from '../src/parts/led.js';
import '../src/parts/index.js';
import { getVisual } from '../src/render/shapes.js';

describe('parseColor', () => {
  it('reads long and short hex', () => {
    expect(parseColor('#ff8000')).toEqual({ r: 255, g: 128, b: 0 });
    expect(parseColor('#f80')).toEqual({ r: 255, g: 136, b: 0 });
  });

  it('reads the names this project ships', () => {
    expect(parseColor('red')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor('  WHITE ')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('rejects what it cannot read, rather than guessing', () => {
    for (const bad of ['', '   ', '#ff', '#gggggg', 'chartreuse', 'rgb(1,2,3)']) {
      expect(parseColor(bad), bad).toBeNull();
    }
  });
});

describe('hsv round trip', () => {
  it('survives a trip through HSV and back', () => {
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#123456', '#ffffff', '#000000']) {
      expect(toHex(hsvToRgb(rgbToHsv(parseColor(hex)!)))).toBe(hex);
    }
  });

  it('gives a grey no hue to remember', () => {
    expect(rgbToHsv({ r: 128, g: 128, b: 128 }).s).toBe(0);
  });

  it('wraps a hue outside 0-360', () => {
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual(hsvToRgb({ h: 0, s: 1, v: 1 }));
    expect(hsvToRgb({ h: -120, s: 1, v: 1 })).toEqual(hsvToRgb({ h: 240, s: 1, v: 1 }));
  });
});

describe('emittedColor', () => {
  it('lights a colour brighter than the body it came from', () => {
    // The old behaviour returned the body colour unchanged, which "lit" the
    // part in exactly the shade it already was.
    const body = '#803030';
    const lit = emittedColor(body)!;
    expect(lit).not.toBe(body);
    expect(rgbToHsv(parseColor(lit)!).v).toBeGreaterThan(rgbToHsv(parseColor(body)!).v);
  });

  it('keeps the hue it was given', () => {
    // Within a degree: the trip back out to 8-bit hex costs a fraction of one.
    const lit = rgbToHsv(parseColor(emittedColor('#2060c0')!)!);
    expect(Math.abs(lit.h - rgbToHsv(parseColor('#2060c0')!).h)).toBeLessThan(1);
  });

  it('lights a colourless body white, the way a clear LED does', () => {
    expect(emittedColor('#000000')).toBe('#ffffff');
    expect(emittedColor('#808080')).toBe('#ffffff');
  });

  it('gives nothing back for something it cannot read', () => {
    expect(emittedColor('nonsense')).toBeNull();
  });
});

describe('lightColorFor', () => {
  it('keeps the hand-tuned light for the named colours', () => {
    expect(lightColorFor('red')).toBe('#ff2d2d');
    expect(lightColorFor('GREEN')).toBe('#2dff2d');
  });

  it('works one out for a colour off the wheel', () => {
    const lit = lightColorFor('#2060c0');
    expect(lit).not.toBe('#2060c0');
    expect(parseColor(lit)).not.toBeNull();
  });

  it('still returns something for a colour it cannot read at all', () => {
    expect(lightColorFor('rebeccapurple')).toBe('rebeccapurple');
  });
});

describe('the light a part actually shows', () => {
  /*
   * `lightColorFor` existed but nothing called it: the renderer read the body
   * colour out of the attributes and used that, so an LED lit in exactly the
   * shade it already was. These hold the two ends together.
   */
  const litFill = (attrs: Record<string, string>) =>
    /fill="([^"]+)"/.exec(getVisual('wokwi-led').live!({ brightness: 1 }, attrs))![1];

  it('lights an LED brighter than its body', () => {
    expect(litFill({ color: '#803030' })).not.toBe('#803030');
  });

  it('uses the hand-tuned light for a named colour', () => {
    expect(litFill({ color: 'red' })).toBe('#ff2d2d');
  });

  it('lets an explicit lightColor win', () => {
    expect(litFill({ color: 'red', lightColor: '#00ff88' })).toBe('#00ff88');
  });

  it('lights a 7-segment brighter than its body too', () => {
    const svg = getVisual('wokwi-7segment').live!(
      { digits: [[true, false, false, false, false, false, false, false]] },
      { color: '#803030' },
    );
    expect(svg).not.toContain('#803030');
  });
});

describe('wheel geometry', () => {
  /*
   * The wheel is painted by a CSS conic gradient that starts at twelve
   * o'clock and runs clockwise. These have to agree with that, and with each
   * other, or dragging lands on a different colour from the one under the
   * pointer.
   */
  it('reads hue clockwise from the top', () => {
    expect(hueAt(0, -10)).toBeCloseTo(0, 6); // up
    expect(hueAt(10, 0)).toBeCloseTo(90, 6); // right
    expect(hueAt(0, 10)).toBeCloseTo(180, 6); // down
    expect(hueAt(-10, 0)).toBeCloseTo(270, 6); // left
  });

  it('reads saturation from the centre out, and stops at the rim', () => {
    expect(saturationAt(0, 0, 50)).toBe(0);
    expect(saturationAt(25, 0, 50)).toBeCloseTo(0.5, 6);
    expect(saturationAt(80, 0, 50)).toBe(1);
  });

  it('has no opinion when the wheel has no size', () => {
    // A hidden panel reports a zero-sized box; this must not divide by it.
    expect(saturationAt(10, 10, 0)).toBe(0);
  });

  it('places a colour back where it was picked from', () => {
    const radius = 66;
    for (const [dx, dy] of [
      [0, -40],
      [30, 0],
      [-20, 25],
      [11, 11],
    ]) {
      const back = wheelPosition(hueAt(dx, dy), saturationAt(dx, dy, radius), radius);
      expect(back.dx).toBeCloseTo(dx, 6);
      expect(back.dy).toBeCloseTo(dy, 6);
    }
  });
});

describe('createColorPicker', () => {
  function picker(value = '#ff0000') {
    const changes: string[] = [];
    const el = createColorPicker({
      value,
      presets: ['red', 'green'],
      onChange: (hex) => changes.push(hex),
    });
    document.body.append(el);
    return { el, changes };
  }

  it('shows a wheel, a brightness slider and a hex box', () => {
    const { el } = picker();
    expect(el.querySelector('.color-wheel')).not.toBeNull();
    expect(el.querySelector('.color-value')).not.toBeNull();
    expect(el.querySelector<HTMLInputElement>('.color-hex')!.value).toBe('#ff0000');
  });

  it('starts from the colour it was given', () => {
    const { el } = picker('#00ff00');
    expect(el.querySelector<HTMLInputElement>('.color-hex')!.value).toBe('#00ff00');
  });

  it('accepts a name as its starting value', () => {
    const { el } = picker('blue');
    expect(el.querySelector<HTMLInputElement>('.color-hex')!.value).toBe('#0000ff');
  });

  it('reports a colour typed into the hex box', () => {
    const { el, changes } = picker();
    const hex = el.querySelector<HTMLInputElement>('.color-hex')!;
    hex.value = '#123456';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changes).toEqual(['#123456']);
  });

  it('ignores a half-typed hex instead of correcting it mid-keystroke', () => {
    const { el, changes } = picker();
    const hex = el.querySelector<HTMLInputElement>('.color-hex')!;
    hex.value = '#12';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changes).toEqual([]);
    expect(hex.value).toBe('#12');
  });

  it('reports a preset when one is clicked', () => {
    const { el, changes } = picker();
    el.querySelector<HTMLElement>('.swatch[data-color="green"]')!.click();
    expect(changes).toEqual(['#008000']);
  });

  it('dims the colour with the brightness slider', () => {
    const { el, changes } = picker('#ff0000');
    const value = el.querySelector<HTMLInputElement>('.color-value')!;
    value.value = '50';
    value.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changes).toHaveLength(1);
    expect(rgbToHsv(parseColor(changes[0])!).v).toBeCloseTo(0.5, 2);
    // Same hue, just darker.
    expect(rgbToHsv(parseColor(changes[0])!).h).toBeCloseTo(0, 6);
  });
});
