/**
 * ESPN data client — the deterministic read layer this package is built on.
 *
 * Every external read the package makes goes through here, and every one of them is a plain
 * schema-bounded GET against ESPN's public JSON: no credential, no model in the loop, no
 * free-form tool. That is the ADR-036 boundary in its simplest form — exact data access completes
 * OUTSIDE any reasoning, and only the normalised result is ever handed onward.
 *
 * WHAT IS ACTUALLY AVAILABLE, VERIFIED LIVE. These endpoints are undocumented but long-stable and
 * were each exercised against the live service while this module was written:
 *   - team list, and a team's roster with position, age, experience and injury flags
 *   - a team's full season schedule with final scores and neutral-site flags
 *   - the scoreboard, which carries DraftKings' moneyline, spread and total inline
 *   - a game summary: per-player injury reports with status and body part, ESPN's own matchup
 *     predictor, against-the-spread records, last-five form, team leaders and the news wire
 *   - per-athlete and per-team season statistics, which is what makes injury weighting use a real
 *     production denominator instead of a positional guess
 *
 * THE ONE THING TO KNOW ABOUT THESE ENDPOINTS. They are not a contracted API. They can change
 * shape without notice, so every accessor here is defensive: a missing branch yields an empty
 * result rather than an exception, and the caller decides whether a game is still analysable. A
 * silent shape change must degrade a game card, never take down the poller.
 *
 * SEASON RESULTS ARE ASSEMBLED PER TEAM AND DEDUPED. There is no single "give me the season"
 * endpoint that behaves the same way for both leagues, so the whole tape is built by walking each
 * team's schedule and deduping on event id. That is around thirty requests per league per refresh,
 * which is why it belongs in a cached daily job and not on a request path.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — teams, rosters, per-team schedules deduped into a season tape, scoreboard with inline book prices, game summary (injuries/predictor/ATS/form/news), and athlete + team season statistics for production-weighted availability.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Retry transient reads (5xx/429/network, never a 4xx) and fire onError once every attempt is exhausted. Measured live: eight consecutive reads from a fresh process in the same container all succeeded under 1.6s while the long-running api intermittently failed the identical read, and the failure reached the user as "your team has no games this week". A single attempt from a busy event loop is not a reliable read, and a failed read must never render as an answer.
 *
 * @module sports-espn
 */

import type { League } from './sports-odds';
import type { GameResult } from './sports-ratings';
import type { InjuryEntry } from './sports-adjustments';
import type { MarketQuote } from './sports-ensemble';

/** ESPN's URL segments per league. Adding a league is adding a row here plus its constants. */
export const LEAGUE_PATHS: Record<League, { sport: string; league: string; scoreboardParams?: string }> = {
  nfl: { sport: 'football', league: 'nfl' },
  nba: { sport: 'basketball', league: 'nba' },
  // `groups=80` is FBS. Without it the college scoreboard answers with a small default subset —
  // 16 games for a week that actually had 53 (measured 2026-09-09) — which would look like a light
  // slate rather than a filtered request. `limit` is needed for the same reason.
  ncaaf: { sport: 'football', league: 'college-football', scoreboardParams: 'groups=80&limit=400' },
};

/**
 * Leagues whose season tape is assembled from PER-WEEK scoreboards instead of per-team schedules.
 *
 * College football has 761 teams in ESPN's list across every division. Walking each schedule the
 * way the professional leagues do would be 761 requests per rating rebuild. Sixteen week-calls
 * return the same FBS games — fewer requests than the NFL's 32 — so the strategy is per league, not
 * one size for all.
 */
export const WEEK_TAPE_LEAGUES: ReadonlySet<League> = new Set<League>(['ncaaf']);

/** Regular-season weeks to walk when assembling a college-football tape. */
export const NCAAF_REGULAR_WEEKS = 16;

const SITE_API = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE_API = 'https://sports.core.api.espn.com/v2/sports';

/** Optional injection points, so the client is testable without network and observable in prod. */
export interface EspnOptions {
  /** Replaces global fetch; tests pass a stub. */
  fetchImpl?: typeof fetch;
  /** Called with every request and its outcome. The route wires the Pino child logger in. */
  log?: (event: string, fields: Record<string, unknown>) => void;
  /**
   * Called when a read ultimately fails, after retries. This is how a caller tells "ESPN said
   * there are no games" apart from "we never reached ESPN" — a distinction the surface MUST make,
   * because an empty list rendered as an answer is a lie a person will act on.
   */
  onError?: (url: string, reason: string) => void;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Attempts per read, including the first. Transient failures here are common under load. */
  attempts?: number;
}

/** A team as ESPN identifies it. `id` is what every other endpoint keys on. */
export interface TeamRef {
  id: string;
  abbreviation: string;
  displayName: string;
  location: string;
  logo?: string;
}

/** A scheduled, not-yet-played game. */
export interface ScheduledGame {
  eventId: string;
  date: string;
  name: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: string;
  awayTeamId: string;
  neutralSite: boolean;
  venue?: string;
  quote: MarketQuote;
}

/** Everything the summary endpoint yields about one game. */
export interface GameSummary {
  eventId: string;
  injuries: Record<string, InjuryEntry[]>;
  /** ESPN's home-side win projection as a percentage, when published. */
  espnHomeWinPct?: number;
  /** Team id ESPN considers home, so the projection can be attributed correctly. */
  espnHomeTeamId?: string;
  quote: MarketQuote;
  /** Against-the-spread records, keyed by team abbreviation. */
  ats: Record<string, string>;
  /** Recent-form summary lines, keyed by team abbreviation. */
  form: Record<string, string>;
  /** Headlines from the wire for these two teams. */
  news: Array<{ headline: string; published?: string; link?: string }>;
}

/**
 * @description Fetch and parse JSON with a timeout, retrying a transient failure before giving up,
 * and returning null rather than throwing when the service ultimately misbehaves.
 *
 * THE RETRY IS NOT DEFENSIVE PADDING. Measured on the live box 2026-09-07: eight consecutive reads
 * from a fresh process in the same container all succeeded in under 1.6s, while the long-running
 * api intermittently failed the identical read. A single attempt from a busy event loop is simply
 * not a reliable read, and the failure surfaced as "your team has no games this week" — an answer,
 * not an error.
 *
 * `onError` fires only when every attempt is exhausted, so a caller can report honestly.
 * @param url - Absolute URL to read.
 * @param opts - Injection points, timeout and attempt count.
 * @param headers - Optional request headers. The fantasy client passes the league cookies here;
 * they are consumed at this boundary and never logged (only the URL is).
 * @returns Parsed JSON, or null once every attempt has failed.
 */
export async function getJson(url: string, opts: EspnOptions, headers?: Record<string, string>): Promise<any | null> {
  const doFetch = opts.fetchImpl || globalThis.fetch;
  const attempts = Math.max(1, opts.attempts ?? 3);
  let reason = 'unknown';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
    const started = Date.now();
    try {
      const res = await doFetch(url, { signal: controller.signal, headers: headers as HeadersInit | undefined });
      if (res.ok) {
        const body = await res.json();
        opts.log?.('espn.request.ok', { url, ms: Date.now() - started, attempt });
        return body;
      }
      reason = `HTTP ${res.status}`;
      opts.log?.('espn.request.failed', { url, status: res.status, ms: Date.now() - started, attempt });
      // A 4xx is a statement about the request and will not change on a retry; a 5xx might.
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      reason = (err as Error).message;
      opts.log?.('espn.request.error', { url, ms: Date.now() - started, attempt, error: reason });
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) await sleep(250 * attempt);
  }
  opts.onError?.(url, reason);
  return null;
}

/** Backoff between attempts. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * @description List a league's teams.
 * @param league - League to list.
 * @param opts - Client options.
 * @returns Every team, or an empty array when the endpoint is unavailable.
 */
export async function listTeams(league: League, opts: EspnOptions = {}): Promise<TeamRef[]> {
  const p = LEAGUE_PATHS[league];
  const body = await getJson(`${SITE_API}/${p.sport}/${p.league}/teams`, opts);
  const groups = body?.sports?.[0]?.leagues?.[0]?.teams || [];
  return groups.map((g: any) => g.team).filter(Boolean).map((t: any) => ({
    id: String(t.id),
    abbreviation: t.abbreviation,
    displayName: t.displayName,
    location: t.location,
    logo: t.logos?.[0]?.href,
  }));
}

/**
 * @description Read one team's season schedule and split it into finished results and upcoming
 * fixtures. The finished half is the tape both rating models learn from.
 * @param league - League to read.
 * @param teamId - ESPN team id.
 * @param season - Season year, e.g. 2025.
 * @param opts - Client options.
 * @returns Completed results and remaining fixtures for that team.
 */
export async function teamSchedule(
  league: League, teamId: string, season: number, opts: EspnOptions = {},
): Promise<{ results: Array<GameResult & { eventId: string }>; upcoming: Array<{ eventId: string; date: string }> }> {
  const p = LEAGUE_PATHS[league];
  const body = await getJson(`${SITE_API}/${p.sport}/${p.league}/teams/${teamId}/schedule?season=${season}`, opts);
  const results: Array<GameResult & { eventId: string }> = [];
  const upcoming: Array<{ eventId: string; date: string }> = [];
  for (const ev of body?.events || []) {
    const comp = ev?.competitions?.[0];
    if (!comp) continue;
    const home = (comp.competitors || []).find((c: any) => c.homeAway === 'home');
    const away = (comp.competitors || []).find((c: any) => c.homeAway === 'away');
    if (!home?.team?.abbreviation || !away?.team?.abbreviation) continue;
    if (comp.status?.type?.completed) {
      const hs = Number(home.score?.value ?? home.score);
      const as = Number(away.score?.value ?? away.score);
      if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
      results.push({
        eventId: String(ev.id), date: String(ev.date || comp.date || ''),
        homeTeam: home.team.abbreviation, awayTeam: away.team.abbreviation,
        homeScore: hs, awayScore: as, neutralSite: Boolean(comp.neutralSite),
      });
    } else {
      upcoming.push({ eventId: String(ev.id), date: String(ev.date || comp.date || '') });
    }
  }
  return { results, upcoming };
}

/**
 * @description Assemble a season's finished games from PER-WEEK scoreboards. Used for leagues where
 * walking every team's schedule is absurd: ESPN lists 761 college-football teams across every
 * division, so the per-team strategy would be 761 requests where sixteen week-calls return the same
 * FBS games.
 * @param league - League to assemble.
 * @param season - Season year.
 * @param weeks - Regular-season weeks to walk.
 * @param opts - Client options.
 * @returns Every finished game found, chronological and deduped.
 */
export async function leagueResultsByWeek(
  league: League, season: number, weeks: number, opts: EspnOptions = {},
): Promise<GameResult[]> {
  const p = LEAGUE_PATHS[league];
  const seen = new Set<string>();
  const out: GameResult[] = [];
  for (let week = 1; week <= weeks; week += 1) {
    const extra = p.scoreboardParams ? `&${p.scoreboardParams}` : '';
    const url = `${SITE_API}/${p.sport}/${p.league}/scoreboard?dates=${season}&seasontype=2&week=${week}${extra}`;
    const body = await getJson(url, opts);
    for (const ev of body?.events || []) {
      const comp = ev?.competitions?.[0];
      if (!comp?.status?.type?.completed || seen.has(String(ev.id))) continue;
      const home = (comp.competitors || []).find((c: any) => c.homeAway === 'home');
      const away = (comp.competitors || []).find((c: any) => c.homeAway === 'away');
      const hs = Number(home?.score?.value ?? home?.score);
      const as = Number(away?.score?.value ?? away?.score);
      if (!home?.team?.abbreviation || !away?.team?.abbreviation) continue;
      if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
      seen.add(String(ev.id));
      out.push({
        date: String(ev.date || comp.date || ''),
        homeTeam: home.team.abbreviation, awayTeam: away.team.abbreviation,
        homeScore: hs, awayScore: as, neutralSite: Boolean(comp.neutralSite),
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  opts.log?.('espn.season.assembledByWeek', { league, season, weeks, games: out.length });
  return out;
}

/**
 * @description Assemble a whole league season's finished games. Leagues in `WEEK_TAPE_LEAGUES` walk
 * per-week scoreboards; the rest walk each team's schedule and dedupe on event id. Either way this
 * is dozens of requests, so it belongs in a cached daily refresh and never on a request path.
 * @param league - League to assemble.
 * @param season - Season year.
 * @param opts - Client options.
 * @returns Every finished game in the season, chronological.
 */
export async function leagueResults(league: League, season: number, opts: EspnOptions = {}): Promise<GameResult[]> {
  if (WEEK_TAPE_LEAGUES.has(league)) return leagueResultsByWeek(league, season, NCAAF_REGULAR_WEEKS, opts);
  const teams = await listTeams(league, opts);
  const seen = new Set<string>();
  const out: GameResult[] = [];
  for (const team of teams) {
    const { results } = await teamSchedule(league, team.id, season, opts);
    for (const r of results) {
      if (seen.has(r.eventId)) continue;
      seen.add(r.eventId);
      const { eventId, ...game } = r;
      out.push(game);
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  opts.log?.('espn.season.assembled', { league, season, teams: teams.length, games: out.length });
  return out;
}

/**
 * @description Read the current scoreboard, which carries each game's book prices inline.
 * @param league - League to read.
 * @param opts - Client options.
 * @param dates - Optional ESPN date filter, e.g. '20260910' or '20260910-20260916'.
 * @returns Scheduled games with whatever prices the scoreboard published.
 */
export async function scoreboard(
  league: League, opts: EspnOptions = {}, dates?: string,
): Promise<ScheduledGame[]> {
  const p = LEAGUE_PATHS[league];
  const parts: string[] = [];
  if (dates) parts.push(`dates=${encodeURIComponent(dates)}`);
  if (p.scoreboardParams) parts.push(p.scoreboardParams);
  const qs = parts.length ? `?${parts.join('&')}` : '';
  const body = await getJson(`${SITE_API}/${p.sport}/${p.league}/scoreboard${qs}`, opts);
  const out: ScheduledGame[] = [];
  for (const ev of body?.events || []) {
    const comp = ev?.competitions?.[0];
    if (!comp) continue;
    const home = (comp.competitors || []).find((c: any) => c.homeAway === 'home');
    const away = (comp.competitors || []).find((c: any) => c.homeAway === 'away');
    if (!home?.team?.abbreviation || !away?.team?.abbreviation) continue;
    out.push({
      eventId: String(ev.id), date: String(ev.date || ''), name: String(ev.name || ''),
      homeTeam: home.team.abbreviation, awayTeam: away.team.abbreviation,
      homeTeamId: String(home.team.id), awayTeamId: String(away.team.id),
      neutralSite: Boolean(comp.neutralSite), venue: comp.venue?.fullName,
      quote: parseQuote(comp.odds, String(home.team.id)),
    });
  }
  return out;
}

/**
 * @description Turn an ESPN odds block into a normalised market quote. Prefers the highest-priority
 * provider, which is the book ESPN itself leads with.
 * @param odds - ESPN odds array from a competition or summary payload.
 * @param homeTeamId - ESPN id of the home team, used to attribute the moneylines correctly.
 * @returns The quote, with absent fields left undefined rather than defaulted.
 */
export function parseQuote(odds: any[] | undefined, homeTeamId: string): MarketQuote {
  const list = Array.isArray(odds) ? [...odds] : [];
  list.sort((a, b) => (a?.provider?.priority ?? 99) - (b?.provider?.priority ?? 99));
  const o = list[0];
  if (!o) return {};
  const homeIsHome = String(o.homeTeamOdds?.teamId ?? '') === homeTeamId;
  const homeSide = homeIsHome ? o.homeTeamOdds : o.awayTeamOdds;
  const awaySide = homeIsHome ? o.awayTeamOdds : o.homeTeamOdds;
  const quote: MarketQuote = { book: o.provider?.name };
  if (Number.isFinite(Number(homeSide?.moneyLine))) quote.homeMoneyline = Number(homeSide.moneyLine);
  if (Number.isFinite(Number(awaySide?.moneyLine))) quote.awayMoneyline = Number(awaySide.moneyLine);
  // ESPN quotes `spread` from the FAVOURITE's perspective in `details` but as a home-side number in
  // `spread`; the home-side convention is what the rest of this package uses.
  if (Number.isFinite(Number(o.spread))) quote.homeSpread = Number(o.spread);
  if (Number.isFinite(Number(o.overUnder))) quote.total = Number(o.overUnder);
  if (Number.isFinite(Number(homeSide?.spreadOdds))) quote.homeSpreadOdds = Number(homeSide.spreadOdds);
  if (Number.isFinite(Number(awaySide?.spreadOdds))) quote.awaySpreadOdds = Number(awaySide.spreadOdds);
  return quote;
}

/**
 * @description Read a game's full pre-game picture: injury reports, ESPN's own projection, book
 * prices, against-the-spread records, recent form and the news wire.
 * @param league - League the game belongs to.
 * @param eventId - ESPN event id.
 * @param opts - Client options.
 * @returns The summary, or null when the endpoint is unavailable.
 */
export async function gameSummary(
  league: League, eventId: string, opts: EspnOptions = {},
): Promise<GameSummary | null> {
  const p = LEAGUE_PATHS[league];
  const body = await getJson(`${SITE_API}/${p.sport}/${p.league}/summary?event=${encodeURIComponent(eventId)}`, opts);
  if (!body) return null;
  const comp = body?.header?.competitions?.[0];
  const homeTeamId = String((comp?.competitors || []).find((c: any) => c.homeAway === 'home')?.team?.id ?? '');
  return {
    eventId,
    injuries: parseInjuries(body?.injuries),
    espnHomeWinPct: parseProjection(body?.predictor, homeTeamId),
    espnHomeTeamId: homeTeamId || undefined,
    quote: parseQuote(body?.pickcenter?.length ? body.pickcenter : comp?.odds, homeTeamId),
    ats: mapByTeam(body?.againstTheSpread, (t: any) => t?.records?.[0]?.summary),
    form: mapByTeam(body?.lastFiveGames, (t: any) => summariseForm(t?.events)),
    news: (body?.news?.articles || []).slice(0, 8).map((a: any) => ({
      headline: String(a?.headline || ''), published: a?.published, link: a?.links?.web?.href,
    })).filter((a: { headline: string }) => a.headline),
  };
}

/** Normalises ESPN's per-team injury block into the shape the availability model consumes. */
function parseInjuries(blocks: any[] | undefined): Record<string, InjuryEntry[]> {
  const out: Record<string, InjuryEntry[]> = {};
  for (const block of blocks || []) {
    const abbr = block?.team?.abbreviation;
    if (!abbr) continue;
    out[abbr] = (block.injuries || []).map((i: any) => ({
      player: String(i?.athlete?.displayName || 'unknown'),
      position: String(i?.athlete?.position?.abbreviation || ''),
      status: String(i?.status || ''),
      athleteId: i?.athlete?.id ? String(i.athlete.id) : undefined,
      detail: i?.details?.type ? String(i.details.type) : undefined,
    })).filter((i: InjuryEntry) => i.position || i.status);
  }
  return out;
}

/** Pulls ESPN's home-side win projection out of the predictor block, as a percentage. */
function parseProjection(predictor: any, homeTeamId: string): number | undefined {
  if (!predictor) return undefined;
  const home = String(predictor.homeTeam?.id ?? '') === homeTeamId ? predictor.homeTeam : predictor.awayTeam;
  const pct = Number(home?.gameProjection);
  return Number.isFinite(pct) ? pct : undefined;
}

/** Folds any per-team ESPN block into a plain abbreviation-keyed map. */
function mapByTeam(blocks: any[] | undefined, pick: (t: any) => string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of blocks || []) {
    const abbr = b?.team?.abbreviation;
    const value = pick(b);
    if (abbr && value) out[abbr] = String(value);
  }
  return out;
}

/** Condenses a last-five-games block into a readable W-L line. */
function summariseForm(events: any[] | undefined): string | undefined {
  if (!Array.isArray(events) || !events.length) return undefined;
  const parts = events.slice(0, 5).map((e) => `${e?.gameResult || '?'}${e?.score ? ` ${e.score}` : ''}`);
  return parts.join(', ');
}

/** A finished game's final state and the prices it closed at. */
export interface FinalState {
  completed: boolean;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  /** The last published prices, which are the closing line for grading purposes. */
  closingQuote: MarketQuote;
}

/**
 * @description Read a game's final score and closing prices, for grading. Returns null while the
 * game is still in progress or unavailable, so the grader simply tries again on its next pass
 * rather than recording a half-finished result.
 *
 * The closing quote is taken from the same block the pre-game quote came from. ESPN keeps the last
 * published line there after a game ends, which is exactly the number closing-line value needs.
 * @param league - League the game belongs to.
 * @param eventId - ESPN event id.
 * @param opts - Client options.
 * @returns The final state, or null when the game has not finished.
 */
export async function finalState(
  league: League, eventId: string, opts: EspnOptions = {},
): Promise<FinalState | null> {
  const p = LEAGUE_PATHS[league];
  const body = await getJson(`${SITE_API}/${p.sport}/${p.league}/summary?event=${encodeURIComponent(eventId)}`, opts);
  const comp = body?.header?.competitions?.[0];
  if (!comp?.status?.type?.completed) return null;
  const home = (comp.competitors || []).find((c: any) => c.homeAway === 'home');
  const away = (comp.competitors || []).find((c: any) => c.homeAway === 'away');
  const hs = Number(home?.score?.value ?? home?.score);
  const as = Number(away?.score?.value ?? away?.score);
  if (!home?.team?.abbreviation || !away?.team?.abbreviation || !Number.isFinite(hs) || !Number.isFinite(as)) return null;
  return {
    completed: true,
    homeTeam: home.team.abbreviation, awayTeam: away.team.abbreviation,
    homeScore: hs, awayScore: as,
    closingQuote: parseQuote(body?.pickcenter?.length ? body.pickcenter : comp?.odds, String(home.team.id)),
  };
}

/**
 * @description Read one athlete's season statistics, flattened to a name→value map.
 * @param league - League the athlete plays in.
 * @param athleteId - ESPN athlete id.
 * @param season - Season year.
 * @param opts - Client options.
 * @returns Statistic name to numeric value; empty when unavailable.
 */
export async function athleteSeasonStats(
  league: League, athleteId: string, season: number, opts: EspnOptions = {},
): Promise<Record<string, number>> {
  const p = LEAGUE_PATHS[league];
  const url = `${CORE_API}/${p.sport}/leagues/${p.league}/seasons/${season}/types/2/athletes/${athleteId}/statistics`;
  return flattenStats(await getJson(url, opts));
}

/**
 * @description Read a team's season statistics totals — the denominator that turns a player's
 * production into a share of his team's, which is what makes injury weighting real rather than
 * positional.
 * @param league - League the team plays in.
 * @param teamId - ESPN team id.
 * @param season - Season year.
 * @param opts - Client options.
 * @returns Statistic name to numeric value; empty when unavailable.
 */
export async function teamSeasonStats(
  league: League, teamId: string, season: number, opts: EspnOptions = {},
): Promise<Record<string, number>> {
  const p = LEAGUE_PATHS[league];
  const url = `${CORE_API}/${p.sport}/leagues/${p.league}/seasons/${season}/types/2/teams/${teamId}/statistics`;
  return flattenStats(await getJson(url, opts));
}

/**
 * @description Flatten an ESPN statistics payload's nested categories into one name→value map.
 * Later categories win on a name collision, which only happens for shared totals like `totalYards`
 * where the values agree anyway.
 * @param body - Raw statistics payload.
 * @returns Statistic name to numeric value.
 */
export function flattenStats(body: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cat of body?.splits?.categories || []) {
    for (const s of cat?.stats || []) {
      const v = Number(s?.value ?? String(s?.displayValue ?? '').replace(/,/g, ''));
      if (s?.name && Number.isFinite(v)) out[s.name] = v;
    }
  }
  return out;
}

/**
 * @description Statistic that best represents a position's production, used to size an injury.
 * Positions with no meaningful counting stat return null and fall back to positional leverage
 * alone — which is the honest answer for an offensive lineman, whose value does not appear in a
 * box score at all.
 * @param league - League the player plays in.
 * @param position - Position abbreviation.
 * @returns The athlete stat name and its team-total counterpart, or null.
 */
export function productionStatFor(
  league: League, position: string,
): { athleteStat: string; teamStat: string } | null {
  const pos = String(position || '').toUpperCase();
  if (league === 'nba') return { athleteStat: 'points', teamStat: 'points' };
  if (pos === 'QB') return { athleteStat: 'passingYards', teamStat: 'passingYards' };
  if (pos === 'RB' || pos === 'FB') return { athleteStat: 'rushingYards', teamStat: 'rushingYards' };
  if (pos === 'WR' || pos === 'TE') return { athleteStat: 'receivingYards', teamStat: 'receivingYards' };
  return null;
}
