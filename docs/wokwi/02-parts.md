# Wokwi Parts Reference — pin names + attributes

Every `type` string below goes in `parts[].type` in diagram.json. Pin names are used
verbatim on both sides of a connection: `["<partId>:<PIN>", "<partId>:<PIN>", color, []]`.
All attribute values in diagram.json are **strings**, even numeric ones ("400", "0x27").

Note: the docs site has part pages only for the parts listed here. ESP32 dev boards
(`board-esp32-devkit-c-v4`, `board-esp32-c3-devkitm-1`, …) have no individual page —
see the ESP32 guide and the in-editor part picker.

---

## Boards / MCUs

### wokwi-arduino-uno
Pins: `0`–`13`, `A0`–`A5`, `VIN`, `5V`, `GND.1`, `GND.2`, `GND.3`
Alt functions: 0=RX, 1=TX, 2=INT0, 3=INT1, 10=SS, 11=MOSI, 12=MISO, 13=SCLK, A4=SDA, A5=SCL
Attrs: `frequency` (default `"16m"`, MCU clock in Hz)
Notes: PWM on 3,5,6,9,10,11. SPI and I2C master mode only. Analog Comparator not
implemented. GDB supported. Simulated by AVR8js.

### wokwi-arduino-nano
Same core as the Uno (ATmega328P, 32 KB flash, 2 KB SRAM, 1 KB EEPROM).
Pins: `0`–`13`, `A0`–`A7`. **A6/A7 are analog-input only — not usable as digital GPIO.**

### wokwi-arduino-mega
Pins: `0`–`53`, `A0`–`A15` (also digital), `VIN`, `5V`, `5V.1`, `5V.2`, `GND.1`–`GND.5`
Alt: 0/1 Serial, 2/3 INT4/INT5, 14–17 Serial3/Serial2, 18/19 Serial1, 20=SDA, 21=SCL,
50=MISO, 51=MOSI, 52=SCK. PWM on 2–13 and 44–46 (15 channels).
On-board LEDs: L (pin 13 / `LED_BUILTIN`), RX, TX, ON.
Notes: SPI/I2C master only; Output Compare Modulator and Analog Comparator missing;
16-bit timers lack Input Capture. Serial Monitor for all four USARTs.

### wokwi-attiny85
Pins: `PB5` (reset), `PB3`, `PB4`, `GND`, `PB0` (MOSI/SDA), `PB1` (MISO), `PB2` (SCK/SCL), `VCC`
Attrs: `frequency` (default `"8m"`; common: 1m, 8m, 16m, 20m)
Notes: 8 KB flash / 512 B SRAM / 512 B EEPROM. USI = I2C mode only. Timer0 with PWM on
PB0/PB1; **Timer1 not implemented**. Watchdog, EEPROM, ADC, GDB supported.

### wokwi-pi-pico
Pins: `GP0`–`GP22`, `GP26`/`GP27`/`GP28` (also ADC ch 0/1/2), `GND.1`–`GND.8`,
`VSYS`, `VBUS`, `3V3`, `TP4` (=GPIO23, diagram.json only), `TP5` (=GPIO25 + onboard LED)
Notes: **single core only** (RP2040 has two). USB CDC serial (early messages can be lost
during enumeration). I2C/SPI master only. PIO supported (with debugger). DMA only for
PIO. Timer pause not implemented. Temperature sensor always reads 0. Arduino-Pico core;
exports UF2. MicroPython and CircuitPython supported.

### wokwi-franzininho
ATtiny85-based board. Pins: `0` (PB0, MOSI/SDA), `1` (PB1, MISO, LED1), `2` (PB2, SCK/SCL),
`3` (PB3), `4` (PB5, reset), `5` (PB4), `VCC`, `GND`. Two 3 mm LEDs (power + PB1).

### board-franzininho-wifi
ESP32-S2 board from Brazil. Orange LED on pin 33, blue LED on pin 21, plus a green power LED.

### board-stm32-bluepill
STM32F103C8, Cortex-M3 @ 72 MHz, 64 KiB flash / 20 KiB RAM. Pin names are STM32 GPIO
names (`PA0`…`PC13`); user LED on `PC13`.
Supported: core, GPIO, USART, I2C, SPI, TIM1/2/3/4 (analogWrite), EXTI, WWDG, RCC, GDB.
Partial: ADC (ADC1 basic conversion only; ADC2 missing). Not implemented: DMA, RTC, PWR, IWDG.

### board-st-nucleo-c031c6
Cortex-M0+. STM32 pin names (`PA5` = D13 = onboard LED).
Supported: core, GPIO, USART, I2C (master), SPI (master), ADC, TIM1/3/14/16/17
(analogWrite), CRC (8/16/32-bit), EXTI, SysTick, GDB. Not implemented: DMA, RTC.

### board-st-nucleo-l031k6
Cortex-M0+. Pins `PA0`–`PA15`, `PB0`–`PB15`; onboard LED `PB3` (`LED_BUILTIN`).
Supported: core, GPIO, USART, I2C (master), SPI (master), ADC, TIM2/21/22, CRC, EXTI,
RCC, 1 KB EEPROM. Partial: SYSCFG (EXTICRn only), WWDG. Not implemented: comparator,
DBG, DMA, IWDG, LPTIM, LPUART, PWR, RTC.

---

## LEDs & displays

### wokwi-led
Pins: `A` (anode), `C` (cathode)
Attrs: `color` ("red" default, "green", "yellow", "white", hex), `lightColor`,
`label`, `gamma` ("2.8"), `flip` ("1" to flip), `fps` ("80")

### wokwi-rgb-led
Pins: `R`, `G`, `B`, `COM`
Attrs: `common` — "anode" (default) | "cathode". PWM for color mixing.

### wokwi-led-bar-graph
Pins: `A1`–`A10` (anodes), `C1`–`C10` (cathodes)
Attrs: `color` — "red" (default), "yellow", hex, "GYR" (green-yellow-red gradient),
"BCYR" (cyan-blue-yellow-red)

### wokwi-neopixel
Single WS2812. Pins: `VDD`, `VSS`, `DIN`, `DOUT`. No attributes.
Chain DOUT -> DIN. GRB order, 800 kHz. Use the strip/ring/matrix parts for many LEDs.

### wokwi-led-strip
Pins: `VDD`, `DIN`, `VSS`, `VDD.2`, `DOUT`, `VSS.2`
Attrs: `pixels` ("8"), `pixelShape` ("" | "square" | "circle"),
`pixelSize` ("5050" default / 23 px, "3535" / 16 px, "2020" / 9 px)

### wokwi-led-ring
Pins: `GND`, `VCC`, `DIN`, `DOUT`. Attrs: `pixels` ("16").

### wokwi-led-matrix
WS2812 matrix. Pins: `DIN`, `VDD`, `VSS`, `DOUT`
Attrs: `rows` ("8"), `cols` ("8"), `layout` ("" progressive | "serpentine"),
`brightness` ("1"), `pixelShape` ("" | "square" | "circle"), `pixelSize` ("5050"|"3535"|"2020")

### wokwi-7segment
Pins: `A`,`B`,`C`,`D`,`E`,`F`,`G`,`DP`,`COM` (single digit); multi-digit adds
`DIG1`–`DIG4`; optional `CLN` (colon)
Attrs: `common` ("anode" default | "cathode"), `digits` ("1"–"4"), `colon` ("" | "1"),
`color` ("red" default, names or hex)
Notes: common anode -> drive segments LOW to light; common cathode -> drive HIGH.
Multi-digit needs multiplexing. Works with the SevSeg library / Pico PIO.

### wokwi-tm1637-7segment
4-digit module. Pins: `CLK`, `DIO`, `VCC`, `GND`. Attrs: `color` ("red").
Protocol resembles but is **not** I2C. Libraries: TM1637_RT, Grove 4-Digit Display.

### wokwi-max7219-matrix
Pins: `VCC`, `GND`, `DIN`, `CS`, `CLK`, `DOUT`
Attrs: `chain` ("1", units chained horizontally), `color` ("red"),
`layout` ("parola" default | "fc16")
Wrong layout rotates/mirrors the output. Chain DOUT -> DIN, share CLK/CS.

### wokwi-lcd1602 / wokwi-lcd2004
16x2 and 20x4 character LCDs; identical pins and attributes.
Parallel pins: `VSS`, `VDD`, `V0`, `RS`, `RW`, `E`, `D0`–`D7`, `A`, `K`
I2C pins (`pins: "i2c"`): `GND`, `VCC`, `SDA`, `SCL`
Attrs: `pins` ("full" default | "i2c"), `i2cAddress` ("0x27"), `color` ("black"),
`background` ("green"), `variant` ("A00" default | "A02")
Notes: I2C mode emulates a PCF8574T expander. 8 user-definable characters (indices 0-7).
Variants differ in the upper character range (A00 katakana, A02 Western European).

### board-ssd1306   (preferred)
128x64 mono OLED, I2C. Pins: `GND`, `VCC`, `SCL`, `SDA` (Uno: A5/A4)
Attrs: `i2cAddress` ("0x3c" default, or "0x3d")
Libraries: Adafruit SSD1306, ssd1306, lcdgfx, U8glib, U8g2/U8x8, SSD1306Ascii, Tiny4kOLED.

### wokwi-ssd1306   (deprecated — use board-ssd1306)
Pins: `DATA` (SDA), `CLK` (SCL), `3V3`, `GND`, `VIN`. DC/RST/CS unused.
Attrs: `i2cAddress` ("0x3c"). **I2C only, no SPI.**

### board-grove-oled-sh1107
128x128 mono OLED. Pins: `SCL`, `SDA`, `VCC`, `GND`. No attributes. **I2C only.**

### wokwi-ili9341
240x320 color SPI LCD. Pins: `VCC`, `GND`, `CS`, `RST`, `D/C`, `MOSI`, `SCK`, `LED`, `MISO`
Attrs: `flipHorizontal` ("" | "1"), `flipVertical` ("" | "1"), `swapXY` ("" | "1")
`RST` and `LED` are non-functional in simulation; `MISO` optional.
Libraries: Adafruit_ILI9341, lcdgfx.

### wokwi-nokia-5110-screen
84x48 mono LCD (PCD8544), SPI. Pins: `RST`, `CE`, `DC`, `DIN`, `CLK`, `VCC`, `BL`, `GND`.
Library: Adafruit PCD8544.

### wokwi-tv
PAL TV, 768x576, 25 fps, black & white. Pins: `IN` (pixel data), `SYNC`, `GND`.
No attributes. Frame = 40 ms (two interlaced 20 ms fields), 625 slots of 64 µs;
field sync ~30 µs low on SYNC, line sync 4 µs low. Library: Arduino TVout.

---

## Input

### wokwi-pushbutton
Pins: `1.l`, `1.r`, `2.l`, `2.r` (each numbered contact pair is internally joined;
pressing joins 1 to 2)
Attrs: `color` ("red"), `label` (""), `key` (keyboard shortcut), `xray` ("" | "1"),
`bounce` ("" = on; "0" disables)
Bounce: contacts separate/reconnect 10–100 times over ~1 ms. Ctrl/Cmd-click sticks the
button down. Automation control: `pressed` (0/1).

### wokwi-pushbutton-6mm
6 mm tactile switch — same pins/behavior as `wokwi-pushbutton`.

### wokwi-slide-switch
SPDT. Pins: `1` (left), `2` (common), `3` (right).
Attrs: `value` ("" = left, "1" = right), `bounce` ("0" disables).

### wokwi-dip-switch-8
Pins: `1a`/`1b` … `8a`/`8b`. No attributes.
Click to focus, then press keys "1"–"8" to toggle.

### wokwi-membrane-keypad
Pins: `R1`–`R4` (rows), `C1`–`C4` (columns)
Attrs: `columns` ("4" default | "3"), `keys` (array of 12–16 labels; default
`["1","2","3","A","4","5","6","B","7","8","9","C","*","0","#","D"]`; Unicode/emoji OK)
Click to focus, then type. Library: Keypad.

### wokwi-ky-040  (rotary encoder)
Pins: `CLK` (A), `DT` (B), `SW` (button to GND), `VCC`, `GND`. No attributes.
CW: CLK falls first, then DT. CCW: DT first. Module pull-ups on CLK/DT are always
enforced in simulation. Keys: Right/Up = CW, Left/Down = CCW, Space = press.

### wokwi-potentiometer
Pins: `GND`, `SIG`, `VCC`. Attrs: `value` (initial position, "0", range 0–1023).
GND/VCC connection optional (no full analog sim) but recommended.
Keys: Left/Right fine, PgUp/PgDn coarse, Home/End extremes.
Automation control: `position` (0.0–1.0).

### wokwi-slide-potentiometer
Same pins/behavior as the potentiometer.
Attrs: `value` ("0", 0–1023), `travelLength` mm ("30" default; "15","20","30","45","60","100").

### wokwi-analog-joystick
Pins: `VCC`, `VERT`, `HORZ`, `SEL`, `GND`. Attrs: `bounce` ("0" disables).
Idle = VCC/2. VERT 0 V bottom -> VCC top; HORZ 0 V right -> VCC left. SEL closes to GND.
Arrow keys move, Space presses.

---

## Sensors

### wokwi-dht22
Pins: `VCC`, `SDA` (data), `NC`, `GND`
Attrs: `temperature` ("24" °C), `humidity` ("40" %RH). Click during sim for sliders.
On ESP32 use the "DHT sensor library for ESPx".

### wokwi-ds18b20   (1-Wire)
Pins: `VCC`, `DQ`, `GND`
Attrs: `temperature` ("22", -55..125), `deviceID` ("010203040506", 12 hex chars),
`familyCode` ("28")
Multiple sensors on one bus need unique `deviceID`s. Libraries: OneWire, DallasTemperature
(the latter cannot read exactly -55 °C). Automation: float control, -55..125.

### wokwi-ntc-temperature-sensor   (analog)
Pins: `VCC`, `OUT`, `GND`. Attrs: `temperature` ("24"), `beta` ("3950").
Module = 10 K NTC in series with a 10 K resistor; read OUT with `analogRead()`.

### wokwi-photoresistor-sensor   (analog)
Pins: `VCC`, `GND`, `DO`, `AO`
Attrs: `lux` ("500"), `threshold` ("2.5" V), `rl10` ("50" kΩ @ 10 lux), `gamma` ("0.7")
AO = divider of LDR against a fixed 10 kΩ. **DO goes HIGH in the dark, LOW in light.**
analogRead ranges ~8 (direct sun) to ~1016 (full moon). Automation: `lux` float.

### wokwi-gas-sensor   (MQ2)
Pins: `VCC`, `GND`, `DO`, `AO`. Attrs: `ppm` ("400"), `threshold` ("4.4" V).
DO goes LOW when ppm exceeds the threshold. No warm-up delay in simulation.

### wokwi-hc-sr04   (ultrasonic)
Pins: `VCC`, `TRIG`, `ECHO`, `GND`. Attrs: `distance` cm ("400", range 2–400).
TRIG high >= 10 µs starts a measurement; ECHO pulse width is proportional to distance.
cm = pulse_µs / 58; inches = pulse_µs / 148.

### wokwi-pir-motion-sensor
Pins: `GND`, `OUT`, `VCC`
Attrs: `delayTime` ("5" s OUT stays high), `inhibitTime` ("1.2" s ignored after),
`retrigger` ("" = enabled; "0" disables)
Trigger with the "Simulate Motion" button on the selected part.

### wokwi-mpu6050   (I2C)
Pins: `VCC`, `GND`, `SCL`, `SDA`, `XDA`, `XCL` (both unimplemented), `AD0`, `INT`
Attrs (floats): `accelX` ("0"), `accelY` ("0"), `accelZ` ("1"), `rotationX/Y/Z` ("0" deg/s),
`temperature` ("24"). Address 0x68, or 0x69 via AD0. 1 g = 9.80665 m/s².

### board-bmp180   (I2C)
Pins: `VCC`, `3.3V`, `GND`, `SCL`, `SDA`
Attrs: `temperature` ("24", -40..85), `pressure` ("101325" Pa, 30000–110000)
Address 0x77; BMP085-compatible libraries. Sliders during simulation.

### wokwi-ds1307   (RTC, I2C)
Pins: `GND`, `5V`, `SDA`, `SCL`, `SQW`
Attrs: `initTime` — "now" (default) | "0" (= 2000-01-01T00:00:00Z) | ISO 8601 string
Address 0x68. SQW can output 1 Hz / 4.096 kHz / 8.192 kHz / 32.768 kHz or a static level
(`writeSqwPinMode()` in RTClib).

### wokwi-hx711   (load cell amp)
Pins: `VCC`, `DT`, `SCK`, `GND` (E+/E-/A+/A-/B+/B- are decorative only)
Attrs: `type` ("50kg" default | "5kg" | "gauge")
Raw range 0–2100 (5 kg) or 0–21000 (50 kg). Channel B and variable gain not supported.
Automation control: `load` (float, kg).

### board-mfrc522   (RFID, SPI mode 0)
Pins: `3.3V`, `RST`, `GND`, `IRQ`, `MISO`, `MOSI`, `SCK`, `SDA` (= chip select)
Attrs: `uid` (4- or 7-byte hex, e.g. `01:02:03:04`; affects the blue card only)
Six card presets; tap = 500 ms. Keys: b/g/y/r/n/k select a card, t taps.
Automation controls: `card`, `tagPresent`.

---

## Motors

### wokwi-servo
Pins: `PWM`, `V+`, `GND`. Attrs: `horn` ("single" | "double" | "cross"),
`hornColor` ("#ccc"). Range 0–180° with hard stops.

### wokwi-stepper-motor
Pins: `A-`, `A+`, `B+`, `B-`
Attrs: `arrow` (color, ""), `display` ("steps" | "angle" | "none"),
`gearRatio` ("1:1" = 200 steps/rev, "2:1" = 400, …), `size` (NEMA "8","11","14","17","23"(default),"34")
1.8°/step; half-stepping gives 0.9°. Coil current is not modeled.
Libraries: Stepper, AccelStepper.

### wokwi-biaxial-stepper
Two concentric steppers in one housing. Pins: `A1-`,`A1+`,`B1+`,`B1-` (outer),
`A2-`,`A2+`,`B2+`,`B2-` (inner)
Attrs: `outerHandLength` ("30", 20–70), `outerHandColor` ("gold"),
`outerHandShape` ("plain" | "arrow" | "ornate"), and the same three `inner*`
(`innerHandColor` default "silver").

### wokwi-a4988   (stepper driver)
Pins: `ENABLE`, `MS1`, `MS2`, `MS3`, `RESET`, `SLEEP`, `STEP`, `DIR`, `GND`, `VDD`,
`1B` (motor B-), `1A` (B+), `2A` (A+), `2B` (A-), `VMOT`. No attributes.
ENABLE/RESET/SLEEP are active low — tie RESET to SLEEP, pulled high.
MS1/2/3 select full-step .. 1/16 step (1.8° down to 0.1125°). Angles update every
half-step in 1/8 and 1/16 modes.

---

## Logic, power, and misc

### wokwi-74hc595   (serial-in parallel-out)
Pins: `DS` (serial in), `SHCP` (shift clock), `STCP` (latch), `OE` (active low),
`Q0`–`Q7`, `Q7S` (serial out for chaining), `MR` (clear, active low), `GND`, `VCC`
No attributes. Tie OE to GND and MR to VCC if unused. Use `shiftOut()`.

### wokwi-74hc165   (parallel-in serial-out)
Pins: `D0`–`D7`, `PL` (parallel load, active low), `CP` (clock), `CE` (clock enable,
active low), `Q7`, `Q7_N`, `DS` (serial in for chaining), `GND`, `VCC`
PL low samples D0–D7 (D7 appears on Q7); PL high then CP pulses shift bits out.
Tie CE to GND. Chain Q7 -> DS.

### wokwi-nlsf595   (SPI tri-color LED driver)
Pins: `SI`, `SCK`, `RCK` (latch), `OE` (active low), `QA`–`QH`, `SQH` (serial out),
`SCLR` (clear, active low), `GND`, `VCC`. No attributes.
One unit drives two RGB LEDs; two chained units drive up to five. Chain SQH -> SI.

### wokwi-relay-module
Pins: `VCC`, `GND`, `IN`, `NC`, `COM`, `NO`. Attrs: `transistor` ("npn" default = active
high | "pnp" = active low).
NPN: IN high/disconnected -> COM–NC; IN low -> COM–NO. PNP is inverted.

### wokwi-ks2e-m-dc5   (DPDT relay)
Pins: `COIL1`, `COIL2`, `P1`, `NC1`, `NO1`, `P2`, `NC2`, `NO2`. No attributes.
Unpowered: P1–NC1, P2–NC2. Energized: P1–NO1, P2–NO2.

### wokwi-resistor
Pins: `1`, `2`. Attrs: `value` ohms ("1000").
Only very basic analog simulation — **cannot** be combined with potentiometers or NTC
sensors; usable as an external pull-up/pull-down.

### wokwi-buzzer
Pins: `1` (negative/black), `2` (positive/red)
Attrs: `mode` ("smooth" default — better quality for single tones/melodies, can fail on
polyphony; "accurate" — precise but clicks), `volume` ("1.0", 0.01–1.0)

### wokwi-clock-generator
Pin: `CLK`. Attrs: `frequency` ("10k"; suffix `k` = kHz, `m` = MHz, none = Hz,
e.g. "1.3m", "1"). Above 100 kHz slows the simulation.

### wokwi-ir-receiver
Pins: `GND`, `VCC`, `DAT`. No attributes. 38 kHz, NEC encoding.
Libraries: IRRemote, IRMP. Signals can also be injected manually during simulation.

### wokwi-ir-remote
No pins, no attributes. 38 kHz NEC, address 0, 20 keys. Sample commands:
Power 162 (0xFFA25D, key O), Menu 226 (0xFFE21D, M), Test 34 (0xFF22DD, T),
Plus 2 (0xFF02FD, +), Back 194 (0xFFC23D, B), Prev 224 (0xFFE01F, Left),
Play 168 (0xFFA857, P), Next 144 (0xFF906F, Right), 0 = 104 (0xFF6897),
Minus 152 (0xFF9867, -), C 176 (0xFFB04F), digits 1–9 = 48–82.

### wokwi-microsd-card
Pins: `CD`, `DO` (MISO), `GND`, `SCK`, `VCC`, `DI` (MOSI), `CS`. No attributes.
FAT16 filesystem created at simulation start, max 8 MB; project files are copied onto it.
Paying users can upload binary files. `CD` is always disconnected (card always present).

### wokwi-logic-analyzer
Pins: `D0`–`D7`, `GND`
Attrs: `bufferSize` ("1000000"; 9 bytes/sample, so ~9 MB), `channelNames`
("D0,D1,…,D7"), `filename` ("wokwi-logic", web only — VS Code uses `vcdFile` in
wokwi.toml), `triggerMode` ("off" default | "level" | "edge"),
`triggerLevel` ("high" | "low"), `triggerPin` ("D0"–"D7", default "D7")
Edge: starts on the trigger and records to the end. Level: records only while the
trigger is at the level. Output = VCD (PulseView / GTKWave).

### wokwi-wifi-ap   (paid: Hobby+ / Pro)
No pins. Attrs: `ssid` ("MyNetwork"), `password` ("" = open, WPA2-PSK),
`channel` ("6", 1–13), `internet` ("" = on, "0" = local-only), `bssid` (auto MAC)
Adding any custom AP suppresses the default open "Wokwi-GUEST" network. Multiple parts
simulate several networks. Internet routes through the Wokwi IoT Gateway.

### wokwi-text
No pins. Attrs: `text` ("", multi-line supported). Diagram annotation only.
