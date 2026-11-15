"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Finance 1.7.0 (Lane FINH1b, 2026-11-14): "where do I stand", mounted at /api/finance/day. GET / reads the person's own records (accounts, this month and the two before, bills, goals, the month against its plan, closed months) and answers the day the model in finance-day-model.ts works out: what is new to review, what is unusual, bills overdue and coming due, the month so far, goals, net worth with its oldest date, and whether this is the first run. It only reads. afterRecordsChange() is what the ledger's writes call once records changed: it proposes a bill for each repeating charge the person has no bill for and marks due dates paid by matching charges, within the time the caller allows, so a proposal is never made on a GET. Nothing here moves money.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readDay = readDay;
exports.afterRecordsChange = afterRecordsChange;
exports.createFinanceDayRoutes = createFinanceDayRoutes;
/**
 * @module finance-day
 */
const express_1 = require("express");
const finance_ledger_store_1 = require("./finance-ledger-store");
const finance_bills_1 = require("./finance-bills");
const finance_goals_1 = require("./finance-goals");
const finance_month_1 = require("./finance-month");
const finance_day_model_1 = require("./finance-day-model");
const finance_day_kit_1 = require("./finance-day-kit");
const finance_ledger_store_2 = require("./finance-ledger-store");
/** The floor the person planned for this month (the least they want left in cash), as a planned figure. */
async function floorOf(db, sub, bookId, month) {
    const line = (await (0, finance_month_1.listLines)(db, sub, bookId, month)).find((l) => l.line === 'floor');
    if (!line || line.plannedCents === null)
        return null;
    return (0, finance_day_model_1.forward)((0, finance_ledger_store_2.figure)(line.plannedCents, line.currency, line.sourceLabel || 'Your plan', line.source, line.setOn, line.posture), 'planned');
}
/**
 * @description Read everything the day needs and answer it. Only reads.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param today - YYYY-MM-DD.
 * @returns The answer of GET /api/finance/day.
 */
async function readDay(db, sub, bookId, today) {
    const book = await (0, finance_ledger_store_1.readBook)(db, sub, bookId);
    const accounts = await (0, finance_ledger_store_1.listAccounts)(db, sub, bookId);
    const transactions = await (0, finance_ledger_store_1.listMonths)(db, sub, bookId, (0, finance_day_model_1.recentMonths)(today, finance_day_model_1.DAY_MONTHS));
    const bills = (0, finance_bills_1.billLists)(await (0, finance_bills_1.listBills)(db, sub, bookId), await (0, finance_bills_1.listEvents)(db, sub, bookId, (0, finance_bills_1.eventMonths)(today)), today);
    const closes = await (0, finance_month_1.listCloses)(db, sub, bookId);
    return (0, finance_day_model_1.buildDay)({
        bookId, today, currency: book?.currency || accounts[0]?.currency || 'USD', accounts, linked: await (0, finance_month_1.linkedItems)(db, sub), transactions,
        bills: { proposed: bills.proposed, overdue: bills.overdue, week: bills.week, later: bills.later },
        goals: await (0, finance_goals_1.goalsWithProgress)(db, sub, bookId, today), month: await (0, finance_month_1.readMonth)(db, sub, bookId, (0, finance_ledger_store_2.monthOf)(today), today),
        floor: await floorOf(db, sub, bookId, (0, finance_ledger_store_2.monthOf)(today)), closedThrough: book?.closedThrough || null, closes,
        streak: (0, finance_month_1.closeStreak)(closes, today), bookCreatedAt: null,
    });
}
/**
 * @description After the records changed (an import applied or undone, a transaction typed or
 * changed): propose a bill for each repeating charge the person has no bill for, and mark due dates
 * paid by matching charges. Bounded by stopAt so it fits inside the request that made the change.
 * A failure here never undoes the change that was made; the next change tries again.
 * @param db - The pool.
 * @param sub - The caller.
 * @param today - YYYY-MM-DD.
 * @param stopAt - The clock time (ms) after which nothing new is started.
 * @returns How many bills were proposed, and how many due dates were found paid.
 */
async function afterRecordsChange(db, sub, today, stopAt) {
    const txns = await (0, finance_ledger_store_1.listMonths)(db, sub, finance_ledger_store_1.HOME_BOOK, (0, finance_day_model_1.recentMonths)(today, finance_day_model_1.DAY_MONTHS));
    const proposed = Date.now() < stopAt ? await (0, finance_bills_1.proposeBills)(db, sub, finance_ledger_store_1.HOME_BOOK, (0, finance_day_model_1.findRepeating)(txns, 'out')) : 0;
    const settled = Date.now() < stopAt ? await (0, finance_bills_1.syncBills)(db, sub, finance_ledger_store_1.HOME_BOOK, today, txns, stopAt) : { paid: 0 };
    return { proposed, paid: settled.paid };
}
/**
 * @description The day's routes. GET / only reads.
 * @param ctx - The application context (its pool is the person's own records).
 * @returns The router mounted at /api/finance/day.
 */
function createFinanceDayRoutes(ctx) {
    const router = (0, express_1.Router)();
    const db = ctx.pool;
    /** GET / — where the person stands today, from their own records. */
    router.get('/', (0, finance_day_kit_1.route)('day', (sub, req) => readDay(db, sub, (0, finance_day_kit_1.bookOf)(req), (0, finance_day_kit_1.dayOf)(req))));
    return router;
}
//# sourceMappingURL=finance-day.js.map