/**
 * The dashboard: the first thing the app shows.
 *
 * For now it does one job - pick a board. Each card previews the board with
 * the same artwork the canvas draws, so what you choose is what you get.
 */

import { boardDefinitions, type BoardDefinition } from '../mcu/boards.js';
import { getVisual, withIdPrefix } from '../render/shapes.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface DashboardOptions {
  onPick: (boardType: string) => void;
  /**
   * Board type of the project already in storage, if any. Its card says so,
   * because picking it carries on with that work while picking another starts
   * fresh - the user should be able to see which is which.
   *
   * Read at render time, not once at construction: the stored project changes
   * as the user works, and a stale badge would point at the wrong card.
   */
  savedBoardType?: () => string | null;
}

/** Digital pins are the ones named as a bare number. */
function digitalPinCount(board: BoardDefinition): number {
  return board.pins.filter((name) => /^\d+$/.test(name)).length;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}

function boardSpecs(board: BoardDefinition): [string, string][] {
  const chip = board.chip;
  return [
    ['MCU', chip.name],
    ['Clock', `${board.defaultFrequencyHz / 1_000_000} MHz`],
    ['Flash', formatBytes(chip.flashBytes)],
    ['SRAM', formatBytes(chip.sramBytes)],
    ['Digital', `${digitalPinCount(board)} pins, ${board.pwmPins.length} PWM`],
    ['Analog', `${Object.keys(board.adcChannels).length} inputs`],
  ];
}

/** A scaled-down copy of the board artwork, for the card. */
function preview(board: BoardDefinition): SVGSVGElement {
  const visual = getVisual(board.type);
  const svg = document.createElementNS(SVG_NS, 'svg');
  const margin = 56;
  svg.setAttribute('viewBox', `${-margin} ${-margin} ${visual.width + margin * 2} ${visual.height + margin * 2}`);
  svg.setAttribute('class', 'board-preview');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${board.label} board`);
  // The canvas keeps the artwork's own ids; this copy takes prefixed ones so
  // the two do not collide in one document.
  svg.innerHTML = withIdPrefix(visual.body({}) + (visual.pinLabels?.() ?? ''), `preview-${board.type}-`);
  return svg;
}

export class Dashboard {
  private host: HTMLElement;
  private options: DashboardOptions;

  constructor(host: HTMLElement, options: DashboardOptions) {
    this.host = host;
    this.options = options;
    this.render();
  }

  render(): void {
    const saved = this.options.savedBoardType?.() ?? null;
    this.host.replaceChildren();
    for (const board of boardDefinitions()) {
      this.host.append(this.card(board, saved));
    }
  }

  private card(board: BoardDefinition, savedBoardType: string | null): HTMLElement {
    const card = document.createElement('button');
    card.className = 'board-card';
    card.type = 'button';
    card.dataset.boardType = board.type;

    const art = document.createElement('div');
    art.className = 'board-art';
    art.append(preview(board));

    const title = document.createElement('h3');
    title.textContent = board.label;

    const specs = document.createElement('dl');
    specs.className = 'board-specs';
    for (const [name, value] of boardSpecs(board)) {
      const dt = document.createElement('dt');
      dt.textContent = name;
      const dd = document.createElement('dd');
      dd.textContent = value;
      specs.append(dt, dd);
    }

    const footer = document.createElement('p');
    footer.className = 'board-footer';
    footer.textContent = board.fqbn;

    card.append(art, title, specs, footer);

    if (savedBoardType === board.type) {
      const badge = document.createElement('span');
      badge.className = 'board-badge';
      badge.textContent = 'Saved project';
      card.append(badge);
    }

    card.addEventListener('click', () => this.options.onPick(board.type));
    return card;
  }
}
