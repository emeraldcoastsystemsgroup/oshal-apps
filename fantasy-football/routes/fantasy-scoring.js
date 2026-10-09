"use strict";
/**
 * Fantasy scoring and lineup optimisation — pure functions, no I/O.
 *
 * THE CENTRAL FACT ABOUT ESPN'S PROJECTIONS, and it dictates this module's whole shape: ESPN
 * publishes per-player, per-week projections as RAW STATS, not as fantasy points. The `appliedTotal`
 * field that looks like a point total is null in the public feed, because a fantasy point total is
 * meaningless without a league's scoring rules — half a point per reception or one, four points for
 * a passing touchdown or six. Measured on the live feed 2026-09-08: 29,281 weekly projection rows,
 * ZERO with a usable `appliedTotal`, and the raw stat maps fully populated (Travis Kelce week 1:
 * 43.18 receiving yards, 0.22 receiving touchdowns, 4.0 receptions).
 *
 * So points are computed here instead, and the league supplies the multipliers. ESPN's `mSettings`
 * view returns `scoringItems` as `{statId, points}` pairs — which means this module NEVER needs a
 * hardcoded table of what stat id 24 means. It multiplies the projected value for each stat id by
 * that league's points for the same id and sums. A hardcoded stat dictionary would be a guess that
 * silently mis-scores every player in a non-standard league; the league's own settings cannot be.
 *
 * LINEUP OPTIMISATION is a small assignment problem — roughly fifteen players into nine slots with
 * eligibility constraints — and it is solved EXACTLY, as a maximum-weight bipartite assignment of
 * players to slot openings (the Hungarian method). The greedy-by-scarcity pass this module used to
 * run was only "optimal in practice": against brute force over 3,000 random rosters it lost points
 * on 6, by as much as 21, whenever a dual-position player and two flexible slots met. The rest of
 * season value is a sum of these weekly optima, so an optimiser that is wrong one week in five
 * hundred is wrong somewhere in every season total.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — league-scoring application over ESPN's raw projected stats (no hardcoded stat dictionary), slot-eligibility lineup optimisation with pairwise improvement, and the start/sit diff against the lineup actually set.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Take ScoringItem, LineupSlot and FantasyPlayer from the fantasy-leagues kernel skill (ADR-146 D2), which reads them from ESPN, and re-export them so this package's modules import them from here unchanged. Type-only: no emitted code changes. One definition instead of a package copy that had to stay structurally identical to the client's.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Moved from sports-edge (sports-fantasy-scoring.ts, SEQ 1-2 above) into the fantasy-football package (ADR-146 D1, operator decision 2026-09-27). Scoring and start/sit are unchanged. optimiseLineup is now an EXACT assignment (Hungarian method over slot openings, fill-first then points) instead of greedy-by-scarcity plus bench swaps: a brute-force comparison over 3,000 random rosters found the greedy lineup short on 6 of them (up to 21 points) where a dual-position player met two flexible slots, and the rest-of-season value this package now computes is a sum of these weekly optima.
 *
 * @module fantasy-scoring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNAVAILABLE_STATUSES = void 0;
exports.applyScoring = applyScoring;
exports.isAvailable = isAvailable;
exports.optimiseLineup = optimiseLineup;
exports.startSitCalls = startSitCalls;
/**
 * @description Fantasy points for a stat line under one league's scoring rules. Stats the league
 * does not score contribute nothing; rules for stats the player did not accrue contribute nothing.
 * Neither case is an error — a league simply may not score a category.
 * @param stats - Raw stats keyed by ESPN stat id.
 * @param scoring - The league's scoring rules.
 * @returns Fantasy points.
 */
function applyScoring(stats, scoring) {
    if (!stats)
        return 0;
    let total = 0;
    for (const rule of scoring) {
        const value = stats[String(rule.statId)];
        if (typeof value === 'number' && Number.isFinite(value))
            total += value * rule.points;
    }
    return Math.round(total * 100) / 100;
}
/** Statuses that mean a player will not accrue points, so starting them is a wasted slot. */
exports.UNAVAILABLE_STATUSES = new Set(['OUT', 'INJURY_RESERVE', 'SUSPENSION', 'BYE']);
/**
 * @description Whether a player can be expected to play. Used to keep an OUT player out of a
 * recommended lineup no matter how good his projection looks — a projection is not conditioned on
 * availability, and a stale projection for a ruled-out starter is the single most costly thing a
 * start/sit tool can get wrong.
 * @param player - The player.
 * @returns True when the player is expected to play.
 */
function isAvailable(player) {
    return !exports.UNAVAILABLE_STATUSES.has(String(player.injuryStatus || '').toUpperCase());
}
/**
 * @description Pick the highest-projected legal starting lineup, exactly.
 *
 * The objective is lexicographic: fill as many openings as the roster legally can, then maximise
 * projected points among those lineups. Filling first matters because a slot left empty scores
 * nothing, and a manager who leaves one empty on purpose is not following advice, he is forfeiting.
 * Both terms go into one assignment weight — a fill bonus larger than any projection, plus the
 * projection itself — so a single Hungarian solve is exact for both at once.
 *
 * Unavailable players are excluded outright rather than ranked low: a projection does not know the
 * player has been ruled out.
 * @param players - The whole roster.
 * @param slots - The league's starting slots.
 * @param scoring - The league's scoring rules.
 * @returns The chosen starters, the bench, and the projected total.
 */
function optimiseLineup(players, slots, scoring) {
    const pool = players
        .filter(isAvailable)
        .map((p) => ({ player: p, points: applyScoring(p.projectedStats, scoring) }))
        .sort((a, b) => b.points - a.points);
    const openings = [];
    for (const s of slots)
        for (let i = 0; i < s.count; i += 1)
            openings.push(s.slotId);
    const chosen = assignOpenings(openings, pool);
    const used = new Set();
    const starters = [];
    openings.forEach((slotId, row) => {
        const col = chosen[row];
        if (col < 0)
            return;
        used.add(pool[col].player.playerId);
        starters.push({ slotId, player: pool[col].player, points: pool[col].points });
    });
    const bench = pool.filter((e) => !used.has(e.player.playerId));
    const total = Math.round(starters.reduce((s, a) => s + a.points, 0) * 100) / 100;
    return { starters, bench, total };
}
/**
 * A fill bonus that dominates any realistic weekly projection, so the assignment fills every
 * opening it legally can before it compares points. Projections are tens of points; this is not.
 */
const FILL_BONUS = 10_000;
/**
 * @description Assign players to openings for the maximum total weight (Hungarian method, the
 * O(n²m) potentials form). Rows are openings; columns are the pool followed by one "leave empty"
 * column per opening, so every row always has a legal choice and an ineligible pairing is never
 * forced. The weight of an eligible pairing is FILL_BONUS + points; of an empty column, zero.
 * @param openings - Slot ids, one per opening.
 * @param pool - Available players with their projected points.
 * @returns For each opening, the index into `pool` it is filled from, or -1 when left empty.
 */
function assignOpenings(openings, pool) {
    const n = openings.length;
    const m = pool.length + n;
    const forbidden = FILL_BONUS * 1000;
    const cost = (row, col) => {
        if (col >= pool.length)
            return 0;
        return pool[col].player.eligibleSlots.includes(openings[row]) ? -(FILL_BONUS + pool[col].points) : forbidden;
    };
    const st = {
        u: new Array(n + 1).fill(0), v: new Array(m + 1).fill(0),
        owner: new Array(m + 1).fill(0), way: new Array(m + 1).fill(0), m, cost,
    };
    for (let row = 1; row <= n; row += 1) {
        st.owner[0] = row;
        augment(st);
    }
    const chosen = new Array(n).fill(-1);
    for (let col = 1; col <= m; col += 1) {
        if (st.owner[col] && col - 1 < pool.length)
            chosen[st.owner[col] - 1] = col - 1;
    }
    return chosen;
}
/**
 * @description One augmenting-path step of the Hungarian method: insert the row waiting in
 * owner[0] into the matching, adjusting the dual potentials so every reduced cost stays
 * non-negative.
 * @param st - The solve's state, mutated in place.
 * @returns Nothing.
 */
function augment(st) {
    const { u, v, owner, way, m, cost } = st;
    const minv = new Array(m + 1).fill(Infinity);
    const done = new Array(m + 1).fill(false);
    let col0 = 0;
    do {
        done[col0] = true;
        const r0 = owner[col0];
        let delta = Infinity;
        let col1 = 0;
        for (let col = 1; col <= m; col += 1) {
            if (done[col])
                continue;
            const cur = cost(r0 - 1, col - 1) - u[r0] - v[col];
            if (cur < minv[col]) {
                minv[col] = cur;
                way[col] = col0;
            }
            if (minv[col] < delta) {
                delta = minv[col];
                col1 = col;
            }
        }
        for (let col = 0; col <= m; col += 1) {
            if (done[col]) {
                u[owner[col]] += delta;
                v[col] -= delta;
            }
            else
                minv[col] -= delta;
        }
        col0 = col1;
    } while (owner[col0] !== 0);
    do {
        const col1 = way[col0];
        owner[col0] = owner[col1];
        col0 = col1;
    } while (col0 !== 0);
}
/**
 * @description Compare the lineup the manager has actually set against the optimal one and return
 * the changes worth making. Returns an empty list when the lineup is already optimal, which is the
 * common and correct outcome — a tool that always finds something to change is not advising, it is
 * fidgeting.
 * @param current - Player ids currently in the starting lineup.
 * @param optimal - The optimised lineup.
 * @param scoring - The league's scoring rules, for pricing the benched players.
 * @param roster - The whole roster, to resolve who is being sat.
 * @param minGain - Minimum projected points a swap must gain to be worth recommending.
 * @returns Recommended swaps, biggest gain first.
 */
function startSitCalls(current, optimal, scoring, roster, minGain = 0.5) {
    const currentSet = new Set(current);
    const byId = new Map(roster.map((p) => [p.playerId, p]));
    // Players the optimiser starts who are currently benched, and vice versa.
    const toStart = optimal.starters.filter((a) => !currentSet.has(a.player.playerId));
    const startedIds = new Set(optimal.starters.map((a) => a.player.playerId));
    const toSit = current
        .filter((id) => !startedIds.has(id))
        .map((id) => {
        const p = byId.get(id);
        // An UNAVAILABLE player is priced at ZERO, not at his projection. A projection is not
        // conditioned on availability, so a ruled-out star keeps a great number right up to kickoff —
        // and pricing him at it makes the gain from benching him look NEGATIVE, which silences the
        // tool on precisely the swap that costs the most. Caught by a guard, not in a lineup.
        const available = p ? isAvailable(p) : true;
        const points = p && available ? applyScoring(p.projectedStats, scoring) : 0;
        return { id, name: p?.name || String(id), points, player: p };
    })
        .sort((a, b) => a.points - b.points);
    const calls = [];
    for (let i = 0; i < Math.min(toStart.length, toSit.length); i += 1) {
        const inp = toStart[i];
        const out = toSit[i];
        const gain = Math.round((inp.points - out.points) * 100) / 100;
        if (gain < minGain)
            continue;
        const sitting = out.player;
        const unavailable = sitting && !isAvailable(sitting);
        calls.push({
            start: { playerId: inp.player.playerId, name: inp.player.name, points: inp.points },
            sit: { playerId: out.id, name: out.name, points: out.points },
            slotId: inp.slotId,
            gain,
            reason: unavailable
                ? `${out.name} is ${sitting?.injuryStatus} and will not score; ${inp.player.name} projects ${inp.points}`
                : `${inp.player.name} projects ${inp.points} vs ${out.name}'s ${out.points}`,
        });
    }
    return calls.sort((a, b) => b.gain - a.gain);
}
//# sourceMappingURL=fantasy-scoring.js.map