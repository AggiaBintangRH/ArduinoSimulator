/**
 * Importing this module registers every built-in part.
 * Registration happens as an import side effect, so this must be imported
 * before a diagram is loaded.
 */

import './led.js';
import './input.js';
import './analog.js';
import './display.js';
import './lcd1602.js';
import './neopixel.js';

export { registeredTypes, getPartDefinition, pinLookup } from '../sim/registry.js';
