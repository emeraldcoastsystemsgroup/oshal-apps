/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | A demo installation's sample household as records, not only a snapshot: seven named accounts with balances dated today and three months of dated transactions (pay every two weeks, rent, utilities, a subscription, a loan payment, groceries, fuel, meals out, savings interest, card purchases and a card payment), the newest five still to review and one of them larger than usual at its merchant, so a trial opens on a day with things to do. Every record says it is sample data. Loading it again replaces the earlier sample and touches nothing else; a real sync removes it. The employer on the paycheck is a made-up name (it named the owner's company).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 1.8.4: export sampleAggregate alongside sampleRecords so POST /demo-data shares the sample household definition here without framework imports.
 */

/**
 * No framework runtime import; the only route that calls this is POST /demo-data, behind the
 * installation's FINANCE_DEMO_DATA setting.
 *
 * @module finance-sample
 */
import type { FinanceAccount, FinanceAggregate, FinanceHolding } from './finance-plaid';
import {
  HOME_BOOK, deleteAccount, deleteImportTransactions, ensureBook, hashId, insertAccount, insertImport, insertTransactions,
  monthOf, nowStamp, readImport, saveImport, transactionId,
  type LedgerAccount, type LedgerDb, type LedgerImport, type LedgerTransaction,
} from './finance-ledger-store';

const DAY_MS = 86_400_000;
/** How far back the sample's transactions go. */
export const SAMPLE_DAYS = 89;
/** What every sample record says of itself. */
export const SAMPLE_LABEL = 'Sample data';

/** The sample accounts: key, name, institution, type, subtype, last four, balance in cents (owed for the card and the loan). */
const ACCOUNTS: ReadonlyArray<readonly [string, string, string, string, string, string, number]> = [
  ['checking', 'Everyday Checking', 'Harbor Bank', 'depository', 'checking', '4821', 482044],
  ['savings', 'Rainy-day Savings', 'Harbor Bank', 'depository', 'savings', '7730', 1840000],
  ['market', 'Money Market', 'Coastal Credit Union', 'depository', 'money market', '2214', 1250000],
  ['brokerage', 'Brokerage', 'Blue Sky Brokerage', 'investment', 'brokerage', '9043', 7718000],
  ['retirement', 'Retirement 401(k)', 'Blue Sky Brokerage', 'investment', '401k', '5512', 4670000],
  ['card', 'Travel Rewards Card', 'Harbor Bank', 'credit', 'credit card', '0082', 124032],
  ['loan', 'Auto Loan', 'Coastal Credit Union', 'loan', 'auto', '6619', 980000],
];

/** One sample line before it is dated: account key, direction, cents, description, category. */
type Line = readonly [string, 'in' | 'out', number, string, string];

/** What happens every month on a fixed day of the month. */
const MONTHLY: ReadonlyArray<readonly [number, Line]> = [
  [1, ['checking', 'out', 145000, 'Maple Court Apartments', 'Rent']],
  [1, ['savings', 'in', 412, 'Interest paid', 'Income']],
  [8, ['checking', 'out', 1399, 'Streaming Plus', 'Streaming']],
  [12, ['checking', 'out', 11240, 'City Utilities', 'Utilities']],
  [16, ['checking', 'out', 30000, 'Transfer to Rainy-day Savings', 'Transfer']],
  [16, ['savings', 'in', 30000, 'Transfer from Everyday Checking', 'Transfer']],
  [20, ['checking', 'out', 28500, 'Auto loan payment', 'Loan payment']],
  [24, ['checking', 'out', 40000, 'Travel Rewards Card payment', 'Transfer']],
  [24, ['card', 'in', 40000, 'Payment thank you', 'Transfer']],
];

/** What repeats every so many days, counted back from today: every, offset, then the amounts it cycles through. */
const REPEATING: ReadonlyArray<readonly [number, number, Line, readonly number[]]> = [
  [14, 5, ['checking', 'in', 320000, 'Paycheck Lakeside Design Co', 'Income'], [320000]],
  [7, 1, ['checking', 'out', 0, 'Harbor Market', 'Groceries'], [8431, 9612, 7240, 10388, 6895]],
  [10, 6, ['checking', 'out', 0, 'Corner Fuel', 'Gas'], [3855, 4210, 3690]],
  [9, 3, ['card', 'out', 0, 'Corner Trattoria', 'Dining out'], [5280, 3640, 4415]],
  [35, 45, ['checking', 'out', 4000, 'Harbor Dental', 'Health'], [4000]],
  [30, 20, ['card', 'out', 0, 'Trailhead Outfitters', 'Shopping'], [8620, 4310]],
];

/** The sample holdings the snapshot lists beside the brokerage account. */
const HOLDINGS: FinanceHolding[] = [
  { name: 'Total Stock Market Index', ticker: 'VTI', type: 'etf', quantity: 180, value: 48960.00, costBasis: 41200, institution: 'Blue Sky Brokerage', accountName: 'Brokerage' },
  { name: 'Apple Inc', ticker: 'AAPL', type: 'equity', quantity: 60, value: 15780.00, costBasis: 11900, institution: 'Blue Sky Brokerage', accountName: 'Brokerage' },
  { name: 'US Bond Index', ticker: 'BND', type: 'etf', quantity: 120, value: 8920.00, costBasis: 9100, institution: 'Blue Sky Brokerage', accountName: 'Brokerage' },
  { name: 'Money market sweep', ticker: null, type: 'cash', quantity: 1, value: 3520.00, costBasis: 3520, institution: 'Blue Sky Brokerage', accountName: 'Brokerage' },
];

/** The sample household's records for one person. */
export interface SampleRecords { importId: string; accounts: LedgerAccount[]; transactions: LedgerTransaction[]; holdings: FinanceHolding[] }

/** The id of a person's sample account. */
function accountId(sub: string, key: string): string {
  return hashId('acct', sub, 'sample', key);
}

/** The id of the one import record that stands for a person's sample data. */
export function sampleImportId(sub: string): string {
  return hashId('imp', sub, 'sample');
}

/** The dated lines of the sample: what repeats, what falls on a day of the month, and one charge larger than usual. */
function datedLines(now: Date): Array<{ date: string; line: Line }> {
  const day = (back: number): string => new Date(now.getTime() - back * DAY_MS).toISOString().slice(0, 10);
  const lines: Array<{ date: string; line: Line }> = [];
  for (const [every, offset, line, amounts] of REPEATING) {
    for (let back = offset, n = 0; back <= SAMPLE_DAYS; back += every, n++) {
      lines.push({ date: day(back), line: [line[0], line[1], amounts[n % amounts.length], line[3], line[4]] });
    }
  }
  for (let back = 0; back <= SAMPLE_DAYS; back++) {
    const date = day(back), dayOfMonth = Number(date.slice(8, 10));
    for (const [on, line] of MONTHLY) if (on === dayOfMonth) lines.push({ date, line });
  }
  lines.push({ date: day(2), line: ['checking', 'out', 41200, 'Harbor Dental', 'Health'] });
  return lines.sort((a, b) => b.date.localeCompare(a.date) || a.line[3].localeCompare(b.line[3]));
}

/**
 * @description The sample household's records for one person, dated relative to today. Pure and
 * deterministic: the same person and day always give the same records and the same ids.
 * @param sub - The person the records are for.
 * @param now - Today.
 * @returns Accounts, three months of transactions (the newest five still to review) and holdings.
 */
export function sampleRecords(sub: string, now: Date = new Date()): SampleRecords {
  const stamp = now.toISOString(), today = stamp.slice(0, 10), importId = sampleImportId(sub);
  const accounts: LedgerAccount[] = ACCOUNTS.map(([key, name, institution, type, subtype, last4, cents]) => ({
    accountId: accountId(sub, key), bookId: HOME_BOOK, name, institution, type, subtype, last4, currency: 'USD', balanceCents: cents,
    balanceAsOf: today, source: 'sample', sourceLabel: SAMPLE_LABEL, posture: 'sample', linkId: '', importMap: null, state: 'open',
    createdAt: stamp, updatedAt: stamp,
  }));
  const seen = new Map<string, number>();
  const transactions: LedgerTransaction[] = datedLines(now).map(({ date, line }, index) => {
    const [key, direction, amountCents, description, category] = line;
    const identity = `${key}|${date}|${amountCents}|${direction}|${description}`, position = seen.get(identity) || 0;
    seen.set(identity, position + 1);
    return {
      txnId: transactionId(accountId(sub, key), { date, amountCents, direction, description, position }), bookId: HOME_BOOK,
      accountId: accountId(sub, key), month: monthOf(date), date, amountCents, direction, currency: 'USD', description,
      merchant: description, category, categorySource: 'sample', review: index < 5 ? 'new' : 'reviewed', flags: [], note: '',
      source: 'sample', sourceLabel: SAMPLE_LABEL, sourceRef: '', posture: 'sample', importId, matchedBillId: '',
      matchedInvoiceId: '', createdAt: stamp, updatedAt: stamp,
    };
  });
  return { importId, accounts, transactions, holdings: HOLDINGS.map((holding) => ({ ...holding })) };
}

/**
 * @description The part of the snapshot the sample's holdings travel in (Finance's records hold no
 * holdings of their own).
 * @param holdings - The sample holdings.
 * @param now - Today.
 * @returns A linked part with only holdings, marked as sample data.
 */
export function sampleLinkedPart(holdings: FinanceHolding[], now: Date = new Date()): FinanceAggregate {
  return {
    generatedAt: now.toISOString(), sourceEnvironment: 'sample', currency: 'USD', netWorth: { assets: 0, liabilities: 0, net: 0 },
    accounts: [], holdings, topSpending: [], spendByMonth: [], recentTransactions: [], transactionWindowDays: SAMPLE_DAYS + 1, notes: [],
  };
}

/**
 * @description Remove a person's sample records: its transactions, its accounts and its import
 * record's claim. Records the person added themselves are not touched.
 * @param db - The pool.
 * @param sub - The person.
 * @returns How many sample transactions were removed.
 */
export async function clearSample(db: LedgerDb, sub: string): Promise<number> {
  const importId = sampleImportId(sub);
  const held = await readImport(db, sub, importId);
  if (!held || held.state !== 'applied') return 0;
  const removed = await deleteImportTransactions(db, sub, importId);
  for (const [key] of ACCOUNTS) await deleteAccount(db, sub, accountId(sub, key));
  await saveImport(db, sub, { ...held, state: 'undone', rowsAdded: 0, undoneAt: nowStamp() });
  return removed;
}

/**
 * @description Write the sample household into a person's records, replacing an earlier sample.
 * @param db - The pool.
 * @param sub - The person.
 * @param now - Today.
 * @returns The records written.
 */
export async function loadSample(db: LedgerDb, sub: string, now: Date = new Date()): Promise<SampleRecords> {
  await ensureBook(db, sub, HOME_BOOK);
  await clearSample(db, sub);
  const sample = sampleRecords(sub, now);
  for (const account of sample.accounts) await insertAccount(db, sub, account);
  const { added } = await insertTransactions(db, sub, sample.transactions);
  const dates = sample.transactions.map((t) => t.date).sort();
  const record: LedgerImport = {
    importId: sample.importId, bookId: HOME_BOOK, accountId: '', newAccount: null, kind: 'sample', fileName: SAMPLE_LABEL, fingerprint: '',
    periodStart: dates[0] || null, periodEnd: dates[dates.length - 1] || null, rowsTotal: sample.transactions.length,
    rowsNew: sample.transactions.length, rowsDuplicate: 0, rowsUnreadable: 0, rowsAdded: added, closingBalanceCents: null,
    closingBalanceAsOf: null, columnMap: null, pending: null, state: 'applied', docId: '', createdAt: nowStamp(), appliedAt: nowStamp(), undoneAt: null,
  };
  if (await readImport(db, sub, sample.importId)) await saveImport(db, sub, record); else await insertImport(db, sub, record);
  return sample;
}

/** A demo installation's sample household snapshot: named banks, healthy balances, dated relative to now. */
export function sampleAggregate(windowDays = 90): FinanceAggregate {
  const day = (back: number) => new Date(Date.now() - back * DAY_MS).toISOString().slice(0, 10);
  const month = (back: number) => new Date(Date.now() - back * 30 * DAY_MS).toISOString().slice(0, 7);
  const accounts: Array<FinanceAccount & { balance: number }> = [
    { name: 'Everyday Checking', type: 'depository', subtype: 'checking', mask: '4821', balance: 4820.44, currency: 'USD', institution: 'Harbor Bank' },
    { name: 'Rainy-day Savings', type: 'depository', subtype: 'savings', mask: '7730', balance: 18400.00, currency: 'USD', institution: 'Harbor Bank' },
    { name: 'Money Market', type: 'depository', subtype: 'money market', mask: '2214', balance: 12500.00, currency: 'USD', institution: 'Coastal Credit Union' },
    { name: 'Brokerage', type: 'investment', subtype: 'brokerage', mask: '9043', balance: 77180.00, currency: 'USD', institution: 'Blue Sky Brokerage' },
    { name: 'Retirement 401(k)', type: 'investment', subtype: '401k', mask: '5512', balance: 46700.00, currency: 'USD', institution: 'Blue Sky Brokerage' },
    { name: 'Travel Rewards Card', type: 'credit', subtype: 'credit card', mask: '0082', balance: 1240.317, currency: 'USD', institution: 'Harbor Bank' },
    { name: 'Auto Loan', type: 'loan', subtype: 'auto', mask: '6619', balance: 9800.00, currency: 'USD', institution: 'Coastal Credit Union' },
  ];
  const holdings = HOLDINGS.map((holding) => ({ ...holding }));
  const assets = accounts.filter((a) => a.type !== 'credit' && a.type !== 'loan').reduce((s, a) => s + a.balance, 0);
  const liabilities = accounts.filter((a) => a.type === 'credit' || a.type === 'loan').reduce((s, a) => s + a.balance, 0);
  return {
    generatedAt: new Date().toISOString(), sourceEnvironment: 'sample', currency: 'USD',
    netWorth: { assets: Math.round(assets * 100) / 100, liabilities: Math.round(liabilities * 100) / 100, net: Math.round((assets - liabilities) * 100) / 100 },
    accounts: accounts.map((a) => ({ ...a, balance: Math.round(a.balance * 100) / 100 })), holdings,
    topSpending: [
      { category: 'Groceries', total: 612.40, count: 14 }, { category: 'Dining out', total: 284.15, count: 9 },
      { category: 'Utilities', total: 231.60, count: 4 }, { category: 'Gas', total: 148.90, count: 6 },
      { category: 'Streaming', total: 41.97, count: 3 },
    ],
    spendByMonth: [
      { month: month(2), spend: 3180.22, income: 6400.00 }, { month: month(1), spend: 3324.75, income: 6400.00 },
      { month: month(0), spend: 1319.02, income: 3200.00 },
    ],
    recentTransactions: [
      { date: day(1), name: 'Harbor Market', amount: 84.31, category: 'Groceries' },
      { date: day(2), name: 'City Utilities', amount: 112.40, category: 'Utilities' },
      { date: day(3), name: 'Corner Trattoria', amount: 52.80, category: 'Dining out' },
      { date: day(5), name: 'Paycheck — Lakeside Design Co', amount: -3200.00, category: 'Income' },
      { date: day(6), name: 'Shell Station', amount: 38.55, category: 'Gas' },
      { date: day(8), name: 'Streaming Plus', amount: 13.99, category: 'Streaming' },
      { date: day(9), name: 'Harbor Market', amount: 96.12, category: 'Groceries' },
      { date: day(11), name: 'Auto loan payment', amount: 285.00, category: 'Loan payment' },
    ],
    transactionWindowDays: windowDays,
    notes: ['Sample data for this demo installation. Link a real account to replace it.'],
  } as FinanceAggregate;
}
