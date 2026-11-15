"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Bills, mounted at /api/finance/bills (Roger, 2026-11-12: Finance as a person's money day). A repeating charge found in a person's own transactions is proposed as a bill and becomes one only when they confirm it; a bill can also be typed. Each bill has due dates; a due date is paid when a matching charge is in the records, or when the person says so, and "Mark paid" says what it is: it marks the bill paid in Finance and does not pay it. The list answers what is overdue, due this week, due later and paid this month, each expected amount a figure that says Estimate (from the last charge) or Planned (typed) with its source and date; a bill with no known amount has none, never zero. Nothing here pays, moves or schedules money, and nothing changes in a closed month. The GET only reads.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Finance 1.8.0 (Lane FINH2): a payment taken out of the records no longer leaves its bill paid: releasePayments puts a due date it matched back to due, and one the person had marked paid keeps their mark without the payment's amount (VER2 on the test slot: after Undo the bill stayed on Paid). Delete: an ended bill can be deleted with confirm: true (POST /:billId/delete); its due dates go, and a bill found in the person's payments keeps only its match words (state 'deleted', listed nowhere) so the same charge is not proposed again. The bills list also answers the person's bills with their state, so the screen can offer No longer due and Delete.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Finance 1.8.0 (Lane FINH2): covers, dropUnpaid and proposalOf are exported for the mail module (a bill found in mail brings the known bill for its payee up to date) and the recurring module (Track as a bill makes a repeating payment a bill the way Add to Bills does).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BILLS_SQL = exports.PAID_NOTE = exports.LATER_DAYS = exports.WEEK_DAYS = exports.EVENTS_AHEAD_DAYS = exports.CADENCES = void 0;
exports.listBills = listBills;
exports.needBill = needBill;
exports.insertBill = insertBill;
exports.saveBill = saveBill;
exports.listEvents = listEvents;
exports.needEvent = needEvent;
exports.saveEvent = saveEvent;
exports.eventMonths = eventMonths;
exports.dueDates = dueDates;
exports.dueOf = dueOf;
exports.billLists = billLists;
exports.billCard = billCard;
exports.proposalOf = proposalOf;
exports.covers = covers;
exports.proposeBills = proposeBills;
exports.matchPayments = matchPayments;
exports.releasePayments = releasePayments;
exports.deleteBill = deleteBill;
exports.syncBills = syncBills;
exports.addBill = addBill;
exports.dropUnpaid = dropUnpaid;
exports.changedBill = changedBill;
exports.answerEvent = answerEvent;
exports.readBills = readBills;
exports.createFinanceBillsRoutes = createFinanceBillsRoutes;
/**
 * @module finance-bills
 */
const express_1 = require("express");
const finance_ledger_store_1 = require("./finance-ledger-store");
const finance_day_model_1 = require("./finance-day-model");
const finance_day_kit_1 = require("./finance-day-kit");
/** How often a bill can come due: a number of days, or a number of months. */
exports.CADENCES = Object.freeze({
    weekly: { days: 7, reach: 3 }, 'every-two-weeks': { days: 14, reach: 5 }, monthly: { months: 1, reach: 10 },
    quarterly: { months: 3, reach: 10 }, yearly: { months: 12, reach: 10 },
});
/** Due dates are kept this many days ahead. */
exports.EVENTS_AHEAD_DAYS = 45;
/** "This week" on the bills list. */
exports.WEEK_DAYS = 7;
/** "Later" on the bills list reaches this many days ahead. */
exports.LATER_DAYS = 35;
/** What marking a bill paid says of itself. */
exports.PAID_NOTE = 'Marks it paid in Finance. It does not pay the bill.';
/** The most due dates one bill gets in one pass. */
const MAX_DUE_DATES = 60;
const BILL_COLUMNS = 'bill_id, user_sub, book_id, payee, match_text, amount_cents, amount_as_of, currency, cadence, due_day, first_due, next_due, account_id, category, origin, source, source_label, posture, state, evidence, created_at, updated_at';
const EVENT_COLUMNS = 'event_id, user_sub, book_id, bill_id, month, due_date, amount_cents, amount_as_of, currency, state, paid_on, paid_cents, paid_txn_id, paid_by, paid_source, paid_source_label, paid_posture, told_due_at, told_overdue_at, created_at, updated_at';
/** Every statement this module issues. The selective text equality comes first in each WHERE. */
exports.BILLS_SQL = Object.freeze({
    billsByBook: `SELECT ${BILL_COLUMNS} FROM finance_bills WHERE book_id = $1 AND user_sub = $2`,
    billRead: `SELECT ${BILL_COLUMNS} FROM finance_bills WHERE bill_id = $1 AND user_sub = $2`,
    billInsert: `INSERT INTO finance_bills (${BILL_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21, $22)`,
    billUpdate: 'UPDATE finance_bills SET payee = $3, match_text = $4, amount_cents = $5, amount_as_of = $6, cadence = $7, due_day = $8, first_due = $9, next_due = $10, account_id = $11, category = $12, source = $13, source_label = $14, posture = $15, state = $16, evidence = $17::jsonb, updated_at = $18 WHERE bill_id = $1 AND user_sub = $2',
    eventsByMonth: `SELECT ${EVENT_COLUMNS} FROM finance_bill_events WHERE month = $1 AND user_sub = $2 AND book_id = $3`,
    eventRead: `SELECT ${EVENT_COLUMNS} FROM finance_bill_events WHERE event_id = $1 AND user_sub = $2`,
    eventInsert: `INSERT INTO finance_bill_events (${EVENT_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
    eventUpdate: 'UPDATE finance_bill_events SET amount_cents = $3, amount_as_of = $4, state = $5, paid_on = $6, paid_cents = $7, paid_txn_id = $8, paid_by = $9, paid_source = $10, paid_source_label = $11, paid_posture = $12, told_due_at = $13, told_overdue_at = $14, updated_at = $15 WHERE event_id = $1 AND user_sub = $2',
    eventDelete: 'DELETE FROM finance_bill_events WHERE event_id = $1 AND user_sub = $2',
    eventsByBill: `SELECT ${EVENT_COLUMNS} FROM finance_bill_events WHERE bill_id = $1 AND user_sub = $2`,
    billDelete: 'DELETE FROM finance_bills WHERE bill_id = $1 AND user_sub = $2',
});
/* ─── rows ──────────────────────────────────────────────────────────────────── */
/** A stored bill row as the record the modules use. */
function billOf(row) {
    return {
        billId: row.bill_id, bookId: row.book_id, payee: row.payee, matchText: row.match_text || '', amountCents: (0, finance_day_kit_1.wholeOrNull)(row.amount_cents),
        amountAsOf: row.amount_as_of || null, currency: row.currency || 'USD', cadence: row.cadence, dueDay: row.due_day === null || row.due_day === undefined ? null : Number(row.due_day),
        firstDue: row.first_due || null, nextDue: row.next_due || null, accountId: row.account_id || '', category: row.category || '', origin: row.origin,
        source: row.source, sourceLabel: row.source_label || '', posture: row.posture || '', state: row.state, evidence: (0, finance_day_kit_1.cell)(row.evidence),
        createdAt: row.created_at, updatedAt: row.updated_at,
    };
}
/** A stored due-date row as the record the modules use. */
function eventOf(row) {
    return {
        eventId: row.event_id, bookId: row.book_id, billId: row.bill_id, month: row.month, dueDate: row.due_date, amountCents: (0, finance_day_kit_1.wholeOrNull)(row.amount_cents),
        amountAsOf: row.amount_as_of || null, currency: row.currency || 'USD', state: row.state, paidOn: row.paid_on || null, paidCents: (0, finance_day_kit_1.wholeOrNull)(row.paid_cents),
        paidTxnId: row.paid_txn_id || '', paidBy: row.paid_by || '', paidSource: row.paid_source || '', paidSourceLabel: row.paid_source_label || '',
        paidPosture: row.paid_posture || '', toldDueAt: row.told_due_at || null, toldOverdueAt: row.told_overdue_at || null,
        createdAt: row.created_at, updatedAt: row.updated_at,
    };
}
/* ─── the store ─────────────────────────────────────────────────────────────── */
/**
 * @description Every bill in one of the caller's sets of records, by payee.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The bills, in every state.
 */
async function listBills(db, sub, bookId) {
    const rows = (await db.query(exports.BILLS_SQL.billsByBook, [bookId, sub])).rows;
    return rows.map(billOf).sort((a, b) => a.payee.localeCompare(b.payee) || a.billId.localeCompare(b.billId));
}
/**
 * @description One of the caller's bills, or a refusal in words.
 * @param db - The pool.
 * @param sub - The caller.
 * @param billId - The bill.
 * @returns The bill.
 */
async function needBill(db, sub, billId) {
    const row = (await db.query(exports.BILLS_SQL.billRead, [billId, sub])).rows[0];
    if (!row || row.state === 'deleted')
        throw new finance_ledger_store_1.LedgerRefusal(404, 'unknown_bill', 'That bill is not in your records.');
    return billOf(row);
}
/**
 * @description Keep a new bill. A second bill with the same id is left as it is.
 * @param db - The pool.
 * @param sub - The caller.
 * @param b - The bill.
 * @returns True when it was added.
 */
async function insertBill(db, sub, b) {
    try {
        await db.query(exports.BILLS_SQL.billInsert, [b.billId, sub, b.bookId, b.payee, b.matchText, b.amountCents, b.amountAsOf, b.currency, b.cadence, b.dueDay,
            b.firstDue, b.nextDue, b.accountId, b.category, b.origin, b.source, b.sourceLabel, b.posture, b.state, (0, finance_day_kit_1.jsonParam)(b.evidence), b.createdAt, b.updatedAt]);
        return true;
    }
    catch (err) {
        if (!(0, finance_ledger_store_1.duplicateKey)(err))
            throw err;
        return false;
    }
}
/**
 * @description Keep a bill's present values.
 * @param db - The pool.
 * @param sub - The caller.
 * @param b - The bill with its new values.
 * @returns Nothing.
 */
async function saveBill(db, sub, b) {
    await db.query(exports.BILLS_SQL.billUpdate, [b.billId, sub, b.payee, b.matchText, b.amountCents, b.amountAsOf, b.cadence, b.dueDay, b.firstDue, b.nextDue,
        b.accountId, b.category, b.source, b.sourceLabel, b.posture, b.state, (0, finance_day_kit_1.jsonParam)(b.evidence), (0, finance_ledger_store_1.nowStamp)()]);
}
/**
 * @description The due dates that fall in some months, read one month at a time, oldest first.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param months - The months to read (YYYY-MM).
 * @returns The due dates.
 */
async function listEvents(db, sub, bookId, months) {
    const all = [];
    for (const month of [...new Set(months)])
        all.push(...(await db.query(exports.BILLS_SQL.eventsByMonth, [month, sub, bookId])).rows.map(eventOf));
    return all.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.eventId.localeCompare(b.eventId));
}
/**
 * @description One of the caller's due dates, or a refusal in words.
 * @param db - The pool.
 * @param sub - The caller.
 * @param eventId - The due date.
 * @returns The due date.
 */
async function needEvent(db, sub, eventId) {
    const row = (await db.query(exports.BILLS_SQL.eventRead, [eventId, sub])).rows[0];
    if (!row)
        throw new finance_ledger_store_1.LedgerRefusal(404, 'unknown_due_date', 'That due date is not in your records.');
    return eventOf(row);
}
/** Keep a new due date; a second row with the same id is a skip, so a pass run twice adds nothing. */
async function insertEvent(db, sub, e) {
    try {
        await db.query(exports.BILLS_SQL.eventInsert, [e.eventId, sub, e.bookId, e.billId, e.month, e.dueDate, e.amountCents, e.amountAsOf, e.currency, e.state,
            e.paidOn, e.paidCents, e.paidTxnId, e.paidBy, e.paidSource, e.paidSourceLabel, e.paidPosture, e.toldDueAt, e.toldOverdueAt, e.createdAt, e.updatedAt]);
        return true;
    }
    catch (err) {
        if (!(0, finance_ledger_store_1.duplicateKey)(err))
            throw err;
        return false;
    }
}
/**
 * @description Keep a due date's present values: what is expected, whether it is paid, and whether the person was told.
 * @param db - The pool.
 * @param sub - The caller.
 * @param e - The due date with its new values.
 * @returns Nothing.
 */
async function saveEvent(db, sub, e) {
    await db.query(exports.BILLS_SQL.eventUpdate, [e.eventId, sub, e.amountCents, e.amountAsOf, e.state, e.paidOn, e.paidCents, e.paidTxnId, e.paidBy,
        e.paidSource, e.paidSourceLabel, e.paidPosture, e.toldDueAt, e.toldOverdueAt, (0, finance_ledger_store_1.nowStamp)()]);
}
/* ─── due dates ─────────────────────────────────────────────────────────────── */
/**
 * @description The months that hold a bill's due dates around a day: last month to two months ahead.
 * @param today - YYYY-MM-DD.
 * @returns YYYY-MM values.
 */
function eventMonths(today) {
    return [-1, 0, 1, 2].map((ahead) => (0, finance_day_model_1.addMonths)((0, finance_ledger_store_1.monthOf)(today), ahead));
}
/**
 * @description A bill's due dates in a span of days, from its first due date on.
 * @param bill - The bill (its cadence, first due date and day of the month).
 * @param from - YYYY-MM-DD, the first day of the span.
 * @param to - YYYY-MM-DD, the last day of the span.
 * @returns The due dates, oldest first.
 */
function dueDates(bill, from, to) {
    const step = exports.CADENCES[bill.cadence], start = bill.firstDue, dates = [];
    if (!step || !start)
        return dates;
    const day = bill.dueDay || Number(start.slice(8, 10));
    for (let n = 0; dates.length < MAX_DUE_DATES; n++) {
        const due = step.days ? (0, finance_day_model_1.addDays)(start, n * step.days) : (0, finance_day_model_1.dayInMonth)((0, finance_day_model_1.addMonths)((0, finance_ledger_store_1.monthOf)(start), n * step.months), day);
        if (due > to)
            break;
        if (due >= from && due >= start)
            dates.push(due);
        if (n > 5000)
            break;
    }
    return dates;
}
/** A bill's expected amount as a figure: an estimate when it came from a charge, planned when it was typed. */
function expectedFigure(bill, cents, asOf) {
    if (cents === null || !asOf)
        return null;
    const said = (0, finance_ledger_store_1.figure)(cents, bill.currency, bill.sourceLabel || (0, finance_ledger_store_1.sourceWords)(bill.source), bill.source, asOf, bill.posture);
    return (0, finance_day_model_1.forward)(said, bill.source === 'typed' ? 'planned' : 'estimate');
}
/** What was paid on a due date as a figure, from the payment the records hold or the amount the person typed. */
function paidFigure(event) {
    if (event.paidCents === null || !event.paidOn)
        return null;
    return (0, finance_ledger_store_1.figure)(event.paidCents, event.currency, event.paidSourceLabel || (0, finance_ledger_store_1.sourceWords)(event.paidSource || 'typed'), event.paidSource || 'typed', event.paidOn, event.paidPosture);
}
/**
 * @description One due date as a screen reads it.
 * @param bill - The bill.
 * @param event - Its due date.
 * @param today - YYYY-MM-DD.
 * @returns The due date with its amount as a figure (paid, else expected, else null).
 */
function dueOf(bill, event, today) {
    return {
        billId: bill.billId, eventId: event.eventId, payee: bill.payee, due: event.dueDate, daysUntil: (0, finance_day_model_1.daysBetween)(today, event.dueDate), state: event.state,
        cadence: bill.cadence, accountId: bill.accountId, category: bill.category,
        amount: event.state === 'paid' ? paidFigure(event) : expectedFigure(bill, event.amountCents, event.amountAsOf),
        paidOn: event.paidOn, paidBy: event.paidBy,
    };
}
/**
 * @description The bills list: what is overdue, due this week, due later and paid this month.
 * @param bills - The person's bills.
 * @param events - The due dates around today.
 * @param today - YYYY-MM-DD.
 * @returns The four lists and how many proposals wait for an answer.
 */
function billLists(bills, events, today) {
    const byId = new Map(bills.map((bill) => [bill.billId, bill])), weekEnd = (0, finance_day_model_1.addDays)(today, exports.WEEK_DAYS), laterEnd = (0, finance_day_model_1.addDays)(today, exports.LATER_DAYS);
    const due = events.filter((e) => e.state === 'due' && byId.get(e.billId)?.state === 'confirmed').map((e) => dueOf(byId.get(e.billId), e, today));
    const paid = events.filter((e) => e.state === 'paid' && e.month === (0, finance_ledger_store_1.monthOf)(today) && byId.has(e.billId)).map((e) => dueOf(byId.get(e.billId), e, today));
    return {
        proposed: bills.filter((bill) => bill.state === 'proposed').length,
        overdue: due.filter((d) => d.due < today), week: due.filter((d) => d.due >= today && d.due <= weekEnd),
        later: due.filter((d) => d.due > weekEnd && d.due <= laterEnd), paid,
    };
}
/**
 * @description A bill as a screen reads it.
 * @param bill - The bill.
 * @returns The bill with its expected amount as a figure and the charges it was found from.
 */
function billCard(bill) {
    return {
        billId: bill.billId, payee: bill.payee, state: bill.state, origin: bill.origin, cadence: bill.cadence, dueDay: bill.dueDay, firstDue: bill.firstDue,
        nextDue: bill.nextDue, accountId: bill.accountId, category: bill.category, amount: expectedFigure(bill, bill.amountCents, bill.amountAsOf),
        evidence: bill.evidence || [],
    };
}
/* ─── proposals ─────────────────────────────────────────────────────────────── */
/** A repeating charge as a bill waiting for the person's answer. */
function proposalOf(sub, bookId, series) {
    const now = (0, finance_ledger_store_1.nowStamp)(), last = series.last;
    return {
        billId: (0, finance_ledger_store_1.hashId)('bill', sub, bookId, series.key), bookId, payee: (0, finance_ledger_store_1.cleanText)(series.payee, 80), matchText: series.key, amountCents: series.amountCents,
        amountAsOf: last.date, currency: last.currency, cadence: series.cadence, dueDay: series.dueDay, firstDue: series.charges[0].date, nextDue: series.nextDate,
        accountId: series.accountId, category: series.category, origin: last.source === 'sample' ? 'sample' : 'found', source: last.source,
        sourceLabel: last.sourceLabel || (0, finance_ledger_store_1.sourceWords)(last.source), posture: last.posture, state: 'proposed',
        evidence: series.charges.map((t) => ({ txnId: t.txnId, date: t.date, amount: (0, finance_ledger_store_1.amountFigure)(t) })), createdAt: now, updatedAt: now,
    };
}
/** Whether a bill the person already has (or turned down) covers a repeating charge. */
function covers(bill, key) {
    return Boolean(bill.matchText) && (bill.matchText === key || key.includes(bill.matchText) || bill.matchText.includes(key));
}
/**
 * @description Propose a bill for each repeating charge the person has no bill for. A proposal still
 * waiting is brought up to date with the newest charge; an answered one is never proposed again.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param repeating - The repeating charges found in the person's transactions.
 * @returns How many new proposals were added.
 */
async function proposeBills(db, sub, bookId, repeating) {
    const bills = await listBills(db, sub, bookId);
    let added = 0;
    for (const series of repeating) {
        const fresh = proposalOf(sub, bookId, series), waiting = bills.find((bill) => bill.billId === fresh.billId && bill.state === 'proposed');
        if (waiting && waiting.amountAsOf !== fresh.amountAsOf) {
            await saveBill(db, sub, { ...fresh, createdAt: waiting.createdAt, firstDue: waiting.firstDue });
        }
        else if (!waiting && !bills.some((bill) => covers(bill, series.key)) && await insertBill(db, sub, fresh)) {
            added += 1;
        }
    }
    return added;
}
/* ─── payments found in the records ─────────────────────────────────────────── */
/** Whether a transaction is a payment of a bill, by the payee's name. */
function pays(bill, t) {
    const key = (0, finance_day_model_1.merchantKey)(t);
    return t.direction === 'out' && Boolean(bill.matchText) && (key === bill.matchText || key.includes(bill.matchText));
}
/**
 * @description Pair each unpaid due date with the charge that paid it: the same payee, the closest
 * date within the bill's reach, each charge used once.
 * @param bills - The confirmed bills.
 * @param events - Their due dates.
 * @param txns - The person's transactions around those dates.
 * @returns The pairs found.
 */
function matchPayments(bills, events, txns) {
    const used = new Set(events.map((e) => e.paidTxnId).filter(Boolean)), pairs = [];
    for (const bill of bills.filter((b) => b.state === 'confirmed')) {
        const reach = exports.CADENCES[bill.cadence]?.reach || 10;
        const open = events.filter((e) => e.billId === bill.billId && (e.state === 'due' || (e.state === 'paid' && !e.paidTxnId)));
        for (const event of open) {
            const txn = txns.filter((t) => pays(bill, t) && !used.has(t.txnId) && (!t.matchedBillId || t.matchedBillId === bill.billId) && Math.abs((0, finance_day_model_1.daysBetween)(event.dueDate, t.date)) <= reach)
                .sort((a, b) => Math.abs((0, finance_day_model_1.daysBetween)(event.dueDate, a.date)) - Math.abs((0, finance_day_model_1.daysBetween)(event.dueDate, b.date)) || a.date.localeCompare(b.date) || a.txnId.localeCompare(b.txnId))[0];
            if (!txn)
                continue;
            used.add(txn.txnId);
            pairs.push({ bill, event, txn });
        }
    }
    return pairs;
}
/** Record that a charge paid a due date, on the due date and on the transaction. */
async function keepPayment(db, sub, bill, event, txn) {
    await saveEvent(db, sub, {
        ...event, state: 'paid', paidOn: txn.date, paidCents: txn.amountCents, paidTxnId: txn.txnId, paidBy: event.paidBy || 'matched',
        paidSource: txn.source, paidSourceLabel: txn.sourceLabel || (0, finance_ledger_store_1.sourceWords)(txn.source), paidPosture: txn.posture,
    });
    if (txn.matchedBillId !== bill.billId)
        await (0, finance_ledger_store_1.saveTransaction)(db, sub, { ...txn, matchedBillId: bill.billId });
}
/** A found bill's expected amount follows its newest payment; a typed amount stays as typed. */
function followPayment(bill, txn) {
    if (bill.source === 'typed' || (bill.amountAsOf && txn.date <= bill.amountAsOf))
        return null;
    return { ...bill, amountCents: txn.amountCents, amountAsOf: txn.date, source: txn.source, sourceLabel: txn.sourceLabel || (0, finance_ledger_store_1.sourceWords)(txn.source), posture: txn.posture };
}
/**
 * @description Undo what removed payments had done to the bills: a due date a removed transaction
 * paid by matching goes back to due; one the person had marked paid stays paid by their mark, without
 * the removed payment's amount. Due dates in a closed month are left as they are.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param removed - The transactions taken out (their ids and months).
 * @returns How many due dates were changed.
 */
async function releasePayments(db, sub, bookId, removed) {
    if (!removed.length)
        return 0;
    const gone = new Set(removed.map((t) => t.txnId)), book = await (0, finance_ledger_store_1.readBook)(db, sub, bookId);
    const months = [...new Set(removed.flatMap((t) => [-1, 0, 1].map((step) => (0, finance_day_model_1.addMonths)(t.month, step))))];
    const cleared = { paidTxnId: '', paidSource: '', paidSourceLabel: '', paidPosture: '' };
    let released = 0;
    for (const event of await listEvents(db, sub, bookId, months)) {
        if (!event.paidTxnId || !gone.has(event.paidTxnId) || (0, finance_ledger_store_1.monthClosed)(book, event.month))
            continue;
        const next = event.paidBy === 'marked'
            ? { ...event, ...cleared, paidCents: null }
            : { ...event, ...cleared, state: 'due', paidOn: null, paidCents: null, paidBy: '' };
        await saveEvent(db, sub, next);
        released += 1;
    }
    return released;
}
/**
 * @description Delete a bill that has ended, with its due dates. A bill found in the person's payments
 * keeps only its match words, listed nowhere, so the same charge is not proposed again; any other bill
 * is removed outright.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bill - The bill; it must have ended.
 * @returns How many due dates were removed.
 */
async function deleteBill(db, sub, bill) {
    if (bill.state !== 'ended')
        throw new finance_ledger_store_1.LedgerRefusal(409, 'not_ended', 'Only a bill that has ended can be deleted. Say it is no longer due first.');
    const events = (await db.query(exports.BILLS_SQL.eventsByBill, [bill.billId, sub])).rows.map(eventOf);
    for (const event of events)
        (0, finance_ledger_store_1.assertMonthOpen)(await (0, finance_ledger_store_1.readBook)(db, sub, event.bookId), event.month);
    for (const event of events)
        await db.query(exports.BILLS_SQL.eventDelete, [event.eventId, sub]);
    if (bill.origin === 'found' || bill.origin === 'sample') {
        await saveBill(db, sub, { ...bill, payee: '', amountCents: null, amountAsOf: null, nextDue: null, firstDue: null, accountId: '', category: '', sourceLabel: '', evidence: null, state: 'deleted' });
    }
    else {
        await db.query(exports.BILLS_SQL.billDelete, [bill.billId, sub]);
    }
    return events.length;
}
/* ─── keeping the due dates current ─────────────────────────────────────────── */
/** A new due date for a bill. */
function eventFor(bill, due) {
    const now = (0, finance_ledger_store_1.nowStamp)();
    return {
        eventId: (0, finance_ledger_store_1.hashId)('due', bill.billId, due), bookId: bill.bookId, billId: bill.billId, month: (0, finance_ledger_store_1.monthOf)(due), dueDate: due, amountCents: bill.amountCents,
        amountAsOf: bill.amountAsOf, currency: bill.currency, state: 'due', paidOn: null, paidCents: null, paidTxnId: '', paidBy: '', paidSource: '',
        paidSourceLabel: '', paidPosture: '', toldDueAt: null, toldOverdueAt: null, createdAt: now, updatedAt: now,
    };
}
/** Add the due dates a confirmed bill is missing, from last month to 45 days ahead; closed months are left alone. */
async function addDueDates(db, sub, book, bills, events, today, stopAt) {
    const have = new Set(events.map((e) => e.eventId)), from = `${(0, finance_day_model_1.addMonths)((0, finance_ledger_store_1.monthOf)(today), -1)}-01`, to = (0, finance_day_model_1.addDays)(today, exports.EVENTS_AHEAD_DAYS);
    let added = 0;
    for (const bill of bills.filter((b) => b.state === 'confirmed')) {
        for (const due of dueDates(bill, from, to)) {
            const event = eventFor(bill, due);
            if (have.has(event.eventId) || (0, finance_ledger_store_1.monthClosed)(book, event.month))
                continue;
            if (Date.now() >= stopAt)
                return added;
            if (await insertEvent(db, sub, event))
                added += 1;
        }
    }
    return added;
}
/** Bring each bill's expected amount and next due date, and its unpaid due dates' amounts, up to date. */
async function settleBills(db, sub, bills, events, today, stopAt) {
    for (const bill of bills.filter((b) => b.state === 'confirmed')) {
        const mine = events.filter((e) => e.billId === bill.billId && e.state === 'due');
        const nextDue = mine.length ? mine[0].dueDate : dueDates(bill, today, (0, finance_day_model_1.addDays)(today, 400))[0] || null;
        if (Date.now() >= stopAt)
            return;
        if (nextDue !== bill.nextDue)
            await saveBill(db, sub, { ...bill, nextDue });
        for (const event of mine.filter((e) => e.dueDate >= today && (e.amountCents !== bill.amountCents || e.amountAsOf !== bill.amountAsOf))) {
            if (Date.now() >= stopAt)
                return;
            await saveEvent(db, sub, { ...event, amountCents: bill.amountCents, amountAsOf: bill.amountAsOf });
        }
    }
}
/**
 * @description Keep the due dates current: add the ones missing, mark the ones a charge in the
 * records paid, and bring expected amounts and next due dates up to date. Safe to run again: a due
 * date has one id, and a pass that runs out of time is finished by the next.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param today - YYYY-MM-DD.
 * @param txns - The person's transactions for this month and the two before; read here when not given.
 * @param stopAt - The clock time (ms) after which nothing new is started.
 * @returns How many due dates were added and how many were found paid, and whether the pass finished.
 */
async function syncBills(db, sub, bookId, today, txns, stopAt = Infinity) {
    const book = await (0, finance_ledger_store_1.readBook)(db, sub, bookId), months = eventMonths(today);
    let bills = await listBills(db, sub, bookId);
    if (!bills.some((bill) => bill.state === 'confirmed'))
        return { added: 0, paid: 0, complete: true };
    const added = await addDueDates(db, sub, book, bills, await listEvents(db, sub, bookId, months), today, stopAt);
    const records = txns || await (0, finance_ledger_store_1.listMonths)(db, sub, bookId, (0, finance_day_model_1.recentMonths)(today, 3));
    const pairs = matchPayments(bills, await listEvents(db, sub, bookId, months), records).filter((p) => !(0, finance_ledger_store_1.monthClosed)(book, p.event.month) && !(0, finance_ledger_store_1.monthClosed)(book, p.txn.month));
    for (const pair of pairs) {
        if (Date.now() >= stopAt)
            return { added, paid: pairs.indexOf(pair), complete: false };
        await keepPayment(db, sub, pair.bill, pair.event, pair.txn);
        const followed = followPayment(pair.bill, pair.txn);
        if (followed) {
            await saveBill(db, sub, followed);
            bills = bills.map((bill) => (bill.billId === followed.billId ? followed : bill));
        }
    }
    await settleBills(db, sub, bills, await listEvents(db, sub, bookId, months), today, stopAt);
    return { added, paid: pairs.length, complete: Date.now() < stopAt };
}
/* ─── writes a person makes ─────────────────────────────────────────────────── */
/** The day of the month a request names, 1 to 31. */
function dueDayOf(value) {
    const day = Number(value);
    if (!Number.isInteger(day) || day < 1 || day > 31)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_due_day', 'The day a bill is due is a day of the month, 1 to 31.');
    return day;
}
/** The first date on or after a day that falls on a day of the month. */
function nextOn(day, today) {
    const here = (0, finance_day_model_1.dayInMonth)((0, finance_ledger_store_1.monthOf)(today), day);
    return here >= today ? here : (0, finance_day_model_1.dayInMonth)((0, finance_day_model_1.addMonths)((0, finance_ledger_store_1.monthOf)(today), 1), day);
}
/** A bill with an amount the person typed: it stays as typed and says so. */
function withTypedAmount(bill, cents, today) {
    return { ...bill, amountCents: cents, amountAsOf: cents === null ? null : today, source: 'typed', sourceLabel: 'Typed by you', posture: bill.posture === 'sample' ? 'sample' : 'typed' };
}
/**
 * @description Add a bill a person typed. It is confirmed at once: they typed it.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param body - payee and nextDue, and optionally amountCents, cadence, accountId, category, requestId.
 * @param today - YYYY-MM-DD.
 * @returns The bill.
 */
async function addBill(db, sub, bookId, body, today) {
    const payee = (0, finance_day_kit_1.nameOf)(body.payee, 'Say who the bill is paid to.'), cadence = String(body.cadence || 'monthly'), now = (0, finance_ledger_store_1.nowStamp)();
    if (!exports.CADENCES[cadence])
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_cadence', 'A bill comes due weekly, every two weeks, monthly, quarterly or yearly.');
    const nextDue = (0, finance_day_kit_1.dateOf)(body.nextDue, 'The due date');
    if (!nextDue)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'due_date_required', 'Say when the bill is next due.');
    const cents = (0, finance_day_kit_1.centsOf)(body.amountCents, 'The amount');
    const bill = {
        billId: typeof body.requestId === 'string' && body.requestId ? (0, finance_ledger_store_1.hashId)('bill', sub, 'request', body.requestId) : (0, finance_ledger_store_1.newId)('bill'), bookId, payee,
        matchText: (0, finance_day_model_1.merchantKey)({ merchant: payee, description: payee }), amountCents: cents, amountAsOf: cents === null ? null : today, currency: 'USD', cadence,
        dueDay: exports.CADENCES[cadence].months ? Number(nextDue.slice(8, 10)) : null, firstDue: nextDue, nextDue, accountId: (0, finance_ledger_store_1.cleanText)(body.accountId, 80),
        category: (0, finance_ledger_store_1.cleanText)(body.category, 60), origin: 'typed', source: 'typed', sourceLabel: 'Typed by you', posture: 'typed', state: 'confirmed',
        evidence: null, createdAt: now, updatedAt: now,
    };
    await (0, finance_ledger_store_1.ensureBook)(db, sub, bookId);
    await insertBill(db, sub, bill);
    return needBill(db, sub, bill.billId);
}
/** Remove a bill's unpaid due dates from a day on, before its schedule changes or it ends. */
async function dropUnpaid(db, sub, bill, today) {
    const events = await listEvents(db, sub, bill.bookId, eventMonths(today));
    for (const event of events.filter((e) => e.billId === bill.billId && e.state === 'due' && e.dueDate >= today)) {
        await db.query(exports.BILLS_SQL.eventDelete, [event.eventId, sub]);
    }
}
/**
 * @description Change a bill: its payee, amount, day of the month, account or category. A new day of
 * the month replaces the unpaid due dates ahead.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bill - The bill as it stands.
 * @param body - The values to change.
 * @param today - YYYY-MM-DD.
 * @returns The bill as changed (not yet stored).
 */
async function changedBill(db, sub, bill, body, today) {
    let next = { ...bill };
    if (body.payee !== undefined) {
        next.payee = (0, finance_day_kit_1.nameOf)(body.payee, 'Say who the bill is paid to.');
        if (bill.origin === 'typed')
            next.matchText = (0, finance_day_model_1.merchantKey)({ merchant: next.payee, description: next.payee });
    }
    if (body.amountCents !== undefined)
        next = withTypedAmount(next, (0, finance_day_kit_1.centsOf)(body.amountCents, 'The amount'), today);
    if (body.accountId !== undefined)
        next.accountId = (0, finance_ledger_store_1.cleanText)(body.accountId, 80);
    if (body.category !== undefined)
        next.category = (0, finance_ledger_store_1.cleanText)(body.category, 60);
    if (body.dueDay !== undefined && exports.CADENCES[bill.cadence].months && dueDayOf(body.dueDay) !== bill.dueDay) {
        next.dueDay = dueDayOf(body.dueDay);
        if (bill.state === 'confirmed') {
            await dropUnpaid(db, sub, bill, today);
            next.firstDue = nextOn(next.dueDay, today);
        }
    }
    return next;
}
/**
 * @description Mark one due date paid because the person says so, skip it, or put it back to due.
 * Bookkeeping only: nothing is paid.
 * @param db - The pool.
 * @param sub - The caller.
 * @param event - The due date.
 * @param answer - 'paid', 'skipped' or 'due'.
 * @param body - For paid: optionally paidOn and amountCents.
 * @param today - YYYY-MM-DD.
 * @returns The due date as it now stands.
 */
async function answerEvent(db, sub, event, answer, body, today) {
    (0, finance_ledger_store_1.assertMonthOpen)(await (0, finance_ledger_store_1.readBook)(db, sub, event.bookId), event.month);
    if (answer !== 'paid' && event.paidTxnId)
        throw new finance_ledger_store_1.LedgerRefusal(409, 'paid_in_records', 'This bill was matched to a payment in your records, so it stays paid.');
    const cleared = { paidOn: null, paidCents: null, paidTxnId: '', paidBy: '', paidSource: '', paidSourceLabel: '', paidPosture: '' };
    let next = { ...event, ...cleared, state: answer };
    if (answer === 'paid') {
        const paidOn = (0, finance_day_kit_1.dateOf)(body.paidOn, 'The date paid') || today, cents = (0, finance_day_kit_1.centsOf)(body.amountCents, 'The amount paid');
        if (paidOn > today)
            throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_date', 'The date paid must be today or earlier.');
        next = event.paidTxnId ? event : { ...next, paidOn, paidCents: cents, paidBy: 'marked', paidSource: cents === null ? '' : 'typed', paidSourceLabel: cents === null ? '' : 'Typed by you', paidPosture: cents === null ? '' : 'typed' };
    }
    await saveEvent(db, sub, next);
    return next;
}
/* ─── the routes ────────────────────────────────────────────────────────────── */
/**
 * @description The bills list for one set of records.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param today - YYYY-MM-DD.
 * @returns Proposals, confirmed bills, and the due dates by where they stand.
 */
async function readBills(db, sub, bookId, today) {
    const bills = await listBills(db, sub, bookId), lists = billLists(bills, await listEvents(db, sub, bookId, eventMonths(today)), today);
    return {
        book: bookId, asOf: today, proposals: bills.filter((bill) => bill.state === 'proposed').map(billCard),
        bills: bills.filter((bill) => bill.state === 'confirmed').map(billCard), ended: bills.filter((bill) => bill.state === 'ended').map(billCard),
        overdue: lists.overdue, week: lists.week, later: lists.later, paid: lists.paid, note: exports.PAID_NOTE,
    };
}
/** Answer one due date and say what the answer was. */
async function answered(db, sub, eventId, answer, body, today) {
    const event = await answerEvent(db, sub, await needEvent(db, sub, eventId), answer, body, today);
    const bill = await needBill(db, sub, event.billId);
    await syncBills(db, sub, bill.bookId, today);
    return { ok: true, due: dueOf(bill, event, today), note: answer === 'paid' ? exports.PAID_NOTE : null };
}
/** Store a bill's new state and bring its due dates up to date. */
async function settled(db, sub, bill, today) {
    await saveBill(db, sub, bill);
    await syncBills(db, sub, bill.bookId, today);
    return { ok: true, bill: billCard(await needBill(db, sub, bill.billId)) };
}
/**
 * @description The bills routes, mounted at /api/finance/bills.
 * @param ctx - The application context (its pool).
 * @returns The router.
 */
function createFinanceBillsRoutes(ctx) {
    const router = (0, express_1.Router)();
    const db = ctx.pool;
    /** GET / — proposals, bills, and what is overdue, due this week, due later and paid this month. */
    router.get('/', (0, finance_day_kit_1.route)('bills', (sub, req) => readBills(db, sub, (0, finance_day_kit_1.bookOf)(req), (0, finance_day_kit_1.dayOf)(req))));
    /** POST / — add a bill the person typed. */
    router.post('/', (0, finance_day_kit_1.route)('bills.add', async (sub, req) => settled(db, sub, await addBill(db, sub, (0, finance_day_kit_1.bookOf)(req), (0, finance_day_kit_1.bodyOf)(req), (0, finance_day_kit_1.dayOf)(req)), (0, finance_day_kit_1.dayOf)(req))));
    /** POST /events/:eventId/paid — mark a due date paid in Finance. It does not pay the bill. */
    router.post('/events/:eventId/paid', (0, finance_day_kit_1.route)('bills.paid', (sub, req) => answered(db, sub, String(req.params.eventId), 'paid', (0, finance_day_kit_1.bodyOf)(req), (0, finance_day_kit_1.dayOf)(req))));
    /** POST /events/:eventId/skip — this due date does not apply. */
    router.post('/events/:eventId/skip', (0, finance_day_kit_1.route)('bills.skip', (sub, req) => answered(db, sub, String(req.params.eventId), 'skipped', (0, finance_day_kit_1.bodyOf)(req), (0, finance_day_kit_1.dayOf)(req))));
    /** POST /events/:eventId/unpaid — put a due date the person marked or skipped back to due. */
    router.post('/events/:eventId/unpaid', (0, finance_day_kit_1.route)('bills.unpaid', (sub, req) => answered(db, sub, String(req.params.eventId), 'due', (0, finance_day_kit_1.bodyOf)(req), (0, finance_day_kit_1.dayOf)(req))));
    /** POST /:billId/confirm — a proposed bill becomes a bill (confirm: true); payee, amount and day may be corrected. */
    router.post('/:billId/confirm', (0, finance_day_kit_1.route)('bills.confirm', async (sub, req) => {
        const bill = await needBill(db, sub, String(req.params.billId)), today = (0, finance_day_kit_1.dayOf)(req);
        (0, finance_day_kit_1.requireConfirm)((0, finance_day_kit_1.bodyOf)(req), 'Adding this bill');
        if (!['proposed', 'dismissed'].includes(bill.state))
            throw new finance_ledger_store_1.LedgerRefusal(409, 'already_answered', 'This bill is already in your bills.');
        return settled(db, sub, { ...(await changedBill(db, sub, bill, (0, finance_day_kit_1.bodyOf)(req), today)), state: 'confirmed' }, today);
    }));
    /** POST /:billId/dismiss — a proposed bill is not a bill; it is not proposed again. */
    router.post('/:billId/dismiss', (0, finance_day_kit_1.route)('bills.dismiss', async (sub, req) => {
        const bill = await needBill(db, sub, String(req.params.billId));
        if (bill.state !== 'proposed')
            throw new finance_ledger_store_1.LedgerRefusal(409, 'already_answered', 'Only a bill Finance proposed can be turned down.');
        return settled(db, sub, { ...bill, state: 'dismissed' }, (0, finance_day_kit_1.dayOf)(req));
    }));
    /** POST /:billId/end — the bill no longer comes due; its unpaid due dates ahead are removed. */
    router.post('/:billId/end', (0, finance_day_kit_1.route)('bills.end', async (sub, req) => {
        const bill = await needBill(db, sub, String(req.params.billId)), today = (0, finance_day_kit_1.dayOf)(req);
        await dropUnpaid(db, sub, bill, today);
        return settled(db, sub, { ...bill, state: 'ended', nextDue: null }, today);
    }));
    /** POST /:billId/delete — delete a bill that has ended, with its due dates (confirm: true). */
    router.post('/:billId/delete', (0, finance_day_kit_1.route)('bills.delete', async (sub, req) => {
        const bill = await needBill(db, sub, String(req.params.billId));
        (0, finance_day_kit_1.requireConfirm)((0, finance_day_kit_1.bodyOf)(req), 'Deleting this bill');
        const removed = await deleteBill(db, sub, bill);
        return { ok: true, billId: bill.billId, deleted: true, dueDatesRemoved: removed };
    }));
    /** POST /:billId — change a bill's payee, amount, day of the month, account or category. */
    router.post('/:billId', (0, finance_day_kit_1.route)('bills.change', async (sub, req) => {
        const today = (0, finance_day_kit_1.dayOf)(req);
        return settled(db, sub, await changedBill(db, sub, await needBill(db, sub, String(req.params.billId)), (0, finance_day_kit_1.bodyOf)(req), today), today);
    }));
    return router;
}
//# sourceMappingURL=finance-bills.js.map