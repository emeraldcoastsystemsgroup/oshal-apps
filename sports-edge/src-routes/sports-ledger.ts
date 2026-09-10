/**
 * The ledger — every call registered before kickoff, graded after, and the gate that decides
 * whether any of it has earned the right to stake money.
 *
 * WHY THIS EXISTS IN THIS SHAPE. Before this package was written, the live kalshi_predictions
 * ledger on the operator's box was queried: 2,507 settled predictions, our Brier 0.1814 against
 * the market's 0.1400, beating the market on 762 of 2,507 — 30%. Every series lost. That is a
 * 2,507-sample demonstration that a model which is never forced to prove itself against the price
 * will happily suggest stakes forever. So this module is the half of the loop that acts on the
 * measurement, and it is the reason Phase 1 ships with no order path at all.
 *
 * THE THREE-VERDICT GATE, borrowed from @/features/prediction-markets strategy-scorecard and made
 * strictly harder for sport:
 *
 *   UNPROVEN — fewer than MIN_GRADED settled calls.                      → stake 0
 *   FAILING  — enough evidence, and it fails EITHER bar below.           → stake 0 (auto-retired)
 *   PROVEN   — enough evidence, better Brier than the market, AND        → stake allowed
 *              positive average closing-line value.
 *
 * CLOSING-LINE VALUE IS THE FIRST BAR, NOT THE THIRD. A season is a tiny sample: an NFL model
 * making a hundred calls can finish 55-45 on pure luck and look like edge, or 45-55 on pure luck
 * and look broken. Beating the closing line is the market itself confirming a pick was mispriced,
 * and it converges in dozens of bets rather than thousands. A strategy that beats the close and
 * loses money was unlucky; one that loses to the close and makes money was lucky. This module
 * treats both as unproven, which is the only defensible reading.
 *
 * WIN-LOSS RECORD IS REPORTED LAST AND ON PURPOSE. It is the number everyone wants and the least
 * informative one available. It is shown because hiding it would be its own kind of dishonesty.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — pre-kickoff registration of the ensemble and shadow strategies, settlement grading with Brier/CLV/P&L, and the UNPROVEN/FAILING/PROVEN staking gate requiring both a better-than-market Brier and positive average closing-line value.
 *
 * @module sports-ledger
 */

import { closingLineValue, decimalOdds, devigTwoWay, winProbabilityFromMargin, type League } from './sports-odds';
import { coverProbability } from './sports-odds';
import type { GamePreview } from './sports-preview';

/** Settled calls a strategy needs before its record means anything. */
export const MIN_GRADED = Number(process.env.SPORTS_MIN_GRADED) || 30;

/** The strategy name the voting ensemble records under. */
export const ENSEMBLE_STRATEGY = 'ensemble';

/** A row about to be written to the ledger, before kickoff. */
export interface PendingPrediction {
  strategy: string;
  league: League;
  eventId: string;
  gameDate: string;
  homeTeam: string;
  awayTeam: string;
  market: 'moneyline' | 'spread';
  side: 'home' | 'away';
  selection: string;
  modelProb: number;
  marketProb: number;
  edge: number;
  priceAtPick: number | null;
  spreadAtPick: number | null;
  stakeFraction: number;
  projectedMargin: number;
  rationale: unknown;
}

/**
 * @description Turn a preview into the rows to register before kickoff — the voting ensemble's
 * candidates plus one row per shadow strategy on the same game, so the free baselines we must beat
 * accumulate a record from the first game rather than being reconstructed later.
 *
 * Shadow rows carry `stakeFraction: 0` unconditionally. They exist to be compared, never to be
 * acted on.
 * @param preview - The built preview.
 * @param stakeAllowed - Whether the ensemble's gate currently permits a stake. When false the
 * Kelly numbers are still recorded but the stake written is zero.
 * @returns Rows to upsert into the ledger.
 */
export function predictionsFrom(preview: GamePreview, stakeAllowed: boolean): PendingPrediction[] {
  const base = {
    league: preview.league, eventId: preview.eventId, gameDate: preview.date,
    homeTeam: preview.homeTeam, awayTeam: preview.awayTeam,
    projectedMargin: preview.line.projectedMargin,
  };
  const rows: PendingPrediction[] = preview.edges.map((e) => ({
    ...base,
    strategy: ENSEMBLE_STRATEGY,
    market: e.market, side: e.side, selection: e.selection,
    modelProb: e.modelProbability, marketProb: e.marketProbability, edge: e.edge,
    priceAtPick: e.price, spreadAtPick: preview.quote.homeSpread ?? null,
    stakeFraction: stakeAllowed ? e.kelly : 0,
    rationale: { signals: preview.line.signals, adjustments: preview.line.adjustments, availability: preview.line.availability },
  }));
  rows.push(...shadowRows(preview, base));
  return rows;
}

/**
 * @description One straight-up row per shadow strategy, recorded on every game whether or not the
 * ensemble found an edge. A shadow with no edge threshold is the point: it is a forecast to be
 * scored, not a bet to be placed.
 * @param preview - The built preview.
 * @param base - Shared game identity fields.
 * @returns Shadow rows, omitting any whose inputs were unavailable.
 */
function shadowRows(preview: GamePreview, base: Omit<PendingPrediction,
  'strategy' | 'market' | 'side' | 'selection' | 'modelProb' | 'marketProb' | 'edge' | 'priceAtPick' | 'spreadAtPick' | 'stakeFraction' | 'rationale'>,
): PendingPrediction[] {
  const out: PendingPrediction[] = [];
  const ml = preview.quote.homeMoneyline;
  const opp = preview.quote.awayMoneyline;
  const marketProb = Number.isFinite(ml as number) && Number.isFinite(opp as number)
    ? devigTwoWay(ml as number, opp as number).home : NaN;
  const add = (strategy: string, prob: number, note: string): void => {
    if (!Number.isFinite(prob) || !Number.isFinite(marketProb)) return;
    out.push({
      ...base, strategy, market: 'moneyline', side: 'home',
      selection: `${preview.homeTeam} moneyline`,
      modelProb: prob, marketProb, edge: prob - marketProb,
      priceAtPick: ml ?? null, spreadAtPick: preview.quote.homeSpread ?? null,
      stakeFraction: 0, rationale: { note },
    });
  };
  for (const s of preview.line.shadow) {
    // The ESPN baseline is a probability, not a margin, so it is recorded separately below. Every
    // other shadow is a projected margin and converts the same way our own line does.
    if (s.model === 'espn-predictor' || !Number.isFinite(s.points)) continue;
    add(s.model, winProbabilityFromMargin(s.points, preview.league), s.basis);
  }
  // Recorded from the preview's OWN context rather than from a marker in the shadow array. The two
  // can disagree — the line is built before the summary is necessarily complete — and a baseline
  // that silently vanishes is worse than no baseline, because it makes the comparison look done.
  const pct = preview.context.espnHomeWinPct;
  if (Number.isFinite(pct as number)) {
    add('espn-predictor', (pct as number) / 100,
      `ESPN projects ${(pct as number).toFixed(1)}% for ${preview.homeTeam} — a free number this package must beat`);
  }
  return out;
}

/** A ledger row as stored, with the fields grading needs. */
export interface GradableRow {
  id: number;
  league: League;
  market: 'moneyline' | 'spread';
  side: 'home' | 'away';
  modelProb: number;
  marketProb: number;
  priceAtPick: number | null;
  spreadAtPick: number | null;
  stakeFraction: number;
}

/** The final state of a game, plus the prices it closed at. */
export interface Settlement {
  homeScore: number;
  awayScore: number;
  /** Closing American odds on the side we took. */
  closingPrice?: number;
  /** Closing American odds on the opposite side, needed to de-vig the close. */
  closingOpposingPrice?: number;
  /** Home-side spread at close. */
  closingSpread?: number;
}

/** What grading produced for one row. */
export interface Grade {
  won: boolean;
  brier: number;
  marketBrier: number;
  clv: number | null;
  pnlUnits: number;
}

/**
 * @description Grade one settled call. The bet's outcome depends on the market: a moneyline is
 * decided by who won, a spread by whether the margin cleared the number we took — not the number
 * it closed at, because the number we took is the bet we actually made.
 *
 * A push on an integer spread is graded as a loss of zero: not won, no profit, and both Brier
 * scores computed against the outcome that did occur. That is conservative in our disfavour, which
 * is the correct direction for an unproven model.
 * @param row - The stored row.
 * @param settle - The final score and closing prices.
 * @returns Outcome, both Brier scores, closing-line value and profit per unit staked.
 */
export function gradeOne(row: GradableRow, settle: Settlement): Grade {
  const margin = settle.homeScore - settle.awayScore;
  const homeWon = margin > 0;
  let won: boolean;
  if (row.market === 'moneyline') {
    won = row.side === 'home' ? homeWon : margin < 0;
  } else {
    const spread = row.spreadAtPick ?? 0;
    const covered = margin + spread;
    won = row.side === 'home' ? covered > 0 : covered < 0;
  }
  const actual = won ? 1 : 0;
  const brier = (row.modelProb - actual) ** 2;
  const marketBrier = (row.marketProb - actual) ** 2;
  const clv = (settle.closingPrice !== undefined && settle.closingOpposingPrice !== undefined && row.priceAtPick !== null)
    ? closingLineValue(row.priceAtPick, settle.closingPrice, settle.closingOpposingPrice)
    : null;
  const dec = row.priceAtPick !== null ? decimalOdds(row.priceAtPick) : NaN;
  const pnlUnits = Number.isFinite(dec) ? (won ? dec - 1 : -1) : 0;
  return { won, brier, marketBrier, clv: Number.isFinite(clv as number) ? clv : null, pnlUnits };
}

/**
 * @description Model probability a spread bet wins, recomputed from a projected margin. Exposed so
 * a re-grade after a model change can be compared against the original without re-deriving the
 * conversion in a second place.
 * @param projectedMargin - Our projected home margin.
 * @param homeSpread - Home-side spread taken.
 * @param side - Which side was taken.
 * @param league - League whose margin dispersion applies.
 * @returns Probability the taken side covers.
 */
export function spreadProbability(
  projectedMargin: number, homeSpread: number, side: 'home' | 'away', league: League,
): number {
  const homeCover = coverProbability(projectedMargin, homeSpread, league);
  return side === 'home' ? homeCover : 1 - homeCover;
}

/** One strategy's settled record. */
export interface StrategyRollup {
  strategy: string;
  graded: number;
  wins: number;
  /** Our mean Brier over settled calls. Lower is better. */
  brier: number;
  /** The market's mean Brier over the SAME calls. This is the bar. */
  marketBrier: number;
  /** Mean closing-line value in probability points. Positive means we beat the close. */
  meanClv: number;
  /** Calls where a closing price was available, so meanClv has a denominator. */
  clvSamples: number;
  /** Total profit in units, at the prices taken. */
  pnlUnits: number;
}

/** A verdict and the reason for it, in words a person can act on. */
export interface StrategyVerdict {
  strategy: string;
  verdict: 'UNPROVEN' | 'FAILING' | 'PROVEN';
  /** Whether this strategy may size a stake at all. */
  mayStake: boolean;
  reason: string;
  rollup: StrategyRollup;
}

/**
 * @description Classify a strategy against the gate. Both bars must clear for PROVEN: a better
 * Brier than the market on the same games, and positive average closing-line value. Either one
 * alone is a story; together they are evidence.
 *
 * A strategy with settled calls but no closing prices recorded cannot clear the CLV bar and stays
 * FAILING. That is intentional — an unmeasurable strategy is not a proven one, and the fix is to
 * record closing prices, not to lower the bar.
 * @param rollup - The strategy's settled record.
 * @returns Verdict, whether it may stake, and why.
 */
export function classify(rollup: StrategyRollup): StrategyVerdict {
  const base = { strategy: rollup.strategy, rollup };
  if (rollup.graded < MIN_GRADED) {
    return {
      ...base, verdict: 'UNPROVEN', mayStake: false,
      reason: `${rollup.graded} of ${MIN_GRADED} settled calls — not enough evidence to stake anything.`,
    };
  }
  const beatsMarket = rollup.brier < rollup.marketBrier;
  const beatsClose = rollup.clvSamples > 0 && rollup.meanClv > 0;
  if (beatsMarket && beatsClose) {
    return {
      ...base, verdict: 'PROVEN', mayStake: true,
      reason: `Brier ${rollup.brier.toFixed(4)} beats the market's ${rollup.marketBrier.toFixed(4)}, and it beats the close by ${(rollup.meanClv * 100).toFixed(2)} probability points on average over ${rollup.clvSamples} calls.`,
    };
  }
  const why: string[] = [];
  if (!beatsMarket) why.push(`Brier ${rollup.brier.toFixed(4)} does not beat the market's ${rollup.marketBrier.toFixed(4)}`);
  if (!beatsClose) {
    why.push(rollup.clvSamples === 0
      ? 'no closing prices recorded, so closing-line value cannot be measured'
      : `it loses to the close by ${(Math.abs(rollup.meanClv) * 100).toFixed(2)} probability points on average`);
  }
  return { ...base, verdict: 'FAILING', mayStake: false, reason: `${why.join('; ')}. Stake stays at zero.` };
}

/**
 * @description Fold graded rows into one strategy's record. Kept pure and separate from the query
 * so the rollup arithmetic is testable without a database.
 * @param strategy - Strategy name.
 * @param rows - That strategy's settled rows.
 * @returns The rollup.
 */
export function rollup(strategy: string, rows: Array<{ won: boolean; brier: number; marketBrier: number; clv: number | null; pnlUnits: number }>): StrategyRollup {
  const graded = rows.length;
  const clvRows = rows.filter((r) => r.clv !== null && Number.isFinite(r.clv as number));
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  return {
    strategy, graded,
    wins: rows.filter((r) => r.won).length,
    brier: graded ? sum(rows.map((r) => r.brier)) / graded : 0,
    marketBrier: graded ? sum(rows.map((r) => r.marketBrier)) / graded : 0,
    meanClv: clvRows.length ? sum(clvRows.map((r) => r.clv as number)) / clvRows.length : 0,
    clvSamples: clvRows.length,
    pnlUnits: sum(rows.map((r) => r.pnlUnits)),
  };
}
