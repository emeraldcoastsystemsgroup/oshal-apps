/**
 * Finance — Plaid client + aggregate builder (the cheap, deterministic data-access half).
 *
 * ADR-036 split: this module is the raw I/O the controller caches. It talks to Plaid
 * (https://<env>.plaid.com) with the OSHAL Plaid app credentials + a per-user, per-item
 * `access_token`, and folds the raw read into a compact `FinanceAggregate`. The REASONING
 * over that aggregate (the finance brief) always runs on the accountable finance-analyst
 * bot — never here. v1 is READ-ONLY aggregation: balances, holdings, transactions. No trade
 * execution, no crypto.
 *
 * Plaid does NOT use a redirect OAuth handshake, so it is intentionally NOT a generic
 * connectors-routes provider — connections are made through Plaid Link (or, for local
 * testing, the Sandbox public_token path) and stored in finance-owned tables.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-17 23:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — Plaid request helper (env-selectable sandbox/production), link-token + public_token exchange + sandbox-item helpers, and fetchFinanceAggregate (balances + investment holdings + transactions → compact net-worth/holdings/spend aggregate). Read-only; per-product try/catch so one unready product never fails the whole sync.
 *
 * @module finance-plaid
 */

const PLAID_ENV = process.env.PLAID_ENV || 'sandbox';
const PLAID_BASE = `https://${PLAID_ENV}.plaid.com`;
/** Default Sandbox institution for the demo-connect path (First Platypus Bank). */
const SANDBOX_INSTITUTION = process.env.PLAID_SANDBOX_INSTITUTION || 'ins_109508';

/** An error from the Plaid API, carrying its machine-readable error_code. */
export interface PlaidError extends Error {
  plaidCode?: string;
  status?: number;
}

/** A single bank/brokerage account in the compact aggregate. */
export interface FinanceAccount {
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  balance: number;
  currency: string;
  institution: string;
}

/** A single investment holding in the compact aggregate. */
export interface FinanceHolding {
  name: string;
  ticker: string | null;
  type: string | null;
  quantity: number;
  value: number;
  costBasis: number | null;
  institution: string;
  accountName: string;
}

/** The compact, bot-ready view of a user's finances (read-only aggregation). */
export interface FinanceAggregate {
  generatedAt: string;
  currency: string;
  netWorth: { assets: number; liabilities: number; net: number };
  accounts: FinanceAccount[];
  holdings: FinanceHolding[];
  topSpending: Array<{ category: string; total: number; count: number }>;
  spendByMonth: Array<{ month: string; spend: number; income: number }>;
  recentTransactions: Array<{ date: string; name: string; amount: number; category: string }>;
  transactionWindowDays: number;
  notes: string[];
}

/** The OSHAL Plaid app credentials (client_id + secret) from the environment. */
function plaidCreds(): { client_id: string; secret: string } {
  return { client_id: process.env.PLAID_CLIENT_ID || '', secret: process.env.PLAID_SECRET || '' };
}

/** True when both Plaid credentials are configured (else the surface shows a setup note). */
export function plaidConfigured(): boolean {
  const c = plaidCreds();
  return Boolean(c.client_id && c.secret);
}

/** The active Plaid environment label (sandbox/development/production), for the surface. */
export function plaidEnv(): string {
  return PLAID_ENV;
}

/**
 * @description Low-level Plaid POST. Injects the app credentials, throws a `PlaidError`
 * carrying `plaidCode` on a non-2xx so callers can branch on product-not-ready, etc.
 * @param pathname - The Plaid API path (e.g. '/accounts/balance/get').
 * @param body - The request body (credentials are merged in).
 * @returns The parsed JSON response.
 */
export async function plaidRequest<T = Record<string, unknown>>(pathname: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${PLAID_BASE}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...plaidCreds(), ...body }),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const err = new Error(String(j.error_message || `plaid ${pathname} ${r.status}`)) as PlaidError;
    err.plaidCode = j.error_code ? String(j.error_code) : undefined;
    err.status = r.status;
    throw err;
  }
  return j as T;
}

/**
 * @description Create a Plaid Link token for the surface's Link widget. Scopes to the
 * caller via `client_user_id` so Link is tied to the signed-in user.
 * @param userSub - The caller's OIDC sub (Plaid client_user_id).
 * @returns The short-lived link_token the browser hands to Plaid.create({token}).
 */
export async function createLinkToken(userSub: string): Promise<string> {
  const j = await plaidRequest<{ link_token: string }>('/link/token/create', {
    user: { client_user_id: userSub },
    client_name: 'OSHAL Finance',
    products: ['transactions', 'investments'],
    country_codes: ['US'],
    language: 'en',
  });
  return j.link_token;
}

/** A linked Plaid Item (one institution login) ready to store. */
export interface ExchangedItem {
  accessToken: string;
  itemId: string;
  institution: string;
}

/**
 * @description Exchange a Link `public_token` for a long-lived `access_token` + item id,
 * and resolve the institution's display name for labeling.
 * @param publicToken - The public_token Plaid Link returned to the browser.
 * @returns The access token, item id, and a human institution label.
 */
export async function exchangePublicToken(publicToken: string): Promise<ExchangedItem> {
  const ex = await plaidRequest<{ access_token: string; item_id: string }>(
    '/item/public_token/exchange', { public_token: publicToken });
  const institution = await resolveInstitution(ex.access_token);
  return { accessToken: ex.access_token, itemId: ex.item_id, institution };
}

/**
 * @description Sandbox-only: mint a public_token for a test institution and exchange it,
 * so the whole flow is testable from localhost without the Link JS widget or real bank
 * credentials. Refuses to run outside the sandbox environment.
 * @param institutionId - The Sandbox institution id (defaults to First Platypus Bank).
 * @returns The exchanged item, ready to store for the caller.
 */
export async function createSandboxItem(institutionId?: string): Promise<ExchangedItem> {
  if (PLAID_ENV !== 'sandbox') throw new Error('sandbox item creation is only allowed when PLAID_ENV=sandbox');
  const pt = await plaidRequest<{ public_token: string }>('/sandbox/public_token/create', {
    institution_id: institutionId || SANDBOX_INSTITUTION,
    initial_products: ['transactions', 'investments'],
  });
  return exchangePublicToken(pt.public_token);
}

/** Resolve an item's institution display name; falls back to a generic label. */
async function resolveInstitution(accessToken: string): Promise<string> {
  try {
    const item = await plaidRequest<{ item: { institution_id?: string } }>('/item/get', { access_token: accessToken });
    const id = item.item?.institution_id;
    if (!id) return 'Linked institution';
    const inst = await plaidRequest<{ institution: { name?: string } }>('/institutions/get_by_id', {
      institution_id: id, country_codes: ['US'],
    });
    return inst.institution?.name || 'Linked institution';
  } catch {
    return 'Linked institution';
  }
}

/* ─── aggregate builder ─────────────────────────────────────────────────────── */

/** Plaid balances treats credit/loan balances as amounts owed → liabilities. */
const LIABILITY_TYPES = new Set(['credit', 'loan']);

/**
 * @description Pull balances + investment holdings + transactions for ONE item and fold
 * them into the running aggregate. Each product is wrapped so an unready/again-later product
 * (common right after a sandbox link) degrades to a note instead of failing the whole sync.
 * @param accessToken - The item's Plaid access token.
 * @param institution - The item's institution label.
 * @param windowDays - How many days of transactions to request.
 * @param acc - The aggregate accumulators being built up across items.
 */
async function foldItem(
  accessToken: string,
  institution: string,
  windowDays: number,
  acc: { accounts: FinanceAccount[]; holdings: FinanceHolding[]; txns: Array<{ date: string; name: string; amount: number; category: string }>; notes: string[] },
): Promise<void> {
  await foldBalances(accessToken, institution, acc);
  await foldHoldings(accessToken, institution, acc);
  await foldTransactions(accessToken, institution, windowDays, acc);
}

/** Add an item's account balances to the aggregate. */
async function foldBalances(accessToken: string, institution: string, acc: { accounts: FinanceAccount[]; notes: string[] }): Promise<void> {
  try {
    const bal = await plaidRequest<{ accounts: PlaidApiAccount[] }>('/accounts/balance/get', { access_token: accessToken });
    for (const a of bal.accounts || []) {
      acc.accounts.push({
        name: a.name || a.official_name || 'Account',
        type: a.type || 'other', subtype: a.subtype || null, mask: a.mask || null,
        balance: Number(a.balances?.current ?? a.balances?.available ?? 0),
        currency: a.balances?.iso_currency_code || 'USD', institution,
      });
    }
  } catch (err) {
    acc.notes.push(`balances unavailable for ${institution} (${(err as PlaidError).plaidCode || 'error'})`);
  }
}

/** Add an item's investment holdings to the aggregate. */
async function foldHoldings(accessToken: string, institution: string, acc: { holdings: FinanceHolding[]; notes: string[] }): Promise<void> {
  try {
    const inv = await plaidRequest<{ holdings: PlaidApiHolding[]; securities: PlaidApiSecurity[]; accounts: PlaidApiAccount[] }>(
      '/investments/holdings/get', { access_token: accessToken });
    const secById = new Map((inv.securities || []).map((s) => [s.security_id, s]));
    const acctById = new Map((inv.accounts || []).map((a) => [a.account_id, a]));
    for (const h of inv.holdings || []) {
      const sec = secById.get(h.security_id);
      const acct = acctById.get(h.account_id);
      const qty = Number(h.quantity || 0);
      acc.holdings.push({
        name: sec?.name || sec?.ticker_symbol || 'Holding', ticker: sec?.ticker_symbol || null,
        type: sec?.type || null, quantity: qty,
        value: Number(h.institution_value ?? qty * Number(sec?.close_price || 0)),
        costBasis: h.cost_basis != null ? Number(h.cost_basis) : null,
        institution, accountName: acct?.name || 'Investment',
      });
    }
  } catch (err) {
    const code = (err as PlaidError).plaidCode;
    if (code !== 'PRODUCTS_NOT_SUPPORTED' && code !== 'NO_INVESTMENT_ACCOUNTS') {
      acc.notes.push(`holdings unavailable for ${institution} (${code || 'error'})`);
    }
  }
}

/** Add an item's recent transactions to the aggregate. */
async function foldTransactions(
  accessToken: string, institution: string, windowDays: number,
  acc: { txns: Array<{ date: string; name: string; amount: number; category: string }>; notes: string[] },
): Promise<void> {
  const end = new Date();
  const start = new Date(end.getTime() - windowDays * 86_400_000);
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);
  try {
    const tx = await plaidRequest<{ transactions: PlaidApiTxn[] }>('/transactions/get', {
      access_token: accessToken, start_date: fmt(start), end_date: fmt(end), options: { count: 250, offset: 0 },
    });
    for (const t of tx.transactions || []) {
      acc.txns.push({
        date: t.date || '', name: t.merchant_name || t.name || 'Transaction',
        amount: Number(t.amount || 0),
        category: t.personal_finance_category?.primary || (t.category && t.category[0]) || 'Other',
      });
    }
  } catch (err) {
    acc.notes.push(`transactions not ready for ${institution} (${(err as PlaidError).plaidCode || 'error'}) — try syncing again shortly`);
  }
}

/**
 * @description Fetch + fold every supplied item into ONE compact aggregate (net worth,
 * accounts, holdings, spend rollups, recent transactions). Pure read-only; safe to re-run.
 * @param items - The caller's linked items ({ accessToken, institution }).
 * @param windowDays - Transaction look-back window (default 90).
 * @returns The compact FinanceAggregate handed to the surface + the reasoning bot.
 */
export async function fetchFinanceAggregate(
  items: Array<{ accessToken: string; institution: string }>,
  windowDays = 90,
): Promise<FinanceAggregate> {
  const acc = { accounts: [] as FinanceAccount[], holdings: [] as FinanceHolding[], txns: [] as Array<{ date: string; name: string; amount: number; category: string }>, notes: [] as string[] };
  for (const it of items) await foldItem(it.accessToken, it.institution, windowDays, acc);
  return assembleAggregate(acc, windowDays);
}

/** Roll the raw accumulators into the final aggregate (net worth + spend analytics). */
function assembleAggregate(
  acc: { accounts: FinanceAccount[]; holdings: FinanceHolding[]; txns: Array<{ date: string; name: string; amount: number; category: string }>; notes: string[] },
  windowDays: number,
): FinanceAggregate {
  let assets = 0, liabilities = 0;
  for (const a of acc.accounts) {
    if (LIABILITY_TYPES.has(a.type)) liabilities += Math.abs(a.balance);
    else assets += a.balance;
  }
  const currency = acc.accounts.find((a) => a.currency)?.currency || 'USD';
  const spendByCat = new Map<string, { total: number; count: number }>();
  const byMonth = new Map<string, { spend: number; income: number }>();
  for (const t of acc.txns) {
    const month = (t.date || '').slice(0, 7);
    const m = byMonth.get(month) || { spend: 0, income: 0 };
    if (t.amount > 0) { // Plaid: positive = money out
      m.spend += t.amount;
      const c = spendByCat.get(t.category) || { total: 0, count: 0 };
      c.total += t.amount; c.count += 1; spendByCat.set(t.category, c);
    } else { m.income += Math.abs(t.amount); }
    if (month) byMonth.set(month, m);
  }
  return {
    generatedAt: new Date().toISOString(), currency,
    netWorth: { assets: round(assets), liabilities: round(liabilities), net: round(assets - liabilities) },
    accounts: acc.accounts.map((a) => ({ ...a, balance: round(a.balance) })),
    holdings: acc.holdings.sort((a, b) => b.value - a.value).map((h) => ({ ...h, value: round(h.value) })),
    topSpending: [...spendByCat.entries()].map(([category, v]) => ({ category, total: round(v.total), count: v.count }))
      .sort((a, b) => b.total - a.total).slice(0, 10),
    spendByMonth: [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({ month, spend: round(v.spend), income: round(v.income) })),
    recentTransactions: acc.txns.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 25),
    transactionWindowDays: windowDays, notes: acc.notes,
  };
}

/** Round to cents. */
function round(n: number): number { return Math.round(n * 100) / 100; }

/* ─── minimal Plaid response shapes (only the fields we read) ─────────────────── */
interface PlaidApiAccount { account_id: string; name?: string; official_name?: string; type?: string; subtype?: string; mask?: string; balances?: { current?: number; available?: number; iso_currency_code?: string }; }
interface PlaidApiSecurity { security_id: string; name?: string; ticker_symbol?: string; type?: string; close_price?: number; }
interface PlaidApiHolding { account_id: string; security_id: string; quantity?: number; institution_value?: number; cost_basis?: number; }
interface PlaidApiTxn { date?: string; name?: string; merchant_name?: string; amount?: number; category?: string[]; personal_finance_category?: { primary?: string }; }
