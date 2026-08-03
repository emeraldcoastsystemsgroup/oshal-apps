"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — extracted verbatim from the marine slice.
 *                     |                             | A load set, a store and a closed-loop verdict say nothing
 *                     |                             | about tides: the only thing that made the marine budget
 *                     |                             | marine was where the watts came from. Naming that seam
 *                     |                             | (HarvestSampler) lets a second harvest domain reuse the
 *                     |                             | engine instead of copying its arithmetic and drifting.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Added netEnergyWh. "Ends no worse charged than it started"
 *                     |                             | is unusable as a closure test on a store that starts FULL:
 *                     |                             | the top clamp makes it mean "ends exactly full", which is a
 *                     |                             | property of where the window happens to stop, not of the
 *                     |                             | design. netEnergyWh is the same question asked without a
 *                     |                             | ceiling, so it is capacity-independent and answers the one
 *                     |                             | thing storage genuinely cannot fix.
 */
Object.defineProperty(exports, "__esModule", { value: true });
