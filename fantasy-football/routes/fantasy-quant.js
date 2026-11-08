"use strict";
/**
 * Fantasy Quant read and confirm-gated action routes — /api/fantasy-football/quant/*.
 *
 * Every GET endpoint (`GET /quant/start-sit`, `GET /quant/waivers`, `GET /quant/matchup`) runs
 * strictly read-only (`{ persist: false }`) so native reader admission never sees a SQL write.
 * Roster/lineup mutations live exclusively on `POST /quant/set-lineup` and `POST /quant/apply-waiver`,
 * bound with `defaultAuthMode: ask` and `requiresApproval: true` in `oshal-app.yaml`.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — read-only FLEX/slot start-sit ranking with floor/ceiling and P(win) swing, waiver/streaming upgrades, head-to-head matchup breakdown, and approval-card-gated lineup and waiver mutation endpoints.
 *
 * @module fantasy-quant
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFantasyQuantRoutes = registerFantasyQuantRoutes;
const logger_1 = require("@/shared/logger");
const fantasy_leagues_1 = require("@/features/fantasy-leagues");
const fantasy_context_1 = require("./fantasy-context");
const fantasy_feed_1 = require("./fantasy-feed");
const fantasy_grading_1 = require("./fantasy-grading");
const fantasy_http_1 = require("./fantasy-http");
const fantasy_manual_1 = require("./fantasy-manual");
const fantasy_plan_1 = require("./fantasy-plan");
const fantasy_roster_1 = require("./fantasy-roster");
const fantasy_scoring_1 = require("./fantasy-scoring");
const fantasy_store_1 = require("./fantasy-store");
const fantasy_trades_1 = require("./fantasy-trades");
const fantasy_waivers_1 = require("./fantasy-waivers");
const fantasy_winprob_1 = require("./fantasy-winprob");
const log = (0, logger_1.createChildLogger)({ module: 'fantasy-quant' });
const SLOT_LABELS = {
    0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 7: 'OP', 16: 'D/ST', 17: 'K', 20: 'Bench', 21: 'IR', 23: 'FLEX',
};
const POSITION_LABELS = {
    1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST', 17: 'K',
};
const PRO_TEAMS = {
    1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
    9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
    17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
    25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};
const NAMED_SLOT_IDS = {
    QB: 0, RB: 2, WR: 4, TE: 6, OP: 7, SUPERFLEX: 7, DST: 16, 'D/ST': 16, K: 17, FLEX: 23,
};
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function slotName(slotId) { return SLOT_LABELS[slotId] || `Slot ${slotId}`; }
function posName(posId) { return (posId && POSITION_LABELS[posId]) || 'FLEX'; }
/** Resolves the requested league, falling back from linked ESPN leagues to the latest hand-typed league. */
async function resolveQuantContext(pool, sub, raw, withShape = false) {
    const req = { ...(0, fantasy_http_1.leagueRequestOf)(raw), withShape };
    if (req.leagueId === undefined && req.manualId === undefined) {
        const linked = await (0, fantasy_store_1.listLeagues)(pool, sub);
        if (!linked.length) {
            const manuals = await (0, fantasy_manual_1.listManualLeagues)(pool, sub);
            if (manuals.length)
                req.manualId = manuals[manuals.length - 1].id;
        }
    }
    return (0, fantasy_context_1.resolveLeagueContext)(pool, sub, req);
}
function mergePlayerWeeks(stored, fetched, week, ids) {
    const wanted = new Set(ids);
    const byKey = new Map();
    for (const row of [...stored, ...fetched]) {
        if (row.week < week && wanted.has(row.playerId))
            byKey.set(`${row.playerId}:${row.week}`, row);
    }
    return [...byKey.values()].sort((a, b) => a.week - b.week);
}
function computeOpponentMoments(opponent, players, settings, history) {
    if (!opponent)
        return null;
    const oppRoster = (0, fantasy_roster_1.joinRoster)(opponent.entries, players, history);
    const best = (0, fantasy_scoring_1.optimiseLineup)(oppRoster, settings.slots, settings.scoring);
    return (0, fantasy_winprob_1.lineupMoments)(best.starters.map((a) => a.player), settings.scoring);
}
async function computeReadOnlyWeek(pool, sub, ctx) {
    const read = await (0, fantasy_feed_1.projectionsFor)(pool, sub, ctx.season, ctx.week, { persist: false });
    const fixture = (0, fantasy_leagues_1.opponentOutcomeFor)(ctx.matchups, ctx.own.teamId, ctx.week);
    const opponent = fixture.opponentTeamId === null ? null
        : ctx.teams.find((t) => t.teamId === fixture.opponentTeamId) || null;
    if (!Object.keys(read.players).length)
        return { ok: false, read, opponent };
    const ids = [...ctx.own.rosterPlayerIds, ...(opponent?.rosterPlayerIds || [])];
    const stored = await (0, fantasy_store_1.readPlayerWeeks)(pool, sub, ctx.season, ctx.week, ids).catch(() => []);
    const history = (0, fantasy_roster_1.historyFor)(mergePlayerWeeks(stored, read.weeks, ctx.week, ids), ctx.settings.scoring);
    const roster = (0, fantasy_roster_1.joinRoster)(ctx.own.entries, read.players, history);
    const theirs = computeOpponentMoments(opponent, read.players, ctx.settings, history);
    const win = (0, fantasy_winprob_1.optimiseForWin)(roster, ctx.settings.slots, ctx.settings.scoring, theirs);
    const calls = (0, fantasy_scoring_1.startSitCalls)(ctx.own.startingPlayerIds, win.lineup, ctx.settings.scoring, roster);
    const openSlots = (0, fantasy_scoring_1.openSlotStarts)(ctx.own.startingPlayerIds, win.lineup);
    return { ok: true, read, opponent, history, roster, theirs, win, calls, openSlots };
}
function proTeamForPlayer(ctx, poolPlayers, playerId) {
    const fromPool = poolPlayers[playerId]?.proTeamId;
    if (typeof fromPool === 'number' && fromPool > 0)
        return fromPool;
    const entry = ctx.own.entries.find((e) => e.playerId === playerId);
    const fromEntry = Number(entry?.player?.proTeamId);
    return Number.isFinite(fromEntry) && fromEntry > 0 ? fromEntry : null;
}
function counterfactualWinProb(candidate, optimalStarters, benchPlayers, targetSlotId, scoring, theirs) {
    if (!theirs)
        return { winProbPct: null, deltaWinProbPts: null };
    const starterIds = new Set(optimalStarters.map((s) => s.player.playerId));
    const fullStarters = optimalStarters.map((s) => s.player);
    const baseProb = (0, fantasy_winprob_1.winProbability)((0, fantasy_winprob_1.lineupMoments)(fullStarters, scoring), theirs);
    if (starterIds.has(candidate.playerId)) {
        const bestBench = benchPlayers.find((b) => b.eligibleSlots.includes(targetSlotId) && (0, fantasy_scoring_1.isAvailable)(b));
        if (!bestBench)
            return { winProbPct: round2(baseProb * 100), deltaWinProbPts: 0 };
        const swapped = fullStarters.map((p) => (p.playerId === candidate.playerId ? bestBench : p));
        const altProb = (0, fantasy_winprob_1.winProbability)((0, fantasy_winprob_1.lineupMoments)(swapped, scoring), theirs);
        return { winProbPct: round2(baseProb * 100), deltaWinProbPts: round2((baseProb - altProb) * 100) };
    }
    const slotHolder = optimalStarters.find((s) => s.slotId === targetSlotId)?.player
        || optimalStarters.find((s) => candidate.eligibleSlots.includes(s.slotId))?.player;
    if (!slotHolder)
        return { winProbPct: round2(baseProb * 100), deltaWinProbPts: 0 };
    const swapped = fullStarters.map((p) => (p.playerId === slotHolder.playerId ? candidate : p));
    const candProb = (0, fantasy_winprob_1.winProbability)((0, fantasy_winprob_1.lineupMoments)(swapped, scoring), theirs);
    return { winProbPct: round2(candProb * 100), deltaWinProbPts: round2((candProb - baseProb) * 100) };
}
function buildSlotCandidates(ctx, w, rawSlot) {
    const upper = String(rawSlot || 'FLEX').trim().toUpperCase();
    const targetSlotId = NAMED_SLOT_IDS[upper] ?? 23;
    const filterAll = upper === 'ALL';
    const eligible = filterAll ? w.roster : w.roster.filter((p) => p.eligibleSlots.includes(targetSlotId));
    const poolList = eligible.length ? eligible : w.roster;
    const starterSlotByPlayer = new Map(w.win.lineup.starters.map((s) => [s.player.playerId, s.slotId]));
    const benchWeighed = w.roster.filter((p) => !starterSlotByPlayer.has(p.playerId));
    const currentSet = new Set(ctx.own.startingPlayerIds);
    return poolList.map((p) => {
        const avail = (0, fantasy_scoring_1.isAvailable)(p);
        const proId = proTeamForPlayer(ctx, w.read.players, p.playerId);
        const byeWeek = proId !== null ? (ctx.byes[proId] ?? null) : null;
        const onBye = byeWeek === ctx.week || String(p.injuryStatus || '').toUpperCase() === 'BYE';
        const pts = avail && !onBye ? (0, fantasy_scoring_1.applyScoring)(p.projectedStats, ctx.settings.scoring) : 0;
        const sd = round2((0, fantasy_winprob_1.spreadFor)(pts, p.defaultPositionId, p.pointsHistory));
        const recSlot = starterSlotByPlayer.get(p.playerId);
        const cf = counterfactualWinProb(p, w.win.lineup.starters, benchWeighed, targetSlotId, ctx.settings.scoring, w.theirs);
        return {
            playerId: p.playerId,
            name: p.name,
            position: posName(p.defaultPositionId),
            proTeam: proId ? (PRO_TEAMS[proId] || `Team ${proId}`) : null,
            byeWeek,
            onByeThisWeek: onBye,
            injuryStatus: p.injuryStatus || 'ACTIVE',
            available: avail && !onBye,
            projectedPoints: pts,
            spreadSd: sd,
            floor10: Math.max(0, round2(pts - 1.2816 * sd)),
            ceiling90: round2(pts + 1.2816 * sd),
            currentlyStarting: currentSet.has(p.playerId),
            recommendedSlot: recSlot !== undefined ? slotName(recSlot) : 'Bench',
            recommendedAction: recSlot === undefined ? 'BENCH' : (recSlot === targetSlotId ? `START_${slotName(recSlot)}` : 'START_CORE'),
            winProbIfStartedPct: cf.winProbPct,
            deltaWinProbPts: cf.deltaWinProbPts,
        };
    }).sort((a, b) => {
        const aStart = a.recommendedAction === 'BENCH' ? 0 : 1;
        const bStart = b.recommendedAction === 'BENCH' ? 0 : 1;
        return (bStart - aStart) || (b.projectedPoints - a.projectedPoints);
    });
}
async function handleQuantStartSit(pool, req, res) {
    const sub = (0, fantasy_http_1.requireSub)(req, res);
    if (!sub)
        return;
    try {
        const q = req.query;
        const resolved = await resolveQuantContext(pool, sub, q, false);
        if (!resolved.ok) {
            (0, fantasy_http_1.sendContextFailure)(res, resolved);
            return;
        }
        const zero = (0, fantasy_manual_1.zeroScoringReason)(resolved.ctx.settings.scoring);
        if (zero) {
            res.json((0, fantasy_manual_1.scoringRefusedBody)(resolved.ctx, zero));
            return;
        }
        const w = await computeReadOnlyWeek(pool, sub, resolved.ctx);
        if (!w.ok) {
            res.json({ ok: false, league: resolved.ctx.settings.name, week: resolved.ctx.week, projectionFeed: w.read.feed });
            return;
        }
        const requestedSlot = String(q.slot || 'FLEX').trim().toUpperCase();
        const candidates = buildSlotCandidates(resolved.ctx, w, requestedSlot);
        const flexPick = candidates.find((c) => c.recommendedSlot === requestedSlot) || candidates.find((c) => c.recommendedAction !== 'BENCH') || candidates[0] || null;
        res.json({
            source: resolved.ctx.source,
            league: { name: resolved.ctx.settings.name, leagueId: resolved.ctx.key, season: resolved.ctx.season, week: resolved.ctx.week },
            team: { teamId: resolved.ctx.own.teamId, name: resolved.ctx.own.name },
            slot: requestedSlot,
            matchup: {
                opponentName: w.opponent?.name || null,
                posture: w.theirs ? w.win.posture : 'no-opponent',
                yourProjectedPts: w.win.moments.mean,
                opponentProjectedPts: w.theirs?.mean ?? null,
                matchupDeltaPts: w.theirs ? round2(w.win.moments.mean - w.theirs.mean) : null,
                winProbabilityPct: w.theirs ? round2(w.win.winProbability * 100) : null,
                meanMaxWinProbabilityPct: w.theirs ? round2(w.win.meanWinProbability * 100) : null,
            },
            recommendedPick: flexPick,
            startSitCalls: w.calls.map((c) => ({ ...c, slotName: slotName(c.slotId) })),
            openSlots: w.openSlots.map((o) => ({ ...o, slotName: slotName(o.slotId) })),
            varianceSwaps: w.win.swaps.map((s) => ({ ...s, slotName: slotName(s.slotId) })),
            candidates,
        });
    }
    catch (err) {
        log.error({ err }, 'quant start-sit failed');
        res.status(502).json({ error: 'could not evaluate start/sit candidates' });
    }
}
async function handleQuantWaivers(pool, req, res) {
    const sub = (0, fantasy_http_1.requireSub)(req, res);
    if (!sub)
        return;
    try {
        const q = req.query;
        const resolved = await resolveQuantContext(pool, sub, q, true);
        if (!resolved.ok) {
            (0, fantasy_http_1.sendContextFailure)(res, resolved);
            return;
        }
        const ctx = resolved.ctx;
        const zero = (0, fantasy_manual_1.zeroScoringReason)(ctx.settings.scoring);
        if (zero) {
            res.json((0, fantasy_manual_1.scoringRefusedBody)(ctx, zero));
            return;
        }
        const { feeds, generatedAt, feed } = await (0, fantasy_feed_1.seasonFeeds)(pool, sub, ctx.season, ctx.week, ctx.lastWeek, { persist: false });
        if (!feed.ok) {
            res.json({ ok: false, league: ctx.settings.name, week: ctx.week, projectionFeed: feed });
            return;
        }
        const built = (0, fantasy_plan_1.buildSeasonPlan)({
            currentWeek: ctx.week, lastWeek: ctx.lastWeek, playoffStart: ctx.playoffStart,
            feeds, byes: ctx.byes, slots: ctx.settings.slots, scoring: ctx.settings.scoring,
        });
        const currentPool = feeds.get(ctx.week) || {};
        const budget = ctx.faab ? Math.max(0, ctx.faab.budget - ctx.faab.spent) : null;
        const board = (0, fantasy_waivers_1.waiverBoard)({
            plan: built.plan, rosterIds: ctx.own.rosterPlayerIds,
            rosteredIds: ctx.teams.flatMap((t) => t.rosterPlayerIds),
            pool: currentPool, budget, teams: ctx.teams.length,
        });
        const trades = await (0, fantasy_trades_1.findTrades)({ teamId: ctx.own.teamId, name: ctx.own.name, rosterIds: ctx.own.rosterPlayerIds }, ctx.teams.filter((t) => t.teamId !== ctx.own.teamId).map((t) => ({ teamId: t.teamId, name: t.name, rosterIds: t.rosterPlayerIds })), built.plan);
        res.json({
            source: ctx.source,
            league: { name: ctx.settings.name, leagueId: ctx.key, season: ctx.season, week: ctx.week },
            team: { teamId: ctx.own.teamId, name: ctx.own.name },
            mode: ctx.faab ? 'faab' : 'rolling',
            faabRemaining: budget,
            projectionsGeneratedAt: generatedAt,
            upgrades: board.rows.slice(0, 10),
            streaming: board.streaming.slice(0, 8),
            tradeIdeasCount: trades.length,
        });
    }
    catch (err) {
        log.error({ err }, 'quant waivers failed');
        res.status(502).json({ error: 'could not evaluate waiver wire upgrades' });
    }
}
function formatMatchupStarters(w) {
    return w.win.lineup.starters.map((s) => {
        const weighed = w.roster.find((r) => r.playerId === s.player.playerId);
        const sd = round2((0, fantasy_winprob_1.spreadFor)(s.points, weighed?.defaultPositionId, weighed?.pointsHistory));
        return {
            slotId: s.slotId, slotName: slotName(s.slotId), playerId: s.player.playerId, name: s.player.name,
            projectedPoints: s.points, spreadSd: sd,
            floor10: Math.max(0, round2(s.points - 1.2816 * sd)), ceiling90: round2(s.points + 1.2816 * sd),
            injuryStatus: s.player.injuryStatus || 'ACTIVE',
        };
    });
}
function formatMomentsBand(moments) {
    if (!moments)
        return null;
    return {
        mean: moments.mean, sd: moments.sd,
        floor10: Math.max(0, round2(moments.mean - 1.2816 * moments.sd)),
        ceiling90: round2(moments.mean + 1.2816 * moments.sd),
    };
}
async function handleQuantMatchup(pool, req, res) {
    const sub = (0, fantasy_http_1.requireSub)(req, res);
    if (!sub)
        return;
    try {
        const q = req.query;
        const resolved = await resolveQuantContext(pool, sub, q, false);
        if (!resolved.ok) {
            (0, fantasy_http_1.sendContextFailure)(res, resolved);
            return;
        }
        const ctx = resolved.ctx;
        const zero = (0, fantasy_manual_1.zeroScoringReason)(ctx.settings.scoring);
        if (zero) {
            res.json((0, fantasy_manual_1.scoringRefusedBody)(ctx, zero));
            return;
        }
        const [w, rec, weeks] = await Promise.all([
            computeReadOnlyWeek(pool, sub, ctx), (0, fantasy_store_1.fantasyRecord)(pool, sub, ctx.key), (0, fantasy_grading_1.weekRecord)(pool, sub, ctx.key),
        ]);
        if (!w.ok) {
            res.json({ ok: false, league: ctx.settings.name, week: ctx.week, projectionFeed: w.read.feed });
            return;
        }
        res.json({
            source: ctx.source,
            league: { name: ctx.settings.name, leagueId: ctx.key, season: ctx.season, week: ctx.week },
            team: { teamId: ctx.own.teamId, name: ctx.own.name },
            opponent: w.opponent ? { teamId: w.opponent.teamId, name: w.opponent.name } : null,
            posture: w.theirs ? w.win.posture : 'no-opponent',
            winProbabilityPct: w.theirs ? round2(w.win.winProbability * 100) : null,
            meanMaxWinProbabilityPct: w.theirs ? round2(w.win.meanWinProbability * 100) : null,
            yourMoments: formatMomentsBand(w.win.moments),
            opponentMoments: formatMomentsBand(w.theirs),
            projectedMarginPts: w.theirs ? round2(w.win.moments.mean - w.theirs.mean) : null,
            starters: formatMatchupStarters(w),
            varianceSwaps: w.win.swaps.map((s) => ({ ...s, slotName: slotName(s.slotId) })),
            record: { calls: rec, weeksGraded: weeks.graded, weeksRecorded: weeks.weeks, actualGainPts: weeks.actualGain },
        });
    }
    catch (err) {
        log.error({ err }, 'quant matchup failed');
        res.status(502).json({ error: 'could not evaluate matchup breakdown' });
    }
}
async function applyManualLineupChange(pool, sub, manualId, optimalIds, startId, sitId) {
    const doc = await (0, fantasy_manual_1.readManualLeague)(pool, sub, manualId);
    if (!doc)
        return { ok: false, error: 'hand-typed league not found' };
    const mine = doc.league.teams.find((t) => t.mine);
    if (!mine)
        return { ok: false, error: 'your team is missing in that league' };
    let nextStarting = [...mine.starting];
    if (startId !== null) {
        if (!mine.roster.includes(startId))
            return { ok: false, error: `player ${startId} is not on your roster` };
        if (sitId !== null)
            nextStarting = nextStarting.filter((id) => id !== sitId);
        if (!nextStarting.includes(startId))
            nextStarting.push(startId);
    }
    else {
        nextStarting = [...optimalIds];
    }
    const updated = {
        ...doc.league,
        teams: doc.league.teams.map((t) => (t.mine ? { ...t, starting: nextStarting } : t)),
    };
    await (0, fantasy_manual_1.saveManualLeague)(pool, sub, updated, manualId);
    return { ok: true, starting: nextStarting };
}
async function handleQuantSetLineup(pool, req, res) {
    const sub = (0, fantasy_http_1.requireSub)(req, res);
    if (!sub)
        return;
    try {
        const body = (req.body || {});
        const resolved = await resolveQuantContext(pool, sub, body, false);
        if (!resolved.ok) {
            (0, fantasy_http_1.sendContextFailure)(res, resolved);
            return;
        }
        const ctx = resolved.ctx;
        const w = await computeReadOnlyWeek(pool, sub, ctx);
        if (!w.ok) {
            res.status(409).json({ error: 'cannot record or set a lineup without projections' });
            return;
        }
        const optimalIds = w.win.lineup.starters.map((s) => s.player.playerId);
        const startId = body.startPlayerId !== undefined ? Number(body.startPlayerId) : null;
        const sitId = body.sitPlayerId !== undefined ? Number(body.sitPlayerId) : null;
        let updatedStarters = ctx.own.startingPlayerIds;
        if (ctx.source === 'manual') {
            const manualId = Number(ctx.key.replace(/^manual:/, ''));
            const saved = await applyManualLineupChange(pool, sub, manualId, optimalIds, startId, sitId);
            if (!saved.ok) {
                res.status(400).json({ error: saved.error });
                return;
            }
            updatedStarters = saved.starting || optimalIds;
        }
        const registered = await (0, fantasy_store_1.recordCalls)(pool, sub, ctx.season, ctx.key, ctx.week, w.calls);
        await (0, fantasy_grading_1.recordWeek)(pool, sub, {
            season: ctx.season, leagueKey: ctx.key, week: ctx.week, source: ctx.source,
            advised: optimalIds, meanLineup: w.win.meanLineup.starters.map((s) => s.player.playerId),
            started: updatedStarters, swaps: w.win.swaps,
            winProbability: w.theirs ? w.win.winProbability : null,
            meanWinProbability: w.theirs ? w.win.meanWinProbability : null,
            projectedAdvised: w.win.lineup.total, projectedStarted: w.win.moments.mean,
        });
        res.json({
            ok: true, source: ctx.source, leagueKey: ctx.key, week: ctx.week,
            startingPlayerIds: updatedStarters, registeredCalls: registered,
            note: ctx.source === 'manual'
                ? 'Lineup updated in your hand-typed league and recorded in the weekly ledger.'
                : 'Pre-kickoff calls recorded in Fantasy Football; apply the swap in ESPN as well.',
        });
    }
    catch (err) {
        log.error({ err }, 'quant set-lineup failed');
        res.status(502).json({ error: 'could not update lineup' });
    }
}
async function handleQuantApplyWaiver(pool, req, res) {
    const sub = (0, fantasy_http_1.requireSub)(req, res);
    if (!sub)
        return;
    try {
        const body = (req.body || {});
        const addId = Number(body.addPlayerId);
        const dropId = Number(body.dropPlayerId);
        if (!Number.isInteger(addId) || addId <= 0 || !Number.isInteger(dropId) || dropId <= 0) {
            res.status(400).json({ error: 'addPlayerId and dropPlayerId must be positive integer ESPN player ids' });
            return;
        }
        const resolved = await resolveQuantContext(pool, sub, body, true);
        if (!resolved.ok) {
            (0, fantasy_http_1.sendContextFailure)(res, resolved);
            return;
        }
        if (resolved.ctx.source !== 'manual') {
            res.status(400).json({ error: 'ESPN waiver claims must be submitted on ESPN; hand-typed leagues update here.' });
            return;
        }
        const manualId = Number(resolved.ctx.key.replace(/^manual:/, ''));
        const doc = await (0, fantasy_manual_1.readManualLeague)(pool, sub, manualId);
        if (!doc) {
            res.status(404).json({ error: 'hand-typed league not found' });
            return;
        }
        const allRostered = new Set(doc.league.teams.flatMap((t) => t.roster));
        if (allRostered.has(addId)) {
            res.status(400).json({ error: `player ${addId} is already rostered in this league` });
            return;
        }
        const mine = doc.league.teams.find((t) => t.mine);
        if (!mine || !mine.roster.includes(dropId)) {
            res.status(400).json({ error: `player ${dropId} is not on your roster` });
            return;
        }
        const bid = Math.max(0, Number(body.faabBid) || 0);
        const nextFaab = doc.league.faab ? {
            budget: doc.league.faab.budget,
            spent: Math.min(doc.league.faab.budget, doc.league.faab.spent + bid),
        } : null;
        const updated = {
            ...doc.league, faab: nextFaab,
            teams: doc.league.teams.map((t) => (t.mine ? {
                ...t,
                roster: t.roster.map((id) => (id === dropId ? addId : id)),
                starting: t.starting.filter((id) => id !== dropId),
            } : t)),
        };
        await (0, fantasy_manual_1.saveManualLeague)(pool, sub, updated, manualId);
        res.json({ ok: true, manualId, addedPlayerId: addId, droppedPlayerId: dropId, faab: nextFaab });
    }
    catch (err) {
        log.error({ err }, 'quant apply-waiver failed');
        res.status(502).json({ error: 'could not apply waiver swap' });
    }
}
/** Mounts read-only Fantasy Quant endpoints and confirm-gated lineup/waiver endpoints. */
function registerFantasyQuantRoutes(router, pool) {
    router.get('/quant/start-sit', (req, res) => handleQuantStartSit(pool, req, res));
    router.get('/quant/waivers', (req, res) => handleQuantWaivers(pool, req, res));
    router.get('/quant/matchup', (req, res) => handleQuantMatchup(pool, req, res));
    router.post('/quant/set-lineup', (req, res) => handleQuantSetLineup(pool, req, res));
    router.post('/quant/apply-waiver', (req, res) => handleQuantApplyWaiver(pool, req, res));
}
//# sourceMappingURL=fantasy-quant.js.map