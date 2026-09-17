/**
 * Kalshi trends — the time series behind the Trends tab, read from the prediction ledger.
 *
 * Operator, 2026-09-05: "keep track of Kalshi like we do stocks — charts, trend analysis,
 * projections, paper and real, manual and auto". The ledger (kalshi_predictions) is already a
 * complete paper book: every strategy's every pick, one contract each, graded at settlement. This
 * module folds it into what a trader watches — a PAPER BANKROLL curve per strategy (the ledger's
 * own quarter-Kelly stake_fraction replayed as paper fills, so the number answers "what would a
 * bankroll have done" instead of summing one-contract P&Ls), a cumulative P&L curve per strategy, a rolling hit
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
 * 2026-09-16 00:00:00 | maintainer@emeraldcoastsystemsgroup.com     | The Paper · auto book is a BANKROLL, not a one-contract sum: every graded row is replayed as a paper fill of the Kelly fraction the ledger already recorded (stake_fraction), returning pnl_per_contract over what the contract actually cost (ask + taker fee). Per-strategy bankroll on every daily point, a book-wide bankroll across strategies in grading order, and the start is deployment config (KALSHI_PAPER_BANKROLL_START). A zero-stake forward test leaves its bankroll flat, and `sized` says how many rows moved money — a sized curve reads as money, so it is labelled paper on the tile, the curve and the note.
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
  /** The quarter-Kelly fraction recorded WITH the prediction. 0 for a zero-stake forward test. */
  stakeFraction?: number;
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
  /** The PAPER bankroll after this day's fills — sized by the ledger's own stake_fraction. */
  bankroll: number;
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
  /** PAPER money. Where the sized book started, where it ended, and the return between them. */
  bankrollStart: number;
  bankroll: number;
  bankrollReturn: number | null;
  /** Graded rows that actually staked something. 0 means the curve is flat BY DESIGN, not broken. */
  sizedGraded: number;
  days: DailyPoint[];
}

/** The four books, each with a status the strip can print without lying. */
export interface Books {
  paperAuto: {
    strategies: number; predictions: number; graded: number; pnl: number; note: string;
    /** PAPER money: the sized book replayed across every strategy in grading order. */
    bankrollStart: number; bankroll: number; bankrollReturn: number | null; sized: number;
  };
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
 * The PAPER book's starting bankroll, dollars. A deployment overrides it with
 * KALSHI_PAPER_BANKROLL_START. Nothing in this module places an order or touches real money.
 */
export const DEFAULT_PAPER_BANKROLL = 1000;

/**
 * @description The configured paper starting bankroll, or the default when unset/unusable.
 * @param env - Environment to read (injectable, so the guard never reaches into process.env).
 * @returns A finite positive dollar amount.
 */
export function paperBankrollStart(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.KALSHI_PAPER_BANKROLL_START);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PAPER_BANKROLL;
}

/**
 * @description Return per dollar actually at risk on one contract: realized P&L over what the
 * contract cost (the ask PLUS Kalshi's quadratic taker fee, which is what leaves the bankroll).
 * A total loss is -1; dividing by the bare ask instead would understate every loss.
 * @param price - Ask at prediction time (market_prob).
 * @param pnl - Realized dollars per contract, fees already included (pnl_per_contract).
 * @returns Return per dollar staked; 0 when the cost is not a usable positive number.
 */
export function stakeReturn(price: number, pnl: number): number {
  const cost = price + quadraticFee(price);
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  const r = pnl / cost;
  return Number.isFinite(r) ? r : 0;
}

/**
 * @description One paper fill against a bankroll: wager the ledger's own stake fraction of it and
 * earn stakeReturn on that wager. Clamped to [0, 1] of the bankroll and floored at zero, so a
 * ruinous run stops at broke instead of going negative. A ZERO-stake row (every pre-registered
 * forward test) leaves the bankroll exactly where it was — the flat line is the honest answer.
 * @param bankroll - Bankroll before the fill.
 * @param stakeFraction - Kelly fraction recorded with the prediction.
 * @param price - Ask at prediction time.
 * @param pnl - Realized dollars per contract.
 * @returns Bankroll after the fill.
 */
export function nextBankroll(bankroll: number, stakeFraction: number, price: number, pnl: number): number {
  const b = Number.isFinite(bankroll) && bankroll > 0 ? bankroll : 0;
  const f = Number.isFinite(stakeFraction) ? Math.min(1, Math.max(0, stakeFraction)) : 0;
  if (b <= 0 || f <= 0) return b;
  return Math.max(0, b + b * f * stakeReturn(price, pnl));
}

/**
 * @description Replay a chronological run of graded rows as sized paper fills.
 * @param rows - Graded rows, oldest first.
 * @param start - Starting bankroll.
 * @returns The final bankroll, the start it came from, and how many rows actually staked.
 */
export function bankrollWalk(
  rows: Array<{ price: number; pnl: number; stakeFraction?: number }>, start: number,
): { start: number; bankroll: number; sized: number } {
  const s = Number.isFinite(start) && start > 0 ? start : DEFAULT_PAPER_BANKROLL;
  let bankroll = s;
  let sized = 0;
  for (const r of rows) {
    const f = Number(r.stakeFraction) || 0;
    if (f > 0) sized += 1;
    bankroll = nextBankroll(bankroll, f, r.price, r.pnl);
  }
  return { start: s, bankroll, sized };
}

/**
 * @description Return between a start and an end bankroll.
 * @param start - Starting bankroll.
 * @param end - Ending bankroll.
 * @returns The fractional return, or null when there is no positive start to divide by.
 */
export function bankrollReturn(start: number, end: number): number | null {
  return Number.isFinite(start) && start > 0 ? (end - start) / start : null;
}

/**
 * @description Fold graded predictions (already sorted by gradedAt) into daily points with a
 * cumulative P&L and rolling hit/breakeven. Rolling values are computed per prediction over the
 * last ROLLING_WINDOW and sampled at each day's last grade, so a day with one grade still moves.
 * @param rows - One strategy's graded predictions, oldest first.
 * @param bankrollStart - Starting PAPER bankroll for the sized replay.
 * @returns Daily points, oldest first.
 */
export function dailySeries(rows: GradedRow[], bankrollStart: number = DEFAULT_PAPER_BANKROLL): DailyPoint[] {
  const out: DailyPoint[] = [];
  const window: Array<{ won: boolean; price: number }> = [];
  let cum = 0;
  let bank = Number.isFinite(bankrollStart) && bankrollStart > 0 ? bankrollStart : DEFAULT_PAPER_BANKROLL;
  for (const r of rows) {
    const day = r.gradedAt.slice(0, 10);
    cum += r.pnl;
    bank = nextBankroll(bank, Number(r.stakeFraction) || 0, r.price, r.pnl);
    window.push({ won: r.won, price: r.price });
    if (window.length > ROLLING_WINDOW) window.shift();
    const hit = window.filter((w) => w.won).length / window.length;
    const breakeven = window.reduce((s, w) => s + w.price + quadraticFee(w.price), 0) / window.length;
    const last = out[out.length - 1];
    if (last && last.day === day) {
      last.n += 1; last.wins += r.won ? 1 : 0; last.pnl += r.pnl; last.cumPnl = cum;
      last.brier = meanInto(last.brier, last.n - 1, r.brier); last.marketBrier = meanInto(last.marketBrier, last.n - 1, r.marketBrier);
      last.rollingHit = hit; last.rollingBreakeven = breakeven; last.bankroll = bank;
    } else {
      out.push({ day, n: 1, wins: r.won ? 1 : 0, pnl: r.pnl, cumPnl: cum, brier: r.brier, marketBrier: r.marketBrier,
        rollingHit: hit, rollingBreakeven: breakeven, bankroll: bank });
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
            pnl_per_contract::float AS pnl, brier::float AS brier, market_brier::float AS market_brier,
            stake_fraction::float AS stake_fraction
       FROM kalshi_predictions
      WHERE settled AND graded_at IS NOT NULL ${sinceDays ? 'AND graded_at >= now() - ($1 || \' days\')::interval' : ''}
      ORDER BY strategy, graded_at, id`,
    sinceDays ? [String(sinceDays)] : []);
  return rows.map((r) => ({
    strategy: String(r.strategy), gradedAt: new Date(r.graded_at as string).toISOString(), won: r.won === true,
    price: Number(r.price), pnl: Number(r.pnl) || 0,
    brier: r.brier === null ? null : Number(r.brier), marketBrier: r.market_brier === null ? null : Number(r.market_brier),
    stakeFraction: Number(r.stake_fraction) || 0,
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

/**
 * @description Replay the WHOLE ledger — every strategy, in grading order — as one sized paper
 * book. This is the Paper · auto book's own number, so it is deliberately NOT windowed by the
 * Trends window: a bankroll that restarted every time someone picked "last 30 days" would be a
 * different book each time it was looked at.
 * @param pool - Postgres pool.
 * @param start - Starting PAPER bankroll.
 * @returns Start, final bankroll and how many graded rows actually staked.
 */
export async function readBookBankroll(pool: QueryablePool, start: number): Promise<{ start: number; bankroll: number; sized: number }> {
  const { rows } = await pool.query(
    `SELECT market_prob::float AS price, pnl_per_contract::float AS pnl, stake_fraction::float AS stake_fraction
       FROM kalshi_predictions
      WHERE settled AND graded_at IS NOT NULL
      ORDER BY graded_at, id`);
  return bankrollWalk(rows.map((r) => ({
    price: Number(r.price), pnl: Number(r.pnl) || 0, stakeFraction: Number(r.stake_fraction) || 0,
  })), start);
}

/** @description The four books. Only the paper-auto book (the ledger) and manual orders exist. */
export async function readBooks(pool: QueryablePool, bankrollStart: number = DEFAULT_PAPER_BANKROLL): Promise<Books> {
  const { rows: led } = await pool.query(
    `SELECT count(DISTINCT strategy)::int AS strategies, count(*)::int AS predictions,
            count(*) FILTER (WHERE settled)::int AS graded, coalesce(sum(pnl_per_contract) FILTER (WHERE settled), 0)::float AS pnl
       FROM kalshi_predictions`);
  const bank = await readBookBankroll(pool, bankrollStart);
  const { rows: ord } = await pool.query(
    `SELECT env, count(*)::int AS orders, count(*) FILTER (WHERE kalshi_status = 'blocked')::int AS blocked,
            coalesce(sum(count), 0)::int AS contracts, coalesce(sum(count * limit_price_cents), 0)::float / 100 AS notional
       FROM kalshi_orders GROUP BY env`);
  const by = (env: string) => ord.find((r) => r.env === env) ?? { orders: 0, blocked: 0, contracts: 0, notional: 0 };
  const demo = by('demo'); const live = by('live'); const l = led[0] ?? { strategies: 0, predictions: 0, graded: 0, pnl: 0 };
  return {
    paperAuto: {
      strategies: Number(l.strategies), predictions: Number(l.predictions), graded: Number(l.graded), pnl: Number(l.pnl),
      bankrollStart: bank.start, bankroll: bank.bankroll, bankrollReturn: bankrollReturn(bank.start, bank.bankroll), sized: bank.sized,
      note: 'PAPER money: every strategy pick replayed at its own recorded Kelly stake against a '
        + 'paper bankroll, graded at settlement — no order is placed and none of it is real' },
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
 * @param opts - sinceDays limits the series window (null = all); nowMs for projections;
 * bankrollStart is the PAPER book's starting bankroll (deployment config).
 * @returns The payload the /trends route serves.
 */
export async function trendSeries(pool: QueryablePool, opts: { sinceDays: number | null; nowMs?: number; bankrollStart?: number }): Promise<{
  generatedAt: string; windowDays: number | null; minGraded: number; bankrollStart: number;
  strategies: StrategyTrend[]; books: Books;
}> {
  const nowMs = opts.nowMs ?? Date.now();
  const start = Number.isFinite(opts.bankrollStart) && (opts.bankrollStart as number) > 0
    ? (opts.bankrollStart as number) : DEFAULT_PAPER_BANKROLL;
  const [rows, meta, books] = await Promise.all([readGradedRows(pool, opts.sinceDays), readStrategyMeta(pool), readBooks(pool, start)]);
  const grouped = groupByStrategy(rows);
  const names = new Set<string>([...grouped.keys(), ...meta.keys()]);
  const strategies: StrategyTrend[] = [...names].sort().map((strategy) => {
    const picks = grouped.get(strategy) ?? [];
    const days = dailySeries(picks, start);
    const m = meta.get(strategy) ?? { pending: 0, graded: 0, firstAt: null };
    const pace = gradedPerDay(m.graded, m.firstAt, nowMs);
    const bankroll = days.length ? days[days.length - 1].bankroll : start;
    return {
      strategy, graded: m.graded, pending: m.pending, firstAt: m.firstAt,
      lastGradedAt: days.length ? days[days.length - 1].day : null,
      totalPnl: days.length ? days[days.length - 1].cumPnl : 0,
      gradedPerDay: pace, daysToVerdict: daysToVerdict(m.graded, pace),
      bankrollStart: start, bankroll, bankrollReturn: bankrollReturn(start, bankroll),
      sizedGraded: picks.filter((p) => (Number(p.stakeFraction) || 0) > 0).length,
      days,
    };
  });
  return {
    generatedAt: new Date(nowMs).toISOString(), windowDays: opts.sinceDays, minGraded: MIN_GRADED_FOR_VERDICT,
    bankrollStart: start, strategies, books,
  };
}
