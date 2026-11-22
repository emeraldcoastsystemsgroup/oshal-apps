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
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Item C (0.12.4): persist in_open_window and prior_poll_absent on sports_line_history, record absent-price and priced polls in sports_line_poll_state, and expose knownUpcomingGames and confirmedOpener counts for adaptive open-window capture.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The unchanged-path UPDATE matches the row ID, not first_seen. Postgres keeps microseconds and a JS Date round-trip keeps milliseconds, so the timestamp predicate matched nothing: no duplicate rows (the insert was correctly skipped) but observations frozen at 1 and last_seen never advancing. Caught live, not by a unit test.
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — schema self-heal, the change-only capture write, the standing-quote read the writer compares against, and the per-game observation series the movement summary folds.
 *
 * @module sports-line-store
 */

import type { Pool } from 'pg';
import type { League } from './sports-odds';
import type { MarketQuote } from './sports-ensemble';
import { hasPrice, normaliseQuote, sameLine, type LineObservation } from './sports-line-history';
import { isInOpenWindow, type UpcomingGameWindowRef } from './open-windows';

/** Sentinel book key used when ESPN returns an empty odds array before any book posts. */
export const ANY_BOOK = '*';

/** DDL kept equivalent to migrations/003-sports-line-history.sql and 006-sports-line-open-windows.sql. */
const DDL = [
  `CREATE TABLE IF NOT EXISTS sports_line_history (
     id BIGSERIAL PRIMARY KEY, league TEXT NOT NULL, event_id TEXT NOT NULL,
     game_date TIMESTAMPTZ, home_team TEXT NOT NULL, away_team TEXT NOT NULL, book TEXT NOT NULL,
     home_spread NUMERIC(5,1), home_spread_odds INTEGER, away_spread_odds INTEGER,
     home_moneyline INTEGER, away_moneyline INTEGER, total NUMERIC(5,1),
     first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
     last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
     observations INTEGER NOT NULL DEFAULT 1,
     in_open_window BOOLEAN NOT NULL DEFAULT FALSE,
     prior_poll_absent BOOLEAN NOT NULL DEFAULT FALSE)`,
  `ALTER TABLE sports_line_history ADD COLUMN IF NOT EXISTS in_open_window BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE sports_line_history ADD COLUMN IF NOT EXISTS prior_poll_absent BOOLEAN NOT NULL DEFAULT FALSE`,
  `CREATE INDEX IF NOT EXISTS idx_sports_line_event_book ON sports_line_history (event_id, book, first_seen DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sports_line_game_date ON sports_line_history (league, game_date)`,
  `CREATE TABLE IF NOT EXISTS sports_line_poll_state (
     event_id TEXT NOT NULL, book TEXT NOT NULL, league TEXT NOT NULL, game_date TIMESTAMPTZ,
     had_price BOOLEAN NOT NULL DEFAULT FALSE, polled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (event_id, book))`,
  `CREATE INDEX IF NOT EXISTS idx_sports_line_poll_state_date ON sports_line_poll_state (league, game_date)`,
];

/**
 * @description Create the capture tables and columns, idempotently.
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
    gameDate: x.game_date ? new Date(x.game_date).toISOString() : null,
    homeSpread: num(x.home_spread),
    homeSpreadOdds: num(x.home_spread_odds),
    awaySpreadOdds: num(x.away_spread_odds),
    homeMoneyline: num(x.home_moneyline),
    awayMoneyline: num(x.away_moneyline),
    total: num(x.total),
    firstSeen: new Date(x.first_seen).toISOString(),
    lastSeen: new Date(x.last_seen).toISOString(),
    observations: Number(x.observations) || 1,
    inOpenWindow: Boolean(x.in_open_window),
    priorPollAbsent: Boolean(x.prior_poll_absent),
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

/** Optional overrides for deterministic capture testing. */
export interface CaptureQuoteOptions {
  /** Instant of the poll; defaults to current wall-clock time. */
  capturedAt?: Date | string;
}

/** Normalises an optional capture instant to an ISO string and Date. */
function resolveCapturedAt(value?: Date | string): { date: Date; iso: string } {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  return { date, iso: date.toISOString() };
}

/**
 * @description Record the latest poll outcome for one game and book so subsequent polls know
 * whether the immediately preceding poll returned no price.
 * @param pool - Postgres pool.
 * @param game - The polled game.
 * @param book - Book name, or ANY_BOOK ('*') when ESPN published no book entry at all.
 * @param hadPrice - True when a usable price was present on this poll.
 * @param polledIso - ISO timestamp of the poll.
 * @returns Nothing.
 */
export async function recordPollState(
  pool: Pool, game: GameRef, book: string, hadPrice: boolean, polledIso: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO sports_line_poll_state (event_id, book, league, game_date, had_price, polled_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (event_id, book) DO UPDATE
     SET league = EXCLUDED.league,
         game_date = COALESCE(EXCLUDED.game_date, sports_line_poll_state.game_date),
         had_price = EXCLUDED.had_price,
         polled_at = EXCLUDED.polled_at`,
    [game.eventId, book, game.league, game.gameDate, hadPrice, polledIso],
  );
}

/**
 * @description Whether the immediately preceding poll of the same game and book (or a game-wide
 * empty-odds poll when no book was listed yet) returned no price before `capturedIso`.
 * @param pool - Postgres pool.
 * @param eventId - ESPN event id.
 * @param book - Book name.
 * @param capturedIso - ISO timestamp of the current poll.
 * @returns True iff a strictly earlier poll exists for this game/book and had no price.
 */
export async function priorPollWasAbsent(
  pool: Pool, eventId: string, book: string, capturedIso: string,
): Promise<boolean> {
  const r = await pool.query(
    `SELECT had_price, polled_at FROM sports_line_poll_state
     WHERE event_id = $1 AND book IN ($2, $3) AND polled_at < $4
     ORDER BY polled_at DESC LIMIT 1`,
    [eventId, book, ANY_BOOK, capturedIso],
  );
  return r.rows.length > 0 && !Boolean(r.rows[0].had_price);
}

/**
 * @description Capture one quote, writing a row to sports_line_history ONLY if the line actually
 * changed, while recording whether the poll landed inside the league's expected open window and
 * tracking empty-price polls in sports_line_poll_state.
 * @param pool - Postgres pool.
 * @param game - The game this quote belongs to.
 * @param quote - The quote just observed.
 * @param opts - Optional capture instant override.
 * @returns What happened, for the poller's counters.
 */
export async function captureQuote(
  pool: Pool, game: GameRef, quote: MarketQuote, opts: CaptureQuoteOptions = {},
): Promise<CaptureResult> {
  const { date: capturedDate, iso: capturedIso } = resolveCapturedAt(opts.capturedAt);
  if (!hasPrice(quote)) {
    const emptyBook = quote?.book ? String(quote.book).trim() || ANY_BOOK : ANY_BOOK;
    await recordPollState(pool, game, emptyBook, false, capturedIso);
    return 'no-price';
  }
  const book = String(quote.book || 'unknown');
  const standing = await standingQuote(pool, game.eventId, book);
  if (standing && sameLine(quote, standing as unknown as MarketQuote)) {
    // Match by primary key id (never round-tripped first_seen timestamps; Postgres microseconds vs JS ms).
    await pool.query(
      `UPDATE sports_line_history SET last_seen = $2, observations = observations + 1 WHERE id = $1`,
      [standing.id, capturedIso],
    );
    await recordPollState(pool, game, book, true, capturedIso);
    return 'unchanged';
  }
  const inOpenWindow = isInOpenWindow(game.league, capturedDate, game.gameDate).inWindow;
  const priorPollAbsent = standing ? false : await priorPollWasAbsent(pool, game.eventId, book, capturedIso);
  const n = normaliseQuote(quote);
  await pool.query(
    `INSERT INTO sports_line_history
       (league, event_id, game_date, home_team, away_team, book,
        home_spread, home_spread_odds, away_spread_odds, home_moneyline, away_moneyline, total,
        first_seen, last_seen, in_open_window, prior_poll_absent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15)`,
    [game.league, game.eventId, game.gameDate, game.homeTeam, game.awayTeam, book,
      n.homeSpread, n.homeSpreadOdds, n.awaySpreadOdds, n.homeMoneyline, n.awayMoneyline,
      typeof quote.total === 'number' && Number.isFinite(quote.total) ? quote.total : null,
      capturedIso, inOpenWindow, priorPollAbsent],
  );
  await recordPollState(pool, game, book, true, capturedIso);
  return standing ? 'moved' : 'first-capture';
}

/**
 * @description Known upcoming games from sports_line_poll_state so the adaptive scheduler can
 * determine whether any league is inside its expected open window without spending an ESPN read.
 * @param pool - Postgres pool.
 * @param now - Current instant.
 * @returns Distinct upcoming (league, gameDate) pairs.
 */
export async function knownUpcomingGames(
  pool: Pool, now: Date = new Date(),
): Promise<UpcomingGameWindowRef[]> {
  const cutoff = new Date(now.getTime() - 6 * 3600000).toISOString();
  const r = await pool.query(
    `SELECT DISTINCT league, game_date FROM sports_line_poll_state
     WHERE game_date IS NOT NULL AND game_date >= $1
     ORDER BY game_date ASC`,
    [cutoff],
  );
  return r.rows.map((row: any) => ({
    league: row.league as League,
    gameDate: row.game_date ? new Date(row.game_date).toISOString() : null,
  }));
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
 * @returns Row count, distinct games, oldest observation, books, in-window rows and confirmed openers.
 */
export async function captureStats(pool: Pool): Promise<{
  rows: number; games: number; since: string | null; books: string[];
  inWindowRows: number; confirmedOpeners: number;
}> {
  const r = await pool.query(
    `SELECT count(*)::int AS rows, count(DISTINCT event_id)::int AS games,
            min(first_seen) AS since, array_agg(DISTINCT book) AS books,
            count(*) FILTER (WHERE in_open_window)::int AS in_window_rows,
            count(*) FILTER (WHERE in_open_window AND prior_poll_absent)::int AS confirmed_openers
     FROM sports_line_history`,
  );
  const row = r.rows[0] || {};
  return {
    rows: Number(row.rows) || 0,
    games: Number(row.games) || 0,
    since: row.since ? new Date(row.since).toISOString() : null,
    books: (row.books || []).filter(Boolean),
    inWindowRows: Number(row.in_window_rows) || 0,
    confirmedOpeners: Number(row.confirmed_openers) || 0,
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
