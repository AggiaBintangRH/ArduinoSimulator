/**
 * Parser + validator for `diagram.json`.
 *
 * Validation is deliberately two-tier:
 *  - structural problems (bad JSON, wrong types, duplicate ids) are errors and
 *    make the diagram unusable;
 *  - semantic problems (unknown part type, unknown pin name) are collected as
 *    diagnostics so the editor can still render what it understands.
 */

import type {
  Diagram,
  DiagramConnection,
  DiagramPart,
  PinRef,
  SerialMonitorConfig,
  SerialMonitorDisplay,
  SerialMonitorNewline,
} from './types.js';
import { parseRoute, RouteParseError } from './router.js';

export class DiagramParseError extends Error {}

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  /** Where the problem is, e.g. `parts[2]` or `connections[5]`. */
  path: string;
}

export interface ParseResult {
  diagram: Diagram;
  diagnostics: Diagnostic[];
}

/** Look up the pin names a part type exposes. Returns null for unknown types. */
export type PinLookup = (partType: string) => readonly string[] | null;

const DISPLAY_VALUES: SerialMonitorDisplay[] = ['auto', 'always', 'never', 'plotter', 'terminal'];
const NEWLINE_VALUES: SerialMonitorNewline[] = ['lf', 'cr', 'crlf', 'none'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Split `"uno:13"` into its parts. Pin names may themselves contain dots ("GND.2"). */
export function parsePinRef(ref: string): PinRef {
  const idx = ref.indexOf(':');
  if (idx <= 0 || idx === ref.length - 1) {
    throw new DiagramParseError(`malformed pin reference: ${JSON.stringify(ref)}`);
  }
  return { partId: ref.slice(0, idx), pin: ref.slice(idx + 1) };
}

export function formatPinRef(ref: PinRef): string {
  return `${ref.partId}:${ref.pin}`;
}

function parsePart(raw: unknown, path: string): DiagramPart {
  if (!isPlainObject(raw)) {
    throw new DiagramParseError(`${path} is not an object`);
  }
  const { id, type } = raw;
  if (typeof id !== 'string' || id === '') {
    throw new DiagramParseError(`${path}.id must be a non-empty string`);
  }
  if (typeof type !== 'string' || type === '') {
    throw new DiagramParseError(`${path}.type must be a non-empty string`);
  }

  const part: DiagramPart = { id, type };

  for (const key of ['left', 'top', 'rotate'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new DiagramParseError(`${path}.${key} must be a finite number`);
    }
    part[key] = value;
  }

  if (raw.hide !== undefined) {
    if (typeof raw.hide !== 'boolean') {
      throw new DiagramParseError(`${path}.hide must be a boolean`);
    }
    part.hide = raw.hide;
  }

  if (raw.attrs !== undefined) {
    if (!isPlainObject(raw.attrs)) {
      throw new DiagramParseError(`${path}.attrs must be an object`);
    }
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.attrs)) {
      // Wokwi writes every attribute as a string, but hand-edited diagrams often
      // use raw numbers/booleans. Coerce rather than reject.
      if (typeof v === 'string') attrs[k] = v;
      else if (typeof v === 'number' || typeof v === 'boolean') attrs[k] = String(v);
      else if (Array.isArray(v)) attrs[k] = JSON.stringify(v);
      else throw new DiagramParseError(`${path}.attrs.${k} has an unsupported value type`);
    }
    part.attrs = attrs;
  }

  return part;
}

function parseConnection(raw: unknown, path: string): DiagramConnection {
  if (!Array.isArray(raw)) {
    throw new DiagramParseError(`${path} must be an array`);
  }
  if (raw.length < 3) {
    throw new DiagramParseError(`${path} must have at least 3 elements [from, to, color]`);
  }
  const [from, to, color, route] = raw;
  if (typeof from !== 'string' || typeof to !== 'string') {
    throw new DiagramParseError(`${path} endpoints must be strings`);
  }
  if (typeof color !== 'string') {
    throw new DiagramParseError(`${path}[2] (color) must be a string`);
  }
  let instructions: string[] = [];
  if (route !== undefined) {
    if (!Array.isArray(route) || route.some((s) => typeof s !== 'string')) {
      throw new DiagramParseError(`${path}[3] (route) must be an array of strings`);
    }
    instructions = route as string[];
  }
  return [from, to, color, instructions];
}

function parseSerialMonitor(raw: unknown, diagnostics: Diagnostic[]): SerialMonitorConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    throw new DiagramParseError('serialMonitor must be an object');
  }
  const cfg: SerialMonitorConfig = {};
  if (raw.display !== undefined) {
    if (DISPLAY_VALUES.includes(raw.display as SerialMonitorDisplay)) {
      cfg.display = raw.display as SerialMonitorDisplay;
    } else {
      diagnostics.push({
        severity: 'warning',
        path: 'serialMonitor.display',
        message: `unknown display mode ${JSON.stringify(raw.display)}; falling back to "auto"`,
      });
    }
  }
  if (raw.newline !== undefined) {
    if (NEWLINE_VALUES.includes(raw.newline as SerialMonitorNewline)) {
      cfg.newline = raw.newline as SerialMonitorNewline;
    } else {
      diagnostics.push({
        severity: 'warning',
        path: 'serialMonitor.newline',
        message: `unknown newline mode ${JSON.stringify(raw.newline)}; falling back to "lf"`,
      });
    }
  }
  if (typeof raw.collapse === 'boolean') cfg.collapse = raw.collapse;
  if (typeof raw.convertEol === 'boolean') cfg.convertEol = raw.convertEol;
  return cfg;
}

/**
 * Parse and validate a diagram.
 *
 * @param input   the diagram as a JSON string or an already-decoded object
 * @param lookup  optional pin-name lookup used to check connection endpoints
 */
export function parseDiagram(input: string | unknown, lookup?: PinLookup): ParseResult {
  let raw: unknown;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      throw new DiagramParseError(`invalid JSON: ${(e as Error).message}`);
    }
  } else {
    raw = input;
  }

  if (!isPlainObject(raw)) {
    throw new DiagramParseError('diagram must be a JSON object');
  }

  const diagnostics: Diagnostic[] = [];

  if (raw.version !== undefined && raw.version !== 1) {
    diagnostics.push({
      severity: 'warning',
      path: 'version',
      message: `expected version 1, got ${JSON.stringify(raw.version)}`,
    });
  }

  const rawParts = raw.parts ?? [];
  if (!Array.isArray(rawParts)) throw new DiagramParseError('parts must be an array');
  const parts = rawParts.map((p, i) => parsePart(p, `parts[${i}]`));

  const byId = new Map<string, DiagramPart>();
  for (const [i, part] of parts.entries()) {
    if (byId.has(part.id)) {
      throw new DiagramParseError(`parts[${i}] duplicates part id ${JSON.stringify(part.id)}`);
    }
    byId.set(part.id, part);
  }

  const rawConnections = raw.connections ?? [];
  if (!Array.isArray(rawConnections)) throw new DiagramParseError('connections must be an array');
  const connections = rawConnections.map((c, i) => parseConnection(c, `connections[${i}]`));

  // Semantic checks: endpoints must resolve, routes must parse.
  for (const [i, conn] of connections.entries()) {
    const path = `connections[${i}]`;
    for (const [side, ref] of [['from', conn[0]], ['to', conn[1]]] as const) {
      let parsed: PinRef;
      try {
        parsed = parsePinRef(ref);
      } catch (e) {
        diagnostics.push({ severity: 'error', path: `${path} (${side})`, message: (e as Error).message });
        continue;
      }
      const part = byId.get(parsed.partId);
      if (!part) {
        diagnostics.push({
          severity: 'error',
          path: `${path} (${side})`,
          message: `no part with id ${JSON.stringify(parsed.partId)}`,
        });
        continue;
      }
      const pins = lookup?.(part.type);
      if (pins === null) {
        diagnostics.push({
          severity: 'warning',
          path: `${path} (${side})`,
          message: `unknown part type ${JSON.stringify(part.type)}; cannot verify pin ${JSON.stringify(parsed.pin)}`,
        });
      } else if (pins && !pins.includes(parsed.pin)) {
        diagnostics.push({
          severity: 'error',
          path: `${path} (${side})`,
          message: `part ${JSON.stringify(part.id)} (${part.type}) has no pin ${JSON.stringify(parsed.pin)}`,
        });
      }
    }

    try {
      parseRoute(conn[3]);
    } catch (e) {
      if (e instanceof RouteParseError) {
        diagnostics.push({ severity: 'warning', path: `${path}[3]`, message: e.message });
      } else throw e;
    }
  }

  // Unknown part types are worth surfacing even when nothing connects to them.
  if (lookup) {
    for (const [i, part] of parts.entries()) {
      if (lookup(part.type) === null) {
        diagnostics.push({
          severity: 'warning',
          path: `parts[${i}]`,
          message: `unknown part type ${JSON.stringify(part.type)}`,
        });
      }
    }
  }

  const diagram: Diagram = {
    version: typeof raw.version === 'number' ? raw.version : 1,
    parts,
    connections,
  };
  if (typeof raw.author === 'string') diagram.author = raw.author;
  if (typeof raw.editor === 'string') diagram.editor = raw.editor;
  const serialMonitor = parseSerialMonitor(raw.serialMonitor, diagnostics);
  if (serialMonitor) diagram.serialMonitor = serialMonitor;

  return { diagram, diagnostics };
}

/** Serialize back to the canonical diagram.json shape. */
export function stringifyDiagram(diagram: Diagram, indent = 2): string {
  const out: Record<string, unknown> = { version: diagram.version || 1 };
  if (diagram.author) out.author = diagram.author;
  if (diagram.editor) out.editor = diagram.editor;
  out.parts = diagram.parts;
  out.connections = diagram.connections;
  if (diagram.serialMonitor) out.serialMonitor = diagram.serialMonitor;
  return JSON.stringify(out, null, indent);
}

/** Convenience: throw if any diagnostic is an error. */
export function assertNoErrors(result: ParseResult): ParseResult {
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) {
    throw new DiagramParseError(
      `diagram has ${errors.length} error(s):\n` +
        errors.map((d) => `  ${d.path}: ${d.message}`).join('\n'),
    );
  }
  return result;
}
