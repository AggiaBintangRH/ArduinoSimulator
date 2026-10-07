// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/parts/index.js';
import { Dashboard } from '../src/ui/dashboard.js';
import { starterProject } from '../src/ui/starter.js';
import { boardDefinitions, ARDUINO_UNO, ARDUINO_MEGA, findBoard } from '../src/mcu/boards.js';
import { Simulation } from '../src/sim/simulation.js';
import { serializeProject, deserializeProject } from '../src/storage.js';

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
}

describe('Dashboard', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('offers one card per board the simulator can run', () => {
    const el = host();
    new Dashboard(el, { onPick: () => {} });
    const cards = [...el.querySelectorAll<HTMLElement>('.board-card')];
    expect(cards.map((c) => c.dataset.boardType)).toEqual(
      boardDefinitions().map((b) => b.type),
    );
  });

  it('reports the board that was picked', () => {
    const el = host();
    const picked: string[] = [];
    new Dashboard(el, { onPick: (type) => picked.push(type) });
    el.querySelector<HTMLElement>(`[data-board-type="${ARDUINO_MEGA.type}"]`)!.click();
    expect(picked).toEqual([ARDUINO_MEGA.type]);
  });

  it('previews each board with the artwork the canvas uses', () => {
    const el = host();
    new Dashboard(el, { onPick: () => {} });
    for (const card of el.querySelectorAll('.board-card')) {
      const svg = card.querySelector('svg.board-preview');
      expect(svg).not.toBeNull();
      expect(svg!.innerHTML.length).toBeGreaterThan(50);
    }
  });

  it('gives its previews their own ids, so the canvas copy still paints', () => {
    // SVG resolves `url(#id)` document-wide and takes the first match. When the
    // preview kept the artwork's own ids it won that race, and because the
    // dashboard is hidden once a board is open, the canvas board's headers
    // resolved to a pattern in a non-rendered subtree and vanished.
    const el = host();
    new Dashboard(el, { onPick: () => {} });
    // The Mega is drawn without ids now, precisely so this cannot happen
    // again, but any artwork that does use them must still be namespaced.
    const ids = [...el.querySelectorAll('[id]')].map((e) => e.id);
    for (const id of ids) expect(id.startsWith('preview-')).toBe(true);
    for (const html of [...el.querySelectorAll('svg.board-preview')].map((s) => s.innerHTML)) {
      expect(html).not.toMatch(/url\(#(?!preview-)/);
    }
  });

  it('shows the real SRAM figure, not the CPU data-space allocation', () => {
    // avr8js is handed SRAM plus the extended I/O window; printing that as
    // memory would overstate the Mega by 256 bytes.
    const el = host();
    new Dashboard(el, { onPick: () => {} });
    const card = el.querySelector(`[data-board-type="${ARDUINO_MEGA.type}"]`)!;
    const values = [...card.querySelectorAll('dd')].map((d) => d.textContent);
    expect(values).toContain('8 KB');
    expect(values).toContain('256 KB');
    expect(values).toContain('atmega2560');
  });

  it('marks the board whose project is already saved', () => {
    const el = host();
    new Dashboard(el, { onPick: () => {}, savedBoardType: () => ARDUINO_UNO.type });
    const uno = el.querySelector(`[data-board-type="${ARDUINO_UNO.type}"]`)!;
    const mega = el.querySelector(`[data-board-type="${ARDUINO_MEGA.type}"]`)!;
    expect(uno.querySelector('.board-badge')).not.toBeNull();
    expect(mega.querySelector('.board-badge')).toBeNull();
  });

  it('re-reads the saved board on every render', () => {
    // The badge points at the card that resumes existing work, so it has to
    // follow the stored project rather than whatever was true at startup.
    const el = host();
    let saved = ARDUINO_UNO.type;
    const dashboard = new Dashboard(el, { onPick: () => {}, savedBoardType: () => saved });
    saved = ARDUINO_MEGA.type;
    dashboard.render();
    expect(el.querySelector(`[data-board-type="${ARDUINO_UNO.type}"] .board-badge`)).toBeNull();
    expect(
      el.querySelector(`[data-board-type="${ARDUINO_MEGA.type}"] .board-badge`),
    ).not.toBeNull();
  });
});

describe('starter projects', () => {
  for (const board of boardDefinitions()) {
    describe(board.label, () => {
      it('contains that board and nothing else that is a board', () => {
        const project = starterProject(board);
        expect(findBoard(project.diagram.parts)?.type).toBe(board.type);
      });

      it('builds and runs without errors', () => {
        const sim = new Simulation(starterProject(board).diagram);
        expect(sim.problems.filter((p) => p.severity === 'error')).toEqual([]);
        expect(sim.fqbn).toBe(board.fqbn);
        sim.dispose();
      });

      it('wires its LED to the built-in LED pin and a real ground', () => {
        const project = starterProject(board);
        const refs = project.diagram.connections.flatMap(([from, to]) => [from, to]);
        expect(refs).toContain(`board:${board.builtinLed}`);
        const ground = refs.find((r) => r.startsWith('board:GND'));
        expect(ground).toBeDefined();
        expect(board.pins).toContain(ground!.slice('board:'.length));
      });

      it('keeps the LED clear of the board artwork', () => {
        const project = starterProject(board);
        const boardPart = project.diagram.parts.find((p) => p.type === board.type)!;
        const led = project.diagram.parts.find((p) => p.id === 'led1')!;
        expect(led.left!).toBeGreaterThan(boardPart.left ?? 0);
      });

      it('round-trips through project serialization', () => {
        const project = starterProject(board);
        const back = deserializeProject(serializeProject(project));
        expect(back.diagram).toEqual(project.diagram);
        expect(back.sketch).toBe(project.sketch);
      });
    });
  }
});
