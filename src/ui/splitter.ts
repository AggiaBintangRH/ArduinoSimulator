/**
 * Draggable dividers between the panes.
 *
 * The panes are laid out by CSS grid; a splitter does not move anything
 * itself, it just reports the size the pane should be. Whoever installs it
 * decides what that means - a grid column, a row height - so this file has no
 * opinion about the layout it is dividing.
 */

export interface SplitterOptions {
  /** Which way the divider slides. */
  axis: 'x' | 'y';
  /**
   * Whether the pane grows as the pointer coordinate grows. A divider to the
   * right of its pane grows with +x; one above its pane grows with -y.
   */
  grow: 1 | -1;
  /** The pane's size right now, in px. */
  size: () => number;
  /** Give the pane a new size, in px. */
  apply: (px: number) => void;
  /** Smallest allowed size. Zero means the pane can be put away entirely. */
  min?: number;
  /** Largest allowed size, measured when the drag starts. */
  max: () => number;
  /** Size to go back to on a double-click, for a pane dragged out of sight. */
  reset: number;
  /** How far one arrow-key press moves the divider. */
  step?: number;
  /** Called after every change, so a canvas can be told to re-measure. */
  onChange?: () => void;
}

export function clampSize(px: number, min: number, max: number): number {
  // A max below the min means there is no room at all; the min wins, because
  // a negative size is not a size.
  return Math.max(min, Math.min(px, Math.max(min, max)));
}

/**
 * Make `handle` drag the pane its options describe.
 *
 * Returns a function that removes the listeners again, which matters for
 * tests more than for the app - the app's splitters live as long as it does.
 */
export function installSplitter(handle: HTMLElement, options: SplitterOptions): () => void {
  const min = options.min ?? 0;
  let start = 0;
  let from = 0;
  let dragging = false;

  const set = (px: number) => {
    options.apply(clampSize(px, min, options.max()));
    options.onChange?.();
  };

  const onDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    // Panes are full of text; without this the drag selects it and the
    // browser's own drag-the-selection takes the pointer.
    ev.preventDefault();
    dragging = true;
    start = options.axis === 'x' ? ev.clientX : ev.clientY;
    from = options.size();
    handle.classList.add('dragging');
    try {
      handle.setPointerCapture(ev.pointerId);
    } catch {
      // Without capture the drag still tracks until the pointer leaves.
    }
  };

  const onMove = (ev: PointerEvent) => {
    if (!dragging) return;
    const at = options.axis === 'x' ? ev.clientX : ev.clientY;
    set(from + (at - start) * options.grow);
  };

  const onUp = (ev: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    try {
      handle.releasePointerCapture(ev.pointerId);
    } catch {
      // Already released; nothing to do.
    }
  };

  // A pane dragged all the way shut leaves only the handle behind, so there
  // has to be a way back that does not depend on hitting a few pixels twice.
  const onDouble = () => set(options.reset);

  /*
   * The handle is a focusable separator, so the arrow keys along its axis have
   * to move it - a control that takes focus and then does nothing is worse
   * than one that never takes it.
   */
  const onKey = (ev: KeyboardEvent) => {
    const step = options.step ?? 24;
    const keys =
      options.axis === 'x'
        ? { less: 'ArrowLeft', more: 'ArrowRight' }
        : { less: 'ArrowUp', more: 'ArrowDown' };
    if (ev.key === 'Home') {
      ev.preventDefault();
      set(options.reset);
      return;
    }
    const delta = ev.key === keys.less ? -step : ev.key === keys.more ? step : 0;
    if (delta === 0) return;
    ev.preventDefault();
    set(options.size() + delta * options.grow);
  };

  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
  handle.addEventListener('dblclick', onDouble);
  handle.addEventListener('keydown', onKey);

  return () => {
    handle.removeEventListener('pointerdown', onDown);
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
    handle.removeEventListener('dblclick', onDouble);
    handle.removeEventListener('keydown', onKey);
  };
}
