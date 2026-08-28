/**
 * Event-driven scheduler with a nanosecond simulation clock.
 *
 * Mirrors the Wokwi chips-api timing model (docs/wokwi/01-core.md section 3):
 * parts never poll, they schedule callbacks and react to pin edges.
 */

export type TimerCallback = (userData: unknown) => void;

interface ScheduledEvent {
  /** Absolute sim time in nanoseconds. */
  at: bigint;
  /** Monotonic tiebreaker so equal-time events fire in scheduling order. */
  seq: number;
  timerId: number;
  cancelled: boolean;
}

export interface TimerConfig {
  callback: TimerCallback;
  userData?: unknown;
}

interface TimerSlot {
  config: TimerConfig;
  /** The event currently scheduled for this timer, if any. */
  pending: ScheduledEvent | null;
  /** Repeat interval in ns, or null for a one-shot. */
  interval: bigint | null;
}

/**
 * A binary min-heap keyed on (at, seq).
 *
 * A sorted array would be simpler, but blink-rate tests schedule on the order of
 * 10^5 events and the O(n) insert showed up immediately.
 */
class EventQueue {
  private heap: ScheduledEvent[] = [];

  get size(): number {
    return this.heap.length;
  }

  private static before(a: ScheduledEvent, b: ScheduledEvent): boolean {
    return a.at === b.at ? a.seq < b.seq : a.at < b.at;
  }

  push(ev: ScheduledEvent): void {
    this.heap.push(ev);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!EventQueue.before(this.heap[i], this.heap[parent])) break;
      [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
      i = parent;
    }
  }

  peek(): ScheduledEvent | undefined {
    return this.heap[0];
  }

  pop(): ScheduledEvent | undefined {
    const top = this.heap[0];
    if (top === undefined) return undefined;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.heap.length && EventQueue.before(this.heap[l], this.heap[smallest])) smallest = l;
        if (r < this.heap.length && EventQueue.before(this.heap[r], this.heap[smallest])) smallest = r;
        if (smallest === i) break;
        [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
        i = smallest;
      }
    }
    return top;
  }

  clear(): void {
    this.heap = [];
  }
}

export class Scheduler {
  private nanos = 0n;
  private queue = new EventQueue();
  private timers = new Map<number, TimerSlot>();
  private nextTimerId = 1;
  private seq = 0;

  /** Current simulation time in nanoseconds. */
  get simNanos(): bigint {
    return this.nanos;
  }

  get simMicros(): number {
    return Number(this.nanos / 1000n);
  }

  get simMillis(): number {
    return Number(this.nanos / 1_000_000n);
  }

  /** Number of events still queued. Exposed for tests and diagnostics. */
  get pendingEvents(): number {
    return this.queue.size;
  }

  timerInit(config: TimerConfig): number {
    const id = this.nextTimerId++;
    this.timers.set(id, { config, pending: null, interval: null });
    return id;
  }

  /** Schedule a timer `micros` microseconds from now. */
  timerStart(timerId: number, micros: number, repeat = false): void {
    this.timerStartNanos(timerId, BigInt(Math.round(micros * 1000)), repeat);
  }

  /** Schedule a timer `nanos` nanoseconds from now. */
  timerStartNanos(timerId: number, nanos: bigint, repeat = false): void {
    const slot = this.timers.get(timerId);
    if (!slot) throw new Error(`unknown timer id ${timerId}`);
    if (nanos < 0n) throw new Error('timer delay must not be negative');
    this.cancelPending(slot);
    slot.interval = repeat ? nanos : null;
    this.schedule(slot, timerId, nanos);
  }

  timerStop(timerId: number): void {
    const slot = this.timers.get(timerId);
    if (!slot) return;
    this.cancelPending(slot);
    slot.interval = null;
  }

  /** One-shot convenience that does not require pre-registering a timer. */
  at(nanosFromNow: bigint, callback: TimerCallback, userData?: unknown): number {
    const id = this.timerInit({ callback, userData });
    this.timerStartNanos(id, nanosFromNow);
    return id;
  }

  private cancelPending(slot: TimerSlot): void {
    if (slot.pending) {
      slot.pending.cancelled = true;
      slot.pending = null;
    }
  }

  private schedule(slot: TimerSlot, timerId: number, delay: bigint): void {
    const ev: ScheduledEvent = {
      at: this.nanos + delay,
      seq: this.seq++,
      timerId,
      cancelled: false,
    };
    slot.pending = ev;
    this.queue.push(ev);
  }

  /** Sim time of the next queued event, or null when the queue is empty. */
  nextEventTime(): bigint | null {
    for (;;) {
      const top = this.queue.peek();
      if (!top) return null;
      if (top.cancelled) {
        this.queue.pop();
        continue;
      }
      return top.at;
    }
  }

  /**
   * Run every event scheduled at or before `untilNanos`, then park the clock
   * exactly at `untilNanos`.
   */
  runUntil(untilNanos: bigint): void {
    for (;;) {
      const next = this.nextEventTime();
      if (next === null || next > untilNanos) break;
      this.step();
    }
    if (this.nanos < untilNanos) this.nanos = untilNanos;
  }

  /** Advance by a relative amount. */
  advance(nanos: bigint): void {
    this.runUntil(this.nanos + nanos);
  }

  /**
   * Fire exactly one event, moving the clock to its scheduled time.
   * Returns false when nothing was queued.
   */
  step(): boolean {
    let ev: ScheduledEvent | undefined;
    for (;;) {
      ev = this.queue.pop();
      if (!ev) return false;
      if (!ev.cancelled) break;
    }

    this.nanos = ev.at;
    const slot = this.timers.get(ev.timerId);
    if (!slot) return true;

    // Re-arm a repeating timer *before* the callback runs, so the callback can
    // legally stop or reschedule it.
    if (slot.pending === ev) slot.pending = null;
    if (slot.interval !== null && slot.interval > 0n) {
      this.schedule(slot, ev.timerId, slot.interval);
    }

    slot.config.callback(slot.config.userData);
    return true;
  }

  reset(): void {
    this.nanos = 0n;
    this.queue.clear();
    this.timers.clear();
    this.nextTimerId = 1;
    this.seq = 0;
  }
}
