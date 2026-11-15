"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Finance's own records over HTTP, mounted at /api/finance/ledger (Roger, 2026-11-12: Finance as a person's money day, with no bank connection needed). Accounts (GET, and POST to add one or type a balance), transactions (GET a month, POST one typed, POST /:id to set its category, mark it reviewed, note it or say it is not mine), statement imports (preview, apply, undo, the list and one import) and the "Send to..." endpoint that turns a statement another application hands over into a preview. Every GET only reads. Every amount answered is a figure with its source and date; an account with no known balance answers null, never zero. Applying and undoing an import need confirm: true. Nothing here moves money, places an order, links a bank or creates a table.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Finance 1.7.0 (Lane FINH1b): bills follow the records. After an import is applied in full, an import is undone, or a transaction is typed, the answer also carries bills: what the day module's afterRecordsChange found (a bill proposed for each repeating charge the person has no bill for, due dates marked paid by matching charges), bounded to 15 s inside the request. A failure there is logged and never undoes the change. Every GET still only reads.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Finance 1.8.0 (Lane FINH2): Undo puts back to due every due date one of the removed transactions had paid (the answer says how many, as released), before the bills follow the records; and the imports list answers the statements brought in (applied, being applied, or undone), not a preview nobody added (VER2 on the test slot: a second preview of the same file stayed in Statements brought in with no Undo). A preview is still read by its id.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFinanceLedgerRoutes = createFinanceLedgerRoutes;
/**
 * @module finance-ledger
 */
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const artifact_exchange_1 = require("@/shared/artifact-exchange");
const finance_ledger_store_1 = require("./finance-ledger-store");
const finance_ledger_import_1 = require("./finance-ledger-import");
const finance_parse_csv_1 = require("./finance-parse-csv");
const finance_parse_text_1 = require("./finance-parse-text");
const finance_aggregate_1 = require("./finance-aggregate");
const finance_day_1 = require("./finance-day");
const finance_bills_1 = require("./finance-bills");
const finance_day_kit_1 = require("./finance-day-kit");
const logger = (0, logger_1.createChildLogger)({ module: 'finance-ledger' });
/** How long the bills may take to follow a change, inside the request that made it (the kernel ends a call at 60 s). */
const BILLS_FOLLOW_MS = 15_000;
/**
 * Bills follow the records after a change: a repeating charge becomes a proposal, a matching charge marks a due date
 * paid. A failure is logged and never undoes the change; the next change tries again.
 */
async function billsFollow(db, sub, req) {
    try {
        return await (0, finance_day_1.afterRecordsChange)(db, sub, (0, finance_day_kit_1.dayOf)(req), Date.now() + BILLS_FOLLOW_MS);
    }
    catch (err) {
        logger.error({ err }, 'finance bills did not follow the records');
        return null;
    }
}
/** Lines of a preview answered in full; the counts always cover the whole file. */
const PREVIEW_ROWS = 200;
/** The longest bill text kept with its document record. */
const BILL_TEXT_LIMIT = 20_000;
/** Signed-in caller's OIDC sub. */
function callerSub(req) {
    const u = req.oidc?.user;
    const sub = u?.sub || u?.oid;
    return sub ? String(sub) : null;
}
/** Today as YYYY-MM-DD. */
function today() {
    return new Date().toISOString().slice(0, 10);
}
/**
 * @description Wrap one handler: require a signed-in caller, answer a refusal in its own words and
 * log anything else.
 * @param name - The route's name for the log.
 * @param run - The handler; what it returns is the JSON answer.
 * @returns The Express handler.
 */
function route(name, run) {
    return async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            res.json(await run(sub, req));
        }
        catch (err) {
            if (err instanceof finance_ledger_store_1.LedgerRefusal) {
                res.status(err.status).json({ error: err.code, message: err.message });
                return;
            }
            logger.error({ err, route: name }, 'finance ledger route failed');
            res.status(500).json({ error: 'ledger_unavailable', message: 'Finance could not read or change your records just now. Try again.' });
        }
    };
}
/** Require the explicit confirmation a write that adds or removes many records needs. */
function requireConfirm(body, what) {
    if (!body || body.confirm !== true)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'confirm_required', `${what} needs your confirmation.`);
}
/* ─── what the routes answer ────────────────────────────────────────────────── */
/** An account as a screen reads it. */
function presentAccount(a, linked) {
    const disconnected = a.source === 'plaid' && !linked.has(a.linkId);
    const balance = (0, finance_ledger_store_1.balanceFigure)(a);
    return {
        id: a.accountId, name: a.name, institution: a.institution, type: a.type, subtype: a.subtype, last4: a.last4, currency: a.currency,
        owed: finance_ledger_store_1.OWED_TYPES.includes(a.type), balance, balanceNote: balance ? null : 'Not known yet', source: a.source,
        sourceLabel: a.sourceLabel, posture: a.posture || null, state: disconnected ? 'disconnected' : a.state, updatedAt: a.updatedAt,
    };
}
/** One total over several accounts: the oldest date, and the source in words (one source by name, several as a count). */
function totalFigure(cents, parts) {
    if (!parts.length)
        return null;
    const labels = [...new Set(parts.map((p) => p.figure.source))], kinds = [...new Set(parts.map((p) => p.figure.sourceKind))];
    const postures = [...new Set(parts.map((p) => p.figure.posture || ''))];
    const oldest = parts.map((p) => p.figure.asOf).sort()[0];
    return (0, finance_ledger_store_1.figure)(cents, parts[0].figure.currency, labels.length === 1 ? labels[0] : `${labels.length} sources`, kinds.length === 1 ? kinds[0] : 'mixed', oldest, postures.length === 1 ? postures[0] : '');
}
/** Net worth over the accounts whose balance is known, with its parts and the accounts left out. */
function netWorth(accounts, linked) {
    const open = accounts.filter((a) => a.state === 'open' && !(a.source === 'plaid' && !linked.has(a.linkId)));
    const parts = open.flatMap((a) => { const f = (0, finance_ledger_store_1.balanceFigure)(a); return f ? [{ accountId: a.accountId, name: a.name, owed: finance_ledger_store_1.OWED_TYPES.includes(a.type), figure: f }] : []; });
    const without = open.filter((a) => !(0, finance_ledger_store_1.balanceFigure)(a)).map((a) => a.name);
    if (new Set(parts.map((p) => p.figure.currency)).size > 1) {
        return { assets: null, liabilities: null, net: null, parts, without, note: 'These accounts are in more than one currency, so no total is shown.' };
    }
    const have = parts.filter((p) => !p.owed), owe = parts.filter((p) => p.owed);
    const assets = have.reduce((sum, p) => sum + p.figure.cents, 0), liabilities = owe.reduce((sum, p) => sum + Math.max(p.figure.cents, 0), 0);
    return {
        assets: totalFigure(assets, have), liabilities: totalFigure(liabilities, owe), net: totalFigure(assets - liabilities, parts), parts, without,
        note: without.length ? `Without ${without.join(', ')}: no balance is known yet.` : null,
    };
}
/** A transaction as a screen reads it. */
function presentTransaction(t, names) {
    return {
        id: t.txnId, accountId: t.accountId, account: names.get(t.accountId) || '', date: t.date, month: t.month, amount: (0, finance_ledger_store_1.amountFigure)(t),
        direction: t.direction, description: t.description, merchant: t.merchant, category: t.category, categorySource: t.categorySource,
        review: t.review, flags: t.flags, note: t.note, source: t.source, importId: t.importId, matchedBillId: t.matchedBillId,
        matchedInvoiceId: t.matchedInvoiceId,
    };
}
/** An import as a screen reads it. */
function presentImport(i, names) {
    const proposed = i.newAccount;
    return {
        id: i.importId, kind: i.kind, fileName: i.fileName, accountId: i.accountId, account: names.get(i.accountId) || proposed?.name || '',
        period: i.periodStart && i.periodEnd ? { start: i.periodStart, end: i.periodEnd } : null,
        counts: { total: i.rowsTotal, toAdd: i.state === 'previewed' || i.state === 'applying' ? i.rowsNew : 0, added: i.rowsAdded, duplicate: i.rowsDuplicate, unreadable: i.rowsUnreadable },
        state: i.state, canUndo: finance_ledger_import_1.FILE_KINDS.includes(i.kind) && i.state !== 'undone', createdAt: i.createdAt, appliedAt: i.appliedAt, undoneAt: i.undoneAt,
    };
}
/** A preview as the import sheet reads it: the account, the counts over the whole file and its first lines. */
function presentPreview(preview) {
    const { record, target, candidates, parsed } = preview;
    const label = target ? `${target.account.institution || target.account.name} statement` : record.fileName || 'Statement';
    const asOf = record.periodEnd || today();
    const toAdd = target ? candidates.filter((c) => c.status === 'new').length : parsed.rows.length;
    const closing = parsed.closingBalance ? (0, finance_ledger_store_1.figure)(parsed.closingBalance.cents, target?.account.currency || 'USD', label, 'import', parsed.closingBalance.asOf) : null;
    const lines = target
        ? candidates.slice(0, PREVIEW_ROWS).map((c) => ({ line: c.row.line, date: c.txn.date, amount: (0, finance_ledger_store_1.figure)(c.txn.amountCents, c.txn.currency, label, 'import', c.txn.date), direction: c.txn.direction, description: c.txn.description, category: c.txn.category, categorySource: c.txn.categorySource, status: c.status }))
        : parsed.rows.slice(0, PREVIEW_ROWS).map((r) => ({ line: r.line, date: r.date, amount: (0, finance_ledger_store_1.figure)(r.amountCents, 'USD', label, 'import', r.date), direction: r.direction, description: r.description, category: r.category || '', categorySource: '', status: 'new' }));
    return {
        importId: record.importId, kind: record.kind, fileName: record.fileName, state: record.state, asOf,
        account: target ? { id: target.account.accountId, name: target.account.name, institution: target.account.institution, type: target.account.type, last4: target.account.last4, isNew: target.isNew, guessed: target.guessed } : null,
        needsAccount: !target,
        counts: { total: parsed.rows.length, toAdd, duplicate: candidates.filter((c) => c.status === 'duplicate').length, closedMonth: candidates.filter((c) => c.status === 'closed').length, unreadable: parsed.unreadableCount },
        period: parsed.period, closingBalance: closing, rows: lines, rowsShown: lines.length, unreadable: parsed.unreadable,
        columnMap: parsed.columnMap || null, headerKey: parsed.headerKey || null, button: `Add ${toAdd.toLocaleString('en-US')} transaction${toAdd === 1 ? '' : 's'}`,
    };
}
/* ─── reads the handlers share ──────────────────────────────────────────────── */
/** The ids of the caller's bank links, to tell a linked account from one whose bank was disconnected. */
async function linkedItems(db, sub) {
    const rows = (await db.query('SELECT item_id FROM oshal_finance_items WHERE user_sub = $1', [sub])).rows;
    return new Set(rows.map((row) => String(row.item_id)));
}
/** Account names by id, for labelling transactions and imports. */
async function accountNames(db, sub, bookId) {
    return new Map((await (0, finance_ledger_store_1.listAccounts)(db, sub, bookId)).map((a) => [a.accountId, a.name]));
}
/** The first and last month any applied import covers, so a screen knows which months hold records. */
function monthsCovered(imports) {
    const live = imports.filter((i) => (i.state === 'applied' || i.state === 'applying') && i.periodStart && i.periodEnd);
    if (!live.length)
        return null;
    return { first: (0, finance_ledger_store_1.monthOf)(live.map((i) => i.periodStart).sort()[0]), last: (0, finance_ledger_store_1.monthOf)(live.map((i) => i.periodEnd).sort().pop()) };
}
/* ─── accounts ──────────────────────────────────────────────────────────────── */
/** A typed balance checked: whole cents with a real date that is not in the future, or neither. */
function typedBalance(body) {
    if (body.balanceCents === undefined || body.balanceCents === null || body.balanceCents === '')
        return null;
    const cents = Number(body.balanceCents), asOf = String(body.balanceAsOf || today());
    if (!Number.isSafeInteger(cents) || Math.abs(cents) > 1e13)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_balance', 'A balance is a whole number of cents.');
    if (!(0, finance_ledger_store_1.isDate)(asOf) || asOf > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10))
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_date', 'The balance date must be a real date, today or earlier.');
    return { cents, asOf };
}
/** Add an account a person typed. */
async function addAccount(db, sub, bookId, body) {
    const name = (0, finance_ledger_store_1.cleanText)(body.name, 80), type = String(body.type || 'depository');
    if (!name)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'name_required', 'Give the account a name.');
    if (!finance_ledger_store_1.ACCOUNT_TYPES.includes(type))
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_type', 'An account is one of: depository, credit, loan, investment, other.');
    const balance = typedBalance(body), now = (0, finance_ledger_store_1.nowStamp)();
    const account = {
        accountId: typeof body.requestId === 'string' && body.requestId ? (0, finance_ledger_store_1.hashId)('acct', sub, 'request', body.requestId) : (0, finance_ledger_store_1.newId)('acct'), bookId, name,
        institution: (0, finance_ledger_store_1.cleanText)(body.institution, 80), type, subtype: (0, finance_ledger_store_1.cleanText)(body.subtype, 40), last4: (0, finance_ledger_store_1.lastFour)(body.last4),
        currency: /^[A-Za-z]{3}$/.test(String(body.currency || '')) ? String(body.currency).toUpperCase() : 'USD',
        balanceCents: balance?.cents ?? null, balanceAsOf: balance?.asOf ?? null, source: 'typed', sourceLabel: 'Typed by you', posture: 'typed',
        linkId: '', importMap: null, state: 'open', createdAt: now, updatedAt: now,
    };
    await (0, finance_ledger_store_1.ensureBook)(db, sub, bookId);
    await (0, finance_ledger_store_1.insertAccount)(db, sub, account);
    return (await (0, finance_ledger_store_1.readAccount)(db, sub, account.accountId)) || account;
}
/** Change an account a person owns: its name and, typed, its balance with a date. */
async function changeAccount(db, sub, bookId, body) {
    const account = await (0, finance_ledger_store_1.readAccount)(db, sub, String(body.accountId));
    if (!account || account.bookId !== bookId)
        throw new finance_ledger_store_1.LedgerRefusal(404, 'unknown_account', 'That account is not in your records.');
    const balance = typedBalance(body);
    if (balance && account.source === 'plaid')
        throw new finance_ledger_store_1.LedgerRefusal(409, 'linked_balance', 'This balance comes from your bank link. Choose Sync to update it.');
    if (account.source === 'sample')
        throw new finance_ledger_store_1.LedgerRefusal(409, 'sample_account', 'This is a sample account. Add your own account to keep your own figures.');
    const next = { ...account, name: (0, finance_ledger_store_1.cleanText)(body.name, 80) || account.name };
    if (body.institution !== undefined)
        next.institution = (0, finance_ledger_store_1.cleanText)(body.institution, 80);
    if (body.state === 'closed' || body.state === 'open')
        next.state = String(body.state);
    if (balance)
        Object.assign(next, { balanceCents: balance.cents, balanceAsOf: balance.asOf, source: 'typed', sourceLabel: 'Typed by you', posture: 'typed' });
    await (0, finance_ledger_store_1.saveAccount)(db, sub, next);
    return next;
}
/* ─── transactions ──────────────────────────────────────────────────────────── */
/** A typed transaction checked and built. */
function typedTransaction(sub, account, body) {
    const date = String(body.date || ''), cents = Number(body.amountCents), direction = body.direction === 'in' ? 'in' : body.direction === 'out' ? 'out' : '';
    const description = (0, finance_ledger_store_1.cleanText)(body.description);
    if (!(0, finance_ledger_store_1.isDate)(date))
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_date', 'A transaction needs a real date.');
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1e13)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_amount', 'An amount is a whole number of cents above zero.');
    if (!direction)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_direction', 'Say whether the money came in or went out.');
    if (!description)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'description_required', 'Say what the transaction was.');
    const now = (0, finance_ledger_store_1.nowStamp)();
    return {
        txnId: typeof body.requestId === 'string' && body.requestId ? (0, finance_ledger_store_1.hashId)('t', sub, 'request', body.requestId) : (0, finance_ledger_store_1.newId)('t'), bookId: account.bookId,
        accountId: account.accountId, month: (0, finance_ledger_store_1.monthOf)(date), date, amountCents: cents, direction, currency: account.currency, description,
        merchant: description, category: (0, finance_ledger_store_1.cleanText)(body.category, 60) || (direction === 'in' ? 'Income' : 'Other'), categorySource: body.category ? 'person' : 'guess',
        review: 'reviewed', flags: [], note: (0, finance_ledger_store_1.cleanText)(body.note), source: 'typed', sourceLabel: 'Typed by you', sourceRef: '', posture: 'typed',
        importId: (0, finance_ledger_import_1.typedImportId)(sub, account.bookId), matchedBillId: '', matchedInvoiceId: '', createdAt: now, updatedAt: now,
    };
}
/** Keep the one record that stands for what a person typed, widened to cover this date. */
async function keepTypedImport(db, sub, t) {
    const held = await (0, finance_ledger_store_1.readImport)(db, sub, t.importId);
    if (held) {
        await (0, finance_ledger_store_1.saveImport)(db, sub, { ...held, state: 'applied', rowsAdded: held.rowsAdded + 1, rowsTotal: held.rowsTotal + 1,
            periodStart: !held.periodStart || t.date < held.periodStart ? t.date : held.periodStart, periodEnd: !held.periodEnd || t.date > held.periodEnd ? t.date : held.periodEnd });
        return;
    }
    await (0, finance_ledger_store_1.insertImport)(db, sub, {
        importId: t.importId, bookId: t.bookId, accountId: '', newAccount: null, kind: 'typed', fileName: 'Typed by you', fingerprint: '', periodStart: t.date,
        periodEnd: t.date, rowsTotal: 1, rowsNew: 0, rowsDuplicate: 0, rowsUnreadable: 0, rowsAdded: 1, closingBalanceCents: null, closingBalanceAsOf: null,
        columnMap: null, pending: null, state: 'applied', docId: '', createdAt: (0, finance_ledger_store_1.nowStamp)(), appliedAt: (0, finance_ledger_store_1.nowStamp)(), undoneAt: null,
    });
}
/** Add one transaction a person typed. */
async function addTransaction(db, sub, bookId, body) {
    const account = await (0, finance_ledger_store_1.readAccount)(db, sub, String(body.accountId || ''));
    if (!account || account.bookId !== bookId)
        throw new finance_ledger_store_1.LedgerRefusal(404, 'unknown_account', 'Choose one of your accounts for this transaction.');
    const txn = typedTransaction(sub, account, body);
    (0, finance_ledger_store_1.assertMonthOpen)(await (0, finance_ledger_store_1.ensureBook)(db, sub, bookId), txn.month);
    const { added } = await (0, finance_ledger_store_1.insertTransactions)(db, sub, [txn]);
    if (added) {
        await keepTypedImport(db, sub, txn);
        await (0, finance_aggregate_1.rebuildSnapshot)(db, sub);
    }
    return txn;
}
/** Change what a person may change on a transaction; a typed one can also be removed. */
async function changeTransaction(db, sub, txnId, body) {
    const txn = await (0, finance_ledger_store_1.readTransaction)(db, sub, txnId);
    if (!txn)
        throw new finance_ledger_store_1.LedgerRefusal(404, 'unknown_transaction', 'That transaction is not in your records.');
    (0, finance_ledger_store_1.assertMonthOpen)(await (0, finance_ledger_store_1.readBook)(db, sub, txn.bookId), txn.month);
    if (body.remove === true) {
        if (txn.source !== 'typed')
            throw new finance_ledger_store_1.LedgerRefusal(409, 'not_typed', 'Only a transaction you typed can be removed here. Undo the import that brought this one.');
        await db.query(finance_ledger_store_1.LEDGER_SQL.txnDelete, [txn.txnId, sub]);
        await (0, finance_aggregate_1.rebuildSnapshot)(db, sub);
        return null;
    }
    const category = body.category === undefined ? '' : (0, finance_ledger_store_1.cleanText)(body.category, 60);
    if (category) {
        txn.category = category;
        txn.categorySource = 'person';
    }
    if (typeof body.reviewed === 'boolean')
        txn.review = body.reviewed ? 'reviewed' : 'new';
    if (body.note !== undefined)
        txn.note = (0, finance_ledger_store_1.cleanText)(body.note);
    if (typeof body.notMine === 'boolean')
        txn.flags = body.notMine ? [...new Set([...txn.flags, 'not-mine'])] : txn.flags.filter((flag) => flag !== 'not-mine');
    await (0, finance_ledger_store_1.saveTransaction)(db, sub, txn);
    if (category && body.remember === true)
        await (0, finance_ledger_store_1.rememberRule)(db, sub, txn.bookId, txn.merchant || txn.description, category);
    return txn;
}
/* ─── imports ───────────────────────────────────────────────────────────────── */
/** The text a preview request carries, bounded. */
function previewInput(bookId, body) {
    if (typeof body.text !== 'string')
        throw new finance_ledger_store_1.LedgerRefusal(400, 'text_required', 'Send the statement as text.');
    if (body.text.length > finance_parse_csv_1.MAX_IMPORT_BYTES)
        throw new finance_ledger_store_1.LedgerRefusal(413, 'file_too_large', 'This file is larger than 2 MB. Finance reads statements up to 2 MB; export a shorter date range and add each part.');
    return {
        bookId, text: body.text, kind: typeof body.kind === 'string' ? body.kind : '', fileName: (0, finance_ledger_store_1.cleanText)(body.fileName, 120),
        accountId: typeof body.accountId === 'string' && body.accountId ? body.accountId : undefined,
        newAccount: body.newAccount && typeof body.newAccount === 'object' ? body.newAccount : undefined,
        columnMap: body.columnMap, docId: typeof body.docId === 'string' ? body.docId : undefined,
    };
}
/** A bill read from text: kept as a document with what Finance proposes, for the person to confirm on Bills. */
async function proposeBill(db, sub, input, origin) {
    if ((0, finance_ledger_import_1.kindOf)(input.text, input.fileName, input.kind) !== 'text' || !(0, finance_parse_text_1.looksLikeBill)(input.text))
        return null;
    const bill = (0, finance_parse_text_1.parseBillText)(input.text);
    if (!bill.ok)
        return null;
    const docId = (0, finance_ledger_store_1.newId)('doc');
    await (0, finance_ledger_store_1.ensureBook)(db, sub, input.bookId);
    await (0, finance_ledger_store_1.insertDocument)(db, sub, {
        docId, bookId: input.bookId, kind: 'bill', title: input.fileName || bill.payee, fingerprint: (0, finance_ledger_store_1.fingerprint)(input.text), bodyText: input.text.slice(0, BILL_TEXT_LIMIT),
        origin, produced: { proposal: { payee: bill.payee, amountDueCents: bill.amountDueCents, dueDate: bill.dueDate } }, createdAt: (0, finance_ledger_store_1.nowStamp)(),
    });
    return { kind: 'bill', docId, bill: { payee: bill.payee, amountDue: (0, finance_ledger_store_1.figure)(bill.amountDueCents, 'USD', `${bill.payee} bill`, 'import', today()), dueDate: bill.dueDate } };
}
/** Read a statement and answer its preview, a bill proposal, a request to match columns, or a refusal in words. */
async function preview(db, sub, input, origin) {
    const bill = await proposeBill(db, sub, input, origin);
    if (bill)
        return bill;
    const parsed = (0, finance_ledger_import_1.readStatement)(input);
    if (!parsed.ok)
        throw new finance_ledger_store_1.LedgerRefusal(422, parsed.code, parsed.message);
    if ('needsColumns' in parsed)
        return { needsColumns: true, header: parsed.header, headerKey: parsed.headerKey, sample: parsed.sample };
    return presentPreview(await (0, finance_ledger_import_1.previewImport)(db, sub, input, parsed));
}
/** One import with its lines again, for a sheet opened on a preview another screen made. */
async function importDetail(db, sub, importId) {
    const record = await (0, finance_ledger_store_1.readImport)(db, sub, importId);
    if (!record)
        throw new finance_ledger_store_1.LedgerRefusal(404, 'unknown_import', 'That import is not in your records.');
    const names = await accountNames(db, sub, record.bookId);
    const proposed = record.newAccount;
    const account = record.accountId ? await (0, finance_ledger_store_1.readAccount)(db, sub, record.accountId) : proposed && proposed.accountId ? proposed : null;
    const rows = (0, finance_ledger_import_1.pendingRows)(record);
    if (!account || !rows.length)
        return { ...presentImport(record, names), needsAccount: !account && rows.length > 0, rows: [] };
    const candidates = await (0, finance_ledger_import_1.classify)(db, sub, await (0, finance_ledger_store_1.readBook)(db, sub, record.bookId), account, rows, record.importId);
    const label = `${account.institution || account.name} statement`;
    return {
        ...presentImport(record, names), needsAccount: false,
        rows: candidates.slice(0, PREVIEW_ROWS).map((c) => ({ line: c.row.line, date: c.txn.date, amount: (0, finance_ledger_store_1.figure)(c.txn.amountCents, c.txn.currency, label, 'import', c.txn.date), direction: c.txn.direction, description: c.txn.description, category: c.txn.category, status: c.status })),
    };
}
/** The text of an artifact another application handed over, or a refusal in words. */
async function artifactText(req, sub, ref) {
    if (!/^art_[A-Za-z0-9_-]{8,64}$/.test(ref))
        throw new finance_ledger_store_1.LedgerRefusal(400, 'ref_required', 'A valid artifact reference is required.');
    const got = await (0, artifact_exchange_1.redeemArtifactViaRelay)({ port: req.socket?.localPort, callerSub: sub, ref, maxBytes: finance_parse_csv_1.MAX_IMPORT_BYTES, request: { headers: req.headers } });
    if (!got.ok)
        throw new finance_ledger_store_1.LedgerRefusal(got.status === 413 ? 413 : got.status === 404 ? 404 : 502, 'artifact_unavailable', got.status === 413 ? 'This file is larger than 2 MB. Finance reads statements up to 2 MB.' : 'Finance could not fetch that file. Use Send to again.');
    if (got.buffer.subarray(0, 5).toString('latin1') === '%PDF-')
        throw new finance_ledger_store_1.LedgerRefusal(415, 'pdf_needs_text', 'Finance reads a PDF from its own Add an account sheet, where the PDF is turned into text first. Open Finance, choose Add an account and pick the file there.');
    if (got.buffer.includes(0))
        throw new finance_ledger_store_1.LedgerRefusal(415, 'not_text', 'This file is not text. Save the statement as CSV, OFX or QFX and send that file.');
    return { name: (0, finance_ledger_store_1.cleanText)(got.name, 120), text: got.buffer.toString('utf8') };
}
/** Turn a handed-over statement into a preview and say so in one line the sender shows. */
async function importArtifact(db, sub, req) {
    const body = (req.body || {});
    const { name, text } = await artifactText(req, sub, String(body.ref ?? ''));
    const input = { bookId: finance_ledger_store_1.HOME_BOOK, text, fileName: name };
    const bill = await proposeBill(db, sub, input, 'send-to');
    if (bill)
        return { ok: true, ...bill, message: `Read ${name}: a bill from ${bill.bill.payee} is waiting in Finance.` };
    const parsed = (0, finance_ledger_import_1.readStatement)(input);
    if (!parsed.ok)
        throw new finance_ledger_store_1.LedgerRefusal(422, parsed.code, parsed.message);
    if ('needsColumns' in parsed)
        throw new finance_ledger_store_1.LedgerRefusal(422, 'needs_columns', 'Finance could not tell this file\'s columns apart. Open Finance, choose Add an account and add the file there to match them.');
    const docId = (0, finance_ledger_store_1.newId)('doc');
    await (0, finance_ledger_store_1.ensureBook)(db, sub, finance_ledger_store_1.HOME_BOOK);
    await (0, finance_ledger_store_1.insertDocument)(db, sub, { docId, bookId: finance_ledger_store_1.HOME_BOOK, kind: 'statement', title: name, fingerprint: (0, finance_ledger_store_1.fingerprint)(text), bodyText: '', origin: 'send-to', produced: null, createdAt: (0, finance_ledger_store_1.nowStamp)() });
    const made = await (0, finance_ledger_import_1.previewImport)(db, sub, { ...input, docId }, parsed);
    await (0, finance_ledger_store_1.saveDocumentProduced)(db, sub, docId, { importId: made.record.importId });
    const answer = presentPreview(made), toAdd = answer.counts.toAdd;
    return { ok: true, ...answer, docId, message: `Read ${name}: ${toAdd.toLocaleString('en-US')} transaction${toAdd === 1 ? '' : 's'} ready to add in Finance.` };
}
/**
 * @description Builds the ledger router (mount at /api/finance/ledger behind requiresAuth).
 * @param ctx - App context (the pool for the caller's own records).
 * @returns Express router.
 */
function createFinanceLedgerRoutes(ctx) {
    const router = (0, express_1.Router)();
    const db = ctx.pool;
    const bookOf = (req) => (0, finance_ledger_store_1.bookIdOf)(req.query?.book ?? req.body?.book);
    /** GET /accounts — the caller's accounts with each balance's source and date, and net worth over the known ones. */
    router.get('/accounts', route('accounts', async (sub, req) => {
        const bookId = bookOf(req);
        const [accounts, linked] = await Promise.all([(0, finance_ledger_store_1.listAccounts)(db, sub, bookId), linkedItems(db, sub)]);
        return { book: bookId, asOf: today(), accounts: accounts.map((a) => presentAccount(a, linked)), netWorth: netWorth(accounts, linked) };
    }));
    /** POST /accounts — add an account, or (with accountId) rename it or type its balance with a date. */
    router.post('/accounts', route('accounts.write', async (sub, req) => {
        const body = (req.body || {}), bookId = bookOf(req);
        const account = body.accountId ? await changeAccount(db, sub, bookId, body) : await addAccount(db, sub, bookId, body);
        await (0, finance_aggregate_1.rebuildSnapshot)(db, sub);
        return { ok: true, account: presentAccount(account, await linkedItems(db, sub)) };
    }));
    /** GET /transactions?month=YYYY-MM — one month of the caller's transactions, newest first. */
    router.get('/transactions', route('transactions', async (sub, req) => {
        const bookId = bookOf(req), query = req.query;
        const covered = monthsCovered(await (0, finance_ledger_store_1.listImports)(db, sub, bookId));
        const month = query.month === undefined || query.month === '' ? covered?.last || today().slice(0, 7) : String(query.month);
        if (!(0, finance_ledger_store_1.isMonth)(month))
            throw new finance_ledger_store_1.LedgerRefusal(400, 'bad_month', 'A month is written YYYY-MM.');
        const names = await accountNames(db, sub, bookId);
        const all = await (0, finance_ledger_store_1.listTransactions)(db, sub, bookId, month);
        const shown = all.filter((t) => (!query.account || t.accountId === query.account) && (!query.review || t.review === query.review));
        return { book: bookId, month, months: covered, counts: { total: all.length, toReview: all.filter((t) => t.review === 'new').length }, transactions: shown.map((t) => presentTransaction(t, names)) };
    }));
    /** POST /transactions — one transaction a person typed. */
    router.post('/transactions', route('transactions.add', async (sub, req) => {
        const bookId = bookOf(req);
        const txn = await addTransaction(db, sub, bookId, (req.body || {}));
        const bills = await billsFollow(db, sub, req);
        return { ok: true, transaction: presentTransaction(txn, await accountNames(db, sub, bookId)), bills };
    }));
    /** POST /transactions/:id — category, reviewed, note, not mine; remove: true for one a person typed. */
    router.post('/transactions/:id', route('transactions.change', async (sub, req) => {
        const txn = await changeTransaction(db, sub, String(req.params.id), (req.body || {}));
        return txn ? { ok: true, transaction: presentTransaction(txn, await accountNames(db, sub, txn.bookId)) } : { ok: true, removed: true };
    }));
    /** GET /imports — every statement brought in (applied, being applied, or undone), newest first. A preview nobody added is not listed. */
    router.get('/imports', route('imports', async (sub, req) => {
        const bookId = bookOf(req);
        const names = await accountNames(db, sub, bookId);
        return { book: bookId, imports: (await (0, finance_ledger_store_1.listImports)(db, sub, bookId)).filter((i) => i.state !== 'previewed').map((i) => presentImport(i, names)) };
    }));
    /** GET /imports/:id — one import; a preview still waiting answers its lines again. */
    router.get('/imports/:id', route('imports.one', (sub, req) => importDetail(db, sub, String(req.params.id))));
    /** POST /imports/preview — read a statement; writes nothing but the preview record. */
    router.post('/imports/preview', route('imports.preview', (sub, req) => preview(db, sub, previewInput(bookOf(req), (req.body || {})), 'upload')));
    /** POST /imports/artifact — the "Send to..." endpoint: {ref} becomes a preview. */
    router.post('/imports/artifact', route('imports.artifact', (sub, req) => importArtifact(db, sub, req)));
    /** POST /imports/:id/apply — add the preview's new transactions (confirm: true); call again while remaining is above zero. */
    router.post('/imports/:id/apply', route('imports.apply', async (sub, req) => {
        const body = (req.body || {});
        requireConfirm(body, 'Adding these transactions');
        const done = await (0, finance_ledger_import_1.applyImport)(db, sub, String(req.params.id), { accountId: typeof body.accountId === 'string' ? body.accountId : undefined, newAccount: body.newAccount && typeof body.newAccount === 'object' ? body.newAccount : undefined });
        const bills = done.remaining ? null : await billsFollow(db, sub, req);
        return { ok: true, state: done.record.state, added: done.added, addedTotal: done.record.rowsAdded, duplicate: done.record.rowsDuplicate, remaining: done.remaining, accountId: done.record.accountId, bills };
    }));
    /** POST /imports/:id/undo — take an import's transactions back out (confirm: true). */
    router.post('/imports/:id/undo', route('imports.undo', async (sub, req) => {
        requireConfirm(req.body, 'Undoing this import');
        const done = await (0, finance_ledger_import_1.undoImport)(db, sub, String(req.params.id));
        const released = await (0, finance_bills_1.releasePayments)(db, sub, done.record.bookId, done.removedTxns);
        const bills = await billsFollow(db, sub, req);
        return { ok: true, state: done.record.state, removed: done.removed, released, bills };
    }));
    return router;
}
//# sourceMappingURL=finance-ledger.js.map