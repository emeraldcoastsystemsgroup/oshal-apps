"use strict";
/**
 * The waiver board — the wire ranked by what a claim is worth to YOUR starting lineup over the rest
 * of the season, with the drop that makes room and the bid that buys it (spec 2.2.7).
 *
 * A claim is a swap, not an addition, because a full roster has no free slot:
 *
 *     Δ(c, d) = SV(R − d + c, W) − SV(R, W)          ranked over the best drop d for each c
 *     bid*(c) = B × Δ / (Δ + E_rest)                   the budget's own marginal value
 *
 * where B is the FAAB left and E_rest the value still on the wire besides this claim — spend the
 * share of what is left that this claim is of the value left. Two corrections on top:
 *
 *   - a SCARCITY PREMIUM when the add takes a starting slot from a player at or below the league's
 *     replacement level in more than a third of the remaining weeks — the leftover-running-back case
 *     the operator's roster is in exactly; and
 *   - a HARD CAP at the point where winning leaves less than a minimum bid for every other remaining
 *     week.
 *
 * STREAMING is a separate lane. Defences and kickers (and a second quarterback where the league
 * starts a superflex) are one-week decisions: priced on THIS week only, against the player they would
 * replace, with no bid drawn from the rest-of-season budget. They never enter the rest-of-season
 * lane, never count toward E_rest, and never move its bids.
 *
 * NOTHING IS CLAIMED. This computes a board; no route here submits a claim anywhere.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — rest-of-season swap value over the best drop, the FAAB bid with a replacement-level scarcity premium and a reserve cap, and an isolated one-week streaming lane.
 *
 * @module fantasy-waivers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WIRE_DEPTH = exports.RESERVE_PER_WEEK = exports.SCARCITY_SHARE = exports.SCARCITY_PREMIUM = exports.STREAM_POSITIONS = void 0;
exports.bidFor = bidFor;
exports.waiverBoard = waiverBoard;
const fantasy_scoring_1 = require("./fantasy-scoring");
const fantasy_season_1 = require("./fantasy-season");
/** ESPN positions streamed week to week: 16 D/ST, 17 K. A superflex league adds 1 QB. */
exports.STREAM_POSITIONS = new Set([16, 17]);
/** ESPN's superflex (OP) lineup slot. */
const SUPERFLEX_SLOT = 7;
/** Uplift on a bid when the add replaces a replacement-level starter. A stated parameter. */
exports.SCARCITY_PREMIUM = 0.25;
/** The share of remaining weeks above which a starter counts as "a replacement" there. */
exports.SCARCITY_SHARE = 1 / 3;
/** Dollars kept back per remaining week so one claim cannot spend the season. A stated parameter. */
exports.RESERVE_PER_WEEK = 1;
/** How many wire players are priced in full; the rest of the wire cannot beat these on this week. */
exports.WIRE_DEPTH = 40;
/**
 * @description Whether a position is streamed in this league.
 * @param positionId - ESPN defaultPositionId.
 * @param plan - The plan (for the league's slots).
 * @returns True for the streaming lane.
 */
function isStreamed(positionId, plan) {
    if (exports.STREAM_POSITIONS.has(positionId))
        return true;
    return positionId === 1 && plan.slots.some((s) => s.slotId === SUPERFLEX_SLOT && s.count > 0);
}
/**
 * @description The wire worth pricing: players nobody rosters, projected to score this week, best
 * first, at most WIRE_DEPTH per lane.
 * @param input - The board inputs.
 * @returns The candidates, by lane.
 */
function wireCandidates(input) {
    const held = new Set(input.rosteredIds);
    const week = input.plan.weeks[0]?.week;
    const scored = Object.values(input.pool)
        .filter((p) => !held.has(p.playerId))
        .map((p) => ({ p, points: week === undefined ? 0 : (0, fantasy_scoring_1.applyScoring)(p.projectedStats, input.plan.scoring) }))
        .filter((x) => x.points > 0)
        .sort((a, b) => b.points - a.points);
    const season = scored.filter((x) => !isStreamed(Number(x.p.defaultPositionId), input.plan)).slice(0, exports.WIRE_DEPTH).map((x) => x.p);
    const stream = scored.filter((x) => isStreamed(Number(x.p.defaultPositionId), input.plan)).slice(0, exports.WIRE_DEPTH).map((x) => x.p);
    return { season, stream };
}
/**
 * @description Price one rest-of-season claim: the best drop for it, the gain, and whether it takes
 * a replacement-level starter's slot in more than a third of the weeks.
 * @param c - The wire player.
 * @param input - The board inputs.
 * @param base - SV(R).
 * @param replacement - Replacement points by position.
 * @returns The priced row without a bid, or null when no swap gains.
 */
function priceClaim(c, input, base, replacement) {
    const withC = [...input.rosterIds, c.playerId];
    const drop = (0, fantasy_season_1.dropCandidate)(withC, input.plan, (0, fantasy_season_1.seasonValue)(withC, input.plan), [c.playerId]);
    if (!drop)
        return null;
    const after = (0, fantasy_season_1.seasonValue)(withC.filter((id) => id !== drop.playerId), input.plan);
    const gain = Math.round((after.total - base.total) * 100) / 100;
    if (!(gain > 0))
        return null;
    const started = (0, fantasy_season_1.weeksStarted)(c.playerId, after);
    const displacedReplacement = started.filter((w) => displacesReplacement(c.playerId, w, base, after, replacement, input.plan)).length;
    const dropped = input.plan.playerFor(drop.playerId, input.plan.weeks[0].week) || input.pool[drop.playerId];
    return {
        add: { playerId: c.playerId, name: c.name, positionId: Number(c.defaultPositionId) || null },
        drop: { playerId: drop.playerId, name: dropped?.name || `Player ${drop.playerId}` },
        gain,
        weeksStarting: started.length,
        scarcity: displacedReplacement > input.plan.weeks.length * exports.SCARCITY_SHARE,
    };
}
/**
 * @description Whether, in week w, the add takes a slot whose previous occupant scored at or below
 * the league's replacement level for his position (or the slot was empty).
 * @param addId - The player added.
 * @param week - The week.
 * @param base - SV(R) with its starters.
 * @param after - SV after the swap.
 * @param replacement - Replacement points by position.
 * @param plan - The plan.
 * @returns True when the add replaces a replacement.
 */
function displacesReplacement(addId, week, base, after, replacement, plan) {
    const slot = after.weeks.find((w) => w.week === week)?.starters.find((s) => s.playerId === addId)?.slotId;
    const before = base.weeks.find((w) => w.week === week);
    if (slot === undefined || !before)
        return false;
    const stillStarting = new Set(after.weeks.find((w) => w.week === week)?.starters.map((s) => s.playerId));
    const displaced = before.starters.filter((s) => s.slotId === slot && !stillStarting.has(s.playerId));
    if (!displaced.length)
        return before.starters.filter((s) => s.slotId === slot).length < plan.slots.filter((s) => s.slotId === slot).reduce((n, s) => n + s.count, 0);
    return displaced.some((s) => {
        const p = plan.playerFor(s.playerId, week);
        const level = replacement[Number(p?.defaultPositionId)];
        return level !== undefined && s.points <= level;
    });
}
/**
 * @description The bid for one claim: the budget's marginal value, the scarcity premium, the cap.
 * @param gain - Δ for the claim.
 * @param others - E_rest: the value on the wire besides this claim.
 * @param scarcity - Whether the premium applies.
 * @param budget - FAAB left.
 * @param cap - The most one claim may spend.
 * @returns Whole dollars.
 */
function bidFor(gain, others, scarcity, budget, cap) {
    if (!(gain > 0) || !(budget > 0))
        return 0;
    const share = gain / (gain + Math.max(others, 0));
    const raw = budget * share * (scarcity ? 1 + exports.SCARCITY_PREMIUM : 1);
    return Math.max(0, Math.min(Math.floor(raw), cap));
}
/**
 * @description Build the board: the rest-of-season lane ranked by Δ with a bid and a drop on every
 * row, and the streaming lane beside it.
 * @param input - The plan, rosters, this week's pool and the budget.
 * @returns The board.
 */
function waiverBoard(input) {
    const base = (0, fantasy_season_1.seasonValue)(input.rosterIds, input.plan);
    const { byPosition } = (0, fantasy_season_1.replacementLevel)(Object.values(input.pool), input.plan.slots, input.plan.scoring, input.teams);
    const { season, stream } = wireCandidates(input);
    const priced = season.map((c) => priceClaim(c, input, base, byPosition)).filter((r) => r !== null)
        .sort((a, b) => b.gain - a.gain);
    const wireValue = Math.round(priced.reduce((s, r) => s + r.gain, 0) * 100) / 100;
    const cap = input.budget === null ? null : Math.max(0, input.budget - exports.RESERVE_PER_WEEK * Math.max(input.plan.weeks.length - 1, 0));
    const rows = priced.map((r) => ({
        ...r,
        cap,
        bid: input.budget === null ? null : bidFor(r.gain, wireValue - r.gain, r.scarcity, input.budget, cap),
    }));
    return { rows, streaming: streamingLane(stream, input), budget: input.budget, cap, wireValue, replacement: byPosition };
}
/**
 * @description The one-week lane: each streamer against the player of his position he would replace
 * this week — or, where he fills a slot nobody of his position holds (a superflex quarterback), the
 * player the rest-of-season value says costs least to cut — gain on THIS week only, never a bid.
 * @param stream - Streaming candidates.
 * @param input - The board inputs.
 * @returns Rows with a positive one-week gain, best first.
 */
function streamingLane(stream, input) {
    const thisWeek = { ...input.plan, weeks: input.plan.weeks.slice(0, 1).map((w) => ({ ...w, weight: 1 })) };
    if (!thisWeek.weeks.length)
        return [];
    const base = (0, fantasy_season_1.seasonValue)(input.rosterIds, thisWeek);
    const cheapest = (0, fantasy_season_1.dropCandidate)(input.rosterIds, input.plan)?.playerId;
    const rows = [];
    for (const c of stream) {
        const samePosition = input.rosterIds.filter((id) => {
            const p = input.pool[id];
            return Number(p?.defaultPositionId) === Number(c.defaultPositionId);
        });
        const drops = cheapest === undefined || samePosition.includes(cheapest) ? samePosition : [...samePosition, cheapest];
        let best = null;
        for (const d of drops) {
            const after = (0, fantasy_season_1.seasonValue)([...input.rosterIds.filter((id) => id !== d), c.playerId], thisWeek);
            const gain = Math.round((after.total - base.total) * 100) / 100;
            if (gain > 0 && (!best || gain > best.gain)) {
                best = { add: { playerId: c.playerId, name: c.name, positionId: Number(c.defaultPositionId) || null },
                    drop: { playerId: d, name: input.pool[d]?.name || `Player ${d}` }, gain, horizon: 'this-week', bid: 0 };
            }
        }
        if (best)
            rows.push(best);
    }
    return rows.sort((a, b) => b.gain - a.gain);
}
//# sourceMappingURL=fantasy-waivers.js.map