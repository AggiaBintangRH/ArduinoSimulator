# Arduino Simulator — Build Plan

A browser-based Arduino/electronics simulator modeled on Wokwi.
Reference material: [`docs/wokwi/01-core.md`](docs/wokwi/01-core.md), [`docs/wokwi/02-parts.md`](docs/wokwi/02-parts.md).

**Stack:** TypeScript + Vite, [avr8js](https://github.com/wokwi/avr8js) for the ATmega328P core,
SVG rendering, Wokwi-compatible `diagram.json`.

**Scope (from the Wokwi constraints we captured):** one MCU per project, no SPICE-level
analog, parts are event-driven models rather than physical simulations.

**Status:** Phases 1–3 done, 78 tests passing. Boxes get checked only after the step
runs and its tests pass.

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
- [ ] 4.1 Wire avr8js ATmega328P: flash load, CPU stepping, clock frequency
- [ ] 4.2 Map AVR ports to simulator pins (D0–D13, A0–A5)
- [ ] 4.3 Timers → PWM output on 3, 5, 6, 9, 10, 11
- [ ] 4.4 USART → serial monitor stream
- [ ] 4.5 Run-loop with real-time pacing + speed reporting
- [ ] 4.6 Tests: blink hex toggles pin 13 at the right rate

## Phase 5 — Parts library
- [ ] 5.1 Part registry + base class, attribute plumbing
- [ ] 5.2 `wokwi-led`, `wokwi-resistor`, `wokwi-pushbutton`, `wokwi-slide-switch`
- [ ] 5.3 `wokwi-potentiometer`, `wokwi-ntc-temperature-sensor` (analog-lite)
- [ ] 5.4 `wokwi-buzzer` (WebAudio), `wokwi-7segment`
- [ ] 5.5 `wokwi-lcd1602` (parallel + I2C/PCF8574)
- [ ] 5.6 `wokwi-neopixel` / `wokwi-led-strip` (WS2812 timing decoder)
- [ ] 5.7 Tests per part

## Phase 6 — Rendering
- [ ] 6.1 SVG canvas, pan/zoom, 2.54 mm grid
- [ ] 6.2 Board + part SVG rendering with pin hit-boxes
- [ ] 6.3 Wire rendering using the Phase 2 router
- [ ] 6.4 Live visual state (LED glow, display pixels, servo angle)

## Phase 7 — Editor
- [ ] 7.1 Add / move / rotate / delete parts
- [ ] 7.2 Draw + delete wires by clicking pins
- [ ] 7.3 Attribute inspector panel
- [ ] 7.4 Two-way sync with the `diagram.json` text view

## Phase 8 — Code + serial
- [ ] 8.1 Code editor pane (CodeMirror)
- [ ] 8.2 Compile pipeline: local `arduino-cli` if present, else hosted build fallback
- [ ] 8.3 Serial monitor with the Wokwi `serialMonitor` options
- [ ] 8.4 Serial input back to the sketch

## Phase 9 — Polish
- [ ] 9.1 Project save/load (localStorage + file import/export)
- [ ] 9.2 Example projects (blink, button, pot+LED, LCD hello)
- [ ] 9.3 Keyboard shortcuts matching Wokwi
- [ ] 9.4 README + usage docs, final test pass
