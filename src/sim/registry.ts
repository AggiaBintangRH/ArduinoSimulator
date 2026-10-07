/** Registry mapping diagram.json `type` strings to part implementations. */

import type { PartDefinition } from './part.js';
import { boardPins } from '../mcu/boards.js';

const registry = new Map<string, PartDefinition>();

export function registerPart(def: PartDefinition): void {
  if (registry.has(def.type)) {
    throw new Error(`part type ${JSON.stringify(def.type)} is already registered`);
  }
  registry.set(def.type, def);
}

export function getPartDefinition(type: string): PartDefinition | undefined {
  return registry.get(type);
}

export function registeredTypes(): string[] {
  return [...registry.values()].filter((part) => !part.internal).map((part) => part.type).sort();
}

/**
 * Pin lookup in the shape `parseDiagram` expects.
 *
 * Boards are not in the part registry - they are the MCU, not a peripheral -
 * so their headers are looked up separately. Without this a diagram's board
 * pins would skip validation entirely and a typo like `uno:D13` would only
 * surface as a missing wire at run time.
 */
export function pinLookup(type: string): readonly string[] | null {
  return registry.get(type)?.pins ?? boardPins(type);
}

/** Test helper: drop everything so suites stay independent. */
export function clearRegistry(): void {
  registry.clear();
}
