"use strict";
/**
 * The two-sided trade finder (spec 2.2.8) — trades the OTHER manager gains from too.
 *
 * A trade is two season values per side. For your roster R, their roster T, a give-set g ⊆ R and a
 * get-set h ⊆ T:
 *
 *     Δ_you  = SV(R − g + h) − SV(R)
 *     Δ_them = SV(T − h + g) − SV(T)
 *
 * PROPOSE ONLY WHEN BOTH ARE POSITIVE. Those trades exist far more often than they look like they
 * should, because rosters have different slot pressure: a manager who starts three receivers and
 * rosters six has a fourth receiver whose value TO THEM is near zero — he never reaches their
 * lineup — while the same player fills a hole in yours. "Your draft's damage is someone else's
 * surplus", and this search is how you find it. A proposal that is good only for you is not a
 * proposal; it is a request to be refused, so it is never surfaced.
 *
 * The search is bounded to 1-for-1 and 2-for-1 (you give two, get one) among each side's most valuable
 * players over the remaining weeks — STARTERS OR NOT, because a surplus bench player who never reaches
 * his own lineup is exactly what the other side is short of — and when a side ends up one player over, its own least-costly
 * drop is taken before its value is counted — a trade that forces them to cut a starter is priced as
 * one. Both gains are shown on every proposal; the other manager's gain is the argument that gets a
 * trade accepted.
 *
 * NOTHING IS PROPOSED ON ESPN. This computes candidates; no route here sends an offer anywhere.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — 1-for-1 and 2-for-1 search over every other roster's most valuable players (starters or not), both sides valued with SV over their own rosters (a side left over its roster size drops its least-costly player first), surfaced only when both gains clear the threshold, ranked by your gain; the search yields to the event loop between teams (a twelve-team, fifteen-week league measured 848 ms in all, longest block 97 ms).
 *
 * @module fantasy-trades
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRADE_BREADTH = exports.TRADE_LIMIT = exports.TRADE_THRESHOLD = void 0;
exports.tradeable = tradeable;
exports.sideAfter = sideAfter;
exports.findTrades = findTrades;
const fantasy_scoring_1 = require("./fantasy-scoring");
const fantasy_season_1 = require("./fantasy-season");
/** The least either side must gain, in weighted points, for a proposal to surface. */
exports.TRADE_THRESHOLD = 0.5;
/** Proposals returned, best for you first. */
exports.TRADE_LIMIT = 15;
/** How many of each side's players the search considers, most projected points over the plan first. */
exports.TRADE_BREADTH = 8;
/**
 * @description The players on a roster worth trading for or away: the most projected points over the
 * plan's weeks, starters or not, at most TRADE_BREADTH, and never a player projected for nothing.
 * @param rosterIds - The roster.
 * @param plan - The season plan.
 * @returns Player ids, most valuable first.
 */
function tradeable(rosterIds, plan) {
    const worth = rosterIds.map((id) => ({
        id,
        points: plan.weeks.reduce((s, w) => s + w.weight * (0, fantasy_scoring_1.applyScoring)(plan.playerFor(id, w.week)?.projectedStats, plan.scoring), 0),
    }));
    return worth.filter((x) => x.points > 0).sort((a, b) => b.points - a.points).slice(0, exports.TRADE_BREADTH).map((x) => x.id);
}
/**
 * @description One side's value after a trade: out goes `out`, in comes `incoming`, and when the side
 * ends up above its original size it drops its least-costly player (never one just received).
 * @param rosterIds - The side's roster.
 * @param out - Players leaving.
 * @param incoming - Players arriving.
 * @param plan - The season plan.
 * @returns The value after, and the drop made (or null).
 */
function sideAfter(rosterIds, out, incoming, plan) {
    const next = [...rosterIds.filter((id) => !out.includes(id)), ...incoming];
    if (next.length <= rosterIds.length)
        return { value: (0, fantasy_season_1.seasonValue)(next, plan).total, drop: null };
    const drop = (0, fantasy_season_1.dropCandidate)(next, plan, undefined, incoming);
    const kept = next.filter((id) => id !== drop?.playerId);
    return { value: (0, fantasy_season_1.seasonValue)(kept, plan).total, drop: drop ? drop.playerId : null };
}
/**
 * @description Every give/get combination to try against one team: 1-for-1 and you-give-2-get-1.
 * @param mine - Your tradeable players.
 * @param theirs - Their tradeable players.
 * @returns Pairs of [give, get].
 */
function combinations(mine, theirs) {
    const out = [];
    for (const h of theirs) {
        for (let i = 0; i < mine.length; i += 1) {
            out.push([[mine[i]], [h]]);
            for (let j = i + 1; j < mine.length; j += 1)
                out.push([[mine[i], mine[j]], [h]]);
        }
    }
    return out;
}
/**
 * @description Search every other team for trades both sides gain from.
 * @param mine - Your team.
 * @param others - Every other team in the league.
 * @param plan - The season plan (the same league: same slots and scoring for both sides).
 * @param threshold - The least each side must gain to surface.
 * @param limit - How many proposals to return.
 * @returns Proposals, best for you first; never one with Δ_them at or below the threshold. Yields to
 * the event loop between teams.
 */
async function findTrades(mine, others, plan, threshold = exports.TRADE_THRESHOLD, limit = exports.TRADE_LIMIT) {
    const myBase = (0, fantasy_season_1.seasonValue)(mine.rosterIds, plan);
    const myTradeable = tradeable(mine.rosterIds, plan);
    const proposals = [];
    for (const team of others) {
        if (team.teamId === mine.teamId)
            continue;
        // One team at a time, handing the event loop back between them: a twelve-team league is
        // thousands of season values, and the api serves everyone else meanwhile.
        await new Promise((resolve) => setImmediate(resolve));
        const theirBase = (0, fantasy_season_1.seasonValue)(team.rosterIds, plan);
        for (const [give, get] of combinations(myTradeable, tradeable(team.rosterIds, plan))) {
            const you = sideAfter(mine.rosterIds, give, get, plan);
            const youGain = round2(you.value - myBase.total);
            if (!(youGain > threshold))
                continue;
            const them = sideAfter(team.rosterIds, get, give, plan);
            const themGain = round2(them.value - theirBase.total);
            if (!(themGain > threshold))
                continue;
            proposals.push({ teamId: team.teamId, teamName: team.name, give, get, youGain, themGain, youDrop: you.drop, themDrop: them.drop });
        }
    }
    return proposals.sort((a, b) => b.youGain - a.youGain || b.themGain - a.themGain).slice(0, limit);
}
/** Rounds to two decimals. */
function round2(n) {
    return Math.round(n * 100) / 100;
}
//# sourceMappingURL=fantasy-trades.js.map