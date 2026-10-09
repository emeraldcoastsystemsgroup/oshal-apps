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
 *
 * @module fantasy-feed
 */

import type { Pool } from 'pg';
import { createChildLogger } from '@/shared/logger';
import { fetchProjections, type PlayerFeed } from '@/features/fantasy-leagues';
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
 * @returns The distilled feed.
 */
function sharedFeedFetch(season: number, week: number): Promise<PlayerFeed> {
  const key = `${season}:${week}`;
  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchProjections(season, week, espn).finally(() => { inflight.delete(key); });
    inflight.set(key, pending);
  }
  return pending;
}

/**
 * @description Read the caller's cached projection feed, refreshing it when missing or stale. A
 * stale cache still beats nothing when ESPN is down, and the response says how old it is.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param season - Season year.
 * @param week - Scoring period.
 * @returns Players keyed by id (possibly empty when ESPN is unreachable) and the cache age.
 */
export async function projectionsFor(
  pool: Pool, sub: string, season: number, week: number,
): Promise<{ players: Record<number, FantasyPlayer>; generatedAt: string | null }> {
  const cached = await readProjections(pool, sub, season, week);
  const ageHours = cached ? (Date.now() - Date.parse(cached.generatedAt)) / 3600000 : Infinity;
  if (cached && ageHours < PROJECTION_MAX_AGE_HOURS) {
    return { players: cached.players as Record<number, FantasyPlayer>, generatedAt: cached.generatedAt };
  }
  try {
    const started = Date.now();
    const { players, weeks } = await sharedFeedFetch(season, week);
    if (Object.keys(players).length) await writeProjections(pool, sub, season, week, players, Date.now() - started);
    // The completed weeks came back in the SAME response, so accumulating them costs no extra read.
    const stored = weeks.length ? await writePlayerWeeks(pool, sub, season, weeks) : 0;
    log.info({ season, week, players: Object.keys(players).length, playerWeeks: stored, ms: Date.now() - started },
      'projection feed refreshed');
  } catch (err) {
    log.error({ err, season, week }, 'projection refresh failed');
  }
  const use = (await readProjections(pool, sub, season, week)) || cached;
  return { players: (use?.players || {}) as Record<number, FantasyPlayer>, generatedAt: use?.generatedAt || null };
}

/**
 * @description The caller's cached feeds for a range of weeks, current week refreshed first, for
 * the season plan. Weeks never read are simply absent — the plan prices them from a rate and says so.
 * @param pool - Postgres pool.
 * @param sub - Caller's subject.
 * @param season - Season year.
 * @param currentWeek - The current week (refreshed when stale).
 * @param lastWeek - The last week of the plan.
 * @returns Feeds keyed by week, and the current week's cache age.
 */
export async function seasonFeeds(
  pool: Pool, sub: string, season: number, currentWeek: number, lastWeek: number,
): Promise<{ feeds: Map<number, Record<number, FantasyPlayer>>; generatedAt: string | null }> {
  const current = await projectionsFor(pool, sub, season, currentWeek);
  const feeds = new Map<number, Record<number, FantasyPlayer>>();
  for (const [week, players] of await readProjectionWeeks(pool, sub, season, Math.max(1, currentWeek - 1), lastWeek)) {
    feeds.set(week, players as Record<number, FantasyPlayer>);
  }
  feeds.set(currentWeek, current.players);
  return { feeds, generatedAt: current.generatedAt };
}
