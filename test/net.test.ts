import { describe, it, expect, vi } from 'vitest';
import {
  Pin,
  PinMode,
  NetList,
  Edge,
  HIGH,
  LOW,
  VCC_VOLTS,
} from '../src/sim/net.js';

function pin(name: string, mode: PinMode = PinMode.Input): Pin {
  return new Pin('p', name, mode);
}

describe('Net resolution', () => {
  it('an isolated pin with no driver floats and reads LOW', () => {
    const nl = new NetList();
    const a = pin('A');
    const net = nl.isolate(a);
    expect(net.floating).toBe(true);
    expect(a.read()).toBe(LOW);
  });

  it('a strong output drives the net', () => {
    const nl = new NetList();
    const out = pin('OUT', PinMode.Output);
    const inp = pin('IN');
    nl.connect(out, inp);
    out.write(HIGH);
    expect(inp.read()).toBe(HIGH);
    out.write(LOW);
    expect(inp.read()).toBe(LOW);
  });

  it('an output only drives while it is in Output mode', () => {
    const nl = new NetList();
    const out = pin('OUT', PinMode.Output);
    const inp = pin('IN');
    nl.connect(out, inp);
    out.write(HIGH);
    expect(inp.read()).toBe(HIGH);
    out.setMode(PinMode.Input);
    expect(nl.netOf(inp)!.floating).toBe(true);
  });

  it('a pull-up holds the net HIGH when nothing else drives', () => {
    const nl = new NetList();
    const a = pin('A', PinMode.InputPullup);
    const b = pin('B');
    nl.connect(a, b);
    expect(b.read()).toBe(HIGH);
    expect(nl.netOf(b)!.floating).toBe(false);
  });

  it('a pull-down holds the net LOW', () => {
    const nl = new NetList();
    const a = pin('A', PinMode.InputPulldown);
    const b = pin('B');
    nl.connect(a, b);
    expect(b.read()).toBe(LOW);
    expect(nl.netOf(b)!.floating).toBe(false);
  });

  it('a strong LOW output beats a pull-up (the button case)', () => {
    const nl = new NetList();
    const mcu = pin('D2', PinMode.InputPullup);
    const button = pin('BTN', PinMode.Output);
    nl.connect(mcu, button);
    button.write(LOW);
    expect(mcu.read()).toBe(LOW);
  });

  it('flags two opposing strong drivers as a conflict and resolves LOW', () => {
    const nl = new NetList();
    const a = pin('A', PinMode.Output);
    const b = pin('B', PinMode.Output);
    nl.connect(a, b);
    a.write(HIGH);
    b.write(LOW);
    const net = nl.netOf(a)!;
    expect(net.hasConflict).toBe(true);
    expect(net.digital()).toBe(LOW);
    expect(nl.conflicts.length).toBeGreaterThan(0);
  });

  it('agreeing strong drivers are not a conflict', () => {
    const nl = new NetList();
    const a = pin('A', PinMode.Output);
    const b = pin('B', PinMode.Output);
    nl.connect(a, b);
    a.write(HIGH);
    b.write(HIGH);
    expect(nl.netOf(a)!.hasConflict).toBe(false);
    expect(nl.netOf(a)!.digital()).toBe(HIGH);
  });

  it('a pull-up net reads VCC and a driven-low net reads 0V', () => {
    const nl = new NetList();
    const a = pin('A', PinMode.InputPullup);
    const b = pin('B');
    nl.connect(a, b);
    expect(b.adcRead()).toBe(VCC_VOLTS);

    const nl2 = new NetList();
    const c = pin('C', PinMode.Output);
    const d = pin('D');
    nl2.connect(c, d);
    c.write(LOW);
    expect(d.adcRead()).toBe(0);
  });
});

describe('Analog', () => {
  it('a DAC voltage sets the net voltage', () => {
    const nl = new NetList();
    const src = pin('SIG', PinMode.Analog);
    const adc = pin('A0', PinMode.Analog);
    nl.connect(src, adc);
    src.dacWrite(3.3);
    expect(adc.adcRead()).toBeCloseTo(3.3, 6);
  });

  it('derives a digital level from the analog voltage', () => {
    const nl = new NetList();
    const src = pin('SIG', PinMode.Analog);
    const adc = pin('A0', PinMode.Analog);
    nl.connect(src, adc);
    src.dacWrite(4.0);
    expect(adc.read()).toBe(HIGH);
    src.dacWrite(1.0);
    expect(adc.read()).toBe(LOW);
  });

  it('a strong digital driver overrides an analog source', () => {
    const nl = new NetList();
    const src = pin('SIG', PinMode.Analog);
    const drv = pin('OUT', PinMode.Output);
    const adc = pin('A0', PinMode.Analog);
    nl.connect(src, adc);
    nl.connect(drv, adc);
    src.dacWrite(2.5);
    drv.write(HIGH);
    expect(adc.adcRead()).toBe(VCC_VOLTS);
  });

  it('clearing the DAC voltage releases the net', () => {
    const nl = new NetList();
    const src = pin('SIG', PinMode.Analog);
    const adc = pin('A0', PinMode.Analog);
    nl.connect(src, adc);
    src.dacWrite(2.5);
    expect(nl.netOf(adc)!.floating).toBe(false);
    src.dacWrite(null);
    expect(nl.netOf(adc)!.floating).toBe(true);
  });
});

describe('Net merging', () => {
  it('connecting three pins puts them all on one net', () => {
    const nl = new NetList();
    const a = pin('A', PinMode.Output);
    const b = pin('B');
    const c = pin('C');
    nl.connect(a, b);
    nl.connect(b, c);
    expect(nl.netOf(a)).toBe(nl.netOf(c));
    a.write(HIGH);
    expect(c.read()).toBe(HIGH);
  });

  it('merges two separate nets when they are joined', () => {
    const nl = new NetList();
    const a = pin('A', PinMode.Output);
    const b = pin('B');
    const c = pin('C');
    const d = pin('D');
    nl.connect(a, b);
    nl.connect(c, d);
    expect(nl.netOf(a)).not.toBe(nl.netOf(c));
    nl.connect(b, c);
    expect(nl.netOf(a)).toBe(nl.netOf(d));
    a.write(HIGH);
    expect(d.read()).toBe(HIGH);
    expect(nl.allNets()).toHaveLength(1);
  });

  it('connecting the same pair twice is a no-op', () => {
    const nl = new NetList();
    const a = pin('A');
    const b = pin('B');
    const n1 = nl.connect(a, b);
    const n2 = nl.connect(a, b);
    expect(n1).toBe(n2);
    expect(n1.pins).toHaveLength(2);
  });
});

describe('Pin watches', () => {
  it('fires on a rising edge only', () => {
    const nl = new NetList();
    const out = pin('OUT', PinMode.Output);
    const inp = pin('IN');
    nl.connect(out, inp);
    const cb = vi.fn();
    inp.watchPin(Edge.Rising, cb);

    out.write(HIGH);
    nl.settle();
    expect(cb).toHaveBeenCalledTimes(1);

    out.write(LOW);
    nl.settle();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires on a falling edge only', () => {
    const nl = new NetList();
    const out = pin('OUT', PinMode.Output);
    const inp = pin('IN');
    nl.connect(out, inp);
    out.write(HIGH);
    nl.settle();

    const cb = vi.fn();
    inp.watchPin(Edge.Falling, cb);
    out.write(LOW);
    nl.settle();
    expect(cb).toHaveBeenCalledTimes(1);

    out.write(HIGH);
    nl.settle();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires on both edges', () => {
    const nl = new NetList();
    const out = pin('OUT', PinMode.Output);
    const inp = pin('IN');
    nl.connect(out, inp);
    const cb = vi.fn();
    inp.watchPin(Edge.Both, cb);

    out.write(HIGH);
    nl.settle();
    out.write(LOW);
    nl.settle();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('passes the new value to the callback', () => {
    const nl = new NetList();
    const out = pin('OUT', PinMode.Output);
    const inp = pin('IN');
    nl.connect(out, inp);
    const seen: number[] = [];
    inp.watchPin(Edge.Both, (v) => seen.push(v));
    out.write(HIGH);
    nl.settle();
    out.write(LOW);
    nl.settle();
    expect(seen).toEqual([HIGH, LOW]);
  });

  it('does not fire when the level did not actually change', () => {
    const nl = new NetList();
    const out = pin('OUT', PinMode.Output);
    const inp = pin('IN');
    nl.connect(out, inp);
    const cb = vi.fn();
    inp.watchPin(Edge.Both, cb);
    out.write(LOW); // already LOW
    nl.settle();
    expect(cb).not.toHaveBeenCalled();
  });

  it('allows only one watch per pin', () => {
    const p = pin('A');
    expect(p.watchPin(Edge.Both, () => {})).toBe(true);
    expect(p.watchPin(Edge.Both, () => {})).toBe(false);
  });

  it('watchStop removes the watch', () => {
    const nl = new NetList();
    const out = pin('OUT', PinMode.Output);
    const inp = pin('IN');
    nl.connect(out, inp);
    const cb = vi.fn();
    inp.watchPin(Edge.Both, cb);
    inp.watchStop();
    out.write(HIGH);
    nl.settle();
    expect(cb).not.toHaveBeenCalled();
  });

  it('propagates a chain of watches in one settle()', () => {
    // out -> a, and a's watch drives b, which c observes.
    const nl = new NetList();
    const out = pin('OUT', PinMode.Output);
    const a = pin('A');
    const b = pin('B', PinMode.Output);
    const c = pin('C');
    nl.connect(out, a);
    nl.connect(b, c);

    a.watchPin(Edge.Both, (v) => {
      b.write(v);
      nl.markDirty(nl.netOf(b)!);
    });

    out.write(HIGH);
    nl.markDirty(nl.netOf(out)!);
    nl.settle();
    expect(c.read()).toBe(HIGH);
  });

  it('throws instead of hanging on an oscillating circuit', () => {
    const nl = new NetList();
    const out = pin('OUT', PinMode.Output);
    const inp = pin('IN');
    nl.connect(out, inp);
    // An inverter feeding itself: every settle pass flips the value again.
    inp.watchPin(Edge.Both, (v) => {
      out.write(v === HIGH ? LOW : HIGH);
      nl.markDirty(nl.netOf(out)!);
    });
    out.write(HIGH);
    nl.markDirty(nl.netOf(out)!);
    expect(() => nl.settle()).toThrow(/oscillating/);
  });
});

describe('NetList lifecycle', () => {
  it('reset clears nets and conflicts', () => {
    const nl = new NetList();
    const a = pin('A', PinMode.Output);
    const b = pin('B', PinMode.Output);
    nl.connect(a, b);
    a.write(HIGH);
    b.write(LOW);
    nl.netOf(a)!.hasConflict;
    expect(nl.allNets().length).toBe(1);
    nl.reset();
    expect(nl.allNets()).toHaveLength(0);
    expect(nl.conflicts).toHaveLength(0);
  });
});
