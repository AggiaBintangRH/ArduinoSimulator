/**
 * Chip-level descriptions of the AVR parts we emulate.
 *
 * avr8js ships register maps for the ATmega328P only, but every peripheral it
 * models is configured by a plain data object. So a second chip is a matter of
 * writing the right register addresses and interrupt vectors, not new code.
 *
 * Interrupt vector numbers below are *byte* addresses into the vector table,
 * which is how avr8js expresses them (`cpu.pc = addr`, and pc counts words on
 * a 2-word JMP table -> vector index n lands at 2n). Both chips here use the
 * 2-word table, so vector n = 2n in these tables.
 */

import {
  portAConfig,
  portBConfig,
  portCConfig,
  portDConfig,
  portEConfig,
  portFConfig,
  portGConfig,
  portHConfig,
  portJConfig,
  portKConfig,
  portLConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
  adcConfig,
  twiConfig,
  spiConfig,
  clockConfig,
  ADCMuxInputType,
  ADCReference,
  type AVRPortConfig,
  type AVRTimerConfig,
  type ADCConfig,
  type ADCMuxConfiguration,
  type AVRExternalInterrupt,
  type AVRPinChangeInterrupt,
  type TWIConfig,
  type SPIConfig,
  type AVRClockConfig,
} from 'avr8js';

/** avr8js exports `usart0Config` but not its type, so borrow it. */
type USARTConfig = typeof usart0Config;

/** Port letter -> avr8js port configuration. */
export type PortConfigs = Record<string, AVRPortConfig>;

export interface AvrChip {
  /** Chip name as the toolchain spells it, e.g. `atmega328p`. */
  readonly name: string;
  readonly flashBytes: number;
  /** SRAM as the datasheet states it. Shown to the user; not a CPU argument. */
  readonly sramBytes: number;
  /**
   * Byte count handed to the avr8js CPU, which allocates `n + 0x100` and
   * treats that as the whole data space. On a chip with extended I/O (the
   * 2560's 0x100..0x1FF) this is SRAM plus that window, so it is larger than
   * the datasheet's SRAM figure and must not be shown as memory.
   */
  readonly dataSpaceBytes: number;
  readonly ports: PortConfigs;
  readonly timers: readonly AVRTimerConfig[];
  /** USART0 first; the rest exist so `Serial1`..`Serial3` are not silently dead. */
  readonly usarts: readonly USARTConfig[];
  readonly adc: ADCConfig;
  readonly twi: TWIConfig;
  readonly spi: SPIConfig;
  readonly clock: AVRClockConfig;
}

// ---------------------------------------------------------------------------
// ATmega328P (Arduino Uno, Nano)
// ---------------------------------------------------------------------------

export const ATMEGA328P: AvrChip = {
  name: 'atmega328p',
  flashBytes: 32 * 1024,
  sramBytes: 2 * 1024,
  dataSpaceBytes: 2 * 1024,
  ports: { B: portBConfig, C: portCConfig, D: portDConfig },
  timers: [timer0Config, timer1Config, timer2Config],
  usarts: [usart0Config],
  adc: adcConfig,
  twi: twiConfig,
  spi: spiConfig,
  clock: clockConfig,
};

// ---------------------------------------------------------------------------
// ATmega2560 (Arduino Mega 2560)
// ---------------------------------------------------------------------------

/**
 * The port register addresses are identical to the 328P's where the ports
 * overlap, so avr8js's exported configs are reused. What differs is which
 * interrupts hang off which port, so those are rebuilt here.
 */

const MEGA_INT: Record<number, AVRExternalInterrupt> = {};
for (let index = 0; index < 8; index++) {
  MEGA_INT[index] = {
    // INT0..3 are configured by EICRA, INT4..7 by EICRB.
    EICRA: 0x69,
    EICRB: 0x6a,
    EIMSK: 0x3d,
    EIFR: 0x3c,
    index,
    interrupt: 0x02 + index * 2,
  };
}

const MEGA_PCINT0: AVRPinChangeInterrupt = {
  PCIE: 0,
  PCICR: 0x68,
  PCIFR: 0x3b,
  PCMSK: 0x6b, // PCMSK0 -> PB0..PB7
  pinChangeInterrupt: 0x12,
  mask: 0xff,
  offset: 0,
};

/**
 * PCINT1 covers PE0 (bit 0) and PJ0..PJ6 (bits 1..7). Only the PJ half is
 * wired up: avr8js allows one pin-change block per port, and PE0 is the RX0
 * pin, which sketches do not use as a pin-change source.
 */
const MEGA_PCINT1_PORTJ: AVRPinChangeInterrupt = {
  PCIE: 1,
  PCICR: 0x68,
  PCIFR: 0x3b,
  PCMSK: 0x6c,
  pinChangeInterrupt: 0x14,
  mask: 0x7f,
  offset: 1,
};

const MEGA_PCINT2: AVRPinChangeInterrupt = {
  PCIE: 2,
  PCICR: 0x68,
  PCIFR: 0x3b,
  PCMSK: 0x6d, // PCMSK2 -> PK0..PK7
  pinChangeInterrupt: 0x16,
  mask: 0xff,
  offset: 0,
};

const megaPortD: AVRPortConfig = {
  ...portDConfig,
  pinChange: undefined,
  // INT0..INT3 sit on PD0..PD3 (not PD2/PD3 as on the 328P).
  externalInterrupts: [MEGA_INT[0], MEGA_INT[1], MEGA_INT[2], MEGA_INT[3]],
};

const megaPortE: AVRPortConfig = {
  ...portEConfig,
  // INT4..INT7 sit on PE4..PE7.
  externalInterrupts: [null, null, null, null, MEGA_INT[4], MEGA_INT[5], MEGA_INT[6], MEGA_INT[7]],
};

const megaPortB: AVRPortConfig = { ...portBConfig, pinChange: MEGA_PCINT0 };
const megaPortJ: AVRPortConfig = { ...portJConfig, pinChange: MEGA_PCINT1_PORTJ };
const megaPortK: AVRPortConfig = { ...portKConfig, pinChange: MEGA_PCINT2 };
const megaPortC: AVRPortConfig = { ...portCConfig, pinChange: undefined };

const timer01Dividers = { 0: 0, 1: 1, 2: 8, 3: 64, 4: 256, 5: 1024, 6: 0, 7: 0 };
const timer2Dividers = { 0: 0, 1: 1, 2: 8, 3: 32, 4: 64, 5: 128, 6: 256, 7: 1024 };

/** TIFR/TIMSK bit masks. The 2560's 16-bit timers add a third compare unit. */
const megaTimerBits = {
  TOV: 1,
  OCFA: 2,
  OCFB: 4,
  OCFC: 8,
  TOIE: 1,
  OCIEA: 2,
  OCIEB: 4,
  OCIEC: 8,
};

const megaTimer0: AVRTimerConfig = {
  bits: 8,
  dividers: timer01Dividers,
  captureInterrupt: 0,
  compAInterrupt: 0x2a,
  compBInterrupt: 0x2c,
  compCInterrupt: 0,
  ovfInterrupt: 0x2e,
  TIFR: 0x35,
  OCRA: 0x47,
  OCRB: 0x48,
  OCRC: 0,
  ICR: 0,
  TCNT: 0x46,
  TCCRA: 0x44,
  TCCRB: 0x45,
  TCCRC: 0,
  TIMSK: 0x6e,
  ...megaTimerBits,
  OCFC: 0,
  OCIEC: 0,
  compPortA: portBConfig.PORT, // OC0A = PB7 (D13)
  compPinA: 7,
  compPortB: portGConfig.PORT, // OC0B = PG5 (D4)
  compPinB: 5,
  compPortC: 0,
  compPinC: 0,
  externalClockPort: portDConfig.PORT, // T0 = PD7
  externalClockPin: 7,
};

const megaTimer1: AVRTimerConfig = {
  bits: 16,
  dividers: timer01Dividers,
  captureInterrupt: 0x20,
  compAInterrupt: 0x22,
  compBInterrupt: 0x24,
  compCInterrupt: 0x26,
  ovfInterrupt: 0x28,
  TIFR: 0x36,
  OCRA: 0x88,
  OCRB: 0x8a,
  OCRC: 0x8c,
  ICR: 0x86,
  TCNT: 0x84,
  TCCRA: 0x80,
  TCCRB: 0x81,
  TCCRC: 0x82,
  TIMSK: 0x6f,
  ...megaTimerBits,
  compPortA: portBConfig.PORT, // OC1A = PB5 (D11)
  compPinA: 5,
  compPortB: portBConfig.PORT, // OC1B = PB6 (D12)
  compPinB: 6,
  compPortC: portBConfig.PORT, // OC1C = PB7 (D13)
  compPinC: 7,
  externalClockPort: portDConfig.PORT, // T1 = PD6
  externalClockPin: 6,
};

const megaTimer2: AVRTimerConfig = {
  bits: 8,
  dividers: timer2Dividers,
  captureInterrupt: 0,
  compAInterrupt: 0x1a,
  compBInterrupt: 0x1c,
  compCInterrupt: 0,
  ovfInterrupt: 0x1e,
  TIFR: 0x37,
  OCRA: 0xb3,
  OCRB: 0xb4,
  OCRC: 0,
  ICR: 0,
  TCNT: 0xb2,
  TCCRA: 0xb0,
  TCCRB: 0xb1,
  TCCRC: 0,
  TIMSK: 0x70,
  ...megaTimerBits,
  OCFC: 0,
  OCIEC: 0,
  compPortA: portBConfig.PORT, // OC2A = PB4 (D10)
  compPinA: 4,
  compPortB: portHConfig.PORT, // OC2B = PH6 (D9)
  compPinB: 6,
  compPortC: 0,
  compPinC: 0,
  externalClockPort: 0,
  externalClockPin: 0,
};

const megaTimer3: AVRTimerConfig = {
  bits: 16,
  dividers: timer01Dividers,
  captureInterrupt: 0x3e,
  compAInterrupt: 0x40,
  compBInterrupt: 0x42,
  compCInterrupt: 0x44,
  ovfInterrupt: 0x46,
  TIFR: 0x38,
  OCRA: 0x98,
  OCRB: 0x9a,
  OCRC: 0x9c,
  ICR: 0x96,
  TCNT: 0x94,
  TCCRA: 0x90,
  TCCRB: 0x91,
  TCCRC: 0x92,
  TIMSK: 0x71,
  ...megaTimerBits,
  compPortA: portEConfig.PORT, // OC3A = PE3 (D5)
  compPinA: 3,
  compPortB: portEConfig.PORT, // OC3B = PE4 (D2)
  compPinB: 4,
  compPortC: portEConfig.PORT, // OC3C = PE5 (D3)
  compPinC: 5,
  externalClockPort: portEConfig.PORT, // T3 = PE6
  externalClockPin: 6,
};

const megaTimer4: AVRTimerConfig = {
  bits: 16,
  dividers: timer01Dividers,
  captureInterrupt: 0x52,
  compAInterrupt: 0x54,
  compBInterrupt: 0x56,
  compCInterrupt: 0x58,
  ovfInterrupt: 0x5a,
  TIFR: 0x39,
  OCRA: 0xa8,
  OCRB: 0xaa,
  OCRC: 0xac,
  ICR: 0xa6,
  TCNT: 0xa4,
  TCCRA: 0xa0,
  TCCRB: 0xa1,
  TCCRC: 0xa2,
  TIMSK: 0x72,
  ...megaTimerBits,
  compPortA: portHConfig.PORT, // OC4A = PH3 (D6)
  compPinA: 3,
  compPortB: portHConfig.PORT, // OC4B = PH4 (D7)
  compPinB: 4,
  compPortC: portHConfig.PORT, // OC4C = PH5 (D8)
  compPinC: 5,
  externalClockPort: portHConfig.PORT, // T4 = PH7
  externalClockPin: 7,
};

const megaTimer5: AVRTimerConfig = {
  bits: 16,
  dividers: timer01Dividers,
  captureInterrupt: 0x5c,
  compAInterrupt: 0x5e,
  compBInterrupt: 0x60,
  compCInterrupt: 0x62,
  ovfInterrupt: 0x64,
  TIFR: 0x3a,
  OCRA: 0x128,
  OCRB: 0x12a,
  OCRC: 0x12c,
  ICR: 0x126,
  TCNT: 0x124,
  TCCRA: 0x120,
  TCCRB: 0x121,
  TCCRC: 0x122,
  TIMSK: 0x73,
  ...megaTimerBits,
  compPortA: portLConfig.PORT, // OC5A = PL3 (D46)
  compPinA: 3,
  compPortB: portLConfig.PORT, // OC5B = PL4 (D45)
  compPinB: 4,
  compPortC: portLConfig.PORT, // OC5C = PL5 (D44)
  compPinC: 5,
  externalClockPort: portLConfig.PORT, // T5 = PL2
  externalClockPin: 2,
};

function megaUsart(base: number, rxVector: number): USARTConfig {
  return {
    rxCompleteInterrupt: rxVector,
    dataRegisterEmptyInterrupt: rxVector + 2,
    txCompleteInterrupt: rxVector + 4,
    UCSRA: base,
    UCSRB: base + 1,
    UCSRC: base + 2,
    UBRRL: base + 4,
    UBRRH: base + 5,
    UDR: base + 6,
  };
}

/**
 * ADC mux map. MUX[4:0] lives in ADMUX and MUX5 in ADCSRB; avr8js folds MUX5
 * in as bit 5, so channels 8..15 appear at 0x20..0x27. The differential
 * channels are left out: they need a gain stage this simulator does not model.
 */
const megaAdcChannels: ADCMuxConfiguration = {
  0: { type: ADCMuxInputType.SingleEnded, channel: 0 },
  1: { type: ADCMuxInputType.SingleEnded, channel: 1 },
  2: { type: ADCMuxInputType.SingleEnded, channel: 2 },
  3: { type: ADCMuxInputType.SingleEnded, channel: 3 },
  4: { type: ADCMuxInputType.SingleEnded, channel: 4 },
  5: { type: ADCMuxInputType.SingleEnded, channel: 5 },
  6: { type: ADCMuxInputType.SingleEnded, channel: 6 },
  7: { type: ADCMuxInputType.SingleEnded, channel: 7 },
  0x1e: { type: ADCMuxInputType.Constant, voltage: 1.1 },
  0x1f: { type: ADCMuxInputType.Constant, voltage: 0 },
  0x20: { type: ADCMuxInputType.SingleEnded, channel: 8 },
  0x21: { type: ADCMuxInputType.SingleEnded, channel: 9 },
  0x22: { type: ADCMuxInputType.SingleEnded, channel: 10 },
  0x23: { type: ADCMuxInputType.SingleEnded, channel: 11 },
  0x24: { type: ADCMuxInputType.SingleEnded, channel: 12 },
  0x25: { type: ADCMuxInputType.SingleEnded, channel: 13 },
  0x26: { type: ADCMuxInputType.SingleEnded, channel: 14 },
  0x27: { type: ADCMuxInputType.SingleEnded, channel: 15 },
};

const megaAdc: ADCConfig = {
  ADMUX: 0x7c,
  ADCSRA: 0x7a,
  ADCSRB: 0x7b,
  ADCL: 0x78,
  ADCH: 0x79,
  DIDR0: 0x7e,
  adcInterrupt: 0x3a,
  numChannels: 16,
  muxInputMask: 0x3f,
  muxChannels: megaAdcChannels,
  adcReferences: [
    ADCReference.AREF,
    ADCReference.AVCC,
    ADCReference.Internal1V1,
    ADCReference.Internal2V56,
  ],
};

export const ATMEGA2560: AvrChip = {
  name: 'atmega2560',
  flashBytes: 256 * 1024,
  sramBytes: 8 * 1024,
  // SRAM sits at 0x200..0x21FF. avr8js reserves only 0x100 for registers, so
  // the extended I/O window (0x100..0x1FF) is paid for here; without it every
  // write to PORTH/J/K/L and timers 3-5 would land outside the array.
  dataSpaceBytes: 8 * 1024 + 0x100,
  ports: {
    A: portAConfig,
    B: megaPortB,
    C: megaPortC,
    D: megaPortD,
    E: megaPortE,
    F: portFConfig,
    G: portGConfig,
    H: portHConfig,
    J: megaPortJ,
    K: megaPortK,
    L: portLConfig,
  },
  timers: [megaTimer0, megaTimer1, megaTimer2, megaTimer3, megaTimer4, megaTimer5],
  usarts: [
    megaUsart(0xc0, 0x32),
    megaUsart(0xc8, 0x48),
    megaUsart(0xd0, 0x66),
    megaUsart(0x130, 0x6c),
  ],
  adc: megaAdc,
  twi: { ...twiConfig, twiInterrupt: 0x4e },
  spi: { ...spiConfig, spiInterrupt: 0x30 },
  clock: clockConfig,
};
