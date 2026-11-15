"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | A statement import in three steps a person controls: preview (read the file, pick or propose the account, show what would be added and what is already there; nothing but the preview record is written), apply (add at most 1,500 new transactions a call, safe to call again, then bring the account's balance to the statement's closing balance and rebuild the snapshot) and undo (take the import's transactions back out, and the account or balance it brought). A duplicate is the same bank id, or the same account, date, amount and description; it is skipped, never added twice. A transaction in a closed month is not added. A category comes from the file, then from the person's own rules, then from a small table of plain words, and is marked as a guess until the person reviews it.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Finance 1.8.0 (Lane FINH2): undo also answers which transactions it took out (their ids and months), so the bills a removed payment had marked paid can be put back to due (VER2 on the test slot: after Undo the bill's matched payment stayed on Paid).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILE_KINDS = exports.APPLY_ROWS = void 0;
exports.guessCategory = guessCategory;
exports.kindOf = kindOf;
exports.readStatement = readStatement;
exports.classify = classify;
exports.previewImport = previewImport;
exports.pendingRows = pendingRows;
exports.applyImport = applyImport;
exports.undoImport = undoImport;
exports.typedImportId = typedImportId;
/**
 * No framework runtime import: runs with plain node and a PostgreSQL pool in tests/ledger-import.test.cjs.
 *
 * @module finance-ledger-import
 */
const finance_ledger_store_1 = require("./finance-ledger-store");
const finance_parse_csv_1 = require("./finance-parse-csv");
const finance_parse_ofx_1 = require("./finance-parse-ofx");
const finance_parse_text_1 = require("./finance-parse-text");
const finance_aggregate_1 = require("./finance-aggregate");
/** The most transactions one apply call adds, to stay inside the 60-second package call. */
exports.APPLY_ROWS = 1500;
/** The kinds of import a person can undo: the ones a file produced. */
exports.FILE_KINDS = Object.freeze(['csv', 'ofx', 'text']);
/** Plain words that suggest a category. First match wins; the result is a guess the person reviews. */
const CATEGORY_WORDS = [
    [/\b(payroll|paycheck|direct dep|salary|interest (paid|earned))\b/i, 'Income'],
    [/\b(transfer|xfer|payment thank you|card payment|autopay)\b/i, 'Transfer'],
    [/\b(loan payment|auto loan|student loan)\b/i, 'Loan payment'],
    [/\b(rent|apartments?|property management)\b/i, 'Rent'],
    [/\bmortgage\b/i, 'Mortgage'],
    [/\b(utilit\w*|electric|water|sewer|power|energy|internet|broadband|wireless)\b/i, 'Utilities'],
    [/\b(market|grocer\w*|supermarket|foods?)\b/i, 'Groceries'],
    [/\b(restaurant|trattoria|cafe|coffee|pizza|grill|diner|bistro|bakery)\b/i, 'Dining out'],
    [/\b(fuel|gas station|gasoline|petrol)\b/i, 'Gas'],
    [/\b(pharmacy|dental|dentist|clinic|hospital|medical|doctor|optical)\b/i, 'Health'],
    [/\binsurance\b/i, 'Insurance'],
    [/\b(streaming|subscription)\b/i, 'Streaming'],
    [/\b(fee|overdraft|service charge)\b/i, 'Fees'],
    [/\b(airline|hotel|lodging|travel)\b/i, 'Travel'],
    [/\b(tax|treasury)\b/i, 'Taxes'],
];
/**
 * @description The category a description suggests, from plain words only.
 * @param description - The transaction's description.
 * @param direction - Which way the money went.
 * @returns The suggested category ('Income' or 'Other' when no word matches).
 */
function guessCategory(description, direction) {
    for (const [words, category] of CATEGORY_WORDS)
        if (words.test(description))
            return category;
    return direction === 'in' ? 'Income' : 'Other';
}
/**
 * @description Which reader a file needs: OFX by its own header, then the file's name, then its shape.
 * @param text - The file's text.
 * @param fileName - The file's name, when known.
 * @param kind - The kind the caller named, when it did.
 * @returns 'csv', 'ofx' or 'text'.
 */
function kindOf(text, fileName = '', kind = '') {
    if (kind === 'csv' || kind === 'ofx' || kind === 'text')
        return kind;
    if ((0, finance_parse_ofx_1.looksLikeOfx)(text) || /\.(ofx|qfx)$/i.test(fileName))
        return 'ofx';
    if (/\.(csv|tsv)$/i.test(fileName))
        return 'csv';
    if (/\.(txt|pdf)$/i.test(fileName))
        return 'text';
    const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 8);
    // A comma inside an amount (1,450.00) is not a delimiter.
    const delimited = lines.filter((line) => (line.match(/,(?!\d{3}(?:\D|$))|[;\t]/g) || []).length >= 2).length;
    return lines.length && delimited >= Math.ceil(lines.length * 0.75) ? 'csv' : 'text';
}
/**
 * @description Read a statement with the reader its kind needs.
 * @param input - The preview request.
 * @returns The transactions, a request to match columns, or a refusal in words.
 */
function readStatement(input) {
    const kind = kindOf(input.text, input.fileName, input.kind);
    if (kind === 'ofx')
        return (0, finance_parse_ofx_1.parseOfx)(input.text);
    if (kind === 'csv')
        return (0, finance_parse_csv_1.parseCsv)(input.text, { columnMap: input.columnMap });
    return (0, finance_parse_text_1.parseStatementText)(input.text);
}
/** The words that say where an account's statement figures came from. */
function statementLabel(account) {
    return `${account.institution || account.name} statement`;
}
/** A new account as an import proposes it. The id is fixed at the preview so every apply call writes the same account. */
function proposedAccount(sub, bookId, spec, fromFile) {
    const now = (0, finance_ledger_store_1.nowStamp)();
    const type = finance_ledger_store_1.ACCOUNT_TYPES.includes(String(spec.type || fromFile?.type)) ? String(spec.type || fromFile?.type) : 'depository';
    const subtype = (0, finance_ledger_store_1.cleanText)(spec.subtype ?? fromFile?.subtype ?? '', 40);
    const institution = (0, finance_ledger_store_1.cleanText)(spec.institution ?? fromFile?.institution ?? '', 80);
    const last4 = (0, finance_ledger_store_1.lastFour)(spec.last4 ?? fromFile?.last4 ?? '');
    const fallback = [institution, subtype || (type === 'credit' ? 'card' : 'account'), last4 && `ending ${last4}`].filter(Boolean).join(' ');
    const name = (0, finance_ledger_store_1.cleanText)(spec.name || fallback || 'Account', 80);
    return {
        accountId: typeof spec.accountId === 'string' && /^acct_[0-9a-f]{32}$/.test(spec.accountId) ? spec.accountId : (0, finance_ledger_store_1.newId)('acct'),
        bookId, name, institution, type, subtype, last4, currency: (0, finance_ledger_store_1.cleanText)(spec.currency ?? fromFile?.currency ?? 'USD', 3).toUpperCase() || 'USD',
        balanceCents: null, balanceAsOf: null, source: 'import', sourceLabel: statementLabel({ institution, name }), posture: '',
        linkId: '', importMap: null, state: 'open', createdAt: now, updatedAt: now,
    };
}
/** The account a file belongs to, among the person's accounts: the one named, else the one the file itself points at. */
async function existingTarget(db, sub, input, parsed) {
    if (input.accountId) {
        const account = await (0, finance_ledger_store_1.readAccount)(db, sub, input.accountId);
        if (!account || account.bookId !== input.bookId)
            throw new finance_ledger_store_1.LedgerRefusal(404, 'unknown_account', 'That account is not in your records.');
        return { account, isNew: false, guessed: false };
    }
    const accounts = (await (0, finance_ledger_store_1.listAccounts)(db, sub, input.bookId)).filter((a) => a.state === 'open' && a.source !== 'sample');
    const fromFile = parsed.account;
    const matches = fromFile?.last4
        ? accounts.filter((a) => a.last4 === fromFile.last4 && a.type === fromFile.type)
        : parsed.headerKey ? accounts.filter((a) => a.importMap?.headerKey === parsed.headerKey) : [];
    return matches.length === 1 ? { account: matches[0], isNew: false, guessed: true } : null;
}
/** The account an import will write to, or null when the person still has to choose one. */
async function targetOf(db, sub, input, parsed) {
    const existing = await existingTarget(db, sub, input, parsed);
    if (existing)
        return existing;
    if (input.newAccount && typeof input.newAccount === 'object')
        return { account: proposedAccount(sub, input.bookId, input.newAccount, parsed.account), isNew: true, guessed: false };
    if (parsed.account?.last4)
        return { account: proposedAccount(sub, input.bookId, {}, parsed.account), isNew: true, guessed: true };
    return null;
}
/** One line of a file as the transaction it would become. */
function candidateOf(sub, account, row, position, importId, rules) {
    const now = (0, finance_ledger_store_1.nowStamp)(), description = (0, finance_ledger_store_1.cleanText)(row.description) || 'Transaction';
    const fromFile = (0, finance_ledger_store_1.cleanText)(row.category || '', 60), fromRule = fromFile ? '' : (0, finance_ledger_store_1.ruleCategory)(rules, description);
    return {
        txnId: (0, finance_ledger_store_1.transactionId)(account.accountId, { bankRef: row.bankRef, date: row.date, amountCents: row.amountCents, direction: row.direction, description, position }),
        bookId: account.bookId, accountId: account.accountId, month: (0, finance_ledger_store_1.monthOf)(row.date), date: row.date, amountCents: row.amountCents,
        direction: row.direction, currency: account.currency, description, merchant: description,
        category: fromFile || fromRule || guessCategory(description, row.direction), categorySource: fromFile ? 'file' : fromRule ? 'rule' : 'guess',
        review: 'new', flags: [], note: '', source: 'import', sourceLabel: statementLabel(account), sourceRef: (0, finance_ledger_store_1.cleanText)(row.bankRef || '', 80),
        posture: '', importId, matchedBillId: '', matchedInvoiceId: '', createdAt: now, updatedAt: now,
    };
}
/** The same-account, same-day, same-amount, same-description key the second duplicate rule compares. */
function tupleKey(t) {
    return [t.accountId, t.date, t.amountCents, t.direction, (0, finance_ledger_store_1.matchText)(t.description)].join('\u001f');
}
/**
 * @description Decide, for every line of a file, whether it is new, already in the records, already
 * added by this import, or in a closed month. A duplicate is a row with the same id (the bank's own
 * id, or account, date, amount, description and position) or, failing that, an unclaimed row of the
 * same account, date, amount and description from another source.
 * @param db - The pool.
 * @param sub - The caller.
 * @param book - The set of records (for its closed months).
 * @param account - The account the file belongs to.
 * @param rows - The file's lines.
 * @param importId - This import.
 * @returns One candidate a line, in the file's order.
 */
async function classify(db, sub, book, account, rows, importId) {
    const rules = await (0, finance_ledger_store_1.listRules)(db, sub, account.bookId);
    const seen = new Map();
    const txns = rows.map((row) => {
        const key = tupleKey({ accountId: account.accountId, ...row });
        const position = seen.get(key) || 0;
        seen.set(key, position + 1);
        return candidateOf(sub, account, row, position, importId, rules);
    });
    const held = await (0, finance_ledger_store_1.listMonths)(db, sub, account.bookId, txns.map((t) => t.month));
    const byId = new Map(held.map((t) => [t.txnId, t]));
    const unclaimed = new Map();
    for (const t of held)
        if (t.accountId === account.accountId && t.importId !== importId)
            unclaimed.set(tupleKey(t), (unclaimed.get(tupleKey(t)) || 0) + 1);
    return txns.map((txn, index) => {
        const same = byId.get(txn.txnId), key = tupleKey(txn);
        if (same)
            return { row: rows[index], txn, status: same.importId === importId ? 'added' : 'duplicate' };
        if ((0, finance_ledger_store_1.monthClosed)(book, txn.month))
            return { row: rows[index], txn, status: 'closed' };
        if ((unclaimed.get(key) || 0) > 0) {
            unclaimed.set(key, unclaimed.get(key) - 1);
            return { row: rows[index], txn, status: 'duplicate' };
        }
        return { row: rows[index], txn, status: 'new' };
    });
}
/** How many candidates have a status. */
function count(candidates, status) {
    return candidates.filter((c) => c.status === status).length;
}
/**
 * @description Read a statement and keep its preview: what would be added, what is already there,
 * the account it belongs to and the closing balance. Nothing but the preview record is written.
 * @param db - The pool.
 * @param sub - The caller.
 * @param input - The file and what the person chose.
 * @param parsed - The statement as read.
 * @returns The preview.
 */
async function previewImport(db, sub, input, parsed) {
    const book = await (0, finance_ledger_store_1.ensureBook)(db, sub, input.bookId);
    const target = await targetOf(db, sub, input, parsed);
    const importId = (0, finance_ledger_store_1.newId)('imp');
    const candidates = target ? await classify(db, sub, book, target.account, parsed.rows, importId) : [];
    const record = {
        importId, bookId: input.bookId, accountId: target && !target.isNew ? target.account.accountId : '',
        newAccount: target?.isNew ? { ...target.account } : null, kind: parsed.kind, fileName: (0, finance_ledger_store_1.cleanText)(input.fileName || '', 120),
        fingerprint: (0, finance_ledger_store_1.fingerprint)(input.text), periodStart: parsed.period?.start || null, periodEnd: parsed.period?.end || null,
        rowsTotal: parsed.rows.length, rowsNew: target ? count(candidates, 'new') : parsed.rows.length, rowsDuplicate: count(candidates, 'duplicate'),
        rowsUnreadable: parsed.unreadableCount, rowsAdded: 0, closingBalanceCents: parsed.closingBalance?.cents ?? null,
        closingBalanceAsOf: parsed.closingBalance?.asOf ?? null, columnMap: parsed.columnMap ? { headerKey: parsed.headerKey, map: parsed.columnMap } : null,
        pending: parsed.rows, state: 'previewed', docId: input.docId || '', createdAt: (0, finance_ledger_store_1.nowStamp)(), appliedAt: null, undoneAt: null,
    };
    await (0, finance_ledger_store_1.insertImport)(db, sub, record);
    return { record, target, candidates, parsed };
}
/**
 * @description The lines an import record still holds, checked on the way out of storage.
 * @param record - The import.
 * @returns Its waiting lines; anything that is not a dated amount is dropped.
 */
function pendingRows(record) {
    return (record.pending || []).filter((row) => {
        const r = row;
        return Boolean(r) && (0, finance_ledger_store_1.isDate)(r.date) && Number.isSafeInteger(r.amountCents) && r.amountCents > 0 && (r.direction === 'in' || r.direction === 'out');
    });
}
/** The account an apply call writes to, created now when the import proposed a new one. */
async function applyTarget(db, sub, record, choice) {
    const named = choice.accountId || record.accountId;
    if (named) {
        const account = await (0, finance_ledger_store_1.readAccount)(db, sub, named);
        if (!account || account.bookId !== record.bookId)
            throw new finance_ledger_store_1.LedgerRefusal(404, 'unknown_account', 'That account is not in your records.');
        return { account, created: false };
    }
    const spec = record.newAccount || (choice.newAccount && typeof choice.newAccount === 'object' ? choice.newAccount : null);
    if (!spec)
        throw new finance_ledger_store_1.LedgerRefusal(400, 'account_required', 'Choose the account this statement belongs to, or name a new one.');
    const proposed = proposedAccount(sub, record.bookId, spec);
    const created = await (0, finance_ledger_store_1.insertAccount)(db, sub, proposed);
    return { account: (await (0, finance_ledger_store_1.readAccount)(db, sub, proposed.accountId)) || proposed, created };
}
/** After the last transaction is in: the statement's closing balance and, for a CSV, its column map are kept on the account. */
async function finishAccount(db, sub, account, record) {
    const before = { balanceCents: account.balanceCents, balanceAsOf: account.balanceAsOf, source: account.source, sourceLabel: account.sourceLabel, posture: account.posture };
    const next = { ...account };
    if (record.columnMap)
        next.importMap = record.columnMap;
    const newer = record.closingBalanceCents !== null && record.closingBalanceAsOf && (!account.balanceAsOf || record.closingBalanceAsOf >= account.balanceAsOf);
    if (newer) {
        // An OFX card or loan statement states what is owed as a negative balance; the account keeps the amount owed.
        next.balanceCents = finance_ledger_store_1.OWED_TYPES.includes(account.type) && record.kind === 'ofx' ? -record.closingBalanceCents : record.closingBalanceCents;
        next.balanceAsOf = record.closingBalanceAsOf;
        next.source = 'import';
        next.sourceLabel = statementLabel(account);
        next.posture = '';
    }
    if (newer || record.columnMap)
        await (0, finance_ledger_store_1.saveAccount)(db, sub, next);
    return newer ? before : null;
}
/**
 * @description Add an import's new transactions, at most APPLY_ROWS a call. Safe to call again:
 * what an earlier call added is recognised and not added twice. When nothing is left the account is
 * brought to the statement's closing balance and the snapshot is rebuilt.
 * @param db - The pool.
 * @param sub - The caller.
 * @param importId - The import.
 * @param choice - The account, when the preview could not tell.
 * @returns The import as it now stands, what this call added and what is left.
 */
async function applyImport(db, sub, importId, choice = {}) {
    const record = await (0, finance_ledger_store_1.readImport)(db, sub, importId);
    if (!record || !exports.FILE_KINDS.includes(record.kind))
        throw new finance_ledger_store_1.LedgerRefusal(404, 'unknown_import', 'That import is not in your records.');
    if (record.state === 'applied')
        return { record, added: 0, remaining: 0 };
    if (record.state === 'undone')
        throw new finance_ledger_store_1.LedgerRefusal(409, 'import_undone', 'This import was undone. Add the file again to bring its transactions back.');
    const book = await (0, finance_ledger_store_1.ensureBook)(db, sub, record.bookId);
    const { account, created } = await applyTarget(db, sub, record, choice);
    const candidates = await classify(db, sub, book, account, pendingRows(record), importId);
    const fresh = candidates.filter((c) => c.status === 'new');
    const { added } = await (0, finance_ledger_store_1.insertTransactions)(db, sub, fresh.slice(0, exports.APPLY_ROWS).map((c) => c.txn));
    const remaining = Math.max(0, fresh.length - exports.APPLY_ROWS);
    const next = {
        ...record, accountId: account.accountId, rowsAdded: count(candidates, 'added') + added, rowsDuplicate: count(candidates, 'duplicate'),
        rowsNew: remaining, state: remaining ? 'applying' : 'applied',
        newAccount: record.newAccount || created ? { ...(record.newAccount || {}), accountId: account.accountId, created: created || Boolean(record.newAccount?.created) } : null,
    };
    if (!remaining) {
        const before = await finishAccount(db, sub, account, record);
        next.newAccount = before ? { ...(next.newAccount || { accountId: account.accountId }), balanceBefore: before } : next.newAccount;
        next.pending = null;
        next.appliedAt = (0, finance_ledger_store_1.nowStamp)();
    }
    await (0, finance_ledger_store_1.saveImport)(db, sub, next);
    if (!remaining)
        await (0, finance_aggregate_1.rebuildSnapshot)(db, sub);
    return { record: next, added, remaining };
}
/** Whether anything but this import still stands on an account. */
async function accountStillUsed(db, sub, record) {
    const others = (await (0, finance_ledger_store_1.listImports)(db, sub, record.bookId)).filter((i) => i.importId !== record.importId && i.state !== 'undone' && i.state !== 'previewed');
    if (others.some((i) => i.accountId === record.accountId))
        return true;
    for (const other of others.filter((i) => !exports.FILE_KINDS.includes(i.kind))) {
        if ((await (0, finance_ledger_store_1.listImportTransactions)(db, sub, other.importId)).some((t) => t.accountId === record.accountId))
            return true;
    }
    return false;
}
/** Take back what an import did to its account: remove the account it created, or restore the balance it replaced. */
async function undoAccount(db, sub, record) {
    const effects = record.newAccount;
    const account = record.accountId ? await (0, finance_ledger_store_1.readAccount)(db, sub, record.accountId) : null;
    if (!account || !effects)
        return;
    if (effects.created && !(await accountStillUsed(db, sub, record))) {
        await (0, finance_ledger_store_1.deleteAccount)(db, sub, account.accountId);
        return;
    }
    const before = effects.balanceBefore;
    if (before && account.balanceAsOf === record.closingBalanceAsOf && account.source === 'import') {
        await (0, finance_ledger_store_1.saveAccount)(db, sub, { ...account, balanceCents: before.balanceCents, balanceAsOf: before.balanceAsOf, source: before.source, sourceLabel: before.sourceLabel, posture: before.posture });
    }
}
/**
 * @description Undo an import: its transactions leave the records, with the account it created or
 * the balance it brought, and the snapshot is rebuilt. An import with a transaction in a closed
 * month is refused until that month is reopened.
 * @param db - The pool.
 * @param sub - The caller.
 * @param importId - The import.
 * @returns The import as it now stands, how many transactions were removed, and which (their ids and months).
 */
async function undoImport(db, sub, importId) {
    const record = await (0, finance_ledger_store_1.readImport)(db, sub, importId);
    if (!record)
        throw new finance_ledger_store_1.LedgerRefusal(404, 'unknown_import', 'That import is not in your records.');
    if (record.kind === 'plaid')
        throw new finance_ledger_store_1.LedgerRefusal(409, 'not_a_file', 'These transactions came from a bank link. Remove the link on Linked banks to stop reading that bank.');
    if (!exports.FILE_KINDS.includes(record.kind))
        throw new finance_ledger_store_1.LedgerRefusal(409, 'not_a_file', 'Only a statement you added can be undone here.');
    if (record.state === 'undone')
        return { record, removed: 0, removedTxns: [] };
    const book = await (0, finance_ledger_store_1.readBook)(db, sub, record.bookId);
    const taken = await (0, finance_ledger_store_1.listImportTransactions)(db, sub, importId);
    for (const t of taken)
        (0, finance_ledger_store_1.assertMonthOpen)(book, t.month);
    const removed = await (0, finance_ledger_store_1.deleteImportTransactions)(db, sub, importId);
    await undoAccount(db, sub, record);
    const next = { ...record, state: 'undone', pending: null, rowsAdded: 0, undoneAt: (0, finance_ledger_store_1.nowStamp)() };
    await (0, finance_ledger_store_1.saveImport)(db, sub, next);
    await (0, finance_aggregate_1.rebuildSnapshot)(db, sub);
    return { record: next, removed, removedTxns: taken.map((t) => ({ txnId: t.txnId, month: t.month })) };
}
/**
 * @description The id of the record that stands for everything a person typed into a set of records.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The import id.
 */
function typedImportId(sub, bookId) {
    return (0, finance_ledger_store_1.hashId)('imp', sub, bookId, 'typed');
}
//# sourceMappingURL=finance-ledger-import.js.map