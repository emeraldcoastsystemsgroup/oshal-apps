"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Recurring, mounted at /api/finance/recurring (Finance 1.8.0, Lane FINH2: the design's slice 3; Roger 2026-11-14: "reviews bank accounts for recurring payments"). GET / works out every charge that repeats in the person's own transactions of the last seven months (the bills module's rule: a payee's last three charges, evenly spaced and within 10 percent) and answers each with what it costs a charge and a year, when it was last charged and is next expected, whether it is new or its price went up, and the person's answer; with the totals a month and a year. Each is reviewed once (POST /:seriesId/answer): Keep, Track as a bill (confirm: true; it becomes a bill as Add to Bills makes one) or Mark to cancel, which records that the person means to cancel it themselves and then says when it is charged again. Review again (POST /:seriesId/clear) takes the answer back. Finance cancels nothing, pays nothing and moves nothing. The GET only reads.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECURRING_SQL = exports.RECURRING_NOTE = exports.ANSWERS = exports.PER_YEAR = exports.RECURRING_MONTHS = void 0;
exports.seriesIdOf = seriesIdOf;
exports.readRecurring = readRecurring;
exports.answerSeries = answerSeries;
exports.createFinanceRecurringRoutes = createFinanceRecurringRoutes;
/**
 * @module finance-recurring
 */
const express_1 = require("express");
const finance_ledger_store_1 = require("./finance-ledger-store");
const finance_day_model_1 = require("./finance-day-model");
const finance_day_kit_1 = require("./finance-day-kit");
const finance_bills_1 = require("./finance-bills");
/** How many months of transactions the repeating payments are worked out from. */
exports.RECURRING_MONTHS = 7;
/** Charges a year, by how often a payment repeats. */
exports.PER_YEAR = Object.freeze({ weekly: 52, 'every-two-weeks': 26, monthly: 12, quarterly: 4, yearly: 1 });
/** The answers a person can give. */
exports.ANSWERS = Object.freeze(['keep', 'bill', 'cancel']);
/** What Recurring is, in the words the screen and the concierge use. */
exports.RECURRING_NOTE = 'Worked out from your own transactions. Finance cancels nothing and pays nothing: Mark to cancel records what you mean to do, and Finance shows here if it is charged again.';
const REVIEW_COLUMNS = 'review_id, user_sub, book_id, series_key, payee, answer, answered_on, amount_cents, bill_id, created_at, updated_at';
/** Every statement this module issues. The selective text equality comes first in each WHERE. */
exports.RECURRING_SQL = Object.freeze({
    reviewsByBook: `SELECT ${REVIEW_COLUMNS} FROM finance_recurring_reviews WHERE book_id = $1 AND user_sub = $2`,
    reviewInsert: `INSERT INTO finance_recurring_reviews (${REVIEW_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    reviewUpdate: 'UPDATE finance_recurring_reviews SET payee = $3, answer = $4, answered_on = $5, amount_cents = $6, bill_id = $7, updated_at = $8 WHERE review_id = $1 AND user_sub = $2',
    reviewDelete: 'DELETE FROM finance_recurring_reviews WHERE review_id = $1 AND user_sub = $2',
});
function reviewOf(row) {
    return {
        reviewId: row.review_id, bookId: row.book_id, seriesKey: row.series_key, payee: row.payee, answer: row.answer, answeredOn: row.answered_on,
        amountCents: row.amount_cents === null || row.amount_cents === undefined ? null : Number(row.amount_cents), billId: row.bill_id || '',
        createdAt: row.created_at, updatedAt: row.updated_at,
    };
}
/**
 * @description The id a repeating payment is answered by.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param key - The payee in the words charges are matched by.
 * @returns The id.
 */
function seriesIdOf(sub, bookId, key) {
    return (0, finance_ledger_store_1.hashId)('recur', sub, bookId, key);
}
/** The repeating charges in the person's own transactions of the last seven months. */
async function repeating(db, sub, bookId, today) {
    return (0, finance_day_model_1.findRepeating)(await (0, finance_ledger_store_1.listMonths)(db, sub, bookId, (0, finance_day_model_1.recentMonths)(today, exports.RECURRING_MONTHS)), 'out');
}
async function listReviews(db, sub, bookId) {
    return (await db.query(exports.RECURRING_SQL.reviewsByBook, [bookId, sub])).rows.map(reviewOf);
}
/** What a payment costs a year, as an estimate from its last charge. */
function perYear(series) {
    const times = exports.PER_YEAR[series.cadence];
    if (!times)
        return null;
    const last = series.last;
    return (0, finance_ledger_store_1.figure)(series.amountCents * times, last.currency, `${last.sourceLabel || 'Your records'}: ${times} × the last charge`, last.source, last.date, 'estimate');
}
/** One repeating payment as the screen and the concierge read it. */
function itemOf(sub, bookId, series, review, bills) {
    const first = series.charges[0], last = series.last;
    return {
        seriesId: seriesIdOf(sub, bookId, series.key), payee: series.payee, cadence: series.cadence, amount: (0, finance_ledger_store_1.amountFigure)(last), perYear: perYear(series),
        lastDate: last.date, nextDate: series.nextDate, isNew: series.isNew, priceWentUp: last.amountCents > first.amountCents,
        earlierAmount: last.amountCents > first.amountCents ? (0, finance_ledger_store_1.amountFigure)(first) : null,
        hasBill: bills.some((bill) => bill.state === 'confirmed' && (0, finance_bills_1.covers)(bill, series.key)),
        review: review ? { answer: review.answer, answeredOn: review.answeredOn } : null,
        chargedAgain: review && review.answer === 'cancel' && last.date > review.answeredOn ? last.date : null,
    };
}
/** The totals a month and a year, summed over the payments the person did not mark to cancel. */
function totals(list, reviews, today) {
    const counted = list.filter((s) => exports.PER_YEAR[s.cadence] && reviews.get(s.key)?.answer !== 'cancel');
    if (!counted.length)
        return null;
    const currency = counted[0].last.currency, yearly = counted.reduce((sum, s) => sum + s.amountCents * exports.PER_YEAR[s.cadence], 0);
    const asOf = counted.map((s) => s.last.date).sort().slice(-1)[0] || today, label = 'Worked out from your transactions';
    return { monthly: (0, finance_ledger_store_1.figure)(Math.round(yearly / 12), currency, label, 'derived', asOf, 'estimate'), yearly: (0, finance_ledger_store_1.figure)(yearly, currency, label, 'derived', asOf, 'estimate') };
}
/**
 * @description Every repeating payment in the person's own records, with their answers and the totals.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param today - YYYY-MM-DD.
 * @returns The view.
 */
async function readRecurring(db, sub, bookId, today) {
    const list = await repeating(db, sub, bookId, today), reviews = new Map((await listReviews(db, sub, bookId)).map((r) => [r.seriesKey, r]));
    const bills = await (0, finance_bills_1.listBills)(db, sub, bookId);
    const items = list.map((s) => itemOf(sub, bookId, s, reviews.get(s.key), bills));
    return { book: bookId, asOf: today, items, toReview: items.filter((i) => !i.review).length, totals: totals(list, reviews, today), note: exports.RECURRING_NOTE };
}
/** The repeating payment an id names, or a refusal in words. */
async function needSeries(db, sub, bookId, today, seriesId) {
    const found = (await repeating(db, sub, bookId, today)).find((s) => seriesIdOf(sub, bookId, s.key) === seriesId);
    if (!found)
        throw new finance_ledger_store_1.LedgerRefusal(404, 'unknown_series', 'That repeating payment is not in your records.');
    return found;
}
/** Track a repeating payment as a bill: the bill it already is, the proposal confirmed, or a new bill from its charges. */
async function trackAsBill(db, sub, bookId, series, today) {
    const bills = await (0, finance_bills_1.listBills)(db, sub, bookId), known = bills.find((bill) => bill.state === 'confirmed' && (0, finance_bills_1.covers)(bill, series.key));
    if (known)
        return known;
    const fresh = (0, finance_bills_1.proposalOf)(sub, bookId, series), held = bills.find((bill) => bill.billId === fresh.billId);
    const bill = { ...fresh, state: 'confirmed', createdAt: held?.createdAt || fresh.createdAt };
    if (held || !(await (0, finance_bills_1.insertBill)(db, sub, bill)))
        await (0, finance_bills_1.saveBill)(db, sub, bill);
    await (0, finance_bills_1.syncBills)(db, sub, bookId, today);
    return bill;
}
/**
 * @description Keep the person's answer to one repeating payment.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param seriesId - The repeating payment.
 * @param body - answer: keep, bill (with confirm: true) or cancel.
 * @param today - YYYY-MM-DD.
 * @returns What was recorded, and the bill when it is tracked as one.
 */
async function answerSeries(db, sub, bookId, seriesId, body, today) {
    const answer = String(body.answer || '');
    if (!exports.ANSWERS.includes(answer))
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_answer', 'Answer keep, bill or cancel.');
    if (answer === 'bill')
        (0, finance_day_kit_1.requireConfirm)(body, 'Tracking this as a bill');
    const series = await needSeries(db, sub, bookId, today, seriesId);
    await (0, finance_ledger_store_1.ensureBook)(db, sub, bookId);
    const bill = answer === 'bill' ? await trackAsBill(db, sub, bookId, series, today) : null, now = (0, finance_ledger_store_1.nowStamp)();
    const review = { reviewId: seriesId, bookId, seriesKey: series.key, payee: series.payee, answer, answeredOn: today, amountCents: series.amountCents,
        billId: bill?.billId || '', createdAt: now, updatedAt: now };
    try {
        await db.query(exports.RECURRING_SQL.reviewInsert, [review.reviewId, sub, bookId, review.seriesKey, review.payee, review.answer, review.answeredOn, review.amountCents, review.billId, now, now]);
    }
    catch (err) {
        if (!(0, finance_ledger_store_1.duplicateKey)(err))
            throw err;
        await db.query(exports.RECURRING_SQL.reviewUpdate, [review.reviewId, sub, review.payee, review.answer, review.answeredOn, review.amountCents, review.billId, now]);
    }
    const words = answer === 'keep' ? `${series.payee}: kept.` : answer === 'bill' ? `${series.payee} is in your Bills. It does not pay the bill.`
        : `Recorded: you mean to cancel ${series.payee}. Finance cancels nothing; cancel it with ${series.payee} yourself. Finance shows here if it is charged again.`;
    return { ok: true, seriesId, answer, words, bill: bill ? (0, finance_bills_1.billCard)(bill) : null };
}
/**
 * @description The recurring routes, mounted at /api/finance/recurring.
 * @param ctx - The application context (its pool).
 * @returns The router.
 */
function createFinanceRecurringRoutes(ctx) {
    const router = (0, express_1.Router)();
    const db = ctx.pool;
    /** GET / — every repeating payment with what it costs a year, the person's answers and the totals. */
    router.get('/', (0, finance_day_kit_1.route)('recurring', (sub, req) => readRecurring(db, sub, (0, finance_day_kit_1.bookOf)(req), (0, finance_day_kit_1.dayOf)(req))));
    /** POST /:seriesId/answer — Keep, Track as a bill (confirm: true) or Mark to cancel. Nothing is cancelled. */
    router.post('/:seriesId/answer', (0, finance_day_kit_1.route)('recurring.answer', (sub, req) => answerSeries(db, sub, (0, finance_day_kit_1.bookOf)(req), String(req.params.seriesId), (0, finance_day_kit_1.bodyOf)(req), (0, finance_day_kit_1.dayOf)(req))));
    /** POST /:seriesId/clear — take the answer back, so the payment is reviewed again. */
    router.post('/:seriesId/clear', (0, finance_day_kit_1.route)('recurring.clear', async (sub, req) => {
        const seriesId = String(req.params.seriesId), bookId = (0, finance_day_kit_1.bookOf)(req);
        const held = (await listReviews(db, sub, bookId)).find((r) => r.reviewId === seriesId);
        if (!held)
            throw new finance_ledger_store_1.LedgerRefusal(404, 'unknown_review', 'That payment has no answer to take back.');
        await db.query(exports.RECURRING_SQL.reviewDelete, [seriesId, sub]);
        return { ok: true, seriesId, payee: held.payee };
    }));
    return router;
}
//# sourceMappingURL=finance-recurring.js.map