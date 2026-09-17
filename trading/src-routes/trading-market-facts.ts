/**
 * Market context for the accountable trading bot — the index and whole-market half of the
 * specialist-context fact set.
 *
 * WHY THIS FILE EXISTS. A protected bot-node run is TOOL-LESS: the trading-analyst is handed a
 * prompt and nothing else — no tools, no workspace, no HTTP client — so it cannot call
 * GET /reports/movers, or any other route in this package, however good that route is. The
 * kernel's specialist-context channel is the ONLY data channel that reaches it, and the package
 * declared book facts on that channel and nothing else. That is why the bot could report the
 * operator's equity to the cent and, in the same answer, say it could not access index or
 * market-mover data: not a missing key (the paper key entitles the screener), not a missing
 * screener (it ships in the kernel and the surface route uses it), but a fact set that never
 * carried a market number. This file declares them.
 *
 * SCALARS ONLY, SO NO SYMBOLS. The kernel's SpecialistFact is `number | boolean | null` by
 * design — the channel deliberately carries no raw content. A named mover ("NVDA +7.2%") is a
 * string and CANNOT cross it. What crosses is the SHAPE of the session: three index moves and the
 * extremes of the whole-market screener board. The bot learns the market's direction and its
 * dispersion, never which ticker produced them, and it must not imply otherwise.
 *
 * THE DEADLINE IS THE SAME ONE. SpecialistContextRegistry gives a reader 2000 ms and THROWS on
 * expiry rather than degrading, so a slow vendor here would not blank a number — it would kill the
 * whole dispatch and leave the operator's thread silent, which is the exact failure this channel
 * exists to end. Three things keep that from happening:
 *
 *  1. NO CALL AT ALL WITHOUT A KEY. `marketDataConfigured()` is checked first, so a deployment with
 *     no market credential spends no time and reaches no network — it reads all-null immediately.
 *  2. CACHE FIRST, AND STALE BEATS NOTHING. A successful read is held for MARKET_FACTS_TTL_MS. A
 *     read that misses the budget still answers from the last good snapshot and states its real age
 *     on `market.age_seconds`, so a served-from-cache number is never passed off as live. Past
 *     MARKET_FACTS_MAX_AGE_MS a snapshot is dropped: at that age "unknown" is the honest answer and
 *     a stale one is a lie about the session.
 *  3. THE BUDGET IS A RACE, NOT A CHECK BETWEEN STEPS. Measured from the box, the vendor answers in
 *     56-85 ms warm and 1324 ms on a cold connection — a cold call alone would eat most of the
 *     registry's deadline. So the refresh races the budget, and the refresh that lost the race is
 *     NOT abandoned: it keeps running and fills the cache, so the next dispatch is served.
 *
 * NEVER FABRICATES. Every figure the vendor did not supply stays null. A zero is only ever a real
 * zero. `market.screener_available` separates "the whole-market board answered" from "it did not",
 * so an absent extreme is never read as a calm market, and `market.complete` is true only when
 * every leg landed.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the market half of the trading specialist fact set: SPY/QQQ/DIA day moves from one daily-bar batch, the whole-market screener's best gainer and worst loser, a cache-first read that races the same budget the book reader uses and answers from the last good snapshot with its real age rather than nothing, an all-null no-network path when no market key is configured, and readTradingSpecialistFacts composing the book and market halves in parallel so the declared key set is produced in one wall-clock budget.
 *
 * @module trading-market-facts
 */

import type { AppContext } from '@/app/composition/app-context';
import { barsBatchOhlcv, marketDataConfigured, screenerMovers, type OhlcvBar, type ScreenerBoard } from '@/features/trading';
import { createChildLogger } from '@/shared/logger';
import {
  readTradingBookFacts, TRADING_FACTS_BUDGET_MS, TRADING_FACT_KEYS,
  type TradingFactValue, type TradingFactsInput, type TradingFactsOptions,
} from './trading-book-facts';

const logger = createChildLogger({ module: 'trading-market-facts' });

/**
 * The index proxies, in the order their fact keys are declared. ETFs, not the indices themselves:
 * the vendor's equity feed prices these and does not carry ^GSPC, and the bot is told which proxy
 * produced each number by the key name.
 */
export const MARKET_INDEX_SYMBOLS = Object.freeze(['SPY', 'QQQ', 'DIA'] as const);

/** The fact key each index proxy fills, in the same order. */
const INDEX_KEYS = Object.freeze(['market.spy_change_pct', 'market.qqq_change_pct', 'market.dia_change_pct'] as const);

/**
 * The market half of the closed fact set. Eight keys, which with the book half's 54 leaves the
 * declaration at 62 of the registry's 64-key cap.
 */
export const MARKET_FACT_KEYS: readonly string[] = Object.freeze([
  ...INDEX_KEYS,
  'market.top_gainer_pct',
  'market.top_loser_pct',
  'market.screener_available',
  'market.age_seconds',
  'market.complete',
]);

/** The whole declaration: the book half and the market half, exactly as registered. */
export const TRADING_SPECIALIST_FACT_KEYS: readonly string[] = Object.freeze([
  ...TRADING_FACT_KEYS,
  ...MARKET_FACT_KEYS,
]);

/** How long a successful snapshot is served without going back to the vendor. */
export const MARKET_FACTS_TTL_MS = 60_000;

/** Past this age a cached snapshot is dropped — "unknown" is honest, a stale session is not. */
export const MARKET_FACTS_MAX_AGE_MS = 15 * 60_000;

/** How many rows the screener is asked for. One is all a top/bottom extreme needs after filtering. */
const SCREENER_TOP = 5;

/** Two closes are the minimum an honest day-over-day change can be computed from. */
const INDEX_BARS = 2;

/** One resolved market picture. Every figure is the vendor's or null; nothing is derived to fill a gap. */
export interface MarketSnapshot {
  /** Epoch ms the snapshot was taken — the basis for the reported age. */
  takenAt: number;
  /** Day change percent per index proxy, keyed by symbol; a proxy the vendor did not price is absent. */
  indexChangePct: Map<string, number>;
  /** The whole-market board's best gainer percent, or null. */
  topGainerPct: number | null;
  /** The whole-market board's worst loser percent, or null. */
  topLoserPct: number | null;
  /** True when the screener answered at all — separates "no extremes" from "no board". */
  screenerAvailable: boolean;
  /** True only when every leg landed: all three proxies priced and the screener answered. */
  complete: boolean;
}

/** Vendor seams. Production callers pass nothing; the guard drives the branches with these. */
export interface MarketFactsOptions extends TradingFactsOptions {
  /** Daily-bar batch reader. Defaults to the kernel's `barsBatchOhlcv`. */
  bars?: (symbols: string[]) => Promise<Map<string, OhlcvBar[]>>;
  /** Whole-market screener reader. Defaults to the kernel's `screenerMovers`. */
  movers?: (side: 'gainers' | 'losers', top: number) => Promise<ScreenerBoard | null>;
  /** Market-credential check. Defaults to the kernel's `marketDataConfigured`. */
  configured?: () => boolean;
}

/** The last good snapshot, held across dispatches so a cold vendor costs one read, not every read. */
let cached: MarketSnapshot | null = null;

/** The refresh already running, so concurrent dispatches share one vendor call instead of racing it. */
let inFlight: Promise<MarketSnapshot | null> | null = null;

/**
 * @description Drop the cached snapshot and any shared refresh. Exported for the regression guard,
 * which must be able to start each case from a cold cache; production never calls it.
 * @returns Nothing.
 */
export function resetMarketFactsCache(): void {
  cached = null;
  inFlight = null;
}

/**
 * @description Day-over-day change percent from a symbol's ascending daily bars — the same
 * computation the bounded movers board uses, so the two never disagree about the same session.
 * @param bars - The symbol's ascending daily bars.
 * @returns The percent change, or null under two bars or against a zero prior close.
 */
export function indexChangePct(bars: readonly OhlcvBar[] | undefined): number | null {
  if (!bars || bars.length < INDEX_BARS) return null;
  const last = bars[bars.length - 1], prev = bars[bars.length - 2];
  if (!prev.c) return null;
  return ((last.c - prev.c) / prev.c) * 100;
}

/**
 * @description The best percent on a screener board, ignoring rows the vendor left unpriced.
 * @param board - The board, or null when the screener did not answer.
 * @param pick - 'max' for the gainers board, 'min' for the losers board.
 * @returns The extreme percent, or null when the board is absent or carries no priced row.
 */
function extremePct(board: ScreenerBoard | null, pick: 'max' | 'min'): number | null {
  const pcts = (board?.rows ?? []).map((row) => row.changePct).filter((p): p is number => p !== null);
  if (!pcts.length) return null;
  return pick === 'max' ? Math.max(...pcts) : Math.min(...pcts);
}

/**
 * @description One full vendor read: a single daily-bar batch for the index proxies and both
 * screener boards, all three in parallel and each fail-soft on its own. A leg that fails costs its
 * own figures and marks the snapshot incomplete; it never throws and never blocks the others.
 * @param options - Vendor seams and the clock seam.
 * @returns The snapshot, or null when every leg failed outright.
 */
async function refresh(options: MarketFactsOptions): Promise<MarketSnapshot | null> {
  const now = options.now ?? Date.now;
  const bars = options.bars ?? ((symbols) => barsBatchOhlcv(symbols, '1Day', INDEX_BARS));
  const movers = options.movers ?? screenerMovers;
  const soft = <T>(p: Promise<T>, leg: string): Promise<T | null> =>
    p.catch((err) => { logger.warn({ err, leg }, 'market context leg failed — its figures read unknown'); return null; });

  const [barsBySymbol, gainers, losers] = await Promise.all([
    soft(bars([...MARKET_INDEX_SYMBOLS]), 'index-bars'),
    soft(movers('gainers', SCREENER_TOP), 'screener-gainers'),
    soft(movers('losers', SCREENER_TOP), 'screener-losers'),
  ]);

  const indexChange = new Map<string, number>();
  for (const symbol of MARKET_INDEX_SYMBOLS) {
    const pct = indexChangePct(barsBySymbol?.get(symbol));
    if (pct !== null) indexChange.set(symbol, pct);
  }
  // The screener answered if EITHER board came back: one usable board is a board, and reporting
  // "no screener" while holding real rows from it would understate what the bot was actually told.
  const screenerAvailable = gainers !== null || losers !== null;
  if (!indexChange.size && !screenerAvailable) return null;
  return {
    takenAt: now(),
    indexChangePct: indexChange,
    topGainerPct: extremePct(gainers, 'max'),
    topLoserPct: extremePct(losers, 'min'),
    screenerAvailable,
    complete: indexChange.size === MARKET_INDEX_SYMBOLS.length && screenerAvailable,
  };
}

/**
 * @description Start a refresh, or join the one already running, and keep it alive past the
 * caller's budget. A refresh that loses the race still fills the cache, which is what turns a cold
 * vendor into one unknown read instead of an unknown read every time.
 * @param options - Vendor seams and the clock seam.
 * @returns The refresh promise, shared by every caller that arrives while it runs.
 */
function startRefresh(options: MarketFactsOptions): Promise<MarketSnapshot | null> {
  if (inFlight) return inFlight;
  const run = refresh(options)
    .catch((err) => { logger.error({ err }, 'market context read failed — the bot is dispatched with no market numbers'); return null; })
    .then((snapshot) => {
      if (snapshot) cached = snapshot;
      if (inFlight === run) inFlight = null;
      return snapshot;
    });
  inFlight = run;
  return run;
}

/**
 * @description Flatten a snapshot onto the declared market keys, stating its age rather than
 * implying freshness. Every key is written on every path, so the returned record is always exactly
 * the declared set whatever the vendor did.
 * @param snapshot - The snapshot, or null when nothing is known.
 * @param ageMs - How old the snapshot is, in milliseconds.
 * @param out - The record to fill in place.
 * @returns Nothing.
 */
function emitMarket(snapshot: MarketSnapshot | null, ageMs: number, out: Record<string, TradingFactValue>): void {
  MARKET_INDEX_SYMBOLS.forEach((symbol, i) => {
    out[INDEX_KEYS[i]] = snapshot?.indexChangePct.get(symbol) ?? null;
  });
  out['market.top_gainer_pct'] = snapshot?.topGainerPct ?? null;
  out['market.top_loser_pct'] = snapshot?.topLoserPct ?? null;
  out['market.screener_available'] = snapshot ? snapshot.screenerAvailable : false;
  out['market.age_seconds'] = snapshot ? Math.max(0, Math.round(ageMs / 1000)) : null;
  out['market.complete'] = snapshot ? snapshot.complete : false;
}

/**
 * @description Read the market half of the fact set. Answers from cache when it is fresh, otherwise
 * races a refresh against the budget and falls back to the last good snapshot with its real age.
 * Makes no network call at all when no market credential is configured, and never throws.
 * @param options - Vendor seams, budget and clock seams; production callers pass nothing.
 * @returns Exactly the keys in MARKET_FACT_KEYS, scalars only.
 */
export async function readMarketFacts(options: MarketFactsOptions = {}): Promise<Record<string, TradingFactValue>> {
  const now = options.now ?? Date.now;
  const out: Record<string, TradingFactValue> = {};
  const configured = options.configured ?? marketDataConfigured;
  // Drop a snapshot too old to describe this session before anything else reads it.
  if (cached && now() - cached.takenAt > MARKET_FACTS_MAX_AGE_MS) cached = null;
  if (!configured()) {
    logger.info({}, 'market context skipped — no market-data key configured');
    emitMarket(null, 0, out);
    return out;
  }
  const fresh = cached && now() - cached.takenAt <= MARKET_FACTS_TTL_MS ? cached : null;
  if (fresh) {
    emitMarket(fresh, now() - fresh.takenAt, out);
    return out;
  }
  const budgetMs = options.budgetMs ?? TRADING_FACTS_BUDGET_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), budgetMs); });
  try {
    // The refresh is deliberately NOT awaited past this race — it keeps running and fills the cache.
    const landed = await Promise.race([startRefresh(options), budget]);
    const snapshot = landed ?? cached;
    emitMarket(snapshot, snapshot ? now() - snapshot.takenAt : 0, out);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return out;
}

/**
 * @description The whole specialist fact set for the trading bot: the book half and the market half,
 * read IN PARALLEL so declaring market numbers costs no additional wall-clock time against the
 * registry's deadline. Neither half throws, so this does not either.
 * @param ctx - The package context (pool only).
 * @param input - The verified principal and the registry's abort signal.
 * @param options - Budget, clock and vendor seams for the regression guard.
 * @returns Exactly the keys in TRADING_SPECIALIST_FACT_KEYS, scalars only.
 */
export async function readTradingSpecialistFacts(
  ctx: Pick<AppContext, 'pool'>, input: TradingFactsInput, options: MarketFactsOptions = {},
): Promise<Record<string, TradingFactValue>> {
  const [books, market] = await Promise.all([
    readTradingBookFacts(ctx, input, options),
    readMarketFacts(options),
  ]);
  return { ...books, ...market };
}
