/**
 * Kalshi grading: reality scores the predictions.
 *
 * Every hand the scan shows is recorded in kalshi_predictions before its market closes. This module is the other
 * half: for every recorded prediction whose market has closed it asks Kalshi's public market data for the result
 * and writes the outcome, our Brier score, the market's Brier score on the same market and the result of one
 * contract bought at the recorded ask, fees included. It needs no Kalshi account and places no order.
 *
 * The retired platform ran this as a command-line script once a day. The native kernel never had it, so the
 * Scorecard stood at "graded 0" with thousands pending (Roger, 2026-11-10: "Kalshi makes predictions but never
 * follows up on if it got them correct ... I can't find a moat if it's not scoring its calls"). Here it runs
 * inside a request: from the background-scan job on the ticks where no scan is due, and from the Scorecard tab.
 * No framework imports: the caller hands in the market reader, so a test drives it over HTTP against a stand-in.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: read what is past its close, look results up forty markets a request, write each grade as it is known, stop inside the kernel's 60-second call and say where the next run carries on. The formulas are the retired grader's, unchanged, so the Scorecard and Trends read the ledger as they always have.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | One write per result, not one per prediction. Live on 2026-11-11 a statement on a ledger of 4,800 rows took about 0.4 seconds on the native kernel (it reads the person's whole table), so the first scheduled run graded 100 of 4,544 predictions in its 35 seconds and the Scorecard's walk would have stopped at its call limit with most of them unasked. A lookup's markets that settled YES are graded by one statement and those that settled NO by another, with the scores and the paper result computed in the statement from the row's own columns (the same formulas, in exact decimals), so a lookup of forty markets costs two writes however many predictions it carries.
 */

/** The one pool method this module uses, so a test can hand in a real pool or the kernel's. */
export interface GradePool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
}

/** Kalshi's public market reader: path and query under the API base, parsed JSON back. */
export type MarketReader = (path: string) => Promise<unknown>;

/** A recorded prediction whose market has closed and which has no grade yet. */
export interface DuePrediction {
  id: string;
  ticker: string;
  side: string;
  /** Our probability that our side wins, as recorded. */
  predictedProb: number;
  /** The ask of our side when recorded: the market's probability that our side wins. */
  marketProb: number;
}

/** What settlement gives one prediction. */
export interface Grade {
  settledYes: boolean;
  brier: number;
  marketBrier: number;
  pnlPerContract: number;
}

/** What one grading run did. */
export interface GradeRun {
  /** Predictions past their close with no grade when the run began. */
  due: number;
  /** Distinct markets those predictions are on. */
  markets: number;
  /** Markets this run asked Kalshi about. */
  checked: number;
  /** Predictions this run graded. */
  graded: number;
  /** Predictions on markets this run asked about that Kalshi has not posted a result for. */
  waiting: number;
  /** Lookups that failed; their markets are tried again by the next run. */
  failedLookups: number;
  /** The last market asked about, in ticker order: the next run's `after`. */
  lastTicker: string | null;
  /** Whether every market that was due has been asked about (by this run, or by the walk this run finished). */
  done: boolean;
  /** Set when Kalshi could not be reached at all. */
  error?: string;
}

/** Where the ledger stands. */
export interface GradingSummary {
  /** Past their close, no grade yet. */
  due: number;
  /** Their market has not closed. */
  open: number;
  /** Graded. */
  graded: number;
  lastGradedAt: string | null;
}

/** Markets per lookup. Kalshi answers a comma-separated `tickers` list; forty long tickers stay well inside a URL. */
export const GRADE_LOOKUP_SIZE = 40;
/**
 * How long one run may keep starting lookups. The kernel ends a package call at 60 seconds; a lookup in flight
 * may take ten more and its grades are written after it.
 */
export const GRADE_BUDGET_MS = 35_000;
/** The Scorecard walks the list in short calls, so the person sees the count move every few seconds. */
export const GRADE_WALK_BUDGET_MS = 8_000;
/** Kalshi's standard quadratic fee rate. */
const QUADRATIC_RATE = 0.07;
/** The golden-ratio step: successive unattended runs start at well-spread places in the list. */
const GOLDEN_STEP = 0.6180339887498949;
/** The background job fires every fifteen minutes; each firing is one step along the list. */
const TICK_MS = 15 * 60 * 1000;

/**
 * @description Kalshi's taker fee per contract on a ten-contract clip, rounded up to the cent as Kalshi does.
 * The retired grader's fee, so the ledger keeps one meaning.
 * @param price - The ask paid, dollars.
 * @returns The fee per contract, dollars.
 */
export function feePerContract(price: number): number {
  return Math.ceil(QUADRATIC_RATE * 10 * price * (1 - price) * 100 - 1e-9) / 100 / 10;
}

/**
 * @description Grade one prediction against its market's result.
 * @param row - The prediction as recorded.
 * @param settledYes - Whether the market settled YES.
 * @returns The outcome, our Brier score, the market's on the same market, and the result of one contract of our
 * side bought at the recorded ask: a win pays $1 less the price and fee, a loss costs the price and fee.
 */
export function gradeOf(row: Pick<DuePrediction, 'side' | 'predictedProb' | 'marketProb'>, settledYes: boolean): Grade {
  const sideWon = row.side === 'yes' ? settledYes : !settledYes;
  const outcome = sideWon ? 1 : 0;
  const fee = feePerContract(row.marketProb);
  return {
    settledYes,
    brier: (row.predictedProb - outcome) ** 2,
    marketBrier: (row.marketProb - outcome) ** 2,
    pnlPerContract: sideWon ? 1 - row.marketProb - fee : -(row.marketProb + fee),
  };
}

/**
 * @description Every recorded prediction whose market has closed and which has no grade.
 * @param pool - The caller's ledger.
 * @returns The rows, in no particular order.
 */
export async function readDue(pool: GradePool): Promise<DuePrediction[]> {
  const { rows } = await pool.query(
    `SELECT id, ticker, side, predicted_prob::float AS predicted_prob, market_prob::float AS market_prob
       FROM kalshi_predictions
      WHERE settled = false AND close_time < now()`,
  );
  return rows.map((r) => ({
    id: String(r.id), ticker: String(r.ticker), side: String(r.side),
    predictedProb: Number(r.predicted_prob), marketProb: Number(r.market_prob),
  }));
}

/**
 * @description The results Kalshi has posted for a set of markets.
 * @param reader - Kalshi's public market reader.
 * @param tickers - Up to GRADE_LOOKUP_SIZE market tickers.
 * @returns Ticker to settled-YES for every market with a yes or no result; a market with no result yet, or one
 * Kalshi does not return, is absent.
 */
export async function settlementsOf(reader: MarketReader, tickers: string[]): Promise<Map<string, boolean>> {
  const body = await reader(`/markets?limit=1000&tickers=${encodeURIComponent(tickers.join(','))}`) as { markets?: Array<{ ticker?: unknown; result?: unknown }> };
  const out = new Map<string, boolean>();
  for (const m of Array.isArray(body?.markets) ? body.markets : []) {
    if (m.result === 'yes') out.set(String(m.ticker), true);
    else if (m.result === 'no') out.set(String(m.ticker), false);
  }
  return out;
}

/**
 * @description Where an unattended run starts in a list of `count` markets. Each firing of the background job
 * starts a golden-ratio step further along, so markets that never get a result cannot keep the same run from
 * ever reaching the ones behind them.
 * @param count - Markets due.
 * @param nowMs - The time now.
 * @returns An index into the list.
 */
export function rotatingStart(count: number, nowMs: number): number {
  if (count <= 0) return 0;
  const step = Math.floor(nowMs / TICK_MS);
  return Math.floor(((step * GOLDEN_STEP) % 1) * count);
}

/**
 * @description The one statement that grades every ungraded prediction on a set of markets that settled the same way.
 * The scores and the paper result come from the row's own columns: our side won when (side = 'yes') equals the result;
 * Brier is the squared miss of our probability and of the market's; one contract at the recorded ask wins $1 less the
 * price and the fee, or loses the price and the fee; the fee is Kalshi's on a ten-contract clip, rounded up to the cent.
 * @param tickers - How many markets the statement names ($2 onwards; $1 is the result).
 * @returns The statement.
 */
export function gradeStatement(tickers: number): string {
  const won = "(CASE WHEN (side = 'yes') = $1 THEN 1 ELSE 0 END)";
  // Divided by 1000.0, not 1000: the native kernel's interpreter divides two whole numbers as whole numbers, and the
  // fee came out as 0 (crates/oshald/tests/kalshi_grading_sql.rs in the kernel repository proves this statement there).
  const fee = '(ceil(70.0 * market_prob * (1.0 - market_prob) - 0.000000001) / 1000.0)';
  const marks = Array.from({ length: tickers }, (_, i) => '$' + String(i + 2)).join(', ');
  return [
    'UPDATE kalshi_predictions',
    '   SET settled = true, settled_yes = $1,',
    '       brier = (predicted_prob - ' + won + ') * (predicted_prob - ' + won + '),',
    '       market_brier = (market_prob - ' + won + ') * (market_prob - ' + won + '),',
    "       pnl_per_contract = CASE WHEN (side = 'yes') = $1 THEN 1 - market_prob - " + fee + ' ELSE -(market_prob + ' + fee + ') END,',
    '       graded_at = now()',
    ' WHERE settled = false AND close_time < now() AND ticker IN (' + marks + ')',
  ].join('\n');
}

/** Grade every ungraded prediction on these markets, which all settled the same way; answers how many rows it wrote. */
async function writeGrades(pool: GradePool, settledYes: boolean, tickers: string[], expected: number): Promise<number> {
  if (!tickers.length) return 0;
  const done = await pool.query(gradeStatement(tickers.length), [settledYes, ...tickers]);
  return typeof done.rowCount === 'number' ? done.rowCount : expected;
}

/**
 * @description Grade what is past its close. Asks Kalshi about the markets forty at a time, writes a lookup's grades
 * as soon as its results are known (two statements a lookup), and stops starting lookups once the budget is spent,
 * so a long list is finished by the runs that follow.
 * @param pool - The caller's ledger.
 * @param reader - Kalshi's public market reader.
 * @param options - `after`: carry on after this ticker and stop at the end of the list (the Scorecard's walk);
 * without it the run starts at a rotating place and wraps (the background job). A walk's call is short, the
 * background job's long. `budgetMs` and `nowMs` are for tests.
 * @returns What the run did and where the next carries on.
 */
export async function gradeDue(
  pool: GradePool,
  reader: MarketReader,
  options: { after?: string; budgetMs?: number; nowMs?: () => number } = {},
): Promise<GradeRun> {
  const now = options.nowMs ?? Date.now;
  const startedAt = now();
  const walking = typeof options.after === 'string';
  const budgetMs = options.budgetMs ?? (walking ? GRADE_WALK_BUDGET_MS : GRADE_BUDGET_MS);
  const due = await readDue(pool);
  const byTicker = new Map<string, DuePrediction[]>();
  for (const row of due) byTicker.set(row.ticker, [...(byTicker.get(row.ticker) ?? []), row]);
  const tickers = [...byTicker.keys()].sort();
  const first = walking ? tickers.findIndex((t) => t > (options.after as string)) : rotatingStart(tickers.length, startedAt);
  const order = first < 0 ? [] : walking ? tickers.slice(first) : [...tickers.slice(first), ...tickers.slice(0, first)];
  const run: GradeRun = { due: due.length, markets: tickers.length, checked: 0, graded: 0, waiting: 0, failedLookups: 0, lastTicker: options.after ?? null, done: false };
  for (let at = 0; at < order.length; at += GRADE_LOOKUP_SIZE) {
    if (now() - startedAt >= budgetMs) return run;
    const batch = order.slice(at, at + GRADE_LOOKUP_SIZE);
    let results: Map<string, boolean>;
    try { results = await settlementsOf(reader, batch); }
    catch (err) {
      run.failedLookups += 1;
      if (run.checked === 0 && run.failedLookups === 1) { run.error = (err as Error).message; return run; }
      continue;
    }
    for (const settledYes of [true, false]) {
      const settled = batch.filter((ticker) => results.get(ticker) === settledYes);
      const rows = settled.reduce((sum, ticker) => sum + (byTicker.get(ticker)?.length ?? 0), 0);
      run.graded += await writeGrades(pool, settledYes, settled, rows);
    }
    for (const ticker of batch) if (!results.has(ticker)) run.waiting += byTicker.get(ticker)?.length ?? 0;
    run.checked += batch.length;
    run.lastTicker = batch[batch.length - 1];
  }
  run.done = run.failedLookups === 0;
  return run;
}

/**
 * @description Where the ledger stands: how many predictions are past their close and ungraded, how many are on
 * markets still open, how many are graded and when the last grade was written.
 * @param pool - The caller's ledger.
 * @returns The four facts the Scorecard states.
 */
export async function gradingSummary(pool: GradePool): Promise<GradingSummary> {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE NOT settled AND close_time < now())::int AS due,
            count(*) FILTER (WHERE NOT settled AND (close_time IS NULL OR close_time >= now()))::int AS open,
            count(*) FILTER (WHERE settled)::int AS graded,
            max(graded_at) AS last_graded_at
       FROM kalshi_predictions`,
  );
  const r = rows[0] ?? {};
  return {
    due: Number(r.due) || 0, open: Number(r.open) || 0, graded: Number(r.graded) || 0,
    lastGradedAt: r.last_graded_at ? new Date(r.last_graded_at as string).toISOString() : null,
  };
}
