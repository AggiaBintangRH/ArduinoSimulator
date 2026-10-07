/**
 * Project persistence: localStorage for the working copy, file import/export
 * for sharing.
 */

import type { Diagram } from './diagram/types.js';
import { parseDiagram, stringifyDiagram } from './diagram/parse.js';
import { pinLookup } from './sim/registry.js';
import { parseFiles, type SketchFile } from './build/sketch-files.js';

export interface Project {
  name: string;
  /** The main `.ino`. */
  sketch: string;
  diagram: Diagram;
  /** Library names, one per line, in libraries.txt format. */
  libraries: string[];
  /**
   * Headers and other sources beside the main sketch.
   *
   * A sketch is a directory: `pitches.h` next to `sketch.ino` is how the tone
   * examples are written. Absent in projects saved before this existed, which
   * is why it is read defensively rather than required.
   */
  files: SketchFile[];
}

const STORAGE_KEY = 'arduino-simulator.project';
const VIEW_KEY = 'arduino-simulator.view';
const LAYOUT_KEY = 'arduino-simulator.layout';
const MUTED_KEY = 'arduino-simulator.muted';

export type ViewState = 'dashboard' | 'simulation';

export function saveView(view: ViewState): void {
  try {
    storage()?.setItem(VIEW_KEY, view);
  } catch {
    // Ignore storage errors.
  }
}

export function loadView(): ViewState {
  try {
    const v = storage()?.getItem(VIEW_KEY);
    if (v === 'dashboard' || v === 'simulation') return v;
  } catch {
    // Ignore.
  }
  return 'dashboard';
}

/** Pane sizes, in px. A missing entry means "whatever the stylesheet says". */
export interface LayoutSizes {
  codeWidth?: number;
  serialHeight?: number;
}

export function saveLayout(sizes: LayoutSizes): void {
  try {
    storage()?.setItem(LAYOUT_KEY, JSON.stringify(sizes));
  } catch {
    // Ignore storage errors.
  }
}

export function loadLayout(): LayoutSizes {
  try {
    const raw = storage()?.getItem(LAYOUT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LayoutSizes;
    // Anything that is not a usable number is dropped rather than trusted:
    // a bad value here would collapse a pane on startup with no way to know
    // why.
    const clean: LayoutSizes = {};
    for (const key of ['codeWidth', 'serialHeight'] as const) {
      const value = parsed?.[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        clean[key] = value;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

/** Whether the buzzer is muted. Remembered: it is a preference, not a state. */
export function saveMuted(muted: boolean): void {
  try {
    storage()?.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    // Ignore storage errors.
  }
}

export function loadMuted(): boolean {
  try {
    return storage()?.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function serializeProject(project: Project): string {
  return JSON.stringify(
    {
      name: project.name,
      sketch: project.sketch,
      diagram: project.diagram,
      libraries: project.libraries,
      files: project.files,
    },
    null,
    2,
  );
}

export class ProjectParseError extends Error {}

export function deserializeProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ProjectParseError(`not valid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new ProjectParseError('project must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.diagram === undefined) {
    throw new ProjectParseError('project has no diagram');
  }
  const { diagram } = parseDiagram(obj.diagram, pinLookup);
  return {
    name: typeof obj.name === 'string' ? obj.name : 'Untitled',
    sketch: typeof obj.sketch === 'string' ? obj.sketch : '',
    diagram,
    libraries: Array.isArray(obj.libraries)
      ? obj.libraries.filter((l): l is string => typeof l === 'string')
      : [],
    files: parseFiles(obj.files),
  };
}

/** Parse a libraries.txt file: one per line, `#` comments, `Name@version`. */
export function parseLibrariesTxt(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

export function formatLibrariesTxt(libraries: readonly string[]): string {
  return libraries.join('\n') + (libraries.length ? '\n' : '');
}

function storage(): Storage | null {
  try {
    // Access can throw outright in a private window or with site data blocked.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveProject(project: Project): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, serializeProject(project));
    return true;
  } catch {
    // Quota exceeded, or storage disabled mid-session.
    return false;
  }
}

export function loadProject(): Project | null {
  const store = storage();
  if (!store) return null;
  try {
    const text = store.getItem(STORAGE_KEY);
    if (!text) return null;
    return deserializeProject(text);
  } catch {
    // A corrupt saved project must not brick startup.
    return null;
  }
}

export function clearProject(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do if storage is unavailable.
  }
}

/** Filename-safe version of a project name. */
export function projectFileName(name: string, extension = 'json'): string {
  const safe = name
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
  return `${safe || 'project'}.${extension}`;
}

export { stringifyDiagram };
