/**
 * Line-capture storage — the change-only writer and the movement reader.
 *
 * The whole design is one rule: a poll writes a row ONLY when the number differs from the one
 * standing. Re-seeing the same line extends `last_seen` and bumps `observations`. That is what
 * turns an hourly poller into a movement history instead of 24 duplicate rows a day per game.
 *
 * `ensureLineSchema` mirrors migrations/003 because APP_PACKAGE_MIGRATIONS is a flag and the app
 * has to work where it is off. The migration is the record; this is the bootstrap.
 *
 * No framework imports, so the compiled module loads under the plain-node test suites.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The unchanged-path UPDATE matches the row ID, not first_seen. Postgres keeps microseconds and a JS Date round-trip keeps milliseconds, so the timestamp predicate matched nothing: no duplicate rows (the insert was correctly skipped) but observations frozen at 1 and last_seen never advancing. Caught live, not by a unit test.
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — schema self-heal, the change-only capture write, the standing-quote read the writer compares against, and the per-game observation series the movement summary folds.
 *
 * @module sports-line-store
 */

import type { Pool } from 'pg';
import type { League } from './sports-odds';
import type { MarketQuote } from './sports-ensemble';
import { hasPrice, normaliseQuote, sameLine, type LineObservation } from './sports-line-history';

/** DDL kept equivalent to migrations/003-sports-line-history.sql. */
const DDL = [
  `CREATE TABLE IF NOT EXISTS sports_line_history (
     id BIGSERIAL PRIMARY KEY, league TEXT NOT NULL, event_id TEXT NOT NULL,
     game_date TIMESTAMPTZ, home_team TEXT NOT NULL, away_team TEXT NOT NULL, book TEXT NOT NULL,
     home_spread NUMERIC(5,1), home_spread_odds INTEGER, away_spread_odds INTEGER,
     home_moneyline INTEGER, away_moneyline INTEGER, total NUMERIC(5,1),
     first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
     last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
     observations INTEGER NOT NULL DEFAULT 1)`,
  `CREATE INDEX IF NOT EXISTS idx_sports_line_event_book ON sports_line_history (event_id, book, first_seen DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sports_line_game_date ON sports_line_history (league, game_date)`,
];

/**
 * @description Create the capture table, idempotently.
 * @param pool - Postgres pool.
 * @returns Nothing; throws if the database is unreachable.
 */
export async function ensureLineSchema(pool: Pool): Promise<void> {
  for (const stmt of DDL) await pool.query(stmt);
}

/** Maps a stored row to the shape the pure movement functions consume. */
function toObservation(x: any): LineObservation {
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(x.id),
    eventId: x.event_id,
    book: x.book,
    homeSpread: num(x.home_spread),
    homeSpreadOdds: num(x.home_spread_odds),
    awaySpreadOdds: num(x.away_spread_odds),
    homeMoneyline: num(x.home_moneyline),
    awayMoneyline: num(x.away_moneyline),
    total: num(x.total),
    firstSeen: new Date(x.first_seen).toISOString(),
    lastSeen: new Date(x.last_seen).toISOString(),
    observations: Number(x.observations) || 1,
  };
}

/**
 * @description The quote currently standing for a game and book — the newest row. This is what a
 * new poll is compared against to decide "moved" versus "still the same number".
 * @param pool - Postgres pool.
 * @param eventId - ESPN event id.
 * @param book - Book name.
 * @returns The standing observation, or null when nothing has been captured yet.
 */
export async function standingQuote(pool: Pool, eventId: string, book: string): Promise<LineObservation | null> {
  const r = await pool.query(
    `SELECT * FROM sports_line_history WHERE event_id = $1 AND book = $2
     ORDER BY first_seen DESC LIMIT 1`,
    [eventId, book],
  );
  return r.rows.length ? toObservation(r.rows[0]) : null;
}

/** What a capture attempt did, so the poller can log something meaningful. */
export type CaptureResult = 'no-price' | 'unchanged' | 'first-capture' | 'moved';

/** Identity of the game a quote belongs to. */
export interface GameRef {
  league: League;
  eventId: string;
  gameDate: string | null;
  homeTeam: string;
  awayTeam: string;
}

/**
 * @description Capture one quote, writing a row ONLY if the line actually changed.
 *
 * A quote with no usable price is skipped rather than stored: a book that has not posted yet must
 * read as absent, never as a line of zero, and storing it would manufacture a fake "opener" at
 * whatever moment we happened to look first.
 * @param pool - Postgres pool.
 * @param game - The game this quote belongs to.
 * @param quote - The quote just observed.
 * @returns What happened, for the poller's counters.
 */
export async function captureQuote(pool: Pool, game: GameRef, quote: MarketQuote): Promise<CaptureResult> {
  if (!hasPrice(quote)) return 'no-price';
  const book = String(quote.book || 'unknown');
  const standing = await standingQuote(pool, game.eventId, book);

  if (standing && sameLine(quote, standing as unknown as MarketQuote)) {
    // Same number: extend its life rather than duplicating it.
    //
    // ⚠ MATCHED ON THE ROW ID, NOT ON first_seen. Postgres stores the timestamp to MICROSECOND
    // precision (05:01:59.133599) while a JS Date round-trip only carries MILLISECONDS
    // (05:01:59.133Z), so a `WHERE first_seen = $3` predicate silently matched NOTHING. The failure
    // was invisible in the obvious place — no duplicate rows appeared, because the insert was
    // correctly skipped — but observations stayed at 1 forever and last_seen never advanced, which
    // makes "how long has this line been standing" permanently unanswerable. Found on the box by
    // checking observations after a second pass reported 47 unchanged.
    await pool.query(
      `UPDATE sports_line_history SET last_seen = now(), observations = observations + 1 WHERE id = $1`,
      [standing.id],
    );
    return 'unchanged';
  }

  const n = normaliseQuote(quote);
  await pool.query(
    `INSERT INTO sports_line_history
       (league, event_id, game_date, home_team, away_team, book,
        home_spread, home_spread_odds, away_spread_odds, home_moneyline, away_moneyline, total)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [game.league, game.eventId, game.gameDate, game.homeTeam, game.awayTeam, book,
      n.homeSpread, n.homeSpreadOdds, n.awaySpreadOdds, n.homeMoneyline, n.awayMoneyline,
      typeof quote.total === 'number' && Number.isFinite(quote.total) ? quote.total : null],
  );
  return standing ? 'moved' : 'first-capture';
}

/**
 * @description Every observation for one game, oldest first — the series the movement summary
 * folds into an opener, a close and the steps between.
 * @param pool - Postgres pool.
 * @param eventId - ESPN event id.
 * @param book - Optional book filter; omit to read every book.
 * @returns Observations, chronological.
 */
export async function observationsFor(pool: Pool, eventId: string, book?: string): Promise<LineObservation[]> {
  const r = book
    ? await pool.query('SELECT * FROM sports_line_history WHERE event_id = $1 AND book = $2 ORDER BY first_seen ASC', [eventId, book])
    : await pool.query('SELECT * FROM sports_line_history WHERE event_id = $1 ORDER BY first_seen ASC', [eventId]);
  return r.rows.map(toObservation);
}

/**
 * @description How much line history exists, for the status panel. A capture layer whose whole
 * value is "we were watching" has to be able to show that it was.
 * @param pool - Postgres pool.
 * @returns Row count, distinct games, and the oldest observation.
 */
export async function captureStats(pool: Pool): Promise<{ rows: number; games: number; since: string | null; books: string[] }> {
  const r = await pool.query(
    `SELECT count(*)::int AS rows, count(DISTINCT event_id)::int AS games,
            min(first_seen) AS since, array_agg(DISTINCT book) AS books
     FROM sports_line_history`,
  );
  const row = r.rows[0] || {};
  return {
    rows: Number(row.rows) || 0,
    games: Number(row.games) || 0,
    since: row.since ? new Date(row.since).toISOString() : null,
    books: (row.books || []).filter(Boolean),
  };
}

/**
 * @description The closing line for a game — the last quote standing before kickoff. This is the
 * number closing-line value is measured against, so it is read from the capture history rather than
 * re-fetched: after a game ends the book stops publishing, and a live re-fetch would return nothing.
 * @param pool - Postgres pool.
 * @param eventId - ESPN event id.
 * @param book - Book name.
 * @returns The closing observation, or null when the game was never captured.
 */
export async function closingLine(pool: Pool, eventId: string, book: string): Promise<LineObservation | null> {
  const r = await pool.query(
    `SELECT h.* FROM sports_line_history h
     WHERE h.event_id = $1 AND h.book = $2
       AND (h.game_date IS NULL OR h.first_seen <= h.game_date)
     ORDER BY h.first_seen DESC LIMIT 1`,
    [eventId, book],
  );
  return r.rows.length ? toObservation(r.rows[0]) : null;
}
