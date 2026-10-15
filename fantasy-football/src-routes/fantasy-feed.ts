/**
 * The public projection feed, per person — fetched once however many people ask, cached in each
 * caller's own rows, and read back week by week for the season plan.
 *
 * The feed is public (no credential) and identical for everybody, but ownership here is per person
 * (ADR-146 Q2), so the durable cache is each caller's own ff_projections rows; only the in-flight
 * fetch is shared, and nothing is retained after it settles. ESPN returns ~39MB per read and ignores
 * the filter's limit, so a caller's cache is refreshed at most every few hours and never per click.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the per-person projection cache and the shared in-flight fetch moved out of fantasy-routes.ts so the lineup and the management routes share them, plus the cached-weeks read the season plan is built from and the season defaults.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | projectionsFor reports the feed's state ({ok, source, reason}) from the client's onError instead of returning an empty feed that a surface rendered as zero-point projections, takes {persist:false} so a reader request (GET) never writes the cache the native kernel refuses there, keeps a fetched feed when its cache write fails, and returns the completed weeks it fetched so a read can weigh them without storing them. Guard: tests/fantasy-lineup-readonly.test.js.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | seasonFeeds also returns the current week's feed state, so the season, waiver and trade boards can refuse to price from an empty feed (they showed SEASON VALUE 0.0 and "Nobody on the wire improves..." when ESPN's projection feed answered no players). Guard: tests/fantasy-boards-no-projection.test.js.
 *
 * @module fantasy-feed
 */

import type { Pool } from 'pg';
import { createChildLogger } from '@/shared/logger';
import { fetchProjections, type FantasyReadOptions, type PlayerFeed, type PlayerWeekActual } from '@/features/fantasy-leagues';
import type { FantasyPlayer } from './fantasy-scoring';
import { espn } from './fantasy-context';
import { readProjectionWeeks, readProjections, writePlayerWeeks, writeProjections } from './fantasy-store';

const log = createChildLogger({ module: 'fantasy-football-feed' });

/** Hours before a person's cached projection feed is considered stale enough to refetch. */
const PROJECTION_MAX_AGE_HOURS = 6;

/** In-flight public feed fetches, keyed by season and week, shared across callers while in flight. */
const inflight = new Map<string, Promise<PlayerFeed>>();

/**
 * @description The NFL season ESPN keys fantasy by: the year the season STARTS, so January's
 * playoffs still belong to the previous year's season.
 * @param now - Instant to resolve as of.
 * @returns The season year.
 */
export function currentNflSeason(now: Date = new Date()): number {
  return now.getUTCMonth() + 1 >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

/**
 * @description Parse a season, defaulting to the current NFL season.
 * @param value - Raw input.
 * @returns A season year.
 */
export function seasonOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 2100 ? n : currentNflSeason();
}

/**
 * @description The public feed for one week, fetched once however many people ask at the same time.
 * @param season - Season year.
 * @param week - Scoring period.
 * @param opts - Read options; the first caller's onError hears the failure.
 * @returns The distilled feed.
 */
function sharedFeedFetch(season: number, week: number, opts: FantasyReadOptions = espn): Promise<PlayerFeed> {
  const key = `${season}:${week}`;
  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchProjections(season, week, opts).finally(() => { inflight.delete(key); });
    inflight.set(key, pending);
  }
  return pending;
}

/** Where a served projection feed came from, and why it is missing when it is. */
export interface FeedState {
  /** False only when no projection is available at all for the week. */
  ok: boolean;
  source: 'cache' | 'live' | 'stale-cache' | 'none';
  /** Why the live read gave nothing (the client's own reason), or null when it answered. */
  reason: string | null;
}

/** A served projection feed. */
export interface ProjectionRead {
  players: Record<number, FantasyPlayer>;
  generatedAt: string | null;
  /** Completed weeks the live read carried (empty when served from the cache). */
  weeks: PlayerWeekActual[];
  feed: FeedState;
}

/**
 * @description Read the public feed live, capturing the client's own failure reason. The client
 * reports an unreachable or refused read through onError and returns an empty feed, so the reason is
 * the only thing that tells "no players" from "never reached ESPN".
 * @param season - Season year.
 * @param week - Scoring period.
 * @returns The feed and the first failure reason, if any.
 */
async function fetchFeed(season: number, week: number): Promise<PlayerFeed & { reason: string | null }> {
  let reason: string | null = null;
  const opts = { ...espn, onError: (_url: string, why: string) => { if (!reason) reason = why; } };
  try {
    const feed = await sharedFeedFetch(season, week, opts);
    return { players: feed.players || {}, weeks: feed.weeks || [], reason };
  } catch (err) {
    log.error({ err, season, week }, 'projection feed read failed');
    return { players: {}, weeks: [], reason: (err as Error).message || 'the projection feed read failed' };
  }
}

/**
 * @description Store a fetched feed in the caller's cache. A refused or failed write is logged and the
 * fetched feed is still served: the cache is an optimisation, never the answer.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param at - Season and week.
 * @param fetched - The live feed.
 * @param ms - How long the read took.
 * @returns Nothing.
 */
async function persistFeed(
  pool: Pool, sub: string, at: { season: number; week: number }, fetched: PlayerFeed, ms: number,
): Promise<void> {
  try {
    if (Object.keys(fetched.players).length) await writeProjections(pool, sub, at.season, at.week, fetched.players, ms);
    // The completed weeks came back in the SAME response, so accumulating them costs no extra read.
    const stored = fetched.weeks.length ? await writePlayerWeeks(pool, sub, at.season, fetched.weeks) : 0;
    log.info({ ...at, players: Object.keys(fetched.players).length, playerWeeks: stored, ms }, 'projection feed refreshed');
  } catch (err) {
    log.error({ err, ...at }, 'projection cache write failed; serving the fetched feed');
  }
}

/**
 * @description Read the caller's cached projection feed, refreshing it when missing or stale. A
 * stale cache still beats nothing when ESPN is down, and the answer says so; when there is nothing
 * at all, `feed.ok` is false with the client's reason, so no surface shows an empty feed as zeros.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param season - Season year.
 * @param week - Scoring period.
 * @param opts - persist:false for a reader request, which must not write the cache.
 * @returns The players keyed by id, their age, the fetched completed weeks and the feed's state.
 */
export async function projectionsFor(
  pool: Pool, sub: string, season: number, week: number, opts: { persist?: boolean } = {},
): Promise<ProjectionRead> {
  const cached = await readProjections(pool, sub, season, week);
  const ageHours = cached ? (Date.now() - Date.parse(cached.generatedAt)) / 3600000 : Infinity;
  if (cached && ageHours < PROJECTION_MAX_AGE_HOURS) {
    return { players: cached.players as Record<number, FantasyPlayer>, generatedAt: cached.generatedAt, weeks: [], feed: { ok: true, source: 'cache', reason: null } };
  }
  const started = Date.now();
  const fetched = await fetchFeed(season, week);
  if (opts.persist !== false) await persistFeed(pool, sub, { season, week }, fetched, Date.now() - started);
  if (Object.keys(fetched.players).length) {
    return { players: fetched.players as Record<number, FantasyPlayer>, generatedAt: new Date().toISOString(), weeks: fetched.weeks, feed: { ok: true, source: 'live', reason: null } };
  }
  const reason = fetched.reason || 'the projection feed returned no players for this week';
  log.warn({ season, week, reason, cached: Boolean(cached) }, 'projection feed gave no players');
  if (cached) {
    return { players: cached.players as Record<number, FantasyPlayer>, generatedAt: cached.generatedAt, weeks: fetched.weeks, feed: { ok: true, source: 'stale-cache', reason } };
  }
  return { players: {}, generatedAt: null, weeks: fetched.weeks, feed: { ok: false, source: 'none', reason } };
}

/**
 * @description The caller's cached feeds for a range of weeks, current week refreshed first, for
 * the season plan. Weeks never read are simply absent — the plan prices them from a rate and says so.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param season - Season year.
 * @param currentWeek - The current week (refreshed when stale).
 * @param lastWeek - The last week of the plan.
 * @returns Feeds keyed by week, the current week's cache age, and the current week's feed state.
 */
export async function seasonFeeds(
  pool: Pool, sub: string, season: number, currentWeek: number, lastWeek: number,
): Promise<{ feeds: Map<number, Record<number, FantasyPlayer>>; generatedAt: string | null; feed: FeedState }> {
  const current = await projectionsFor(pool, sub, season, currentWeek);
  const feeds = new Map<number, Record<number, FantasyPlayer>>();
  for (const [week, players] of await readProjectionWeeks(pool, sub, season, Math.max(1, currentWeek - 1), lastWeek)) {
    feeds.set(week, players as Record<number, FantasyPlayer>);
  }
  feeds.set(currentWeek, current.players);
  return { feeds, generatedAt: current.generatedAt, feed: current.feed };
}
