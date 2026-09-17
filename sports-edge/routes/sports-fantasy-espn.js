"use strict";
/**
 * ESPN Fantasy client — the public projection feed, and a private league read with the caller's
 * brokered cookies.
 *
 * TWO HALVES WITH VERY DIFFERENT SECURITY PROPERTIES, and keeping them apart is the point of this
 * module:
 *
 *   - THE PUBLIC HALF needs no credential at all. `playerProjections` reads ESPN's whole player
 *     universe — 11,617 players, ~39MB — carrying per-week RAW projected stats for every one. It is
 *     the same data for everybody, so it is fetched once and cached, never per request.
 *   - THE PRIVATE HALF needs the caller's `SWID` + `espn_s2` cookies. ESPN publishes no OAuth for
 *     fantasy, so these are ACCOUNT SESSION cookies rather than a scoped token. They are resolved
 *     per-request from the connector broker, put on exactly one outbound request, and never logged,
 *     never returned to a caller, and never placed anywhere a model can read. A league the caller
 *     cannot see answers 401 and this module reports not-connected rather than guessing.
 *
 * ⚠ THE FILTER HEADER IS REQUIRED, AND ITS `limit` IS IGNORED. Both halves of that were measured
 * live 2026-09-08, and getting it half-right already cost one bug:
 *     no `x-fantasy-filter` header  ->     50 players (ESPN's default page)
 *     with the header               -> 11,617 players (~39MB), whatever limit is asked for
 * So the header must be SENT — without it the feed silently returns fifty alphabetically-early
 * players and a roster full of unprojected names, which looks like missing data rather than a
 * truncated request. The limit is set high anyway so that if ESPN ever starts honouring it, the
 * full set still comes back.
 *
 * That size is also why projections are a cached job and why `distilProjections` reduces the
 * payload to the handful of fields a lineup decision needs before anything is stored.
 *
 * `appliedTotal` IS NOT USED, deliberately. It is null in the public feed because a fantasy point
 * total requires a league's scoring rules. Points are computed in sports-fantasy-scoring from the
 * raw stats and the league's own `scoringItems`, which is both correct for a non-standard league
 * and free of any hardcoded guess about what a stat id means.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — credential split/normalisation, private league reads (settings, teams, rosters, matchups) with the caller's cookies on exactly one request, and the public player-projection feed distilled to the fields a lineup decision needs.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Send the x-fantasy-filter header on the player feed. It is REQUIRED: without it ESPN returns its default page of 50 players, so a roster came back almost entirely unprojected — which reads as missing data, not as a truncated request. Only the limit VALUE is ignored (11,617 returned whatever is asked). Caught by running the real feed and reading the output; the unit guards could not see it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Read the week's schedule (mMatchup) and resolve a team's opponent. Until now nothing in the package knew who you play, so a lineup could only be optimised against the field instead of against the one team whose score actually has to be beaten.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Report WHY a league read came back empty. `readLeagueSettings` returns null for an unreachable ESPN exactly as it does for a league ESPN refuses, and `opponentTeamFor` returns null for a bye exactly as it does for a schedule nobody could read, so a caller could only guess — from whether a credential was stored, and from nothing at all. The outcome variants carry the classified failure alongside the same values.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Keep the COMPLETED weeks' actual stat lines the same response already carries. distilProjections kept one week and dropped the rest, so a player's scoring history was thrown away on every refresh and the spread model had nothing but its positional prior to work from. Measured on the live feed 2026-09-16: a request for scoringPeriodId=3 returned 1,740 week-1 actual rows (1,348 with stats) alongside the projections — and 69,653 rows from the PRIOR season, which is why the season filter is not optional.
 *
 * @module sports-fantasy-espn
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NON_STARTING_SLOTS = exports.PLAYER_FEED_FILTER = void 0;
exports.parseCredential = parseCredential;
exports.cookieHeader = cookieHeader;
exports.readLeague = readLeague;
exports.readLeagueSettings = readLeagueSettings;
exports.readLeagueSettingsOutcome = readLeagueSettingsOutcome;
exports.readTeams = readTeams;
exports.findOwnTeam = findOwnTeam;
exports.distilProjections = distilProjections;
exports.distilPlayerWeeks = distilPlayerWeeks;
exports.fetchProjections = fetchProjections;
exports.readMatchups = readMatchups;
exports.opponentTeamFor = opponentTeamFor;
exports.readMatchupsOutcome = readMatchupsOutcome;
exports.opponentOutcomeFor = opponentOutcomeFor;
const sports_espn_1 = require("./sports-espn");
const FANTASY_API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
/**
 * The filter header the season-level player feed requires. Its PRESENCE is what returns the full
 * player universe; the `limit` value is ignored by ESPN today and is set high so that a future ESPN
 * which honours it still returns everything.
 */
exports.PLAYER_FEED_FILTER = JSON.stringify({ players: { limit: 20000 } });
/**
 * @description Split the stored connector secret into its two cookies and normalise the SWID to its
 * braced form. The stored shape is `SWID:espn_s2`; a braced GUID contains no colon, so the FIRST
 * colon is the separator and an `espn_s2` containing colons survives intact.
 * @param secret - The brokered secret, or null when the caller has not connected.
 * @returns The credential, or null when absent or malformed. Never throws — a malformed secret is
 * "not connected", not an error to surface.
 */
function parseCredential(secret) {
    if (!secret)
        return null;
    const i = secret.indexOf(':');
    if (i < 1 || i >= secret.length - 1)
        return null;
    const raw = secret.slice(0, i).trim();
    const espnS2 = secret.slice(i + 1).trim();
    if (!raw || !espnS2)
        return null;
    return { swid: raw.startsWith('{') ? raw : `{${raw}}`, espnS2 };
}
/**
 * @description The cookie header for a private league read. Kept as its own function so there is
 * exactly one place the credential is turned into a header, and so a test can assert both cookies
 * are present — one alone authenticates nothing.
 * @param cred - The caller's credential.
 * @returns Headers for the request.
 */
function cookieHeader(cred) {
    return { Cookie: `SWID=${cred.swid}; espn_s2=${cred.espnS2}`, Accept: 'application/json' };
}
/**
 * @description Read a league with the given views. Adding `?view=` more than once is how ESPN
 * composes a response, so views are appended individually rather than comma-joined.
 * @param season - Season year.
 * @param leagueId - The league's numeric id.
 * @param views - ESPN view names, e.g. `mSettings`, `mTeam`, `mRoster`, `mMatchup`.
 * @param cred - The caller's cookies, or null for a public league.
 * @param opts - HTTP options (retry, logging, failure reporting).
 * @returns The league payload, or null when unreachable or not permitted.
 */
async function readLeague(season, leagueId, views, cred, opts = {}) {
    const qs = views.map((v) => `view=${encodeURIComponent(v)}`).join('&');
    const url = `${FANTASY_API}/seasons/${season}/segments/0/leagues/${encodeURIComponent(leagueId)}${qs ? `?${qs}` : ''}`;
    return (0, sports_espn_1.getJson)(url, opts, cred ? cookieHeader(cred) : undefined);
}
/** ESPN lineup slot ids that are not part of the STARTING lineup. 20 = bench, 21 = IR. */
exports.NON_STARTING_SLOTS = new Set([20, 21]);
/**
 * @description Read a league's name, current week, scoring rules and starting-lineup slots.
 * @param season - Season year.
 * @param leagueId - League id.
 * @param cred - The caller's cookies, or null for a public league.
 * @param opts - HTTP options.
 * @returns The settings, or null when the league is unreachable or not permitted.
 */
async function readLeagueSettings(season, leagueId, cred, opts = {}) {
    const body = await readLeague(season, leagueId, ['mSettings'], cred, opts);
    if (!body)
        return null;
    const settings = body.settings || {};
    const scoringItems = settings.scoringSettings?.scoringItems || [];
    const lineup = settings.rosterSettings?.lineupSlotCounts || {};
    const slots = Object.entries(lineup)
        .map(([slotId, count]) => ({ slotId: Number(slotId), count: Number(count) }))
        .filter((s) => s.count > 0 && !exports.NON_STARTING_SLOTS.has(s.slotId));
    return {
        leagueId: String(leagueId),
        season,
        name: String(settings.name || body.name || `League ${leagueId}`),
        scoringPeriodId: Number(body.scoringPeriodId) || 1,
        scoring: scoringItems
            .map((it) => ({ statId: Number(it.statId), points: Number(it.points) }))
            .filter((it) => Number.isFinite(it.statId) && Number.isFinite(it.points)),
        slots,
    };
}
/**
 * @description Read a league's settings and say WHY when nothing comes back. A caller that cannot
 * tell "we never reached ESPN" from "ESPN refused this league" can only guess from whether a
 * credential is stored, which is how a dead resolver came to be reported as "connect your ESPN
 * account" to someone whose account was already connected.
 * @param season - Season year.
 * @param leagueId - League id.
 * @param cred - The caller's cookies, or null for a public league.
 * @param opts - HTTP options.
 * @returns The settings, and the classified failure when there are none.
 */
async function readLeagueSettingsOutcome(season, leagueId, cred, opts = {}) {
    const { value, failure } = await (0, sports_espn_1.readWithOutcome)(opts, (o) => readLeagueSettings(season, leagueId, cred, o));
    return { settings: value, failure };
}
/**
 * @description Read every team in the league with its current roster and starting lineup.
 * @param season - Season year.
 * @param leagueId - League id.
 * @param week - Scoring period whose lineup to read.
 * @param cred - The caller's cookies, or null for a public league.
 * @param opts - HTTP options.
 * @returns Teams, or an empty array when unreachable.
 */
async function readTeams(season, leagueId, week, cred, opts = {}) {
    const qs = `?scoringPeriodId=${week}&view=mRoster&view=mTeam`;
    const url = `${FANTASY_API}/seasons/${season}/segments/0/leagues/${encodeURIComponent(leagueId)}${qs}`;
    const body = await (0, sports_espn_1.getJson)(url, opts, cred ? cookieHeader(cred) : undefined);
    const out = [];
    for (const t of body?.teams || []) {
        const entries = (t.roster?.entries || []).map((e) => ({
            playerId: Number(e.playerId),
            lineupSlotId: Number(e.lineupSlotId),
            player: e.playerPoolEntry?.player || e.player || {},
        }));
        out.push({
            teamId: Number(t.id),
            name: String(t.name || [t.location, t.nickname].filter(Boolean).join(' ') || `Team ${t.id}`).trim(),
            abbrev: String(t.abbrev || ''),
            owners: (t.owners || []).map((o) => String(o)),
            entries,
            rosterPlayerIds: entries.map((e) => e.playerId),
            startingPlayerIds: entries
                .filter((e) => !exports.NON_STARTING_SLOTS.has(e.lineupSlotId))
                .map((e) => e.playerId),
        });
    }
    return out;
}
/**
 * @description Find the caller's own team by matching their SWID against the league's owner ids, so
 * they never have to look up a team id by hand.
 * @param teams - Teams in the league.
 * @param swid - The caller's braced SWID.
 * @returns Their team, or null when the SWID owns none (a league they were removed from).
 */
function findOwnTeam(teams, swid) {
    const want = swid.toUpperCase();
    return teams.find((t) => t.owners.some((o) => o.toUpperCase() === want)) || null;
}
/**
 * @description Reduce ESPN's ~39MB player universe to the fields a lineup decision needs, for one
 * week. Everything else — historical splits, ownership trend series, draft ranks — is dropped
 * before anything is stored, because storing 39MB per week to read six fields is how a cache
 * becomes the problem it was meant to solve.
 * @param feed - The raw array from the players endpoint.
 * @param season - Season whose projections to keep.
 * @param week - Scoring period whose projections to keep.
 * @returns Players keyed by player id.
 */
function distilProjections(feed, season, week) {
    const out = {};
    for (const entry of feed || []) {
        const p = (entry && typeof entry === 'object' && 'player' in entry) ? entry.player : entry;
        if (!p || typeof p !== 'object' || !Number.isFinite(Number(p.id)))
            continue;
        const rows = p.stats || [];
        const proj = rows.find((s) => s.seasonId === season && s.scoringPeriodId === week
            && s.statSourceId === 1 && s.statSplitTypeId === 1);
        const actual = rows.find((s) => s.seasonId === season && s.scoringPeriodId === week
            && s.statSourceId === 0 && s.statSplitTypeId === 1);
        if (!proj && !actual)
            continue;
        out[Number(p.id)] = {
            playerId: Number(p.id),
            name: String(p.fullName || ''),
            eligibleSlots: (p.eligibleSlots || []).map((n) => Number(n)),
            projectedStats: (proj?.stats || {}),
            actualStats: actual?.stats,
            injuryStatus: p.injuryStatus ? String(p.injuryStatus) : undefined,
            proTeamId: Number(p.proTeamId) || 0,
            defaultPositionId: Number(p.defaultPositionId) || 0,
            percentOwned: Number(p.ownership?.percentOwned) || 0,
        };
    }
    return out;
}
/**
 * @description Keep every completed week's ACTUAL stat line the same response already carries.
 *
 * This is the half of the feed `distilProjections` throws away. That function is asked for one
 * week and keeps one week, which is right for a lineup decision and wrong for everything that needs
 * a player's history — and the history is the only thing that can make one player's spread differ
 * from another's at the same position and projection. Without it every candidate gets the positional
 * prior times his projection, two similar players get nearly identical spreads, and the
 * win-probability objective has nothing to trade.
 *
 * Measured live 2026-09-16, one credential-free request for `scoringPeriodId=3`: 11,617 players,
 * 1,740 rows with `statSourceId:0, statSplitTypeId:1, scoringPeriodId:1` (1,348 of them carrying
 * stats), and zero extra calls needed to get them.
 *
 * THREE FILTERS, AND EACH ONE IS LOAD-BEARING:
 *   - `seasonId` — the same response carried 69,653 rows from the PRIOR season on that run. Without
 *     this filter last year's weeks would be mixed into this year's history, which is worse than no
 *     history at all: it would look like evidence.
 *   - `statSourceId === 0` — source 1 is ESPN's projection. A projection has no dispersion to
 *     measure; feeding it back in would produce a spread estimated from a model's own smoothness.
 *   - `statSplitTypeId === 1` and `scoringPeriodId >= 1` — split 0 / period 0 is the SEASON total,
 *     which would enter the history as one enormous week.
 * @param feed - The raw array from the players endpoint.
 * @param season - Season whose weeks to keep.
 * @returns One row per player per completed week that produced stats.
 */
function distilPlayerWeeks(feed, season) {
    const out = [];
    for (const entry of feed || []) {
        const p = (entry && typeof entry === 'object' && 'player' in entry) ? entry.player : entry;
        if (!p || typeof p !== 'object' || !Number.isFinite(Number(p.id)))
            continue;
        for (const row of p.stats || []) {
            if (row?.seasonId !== season || row?.statSourceId !== 0 || row?.statSplitTypeId !== 1)
                continue;
            const week = Number(row.scoringPeriodId);
            if (!Number.isFinite(week) || week < 1)
                continue;
            const stats = row.stats;
            if (!stats || typeof stats !== 'object' || !Object.keys(stats).length)
                continue;
            out.push({ playerId: Number(p.id), week, stats: stats });
        }
    }
    return out;
}
/**
 * @description Fetch and distil the public player projections for one week. No credential is used
 * or needed. The response is large and the season-level filter header is ignored by ESPN, so this
 * belongs in a cached daily job and never on a request path.
 *
 * ONE REQUEST, BOTH HALVES. The response carries the completed weeks' actual lines as well as the
 * projections, so the scoring history costs nothing extra here and would cost a second ~40MB fetch
 * per week if it were asked for separately.
 * @param season - Season year.
 * @param week - Scoring period.
 * @param opts - HTTP options; give this a long timeout.
 * @returns The distilled players for the week and every completed week's actual lines; both empty
 *          when the feed is unreachable.
 */
async function fetchProjections(season, week, opts = {}) {
    const url = `${FANTASY_API}/seasons/${season}/players?scoringPeriodId=${week}&view=kona_player_info`;
    const feed = await (0, sports_espn_1.getJson)(url, { timeoutMs: 90_000, ...opts }, {
        Accept: 'application/json',
        // REQUIRED. Without this header ESPN returns its default page of 50 players; with it, the
        // whole universe. The limit value itself is ignored — it is set high so a future ESPN that
        // honours it still returns everything rather than truncating us to a page.
        'x-fantasy-filter': exports.PLAYER_FEED_FILTER,
    });
    if (!Array.isArray(feed))
        return { players: {}, weeks: [] };
    return { players: distilProjections(feed, season, week), weeks: distilPlayerWeeks(feed, season) };
}
/**
 * @description Read the league's schedule so a lineup can be optimised against the one team whose
 * score has to be beaten.
 *
 * ESPN keys the schedule by `matchupPeriodId`, which is NOT the same field as the `scoringPeriodId`
 * a lineup is set for. They coincide in a standard weekly football league and diverge in the
 * multi-week playoff formats some leagues use, so the caller's week is matched against the matchup
 * period and a miss returns nothing rather than the wrong fixture.
 * @param season - Season year.
 * @param leagueId - League id.
 * @param cred - The caller's cookies, or null for a public league.
 * @param opts - HTTP options.
 * @returns Every fixture in the season, or an empty array when the schedule is unreadable.
 */
async function readMatchups(season, leagueId, cred, opts = {}) {
    const body = await readLeague(season, leagueId, ['mMatchup'], cred, opts);
    const out = [];
    for (const m of body?.schedule || []) {
        const home = Number(m?.home?.teamId);
        if (!Number.isFinite(home))
            continue;
        const away = Number(m?.away?.teamId);
        out.push({
            matchupPeriodId: Number(m?.matchupPeriodId) || 0,
            homeTeamId: home,
            awayTeamId: Number.isFinite(away) ? away : null,
        });
    }
    return out;
}
/**
 * @description The team a given team plays in a given week.
 * @param matchups - The season's fixtures.
 * @param teamId - The team whose opponent is wanted.
 * @param week - Matchup period.
 * @returns The opponent's team id, or null on a bye, an unplayed week, or an unreadable schedule —
 *          all of which mean the same thing to the OPTIMISER: play against nobody. They do not mean
 *          the same thing to the person reading the screen; use `opponentOutcomeFor` for that.
 */
function opponentTeamFor(matchups, teamId, week) {
    for (const m of matchups) {
        if (m.matchupPeriodId !== week)
            continue;
        if (m.homeTeamId === teamId)
            return m.awayTeamId;
        if (m.awayTeamId === teamId)
            return m.homeTeamId;
    }
    return null;
}
/**
 * @description Read the season's fixtures and say WHY when none come back. An empty schedule and an
 * unreadable one are the same array, and telling a manager he has a bye when ESPN simply could not
 * be read is a wrong reason attached to a right lineup.
 * @param season - Season year.
 * @param leagueId - League id.
 * @param cred - The caller's cookies, or null for a public league.
 * @param opts - HTTP options.
 * @returns The fixtures, and the classified failure when the read produced none.
 */
async function readMatchupsOutcome(season, leagueId, cred, opts = {}) {
    const { value, failure } = await (0, sports_espn_1.readWithOutcome)(opts, (o) => readMatchups(season, leagueId, cred, o));
    return { matchups: value, failure };
}
/**
 * @description Resolve a week's opponent and, when there is none, which kind of none. A fixture
 * that exists with only one side is a bye; no fixture at all for that matchup period is a schedule
 * that does not cover the week. Both are legitimate and neither is a failure — but they are also
 * not the same sentence, and neither is a schedule the caller could not read at all.
 * @param matchups - The season's fixtures.
 * @param teamId - The team whose opponent is wanted.
 * @param week - Matchup period.
 * @returns The opponent id and the reason there is or is not one.
 */
function opponentOutcomeFor(matchups, teamId, week) {
    for (const m of matchups) {
        if (m.matchupPeriodId !== week)
            continue;
        if (m.homeTeamId === teamId) {
            return m.awayTeamId === null
                ? { opponentTeamId: null, reason: 'bye' }
                : { opponentTeamId: m.awayTeamId, reason: 'opponent' };
        }
        if (m.awayTeamId === teamId)
            return { opponentTeamId: m.homeTeamId, reason: 'opponent' };
    }
    return { opponentTeamId: null, reason: 'not-scheduled' };
}
//# sourceMappingURL=sports-fantasy-espn.js.map