import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../src/parts/index.js';
import { DiagramEditor, defaultWireColor, makePartId } from '../src/editor/diagram-editor.js';
import type { Diagram } from '../src/diagram/types.js';

function base(): Diagram {
  return {
    version: 1,
    parts: [
      { id: 'uno', type: 'wokwi-arduino-uno', left: 0, top: 0 },
      { id: 'led1', type: 'wokwi-led', left: 100, top: 50 },
    ],
    connections: [['uno:13', 'led1:A', 'green', []]],
  };
}

describe('defaultWireColor', () => {
  it('uses black for ground', () => {
    expect(defaultWireColor('led1:C', 'uno:GND.1')).toBe('black');
  });

  it('uses red for power', () => {
    expect(defaultWireColor('pot:VCC', 'uno:5V')).toBe('red');
  });

  it('uses green for everything else', () => {
    expect(defaultWireColor('uno:13', 'led1:A')).toBe('green');
  });

  it('prefers ground when a wire touches both rails', () => {
    expect(defaultWireColor('uno:GND.1', 'uno:5V')).toBe('black');
  });
});

describe('makePartId', () => {
  it('derives an id from the type', () => {
    expect(makePartId({ version: 1, parts: [], connections: [] }, 'wokwi-led')).toBe('led1');
  });

  it('avoids collisions', () => {
    const d: Diagram = {
      version: 1,
      parts: [{ id: 'led1', type: 'wokwi-led' }, { id: 'led2', type: 'wokwi-led' }],
      connections: [],
    };
    expect(makePartId(d, 'wokwi-led')).toBe('led3');
  });

  it('strips the board- prefix too', () => {
    expect(makePartId({ version: 1, parts: [], connections: [] }, 'board-ssd1306')).toBe('ssd13061');
  });
});

describe('DiagramEditor parts', () => {
  let editor: DiagramEditor;
  let changes: number;

  beforeEach(() => {
    changes = 0;
    editor = new DiagramEditor(base(), { onChange: () => changes++ });
  });

  it('does not mutate the diagram it was given', () => {
    const original = base();
    const ed = new DiagramEditor(original);
    ed.addPart('wokwi-led');
    expect(original.parts).toHaveLength(2);
  });

  it('adds a part and selects it', () => {
    const id = editor.addPart('wokwi-resistor', 200, 200);
    expect(editor.value.parts).toHaveLength(3);
    expect(editor.selected).toBe(id);
    expect(editor.findPart(id)!.left).toBe(200);
  });

  it('adds a part with attributes', () => {
    const id = editor.addPart('wokwi-led', 0, 0, { color: 'blue' });
    expect(editor.findPart(id)!.attrs).toEqual({ color: 'blue' });
  });

  it('moves a part', () => {
    editor.movePart('led1', 300, 400);
    expect(editor.findPart('led1')).toMatchObject({ left: 300, top: 400 });
  });

  it('ignores a move for an unknown part', () => {
    expect(() => editor.movePart('ghost', 1, 1)).not.toThrow();
  });

  it('rotates in 90 degree steps and wraps at 360', () => {
    editor.rotatePart('led1');
    expect(editor.findPart('led1')!.rotate).toBe(90);
    editor.rotatePart('led1');
    editor.rotatePart('led1');
    editor.rotatePart('led1');
    expect(editor.findPart('led1')!.rotate).toBe(0);
  });

  it('deletes a part and its wires', () => {
    editor.deletePart('led1');
    expect(editor.value.parts).toHaveLength(1);
    expect(editor.value.connections).toHaveLength(0);
  });

  it('clears the selection when the selected part is deleted', () => {
    editor.select('led1');
    editor.deletePart('led1');
    expect(editor.selected).toBeNull();
  });

  it('duplicates a part with a fresh id and an offset', () => {
    const copyId = editor.duplicatePart('led1')!;
    expect(copyId).not.toBe('led1');
    expect(editor.findPart(copyId)).toMatchObject({ left: 120, top: 70 });
    // The copy is not wired to anything.
    expect(editor.value.connections).toHaveLength(1);
  });

  it('returns null when duplicating a missing part', () => {
    expect(editor.duplicatePart('ghost')).toBeNull();
  });

  it('sets and clears attributes', () => {
    editor.setAttr('led1', 'color', 'blue');
    expect(editor.findPart('led1')!.attrs).toEqual({ color: 'blue' });
    editor.setAttr('led1', 'color', '');
    expect(editor.findPart('led1')!.attrs).toBeUndefined();
  });

  it('notifies on every change', () => {
    editor.addPart('wokwi-led');
    editor.movePart('led1', 1, 1);
    editor.rotatePart('led1');
    expect(changes).toBe(3);
  });
});

describe('DiagramEditor wiring', () => {
  let editor: DiagramEditor;
  let errors: string[];

  beforeEach(() => {
    errors = [];
    editor = new DiagramEditor(base(), { onError: (m) => errors.push(m) });
  });

  it('connects two pins with an auto colour', () => {
    expect(editor.connect('led1:C', 'uno:GND.1')).toBe(true);
    const wire = editor.value.connections.at(-1)!;
    expect(wire[0]).toBe('led1:C');
    expect(wire[2]).toBe('black');
  });

  it('rejects a self connection', () => {
    expect(editor.connect('uno:13', 'uno:13')).toBe(false);
    expect(errors[0]).toMatch(/itself/);
  });

  it('rejects a duplicate wire in either direction', () => {
    expect(editor.connect('led1:A', 'uno:13')).toBe(false);
    expect(errors[0]).toMatch(/already connected/);
  });

  it('rejects a pin the part does not have', () => {
    expect(editor.connect('led1:ZZ', 'uno:13')).toBe(false);
    expect(errors[0]).toMatch(/has no pin/);
  });

  it('rejects an unknown part', () => {
    expect(editor.connect('ghost:1', 'uno:13')).toBe(false);
    expect(errors[0]).toMatch(/no part with id/);
  });

  it('completes a wire across two pin clicks', () => {
    editor.clickPin('led1', 'C');
    expect(editor.pending).toEqual({ partId: 'led1', pin: 'C' });
    editor.clickPin('uno', 'GND.1');
    expect(editor.pending).toBeNull();
    expect(editor.value.connections).toHaveLength(2);
  });

  it('cancels when the same pin is clicked twice', () => {
    editor.clickPin('led1', 'C');
    editor.clickPin('led1', 'C');
    expect(editor.pending).toBeNull();
    expect(editor.value.connections).toHaveLength(1);
  });

  it('cancels an in-progress wire', () => {
    editor.clickPin('led1', 'C');
    editor.cancelWire();
    expect(editor.pending).toBeNull();
  });

  it('disconnects in either direction', () => {
    expect(editor.disconnect('led1:A', 'uno:13')).toBe(true);
    expect(editor.value.connections).toHaveLength(0);
  });

  it('reports a disconnect that matched nothing', () => {
    expect(editor.disconnect('led1:C', 'uno:2')).toBe(false);
  });

  it('deletes a wire by index', () => {
    expect(editor.deleteConnectionAt(0)).toBe(true);
    expect(editor.value.connections).toHaveLength(0);
    expect(editor.deleteConnectionAt(5)).toBe(false);
  });

  it('changes a wire colour', () => {
    editor.setWireColor(0, 'blue');
    expect(editor.value.connections[0][2]).toBe('blue');
  });
});

describe('DiagramEditor undo/redo', () => {
  let editor: DiagramEditor;

  beforeEach(() => {
    editor = new DiagramEditor(base());
  });

  it('starts with nothing to undo', () => {
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);
  });

  it('undoes an added part', () => {
    editor.addPart('wokwi-resistor');
    expect(editor.value.parts).toHaveLength(3);
    editor.undo();
    expect(editor.value.parts).toHaveLength(2);
  });

  it('redoes an undone change', () => {
    editor.addPart('wokwi-resistor');
    editor.undo();
    editor.redo();
    expect(editor.value.parts).toHaveLength(3);
  });

  it('undoes a delete, restoring wires', () => {
    editor.deletePart('led1');
    editor.undo();
    expect(editor.value.parts).toHaveLength(2);
    expect(editor.value.connections).toHaveLength(1);
  });

  it('undoes a move', () => {
    editor.movePart('led1', 999, 999);
    editor.undo();
    expect(editor.findPart('led1')).toMatchObject({ left: 100, top: 50 });
  });

  it('discards the redo stack after a new edit', () => {
    editor.addPart('wokwi-resistor');
    editor.undo();
    expect(editor.canRedo()).toBe(true);
    editor.addPart('wokwi-buzzer');
    expect(editor.canRedo()).toBe(false);
  });

  it('is a no-op when there is nothing to undo', () => {
    expect(() => editor.undo()).not.toThrow();
    expect(editor.value.parts).toHaveLength(2);
  });

  it('handles many undos in sequence', () => {
    for (let i = 0; i < 5; i++) editor.addPart('wokwi-led');
    expect(editor.value.parts).toHaveLength(7);
    for (let i = 0; i < 5; i++) editor.undo();
    expect(editor.value.parts).toHaveLength(2);
  });
});

describe('DiagramEditor replace', () => {
  it('replaces the diagram from the JSON view', () => {
    const editor = new DiagramEditor(base());
    const onChange = vi.fn();
    editor.replace({ version: 1, parts: [{ id: 'x', type: 'wokwi-led' }], connections: [] });
    expect(editor.value.parts).toHaveLength(1);
    void onChange;
  });

  it('clears a selection that no longer exists', () => {
    const editor = new DiagramEditor(base());
    editor.select('led1');
    editor.replace({ version: 1, parts: [], connections: [] });
    expect(editor.selected).toBeNull();
  });

  it('can be undone', () => {
    const editor = new DiagramEditor(base());
    editor.replace({ version: 1, parts: [], connections: [] });
    editor.undo();
    expect(editor.value.parts).toHaveLength(2);
  });
});

describe('setWireRoute', () => {
  function editorWithWire() {
    const changes: number[] = [];
    const errors: string[] = [];
    const editor = new DiagramEditor(
      {
        version: 1,
        parts: [
          { id: 'uno', type: 'wokwi-arduino-uno', left: 0, top: 0 },
          { id: 'led1', type: 'wokwi-led', left: 200, top: 100 },
        ],
        connections: [['uno:13', 'led1:A', 'green', []]],
      },
      { onChange: () => changes.push(1), onError: (m) => errors.push(m) },
    );
    return { editor, changes, errors };
  }

  it('stores the route on the wire', () => {
    const { editor } = editorWithWire();
    editor.setWireRoute(0, ['v19.2', 'h-9.6']);
    expect(editor.value.connections[0][3]).toEqual(['v19.2', 'h-9.6']);
  });

  it('records exactly one undo step per call', () => {
    // The drag reports once, on release; a route change is one edit, so one
    // undo must put the wire back the way it was.
    const { editor } = editorWithWire();
    editor.setWireRoute(0, ['v19.2']);
    editor.undo();
    expect(editor.value.connections[0][3]).toEqual([]);
  });

  it('rejects a route the router cannot parse, and says why', () => {
    const { editor, errors } = editorWithWire();
    editor.setWireRoute(0, ['sideways']);
    expect(editor.value.connections[0][3]).toEqual([]);
    expect(errors.length).toBe(1);
  });

  it('copies the route rather than aliasing the caller array', () => {
    const { editor } = editorWithWire();
    const route = ['v19.2'];
    editor.setWireRoute(0, route);
    route.push('h19.2');
    expect(editor.value.connections[0][3]).toEqual(['v19.2']);
  });

  it('ignores an index that is not a wire', () => {
    const { editor, changes } = editorWithWire();
    editor.setWireRoute(5, ['v10']);
    expect(changes).toEqual([]);
  });
});
