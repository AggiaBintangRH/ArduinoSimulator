/**
 * Serial monitor buffer, implementing Wokwi's documented `serialMonitor` options.
 */

import type { SerialMonitorConfig, SerialMonitorNewline } from '../diagram/types.js';
import { SERIAL_NEWLINE_BYTES } from '../diagram/types.js';

export interface SerialMonitorOptions extends SerialMonitorConfig {
  /** Cap on retained characters, so a chatty sketch cannot grow without bound. */
  maxChars?: number;
}

export class SerialMonitor {
  private buffer = '';
  private decoder = new TextDecoder('utf-8', { fatal: false });
  private pending: number[] = [];
  private readonly maxChars: number;

  readonly config: SerialMonitorConfig;
  onChange: (() => void) | null = null;

  constructor(options: SerialMonitorOptions = {}) {
    const { maxChars, ...config } = options;
    this.config = config;
    this.maxChars = maxChars ?? 200_000;
  }

  get text(): string {
    return this.buffer;
  }

  get isTerminal(): boolean {
    return this.config.display === 'terminal';
  }

  get isPlotter(): boolean {
    return this.config.display === 'plotter';
  }

  /** Whether the monitor should be visible given the display mode. */
  shouldShow(hasOutput: boolean): boolean {
    switch (this.config.display) {
      case 'never':
        return false;
      case 'always':
      case 'terminal':
      case 'plotter':
        return true;
      default:
        return hasOutput;
    }
  }

  /** Feed one byte from the MCU's UART. */
  writeByte(byte: number): void {
    this.pending.push(byte);
    this.flush();
  }

  writeBytes(bytes: Iterable<number>): void {
    for (const b of bytes) this.pending.push(b);
    this.flush();
  }

  /**
   * Decode buffered bytes as UTF-8.
   *
   * Multi-byte sequences can straddle two writes, so decoding is streamed and
   * incomplete tails stay pending until the rest arrives.
   */
  private flush(): void {
    if (this.pending.length === 0) return;
    const bytes = Uint8Array.from(this.pending);
    this.pending = [];
    let chunk = this.decoder.decode(bytes, { stream: true });

    if (this.config.convertEol && this.isTerminal) {
      // In terminal mode a bare \n only moves down a line; the carriage return
      // is what returns to column 0.
      chunk = chunk.replace(/(?<!\r)\n/g, '\r\n');
    }

    this.buffer += chunk;
    if (this.buffer.length > this.maxChars) {
      this.buffer = this.buffer.slice(this.buffer.length - this.maxChars);
    }
    if (chunk.length) this.onChange?.();
  }

  clear(): void {
    this.buffer = '';
    this.pending = [];
    this.onChange?.();
  }

  /** Lines, for the plotter and for line-oriented display. */
  lines(): string[] {
    return this.buffer.split(/\r?\n/);
  }

  /**
   * Parse the buffer as Serial Plotter data.
   * The Arduino plotter reads whitespace or comma separated numbers per line.
   */
  plotterSeries(): number[][] {
    const series: number[][] = [];
    for (const line of this.lines()) {
      const values = line
        .trim()
        .split(/[\s,]+/)
        .filter((s) => s !== '')
        .map(Number);
      if (values.length === 0 || values.some((v) => !Number.isFinite(v))) continue;
      values.forEach((value, i) => {
        (series[i] ??= []).push(value);
      });
    }
    return series;
  }

  /** Bytes to append when the user sends a line, per the `newline` setting. */
  newlineBytes(): number[] {
    const mode: SerialMonitorNewline = this.config.newline ?? 'lf';
    return SERIAL_NEWLINE_BYTES[mode] ?? SERIAL_NEWLINE_BYTES.lf;
  }

  /** Encode user input plus the configured line ending. */
  encodeInput(text: string): number[] {
    return [...new TextEncoder().encode(text), ...this.newlineBytes()];
  }
}
