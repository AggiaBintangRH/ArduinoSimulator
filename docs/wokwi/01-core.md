# Wokwi Docs Digest — Core (diagram format, chips API, guides)

Source: https://docs.wokwi.com/ (summarized 2026-08-28)

## 1. diagram.json format  (https://docs.wokwi.com/diagram-format)

```json
{
  "version": 1,
  "author": "Name",
  "editor": "wokwi",
  "parts": [],
  "connections": [],
  "serialMonitor": {}
}
```

- `version` — always `1`
- `author`, `editor` ("wokwi")
- `parts` — array of part objects
- `connections` — array of wires
- `serialMonitor` — optional (see below)

### Part object
| Field  | Type    | Req | Notes |
|--------|---------|-----|-------|
| id     | string  | yes | unique, e.g. "led1" |
| type   | string  | yes | e.g. "wokwi-led" |
| left   | number  | no  | X px |
| top    | number  | no  | Y px |
| rotate | number  | no  | degrees |
| hide   | boolean | no  | hide part |
| attrs  | object  | no  | part-specific attributes |

```json
{ "id": "led1", "type": "wokwi-led", "left": 100, "top": 50, "attrs": { "color": "red" } }
```

### Connection = 4-element array
`[ "srcId:pin", "dstId:pin", "wireColor", [ wireInstructions ] ]`
e.g. `["led1:A", "uno:13", "green", []]`
An empty color string hides the wire.

### Wire routing instructions
- `"v<n>"` vertical move in px (negative = up)
- `"h<n>"` horizontal move in px (negative = left)
- `"*"` anchor separating instructions measured from the source (before) from those measured from the target (after)

`["v10","h5","*","v-15","h10"]` — the simulator auto-fills remaining gaps.

### Grid
Parts/wires snap to a 2.54 mm (0.1") grid; fine grid 1.27 mm (Alt/Ctrl); Shift disables snapping.

## 2. serialMonitor  (https://docs.wokwi.com/guides/serial-monitor)

```json
"serialMonitor": { "collapse": false, "convertEol": false, "display": "auto", "newline": "lf" }
```
- `display`: `auto` (default, opens on output) | `always` | `never` | `plotter` (Serial Plotter) | `terminal` (XTerm.js, color support)
- `newline`: `lf` (\n) | `cr` (\r) | `crlf` | `none`
- `collapse`: initial collapsed state
- `convertEol`: terminal mode, converts \n to \r\n

Arduino Uno/Mega: hardware UART auto-detected. ATtiny85 needs SoftwareSerial.

## 3. Custom Chips API  (https://docs.wokwi.com/chips-api/*)

A custom chip = a `.chip.json` (pinout/metadata) + a C source compiled to WASM.
Entry point `chip_init()` — called once per instance in the diagram.
Keep per-instance state in a `chip_state_t` struct; pass a pointer via the `user_data`
field of `i2c_config_t` / `timer_config_t` / `uart_config_t` / `pin_watch_config_t`.
Debug with `printf()` into the "Chips Console" tab. **Messages must end with "\n".**

### chip.json schema
| Field | Type | Notes |
|-------|------|-------|
| name | string | shown in the diagram editor |
| author | string | |
| pins | array | pin names, index 0 = pin 1; use `""` to skip a position |
| controls | array | optional interactive controls |
| display | object | optional, `{ "width": 128, "height": 64 }` |

Control object: `id` (camelCase), `label`, `type` (only `"range"` today), `min`, `max`, `step`.
Control values are read through the Attributes API.

```json
{
  "name": "My Custom Chip",
  "author": "Your Name",
  "pins": ["VCC", "GND", "SCL", "SDA", "OUT"],
  "controls": [
    { "id": "temperature", "label": "Temperature (C)", "type": "range", "min": -40, "max": 125, "step": 0.1 }
  ]
}
```

### GPIO API
```c
pin_t pin_init(const char *name, uint32_t mode);   // chip_init() only
void  pin_mode(pin_t pin, uint32_t mode);
void  pin_write(pin_t pin, uint32_t value);        // HIGH / LOW
uint32_t pin_read(pin_t pin);
bool  pin_watch(pin_t pin, pin_watch_config_t *config);  // one watch per pin
void  pin_watch_stop(pin_t pin);
```
Modes: `INPUT`, `INPUT_PULLUP`, `INPUT_PULLDOWN`, `OUTPUT`, `OUTPUT_LOW`, `OUTPUT_HIGH`, `ANALOG`.
Values: `HIGH`, `LOW`.
```c
typedef struct {
  uint32_t edge;                     // RISING | FALLING | BOTH
  pin_change_callback pin_change;
  void *user_data;
} pin_watch_config_t;
void chip_pin_change(void *user_data, pin_t pin, uint32_t value);
```

### Analog API
```c
float pin_adc_read(pin_t pin);            // pin must be in ANALOG mode
void  pin_dac_write(pin_t pin, float voltage);
```
ADC reference voltage is **5 V on every MCU**; 0 V -> min, 5 V -> max (1023 on Arduino).
`pin_dac_write` may be called before switching to ANALOG mode; the voltage applies after.
Analog-capable stock parts: potentiometer, NTC sensor, photoresistor, analog joystick.

### Time / timers
```c
uint64_t get_sim_nanos(void);                  // /1000 = us, /1000000 = ms
timer_t  timer_init(timer_config_t *config);   // chip_init() only
void     timer_start(timer_t id, uint32_t micros, bool repeat);
void     timer_start_ns(timer_t id, uint64_t nanos, bool repeat);  // slower, prefer timer_start
void     timer_stop(timer_t id);
```
`timer_config_t { callback; void *user_data; }` ; `void chip_timer_callback(void *user_data)`

### Attributes API
```c
uint32_t attr_init(const char *name, uint32_t default_value);      // chip_init() only
uint32_t attr_init_float(const char *name, float default_value);
uint32_t attr_read(uint32_t attr);
float    attr_read_float(uint32_t attr);
```
Attributes come from `attrs` in diagram.json and from `controls` in chip.json.
Naming: camelCase, American English (`color`, not `colour`).

### I2C device API
```c
void i2c_init(i2c_config_t *config);   // chip_init() only
```
`i2c_config_t`: `address` (7-bit, or 0 = listen to all), `sda`, `scl`, `user_data`,
`connect`, `read`, `write`, `disconnect`.
- `connect(user_data, address, bool read)` -> bool (true = ACK, false = NACK)
- `read(user_data)` -> uint8_t byte sent to the MCU
- `write(user_data, uint8_t data)` -> bool ACK
- `disconnect(user_data)` — optional, end of transaction

### SPI device API
```c
spi_dev_t spi_init(spi_config_t *config);   // chip_init() only
void spi_start(spi_dev_t dev, uint8_t *buffer, uint32_t count);
void spi_stop(spi_dev_t dev);
```
`spi_config_t`: `sck`, `mosi` (or `NO_PIN`), `miso` (or `NO_PIN`), `mode` (0-3), `done`, `user_data`.
No CS/SS handling — watch the CS pin yourself. In the `done(user_data, buffer, count)`
callback, if CS is still LOW call `spi_start()` again for the next chunk.
Use a large buffer for high-throughput devices (LCDs).

### UART API
```c
uart_dev_t uart_init(uart_config_t *config);
bool uart_write(uart_dev_t uart, uint8_t *buffer, uint32_t count);  // false if busy
```
`uart_config_t`: `rx` (or `NO_PIN`), `tx` (or `NO_PIN`), `baud_rate`, `rx_data`, `write_done`, `user_data`.
`rx_data` fires per received byte; `write_done` when a transmit finishes. Non-blocking.

### Framebuffer API
```c
buffer_t framebuffer_init(uint32_t *pixel_width, uint32_t *pixel_height);  // chip_init() only
buffer_write(...); buffer_read(...);
```
32-bit RGBA pixels; size = width*height*4. Dimensions come from `display` in chip.json.

### Compiling chips to WASM  (https://docs.wokwi.com/guides/custom-chips-to-wasm)
```
clang --target=wasm32-unknown-wasi -nostartfiles -Wl,--import-memory \
  -Wl,--export-table -Wl,--no-entry -Werror -o dist/chip.wasm src/main.c
```
Needs `wasi-libc` and `libclang_rt.builtins-wasm32.a` (wasi-sdk) plus LLVM/clang.
Options: `wokwi-cli chip compile main.c` (v0.20.0+), GitHub Actions (inverter-chip
template), VS Code dev container, or
`docker run --rm -u 1000:1000 -v ${PWD}:/src wokwi/builder-clang-wasm:latest make`.
Register in `wokwi.toml` under `[[chip]]` (name + binary); a `.json` file with the same
base name as the `.wasm` describes the pinout. Include `wokwi-api.h`.

## 4. Supported hardware  (https://docs.wokwi.com/getting-started/supported-hardware)

**AVR:** Arduino Uno (ATmega328P), Nano (ATmega328P), Mega (ATmega2560), ATtiny85
**ESP32:** ESP32, S2, S3 (Xtensa); C3, C6, C61, H2 (RISC-V); C5 / S31 alpha; P4 beta
**STM32:** STM32C031, STM32L031, STM32F103C8 (Blue Pill)
**Other:** Raspberry Pi Pico (RP2040)

Sensors: HC-SR04, DHT22, DS1307 RTC, PIR, NTC, DS18B20, BMP180, MPU6050,
photoresistor, MQ2 gas, HX711, MFRC522 RFID
Input: pushbutton, slide switch, DIP switch 8, 4x4 keypad, analog joystick,
potentiometer, slide pot, KY-040 encoder
LEDs/displays: LED, RGB LED, bar graph, WS2812 strip/ring/matrix, LCD1602/2004,
Nokia 5110, ILI9341, SSD1306, SH1107, MAX7219 matrix, 7-segment, e-paper, PAL TV
Motors: servo, bipolar stepper, A4988 driver, biaxial stepper
Comms: IR receiver, IR remote
Logic/other: NOT/AND/OR/XOR/NAND gates, MUX, flip-flops, 74HC595, 74HC165,
resistor, buzzer, clock generator, relay, breadboard, logic analyzer, microSD, text

## 5. ESP32 notes  (guides/esp32, guides/esp32-wifi)

Frameworks: Arduino core, ESP-IDF, MicroPython, CircuitPython, Rust, custom firmware.
Supported: GPIO, UART, SPI, I2C, timers, ADC, crypto (AES/SHA/RSA), WiFi, GDB.
Partial/absent: I2S (in progress), RMT (TX only), TWAI/CAN (partial); **no** MCPWM,
Hall sensor, or Bluetooth. USB CDC on S3/C3/C5/C6/C61/H2.
Flash 2-32 MB, PSRAM 2-8 MB via chip attributes; custom `partitions.csv`;
`cpuFrequency` attribute (auto CPU-frequency limiting for performance).

WiFi: default open AP **Wokwi-GUEST** (no password). Public gateway IP 10.10.0.2
(cloud, traffic monitored); private gateway 10.13.37.2 (paid, local, faster, can reach
local services; simulated web servers reachable at localhost:9080).
Simulated MAC 24:0a:c4:00:01:10. TCP + UDP work; **no ICMP** (ping fails).
HTTP/HTTPS/MQTT/CoAP/DNS work. Custom APs via the `wokwi-wifi-ap` part (paid).
PCAP download for Wireshark (timestamps follow the simulation clock).

## 6. Logic analyzer & libraries

Logic analyzer: 8 channels D0-D7, 1 GHz sample rate. Attributes: `channelNames`
(e.g. "SCL,SDA,RST"), `triggerPin` (default D7), `triggerLevel` ("high"/"low"),
`triggerMode` ("edge"/"level"). Exports `wokwi-logic.vcd` (VCD) when the sim stops;
filename overridable via `vcdFile` in wokwi.toml. View in PulseView (downsample ~50,
protocol decoders for I2C/UART/WS2812) or GTKWave.

Libraries: type `#` on an empty line for include autocomplete, or use the Library
Manager tab. `libraries.txt` — one library per line, `Name@1.2.3` pins a version,
`#` starts a comment, `Name@wokwi:id` references a custom uploaded library.
Wire.h/SPI.h are built in.

## 7. Other

MicroPython / CircuitPython: Raspberry Pi Pico. `main.py` (MicroPython) or `code.py`
(CircuitPython) auto-runs; all project files are copied into the Pico flash filesystem.
REPL after the script ends or Ctrl+C; Ctrl+E paste mode. CircuitPython pulls Adafruit
bundle libraries listed in `requirements.txt` into `lib/`.

Interactive debugger (web): AVR only (Uno, Nano, Mega, ATtiny85) — breakpoints in the
gutter, continue/step over/into/out, call stack + variables panes. Other MCUs use VS Code.
Web GDB: F1 -> "Start Web GDB Session (debug build)"; Arduino and Pi Pico.

FAQ: firmware runs one instruction at a time like real hardware; Chrome is faster than
Firefox; `delay()` reduces simulator load; offline via the VS Code extension;
**multiple microcontrollers in one project are not supported** (workaround: separate
simulations linked through a private IoT gateway).

Keyboard: Ctrl/Cmd+Enter start sim, Ctrl/Cmd+S save, F1 commands, Alt+Shift+F format,
F8 / Shift+F8 next/prev error, Ctrl+D select next occurrence, Alt+Up/Down move line.
Diagram editor: `A` or "+" add part, `R` rotate 90 degrees, `D` duplicate, `G` toggle
grid, Delete removes, Shift-click multi-select, 0-9 / letters set wire color.
Wire colors auto-assign: black = ground, red = 5V, green = other.

## 8. Tooling (VS Code extension + Wokwi CI)

### wokwi.toml
```toml
[wokwi]
version = 1
firmware = 'build/flasher_args.json'   # .hex .elf .uf2 .bin, board dependent
elf = 'build/example_app.elf'          # optional, improves performance
vcdFile = 'logic-capture.vcd'          # default wokwi.vcd
gdbServerPort = 3333
rfc2217ServerPort = 4000

[[net.forward]]
from = "localhost:8180"
to = "target:80"

[[chip]]
name = 'inverter'
binary = 'chips/inverter.chip.wasm'
```
Use forward slashes in paths. Required files: `diagram.json` + `wokwi.toml`.
Extension needs a license (F1 -> "Wokwi: Request a new License"). Works with Zephyr,
PlatformIO, ESP-IDF, Pi Pico SDK, NuttX, Rust, Arduino CLI, MicroPython.
Offline mode requires the Pro plan. Privacy mode: `wokwi.hidePersonalInfo`.
Diagram editor opens by clicking `diagram.json` (also `diagram.*.json`); visual editing
requires Hobby+ or Pro, text editing is always available.

VS Code debugging: set `gdbServerPort = 3333`, add a `cppdbg` launch config with
`miDebuggerPath` (e.g. `xtensa-esp32-elf-gdb`, `avr-gdb`) and
`miDebuggerServerAddress: "localhost:3333"`. Start "Wokwi: Start Simulator and Wait for
Debugger" **before** pressing F5.

### Wokwi CI
Install: `curl -L https://wokwi.com/ci/install.sh | sh` (Linux/macOS) or
`iwr https://wokwi.com/ci/install.ps1 -useb | iex` (Windows). ESP-IDF: `pip install idf-wokwi`.
Token from https://wokwi.com/dashboard/ci — starts with `wok_`, exactly 44 chars,
env var `WOKWI_CLI_TOKEN`.
Sim-time quotas: Free 50 min/mo, Hobby/Hobby+ 200, Pro 2000. Stateless — firmware is
not retained.

CLI flags: `--elf`, `--diagram-file`, `--interactive`, `--serial-log-file`,
`--timeout` (sim ms, default 30000), `--timeout-exit-code` (default 42),
`--expect-text`, `--fail-text`, `--scenario`, `--screenshot-part`, `--screenshot-time`,
`--screenshot-file`, `--vcd-file`, `--quiet`, `--help`. Also `wokwi-cli lint`.

Automation scenario YAML:
```yaml
name: 'Scenario name'
version: 1
author: 'Your name'
steps:
  - delay: 30ms
  - wait-serial: 'Ready for testing!'
  - write-serial: 'text'            # or a byte array [87, 111, 107]
  - set-control: { part-id: dht, control: humidity, value: 39 }
  - expect-pin: { part-id: esp, pin: 2, expected: 1 }
  - take-screenshot: { part-id: 'oled1', compare-with: 'screenshots/oled-1.png' }
  - touch: { part-id: esp32s3box, x: 120, y: 160, duration: 100ms }
  # also: touch-press, touch-move, touch-release
```

GitHub Actions:
```yaml
- uses: wokwi/wokwi-ci-action@v1
  with:
    token: ${{ secrets.WOKWI_CLI_TOKEN }}
    path: /
    expect_text: 'Hello, world!'
```

MCP server (experimental): `wokwi-cli mcp` over stdio with `WOKWI_CLI_TOKEN`.
