"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Finance's own records (migration 002): the store every ledger module reads and writes through. Books, accounts, transactions, imports, rules and documents, each statement owner-scoped by user_sub and shaped for the native kernel: one text key, the selective text equality first in every WHERE, plain INSERTs with a duplicate key treated as a skip, no ON CONFLICT, ORDER BY, GROUP BY or transaction, sorting done here. No statement here creates or alters a table. Every amount leaves as a figure that names its source and its date; a figure without both is refused.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEDGER_SQL = exports.TXN_INSERT_COLUMNS = exports.LedgerRefusal = exports.TEXT_LIMIT = exports.INSERT_GROUP = exports.POSTURES = exports.SOURCE_KINDS = exports.OWED_TYPES = exports.ACCOUNT_TYPES = exports.BOOK_IDS = exports.BUSINESS_BOOK = exports.HOME_BOOK = void 0;
exports.hashId = hashId;
exports.newId = newId;
exports.fingerprint = fingerprint;
exports.isDate = isDate;
exports.isMonth = isMonth;
exports.monthOf = monthOf;
exports.monthWords = monthWords;
exports.cleanText = cleanText;
exports.lastFour = lastFour;
exports.figure = figure;
exports.transactionId = transactionId;
exports.matchText = matchText;
exports.duplicateKey = duplicateKey;
exports.nowStamp = nowStamp;
exports.transactionInsertSql = transactionInsertSql;
exports.bookIdOf = bookIdOf;
exports.readBook = readBook;
exports.ensureBook = ensureBook;
exports.saveBook = saveBook;
exports.assertMonthOpen = assertMonthOpen;
exports.monthClosed = monthClosed;
exports.listAccounts = listAccounts;
exports.readAccount = readAccount;
exports.insertAccount = insertAccount;
exports.saveAccount = saveAccount;
exports.deleteAccount = deleteAccount;
exports.balanceFigure = balanceFigure;
exports.sourceWords = sourceWords;
exports.listTransactions = listTransactions;
exports.listMonths = listMonths;
exports.readTransaction = readTransaction;
exports.listImportTransactions = listImportTransactions;
exports.insertTransactions = insertTransactions;
exports.saveTransaction = saveTransaction;
exports.deleteImportTransactions = deleteImportTransactions;
exports.amountFigure = amountFigure;
exports.insertImport = insertImport;
exports.readImport = readImport;
exports.listImports = listImports;
exports.saveImport = saveImport;
exports.listRules = listRules;
exports.rememberRule = rememberRule;
exports.ruleCategory = ruleCategory;
exports.insertDocument = insertDocument;
exports.readDocument = readDocument;
exports.listDocuments = listDocuments;
exports.saveDocumentProduced = saveDocumentProduced;
/**
 * Self-contained on purpose (node built-ins only, no framework runtime import), so the store runs
 * against a plain PostgreSQL pool in tests/ledger-*.test.cjs and its statements run verbatim on the
 * native interpreter in the kernel's crates/oshald/tests/finance_ledger_store.rs.
 *
 * @module finance-ledger-store
 */
const crypto_1 = require("crypto");
/** The household's set of records. */
exports.HOME_BOOK = 'home';
/** The one business set of records the first version allows. */
exports.BUSINESS_BOOK = 'business';
/** Every set of records a request may name. */
exports.BOOK_IDS = Object.freeze([exports.HOME_BOOK, exports.BUSINESS_BOOK]);
/** Account types, the same words the saved snapshot already uses. */
exports.ACCOUNT_TYPES = Object.freeze(['depository', 'credit', 'loan', 'investment', 'other']);
/** Account types whose balance is an amount owed. */
exports.OWED_TYPES = Object.freeze(['credit', 'loan']);
/** Where a record came from. */
exports.SOURCE_KINDS = Object.freeze(['import', 'plaid', 'typed', 'sample']);
/** The posture pills this store can state; '' means none applies (a statement the person uploaded). */
exports.POSTURES = Object.freeze(['sample', 'test-bank', 'live', 'typed', '']);
/** Rows one multi-row INSERT carries. */
exports.INSERT_GROUP = 50;
/** The longest text kept for a name, a description or a note. */
exports.TEXT_LIMIT = 240;
/** A refusal a person reads: the HTTP status, a stable code and the sentence. */
class LedgerRefusal extends Error {
    status;
    code;
    /**
     * @param status - The HTTP status the route answers.
     * @param code - A stable machine word for the refusal.
     * @param message - The sentence the person reads.
     */
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
exports.LedgerRefusal = LedgerRefusal;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/**
 * @description A deterministic id: the same parts always give the same id, so a second copy of a
 * record is refused by its key instead of stored twice.
 * @param prefix - What the id names ('t', 'acct', ...).
 * @param parts - The values that identify the record.
 * @returns The prefixed 32-hex id.
 */
function hashId(prefix, ...parts) {
    return `${prefix}_${(0, crypto_1.createHash)('sha256').update(parts.map(String).join('\u001f')).digest('hex').slice(0, 32)}`;
}
/**
 * @description A fresh random id for a record with no natural identity.
 * @param prefix - What the id names.
 * @returns The prefixed 32-hex id.
 */
function newId(prefix) {
    return `${prefix}_${(0, crypto_1.randomBytes)(16).toString('hex')}`;
}
/**
 * @description The fingerprint kept of a file Finance read (the file itself is not kept).
 * @param text - The file's text.
 * @returns Its SHA-256 in hex.
 */
function fingerprint(text) {
    return (0, crypto_1.createHash)('sha256').update(text).digest('hex');
}
/**
 * @description Whether a value is a real calendar date written YYYY-MM-DD.
 * @param value - The value to test.
 * @returns True for a valid date.
 */
function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const at = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) === value;
}
/**
 * @description Whether a value is a month written YYYY-MM.
 * @param value - The value to test.
 * @returns True for a valid month.
 */
function isMonth(value) {
    return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
/**
 * @description The month a date falls in.
 * @param date - A YYYY-MM-DD date.
 * @returns YYYY-MM.
 */
function monthOf(date) {
    return date.slice(0, 7);
}
/**
 * @description A month in words for a sentence a person reads.
 * @param month - YYYY-MM.
 * @returns For example "October 2026".
 */
function monthWords(month) {
    return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] || month} ${month.slice(0, 4)}`;
}
/**
 * @description Text made safe to keep: one line, trimmed, bounded.
 * @param value - Anything a file or a person supplied.
 * @param limit - The longest text kept.
 * @returns The cleaned text ('' for nothing).
 */
function cleanText(value, limit = exports.TEXT_LIMIT) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}
/**
 * @description The last four digits of an account number, and nothing else of it.
 * @param value - An account number, a mask or anything containing digits.
 * @returns Up to four trailing digits ('' when there are none).
 */
function lastFour(value) {
    return String(value ?? '').replace(/\D+/g, '').slice(-4);
}
/**
 * @description An amount with its source and date. Refuses to build one without both, so no route
 * can return a bare number.
 * @param cents - The amount in whole cents.
 * @param currency - Its currency code.
 * @param source - Where it came from, in words ("Harbor Bank statement").
 * @param sourceKind - Where it came from, as a kind ('import', 'plaid', 'typed', 'sample', 'mixed').
 * @param asOf - The date the figure is true for (YYYY-MM-DD).
 * @param posture - The posture pill, or '' for none.
 * @returns The figure.
 */
function figure(cents, currency, source, sourceKind, asOf, posture = '') {
    if (!Number.isSafeInteger(cents))
        throw new Error('A figure needs a whole number of cents.');
    if (!source || !sourceKind)
        throw new Error('A figure needs to say where it came from.');
    if (!isDate(asOf))
        throw new Error('A figure needs the date it is true for.');
    return { cents, currency: currency || 'USD', source, sourceKind, asOf, posture: posture || null };
}
/**
 * @description The identity of a transaction: the bank's own id when the file has one, else its
 * account, date, amount, direction, description and its position among identical lines.
 * @param accountId - The account the transaction belongs to.
 * @param row - The transaction's identifying values.
 * @returns The transaction id.
 */
function transactionId(accountId, row) {
    if (row.bankRef)
        return hashId('t', accountId, 'ref', row.bankRef);
    return hashId('t', accountId, row.date, row.amountCents, row.direction, matchText(row.description), row.position || 0);
}
/**
 * @description Text folded for comparison: lower case, single spaces.
 * @param value - A description.
 * @returns The folded text.
 */
function matchText(value) {
    return cleanText(value).toLowerCase();
}
/**
 * @description Whether an error is the store refusing a second row with the same key.
 * @param err - What a statement threw.
 * @returns True for a duplicate key.
 */
function duplicateKey(err) {
    const e = err;
    return e?.code === '23505' || /23505|unique (constraint|key)|duplicate key|primary key constraint/i.test(String(e?.message || ''));
}
/** A whole number out of a BIGINT a driver may hand back as text. */
function int(value) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(n))
        throw new Error('A stored amount is not a whole number.');
    return n;
}
/** A nullable whole number. */
function intOrNull(value) {
    return value === null || value === undefined ? null : int(value);
}
/** A stored JSON cell: an object or array, parsed when a driver hands it back as text. */
function json(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        }
        catch {
            return null;
        }
    }
    return value;
}
/** A JSON value for a ::jsonb parameter. */
function jsonParam(value) {
    return value === null || value === undefined ? null : JSON.stringify(value);
}
/** The current instant, written the way every stamp in these tables is. */
function nowStamp() {
    return new Date().toISOString();
}
/* ─── statements ────────────────────────────────────────────────────────────── */
const BOOK_COLUMNS = 'book_key, user_sub, book_id, kind, name, currency, closed_through, created_at, updated_at';
const ACCOUNT_COLUMNS = 'account_id, user_sub, book_id, name, institution, type, subtype, last4, currency, balance_cents, balance_as_of, source, source_label, posture, link_id, import_map, state, created_at, updated_at';
const TXN_COLUMNS = 'txn_id, user_sub, book_id, account_id, month, txn_date, amount_cents, direction, currency, description, merchant, category, category_source, review, flags, note, source, source_label, source_ref, posture, import_id, matched_bill_id, matched_invoice_id, created_at, updated_at';
const IMPORT_FACTS = 'import_id, user_sub, book_id, account_id, new_account, kind, file_name, fingerprint, period_start, period_end, rows_total, rows_new, rows_duplicate, rows_unreadable, rows_added, closing_balance_cents, closing_balance_as_of, column_map, state, doc_id, created_at, applied_at, undone_at';
const DOC_FACTS = 'doc_id, user_sub, book_id, kind, title, fingerprint, origin, produced, created_at';
/** The columns of one transaction row, in insert order. */
exports.TXN_INSERT_COLUMNS = Object.freeze(TXN_COLUMNS.split(', '));
/**
 * Every statement the store issues, by name. The selective text equality comes first in each WHERE
 * (the native kernel starts a read, an update or a delete from the rows its first such term selects),
 * and user_sub follows so a shared PostgreSQL table stays owner-scoped.
 */
exports.LEDGER_SQL = Object.freeze({
    bookRead: `SELECT ${BOOK_COLUMNS} FROM finance_books WHERE book_key = $1 AND user_sub = $2`,
    bookInsert: 'INSERT INTO finance_books (book_key, user_sub, book_id, kind, name, currency, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    bookUpdate: 'UPDATE finance_books SET name = $3, closed_through = $4, updated_at = $5 WHERE book_key = $1 AND user_sub = $2',
    accountsByBook: `SELECT ${ACCOUNT_COLUMNS} FROM finance_accounts WHERE book_id = $1 AND user_sub = $2`,
    accountRead: `SELECT ${ACCOUNT_COLUMNS} FROM finance_accounts WHERE account_id = $1 AND user_sub = $2`,
    accountInsert: `INSERT INTO finance_accounts (${ACCOUNT_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19)`,
    accountUpdate: 'UPDATE finance_accounts SET name = $3, institution = $4, type = $5, subtype = $6, last4 = $7, currency = $8, balance_cents = $9, balance_as_of = $10, source = $11, source_label = $12, posture = $13, link_id = $14, import_map = $15::jsonb, state = $16, updated_at = $17 WHERE account_id = $1 AND user_sub = $2',
    accountDelete: 'DELETE FROM finance_accounts WHERE account_id = $1 AND user_sub = $2',
    txnByMonth: `SELECT ${TXN_COLUMNS} FROM finance_transactions WHERE month = $1 AND user_sub = $2 AND book_id = $3`,
    txnRead: `SELECT ${TXN_COLUMNS} FROM finance_transactions WHERE txn_id = $1 AND user_sub = $2`,
    txnByImport: `SELECT ${TXN_COLUMNS} FROM finance_transactions WHERE import_id = $1 AND user_sub = $2`,
    txnUpdate: 'UPDATE finance_transactions SET category = $3, category_source = $4, review = $5, flags = $6, note = $7, matched_bill_id = $8, matched_invoice_id = $9, updated_at = $10 WHERE txn_id = $1 AND user_sub = $2',
    txnDelete: 'DELETE FROM finance_transactions WHERE txn_id = $1 AND user_sub = $2',
    txnDeleteByImport: 'DELETE FROM finance_transactions WHERE import_id = $1 AND user_sub = $2',
    importRead: `SELECT ${IMPORT_FACTS}, pending FROM finance_imports WHERE import_id = $1 AND user_sub = $2`,
    importsByBook: `SELECT ${IMPORT_FACTS} FROM finance_imports WHERE book_id = $1 AND user_sub = $2`,
    importInsert: `INSERT INTO finance_imports (${IMPORT_FACTS}, pending) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20, $21, $22, $23, $24::jsonb)`,
    importUpdate: 'UPDATE finance_imports SET account_id = $3, new_account = $4::jsonb, rows_new = $5, rows_duplicate = $6, rows_added = $7, pending = $8::jsonb, state = $9, applied_at = $10, undone_at = $11, period_start = $12, period_end = $13, rows_total = $14 WHERE import_id = $1 AND user_sub = $2',
    rulesByBook: 'SELECT rule_id, user_sub, book_id, match_text, category, created_at FROM finance_rules WHERE book_id = $1 AND user_sub = $2',
    ruleInsert: 'INSERT INTO finance_rules (rule_id, user_sub, book_id, match_text, category, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    ruleUpdate: 'UPDATE finance_rules SET category = $3 WHERE rule_id = $1 AND user_sub = $2',
    docRead: `SELECT ${DOC_FACTS}, body_text FROM finance_documents WHERE doc_id = $1 AND user_sub = $2`,
    docsByBook: `SELECT ${DOC_FACTS} FROM finance_documents WHERE book_id = $1 AND user_sub = $2`,
    docInsert: `INSERT INTO finance_documents (${DOC_FACTS}, body_text) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
    docUpdate: 'UPDATE finance_documents SET produced = $3::jsonb WHERE doc_id = $1 AND user_sub = $2',
});
/**
 * @description The multi-row INSERT for a run of transactions.
 * @param count - How many rows the statement carries.
 * @returns The statement text, with 25 parameters a row.
 */
function transactionInsertSql(count) {
    const width = exports.TXN_INSERT_COLUMNS.length;
    const tuples = [];
    for (let row = 0; row < count; row++) {
        const base = row * width;
        tuples.push(`(${exports.TXN_INSERT_COLUMNS.map((_, column) => `$${base + column + 1}`).join(', ')})`);
    }
    return `INSERT INTO finance_transactions (${TXN_COLUMNS}) VALUES ${tuples.join(', ')}`;
}
/* ─── rows ──────────────────────────────────────────────────────────────────── */
/** A stored book row as the record the modules use. */
function bookOf(row) {
    return { bookId: row.book_id, kind: row.kind, name: row.name || '', currency: row.currency || 'USD', closedThrough: row.closed_through || null };
}
/** A stored account row as the record the modules use. */
function accountOf(row) {
    return {
        accountId: row.account_id, bookId: row.book_id, name: row.name, institution: row.institution || '', type: row.type,
        subtype: row.subtype || '', last4: row.last4 || '', currency: row.currency || 'USD',
        balanceCents: intOrNull(row.balance_cents), balanceAsOf: row.balance_as_of || null, source: row.source,
        sourceLabel: row.source_label || '', posture: row.posture || '', linkId: row.link_id || '',
        importMap: json(row.import_map), state: row.state || 'open',
        createdAt: row.created_at, updatedAt: row.updated_at,
    };
}
/** A stored transaction row as the record the modules use. */
function transactionOf(row) {
    return {
        txnId: row.txn_id, bookId: row.book_id, accountId: row.account_id, month: row.month, date: row.txn_date,
        amountCents: int(row.amount_cents), direction: row.direction === 'in' ? 'in' : 'out', currency: row.currency || 'USD',
        description: row.description || '', merchant: row.merchant || '', category: row.category || '',
        categorySource: row.category_source || '', review: row.review || 'new',
        flags: String(row.flags || '').split(',').filter(Boolean), note: row.note || '', source: row.source,
        sourceLabel: row.source_label || '', sourceRef: row.source_ref || '', posture: row.posture || '',
        importId: row.import_id || '', matchedBillId: row.matched_bill_id || '', matchedInvoiceId: row.matched_invoice_id || '',
        createdAt: row.created_at, updatedAt: row.updated_at,
    };
}
/** A stored import row as the record the modules use. */
function importOf(row) {
    return {
        importId: row.import_id, bookId: row.book_id, accountId: row.account_id || '',
        newAccount: json(row.new_account), kind: row.kind, fileName: row.file_name || '',
        fingerprint: row.fingerprint || '', periodStart: row.period_start || null, periodEnd: row.period_end || null,
        rowsTotal: int(row.rows_total || 0), rowsNew: int(row.rows_new || 0), rowsDuplicate: int(row.rows_duplicate || 0),
        rowsUnreadable: int(row.rows_unreadable || 0), rowsAdded: int(row.rows_added || 0),
        closingBalanceCents: intOrNull(row.closing_balance_cents), closingBalanceAsOf: row.closing_balance_as_of || null,
        columnMap: json(row.column_map), pending: json(row.pending),
        state: row.state, docId: row.doc_id || '', createdAt: row.created_at, appliedAt: row.applied_at || null,
        undoneAt: row.undone_at || null,
    };
}
/** A stored document row as the record the modules use. */
function documentOf(row) {
    return {
        docId: row.doc_id, bookId: row.book_id, kind: row.kind, title: row.title || '', fingerprint: row.fingerprint || '',
        bodyText: row.body_text || '', origin: row.origin || '', produced: json(row.produced),
        createdAt: row.created_at,
    };
}
/** The values of one transaction, in TXN_INSERT_COLUMNS order. */
function transactionValues(sub, t) {
    return [t.txnId, sub, t.bookId, t.accountId, t.month, t.date, t.amountCents, t.direction, t.currency, t.description,
        t.merchant, t.category, t.categorySource, t.review, t.flags.join(','), t.note, t.source, t.sourceLabel, t.sourceRef,
        t.posture, t.importId, t.matchedBillId, t.matchedInvoiceId, t.createdAt, t.updatedAt];
}
/* ─── books ─────────────────────────────────────────────────────────────────── */
/**
 * @description The set of records a request names, or a refusal in words.
 * @param value - The request's book ('home' when absent).
 * @returns The book id.
 */
function bookIdOf(value) {
    const id = value === undefined || value === null || value === '' ? exports.HOME_BOOK : String(value);
    if (!exports.BOOK_IDS.includes(id))
        throw new LedgerRefusal(400, 'unknown_book', 'Finance keeps two sets of records: home and business.');
    return id;
}
/**
 * @description Read one of the caller's sets of records.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - 'home' or 'business'.
 * @returns The book, or null when it has never been written to.
 */
async function readBook(db, sub, bookId) {
    const row = (await db.query(exports.LEDGER_SQL.bookRead, [`${sub}|${bookId}`, sub])).rows[0];
    return row ? bookOf(row) : null;
}
/**
 * @description The caller's set of records, created on its first write. Call from a POST only: a
 * GET cannot write on the native kernel.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - 'home' or 'business'.
 * @returns The book.
 */
async function ensureBook(db, sub, bookId) {
    const existing = await readBook(db, sub, bookId);
    if (existing)
        return existing;
    const now = nowStamp();
    try {
        await db.query(exports.LEDGER_SQL.bookInsert, [`${sub}|${bookId}`, sub, bookId, bookId === exports.HOME_BOOK ? 'household' : 'business', '', 'USD', now, now]);
    }
    catch (err) {
        if (!duplicateKey(err))
            throw err;
    }
    return (await readBook(db, sub, bookId)) || { bookId, kind: bookId === exports.HOME_BOOK ? 'household' : 'business', name: '', currency: 'USD', closedThrough: null };
}
/**
 * @description Keep a book's name and the last month closed.
 * @param db - The pool.
 * @param sub - The caller.
 * @param book - The book with its new values.
 * @returns Nothing.
 */
async function saveBook(db, sub, book) {
    await db.query(exports.LEDGER_SQL.bookUpdate, [`${sub}|${book.bookId}`, sub, cleanText(book.name), book.closedThrough, nowStamp()]);
}
/**
 * @description Refuse a change to a closed month, in the words the screen shows.
 * @param book - The set of records (null when nothing was ever written, so nothing is closed).
 * @param month - The month the change falls in (YYYY-MM).
 * @returns Nothing; throws the refusal.
 */
function assertMonthOpen(book, month) {
    if (book?.closedThrough && month <= book.closedThrough) {
        throw new LedgerRefusal(409, 'month_closed', `${monthWords(month)} is closed. Reopen it to change this.`);
    }
}
/**
 * @description Whether a month is closed in a set of records.
 * @param book - The set of records.
 * @param month - YYYY-MM.
 * @returns True when the month is at or before the last closed month.
 */
function monthClosed(book, month) {
    return Boolean(book?.closedThrough && month <= book.closedThrough);
}
/* ─── accounts ──────────────────────────────────────────────────────────────── */
/**
 * @description Every account in one of the caller's sets of records, by name.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The accounts.
 */
async function listAccounts(db, sub, bookId) {
    const rows = (await db.query(exports.LEDGER_SQL.accountsByBook, [bookId, sub])).rows;
    return rows.map(accountOf).sort((a, b) => a.name.localeCompare(b.name) || a.accountId.localeCompare(b.accountId));
}
/**
 * @description One of the caller's accounts.
 * @param db - The pool.
 * @param sub - The caller.
 * @param accountId - The account.
 * @returns The account, or null when the caller has no such account.
 */
async function readAccount(db, sub, accountId) {
    const row = (await db.query(exports.LEDGER_SQL.accountRead, [accountId, sub])).rows[0];
    return row ? accountOf(row) : null;
}
/**
 * @description Add an account. A second account with the same id is left as it is.
 * @param db - The pool.
 * @param sub - The caller.
 * @param a - The account.
 * @returns True when it was added, false when it was already there.
 */
async function insertAccount(db, sub, a) {
    try {
        await db.query(exports.LEDGER_SQL.accountInsert, [a.accountId, sub, a.bookId, a.name, a.institution, a.type, a.subtype, a.last4,
            a.currency, a.balanceCents, a.balanceAsOf, a.source, a.sourceLabel, a.posture, a.linkId, jsonParam(a.importMap),
            a.state, a.createdAt, a.updatedAt]);
        return true;
    }
    catch (err) {
        if (!duplicateKey(err))
            throw err;
        return false;
    }
}
/**
 * @description Keep an account's present values (name, balance with its date and source, and the rest).
 * @param db - The pool.
 * @param sub - The caller.
 * @param a - The account with its new values.
 * @returns Nothing.
 */
async function saveAccount(db, sub, a) {
    await db.query(exports.LEDGER_SQL.accountUpdate, [a.accountId, sub, a.name, a.institution, a.type, a.subtype, a.last4, a.currency,
        a.balanceCents, a.balanceAsOf, a.source, a.sourceLabel, a.posture, a.linkId, jsonParam(a.importMap), a.state, nowStamp()]);
}
/**
 * @description Remove one of the caller's accounts (an undo of the import that created it).
 * @param db - The pool.
 * @param sub - The caller.
 * @param accountId - The account.
 * @returns Nothing.
 */
async function deleteAccount(db, sub, accountId) {
    await db.query(exports.LEDGER_SQL.accountDelete, [accountId, sub]);
}
/**
 * @description An account's balance as a figure, or null when no balance is known yet.
 * @param a - The account.
 * @returns The figure, or null (unknown is not zero).
 */
function balanceFigure(a) {
    if (a.balanceCents === null || !a.balanceAsOf)
        return null;
    return figure(a.balanceCents, a.currency, a.sourceLabel || sourceWords(a.source), a.source, a.balanceAsOf, a.posture);
}
/**
 * @description The plain words for a kind of source, used when a record carries no label of its own.
 * @param kind - 'import', 'plaid', 'typed' or 'sample'.
 * @returns The words.
 */
function sourceWords(kind) {
    if (kind === 'sample')
        return 'Sample data';
    if (kind === 'typed')
        return 'Typed by you';
    if (kind === 'plaid')
        return 'Bank link';
    return 'Statement';
}
/* ─── transactions ──────────────────────────────────────────────────────────── */
/** Newest first, then by description and id so the order never changes between reads. */
function newestFirst(a, b) {
    return b.date.localeCompare(a.date) || a.description.localeCompare(b.description) || a.txnId.localeCompare(b.txnId);
}
/**
 * @description One month of transactions in a set of records, newest first.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param month - YYYY-MM.
 * @returns The month's transactions.
 */
async function listTransactions(db, sub, bookId, month) {
    const rows = (await db.query(exports.LEDGER_SQL.txnByMonth, [month, sub, bookId])).rows;
    return rows.map(transactionOf).sort(newestFirst);
}
/**
 * @description Several months of transactions, read one month at a time.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param months - The months to read (YYYY-MM).
 * @returns Their transactions, newest first.
 */
async function listMonths(db, sub, bookId, months) {
    const all = [];
    for (const month of [...new Set(months)])
        all.push(...await listTransactions(db, sub, bookId, month));
    return all.sort(newestFirst);
}
/**
 * @description One of the caller's transactions.
 * @param db - The pool.
 * @param sub - The caller.
 * @param txnId - The transaction.
 * @returns The transaction, or null when the caller has none with that id.
 */
async function readTransaction(db, sub, txnId) {
    const row = (await db.query(exports.LEDGER_SQL.txnRead, [txnId, sub])).rows[0];
    return row ? transactionOf(row) : null;
}
/**
 * @description The transactions one import added.
 * @param db - The pool.
 * @param sub - The caller.
 * @param importId - The import.
 * @returns Its transactions, newest first.
 */
async function listImportTransactions(db, sub, importId) {
    const rows = (await db.query(exports.LEDGER_SQL.txnByImport, [importId, sub])).rows;
    return rows.map(transactionOf).sort(newestFirst);
}
/** Add one transaction; a second row with the same id is a skip. */
async function insertOne(db, sub, t) {
    try {
        await db.query(transactionInsertSql(1), transactionValues(sub, t));
        return true;
    }
    catch (err) {
        if (!duplicateKey(err))
            throw err;
        return false;
    }
}
/**
 * @description Add transactions in runs of INSERT_GROUP. A run the store refuses for a duplicate key
 * is added row by row, each duplicate skipped, so nothing is ever stored twice.
 * @param db - The pool.
 * @param sub - The caller.
 * @param rows - The transactions to add.
 * @returns How many were added and how many were already there.
 */
async function insertTransactions(db, sub, rows) {
    let added = 0, skipped = 0;
    for (let start = 0; start < rows.length; start += exports.INSERT_GROUP) {
        const group = rows.slice(start, start + exports.INSERT_GROUP);
        try {
            await db.query(transactionInsertSql(group.length), group.flatMap((t) => transactionValues(sub, t)));
            added += group.length;
        }
        catch (err) {
            if (!duplicateKey(err))
                throw err;
            for (const t of group) {
                if (await insertOne(db, sub, t))
                    added += 1;
                else
                    skipped += 1;
            }
        }
    }
    return { added, skipped };
}
/**
 * @description Keep what a person or a rule changed on a transaction: category, reviewed, flags,
 * note and what it was matched to. Its date, amount and source never change.
 * @param db - The pool.
 * @param sub - The caller.
 * @param t - The transaction with its new values.
 * @returns Nothing.
 */
async function saveTransaction(db, sub, t) {
    await db.query(exports.LEDGER_SQL.txnUpdate, [t.txnId, sub, t.category, t.categorySource, t.review, t.flags.join(','), t.note,
        t.matchedBillId, t.matchedInvoiceId, nowStamp()]);
}
/**
 * @description Remove every transaction one import added (its undo).
 * @param db - The pool.
 * @param sub - The caller.
 * @param importId - The import.
 * @returns How many rows were removed.
 */
async function deleteImportTransactions(db, sub, importId) {
    if (!importId)
        return 0;
    const result = await db.query(exports.LEDGER_SQL.txnDeleteByImport, [importId, sub]);
    return Number(result.rowCount || 0);
}
/**
 * @description A transaction's amount as a figure: its source in words, its own date, its posture.
 * @param t - The transaction.
 * @returns The figure.
 */
function amountFigure(t) {
    return figure(t.amountCents, t.currency, t.sourceLabel || sourceWords(t.source), t.source, t.date, t.posture);
}
/* ─── imports ───────────────────────────────────────────────────────────────── */
/**
 * @description Keep a new import record (the preview).
 * @param db - The pool.
 * @param sub - The caller.
 * @param i - The import.
 * @returns Nothing.
 */
async function insertImport(db, sub, i) {
    await db.query(exports.LEDGER_SQL.importInsert, [i.importId, sub, i.bookId, i.accountId, jsonParam(i.newAccount), i.kind, i.fileName,
        i.fingerprint, i.periodStart, i.periodEnd, i.rowsTotal, i.rowsNew, i.rowsDuplicate, i.rowsUnreadable, i.rowsAdded,
        i.closingBalanceCents, i.closingBalanceAsOf, jsonParam(i.columnMap), i.state, i.docId, i.createdAt, i.appliedAt,
        i.undoneAt, jsonParam(i.pending)]);
}
/**
 * @description One of the caller's imports, with the rows still waiting to be added.
 * @param db - The pool.
 * @param sub - The caller.
 * @param importId - The import.
 * @returns The import, or null when the caller has none with that id.
 */
async function readImport(db, sub, importId) {
    const row = (await db.query(exports.LEDGER_SQL.importRead, [importId, sub])).rows[0];
    return row ? importOf(row) : null;
}
/**
 * @description Every import in a set of records, newest first, without their waiting rows.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The imports.
 */
async function listImports(db, sub, bookId) {
    const rows = (await db.query(exports.LEDGER_SQL.importsByBook, [bookId, sub])).rows;
    return rows.map(importOf).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.importId.localeCompare(b.importId));
}
/**
 * @description Keep an import's progress: its account, counts, period, waiting rows and state.
 * @param db - The pool.
 * @param sub - The caller.
 * @param i - The import with its new values.
 * @returns Nothing.
 */
async function saveImport(db, sub, i) {
    await db.query(exports.LEDGER_SQL.importUpdate, [i.importId, sub, i.accountId, jsonParam(i.newAccount), i.rowsNew, i.rowsDuplicate,
        i.rowsAdded, jsonParam(i.pending), i.state, i.appliedAt, i.undoneAt, i.periodStart, i.periodEnd, i.rowsTotal]);
}
/* ─── rules ─────────────────────────────────────────────────────────────────── */
/**
 * @description The caller's "description contains X means category Y" rules, longest match first.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The rules.
 */
async function listRules(db, sub, bookId) {
    const rows = (await db.query(exports.LEDGER_SQL.rulesByBook, [bookId, sub])).rows;
    return rows.map((row) => ({ ruleId: row.rule_id, bookId: row.book_id, matchText: row.match_text, category: row.category, createdAt: row.created_at }))
        .sort((a, b) => b.matchText.length - a.matchText.length || a.matchText.localeCompare(b.matchText));
}
/**
 * @description Remember that a description containing some text means a category. Saying it again
 * for the same text replaces the category.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @param text - The text a description contains.
 * @param category - The category it means.
 * @returns The rule.
 */
async function rememberRule(db, sub, bookId, text, category) {
    const rule = { ruleId: hashId('rule', sub, bookId, matchText(text)), bookId, matchText: matchText(text), category: cleanText(category, 60), createdAt: nowStamp() };
    try {
        await db.query(exports.LEDGER_SQL.ruleInsert, [rule.ruleId, sub, bookId, rule.matchText, rule.category, rule.createdAt]);
    }
    catch (err) {
        if (!duplicateKey(err))
            throw err;
        await db.query(exports.LEDGER_SQL.ruleUpdate, [rule.ruleId, sub, rule.category]);
    }
    return rule;
}
/**
 * @description The category the caller's rules give a description, if any rule matches.
 * @param rules - The caller's rules, longest match first.
 * @param description - The transaction's description.
 * @returns The category, or '' when no rule matches.
 */
function ruleCategory(rules, description) {
    const text = matchText(description);
    return rules.find((rule) => rule.matchText && text.includes(rule.matchText))?.category || '';
}
/* ─── documents ─────────────────────────────────────────────────────────────── */
/**
 * @description Keep the record of a document Finance read.
 * @param db - The pool.
 * @param sub - The caller.
 * @param d - The document.
 * @returns Nothing.
 */
async function insertDocument(db, sub, d) {
    await db.query(exports.LEDGER_SQL.docInsert, [d.docId, sub, d.bookId, d.kind, d.title, d.fingerprint, d.origin, jsonParam(d.produced), d.createdAt, d.bodyText]);
}
/**
 * @description One of the caller's documents, with its kept text.
 * @param db - The pool.
 * @param sub - The caller.
 * @param docId - The document.
 * @returns The document, or null when the caller has none with that id.
 */
async function readDocument(db, sub, docId) {
    const row = (await db.query(exports.LEDGER_SQL.docRead, [docId, sub])).rows[0];
    return row ? documentOf(row) : null;
}
/**
 * @description The documents in a set of records, newest first, without their text.
 * @param db - The pool.
 * @param sub - The caller.
 * @param bookId - The set of records.
 * @returns The documents.
 */
async function listDocuments(db, sub, bookId) {
    const rows = (await db.query(exports.LEDGER_SQL.docsByBook, [bookId, sub])).rows;
    return rows.map(documentOf).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.docId.localeCompare(b.docId));
}
/**
 * @description Record what a document produced (an import, a proposed bill).
 * @param db - The pool.
 * @param sub - The caller.
 * @param docId - The document.
 * @param produced - What it produced.
 * @returns Nothing.
 */
async function saveDocumentProduced(db, sub, docId, produced) {
    await db.query(exports.LEDGER_SQL.docUpdate, [docId, sub, jsonParam(produced)]);
}
//# sourceMappingURL=finance-ledger-store.js.map