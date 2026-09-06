/**
 * Kalshi trends — the time series behind the Trends tab, read from the prediction ledger.
 *
 * Operator, 2026-09-05: "keep track of Kalshi like we do stocks — charts, trend analysis,
 * projections, paper and real, manual and auto". The ledger (kalshi_predictions) is already a
 * complete paper book: every strategy's every pick, one contract each, graded at settlement. This
 * module folds it into what a trader watches — a cumulative P&L curve per strategy, a rolling hit
 * rate against the rolling breakeven (price + fee) so "are we beating the price" is visible as a
 * line, and a projection of when each strategy reaches the 30 graded rows the Scorecard needs —
 * plus the four books (paper/real × manual/auto) with an honest status for each, including the one
 * that is not built. Pure math is exported and pinned by tests/kalshi-trends.test.js; the only I/O
 * is SELECTs. No framework imports, so the compiled module loads under the plain-node suites.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-05 06:30:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial — per-strategy daily series (n, wins, P&L, Brier), cumulative P&L, rolling hit vs breakeven over the last 50 graded, days-to-verdict projection, and the four-book status read from kalshi_orders + the ledger.
 */

/** The minimal pg surface this module needs (a Pool or a client). */
export interface QueryablePool {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** One graded prediction as the series math consumes it. */
export interface GradedRow {
  strategy: string;
  gradedAt: string;
  won: boolean;
  price: number;
  pnl: number;
  brier: number | null;
  marketBrier: number | null;
}

/** One day of one strategy's graded results. */
export interface DailyPoint {
  day: string;
  n: number;
  wins: number;
  pnl: number;
  cumPnl: number;
  brier: number | null;
  marketBrier: number | null;
  /** Rolling hit rate over the last ROLLING_WINDOW graded predictions, as of this day's last grade. */
  rollingHit: number | null;
  /** Rolling breakeven (mean price + fee) over the same window. */
  rollingBreakeven: number | null;
}

/** Everything the Trends tab draws for one strategy. */
export interface StrategyTrend {
  strategy: string;
  graded: number;
  pending: number;
  firstAt: string | null;
  lastGradedAt: string | null;
  totalPnl: number;
  gradedPerDay: number | null;
  /** Days until MIN_GRADED settled rows at the observed pace; 0 when already there; null when no pace yet. */
  daysToVerdict: number | null;
  days: DailyPoint[];
}

/** The four books, each with a status the strip can print without lying. */
export interface Books {
  paperAuto: { strategies: number; predictions: number; graded: number; pnl: number; note: string };
  paperManual: { orders: number; contracts: number; notional: number; note: string };
  liveManual: { orders: number; blocked: number; contracts: number; notional: number; note: string };
  liveAuto: { built: false; note: string };
}

export const ROLLING_WINDOW = 50;
export const MIN_GRADED_FOR_VERDICT = 30;

/** Kalshi's quadratic taker fee per contract, dollars. */
export function quadraticFee(price: number): number {
  return 0.07 * price * (1 - price);
}

/**
 * @description Fold graded predictions (already sorted by gradedAt) into daily points with a
 * cumulative P&L and rolling hit/breakeven. Rolling values are computed per prediction over the
 * last ROLLING_WINDOW and sampled at each day's last grade, so a day with one grade still moves.
 * @param rows - One strategy's graded predictions, oldest first.
 * @returns Daily points, oldest first.
 */
export function dailySeries(rows: GradedRow[]): DailyPoint[] {
  const out: DailyPoint[] = [];
  const window: Array<{ won: boolean; price: number }> = [];
  let cum = 0;
  for (const r of rows) {
    const day = r.gradedAt.slice(0, 10);
    cum += r.pnl;
    window.push({ won: r.won, price: r.price });
    if (window.length > ROLLING_WINDOW) window.shift();
    const hit = window.filter((w) => w.won).length / window.length;
    const breakeven = window.reduce((s, w) => s + w.price + quadraticFee(w.price), 0) / window.length;
    const last = out[out.length - 1];
    if (last && last.day === day) {
      last.n += 1; last.wins += r.won ? 1 : 0; last.pnl += r.pnl; last.cumPnl = cum;
      last.brier = meanInto(last.brier, last.n - 1, r.brier); last.marketBrier = meanInto(last.marketBrier, last.n - 1, r.marketBrier);
      last.rollingHit = hit; last.rollingBreakeven = breakeven;
    } else {
      out.push({ day, n: 1, wins: r.won ? 1 : 0, pnl: r.pnl, cumPnl: cum, brier: r.brier, marketBrier: r.marketBrier,
        rollingHit: hit, rollingBreakeven: breakeven });
    }
  }
  return out;
}

/** Running mean that tolerates nulls (a null sample leaves the mean unchanged). */
function meanInto(current: number | null, count: number, sample: number | null): number | null {
  if (sample === null || !Number.isFinite(sample)) return current;
  if (current === null) return sample;
  return (current * count + sample) / (count + 1);
}

/**
 * @description Days until a strategy reaches the verdict threshold at its observed grading pace.
 * @param graded - Settled rows so far.
 * @param gradedPerDay - Observed pace (graded rows per calendar day since the first prediction).
 * @returns 0 when already at threshold, null when there is no pace to project from.
 */
export function daysToVerdict(graded: number, gradedPerDay: number | null): number | null {
  if (graded >= MIN_GRADED_FOR_VERDICT) return 0;
  if (!gradedPerDay || gradedPerDay <= 0) return null;
  return Math.ceil((MIN_GRADED_FOR_VERDICT - graded) / gradedPerDay);
}

/** Observed grading pace: settled rows per day between the first prediction and now (≥ 1 day). */
export function gradedPerDay(graded: number, firstAtIso: string | null, nowMs: number): number | null {
  if (!firstAtIso || graded <= 0) return null;
  const days = Math.max(1, (nowMs - Date.parse(firstAtIso)) / 86_400_000);
  return graded / days;
}

/** @description Group flat graded rows by strategy, preserving input order within each. */
export function groupByStrategy(rows: GradedRow[]): Map<string, GradedRow[]> {
  const m = new Map<string, GradedRow[]>();
  for (const r of rows) {
    const list = m.get(r.strategy) ?? [];
    list.push(r);
    m.set(r.strategy, list);
  }
  return m;
}

/** @description Read every graded prediction, oldest first, for the series math. */
export async function readGradedRows(pool: QueryablePool, sinceDays: number | null): Promise<GradedRow[]> {
  const { rows } = await pool.query(
    `SELECT strategy, graded_at, ((side = 'yes') = settled_yes) AS won, market_prob::float AS price,
            pnl_per_contract::float AS pnl, brier::float AS brier, market_brier::float AS market_brier
       FROM kalshi_predictions
      WHERE settled AND graded_at IS NOT NULL ${sinceDays ? 'AND graded_at >= now() - ($1 || \' days\')::interval' : ''}
      ORDER BY strategy, graded_at, id`,
    sinceDays ? [String(sinceDays)] : []);
  return rows.map((r) => ({
    strategy: String(r.strategy), gradedAt: new Date(r.graded_at as string).toISOString(), won: r.won === true,
    price: Number(r.price), pnl: Number(r.pnl) || 0,
    brier: r.brier === null ? null : Number(r.brier), marketBrier: r.market_brier === null ? null : Number(r.market_brier),
  }));
}

/** @description Per-strategy counts the series alone cannot give: pending rows and the first prediction. */
export async function readStrategyMeta(pool: QueryablePool): Promise<Map<string, { pending: number; graded: number; firstAt: string | null }>> {
  const { rows } = await pool.query(
    `SELECT strategy, count(*) FILTER (WHERE NOT settled)::int AS pending, count(*) FILTER (WHERE settled)::int AS graded,
            min(created_at) AS first_at
       FROM kalshi_predictions GROUP BY strategy`);
  return new Map(rows.map((r) => [String(r.strategy), {
    pending: Number(r.pending), graded: Number(r.graded),
    firstAt: r.first_at ? new Date(r.first_at as string).toISOString() : null,
  }]));
}

/** @description The four books. Only the paper-auto book (the ledger) and manual orders exist. */
export async function readBooks(pool: QueryablePool): Promise<Books> {
  const { rows: led } = await pool.query(
    `SELECT count(DISTINCT strategy)::int AS strategies, count(*)::int AS predictions,
            count(*) FILTER (WHERE settled)::int AS graded, coalesce(sum(pnl_per_contract) FILTER (WHERE settled), 0)::float AS pnl
       FROM kalshi_predictions`);
  const { rows: ord } = await pool.query(
    `SELECT env, count(*)::int AS orders, count(*) FILTER (WHERE kalshi_status = 'blocked')::int AS blocked,
            coalesce(sum(count), 0)::int AS contracts, coalesce(sum(count * limit_price_cents), 0)::float / 100 AS notional
       FROM kalshi_orders GROUP BY env`);
  const by = (env: string) => ord.find((r) => r.env === env) ?? { orders: 0, blocked: 0, contracts: 0, notional: 0 };
  const demo = by('demo'); const live = by('live'); const l = led[0] ?? { strategies: 0, predictions: 0, graded: 0, pnl: 0 };
  return {
    paperAuto: { strategies: Number(l.strategies), predictions: Number(l.predictions), graded: Number(l.graded), pnl: Number(l.pnl),
      note: 'every strategy pick, one contract at the ask, graded at settlement — no order is placed' },
    paperManual: { orders: Number(demo.orders), contracts: Number(demo.contracts), notional: Number(demo.notional),
      note: 'orders on the demo exchange (a demo key made default on /utilities)' },
    liveManual: { orders: Number(live.orders), blocked: Number(live.blocked), contracts: Number(live.contracts), notional: Number(live.notional),
      note: 'confirm-gated orders on the live exchange; refusals are counted, not hidden' },
    liveAuto: { built: false, note: 'not built — an autopilot needs a PROVEN strategy first, and none has beaten the market' },
  };
}

/**
 * @description Assemble the Trends payload: one trend per strategy plus the books.
 * @param pool - Postgres pool.
 * @param opts - sinceDays limits the series window (null = all); nowMs for projections.
 * @returns The payload the /trends route serves.
 */
export async function trendSeries(pool: QueryablePool, opts: { sinceDays: number | null; nowMs?: number }): Promise<{
  generatedAt: string; windowDays: number | null; minGraded: number; strategies: StrategyTrend[]; books: Books;
}> {
  const nowMs = opts.nowMs ?? Date.now();
  const [rows, meta, books] = await Promise.all([readGradedRows(pool, opts.sinceDays), readStrategyMeta(pool), readBooks(pool)]);
  const grouped = groupByStrategy(rows);
  const names = new Set<string>([...grouped.keys(), ...meta.keys()]);
  const strategies: StrategyTrend[] = [...names].sort().map((strategy) => {
    const days = dailySeries(grouped.get(strategy) ?? []);
    const m = meta.get(strategy) ?? { pending: 0, graded: 0, firstAt: null };
    const pace = gradedPerDay(m.graded, m.firstAt, nowMs);
    return {
      strategy, graded: m.graded, pending: m.pending, firstAt: m.firstAt,
      lastGradedAt: days.length ? days[days.length - 1].day : null,
      totalPnl: days.length ? days[days.length - 1].cumPnl : 0,
      gradedPerDay: pace, daysToVerdict: daysToVerdict(m.graded, pace), days,
    };
  });
  return { generatedAt: new Date(nowMs).toISOString(), windowDays: opts.sinceDays, minGraded: MIN_GRADED_FOR_VERDICT, strategies, books };
}
