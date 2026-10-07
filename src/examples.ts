/**
 * Built-in example projects.
 *
 * Sketches are ordinary Arduino C++ and need the toolchain to build. Each
 * example also ships a prebuilt `hex` where one is available, so the examples
 * run even with no arduino-cli installed.
 */

import type { Diagram } from './diagram/types.js';
import type { SketchFile } from './build/sketch-files.js';

export interface Example {
  id: string;
  name: string;
  description: string;
  sketch: string;
  /** Headers beside the sketch, for examples that are more than one file. */
  files?: SketchFile[];
  diagram: Diagram;
}

export const EXAMPLES: Example[] = [
  {
    id: 'blink',
    name: 'Blink',
    description: 'The classic: toggle the built-in LED on pin 13 once a second.',
    sketch: `// Blink - the "hello world" of Arduino.
// The LED on pin 13 turns on for a second, then off for a second.

const int LED_PIN = 13;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(1000);
  digitalWrite(LED_PIN, LOW);
  delay(1000);
}
`,
    diagram: {
      version: 1,
      author: 'Arduino Simulator',
      editor: 'wokwi',
      parts: [
        { id: 'uno', type: 'wokwi-arduino-uno', top: 0, left: 0 },
        { id: 'led1', type: 'wokwi-led', top: -80, left: 380, attrs: { color: 'red' } },
        { id: 'r1', type: 'wokwi-resistor', top: 40, left: 360, attrs: { value: '220' } },
      ],
      connections: [
        ['uno:13', 'led1:A', 'green', ['v-40', 'h60']],
        ['led1:C', 'r1:1', 'black', ['v20']],
        ['r1:2', 'uno:GND.1', 'black', ['v60', 'h-200']],
      ],
    },
  },

  {
    id: 'button',
    name: 'Button',
    description: 'Read a pushbutton with the internal pull-up and mirror it to an LED.',
    sketch: `// Press the button to light the LED.
// INPUT_PULLUP means the pin reads HIGH when the button is up,
// and LOW when it is pressed (the button connects the pin to ground).

const int BUTTON_PIN = 2;
const int LED_PIN = 13;

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  bool pressed = digitalRead(BUTTON_PIN) == LOW;
  digitalWrite(LED_PIN, pressed ? HIGH : LOW);
}
`,
    diagram: {
      version: 1,
      editor: 'wokwi',
      parts: [
        { id: 'uno', type: 'wokwi-arduino-uno', top: 0, left: 0 },
        { id: 'btn1', type: 'wokwi-pushbutton', top: 260, left: 120, attrs: { color: 'green' } },
        { id: 'led1', type: 'wokwi-led', top: -80, left: 380, attrs: { color: 'red' } },
      ],
      connections: [
        ['uno:2', 'btn1:1.l', 'green', ['v60', 'h-40']],
        ['btn1:2.l', 'uno:GND.2', 'black', ['v40', 'h-60']],
        ['uno:13', 'led1:A', 'green', ['v-40', 'h60']],
        ['led1:C', 'uno:GND.1', 'black', ['v40']],
      ],
    },
  },

  {
    id: 'potentiometer',
    name: 'Potentiometer fade',
    description: 'Read an analog input and use it to set LED brightness with PWM.',
    sketch: `// Turn the knob to fade the LED.
// analogRead gives 0..1023; analogWrite (PWM) takes 0..255.

const int POT_PIN = A0;
const int LED_PIN = 9;   // pin 9 supports PWM

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int raw = analogRead(POT_PIN);
  int brightness = map(raw, 0, 1023, 0, 255);
  analogWrite(LED_PIN, brightness);

  Serial.println(raw);
  delay(50);
}
`,
    diagram: {
      version: 1,
      editor: 'wokwi',
      parts: [
        { id: 'uno', type: 'wokwi-arduino-uno', top: 0, left: 0 },
        { id: 'pot1', type: 'wokwi-potentiometer', top: 260, left: 220, attrs: { value: '512' } },
        { id: 'led1', type: 'wokwi-led', top: -80, left: 380, attrs: { color: 'blue' } },
      ],
      connections: [
        ['pot1:VCC', 'uno:5V', 'red', ['v40']],
        ['pot1:GND', 'uno:GND.2', 'black', ['v60']],
        ['pot1:SIG', 'uno:A0', 'green', ['v20']],
        ['uno:9', 'led1:A', 'green', ['v-40', 'h80']],
        ['led1:C', 'uno:GND.1', 'black', ['v40']],
      ],
      serialMonitor: { display: 'plotter' },
    },
  },

  {
    id: 'lcd',
    name: 'LCD Hello',
    description: 'Write two lines to a 16x2 character LCD over I2C.',
    sketch: `// Print to a 16x2 LCD over I2C.
// Requires the "LiquidCrystal I2C" library.

#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Hello, world!");
}

void loop() {
  lcd.setCursor(0, 1);
  lcd.print(millis() / 1000);
  lcd.print(" s   ");
  delay(200);
}
`,
    diagram: {
      version: 1,
      editor: 'wokwi',
      parts: [
        { id: 'uno', type: 'wokwi-arduino-uno', top: 0, left: 0 },
        {
          id: 'lcd1',
          type: 'wokwi-lcd1602',
          top: -140,
          left: 260,
          attrs: { pins: 'i2c', background: 'green', color: 'black' },
        },
      ],
      connections: [
        ['lcd1:GND', 'uno:GND.1', 'black', ['v40']],
        ['lcd1:VCC', 'uno:5V', 'red', ['v60']],
        ['lcd1:SDA', 'uno:A4', 'green', ['v80']],
        ['lcd1:SCL', 'uno:A5', 'green', ['v100']],
      ],
    },
  },

  {
    id: 'neopixel',
    name: 'NeoPixel rainbow',
    description: 'Drive an 8-pixel WS2812 strip through a colour cycle.',
    sketch: `// Cycle a rainbow along a WS2812 strip.
// Requires the "Adafruit NeoPixel" library.

#include <Adafruit_NeoPixel.h>

const int PIN = 6;
const int NUM_PIXELS = 8;

Adafruit_NeoPixel strip(NUM_PIXELS, PIN, NEO_GRB + NEO_KHZ800);

void setup() {
  strip.begin();
  strip.setBrightness(64);
  strip.show();
}

void loop() {
  static uint16_t offset = 0;
  for (int i = 0; i < NUM_PIXELS; i++) {
    int hue = (offset + i * 65536L / NUM_PIXELS) % 65536;
    strip.setPixelColor(i, strip.gamma32(strip.ColorHSV(hue)));
  }
  strip.show();
  offset += 512;
  delay(20);
}
`,
    diagram: {
      version: 1,
      editor: 'wokwi',
      parts: [
        { id: 'uno', type: 'wokwi-arduino-uno', top: 0, left: 0 },
        {
          id: 'strip1',
          type: 'wokwi-led-strip',
          top: -120,
          left: 260,
          attrs: { pixels: '8' },
        },
      ],
      connections: [
        ['strip1:VDD', 'uno:5V', 'red', ['v60']],
        ['strip1:VSS', 'uno:GND.1', 'black', ['v80']],
        ['strip1:DIN', 'uno:6', 'green', ['v100']],
      ],
    },
  },
  {
    id: 'mega-chase',
    name: 'Mega LED chase',
    description:
      'Arduino Mega 2560: four LEDs on the D22-D25 bank, with the position reported over Serial.',
    sketch: `// Mega 2560 - LED chase on the extended digital header.
// D22-D25 live on PORTA, which only exists on the Mega.

const int FIRST_LED = 22;
const int NUM_LEDS = 4;

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < NUM_LEDS; i++) {
    pinMode(FIRST_LED + i, OUTPUT);
  }
  Serial.println("Mega chase running");
}

void loop() {
  static int position = 0;
  for (int i = 0; i < NUM_LEDS; i++) {
    digitalWrite(FIRST_LED + i, i == position ? HIGH : LOW);
  }
  Serial.print("led ");
  Serial.println(FIRST_LED + position);
  position = (position + 1) % NUM_LEDS;
  delay(200);
}
`,
    diagram: {
      version: 1,
      editor: 'wokwi',
      parts: [
        { id: 'mega', type: 'wokwi-arduino-mega', top: 0, left: 0 },
        { id: 'led1', type: 'wokwi-led', top: 20, left: 900, attrs: { color: 'red' } },
        { id: 'led2', type: 'wokwi-led', top: 20, left: 950, attrs: { color: 'yellow' } },
        { id: 'led3', type: 'wokwi-led', top: 20, left: 1000, attrs: { color: 'green' } },
        { id: 'led4', type: 'wokwi-led', top: 20, left: 1050, attrs: { color: 'blue' } },
        { id: 'r1', type: 'wokwi-resistor', top: 120, left: 900, attrs: { value: '220' } },
        { id: 'r2', type: 'wokwi-resistor', top: 160, left: 950, attrs: { value: '220' } },
        { id: 'r3', type: 'wokwi-resistor', top: 200, left: 1000, attrs: { value: '220' } },
        { id: 'r4', type: 'wokwi-resistor', top: 240, left: 1050, attrs: { value: '220' } },
      ],
      connections: [
        ['mega:22', 'led1:A', 'green', []],
        ['mega:23', 'led2:A', 'green', []],
        ['mega:24', 'led3:A', 'green', []],
        ['mega:25', 'led4:A', 'green', []],
        ['led1:C', 'r1:2', 'black', []],
        ['led2:C', 'r2:2', 'black', []],
        ['led3:C', 'r3:2', 'black', []],
        ['led4:C', 'r4:2', 'black', []],
        // Drop to the ground rail's height first, then run in. Left to the
        // default route these went horizontal at the resistor's own height,
        // which took them straight across the PCB and down through the header.
        ['r1:1', 'mega:GND.4', 'black', ['v224.4']],
        ['r2:1', 'mega:GND.4', 'black', ['v184.4']],
        ['r3:1', 'mega:GND.5', 'black', ['v144.4']],
        ['r4:1', 'mega:GND.5', 'black', ['v104.4']],
      ],
    },
  },
];

export function getExample(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

export const DEFAULT_EXAMPLE = EXAMPLES[0];
