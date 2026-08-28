import { describe, it, expect } from 'vitest';
import { loadHex, toHex, HexParseError } from '../src/mcu/hex.js';

describe('loadHex', () => {
  it('loads a simple data record', () => {
    const target = new Uint8Array(16);
    // 4 bytes 01 02 03 04 at address 0
    const result = loadHex(':0400000001020304F2\n:00000001FF\n', target);
    expect(Array.from(target.subarray(0, 4))).toEqual([1, 2, 3, 4]);
    expect(result.bytesLoaded).toBe(4);
  });

  it('round-trips through toHex', () => {
    const original = new Uint8Array(64);
    for (let i = 0; i < original.length; i++) original[i] = (i * 7) & 0xff;
    const target = new Uint8Array(64);
    loadHex(toHex(original), target);
    expect(Array.from(target)).toEqual(Array.from(original));
  });

  it('honours the record address', () => {
    const target = new Uint8Array(32);
    // 2 bytes AA BB at address 0x0010
    loadHex(':02001000AABB89\n:00000001FF\n', target);
    expect(target[0x10]).toBe(0xaa);
    expect(target[0x11]).toBe(0xbb);
    expect(target[0]).toBe(0);
  });

  it('reports the start address from a start-linear record', () => {
    const target = new Uint8Array(16);
    const r = loadHex(':0400000500000100F6\n:00000001FF\n', target);
    expect(r.startAddress).toBe(0x0100);
  });

  it('ignores blank lines', () => {
    const target = new Uint8Array(8);
    expect(() => loadHex('\n\n:0400000001020304F2\n\n:00000001FF\n', target)).not.toThrow();
  });

  it('rejects a bad checksum', () => {
    const target = new Uint8Array(16);
    expect(() => loadHex(':0400000001020304FF\n:00000001FF\n', target)).toThrow(/checksum/);
  });

  it('rejects a record not starting with a colon', () => {
    expect(() => loadHex('0400000001020304F2\n', new Uint8Array(16))).toThrow(HexParseError);
  });

  it('rejects a missing EOF record', () => {
    expect(() => loadHex(':0400000001020304F2\n', new Uint8Array(16))).toThrow(/end-of-file/);
  });

  it('rejects data past the end of flash', () => {
    expect(() => loadHex(':0400100001020304E2\n:00000001FF\n', new Uint8Array(8))).toThrow(
      /exceeds/,
    );
  });

  it('rejects an odd number of hex digits', () => {
    expect(() => loadHex(':040000000102030F2\n', new Uint8Array(16))).toThrow(/odd number/);
  });

  it('rejects non-hex characters', () => {
    expect(() => loadHex(':04000000ZZ020304F2\n', new Uint8Array(16))).toThrow(/invalid hex/);
  });

  it('rejects an unsupported record type', () => {
    expect(() => loadHex(':00000006FA\n', new Uint8Array(16))).toThrow(/unsupported record type/);
  });

  it('stops reading after the EOF record', () => {
    const target = new Uint8Array(16);
    loadHex(':0400000001020304F2\n:00000001FF\n:04000000FFFFFFFF00\n', target);
    expect(target[0]).toBe(1);
  });
});
