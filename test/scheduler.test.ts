import { describe, it, expect, vi } from 'vitest';
import { Scheduler } from '../src/sim/scheduler.js';

describe('Scheduler', () => {
  it('starts at time zero', () => {
    const s = new Scheduler();
    expect(s.simNanos).toBe(0n);
    expect(s.simMillis).toBe(0);
  });

  it('fires a one-shot timer at the right time', () => {
    const s = new Scheduler();
    const fired: bigint[] = [];
    const id = s.timerInit({ callback: () => fired.push(s.simNanos) });
    s.timerStart(id, 1000); // 1000 us = 1 ms
    s.advance(2_000_000n);
    expect(fired).toEqual([1_000_000n]);
  });

  it('does not fire a one-shot twice', () => {
    const s = new Scheduler();
    const cb = vi.fn();
    const id = s.timerInit({ callback: cb });
    s.timerStart(id, 10);
    s.advance(1_000_000n);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('repeats a repeating timer at a fixed interval', () => {
    const s = new Scheduler();
    const at: bigint[] = [];
    const id = s.timerInit({ callback: () => at.push(s.simNanos) });
    s.timerStart(id, 100, true); // every 100us
    s.advance(550_000n);
    expect(at).toEqual([100_000n, 200_000n, 300_000n, 400_000n, 500_000n]);
  });

  it('stops a repeating timer', () => {
    const s = new Scheduler();
    let count = 0;
    const id = s.timerInit({ callback: () => count++ });
    s.timerStart(id, 100, true);
    s.advance(350_000n);
    expect(count).toBe(3);
    s.timerStop(id);
    s.advance(1_000_000n);
    expect(count).toBe(3);
  });

  it('lets a callback stop its own repeating timer', () => {
    const s = new Scheduler();
    let count = 0;
    const id = s.timerInit({
      callback: () => {
        count++;
        if (count === 2) s.timerStop(id);
      },
    });
    s.timerStart(id, 10, true);
    s.advance(1_000_000n);
    expect(count).toBe(2);
  });

  it('lets a callback reschedule itself with a new interval', () => {
    const s = new Scheduler();
    const at: bigint[] = [];
    const id = s.timerInit({
      callback: () => {
        at.push(s.simNanos);
        if (at.length === 1) s.timerStart(id, 50, true);
      },
    });
    s.timerStart(id, 100, true);
    s.advance(260_000n);
    expect(at).toEqual([100_000n, 150_000n, 200_000n, 250_000n]);
  });

  it('restarting a timer cancels the previous schedule', () => {
    const s = new Scheduler();
    const at: bigint[] = [];
    const id = s.timerInit({ callback: () => at.push(s.simNanos) });
    s.timerStart(id, 1000);
    s.advance(100_000n); // 0.1ms in, before it fires
    s.timerStart(id, 1000); // reschedule: should fire at 1.1ms, only once
    s.advance(5_000_000n);
    expect(at).toEqual([1_100_000n]);
  });

  it('passes userData to the callback', () => {
    const s = new Scheduler();
    const seen: unknown[] = [];
    const id = s.timerInit({ callback: (ud) => seen.push(ud), userData: { tag: 'x' } });
    s.timerStart(id, 1);
    s.advance(1_000_000n);
    expect(seen).toEqual([{ tag: 'x' }]);
  });

  it('orders same-time events by scheduling order', () => {
    const s = new Scheduler();
    const order: string[] = [];
    const a = s.timerInit({ callback: () => order.push('a') });
    const b = s.timerInit({ callback: () => order.push('b') });
    const c = s.timerInit({ callback: () => order.push('c') });
    s.timerStart(a, 100);
    s.timerStart(b, 100);
    s.timerStart(c, 100);
    s.advance(200_000n);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('parks the clock exactly at the requested time', () => {
    const s = new Scheduler();
    const id = s.timerInit({ callback: () => {} });
    s.timerStart(id, 10);
    s.runUntil(5_000_000n);
    expect(s.simNanos).toBe(5_000_000n);
  });

  it('never moves the clock backwards', () => {
    const s = new Scheduler();
    s.advance(1_000_000n);
    s.runUntil(500_000n);
    expect(s.simNanos).toBe(1_000_000n);
  });

  it('step() returns false when nothing is queued', () => {
    const s = new Scheduler();
    expect(s.step()).toBe(false);
  });

  it('step() fires exactly one event', () => {
    const s = new Scheduler();
    let count = 0;
    const id = s.timerInit({ callback: () => count++ });
    s.timerStart(id, 10, true);
    expect(s.step()).toBe(true);
    expect(count).toBe(1);
  });

  it('nextEventTime reports the next deadline', () => {
    const s = new Scheduler();
    const id = s.timerInit({ callback: () => {} });
    s.timerStart(id, 250);
    expect(s.nextEventTime()).toBe(250_000n);
  });

  it('nextEventTime is null on an empty queue', () => {
    expect(new Scheduler().nextEventTime()).toBeNull();
  });

  it('supports the one-shot at() helper', () => {
    const s = new Scheduler();
    let hit = false;
    s.at(5_000n, () => {
      hit = true;
    });
    s.advance(10_000n);
    expect(hit).toBe(true);
  });

  it('reports sim time in us and ms', () => {
    const s = new Scheduler();
    s.advance(2_500_000n);
    expect(s.simMicros).toBe(2500);
    expect(s.simMillis).toBe(2);
  });

  it('rejects a negative delay', () => {
    const s = new Scheduler();
    const id = s.timerInit({ callback: () => {} });
    expect(() => s.timerStartNanos(id, -1n)).toThrow(/negative/);
  });

  it('rejects an unknown timer id', () => {
    const s = new Scheduler();
    expect(() => s.timerStart(999, 10)).toThrow(/unknown timer/);
  });

  it('reset() clears the clock and the queue', () => {
    const s = new Scheduler();
    const id = s.timerInit({ callback: () => {} });
    s.timerStart(id, 10, true);
    s.advance(100_000n);
    s.reset();
    expect(s.simNanos).toBe(0n);
    expect(s.pendingEvents).toBe(0);
  });

  it('keeps ordering correct across many interleaved timers', () => {
    const s = new Scheduler();
    const at: bigint[] = [];
    for (const period of [3, 5, 7, 11]) {
      const id = s.timerInit({ callback: () => at.push(s.simNanos) });
      s.timerStart(id, period, true);
    }
    s.advance(1_000_000n);
    const sorted = [...at].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(at).toEqual(sorted);
  });
});
