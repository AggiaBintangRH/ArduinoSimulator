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

- **ATmega328P** (Arduino Uno / Nano) — GPIO, PWM, timers, USART, ADC, I2C and
  SPI peripherals, at a configurable clock.
- **Wokwi-compatible `diagram.json`** — same part types, pin names, attributes,
  connection arrays and `v`/`h`/`*` wire-routing language, so diagrams copy
  across.
- **Parts** — LED, RGB LED, bar graph, resistor, pushbutton, slide switch, DIP
  switch, potentiometer, NTC thermistor, photoresistor, buzzer, 7-segment,
  HD44780 LCD (parallel and I2C), and WS2812 strip/ring/matrix.
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

Restart `npm run dev` and the **Compile** button will build the sketch.

Without a toolchain the simulator still runs — use **Load .hex** to open a
prebuilt firmware file (`fixtures/blink.hex` is included). The build log says
which mode you are in.

## Keyboard

| Key | Action |
| --- | --- |
| `Ctrl`/`⌘` + `Enter` | Start / stop the simulation |
| `Ctrl`/`⌘` + `S` | Save the project |
| `Ctrl`/`⌘` + `Z` | Undo (`Shift` to redo) |
| `A` | Add a part |
| `R` | Rotate the selected part |
| `D` | Duplicate the selected part |
| `Delete` | Remove the selected part |
| `Esc` | Cancel the wire being drawn |

Scroll to zoom, drag the background to pan. Parts snap to the 2.54 mm (0.1 in)
grid.

## Layout

```
src/
  diagram/   diagram.json types, parser/validator, wire router
  sim/       scheduler, pin/net model, part runtime, registry, Simulation
  mcu/       ATmega328P on avr8js, Intel HEX loader
  parts/     part implementations
  render/    SVG artwork and canvas
  editor/    diagram mutation, undo/redo
  build/     compiler client
  ui/        styles
docs/wokwi/  digest of the Wokwi documentation this was built against
test/        321 tests
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

## Testing

```bash
npm test         # 321 tests
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
