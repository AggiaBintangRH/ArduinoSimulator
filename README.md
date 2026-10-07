# Arduino Simulator

A browser-based Arduino and electronics simulator, modeled on [Wokwi](https://wokwi.com/)
and using its `diagram.json` format. Real compiled AVR firmware is executed
instruction by instruction with [avr8js](https://github.com/wokwi/avr8js); parts
are event-driven models that react to pin changes.

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## What works

- **Dashboard** — the app opens on a board picker; choosing one starts a blink
  project for that board. The `Boards` button in the toolbar goes back.
- **Boards** — Arduino Uno (ATmega328P) and Arduino Mega 2560 (ATmega2560),
  both running real compiled firmware: GPIO, PWM, timers, USART, ADC, I2C and
  SPI peripherals, at a configurable clock. The Mega adds ports A-L, timers 3-5,
  16 analog inputs and `Serial1`-`Serial3`. Compiling picks the right board
  automatically from the diagram. Nano, Leonardo and ESP32 are planned — see
  [TODO.md](TODO.md) phase 10. The Mega's board artwork and pin names are
  adapted from Wokwi Elements (MIT) — see [THIRD-PARTY.md](THIRD-PARTY.md).
  Its reset button works: hold it to stop the chip, let go to restart the sketch.
- **Wokwi-compatible `diagram.json`** — same part types, pin names, attributes,
  connection arrays and `v`/`h`/`*` wire-routing language, so diagrams copy
  across.
- **Parts** — LED, RGB LED, bar graph, resistor, pushbutton, slide switch, DIP
  switch, potentiometer, NTC thermistor, photoresistor, DHT22, HC-SR04, servo,
  buzzer, 7-segment, HD44780 LCD (parallel and I2C), and WS2812 strip/ring/matrix.
- **Editor** — add, move, rotate, duplicate and delete parts; draw wires by
  clicking pins; edit attributes in the inspector; undo/redo; two-way sync with
  the `diagram.json` text view.
- **Serial monitor** — the documented `serialMonitor` options (`display`,
  `newline`, `convertEol`), plus serial input back into the sketch.
- **Projects** — autosaved to localStorage, with JSON import/export and five
  bundled examples.

## Running a sketch

Compiling Arduino C++ needs a real toolchain, which cannot run in a browser.
Rather than sending your code to a third-party build service, this project uses
a **local** `arduino-cli`:

```bash
# macOS / Linux
brew install arduino-cli
# Windows
winget install ArduinoSA.CLI

arduino-cli core install arduino:avr
```

Restart `npm run dev` and **Start** will build the sketch and run it. There is
no separate compile step; successful builds are cached, so starting again
without editing anything does not rebuild.

Without a toolchain the simulator still runs — use **Load .hex** to open a
prebuilt firmware file (`fixtures/blink.hex` is included). The build log says
which mode you are in.

## Sketch files

A sketch is a directory, not a single file. The `+` on the tab strip adds one:
type a name (`pitches` becomes `pitches.h`) or upload one from disk. Headers
sit beside `sketch.ino`, so `#include "pitches.h"` resolves the way it does in
the Arduino IDE. `.h`, `.hpp`, `.c`, `.cc`, `.cpp`, `.ino` and `.S` are
compiled; anything else is refused with the reason.

Files are saved with the project and travel with an export.

## Libraries

**Libraries** in the toolbar searches the Arduino library index, installs by
name, or takes a `.zip` — the same archive the Arduino IDE's *Add .ZIP Library*
accepts; you can also drop one on the dialog. Everything goes to the local
`arduino-cli`'s own library directory, so a library installed here is one the
Arduino IDE has too.

A project records the libraries its sketch needs by name, and that list travels
with the exported project; the toolchain is what actually has them installed.
Opening a project that needs a library this machine lacks marks it in the
dialog, and building says which library is missing instead of failing on an
`#include`.

Uploading a `.zip` runs `arduino-cli lib install --zip-path`, which installs
code you supplied without checking it against the index — the same trust
decision as adding a zip library in the Arduino IDE.

## Sound

A buzzer plays. The part measures the square wave on its pins and the app turns
that into a tone, so `tone()` and a bit-banged pin both sound. The speaker
button in the toolbar mutes it, and that choice is remembered.

Sound starts on **Start**, because browsers will not play audio until the
person has interacted with the page.

The tone is shaped the way a piezo buzzer shapes it — a small resonator with
little output down low — so it sounds thin and reedy rather than like a
synthesiser playing a square wave.

## Pressing things

While a simulation is running, parts with something to operate can be operated:
press and hold a pushbutton (it conducts while held, like the real part), click
a slide switch to flip it, adjust the potentiometer, sensor readings, or servo
angle in the inspector, and press the Mega's reset button. Nothing responds
before **Start** — there is no sketch running to notice.

## Keyboard

| Key | Action |
| --- | --- |
| `Ctrl`/`⌘` + `Enter` | Start / stop the simulation |
| `Ctrl`/`⌘` + `S` | Save the project |
| `Ctrl`/`⌘` + `Z` | Undo (`Shift` to redo) |
| `R` | Rotate the selected part |
| `D` | Duplicate the selected part |
| `Delete` | Remove the selected part |
| `Esc` | Cancel the wire being drawn |

Parts are added with the **Add part** button on the canvas, which drops them
where you are looking.

Scroll to zoom, middle-drag the background to pan, and left-drag empty canvas
to select a group of parts. Shift-click or Shift-drag adds parts to the
selection. Drag a selected part to move the group, or use `R`/`Delete` to
rotate/remove the group together. Drag a wire to reshape it; moves snap to the
2.54 mm (0.1 in) grid, and `Shift` halves the step.

## Layout

```
src/
  diagram/   diagram.json types, parser/validator, wire router
  sim/       scheduler, pin/net model, part runtime, registry, Simulation
  mcu/       ATmega328P on avr8js, Intel HEX loader
  parts/     part implementations
  render/    SVG artwork and canvas
  editor/    diagram mutation, undo/redo
  build/     compiler, library and sketch-file clients
  ui/        styles
docs/wokwi/  digest of the Wokwi documentation this was built against
test/        644 tests
```

## Design notes

Three constraints were taken from Wokwi deliberately, and the tests hold them:

1. **One microcontroller per project.** A second board is reported as an error.
2. **No SPICE-level analog.** The ADC reference is 5 V on every board, and a
   resistor is a passive connector rather than part of a solved network. Sensors
   compute an output voltage from an attribute and drive it onto a net.
3. **Parts are event-driven.** A part declares pins, watches edges and schedules
   timers; nothing polls.

Two details are worth knowing if you extend this:

- The **simulation clock is derived from CPU cycles** and is synced before pin
  watches run, so a part measuring a pulse width inside a callback sees real
  elapsed time. Getting this wrong silently breaks every timing-based part.
- **LED brightness is time-integrated** over a frame rather than sampled, so PWM
  and fast blinking report a true duty cycle instead of aliasing to 0 or 1.

### Known divergence

At `OCR0A = 0` in fast-PWM mode, avr8js holds the compare output HIGH where real
silicon emits a one-tick spike. This is unreachable from normal Arduino code —
`analogWrite(pin, 0)` calls `digitalWrite(pin, LOW)` and never writes `OCR = 0`
with PWM enabled — and is pinned by a test so an avr8js upgrade that fixes it
shows up rather than passing silently.

avr8js also restarts a timer's prescaler phase on every write to `TCCRnB`,
where hardware ignores a write that changes nothing. `tone()` rewrites that
register on every call, so a sketch calling it from `loop()` — the usual shape
of a button-driven instrument — made the timer crawl and every note play flat.
Redundant writes to that register are dropped before avr8js sees them, which is
what the hardware does with them; a real configuration change is passed
through. Three tests cover it.

## Testing

```bash
npm test         # 644 tests
npm run typecheck
npm run build
```

Test firmware is assembled in-process with the assembler bundled inside avr8js,
so the suite needs no Arduino toolchain and stays deterministic.

## Credit

The simulation approach, `diagram.json` format and part semantics follow
[Wokwi](https://wokwi.com/); the AVR core is [avr8js](https://github.com/wokwi/avr8js),
both by Uri Shaked. This project is an independent implementation, not affiliated
with Wokwi.
