/**
 * The ensemble — every model votes, the shadows only watch, and the market gets the last word.
 *
 * This is the sports twin of the trading engine's ALGORITHMS / SHADOW_ALGORITHMS split
 * (@/features/trading algorithms.ts, ADR-096). A model in `STRENGTH_MODELS` contributes to the
 * line we publish. A model in `SHADOW_MODELS` is computed and recorded on every game and
 * contributes NOTHING, so its record accumulates in the open where it can be compared before
 * anyone is tempted to promote it. Promotion is an operator decision backed by graded rows, never
 * a code change made because a model looked good in a backtest.
 *
 * TWO KINDS OF MODEL, COMBINED TWO DIFFERENT WAYS. This distinction is the one methodological
 * point in the file and getting it wrong quietly corrupts every number downstream:
 *
 *   - STRENGTH models (Elo, power ratings, unit matchup) are competing ESTIMATES OF THE SAME
 *     QUANTITY — how much better one team is. They are combined by weighted AVERAGE. Averaging is
 *     right because they are three views of one thing; adding them would triple-count team quality
 *     and produce lines twenty points off.
 *   - CONTEXT adjustments (availability, rest and travel) are SEPARATE EFFECTS that the strength
 *     models cannot see, because they describe this specific game rather than the team's season.
 *     They are ADDED. Averaging them in would dilute a starting quarterback's absence into
 *     nothing.
 *
 * WHY THE MARKET IS IN HERE AT ALL. `SHADOW_MODELS` includes a blend of our line with the market's
 * and the ESPN matchup predictor. Both exist to answer the only question that matters early on:
 * does this package add anything to a number anyone can get for free? If the blend beats us, the
 * honest conclusion is that our contribution is noise and the blend should be promoted. That
 * comparison is built in from the first game rather than discovered later.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — weighted strength ensemble plus additive context adjustments, non-voting shadow models incl. a market blend and the ESPN predictor baseline, and the straight-up / against-the-spread edge evaluation against a de-vigged market. A strength model with no data ABSTAINS and its weight is redistributed: found live in NFL Week 1, where power and units had no games, returned zero, and averaged a real Elo signal most of the way to nothing — a confident-looking preview that was pure home-field advantage.
 *
 * @module sports-ensemble
 */

import {
  coverProbability, devigTwoWay, expectedValue, kellyFraction, winProbabilityFromMargin, type League,
} from './sports-odds';
import { eloToMargin, LEAGUE_CONSTANTS, type EloRating, type PowerRating } from './sports-ratings';
import {
  availabilityImpact, matchupEdge, restImpact,
  type AvailabilityImpact, type InjuryEntry, type RestContext, type UnitRating,
} from './sports-adjustments';

/** Everything the ensemble needs about one scheduled game. */
export interface GameInputs {
  league: League;
  homeTeam: string;
  awayTeam: string;
  neutralSite: boolean;
  elo: Record<string, EloRating>;
  power: Record<string, PowerRating>;
  units: Record<string, UnitRating>;
  homeInjuries: InjuryEntry[];
  awayInjuries: InjuryEntry[];
  homeRest: RestContext;
  awayRest: RestContext;
  /** The market's home-side spread, e.g. -3.5. Used only by shadow models. */
  marketHomeSpread?: number;
  /** ESPN's own home win projection as a percentage, e.g. 61.1. Recorded as a baseline. */
  espnHomeWinPct?: number;
}

/** One model's contribution, in points of expected home margin. */
export interface ModelSignal {
  model: string;
  /** Points of home margin this model accounts for. */
  points: number;
  /** Plain-language reason, shown on the game card so a number is never unexplained. */
  basis: string;
  /**
   * False when the model had no data to work from and is ABSTAINING rather than calling a tie.
   *
   * The distinction is load-bearing and cost a real bug: in Week 1 the power and unit models have
   * no games to average, so they return zero. A zero that VOTES is a model saying "these teams are
   * even", and averaging it against a real Elo signal drags the line most of the way to nothing —
   * which is how a confident-looking preview ends up being pure home-field advantage. An abstaining
   * model is excluded from the average and the remaining weights renormalise.
   */
  available: boolean;
}

/** Relative weights of the strength models. They are normalised, so these are ratios not shares. */
export const STRENGTH_WEIGHTS: Record<string, number> = { elo: 0.45, power: 0.35, units: 0.20 };

/** The full line for one game, with every model's contribution kept separate. */
export interface EnsembleLine {
  /** Our projected home margin in points — the line we would set. */
  projectedMargin: number;
  /** Our probability the home side wins outright. */
  homeWinProbability: number;
  /** Points of home advantage applied. */
  homeAdvantage: number;
  /** The averaged strength estimate before context was added. */
  strengthMargin: number;
  /** Strength models, which vote. */
  signals: ModelSignal[];
  /** Context adjustments, which are added. */
  adjustments: ModelSignal[];
  /** Models recorded but excluded from the line. */
  shadow: ModelSignal[];
  /** Whose injury report cost what, for the game card. */
  availability: { home: AvailabilityImpact; away: AvailabilityImpact };
}

/**
 * @description Build our line for a game: average the strength models, add the context
 * adjustments, and convert the result to a win probability. Every contribution is returned
 * separately so the card can show WHY the number is what it is, which is what makes a bad pick
 * diagnosable after the fact.
 * @param g - Everything known about the scheduled game.
 * @returns The projected margin, the win probability, and each model's contribution.
 */
export function buildLine(g: GameInputs): EnsembleLine {
  const c = LEAGUE_CONSTANTS[g.league];
  const hfa = g.neutralSite ? 0 : c.homeAdvantagePoints;
  const signals = strengthSignals(g, hfa);
  // Only models with data vote; the rest abstain and their weight is redistributed. Early in a
  // season this is usually Elo alone carrying the line, which is the honest answer.
  const voting = signals.filter((s) => s.available);
  const weighted = voting.reduce((sum, s) => sum + s.points * (STRENGTH_WEIGHTS[s.model] || 0), 0);
  const weightSum = voting.reduce((sum, s) => sum + (STRENGTH_WEIGHTS[s.model] || 0), 0);
  const strengthMargin = weightSum > 0 ? weighted / weightSum : hfa;

  const homeAvail = availabilityImpact(g.homeInjuries || [], g.league);
  const awayAvail = availabilityImpact(g.awayInjuries || [], g.league);
  const adjustments: ModelSignal[] = [
    {
      model: 'availability',
      points: round2(homeAvail.points - awayAvail.points),
      available: true,
      basis: availabilityBasis(homeAvail, awayAvail),
    },
    {
      model: 'rest',
      points: round2(restImpact(g.homeRest || { restDays: 7 }, g.league) - restImpact(g.awayRest || { restDays: 7 }, g.league)),
      available: true,
      basis: `${g.homeTeam} on ${g.homeRest?.restDays ?? 7}d rest, ${g.awayTeam} on ${g.awayRest?.restDays ?? 7}d`,
    },
  ];
  const projectedMargin = round2(strengthMargin + adjustments.reduce((s, a) => s + a.points, 0));
  const homeWinProbability = winProbabilityFromMargin(projectedMargin, g.league);
  return {
    projectedMargin,
    homeWinProbability,
    homeAdvantage: hfa,
    strengthMargin: round2(strengthMargin),
    signals,
    adjustments,
    shadow: shadowSignals(g, projectedMargin),
    availability: { home: homeAvail, away: awayAvail },
  };
}

/**
 * @description The three competing estimates of team strength, each expressed as points of home
 * margin so they can be averaged on one scale.
 * @param g - Game inputs.
 * @param hfa - Home advantage in points, already zeroed for neutral sites.
 * @returns One signal per strength model.
 */
function strengthSignals(g: GameInputs, hfa: number): ModelSignal[] {
  const c = LEAGUE_CONSTANTS[g.league];
  const homeEloRow = g.elo[g.homeTeam];
  const awayEloRow = g.elo[g.awayTeam];
  const homeElo = homeEloRow?.elo ?? 1500;
  const awayElo = awayEloRow?.elo ?? 1500;
  const eloMargin = eloToMargin(homeElo - awayElo + (hfa ? c.homeAdvantageElo : 0), g.league);
  const homePower = g.power[g.homeTeam];
  const awayPower = g.power[g.awayTeam];
  const homeUnits = g.units[g.homeTeam];
  const awayUnits = g.units[g.awayTeam];
  const match = matchupEdge(homeUnits, awayUnits);
  // A rating exists for a team only if it was seeded or it played; a POWER or UNIT rating needs
  // games, because both are averages. Absent either side, the model has nothing to say.
  const eloReady = Boolean(homeEloRow && awayEloRow);
  const powerReady = Boolean(homePower?.games && awayPower?.games);
  const unitsReady = Boolean(homeUnits?.games && awayUnits?.games);
  return [
    {
      model: 'elo',
      points: round2(eloMargin),
      available: eloReady,
      basis: eloReady
        ? `Elo ${Math.round(homeElo)} vs ${Math.round(awayElo)}${hfa ? ` +${c.homeAdvantageElo} home` : ' (neutral)'}`
        : 'no rating for one of these teams yet — abstaining',
    },
    {
      model: 'power',
      points: round2((homePower?.rating ?? 0) - (awayPower?.rating ?? 0) + hfa),
      available: powerReady,
      basis: powerReady
        ? `power ${(homePower as PowerRating).rating.toFixed(1)} vs ${(awayPower as PowerRating).rating.toFixed(1)}, schedule-adjusted`
        : 'no games played this season yet — abstaining rather than calling these teams even',
    },
    {
      model: 'units',
      points: round2(match.netHomeMargin + hfa),
      available: unitsReady,
      basis: unitsReady
        ? `${g.homeTeam} off ${signed(match.home.offenseVsDefense)} / def ${signed(match.home.defenseVsOffense)} vs ${g.awayTeam}`
        : 'no games played this season yet — abstaining rather than calling these teams even',
    },
  ];
}

/**
 * @description Models that are computed and recorded on every game but never affect the line. They
 * exist so their record accrues in the open; promoting one is an operator decision backed by
 * graded rows.
 * @param g - Game inputs.
 * @param ourMargin - The margin our voting ensemble produced.
 * @returns One signal per shadow model, omitting any whose inputs are unavailable.
 */
function shadowSignals(g: GameInputs, ourMargin: number): ModelSignal[] {
  const out: ModelSignal[] = [];
  if (Number.isFinite(g.marketHomeSpread as number)) {
    // A book's spread is quoted from the home side: -3.5 means home is favoured by 3.5, so the
    // market's projected home margin is the NEGATIVE of the quoted number.
    const marketMargin = -(g.marketHomeSpread as number);
    out.push({
      model: 'market-blend',
      points: round2((ourMargin + marketMargin) / 2),
      available: true,
      basis: `half our ${signed(ourMargin)} and the market's ${signed(marketMargin)}`,
    });
    out.push({ model: 'market-only', points: round2(marketMargin), available: true, basis: 'the closing-line baseline we have to beat' });
  }
  if (Number.isFinite(g.espnHomeWinPct as number)) {
    out.push({
      model: 'espn-predictor',
      points: NaN,
      available: true,
      basis: `ESPN projects ${(g.espnHomeWinPct as number).toFixed(1)}% for ${g.homeTeam} — a free number this package must beat`,
    });
  }
  return out;
}

/** Renders the availability adjustment's reason, naming the players that drive it. */
function availabilityBasis(home: AvailabilityImpact, away: AvailabilityImpact): string {
  const name = (i: AvailabilityImpact): string =>
    (i.keyLosses.length ? i.keyLosses.slice(0, 2).map((l) => `${l.player} (${l.position}, ${l.status})`).join(', ') : 'clean report');
  return `home: ${name(home)}; away: ${name(away)}`;
}

/** Formats a point value with an explicit sign, the way a line is written. */
function signed(n: number): string { return `${n > 0 ? '+' : ''}${n.toFixed(1)}`; }

/** Rounds to two decimals so stored and displayed points agree exactly. */
function round2(n: number): number { return Math.round(n * 100) / 100; }

/** The market's quoted prices for a game, as a book publishes them. */
export interface MarketQuote {
  /** Home moneyline in American odds. */
  homeMoneyline?: number;
  /** Away moneyline in American odds. */
  awayMoneyline?: number;
  /** Home-side spread, e.g. -3.5. */
  homeSpread?: number;
  /** Price on the home side of the spread; books default to -110. */
  homeSpreadOdds?: number;
  /** Price on the away side of the spread; books default to -110. */
  awaySpreadOdds?: number;
  /** The over/under. Captured and stored, but NOT yet modelled — this package projects a margin,
   *  not a total, so quoting a totals edge would be a number with nothing behind it. */
  total?: number;
  /** Which book the quote came from. */
  book?: string;
}

/** One actionable disagreement between our line and the market's price. */
export interface EdgeCandidate {
  /** 'moneyline' for straight up, 'spread' for against the line. */
  market: 'moneyline' | 'spread';
  /** Which side the edge is on. */
  side: 'home' | 'away';
  /** Human-readable selection, e.g. 'SEA -3.5' or 'NE moneyline'. */
  selection: string;
  /** Our probability this bet wins. */
  modelProbability: number;
  /** The market's de-vigged probability for the same bet. */
  marketProbability: number;
  /** Model minus market, in probability points. */
  edge: number;
  /** The American odds available. */
  price: number;
  /** Expected profit per unit staked at that price. */
  expectedValue: number;
  /** Quarter-Kelly stake as a bankroll fraction, before the scorecard gate. */
  kelly: number;
}

/**
 * @description Compare our line to the market's prices and return every disagreement worth a bet,
 * for both the straight-up and against-the-spread markets. Only positive-expectation candidates
 * survive, and both sides of each market are tested so a model that likes the underdog is not
 * silently ignored.
 *
 * The stake returned here is arithmetic, NOT permission. The scorecard gate decides whether a
 * strategy has earned the right to stake anything at all; until it has, these numbers are a record
 * of what we would have done.
 * @param line - Our line for the game.
 * @param quote - The book's prices.
 * @param league - League whose margin dispersion applies.
 * @param minEdge - Minimum probability-point disagreement worth reporting.
 * @returns Candidates sorted by edge, largest first.
 */
export function evaluateEdges(
  line: EnsembleLine, quote: MarketQuote, league: League, minEdge = 0.02,
): EdgeCandidate[] {
  const out: EdgeCandidate[] = [];
  const homeP = line.homeWinProbability;
  if (Number.isFinite(quote.homeMoneyline as number) && Number.isFinite(quote.awayMoneyline as number)) {
    const fair = devigTwoWay(quote.homeMoneyline as number, quote.awayMoneyline as number);
    push(out, 'moneyline', 'home', 'moneyline', homeP, fair.home, quote.homeMoneyline as number, minEdge);
    push(out, 'moneyline', 'away', 'moneyline', 1 - homeP, fair.away, quote.awayMoneyline as number, minEdge);
  }
  if (Number.isFinite(quote.homeSpread as number)) {
    const spread = quote.homeSpread as number;
    const homeOdds = quote.homeSpreadOdds ?? -110;
    const awayOdds = quote.awaySpreadOdds ?? -110;
    const fair = devigTwoWay(homeOdds, awayOdds);
    const coverP = coverProbability(line.projectedMargin, spread, league);
    push(out, 'spread', 'home', fmtSpread(spread), coverP, fair.home, homeOdds, minEdge);
    push(out, 'spread', 'away', fmtSpread(-spread), 1 - coverP, fair.away, awayOdds, minEdge);
  }
  return out.sort((a, b) => b.edge - a.edge);
}

/** Formats a spread the way a ticket reads it. */
function fmtSpread(n: number): string { return `${n > 0 ? '+' : ''}${n}`; }

/**
 * @description Append a candidate when the model genuinely disagrees with the de-vigged market by
 * at least `minEdge` AND the price is positive-expectation. Both conditions are required: an edge
 * that vanishes into the vig is not a bet.
 */
function push(
  out: EdgeCandidate[], market: 'moneyline' | 'spread', side: 'home' | 'away', label: string,
  modelP: number, marketP: number, price: number, minEdge: number,
): void {
  if (!Number.isFinite(modelP) || !Number.isFinite(marketP) || !Number.isFinite(price)) return;
  const edge = modelP - marketP;
  if (edge < minEdge) return;
  const ev = expectedValue(modelP, price);
  if (!(ev > 0)) return;
  out.push({
    market, side, selection: label,
    modelProbability: modelP, marketProbability: marketP,
    edge: Math.round(edge * 10000) / 10000,
    price, expectedValue: Math.round(ev * 10000) / 10000,
    kelly: Math.round(kellyFraction(modelP, price) * 10000) / 10000,
  });
}
