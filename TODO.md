# Arduino Simulator — Build Plan

A browser-based Arduino/electronics simulator modeled on Wokwi.
Reference material: [`docs/wokwi/01-core.md`](docs/wokwi/01-core.md), [`docs/wokwi/02-parts.md`](docs/wokwi/02-parts.md).

**Stack:** TypeScript + Vite, [avr8js](https://github.com/wokwi/avr8js) for the ATmega328P core,
SVG rendering, Wokwi-compatible `diagram.json`.

**Scope (from the Wokwi constraints we captured):** one MCU per project, no SPICE-level
analog, parts are event-driven models rather than physical simulations.

**Status: all 34 steps of the original plan complete, plus the Mega 2560.**
349 tests passing, typecheck and production build clean.

---

## Phase 1 — Scaffold
- [x] 1.1 `npm init` + Vite + TypeScript + Vitest, `tsconfig`, folder layout
- [x] 1.2 `git init`, `.gitignore`, README skeleton
- [x] 1.3 Verify dev server and test runner both start

## Phase 2 — Diagram format
- [x] 2.1 TypeScript types for `diagram.json` (parts, connections, serialMonitor)
- [x] 2.2 Parser + validator (unknown part types, bad pin refs, duplicate ids)
- [x] 2.3 Wire-route parser for the `v10` / `h-20` / `*` instruction language
- [x] 2.4 Unit tests for parser + router — 30 tests

## Phase 3 — Simulation kernel
- [x] 3.1 Event-driven scheduler (nanosecond sim clock, timer queue)
- [x] 3.2 Pin + net model: connect pins into nets, resolve conflicts, pull-ups
- [x] 3.3 Part runtime API (`pinInit/pinRead/pinWrite/pinWatch`, timers, attrs)
- [x] 3.4 Unit tests for scheduler + net resolution — 48 tests

## Phase 4 — MCU core
- [x] 4.1 Wire avr8js ATmega328P: flash load, CPU stepping, clock frequency
- [x] 4.2 Map AVR ports to simulator pins (D0–D13, A0–A5)
- [x] 4.3 Timers → PWM output on 3, 5, 6, 9, 10, 11
- [x] 4.4 USART → serial monitor stream
- [x] 4.5 Run-loop with real-time pacing + speed reporting
- [x] 4.6 Tests: blink hex toggles pin 13 at the right rate — 39 tests

## Phase 5 — Parts library
- [x] 5.1 Part registry + base class, attribute plumbing
- [x] 5.2 `wokwi-led`, `wokwi-resistor`, `wokwi-pushbutton`, `wokwi-slide-switch`
- [x] 5.3 `wokwi-potentiometer`, `wokwi-ntc-temperature-sensor` (analog-lite)
- [x] 5.4 `wokwi-buzzer` (frequency detection), `wokwi-7segment`
- [x] 5.5 `wokwi-lcd1602` (parallel + I2C/PCF8574)
- [x] 5.6 `wokwi-neopixel` / `wokwi-led-strip` (WS2812 timing decoder)
- [x] 5.7 Tests per part — 49 tests

## Phase 6 — Rendering
- [x] 6.1 SVG canvas, pan/zoom, 2.54 mm grid
- [x] 6.2 Board + part SVG rendering with pin hit-boxes
- [x] 6.3 Wire rendering using the Phase 2 router
- [x] 6.4 Live visual state (LED glow, LCD text, neopixel colour, segments) — 34 tests

## Phase 7 — Editor
- [x] 7.1 Add / move / rotate / delete parts (plus duplicate, undo/redo)
- [x] 7.2 Draw + delete wires by clicking pins
- [x] 7.3 Attribute inspector panel with live controls
- [x] 7.4 Two-way sync with the `diagram.json` text view — 42 tests

## Phase 8 — Code + serial
- [x] 8.1 Code editor pane
- [x] 8.2 Compile pipeline: local `arduino-cli` via a dev-server endpoint,
      `.hex` upload as the always-available fallback
- [x] 8.3 Serial monitor with the Wokwi `serialMonitor` options
- [x] 8.4 Serial input back to the sketch — 37 tests

## Phase 9 — Polish
- [x] 9.1 Project save/load (localStorage + file import/export)
- [x] 9.2 Example projects (blink, button, pot fade, LCD hello, neopixel)
- [x] 9.3 Keyboard shortcuts matching Wokwi
- [x] 9.4 README + usage docs, final test pass — 42 tests

---

## Bugs found and fixed along the way

1. **Nets never re-propagated after a pin write.** `Pin.write()` marked its `Net`
   dirty but the `NetList` never learned about it, so only nets dirtied at wiring
   time ever fired watches. Fixed with a `NetOwner` back-reference.
2. **The sim clock froze inside a CPU run.** Time only advanced at chunk
   boundaries, so every pin edge in one run shared a timestamp and any part
   measuring a pulse width read zero elapsed time — silently breaking LED
   brightness, buzzer pitch and WS2812. Fixed with `Scheduler.syncTime`, called
   before watches run and only when a net is actually dirty.
3. **LED brightness aliased to 0 or 1.** The LED sampled its integration window
   on every edge, so it measured exactly one pulse. Sampling now happens only on
   the frame timer.
4. **Part state was lost on init.** Events emitted during `init()` were dropped
   if a listener attached later, and deduping meant they never re-sent.
   `Simulation.latestPartEvents` now retains them.
5. **A passive test driver held nets low.** The `Driver` helper defaulted to
   `Output`, defeating internal pull-ups before a test did anything.
6. **The speed readout reported headroom, not speed.** It showed "1250%" while
   correctly paced at 1×. Now measured across whole frames, with `headroom`
   exposed separately.

## Phase 10 — Dashboard

- [x] 10.0 **Dashboard as the opening page.** Board selection only, for now.
  - [x] One card per board the simulator can actually run, previewed with the
        same artwork the canvas draws, plus MCU, clock, flash, SRAM, pin counts
        and the FQBN
  - [x] Picking a board opens a blink starter for it, generated from the board
        definition (built-in LED pin, first ground pad, LED parked clear of the
        board's own width)
  - [x] A `Boards` button returns to it; picking the board that matches the
        stored project carries that work on instead of overwriting it, and its
        card says "Saved project" so which is which is visible
  - [x] Split `AvrChip.sramBytes` (datasheet) from `dataSpaceBytes` (what
        avr8js is allocated), or the Mega's card would have claimed 8.25 KB
  - [x] Canvas frames the diagram when a project loads (`fitToContent`). The
        view previously always started at 1x from a fixed corner, which suited
        a 300px Uno and showed a 776px Mega cut in half.
  - [x] Dashboard previews get prefixed element ids. Sharing the artwork's own
        ids meant SVG resolved `url(#pins-female)` to the preview's copy, and
        once the dashboard was hidden that copy painted nothing - so the board
        on the canvas lost its black header strips.
  - [x] Pin hit-boxes are invisible until a part is hovered or a wire is being
        drawn. They used to be painted on every pin, which was a help on the
        hand-drawn Uno but buried the Mega's real artwork - whose headers are
        already drawn - under 85 gold dots.
  - [x] 20 tests
  - Next, when there is more to put on it: recent projects, examples, and a
    "new project" flow that does not go through a board first.

## Phase 10.7 — Our own Mega artwork

- [x] 10.7 **Draw the Mega ourselves, and number the 2x18 end header.**
  - [x] The adapted Wokwi Elements drawing is gone. On a faithful copy of the
        real board there is nowhere to print the 36 end-header numbers: the
        header sits against a notched right edge - x=757 above y=110, only
        widening to x=775 below - with 27.8px of bare PCB beside it, hemmed in
        by the top header's rotated "SCL 21" marking at x=683.5. Two columns
        only fit at 8px, half the size of the rest of the silkscreen; a column
        placed against the narrow edge fell off the board entirely for 23, 25,
        27 and 29, drawn near-white against the canvas.
  - [x] The board is 832px long against the real 767, and the extra length is
        spent on a labelled strip either side of the end header - so every
        number sits beside its own pad, at full size, on the board. The header
        arrangement itself is the real one: the two Uno-shaped digital groups,
        the Mega's own 14-21 group, POWER and the two analog banks, running the
        length of the board rather than bunched at one end.
  - [x] Pin positions and silkscreen are generated from one layout table, so a
        number cannot drift away from the pad it names.
  - [x] Every pad sits a whole number of pitches from every other, so a part
        snapped to the canvas grid lines up with any pad on the board.
  - [x] Header groups need a two-pitch gap: the plastic runs 9.9px past its
        outermost pad, so neighbours one pitch apart draw as a single block.
  - [x] No element ids anywhere in the artwork, so two copies of the board on
        one page cannot fight over a `url(#…)` lookup - the bug that lost the
        old board its header fill when the dashboard opened.
  - [x] "Mega LED chase" relaid out for the longer board, with route hints that
        drop the ground wires to the rail's height before running in. Left to
        the default route they went horizontal at the resistor's own height,
        straight across the PCB and down through the header.
  - [x] 86 header holes, checked against the A000067 pinout: 26 along the top,
        24 along the bottom, 36 on the end header. That is one more than the 85
        pins the board names - the power header's first hole is drilled but not
        connected, and the first draft left it out. Both ICSP headers are drawn
        too; only the 2560's was there at first.
  - [x] The bottom row runs one pitch below the end header's last row, as on
        the real board, and one pitch further left. Level with it, the analog
        bank's plastic ran under the end header's GND marking and the A15
        marking ran into it - the corner the board is judged by.
  - [x] A test builds a box for every marking and every socket block from the
        generated markup and fails on any overlap. The corner above got past
        an earlier check that compared markings only to other markings: the
        thing it collided with was a block, not a label.
  - [x] Board is 832 x 404, against the real board's 767 x 403 at this scale -
        longer, but the same height and the same header arrangement.
  - [x] USB-B and the power jack are drawn from above like everything else,
        with their openings facing off the left edge. They were drawn head-on
        at first, which read as the board being viewed from two directions at
        once.
  - [x] 17 tests, covering pad/label alignment, grid spacing, block gaps, the
        socket count, marking collisions, and the artwork staying id-free.

## Phase 10.18 — The buzzer sounds like a buzzer

Reported as "the sound is weird, not like a real one", on the Arduino mini
piano: a Mega, eight buttons, `tone()` called from `loop()`.

- [x] 10.18a **Every note played flat, and a tight `tone()` loop nearly
      stopped the timer.** avr8js resets a timer's prescaler phase on every
      write to TCCRnB - it moves `lastCycle` to the current cycle, discarding
      the progress made towards the next tick. Hardware does not: the
      prescaler free-runs, and re-writing the same clock-select bits changes
      nothing (resetting it deliberately takes GTCCR). `tone()` writes TCCRnB
      on **every call**, and this piano - like most button-driven sketches -
      calls it from `loop()`, thousands of times a second. Held C4 came out at
      257Hz instead of 262.6, and `void loop(){ tone(8,262); }` produced 78Hz.
      A write that changes nothing is now dropped, which is what the hardware
      does with it; a real configuration change still goes through. Three
      tests on hardware-toggled OC2A: without the fix the timer produces zero
      toggles in 20ms.
- [x] 10.18b **Every note slid into the next.** The oscillator's frequency was
      ramped with `setTargetAtTime`, which is a portamento - a sound no buzzer
      has ever made. Set outright now, as a pin does.
- [x] 10.18c **A wrong note in front of the right one.** The pitch was the
      mean of the periods in a 50ms window, and the window that straddles a
      note change holds both notes: 440 into 880 reported ~859 first. The
      median of a mostly-new window is the new note. The window is 20ms now
      too - at 50ms a short note could be over before it was ever reported.
- [x] 10.18d **A chirp in front of every keypress.** Contact bounce makes the
      sketch start and stop the tone a dozen times in a millisecond, and that
      burst of ragged edges has a median like any other numbers - reported as
      a ~1.2kHz tone for a whole window. A window now has to look periodic
      before it is called a note: at least three periods, most of them within
      20% of the median. Loose enough that a straddling window still reports
      the new note.
- [x] 10.18e **It sounded like a synthesiser, not a beeper.** A bare square
      wave has all its energy in the fundamental. A piezo buzzer is a
      resonator in a small case: little output down low, a sharp peak a few
      kHz up. A highpass and a peaking filter stand in for the case. Measured
      offline: 440Hz drops from -11dB to -23dB while the 1.3-3kHz harmonics
      become the loudest part, which is where a real buzzer radiates.
- [x] 10.18f `volume` and `mode` are read from the value `attrChanged` is
      handed rather than from `ctx`, whose attributes are the ones the part
      was built with - so turning the volume down mid-run did nothing.
      `mode: "accurate"` now switches without the ramp and clicks, as Wokwi
      documents.
- [x] Verified on the reported project: all eight keys in tune (263, 295, 331,
      349, 393, 440, 494, 523 against 262-523 asked), no chirp, no glide.

## Phase 10.17 — The buzzer makes a sound

- [x] 10.17 **Nothing in the project had ever played audio.**
  - [x] `BuzzerPart` measured the square wave across its pins and reported a
        frequency 20 times a second, and its own comment said "the renderer
        owns WebAudio". The renderer owned no such thing: there was no
        `AudioContext` anywhere in the codebase. The part drew its green rings
        in silence, and the comment described code that was never written.
  - [x] `src/ui/audio.ts` listens for what the buzzer reports. One oscillator
        per buzzer, kept alive across pitch changes - a melody changes the
        note dozens of times a second, and an oscillator per note both clicks
        and leaks. Square wave, because a piezo buzzer is driven by one.
  - [x] Gain is ramped rather than assigned; every instant step in level or
        pitch is an audible click.
  - [x] Started from the Start click, not on load: browsers refuse to play
        until the person has interacted with the page, and a context built any
        earlier starts suspended - which would eat the first note of a sketch
        that beeps in `setup()`.
  - [x] Torn down on Stop, on a rebuild, and when a run fails part-way. A
        stopped simulation must not go on humming.
  - [x] A mute button in the toolbar, remembered across reloads. Unmuting
        reapplies what each buzzer last asked for: a note held through the
        mute reports once and then says nothing more, so waiting for the next
        event would leave it silent until the sketch changed the pitch.
  - [x] The level is capped by the app, not by the part: `volume` scales what
        the app chose rather than being able to turn it up past it.
  - [x] A machine with no audio device, or a browser with no WebAudio, tries
        once and then carries on silently. The simulation is still usable, so
        that is not worth an error in the UI.
  - [x] 15 tests against an injected fake context, and measured in the
        browser: one oscillator for a 440/880/silence loop, the right
        frequencies, silence for a full sketch loop while muted, and the tone
        picked back up on unmute.
  - Frequency comes from averaging periods in a 50ms window, so the report
    that straddles a pitch change lands between the two notes (880 reads ~859
    once before settling). Audible as a very short glide.

## Phase 10.16 — Parts you can actually press

- [x] 10.16 **The pushbutton had nothing to press.**
  - [x] `PushbuttonPart.control('pressed', ...)` had been there since the parts
        library landed, and nothing ever called it: only the boards declared a
        `controls` entry in their artwork, so the button's cap was not a hit
        target at all. Clicking a button selected the part, and a sketch
        polling the pin waited forever. The cap is now a momentary control -
        it conducts while held, like the real thing.
  - [x] `wokwi-pushbutton-6mm` shared none of that artwork and fell back to the
        generic drawing, which has no cap. It is the same switch in a different
        package, so it now shares the drawing and the control.
  - [x] **A latching control had no way to exist.** The dispatcher sent `true`
        on press and, for a momentary control, `false` on release - so a
        switch could be flipped once and never back. `PartControl.toggle` now
        sends the opposite of what the part last reported, read from the
        part's own event rather than a copy kept beside it, so a switch that
        started in its right-hand position moves left on the first press.
  - [x] The slide switch got one. The DIP switch still has no artwork of its
        own, so its eight switches are still unreachable - noted below.
  - [x] Four tests, including one that simply asserts every interactive part
        has something to press. Removing the cap control fails it and the
        press test, with the symptom that was reported.

- [ ] `wokwi-dip-switch-8` draws through the generic fallback, so its eight
      switches cannot be flipped. Needs artwork before it needs controls.

## Phase 10.15 — More than one file

- [x] 10.15 **A sketch is a directory: add `pitches.h` beside `sketch.ino`.**
  - [x] A `+` on the tab strip opens a small dialog: type a name, or upload a
        file from disk. The strip is now drawn from the project rather than
        being fixed markup, and each file tab carries a close button. Typing
        `pitches` creates `pitches.h` - a bare word is not a source file, and
        a header is what an extra file nearly always is.
  - [x] `src/build/sketch-files.ts` holds the rules and returns a sentence
        rather than a boolean, because the dialog shows it: "txt is not a
        source file", "A file name cannot contain a path", "sketch.ino is the
        main sketch".
  - [x] The names are checked again in `vite-plugins/arduino-cli.ts` before
        anything is written. That check is the one that matters - these become
        real files on disk - and it refuses separators, `..`, and any second
        file claiming `sketch.ino`, which would replace the code being built.
        Verified end to end: a request carrying `../../evil.h` compiled the
        legitimate header and wrote nothing outside the sketch directory.
  - [x] **The build cache had to learn about them.** Its key was the sketch,
        the board and the libraries; editing a header moves none of those, so
        the second Start would have served firmware built before the edit and
        the change would have looked like it did nothing. Proved in the
        browser: `NOTE_C4` 262 -> 999 changed what the sketch printed.
  - [x] **The extension check was case-sensitive**, so `Pitches.H` - an
        ordinary header on Windows - was rejected as "not a source file".
        Matched without case now, except `.S`: to gcc that is preprocessed
        assembly and `.s` is not, and only the former is built.
  - [x] The strip scrolls sideways instead of wrapping, and the `+` is pinned
        to its right edge. Wrapping pushed "Build log" onto a second line as
        soon as one file was added, and an unpinned `+` scrolled out of reach
        exactly when there were enough files to want it.
  - [x] Files travel with the project: saved, exported, imported, and dropped
        defensively on the way in, since an imported project is a file someone
        was given. A project saved before this existed opens with none.
  - [x] 30 tests, plus a real build: `#include "pitches.h"` printed 262, 294,
        330, 349, 392 over serial from a sketch calling `tone()`.

## Phase 10.14 — Libraries

- [x] 10.14 **Install Arduino libraries, by name or from a .zip.**
  - [x] A **Libraries** button in the toolbar opens a dialog with three lists:
        search results from the Arduino index, what this project needs, and
        what is installed on this machine. The two lower lists are genuinely
        different things - a project file is portable, the toolchain is not -
        and a project asking for something this machine lacks is marked rather
        than left to fail later as a missing header.
  - [x] `vite-plugins/arduino-libraries.ts`: GET to list, GET `/search`, POST
        to install by name, POST `/zip` to install an uploaded archive, DELETE
        to uninstall. Dev-server only, like the compile endpoint. Names are
        checked against a pattern before reaching the CLI, so nothing that
        would read as a flag or a path gets through, and the upload is checked
        for the `PK` signature so "wrong file" is a sentence, not a stack
        trace.
  - [x] `lib install --zip-path` needs `library.enable_unsafe_install`; it is
        set per command through the environment rather than written into the
        user's own arduino-cli config.
  - [x] **The project's `libraries` list was never used.** It was recorded,
        exported and cached against, but the compile endpoint ignored it
        entirely - so a project could name a library it did not have and the
        build failed on `#include`, which reads as a mistake in the sketch.
        The endpoint now checks the list against what is installed and names
        what is missing.
  - [x] **A zip names its own library**: `SimTestLib.zip` installs as "Sim Test
        Lib". Recording the file name would pin something no toolchain can
        resolve, so the server lists either side of the install and reports
        what actually arrived. Doing that diff in the browser was the first
        attempt, and it was wrong: the dialog's list can be minutes old, and a
        stale "before" made a genuinely new library look like one that was
        already there.
  - [x] **The compile cache outlived its assumptions.** Its key is the sketch,
        the board and the project's library list - none of which change when a
        library is uninstalled. Removing a library the sketch used therefore
        left the next Start serving firmware built while it was still there,
        so the build looked like it had passed. The dialog now drops the cache
        whenever the installed set changes.
  - [x] 46 tests, covering the CLI output parsers, the name pattern, the
        project-list edits, the dialog's flows, and the HTTP client's dev-only
        and unreachable cases.

## Phase 10.13 — Colours as colours

- [x] 10.13 **Colour attributes are picked from swatches, not typed.**
  - [x] The LED palette is the simulator's own list: `lightColorFor` maps a
        body colour to the light it emits, and anything outside that map falls
        back to lighting the part in its own unlit colour. Offering only the
        colours the simulation models keeps that wrong result out of reach -
        a test asserts every offered colour has a light of its own.
  - [x] `color` does not mean the same thing on every part. On an LED it is the
        body; on an LCD it is the text on the backlight, and its default is
        black - which is not a colour an LED body comes in. Caught by a test
        that every part's own default appears in its own picker, so nothing is
        left with no swatch selected.
  - [x] The name is the tooltip and the accessible label, not visible text, and
        the selected ring is drawn outside the swatch so it never covers the
        colour being chosen.
  - [x] Attributes that are not colours stay text fields.
  - [x] A colour wheel, not a fixed palette: hue around the disc, saturation
        towards the middle, a brightness slider, a hex box, and the named
        colours kept as quick picks. The wheel is a CSS conic gradient, so
        there is no canvas to keep in step; `hueAt` and `wheelPosition` are
        inverses of each other and of the way that gradient is painted, which
        a test holds together - a sign error there lands on a different colour
        from the one under the pointer.
  - [x] The panel is positioned against the viewport. The inspector scrolls its
        own contents, and an absolutely positioned child of a scrolling box is
        clipped by it - which cut the wheel in half and hid the hex box.
  - [x] **`lightColorFor` was never called.** The renderer read the body colour
        straight out of the attributes, so the hand-tuned light map had been
        dead code and every LED lit in exactly its unlit shade. Found while
        checking a custom colour lights properly. The rule now lives in
        `util/color`, the renderer uses it, and a test asserts a lit LED never
        shows its body colour.
  - [x] Any colour off the wheel gets a light worked out from itself - brighter
        and a little less saturated, hue kept. A colourless body lights white,
        the way a clear LED does.
  - [x] **The inspector rebuilt itself on every attribute write**, tearing out
        the control being used. A wheel dragged for a second writes dozens of
        times, and each one replaced the wheel under the pointer, so the drag
        carried on against a detached element and read nonsense from its
        zero-sized box. The same rebuild took the caret out of text fields.
  - [x] 28 tests.

## Phase 10.12 — Pins you can see and name

- [x] 10.12 **A solder pad and a pin name on every part.**
  - [x] Pads and names are always drawn, unlike the hit-boxes, which only
        appear on hover. A part was otherwise a plain block with invisible
        pins and no way to tell where a wire was meant to land.
  - [x] Both come from the same pin table the hit-boxes are built from, so a
        name cannot end up on the wrong pad.
  - [x] Boards are excluded: their headers and silkscreen already say. 85 pads
        and 85 names would bury the artwork they sit on.
  - [x] Generic parts grew legs from the body out to each pad; the pins used to
        float beside a plain box.
  - [x] A name sits outside whichever edge its pin is nearest, and is
        counter-rotated by the part's own rotation. A row of names is turned on
        its side when they would run into each other - counting the outline
        that keeps them readable over the artwork, not just the glyphs.
  - [x] The LED and the 7-segment had pins **8px** apart: off the grid parts
        and wires snap to, so their pins could never line up with a header, and
        too tight to print a name beside. Both are now a pin pitch apart, and
        the 7-segment's digit is centred in its wider body.
  - [x] New parts step diagonally until they find a free spot. Adding two in a
        row put the second exactly on the first, which looked like it never
        arrived.
  - [x] Verified in the browser with all 22 part types on the canvas at once:
        25 parts labelled, the board not, zero label collisions.
  - [x] Leads too: the leg between the body and the pad. Parts whose leads have
        a shape of their own - an LED's splay, a resistor's run straight
        through - keep drawing them and set `drawsOwnLeads`; the rest get a
        straight one from the pin table, so no pad is left floating. Leads are
        drawn under the body, so running one well into the part shows no stub
        on top of it.
  - [x] The 7-segment's body is inset from both pin rows, so its leads show on
        both sides the way the LED's do. Flush at the top, the upper pads
        looked embedded in the case.
  - [x] The LED shows its frame: the thin anode post on one side, the broad
        cathode anvil and the cup its die sits in on the other, with the bond
        wire between them. That is how you tell the legs apart on the real
        part without reading anything, and it survives being scaled down to a
        thumbnail. The frame is drawn in a dark metal so it still reads
        through the tinted envelope over it - at the first attempt everything
        inside came out the same washed-out pink.
  - [x] One lead length for the whole diagram. A lead shows for the gap between
        its pad and the body, so every part has to agree on that gap - left to
        each of them they came out at 4px on the generic parts, 4 above and 6
        below the 7-segment, 8 on the neopixels, and the LCD had its pads
        buried in its body entirely. `PIN_INSET` and `BODY_INSET` now fix it at
        `LEAD_GAP` everywhere, checked by a test and measured in the browser
        across six parts and both rows: 6, every one.
  - [x] 13 tests. Still off-pitch and worth a later pass: the Uno's own header
        table, buzzer, pushbutton, slide switch and the neopixel modules.

## Phase 10.11 — Add part button

- [x] 10.11 **An "Add part" button on the canvas; the `A` shortcut removed.**
  - [x] The button sits on the canvas rather than in the toolbar, because it
        acts on the diagram.
  - [x] `A` is gone from the keymap, the canvas hint and the README - not just
        hidden. A shortcut nobody is told about is worse than no shortcut.
  - [x] New parts land in the middle of the view, snapped to the grid. The old
        fixed (320, 260) dropped them off-screen as soon as the view had been
        panned anywhere.
  - [x] The picker's list is rebuilt when it opens. It was wired to a `show`
        event, which a dialog does not fire, so the list had only ever been
        built at startup.
  - [x] 3 tests for `viewportCenter`, plus the hint and README kept in step.
  - [x] The picker lists readable names with a thumbnail of the part, drawn
        from the same artwork the canvas uses - `viewBox` does the scaling, so
        an 832px board and a 20px LED come out the same size. Ids are prefixed,
        as on the dashboard.
  - [x] Names are derived, not tabulated: strip the vendor prefix, title-case
        the words, leave initialisms alone. A table would go stale the moment a
        part is added; this names one nobody has thought about yet.
  - [x] Search still matches the `wokwi-` type as well as the name, and the
        exact type stays on the row as its tooltip - it is what diagram.json
        wants.
  - [x] 11 tests for the naming, including that every listed part gets a
        distinct name with no prefix left in it.

## Phase 10.10 — Resizable panes

- [x] 10.10 **Drag the dividers between the panes.**
  - [x] The editor slides left and right; the serial monitor drags up to get
        taller. Both sizes are CSS custom properties on the grid, so the
        splitter reports a size and the layout does the rest.
  - [x] Either pane can be dragged shut entirely. Its splitter stays behind,
        and a double-click - or Home - brings the pane back, so putting one
        away is not a one-way trip.
  - [x] Sizes are kept across reloads. Stored values are checked on the way
        back in: anything that is not a usable number is dropped rather than
        trusted, since a bad one would collapse a pane on startup with no clue
        why.
  - [x] The handles are focusable separators, so the arrow keys along their own
        axis move them - a control that takes focus and then does nothing is
        worse than one that never takes it.
  - [x] `preventDefault` on the press, for the third time in this codebase:
        both panes are full of text, and dragging a selection is a native drag
        that takes the pointer away mid-resize.
  - [x] The canvas re-measures its grid on every change.
  - [x] 23 tests, over the clamping, both drag directions, the keyboard, and
        the stored sizes.

## Phase 10.9 — One button

- [x] 10.9 **Start builds the sketch, then runs it. Compile button removed.**
  - [x] Pressing Start is the whole loop. Successful builds are cached by
        source, board and libraries, so starting again without editing
        anything does not rebuild - measured at 1ms from press to running,
        against ~4.7s for the first build.
  - [x] Firmware loaded from a `.hex` file is run as it is, never rebuilt over.
        Editing the sketch drops back to building it, or Start would keep
        running the old file and the edits would look like they did nothing.
  - [x] Start is disabled while a build is in flight, so it cannot be pressed
        twice, and re-enabled whether the build succeeds or fails.
  - [x] A failed build reports its diagnostics and leaves the simulation
        stopped - verified: `compiling…` then `build failed`, problems listed,
        Start usable again.

## Phase 10.8 — Part dragging

- [x] 10.8 **Drag a component to move it.**
  - [x] Press anywhere on a part's artwork and drag; the press also selects it,
        so it is one gesture rather than click-then-drag.
  - [x] Parts land on the diagram grid. Snapping where the part lands rather
        than how far it travelled means touching an off-grid part lines it up,
        so a diagram tidies itself as it is worked on. Shift takes half-pitch
        steps.
  - [x] One gesture is one edit: nothing is written to the diagram until the
        pointer is released, so one Ctrl+Z puts the part back. The preview is
        an offset applied in `pinPosition` and the transforms - editing the
        part mid-drag would have put the dragged position into the undo
        snapshot taken on commit.
  - [x] Pin and control hit-boxes move with the artwork. They live in their own
        layer above the wires, so nothing else moves them, and a pin left
        behind makes the part unwirable where it is drawn.
  - [x] Wires attached to the part follow it live, redrawn from the offset
        pin positions - only the wires that touch it, not the whole canvas.
  - [x] `preventDefault` on the press, as for wires: board artwork is covered
        in silkscreen text, and a text selection hands the pointer to the
        browser's own drag.
  - [x] 11 tests, including that the diagram is untouched mid-drag and that the
        hit-boxes track the artwork.

## Phase 10.6 — Wire editing

- [x] 10.6 **Drag a wire segment to reshape it.**
  - [x] The route in `diagram.json` is the only record of a wire's shape. An
        earlier attempt also kept a per-segment pixel offset in the canvas,
        which meant the shape was stored twice: the offset was never saved (so
        a reload lost it) and was re-applied on top of the route it had just
        written (so the wire jumped twice the drag distance).
  - [x] `offsetSegment` keeps the first and last points on their pins and grows
        a new elbow for an end segment. Moving them with the segment pulled the
        wire off the pin it was connected to.
  - [x] `routeFromPoints` turns the dragged polyline back into `v`/`h` steps.
        The old code wrote `['*', 'v<n>', 'h0']` whatever was dragged: it
        ignored the segment index, anchored every step to the target, and
        snapped to 2.54 (millimetres) rather than the `GRID` pixels the
        diagram is laid out on.
  - [x] One gesture is one edit. The route was previously rewritten on every
        `pointermove`, which pushed an undo entry per pixel and redrew the whole
        canvas each frame - destroying the handle being dragged.
  - [x] Press-select-drag in a single gesture, anywhere along the wire; handles
        mark the segment midpoints.
  - [x] Layers are now artwork, then wires, then pin and control hit-boxes.
        Wires belong over the boards they cross, but a wire's grab area is far
        wider than the line drawn, so on top it swallowed presses meant for the
        pins - and underneath it could not be grabbed where it crossed a board.
        Only the tiny invisible hit-boxes ride above.
  - [x] `dedupe` compares within a tolerance and `routeWire` pins its endpoints
        exactly. Rounded steps accumulate, so a long route landed ~1e-14 from
        the pin and left a hairline segment that collected its own drag handle.
  - [x] The press calls `preventDefault`, and the canvas is `user-select:
        none`. Board artwork is covered in silkscreen text, so a drag across
        one selected the pin labels; dragging a selection is a native browser
        drag, which took the pointer and left the second drag of a wire dead.
  - [x] `Delete` removes the selected wire; `Escape` clears the selection.
  - [x] Segments snap to the diagram grid. Snapping the drag *distance* - the
        first attempt - keeps a wire the same fraction of a pitch off the dots
        however far it is dragged, because it starts from wherever the pin
        happens to sit; snapping the segment's own coordinate is what lands it
        on a grid line. Shift takes half-pitch steps.
  - [x] Cables are drawn as rounded paths over a dark casing, with a blob at
        each end sitting on the pad. The corner radius is trimmed to half the
        shorter of the two segments meeting at each bend, so a short run rounds
        off less rather than doubling back through the corner.
  - [x] 44 tests, across the router geometry, the editor, and the canvas - the
        drag had no test coverage at all before.

## Phase 10.5 — More boards

The board layer is now split three ways so a new board is data, not new engine
code: `src/mcu/avr-chip.ts` (silicon: register addresses, interrupt vectors),
`src/mcu/boards.ts` (header: which port bit is "D13", the FQBN), and
`src/mcu/avr-board.ts` (the runtime, shared by every AVR board).

- [x] 10.1 **Arduino Mega 2560** (ATmega2560) — full firmware execution
  - [x] Chip map: ports A-L, timers 0-5, 4 USARTs, 16-channel ADC with MUX5,
        256K flash with a 22-bit PC, extended I/O window
  - [x] Header map: D0-D53, A0-A15, the 2x18 end header, `arduino:avr:mega`
  - [x] Board artwork adapted from Wokwi Elements (MIT, see
        [THIRD-PARTY.md](THIRD-PARTY.md)), part picker entry, "Mega LED chase"
        example
  - [x] Pin names taken verbatim from Wokwi's `wokwi-arduino-mega`, so an
        imported `diagram.json` lands its wires on the same pads: `GND.1` by
        AREF, `GND.2`/`GND.3` on the power header, `GND.4`/`GND.5` closing the
        digital header, plain `5V` on the power header against `5V.1`/`5V.2`
        opening the digital header, and `SCL`/`SDA` tied to D21/D20
  - [x] Compile targets the diagram's board instead of always the Uno
  - [x] Working reset button on the artwork: press holds the chip in reset and
        releases its pins, letting go restarts the firmware from the vector.
        The simulation clock keeps running throughout, so part timers do not
        stall while it is held. Also in the inspector, for keyboard users.
  - [x] 30 tests: extended I/O ports, timer 1 and timer 5 PWM, the timer 0
        interrupt vector, ADC channel 8 via MUX5, USART0 vs USART1
  - Known gaps: differential ADC channels are not mapped; PCINT1's PE0 half is
    unwired (the PJ half is); USART1-3 run but only USART0 is piped to the
    serial monitor UI. A reset clears the register file, but avr8js keeps some
    peripheral state in its own objects; timers and USARTs are reset explicitly,
    the rest re-initialises as soon as the sketch's `init()` writes to it. The
    Mega also runs slower than realtime on this machine (~80%), which the speed
    readout reports honestly rather than hiding.

- [ ] 10.1b **Uno: match Wokwi's pin names too.** Found while doing the Mega.
      Ours are `GND.1`/`GND.2` on the power header and `GND.3` by AREF; Wokwi
      has `GND.1` by AREF and `GND.2`/`GND.3` on the power header - the same
      names for different pads. Every ground is the same net, so an imported
      diagram still *works*; the wire just lands on the wrong hole. We are also
      missing `IOREF` and the `A4.2`/`A5.2` SDA/SCL pads.
  - [ ] Renumber the Uno's grounds, add `IOREF`, `A4.2`, `A5.2` as an alias of
        `A4`/`A5`
  - [ ] Consider adapting the upstream Uno artwork the same way as the Mega's,
        which would also give the Uno a pressable reset button on the board

- [ ] 10.2 **Arduino Nano** (ATmega328P) — same silicon as the Uno, so this is
      a header + artwork job, no chip work at all
  - [ ] `wokwi-arduino-nano` board definition (`arduino:avr:nano`), including
        A6/A7, which are ADC-only and have no digital port bit
  - [ ] Nano artwork: 2x15 DIP outline (upstream has one, adapt it like the
        Mega's)
  - [ ] Tests: A6/A7 read through the ADC but are absent from `gpio`

- [ ] 10.3 **Arduino Leonardo** (ATmega32U4)
  - [ ] Chip map: ports B, C, D, E, F; timers 0/1/3; ADC channels via ADCSRB
        MUX5; 32K flash, 2.5K SRAM
  - [ ] Timer 4 is the 10-bit high-speed timer and has a register layout
        avr8js's `AVRTimer` does not model — decide whether to skip it (losing
        PWM on D6/D13) or extend the timer model
  - [ ] `Serial` on this board is USB CDC, not a USART. Options: (a) ship with
        `Serial` dead and `Serial1` working, saying so in the UI; (b) emulate
        enough of the 32U4 USB device (UENUM/UEINTX/UEDATX) to capture CDC IN
        data. Wokwi does (b); (a) is a day, (b) is a week.
  - [ ] Tests mirroring the Mega suite, plus a USB-CDC test if (b)

- [ ] 10.4 **ESP32** — not an AVR, so avr8js cannot run it at all. Needs a
      second CPU backend (Xtensa LX6 + the ESP-IDF ROM, or a WASM build of an
      existing emulator) behind a `Board` interface that `Simulation` can hold
      instead of `AvrBoard`. Everything below the CPU (nets, parts, renderer,
      diagram format) already works unchanged.
  - [ ] Extract a `Board` interface from `AvrBoard` (pins, clock, run loop,
        firmware load, serial) so the simulation stops naming AVR
  - [ ] Pick a core: port an Xtensa interpreter, or compile one to WASM
  - [ ] Flash image loading (`.bin` partitions, not Intel HEX)
  - [ ] Peripherals: GPIO matrix, LEDC (PWM), UART, ADC, WiFi stubs
  - [ ] `esp32:esp32:esp32` compile target
  - Until a backend exists, ESP32 stays out of the part picker rather than
    appearing as a board that silently runs nothing.

## Possible next steps

- More boards: Raspberry Pi Pico (RP2040, a third backend), ATtiny85
- More parts: stepper + A4988, MAX7219, SSD1306
- EEPROM: avr8js ships `AVREEPROM` but no board wires it up yet
- Syntax highlighting in the code pane (CodeMirror)
- Logic analyzer part with VCD export
