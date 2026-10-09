"use strict";
/**
 * Postgres access for Fantasy Football — linked leagues, the cached projection feed, each player's
 * completed weeks, and the start/sit ledger.
 *
 * EVERY ROW BELONGS TO ONE PERSON, AND THE DATABASE ENFORCES IT (operator decision 2026-09-27,
 * ADR-146 Q2: "only i can control my team.. no one else can see my team and connection"). Every
 * table is keyed by `user_sub` under FORCED row-level security with an EXACT-OWNER policy: a row is
 * visible and writable only when `oshal.current_sub` — stamped per request by the framework's GUC
 * pool from the signed-in subject — equals its `user_sub`. There is deliberately NO operator arm:
 * no role, operator or service, reads another person's team through these tables. FORCE matters
 * because the api owns the tables and PostgreSQL exempts an owner from its own policies otherwise.
 *
 * Every statement also names `user_sub = $1` itself, so a query that forgot the owner would still
 * be refused twice rather than once.
 *
 * THE PUBLIC PROJECTION FEED IS CACHED PER PERSON TOO. The feed is the same for everybody, but a
 * shared cache is a table one person's refresh writes and another person's lineup reads, and "every
 * table user_sub-keyed" leaves no room for one. The cost is one feed read per person per refresh
 * window; the in-process single-flight in the routes still collapses concurrent fetches into one.
 *
 * The ESPN cookies never appear here: they live in the encrypted connector store and are resolved
 * per request through the broker, so nothing in this module can put them into a row, a log or a
 * cache. `ensureFantasySchema` mirrors migrations/001 because APP_PACKAGE_MIGRATIONS is a flag and
 * the app has to work where it is off; the migration is the record, this is the bootstrap.
 *
 * No framework imports, so the compiled module loads under the plain-node test suites.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — moved from sports-edge (sports-fantasy-store.ts) into the fantasy-football package (ADR-146 D1) and re-keyed for per-user ownership (Q2): ff_leagues, ff_projections, ff_player_weeks and ff_calls are all user_sub-keyed under FORCED exact-owner row-level security with no operator arm, and every statement takes the owner first. The projection cache and completed weeks, shared per (season, week) in sports-edge, are now per person. The schema self-heal creates the same policies the migration does.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The self-heal now also creates ff_manual_leagues and ff_weeks (migration 002) and walls them with the same exact-owner policy; OWNED_TABLES lists all six, openCallsForWeek lists one week's open calls so the week ledger can settle them before a week closes, and readProjectionWeeks reads a person's cached feeds over a range of weeks for the season plan.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | gradeCall types its subtraction ($3::numeric - $4::numeric). The statement moved from sports-edge had never run against PostgreSQL, which refuses it with 'operator is not unique: unknown - unknown' (measured on the disposable PostgreSQL of tests/fantasy-isolation.spec.ts); no start/sit call could ever have been graded.
 *
 * @module fantasy-store
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAYER_WEEK_CHUNK = exports.OWNED_TABLES = void 0;
exports.ownerPolicyStatements = ownerPolicyStatements;
exports.ensureFantasySchema = ensureFantasySchema;
exports.linkLeague = linkLeague;
exports.unlinkLeague = unlinkLeague;
exports.listLeagues = listLeagues;
exports.readProjections = readProjections;
exports.writeProjections = writeProjections;
exports.writePlayerWeeks = writePlayerWeeks;
exports.readPlayerWeeks = readPlayerWeeks;
exports.recordCalls = recordCalls;
exports.openCalls = openCalls;
exports.openCallsForWeek = openCallsForWeek;
exports.gradeCall = gradeCall;
exports.fantasyRecord = fantasyRecord;
exports.listCalls = listCalls;
exports.readProjectionWeeks = readProjectionWeeks;
/** Every table this package owns. Each one is walled by the same exact-owner policy. */
exports.OWNED_TABLES = ['ff_leagues', 'ff_projections', 'ff_player_weeks', 'ff_calls', 'ff_manual_leagues', 'ff_weeks'];
/** DDL kept equivalent to migrations/001-fantasy-football.sql and 002-fantasy-manual-and-weeks.sql. */
const DDL = [
    `CREATE TABLE IF NOT EXISTS ff_leagues (
     id BIGSERIAL PRIMARY KEY, user_sub TEXT NOT NULL, season INTEGER NOT NULL,
     league_id TEXT NOT NULL, league_name TEXT, team_id INTEGER, team_name TEXT,
     linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT ff_leagues_unique UNIQUE (user_sub, season, league_id))`,
    `CREATE TABLE IF NOT EXISTS ff_projections (
     user_sub TEXT NOT NULL, season INTEGER NOT NULL, scoring_period INTEGER NOT NULL,
     payload JSONB NOT NULL, players INTEGER NOT NULL DEFAULT 0,
     generated_at TIMESTAMPTZ NOT NULL DEFAULT now(), build_ms INTEGER,
     PRIMARY KEY (user_sub, season, scoring_period))`,
    `CREATE TABLE IF NOT EXISTS ff_player_weeks (
     user_sub TEXT NOT NULL, season INTEGER NOT NULL, week INTEGER NOT NULL, player_id INTEGER NOT NULL,
     stats JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (user_sub, season, week, player_id))`,
    `CREATE TABLE IF NOT EXISTS ff_calls (
     id BIGSERIAL PRIMARY KEY, user_sub TEXT NOT NULL, season INTEGER NOT NULL,
     league_id TEXT NOT NULL, week INTEGER NOT NULL,
     start_player_id INTEGER NOT NULL, start_player_name TEXT,
     sit_player_id INTEGER NOT NULL, sit_player_name TEXT, slot_id INTEGER,
     projected_start NUMERIC(7,2), projected_sit NUMERIC(7,2), projected_gain NUMERIC(7,2) NOT NULL,
     reason TEXT, settled BOOLEAN NOT NULL DEFAULT FALSE,
     actual_start NUMERIC(7,2), actual_sit NUMERIC(7,2), actual_gain NUMERIC(7,2),
     graded_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT ff_calls_unique UNIQUE (user_sub, season, league_id, week, start_player_id, sit_player_id))`,
    `CREATE INDEX IF NOT EXISTS idx_ff_calls_open ON ff_calls (user_sub, settled, season, week)`,
    `CREATE INDEX IF NOT EXISTS idx_ff_calls_user ON ff_calls (user_sub, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS ff_manual_leagues (
     id BIGSERIAL PRIMARY KEY, user_sub TEXT NOT NULL, name TEXT NOT NULL, season INTEGER NOT NULL,
     doc JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE INDEX IF NOT EXISTS idx_ff_manual_leagues_user ON ff_manual_leagues (user_sub, updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS ff_weeks (
     user_sub TEXT NOT NULL, season INTEGER NOT NULL, league_key TEXT NOT NULL, week INTEGER NOT NULL,
     source TEXT NOT NULL, advised JSONB NOT NULL, mean_lineup JSONB NOT NULL, started JSONB NOT NULL,
     swaps JSONB NOT NULL DEFAULT '[]'::jsonb, win_probability NUMERIC(6,4), mean_win_probability NUMERIC(6,4),
     projected_advised NUMERIC(7,2), projected_started NUMERIC(7,2), graded BOOLEAN NOT NULL DEFAULT FALSE,
     actual_advised NUMERIC(7,2), actual_started NUMERIC(7,2), actual_gain NUMERIC(7,2),
     recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), graded_at TIMESTAMPTZ,
     PRIMARY KEY (user_sub, season, league_key, week))`,
];
/**
 * @description The row-security statements for one owned table: enable, FORCE (the api owns the
 * table, and an owner is exempt from its own policies unless forced), and an exact-owner policy
 * created only when absent, so re-running never opens a window with security on and no policy.
 * @param table - One of OWNED_TABLES (a trusted identifier, never input).
 * @returns Idempotent SQL statements.
 */
function ownerPolicyStatements(table) {
    const policy = `${table}_owner`;
    const owner = "user_sub = nullif(current_setting('oshal.current_sub', true), '')";
    return [
        `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
        `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`,
        `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = '${policy}' AND polrelid = '${table}'::regclass) THEN
         CREATE POLICY ${policy} ON ${table} AS PERMISSIVE FOR ALL USING (${owner}) WITH CHECK (${owner});
       END IF;
     END $$`,
    ];
}
/**
 * @description Create every table and its owner policy, idempotently.
 * @param pool - Postgres pool.
 * @returns Nothing; throws if the database is unreachable.
 */
async function ensureFantasySchema(pool) {
    for (const stmt of DDL)
        await pool.query(stmt);
    for (const table of exports.OWNED_TABLES) {
        for (const stmt of ownerPolicyStatements(table))
            await pool.query(stmt);
    }
}
/**
 * @description Link (or re-link) a league to a person. Idempotent per (user, season, league).
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param league - The league to link.
 * @returns Nothing.
 */
async function linkLeague(pool, userSub, league) {
    await pool.query(`INSERT INTO ff_leagues (user_sub, season, league_id, league_name, team_id, team_name)
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
    const r = await pool.query('DELETE FROM ff_leagues WHERE user_sub = $1 AND season = $2 AND league_id = $3', [userSub, season, leagueId]);
    return r.rowCount || 0;
}
/**
 * @description The leagues a person has linked, oldest first so display order is stable.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @returns Linked leagues.
 */
async function listLeagues(pool, userSub) {
    const r = await pool.query(`SELECT season, league_id, league_name, team_id, team_name FROM ff_leagues
     WHERE user_sub = $1 ORDER BY linked_at ASC`, [userSub]);
    return r.rows.map((x) => ({
        season: Number(x.season), leagueId: x.league_id, leagueName: x.league_name,
        teamId: x.team_id === null ? null : Number(x.team_id), teamName: x.team_name,
    }));
}
/**
 * @description Read a person's cached projection feed for a week.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param season - Season year.
 * @param week - Scoring period.
 * @returns The cache, or null when nothing has been fetched for them yet.
 */
async function readProjections(pool, userSub, season, week) {
    const r = await pool.query(`SELECT payload, players, generated_at FROM ff_projections
     WHERE user_sub = $1 AND season = $2 AND scoring_period = $3`, [userSub, season, week]);
    if (!r.rows.length)
        return null;
    return {
        players: r.rows[0].payload,
        generatedAt: new Date(r.rows[0].generated_at).toISOString(),
        count: Number(r.rows[0].players) || 0,
    };
}
/**
 * @description Store the distilled projection feed for a week, replacing the person's previous one.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param season - Season year.
 * @param week - Scoring period.
 * @param players - Distilled players keyed by id.
 * @param buildMs - How long the fetch took, for the status panel.
 * @returns Nothing.
 */
async function writeProjections(pool, userSub, season, week, players, buildMs) {
    await pool.query(`INSERT INTO ff_projections (user_sub, season, scoring_period, payload, players, generated_at, build_ms)
     VALUES ($1,$2,$3,$4,$5, now(), $6)
     ON CONFLICT (user_sub, season, scoring_period) DO UPDATE
     SET payload = EXCLUDED.payload, players = EXCLUDED.players, generated_at = now(), build_ms = EXCLUDED.build_ms`, [userSub, season, week, JSON.stringify(players), Object.keys(players).length, buildMs]);
}
/**
 * How many player-weeks go into one INSERT. The feed produces on the order of 1,400 rows per
 * completed week (1,348 on the live run of 2026-09-16), so a full season is ~25,000 rows and a row
 * at a time would be 25,000 round trips for data that is refreshed at most every few hours.
 */
exports.PLAYER_WEEK_CHUNK = 500;
/**
 * @description Store completed weeks' actual stat lines for one person. Idempotent: a completed week
 * never changes, and the week still in progress is simply overwritten as it fills in.
 *
 * RAW STATS, NOT POINTS. A week's fantasy points do not exist until a league's scoring rules are
 * applied, and one person can be in two leagues that price the same line differently.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param season - Season year.
 * @param rows - Player-weeks from the feed.
 * @returns How many rows were written or refreshed.
 */
async function writePlayerWeeks(pool, userSub, season, rows) {
    let written = 0;
    for (let i = 0; i < rows.length; i += exports.PLAYER_WEEK_CHUNK) {
        const chunk = rows.slice(i, i + exports.PLAYER_WEEK_CHUNK);
        const values = [userSub, season];
        const tuples = chunk.map((r, j) => {
            values.push(r.week, r.playerId, JSON.stringify(r.stats));
            const b = 2 + j * 3;
            return `($1,$2,$${b + 1},$${b + 2},$${b + 3})`;
        });
        const res = await pool.query(`INSERT INTO ff_player_weeks (user_sub, season, week, player_id, stats)
       VALUES ${tuples.join(',')}
       ON CONFLICT (user_sub, season, week, player_id) DO UPDATE
       SET stats = EXCLUDED.stats, updated_at = now()`, values);
        written += res.rowCount || 0;
    }
    return written;
}
/**
 * @description A set of players' completed weeks, for the scoring history behind their spreads.
 *
 * `beforeWeek` is EXCLUSIVE: the week being set is in progress, its actuals are partial or absent,
 * and letting a half-played week into the history would tell the spread model that a player who
 * has not kicked off yet scored zero.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param season - Season year.
 * @param beforeWeek - Only weeks strictly before this one.
 * @param playerIds - The players whose history is wanted — a roster, not the universe.
 * @returns Their stored weeks, oldest first.
 */
async function readPlayerWeeks(pool, userSub, season, beforeWeek, playerIds) {
    const ids = [...new Set(playerIds.filter((n) => Number.isFinite(n)))];
    if (!ids.length)
        return [];
    const r = await pool.query(`SELECT week, player_id, stats FROM ff_player_weeks
     WHERE user_sub = $1 AND season = $2 AND week < $3 AND player_id = ANY($4::int[])
     ORDER BY week ASC`, [userSub, season, beforeWeek, ids]);
    return r.rows.map((x) => ({
        playerId: Number(x.player_id), week: Number(x.week), stats: x.stats,
    }));
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
        const r = await pool.query(`INSERT INTO ff_calls
         (user_sub, season, league_id, week, start_player_id, start_player_name,
          sit_player_id, sit_player_name, slot_id, projected_start, projected_sit, projected_gain, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (user_sub, season, league_id, week, start_player_id, sit_player_id) DO UPDATE
       SET projected_start = EXCLUDED.projected_start, projected_sit = EXCLUDED.projected_sit,
           projected_gain = EXCLUDED.projected_gain, reason = EXCLUDED.reason, slot_id = EXCLUDED.slot_id
       WHERE ff_calls.settled = FALSE`, [userSub, season, leagueId, week, c.start.playerId, c.start.name, c.sit.playerId, c.sit.name,
            c.slotId, c.start.points, c.sit.points, c.gain, c.reason]);
        n += r.rowCount || 0;
    }
    return n;
}
/**
 * @description A person's registered calls for weeks that have finished but are not graded yet.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param season - Season year.
 * @param beforeWeek - Only weeks strictly before this one, so a week still in progress is not graded.
 * @param limit - Maximum rows.
 * @returns Ungraded calls.
 */
async function openCalls(pool, userSub, season, beforeWeek, limit = 500) {
    const r = await pool.query(`SELECT id, season, league_id, week, start_player_id, sit_player_id
     FROM ff_calls
     WHERE user_sub = $1 AND settled = FALSE AND season = $2 AND week < $3
     ORDER BY week ASC LIMIT $4`, [userSub, season, beforeWeek, limit]);
    return r.rows.map((x) => ({
        id: Number(x.id), season: Number(x.season), leagueId: x.league_id, week: Number(x.week),
        startPlayerId: Number(x.start_player_id), sitPlayerId: Number(x.sit_player_id),
    }));
}
/**
 * @description A person's ungraded calls for one league and one week — the calls a week grade must
 * settle before the week may close.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param season - Season year.
 * @param leagueKey - The league id (or `manual:<id>` for a hand-typed league).
 * @param week - The week.
 * @returns Ungraded calls.
 */
async function openCallsForWeek(pool, userSub, season, leagueKey, week) {
    const r = await pool.query(`SELECT id, season, league_id, week, start_player_id, sit_player_id
     FROM ff_calls
     WHERE user_sub = $1 AND settled = FALSE AND season = $2 AND league_id = $3 AND week = $4`, [userSub, season, leagueKey, week]);
    return r.rows.map((x) => ({
        id: Number(x.id), season: Number(x.season), leagueId: x.league_id, week: Number(x.week),
        startPlayerId: Number(x.start_player_id), sitPlayerId: Number(x.sit_player_id),
    }));
}
/**
 * @description Grade one of the person's calls against what the two players actually scored.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param id - Ledger row id.
 * @param actualStart - Points the recommended starter actually scored.
 * @param actualSit - Points the benched player actually scored.
 * @returns Nothing.
 */
async function gradeCall(pool, userSub, id, actualStart, actualSit) {
    await pool.query(`UPDATE ff_calls
     SET settled = TRUE, actual_start = $3, actual_sit = $4, actual_gain = $3::numeric - $4::numeric, graded_at = now()
     WHERE user_sub = $1 AND id = $2 AND settled = FALSE`, [userSub, id, actualStart, actualSit]);
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
     FROM ff_calls WHERE user_sub = $1 AND settled = TRUE`, [userSub]);
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
     FROM ff_calls WHERE user_sub = $1 ORDER BY created_at DESC LIMIT $2`, [userSub, limit]);
    return r.rows;
}
/**
 * @description A person's cached projection feeds for a range of weeks, for the season plan.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param season - Season year.
 * @param fromWeek - First week wanted.
 * @param toWeek - Last week wanted.
 * @returns Feeds keyed by week; weeks never read are absent.
 */
async function readProjectionWeeks(pool, userSub, season, fromWeek, toWeek) {
    const r = await pool.query(`SELECT scoring_period, payload FROM ff_projections
     WHERE user_sub = $1 AND season = $2 AND scoring_period BETWEEN $3 AND $4 ORDER BY scoring_period`, [userSub, season, fromWeek, toWeek]);
    return new Map(r.rows.map((x) => [Number(x.scoring_period), x.payload]));
}
//# sourceMappingURL=fantasy-store.js.map