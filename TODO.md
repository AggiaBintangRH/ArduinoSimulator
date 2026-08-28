# Arduino Simulator — Build Plan

A browser-based Arduino/electronics simulator modeled on Wokwi.
Reference material: [`docs/wokwi/01-core.md`](docs/wokwi/01-core.md), [`docs/wokwi/02-parts.md`](docs/wokwi/02-parts.md).

**Stack:** TypeScript + Vite, [avr8js](https://github.com/wokwi/avr8js) for the ATmega328P core,
SVG rendering, Wokwi-compatible `diagram.json`.

**Scope (from the Wokwi constraints we captured):** one MCU per project, no SPICE-level
analog, parts are event-driven models rather than physical simulations.

**Status: all 34 steps complete.** 321 tests passing, typecheck and production
build clean, verified running in a real browser.

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

## Possible next steps

- More boards: ESP32 and Raspberry Pi Pico (needs a second CPU backend)
- More parts: servo, stepper + A4988, HC-SR04, DHT22, MAX7219, SSD1306
- Syntax highlighting in the code pane (CodeMirror)
- Logic analyzer part with VCD export
- Multi-select and marquee selection in the editor
