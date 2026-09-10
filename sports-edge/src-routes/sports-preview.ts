/**
 * The game preview — the whole package in one object, for one game.
 *
 * This is what the operator actually asked for: "really know the game that's about to be played."
 * A preview is built bottom-up for a single fixture — both teams' season tape, both injury reports
 * weighted by what those players genuinely produce, rest and travel, the unit matchup, the wire —
 * folded into a line, and then measured against the book's price for a straight-up or
 * against-the-spread call.
 *
 * PRODUCTION-WEIGHTED INJURIES ARE THE EXPENSIVE PART, AND THEY ARE WORTH IT. For every player on
 * an injury report whose position has a meaningful counting stat, this module fetches that
 * player's season statistics and the team's totals in the same category, and divides. A receiver
 * with 31% of his team's receiving yards and a receiver with 4% stop costing the same number, and
 * the denominator is the team's real total rather than an assumed league-average team.
 *
 * The lookups are bounded — an injury report is a handful of players, not a roster — and they are
 * cached per (team, season) inside one build so a twelve-player report costs one team-totals read.
 * Positions with no box-score footprint, offensive line most of all, fall back to positional
 * leverage alone: an honest "we cannot measure this" beats a plausible invented number.
 *
 * WHAT A PREVIEW DELIBERATELY DOES NOT DO. It does not call an LLM. Every number here is a pure
 * function of public data, so the same inputs always produce the same line and a bad call can be
 * traced to a model rather than to a sentence. The wire headlines ride along for the reader; they
 * are displayed, never parsed into a secret adjustment.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — season ratings assembly with prior-season carry-over, production-weighted injury enrichment against real team totals, rest-day derivation from the schedule, and the assembled preview with its straight-up and against-the-spread candidates.
 *
 * @module sports-preview
 */

import type { League } from './sports-odds';
import {
  carryOverElo, computeElo, computePowerRatings,
  type EloRating, type GameResult, type PowerRating,
} from './sports-ratings';
import { computeUnitRatings, type InjuryEntry, type RestContext, type UnitRating } from './sports-adjustments';
import { buildLine, evaluateEdges, type EdgeCandidate, type EnsembleLine, type MarketQuote } from './sports-ensemble';
import {
  athleteSeasonStats, gameSummary, leagueResults, productionStatFor, teamSeasonStats,
  type EspnOptions, type GameSummary, type ScheduledGame,
} from './sports-espn';

/** The three rating tables, always derived from one tape and therefore always cached together. */
export interface SeasonRatings {
  league: League;
  season: number;
  elo: Record<string, EloRating>;
  power: Record<string, PowerRating>;
  units: Record<string, UnitRating>;
  /** Games the ratings were fit on. Zero means every team is at its seeded value. */
  games: number;
  /** True when the current season is too young to stand alone and prior-season Elo was carried in. */
  carriedOver: boolean;
}

/**
 * Games a season must have before it can rate teams without help from the previous one. Below this
 * every rating is mostly noise, and a Week 1 line built on three games of tape would be presented
 * with a confidence it has not earned.
 */
export const MIN_GAMES_STANDALONE: Record<League, number> = { nfl: 48, nba: 150, ncaaf: 250 };

/**
 * @description Build a league's rating tables for a season, seeding Elo from the prior season when
 * the current one is too young to stand alone. The carry-over is regressed toward the mean first,
 * because last season's rating describes a roster that has since turned over.
 * @param league - League to rate.
 * @param season - Season year.
 * @param opts - ESPN client options.
 * @returns The three rating tables plus how much tape they were fit on.
 */
export async function buildSeasonRatings(
  league: League, season: number, opts: EspnOptions = {},
): Promise<SeasonRatings> {
  const games = await leagueResults(league, season, opts);
  let seed: Record<string, number> | undefined;
  let carriedOver = false;
  if (games.length < MIN_GAMES_STANDALONE[league]) {
    const prior = await leagueResults(league, season - 1, opts);
    if (prior.length) {
      seed = carryOverElo(computeElo(prior, league), league);
      carriedOver = true;
      opts.log?.('sports.ratings.carriedOver', { league, season, priorGames: prior.length, games: games.length });
    }
  }
  // The power and unit models have no carry-over equivalent — they are averages, and an average of
  // zero games is no rating at all. They therefore ABSTAIN from the ensemble until games exist
  // rather than reporting a zero that would read as "these teams are even"; the ensemble
  // renormalises over whatever actually has data. Early in a season that is Elo alone, carried over
  // from last year, which is the honest answer rather than a gap.
  return {
    league, season, games: games.length, carriedOver,
    elo: computeElo(games, league, seed),
    power: computePowerRatings(games, league),
    units: computeUnitRatings(games, league),
  };
}

/**
 * @description Attach each injured player's real share of his team's production, so the
 * availability model sizes a loss by what the player actually does rather than by his position
 * alone. Players whose position has no counting stat are returned untouched and fall back to
 * positional leverage.
 * @param league - League the team plays in.
 * @param teamId - ESPN team id, for the team totals denominator.
 * @param injuries - The team's injury report.
 * @param season - Season year whose statistics apply.
 * @param opts - ESPN client options.
 * @returns The same report with `productionShare` filled in where it could be measured.
 */
export async function enrichInjuries(
  league: League, teamId: string, injuries: InjuryEntry[], season: number, opts: EspnOptions = {},
): Promise<InjuryEntry[]> {
  const relevant = injuries.filter((i) => i.athleteId && productionStatFor(league, i.position));
  if (!relevant.length) return injuries;
  const teamTotals = await teamSeasonStats(league, teamId, season, opts);
  const out: InjuryEntry[] = [];
  for (const inj of injuries) {
    const stat = inj.athleteId ? productionStatFor(league, inj.position) : null;
    if (!stat) { out.push(inj); continue; }
    const denom = teamTotals[stat.teamStat];
    if (!denom || denom <= 0) { out.push(inj); continue; }
    const playerStats = await athleteSeasonStats(league, inj.athleteId as string, season, opts);
    const value = playerStats[stat.athleteStat];
    if (!Number.isFinite(value)) { out.push(inj); continue; }
    out.push({ ...inj, productionShare: Math.max(0, Math.min(1, value / denom)) });
  }
  return out;
}

/**
 * @description Days between a team's previous finished game and this one. Falls back to a normal
 * week when the schedule cannot say, which keeps the rest adjustment neutral rather than inventing
 * an advantage.
 * @param results - The team's finished games, any order.
 * @param gameDate - ISO date of the upcoming game.
 * @param league - League, whose normal turnaround is the fallback.
 * @returns Rest context for the adjustment model.
 */
export function restFrom(results: GameResult[], gameDate: string, league: League): RestContext {
  const target = Date.parse(gameDate);
  const normal = league === 'nba' ? 2 : 7;
  if (!Number.isFinite(target)) return { restDays: normal };
  let latest = -Infinity;
  for (const g of results) {
    const t = Date.parse(g.date);
    if (Number.isFinite(t) && t < target && t > latest) latest = t;
  }
  if (!Number.isFinite(latest)) return { restDays: normal };
  return { restDays: Math.round((target - latest) / 86400000) };
}

/** Everything the surface shows for one game. */
export interface GamePreview {
  eventId: string;
  league: League;
  date: string;
  name: string;
  homeTeam: string;
  awayTeam: string;
  venue?: string;
  neutralSite: boolean;
  /** Our line, with every model's contribution kept separate. */
  line: EnsembleLine;
  /** The book's prices. */
  quote: MarketQuote;
  /** Disagreements worth a bet, largest edge first. Often empty — that is the normal case. */
  edges: EdgeCandidate[];
  /** The reader's context: ATS records, recent form, the wire, and rest. */
  context: {
    ats: Record<string, string>;
    form: Record<string, string>;
    news: Array<{ headline: string; published?: string; link?: string }>;
    restDays: { home: number; away: number };
    espnHomeWinPct?: number;
  };
  /** Where each side's ratings sit, for the card's header. */
  ratings: Record<string, { elo: number; power: number; offense: number; defense: number }>;
  /** True when the ratings leaned on the prior season, so the card can say so. */
  carriedOver: boolean;
  generatedAt: string;
}

/** Per-team schedule tape, needed for rest days. */
export interface TeamTape {
  teamId: string;
  results: GameResult[];
}

/**
 * @description Build the full preview for one scheduled game. This is the function the poller and
 * the surface both call; everything else in the package either feeds it or records what it said.
 * @param game - The scheduled game, with whatever prices the scoreboard carried.
 * @param ratings - The league's cached season ratings.
 * @param tapes - Each side's finished games, keyed by team abbreviation, for rest days.
 * @param season - Season year whose statistics apply.
 * @param opts - ESPN client options.
 * @returns The assembled preview.
 */
export async function buildPreview(
  game: ScheduledGame, ratings: SeasonRatings, tapes: Record<string, TeamTape>,
  season: number, opts: EspnOptions = {},
): Promise<GamePreview> {
  const summary: GameSummary | null = await gameSummary(ratings.league, game.eventId, opts);
  const rawHome = summary?.injuries?.[game.homeTeam] || [];
  const rawAway = summary?.injuries?.[game.awayTeam] || [];
  const homeInjuries = await enrichInjuries(ratings.league, game.homeTeamId, rawHome, season, opts);
  const awayInjuries = await enrichInjuries(ratings.league, game.awayTeamId, rawAway, season, opts);
  const homeRest = restFrom(tapes[game.homeTeam]?.results || [], game.date, ratings.league);
  const awayRest = restFrom(tapes[game.awayTeam]?.results || [], game.date, ratings.league);

  // The summary's price is the fresher of the two — the scoreboard's block can lag a line move.
  const quote: MarketQuote = { ...game.quote, ...(summary?.quote || {}) };
  const line = buildLine({
    league: ratings.league, homeTeam: game.homeTeam, awayTeam: game.awayTeam,
    neutralSite: game.neutralSite, elo: ratings.elo, power: ratings.power, units: ratings.units,
    homeInjuries, awayInjuries, homeRest, awayRest,
    marketHomeSpread: quote.homeSpread, espnHomeWinPct: summary?.espnHomeWinPct,
  });
  return {
    eventId: game.eventId, league: ratings.league, date: game.date, name: game.name,
    homeTeam: game.homeTeam, awayTeam: game.awayTeam, venue: game.venue, neutralSite: game.neutralSite,
    line, quote,
    edges: evaluateEdges(line, quote, ratings.league),
    context: {
      ats: summary?.ats || {}, form: summary?.form || {}, news: summary?.news || [],
      restDays: { home: homeRest.restDays, away: awayRest.restDays },
      espnHomeWinPct: summary?.espnHomeWinPct,
    },
    ratings: {
      [game.homeTeam]: ratingsFor(ratings, game.homeTeam),
      [game.awayTeam]: ratingsFor(ratings, game.awayTeam),
    },
    carriedOver: ratings.carriedOver,
    generatedAt: new Date().toISOString(),
  };
}

/** Collects one team's four headline ratings for the card header. */
function ratingsFor(r: SeasonRatings, team: string): { elo: number; power: number; offense: number; defense: number } {
  return {
    elo: Math.round(r.elo[team]?.elo ?? 1500),
    power: r.power[team]?.rating ?? 0,
    offense: r.units[team]?.offense ?? 0,
    defense: r.units[team]?.defense ?? 0,
  };
}
