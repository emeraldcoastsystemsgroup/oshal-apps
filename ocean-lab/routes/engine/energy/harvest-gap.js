"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the worst-case harvest-gap scan lifted out
 *                     |                             | of the marine slice's longestSlackHours. Kept deliberately
 *                     |                             | unit-agnostic (it only ever asks "sampler below threshold?"),
 *                     |                             | which is what lets the marine wrapper keep scanning in m/s
 *                     |                             | against a cut-in SPEED while a watt-domain caller scans in W.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Both ENDS of every detected gap are now bisected to sub-step
 *                     |                             | precision, and the scan is clipped to the span. The bare
 *                     |                             | sample count reported the SAMPLING STEP, not the null: the
 *                     |                             | ground slice's diurnal gap read 0.8333 h at its shipped 600 s
 *                     |                             | step against a true 0.6997 h — 19% high — and refining the
 *                     |                             | step moved the answer around non-monotonically (0.75 at 900 s,
 *                     |                             | 0.8333 at 600 s) because the quantisation, not the physics,
 *                     |                             | was being measured. Refined, the answer is step-insensitive.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.longestGapHours = longestGapHours;
/**
 * @description Bisection steps used to place each threshold crossing. 40 halvings take a 600 s
 * sampling interval to under a nanosecond, so the reported gap is the CONTINUOUS one to well
 * beyond any physical meaning — and, crucially, the answer stops depending on where the sample
 * grid happened to fall.
 */
const CROSSING_REFINEMENTS = 40;
/**
 * @description Locate the instant between two samples of opposite state where the sampler crosses
 * the threshold, by bisection. Assumes ONE crossing in the bracket, which is the same assumption
 * the sampling itself makes — a bracket containing three crossings was already being reported as
 * one by the sample grid.
 * @param harvestAt - Sampler over time.
 * @param cutInW - Threshold. Units must match the sampler.
 * @param loSeconds - Bracket start; its state differs from the bracket end's.
 * @param hiSeconds - Bracket end.
 * @param hiBelow - Whether the bracket END is below threshold.
 * @returns Crossing instant, seconds.
 */
function crossingSeconds(harvestAt, cutInW, loSeconds, hiSeconds, hiBelow) {
    let lo = loSeconds;
    let hi = hiSeconds;
    for (let i = 0; i < CROSSING_REFINEMENTS; i += 1) {
        const mid = (lo + hi) / 2;
        if (harvestAt(mid) < cutInW === hiBelow)
            hi = mid;
        else
            lo = mid;
    }
    return (lo + hi) / 2;
}
/**
 * @description Length of the longest continuous stretch in which a sampler stays below a
 * threshold. THIS is the number that sizes the battery: it is the gap the node must ride
 * through on stored energy alone, and at a marginal site it can run for days — not the short
 * lull an intuition based on a single environmental cycle suggests.
 *
 * The scan samples on a fixed grid but does NOT report grid multiples: each transition between
 * two samples of opposite state is bisected, so the returned length is the continuous gap rather
 * than the number of samples that happened to land inside it. That distinction is not cosmetic —
 * an un-refined scan reports the sampling step, and a 45-minute null and a 53-minute null read
 * identically at a 600 s step, which is a 20% physics regression the number cannot see.
 *
 * **The one limitation refinement cannot remove:** a gap that opens AND closes entirely between
 * two samples is never detected, because no sample inside it is ever taken. `stepSeconds` must
 * therefore be chosen below the shortest gap that matters — for a diurnal null of tens of
 * minutes, minutes; for the annual null of a buried harvester, hours are ample.
 *
 * The comparison is the only arithmetic here (`harvestAt(t) < cutInW`), so the function is
 * unit-agnostic: **the sampler and the threshold merely have to share units.** Callers scanning
 * in watts pass a power sampler and a cut-in power; the marine slice deliberately passes
 * `|current speed|` against a cut-in SPEED, because thresholding the pre-cube speed is both
 * cheaper and exactly equivalent to thresholding the watts it produces.
 * @param harvestAt - Sampler over time. Units must match `cutInW`.
 * @param cutInW - Threshold below which harvest is treated as zero. Units must match the sampler.
 * @param spanHours - Window to search. Use a full environmental cycle (≥ 30 days for tides).
 * @param stepSeconds - Sample step. Default 60. Must be below the shortest gap of interest.
 * @returns Longest sub-threshold stretch in hours, clipped to the span.
 * @throws If the span or step is not a finite positive number — a zero step made the loop bound
 * `Math.ceil(span/step)` Infinity and hung the scan forever.
 */
function longestGapHours(harvestAt, cutInW, spanHours, stepSeconds = 60) {
    if (!Number.isFinite(spanHours) || spanHours <= 0)
        throw new Error(`spanHours must be a finite positive number, got ${spanHours}`);
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0)
        throw new Error(`stepSeconds must be a finite positive number, got ${stepSeconds}`);
    const spanSeconds = spanHours * 3600;
    const steps = Math.ceil(spanSeconds / stepSeconds);
    let longest = 0;
    let previousT = 0;
    let previousBelow = harvestAt(0) < cutInW;
    // Null while the sampler is above threshold; the gap's refined start instant while below.
    let gapStart = previousBelow ? 0 : null;
    for (let i = 1; i <= steps; i += 1) {
        const t = Math.min(i * stepSeconds, spanSeconds);
        const below = harvestAt(t) < cutInW;
        if (below !== previousBelow) {
            const crossing = crossingSeconds(harvestAt, cutInW, previousT, t, below);
            if (below)
                gapStart = crossing;
            else {
                longest = Math.max(longest, crossing - (gapStart ?? 0));
                gapStart = null;
            }
        }
        previousBelow = below;
        previousT = t;
    }
    // A gap still open at the end is clipped to the span: the scan cannot report a stretch longer
    // than the window it looked at, and rounding it UP to the next whole step was reporting one.
    if (gapStart !== null)
        longest = Math.max(longest, spanSeconds - gapStart);
    return longest / 3600;
}
