/**
 * Interactive input parts: pushbutton, slide switch, DIP switch, resistor.
 * Pins and attributes per docs/wokwi/02-parts.md.
 */

import { registerPart } from '../sim/registry.js';
import { Edge, HIGH, LOW, PinMode, type DigitalValue } from '../sim/net.js';
import type { Part, PartContext } from '../sim/part.js';

/**
 * A closed mechanical contact joining a group of pins.
 *
 * Wokwi has no resistive solver, so a closed switch cannot literally merge
 * nets. Instead the contact samples whatever the *other* parts drive and
 * re-drives that level onto every bridged pin.
 *
 * Releasing all pins to Input before sampling is what keeps this honest: the
 * contact never reads back its own output, so it cannot latch a level after the
 * external driver goes away.
 */
export function bridgePins(ctx: PartContext, names: readonly string[], closed: boolean): void {
  for (const name of names) ctx.pinMode(name, PinMode.Input);
  if (!closed) return;

  let sawLow = false;
  let sawHigh = false;
  for (const name of names) {
    if (ctx.pinFloating(name)) continue;
    if (ctx.pinRead(name) === LOW) sawLow = true;
    else sawHigh = true;
  }

  // Nothing external drives the group: leave it floating rather than inventing
  // a level. Both sides driven in opposition is a genuine short, and resolving
  // LOW matches how the net model reports it.
  if (!sawLow && !sawHigh) return;
  const level: DigitalValue = sawLow ? LOW : HIGH;

  for (const name of names) {
    ctx.pinMode(name, PinMode.Output);
    ctx.pinWrite(name, level);
  }
}

/**
 * Mechanical contact bounce.
 *
 * Wokwi simulates this by default: contacts separate and reconnect 10-100 times
 * over roughly 1ms, and `bounce: "0"` disables it. Sketches that poll a button
 * without debouncing misbehave here exactly as they do on a bench.
 */
export class Bouncer {
  private timer: number | null = null;
  private remaining = 0;
  private target = false;

  constructor(
    private ctx: PartContext,
    private apply: (closed: boolean) => void,
    private enabled: boolean,
    private random: () => number = Math.random,
  ) {}

  transition(closed: boolean): void {
    this.target = closed;
    if (!this.enabled) {
      this.apply(closed);
      return;
    }
    if (this.timer === null) {
      this.timer = this.ctx.timerInit(() => this.tick());
    }
    this.remaining = 10 + Math.floor(this.random() * 90);
    this.tick();
  }

  private tick(): void {
    if (this.remaining <= 0) {
      this.apply(this.target);
      return;
    }
    // Chatter between the two states while settling.
    this.apply(this.remaining % 2 === 0 ? this.target : !this.target);
    this.remaining--;
    // Spread the remaining chatter across what is left of the ~1ms window.
    this.ctx.timerStart(this.timer!, Math.max(1, 1000 / (this.remaining + 1)));
  }

  get settling(): boolean {
    return this.remaining > 0;
  }
}

function bounceEnabled(ctx: PartContext): boolean {
  return ctx.attr('bounce', '') !== '0';
}

function truthy(value: number | string | boolean): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/**
 * wokwi-pushbutton / wokwi-pushbutton-6mm
 *
 * The four pins are two internally-joined contact pairs: 1.l-1.r and 2.l-2.r
 * are always connected, and pressing joins pair 1 to pair 2.
 */
const BUTTON_PINS = ['1.l', '1.r', '2.l', '2.r'] as const;

class PushbuttonPart implements Part {
  private ctx!: PartContext;
  private pressed = false;
  private closed = false;
  private bouncer!: Bouncer;
  private reentrant = false;

  init(ctx: PartContext): void {
    this.ctx = ctx;
    for (const name of BUTTON_PINS) ctx.pinInit(name, PinMode.Input);

    this.bouncer = new Bouncer(ctx, (closed) => this.setClosed(closed), bounceEnabled(ctx));

    // Re-evaluate when the outside world changes, so releasing an external
    // driver while the button is held propagates correctly.
    for (const name of ['1.l', '2.l'] as const) {
      ctx.pinWatch(name, Edge.Both, () => this.reapply());
    }

    this.setClosed(false);
    ctx.emit({ pressed: false });
  }

  private setClosed(closed: boolean): void {
    this.closed = closed;
    this.reapply();
  }

  private reapply(): void {
    // bridgePins toggles our own pins, which can re-enter through the watch.
    if (this.reentrant) return;
    this.reentrant = true;
    try {
      // Pair 1 and pair 2 are always internally joined; pressing joins all four.
      if (this.closed) {
        bridgePins(this.ctx, BUTTON_PINS, true);
      } else {
        bridgePins(this.ctx, ['1.l', '1.r'], true);
        bridgePins(this.ctx, ['2.l', '2.r'], true);
      }
    } finally {
      this.reentrant = false;
    }
  }

  control(name: string, value: number | string | boolean): void {
    if (name !== 'pressed') return;
    const next = truthy(value);
    if (next === this.pressed) return;
    this.pressed = next;
    this.bouncer.transition(next);
    this.ctx.emit({ pressed: next });
  }
}

for (const type of ['wokwi-pushbutton', 'wokwi-pushbutton-6mm']) {
  registerPart({
    type,
    pins: [...BUTTON_PINS],
    defaults: { color: 'red', label: '', bounce: '' },
    create: () => new PushbuttonPart(),
  });
}

/**
 * wokwi-slide-switch: SPDT. Pin 2 (common) connects to pin 1 or pin 3.
 * `value` "" = left (pin 1), "1" = right (pin 3).
 */
class SlideSwitchPart implements Part {
  private ctx!: PartContext;
  private right = false;
  private reentrant = false;

  init(ctx: PartContext): void {
    this.ctx = ctx;
    for (const name of ['1', '2', '3']) ctx.pinInit(name, PinMode.Input);
    this.right = ctx.attr('value', '') === '1';
    for (const name of ['1', '2', '3']) {
      ctx.pinWatch(name, Edge.Both, () => this.apply());
    }
    this.apply();
  }

  private apply(): void {
    if (this.reentrant) return;
    this.reentrant = true;
    try {
      bridgePins(this.ctx, this.right ? ['2', '3'] : ['1', '2'], true);
    } finally {
      this.reentrant = false;
    }
    this.ctx.emit({ position: this.right ? 'right' : 'left' });
  }

  control(name: string, value: number | string | boolean): void {
    if (name !== 'value' && name !== 'position') return;
    this.right = truthy(value) || value === 'right';
    this.apply();
  }

  attrChanged(name: string, value: string): void {
    if (name !== 'value') return;
    this.right = value === '1';
    this.apply();
  }
}

registerPart({
  type: 'wokwi-slide-switch',
  pins: ['1', '2', '3'],
  defaults: { value: '', bounce: '' },
  create: () => new SlideSwitchPart(),
});

/** wokwi-dip-switch-8: eight independent switches, pins 1a/1b .. 8a/8b. */
class DipSwitch8Part implements Part {
  private ctx!: PartContext;
  private closed = new Array(8).fill(false);
  private reentrant = false;

  init(ctx: PartContext): void {
    this.ctx = ctx;
    for (let i = 1; i <= 8; i++) {
      ctx.pinInit(`${i}a`, PinMode.Input);
      ctx.pinInit(`${i}b`, PinMode.Input);
      ctx.pinWatch(`${i}a`, Edge.Both, () => this.apply());
      ctx.pinWatch(`${i}b`, Edge.Both, () => this.apply());
    }
    this.apply();
  }

  private apply(): void {
    if (this.reentrant) return;
    this.reentrant = true;
    try {
      for (let i = 0; i < 8; i++) {
        bridgePins(this.ctx, [`${i + 1}a`, `${i + 1}b`], this.closed[i]);
      }
    } finally {
      this.reentrant = false;
    }
    this.ctx.emit({ switches: [...this.closed] });
  }

  control(name: string, value: number | string | boolean): void {
    const m = /^(?:switch)?([1-8])$/.exec(name);
    if (!m) return;
    this.closed[Number(m[1]) - 1] = truthy(value);
    this.apply();
  }
}

registerPart({
  type: 'wokwi-dip-switch-8',
  pins: [
    '1a', '1b', '2a', '2b', '3a', '3b', '4a', '4b',
    '5a', '5b', '6a', '6b', '7a', '7b', '8a', '8b',
  ],
  create: () => new DipSwitch8Part(),
});

/**
 * wokwi-resistor.
 *
 * Wokwi has no analog solver, so a resistor is a passive connector: it ties its
 * two pins to the same level. Its documented role is as an external
 * pull-up/pull-down, which this supports.
 */
class ResistorPart implements Part {
  private ctx!: PartContext;
  private reentrant = false;

  init(ctx: PartContext): void {
    this.ctx = ctx;
    ctx.pinInit('1', PinMode.Input);
    ctx.pinInit('2', PinMode.Input);
    for (const name of ['1', '2']) {
      ctx.pinWatch(name, Edge.Both, () => this.apply());
    }
    this.apply();
    ctx.emit({ value: ctx.attrNumber('value', 1000) });
  }

  private apply(): void {
    if (this.reentrant) return;
    this.reentrant = true;
    try {
      bridgePins(this.ctx, ['1', '2'], true);
    } finally {
      this.reentrant = false;
    }
  }
}

registerPart({
  type: 'wokwi-resistor',
  pins: ['1', '2'],
  defaults: { value: '1000' },
  create: () => new ResistorPart(),
});
