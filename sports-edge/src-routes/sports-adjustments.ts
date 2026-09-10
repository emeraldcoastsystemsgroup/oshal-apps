/**
 * Game-context adjustments — what the ratings do not know.
 *
 * Elo and power ratings describe the team that PLAYED the last N games. They do not know that the
 * quarterback is out, that this is the second night of a back-to-back, or that a good offence is
 * about to meet the one defence built to stop it. This module turns those three things into points
 * of expected margin, which is the only currency the ensemble speaks.
 *
 * AVAILABILITY IS WEIGHTED BY PRODUCTION, NOT BY POSITION ALONE. A generic "WR is worth 1.5 points"
 * constant treats a team's leading receiver and its fifth wideout identically, which is wrong in
 * the direction that costs money. Instead a player's cost is his POSITIONAL LEVERAGE scaled by his
 * SHARE OF HIS TEAM'S ACTUAL PRODUCTION, taken from real season statistics. A quarterback still
 * dominates the table because quarterback leverage genuinely dwarfs everything else — the market
 * moves six to seven points on a starting QB — but a WR1 and a WR5 no longer cost the same.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM. True position-versus-position charting — this receiver
 * against that cornerback, snap by snap — requires charting data that has no free source. Rather
 * than fake it with a plausible-looking number, the unit matchup here is computed from the actual
 * scoring tape: a two-sided rating that separates each team into an offence and a defence, so
 * "their offence against our defence" is a real measured quantity. Where a claim cannot be
 * grounded, it is absent, not invented.
 *
 * THE HONEST CEILING. The market already knows every injury on the wire. These adjustments only
 * generate edge where our weighting DISAGREES with the market's, which is rare and small. They are
 * here because a line built without them is wrong in a way that is easy to fix, not because they
 * are a source of alpha on their own.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — production-weighted availability cost, rest/back-to-back/short-week and travel adjustments, and two-sided offence/defence ratings solved from the scoring tape for the unit matchup.
 *
 * @module sports-adjustments
 */

import type { League } from './sports-odds';
import type { GameResult } from './sports-ratings';
import { LEAGUE_CONSTANTS } from './sports-ratings';

/** One player on an injury report. */
export interface InjuryEntry {
  player: string;
  /** Position abbreviation as the source reports it, e.g. 'QB', 'PG'. */
  position: string;
  /** Report status, e.g. 'Out', 'Doubtful', 'Questionable'. */
  status: string;
  /** Source athlete id, so the player's real production can be looked up. */
  athleteId?: string;
  /** Optional share of team production in [0, 1]; when absent an average starter is assumed. */
  productionShare?: number;
  /** What was injured, when the report says. Displayed, never modelled — body part is not signal. */
  detail?: string;
}

/**
 * Probability a player misses the game, by report status. 'Questionable' is the interesting one:
 * league-wide, questionable players play roughly two-thirds of the time, so 0.35 is the measured
 * value rather than the intuitive coin flip.
 */
export const STATUS_OUT_PROBABILITY: Record<string, number> = {
  out: 1, 'injured reserve': 1, ir: 1, suspension: 1, suspended: 1,
  doubtful: 0.75, questionable: 0.35, probable: 0.15, 'day-to-day': 0.4, active: 0,
};

/**
 * Points of expected margin a team loses when a FULLY AVERAGE starter at this position is out.
 * Scaled afterwards by the player's real production share, so these are the ceiling for a
 * league-average starter, not for a star.
 *
 * The quarterback figure is the market's own: a starting-QB downgrade moves an NFL side roughly
 * six to seven points, more than every other position combined.
 */
export const POSITION_LEVERAGE: Record<League, Record<string, number>> = {
  nfl: {
    QB: 6.5, RB: 1.2, WR: 1.4, TE: 0.9, OT: 1.1, G: 0.7, C: 0.8, OL: 0.8,
    DE: 1.3, EDGE: 1.3, DT: 0.9, LB: 0.8, CB: 1.2, S: 0.8, K: 0.4, P: 0.2, LS: 0.1,
  },
  nba: { PG: 3.2, SG: 3.0, SF: 3.0, PF: 2.9, C: 3.0, G: 3.0, F: 3.0 },
  // College football uses the same position shapes as the NFL, scaled UP: replacement level is far
  // further below the starter in college than in a professional league, where every backup was also
  // a high-level recruit. A starting college quarterback going out is worth more than the NFL's
  // six-and-a-half points, not less.
  ncaaf: {
    QB: 8.0, RB: 1.6, WR: 1.7, TE: 1.0, OT: 1.3, G: 0.9, C: 1.0, OL: 1.0,
    DE: 1.5, EDGE: 1.5, DT: 1.1, LB: 1.0, CB: 1.4, S: 1.0, K: 0.5, P: 0.3, LS: 0.1,
  },
};

/** Fallback leverage when a position is unrecognised — a replaceable contributor. */
const DEFAULT_LEVERAGE = 0.6;

/** What a team's injury report costs it, and which players drive that number. */
export interface AvailabilityImpact {
  /** Points of expected margin lost. Always <= 0. */
  points: number;
  /** The individually meaningful losses, largest first. */
  keyLosses: Array<{ player: string; position: string; status: string; points: number }>;
}

/**
 * @description Cost a team's injury report in points of expected margin. Each player contributes
 * his positional leverage, scaled by his share of team production and by the probability he
 * actually misses the game.
 * @param injuries - The team's injury report.
 * @param league - League whose leverage table applies.
 * @returns Total points lost and the players responsible.
 */
export function availabilityImpact(injuries: InjuryEntry[], league: League): AvailabilityImpact {
  const table = POSITION_LEVERAGE[league] || {};
  const losses: AvailabilityImpact['keyLosses'] = [];
  let total = 0;
  for (const inj of injuries) {
    const outProb = STATUS_OUT_PROBABILITY[String(inj.status || '').toLowerCase().trim()];
    if (!outProb) continue;
    const leverage = table[String(inj.position || '').toUpperCase()] ?? DEFAULT_LEVERAGE;
    // An absent production share means "assume a league-average starter", i.e. no scaling either
    // way. A measured share of 0 correctly zeroes the cost of a player who never plays.
    const share = inj.productionShare === undefined ? 1 : clampShare(inj.productionShare);
    const cost = leverage * share * outProb;
    if (cost <= 0) continue;
    total += cost;
    losses.push({ player: inj.player, position: inj.position, status: inj.status, points: -round2(cost) });
  }
  losses.sort((a, b) => a.points - b.points);
  // Negate BEFORE rounding: `-round2(0)` is negative zero, and a clean injury report must report a
  // plain 0 so strict-equality comparisons downstream do not see a phantom difference.
  return { points: round2(-total), keyLosses: losses.slice(0, 8) };
}

/**
 * @description Scale a raw production share into a multiplier centred on a league-average starter.
 * A starter carrying twice an average starter's load counts roughly twice, but the curve is capped
 * so no single player can be scaled into absurdity by a small-sample statistic.
 * @param share - Player's share of team production in [0, 1].
 * @returns Multiplier in [0, 2].
 */
function clampShare(share: number): number {
  if (!Number.isFinite(share) || share <= 0) return 0;
  // An "average starter" is treated as ~15% of team production; the ratio is capped at 2x.
  return Math.min(share / 0.15, 2);
}

/**
 * Rounds to two decimals so stored and displayed points agree exactly, normalising negative zero
 * to zero. `-0` is invisible in JSON and in most arithmetic but compares unequal to `0` under
 * strict equality, which turns "this team has a clean injury report" into a spurious difference.
 */
function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

/** Schedule context for one side of a game. */
export interface RestContext {
  /** Days since this team's previous game. */
  restDays: number;
  /** True when the team crossed two or more time zones to get here. */
  longTravel?: boolean;
}

/**
 * @description Points of expected margin from rest and travel. The two leagues behave differently
 * enough that they do not share a formula: NFL teams are penalised for a short week and helped by
 * a bye, while NBA teams are penalised sharply on the second night of a back-to-back — the single
 * largest scheduling effect in either sport.
 * @param ctx - This team's rest context.
 * @param league - League whose schedule effects apply.
 * @returns Points, positive when the schedule favours this team.
 */
export function restImpact(ctx: RestContext, league: League): number {
  const days = Number.isFinite(ctx.restDays) ? ctx.restDays : 7;
  let points = 0;
  if (league === 'nba') {
    if (days <= 1) points -= 1.8;          // back-to-back
    else if (days === 2) points -= 0.4;    // 3-in-4 territory
    else if (days >= 4) points += 0.5;     // genuinely rested
  } else {
    if (days <= 4) points -= 1.0;          // short week, e.g. a Thursday game
    else if (days >= 13) points += 0.6;    // off a bye
  }
  if (ctx.longTravel) points -= 0.4;
  return round2(points);
}

/** A team split into how well it scores and how well it prevents scoring, in points vs average. */
export interface UnitRating {
  team: string;
  /** Points per game better than average at scoring, schedule-adjusted. */
  offense: number;
  /** Points per game better than average at preventing scoring, schedule-adjusted. */
  defense: number;
  games: number;
}

/**
 * @description Split every team into an offence and a defence rating by iterating the scoring tape
 * to a fixed point, the two-sided form of a Simple Rating System. This is what makes a real unit
 * matchup possible: "their offence against our defence" becomes two measured numbers rather than a
 * narrative. Home advantage is removed before averaging so a team is not credited with its venue.
 * @param games - Finished games.
 * @param league - League whose home advantage applies.
 * @returns Offence and defence ratings per team, keyed by abbreviation.
 */
export function computeUnitRatings(games: GameResult[], league: League): Record<string, UnitRating> {
  const half = LEAGUE_CONSTANTS[league].homeAdvantagePoints / 2;
  const scored: Record<string, number[]> = {};
  const allowed: Record<string, number[]> = {};
  const opponents: Record<string, string[]> = {};
  for (const g of games) {
    const adj = g.neutralSite ? 0 : half;
    (scored[g.homeTeam] ||= []).push(g.homeScore - adj);
    (allowed[g.homeTeam] ||= []).push(g.awayScore + adj);
    (scored[g.awayTeam] ||= []).push(g.awayScore + adj);
    (allowed[g.awayTeam] ||= []).push(g.homeScore - adj);
    (opponents[g.homeTeam] ||= []).push(g.awayTeam);
    (opponents[g.awayTeam] ||= []).push(g.homeTeam);
  }
  const teams = Object.keys(scored);
  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const leagueAvg = mean(teams.flatMap((t) => scored[t]));
  const off: Record<string, number> = {};
  const def: Record<string, number> = {};
  for (const t of teams) {
    off[t] = mean(scored[t]) - leagueAvg;
    def[t] = leagueAvg - mean(allowed[t]);
  }
  for (let pass = 0; pass < 20; pass += 1) {
    let moved = 0;
    const nextOff: Record<string, number> = {};
    const nextDef: Record<string, number> = {};
    for (const t of teams) {
      // Credit a team for scoring against good defences and for holding down good offences.
      const oppDef = mean((opponents[t] || []).map((o) => def[o] ?? 0));
      const oppOff = mean((opponents[t] || []).map((o) => off[o] ?? 0));
      nextOff[t] = mean(scored[t]) - leagueAvg + oppDef;
      nextDef[t] = leagueAvg - mean(allowed[t]) + oppOff;
      moved = Math.max(moved, Math.abs(nextOff[t] - off[t]), Math.abs(nextDef[t] - def[t]));
    }
    Object.assign(off, nextOff);
    Object.assign(def, nextDef);
    if (moved < 1e-6) break;
  }
  const out: Record<string, UnitRating> = {};
  for (const t of teams) {
    out[t] = { team: t, offense: round2(off[t]), defense: round2(def[t]), games: scored[t].length };
  }
  return out;
}

/** One side's half of the unit matchup. */
export interface MatchupEdge {
  /** Points this team's offence is expected to gain on the opposing defence. */
  offenseVsDefense: number;
  /** Points this team's defence is expected to take off the opposing offence. */
  defenseVsOffense: number;
}

/**
 * @description Score the unit matchup between two teams: each side's offence against the other's
 * defence. The net of the two halves is the matchup's contribution to expected margin.
 * @param home - Home team's unit ratings.
 * @param away - Away team's unit ratings.
 * @returns Both halves plus the net home-side margin contribution.
 */
export function matchupEdge(
  home: UnitRating | undefined, away: UnitRating | undefined,
): { home: MatchupEdge; away: MatchupEdge; netHomeMargin: number } {
  const h = home || { team: '?', offense: 0, defense: 0, games: 0 };
  const a = away || { team: '?', offense: 0, defense: 0, games: 0 };
  const homeEdge: MatchupEdge = { offenseVsDefense: round2(h.offense - a.defense), defenseVsOffense: round2(h.defense - a.offense) };
  const awayEdge: MatchupEdge = { offenseVsDefense: round2(a.offense - h.defense), defenseVsOffense: round2(a.defense - h.offense) };
  const net = round2((homeEdge.offenseVsDefense + homeEdge.defenseVsOffense) - (awayEdge.offenseVsDefense + awayEdge.defenseVsOffense));
  return { home: homeEdge, away: awayEdge, netHomeMargin: round2(net / 2) };
}
