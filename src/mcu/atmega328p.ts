/**
 * ATmega328P board (Arduino Uno / Nano) built on avr8js.
 *
 * Bridges avr8js's register-level model to the simulator's Pin/Net model:
 *   AVR port register change  -> listener -> Pin mode/value -> net settle
 *   net level change          -> pin watch -> port.setPin() -> PIN register
 *
 * The MCU is the clock master. Simulation time is derived from CPU cycles, and
 * part timers are interleaved by slicing the run at each scheduled event.
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
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
  adcConfig,
  twiConfig,
  spiConfig,
  clockConfig,
  ADCMuxInputType,
} from 'avr8js';

import { Pin, PinMode, Edge, HIGH, LOW, type DigitalValue } from '../sim/net.js';
import type { NetList } from '../sim/net.js';
import type { Scheduler } from '../sim/scheduler.js';
import { loadHex } from './hex.js';

/** Flash size in bytes for the ATmega328P. */
export const FLASH_BYTES = 32 * 1024;
export const SRAM_BYTES = 2 * 1024;
export const DEFAULT_FREQUENCY = 16_000_000;

interface PortBinding {
  port: AVRIOPort;
  /** bit index within the port -> board pin name */
  map: { bit: number; name: string }[];
}

export interface ATmega328POptions {
  frequencyHz?: number;
  /** Board pin names to create. Defaults to the Arduino Uno set. */
  pinNames?: readonly string[];
}

/** Digital pins that the timers can drive in PWM mode on the Uno. */
export const PWM_PINS = ['3', '5', '6', '9', '10', '11'] as const;

export const UNO_PINS: readonly string[] = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5',
  'VIN', '5V', '3.3V', 'GND.1', 'GND.2', 'GND.3', 'RESET', 'AREF',
];

/** Pins that are power rails rather than GPIO. */
const POWER_PINS = new Set(['VIN', '5V', '3.3V', 'GND.1', 'GND.2', 'GND.3', 'AREF']);

export class ATmega328P {
  readonly cpu: CPU;
  readonly portB: AVRIOPort;
  readonly portC: AVRIOPort;
  readonly portD: AVRIOPort;
  readonly timer0: AVRTimer;
  readonly timer1: AVRTimer;
  readonly timer2: AVRTimer;
  readonly usart: AVRUSART;
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
  private program = new Uint16Array(FLASH_BYTES / 2);
  private loaded = false;

  constructor(
    private netlist: NetList,
    private scheduler: Scheduler,
    options: ATmega328POptions = {},
  ) {
    this.frequencyHz = options.frequencyHz ?? DEFAULT_FREQUENCY;

    this.cpu = new CPU(this.program, SRAM_BYTES);
    this.portB = new AVRIOPort(this.cpu, portBConfig);
    this.portC = new AVRIOPort(this.cpu, portCConfig);
    this.portD = new AVRIOPort(this.cpu, portDConfig);
    this.timer0 = new AVRTimer(this.cpu, timer0Config);
    this.timer1 = new AVRTimer(this.cpu, timer1Config);
    this.timer2 = new AVRTimer(this.cpu, timer2Config);
    this.usart = new AVRUSART(this.cpu, usart0Config, this.frequencyHz);
    this.adc = new AVRADC(this.cpu, adcConfig);
    this.twi = new AVRTWI(this.cpu, twiConfig, this.frequencyHz);
    this.spi = new AVRSPI(this.cpu, spiConfig, this.frequencyHz);
    this.clock = new AVRClock(this.cpu, this.frequencyHz, clockConfig);

    this.createPins(options.pinNames ?? UNO_PINS);
    this.bindPorts();
    this.bindAdc();

    this.usart.onByteTransmit = (byte: number) => {
      this.onSerialByte?.(byte);
    };
  }

  private createPins(names: readonly string[]): void {
    for (const name of names) {
      const pin = new Pin('__mcu__', name, PinMode.Input);
      this.pins.set(name, pin);
      this.netlist.isolate(pin);
    }
    // Power rails are real drivers: a button to GND only pulls its net low
    // because GND is actually held low. Leaving these floating would silently
    // break every switch and pull-down in a diagram.
    for (const name of names) {
      if (!POWER_PINS.has(name)) continue;
      const pin = this.pins.get(name)!;
      if (name.startsWith('GND')) {
        pin.setMode(PinMode.Output);
        pin.write(LOW);
      } else if (name === '5V' || name === 'VIN' || name === '3.3V') {
        pin.setMode(PinMode.Output);
        pin.write(HIGH);
      }
      // AREF is left as an input: it is a reference, not a supply.
    }
  }

  pin(name: string): Pin {
    const pin = this.pins.get(name);
    if (!pin) throw new Error(`MCU has no pin ${JSON.stringify(name)}`);
    return pin;
  }

  private bindPorts(): void {
    const digitalD = Array.from({ length: 8 }, (_, bit) => ({ bit, name: String(bit) }));
    const digitalB = Array.from({ length: 6 }, (_, bit) => ({ bit, name: String(bit + 8) }));
    const analogC = Array.from({ length: 6 }, (_, bit) => ({ bit, name: `A${bit}` }));

    this.bindings = [
      { port: this.portD, map: digitalD },
      { port: this.portB, map: digitalB },
      { port: this.portC, map: analogC },
    ];

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

    for (const [bit, name] of Array.from({ length: 6 }, (_, i) => [i, `A${i}`] as const)) {
      this.analogChannels.set(bit, this.pin(name));
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
    if (data.length > FLASH_BYTES) {
      throw new Error(`firmware is ${data.length} bytes, flash holds ${FLASH_BYTES}`);
    }
    this.program.fill(0);
    new Uint8Array(this.program.buffer).set(data);
    this.loaded = true;
    this.reset();
  }

  get firmwareLoaded(): boolean {
    return this.loaded;
  }

  reset(): void {
    this.cpu.reset();
    this.cpu.cycles = 0;
    this.usart.reset();
    this.syncAllPorts();
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
