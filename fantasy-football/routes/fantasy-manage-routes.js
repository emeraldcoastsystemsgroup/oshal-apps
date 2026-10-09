"use strict";
/**
 * The management routes — rest-of-season value, the waiver board, the trade finder, and the
 * hand-typed leagues they can all run on.
 *
 * Every one of them reads its league through fantasy-context.ts, so each answers for a connected
 * ESPN league (?leagueId=) and for a league typed in by hand (?manualId=) alike, and every one is
 * READ-ONLY toward ESPN: there is no route here that claims a player, bids, or proposes a trade.
 * The boards are advice; you act on ESPN yourself.
 *
 * Each response says which remaining weeks were priced from a real weekly feed and which from the
 * current week's projection as a rate, and whether bye weeks were known, so a number built on an
 * assumption never reads as one built on data.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — GET /season (SV, the drop candidate, replacement levels), GET /waivers (rest-of-season board with bid and drop, streaming lane), GET /trades (two-sided proposals, both gains shown), and owner-scoped hand-typed league CRUD (/manual-leagues).
 *
 * @module fantasy-manage-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerManageRoutes = registerManageRoutes;
const logger_1 = require("@/shared/logger");
const fantasy_context_1 = require("./fantasy-context");
const fantasy_http_1 = require("./fantasy-http");
const fantasy_feed_1 = require("./fantasy-feed");
const fantasy_plan_1 = require("./fantasy-plan");
const fantasy_season_1 = require("./fantasy-season");
const fantasy_waivers_1 = require("./fantasy-waivers");
const fantasy_trades_1 = require("./fantasy-trades");
const fantasy_manual_1 = require("./fantasy-manual");
const log = (0, logger_1.createChildLogger)({ module: 'fantasy-football-manage' });
/**
 * @description Build the season plan for a league from the caller's cached feeds.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param ctx - The league.
 * @param q - Query (playoffWeight).
 * @returns The plan, the current week's pool and its cache age.
 */
async function planFor(pool, sub, ctx, q) {
    const { feeds, generatedAt } = await (0, fantasy_feed_1.seasonFeeds)(pool, sub, ctx.season, ctx.week, ctx.lastWeek);
    const weight = Number(q.playoffWeight);
    const built = (0, fantasy_plan_1.buildSeasonPlan)({
        currentWeek: ctx.week, lastWeek: ctx.lastWeek, playoffStart: ctx.playoffStart,
        playoffWeight: Number.isFinite(weight) && weight > 0 && weight <= 5 ? weight : undefined,
        feeds, byes: ctx.byes, slots: ctx.settings.slots, scoring: ctx.settings.scoring,
    });
    return { built, pool: feeds.get(ctx.week) || {}, generatedAt };
}
/**
 * @description What every management response says about its league and its numbers' provenance.
 * @param ctx - The league.
 * @param p - The plan.
 * @returns The header fields.
 */
function header(ctx, p) {
    return {
        source: ctx.source,
        league: { name: ctx.settings.name, leagueId: ctx.key, season: ctx.season, week: ctx.week },
        team: { teamId: ctx.own.teamId, name: ctx.own.name },
        weeks: { fromFeed: p.built.fromFeed, fromRate: p.built.fromRate, lastWeek: ctx.lastWeek, playoffStart: ctx.playoffStart },
        byesKnown: Object.keys(ctx.byes).length > 0,
        projectionsGeneratedAt: p.generatedAt,
    };
}
/**
 * @description A name for a player id, from the current feed or a roster entry.
 * @param id - Player id.
 * @param p - The plan.
 * @param ctx - The league.
 * @returns The name.
 */
function nameOf(id, p, ctx) {
    if (p.pool[id]?.name)
        return p.pool[id].name;
    for (const t of ctx.teams) {
        const e = t.entries.find((x) => x.playerId === id);
        if (e?.player?.fullName)
            return String(e.player.fullName);
    }
    return `Player ${id}`;
}
/**
 * @description Wrap a league-scoped read: caller, league resolution from either source, the plan.
 * @param pool - Postgres pool.
 * @param what - Name for the log.
 * @param build - Builds the body from the league and its plan.
 * @returns An express handler.
 */
function leagueRoute(pool, what, build) {
    return async (req, res) => {
        const sub = (0, fantasy_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const q = req.query;
        const started = Date.now();
        try {
            const result = await (0, fantasy_context_1.resolveLeagueContext)(pool, sub, { ...(0, fantasy_http_1.leagueRequestOf)(q), withShape: true });
            if (!result.ok) {
                (0, fantasy_http_1.sendContextFailure)(res, result);
                return;
            }
            const planned = await planFor(pool, sub, result.ctx, q);
            const body = await build(result.ctx, planned);
            log.info({ what, source: result.ctx.source, weeks: planned.built.plan.weeks.length, ms: Date.now() - started }, 'management board served');
            res.json({ ...header(result.ctx, planned), ...body });
        }
        catch (err) {
            log.error({ err, what }, 'management board failed');
            res.status(502).json({ error: `could not build the ${what}` });
        }
    };
}
/**
 * @description Mount the management routes.
 * @param router - The package's router.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerManageRoutes(router, pool) {
    router.get('/season', leagueRoute(pool, 'season value', seasonBody));
    router.get('/waivers', leagueRoute(pool, 'waiver board', waiversBody));
    router.get('/trades', leagueRoute(pool, 'trade finder', tradesBody));
    registerManualRoutes(router, pool);
}
/**
 * @description SV for the caller's roster, its weeks, the drop candidate and the league's
 * replacement levels.
 * @param ctx - The league.
 * @param p - The plan.
 * @returns The body.
 */
function seasonBody(ctx, p) {
    const sv = (0, fantasy_season_1.seasonValue)(ctx.own.rosterPlayerIds, p.built.plan);
    const drop = (0, fantasy_season_1.dropCandidate)(ctx.own.rosterPlayerIds, p.built.plan, sv);
    return {
        total: sv.total,
        byWeek: sv.weeks.map((w) => ({ week: w.week, weight: w.weight, value: w.value })),
        drop: drop ? { playerId: drop.playerId, name: nameOf(drop.playerId, p, ctx), cost: drop.cost } : null,
        replacement: (0, fantasy_season_1.replacementLevel)(Object.values(p.pool), ctx.settings.slots, ctx.settings.scoring, ctx.teams.length).byPosition,
    };
}
/**
 * @description The waiver board for the caller's team.
 * @param ctx - The league.
 * @param p - The plan.
 * @returns The body.
 */
function waiversBody(ctx, p) {
    const board = (0, fantasy_waivers_1.waiverBoard)({
        plan: p.built.plan,
        rosterIds: ctx.own.rosterPlayerIds,
        rosteredIds: ctx.teams.flatMap((t) => t.rosterPlayerIds),
        pool: p.pool,
        budget: ctx.faab ? Math.max(0, ctx.faab.budget - ctx.faab.spent) : null,
        teams: ctx.teams.length,
    });
    return { mode: ctx.faab ? 'faab' : 'rolling', ...board };
}
/**
 * @description Two-sided trade proposals against every other team, with names.
 * @param ctx - The league.
 * @param p - The plan.
 * @returns The body.
 */
async function tradesBody(ctx, p) {
    const proposals = await (0, fantasy_trades_1.findTrades)({ teamId: ctx.own.teamId, name: ctx.own.name, rosterIds: ctx.own.rosterPlayerIds }, ctx.teams.filter((t) => t.teamId !== ctx.own.teamId).map((t) => ({ teamId: t.teamId, name: t.name, rosterIds: t.rosterPlayerIds })), p.built.plan);
    const named = (ids) => ids.map((id) => ({ playerId: id, name: nameOf(id, p, ctx) }));
    return {
        proposals: proposals.map((t) => ({
            ...t, give: named(t.give), get: named(t.get),
            youDrop: t.youDrop === null ? null : { playerId: t.youDrop, name: nameOf(t.youDrop, p, ctx) },
            themDrop: t.themDrop === null ? null : { playerId: t.themDrop, name: nameOf(t.themDrop, p, ctx) },
        })),
    };
}
/**
 * @description The caller's hand-typed leagues: list, read, create, replace, delete. Every statement
 * is owner-scoped and the tables are under forced exact-owner row security besides.
 * @param router - The package's router.
 * @param pool - Postgres pool.
 * @returns Nothing.
 */
function registerManualRoutes(router, pool) {
    const idOf = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
    const guarded = (what, fn) => async (req, res) => {
        const sub = (0, fantasy_http_1.requireSub)(req, res);
        if (!sub)
            return;
        try {
            await fn(sub, req, res);
        }
        catch (err) {
            log.error({ err, what }, 'hand-typed league route failed');
            res.status(500).json({ error: `could not ${what}` });
        }
    };
    router.get('/manual-leagues', guarded('list your hand-typed leagues', async (sub, _req, res) => {
        res.json({ leagues: await (0, fantasy_manual_1.listManualLeagues)(pool, sub) });
    }));
    router.get('/manual-leagues/:id', guarded('read that league', async (sub, req, res) => {
        const found = idOf(req) === null ? null : await (0, fantasy_manual_1.readManualLeague)(pool, sub, idOf(req));
        if (!found) {
            res.status(404).json({ error: 'no hand-typed league with that id is yours' });
            return;
        }
        res.json(found);
    }));
    const save = (replace) => guarded('save that league', async (sub, req, res) => {
        const parsed = (0, fantasy_manual_1.parseManualLeague)(req.body);
        if (!parsed.ok) {
            res.status(400).json({ error: 'the league is not valid', problems: parsed.errors });
            return;
        }
        const id = await (0, fantasy_manual_1.saveManualLeague)(pool, sub, parsed.league, replace ? idOf(req) : null);
        if (id === null) {
            res.status(404).json({ error: 'no hand-typed league with that id is yours' });
            return;
        }
        res.status(replace ? 200 : 201).json({ ok: true, id });
    });
    router.post('/manual-leagues', save(false));
    router.put('/manual-leagues/:id', save(true));
    router.delete('/manual-leagues/:id', guarded('delete that league', async (sub, req, res) => {
        const id = idOf(req);
        res.json({ ok: true, removed: id === null ? 0 : await (0, fantasy_manual_1.deleteManualLeague)(pool, sub, id) });
    }));
}
//# sourceMappingURL=fantasy-manage-routes.js.map