/** Registry mapping diagram.json `type` strings to part implementations. */

import type { PartDefinition } from './part.js';

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
  return [...registry.keys()].sort();
}

/** Pin lookup in the shape `parseDiagram` expects. */
export function pinLookup(type: string): readonly string[] | null {
  return registry.get(type)?.pins ?? null;
}

/** Test helper: drop everything so suites stay independent. */
export function clearRegistry(): void {
  registry.clear();
}
