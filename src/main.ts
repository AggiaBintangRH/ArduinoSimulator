/**
 * Application entry point: wires the editor, canvas, simulation and serial
 * monitor into the page.
 */

import './parts/index.js';
import { parseDiagram, stringifyDiagram } from './diagram/parse.js';
import { DiagramCanvas } from './render/canvas.js';
import { getVisual, withIdPrefix, GRID } from './render/shapes.js';
import { DiagramEditor } from './editor/diagram-editor.js';
import { Simulation } from './sim/simulation.js';
import {
  BOARD_TYPES,
  boardDefinitions,
  findBoard,
  getBoardDefinition,
} from './mcu/boards.js';
import { Dashboard } from './ui/dashboard.js';
import { starterProject } from './ui/starter.js';
import { installSplitter } from './ui/splitter.js';
import { partLabel } from './ui/part-label.js';
import { swatchesFor, swatchColor } from './ui/palette.js';
import { createColorPicker } from './ui/color-picker.js';
import { SerialMonitor } from './sim/serial.js';
import { BuzzerAudio, isBuzzerEvent } from './ui/audio.js';
import { registeredTypes, getPartDefinition, pinLookup } from './sim/registry.js';
import { HttpCompiler, CachingCompiler, type Compiler } from './build/compiler.js';
import { HttpLibraryClient } from './build/libraries.js';
import { createLibraryManager, type LibraryManager } from './ui/library-manager.js';
import {
  addFile,
  removeFile,
  findFile,
  fileNameError,
  suggestFileName,
  MAIN_FILE,
} from './build/sketch-files.js';
import { EXAMPLES, DEFAULT_EXAMPLE } from './examples.js';
import {
  loadProject,
  saveProject,
  serializeProject,
  deserializeProject,
  projectFileName,
  saveView,
  loadView,
  saveLayout,
  loadLayout,
  saveMuted,
  loadMuted,
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
  private audio = new BuzzerAudio();
  /** Kept typed, so the cache can be dropped when the toolchain changes. */
  private buildCache = new CachingCompiler(new HttpCompiler());
  private compiler: Compiler = this.buildCache;
  private libraries: LibraryManager;
  private project: Project;
  private firmware: string | null = null;
  /**
   * Where the loaded firmware came from.
   *
   * Start builds the sketch first, so a `.hex` loaded from disk has to be
   * distinguishable from one this session compiled - otherwise pressing Start
   * would throw the loaded file away and rebuild over it.
   */
  private firmwareSource: 'sketch' | 'file' | null = null;
  /** True while a build is in flight, so Start cannot be pressed twice. */
  private building = false;
  private simDirty = true;
  private statusTimer: number | null = null;

  // elements
  private sketchEl = $<HTMLTextAreaElement>('editor-sketch');
  private fileEl = $<HTMLTextAreaElement>('editor-file');
  private diagramEl = $<HTMLTextAreaElement>('editor-diagram');
  private buildLogEl = $<HTMLPreElement>('build-log');
  private serialOut = $<HTMLPreElement>('serial-output');
  private statusEl = $<HTMLElement>('status');
  private problemList = $<HTMLUListElement>('problem-list');
  private problemCount = $<HTMLElement>('problem-count');
  private inspector = $<HTMLElement>('inspector');
  private dashboardEl = $<HTMLElement>('dashboard');
  private dashboard: Dashboard;
  /** Index of the wire the canvas has selected, if any. */
  private selectedWire: number | null = null;
  /** Diagram editing is locked while the simulation is running. */
  private diagramEditingEnabled = true;
  /** True while the inspector is writing an attribute, so it is not rebuilt. */
  private editingAttr = false;
  /** Keep the wire color picker mounted while it emits live color updates. */
  private editingWireColor = false;
  /**
   * Which tab the code pane is showing: a fixed one, or `file:<name>`.
   *
   * Held rather than read back off the DOM, because the tab strip is rebuilt
   * whenever a file is added or removed.
   */
  private activeTab = 'sketch';

  constructor() {
    this.project = loadProject() ?? {
      name: DEFAULT_EXAMPLE.name,
      sketch: DEFAULT_EXAMPLE.sketch,
      diagram: structuredClone(DEFAULT_EXAMPLE.diagram),
      libraries: [],
      files: structuredClone(DEFAULT_EXAMPLE.files ?? []),
    };

    this.editor = new DiagramEditor(this.project.diagram, {
      onChange: (d) => this.onDiagramChanged(d),
      onSelect: (id) => this.onSelect(id),
      onError: (msg) => this.setStatus(msg, 'error'),
    });

    this.canvas = new DiagramCanvas($('canvas-host'), {
      onPinClick: (partId, pin, at) => {
        if (!this.diagramEditingEnabled) return;
        this.editor.clickPin(partId, pin);
        this.canvas.setWiring(Boolean(this.editor.pending), at);
        if (!this.editor.pending) this.canvas.clearPendingWire();
      },
      onPartClick: () => {
        this.canvas.selectWire(null);
      },
      onPartsSelected: (partIds) => {
        this.editor.select(partIds.length === 1 ? partIds[0] : null);
      },
      onPartMoved: (partId, left, top) => {
        if (!this.sim?.isRunning) this.editor.movePart(partId, left, top);
      },
      onPartsMoved: (moves) => {
        if (!this.sim?.isRunning) this.editor.moveParts(moves);
      },
      onControl: (partId, control, value) => {
        // Pressing a control only means something while a simulation exists;
        // ignoring it quietly beats throwing at the user for clicking a board.
        if (!this.sim) return;
        this.sim.setControl(partId, control, value);
      },
      onBackgroundClick: () => {
        this.editor.cancelWire();
        this.canvas.clearPendingWire();
        this.editor.select(null);
        this.selectedWire = null;
      },
      onWireRouted: (index, route) => {
        if (!this.sim?.isRunning) this.editor.setWireRoute(index, route);
      },
      onWireBranch: (index, _from, at, splitRoutes, branchRoute) => {
        const source = this.editor.pending;
        if (!this.diagramEditingEnabled || !source) return;
        if (!this.editor.branchWireAt(index, source, at, splitRoutes, branchRoute)) {
          this.editor.cancelWire();
        }
      },
      onWireSelect: (index) => {
        // Selecting a wire clears the part selection, so the Delete key has
        // exactly one meaning at any moment.
        if (index !== null) this.editor.select(null);
        this.selectedWire = index;
        if (index === null) this.inspector.hidden = true;
        else this.renderWireInspector(index);
      },
    });

    this.sketchEl.value = this.project.sketch;
    // Editing the sketch means the sketch is what should run, even if a .hex
    // was loaded from disk earlier - otherwise Start would keep running the
    // old file and the edits would look like they did nothing.
    this.sketchEl.addEventListener('input', () => {
      if (this.firmwareSource === 'file') this.firmwareSource = null;
    });
    /*
     * Edits to a header land in the project as they are typed, the same way
     * the sketch does. Waiting until the tab is switched would lose whatever
     * was typed last if the build ran first - and the build is what reads it.
     */
    this.fileEl.addEventListener('input', () => {
      this.flushOpenFile();
      if (this.firmwareSource === 'file') this.firmwareSource = null;
    });
    this.diagramEl.value = stringifyDiagram(this.project.diagram);
    this.canvas.setDiagram(this.editor.value);

    this.serial.onChange = () => this.renderSerial();

    this.installTabs();
    this.installSplitters();
    this.installToolbar();
    this.installKeyboard();
    this.installExamples();
    this.installPartPicker();
    this.installFileAdder();
    this.libraries = this.installLibraries();
    this.checkCompiler();

    this.dashboard = new Dashboard($('board-grid'), {
      onPick: (boardType) => {
        if (this.diagramEditingEnabled) this.openBoard(boardType);
      },
      savedBoardType: () => findBoard(loadProject()?.diagram.parts ?? [])?.type ?? null,
    });

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
    // The inspector reflects edits made elsewhere - the JSON view, undo - but
    // not the ones it made itself; see `setAttr`.
    if (!this.editingAttr && !this.editingWireColor) {
      if (this.editor.selected) this.onSelect(this.editor.selected);
      else if (this.selectedWire !== null) this.renderWireInspector(this.selectedWire);
      else this.onSelect(null);
    }
  }

  private persist(): void {
    this.project.sketch = this.sketchEl.value;
    this.flushOpenFile();
    saveProject(this.project);
  }

  /** Copy the open file's text back into the project. */
  private flushOpenFile(): void {
    const name = this.fileEl.dataset.name;
    if (!name) return;
    const file = findFile(this.project.files, name);
    if (file) file.content = this.fileEl.value;
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

  /** Lock every diagram-changing control while leaving simulation inputs active. */
  private setDiagramEditingEnabled(enabled: boolean): void {
    this.diagramEditingEnabled = enabled;
    this.canvas.setEditingEnabled(enabled);
    this.diagramEl.readOnly = !enabled;
    this.diagramEl.setAttribute('aria-readonly', String(!enabled));
    this.updateDiagramEditControls();
  }

  private updateDiagramEditControls(): void {
    const controls = document.querySelectorAll<HTMLElement>('[data-diagram-edit]');
    for (const root of controls) {
      const descendants = root.querySelectorAll<HTMLElement>('button, input, select, textarea');
      const candidates = root.matches('button, input, select, textarea')
        ? [root, ...descendants]
        : [...descendants];
      for (const control of candidates) {
        if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement ||
            control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
          control.disabled = !this.diagramEditingEnabled;
        }
      }
    }
  }

  // ---- simulation ----------------------------------------------------

  /** Build a fresh Simulation from the current diagram. */
  private buildSimulation(): Simulation | null {
    this.sim?.dispose();
    this.audio.stopAll();
    const sim = new Simulation(this.editor.value);
    sim.onSerialByte = (b) => this.serial.writeByte(b);
    sim.onPartEvent = (id, event) => {
      this.canvas.updatePartState(id, event);
      // A buzzer reports the tone it measures; this is what turns that into a
      // sound. Without it the part drew its rings in silence.
      if (isBuzzerEvent(event)) this.audio.update(id, event);
    };
    sim.onProblem = (problem) => {
      // A failure mid-run must stop the UI claiming it is still running.
      this.setStatus(problem.message, 'error');
      this.setDiagramEditingEnabled(true);
      this.showProblems(
        sim.problems.map((p) => ({ severity: p.severity, message: p.message })),
      );
      $<HTMLButtonElement>('btn-run').disabled = false;
      $<HTMLButtonElement>('btn-stop').disabled = true;
      // A run that failed mid-way must not leave a tone sounding.
      this.audio.stopAll();
    };
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

  /**
   * Build the sketch and run it.
   *
   * There is no separate compile step: pressing Start is the whole loop. The
   * compiler caches successful builds by source, board and libraries, so
   * starting again without editing anything does not rebuild.
   */
  private async start(): Promise<void> {
    if (this.building) return;
    // Firmware loaded from disk is run as it is; there is no sketch to build.
    if (this.firmwareSource !== 'file') {
      const runButton = $<HTMLButtonElement>('btn-run');
      this.building = true;
      runButton.disabled = true;
      try {
        if (!(await this.compile())) return;
      } finally {
        this.building = false;
        runButton.disabled = false;
      }
    }
    if (!this.firmware) {
      this.setStatus('nothing to run - build failed and no .hex is loaded', 'error');
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
    // Started from the click, not on load: a browser will not play sound until
    // the person has interacted with the page, so a context made any earlier
    // starts suspended and the first note of the sketch is lost.
    this.audio.resume();
    sim.start();
    this.setDiagramEditingEnabled(false);
    $<HTMLButtonElement>('btn-run').disabled = true;
    $<HTMLButtonElement>('btn-stop').disabled = false;
    this.setStatus('running', 'running');
    this.pollSpeed();
  }

  private stop(): void {
    this.sim?.pause();
    this.setDiagramEditingEnabled(true);
    // A paused simulation must not go on humming.
    this.audio.stopAll();
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
      // Browsers clamp timers to about 1/second in a hidden tab, which stalls
      // the run loop. Say so, rather than blaming the machine for being slow.
      if (document.hidden) {
        this.statusEl.textContent = 'running (background)';
        this.statusEl.className = 'status busy';
      } else {
        const pct = Math.round(this.sim.speed * 100);
        this.statusEl.textContent = pct >= 90 ? 'running' : `running ${pct}% (slow)`;
        this.statusEl.className = pct >= 90 ? 'status running' : 'status busy';
      }
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

  /** Returns true when the build produced firmware to run. */
  private async compile(): Promise<boolean> {
    this.persist();
    this.setStatus('compiling…', 'busy');
    this.showTab('build');
    // Compile for whichever board the diagram actually contains, or the
    // compiler would silently build Uno code for a Mega sketch.
    const board = findBoard(this.editor.value.parts);
    this.buildLogEl.textContent = `Compiling for ${board?.label ?? 'Arduino Uno'}…\n`;

    const result = await this.compiler.compile(this.sketchEl.value, {
      fqbn: board?.fqbn,
      libraries: this.project.libraries,
      files: this.project.files,
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
      this.firmwareSource = 'sketch';
      this.setStatus(`built in ${result.durationMs ?? 0}ms`);
      return true;
    }
    this.setStatus('build failed', 'error');
    return false;
  }

  private loadHexFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      this.firmware = String(reader.result);
      this.firmwareSource = 'file';
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
    this.renderTabs();
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

  /**
   * Draw the tab strip from the project.
   *
   * A sketch is a directory, so the list is not fixed: `sketch.ino`, then
   * whatever files the project holds, then the two views that are not files.
   */
  private renderTabs(): void {
    const strip = $('code-tabs');
    const addButton = $('btn-add-file');
    for (const old of [...strip.children]) {
      if (old !== addButton) old.remove();
    }

    const tab = (id: string, label: string): HTMLButtonElement => {
      const button = document.createElement('button');
      button.className = 'tab';
      button.dataset.tab = id;
      button.textContent = label;
      button.classList.toggle('active', id === this.activeTab);
      button.addEventListener('click', () => this.showTab(id));
      return button;
    };

    strip.insertBefore(tab('sketch', MAIN_FILE), addButton);
    for (const file of this.project.files) {
      const id = `file:${file.name}`;
      /*
       * The tab and its close button are separate controls in one wrapper: a
       * button inside a button is not valid HTML, and a close that also
       * selected the tab would leave the pane showing a file just removed.
       */
      const wrap = document.createElement('span');
      wrap.className = 'tab-wrap';
      wrap.classList.toggle('active', id === this.activeTab);
      const close = document.createElement('button');
      close.className = 'tab-close';
      close.type = 'button';
      close.textContent = '\u00d7';
      close.title = `Remove ${file.name}`;
      close.setAttribute('aria-label', `Remove ${file.name}`);
      close.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.removeSketchFile(file.name);
      });
      wrap.append(tab(id, file.name), close);
      strip.insertBefore(wrap, addButton);
    }
    strip.insertBefore(tab('diagram', 'diagram.json'), addButton);
    strip.insertBefore(tab('build', 'Build log'), addButton);
  }

  private showTab(name: string): void {
    this.activeTab = name;
    for (const tab of document.querySelectorAll<HTMLButtonElement>('#code-tabs [data-tab]')) {
      const on = tab.dataset.tab === name;
      tab.classList.toggle('active', on);
      const wrap = tab.parentElement;
      if (wrap?.classList.contains('tab-wrap')) wrap.classList.toggle('active', on);
    }
    const file = name.startsWith('file:') ? findFile(this.project.files, name.slice(5)) : undefined;
    if (file && this.fileEl.dataset.name !== file.name) {
      // Only written on a switch: assigning during editing would put the caret
      // back at the end on every keystroke.
      this.fileEl.value = file.content;
      this.fileEl.dataset.name = file.name;
    }
    this.sketchEl.hidden = name !== 'sketch';
    this.fileEl.hidden = !file;
    this.diagramEl.hidden = name !== 'diagram';
    this.buildLogEl.hidden = name !== 'build';
  }

  /**
   * Add a file to the sketch and open it.
   *
   * The name is checked here as well as on the way to the toolchain: this one
   * is what the user sees, the other is what keeps a name from becoming a
   * path on disk.
   */
  private addSketchFile(name: string, content = ''): string | null {
    const problem = fileNameError(name, this.project.files);
    if (problem) return problem;
    const clean = name.trim();
    this.project.files = addFile(this.project.files, clean, content);
    this.persist();
    this.renderTabs();
    this.showTab(`file:${clean}`);
    this.setStatus(`added ${clean}`);
    return null;
  }

  private removeSketchFile(name: string): void {
    if (!window.confirm(`Remove ${name} from this sketch?`)) return;
    this.project.files = removeFile(this.project.files, name);
    // The pane cannot go on showing a file that is no longer in the sketch.
    if (this.activeTab === `file:${name}`) {
      this.activeTab = 'sketch';
      this.fileEl.dataset.name = '';
    }
    this.persist();
    this.renderTabs();
    this.showTab(this.activeTab);
    this.setStatus(`removed ${name}`);
  }

  /**
   * Make the editor and the serial monitor draggable.
   *
   * Both keep their size across reloads: someone who works with a wide canvas
   * and a tall log should not have to set that up again every visit.
   */
  private installSplitters(): void {
    const layout = document.querySelector<HTMLElement>('.layout')!;
    const code = document.querySelector<HTMLElement>('.pane-code')!;
    const serial = $('serial-pane');
    const saved = loadLayout();
    /** Enough canvas left to be worth looking at, whatever the editor does. */
    const CANVAS_MIN = 240;
    const CHROME_MIN = 220;

    const setCode = (px: number) => {
      layout.style.setProperty('--code-width', `${Math.round(px)}px`);
      saveLayout({ ...loadLayout(), codeWidth: Math.round(px) });
    };
    const setSerial = (px: number) => {
      document.body.style.setProperty('--serial-height', `${Math.round(px)}px`);
      saveLayout({ ...loadLayout(), serialHeight: Math.round(px) });
    };

    if (saved.codeWidth !== undefined) {
      layout.style.setProperty('--code-width', `${saved.codeWidth}px`);
    }
    if (saved.serialHeight !== undefined) {
      document.body.style.setProperty('--serial-height', `${saved.serialHeight}px`);
    }

    installSplitter($('split-code'), {
      axis: 'x',
      grow: 1,
      size: () => code.getBoundingClientRect().width,
      apply: setCode,
      max: () => layout.getBoundingClientRect().width - CANVAS_MIN,
      reset: Math.round(layout.getBoundingClientRect().width * 0.38),
      onChange: () => this.canvas.resize(),
    });

    installSplitter($('split-serial'), {
      axis: 'y',
      // The handle sits above the pane, so dragging up - towards smaller y -
      // is what makes the log taller.
      grow: -1,
      size: () => serial.getBoundingClientRect().height,
      apply: setSerial,
      max: () => window.innerHeight - CHROME_MIN,
      reset: 200,
      onChange: () => this.canvas.resize(),
    });
  }

  private installToolbar(): void {
    $('btn-dashboard').addEventListener('click', () => this.showDashboard());
    $('btn-run').addEventListener('click', () => void this.start());
    $('btn-stop').addEventListener('click', () => this.stop());
    $('btn-clear-serial').addEventListener('click', () => this.serial.clear());

    $<HTMLInputElement>('input-hex').addEventListener('change', (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (file) this.loadHexFile(file);
    });

    const mute = $<HTMLButtonElement>('btn-mute');
    const showMuted = (muted: boolean) => {
      this.audio.setMuted(muted);
      mute.setAttribute('aria-pressed', String(muted));
      mute.title = muted ? 'Unmute the buzzer' : 'Mute the buzzer';
      mute.querySelector('.icon')!.textContent = muted ? '\u{1F507}' : '\u{1F50A}';
      mute.classList.toggle('muted', muted);
    };
    showMuted(loadMuted());
    mute.addEventListener('click', () => {
      const muted = mute.getAttribute('aria-pressed') !== 'true';
      saveMuted(muted);
      showMuted(muted);
    });

    $('btn-libraries').addEventListener('click', () => {
      const dialog = $<HTMLDialogElement>('library-manager');
      dialog.showModal();
      // Asked for on opening rather than at startup: the answer comes from
      // running arduino-cli, and it can change while the app is open.
      void this.libraries.refresh();
    });

    $('btn-export').addEventListener('click', () => this.exportProject());
    const projectInput = $<HTMLInputElement>('input-project');
    projectInput.dataset.diagramEdit = 'true';
    projectInput.addEventListener('change', (ev) => {
      if (!this.diagramEditingEnabled) return;
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

    $('inspector-close').addEventListener('click', () => {
      this.canvas.selectWire(null);
      this.editor.select(null);
    });
  }

  /**
   * The Libraries dialog.
   *
   * The project's list is the source of truth for what the sketch needs; the
   * dialog reads and writes it, and a change there is a change to the project
   * like any other, so it is saved and it invalidates the build cache.
   */
  private installLibraries(): LibraryManager {
    return createLibraryManager({
      root: $('library-manager'),
      client: new HttpLibraryClient(),
      libraries: () => this.project.libraries,
      onInstalledChange: () => {
        // A cached build was made against the libraries as they were. Once
        // that set changes, the cached firmware is an answer to a different
        // question - including the one where the library is now gone.
        this.buildCache.clear();
      },
      onChange: (libraries) => {
        this.project.libraries = libraries;
        this.persist();
        // The compiler caches on the library list, so this is what makes the
        // next Start actually rebuild against the library just installed.
        this.setStatus(
          libraries.length === 0
            ? 'no extra libraries'
            : `${libraries.length} librar${libraries.length === 1 ? 'y' : 'ies'} in this project`,
        );
      },
    });
  }

  private applyDiagramText(): void {
    if (!this.diagramEditingEnabled) return;
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
    select.dataset.diagramEdit = 'true';
    select.append(new Option('Examples…', ''));
    for (const example of EXAMPLES) {
      select.append(new Option(example.name, example.id));
    }
    select.addEventListener('change', () => {
      const example = EXAMPLES.find((e) => e.id === select.value);
      select.value = '';
      if (!example) return;
      this.applyProject({
        name: example.name,
        sketch: example.sketch,
        diagram: structuredClone(example.diagram),
        libraries: [],
        files: structuredClone(example.files ?? []),
      });
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
        if (this.sim?.isRunning) this.stop();
        else void this.start();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        this.persist();
        this.setStatus('saved');
        return;
      }
      if (typing) return;

      const key = ev.key.toLowerCase();
      if (!this.diagramEditingEnabled &&
          (((ev.ctrlKey || ev.metaKey) && key === 'z') ||
            key === 'r' || key === 'd' || key === 'delete' || key === 'backspace')) {
        return;
      }

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        ev.shiftKey ? this.editor.redo() : this.editor.undo();
        return;
      }

      const selected = this.editor.selected;
      const selectedParts = this.canvas.selectedPartIds;
      switch (ev.key.toLowerCase()) {
        case 'r':
          if (selectedParts.length > 1) this.editor.rotateParts(selectedParts);
          else if (selected) this.editor.rotatePart(selected);
          break;
        case 'd':
          if (selected) this.editor.duplicatePart(selected);
          break;
        case 'delete':
        case 'backspace':
          if (selectedParts.length > 1) {
            this.editor.deleteParts(selectedParts);
            this.canvas.selectParts([]);
          } else if (selected) {
            this.editor.deletePart(selected);
          } else if (this.selectedWire !== null) {
            this.editor.deleteConnectionAt(this.selectedWire);
            this.canvas.selectWire(null);
            this.selectedWire = null;
          }
          break;
        case 'escape':
          this.editor.cancelWire();
          this.canvas.clearPendingWire();
          this.editor.select(null);
          this.canvas.selectParts([]);
          this.canvas.selectWire(null);
          this.selectedWire = null;
          break;
      }
    });
  }

  /**
   * Somewhere to drop a new part: the middle of the view, on the grid, stepped
   * diagonally until it is not on top of something already there.
   *
   * Adding two parts in a row otherwise puts the second exactly on the first,
   * which looks like the second one never arrived.
   */
  private freeSpot(): [number, number] {
    const taken = new Set(
      this.editor.value.parts.map((part) => `${part.left ?? 0},${part.top ?? 0}`),
    );
    const at = this.canvas.snap(this.canvas.viewportCenter());
    // Bounded, so a diagram that somehow fills every step cannot hang here.
    for (let step = 0; step < 200; step++) {
      const x = at.x + step * GRID;
      const y = at.y + step * GRID;
      if (!taken.has(`${x},${y}`)) return [x, y];
    }
    return [at.x, at.y];
  }

  private installPartPicker(): void {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    /**
     * A thumbnail of the part, drawn with the same artwork the canvas uses.
     *
     * `viewBox` does the scaling, so a 832px board and a 20px LED both come
     * out the same size in the list.
     */
    const partIcon = (type: string): SVGSVGElement => {
      const visual = getVisual(type, pinLookup(type) ?? []);
      const svg = document.createElementNS(SVG_NS, 'svg');
      const margin = visual.pinLabels ? 56 : 0;
      svg.setAttribute('viewBox', `${-margin} ${-margin} ${visual.width + margin * 2} ${visual.height + margin * 2}`);
      svg.setAttribute('class', 'part-icon');
      svg.setAttribute('aria-hidden', 'true');
      // Prefixed ids, as on the dashboard: several copies of one artwork on a
      // page would otherwise fight over a `url(#…)` lookup.
      svg.innerHTML = withIdPrefix(visual.body({}) + (visual.pinLabels?.() ?? ''), `pick-${type}-`);
      return svg;
    };

    const dialog = $<HTMLDialogElement>('part-picker');
    const list = $<HTMLUListElement>('part-list');
    const search = $<HTMLInputElement>('part-search');

    const render = () => {
      const query = search.value.toLowerCase();
      list.replaceChildren();
      // Boards live outside the part registry, but the picker is the only way
      // to get one into a diagram without hand-editing the JSON.
      const types = [...boardDefinitions().map((b) => b.type), ...registeredTypes()].sort();
      for (const type of types) {
        const name = partLabel(type);
        // Search both, so someone who knows the diagram.json name still finds
        // it after the menu stopped showing that name.
        if (query && !`${type} ${name}`.toLowerCase().includes(query)) continue;
        const li = document.createElement('li');
        li.append(partIcon(type));
        const label = document.createElement('span');
        label.className = 'part-name';
        label.textContent = name;
        li.append(label);
        // The exact type is what diagram.json wants; keep it reachable.
        li.title = type;
        li.addEventListener('click', () => {
          if (!this.diagramEditingEnabled) return;
          this.editor.addPart(type, ...this.freeSpot());
          dialog.close();
        });
        list.append(li);
      }
    };

    search.addEventListener('input', render);
    dialog.addEventListener('close', () => {
      search.value = '';
    });

    // `show` is not an event a dialog fires, so the list was only ever built
    // at startup. Rebuild it when the picker is opened instead.
    const addPartButton = $<HTMLButtonElement>('btn-add-part');
    addPartButton.dataset.diagramEdit = 'true';
    addPartButton.addEventListener('click', () => {
      if (!this.diagramEditingEnabled) return;
      render();
      dialog.showModal();
      search.focus();
    });
    render();
  }

  /**
   * The "add a file" dialog.
   *
   * Two ways in, because there are two situations: typing a name for a header
   * about to be written, and picking one that already exists on disk.
   */
  private installFileAdder(): void {
    const dialog = $<HTMLDialogElement>('file-adder');
    const form = $<HTMLFormElement>('file-form');
    const name = $<HTMLInputElement>('file-name');
    const error = $('file-error');
    const upload = $<HTMLInputElement>('input-sketch-file');

    const fail = (message: string) => {
      error.textContent = message;
      name.focus();
    };

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      // "pitches" means pitches.h: a bare word is not a source file, and a
      // header is what an extra file nearly always is.
      const problem = this.addSketchFile(suggestFileName(name.value));
      if (problem) fail(problem);
      else dialog.close();
    });

    $('btn-file-cancel').addEventListener('click', () => dialog.close());

    upload.addEventListener('change', () => {
      const file = upload.files?.[0];
      // Cleared so picking the same file twice still counts as a change.
      upload.value = '';
      if (!file) return;
      const problem = fileNameError(file.name, this.project.files);
      if (problem) {
        fail(problem);
        return;
      }
      void file.text().then((text) => {
        const failed = this.addSketchFile(file.name, text);
        if (failed) fail(failed);
        else dialog.close();
      });
    });

    $('btn-add-file').addEventListener('click', () => {
      name.value = '';
      error.textContent = '';
      dialog.showModal();
      name.focus();
    });
  }

  // ---- inspector -----------------------------------------------------

  /**
   * Write an attribute, and let a running part know.
   *
   * Live parts pick up edits without a full rebuild where they implement
   * `attrChanged`; otherwise the next run applies them.
   */
  private setAttr(partId: string, name: string, value: string): void {
    if (!this.diagramEditingEnabled) return;
    /*
     * Rebuilding the inspector here would tear out the control being used.
     * A colour wheel dragged for a second writes dozens of times, and every
     * one of them replaced the wheel under the pointer - so the drag carried
     * on against a detached element and read nonsense out of its zero-sized
     * box. The same rebuild also took the caret out of a text field mid-edit.
     */
    this.editingAttr = true;
    try {
      this.editor.setAttr(partId, name, value);
    } finally {
      this.editingAttr = false;
    }
    this.sim?.parts.get(partId)?.part.attrChanged?.(name, value);
  }

  /**
   * A colour attribute, as swatches rather than a name to spell.
   *
   * The colour is the thing being chosen, so the control shows colours; the
   * name is on each swatch as its tooltip and its accessible label, for
   * anyone who does need to know what it is called.
   */
  private colorField(
    partId: string,
    name: string,
    value: string,
    choices: string[],
  ): HTMLElement {
    const field = document.createElement('div');
    field.className = 'color-field';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'swatch color-trigger';
    trigger.style.background = swatchColor(value);
    trigger.title = value;
    trigger.setAttribute('aria-label', `${name}: ${value}`);
    trigger.setAttribute('aria-expanded', 'false');

    const popover = document.createElement('div');
    popover.className = 'color-popover';
    popover.hidden = true;
    popover.append(
      createColorPicker({
        value,
        presets: choices,
        onChange: (hex) => {
          this.setAttr(partId, name, hex);
          trigger.style.background = hex;
          trigger.title = hex;
          trigger.setAttribute('aria-label', `${name}: ${hex}`);
        },
      }),
    );

    /*
     * The panel is positioned against the viewport, not the inspector.
     * The inspector scrolls its own contents, and an absolutely positioned
     * child of a scrolling box is clipped by it - which cut the wheel in half
     * and hid the hex box entirely.
     */
    const place = () => {
      const at = trigger.getBoundingClientRect();
      const size = popover.getBoundingClientRect();
      const margin = 8;
      const below = at.bottom + 6;
      const room = window.innerHeight - below - margin;
      const top = room >= size.height ? below : Math.max(margin, at.top - 6 - size.height);
      const left = Math.min(
        Math.max(margin, at.right - size.width),
        window.innerWidth - size.width - margin,
      );
      popover.style.top = `${Math.round(top)}px`;
      popover.style.left = `${Math.round(left)}px`;
    };

    const close = () => {
      popover.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('resize', place);
    };
    // A press anywhere else puts the wheel away. Capture, so it still fires
    // when the press lands on something that stops propagation.
    const onOutside = (ev: Event) => {
      if (!field.contains(ev.target as Node)) close();
    };
    trigger.addEventListener('click', () => {
      if (popover.hidden) {
        popover.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        // Measured after it is shown; a hidden element has no size.
        place();
        document.addEventListener('pointerdown', onOutside, true);
        window.addEventListener('resize', place);
      } else {
        close();
      }
    });
    field.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !popover.hidden) {
        close();
        trigger.focus();
      }
    });

    field.append(trigger, popover);
    return field;
  }

  private onSelect(partId: string | null): void {
    // A multi-selection has no single inspector target; preserve its canvas
    // highlight while the editor clears its single-part selection.
    if (partId !== null || this.canvas.selectedPartIds.length <= 1) this.canvas.select(partId);
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
      row.dataset.diagramEdit = 'true';
      const label = document.createElement('label');
      label.textContent = name;
      const value = part.attrs?.[name] ?? def?.defaults?.[name] ?? '';

      const swatches = swatchesFor(part.type, name);
      row.append(label, swatches ? this.colorField(partId, name, value, swatches) : (() => {
        const input = document.createElement('input');
        input.value = value;
        input.addEventListener('change', () => this.setAttr(partId, name, input.value));
        return input;
      })());
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
    if (part.type === 'wokwi-hc-sr04') {
      this.addSlider(body, partId, 'distance', 2, 400);
    }
    if (part.type === 'wokwi-dht22') {
      this.addSlider(body, partId, 'temperature', -40, 80);
      this.addSlider(body, partId, 'humidity', 0, 100);
    }
    if (part.type === 'wokwi-servo') {
      this.addSlider(body, partId, 'angle', 0, 180);
    }
    if (BOARD_TYPES.has(part.type)) {
      // The board's reset button is clickable on the artwork; this is the
      // same control, reachable by keyboard.
      this.addMomentaryButton(body, partId, 'reset');
    }

    const actions = document.createElement('div');
    actions.className = 'inspector-actions';
    actions.dataset.diagramEdit = 'true';
    const rotate = document.createElement('button');
    rotate.textContent = 'Rotate';
    rotate.addEventListener('click', () => this.editor.rotatePart(partId));
    const remove = document.createElement('button');
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => this.editor.deletePart(partId));
    actions.append(rotate, remove);
    body.append(actions);
    this.updateDiagramEditControls();
  }

  private renderWireInspector(index: number): void {
    const wire = this.editor.value.connections[index];
    if (!wire) {
      this.inspector.hidden = true;
      return;
    }

    const [from, to, color] = wire;
    this.inspector.hidden = false;
    $('inspector-title').textContent = `Wire · ${from} → ${to}`;
    const body = $('inspector-body');
    body.replaceChildren();

    const row = document.createElement('div');
    row.className = 'inspector-row';
    row.dataset.diagramEdit = 'true';
    const label = document.createElement('label');
    label.textContent = 'Color';
    const field = document.createElement('div');
    field.className = 'color-field';
    field.append(
      createColorPicker({
        value: color,
        presets: swatchesFor('wire', 'color') ?? [],
        onChange: (nextColor) => {
          if (!this.diagramEditingEnabled) return;
          this.editingWireColor = true;
          try {
            this.editor.setWireColor(index, nextColor);
          } finally {
            this.editingWireColor = false;
          }
        },
      }),
    );
    row.append(label, field);
    body.append(row);
    this.updateDiagramEditControls();
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

  /** A button that holds its control down only while it is pressed. */
  private addMomentaryButton(host: HTMLElement, partId: string, control: string): void {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const label = document.createElement('label');
    label.textContent = control;
    const button = document.createElement('button');
    button.textContent = 'Press';
    const press = () => this.sim?.setControl(partId, control, true);
    const release = () => this.sim?.setControl(partId, control, false);
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointerleave', release);
    // Keyboard users get a press and an immediate release.
    button.addEventListener('keyup', (ev) => {
      if (ev.key === ' ' || ev.key === 'Enter') {
        press();
        release();
      }
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
    const part = this.editor.findPart(partId);
    const defaultValue = getPartDefinition(part?.type ?? '')?.defaults?.[control];
    input.value = String(part?.attrs?.[control] ?? defaultValue ?? min);
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
    if (!this.diagramEditingEnabled) return;
    try {
      const project = deserializeProject(await file.text());
      this.applyProject(project);
      this.setStatus(`imported ${project.name}`);
    } catch (e) {
      this.setStatus((e as Error).message, 'error');
    }
  }

  /** Swap the whole working project out: stops the run and drops firmware. */
  private applyProject(project: Project): void {
    if (!this.diagramEditingEnabled) return;
    this.stop();
    this.project = project;
    this.sketchEl.value = project.sketch;
    // A different project has different files, so the strip is rebuilt and the
    // pane goes back to the sketch rather than to a tab that is now gone.
    this.fileEl.dataset.name = '';
    this.renderTabs();
    this.showTab('sketch');
    this.editor.replace(project.diagram);
    this.firmware = null;
    this.firmwareSource = null;
    this.serial.clear();
    // Frame whatever just arrived. Boards differ in size by more than 2x, so
    // a fixed starting zoom shows a Mega cut in half.
    this.canvas.fitToContent();
  }

  // ---- dashboard -----------------------------------------------------

  showDashboard(): void {
    this.stop();
    // Save first: the dashboard reads storage to decide which card resumes,
    // and `openBoard` reads it again to load the work.
    this.persist();
    saveView('dashboard');
    this.dashboardEl.hidden = false;
    this.dashboard.render();
  }

  /** Resize the canvas after the dashboard overlay is hidden on startup. */
  resumeWorkspace(): void {
    this.canvas.resize();
    this.canvas.fitToContent();
  }

  /**
   * Open a board from the dashboard.
   *
   * Carrying on with the stored project when it already uses this board means
   * revisiting the dashboard cannot quietly throw away someone's work; any
   * other board starts from that board's blink starter.
   */
  openBoard(boardType: string): void {
    if (!this.diagramEditingEnabled) return;
    const board = getBoardDefinition(boardType);
    if (!board) throw new Error(`unknown board ${JSON.stringify(boardType)}`);

    const saved = loadProject();
    const savedBoard = saved ? findBoard(saved.diagram.parts)?.type : null;
    this.applyProject(savedBoard === boardType ? saved! : starterProject(board));

    saveView('simulation');
    this.dashboardEl.hidden = true;
    this.canvas.resize();
    this.canvas.fitToContent();
    this.setStatus(`${board.label} ready`);
  }
}

const app = new App();
// Resume the last view: if the user was on the simulation page and has a
// saved project, skip the dashboard and show the editor directly.
const savedView = loadView();
if (savedView === 'simulation' && loadProject()) {
  // The dashboard starts hidden (via the HTML attribute) and the workspace
  // is already populated from loadProject() in the App constructor.
  app.resumeWorkspace();
} else {
  app.showDashboard();
}
