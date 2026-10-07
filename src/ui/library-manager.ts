/**
 * The Libraries dialog.
 *
 * Two lists, because there are genuinely two things: what this project asks
 * for, and what this machine has installed. A project that lists a library it
 * cannot find must say so rather than failing later as a missing header.
 */

import {
  addLibrary,
  removeLibrary,
  hasLibrary,
  libraryName,
  librarySpec,
  newlyInstalled,
  type InstalledLibrary,
  type LibraryClient,
  type LibraryResult,
} from '../build/libraries.js';

export interface LibraryManagerOptions {
  /** The dialog to fill; its contents are replaced. */
  root: HTMLElement;
  client: LibraryClient;
  /** The project's library list, read fresh each render. */
  libraries: () => readonly string[];
  onChange: (libraries: string[]) => void;
  /**
   * Called when the set installed on the machine changed.
   *
   * The compile cache is keyed on the sketch, the board and the project's
   * library list - none of which change when a library is installed or
   * removed. Without this, uninstalling a library the project uses left the
   * next Start serving the firmware built back when it was still there.
   */
  onInstalledChange?: () => void;
  /** Milliseconds to wait before searching as the user types. */
  searchDelayMs?: number;
}

export interface LibraryManager {
  /** Fetch the installed list and redraw. */
  refresh(): Promise<void>;
  /** Redraw from what is already known, without asking the server again. */
  render(): void;
  /** Install by name (or `Name@version`) and add it to the project. */
  install(spec: string): Promise<void>;
  installZip(file: File): Promise<void>;
  uninstall(name: string): Promise<void>;
  /** What the last request said, for tests and for the log line. */
  readonly installed: readonly InstalledLibrary[];
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createLibraryManager(options: LibraryManagerOptions): LibraryManager {
  const { root, client } = options;
  const searchDelay = options.searchDelayMs ?? 350;

  let installed: InstalledLibrary[] = [];
  let available = true;
  let searchResults: { name: string; version?: string; sentence?: string }[] = [];
  let busy = false;
  let message = '';
  let searchTimer: number | null = null;

  root.replaceChildren();
  root.classList.add('library-manager');

  const heading = el('h2', undefined, 'Libraries');
  const search = el('input', 'library-search');
  search.type = 'search';
  search.placeholder = 'Search the Arduino library index…';
  search.autocomplete = 'off';

  const installButton = el('button', 'primary', 'Install');
  installButton.type = 'button';

  const zipLabel = el('label', 'file-button', 'Upload .zip');
  zipLabel.title = 'Install a library from a .zip archive';
  const zipInput = el('input', 'library-zip');
  zipInput.type = 'file';
  zipInput.accept = '.zip,application/zip';
  zipInput.hidden = true;
  zipLabel.append(zipInput);

  const row = el('div', 'library-add');
  row.append(search, installButton, zipLabel);

  const status = el('p', 'library-status');
  status.setAttribute('role', 'status');

  // Heading and list hide together: a "Search results" heading over nothing
  // reads as a search that came back empty.
  const resultHeading = el('h3', 'library-results-heading', 'Search results');
  const resultList = el('ul', 'library-results');
  const projectList = el('ul', 'library-list library-project');
  const installedList = el('ul', 'library-list library-installed');

  const closeForm = el('form', 'library-close');
  closeForm.method = 'dialog';
  closeForm.append(el('button', undefined, 'Close'));

  root.append(
    heading,
    row,
    status,
    resultHeading,
    resultList,
    el('h3', undefined, 'Used by this project'),
    projectList,
    el('h3', undefined, 'Installed on this machine'),
    installedList,
    closeForm,
  );

  // ---- rendering -----------------------------------------------------

  function entry(
    name: string,
    detail: string,
    actions: { label: string; title?: string; onClick: () => void; primary?: boolean }[],
  ): HTMLLIElement {
    const li = el('li');
    const text = el('div', 'library-text');
    text.append(el('span', 'library-name', name));
    if (detail) text.append(el('span', 'library-detail', detail));
    li.append(text);
    const buttons = el('div', 'library-actions');
    for (const action of actions) {
      const button = el('button', action.primary ? 'primary' : undefined, action.label);
      button.type = 'button';
      if (action.title) button.title = action.title;
      button.disabled = busy;
      button.addEventListener('click', action.onClick);
      buttons.append(button);
    }
    li.append(buttons);
    return li;
  }

  function render(): void {
    status.textContent = message;
    status.classList.toggle('busy', busy);
    search.disabled = busy;
    installButton.disabled = busy;

    // ---- search results
    resultList.replaceChildren();
    resultList.hidden = searchResults.length === 0;
    resultHeading.hidden = resultList.hidden;
    for (const found of searchResults) {
      const already = installed.some((l) => l.name.toLowerCase() === found.name.toLowerCase());
      resultList.append(
        entry(
          found.name,
          [found.version, found.sentence].filter(Boolean).join(' · '),
          [
            {
              label: already ? 'Add to project' : 'Install',
              primary: true,
              onClick: () => {
                // Already on the machine: nothing to download, just record it.
                if (already) setLibraries(addLibrary(options.libraries(), found.name));
                else void install(librarySpec(found.name, found.version));
              },
            },
          ],
        ),
      );
    }

    // ---- the project's list
    projectList.replaceChildren();
    const wanted = options.libraries();
    if (wanted.length === 0) {
      projectList.append(
        el('li', 'library-empty', 'This project does not need any extra libraries.'),
      );
    }
    for (const spec of wanted) {
      const name = libraryName(spec);
      const match = installed.find((l) => l.name.toLowerCase() === name.toLowerCase());
      const li = entry(
        name,
        match
          ? `installed${match.version ? ` ${match.version}` : ''}`
          : available
            ? 'not installed on this machine'
            : 'no toolchain here to check',
        [
          ...(match || !available
            ? []
            : [{ label: 'Install', primary: true, onClick: () => void install(spec) }]),
          {
            label: 'Remove',
            title: 'Stop this project asking for the library. It stays installed.',
            onClick: () => setLibraries(removeLibrary(options.libraries(), name)),
          },
        ],
      );
      if (!match && available) li.classList.add('library-missing');
      projectList.append(li);
    }

    // ---- what is on the machine
    installedList.replaceChildren();
    if (!available) {
      installedList.append(
        el(
          'li',
          'library-empty',
          'No arduino-cli on this machine, so nothing can be installed from here.',
        ),
      );
    } else if (installed.length === 0) {
      installedList.append(el('li', 'library-empty', 'Nothing installed yet.'));
    }
    for (const lib of installed) {
      const inProject = hasLibrary(options.libraries(), lib.name);
      installedList.append(
        entry(
          lib.name,
          [lib.version, lib.sentence].filter(Boolean).join(' · '),
          [
            ...(inProject
              ? []
              : [
                  {
                    label: 'Add to project',
                    onClick: () =>
                      setLibraries(addLibrary(options.libraries(), librarySpec(lib.name))),
                  },
                ]),
            {
              label: 'Uninstall',
              title: 'Remove the library from this machine',
              onClick: () => void uninstall(lib.name),
            },
          ],
        ),
      );
    }
  }

  function setLibraries(next: string[]): void {
    options.onChange(next);
    render();
  }

  // ---- requests ------------------------------------------------------

  /** Run one request at a time, keeping the dialog honest about the wait. */
  async function work<T>(pending: string, fn: () => Promise<T>): Promise<T | null> {
    if (busy) return null;
    busy = true;
    message = pending;
    render();
    try {
      return await fn();
    } finally {
      busy = false;
      render();
    }
  }

  function apply(result: LibraryResult): void {
    available = result.available;
    if (result.libraries.length === 0 && !result.available) return;
    const before = installed.map((lib) => `${lib.name}@${lib.version ?? ''}`).join('|');
    installed = result.libraries;
    const after = installed.map((lib) => `${lib.name}@${lib.version ?? ''}`).join('|');
    if (before !== after) options.onInstalledChange?.();
  }

  async function refresh(): Promise<void> {
    await work('Reading the installed libraries…', async () => {
      const result = await client.list();
      apply(result);
      message = result.ok ? '' : result.output;
    });
  }

  async function install(spec: string): Promise<void> {
    await work(`Installing ${libraryName(spec)}…`, async () => {
      const result = await client.install(spec);
      apply(result);
      if (result.ok) {
        options.onChange(addLibrary(options.libraries(), spec));
        message = `Installed ${libraryName(spec)}.`;
      } else {
        message = firstLine(result.output) || `could not install ${libraryName(spec)}`;
      }
    });
  }

  async function installZip(file: File): Promise<void> {
    await work(`Installing ${file.name}…`, async () => {
      const before = installed;
      const result = await client.installZip(file);
      apply(result);
      if (!result.ok) {
        message = firstLine(result.output) || `could not install ${file.name}`;
        return;
      }
      /*
       * The archive names the library, not the file: `Adafruit_Foo-1.2.3.zip`
       * installs as "Adafruit Foo". Adding the file name to the project would
       * pin something that does not exist, so the newly arrived entries are
       * what get recorded.
       *
       * The server works that out across the install itself; the local diff is
       * only a fallback, and it compares against a list that may be minutes
       * old.
       */
      const added = result.added ?? newlyInstalled(before, result.libraries);
      let next = [...options.libraries()];
      for (const lib of added) next = addLibrary(next, librarySpec(lib.name, lib.version));
      options.onChange(next);
      message =
        added.length > 0
          ? `Installed ${added.map((l) => l.name).join(', ')}.`
          : `Installed ${file.name}. It was already on this machine.`;
    });
  }

  async function uninstall(name: string): Promise<void> {
    await work(`Removing ${name}…`, async () => {
      const result = await client.uninstall(name);
      apply(result);
      message = result.ok ? `Uninstalled ${name}.` : firstLine(result.output) || 'could not remove';
    });
  }

  async function runSearch(query: string): Promise<void> {
    if (query.trim().length < 2) {
      searchResults = [];
      render();
      return;
    }
    await work(`Searching for “${query}”…`, async () => {
      const result = await client.search(query);
      searchResults = result.results;
      message = result.ok
        ? result.results.length === 0
          ? `Nothing in the index matches “${query}”.`
          : ''
        : firstLine(result.output);
    });
  }

  // ---- events --------------------------------------------------------

  search.addEventListener('input', () => {
    // Debounced: the index search shells out to the CLI, so a request per
    // keystroke would queue up behind itself.
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    const query = search.value;
    searchTimer = window.setTimeout(() => void runSearch(query), searchDelay);
  });

  search.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    // Enter means "search now", not "submit the dialog and close it".
    ev.preventDefault();
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    void runSearch(search.value);
  });

  installButton.addEventListener('click', () => {
    const spec = search.value.trim();
    if (spec !== '') void install(spec);
  });

  zipInput.addEventListener('change', () => {
    const file = zipInput.files?.[0];
    // Cleared so picking the same file twice still counts as a change.
    zipInput.value = '';
    if (file) void installZip(file);
  });

  /*
   * A zip can also just be dropped on the dialog. `dragover` has to be
   * cancelled or the browser navigates to the file instead of handing it over.
   */
  root.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    root.classList.add('dropping');
  });
  root.addEventListener('dragleave', () => root.classList.remove('dropping'));
  root.addEventListener('drop', (ev) => {
    ev.preventDefault();
    root.classList.remove('dropping');
    const file = ev.dataTransfer?.files?.[0];
    if (file) void installZip(file);
  });

  render();

  return {
    refresh,
    render,
    install,
    installZip,
    uninstall,
    get installed() {
      return installed;
    },
  };
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
}
