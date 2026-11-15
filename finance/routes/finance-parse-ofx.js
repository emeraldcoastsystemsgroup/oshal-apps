"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Read an OFX or QFX statement (the file a bank offers as "Quicken" or "Money" download) into transactions, with no column step: the file carries its own account (type, institution and number, of which only the last four digits are kept), each transaction's bank id (FITID), the statement period and the closing balance (LEDGERBAL). Both the older tag-per-line form and the XML form are read. A file that is not OFX, holds an investment statement, or holds more than one account is refused in words.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.looksLikeOfx = looksLikeOfx;
exports.parseOfx = parseOfx;
/**
 * Pure functions: tested with plain node against the compiled module (tests/ledger-parsers.test.cjs).
 *
 * @module finance-parse-ofx
 */
const finance_parse_csv_1 = require("./finance-parse-csv");
/** OFX account types as the words Finance's accounts use. */
const ACCOUNT_KINDS = {
    CHECKING: { type: 'depository', subtype: 'checking' },
    SAVINGS: { type: 'depository', subtype: 'savings' },
    MONEYMRKT: { type: 'depository', subtype: 'money market' },
    CD: { type: 'depository', subtype: 'cd' },
    CREDITLINE: { type: 'credit', subtype: 'line of credit' },
};
/**
 * @description Whether text is an OFX or QFX file.
 * @param text - The file's text.
 * @returns True when it has an OFX section.
 */
function looksLikeOfx(text) {
    return /<OFX>/i.test(text) || /^OFXHEADER:/im.test(text);
}
/** The value of the first tag with this name inside a block ('' when absent). Reads both forms. */
function tag(block, name) {
    const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block);
    return m ? decode(m[1].trim()) : '';
}
/** Every block between an opening and a closing tag of this name, with the offset each starts at. */
function blocks(text, name) {
    const found = [];
    const pattern = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'gi');
    for (let m = pattern.exec(text); m; m = pattern.exec(text))
        found.push({ body: m[1], at: m.index });
    return found;
}
/** The entities OFX text may carry. */
function decode(value) {
    return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
/** An OFX date (YYYYMMDD, optionally followed by a time and a zone) as YYYY-MM-DD. */
function ofxDate(value) {
    const m = /^(\d{8})/.exec(value.trim());
    return m ? (0, finance_parse_csv_1.parseStatementDate)(m[1]) : null;
}
/** The line a character offset falls on. */
function lineAt(text, offset) {
    let line = 1;
    for (let i = 0; i < offset && i < text.length; i++)
        if (text.charCodeAt(i) === 10)
            line += 1;
    return line;
}
/** The account a statement block names. Only the last four digits of its number leave this function. */
function accountOf(statement, card, text) {
    const kind = card ? { type: 'credit', subtype: 'credit card' } : ACCOUNT_KINDS[tag(statement, 'ACCTTYPE').toUpperCase()] || { type: 'depository', subtype: '' };
    return {
        last4: tag(statement, 'ACCTID').replace(/\D+/g, '').slice(-4), type: kind.type, subtype: kind.subtype,
        institution: tag(text, 'ORG').slice(0, 80), currency: (tag(statement, 'CURDEF') || 'USD').toUpperCase().slice(0, 3),
    };
}
/** One STMTTRN block as a transaction, or the reason it is not one. */
function transactionOf(body, line) {
    const date = ofxDate(tag(body, 'DTPOSTED'));
    if (!date)
        return { line, reason: `no posted date in "${tag(body, 'DTPOSTED').slice(0, 40)}"` };
    const cents = (0, finance_parse_csv_1.parseAmountCents)(tag(body, 'TRNAMT'));
    if (cents === null)
        return { line, reason: `no amount in "${tag(body, 'TRNAMT').slice(0, 40)}"` };
    if (cents === 0)
        return { line, reason: 'the amount is zero' };
    const name = tag(body, 'NAME') || tag(body, 'PAYEE'), memo = tag(body, 'MEMO');
    const description = (name && memo && memo.toLowerCase() !== name.toLowerCase() ? `${name} ${memo}` : name || memo || tag(body, 'TRNTYPE') || 'Transaction')
        .replace(/\s+/g, ' ').trim().slice(0, 240);
    const row = { line, date, amountCents: Math.abs(cents), direction: cents < 0 ? 'out' : 'in', description };
    const ref = tag(body, 'FITID');
    if (ref)
        row.bankRef = ref.slice(0, 80);
    return row;
}
/** The closing balance a statement states, with its date. */
function ledgerBalance(statement) {
    const block = blocks(statement, 'LEDGERBAL')[0]?.body || (/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>|$)/i.exec(statement) || [])[1] || '';
    const cents = (0, finance_parse_csv_1.parseAmountCents)(tag(block, 'BALAMT')), asOf = ofxDate(tag(block, 'DTASOF'));
    return cents === null || !asOf ? null : { cents, asOf };
}
/** The transactions of one statement block. The older form does not close STMTTRN, so both are read. */
function transactionBlocks(statement) {
    const closed = blocks(statement, 'STMTTRN');
    if (closed.length)
        return closed;
    const found = [];
    const pattern = /<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>|<LEDGERBAL>|$)/gi;
    for (let m = pattern.exec(statement); m; m = pattern.exec(statement))
        found.push({ body: m[1], at: m.index });
    return found;
}
/** The statement blocks of one kind. A file that never closes its statement is read to its end. */
function statementBlocks(text, name) {
    const closed = blocks(text, name);
    if (closed.length)
        return closed;
    const found = [];
    const pattern = new RegExp(`<${name}>([\\s\\S]*?)(?=<${name}>|$)`, 'gi');
    for (let m = pattern.exec(text); m; m = pattern.exec(text))
        found.push({ body: m[1], at: m.index });
    return found;
}
/**
 * @description Read an OFX or QFX statement.
 * @param text - The file's text.
 * @returns The transactions with the file's own account, period and closing balance, or a refusal in words.
 */
function parseOfx(text) {
    const unreadableText = (0, finance_parse_csv_1.refuseUnreadableText)(text);
    if (unreadableText)
        return unreadableText;
    if (!looksLikeOfx(text))
        return (0, finance_parse_csv_1.refuse)('not_ofx', 'This is not an OFX or QFX file: it has no <OFX> section.');
    if (/<INVSTMTRS>/i.test(text))
        return (0, finance_parse_csv_1.refuse)('investment_statement', 'This file is an investment statement. Finance reads bank and card statements; type an investment balance on the account instead.');
    const statements = [...statementBlocks(text, 'STMTRS').map((b) => ({ ...b, card: false })), ...statementBlocks(text, 'CCSTMTRS').map((b) => ({ ...b, card: true }))];
    if (!statements.length)
        return (0, finance_parse_csv_1.refuse)('no_statement', 'This OFX file holds no bank or card statement.');
    if (statements.length > 1)
        return (0, finance_parse_csv_1.refuse)('several_accounts', `This file holds statements for ${statements.length} accounts. Finance reads one account from a file; download each account on its own.`);
    const statement = statements[0];
    const rows = [], unreadable = [];
    for (const block of transactionBlocks(statement.body)) {
        const row = transactionOf(block.body, lineAt(text, statement.at + block.at));
        if ('reason' in row)
            unreadable.push(row);
        else
            rows.push(row);
    }
    const closingBalance = ledgerBalance(statement.body);
    if (!rows.length && !unreadable.length && closingBalance) {
        // A statement with a balance and no activity is still worth reading: it brings the account up to date.
        return { ok: true, kind: 'ofx', rows, unreadable, unreadableCount: 0, period: null, closingBalance, account: accountOf(statement.body, statement.card, text) };
    }
    const refusal = (0, finance_parse_csv_1.refuseEmptyOrTooLong)(rows, unreadable);
    if (refusal)
        return refusal;
    return {
        ok: true, kind: 'ofx', rows, unreadable: unreadable.slice(0, finance_parse_csv_1.MAX_UNREADABLE_LISTED), unreadableCount: unreadable.length,
        period: (0, finance_parse_csv_1.periodOf)(rows), closingBalance, account: accountOf(statement.body, statement.card, text),
    };
}
//# sourceMappingURL=finance-parse-ofx.js.map