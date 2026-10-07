/**
 * Types for the Wokwi-compatible `diagram.json` format.
 * Reference: https://docs.wokwi.com/diagram-format
 */

/** Attribute values are always strings in diagram.json, even numeric ones ("400", "0x27"). */
export type PartAttrs = Record<string, string>;

export interface DiagramPart {
  id: string;
  type: string;
  left?: number;
  top?: number;
  rotate?: number;
  hide?: boolean;
  attrs?: PartAttrs;
}

/**
 * `[ "srcId:pin", "dstId:pin", color, [ routeInstructions ] ]`
 * An empty color string hides the wire.
 */
export type DiagramConnection = [string, string, string, string[]];

export type SerialMonitorDisplay = 'auto' | 'always' | 'never' | 'plotter' | 'terminal';
export type SerialMonitorNewline = 'lf' | 'cr' | 'crlf' | 'none';

export interface SerialMonitorConfig {
  display?: SerialMonitorDisplay;
  newline?: SerialMonitorNewline;
  collapse?: boolean;
  convertEol?: boolean;
}

export interface Diagram {
  version: number;
  author?: string;
  editor?: string;
  parts: DiagramPart[];
  connections: DiagramConnection[];
  serialMonitor?: SerialMonitorConfig;
}

/** A parsed `"partId:PIN"` endpoint. */
export interface PinRef {
  partId: string;
  pin: string;
}

export const SERIAL_NEWLINE_BYTES: Record<SerialMonitorNewline, number[]> = {
  lf: [10],
  cr: [13],
  crlf: [13, 10],
  none: [],
};
