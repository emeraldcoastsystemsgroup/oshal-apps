"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the rotor-design vocabulary. Blade geometry,
 *                     |                             | section aerodynamics and blade-element momentum theory are ONE
 *                     |                             | slice on purpose: BEMT cannot be evaluated without a section
 *                     |                             | polar, and a section polar has no consumer without BEMT, so
 *                     |                             | splitting them would put a same-layer cross-import between two
 *                     |                             | halves of a single physical model — which the layering rules
 *                     |                             | forbid and which is how two copies of a stall model end up
 *                     |                             | disagreeing about where the blade stalls.
 */
Object.defineProperty(exports, "__esModule", { value: true });
