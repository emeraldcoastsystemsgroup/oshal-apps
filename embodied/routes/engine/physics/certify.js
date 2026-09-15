"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the certification gate (ADR-152 D4/Q4, BACKLOG B19): a trained policy's recorded flight path is replayed point by point through the kinematic sim's own guards — the room fence and `droneClear` against the owner's discovered map — before that policy may fly the plant. The verdict lists every refused point with the guard's reason; unknown space refuses, because a flight through what the map has not seen is not certified by a map.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_REFUSALS_LISTED = void 0;
exports.certifyFlight = certifyFlight;
const quad_model_1 = require("../drone/quad-model");
exports.MAX_REFUSALS_LISTED = 20;
/**
 * @description Replay a flight path through the fence and the map guard. Each point must be inside the room fence and
 * clear of mapped voxels with known air beside it; each hop between points must stay inside the fence.
 * @param sim - The owner's world (its discovered map is the authority). @param trajectory - Points in the world frame.
 * @returns The verdict.
 */
function certifyFlight(sim, trajectory) {
    const fence = { ...sim.fence, keepOut: [] };
    const refused = [];
    let refusedCount = 0;
    const refuse = (index, point, reason) => { refusedCount += 1; if (refused.length < exports.MAX_REFUSALS_LISTED)
        refused.push({ index, point, reason }); };
    let previous = null;
    trajectory.forEach((raw, index) => {
        if (raw.length < 3 || raw.some((v) => !Number.isFinite(v))) {
            refuse(index, [Number.NaN, Number.NaN, Number.NaN], 'not a point');
            return;
        }
        const p = [raw[0], raw[1], raw[2]];
        const inside = (0, quad_model_1.insideFence)(p, fence, sim.droneLimits);
        if (!inside.ok)
            refuse(index, p, inside.reason ?? 'outside the fence');
        else {
            const why = sim.droneClear(p);
            if (why)
                refuse(index, p, why);
            else if (previous) {
                const hop = (0, quad_model_1.segmentClear)(previous, p, fence, sim.droneLimits);
                if (!hop.ok)
                    refuse(index, p, `hop ${hop.reason ?? 'outside the fence'}`);
            }
        }
        previous = p;
    });
    return { ok: trajectory.length > 0 && refusedCount === 0, checked: trajectory.length, refused, refusedCount };
}
//# sourceMappingURL=certify.js.map