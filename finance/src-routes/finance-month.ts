/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The month, mounted at /api/finance/month (Roger, 2026-11-12: Finance as a person's money day). The month so far against the person's own plan: income, bills, goals and everything else, each planned against actual, spending by category in the person's own words, and what is left to spend with what it is made of. The plan is what the person typed; a month with no plan has no "left to spend", never a guess. The close runs four checks (every account updated to the month's end, nothing left to review, every bill answered, each account's statement adding up from the one before) and keeps the month's totals, net worth and every account's balance with its date and source as they stood; it needs the person's confirmation, says so when a check is still open, and a closed month is changed only after "Reopen". Closed months in a row are counted. Every amount is a figure with its source and date. Nothing here moves money or advises. The GETs only read.
 */

/**
 * @module finance-month
 */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import {
  LedgerRefusal, OWED_TYPES, assertMonthOpen, cleanText, duplicateKey, ensureBook, figure, hashId, isMonth, listAccounts, listImports, listMonths,
  listTransactions, matchText, monthOf, monthWords, nowStamp, readBook, saveBook,
  type Figure, type LedgerAccount, type LedgerDb, type LedgerImport, type LedgerTransaction,
} from './finance-ledger-store';
import {
  addDays, addMonths, dayInMonth, daysInMonth, flowFigure, forward, isFlow, netWorth, together, type TotalFigure,
} from './finance-day-model';
import { bodyOf, bookOf, cell, centsOf, dayOf, jsonParam, monthParam, requireConfirm, route, wholeOrNull } from './finance-day-kit';
import { dueOf, listBills, listEvents, type Bill, type BillDue, type BillEvent } from './finance-bills';
import { listGoals, listMoves, type Goal, type GoalMove } from './finance-goals';

/** The plan lines Finance itself reads; any other line is a category in the person's own words. */
export const PLAN_LINES: readonly string[] = Object.freeze(['income', 'everything-else', 'floor']);
/** An account counts as updated to a month's end when its balance is dated within this many days of it, or later. */
export const MONTH_END_GRACE_DAYS = 5;
/** A statement is checked against the one before it when that one is at most this many months back. */
export const STATEMENT_REACH_MONTHS = 4;

/** One line of a month's plan, as stored. */
export interface BudgetLine {
  lineId: string;
  bookId: string;
  month: string;
  line: string;
  plannedCents: number;
  currency: string;
  setOn: string;
  source: string;
  sourceLabel: string;
  posture: string;
}

/** A closed month, or a finished year pack, as stored. */
export interface MonthClose {
  closeId: string;
  bookId: string;
  kind: string;
  period: string;
  state: string;
  in: Figure | null;
  out: Figure | null;
  netWorth: Figure | null;
  summary: Record<string, unknown> | null;
  closedAt: string;
  reopenedAt: string | null;
}

/** One of the four groups a month's plan is read by. */
export interface MonthGroup { id: string; label: string; planned: Figure | null; actual: Figure | null; unknown: string[] }

/** A month so far against its plan. */
export interface MonthView {
  month: string;
  label: string;
  closed: boolean;
  hasPlan: boolean;
  daysLeft: number;
  in: Figure | null;
  out: Figure | null;
  left: TotalFigure | null;
  perDay: Figure | null;
  groups: MonthGroup[];
  categories: Array<{ category: string; count: number; amount: Figure | null; planned: Figure | null }>;
  plan: Array<{ line: string; planned: Figure }>;
}

/** What a month view is worked out from. */
export interface MonthInput {
  month: string;
  today: string;
  closed: boolean;
  transactions: LedgerTransaction[];
  bills: Bill[];
  events: BillEvent[];
  goals: Goal[];
  moves: GoalMove[];
  lines: BudgetLine[];
}

const LINE_COLUMNS = 'line_id, user_sub, book_id, month, line, planned_cents, currency, set_on, source, source_label, posture, created_at, updated_at';
const CLOSE_COLUMNS = 'close_id, user_sub, book_id, kind, period, state, in_cents, out_cents, net_worth_cents, net_worth_as_of, currency, summary, closed_at, reopened_at, updated_at';

/** Every statement this module issues. The selective text equality comes first in each WHERE. */
export const MONTH_SQL = Object.freeze({
  linesByMonth: `SELECT ${LINE_COLUMNS} FROM finance_budget_lines WHERE month = $1 AND user_sub = $2 AND book_id = $3`,
  lineInsert: `INSERT INTO finance_budget_lines (${LINE_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
  lineUpdate: 'UPDATE finance_budget_lines SET planned_cents = $3, set_on = $4, source = $5, source_label = $6, posture = $7, updated_at = $8 WHERE line_id = $1 AND user_sub = $2',
  lineDelete: 'DELETE FROM finance_budget_lines WHERE line_id = $1 AND user_sub = $2',
  closesByBook: `SELECT ${CLOSE_COLUMNS} FROM finance_month_closes WHERE book_id = $1 AND user_sub = $2`,
  closeInsert: `INSERT INTO finance_month_closes (${CLOSE_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15)`,
  closeUpdate: 'UPDATE finance_month_closes SET state = $3, in_cents = $4, out_cents = $5, net_worth_cents = $6, net_worth_as_of = $7, summary = $8::jsonb, closed_at = $9, reopened_at = $10, updated_at = $11 WHERE close_id = $1 AND user_sub = $2',
  linkedItems: 'SELECT item_id FROM oshal_finance_items WHERE user_sub = $1',
});

/* ─── the store ─────────────────────────────────────────────────────────────── */

/** A stored plan line as the record the modules use. */
function lineOf(row: any): BudgetLine {
  return {
    lineId: row.line_id, bookId: row.book_id, month: row.month, line: row.line, plannedCents: wholeOrNull(row.planned_cents) as number,
    currency: row.currency || 'USD', setOn: row.set_on, source: row.source, sourceLabel: row.source_label || '', posture: row.posture || '',
  };
}

/** A stored close row as the record the modules use; its figures are kept whole in the summary. */
function closeOf(row: any): MonthClose {
  const summary = cell<Record<string, unknown>>(row.summary);
  return {
    closeId: row.close_id, bookId: row.book_id, kind: row.kind || 'month', period: row.period, state: row.state,
    in: (summary?.in as Figure) || null, out: (summary?.out as Figure) || null, netWorth: (summary?.netWorth as Figure) || null, summary,
    closedAt: row.closed_at, reopenedAt: row.reopened_at || null,
  };
}

/**
 * @description The plan lines of one month.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param month - YYYY-MM.
 * @returns The lines, by name.
 */
export async function listLines(db: LedgerDb, sub: string, bookId: string, month: string): Promise<BudgetLine[]> {
  const rows = (await db.query(MONTH_SQL.linesByMonth, [month, sub, bookId])).rows;
  return rows.map(lineOf).sort((a, b) => a.line.localeCompare(b.line));
}

/**
 * @description Keep one plan line: add it, or replace the amount of the line with the same name.
 * @param db - The pool.
 * @param sub - The caller.
 * @param line - The line.
 * @returns Nothing.
 */
export async function keepLine(db: LedgerDb, sub: string, line: BudgetLine): Promise<void> {
  const now = nowStamp();
  try {
    await db.query(MONTH_SQL.lineInsert, [line.lineId, sub, line.bookId, line.month, line.line, line.plannedCents, line.currency, line.setOn,
      line.source, line.sourceLabel, line.posture, now, now]);
  } catch (err) {
    if (!duplicateKey(err)) throw err;
    await db.query(MONTH_SQL.lineUpdate, [line.lineId, sub, line.plannedCents, line.setOn, line.source, line.sourceLabel, line.posture, now]);
  }
}

/**
 * @description Every closed month and finished year pack in a set of records, newest first.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The closes.
 */
export async function listCloses(db: LedgerDb, sub: string, bookId: string): Promise<MonthClose[]> {
  const rows = (await db.query(MONTH_SQL.closesByBook, [bookId, sub])).rows;
  return rows.map(closeOf).sort((a, b) => b.period.localeCompare(a.period) || a.closeId.localeCompare(b.closeId));
}

/** Keep a close: add it, or (for a period closed before and reopened) replace what it holds. */
async function keepClose(db: LedgerDb, sub: string, c: MonthClose): Promise<void> {
  const worth = c.netWorth, now = nowStamp();
  const totals = [c.in ? c.in.cents : null, c.out ? c.out.cents : null, worth ? worth.cents : null, worth ? worth.asOf : null];
  try {
    await db.query(MONTH_SQL.closeInsert, [c.closeId, sub, c.bookId, c.kind, c.period, c.state, ...totals, 'USD', jsonParam(c.summary), c.closedAt, c.reopenedAt, now]);
  } catch (err) {
    if (!duplicateKey(err)) throw err;
    await db.query(MONTH_SQL.closeUpdate, [c.closeId, sub, c.state, ...totals, jsonParam(c.summary), c.closedAt, c.reopenedAt, now]);
  }
}

/**
 * @description The ids of the caller's bank links, to tell a linked account from one whose bank was disconnected.
 * @param db - The pool.
 * @param sub - The caller.
 * @returns The link ids.
 */
export async function linkedItems(db: LedgerDb, sub: string): Promise<Set<string>> {
  const rows = (await db.query(MONTH_SQL.linkedItems, [sub])).rows;
  return new Set(rows.map((row) => String(row.item_id)));
}

/* ─── the month against its plan ────────────────────────────────────────────── */

/** A plan line as a figure: planned, dated the day the person set it. */
function lineFigure(line: BudgetLine): Figure {
  return forward(figure(line.plannedCents, line.currency, line.sourceLabel || 'Your plan', line.source, line.setOn, line.posture), 'planned');
}

/** One figure for several planned or estimated amounts; it reads Planned unless they all say the same thing. */
function plannedTotal(parts: Figure[], words: string): Figure | null {
  if (!parts.length) return null;
  const total = together(parts.reduce((sum, part) => sum + part.cents, 0), parts, words, [...parts.map((part) => part.asOf)].sort()[0]) as Figure;
  return total.posture ? total : forward(total, 'planned');
}

/** The bills group: what this month's due dates are expected to cost, and what was paid. */
function billsGroup(input: MonthInput): MonthGroup {
  const byId = new Map(input.bills.map((bill) => [bill.billId, bill]));
  const dues = input.events.filter((e) => e.state !== 'skipped' && byId.has(e.billId)).map((e) => ({ event: e, due: dueOf(byId.get(e.billId) as Bill, { ...e, state: 'due' }, input.today) }));
  const expected = dues.map((d) => d.due.amount).filter((f): f is Figure => Boolean(f));
  const paid = input.events.filter((e) => e.state === 'paid' && byId.has(e.billId)).map((e) => dueOf(byId.get(e.billId) as Bill, e, input.today).amount).filter((f): f is Figure => Boolean(f));
  return {
    id: 'bills', label: 'Bills', planned: plannedTotal(expected, 'Your bills'),
    actual: paid.length ? together(paid.reduce((sum, f) => sum + f.cents, 0), paid, 'Your records', [...paid.map((f) => f.asOf)].sort().pop() as string) : null,
    unknown: dues.filter((d) => !d.due.amount).map((d) => d.due.payee),
  };
}

/** The goals group: what the person plans to set aside each month, and what they set aside this month. */
function goalsGroup(input: MonthInput): MonthGroup {
  const open = input.goals.filter((goal) => goal.state === 'open');
  const plans = open.filter((goal) => goal.monthlyCents !== null).map((goal) => forward(figure(goal.monthlyCents as number, goal.currency, goal.sourceLabel || 'Typed by you', goal.source, goal.updatedAt.slice(0, 10), goal.posture), 'planned'));
  const moves = input.moves.filter((move) => move.month === input.month);
  const kept = moves.map((move) => figure(move.direction === 'in' ? move.amountCents : -move.amountCents, move.currency, move.posture === 'sample' ? move.sourceLabel || 'Sample data' : 'Set aside in Finance', move.source, move.date, move.posture));
  return {
    id: 'goals', label: 'Goals', planned: plannedTotal(plans, 'Your goals'),
    actual: kept.length ? together(kept.reduce((sum, f) => sum + f.cents, 0), kept, 'Set aside in Finance', [...kept.map((f) => f.asOf)].sort().pop() as string) : null,
    unknown: open.filter((goal) => goal.monthlyCents === null).map((goal) => goal.name),
  };
}

/** What may be spent on everything else: the person's own line, else planned income less bills and goals. */
function allowance(lines: BudgetLine[], bills: MonthGroup, goals: MonthGroup): TotalFigure | null {
  const own = lines.find((line) => line.line === 'everything-else'), income = lines.find((line) => line.line === 'income');
  if (own) return { ...lineFigure(own), parts: [{ label: 'Planned for everything else', figure: lineFigure(own) }] };
  if (!income) return null;
  const parts = [{ label: 'Planned income', figure: lineFigure(income) }];
  if (bills.planned) parts.push({ label: 'Bills', figure: bills.planned });
  if (goals.planned) parts.push({ label: 'Goals', figure: goals.planned });
  const cents = income.plannedCents - (bills.planned ? bills.planned.cents : 0) - (goals.planned ? goals.planned.cents : 0);
  return { ...forward(figure(cents, income.currency, 'Your plan', parts.length > 1 ? 'mixed' : income.source, income.setOn, income.posture), 'planned'), parts };
}

/** What is left to spend: the allowance less what was spent on everything else, true up to the newest record counted. */
function leftToSpend(allowed: TotalFigure | null, spent: Figure | null): TotalFigure | null {
  if (!allowed) return null;
  const parts = [...(allowed.parts || [])];
  if (spent) parts.push({ label: 'Spent so far', figure: spent });
  const sample = allowed.posture === 'sample' ? 'sample' : '';
  const said = figure(allowed.cents - (spent ? spent.cents : 0), allowed.currency, spent ? 'Your plan and your records' : allowed.source, spent ? 'mixed' : allowed.sourceKind, spent ? spent.asOf : allowed.asOf, sample);
  return { ...forward(said, 'planned'), parts };
}

/** Spending by category, largest first, with the person's own planned amount where they set one. */
function byCategory(spending: LedgerTransaction[], lines: BudgetLine[]): MonthView['categories'] {
  const groups = new Map<string, LedgerTransaction[]>();
  for (const t of spending) groups.set(t.category || 'Other', [...(groups.get(t.category || 'Other') || []), t]);
  const own = lines.filter((line) => !PLAN_LINES.includes(line.line)), planned = (name: string): Figure | null => {
    const line = own.find((candidate) => matchText(candidate.line) === matchText(name));
    return line ? lineFigure(line) : null;
  };
  const rows = [...groups].map(([category, txns]) => ({ category, count: txns.length, amount: flowFigure(txns), planned: planned(category) }));
  for (const line of own.filter((candidate) => ![...groups.keys()].some((name) => matchText(name) === matchText(candidate.line)))) {
    rows.push({ category: line.line, count: 0, amount: null, planned: lineFigure(line) });
  }
  return rows.sort((a, b) => (b.amount ? b.amount.cents : 0) - (a.amount ? a.amount.cents : 0) || a.category.localeCompare(b.category));
}

/** How many days of a month are left, counting today. */
function daysLeftIn(month: string, today: string): number {
  if (month < monthOf(today)) return 0;
  return month > monthOf(today) ? daysInMonth(month) : daysInMonth(month) - Number(today.slice(8, 10)) + 1;
}

/**
 * @description A month so far against its plan: the four groups planned against actual, spending by
 * category, and what is left to spend with its parts. Without a plan there is no "left to spend".
 * @param input - The month's records.
 * @returns The month view.
 */
export function monthView(input: MonthInput): MonthView {
  const flows = input.transactions.filter(isFlow), income = flows.filter((t) => t.direction === 'in'), spending = flows.filter((t) => t.direction === 'out');
  const incomeLine = input.lines.find((line) => line.line === 'income');
  const bills = billsGroup(input), goals = goalsGroup(input), allowed = allowance(input.lines, bills, goals);
  const other = flowFigure(spending.filter((t) => !t.matchedBillId)), left = leftToSpend(allowed, other), daysLeft = daysLeftIn(input.month, input.today);
  return {
    month: input.month, label: monthWords(input.month), closed: input.closed, hasPlan: Boolean(allowed), daysLeft,
    in: flowFigure(income), out: flowFigure(spending), left,
    perDay: left && left.cents > 0 && daysLeft > 0 ? { ...left, cents: Math.floor(left.cents / daysLeft), parts: undefined } as Figure : null,
    groups: [
      { id: 'income', label: 'Income', planned: incomeLine ? lineFigure(incomeLine) : null, actual: flowFigure(income), unknown: [] },
      bills, goals,
      { id: 'everything-else', label: 'Everything else', planned: allowed ? { ...allowed, parts: undefined } as Figure : null, actual: other, unknown: [] },
    ],
    categories: byCategory(spending, input.lines),
    plan: input.lines.map((line) => ({ line: line.line, planned: lineFigure(line) })),
  };
}

/**
 * @description Read one month's records and work out its view.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param month - YYYY-MM.
 * @param today - YYYY-MM-DD.
 * @returns The month view.
 */
export async function readMonth(db: LedgerDb, sub: string, bookId: string, month: string, today: string): Promise<MonthView> {
  const book = await readBook(db, sub, bookId);
  return monthView({
    month, today, closed: Boolean(book?.closedThrough && month <= book.closedThrough),
    transactions: await listTransactions(db, sub, bookId, month), bills: await listBills(db, sub, bookId),
    events: await listEvents(db, sub, bookId, [month]), goals: await listGoals(db, sub, bookId), moves: await listMoves(db, sub, bookId),
    lines: await listLines(db, sub, bookId, month),
  });
}

/* ─── the plan ──────────────────────────────────────────────────────────────── */

/** The lines a plan request names: the three Finance reads, and any category lines. */
function requestedLines(body: Record<string, unknown>): Array<{ line: string; cents: number | null }> {
  const lines: Array<{ line: string; cents: number | null }> = [];
  for (const [key, line] of [['incomeCents', 'income'], ['everythingElseCents', 'everything-else'], ['floorCents', 'floor']]) {
    if (body[key] !== undefined) lines.push({ line, cents: centsOf(body[key], 'The planned amount') });
  }
  for (const entry of Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : []) {
    const name = cleanText(entry?.line, 60);
    if (!name || PLAN_LINES.includes(matchText(name))) throw new LedgerRefusal(400, 'bad_line', 'Name the category this planned amount is for.');
    lines.push({ line: name, cents: centsOf(entry.plannedCents, 'The planned amount') });
  }
  return lines;
}

/**
 * @description Set a month's plan. A line given with no amount is removed. A closed month's plan cannot change.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param month - YYYY-MM.
 * @param body - incomeCents, everythingElseCents, floorCents, and lines of { line, plannedCents }.
 * @param today - YYYY-MM-DD.
 * @returns How many lines were kept and removed.
 */
export async function setPlan(db: LedgerDb, sub: string, bookId: string, month: string, body: Record<string, unknown>, today: string): Promise<{ kept: number; removed: number }> {
  const lines = requestedLines(body);
  if (!lines.length) throw new LedgerRefusal(400, 'plan_required', 'Type at least your income for the month.');
  assertMonthOpen(await ensureBook(db, sub, bookId), month);
  let kept = 0, removed = 0;
  for (const { line, cents } of lines) {
    const lineId = hashId('line', sub, bookId, month, matchText(line));
    if (cents === null) { await db.query(MONTH_SQL.lineDelete, [lineId, sub]); removed += 1; continue; }
    await keepLine(db, sub, { lineId, bookId, month, line, plannedCents: cents, currency: 'USD', setOn: today, source: 'typed', sourceLabel: 'Your plan', posture: 'typed' });
    kept += 1;
  }
  return { kept, removed };
}

/**
 * @description Carry last month's plan into a month that has none, so a new month opens with a plan.
 * The carried lines say where they came from.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param month - YYYY-MM, the month to fill.
 * @param today - YYYY-MM-DD.
 * @returns How many lines were carried.
 */
export async function carryPlan(db: LedgerDb, sub: string, bookId: string, month: string, today: string): Promise<number> {
  if ((await listLines(db, sub, bookId, month)).length) return 0;
  const before = addMonths(month, -1), earlier = await listLines(db, sub, bookId, before);
  for (const line of earlier) {
    const label = line.posture === 'sample' ? line.sourceLabel : `Your plan, carried over from ${monthWords(before)}`;
    await keepLine(db, sub, { ...line, lineId: hashId('line', sub, bookId, month, matchText(line.line)), month, setOn: today, sourceLabel: label });
  }
  return earlier.length;
}

/* ─── the close ─────────────────────────────────────────────────────────────── */

/** A statement's closing balance in the account's own terms: for a card or a loan, the amount owed. */
function statementBalance(account: LedgerAccount, statement: LedgerImport): number {
  const closing = statement.closingBalanceCents as number;
  return OWED_TYPES.includes(account.type) && statement.kind === 'ofx' ? -closing : closing;
}

/** One account's statement for a month against the statement before it and the transactions between them. */
function statementCheck(account: LedgerAccount, imports: LedgerImport[], txns: LedgerTransaction[], month: string): Record<string, unknown> {
  const base = { accountId: account.accountId, name: account.name };
  const statements = imports.filter((i) => i.accountId === account.accountId && i.state === 'applied' && i.closingBalanceCents !== null && i.closingBalanceAsOf)
    .sort((a, b) => (a.closingBalanceAsOf as string).localeCompare(b.closingBalanceAsOf as string));
  const current = statements.filter((i) => monthOf(i.closingBalanceAsOf as string) === month).pop();
  if (account.type === 'investment') return { ...base, state: 'not-checked', reason: 'An investment account changes with the market, so its statement is not added up.' };
  if (!current) return { ...base, state: 'not-checked', reason: `No statement that closes in ${monthWords(month)} is in your records.` };
  const to = current.closingBalanceAsOf as string, earlier = statements.filter((i) => (i.closingBalanceAsOf as string) < to).pop();
  if (!earlier) return { ...base, state: 'not-checked', to, reason: 'There is no earlier statement to start from.' };
  const from = earlier.closingBalanceAsOf as string;
  if (monthOf(from) < addMonths(month, -STATEMENT_REACH_MONTHS)) return { ...base, state: 'not-checked', to, reason: 'The statement before this one is too far back to add up from.' };
  const between = txns.filter((t) => t.accountId === account.accountId && t.date > from && t.date <= to);
  const moved = between.reduce((sum, t) => sum + (t.direction === 'in' ? t.amountCents : -t.amountCents), 0) * (OWED_TYPES.includes(account.type) ? -1 : 1);
  const difference = statementBalance(account, current) - (statementBalance(account, earlier) + moved);
  const label = `${account.institution || account.name} statement`;
  return {
    ...base, state: difference === 0 ? 'matches' : 'differs', from, to, statement: figure(statementBalance(account, current), account.currency, label, 'import', to),
    difference: difference === 0 ? null : figure(difference, account.currency, `${label} and your records`, 'mixed', to),
  };
}

/** The first of the four checks: every account's balance is dated at the month's end or later. */
function accountsUpdated(accounts: LedgerAccount[], month: string): Record<string, unknown> {
  const end = addDays(dayInMonth(month, 31), -MONTH_END_GRACE_DAYS);
  const open = accounts.filter((a) => !a.balanceAsOf || a.balanceAsOf < end).map((a) => ({ accountId: a.accountId, name: a.name, balanceAsOf: a.balanceAsOf }));
  return { id: 'accounts-updated', label: `Every account is updated to the end of ${monthWords(month)}`, ok: !open.length, open, view: 'accounts' };
}

/** What the close reads, once. */
interface CloseRecords {
  accounts: LedgerAccount[]; linked: Set<string>; imports: LedgerImport[]; window: LedgerTransaction[]; view: MonthView; due: BillDue[];
}

/** Read what the four checks and the summary need: the month, and the months a statement may reach back over. */
async function closeRecords(db: LedgerDb, sub: string, bookId: string, month: string, today: string): Promise<CloseRecords> {
  const linked = await linkedItems(db, sub);
  const accounts = (await listAccounts(db, sub, bookId)).filter((a) => a.state === 'open' && !(a.source === 'plaid' && !linked.has(a.linkId)));
  const months = Array.from({ length: STATEMENT_REACH_MONTHS + 1 }, (_, back) => addMonths(month, -back));
  const bills = await listBills(db, sub, bookId), events = await listEvents(db, sub, bookId, [month]), byId = new Map(bills.map((bill) => [bill.billId, bill]));
  return {
    accounts, linked, imports: await listImports(db, sub, bookId), window: await listMonths(db, sub, bookId, months),
    view: await readMonth(db, sub, bookId, month, today),
    due: events.filter((e) => e.state === 'due' && byId.get(e.billId)?.state === 'confirmed').map((e) => dueOf(byId.get(e.billId) as Bill, e, today)),
  };
}

/**
 * @description The four checks of a month's close, each passed or with what is still open.
 * @param records - What the close read.
 * @param month - YYYY-MM.
 * @returns The checks, in the order the screen shows them.
 */
function closeChecks(records: CloseRecords, month: string): Array<Record<string, unknown>> {
  const toReview = records.window.filter((t) => t.month === month && t.review === 'new').length;
  const statements = records.accounts.map((account) => statementCheck(account, records.imports, records.window, month));
  return [
    accountsUpdated(records.accounts, month),
    { id: 'nothing-to-review', label: 'Nothing is left to review', ok: toReview === 0, open: toReview, view: 'transactions', query: `month=${month}&review=new` },
    { id: 'bills-answered', label: 'Every bill is answered', ok: !records.due.length, open: records.due, view: 'bills' },
    { id: 'statements-match', label: 'Each account adds up to its statement', ok: !statements.some((s) => s.state === 'differs'), accounts: statements, view: 'accounts' },
  ];
}

/**
 * @description How many months in a row are closed, counting back from the latest. The run still
 * counts while last month waits to be closed, and is over once a whole month was skipped.
 * @param closes - The person's closes.
 * @param today - YYYY-MM-DD.
 * @returns The count.
 */
export function closeStreak(closes: MonthClose[], today: string): number {
  const closed = closes.filter((c) => c.kind === 'month' && c.state === 'closed').map((c) => c.period).sort().reverse();
  if (!closed.length || closed[0] < addMonths(monthOf(today), -2)) return 0;
  let run = 1;
  while (run < closed.length && closed[run] === addMonths(closed[run - 1], -1)) run += 1;
  return run;
}

/**
 * @description The close of a month as the screen reads it before the person confirms: whether it
 * can be closed, the four checks, and the summary that would be kept.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param month - YYYY-MM.
 * @param today - YYYY-MM-DD.
 * @returns The close preview.
 */
export async function previewClose(db: LedgerDb, sub: string, bookId: string, month: string, today: string): Promise<Record<string, unknown>> {
  const book = await readBook(db, sub, bookId), records = await closeRecords(db, sub, bookId, month, today), checks = closeChecks(records, month);
  const closed = Boolean(book?.closedThrough && month <= book.closedThrough), over = month < monthOf(today);
  const worth = netWorth(records.accounts, records.linked);
  return {
    book: bookId, asOf: today, month, label: monthWords(month), closed, over, canClose: over && !closed, canReopen: book?.closedThrough === month,
    checks, openChecks: checks.filter((check) => !check.ok).length,
    summary: { month, in: records.view.in, out: records.view.out, groups: records.view.groups, categories: records.view.categories, netWorth: worth.net, worth },
    streak: { monthsClosed: closeStreak(await listCloses(db, sub, bookId), today) },
  };
}

/** How net worth moved since the month before, when both are known. */
function sincePrevious(closes: MonthClose[], month: string, worth: Figure | null): Record<string, unknown> | null {
  const before = closes.find((c) => c.kind === 'month' && c.state === 'closed' && c.period === addMonths(month, -1));
  if (!worth || !before?.netWorth || before.netWorth.currency !== worth.currency) return null;
  const delta = worth.cents - before.netWorth.cents;
  return { since: before.period, sinceLabel: monthWords(before.period), direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same', amount: figure(Math.abs(delta), worth.currency, 'Your closed months', 'closed', worth.asOf, worth.posture || '') };
}

/**
 * @description Close a month: keep its totals, net worth and every account's balance as they stand,
 * and lock its records. A month with a check still open closes only when the person says so.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param month - YYYY-MM.
 * @param today - YYYY-MM-DD.
 * @param closeAnyway - The person's word that open checks may stay open.
 * @returns What the screen says after the close.
 */
export async function closeMonth(db: LedgerDb, sub: string, bookId: string, month: string, today: string, closeAnyway: boolean): Promise<Record<string, unknown>> {
  const preview = await previewClose(db, sub, bookId, month, today), words = monthWords(month);
  if (preview.closed) throw new LedgerRefusal(409, 'already_closed', `${words} is already closed.`);
  if (!preview.over) throw new LedgerRefusal(409, 'month_not_over', `${words} is not over yet.`);
  const open = (preview.checks as Array<Record<string, unknown>>).filter((check) => !check.ok);
  if (open.length && !closeAnyway) {
    throw new LedgerRefusal(409, 'checks_open', `${words} still has something open: ${open.map((check) => String(check.label).toLowerCase()).join('; ')}. Finish these, or close the month anyway.`);
  }
  const summary = preview.summary as Record<string, unknown>, book = await ensureBook(db, sub, bookId), closes = await listCloses(db, sub, bookId);
  const worth = summary.netWorth as Figure | null;
  await keepClose(db, sub, {
    closeId: hashId('close', sub, bookId, 'month', month), bookId, kind: 'month', period: month, state: 'closed', in: summary.in as Figure | null,
    out: summary.out as Figure | null, netWorth: worth, summary: { ...summary, checks: preview.checks, closedWithOpenChecks: open.length }, closedAt: nowStamp(), reopenedAt: null,
  });
  await saveBook(db, sub, { ...book, closedThrough: month });
  const streak = closeStreak(await listCloses(db, sub, bookId), today);
  return { ok: true, month, label: words, line: `${words} closed.`, change: sincePrevious(closes, month, worth), streak: { monthsClosed: streak }, closedWithOpenChecks: open.length };
}

/**
 * @description Reopen the last closed month so its records can change again.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param month - YYYY-MM.
 * @returns What the screen says after the reopening.
 */
export async function reopenMonth(db: LedgerDb, sub: string, bookId: string, month: string): Promise<Record<string, unknown>> {
  const book = await readBook(db, sub, bookId), closes = await listCloses(db, sub, bookId);
  if (!book?.closedThrough || month > book.closedThrough) throw new LedgerRefusal(409, 'not_closed', `${monthWords(month)} is not closed.`);
  if (month !== book.closedThrough) throw new LedgerRefusal(409, 'not_latest', `Only the last closed month can be reopened: ${monthWords(book.closedThrough)}.`);
  const held = closes.find((c) => c.kind === 'month' && c.period === month);
  if (held) await keepClose(db, sub, { ...held, state: 'reopened', reopenedAt: nowStamp() });
  const earlier = closes.filter((c) => c.kind === 'month' && c.state === 'closed' && c.period < month).map((c) => c.period).sort().pop() || null;
  await saveBook(db, sub, { ...book, closedThrough: earlier });
  return { ok: true, month, label: monthWords(month), line: `${monthWords(month)} is open again.`, closedThrough: earlier };
}

/** A close as a screen reads it. */
function closeCard(c: MonthClose): Record<string, unknown> {
  return { period: c.period, label: c.kind === 'month' ? monthWords(c.period) : c.period, state: c.state, closedAt: c.closedAt, reopenedAt: c.reopenedAt, in: c.in, out: c.out, netWorth: c.netWorth };
}

/** Record that a year's pack is done, so the day stops offering it. */
async function finishYearPack(db: LedgerDb, sub: string, bookId: string, year: string, today: string): Promise<Record<string, unknown>> {
  if (!/^\d{4}$/.test(year) || year >= today.slice(0, 4)) throw new LedgerRefusal(400, 'bad_year', 'A year pack is for a year that has ended.');
  await ensureBook(db, sub, bookId);
  await keepClose(db, sub, { closeId: hashId('close', sub, bookId, 'year-pack', year), bookId, kind: 'year-pack', period: year, state: 'closed', in: null, out: null, netWorth: null, summary: null, closedAt: nowStamp(), reopenedAt: null });
  return { ok: true, year: Number(year) };
}

/* ─── the routes ────────────────────────────────────────────────────────────── */

/**
 * @description The month routes, mounted at /api/finance/month.
 * @param ctx - The application context (its pool).
 * @returns The router.
 */
export function createFinanceMonthRoutes(ctx: AppContext): Router {
  const router = Router();
  const db = ctx.pool as unknown as LedgerDb;
  const monthOfRequest = (value: unknown, today: string, fallbackBack: number): string => monthParam(value, addMonths(monthOf(today), -fallbackBack));

  /** GET /?month=YYYY-MM — the month so far against its plan (this month when none is named). */
  router.get('/', route('month', async (sub, req) => {
    const bookId = bookOf(req), today = dayOf(req), month = monthOfRequest((req.query as Record<string, unknown>).month, today, 0);
    return { book: bookId, asOf: today, month: await readMonth(db, sub, bookId, month, today), streak: { monthsClosed: closeStreak(await listCloses(db, sub, bookId), today) } };
  }));

  /** POST /plan — set a month's plan: income, everything else, the lowest balance to keep, and category lines. */
  router.post('/plan', route('month.plan', async (sub, req) => {
    const bookId = bookOf(req), today = dayOf(req), body = bodyOf(req), month = monthOfRequest(body.month, today, 0);
    const done = await setPlan(db, sub, bookId, month, body, today);
    return { ok: true, ...done, month: await readMonth(db, sub, bookId, month, today) };
  }));

  /** GET /close?month=YYYY-MM — the four checks and the summary of a month's close (last month when none is named). */
  router.get('/close', route('month.close.preview', async (sub, req) => {
    const today = dayOf(req);
    return previewClose(db, sub, bookOf(req), monthOfRequest((req.query as Record<string, unknown>).month, today, 1), today);
  }));

  /** POST /close — close a month (confirm: true; closeAnyway: true when a check is still open). */
  router.post('/close', route('month.close', async (sub, req) => {
    const body = bodyOf(req), today = dayOf(req), month = monthOfRequest(body.month, today, 1);
    requireConfirm(body, `Closing ${monthWords(month)}`);
    return closeMonth(db, sub, bookOf(req), month, today, body.closeAnyway === true);
  }));

  /** POST /reopen — reopen the last closed month (confirm: true). */
  router.post('/reopen', route('month.reopen', async (sub, req) => {
    const body = bodyOf(req);
    if (!isMonth(body.month)) throw new LedgerRefusal(400, 'bad_month', 'Say which month to reopen.');
    requireConfirm(body, `Reopening ${monthWords(body.month)}`);
    return reopenMonth(db, sub, bookOf(req), body.month);
  }));

  /** GET /closes — every closed month with its totals and net worth, finished year packs, and the run of closed months. */
  router.get('/closes', route('month.closes', async (sub, req) => {
    const bookId = bookOf(req), today = dayOf(req), closes = await listCloses(db, sub, bookId);
    return {
      book: bookId, asOf: today, months: closes.filter((c) => c.kind === 'month').map(closeCard),
      yearPacks: closes.filter((c) => c.kind === 'year-pack').map(closeCard), streak: { monthsClosed: closeStreak(closes, today) },
    };
  }));

  /** POST /year-pack — the person finished a year's pack (confirm: true); the day stops offering it. */
  router.post('/year-pack', route('month.year-pack', async (sub, req) => {
    const body = bodyOf(req);
    requireConfirm(body, 'Marking the year pack done');
    return finishYearPack(db, sub, bookOf(req), String(body.year || ''), dayOf(req));
  }));

  return router;
}
