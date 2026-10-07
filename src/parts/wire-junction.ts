import { registerPart } from '../sim/registry.js';

/** Internal part used to represent an electrical branch in diagram.json. */
export const WIRE_JUNCTION_TYPE = 'wokwi-wire-junction';
export const WIRE_JUNCTION_PIN = '1';
export const WIRE_JUNCTION_SIZE = 12;
export const WIRE_JUNCTION_CENTER = WIRE_JUNCTION_SIZE / 2;

registerPart({
  type: WIRE_JUNCTION_TYPE,
  pins: [WIRE_JUNCTION_PIN],
  internal: true,
  create: () => ({
    init(context) {
      // The junction has no behavior of its own; this pin joins every branch
      // through the simulator's existing netlist.
      context.pinInit(WIRE_JUNCTION_PIN);
    },
  }),
});
