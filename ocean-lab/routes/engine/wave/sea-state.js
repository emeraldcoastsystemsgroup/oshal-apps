"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the sea-state table and the year it adds up to:
 *                     |                             | one equilibrium per row of a site's table, then the
 *                     |                             | occurrence-weighted mean speed, the share of the year under
 *                     |                             | way, km/day and km/year — the figures the explorer design
 *                     |                             | study published, recomputed from a vector instead of typed.
 *                     |                             | Knots are the international nautical mile (1852 m); a day is
 *                     |                             | 86 400 s; a year is 365 days.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.knots = knots;
exports.kmPerDay = kmPerDay;
exports.evaluateSeaStates = evaluateSeaStates;
const wave_propulsion_1 = require("./wave-propulsion");
/** @description Metres per nautical mile. */
const METRES_PER_NAUTICAL_MILE = 1852;
/** @description Kilometres per day at one metre per second. */
const KM_PER_DAY_PER_MS = 86.4;
/** @description Days in the year the annual figure is taken over. */
const DAYS_PER_YEAR = 365;
/** @description m/s to knots. @param ms - Speed. @returns Knots. */
function knots(ms) {
    return (ms * 3600) / METRES_PER_NAUTICAL_MILE;
}
/** @description m/s to km/day. @param ms - Speed. @returns km/day. */
function kmPerDay(ms) {
    return ms * KM_PER_DAY_PER_MS;
}
/**
 * @description Evaluate every sea state of a site and add the year up. The mean is weighted by
 * occurrence over the WHOLE year (a drifting row contributes its speed, zero or not), which is how
 * the study's 0.46 knots and 20.4 km/day relate: km/day is the mean speed times a day.
 * @param v - The vehicle. @param fluid - The fluid. @param site - The site's table.
 * @returns The rows and the annual figures.
 * @throws RangeError when the occurrences do not sum to one — a year that is not a year.
 */
function evaluateSeaStates(v, fluid, site) {
    const total = site.seaStates.reduce((sum, s) => sum + s.occurrence, 0);
    if (Math.abs(total - 1) > 1e-6)
        throw new RangeError(`the sea-state occurrences sum to ${total}, not 1`);
    const rows = site.seaStates.map((sea) => {
        const eq = (0, wave_propulsion_1.equilibrium)(v, fluid, sea);
        return {
            id: sea.id, label: sea.label, heightM: sea.heightM, periodS: sea.periodS, occurrence: sea.occurrence,
            speedMs: eq.speedMs, knots: knots(eq.speedMs), kmPerDay: kmPerDay(eq.speedMs),
            peakHeaveMs: eq.peakHeaveMs, ceilingMs: eq.ceilingMs, underWay: eq.speedMs >= site.underWayMinSpeedMs,
        };
    });
    const meanSpeedMs = rows.reduce((sum, r) => sum + r.occurrence * r.speedMs, 0);
    return {
        rows,
        meanSpeedMs,
        meanKnots: knots(meanSpeedMs),
        underWayFraction: rows.filter((r) => r.underWay).reduce((sum, r) => sum + r.occurrence, 0),
        kmPerDay: kmPerDay(meanSpeedMs),
        kmPerYear: kmPerDay(meanSpeedMs) * DAYS_PER_YEAR,
        engine: { id: wave_propulsion_1.WAVE_ENGINE.id, version: wave_propulsion_1.WAVE_ENGINE.version },
    };
}
