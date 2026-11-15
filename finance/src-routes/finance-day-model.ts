/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The money day as pure functions (Roger, 2026-11-12: Finance as the day of someone looking after their money). From a person's own accounts and transactions this file works out what Home's steps need, in the order of the day: what came in and went out and is still to review, what is unusual, what is planned to run low, the payday set-aside, an account gone stale, the month to close, the year pack, this week, net worth and how long the cash would last. The four unusual marks are rules stated as facts about the person's own records, never a verdict: larger than usual (over twice the median of the last six charges there, and over $50), charged twice (same place and amount within a day), a new repeating charge (three charges 26 to 33 days apart within 10 percent) and a first charge over $200 somewhere new. A repeating charge becomes a bill only when the person says so. Every amount is a figure with its source and its date: a sum of flows carries the date its records reach, a total of balances carries its oldest date, a forward figure says Estimate or Planned, and what is not known is null, never zero. Nothing here reads a store, writes, calls a model or gives advice.
 */

/**
 * No framework runtime import and no store: every function takes records and a day and returns
 * values, so the page and the assistant get the same answer from the same records.
 *
 * @module finance-day-model
 */
import {
  OWED_TYPES, amountFigure, balanceFigure, figure, isDate, matchText, monthOf, monthWords,
  type Figure, type LedgerAccount, type LedgerTransaction,
} from './finance-ledger-store';
import type { BillDue } from './finance-bills';
import type { GoalProgress } from './finance-goals';
import type { MonthClose, MonthView } from './finance-month';

/** One day in milliseconds. */
export const DAY_MS = 86_400_000;
/** The marks a transaction can carry, in the order Home names them. */
export const UNUSUAL_FLAGS: readonly string[] = Object.freeze(['larger-than-usual', 'charged-twice', 'new-repeating', 'first-large']);
/** Larger than usual: over this many times the median of the earlier charges at that merchant. */
export const LARGER_FACTOR = 2;
/** Larger than usual: and over this amount ($50). */
export const LARGER_FLOOR_CENTS = 5000;
/** Larger than usual: the median is taken over at most this many earlier charges, and at least two. */
export const LARGER_HISTORY = 6;
/** A first charge somewhere new is named when it is over this amount ($200). */
export const FIRST_LARGE_CENTS = 20000;
/** A merchant is only called new when the records reach back at least this many days before the charge. */
export const FIRST_LARGE_HISTORY_DAYS = 30;
/** A repeating charge: three charges this many days apart. */
export const REPEAT_GAP_DAYS: readonly number[] = Object.freeze([26, 33]);
/** A repeating charge or income: amounts within this share of their median. */
export const REPEAT_TOLERANCE = 0.10;
/** Income repeats weekly, every two weeks (or twice a month) or monthly: the gaps each allows, in days. */
export const INCOME_GAPS: ReadonlyArray<readonly [string, number, number]> = Object.freeze([
  Object.freeze(['weekly', 6, 8] as const), Object.freeze(['every-two-weeks', 12, 17] as const), Object.freeze(['monthly', 26, 33] as const),
]);
/** An account whose balance is older than this many days is worth updating. */
export const STALE_DAYS = 35;
/** The payday step stays for this many days after the income arrived. */
export const PAYDAY_DAYS = 7;
/** With no income date known, the plan ahead looks this many days out. */
export const AHEAD_DAYS = 14;
/** The months of transactions the day reads: this month and the two before. */
export const DAY_MONTHS = 3;
/** The year pack is offered from 15 January to 15 April. */
export const YEAR_PACK_WINDOW: readonly string[] = Object.freeze(['01-15', '04-15']);
/** The closed months the runway averages over. */
export const RUNWAY_MONTHS = 3;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A figure made of other figures, which it lists so a person can see the parts. */
export interface TotalFigure extends Figure { parts?: Array<{ label: string; figure: Figure }> }

/** A charge or a deposit that repeats, found in the person's own transactions. */
export interface RepeatingSeries {
  key: string;
  payee: string;
  direction: 'in' | 'out';
  cadence: string;
  gapDays: number;
  amountCents: number;
  dueDay: number;
  nextDate: string;
  accountId: string;
  category: string;
  isNew: boolean;
  charges: LedgerTransaction[];
  last: LedgerTransaction;
}

/** The day's records, already read and already worked out by the bills, goals and month modules. */
export interface DayInput {
  bookId: string;
  today: string;
  currency: string;
  accounts: LedgerAccount[];
  linked: Set<string>;
  transactions: LedgerTransaction[];
  bills: { proposed: number; overdue: BillDue[]; week: BillDue[]; later: BillDue[] };
  goals: GoalProgress[];
  month: MonthView;
  floor: Figure | null;
  closedThrough: string | null;
  closes: MonthClose[];
  streak: number;
  bookCreatedAt: string | null;
}

/* ─── days and months ───────────────────────────────────────────────────────── */

/**
 * @description A date as a count of days, so two dates can be subtracted.
 * @param date - YYYY-MM-DD.
 * @returns Days since 1970-01-01.
 */
export function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

/**
 * @description The date some days after (or before) another.
 * @param date - YYYY-MM-DD.
 * @param days - Days to add; negative goes back.
 * @returns YYYY-MM-DD.
 */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * @description How many days lie from one date to another.
 * @param from - YYYY-MM-DD.
 * @param to - YYYY-MM-DD.
 * @returns to minus from, in days (negative when to is earlier).
 */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/**
 * @description The month some months after (or before) another.
 * @param month - YYYY-MM.
 * @param count - Months to add; negative goes back.
 * @returns YYYY-MM.
 */
export function addMonths(month: string, count: number): string {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + count;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * @description How many days a month has.
 * @param month - YYYY-MM.
 * @returns 28 to 31.
 */
export function daysInMonth(month: string): number {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
}

/**
 * @description A day of a month as a date; a day the month does not have becomes its last day.
 * @param month - YYYY-MM.
 * @param day - 1 to 31.
 * @returns YYYY-MM-DD.
 */
export function dayInMonth(month: string, day: number): string {
  return `${month}-${String(Math.min(Math.max(1, Math.floor(day)), daysInMonth(month))).padStart(2, '0')}`;
}

/**
 * @description The months before and including a day's month, newest first.
 * @param today - YYYY-MM-DD.
 * @param count - How many months, counting this one.
 * @returns YYYY-MM values.
 */
export function recentMonths(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, back) => addMonths(monthOf(today), -back));
}

/**
 * @description The person's day. A page sends its own local day; it is used when it is a real date
 * within a day of the server's, so a person in another time zone still gets their own "today".
 * @param value - The request's day, if any.
 * @param now - The server's clock.
 * @returns YYYY-MM-DD.
 */
export function todayOf(value: unknown, now: Date = new Date()): string {
  const server = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return isDate(value) && Math.abs(daysBetween(server, value)) <= 1 ? value : server;
}

/**
 * @description A date as a person says it: "today", "tomorrow", "yesterday", "on Monday" for the
 * week around today, else "on 16 November" (with the year when it is not this one).
 * @param date - YYYY-MM-DD.
 * @param today - YYYY-MM-DD.
 * @returns The words.
 */
export function dayWords(date: string, today: string): string {
  const gap = daysBetween(today, date);
  if (gap === 0) return 'today';
  if (gap === 1) return 'tomorrow';
  if (gap === -1) return 'yesterday';
  const at = new Date(`${date}T00:00:00Z`);
  if (Math.abs(gap) < 7) return `on ${WEEKDAYS[at.getUTCDay()]}`;
  const year = date.slice(0, 4) === today.slice(0, 4) ? '' : ` ${date.slice(0, 4)}`;
  return `on ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}${year}`;
}

/* ─── figures ───────────────────────────────────────────────────────────────── */

/** The oldest and the newest of some dates. */
function dateRange(dates: string[]): { oldest: string; newest: string } {
  const sorted = [...dates].sort();
  return { oldest: sorted[0], newest: sorted[sorted.length - 1] };
}

/**
 * @description One figure for several: their shared source when they share one, else the given
 * words; the posture they share, else none; and the date given.
 * @param cents - The amount the figure states.
 * @param parts - The figures it is made from.
 * @param words - What to call them together ("Your records").
 * @param asOf - The date the result is true for.
 * @returns The figure, or null when there are no parts.
 */
export function together(cents: number, parts: Figure[], words: string, asOf: string): Figure | null {
  if (!parts.length || !isDate(asOf)) return null;
  const same = parts.every((part) => part.source === parts[0].source && part.sourceKind === parts[0].sourceKind);
  const posture = parts.every((part) => part.posture === parts[0].posture) ? parts[0].posture : null;
  return figure(cents, parts[0].currency, same ? parts[0].source : words, same ? parts[0].sourceKind : 'mixed', asOf, posture || '');
}

/**
 * @description A figure that looks forward. Sample data stays marked as sample.
 * @param f - The figure.
 * @param posture - 'estimate' or 'planned'.
 * @returns The same figure with its posture set.
 */
export function forward(f: Figure, posture: 'estimate' | 'planned'): Figure {
  return { ...f, posture: f.posture === 'sample' ? 'sample' : posture };
}

/**
 * @description The sum of some transactions as a figure. A sum of flows is true up to its newest record.
 * @param txns - The transactions (all one direction).
 * @returns The figure, or null when there are none: no records is not zero.
 */
export function flowFigure(txns: LedgerTransaction[]): Figure | null {
  if (!txns.length) return null;
  return together(txns.reduce((sum, t) => sum + t.amountCents, 0), txns.map(amountFigure), 'Your records', dateRange(txns.map((t) => t.date)).newest);
}

/**
 * @description Whether a transaction is income or spending, and not money moved between the person's own accounts.
 * @param t - The transaction.
 * @returns True for income or spending.
 */
export function isFlow(t: { category: string }): boolean {
  return !/^transfers?\b/.test(matchText(t.category));
}

/**
 * @description The name a merchant is compared by: its words without reference numbers.
 * @param t - The transaction, or anything with a merchant and a description.
 * @returns The folded name ('' when it has none).
 */
export function merchantKey(t: { merchant: string; description: string }): string {
  const text = matchText(t.merchant || t.description);
  const words = text.split(' ').filter((word) => word && !/\d/.test(word)).join(' ').replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words || text;
}

/** Oldest first, then by id so the order never changes between reads. */
function oldestFirst(a: LedgerTransaction, b: LedgerTransaction): number {
  return a.date.localeCompare(b.date) || a.txnId.localeCompare(b.txnId);
}

/** Transactions of one direction that count as income or spending, grouped by merchant, each group oldest first. */
function byMerchant(txns: LedgerTransaction[], direction: 'in' | 'out'): Map<string, LedgerTransaction[]> {
  const groups = new Map<string, LedgerTransaction[]>();
  for (const t of [...txns].sort(oldestFirst)) {
    const key = merchantKey(t);
    if (t.direction !== direction || !isFlow(t) || !key) continue;
    groups.set(key, [...(groups.get(key) || []), t]);
  }
  return groups;
}

/** The middle value of some amounts. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/* ─── what repeats ──────────────────────────────────────────────────────────── */

/** The cadence two gaps fit: about a month for a charge; weekly, two-weekly or monthly for income. */
function cadenceOf(gaps: number[], direction: 'in' | 'out'): string {
  const bands = direction === 'out' ? [['monthly', REPEAT_GAP_DAYS[0], REPEAT_GAP_DAYS[1]] as const] : INCOME_GAPS;
  return bands.find(([, low, high]) => gaps.every((gap) => gap >= low && gap <= high))?.[0] || '';
}

/** A merchant's last three transactions as a repeating series, when their gaps and amounts fit the rule. */
function seriesOf(key: string, group: LedgerTransaction[], direction: 'in' | 'out'): RepeatingSeries | null {
  if (group.length < 3) return null;
  const last = group.slice(-3), gaps = [daysBetween(last[0].date, last[1].date), daysBetween(last[1].date, last[2].date)];
  const cadence = cadenceOf(gaps, direction), middle = median(last.map((t) => t.amountCents));
  if (!cadence || last.some((t) => Math.abs(t.amountCents - middle) > middle * REPEAT_TOLERANCE)) return null;
  const latest = last[2], gapDays = Math.round((gaps[0] + gaps[1]) / 2), dueDay = Number(latest.date.slice(8, 10));
  const nextDate = cadence === 'monthly' ? dayInMonth(addMonths(monthOf(latest.date), 1), dueDay) : addDays(latest.date, gapDays);
  return {
    key, payee: latest.merchant || latest.description, direction, cadence, gapDays, amountCents: latest.amountCents, dueDay, nextDate,
    accountId: latest.accountId, category: latest.category, isNew: group.length === 3, charges: last, last: latest,
  };
}

/**
 * @description The charges (or the income) that repeat in a person's own transactions: a merchant's
 * last three, evenly spaced and within 10 percent of each other.
 * @param txns - The transactions to look through (several months).
 * @param direction - 'out' for charges, 'in' for income.
 * @returns The series found, by payee.
 */
export function findRepeating(txns: LedgerTransaction[], direction: 'in' | 'out'): RepeatingSeries[] {
  const found: RepeatingSeries[] = [];
  for (const [key, group] of byMerchant(txns, direction)) {
    const series = seriesOf(key, group, direction);
    if (series) found.push(series);
  }
  return found.sort((a, b) => a.payee.localeCompare(b.payee) || a.key.localeCompare(b.key));
}

/**
 * @description The income a household counts on: the repeating income with the largest amount.
 * @param txns - The transactions to look through.
 * @returns The series, or null when no income repeats yet.
 */
export function mainIncome(txns: LedgerTransaction[]): RepeatingSeries | null {
  return findRepeating(txns, 'in').sort((a, b) => b.amountCents - a.amountCents || a.key.localeCompare(b.key))[0] || null;
}

/* ─── what is unusual ───────────────────────────────────────────────────────── */

/** The marks one charge earns against the earlier charges at the same merchant. */
function marksFor(t: LedgerTransaction, earlier: LedgerTransaction[], recordsStart: string, newlyRepeating: Set<string>): string[] {
  const marks: string[] = [], usual = earlier.slice(-LARGER_HISTORY).map((e) => e.amountCents);
  if (usual.length >= 2 && t.amountCents > LARGER_FACTOR * median(usual) && t.amountCents > LARGER_FLOOR_CENTS) marks.push('larger-than-usual');
  if (earlier.some((e) => e.amountCents === t.amountCents && daysBetween(e.date, t.date) <= 1)) marks.push('charged-twice');
  if (newlyRepeating.has(t.txnId)) marks.push('new-repeating');
  if (!earlier.length && t.amountCents > FIRST_LARGE_CENTS && daysBetween(recordsStart, t.date) >= FIRST_LARGE_HISTORY_DAYS) marks.push('first-large');
  return marks;
}

/**
 * @description What is unusual among the charges still to review, each a fact about the person's own
 * records. A reviewed transaction is never judged again.
 * @param txns - The transactions to look through (several months).
 * @param repeating - The repeating charges found in the same transactions.
 * @returns For every charge still to review, the marks that apply (often none).
 */
export function detectUnusual(txns: LedgerTransaction[], repeating: RepeatingSeries[] = findRepeating(txns, 'out')): Map<string, string[]> {
  const marks = new Map<string, string[]>();
  if (!txns.length) return marks;
  const recordsStart = dateRange(txns.map((t) => t.date)).oldest;
  const newlyRepeating = new Set(repeating.filter((series) => series.isNew).map((series) => series.last.txnId));
  for (const group of byMerchant(txns, 'out').values()) {
    group.forEach((t, index) => {
      if (t.review === 'new') marks.set(t.txnId, marksFor(t, group.slice(0, index), recordsStart, newlyRepeating));
    });
  }
  return marks;
}

/**
 * @description A transaction's flags with its unusual marks replaced by what the rules say now.
 * @param flags - The flags it carries.
 * @param marks - The unusual marks that apply now.
 * @returns The flags to keep, and whether they changed.
 */
export function withMarks(flags: string[], marks: string[]): { flags: string[]; changed: boolean } {
  const next = [...flags.filter((flag) => !UNUSUAL_FLAGS.includes(flag)), ...UNUSUAL_FLAGS.filter((flag) => marks.includes(flag))];
  return { flags: next, changed: next.join(',') !== flags.join(',') };
}

/** What a larger-than-usual charge was compared with: the median of the earlier charges there, as a figure. */
function usualFigure(t: LedgerTransaction, all: LedgerTransaction[]): Figure | null {
  const earlier = (byMerchant(all, 'out').get(merchantKey(t)) || []).filter((e) => oldestFirst(e, t) < 0).slice(-LARGER_HISTORY);
  if (earlier.length < 2) return null;
  return together(median(earlier.map((e) => e.amountCents)), earlier.map(amountFigure), 'Your records', earlier[earlier.length - 1].date);
}

/* ─── the day's parts ───────────────────────────────────────────────────────── */

/**
 * @description What came in and went out and is still to review.
 * @param txns - The day's transactions.
 * @returns The count, the two sums and the oldest date among them; null when nothing is new.
 */
export function newTransactions(txns: LedgerTransaction[]): Record<string, unknown> | null {
  const fresh = txns.filter((t) => t.review === 'new');
  if (!fresh.length) return null;
  const dates = dateRange(fresh.map((t) => t.date));
  return {
    count: fresh.length, since: dates.oldest, to: dates.newest,
    in: flowFigure(fresh.filter((t) => t.direction === 'in')), out: flowFigure(fresh.filter((t) => t.direction === 'out')),
  };
}

/**
 * @description The charges still to review that carry an unusual mark, newest first.
 * @param txns - The day's transactions.
 * @returns One item for each, with the mark, the amount and what it was compared with.
 */
export function unusualItems(txns: LedgerTransaction[]): Array<Record<string, unknown>> {
  return txns.filter((t) => t.review === 'new' && t.flags.some((flag) => UNUSUAL_FLAGS.includes(flag)))
    .sort((a, b) => oldestFirst(b, a))
    .map((t) => {
      const kinds = UNUSUAL_FLAGS.filter((flag) => t.flags.includes(flag));
      return {
        txnId: t.txnId, kind: kinds[0], kinds, merchant: t.merchant || t.description, date: t.date, accountId: t.accountId,
        amount: amountFigure(t), usual: kinds[0] === 'larger-than-usual' ? usualFigure(t, txns) : null,
      };
    });
}

/** Whether an account is money owed (a card or a loan). */
function owes(account: LedgerAccount): boolean {
  return OWED_TYPES.includes(account.type);
}

/** The accounts that count: open, and not left behind by a bank link that was removed. */
function counted(accounts: LedgerAccount[], linked: Set<string>): LedgerAccount[] {
  return accounts.filter((a) => a.state === 'open' && !(a.source === 'plaid' && !linked.has(a.linkId)));
}

/** One total over several balances: the oldest date, one source by name or several as a count. */
function totalOf(cents: number, parts: Figure[]): Figure | null {
  if (!parts.length) return null;
  const labels = new Set(parts.map((part) => part.source));
  return together(cents, parts, `${labels.size} sources`, dateRange(parts.map((part) => part.asOf)).oldest);
}

/**
 * @description Net worth from the accounts: what the person has less what they owe, in the shape the
 * Accounts screen reads. An account with no known balance is left out and named, never counted as
 * zero; the total carries its oldest date; accounts in more than one currency give no total.
 * @param accounts - The person's accounts.
 * @param linked - The ids of the person's bank links.
 * @returns assets, liabilities and net (each a figure or null), the parts, and the accounts left out.
 */
export function netWorth(accounts: LedgerAccount[], linked: Set<string>): Record<string, unknown> {
  const open = counted(accounts, linked);
  const parts = open.flatMap((a) => { const f = balanceFigure(a); return f ? [{ accountId: a.accountId, name: a.name, institution: a.institution, type: a.type, owed: owes(a), figure: f }] : []; });
  const without = open.filter((a) => !balanceFigure(a)).map((a) => a.name);
  if (new Set(parts.map((part) => part.figure.currency)).size > 1) {
    return { assets: null, liabilities: null, net: null, parts, without, note: 'These accounts are in more than one currency, so no total is shown.' };
  }
  const have = parts.filter((part) => !part.owed), owe = parts.filter((part) => part.owed);
  const assets = have.reduce((sum, part) => sum + part.figure.cents, 0), liabilities = owe.reduce((sum, part) => sum + Math.max(part.figure.cents, 0), 0);
  return {
    assets: totalOf(assets, have.map((part) => part.figure)), liabilities: totalOf(liabilities, owe.map((part) => part.figure)),
    net: totalOf(assets - liabilities, parts.map((part) => part.figure)), parts, without,
    note: without.length ? `Without ${without.join(', ')}: no balance is known yet.` : null,
  };
}

/**
 * @description The accounts whose balance has gone stale, stalest first.
 * @param accounts - The person's accounts.
 * @param today - YYYY-MM-DD.
 * @returns Each with its balance date and how many days old it is.
 */
export function staleAccounts(accounts: LedgerAccount[], today: string): Array<Record<string, unknown>> {
  return accounts.filter((a) => a.state === 'open' && isDate(a.balanceAsOf))
    .map((a) => ({ accountId: a.accountId, name: a.name, balanceAsOf: a.balanceAsOf as string, days: daysBetween(a.balanceAsOf as string, today) }))
    .filter((a) => a.days > STALE_DAYS)
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
}

/** The income that arrived in the last week: the repeating income when one is known, else income large enough to fund the set-aside. */
function arrivedIncome(input: DayInput, income: RepeatingSeries | null, needed: number): LedgerTransaction | null {
  const recent = input.transactions.filter((t) => t.direction === 'in' && isFlow(t) && daysBetween(t.date, input.today) >= 0 && daysBetween(t.date, input.today) <= PAYDAY_DAYS);
  const fits = (t: LedgerTransaction): boolean => (income ? merchantKey(t) === income.key : matchText(t.category) === 'income' && t.amountCents >= needed);
  return recent.filter(fits).sort((a, b) => oldestFirst(b, a))[0] || null;
}

/**
 * @description The payday step: income arrived in the last week and a goal still has this month's
 * set-aside to make. It goes once the person has set aside against that income.
 * @param input - The day's records.
 * @param income - The repeating income, when one was found.
 * @returns The set-aside to offer, or null.
 */
export function payday(input: DayInput, income: RepeatingSeries | null): Record<string, unknown> | null {
  const goal = input.goals.find((g) => g.state === 'open' && g.leftThisMonth !== null && g.leftThisMonth.cents > 0 && (!g.leftToTarget || g.leftToTarget.cents > 0));
  if (!goal || !goal.leftThisMonth) return null;
  const cents = goal.leftToTarget ? Math.min(goal.leftThisMonth.cents, goal.leftToTarget.cents) : goal.leftThisMonth.cents;
  const arrived = arrivedIncome(input, income, cents);
  if (!arrived || input.goals.some((g) => g.answeredIncome.includes(arrived.txnId))) return null;
  return { date: arrived.date, txnId: arrived.txnId, goalId: goal.goalId, goal: goal.name, amount: { ...goal.leftThisMonth, cents }, income: amountFigure(arrived) };
}

/** The lowest point an account's balance is planned to reach as its unpaid bills come due. */
function lowPoint(account: LedgerAccount, balance: Figure, bills: BillDue[], today: string, until: string): { cents: number; date: string; counted: BillDue[] } {
  const mine = bills.filter((b) => b.amount !== null && b.due < until && (b.accountId === account.accountId || !b.accountId))
    .sort((a, b) => a.due.localeCompare(b.due));
  let running = balance.cents, low = { cents: balance.cents, date: today, counted: [] as BillDue[] };
  mine.forEach((bill, index) => {
    running -= (bill.amount as Figure).cents;
    if (running < low.cents) low = { cents: running, date: bill.due < today ? today : bill.due, counted: mine.slice(0, index + 1) };
  });
  return low;
}

/**
 * @description The planned balance that dips under zero, or under the lowest balance the person
 * wants to keep, before their next income: the account's balance as it stands, less the unpaid bills
 * that come due first. An estimate; it changes no balance.
 * @param input - The day's records.
 * @param income - The repeating income, when one was found.
 * @returns The lowest such point, or null when no account is planned to dip.
 */
export function plannedLow(input: DayInput, income: RepeatingSeries | null): Record<string, unknown> | null {
  const unpaid = [...input.bills.overdue, ...input.bills.week, ...input.bills.later].filter((b) => b.state === 'due');
  const incomeDate = income && income.nextDate >= input.today ? income.nextDate : null;
  const until = incomeDate || addDays(input.today, AHEAD_DAYS), floorCents = input.floor ? input.floor.cents : 0;
  let worst: Record<string, unknown> | null = null, worstCents = Infinity;
  for (const account of counted(input.accounts, input.linked).filter((a) => a.type === 'depository')) {
    const balance = balanceFigure(account);
    if (!balance) continue;
    const low = lowPoint(account, balance, unpaid, input.today, until);
    if (!low.counted.length || low.cents >= floorCents || low.cents >= worstCents) continue;
    worstCents = low.cents;
    worst = {
      account: account.name, accountId: account.accountId, date: low.date, incomeDate,
      low: forward(figure(low.cents, balance.currency, `${balance.source} balance, less your bills`, 'mixed', balance.asOf, balance.posture || ''), 'estimate'),
      floor: input.floor, balance, bills: low.counted.map((b) => ({ billId: b.billId, payee: b.payee, due: b.due, amount: b.amount })),
    };
  }
  return worst;
}

/**
 * @description The month to close: last month, when it has records and is not closed.
 * @param input - The day's records.
 * @returns The month, or null.
 */
export function monthToClose(input: DayInput): Record<string, unknown> | null {
  const last = addMonths(monthOf(input.today), -1);
  if (input.closedThrough && last <= input.closedThrough) return null;
  return input.transactions.some((t) => t.month === last) ? { month: last, label: monthWords(last) } : null;
}

/**
 * @description The year pack: offered from 15 January to 15 April for the year before, until done.
 * @param input - The day's records.
 * @returns The year, or null.
 */
export function yearPack(input: DayInput): Record<string, unknown> | null {
  const day = input.today.slice(5), year = String(Number(input.today.slice(0, 4)) - 1);
  if (day < YEAR_PACK_WINDOW[0] || day > YEAR_PACK_WINDOW[1]) return null;
  if (input.closes.some((c) => c.kind === 'year-pack' && c.period === year && c.state === 'closed')) return null;
  const hadRecords = input.closes.some((c) => c.kind === 'month' && c.period.startsWith(year))
    || input.transactions.some((t) => t.month.startsWith(year)) || Boolean(input.bookCreatedAt && input.bookCreatedAt.slice(0, 4) <= year);
  return hadRecords ? { year: Number(year) } : null;
}

/** The repeating income as the amount expected next: an estimate from the last deposit. */
function expectedIncome(income: RepeatingSeries): Figure {
  return forward({ ...amountFigure(income.last), source: `Your last deposit from ${income.payee}` }, 'estimate');
}

/** Bills and expected income in the next seven days, soonest first. */
function upcoming(input: DayInput, income: RepeatingSeries | null): Array<Record<string, unknown>> {
  const end = addDays(input.today, 7);
  const items: Array<Record<string, unknown>> = [...input.bills.week, ...input.bills.later]
    .filter((b) => b.state === 'due' && b.due >= input.today && b.due <= end)
    .map((b) => ({ date: b.due, label: b.payee, kind: 'bill', billId: b.billId, eventId: b.eventId, amount: b.amount }));
  if (income && income.nextDate >= input.today && income.nextDate <= end) {
    items.push({ date: income.nextDate, label: income.payee, kind: 'income', amount: expectedIncome(income) });
  }
  return items.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.label).localeCompare(String(b.label)));
}

/**
 * @description This week: money in and out over the last seven days, what is left to spend for the
 * next seven, and the bills and income ahead.
 * @param input - The day's records.
 * @param income - The repeating income, when one was found.
 * @returns The week. A figure the records do not hold is null.
 */
export function weekView(input: DayInput, income: RepeatingSeries | null): Record<string, unknown> {
  const recent = input.transactions.filter((t) => isFlow(t) && daysBetween(t.date, input.today) >= 0 && daysBetween(t.date, input.today) < 7);
  const monthLeft = input.month.left, perDay = input.month.perDay;
  const left = monthLeft && perDay ? { ...monthLeft, cents: Math.min(monthLeft.cents, perDay.cents * 7), parts: undefined } : null;
  return {
    from: addDays(input.today, -6), to: input.today,
    in: flowFigure(recent.filter((t) => t.direction === 'in')), out: flowFigure(recent.filter((t) => t.direction === 'out')), left,
    upcoming: upcoming(input, income),
  };
}

/**
 * @description How long the cash would last at the average spending of the last closed months.
 * @param accounts - The person's accounts.
 * @param linked - The ids of the person's bank links.
 * @param closes - The closed months.
 * @returns Months of cover with the two figures behind it, or null when no month is closed or no cash balance is known.
 */
export function runway(accounts: LedgerAccount[], linked: Set<string>, closes: MonthClose[]): Record<string, unknown> | null {
  const closed = closes.filter((c) => c.kind === 'month' && c.state === 'closed' && c.out !== null && c.out.cents > 0)
    .sort((a, b) => b.period.localeCompare(a.period)).slice(0, RUNWAY_MONTHS);
  const balances = counted(accounts, linked).filter((a) => a.type === 'depository').map(balanceFigure).filter((f): f is Figure => Boolean(f));
  const cash = totalOf(balances.reduce((sum, f) => sum + f.cents, 0), balances);
  if (!closed.length || !cash || cash.cents <= 0) return null;
  const spent = closed.map((c) => c.out as Figure), average = Math.round(spent.reduce((sum, f) => sum + f.cents, 0) / spent.length);
  const words = closed.length === 1 ? 'Your last closed month' : `Your last ${closed.length} closed months`;
  const spending = together(average, spent, words, dateRange(spent.map((f) => f.asOf)).newest) as Figure;
  return {
    months: Math.floor((cash.cents / average) * 10) / 10, basisMonths: closed.length, from: closed[closed.length - 1].period, to: closed[0].period,
    cash, spending: { ...spending, source: words },
  };
}

/**
 * @description The day: every input Home's steps and its week, month and net worth need, each amount
 * a figure with its source and date. Invoices are not in this answer; they belong to the business records.
 * @param input - The day's records, already read.
 * @returns The answer of GET /api/finance/day.
 */
export function buildDay(input: DayInput): Record<string, unknown> {
  const open = counted(input.accounts, input.linked);
  const income = mainIncome(input.transactions);
  return {
    book: input.bookId, asOf: input.today, currency: input.currency, accounts: open.length, firstRun: open.length === 0,
    sample: open.length > 0 && open.every((a) => a.posture === 'sample'),
    window: { months: recentMonths(input.today, DAY_MONTHS) },
    newTransactions: newTransactions(input.transactions),
    unusual: unusualItems(input.transactions),
    bills: input.bills,
    plannedLow: plannedLow(input, income),
    payday: payday(input, income),
    staleAccounts: staleAccounts(open, input.today),
    close: monthToClose(input),
    yearPack: yearPack(input),
    streak: { monthsClosed: input.streak },
    week: weekView(input, income),
    month: input.month,
    goals: input.goals,
    netWorth: netWorth(input.accounts, input.linked),
    runway: runway(input.accounts, input.linked, input.closes),
    income: income ? { payee: income.payee, cadence: income.cadence, nextDate: income.nextDate, amount: expectedIncome(income) } : null,
  };
}
