import { describe, it, expect, vi } from 'vitest';
import { SerialMonitor } from '../src/sim/serial.js';
import {
  parseDiagnostics,
  hasErrors,
  CachingCompiler,
  UnavailableCompiler,
  type Compiler,
  type CompileResult,
} from '../src/build/compiler.js';

describe('SerialMonitor', () => {
  it('accumulates bytes as text', () => {
    const m = new SerialMonitor();
    m.writeBytes([...new TextEncoder().encode('Hello')]);
    expect(m.text).toBe('Hello');
  });

  it('appends across writes', () => {
    const m = new SerialMonitor();
    m.writeByte(72);
    m.writeByte(105);
    expect(m.text).toBe('Hi');
  });

  it('decodes a UTF-8 sequence split across writes', () => {
    const m = new SerialMonitor();
    // "é" is 0xC3 0xA9
    m.writeByte(0xc3);
    expect(m.text).toBe('');
    m.writeByte(0xa9);
    expect(m.text).toBe('é');
  });

  it('notifies on change', () => {
    const m = new SerialMonitor();
    const onChange = vi.fn();
    m.onChange = onChange;
    m.writeByte(65);
    expect(onChange).toHaveBeenCalled();
  });

  it('clears the buffer', () => {
    const m = new SerialMonitor();
    m.writeByte(65);
    m.clear();
    expect(m.text).toBe('');
  });

  it('trims to the retention limit', () => {
    const m = new SerialMonitor({ maxChars: 10 });
    m.writeBytes([...new TextEncoder().encode('abcdefghijklmnop')]);
    expect(m.text).toHaveLength(10);
    expect(m.text).toBe('ghijklmnop');
  });

  it('splits into lines', () => {
    const m = new SerialMonitor();
    m.writeBytes([...new TextEncoder().encode('a\nb\nc')]);
    expect(m.lines()).toEqual(['a', 'b', 'c']);
  });

  describe('display modes', () => {
    it('auto shows only once there is output', () => {
      const m = new SerialMonitor({ display: 'auto' });
      expect(m.shouldShow(false)).toBe(false);
      expect(m.shouldShow(true)).toBe(true);
    });

    it('always shows immediately', () => {
      expect(new SerialMonitor({ display: 'always' }).shouldShow(false)).toBe(true);
    });

    it('never stays hidden', () => {
      expect(new SerialMonitor({ display: 'never' }).shouldShow(true)).toBe(false);
    });

    it('flags terminal and plotter modes', () => {
      expect(new SerialMonitor({ display: 'terminal' }).isTerminal).toBe(true);
      expect(new SerialMonitor({ display: 'plotter' }).isPlotter).toBe(true);
    });
  });

  describe('convertEol', () => {
    it('converts bare newlines in terminal mode', () => {
      const m = new SerialMonitor({ display: 'terminal', convertEol: true });
      m.writeBytes([...new TextEncoder().encode('a\nb')]);
      expect(m.text).toBe('a\r\nb');
    });

    it('leaves an existing CRLF alone', () => {
      const m = new SerialMonitor({ display: 'terminal', convertEol: true });
      m.writeBytes([...new TextEncoder().encode('a\r\nb')]);
      expect(m.text).toBe('a\r\nb');
    });

    it('does nothing outside terminal mode', () => {
      const m = new SerialMonitor({ convertEol: true });
      m.writeBytes([...new TextEncoder().encode('a\nb')]);
      expect(m.text).toBe('a\nb');
    });
  });

  describe('newline setting', () => {
    it('defaults to LF', () => {
      expect(new SerialMonitor().newlineBytes()).toEqual([10]);
    });

    it('supports CR', () => {
      expect(new SerialMonitor({ newline: 'cr' }).newlineBytes()).toEqual([13]);
    });

    it('supports CRLF', () => {
      expect(new SerialMonitor({ newline: 'crlf' }).newlineBytes()).toEqual([13, 10]);
    });

    it('supports none', () => {
      expect(new SerialMonitor({ newline: 'none' }).newlineBytes()).toEqual([]);
    });

    it('encodes user input with the line ending', () => {
      const m = new SerialMonitor({ newline: 'crlf' });
      expect(m.encodeInput('hi')).toEqual([104, 105, 13, 10]);
    });
  });

  describe('plotter parsing', () => {
    it('reads one series per column', () => {
      const m = new SerialMonitor({ display: 'plotter' });
      m.writeBytes([...new TextEncoder().encode('1 2\n3 4\n5 6\n')]);
      expect(m.plotterSeries()).toEqual([
        [1, 3, 5],
        [2, 4, 6],
      ]);
    });

    it('accepts comma separated values', () => {
      const m = new SerialMonitor({ display: 'plotter' });
      m.writeBytes([...new TextEncoder().encode('1,2\n3,4\n')]);
      expect(m.plotterSeries()).toEqual([
        [1, 3],
        [2, 4],
      ]);
    });

    it('skips non-numeric lines', () => {
      const m = new SerialMonitor({ display: 'plotter' });
      m.writeBytes([...new TextEncoder().encode('hello\n1 2\n')]);
      expect(m.plotterSeries()).toEqual([[1], [2]]);
    });
  });
});

describe('parseDiagnostics', () => {
  it('parses a gcc error with line and column', () => {
    const out = "/tmp/sketch/sketch.ino:12:5: error: 'foo' was not declared in this scope";
    expect(parseDiagnostics(out)).toEqual([
      {
        file: '/tmp/sketch/sketch.ino',
        line: 12,
        column: 5,
        severity: 'error',
        message: "'foo' was not declared in this scope",
      },
    ]);
  });

  it('parses a diagnostic without a column', () => {
    const out = '/tmp/sketch.ino:7: warning: unused variable';
    const [d] = parseDiagnostics(out);
    expect(d.line).toBe(7);
    expect(d.column).toBeUndefined();
    expect(d.severity).toBe('warning');
  });

  it('parses a Windows path with a drive letter', () => {
    const out = 'C:\\Users\\x\\sketch.ino:3:1: error: expected ";"';
    const [d] = parseDiagnostics(out);
    expect(d.file).toBe('C:\\Users\\x\\sketch.ino');
    expect(d.line).toBe(3);
  });

  it('parses several diagnostics', () => {
    const out = [
      'a.ino:1:1: error: first',
      'a.ino:2:1: warning: second',
      'a.ino:3:1: note: third',
    ].join('\n');
    expect(parseDiagnostics(out)).toHaveLength(3);
  });

  it('returns nothing for clean output', () => {
    expect(parseDiagnostics('Sketch uses 924 bytes of program storage space.')).toEqual([]);
  });

  it('detects whether any diagnostic is fatal', () => {
    expect(hasErrors(parseDiagnostics('a.ino:1:1: warning: w'))).toBe(false);
    expect(hasErrors(parseDiagnostics('a.ino:1:1: error: e'))).toBe(true);
  });
});

describe('UnavailableCompiler', () => {
  it('reports unavailable', async () => {
    const c = new UnavailableCompiler();
    expect((await c.status()).available).toBe(false);
  });

  it('explains how to proceed', async () => {
    const result = await new UnavailableCompiler().compile();
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/arduino-cli/);
    expect(result.output).toMatch(/\.hex/);
  });
});

describe('CachingCompiler', () => {
  function fakeCompiler(result: Partial<CompileResult> = {}): Compiler & { calls: number } {
    const inner = {
      calls: 0,
      async status() {
        return { available: true };
      },
      async compile(): Promise<CompileResult> {
        inner.calls++;
        return { ok: true, hex: ':00000001FF\n', diagnostics: [], output: '', ...result };
      },
    };
    return inner;
  }

  it('compiles once for identical sketches', async () => {
    const inner = fakeCompiler();
    const c = new CachingCompiler(inner);
    await c.compile('void setup(){}');
    await c.compile('void setup(){}');
    expect(inner.calls).toBe(1);
  });

  it('recompiles when the sketch changes', async () => {
    const inner = fakeCompiler();
    const c = new CachingCompiler(inner);
    await c.compile('a');
    await c.compile('b');
    expect(inner.calls).toBe(2);
  });

  it('recompiles when the board changes', async () => {
    const inner = fakeCompiler();
    const c = new CachingCompiler(inner);
    await c.compile('a', { fqbn: 'arduino:avr:uno' });
    await c.compile('a', { fqbn: 'arduino:avr:nano' });
    expect(inner.calls).toBe(2);
  });

  it('does not cache failures', async () => {
    const inner = fakeCompiler({ ok: false, hex: undefined });
    const c = new CachingCompiler(inner);
    await c.compile('a');
    await c.compile('a');
    expect(inner.calls).toBe(2);
  });

  it('evicts the oldest entry past the limit', async () => {
    const inner = fakeCompiler();
    const c = new CachingCompiler(inner, 2);
    await c.compile('a');
    await c.compile('b');
    await c.compile('c'); // evicts 'a'
    await c.compile('a');
    expect(inner.calls).toBe(4);
  });

  it('clear() drops the cache', async () => {
    const inner = fakeCompiler();
    const c = new CachingCompiler(inner);
    await c.compile('a');
    c.clear();
    await c.compile('a');
    expect(inner.calls).toBe(2);
  });

  it('passes status through', async () => {
    const c = new CachingCompiler(fakeCompiler());
    expect((await c.status()).available).toBe(true);
  });
});
