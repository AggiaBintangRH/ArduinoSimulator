// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { installSplitter, clampSize } from '../src/ui/splitter.js';
import { saveLayout, loadLayout } from '../src/storage.js';

function pointer(type: string, x: number, y: number, button = 0): Event {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  Object.defineProperty(ev, 'button', { value: button });
  return ev;
}

/** A handle plus a recorded size, standing in for a pane. */
function harness(overrides: Partial<Parameters<typeof installSplitter>[1]> = {}) {
  const handle = document.createElement('div');
  document.body.append(handle);
  let size = 400;
  const changes: number[] = [];
  const stop = installSplitter(handle, {
    axis: 'x',
    grow: 1,
    size: () => size,
    apply: (px) => {
      size = px;
    },
    max: () => 800,
    reset: 300,
    onChange: () => changes.push(size),
    ...overrides,
  });
  return { handle, changes, stop, get size() { return size; } };
}

describe('clampSize', () => {
  it('keeps a size between its bounds', () => {
    expect(clampSize(50, 0, 100)).toBe(50);
    expect(clampSize(-20, 0, 100)).toBe(0);
    expect(clampSize(500, 0, 100)).toBe(100);
  });

  it('lets a pane close completely when the minimum allows it', () => {
    expect(clampSize(-999, 0, 100)).toBe(0);
  });

  it('prefers the minimum when there is no room for it', () => {
    // A window too small for both panes would otherwise ask for a negative
    // size, which is not a size.
    expect(clampSize(50, 100, 40)).toBe(100);
  });
});

describe('installSplitter', () => {
  beforeEach(() => document.body.replaceChildren());

  it('resizes by how far the pointer moved', () => {
    const h = harness();
    h.handle.dispatchEvent(pointer('pointerdown', 100, 0));
    h.handle.dispatchEvent(pointer('pointermove', 160, 0));
    expect(h.size).toBe(460);
  });

  it('grows the other way when the handle sits after the pane', () => {
    // The serial monitor's handle is above it, so dragging up makes it taller.
    const h = harness({ axis: 'y', grow: -1 });
    h.handle.dispatchEvent(pointer('pointerdown', 0, 500));
    h.handle.dispatchEvent(pointer('pointermove', 0, 400));
    expect(h.size).toBe(500);
  });

  it('ignores movement when no drag is in progress', () => {
    const h = harness();
    h.handle.dispatchEvent(pointer('pointermove', 999, 999));
    expect(h.size).toBe(400);
    expect(h.changes).toEqual([]);
  });

  it('stops resizing once the pointer is released', () => {
    const h = harness();
    h.handle.dispatchEvent(pointer('pointerdown', 100, 0));
    h.handle.dispatchEvent(pointer('pointermove', 150, 0));
    h.handle.dispatchEvent(pointer('pointerup', 150, 0));
    h.handle.dispatchEvent(pointer('pointermove', 700, 0));
    expect(h.size).toBe(450);
  });

  it('lets the pane be dragged shut, but no further', () => {
    const h = harness();
    h.handle.dispatchEvent(pointer('pointerdown', 500, 0));
    h.handle.dispatchEvent(pointer('pointermove', -500, 0));
    expect(h.size).toBe(0);
  });

  it('holds the pane at its maximum', () => {
    const h = harness();
    h.handle.dispatchEvent(pointer('pointerdown', 0, 0));
    h.handle.dispatchEvent(pointer('pointermove', 5000, 0));
    expect(h.size).toBe(800);
  });

  it('respects a minimum when one is given', () => {
    const h = harness({ min: 120 });
    h.handle.dispatchEvent(pointer('pointerdown', 500, 0));
    h.handle.dispatchEvent(pointer('pointermove', 0, 0));
    expect(h.size).toBe(120);
  });

  it('brings a closed pane back on a double-click', () => {
    // Dragged shut, the pane leaves only the handle behind; hitting a few
    // pixels twice has to be enough to undo that.
    const h = harness();
    h.handle.dispatchEvent(pointer('pointerdown', 500, 0));
    h.handle.dispatchEvent(pointer('pointermove', -500, 0));
    expect(h.size).toBe(0);
    h.handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(h.size).toBe(300);
  });

  it('stops the press from starting a text selection', () => {
    // Both panes are full of text, and dragging a selection is a native drag
    // that would take the pointer away mid-resize.
    const h = harness();
    const down = pointer('pointerdown', 100, 0);
    h.handle.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('ignores buttons other than the left one', () => {
    const h = harness();
    h.handle.dispatchEvent(pointer('pointerdown', 100, 0, 2));
    h.handle.dispatchEvent(pointer('pointermove', 300, 0));
    expect(h.size).toBe(400);
  });

  it('reports every change, so the canvas can re-measure', () => {
    const h = harness();
    h.handle.dispatchEvent(pointer('pointerdown', 100, 0));
    h.handle.dispatchEvent(pointer('pointermove', 120, 0));
    h.handle.dispatchEvent(pointer('pointermove', 140, 0));
    expect(h.changes).toEqual([420, 440]);
  });

  it('moves with the arrow keys along its own axis', () => {
    // The handle is focusable, so the keys have to work: a control that takes
    // focus and then does nothing is worse than one that never takes it.
    const h = harness();
    const key = (k: string) =>
      h.handle.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('ArrowRight');
    expect(h.size).toBe(424);
    key('ArrowLeft');
    expect(h.size).toBe(400);
    // The cross-axis keys are not ours to take.
    const down = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    h.handle.dispatchEvent(down);
    expect(h.size).toBe(400);
    expect(down.defaultPrevented).toBe(false);
  });

  it('grows upward with ArrowUp when the handle sits above the pane', () => {
    const h = harness({ axis: 'y', grow: -1 });
    h.handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(h.size).toBe(424);
  });

  it('resets on Home', () => {
    const h = harness();
    h.handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(h.size).toBe(300);
  });

  it('detaches cleanly', () => {
    const h = harness();
    h.stop();
    h.handle.dispatchEvent(pointer('pointerdown', 100, 0));
    h.handle.dispatchEvent(pointer('pointermove', 300, 0));
    expect(h.size).toBe(400);
  });
});

describe('layout storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips the pane sizes', () => {
    saveLayout({ codeWidth: 320, serialHeight: 260 });
    expect(loadLayout()).toEqual({ codeWidth: 320, serialHeight: 260 });
  });

  it('returns nothing when there is nothing stored', () => {
    expect(loadLayout()).toEqual({});
  });

  it('drops values that are not usable sizes', () => {
    // A bad value here would collapse a pane on startup with no clue why.
    localStorage.setItem(
      'arduino-simulator.layout',
      JSON.stringify({ codeWidth: 'wide', serialHeight: -5 }),
    );
    expect(loadLayout()).toEqual({});
  });

  it('survives stored text that is not JSON at all', () => {
    localStorage.setItem('arduino-simulator.layout', '{not json');
    expect(loadLayout()).toEqual({});
  });

  it('keeps a size of zero, which means the pane was put away', () => {
    saveLayout({ codeWidth: 0 });
    expect(loadLayout()).toEqual({ codeWidth: 0 });
  });
});
