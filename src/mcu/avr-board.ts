/**
 * AVR board runtime, built on avr8js and driven by a `BoardDefinition`.
 *
 * Bridges avr8js's register-level model to the simulator's Pin/Net model:
 *   AVR port register change  -> listener -> Pin mode/value -> net settle
 *   net level change          -> pin watch -> port.setPin() -> PIN register
 *
 * The MCU is the clock master. Simulation time is derived from CPU cycles, and
 * part timers are interleaved by slicing the run at each scheduled event.
 *
 * Everything chip-specific lives in `avr-chip.ts`, everything board-specific
 * in `boards.ts`; this file only knows how to wire the two together.
 */

import {
  CPU,
  avrInstruction,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  AVRADC,
  AVRTWI,
  AVRSPI,
  AVRClock,
  PinState,
  ADCMuxInputType,
  type AVRTimerConfig,
} from 'avr8js';

import { Pin, PinMode, Edge, HIGH, LOW, type DigitalValue } from '../sim/net.js';
import type { NetList } from '../sim/net.js';
import type { Scheduler } from '../sim/scheduler.js';
import { loadHex } from './hex.js';
import { basePinName, POWER_RAILS, type BoardDefinition } from './boards.js';

export interface AvrBoardOptions {
  frequencyHz?: number;
  /**
   * Board pin names to create. Defaults to the board's own header.
   * Overriding it is a test convenience, not something a diagram does.
   */
  pinNames?: readonly string[];
}

interface PortBinding {
  port: AVRIOPort;
  /** bit index within the port -> board pin name */
  map: { bit: number; name: string }[];
}

export class AvrBoard {
  readonly definition: BoardDefinition;
  readonly cpu: CPU;
  readonly ports = new Map<string, AVRIOPort>();
  readonly timers: AVRTimer[] = [];
  /** USART0 first. `usart` is the one wired to the serial monitor. */
  readonly usarts: AVRUSART[] = [];
  readonly adc: AVRADC;
  readonly twi: AVRTWI;
  readonly spi: AVRSPI;
  readonly clock: AVRClock;

  readonly frequencyHz: number;
  readonly pins = new Map<string, Pin>();

  /** Fired for each byte the sketch writes to Serial. */
  onSerialByte: ((byte: number) => void) | null = null;

  private bindings: PortBinding[] = [];
  private analogChannels = new Map<number, Pin>();
  private program: Uint16Array;
  private loaded = false;
  private resetHeld = false;

  constructor(
    definition: BoardDefinition,
    private netlist: NetList,
    private scheduler: Scheduler,
    options: AvrBoardOptions = {},
  ) {
    this.definition = definition;
    const chip = definition.chip;
    this.frequencyHz = options.frequencyHz ?? definition.defaultFrequencyHz;

    this.program = new Uint16Array(chip.flashBytes / 2);
    this.cpu = new CPU(this.program, chip.dataSpaceBytes);

    for (const [letter, config] of Object.entries(chip.ports)) {
      this.ports.set(letter, new AVRIOPort(this.cpu, config));
    }
    for (const config of chip.timers) {
      this.timers.push(new AVRTimer(this.cpu, config));
    }
    keepPrescalerPhase(this.cpu, chip.timers);
    for (const config of chip.usarts) {
      this.usarts.push(new AVRUSART(this.cpu, config, this.frequencyHz));
    }
    this.adc = new AVRADC(this.cpu, chip.adc);
    this.twi = new AVRTWI(this.cpu, chip.twi, this.frequencyHz);
    this.spi = new AVRSPI(this.cpu, chip.spi, this.frequencyHz);
    this.clock = new AVRClock(this.cpu, this.frequencyHz, chip.clock);

    this.createPins(options.pinNames ?? definition.pins);
    this.tieAliases();
    this.bindPorts();
    this.bindAdc();

    this.usart.onByteTransmit = (byte: number) => {
      this.onSerialByte?.(byte);
    };
  }

  /** USART0 - the one the Arduino core calls `Serial`. */
  get usart(): AVRUSART {
    return this.usarts[0];
  }

  get flashBytes(): number {
    return this.definition.chip.flashBytes;
  }

  private createPins(names: readonly string[]): void {
    for (const name of names) {
      const pin = new Pin('__mcu__', name, PinMode.Input);
      this.pins.set(name, pin);
      this.netlist.isolate(pin);
    }
    for (const name of names) {
      const rail = POWER_RAILS[basePinName(name)];
      if (!rail) continue;
      const pin = this.pins.get(name)!;
      pin.setMode(PinMode.Output);
      pin.write(rail === 'high' ? HIGH : LOW);
    }
  }

  /**
   * Tie duplicated header pins to the pad they repeat. They are one piece of
   * copper on the real board, so wiring a part to `SCL` has to be the same as
   * wiring it to D21 - including seeing what the MCU drives there.
   */
  private tieAliases(): void {
    for (const [alias, primary] of Object.entries(this.definition.aliases ?? {})) {
      const a = this.pins.get(alias);
      const b = this.pins.get(primary);
      if (a && b) this.netlist.connect(a, b);
    }
  }

  pin(name: string): Pin {
    const pin = this.pins.get(name);
    if (!pin) throw new Error(`MCU has no pin ${JSON.stringify(name)}`);
    return pin;
  }

  /** True if the board exposes this pin at all. */
  hasPin(name: string): boolean {
    return this.pins.has(name);
  }

  private bindPorts(): void {
    for (const [letter, bits] of Object.entries(this.definition.gpio)) {
      const port = this.ports.get(letter);
      if (!port) continue;
      const map: { bit: number; name: string }[] = [];
      for (const [bit, name] of Object.entries(bits)) {
        // A pin list narrowed for a test may not carry every header pin.
        if (this.pins.has(name)) map.push({ bit: Number(bit), name });
      }
      if (map.length) this.bindings.push({ port, map });
    }

    for (const binding of this.bindings) {
      // AVR -> world: any port register (or timer PWM override) change.
      binding.port.addListener(() => this.syncPortToPins(binding));

      // World -> AVR: mirror the net level into the PIN register. setPin is
      // masked by DDR inside avr8js, so this is inert while the pin is an output.
      for (const { bit, name } of binding.map) {
        const pin = this.pin(name);
        pin.watchPin(Edge.Both, (value: DigitalValue) => {
          binding.port.setPin(bit, value === HIGH);
        });
      }
    }

    for (const [channel, name] of Object.entries(this.definition.adcChannels)) {
      if (this.pins.has(name)) this.analogChannels.set(Number(channel), this.pin(name));
    }

    this.syncAllPorts();
  }

  private syncPortToPins(binding: PortBinding): void {
    for (const { bit, name } of binding.map) {
      const pin = this.pin(name);
      switch (binding.port.pinState(bit)) {
        case PinState.Low:
          pin.setMode(PinMode.Output);
          pin.write(LOW);
          break;
        case PinState.High:
          pin.setMode(PinMode.Output);
          pin.write(HIGH);
          break;
        case PinState.InputPullUp:
          pin.setMode(PinMode.InputPullup);
          break;
        default:
          pin.setMode(PinMode.Input);
          break;
      }
    }
  }

  private syncAllPorts(): void {
    for (const binding of this.bindings) this.syncPortToPins(binding);
  }

  /** World -> AVR for every pin at once, mirroring net levels into PIN. */
  private syncPinsToPorts(): void {
    for (const binding of this.bindings) {
      for (const { bit, name } of binding.map) {
        binding.port.setPin(bit, this.pin(name).read() === HIGH);
      }
    }
  }

  /**
   * Sample the analog pin live at conversion time rather than mirroring into
   * `channelValues`, so a slider moved mid-conversion is picked up.
   */
  private bindAdc(): void {
    this.adc.onADCRead = (input) => {
      let voltage = 0;
      if (input.type === ADCMuxInputType.SingleEnded) {
        voltage = this.analogChannels.get(input.channel)?.adcRead() ?? 0;
      } else if (input.type === ADCMuxInputType.Constant) {
        voltage = input.voltage;
      } else if (input.type === ADCMuxInputType.Temperature) {
        voltage = 0.3145; // ~25C on the internal sensor
      }
      const reference = this.adc.referenceVoltage || 5;
      const raw = Math.floor((voltage / reference) * 1024);
      const value = Math.min(Math.max(raw, 0), 1023);
      this.cpu.addClockEvent(() => this.adc.completeADCRead(value), this.adc.sampleCycles);
    };
  }

  /** Load firmware from Intel HEX text. Resets the CPU. */
  loadHexFirmware(hex: string): void {
    this.program.fill(0);
    const bytes = new Uint8Array(this.program.buffer);
    loadHex(hex, bytes);
    this.loaded = true;
    this.reset();
  }

  /** Load firmware from raw flash bytes. */
  loadBinary(data: Uint8Array): void {
    if (data.length > this.flashBytes) {
      throw new Error(`firmware is ${data.length} bytes, flash holds ${this.flashBytes}`);
    }
    this.program.fill(0);
    new Uint8Array(this.program.buffer).set(data);
    this.loaded = true;
    this.reset();
  }

  get firmwareLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Full reset, including the cycle counter. Only safe before the simulation
   * starts, because the scheduler derives its clock from `cpu.cycles` and
   * cannot go backwards - use `resetMcu()` to reset a board that is running.
   */
  reset(): void {
    this.resetMcu();
    this.cpu.cycles = 0;
  }

  /**
   * Reset the chip the way pulling RESET low does, without disturbing the
   * simulation clock.
   *
   * Clearing the register file also clears the PIN registers, which hold what
   * the outside world is driving. Those are re-read from the nets afterwards,
   * or a button held down across a reset would come back up.
   */
  resetMcu(): void {
    this.cpu.data.fill(0);
    this.cpu.reset();

    // avr8js's timer reset also raises its `updateDivider` flag, so the timer
    // re-reads its prescaler and re-bases its cycle mark before it counts
    // again. Nothing extra is needed to keep it in step with the clock.
    for (const timer of this.timers) timer.reset();
    for (const usart of this.usarts) usart.reset();

    this.syncAllPorts();
    this.syncPinsToPorts();
  }

  /**
   * Hold the RESET pin low, or let it go.
   *
   * While held the chip is stopped and its pins are released; letting go
   * starts the firmware again from the reset vector. Simulated time keeps
   * running throughout, exactly as the real clock would.
   */
  setResetHeld(held: boolean): void {
    if (held === this.resetHeld) return;
    this.resetHeld = held;
    this.resetMcu();
  }

  get inReset(): boolean {
    return this.resetHeld;
  }

  /** Send a byte to the sketch's Serial input. */
  writeSerialByte(byte: number): boolean | undefined {
    return this.usart.writeByte(byte);
  }

  get serialBusy(): boolean {
    return this.usart.rxBusy;
  }

  get cycles(): number {
    return this.cpu.cycles;
  }

  cyclesToNanos(cycles: number): bigint {
    return (BigInt(Math.round(cycles)) * 1_000_000_000n) / BigInt(this.frequencyHz);
  }

  nanosToCycles(nanos: bigint): number {
    return Number((nanos * BigInt(this.frequencyHz)) / 1_000_000_000n);
  }

  /** Sim time implied by the CPU cycle counter. */
  get mcuNanos(): bigint {
    return this.cyclesToNanos(this.cpu.cycles);
  }

  /**
   * Step the CPU until its cycle counter reaches the cycle matching `deadline`.
   * Net changes are settled after each instruction so parts see edges in order.
   */
  private runCpuUntilNanos(deadline: bigint): void {
    const targetCycles = this.nanosToCycles(deadline);
    const { cpu, netlist, scheduler } = this;
    if (this.resetHeld) {
      // Held in reset: the clock still runs, the CPU does not. Skipping the
      // cycles rather than executing them keeps the timebase moving so part
      // timers and the run loop carry on instead of stalling.
      cpu.cycles = Math.max(cpu.cycles, targetCycles);
      scheduler.syncTime(this.cyclesToNanos(cpu.cycles));
      netlist.settle();
      return;
    }
    while (cpu.cycles < targetCycles) {
      avrInstruction(cpu);
      cpu.tick();
      // Only pay for the cycles->nanos conversion when a pin actually changed.
      // Parts read simNanos inside their watch callbacks to measure pulse
      // widths, so the clock has to be current before those callbacks run.
      if (netlist.hasPending) {
        scheduler.syncTime(this.cyclesToNanos(cpu.cycles));
        netlist.settle();
      }
    }
    scheduler.syncTime(this.cyclesToNanos(cpu.cycles));
  }

  /**
   * Advance the whole system to `deadline`, interleaving CPU execution with
   * part timers so a timer scheduled mid-window fires at the right moment.
   */
  runUntilNanos(deadline: bigint): void {
    let guard = 0;
    while (this.scheduler.simNanos < deadline) {
      if (++guard > 1_000_000) {
        throw new Error('runUntilNanos made no progress; scheduler may be stuck');
      }
      const next = this.scheduler.nextEventTime();
      const chunkEnd = next !== null && next < deadline ? next : deadline;
      this.runCpuUntilNanos(chunkEnd);
      this.scheduler.runUntil(chunkEnd);
      this.netlist.settle();
    }
  }

  /** Advance by a relative amount of simulated time. */
  advanceNanos(nanos: bigint): void {
    this.runUntilNanos(this.scheduler.simNanos + nanos);
  }

  advanceMillis(ms: number): void {
    this.advanceNanos(BigInt(Math.round(ms * 1_000_000)));
  }
}

/**
 * Writing a timer's control register the value it already holds must do
 * nothing at all.
 *
 * avr8js resets the timer's prescaler phase on every write to TCCRnB - it
 * sets `lastCycle` to the current cycle, throwing away the progress made
 * towards the next tick. Hardware does not: the prescaler is free-running,
 * and re-writing the same clock-select bits changes nothing. (Resetting it
 * deliberately takes a separate register, GTCCR.)
 *
 * That divergence is invisible until a sketch writes the register often, and
 * then it is severe. `tone()` re-writes TCCRnB on every call, and calling
 * `tone()` from `loop()` - which is how the Arduino piano example, and most
 * button-driven sketches, are written - resets the prescaler thousands of
 * times a second. With the /128 prescaler a reset discards up to 127 cycles
 * of progress, so the timer counts far slower than it should and every note
 * plays flat: a held C4 sounded at 257Hz instead of 262.6Hz, and in a tight
 * loop the same call produced 78Hz.
 *
 * A write that changes nothing is dropped here, which is exactly what the
 * hardware does with it. A write that really does change the configuration
 * still goes through to avr8js unchanged.
 */
function keepPrescalerPhase(cpu: CPU, configs: readonly AVRTimerConfig[]): void {
  /*
   * On the 8-bit timers the top two bits of TCCRnB are the force-compare
   * strobes. They are write-only, and writing one is an action rather than a
   * setting, so a write carrying them is never redundant. The 16-bit timers
   * keep their strobes in TCCRnC, and use those bits for input capture
   * instead - which are settings, and compare normally.
   */
  const FORCE_COMPARE = 0xc0;
  for (const config of configs) {
    const original = cpu.writeHooks[config.TCCRB];
    if (!original) continue;
    const strobeMask = config.TCCRC ? 0 : FORCE_COMPARE;
    cpu.writeHooks[config.TCCRB] = (value, oldValue, addr, mask) => {
      if ((value & strobeMask) === 0 && (value & ~strobeMask & 0xff) === cpu.data[config.TCCRB]) {
        return true;
      }
      return original(value, oldValue, addr, mask);
    };
  }
}
