/**
 * Extra files in a sketch.
 *
 * An Arduino sketch is a directory, not a single file: `pitches.h` next to
 * `sketch.ino` is how the tone examples are written, and a sketch of any size
 * splits into headers sooner or later. The main `.ino` stays in
 * `Project.sketch`; everything else lives here.
 *
 * Names are checked hard, because they end up as real files on the machine
 * running the toolchain.
 */

export interface SketchFile {
  name: string;
  content: string;
}

/**
 * What arduino-cli will actually compile in a sketch directory.
 *
 * `.pde` is deliberately absent: it is the pre-1.0 sketch extension, and a
 * second sketch file in one directory is an error, not a source file.
 */
export const SKETCH_EXTENSIONS = ['h', 'hpp', 'c', 'cc', 'cpp', 'ino', 'S'] as const;

/** The name the main sketch is written under; nothing else may claim it. */
export const MAIN_FILE = 'sketch.ino';

const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

/**
 * Whether this extension names something the toolchain compiles.
 *
 * The C and C++ ones are matched without case - `Pitches.H` is an ordinary
 * header, and rejecting it as "not a source file" helps nobody. `.S` is not:
 * to gcc, `.S` is assembly that runs through the preprocessor and `.s` is
 * assembly that does not, and arduino-cli only builds the former.
 */
function isSourceExtension(extension: string): boolean {
  if (extension === 'S') return true;
  return SKETCH_EXTENSIONS.includes(extension.toLowerCase() as (typeof SKETCH_EXTENSIONS)[number]);
}

/**
 * Why this name cannot be used, or null if it can.
 *
 * A sentence rather than a boolean: the dialog shows it, and "that name is
 * invalid" tells nobody which part of it was the problem.
 */
export function fileNameError(name: string, existing: readonly SketchFile[] = []): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Give the file a name.';
  // Checked before the character rule so the message names the real problem:
  // someone typing a path meant a path, not a stray slash.
  if (/[\\/]/.test(trimmed)) return 'A file name cannot contain a path.';
  if (!NAME_RE.test(trimmed)) {
    return 'Use letters, digits, dots, dashes and underscores.';
  }
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0) return `Add an extension, such as ${trimmed}.h`;
  const extension = trimmed.slice(dot + 1);
  if (!isSourceExtension(extension)) {
    return `${extension} is not a source file. Use ${SKETCH_EXTENSIONS.join(', ')}.`;
  }
  if (trimmed.toLowerCase() === MAIN_FILE) {
    return `${MAIN_FILE} is the main sketch; edit it in its own tab.`;
  }
  // Case-insensitively: Windows and macOS would treat these as one file, and
  // the two of them would overwrite each other on the way to the toolchain.
  if (existing.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
    return `${trimmed} is already in this sketch.`;
  }
  return null;
}

export function isValidFileName(name: string, existing: readonly SketchFile[] = []): boolean {
  return fileNameError(name, existing) === null;
}

/**
 * A name to offer for something the user typed.
 *
 * Someone asking for "pitches" means `pitches.h` - a bare word is not a source
 * file, and a header is what an extra file nearly always is.
 */
export function suggestFileName(name: string): string {
  const trimmed = name.trim();
  return trimmed !== '' && !trimmed.includes('.') ? `${trimmed}.h` : trimmed;
}

/** Add a file, keeping the list in name order. */
export function addFile(
  files: readonly SketchFile[],
  name: string,
  content = '',
): SketchFile[] {
  return [...files, { name: name.trim(), content }].sort((a, b) => a.name.localeCompare(b.name));
}

export function removeFile(files: readonly SketchFile[], name: string): SketchFile[] {
  return files.filter((f) => f.name.toLowerCase() !== name.trim().toLowerCase());
}

export function findFile(files: readonly SketchFile[], name: string): SketchFile | undefined {
  return files.find((f) => f.name.toLowerCase() === name.trim().toLowerCase());
}

/**
 * Read a list of files out of whatever a saved project or import held.
 *
 * Anything that is not a usable file is dropped rather than trusted: this
 * text becomes file names on disk, and an older saved project has no `files`
 * key at all.
 */
export function parseFiles(value: unknown): SketchFile[] {
  if (!Array.isArray(value)) return [];
  const out: SketchFile[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, content } = entry as { name?: unknown; content?: unknown };
    if (typeof name !== 'string' || typeof content !== 'string') continue;
    if (!isValidFileName(name, out)) continue;
    out.push({ name: name.trim(), content });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
