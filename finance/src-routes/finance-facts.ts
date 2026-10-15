/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | The finance-analyst's specialist-context facts (ADR-090). Asked "how is my finance doing?" in Jarvis, the analyst had no data channel and answered "No data provided ... please provide the aggregate data". The reader gives it the caller's saved finance state as closed scalar facts: how many institutions are linked, whether and how long ago accounts were synced, sandbox or real data, net worth with assets and liabilities, account and holding counts, holdings value, the latest month's spend and income, and whether a brief is saved. Money figures are withheld when the snapshot mixes currencies. The reader never throws: a failed read returns every fact null with facts.complete false.
 * -----------------------------------------------------------------------------
 *
 * Self-contained on purpose (no framework runtime import), so the fact rules are tested with plain
 * node against the compiled module: tests/finance-facts.test.cjs.
 *
 * @module finance-facts
 */
import type { AppContext } from '@/app/composition/app-context';

/** The declared read the facts run under (oshal-app.yaml `tools:`); the kernel pins reader to tool. */
export const FINANCE_FACTS_TOOL = 'finance_facts';
/** The kernel gives a reader 1800 ms; each query gets less so the reader can still answer. */
export const FINANCE_FACTS_QUERY_MS = 1200;

/** The closed fact set. The kernel requires a read to return exactly these keys. */
export const FINANCE_FACT_KEYS: readonly string[] = Object.freeze([
  'facts.complete', 'linked_institutions', 'synced', 'synced_hours_ago', 'sandbox_data',
  'single_currency', 'currency_is_usd', 'net_worth', 'assets', 'liabilities', 'accounts',
  'holdings', 'holdings_value', 'latest_month_spend', 'latest_month_income', 'brief_saved',
]);

/** One scalar fact: the only value kinds the specialist channel admits. */
export type FinanceFact = number | boolean | null;
/** The facts, keyed by FINANCE_FACT_KEYS. */
export type FinanceFacts = Record<string, FinanceFact>;
/** The saved oshal_finance_data row the facts are read from. */
export interface SavedFinanceRow { aggregate?: unknown; synced_at?: unknown; has_brief?: unknown }

type Aggregate = {
  currency?: unknown; sourceEnvironment?: unknown; netWorth?: { assets?: unknown; liabilities?: unknown; net?: unknown };
  accounts?: Array<{ currency?: unknown }>; holdings?: Array<{ value?: unknown }>;
  spendByMonth?: Array<{ month?: unknown; spend?: unknown; income?: unknown }>;
};

/** A finite amount the channel accepts, rounded to cents; anything else is unknown. */
function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e15
    ? Math.round(value * 100) / 100 : null;
}

/**
 * @description Every key unknown, the shape returned when the read could not finish.
 * @returns A fact set with every value null and facts.complete false.
 */
export function unknownFinanceFacts(): FinanceFacts {
  const facts: FinanceFacts = {};
  for (const key of FINANCE_FACT_KEYS) facts[key] = null;
  facts['facts.complete'] = false;
  return facts;
}

/** Whether the snapshot states one currency, so its amounts can be read as one figure. */
function oneCurrency(agg: Aggregate): boolean {
  const currency = typeof agg.currency === 'string' && /^[A-Z]{3}$/.test(agg.currency) ? agg.currency : null;
  const accounts = Array.isArray(agg.accounts) ? agg.accounts : [];
  const seen = new Set(accounts.map((account) => account?.currency).filter(Boolean));
  return Boolean(currency) && seen.size <= 1 && (!seen.size || seen.has(currency));
}

/** The money figures of a one-currency snapshot; a mixed one reports none of them. */
function moneyFacts(agg: Aggregate, single: boolean): FinanceFacts {
  const holdings = Array.isArray(agg.holdings) ? agg.holdings : [];
  const months = (Array.isArray(agg.spendByMonth) ? agg.spendByMonth : [])
    .filter((m) => typeof m?.month === 'string').sort((a, b) => String(b.month).localeCompare(String(a.month)));
  const values = holdings.map((h) => amount(h?.value));
  const held = values.every((v) => v !== null) ? amount(values.reduce((sum: number, v) => sum + (v as number), 0)) : null;
  return {
    net_worth: single ? amount(agg.netWorth?.net) : null,
    assets: single ? amount(agg.netWorth?.assets) : null,
    liabilities: single ? amount(agg.netWorth?.liabilities) : null,
    holdings_value: single ? held : null,
    latest_month_spend: single && months[0] ? amount(months[0].spend) : null,
    latest_month_income: single && months[0] ? amount(months[0].income) : null,
  };
}

/**
 * @description The facts for one person from their linked-institution count and saved row.
 * @param linked - How many institutions the person has linked.
 * @param row - Their saved aggregate row, or null when they never synced.
 * @param now - The time the sync age is measured against.
 * @returns Exactly FINANCE_FACT_KEYS, complete.
 */
export function financeFacts(linked: number, row: SavedFinanceRow | null, now: Date): FinanceFacts {
  const facts = unknownFinanceFacts();
  facts['facts.complete'] = true;
  facts.linked_institutions = Number.isInteger(linked) && linked >= 0 ? linked : null;
  facts.brief_saved = Boolean(row?.has_brief);
  const agg = row?.aggregate && typeof row.aggregate === 'object' ? (row.aggregate as Aggregate) : null;
  facts.synced = Boolean(agg);
  if (!agg) return facts;
  const syncedAt = new Date(String(row?.synced_at ?? '')).getTime();
  facts.synced_hours_ago = Number.isFinite(syncedAt)
    ? Math.max(0, Math.round((now.getTime() - syncedAt) / 360000) / 10) : null;
  const environment = agg.sourceEnvironment;
  facts.sandbox_data = environment === 'sandbox' ? true
    : environment === 'development' || environment === 'production' ? false : null;
  const single = oneCurrency(agg);
  facts.single_currency = single;
  facts.currency_is_usd = typeof agg.currency === 'string' ? agg.currency === 'USD' : null;
  facts.accounts = Array.isArray(agg.accounts) ? agg.accounts.length : null;
  facts.holdings = Array.isArray(agg.holdings) ? agg.holdings.length : null;
  return { ...facts, ...moneyFacts(agg, single) };
}

/** The read input the kernel hands a reader: the verified principal and its deadline signal. */
export interface FinanceFactsInput { sub: string; signal?: AbortSignal }

/**
 * @description Read the caller's saved finance state as specialist facts. Owner-scoped by the
 * principal's sub; reads only the two saved stores, never Plaid, so it fits the kernel deadline.
 * @param pool - The package pool (read-only use).
 * @param input - The verified principal and the kernel's abort signal.
 * @param onError - Called with the error when the read fails (the route logs it).
 * @param now - Clock for the sync age.
 * @returns The facts; on any failure every fact null and facts.complete false.
 */
export async function readFinanceFacts(
  pool: Pick<AppContext['pool'], 'query'>, input: FinanceFactsInput,
  onError: (err: unknown) => void = () => undefined, now: () => Date = () => new Date(),
): Promise<FinanceFacts> {
  const read = (text: string) => pool.query({ text, values: [String(input.sub)], query_timeout: FINANCE_FACTS_QUERY_MS } as any);
  try {
    const [items, saved] = await Promise.all([
      read('SELECT count(*)::int AS count FROM oshal_finance_items WHERE user_sub = $1'),
      read('SELECT aggregate, synced_at, (brief IS NOT NULL) AS has_brief FROM oshal_finance_data WHERE user_sub = $1'),
    ]);
    if (input.signal?.aborted) return unknownFinanceFacts();
    return financeFacts(Number(items.rows[0]?.count ?? 0), saved.rows[0] ?? null, now());
  } catch (err) {
    onError(err);
    return unknownFinanceFacts();
  }
}
