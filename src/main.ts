/**
 * Application entry point: wires the editor, canvas, simulation and serial
 * monitor into the page.
 */

import './parts/index.js';
import { parseDiagram, stringifyDiagram } from './diagram/parse.js';
import { DiagramCanvas } from './render/canvas.js';
import { DiagramEditor } from './editor/diagram-editor.js';
import { Simulation } from './sim/simulation.js';
import { SerialMonitor } from './sim/serial.js';
import { registeredTypes, getPartDefinition } from './sim/registry.js';
import { HttpCompiler, CachingCompiler, type Compiler } from './build/compiler.js';
import { EXAMPLES, DEFAULT_EXAMPLE } from './examples.js';
import {
  loadProject,
  saveProject,
  serializeProject,
  deserializeProject,
  projectFileName,
  type Project,
} from './storage.js';
import type { Diagram } from './diagram/types.js';
import type { PartEvent } from './sim/part.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

class App {
  private editor: DiagramEditor;
  private canvas: DiagramCanvas;
  private sim: Simulation | null = null;
  private serial = new SerialMonitor();
  private compiler: Compiler = new CachingCompiler(new HttpCompiler());
  private project: Project;
  private firmware: string | null = null;
  private simDirty = true;
  private statusTimer: number | null = null;

  // elements
  private sketchEl = $<HTMLTextAreaElement>('editor-sketch');
  private diagramEl = $<HTMLTextAreaElement>('editor-diagram');
  private buildLogEl = $<HTMLPreElement>('build-log');
  private serialOut = $<HTMLPreElement>('serial-output');
  private statusEl = $<HTMLElement>('status');
  private problemList = $<HTMLUListElement>('problem-list');
  private problemCount = $<HTMLElement>('problem-count');
  private inspector = $<HTMLElement>('inspector');

  constructor() {
    this.project = loadProject() ?? {
      name: DEFAULT_EXAMPLE.name,
      sketch: DEFAULT_EXAMPLE.sketch,
      diagram: structuredClone(DEFAULT_EXAMPLE.diagram),
      libraries: [],
    };

    this.editor = new DiagramEditor(this.project.diagram, {
      onChange: (d) => this.onDiagramChanged(d),
      onSelect: (id) => this.onSelect(id),
      onError: (msg) => this.setStatus(msg, 'error'),
    });

    this.canvas = new DiagramCanvas($('canvas-host'), {
      onPinClick: (partId, pin) => {
        this.editor.clickPin(partId, pin);
        if (!this.editor.pending) this.canvas.clearPendingWire();
      },
      onPartClick: (partId) => this.editor.select(partId),
      onBackgroundClick: () => {
        this.editor.cancelWire();
        this.canvas.clearPendingWire();
        this.editor.select(null);
      },
    });

    this.sketchEl.value = this.project.sketch;
    this.diagramEl.value = stringifyDiagram(this.project.diagram);
    this.canvas.setDiagram(this.editor.value);

    this.serial.onChange = () => this.renderSerial();

    this.installTabs();
    this.installToolbar();
    this.installKeyboard();
    this.installExamples();
    this.installPartPicker();
    this.checkCompiler();

    window.addEventListener('resize', () => this.canvas.resize());
    // Persist a little after edits settle rather than on every keystroke.
    window.setInterval(() => this.persist(), 3000);
  }

  // ---- state ---------------------------------------------------------

  private onDiagramChanged(diagram: Diagram): void {
    this.project.diagram = diagram;
    this.canvas.setDiagram(diagram);
    if (document.activeElement !== this.diagramEl) {
      this.diagramEl.value = stringifyDiagram(diagram);
    }
    this.simDirty = true;
    this.onSelect(this.editor.selected);
  }

  private persist(): void {
    this.project.sketch = this.sketchEl.value;
    saveProject(this.project);
  }

  private setStatus(text: string, kind: '' | 'running' | 'error' | 'busy' = ''): void {
    this.statusEl.textContent = text;
    this.statusEl.className = `status ${kind}`;
    if (this.statusTimer) window.clearTimeout(this.statusTimer);
    if (kind === 'error' || kind === '') {
      this.statusTimer = window.setTimeout(() => {
        if (!this.sim?.isRunning) {
          this.statusEl.textContent = 'idle';
          this.statusEl.className = 'status';
        }
      }, 4000);
    }
  }

  // ---- simulation ----------------------------------------------------

  /** Build a fresh Simulation from the current diagram. */
  private buildSimulation(): Simulation | null {
    this.sim?.dispose();
    const sim = new Simulation(this.editor.value);
    sim.onSerialByte = (b) => this.serial.writeByte(b);
    sim.onPartEvent = (id, event) => this.canvas.updatePartState(id, event);
    this.canvas.applyStates(sim.latestPartEvents as Map<string, PartEvent>);

    this.showProblems(sim.problems.map((p) => ({ severity: p.severity, message: p.message })));
    if (sim.hasErrors) {
      this.setStatus('diagram has errors', 'error');
      return null;
    }
    this.sim = sim;
    this.simDirty = false;
    return sim;
  }

  private start(): void {
    if (!this.firmware) {
      this.setStatus('compile or load a .hex first', 'error');
      return;
    }
    const sim = this.simDirty || !this.sim ? this.buildSimulation() : this.sim;
    if (!sim) return;

    try {
      sim.loadHexFirmware(this.firmware);
    } catch (e) {
      this.setStatus((e as Error).message, 'error');
      return;
    }

    this.serial.clear();
    sim.start();
    $<HTMLButtonElement>('btn-run').disabled = true;
    $<HTMLButtonElement>('btn-stop').disabled = false;
    this.setStatus('running', 'running');
    this.pollSpeed();
  }

  private stop(): void {
    this.sim?.pause();
    $<HTMLButtonElement>('btn-run').disabled = false;
    $<HTMLButtonElement>('btn-stop').disabled = true;
    this.setStatus('stopped');
  }

  /**
   * Show how close to realtime the simulation is running.
   * Under ~90% the machine cannot keep up, which is worth flagging.
   */
  private pollSpeed(): void {
    const tick = () => {
      if (!this.sim?.isRunning) return;
      const pct = Math.round(this.sim.speed * 100);
      this.statusEl.textContent = pct >= 90 ? 'running' : `running ${pct}% (slow)`;
      this.statusEl.className = pct >= 90 ? 'status running' : 'status busy';
      window.setTimeout(tick, 500);
    };
    window.setTimeout(tick, 500);
  }

  // ---- compiling -----------------------------------------------------

  private async checkCompiler(): Promise<void> {
    const status = await this.compiler.status();
    if (!status.available) {
      this.buildLogEl.textContent =
        `Sketch compilation is unavailable: ${status.reason ?? 'unknown reason'}.\n\n` +
        'Install arduino-cli and restart the dev server to build sketches here.\n' +
        'You can still run the simulator by loading a prebuilt .hex file.\n';
    } else {
      this.buildLogEl.textContent = `${status.version ?? 'arduino-cli'} ready.\n`;
    }
  }

  private async compile(): Promise<void> {
    this.persist();
    this.setStatus('compiling…', 'busy');
    this.showTab('build');
    this.buildLogEl.textContent = 'Compiling…\n';

    const result = await this.compiler.compile(this.sketchEl.value, {
      libraries: this.project.libraries,
    });

    this.buildLogEl.textContent = result.output || '(no compiler output)';
    this.showProblems(
      result.diagnostics.map((d) => ({
        severity: d.severity === 'error' ? 'error' : 'warning',
        message: `${d.file ? `${d.file.split(/[\\/]/).pop()}:${d.line}: ` : ''}${d.message}`,
      })),
    );

    if (result.ok && result.hex) {
      this.firmware = result.hex;
      this.setStatus(`compiled in ${result.durationMs ?? 0}ms`);
    } else {
      this.setStatus('compile failed', 'error');
    }
  }

  private loadHexFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      this.firmware = String(reader.result);
      this.setStatus(`loaded ${file.name}`);
      this.buildLogEl.textContent = `Loaded firmware from ${file.name}\n`;
    };
    reader.onerror = () => this.setStatus('could not read that file', 'error');
    reader.readAsText(file);
  }

  // ---- problems and serial -------------------------------------------

  private showProblems(problems: { severity: string; message: string }[]): void {
    this.problemList.replaceChildren();
    for (const p of problems) {
      const li = document.createElement('li');
      const sev = document.createElement('span');
      sev.className = `sev ${p.severity}`;
      sev.textContent = p.severity;
      const msg = document.createElement('span');
      msg.textContent = p.message;
      li.append(sev, msg);
      this.problemList.append(li);
    }
    const errors = problems.filter((p) => p.severity === 'error').length;
    this.problemCount.textContent = String(errors);
    this.problemCount.hidden = errors === 0;
  }

  private renderSerial(): void {
    const atBottom =
      this.serialOut.scrollHeight - this.serialOut.scrollTop - this.serialOut.clientHeight < 40;
    this.serialOut.textContent = this.serial.text;
    // Only auto-scroll when the user is already following the tail.
    if (atBottom) this.serialOut.scrollTop = this.serialOut.scrollHeight;
  }

  // ---- UI wiring -----------------------------------------------------

  private installTabs(): void {
    for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      tab.addEventListener('click', () => this.showTab(tab.dataset.tab!));
    }
    for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-serial-tab]')) {
      tab.addEventListener('click', () => {
        const which = tab.dataset.serialTab!;
        for (const t of document.querySelectorAll('[data-serial-tab]')) {
          t.classList.toggle('active', t === tab);
        }
        this.serialOut.hidden = which !== 'monitor';
        this.problemList.hidden = which !== 'problems';
      });
    }
  }

  private showTab(name: string): void {
    for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      tab.classList.toggle('active', tab.dataset.tab === name);
    }
    this.sketchEl.hidden = name !== 'sketch';
    this.diagramEl.hidden = name !== 'diagram';
    this.buildLogEl.hidden = name !== 'build';
  }

  private installToolbar(): void {
    $('btn-run').addEventListener('click', () => this.start());
    $('btn-stop').addEventListener('click', () => this.stop());
    $('btn-compile').addEventListener('click', () => void this.compile());
    $('btn-clear-serial').addEventListener('click', () => this.serial.clear());

    $<HTMLInputElement>('input-hex').addEventListener('change', (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (file) this.loadHexFile(file);
    });

    $('btn-export').addEventListener('click', () => this.exportProject());
    $<HTMLInputElement>('input-project').addEventListener('change', (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (file) void this.importProject(file);
    });

    // Applying the JSON view on blur avoids fighting the user mid-keystroke.
    this.diagramEl.addEventListener('blur', () => this.applyDiagramText());

    $('serial-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const input = $<HTMLInputElement>('serial-input');
      if (!this.sim) return;
      for (const byte of this.serial.encodeInput(input.value)) this.sim.writeSerialByte(byte);
      input.value = '';
    });

    $('inspector-close').addEventListener('click', () => this.editor.select(null));
  }

  private applyDiagramText(): void {
    try {
      const { diagram, diagnostics } = parseDiagram(this.diagramEl.value);
      this.editor.replace(diagram);
      this.showProblems(
        diagnostics.map((d) => ({ severity: d.severity, message: `${d.path}: ${d.message}` })),
      );
    } catch (e) {
      this.setStatus((e as Error).message, 'error');
      this.showProblems([{ severity: 'error', message: (e as Error).message }]);
    }
  }

  private installExamples(): void {
    const select = $<HTMLSelectElement>('select-example');
    select.append(new Option('Examples…', ''));
    for (const example of EXAMPLES) {
      select.append(new Option(example.name, example.id));
    }
    select.addEventListener('change', () => {
      const example = EXAMPLES.find((e) => e.id === select.value);
      select.value = '';
      if (!example) return;
      this.stop();
      this.project = {
        name: example.name,
        sketch: example.sketch,
        diagram: structuredClone(example.diagram),
        libraries: [],
      };
      this.sketchEl.value = example.sketch;
      this.editor.replace(this.project.diagram);
      this.firmware = null;
      this.setStatus(`loaded ${example.name}`);
    });
  }

  private installKeyboard(): void {
    document.addEventListener('keydown', (ev) => {
      const target = ev.target as HTMLElement;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable;

      // Ctrl/Cmd+Enter starts the simulation, matching Wokwi.
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        this.sim?.isRunning ? this.stop() : this.start();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        this.persist();
        this.setStatus('saved');
        return;
      }
      if (typing) return;

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        ev.shiftKey ? this.editor.redo() : this.editor.undo();
        return;
      }

      const selected = this.editor.selected;
      switch (ev.key.toLowerCase()) {
        case 'a':
          ev.preventDefault();
          $<HTMLDialogElement>('part-picker').showModal();
          break;
        case 'r':
          if (selected) this.editor.rotatePart(selected);
          break;
        case 'd':
          if (selected) this.editor.duplicatePart(selected);
          break;
        case 'delete':
        case 'backspace':
          if (selected) this.editor.deletePart(selected);
          break;
        case 'escape':
          this.editor.cancelWire();
          this.canvas.clearPendingWire();
          break;
      }
    });
  }

  private installPartPicker(): void {
    const dialog = $<HTMLDialogElement>('part-picker');
    const list = $<HTMLUListElement>('part-list');
    const search = $<HTMLInputElement>('part-search');

    const render = () => {
      const query = search.value.toLowerCase();
      list.replaceChildren();
      for (const type of registeredTypes()) {
        if (query && !type.toLowerCase().includes(query)) continue;
        const li = document.createElement('li');
        li.textContent = type;
        li.addEventListener('click', () => {
          this.editor.addPart(type, 320, 260);
          dialog.close();
        });
        list.append(li);
      }
    };

    search.addEventListener('input', render);
    dialog.addEventListener('close', () => {
      search.value = '';
    });
    dialog.addEventListener('show', render);
    render();
  }

  // ---- inspector -----------------------------------------------------

  private onSelect(partId: string | null): void {
    this.canvas.select(partId);
    if (!partId) {
      this.inspector.hidden = true;
      return;
    }
    const part = this.editor.findPart(partId);
    if (!part) {
      this.inspector.hidden = true;
      return;
    }

    this.inspector.hidden = false;
    $('inspector-title').textContent = `${part.id} · ${part.type}`;

    const body = $('inspector-body');
    body.replaceChildren();

    const def = getPartDefinition(part.type);
    const known = Object.keys(def?.defaults ?? {});
    const present = Object.keys(part.attrs ?? {});
    const names = [...new Set([...known, ...present])];

    for (const name of names) {
      const row = document.createElement('div');
      row.className = 'inspector-row';
      const label = document.createElement('label');
      label.textContent = name;
      const input = document.createElement('input');
      input.value = part.attrs?.[name] ?? def?.defaults?.[name] ?? '';
      input.addEventListener('change', () => {
        this.editor.setAttr(partId, name, input.value);
        // Live parts pick up attribute edits without a full rebuild where they
        // implement attrChanged; otherwise the next run applies them.
        this.sim?.parts.get(partId)?.part.attrChanged?.(name, input.value);
      });
      row.append(label, input);
      body.append(row);
    }

    // Interactive controls for parts that accept them while running.
    if (part.type.includes('pushbutton')) {
      this.addControlButton(body, partId, 'pressed');
    }
    if (part.type.includes('potentiometer')) {
      this.addSlider(body, partId, 'value', 0, 1023);
    }
    if (part.type === 'wokwi-slide-switch') {
      this.addControlButton(body, partId, 'value');
    }

    const actions = document.createElement('div');
    actions.className = 'inspector-actions';
    const rotate = document.createElement('button');
    rotate.textContent = 'Rotate';
    rotate.addEventListener('click', () => this.editor.rotatePart(partId));
    const remove = document.createElement('button');
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => this.editor.deletePart(partId));
    actions.append(rotate, remove);
    body.append(actions);
  }

  private addControlButton(host: HTMLElement, partId: string, control: string): void {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const label = document.createElement('label');
    label.textContent = control;
    const button = document.createElement('button');
    button.textContent = 'Toggle';
    let state = false;
    button.addEventListener('click', () => {
      state = !state;
      this.sim?.setControl(partId, control, state);
      button.textContent = state ? 'On' : 'Toggle';
    });
    row.append(label, button);
    host.append(row);
  }

  private addSlider(
    host: HTMLElement,
    partId: string,
    control: string,
    min: number,
    max: number,
  ): void {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const label = document.createElement('label');
    label.textContent = control;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.value = String(this.editor.findPart(partId)?.attrs?.[control] ?? min);
    input.addEventListener('input', () => {
      this.sim?.setControl(partId, control, Number(input.value));
    });
    row.append(label, input);
    host.append(row);
  }

  // ---- import / export -----------------------------------------------

  private exportProject(): void {
    this.persist();
    const blob = new Blob([serializeProject(this.project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = projectFileName(this.project.name);
    a.click();
    URL.revokeObjectURL(url);
  }

  private async importProject(file: File): Promise<void> {
    try {
      const project = deserializeProject(await file.text());
      this.stop();
      this.project = project;
      this.sketchEl.value = project.sketch;
      this.editor.replace(project.diagram);
      this.firmware = null;
      this.setStatus(`imported ${project.name}`);
    } catch (e) {
      this.setStatus((e as Error).message, 'error');
    }
  }
}

new App();
