# Arduino Simulator

A browser-based electronics simulator for Arduino Uno and Mega 2560. It runs
compiled AVR firmware with [avr8js](https://github.com/wokwi/avr8js) and supports
Wokwi-compatible `diagram.json` files.

## Quick start

Install **Node.js 24.12 or later** and Git, then run:

```bash
git clone https://github.com/AggiaBintangRH/ArduinoSimulator.git
cd ArduinoSimulator
npm ci
npm run dev
```

Open the local URL printed in the terminal (normally `http://localhost:5173`).
Keep the terminal running while using the app.

### Run the included firmware

No Arduino compiler is needed for this example:

1. Choose **Arduino Uno** on the dashboard.
2. Click **Load .hex** and select `fixtures/blink.hex` from this repository.
3. Click **Start** to run the firmware.

### Compile your own sketch

Install Arduino CLI and make sure `arduino-cli` is available on your `PATH`.
On Windows:

```powershell
winget install ArduinoSA.CLI
```

Open a new terminal after installation, then install the AVR board package:

```bash
arduino-cli core update-index
arduino-cli core install arduino:avr
```

Restart `npm run dev`. Choose a board, edit the sketch, and click **Start**.
The app compiles locally for the selected board and shows compiler output in
the build log. **Libraries** lets you install the libraries a sketch needs.

Use **Load .hex** for existing firmware if Arduino CLI is unavailable. The HEX
file must be compiled for the board selected in the diagram.

## Using the editor

- Add components with **Add part**. Move, rotate, duplicate, or delete them
  while the simulation is stopped.
- Click two pins to connect them. A new wire can also end on an existing wire
  to create a junction.
- Click a wire to show its draggable handles and color controls. Drag the
  handles to reshape it; routing snaps to the grid and aligns with pins.
- Drag with the left mouse button on empty canvas to select multiple parts.
  Selected parts are highlighted. Hold `Shift` to add to the selection.
- Scroll to zoom and drag with the middle mouse button to pan.
- During simulation, component and wire editing is locked. Buttons, switches,
  and other interactive controls remain usable.
- Projects autosave in the browser. Use JSON import/export to move projects
  between computers, and the example picker to open bundled circuits.
- Use the serial monitor to read sketch output and send input. The speaker
  control mutes buzzer audio.

Supported components include LEDs, resistors, pushbuttons, switches,
potentiometers, NTC and light sensors, DHT22, HC-SR04, servos, buzzers,
7-segment displays, character LCDs, and WS2812 LEDs.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl` / `Cmd` + `Enter` | Start or stop |
| `Ctrl` / `Cmd` + `S` | Save project |
| `Ctrl` / `Cmd` + `Z` | Undo (`Shift` to redo) |
| `R` | Rotate selected components |
| `D` | Duplicate selected component |
| `Delete` | Delete selection |
| `Esc` | Cancel drawing a wire |

## Build and development

```bash
npm run build
npm run preview
```

The build is written to `dist/`. Preview serves the built frontend; local
sketch compilation and library management require `npm run dev` because their
Arduino CLI endpoints run in the development server. Prebuilt HEX files can
be used in the preview.

For contributors:

```bash
npm run typecheck
npm test
```

## Credits

The diagram format and component conventions follow [Wokwi](https://wokwi.com/).
This project is independent and is not affiliated with Wokwi. See
[THIRD-PARTY.md](THIRD-PARTY.md) for dependency and artwork attribution.
