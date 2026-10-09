"use strict";
/**
 * Where a league comes from — the caller's ESPN connection, or a league they typed in by hand.
 *
 * ONE SEAM, TWO SOURCES, THE SAME ANSWER SHAPE. Every weekly recommendation (the lineup, the waiver
 * board, the trade finder, the week ledger) asks this module for `{settings, teams, own, schedule,
 * byes, faab, season shape}` and never learns which source answered. That is what makes "manual
 * entry is a first-class input" true in code rather than in a sentence: the connector is consulted
 * only on the ESPN branch, and the manual branch never touches the broker. The parity guard
 * (tests/fantasy-manual.test.js) fails if any route makes the connector a precondition.
 *
 * THE CREDENTIAL RULE lives here now, unchanged: the caller's OWN personal espn-fantasy connection is
 * named by id (the broker's default pick prefers a household-shared one, which is someone else's
 * account session), resolved per request, handed to the fantasy-leagues skill's reads, and never
 * logged, stored or returned.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — resolveLeagueContext over the ESPN connector (settings, rosters, schedule, and on request the FAAB budget and season shape) or a hand-typed league, with the credential rule and the unreachable-ESPN answer moved here from fantasy-routes.ts so every route shares them.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A request that names no league resolves to the caller's most recently linked ESPN league, so the installed package's boards can be read as the signed-in operator (the Test Lab's PAT smokes) without a league id written into the manifest.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | A schedule read that THROWS is logged at ERROR before it degrades to no schedule; the catch came over from sports-edge swallowing it. The fallback is unchanged.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | A league shape read (mSettings+mTeam: the FAAB budget, the last week, the first playoff week) that comes back empty no longer reads as "the league does not bid": the skill returns null once its retries fail, and the null body used to become faab null, lastWeek 17 and playoffStart null, so the waiver board of a FAAB league said it claims by waiver priority, with no bid on any row. The read now captures its classified failure; a transport or 5xx/429 failure answers through the unreachable-ESPN path (503 naming the transport), and a refusal or a read that threw answers 502 naming the unread shape. A read that throws is logged at ERROR. Nothing season-long is priced on an assumed shape.
 *
 * @module fantasy-context
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.espn = void 0;
exports.credentialFor = credentialFor;
exports.answerUnreachable = answerUnreachable;
exports.resolveLeagueContext = resolveLeagueContext;
const logger_1 = require("@/shared/logger");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const connector_tenancy_1 = require("@/app/routes/connector-tenancy");
const fantasy_leagues_1 = require("@/features/fantasy-leagues");
const fantasy_manual_1 = require("./fantasy-manual");
const fantasy_store_1 = require("./fantasy-store");
const log = (0, logger_1.createChildLogger)({ module: 'fantasy-football-context' });
/** HTTP options. A failed read logs at warn — the box runs at info, so debug would be invisible. */
exports.espn = {
    log: (event, fields) => (event === 'espn.request.ok' ? log.debug(fields, event) : log.warn(fields, event)),
    timeoutMs: 25_000,
};
/** The connector this package reads a private league with. */
const CONNECTOR = 'espn-fantasy';
/** ESPN's regular football season length when a league does not say. */
const DEFAULT_LAST_WEEK = 17;
/**
 * @description Resolve the caller's OWN ESPN cookies, or null when they have not connected. A
 * household-shared connection is another person's account session and is refused without being
 * decrypted.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @returns The credential (or null) and whether a shared connection was deliberately ignored.
 */
async function credentialFor(pool, sub) {
    const rows = await (0, connector_tenancy_1.accessibleConnections)(pool, sub, CONNECTOR).catch((err) => {
        log.error({ err }, 'espn connection lookup failed');
        return [];
    });
    const own = rows.find((r) => !r.tenant_id && r.user_sub === sub);
    if (!own)
        return { cred: null, sharedOnly: rows.length > 0 };
    const secret = await (0, connectors_routes_1.getValidAccessToken)(pool, sub, CONNECTOR, { connectionId: own.connection_id })
        .catch((err) => {
        log.error({ err }, 'espn credential resolution failed');
        return null;
    });
    return { cred: (0, fantasy_leagues_1.parseCredential)(secret), sharedOnly: false };
}
/**
 * @description Answer a league read that never reached ESPN, or reached it and got a 5xx. Neither is
 * a credential problem, and the credential message is actively harmful advice for both.
 * @param res - The response to answer on.
 * @param failure - The classified failure, or null when the read simply returned nothing.
 * @returns True when the failure was answered here and the caller should stop.
 */
function answerUnreachable(res, failure) {
    if (!failure || failure.kind === 'refused')
        return false;
    const error = failure.kind === 'unavailable'
        ? `Could not reach ESPN for that league — it answered ${failure.reason}. ESPN's fantasy API is failing, `
            + 'not your ESPN account, so there is nothing to re-paste; try again shortly.'
        : `Could not reach ESPN at all (${failure.reason}). That is a network fault between this swarm and `
            + 'ESPN, not your ESPN account — check connectivity, starting with DNS, rather than re-pasting cookies.';
    res.status(503).json({ error, reason: failure.kind, espnStatus: failure.status });
    return true;
}
/**
 * @description Resolve the league a request names from whichever source it names; naming none means
 * the caller's most recently linked ESPN league.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param req - The league request.
 * @returns The context, or the refusal to send.
 */
async function resolveLeagueContext(pool, sub, req) {
    if (req.manualId !== undefined)
        return manualContext(pool, sub, req);
    if (!req.leagueId) {
        // Naming no league means the caller's most recently linked one — which is what lets the Test Lab
        // read a real league's boards as the signed-in operator without a league id in the manifest.
        const linked = (await (0, fantasy_store_1.listLeagues)(pool, sub)).pop();
        if (!linked)
            return { ok: false, status: 400, body: { error: 'name a league: leagueId (an ESPN league you linked) or manualId (a league typed in by hand)' } };
        return espnContext(pool, sub, { ...req, leagueId: linked.leagueId, season: linked.season });
    }
    return espnContext(pool, sub, req);
}
/**
 * @description The ESPN branch: settings, rosters and schedule through the kernel skill with the
 * caller's own credential, and on request the FAAB budget and season shape.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param req - The league request.
 * @returns The context, or the refusal to send (503 for an unreachable ESPN is signalled by status 503).
 */
async function espnContext(pool, sub, req) {
    const leagueId = String(req.leagueId);
    const { cred } = await credentialFor(pool, sub);
    const { settings, failure } = await (0, fantasy_leagues_1.readLeagueSettingsOutcome)(req.season, leagueId, cred, exports.espn);
    if (!settings) {
        if (failure && failure.kind !== 'refused')
            return { ok: false, status: 503, body: { failure } };
        return { ok: false, status: cred ? 404 : 403, body: {
                error: cred ? 'ESPN would not return that league right now.' : 'Connect ESPN Fantasy to read a private league, or use a league typed in by hand.',
            } };
    }
    const week = req.week || settings.scoringPeriodId;
    const teams = await (0, fantasy_leagues_1.readTeams)(req.season, leagueId, week, cred, exports.espn);
    const own = cred ? (0, fantasy_leagues_1.findOwnTeam)(teams, cred.swid) : null;
    if (!own)
        return { ok: false, status: 404, body: { error: 'no team in that league belongs to this ESPN account' } };
    const schedule = await (0, fantasy_leagues_1.readMatchupsOutcome)(req.season, leagueId, cred, exports.espn).catch((err) => {
        log.error({ err, season: req.season, leagueId, week }, 'schedule read threw; serving the highest-projected lineup');
        return { matchups: [], failure: null };
    });
    let shape = null;
    if (req.withShape) {
        const read = await espnShape(req.season, leagueId, own.teamId, cred);
        if (!read.shape)
            return shapeRefusal(req.season, leagueId, read.failure);
        shape = read.shape;
    }
    return { ok: true, ctx: {
            source: 'espn', key: leagueId, season: req.season, week, settings, teams, own,
            matchups: schedule.matchups, scheduleFailure: schedule.failure, byes: {},
            faab: shape?.faab ?? null, lastWeek: shape?.lastWeek ?? DEFAULT_LAST_WEEK, playoffStart: shape?.playoffStart ?? null, cred,
        } };
}
/**
 * @description The FAAB budget left for the caller's team and the season's shape, from the league's
 * own settings: acquisition budget minus what the team has spent, the final scoring period, and the
 * first playoff week (the week after the regular season's last matchup period).
 *
 * AN UNREAD SHAPE IS NOT A SHAPE. The skill returns null once its retries fail, and a null body read
 * as data says "this league does not bid" and "the season ends in week 17" — the waiver board of a
 * FAAB league then printed "claims by waiver priority, so there is no bid". So the read keeps its
 * classified failure and an empty body is returned as no shape at all.
 * @param season - Season year.
 * @param leagueId - League id.
 * @param teamId - The caller's team.
 * @param cred - The caller's own credential.
 * @returns The shape (FAAB null only when the league's own settings say it does not bid), or null
 * with the read's classified failure.
 */
async function espnShape(season, leagueId, teamId, cred) {
    const captured = [];
    const opts = { ...exports.espn, onError: (_url, reason) => { if (!captured.length)
            captured.push((0, fantasy_leagues_1.classifyFailure)(reason)); } };
    const body = await (0, fantasy_leagues_1.readLeague)(season, leagueId, ['mSettings', 'mTeam'], cred, opts).catch((err) => {
        log.error({ err, season, leagueId }, 'league shape read threw');
        return null;
    });
    if (!body)
        return { shape: null, failure: captured[0] || null };
    const acq = body.settings?.acquisitionSettings || {};
    const team = (body.teams || []).find((t) => Number(t?.id) === teamId);
    const budget = Number(acq.acquisitionBudget);
    const spent = Number(team?.transactionCounter?.acquisitionBudgetSpent) || 0;
    const regular = Number(body.settings?.scheduleSettings?.matchupPeriodCount);
    return { shape: {
            faab: acq.isUsingAcquisitionBudget && Number.isFinite(budget) ? { budget, spent } : null,
            lastWeek: Number(body.status?.finalScoringPeriod) || DEFAULT_LAST_WEEK,
            playoffStart: Number.isFinite(regular) && regular > 0 ? regular + 1 : null,
        }, failure: null };
}
/**
 * @description The answer when the league's shape could not be read. Every season-long board prices
 * from it — whether the league bids, and how many weeks remain — so it is refused rather than priced
 * on a guess: an unreachable or failing ESPN goes through the unreachable-ESPN answer (503 naming
 * the transport), and anything else is a 502 that names the unread shape.
 * @param season - Season year, for the log.
 * @param leagueId - League id, for the log.
 * @param failure - The shape read's classified failure, or null when the read threw.
 * @returns The refusal.
 */
function shapeRefusal(season, leagueId, failure) {
    log.warn({ season, leagueId, failure }, 'league shape unread; season-long board refused');
    if (failure && failure.kind !== 'refused')
        return { ok: false, status: 503, body: { failure } };
    return { ok: false, status: 502, body: {
            error: 'ESPN returned the league but not its budget and season shape, so this board cannot say whether the '
                + 'league bids or how many weeks remain without guessing. Try again shortly.',
            reason: failure ? failure.kind : 'unread', espnStatus: failure ? failure.status : null,
        } };
}
/**
 * @description The manual branch: the caller's own hand-typed league. The connector is never
 * consulted; the current week comes from ESPN's public season read, which needs no credential.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param req - The league request.
 * @returns The context, or 404 when the league is not the caller's.
 */
async function manualContext(pool, sub, req) {
    const stored = await (0, fantasy_manual_1.readManualLeague)(pool, sub, Number(req.manualId));
    if (!stored)
        return { ok: false, status: 404, body: { error: 'no hand-typed league with that id is yours' } };
    const m = stored.league;
    const week = req.week || await (0, fantasy_leagues_1.readCurrentScoringPeriod)(m.season, exports.espn);
    const teams = m.teams.map((t) => manualTeam(t));
    const own = teams[m.teams.findIndex((t) => t.mine)];
    return { ok: true, ctx: {
            source: 'manual', key: `manual:${stored.id}`, season: m.season, week,
            settings: { leagueId: `manual:${stored.id}`, season: m.season, name: m.name, scoringPeriodId: week, scoring: m.scoring, slots: m.slots },
            teams, own, matchups: manualMatchups(m), scheduleFailure: null,
            byes: Object.fromEntries(Object.entries(m.byes).map(([k, v]) => [Number(k), v])),
            faab: m.faab ? { budget: m.faab.budget, spent: m.faab.spent } : null,
            lastWeek: m.lastWeek, playoffStart: m.playoffStart, cred: null,
        } };
}
/**
 * @description A hand-typed team in the shape the ESPN read returns, so nothing downstream can tell.
 * @param t - The hand-typed team.
 * @returns The team.
 */
function manualTeam(t) {
    const entries = t.roster.map((playerId) => ({ playerId, lineupSlotId: t.starting.includes(playerId) ? 0 : 20, player: {} }));
    return {
        teamId: t.teamId, name: t.name, abbrev: '', owners: [], entries,
        rosterPlayerIds: [...t.roster], startingPlayerIds: [...t.starting],
    };
}
/**
 * @description A hand-typed schedule in the skill's fixture shape.
 * @param m - The league.
 * @returns Fixtures.
 */
function manualMatchups(m) {
    return m.schedule.map((s) => ({ matchupPeriodId: s.week, homeTeamId: s.home, awayTeamId: s.away }));
}
//# sourceMappingURL=fantasy-context.js.map