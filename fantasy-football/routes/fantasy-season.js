"use strict";
/**
 * Rest-of-season value — the one function waivers, trades and drafting all rest on.
 *
 * "Build from the team out" (operator, 2026-09-06) is this module. A roster decision is not "who is
 * the better player", it is the change in the points your STARTING lineup will actually score over
 * the weeks that remain:
 *
 *     L(R, w)   = the best legal starting lineup R can field in week w      (optimiseLineup, exact)
 *     SV(R, W)  = Σ_{w ∈ W} ω_w · L(R, w)                                   (seasonValue)
 *     MV(c | R) = SV(R + c, W) − SV(R, W)                                   (marginalValue)
 *     Δ(c, d)   = SV(R − d + c, W) − SV(R, W)                               (swapValue)
 *
 * Drafting and managing differ only in W. Bye collisions, handcuffs, depth and positional scarcity
 * all price themselves: a third running back is worth exactly the weeks he would start, the week
 * your only quarterback is on a bye is a week L falls to nobody, and the drop candidate is simply
 * the player whose removal costs least.
 *
 * WHERE EACH WEEK'S NUMBERS COME FROM is the caller's choice, handed in as a `SeasonPlan`: a
 * projection per player per week (or none — a bye, or not projected), and a weight per week. This
 * module never reads ESPN or the database, so it is exercised by plain-node guards against the same
 * function the routes call, and it cannot tell a hand-typed league from a connected one.
 *
 * Replacement level is the league's own shape (spec 2.2.3): how many players of a position actually
 * start in a league this size, and the mean of the next three after them. It is what makes "your
 * starter is a replacement" a fact about THIS league rather than a rank on a website.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — weekly optimal lineup over a season plan (weeks with the same input signature solved once; a player who starts nowhere is a zero-cost drop found without another solve), SV/MV and swap value, the least-costly drop, the weeks a player would start, and replacement level from the league's own shape (teams × starting slots, flex openings allocated to the best remaining eligible players).
 *
 * @module fantasy-season
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.seasonValue = seasonValue;
exports.marginalValue = marginalValue;
exports.swapValue = swapValue;
exports.dropCandidate = dropCandidate;
exports.weeksStarted = weeksStarted;
exports.replacementLevel = replacementLevel;
const fantasy_scoring_1 = require("./fantasy-scoring");
/**
 * @description The roster as it would be fielded in one week: every player's projection for that
 * week, and nobody who is not projected to play it.
 * @param rosterIds - Player ids on the roster.
 * @param plan - The season plan.
 * @param week - The week.
 * @returns Players available that week.
 */
function weekRoster(rosterIds, plan, week) {
    const out = [];
    for (const id of rosterIds) {
        const p = plan.playerFor(id, week);
        if (p)
            out.push(p);
    }
    return out;
}
/**
 * @description SV(R, W): the weighted sum of the roster's best legal starting lineup in every week of
 * the plan.
 * @param rosterIds - Player ids on the roster (duplicates ignored).
 * @param plan - The season plan.
 * @returns The total and each week's value and starters.
 */
function seasonValue(rosterIds, plan) {
    const ids = [...new Set(rosterIds)];
    const solved = new Map();
    const weeks = plan.weeks.map(({ week, weight }) => {
        const key = plan.signature?.(week) ?? null;
        const hit = key === null ? undefined : solved.get(key);
        if (hit)
            return { week, weight, ...hit };
        const lineup = (0, fantasy_scoring_1.optimiseLineup)(weekRoster(ids, plan, week), plan.slots, plan.scoring);
        const value = {
            value: lineup.total,
            starters: lineup.starters.map((s) => ({ playerId: s.player.playerId, slotId: s.slotId, points: s.points })),
        };
        if (key !== null)
            solved.set(key, value);
        return { week, weight, ...value };
    });
    return { total: round2(weeks.reduce((s, w) => s + w.weight * w.value, 0)), weeks };
}
/**
 * @description MV(c | R) = SV(R + c) − SV(R): what adding one player is worth over the plan.
 * @param candidateId - The player considered.
 * @param rosterIds - The roster.
 * @param plan - The season plan.
 * @param base - SV(R), when the caller already has it.
 * @returns Points gained over the plan (never negative: a player you never start adds nothing).
 */
function marginalValue(candidateId, rosterIds, plan, base) {
    const before = base ?? seasonValue(rosterIds, plan);
    return round2(seasonValue([...rosterIds, candidateId], plan).total - before.total);
}
/**
 * @description Δ(c, d) = SV(R − d + c) − SV(R): what swapping one player for another is worth. A full
 * roster has no free slot, so a claim is a swap, not an addition.
 * @param addId - The player added.
 * @param dropId - The player dropped.
 * @param rosterIds - The roster.
 * @param plan - The season plan.
 * @param base - SV(R), when the caller already has it.
 * @returns Points gained (negative when the swap costs).
 */
function swapValue(addId, dropId, rosterIds, plan, base) {
    const before = base ?? seasonValue(rosterIds, plan);
    const after = seasonValue([...rosterIds.filter((id) => id !== dropId), addId], plan);
    return round2(after.total - before.total);
}
/**
 * @description The drop candidate: argmin over d of SV(R) − SV(R − d).
 *
 * A player who starts in no week of SV(R) costs exactly nothing to drop — SV never rises when a
 * player leaves, so zero is the minimum — and finding him needs no further solve. Among several,
 * the one projected for the fewest points over the plan goes first. Only when everyone starts
 * somewhere is each removal priced in full.
 * @param rosterIds - The roster.
 * @param plan - The season plan.
 * @param base - SV(R), when the caller already has it.
 * @param exclude - Players that may not be dropped (for instance the one just added).
 * @returns The candidate, or null for an empty roster.
 */
function dropCandidate(rosterIds, plan, base, exclude = []) {
    const before = base ?? seasonValue(rosterIds, plan);
    const starting = new Set(before.weeks.flatMap((w) => w.starters.map((s) => s.playerId)));
    const idle = rosterIds.filter((id) => !exclude.includes(id) && !starting.has(id));
    if (idle.length) {
        const projected = (id) => plan.weeks.reduce((s, w) => s + (0, fantasy_scoring_1.applyScoring)(plan.playerFor(id, w.week)?.projectedStats, plan.scoring), 0);
        const pick = idle.reduce((a, b) => (projected(b) < projected(a) ? b : a));
        return { playerId: pick, cost: 0 };
    }
    let best = null;
    for (const id of rosterIds) {
        if (exclude.includes(id))
            continue;
        const cost = round2(before.total - seasonValue(rosterIds.filter((x) => x !== id), plan).total);
        if (!best || cost < best.cost - 1e-9)
            best = { playerId: id, cost };
    }
    return best;
}
/**
 * @description The weeks of the plan in which a player is in the best starting lineup.
 * @param playerId - The player.
 * @param value - A season value that includes him.
 * @returns Week numbers.
 */
function weeksStarted(playerId, value) {
    return value.weeks.filter((w) => w.starters.some((s) => s.playerId === playerId)).map((w) => w.week);
}
/**
 * @description Replacement level per position from the league's own shape (spec 2.2.3). Each of
 * `teams` teams fields every starting opening; openings a single position may fill take the best
 * players of that position, flexible openings then take the best remaining eligible players of any
 * position. R_pos is how many of a position start league-wide; B_pos is the mean projection of the
 * next three. A 12-team 2RB/3WR/1FLEX league and a 10-team 1FLEX league get different baselines,
 * which is the point.
 * @param pool - Every player available this week, with ESPN `defaultPositionId`.
 * @param slots - The league's starting slots.
 * @param scoring - The league's scoring rules.
 * @param teams - Teams in the league.
 * @returns Replacement points by position id, and how many of each start.
 */
function replacementLevel(pool, slots, scoring, teams) {
    const ranked = pool.filter(fantasy_scoring_1.isAvailable)
        .map((p) => ({ p, pos: Number(p.defaultPositionId) || 0, points: (0, fantasy_scoring_1.applyScoring)(p.projectedStats, scoring) }))
        .sort((a, b) => b.points - a.points);
    const positions = [...new Set(ranked.map((r) => r.pos))];
    const eligible = (slotId) => positions.filter((pos) => ranked.some((r) => r.pos === pos && r.p.eligibleSlots.includes(slotId)));
    const taken = new Set();
    const starters = {};
    const fill = (slotId, count) => {
        for (let i = 0; i < count; i += 1) {
            const pick = ranked.find((r) => !taken.has(r.p.playerId) && r.p.eligibleSlots.includes(slotId));
            if (!pick)
                return;
            taken.add(pick.p.playerId);
            starters[pick.pos] = (starters[pick.pos] || 0) + 1;
        }
    };
    const dedicated = slots.filter((s) => eligible(s.slotId).length <= 1);
    const flexible = slots.filter((s) => eligible(s.slotId).length > 1);
    for (const s of dedicated)
        fill(s.slotId, s.count * teams);
    for (const s of flexible)
        fill(s.slotId, s.count * teams);
    const byPosition = {};
    for (const pos of positions) {
        const next = ranked.filter((r) => r.pos === pos && !taken.has(r.p.playerId)).slice(0, 3);
        byPosition[pos] = next.length ? round2(next.reduce((s, r) => s + r.points, 0) / next.length) : 0;
    }
    return { byPosition, starters };
}
/** Rounds to two decimals, the precision every points figure in this package uses. */
function round2(n) {
    return Math.round(n * 100) / 100;
}
//# sourceMappingURL=fantasy-season.js.map