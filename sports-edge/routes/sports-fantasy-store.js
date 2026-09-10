"use strict";
/**
 * Postgres access for the fantasy half — linked leagues, the cached projection feed, and the
 * start/sit ledger.
 *
 * Every statement is parameterised and every read that touches a person's data takes a `userSub`
 * first, so a caller cannot accidentally write a query that spans users. The ESPN cookies never
 * appear here: they live in the encrypted connector store and are resolved per request through the
 * broker, so nothing in this module can leak them into a row, a log, or a cache.
 *
 * `ensureFantasySchema` mirrors migrations/002 because APP_PACKAGE_MIGRATIONS is a flag and the app
 * has to work on a deployment where it is off. The migration is the record; this is the bootstrap.
 *
 * No framework imports, so the compiled module loads under the plain-node test suites.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — schema self-heal, per-user league links, the shared projection cache, and the start/sit ledger's upsert, open-row and grading statements.
 *
 * @module sports-fantasy-store
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureFantasySchema = ensureFantasySchema;
exports.linkLeague = linkLeague;
exports.unlinkLeague = unlinkLeague;
exports.listLeagues = listLeagues;
exports.readProjections = readProjections;
exports.writeProjections = writeProjections;
exports.recordCalls = recordCalls;
exports.openCalls = openCalls;
exports.gradeCall = gradeCall;
exports.fantasyRecord = fantasyRecord;
exports.listCalls = listCalls;
/** DDL kept equivalent to migrations/002-sports-fantasy.sql. */
const DDL = [
    `CREATE TABLE IF NOT EXISTS sports_fantasy_leagues (
     id BIGSERIAL PRIMARY KEY, user_sub TEXT NOT NULL, season INTEGER NOT NULL,
     league_id TEXT NOT NULL, league_name TEXT, team_id INTEGER, team_name TEXT,
     linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT sports_fantasy_leagues_unique UNIQUE (user_sub, season, league_id))`,
    `CREATE INDEX IF NOT EXISTS idx_sports_fantasy_leagues_user ON sports_fantasy_leagues (user_sub)`,
    `CREATE TABLE IF NOT EXISTS sports_fantasy_projections (
     season INTEGER NOT NULL, scoring_period INTEGER NOT NULL, payload JSONB NOT NULL,
     players INTEGER NOT NULL DEFAULT 0, generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     build_ms INTEGER, PRIMARY KEY (season, scoring_period))`,
    `CREATE TABLE IF NOT EXISTS sports_fantasy_calls (
     id BIGSERIAL PRIMARY KEY, user_sub TEXT NOT NULL, season INTEGER NOT NULL,
     league_id TEXT NOT NULL, week INTEGER NOT NULL,
     start_player_id INTEGER NOT NULL, start_player_name TEXT,
     sit_player_id INTEGER NOT NULL, sit_player_name TEXT, slot_id INTEGER,
     projected_start NUMERIC(7,2), projected_sit NUMERIC(7,2), projected_gain NUMERIC(7,2) NOT NULL,
     reason TEXT, settled BOOLEAN NOT NULL DEFAULT FALSE,
     actual_start NUMERIC(7,2), actual_sit NUMERIC(7,2), actual_gain NUMERIC(7,2),
     graded_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT sports_fantasy_calls_unique UNIQUE (user_sub, season, league_id, week, start_player_id, sit_player_id))`,
    `CREATE INDEX IF NOT EXISTS idx_sports_fantasy_calls_open ON sports_fantasy_calls (settled, season, week)`,
    `CREATE INDEX IF NOT EXISTS idx_sports_fantasy_calls_user ON sports_fantasy_calls (user_sub, created_at DESC)`,
];
/**
 * @description Create every fantasy table, idempotently.
 * @param pool - Postgres pool.
 * @returns Nothing; throws if the database is unreachable.
 */
async function ensureFantasySchema(pool) {
    for (const stmt of DDL)
        await pool.query(stmt);
}
/**
 * @description Link (or re-link) a league to a person. Idempotent per (user, season, league).
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param league - The league to link.
 * @returns Nothing.
 */
async function linkLeague(pool, userSub, league) {
    await pool.query(`INSERT INTO sports_fantasy_leagues (user_sub, season, league_id, league_name, team_id, team_name)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_sub, season, league_id) DO UPDATE
     SET league_name = EXCLUDED.league_name, team_id = EXCLUDED.team_id, team_name = EXCLUDED.team_name`, [userSub, league.season, league.leagueId, league.leagueName, league.teamId, league.teamName]);
}
/**
 * @description Unlink a league.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param season - Season year.
 * @param leagueId - League id.
 * @returns Rows removed, so a caller can report "not linked" honestly.
 */
async function unlinkLeague(pool, userSub, season, leagueId) {
    const r = await pool.query('DELETE FROM sports_fantasy_leagues WHERE user_sub = $1 AND season = $2 AND league_id = $3', [userSub, season, leagueId]);
    return r.rowCount || 0;
}
/**
 * @description The leagues a person has linked, oldest first so display order is stable.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @returns Linked leagues.
 */
async function listLeagues(pool, userSub) {
    const r = await pool.query(`SELECT season, league_id, league_name, team_id, team_name FROM sports_fantasy_leagues
     WHERE user_sub = $1 ORDER BY linked_at ASC`, [userSub]);
    return r.rows.map((x) => ({
        season: Number(x.season), leagueId: x.league_id, leagueName: x.league_name,
        teamId: x.team_id === null ? null : Number(x.team_id), teamName: x.team_name,
    }));
}
/**
 * @description Read the cached projection feed for a week.
 * @param pool - Postgres pool.
 * @param season - Season year.
 * @param week - Scoring period.
 * @returns The cache, or null when nothing has been fetched yet.
 */
async function readProjections(pool, season, week) {
    const r = await pool.query('SELECT payload, players, generated_at FROM sports_fantasy_projections WHERE season = $1 AND scoring_period = $2', [season, week]);
    if (!r.rows.length)
        return null;
    return {
        players: r.rows[0].payload,
        generatedAt: new Date(r.rows[0].generated_at).toISOString(),
        count: Number(r.rows[0].players) || 0,
    };
}
/**
 * @description Store the distilled projection feed for a week, replacing any previous one.
 * @param pool - Postgres pool.
 * @param season - Season year.
 * @param week - Scoring period.
 * @param players - Distilled players keyed by id.
 * @param buildMs - How long the fetch took, for the status panel.
 * @returns Nothing.
 */
async function writeProjections(pool, season, week, players, buildMs) {
    await pool.query(`INSERT INTO sports_fantasy_projections (season, scoring_period, payload, players, generated_at, build_ms)
     VALUES ($1,$2,$3,$4, now(), $5)
     ON CONFLICT (season, scoring_period) DO UPDATE
     SET payload = EXCLUDED.payload, players = EXCLUDED.players, generated_at = now(), build_ms = EXCLUDED.build_ms`, [season, week, JSON.stringify(players), Object.keys(players).length, buildMs]);
}
/**
 * @description Register start/sit calls before kickoff. Re-running the advisor UPDATES the row for
 * the same swap rather than appending a second opinion; a settled row is left alone.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param season - Season year.
 * @param leagueId - League id.
 * @param week - Scoring period.
 * @param calls - The recommendations.
 * @returns How many rows were written or refreshed.
 */
async function recordCalls(pool, userSub, season, leagueId, week, calls) {
    let n = 0;
    for (const c of calls) {
        const r = await pool.query(`INSERT INTO sports_fantasy_calls
         (user_sub, season, league_id, week, start_player_id, start_player_name,
          sit_player_id, sit_player_name, slot_id, projected_start, projected_sit, projected_gain, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (user_sub, season, league_id, week, start_player_id, sit_player_id) DO UPDATE
       SET projected_start = EXCLUDED.projected_start, projected_sit = EXCLUDED.projected_sit,
           projected_gain = EXCLUDED.projected_gain, reason = EXCLUDED.reason, slot_id = EXCLUDED.slot_id
       WHERE sports_fantasy_calls.settled = FALSE`, [userSub, season, leagueId, week, c.start.playerId, c.start.name, c.sit.playerId, c.sit.name,
            c.slotId, c.start.points, c.sit.points, c.gain, c.reason]);
        n += r.rowCount || 0;
    }
    return n;
}
/**
 * @description Every registered call for a week that has not been graded yet.
 * @param pool - Postgres pool.
 * @param season - Season year.
 * @param beforeWeek - Only weeks strictly before this one, so a week still in progress is not graded.
 * @param limit - Maximum rows.
 * @returns Ungraded calls.
 */
async function openCalls(pool, season, beforeWeek, limit = 500) {
    const r = await pool.query(`SELECT id, user_sub, season, league_id, week, start_player_id, sit_player_id
     FROM sports_fantasy_calls
     WHERE settled = FALSE AND season = $1 AND week < $2
     ORDER BY week ASC LIMIT $3`, [season, beforeWeek, limit]);
    return r.rows.map((x) => ({
        id: Number(x.id), userSub: x.user_sub, season: Number(x.season), leagueId: x.league_id,
        week: Number(x.week), startPlayerId: Number(x.start_player_id), sitPlayerId: Number(x.sit_player_id),
    }));
}
/**
 * @description Grade one call against what the two players actually scored.
 * @param pool - Postgres pool.
 * @param id - Ledger row id.
 * @param actualStart - Points the recommended starter actually scored.
 * @param actualSit - Points the benched player actually scored.
 * @returns Nothing.
 */
async function gradeCall(pool, id, actualStart, actualSit) {
    await pool.query(`UPDATE sports_fantasy_calls
     SET settled = TRUE, actual_start = $2, actual_sit = $3, actual_gain = $2 - $3, graded_at = now()
     WHERE id = $1 AND settled = FALSE`, [id, actualStart, actualSit]);
}
/**
 * @description Roll up a person's graded start/sit calls. Reports the projected gain beside the
 * actual one on purpose: a tool that claimed +40 and delivered +2 is a different thing from one
 * that claimed +3 and delivered +2, and a win rate alone hides that completely.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @returns The rollup.
 */
async function fantasyRecord(pool, userSub) {
    const r = await pool.query(`SELECT count(*) AS graded,
            count(*) FILTER (WHERE actual_gain > 0) AS right_calls,
            coalesce(sum(actual_gain), 0) AS actual_points,
            coalesce(sum(projected_gain), 0) AS projected_points
     FROM sports_fantasy_calls WHERE user_sub = $1 AND settled = TRUE`, [userSub]);
    const row = r.rows[0] || {};
    return {
        graded: Number(row.graded) || 0,
        right: Number(row.right_calls) || 0,
        actualPoints: Math.round((Number(row.actual_points) || 0) * 100) / 100,
        projectedPoints: Math.round((Number(row.projected_points) || 0) * 100) / 100,
    };
}
/**
 * @description A person's recent calls, graded or not, for the ledger view.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param limit - Maximum rows.
 * @returns Rows, newest first.
 */
async function listCalls(pool, userSub, limit = 100) {
    const r = await pool.query(`SELECT season, league_id, week, start_player_name, sit_player_name, projected_gain,
            settled, actual_start, actual_sit, actual_gain, reason, created_at, graded_at
     FROM sports_fantasy_calls WHERE user_sub = $1 ORDER BY created_at DESC LIMIT $2`, [userSub, limit]);
    return r.rows;
}
//# sourceMappingURL=sports-fantasy-store.js.map