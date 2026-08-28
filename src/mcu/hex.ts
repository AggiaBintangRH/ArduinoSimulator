/**
 * Intel HEX loader.
 *
 * Arduino toolchains emit .hex, so this is the normal way firmware reaches the
 * simulator. Only the record types avr-objcopy produces are supported.
 */

export class HexParseError extends Error {}

export interface HexLoadResult {
  /** Highest byte address written + 1. */
  bytesLoaded: number;
  /** Address recorded by an EIP/SSA record, if present. */
  startAddress: number | null;
}

const RECORD_DATA = 0x00;
const RECORD_EOF = 0x01;
const RECORD_EXT_SEGMENT = 0x02;
const RECORD_START_SEGMENT = 0x03;
const RECORD_EXT_LINEAR = 0x04;
const RECORD_START_LINEAR = 0x05;

/**
 * Parse Intel HEX text into `target`.
 *
 * @param hex     the .hex file contents
 * @param target  flash buffer, written in place
 */
export function loadHex(hex: string, target: Uint8Array): HexLoadResult {
  let baseAddress = 0;
  let highest = 0;
  let startAddress: number | null = null;
  let sawEof = false;

  const lines = hex.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === '') continue;
    const where = `line ${index + 1}`;

    if (line[0] !== ':') {
      throw new HexParseError(`${where}: record does not start with ':'`);
    }
    if (line.length < 11) {
      throw new HexParseError(`${where}: record is too short`);
    }
    if ((line.length - 1) % 2 !== 0) {
      throw new HexParseError(`${where}: record has an odd number of hex digits`);
    }

    const bytes: number[] = [];
    for (let i = 1; i < line.length; i += 2) {
      const byte = parseInt(line.substring(i, i + 2), 16);
      if (Number.isNaN(byte)) {
        throw new HexParseError(`${where}: invalid hex digits at offset ${i}`);
      }
      bytes.push(byte);
    }

    const byteCount = bytes[0];
    const address = (bytes[1] << 8) | bytes[2];
    const recordType = bytes[3];
    const data = bytes.slice(4, 4 + byteCount);

    if (data.length !== byteCount) {
      throw new HexParseError(
        `${where}: declares ${byteCount} data bytes but carries ${data.length}`,
      );
    }

    // The checksum is the two's complement of the sum of every preceding byte.
    const sum = bytes.slice(0, 4 + byteCount).reduce((a, b) => a + b, 0);
    const expected = (-sum) & 0xff;
    const actual = bytes[4 + byteCount];
    if (actual !== expected) {
      throw new HexParseError(
        `${where}: checksum mismatch (expected 0x${expected.toString(16).padStart(2, '0')}, ` +
          `got 0x${actual.toString(16).padStart(2, '0')})`,
      );
    }

    switch (recordType) {
      case RECORD_DATA: {
        const dest = baseAddress + address;
        if (dest + data.length > target.length) {
          throw new HexParseError(
            `${where}: data at 0x${dest.toString(16)} exceeds the ${target.length}-byte flash`,
          );
        }
        target.set(data, dest);
        highest = Math.max(highest, dest + data.length);
        break;
      }
      case RECORD_EOF:
        sawEof = true;
        break;
      case RECORD_EXT_SEGMENT:
        if (data.length !== 2) throw new HexParseError(`${where}: bad extended segment record`);
        baseAddress = ((data[0] << 8) | data[1]) << 4;
        break;
      case RECORD_EXT_LINEAR:
        if (data.length !== 2) throw new HexParseError(`${where}: bad extended linear record`);
        baseAddress = ((data[0] << 8) | data[1]) << 16;
        break;
      case RECORD_START_SEGMENT:
      case RECORD_START_LINEAR:
        startAddress = data.reduce((acc, b) => (acc << 8) | b, 0);
        break;
      default:
        throw new HexParseError(`${where}: unsupported record type 0x${recordType.toString(16)}`);
    }

    if (sawEof) break;
  }

  if (!sawEof) {
    throw new HexParseError('missing end-of-file record (:00000001FF)');
  }

  return { bytesLoaded: highest, startAddress };
}

/** Build an Intel HEX file from raw bytes. Used to make test fixtures. */
export function toHex(data: Uint8Array, bytesPerLine = 16): string {
  const lines: string[] = [];
  for (let offset = 0; offset < data.length; offset += bytesPerLine) {
    const chunk = data.subarray(offset, offset + bytesPerLine);
    const bytes = [chunk.length, (offset >> 8) & 0xff, offset & 0xff, RECORD_DATA, ...chunk];
    const sum = bytes.reduce((a, b) => a + b, 0);
    bytes.push((-sum) & 0xff);
    lines.push(':' + bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(''));
  }
  lines.push(':00000001FF');
  return lines.join('\n') + '\n';
}
