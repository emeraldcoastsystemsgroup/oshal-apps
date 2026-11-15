"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The month, mounted at /api/finance/month (Roger, 2026-11-12: Finance as a person's money day). The month so far against the person's own plan: income, bills, goals and everything else, each planned against actual, spending by category in the person's own words, and what is left to spend with what it is made of. The plan is what the person typed; a month with no plan has no "left to spend", never a guess. The close runs four checks (every account updated to the month's end, nothing left to review, every bill answered, each account's statement adding up from the one before) and keeps the month's totals, net worth and every account's balance with its date and source as they stood; it needs the person's confirmation, says so when a check is still open, and a closed month is changed only after "Reopen". Closed months in a row are counted. Every amount is a figure with its source and date. Nothing here moves money or advises. The GETs only read.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MONTH_SQL = exports.STATEMENT_REACH_MONTHS = exports.MONTH_END_GRACE_DAYS = exports.PLAN_LINES = void 0;
exports.listLines = listLines;
exports.keepLine = keepLine;
exports.listCloses = listCloses;
exports.linkedItems = linkedItems;
exports.monthView = monthView;
exports.readMonth = readMonth;
exports.setPlan = setPlan;
exports.carryPlan = carryPlan;
exports.closeStreak = closeStreak;
exports.previewClose = previewClose;
exports.closeMonth = closeMonth;
exports.reopenMonth = reopenMonth;
exports.createFinanceMonthRoutes = createFinanceMonthRoutes;
/**
 * @module finance-month
 */
const express_1 = require("express");
const finance_ledger_store_1 = require("./finance-ledger-store");
const finance_day_model_1 = require("./finance-day-model");
const finance_day_kit_1 = require("./finance-day-kit");
const finance_bills_1 = require("./finance-bills");
const finance_goals_1 = require("./finance-goals");
/** The plan lines Finance itself reads; any other line is a category in the person's own words. */
exports.PLAN_LINES = Object.freeze(['income', 'everything-else', 'floor']);
/** An account counts as updated to a month's end when its balance is dated within this many days of it, or later. */
exports.MONTH_END_GRACE_DAYS = 5;
/** A statement is checked against the one before it when that one is at most this many months back. */
exports.STATEMENT_REACH_MONTHS = 4;
const LINE_COLUMNS = 'line_id, user_sub, book_id, month, line, planned_cents, currency, set_on, source, source_label, posture, created_at, updated_at';
const CLOSE_COLUMNS = 'close_id, user_sub, book_id, kind, period, state, in_cents, out_cents, net_worth_cents, net_worth_as_of, currency, summary, closed_at, reopened_at, updated_at';
/** Every statement this module issues. The selective text equality comes first in each WHERE. */
exports.MONTH_SQL = Object.freeze({
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
function lineOf(row) {
    return {
        lineId: row.line_id, bookId: row.book_id, month: row.month, line: row.line, plannedCents: (0, finance_day_kit_1.wholeOrNull)(row.planned_cents),
        currency: row.currency || 'USD', setOn: row.set_on, source: row.source, sourceLabel: row.source_label || '', posture: row.posture || '',
    };
}
/** A stored close row as the record the modules use; its figures are kept whole in the summary. */
function closeOf(row) {
    const summary = (0, finance_day_kit_1.cell)(row.summary);
    return {
        closeId: row.close_id, bookId: row.book_id, kind: row.kind || 'month', period: row.period, state: row.state,
        in: summary?.in || null, out: summary?.out || null, netWorth: summary?.netWorth || null, summary,
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
async function listLines(db, sub, bookId, month) {
    const rows = (await db.query(exports.MONTH_SQL.linesByMonth, [month, sub, bookId])).rows;
    return rows.map(lineOf).sort((a, b) => a.line.localeCompare(b.line));
}
/**
 * @description Keep one plan line: add it, or replace the amount of the line with the same name.
 * @param db - The pool.
 * @param sub - The caller.
 * @param line - The line.
 * @returns Nothing.
 */
async function keepLine(db, sub, line) {
    const now = (0, finance_ledger_store_1.nowStamp)();
    try {
        await db.query(exports.MONTH_SQL.lineInsert, [line.lineId, sub, line.bookId, line.month, line.line, line.plannedCents, line.currency, line.setOn,
            line.source, line.sourceLabel, line.posture, now, now]);
    }
    catch (err) {
        if (!(0, finance_ledger_store_1.duplicateKey)(err))
            throw err;
        await db.query(exports.MONTH_SQL.lineUpdate, [line.lineId, sub, line.plannedCents, line.setOn, line.source, line.sourceLabel, line.posture, now]);
    }
}
/**
 * @description Every closed month and finished year pack in a set of records, newest first.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The closes.
 */
async function listCloses(db, sub, bookId) {
    const rows = (await db.query(exports.MONTH_SQL.closesByBook, [bookId, sub])).rows;
    return rows.map(closeOf).sort((a, b) => b.period.localeCompare(a.period) || a.closeId.localeCompare(b.closeId));
}
/** Keep a close: add it, or (for a period closed before and reopened) replace what it holds. */
async function keepClose(db, sub, c) {
    const worth = c.netWorth, now = (0, finance_ledger_store_1.nowStamp)();
    const totals = [c.in ? c.in.cents : null, c.out ? c.out.cents : null, worth ? worth.cents : null, worth ? worth.asOf : null];
    try {
        await db.query(exports.MONTH_SQL.closeInsert, [c.closeId, sub, c.bookId, c.kind, c.period, c.state, ...totals, 'USD', (0, finance_day_kit_1.jsonParam)(c.summary), c.closedAt, c.reopenedAt, now]);
    }
    catch (err) {
        if (!(0, finance_ledger_store_1.duplicateKey)(err))
            throw err;
        await db.query(exports.MONTH_SQL.closeUpdate, [c.closeId, sub, c.state, ...totals, (0, finance_day_kit_1.jsonParam)(c.summary), c.closedAt, c.reopenedAt, now]);
    }
}
/**
 * @description The ids of the caller's bank links, to tell a linked account from one whose bank was disconnected.
 * @param db - The pool.
 * @param sub - The caller.
 * @returns The link ids.
 */
async function linkedItems(db, sub) {
    const rows = (await db.query(exports.MONTH_SQL.linkedItems, [sub])).rows;
    return new Set(rows.map((row) => String(row.item_id)));
}
/* ─── the month against its plan ────────────────────────────────────────────── */
/** A plan line as a figure: planned, dated the day the person set it. */
function lineFigure(line) {
    return (0, finance_day_model_1.forward)((0, finance_ledger_store_1.figure)(line.plannedCents, line.currency, line.sourceLabel || 'Your plan', line.source, line.setOn, line.posture), 'planned');
}
/** One figure for several planned or estimated amounts; it reads Planned unless they all say the same thing. */
function plannedTotal(parts, words) {
    if (!parts.length)
        return null;
    const total = (0, finance_day_model_1.together)(parts.reduce((sum, part) => sum + part.cents, 0), parts, words, [...parts.map((part) => part.asOf)].sort()[0]);
    return total.posture ? total : (0, finance_day_model_1.forward)(total, 'planned');
}
/** The bills group: what this month's due dates are expected to cost, and what was paid. */
function billsGroup(input) {
    const byId = new Map(input.bills.map((bill) => [bill.billId, bill]));
    const dues = input.events.filter((e) => e.state !== 'skipped' && byId.has(e.billId)).map((e) => ({ event: e, due: (0, finance_bills_1.dueOf)(byId.get(e.billId), { ...e, state: 'due' }, input.today) }));
    const expected = dues.map((d) => d.due.amount).filter((f) => Boolean(f));
    const paid = input.events.filter((e) => e.state === 'paid' && byId.has(e.billId)).map((e) => (0, finance_bills_1.dueOf)(byId.get(e.billId), e, input.today).amount).filter((f) => Boolean(f));
    return {
        id: 'bills', label: 'Bills', planned: plannedTotal(expected, 'Your bills'),
        actual: paid.length ? (0, finance_day_model_1.together)(paid.reduce((sum, f) => sum + f.cents, 0), paid, 'Your records', [...paid.map((f) => f.asOf)].sort().pop()) : null,
        unknown: dues.filter((d) => !d.due.amount).map((d) => d.due.payee),
    };
}
/** The goals group: what the person plans to set aside each month, and what they set aside this month. */
function goalsGroup(input) {
    const open = input.goals.filter((goal) => goal.state === 'open');
    const plans = open.filter((goal) => goal.monthlyCents !== null).map((goal) => (0, finance_day_model_1.forward)((0, finance_ledger_store_1.figure)(goal.monthlyCents, goal.currency, goal.sourceLabel || 'Typed by you', goal.source, goal.updatedAt.slice(0, 10), goal.posture), 'planned'));
    const moves = input.moves.filter((move) => move.month === input.month);
    const kept = moves.map((move) => (0, finance_ledger_store_1.figure)(move.direction === 'in' ? move.amountCents : -move.amountCents, move.currency, move.posture === 'sample' ? move.sourceLabel || 'Sample data' : 'Set aside in Finance', move.source, move.date, move.posture));
    return {
        id: 'goals', label: 'Goals', planned: plannedTotal(plans, 'Your goals'),
        actual: kept.length ? (0, finance_day_model_1.together)(kept.reduce((sum, f) => sum + f.cents, 0), kept, 'Set aside in Finance', [...kept.map((f) => f.asOf)].sort().pop()) : null,
        unknown: open.filter((goal) => goal.monthlyCents === null).map((goal) => goal.name),
    };
}
/** What may be spent on everything else: the person's own line, else planned income less bills and goals. */
function allowance(lines, bills, goals) {
    const own = lines.find((line) => line.line === 'everything-else'), income = lines.find((line) => line.line === 'income');
    if (own)
        return { ...lineFigure(own), parts: [{ label: 'Planned for everything else', figure: lineFigure(own) }] };
    if (!income)
        return null;
    const parts = [{ label: 'Planned income', figure: lineFigure(income) }];
    if (bills.planned)
        parts.push({ label: 'Bills', figure: bills.planned });
    if (goals.planned)
        parts.push({ label: 'Goals', figure: goals.planned });
    const cents = income.plannedCents - (bills.planned ? bills.planned.cents : 0) - (goals.planned ? goals.planned.cents : 0);
    return { ...(0, finance_day_model_1.forward)((0, finance_ledger_store_1.figure)(cents, income.currency, 'Your plan', parts.length > 1 ? 'mixed' : income.source, income.setOn, income.posture), 'planned'), parts };
}
/** What is left to spend: the allowance less what was spent on everything else, true up to the newest record counted. */
function leftToSpend(allowed, spent) {
    if (!allowed)
        return null;
    const parts = [...(allowed.parts || [])];
    if (spent)
        parts.push({ label: 'Spent so far', figure: spent });
    const sample = allowed.posture === 'sample' ? 'sample' : '';
    const said = (0, finance_ledger_store_1.figure)(allowed.cents - (spent ? spent.cents : 0), allowed.currency, spent ? 'Your plan and your records' : allowed.source, spent ? 'mixed' : allowed.sourceKind, spent ? spent.asOf : allowed.asOf, sample);
    return { ...(0, finance_day_model_1.forward)(said, 'planned'), parts };
}
/** Spending by category, largest first, with the person's own planned amount where they set one. */
function byCategory(spending, lines) {
    const groups = new Map();
    for (const t of spending)
        groups.set(t.category || 'Other', [...(groups.get(t.category || 'Other') || []), t]);
    const own = lines.filter((line) => !exports.PLAN_LINES.includes(line.line)), planned = (name) => {
        const line = own.find((candidate) => (0, finance_ledger_store_1.matchText)(candidate.line) === (0, finance_ledger_store_1.matchText)(name));
        return line ? lineFigure(line) : null;
    };
    const rows = [...groups].map(([category, txns]) => ({ category, count: txns.length, amount: (0, finance_day_model_1.flowFigure)(txns), planned: planned(category) }));
    for (const line of own.filter((candidate) => ![...groups.keys()].some((name) => (0, finance_ledger_store_1.matchText)(name) === (0, finance_ledger_store_1.matchText)(candidate.line)))) {
        rows.push({ category: line.line, count: 0, amount: null, planned: lineFigure(line) });
    }
    return rows.sort((a, b) => (b.amount ? b.amount.cents : 0) - (a.amount ? a.amount.cents : 0) || a.category.localeCompare(b.category));
}
/** How many days of a month are left, counting today. */
function daysLeftIn(month, today) {
    if (month < (0, finance_ledger_store_1.monthOf)(today))
        return 0;
    return month > (0, finance_ledger_store_1.monthOf)(today) ? (0, finance_day_model_1.daysInMonth)(month) : (0, finance_day_model_1.daysInMonth)(month) - Number(today.slice(8, 10)) + 1;
}
/**
 * @description A month so far against its plan: the four groups planned against actual, spending by
 * category, and what is left to spend with its parts. Without a plan there is no "left to spend".
 * @param input - The month's records.
 * @returns The month view.
 */
function monthView(input) {
    const flows = input.transactions.filter(finance_day_model_1.isFlow), income = flows.filter((t) => t.direction === 'in'), spending = flows.filter((t) => t.direction === 'out');
    const incomeLine = input.lines.find((line) => line.line === 'income');
    const bills = billsGroup(input), goals = goalsGroup(input), allowed = allowance(input.lines, bills, goals);
    const other = (0, finance_day_model_1.flowFigure)(spending.filter((t) => !t.matchedBillId)), left = leftToSpend(allowed, other), daysLeft = daysLeftIn(input.month, input.today);
    return {
        month: input.month, label: (0, finance_ledger_store_1.monthWords)(input.month), closed: input.closed, hasPlan: Boolean(allowed), daysLeft,
        in: (0, finance_day_model_1.flowFigure)(income), out: (0, finance_day_model_1.flowFigure)(spending), left,
        perDay: left && left.cents > 0 && daysLeft > 0 ? { ...left, cents: Math.floor(left.cents / daysLeft), parts: undefined } : null,
        groups: [
            { id: 'income', label: 'Income', planned: incomeLine ? lineFigure(incomeLine) : null, actual: (0, finance_day_model_1.flowFigure)(income), unknown: [] },
            bills, goals,
            { id: 'everything-else', label: 'Everything else', planned: allowed ? { ...allowed, parts: undefined } : null, actual: other, unknown: [] },
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
async function readMonth(db, sub, bookId, month, today) {
    const book = await (0, finance_ledger_store_1.readBook)(db, sub, bookId);
    return monthView({
        month, today, closed: Boolean(book?.closedThrough && month <= book.closedThrough),
        transactions: await (0, finance_ledger_store_1.listTransactions)(db, sub, bookId, month), bills: await (0, finance_bills_1.listBills)(db, sub, bookId),
        events: await (0, finance_bills_1.listEvents)(db, sub, bookId, [month]), goals: await (0, finance_goals_1.listGoals)(db, sub, bookId), moves: await (0, finance_goals_1.listMoves)(db, sub, bookId),
        lines: await listLines(db, sub, bookId, month),
    });
}
/* ─── the plan ──────────────────────────────────────────────────────────────── */
/** The lines a plan request names: the three Finance reads, and any category lines. */
function requestedLines(body) {
    const lines = [];
    for (const [key, line] of [['incomeCents', 'income'], ['everythingElseCents', 'everything-else'], ['floorCents', 'floor']]) {
        if (body[key] !== undefined)
            lines.push({ line, cents: (0, finance_day_kit_1.centsOf)(body[key], 'The planned amount') });
    }
    for (const entry of Array.isArray(body.lines) ? body.lines : []) {
        const name = (0, finance_ledger_store_1.cleanText)(entry?.line, 60);
        if (!name || exports.PLAN_LINES.includes((0, finance_ledger_store_1.matchText)(name)))
            throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_line', 'Name the category this planned amount is for.');
        lines.push({ line: name, cents: (0, finance_day_kit_1.centsOf)(entry.plannedCents, 'The planned amount') });
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
async function setPlan(db, sub, bookId, month, body, today) {
    const lines = requestedLines(body);
    if (!lines.length)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'plan_required', 'Type at least your income for the month.');
    (0, finance_ledger_store_1.assertMonthOpen)(await (0, finance_ledger_store_1.ensureBook)(db, sub, bookId), month);
    let kept = 0, removed = 0;
    for (const { line, cents } of lines) {
        const lineId = (0, finance_ledger_store_1.hashId)('line', sub, bookId, month, (0, finance_ledger_store_1.matchText)(line));
        if (cents === null) {
            await db.query(exports.MONTH_SQL.lineDelete, [lineId, sub]);
            removed += 1;
            continue;
        }
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
async function carryPlan(db, sub, bookId, month, today) {
    if ((await listLines(db, sub, bookId, month)).length)
        return 0;
    const before = (0, finance_day_model_1.addMonths)(month, -1), earlier = await listLines(db, sub, bookId, before);
    for (const line of earlier) {
        const label = line.posture === 'sample' ? line.sourceLabel : `Your plan, carried over from ${(0, finance_ledger_store_1.monthWords)(before)}`;
        await keepLine(db, sub, { ...line, lineId: (0, finance_ledger_store_1.hashId)('line', sub, bookId, month, (0, finance_ledger_store_1.matchText)(line.line)), month, setOn: today, sourceLabel: label });
    }
    return earlier.length;
}
/* ─── the close ─────────────────────────────────────────────────────────────── */
/** A statement's closing balance in the account's own terms: for a card or a loan, the amount owed. */
function statementBalance(account, statement) {
    const closing = statement.closingBalanceCents;
    return finance_ledger_store_1.OWED_TYPES.includes(account.type) && statement.kind === 'ofx' ? -closing : closing;
}
/** One account's statement for a month against the statement before it and the transactions between them. */
function statementCheck(account, imports, txns, month) {
    const base = { accountId: account.accountId, name: account.name };
    const statements = imports.filter((i) => i.accountId === account.accountId && i.state === 'applied' && i.closingBalanceCents !== null && i.closingBalanceAsOf)
        .sort((a, b) => a.closingBalanceAsOf.localeCompare(b.closingBalanceAsOf));
    const current = statements.filter((i) => (0, finance_ledger_store_1.monthOf)(i.closingBalanceAsOf) === month).pop();
    if (account.type === 'investment')
        return { ...base, state: 'not-checked', reason: 'An investment account changes with the market, so its statement is not added up.' };
    if (!current)
        return { ...base, state: 'not-checked', reason: `No statement that closes in ${(0, finance_ledger_store_1.monthWords)(month)} is in your records.` };
    const to = current.closingBalanceAsOf, earlier = statements.filter((i) => i.closingBalanceAsOf < to).pop();
    if (!earlier)
        return { ...base, state: 'not-checked', to, reason: 'There is no earlier statement to start from.' };
    const from = earlier.closingBalanceAsOf;
    if ((0, finance_ledger_store_1.monthOf)(from) < (0, finance_day_model_1.addMonths)(month, -exports.STATEMENT_REACH_MONTHS))
        return { ...base, state: 'not-checked', to, reason: 'The statement before this one is too far back to add up from.' };
    const between = txns.filter((t) => t.accountId === account.accountId && t.date > from && t.date <= to);
    const moved = between.reduce((sum, t) => sum + (t.direction === 'in' ? t.amountCents : -t.amountCents), 0) * (finance_ledger_store_1.OWED_TYPES.includes(account.type) ? -1 : 1);
    const difference = statementBalance(account, current) - (statementBalance(account, earlier) + moved);
    const label = `${account.institution || account.name} statement`;
    return {
        ...base, state: difference === 0 ? 'matches' : 'differs', from, to, statement: (0, finance_ledger_store_1.figure)(statementBalance(account, current), account.currency, label, 'import', to),
        difference: difference === 0 ? null : (0, finance_ledger_store_1.figure)(difference, account.currency, `${label} and your records`, 'mixed', to),
    };
}
/** The first of the four checks: every account's balance is dated at the month's end or later. */
function accountsUpdated(accounts, month) {
    const end = (0, finance_day_model_1.addDays)((0, finance_day_model_1.dayInMonth)(month, 31), -exports.MONTH_END_GRACE_DAYS);
    const open = accounts.filter((a) => !a.balanceAsOf || a.balanceAsOf < end).map((a) => ({ accountId: a.accountId, name: a.name, balanceAsOf: a.balanceAsOf }));
    return { id: 'accounts-updated', label: `Every account is updated to the end of ${(0, finance_ledger_store_1.monthWords)(month)}`, ok: !open.length, open, view: 'accounts' };
}
/** Read what the four checks and the summary need: the month, and the months a statement may reach back over. */
async function closeRecords(db, sub, bookId, month, today) {
    const linked = await linkedItems(db, sub);
    const accounts = (await (0, finance_ledger_store_1.listAccounts)(db, sub, bookId)).filter((a) => a.state === 'open' && !(a.source === 'plaid' && !linked.has(a.linkId)));
    const months = Array.from({ length: exports.STATEMENT_REACH_MONTHS + 1 }, (_, back) => (0, finance_day_model_1.addMonths)(month, -back));
    const bills = await (0, finance_bills_1.listBills)(db, sub, bookId), events = await (0, finance_bills_1.listEvents)(db, sub, bookId, [month]), byId = new Map(bills.map((bill) => [bill.billId, bill]));
    return {
        accounts, linked, imports: await (0, finance_ledger_store_1.listImports)(db, sub, bookId), window: await (0, finance_ledger_store_1.listMonths)(db, sub, bookId, months),
        view: await readMonth(db, sub, bookId, month, today),
        due: events.filter((e) => e.state === 'due' && byId.get(e.billId)?.state === 'confirmed').map((e) => (0, finance_bills_1.dueOf)(byId.get(e.billId), e, today)),
    };
}
/**
 * @description The four checks of a month's close, each passed or with what is still open.
 * @param records - What the close read.
 * @param month - YYYY-MM.
 * @returns The checks, in the order the screen shows them.
 */
function closeChecks(records, month) {
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
function closeStreak(closes, today) {
    const closed = closes.filter((c) => c.kind === 'month' && c.state === 'closed').map((c) => c.period).sort().reverse();
    if (!closed.length || closed[0] < (0, finance_day_model_1.addMonths)((0, finance_ledger_store_1.monthOf)(today), -2))
        return 0;
    let run = 1;
    while (run < closed.length && closed[run] === (0, finance_day_model_1.addMonths)(closed[run - 1], -1))
        run += 1;
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
async function previewClose(db, sub, bookId, month, today) {
    const book = await (0, finance_ledger_store_1.readBook)(db, sub, bookId), records = await closeRecords(db, sub, bookId, month, today), checks = closeChecks(records, month);
    const closed = Boolean(book?.closedThrough && month <= book.closedThrough), over = month < (0, finance_ledger_store_1.monthOf)(today);
    const worth = (0, finance_day_model_1.netWorth)(records.accounts, records.linked);
    return {
        book: bookId, asOf: today, month, label: (0, finance_ledger_store_1.monthWords)(month), closed, over, canClose: over && !closed, canReopen: book?.closedThrough === month,
        checks, openChecks: checks.filter((check) => !check.ok).length,
        summary: { month, in: records.view.in, out: records.view.out, groups: records.view.groups, categories: records.view.categories, netWorth: worth.net, worth },
        streak: { monthsClosed: closeStreak(await listCloses(db, sub, bookId), today) },
    };
}
/** How net worth moved since the month before, when both are known. */
function sincePrevious(closes, month, worth) {
    const before = closes.find((c) => c.kind === 'month' && c.state === 'closed' && c.period === (0, finance_day_model_1.addMonths)(month, -1));
    if (!worth || !before?.netWorth || before.netWorth.currency !== worth.currency)
        return null;
    const delta = worth.cents - before.netWorth.cents;
    return { since: before.period, sinceLabel: (0, finance_ledger_store_1.monthWords)(before.period), direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same', amount: (0, finance_ledger_store_1.figure)(Math.abs(delta), worth.currency, 'Your closed months', 'closed', worth.asOf, worth.posture || '') };
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
async function closeMonth(db, sub, bookId, month, today, closeAnyway) {
    const preview = await previewClose(db, sub, bookId, month, today), words = (0, finance_ledger_store_1.monthWords)(month);
    if (preview.closed)
        throw new finance_ledger_store_1.LedgerRefusal(409, 'already_closed', `${words} is already closed.`);
    if (!preview.over)
        throw new finance_ledger_store_1.LedgerRefusal(409, 'month_not_over', `${words} is not over yet.`);
    const open = preview.checks.filter((check) => !check.ok);
    if (open.length && !closeAnyway) {
        throw new finance_ledger_store_1.LedgerRefusal(409, 'checks_open', `${words} still has something open: ${open.map((check) => String(check.label).toLowerCase()).join('; ')}. Finish these, or close the month anyway.`);
    }
    const summary = preview.summary, book = await (0, finance_ledger_store_1.ensureBook)(db, sub, bookId), closes = await listCloses(db, sub, bookId);
    const worth = summary.netWorth;
    await keepClose(db, sub, {
        closeId: (0, finance_ledger_store_1.hashId)('close', sub, bookId, 'month', month), bookId, kind: 'month', period: month, state: 'closed', in: summary.in,
        out: summary.out, netWorth: worth, summary: { ...summary, checks: preview.checks, closedWithOpenChecks: open.length }, closedAt: (0, finance_ledger_store_1.nowStamp)(), reopenedAt: null,
    });
    await (0, finance_ledger_store_1.saveBook)(db, sub, { ...book, closedThrough: month });
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
async function reopenMonth(db, sub, bookId, month) {
    const book = await (0, finance_ledger_store_1.readBook)(db, sub, bookId), closes = await listCloses(db, sub, bookId);
    if (!book?.closedThrough || month > book.closedThrough)
        throw new finance_ledger_store_1.LedgerRefusal(409, 'not_closed', `${(0, finance_ledger_store_1.monthWords)(month)} is not closed.`);
    if (month !== book.closedThrough)
        throw new finance_ledger_store_1.LedgerRefusal(409, 'not_latest', `Only the last closed month can be reopened: ${(0, finance_ledger_store_1.monthWords)(book.closedThrough)}.`);
    const held = closes.find((c) => c.kind === 'month' && c.period === month);
    if (held)
        await keepClose(db, sub, { ...held, state: 'reopened', reopenedAt: (0, finance_ledger_store_1.nowStamp)() });
    const earlier = closes.filter((c) => c.kind === 'month' && c.state === 'closed' && c.period < month).map((c) => c.period).sort().pop() || null;
    await (0, finance_ledger_store_1.saveBook)(db, sub, { ...book, closedThrough: earlier });
    return { ok: true, month, label: (0, finance_ledger_store_1.monthWords)(month), line: `${(0, finance_ledger_store_1.monthWords)(month)} is open again.`, closedThrough: earlier };
}
/** A close as a screen reads it. */
function closeCard(c) {
    return { period: c.period, label: c.kind === 'month' ? (0, finance_ledger_store_1.monthWords)(c.period) : c.period, state: c.state, closedAt: c.closedAt, reopenedAt: c.reopenedAt, in: c.in, out: c.out, netWorth: c.netWorth };
}
/** Record that a year's pack is done, so the day stops offering it. */
async function finishYearPack(db, sub, bookId, year, today) {
    if (!/^\d{4}$/.test(year) || year >= today.slice(0, 4))
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_year', 'A year pack is for a year that has ended.');
    await (0, finance_ledger_store_1.ensureBook)(db, sub, bookId);
    await keepClose(db, sub, { closeId: (0, finance_ledger_store_1.hashId)('close', sub, bookId, 'year-pack', year), bookId, kind: 'year-pack', period: year, state: 'closed', in: null, out: null, netWorth: null, summary: null, closedAt: (0, finance_ledger_store_1.nowStamp)(), reopenedAt: null });
    return { ok: true, year: Number(year) };
}
/* ─── the routes ────────────────────────────────────────────────────────────── */
/**
 * @description The month routes, mounted at /api/finance/month.
 * @param ctx - The application context (its pool).
 * @returns The router.
 */
function createFinanceMonthRoutes(ctx) {
    const router = (0, express_1.Router)();
    const db = ctx.pool;
    const monthOfRequest = (value, today, fallbackBack) => (0, finance_day_kit_1.monthParam)(value, (0, finance_day_model_1.addMonths)((0, finance_ledger_store_1.monthOf)(today), -fallbackBack));
    /** GET /?month=YYYY-MM — the month so far against its plan (this month when none is named). */
    router.get('/', (0, finance_day_kit_1.route)('month', async (sub, req) => {
        const bookId = (0, finance_day_kit_1.bookOf)(req), today = (0, finance_day_kit_1.dayOf)(req), month = monthOfRequest(req.query.month, today, 0);
        return { book: bookId, asOf: today, month: await readMonth(db, sub, bookId, month, today), streak: { monthsClosed: closeStreak(await listCloses(db, sub, bookId), today) } };
    }));
    /** POST /plan — set a month's plan: income, everything else, the lowest balance to keep, and category lines. */
    router.post('/plan', (0, finance_day_kit_1.route)('month.plan', async (sub, req) => {
        const bookId = (0, finance_day_kit_1.bookOf)(req), today = (0, finance_day_kit_1.dayOf)(req), body = (0, finance_day_kit_1.bodyOf)(req), month = monthOfRequest(body.month, today, 0);
        const done = await setPlan(db, sub, bookId, month, body, today);
        return { ok: true, ...done, month: await readMonth(db, sub, bookId, month, today) };
    }));
    /** GET /close?month=YYYY-MM — the four checks and the summary of a month's close (last month when none is named). */
    router.get('/close', (0, finance_day_kit_1.route)('month.close.preview', async (sub, req) => {
        const today = (0, finance_day_kit_1.dayOf)(req);
        return previewClose(db, sub, (0, finance_day_kit_1.bookOf)(req), monthOfRequest(req.query.month, today, 1), today);
    }));
    /** POST /close — close a month (confirm: true; closeAnyway: true when a check is still open). */
    router.post('/close', (0, finance_day_kit_1.route)('month.close', async (sub, req) => {
        const body = (0, finance_day_kit_1.bodyOf)(req), today = (0, finance_day_kit_1.dayOf)(req), month = monthOfRequest(body.month, today, 1);
        (0, finance_day_kit_1.requireConfirm)(body, `Closing ${(0, finance_ledger_store_1.monthWords)(month)}`);
        return closeMonth(db, sub, (0, finance_day_kit_1.bookOf)(req), month, today, body.closeAnyway === true);
    }));
    /** POST /reopen — reopen the last closed month (confirm: true). */
    router.post('/reopen', (0, finance_day_kit_1.route)('month.reopen', async (sub, req) => {
        const body = (0, finance_day_kit_1.bodyOf)(req);
        if (!(0, finance_ledger_store_1.isMonth)(body.month))
            throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_month', 'Say which month to reopen.');
        (0, finance_day_kit_1.requireConfirm)(body, `Reopening ${(0, finance_ledger_store_1.monthWords)(body.month)}`);
        return reopenMonth(db, sub, (0, finance_day_kit_1.bookOf)(req), body.month);
    }));
    /** GET /closes — every closed month with its totals and net worth, finished year packs, and the run of closed months. */
    router.get('/closes', (0, finance_day_kit_1.route)('month.closes', async (sub, req) => {
        const bookId = (0, finance_day_kit_1.bookOf)(req), today = (0, finance_day_kit_1.dayOf)(req), closes = await listCloses(db, sub, bookId);
        return {
            book: bookId, asOf: today, months: closes.filter((c) => c.kind === 'month').map(closeCard),
            yearPacks: closes.filter((c) => c.kind === 'year-pack').map(closeCard), streak: { monthsClosed: closeStreak(closes, today) },
        };
    }));
    /** POST /year-pack — the person finished a year's pack (confirm: true); the day stops offering it. */
    router.post('/year-pack', (0, finance_day_kit_1.route)('month.year-pack', async (sub, req) => {
        const body = (0, finance_day_kit_1.bodyOf)(req);
        (0, finance_day_kit_1.requireConfirm)(body, 'Marking the year pack done');
        return finishYearPack(db, sub, (0, finance_day_kit_1.bookOf)(req), String(body.year || ''), (0, finance_day_kit_1.dayOf)(req));
    }));
    return router;
}
//# sourceMappingURL=finance-month.js.map