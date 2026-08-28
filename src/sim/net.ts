/**
 * Pin and net model.
 *
 * Wokwi does not do SPICE-level analog (docs/wokwi/01-core.md section 3): pins
 * drive a digital level or an explicit voltage, and a net resolves those into a
 * single value. This model follows the same simplification:
 *
 *   strong drivers (OUTPUT) beat weak ones (pull-up/pull-down) beat floating.
 *   Two strong drivers at opposite levels are a short: reported, resolved LOW.
 */

export enum PinMode {
  Input = 'input',
  InputPullup = 'input-pullup',
  InputPulldown = 'input-pulldown',
  Output = 'output',
  Analog = 'analog',
}

export const LOW = 0;
export const HIGH = 1;
export type DigitalValue = 0 | 1;

export enum Edge {
  Rising = 'rising',
  Falling = 'falling',
  Both = 'both',
}

/** ADC reference is 5 V on every MCU in Wokwi, regardless of the real chip. */
export const VCC_VOLTS = 5;

export type PinChangeCallback = (value: DigitalValue, pin: Pin) => void;

interface Watch {
  edge: Edge;
  callback: PinChangeCallback;
}

export class Pin {
  readonly name: string;
  readonly partId: string;
  net: Net | null = null;

  private _mode: PinMode = PinMode.Input;
  /** Level this pin drives when in Output mode. */
  private _outputValue: DigitalValue = LOW;
  /** Explicit analog voltage this pin drives, or null when it drives none. */
  private _dacVoltage: number | null = null;
  private watch: Watch | null = null;
  /** Last value observed by this pin, used to detect edges. */
  private lastSeen: DigitalValue = LOW;

  constructor(partId: string, name: string, mode: PinMode = PinMode.Input) {
    this.partId = partId;
    this.name = name;
    this._mode = mode;
  }

  get id(): string {
    return `${this.partId}:${this.name}`;
  }

  get mode(): PinMode {
    return this._mode;
  }

  get outputValue(): DigitalValue {
    return this._outputValue;
  }

  get dacVoltage(): number | null {
    return this._dacVoltage;
  }

  setMode(mode: PinMode): void {
    if (this._mode === mode) return;
    this._mode = mode;
    this.net?.invalidate();
  }

  /** Drive a digital level. Only takes effect while the pin is in Output mode. */
  write(value: DigitalValue): void {
    if (this._outputValue === value) return;
    this._outputValue = value;
    if (this._mode === PinMode.Output) this.net?.invalidate();
  }

  /** Read the resolved digital level of the net this pin sits on. */
  read(): DigitalValue {
    return this.net ? this.net.digital() : LOW;
  }

  /**
   * Read the net voltage. The pin should be in Analog mode, matching the Wokwi
   * rule that `pin_adc_read` requires ANALOG.
   */
  adcRead(): number {
    return this.net ? this.net.voltage() : 0;
  }

  /**
   * Drive an explicit voltage. Wokwi allows this before the pin is switched to
   * analog mode, with the voltage applying once the mode changes.
   */
  dacWrite(volts: number | null): void {
    if (this._dacVoltage === volts) return;
    this._dacVoltage = volts;
    this.net?.invalidate();
  }

  /** Returns false if a watch is already installed, matching `pin_watch`. */
  watchPin(edge: Edge, callback: PinChangeCallback): boolean {
    if (this.watch) return false;
    this.watch = { edge, callback };
    this.lastSeen = this.read();
    return true;
  }

  watchStop(): void {
    this.watch = null;
  }

  /** Called by the net after a resolution change. */
  notify(value: DigitalValue): void {
    const previous = this.lastSeen;
    if (previous === value) return;
    this.lastSeen = value;
    const w = this.watch;
    if (!w) return;
    const rising = previous === LOW && value === HIGH;
    if (w.edge === Edge.Both || (w.edge === Edge.Rising && rising) || (w.edge === Edge.Falling && !rising)) {
      w.callback(value, this);
    }
  }

  /** Sync `lastSeen` without firing the watch (used when joining a net). */
  syncSeen(): void {
    this.lastSeen = this.read();
  }
}

export interface NetConflict {
  netId: string;
  drivers: string[];
}

/**
 * A set of pins wired together. Value resolution is lazy: writes mark the net
 * dirty and the next read recomputes, so a burst of writes costs one pass.
 */
/** Back-reference a Net uses to report that it needs re-propagating. */
export interface NetOwner {
  enqueue(net: Net): void;
}

export class Net {
  readonly id: string;
  readonly pins: Pin[] = [];
  /** Set by the NetList that owns this net. */
  owner: NetOwner | null = null;

  private dirty = true;
  private cachedDigital: DigitalValue = LOW;
  private cachedVoltage = 0;
  private cachedFloating = true;
  private conflicting = false;
  private onConflict?: (c: NetConflict) => void;

  constructor(id: string, onConflict?: (c: NetConflict) => void) {
    this.id = id;
    this.onConflict = onConflict;
  }

  add(pin: Pin): void {
    if (pin.net === this) return;
    if (pin.net) pin.net.remove(pin);
    pin.net = this;
    this.pins.push(pin);
    this.invalidate();
    pin.syncSeen();
  }

  remove(pin: Pin): void {
    const i = this.pins.indexOf(pin);
    if (i >= 0) this.pins.splice(i, 1);
    if (pin.net === this) pin.net = null;
    this.invalidate();
  }

  /**
   * Mark the resolved value stale and queue this net for propagation.
   * Called by pins on every write/mode change, so watches fire without the
   * caller having to know about the NetList.
   */
  invalidate(): void {
    this.dirty = true;
    this.owner?.enqueue(this);
  }

  /** True when nothing drives this net at all. */
  get floating(): boolean {
    this.resolve();
    return this.cachedFloating;
  }

  /** True when two strong drivers disagree. */
  get hasConflict(): boolean {
    this.resolve();
    return this.conflicting;
  }

  digital(): DigitalValue {
    this.resolve();
    return this.cachedDigital;
  }

  voltage(): number {
    this.resolve();
    return this.cachedVoltage;
  }

  private resolve(): void {
    if (!this.dirty) return;
    this.dirty = false;

    let strongHigh = 0;
    let strongLow = 0;
    let weakHigh = 0;
    let weakLow = 0;
    let analogSum = 0;
    let analogCount = 0;
    const strongDrivers: string[] = [];

    for (const pin of this.pins) {
      const dac = pin.dacVoltage;
      if (dac !== null) {
        analogSum += dac;
        analogCount++;
        continue;
      }
      switch (pin.mode) {
        case PinMode.Output:
          if (pin.outputValue === HIGH) strongHigh++;
          else strongLow++;
          strongDrivers.push(`${pin.id}=${pin.outputValue ? 'HIGH' : 'LOW'}`);
          break;
        case PinMode.InputPullup:
          weakHigh++;
          break;
        case PinMode.InputPulldown:
          weakLow++;
          break;
        default:
          break;
      }
    }

    const wasConflicting = this.conflicting;
    this.conflicting = strongHigh > 0 && strongLow > 0;
    if (this.conflicting && !wasConflicting) {
      this.onConflict?.({ netId: this.id, drivers: strongDrivers });
    }

    if (strongHigh > 0 || strongLow > 0) {
      this.cachedFloating = false;
      // A short resolves LOW: the low-side driver wins in practice.
      this.cachedDigital = this.conflicting ? LOW : strongHigh > 0 ? HIGH : LOW;
      this.cachedVoltage = this.cachedDigital === HIGH ? VCC_VOLTS : 0;
    } else if (analogCount > 0) {
      this.cachedFloating = false;
      // Several analog sources on one net average out; a single source is exact.
      this.cachedVoltage = analogSum / analogCount;
      this.cachedDigital = this.cachedVoltage >= VCC_VOLTS / 2 ? HIGH : LOW;
    } else if (weakHigh > 0 || weakLow > 0) {
      this.cachedFloating = false;
      // Opposing pulls form a divider; treat the pull-up as dominant.
      this.cachedDigital = weakHigh > 0 ? HIGH : LOW;
      this.cachedVoltage = this.cachedDigital === HIGH ? VCC_VOLTS : 0;
    } else {
      this.cachedFloating = true;
      this.cachedDigital = LOW;
      this.cachedVoltage = 0;
    }
  }

  /** Recompute and fire pin watches whose level changed. */
  propagate(): void {
    const value = this.digital();
    for (const pin of this.pins) pin.notify(value);
  }
}

/**
 * Owns every pin and net in a simulation and keeps them consistent.
 */
export class NetList implements NetOwner {
  private nets = new Map<string, Net>();
  private pinToNet = new Map<Pin, Net>();
  private nextNetId = 1;
  private dirtyNets = new Set<Net>();
  readonly conflicts: NetConflict[] = [];

  private handleConflict = (c: NetConflict): void => {
    this.conflicts.push(c);
  };

  /** Wire two pins together, merging their nets if both already have one. */
  connect(a: Pin, b: Pin): Net {
    const netA = this.pinToNet.get(a);
    const netB = this.pinToNet.get(b);

    if (netA && netB) {
      if (netA === netB) return netA;
      // Merge the smaller net into the larger to keep the copying cheap.
      const [keep, drop] = netA.pins.length >= netB.pins.length ? [netA, netB] : [netB, netA];
      for (const pin of [...drop.pins]) {
        drop.remove(pin);
        keep.add(pin);
        this.pinToNet.set(pin, keep);
      }
      drop.owner = null;
      this.nets.delete(drop.id);
      this.dirtyNets.delete(drop);
      this.markDirty(keep);
      return keep;
    }

    if (netA) {
      netA.add(b);
      this.pinToNet.set(b, netA);
      this.markDirty(netA);
      return netA;
    }
    if (netB) {
      netB.add(a);
      this.pinToNet.set(a, netB);
      this.markDirty(netB);
      return netB;
    }

    const net = new Net(`net${this.nextNetId++}`, this.handleConflict);
    net.owner = this;
    net.add(a);
    net.add(b);
    this.pinToNet.set(a, net);
    this.pinToNet.set(b, net);
    this.nets.set(net.id, net);
    this.markDirty(net);
    return net;
  }

  /** Give a pin its own single-pin net so reads and writes still work. */
  isolate(pin: Pin): Net {
    const existing = this.pinToNet.get(pin);
    if (existing) return existing;
    const net = new Net(`net${this.nextNetId++}`, this.handleConflict);
    net.owner = this;
    net.add(pin);
    this.pinToNet.set(pin, net);
    this.nets.set(net.id, net);
    this.markDirty(net);
    return net;
  }

  netOf(pin: Pin): Net | undefined {
    return this.pinToNet.get(pin);
  }

  allNets(): Net[] {
    return [...this.nets.values()];
  }

  /** NetOwner hook: a net asking to be re-propagated on the next settle(). */
  enqueue(net: Net): void {
    this.dirtyNets.add(net);
  }

  /** True when at least one net is waiting to propagate. */
  get hasPending(): boolean {
    return this.dirtyNets.size > 0;
  }

  markDirty(net: Net): void {
    net.invalidate();
  }

  /**
   * Push pending level changes out to pin watches.
   *
   * A watch callback may write more pins, so this loops until the system
   * settles. The iteration cap catches oscillating circuits (e.g. an inverter
   * wired to its own input) instead of hanging.
   */
  settle(maxPasses = 32): void {
    let passes = 0;
    while (this.dirtyNets.size > 0) {
      if (++passes > maxPasses) {
        throw new Error(
          `net list failed to settle after ${maxPasses} passes; ` +
            'the circuit is probably oscillating',
        );
      }
      const batch = [...this.dirtyNets];
      this.dirtyNets.clear();
      for (const net of batch) net.propagate();
    }
  }

  /** Mark every net dirty; used after bulk wiring or a reset. */
  invalidateAll(): void {
    for (const net of this.nets.values()) this.markDirty(net);
  }

  reset(): void {
    for (const net of this.nets.values()) net.owner = null;
    this.nets.clear();
    this.pinToNet.clear();
    this.dirtyNets.clear();
    this.conflicts.length = 0;
    this.nextNetId = 1;
  }
}
