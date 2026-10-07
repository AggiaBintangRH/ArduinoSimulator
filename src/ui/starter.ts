/**
 * The project a board starts from when it is picked on the dashboard.
 *
 * Deliberately small: the chosen board, one LED on the built-in LED pin, and a
 * blink sketch. It is the shortest path from "I picked a Mega" to something
 * that visibly runs.
 */

import type { BoardDefinition } from '../mcu/boards.js';
import { getVisual } from '../render/shapes.js';
import type { Project } from '../storage.js';

/** The board's first ground pad, whatever the board calls it. */
function firstGround(board: BoardDefinition): string {
  return board.pins.find((name) => name.startsWith('GND')) ?? 'GND';
}

function blinkSketch(board: BoardDefinition): string {
  return `// Blink on the ${board.label}.
// LED_BUILTIN is pin ${board.builtinLed} on this board.

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);
}
`;
}

export function starterProject(board: BoardDefinition): Project {
  // Park the LED clear of the board rather than at a fixed offset, so it does
  // not land on top of a board that happens to be wider.
  const boardWidth = getVisual(board.type).width;
  const ledLeft = boardWidth + 80;

  return {
    name: `${board.label} blink`,
    sketch: blinkSketch(board),
    libraries: [],
    files: [],
    diagram: {
      version: 1,
      editor: 'wokwi',
      parts: [
        { id: 'board', type: board.type, top: 0, left: 0 },
        { id: 'led1', type: 'wokwi-led', top: 20, left: ledLeft, attrs: { color: 'red' } },
        { id: 'r1', type: 'wokwi-resistor', top: 120, left: ledLeft - 20, attrs: { value: '220' } },
      ],
      connections: [
        [`board:${board.builtinLed}`, 'led1:A', 'green', []],
        ['led1:C', 'r1:2', 'black', []],
        ['r1:1', `board:${firstGround(board)}`, 'black', []],
      ],
    },
  };
}
