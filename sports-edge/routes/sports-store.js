"use strict";
/**
 * Postgres access for sports-edge — followed teams, cached ratings and previews, settings, and the
 * prediction ledger.
 *
 * Every statement here is parameterised and every read that touches a person's data takes a
 * `userSub` as its first argument, so a caller cannot accidentally write a query that spans users.
 * The route layer resolves that sub from the request; this module never guesses one.
 *
 * SCHEMA SELF-HEALS. `ensureSchema` creates the same tables migrations/001 declares, because
 * APP_PACKAGE_MIGRATIONS is a flag and the app has to work on a deployment where it is off. The two
 * definitions are kept identical on purpose; the migration is the record, this is the bootstrap.
 *
 * No framework imports, so the compiled module loads under the plain-node test suites.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — schema self-heal, per-user followed teams, ratings/preview caches, scoped settings, and the prediction ledger's upsert, open-row and grading statements.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Added the sports_world_pulls ledger (migrations/004) and its read/record pair: when each World subject was last pulled, so the re-pull cool-down survives a restart. Without it every restart re-classifies the same archive at model cost — invisible, because content-hash dedup means the archive still looks correct.
 *
 * @module sports-store
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEPLOYMENT_SCOPE = void 0;
exports.ensureSchema = ensureSchema;
exports.followTeam = followTeam;
exports.unfollowTeam = unfollowTeam;
exports.listFollowed = listFollowed;
exports.readRatings = readRatings;
exports.writeRatings = writeRatings;
exports.readPreview = readPreview;
exports.writePreview = writePreview;
exports.readSettings = readSettings;
exports.writeSettings = writeSettings;
exports.upsertPredictions = upsertPredictions;
exports.openPredictions = openPredictions;
exports.gradePrediction = gradePrediction;
exports.gradedRows = gradedRows;
exports.predictionsForEvent = predictionsForEvent;
exports.worldPullTimes = worldPullTimes;
exports.recordWorldPull = recordWorldPull;
/** Settings scope key for values that apply to the whole deployment. */
exports.DEPLOYMENT_SCOPE = '__deployment__';
/** DDL kept byte-equivalent to migrations/001-sports-edge.sql. */
const DDL = [
    `CREATE TABLE IF NOT EXISTS sports_followed_teams (
     id BIGSERIAL PRIMARY KEY, user_sub TEXT NOT NULL, league TEXT NOT NULL, team TEXT NOT NULL,
     team_id TEXT NOT NULL, display_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT sports_followed_teams_unique UNIQUE (user_sub, league, team))`,
    `CREATE INDEX IF NOT EXISTS idx_sports_followed_user ON sports_followed_teams (user_sub)`,
    `CREATE TABLE IF NOT EXISTS sports_ratings_cache (
     league TEXT NOT NULL, season INTEGER NOT NULL, payload JSONB NOT NULL,
     games INTEGER NOT NULL DEFAULT 0, generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     build_ms INTEGER, PRIMARY KEY (league, season))`,
    `CREATE TABLE IF NOT EXISTS sports_previews (
     event_id TEXT PRIMARY KEY, league TEXT NOT NULL, game_date TIMESTAMPTZ,
     home_team TEXT NOT NULL, away_team TEXT NOT NULL, payload JSONB NOT NULL,
     generated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE INDEX IF NOT EXISTS idx_sports_previews_date ON sports_previews (game_date)`,
    `CREATE TABLE IF NOT EXISTS sports_settings (
     scope_key TEXT PRIMARY KEY, settings JSONB NOT NULL DEFAULT '{}'::jsonb,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS sports_predictions (
     id BIGSERIAL PRIMARY KEY, strategy TEXT NOT NULL, league TEXT NOT NULL, event_id TEXT NOT NULL,
     game_date TIMESTAMPTZ, home_team TEXT NOT NULL, away_team TEXT NOT NULL, market TEXT NOT NULL,
     side TEXT NOT NULL, selection TEXT NOT NULL, model_prob NUMERIC(6,5) NOT NULL,
     market_prob NUMERIC(6,5) NOT NULL, edge NUMERIC(7,5) NOT NULL, price_at_pick INTEGER,
     spread_at_pick NUMERIC(5,1), stake_fraction NUMERIC(6,5) NOT NULL DEFAULT 0,
     projected_margin NUMERIC(6,2), rationale JSONB, user_sub TEXT,
     settled BOOLEAN NOT NULL DEFAULT FALSE, home_score INTEGER, away_score INTEGER, won BOOLEAN,
     brier NUMERIC(8,6), market_brier NUMERIC(8,6), closing_price INTEGER, closing_spread NUMERIC(5,1),
     clv NUMERIC(8,6), pnl_units NUMERIC(8,4), graded_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT sports_predictions_unique UNIQUE (strategy, event_id, market, side))`,
    `CREATE INDEX IF NOT EXISTS idx_sports_predictions_open ON sports_predictions (settled, game_date)`,
    `CREATE INDEX IF NOT EXISTS idx_sports_predictions_strategy ON sports_predictions (strategy, settled)`,
    `CREATE INDEX IF NOT EXISTS idx_sports_predictions_event ON sports_predictions (event_id)`,
    // migrations/004: the World-subject pull ledger. Timestamps only — the archive itself is
    // world_items, and a second copy here would be the duplication the shared layer exists to end.
    `CREATE TABLE IF NOT EXISTS sports_world_pulls (
     entity TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL,
     last_pulled TIMESTAMPTZ NOT NULL DEFAULT now(), pulls INTEGER NOT NULL DEFAULT 1,
     last_fetched INTEGER NOT NULL DEFAULT 0, last_new INTEGER NOT NULL DEFAULT 0,
     last_error TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_sports_world_pulls_kind ON sports_world_pulls (kind, last_pulled DESC)`,
];
/**
 * @description Create every table this package owns, idempotently. Safe to call on every route
 * factory invocation.
 * @param pool - Postgres pool.
 * @returns Nothing; throws if the database is unreachable.
 */
async function ensureSchema(pool) {
    for (const stmt of DDL)
        await pool.query(stmt);
}
/**
 * @description Follow a team. Idempotent — following twice updates the stored id and name rather
 * than creating a second row.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param t - The team to follow.
 * @returns Nothing.
 */
async function followTeam(pool, userSub, t) {
    await pool.query(`INSERT INTO sports_followed_teams (user_sub, league, team, team_id, display_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_sub, league, team)
     DO UPDATE SET team_id = EXCLUDED.team_id, display_name = EXCLUDED.display_name`, [userSub, t.league, t.team, t.teamId, t.displayName]);
}
/**
 * @description Stop following a team.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param league - League the team plays in.
 * @param team - Team abbreviation.
 * @returns Number of rows removed, so a caller can report "not followed" honestly.
 */
async function unfollowTeam(pool, userSub, league, team) {
    const r = await pool.query('DELETE FROM sports_followed_teams WHERE user_sub = $1 AND league = $2 AND team = $3', [userSub, league, team]);
    return r.rowCount || 0;
}
/**
 * @description List the teams a person follows, oldest first so the display order is stable.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @returns Followed teams.
 */
async function listFollowed(pool, userSub) {
    const r = await pool.query(`SELECT league, team, team_id, display_name FROM sports_followed_teams
     WHERE user_sub = $1 ORDER BY created_at ASC`, [userSub]);
    return r.rows.map((x) => ({
        league: x.league, team: x.team, teamId: x.team_id, displayName: x.display_name,
    }));
}
/**
 * @description Read cached season ratings.
 * @param pool - Postgres pool.
 * @param league - League to read.
 * @param season - Season year.
 * @returns The cached build, or null when nothing has been built yet.
 */
async function readRatings(pool, league, season) {
    const r = await pool.query('SELECT payload, generated_at FROM sports_ratings_cache WHERE league = $1 AND season = $2', [league, season]);
    if (!r.rows.length)
        return null;
    return { ratings: r.rows[0].payload, generatedAt: new Date(r.rows[0].generated_at).toISOString() };
}
/**
 * @description Store a season rating build, replacing any previous one for the same season.
 * @param pool - Postgres pool.
 * @param ratings - The build.
 * @param buildMs - How long it took, for the status panel.
 * @returns Nothing.
 */
async function writeRatings(pool, ratings, buildMs) {
    await pool.query(`INSERT INTO sports_ratings_cache (league, season, payload, games, generated_at, build_ms)
     VALUES ($1, $2, $3, $4, now(), $5)
     ON CONFLICT (league, season) DO UPDATE
     SET payload = EXCLUDED.payload, games = EXCLUDED.games, generated_at = now(), build_ms = EXCLUDED.build_ms`, [ratings.league, ratings.season, JSON.stringify(ratings), ratings.games, buildMs]);
}
/**
 * @description Read a cached game preview.
 * @param pool - Postgres pool.
 * @param eventId - ESPN event id.
 * @returns The preview and when it was built, or null.
 */
async function readPreview(pool, eventId) {
    const r = await pool.query('SELECT payload, generated_at FROM sports_previews WHERE event_id = $1', [eventId]);
    if (!r.rows.length)
        return null;
    return { preview: r.rows[0].payload, generatedAt: new Date(r.rows[0].generated_at).toISOString() };
}
/**
 * @description Store a built preview, keyed by event so a game followed by several people is built
 * once and read by all of them.
 * @param pool - Postgres pool.
 * @param preview - The built preview.
 * @returns Nothing.
 */
async function writePreview(pool, preview) {
    await pool.query(`INSERT INTO sports_previews (event_id, league, game_date, home_team, away_team, payload, generated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (event_id) DO UPDATE
     SET payload = EXCLUDED.payload, game_date = EXCLUDED.game_date, generated_at = now()`, [preview.eventId, preview.league, preview.date || null, preview.homeTeam, preview.awayTeam, JSON.stringify(preview)]);
}
/**
 * @description Read one settings scope's overrides.
 * @param pool - Postgres pool.
 * @param scopeKey - `DEPLOYMENT_SCOPE` or a user subject.
 * @returns The stored overrides, or an empty object.
 */
async function readSettings(pool, scopeKey) {
    const r = await pool.query('SELECT settings FROM sports_settings WHERE scope_key = $1', [scopeKey]);
    return r.rows[0]?.settings || {};
}
/**
 * @description Merge overrides into one settings scope.
 * @param pool - Postgres pool.
 * @param scopeKey - `DEPLOYMENT_SCOPE` or a user subject.
 * @param patch - Values to merge; existing keys not present here are preserved.
 * @returns The merged settings.
 */
async function writeSettings(pool, scopeKey, patch) {
    const r = await pool.query(`INSERT INTO sports_settings (scope_key, settings, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (scope_key) DO UPDATE
     SET settings = sports_settings.settings || EXCLUDED.settings, updated_at = now()
     RETURNING settings`, [scopeKey, JSON.stringify(patch)]);
    return r.rows[0]?.settings || {};
}
/**
 * @description Register predictions before kickoff. Re-running the poller UPDATES the existing row
 * for the same (strategy, event, market, side) rather than appending a second opinion — a ledger
 * that double-counts one bet cannot be graded. Rows already settled are left alone.
 * @param pool - Postgres pool.
 * @param rows - Rows to register.
 * @returns How many rows were written or refreshed.
 */
async function upsertPredictions(pool, rows) {
    let n = 0;
    for (const p of rows) {
        const r = await pool.query(`INSERT INTO sports_predictions
         (strategy, league, event_id, game_date, home_team, away_team, market, side, selection,
          model_prob, market_prob, edge, price_at_pick, spread_at_pick, stake_fraction,
          projected_margin, rationale)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (strategy, event_id, market, side) DO UPDATE
       SET model_prob = EXCLUDED.model_prob, market_prob = EXCLUDED.market_prob,
           edge = EXCLUDED.edge, price_at_pick = EXCLUDED.price_at_pick,
           spread_at_pick = EXCLUDED.spread_at_pick, stake_fraction = EXCLUDED.stake_fraction,
           projected_margin = EXCLUDED.projected_margin, rationale = EXCLUDED.rationale
       WHERE sports_predictions.settled = FALSE`, [p.strategy, p.league, p.eventId, p.gameDate || null, p.homeTeam, p.awayTeam, p.market, p.side,
            p.selection, clampProb(p.modelProb), clampProb(p.marketProb), round5(p.edge), p.priceAtPick,
            p.spreadAtPick, round5(p.stakeFraction), p.projectedMargin, JSON.stringify(p.rationale ?? null)]);
        n += r.rowCount || 0;
    }
    return n;
}
/** Keeps a probability inside the column's NUMERIC(6,5) domain. */
function clampProb(p) { return Math.max(0, Math.min(0.99999, Number(p) || 0)); }
/** Rounds to the ledger's stored precision so reads and writes agree. */
function round5(n) { return Math.round((Number(n) || 0) * 100000) / 100000; }
/**
 * @description Every registered call whose game should have finished by now and which has not been
 * graded yet.
 * @param pool - Postgres pool.
 * @param before - Only rows whose game date precedes this instant.
 * @param limit - Maximum rows to return in one pass.
 * @returns Ungraded rows, oldest game first.
 */
async function openPredictions(pool, before, limit = 500) {
    const r = await pool.query(`SELECT id, strategy, league, event_id, market, side, model_prob, market_prob,
            price_at_pick, spread_at_pick, stake_fraction
     FROM sports_predictions
     WHERE settled = FALSE AND game_date IS NOT NULL AND game_date < $1
     ORDER BY game_date ASC LIMIT $2`, [before.toISOString(), limit]);
    return r.rows.map((x) => ({
        id: Number(x.id), strategy: x.strategy, league: x.league, eventId: x.event_id,
        market: x.market, side: x.side,
        modelProb: Number(x.model_prob), marketProb: Number(x.market_prob),
        priceAtPick: x.price_at_pick === null ? null : Number(x.price_at_pick),
        spreadAtPick: x.spread_at_pick === null ? null : Number(x.spread_at_pick),
        stakeFraction: Number(x.stake_fraction),
    }));
}
/**
 * @description Write a grade back to one row and mark it settled.
 * @param pool - Postgres pool.
 * @param id - Ledger row id.
 * @param grade - The computed grade.
 * @param settle - The settlement that produced it.
 * @returns Nothing.
 */
async function gradePrediction(pool, id, grade, settle) {
    await pool.query(`UPDATE sports_predictions
     SET settled = TRUE, home_score = $2, away_score = $3, won = $4, brier = $5, market_brier = $6,
         clv = $7, pnl_units = $8, closing_price = $9, closing_spread = $10, graded_at = now()
     WHERE id = $1 AND settled = FALSE`, [id, settle.homeScore, settle.awayScore, grade.won, grade.brier, grade.marketBrier,
        grade.clv, grade.pnlUnits, settle.closingPrice ?? null, settle.closingSpread ?? null]);
}
/**
 * @description Every settled row, for the scorecard rollup. Bounded so a long-lived ledger cannot
 * turn the scorecard into a slow query.
 * @param pool - Postgres pool.
 * @param limit - Maximum rows.
 * @returns Settled rows, newest first.
 */
async function gradedRows(pool, limit = 5000) {
    const r = await pool.query(`SELECT strategy, won, brier, market_brier, clv, pnl_units FROM sports_predictions
     WHERE settled = TRUE ORDER BY graded_at DESC LIMIT $1`, [limit]);
    return r.rows.map((x) => ({
        strategy: x.strategy, won: Boolean(x.won),
        brier: Number(x.brier), marketBrier: Number(x.market_brier),
        clv: x.clv === null ? null : Number(x.clv), pnlUnits: Number(x.pnl_units || 0),
    }));
}
/**
 * @description Registered calls for one game, so the card can show what was said and, once graded,
 * how it turned out.
 * @param pool - Postgres pool.
 * @param eventId - ESPN event id.
 * @returns Rows for that game, ensemble first.
 */
async function predictionsForEvent(pool, eventId) {
    const r = await pool.query(`SELECT strategy, market, side, selection, model_prob, market_prob, edge, price_at_pick,
            stake_fraction, settled, won, brier, market_brier, clv, pnl_units, graded_at
     FROM sports_predictions WHERE event_id = $1
     ORDER BY (strategy = 'ensemble') DESC, edge DESC`, [eventId]);
    return r.rows;
}
/**
 * @description When each World subject was last pulled, for the re-pull cool-down.
 * @param pool - Postgres pool.
 * @returns Entity id → ISO timestamp, for subjects ever pulled.
 */
async function worldPullTimes(pool) {
    const r = await pool.query('SELECT entity, last_pulled FROM sports_world_pulls');
    const out = new Map();
    for (const row of r.rows)
        out.set(String(row.entity), new Date(row.last_pulled).toISOString());
    return out;
}
/**
 * @description Record the outcome of one World subject pull.
 *
 * The timestamp advances even when the pull FAILED. A subject whose feed is down would otherwise be
 * retried on every pass forever, which turns one broken feed into a permanent tax on the loop and
 * crowds out the subjects that do work. The error is kept alongside so the failure is visible.
 * @param pool - Postgres pool.
 * @param subject - Entity id, label and kind.
 * @param result - Counts, and the error text when the pull failed.
 * @returns Nothing.
 */
async function recordWorldPull(pool, subject, result) {
    await pool.query(`INSERT INTO sports_world_pulls (entity, label, kind, last_pulled, pulls, last_fetched, last_new, last_error)
     VALUES ($1, $2, $3, now(), 1, $4, $5, $6)
     ON CONFLICT (entity) DO UPDATE SET
       label = EXCLUDED.label, kind = EXCLUDED.kind, last_pulled = now(),
       pulls = sports_world_pulls.pulls + 1,
       last_fetched = EXCLUDED.last_fetched, last_new = EXCLUDED.last_new,
       last_error = EXCLUDED.last_error`, [subject.entity, subject.label, subject.kind, result.fetched, result.newItems, result.error || null]);
}
//# sourceMappingURL=sports-store.js.map