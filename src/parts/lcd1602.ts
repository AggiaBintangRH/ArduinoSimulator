/**
 * wokwi-lcd1602 / wokwi-lcd2004 - HD44780 character LCD.
 *
 * Supports both documented wirings (docs/wokwi/02-parts.md):
 *   pins: "full" (default) - 4-bit or 8-bit parallel via RS/RW/E/D0-D7
 *   pins: "i2c"            - through a PCF8574 backpack at 0x27
 */

import { registerPart } from '../sim/registry.js';
import { Edge, HIGH, PinMode } from '../sim/net.js';
import type { Part, PartContext } from '../sim/part.js';

const CMD_CLEAR = 0x01;
const CMD_HOME = 0x02;

/** HD44780 controller state, independent of how bytes arrive. */
export class Hd44780 {
  readonly rows: number;
  readonly cols: number;
  /** Display RAM as character codes. */
  ram: number[][];
  cursorRow = 0;
  cursorCol = 0;
  displayOn = true;
  cursorVisible = false;
  cursorBlink = false;
  /** 8 user-definable characters, 8 rows of 5 bits each. */
  cgram: number[][] = Array.from({ length: 8 }, () => new Array(8).fill(0));

  private increment = true;
  private shiftMode = false;
  private fourBit = false;
  private nibbleHigh: number | null = null;
  private addressingCgram = false;
  private cgramAddress = 0;

  constructor(rows = 2, cols = 16) {
    this.rows = rows;
    this.cols = cols;
    this.ram = Array.from({ length: rows }, () => new Array(cols).fill(0x20));
  }

  get isFourBit(): boolean {
    return this.fourBit;
  }

  /** Feed one full byte (RS selects command vs data). */
  writeByte(rs: boolean, value: number): void {
    if (rs) this.writeData(value);
    else this.writeCommand(value);
  }

  /**
   * Feed a 4-bit nibble. Two nibbles make a byte, high first.
   * Returns true when a complete byte was consumed.
   */
  writeNibble(rs: boolean, nibble: number): boolean {
    if (this.nibbleHigh === null) {
      this.nibbleHigh = nibble & 0x0f;
      // The 4-bit init sequence sends lone nibbles as commands before the
      // interface width is known; treat 0x2/0x3 that way.
      if (!this.fourBit && !rs) {
        const asCommand = this.nibbleHigh << 4;
        if (asCommand === 0x20) {
          this.fourBit = true;
          this.nibbleHigh = null;
          return true;
        }
        if (asCommand === 0x30) {
          this.nibbleHigh = null;
          return true;
        }
      }
      return false;
    }
    const byte = (this.nibbleHigh << 4) | (nibble & 0x0f);
    this.nibbleHigh = null;
    this.writeByte(rs, byte);
    return true;
  }

  private writeCommand(cmd: number): void {
    if (cmd === CMD_CLEAR) {
      for (const row of this.ram) row.fill(0x20);
      this.cursorRow = 0;
      this.cursorCol = 0;
      this.addressingCgram = false;
      return;
    }
    if ((cmd & 0xfe) === CMD_HOME) {
      this.cursorRow = 0;
      this.cursorCol = 0;
      this.addressingCgram = false;
      return;
    }
    if ((cmd & 0xfc) === 0x04) {
      this.increment = (cmd & 0x02) !== 0;
      this.shiftMode = (cmd & 0x01) !== 0;
      return;
    }
    if ((cmd & 0xf8) === 0x08) {
      this.displayOn = (cmd & 0x04) !== 0;
      this.cursorVisible = (cmd & 0x02) !== 0;
      this.cursorBlink = (cmd & 0x01) !== 0;
      return;
    }
    if ((cmd & 0xe0) === 0x20) {
      this.fourBit = (cmd & 0x10) === 0;
      return;
    }
    if ((cmd & 0xc0) === 0x40) {
      this.addressingCgram = true;
      this.cgramAddress = cmd & 0x3f;
      return;
    }
    if ((cmd & 0x80) === 0x80) {
      this.addressingCgram = false;
      this.setDdramAddress(cmd & 0x7f);
    }
  }

  /** Map an HD44780 DDRAM address onto a row/column. */
  private setDdramAddress(addr: number): void {
    // Row start addresses are the standard HD44780 layout.
    const starts = this.cols > 16 ? [0x00, 0x40, 0x14, 0x54] : [0x00, 0x40, 0x10, 0x50];
    for (let row = Math.min(this.rows, starts.length) - 1; row >= 0; row--) {
      if (addr >= starts[row]) {
        this.cursorRow = row;
        this.cursorCol = addr - starts[row];
        return;
      }
    }
    this.cursorRow = 0;
    this.cursorCol = addr;
  }

  private writeData(value: number): void {
    if (this.addressingCgram) {
      const charIndex = (this.cgramAddress >> 3) & 0x07;
      const rowIndex = this.cgramAddress & 0x07;
      this.cgram[charIndex][rowIndex] = value & 0x1f;
      this.cgramAddress = (this.cgramAddress + 1) & 0x3f;
      return;
    }
    if (this.cursorRow < this.rows && this.cursorCol < this.cols && this.cursorCol >= 0) {
      this.ram[this.cursorRow][this.cursorCol] = value;
    }
    this.cursorCol += this.increment ? 1 : -1;
    void this.shiftMode;
  }

  /** Display contents as text rows. */
  text(): string[] {
    return this.ram.map((row) =>
      row.map((code) => (code >= 0x20 && code < 0x80 ? String.fromCharCode(code) : ' ')).join(''),
    );
  }
}

/** Decodes PCF8574 port writes into HD44780 nibbles. */
export class Pcf8574Backpack {
  private lastEnable = false;

  constructor(private lcd: Hd44780) {}

  /**
   * PCF8574 bit layout used by every common LCD backpack:
   *   b7..b4 = D7..D4, b3 = backlight, b2 = E, b1 = RW, b0 = RS
   * The nibble is latched on the falling edge of E.
   */
  write(port: number): void {
    const enable = (port & 0x04) !== 0;
    const rs = (port & 0x01) !== 0;
    const rw = (port & 0x02) !== 0;
    if (this.lastEnable && !enable && !rw) {
      this.lcd.writeNibble(rs, (port >> 4) & 0x0f);
    }
    this.lastEnable = enable;
  }

  get backlight(): boolean {
    return true;
  }
}

const PARALLEL_PINS = [
  'VSS', 'VDD', 'V0', 'RS', 'RW', 'E',
  'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K',
];
const I2C_PINS = ['GND', 'VCC', 'SDA', 'SCL'];

class Lcd1602Part implements Part {
  private ctx!: PartContext;
  private lcd!: Hd44780;
  private backpack: Pcf8574Backpack | null = null;
  private i2c: I2cSlaveDecoder | null = null;
  private lastE = false;

  constructor(private rows: number, private cols: number) {}

  init(ctx: PartContext): void {
    this.ctx = ctx;
    this.lcd = new Hd44780(this.rows, this.cols);

    const mode = ctx.attr('pins', 'full');
    if (mode === 'i2c') {
      this.initI2c(ctx);
    } else {
      this.initParallel(ctx);
    }

    const timer = ctx.timerInit(() => this.report());
    ctx.timerStart(timer, 1_000_000 / 30, true);
    this.report();
  }

  private initParallel(ctx: PartContext): void {
    for (const name of PARALLEL_PINS) ctx.pinInit(name, PinMode.Input);
    // The HD44780 latches on the falling edge of E.
    ctx.pinWatch('E', Edge.Falling, () => this.onEnableFalling());
  }

  private onEnableFalling(): void {
    if (this.ctx.pinRead('RW') === HIGH) return; // reads are not modelled
    const rs = this.ctx.pinRead('RS') === HIGH;
    const high = this.readNibble(4);
    if (this.lcd.isFourBit) {
      this.lcd.writeNibble(rs, high);
    } else {
      const low = this.readNibble(0);
      const byte = (high << 4) | low;
      // Before the interface width is set, D7..D4 carry the command nibble.
      if (this.looksLikeFourBitInit(byte, high)) this.lcd.writeNibble(rs, high);
      else this.lcd.writeByte(rs, byte);
    }
    void this.lastE;
  }

  /** During init the sketch may still be in 8-bit mode sending 4-bit setup. */
  private looksLikeFourBitInit(byte: number, high: number): boolean {
    return byte === 0 && (high === 0x2 || high === 0x3);
  }

  private readNibble(base: number): number {
    let value = 0;
    for (let bit = 0; bit < 4; bit++) {
      if (this.ctx.pinRead(`D${base + bit}`) === HIGH) value |= 1 << bit;
    }
    return value;
  }

  private initI2c(ctx: PartContext): void {
    for (const name of I2C_PINS) ctx.pinInit(name, PinMode.Input);
    this.backpack = new Pcf8574Backpack(this.lcd);
    const address = ctx.attrNumber('i2cAddress', 0x27);
    this.i2c = new I2cSlaveDecoder(ctx, 'SDA', 'SCL', address, (byte) => {
      this.backpack!.write(byte);
    });
    this.i2c.attach();
  }

  private report(): void {
    this.ctx.emit({
      text: this.lcd.text(),
      rows: this.rows,
      cols: this.cols,
      displayOn: this.lcd.displayOn,
      cursor: { row: this.lcd.cursorRow, col: this.lcd.cursorCol },
      cursorVisible: this.lcd.cursorVisible,
      background: this.ctx.attr('background', 'green'),
      color: this.ctx.attr('color', 'black'),
    });
  }
}

/**
 * Minimal I2C slave: watches SDA/SCL and reconstructs written bytes.
 *
 * Enough for the PCF8574 backpack, which only ever receives. Start and stop
 * conditions are detected as SDA transitions while SCL is high.
 */
export class I2cSlaveDecoder {
  private bits = 0;
  private current = 0;
  private addressed = false;
  private expectingAddress = false;

  constructor(
    private ctx: PartContext,
    private sda: string,
    private scl: string,
    private address: number,
    private onByte: (byte: number) => void,
  ) {}

  attach(): void {
    this.ctx.pinWatch(this.scl, Edge.Rising, () => this.onClockRising());
    this.ctx.pinWatch(this.sda, Edge.Both, () => this.onDataChange());
  }

  private onDataChange(): void {
    if (this.ctx.pinRead(this.scl) !== HIGH) return;
    // SDA moving while SCL is high is a start or stop condition.
    if (this.ctx.pinRead(this.sda) === HIGH) {
      // Rising = stop
      this.addressed = false;
      this.expectingAddress = false;
    } else {
      // Falling = start
      this.expectingAddress = true;
      this.addressed = false;
    }
    this.bits = 0;
    this.current = 0;
  }

  private onClockRising(): void {
    const bit = this.ctx.pinRead(this.sda) === HIGH ? 1 : 0;
    this.current = ((this.current << 1) | bit) & 0x1ff;
    this.bits++;
    if (this.bits < 8) return;

    const byte = this.current & 0xff;
    this.bits = 0;
    this.current = 0;

    if (this.expectingAddress) {
      this.expectingAddress = false;
      this.addressed = (byte >> 1) === this.address;
      return;
    }
    if (this.addressed) this.onByte(byte);
  }
}

registerPart({
  type: 'wokwi-lcd1602',
  pins: [...PARALLEL_PINS, ...I2C_PINS],
  defaults: {
    pins: 'full',
    i2cAddress: '0x27',
    color: 'black',
    background: 'green',
    variant: 'A00',
  },
  create: () => new Lcd1602Part(2, 16),
});

registerPart({
  type: 'wokwi-lcd2004',
  pins: [...PARALLEL_PINS, ...I2C_PINS],
  defaults: {
    pins: 'full',
    i2cAddress: '0x27',
    color: 'black',
    background: 'green',
    variant: 'A00',
  },
  create: () => new Lcd1602Part(4, 20),
});
