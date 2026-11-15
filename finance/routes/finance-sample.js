"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | A demo installation's sample household as records, not only a snapshot: seven named accounts with balances dated today and three months of dated transactions (pay every two weeks, rent, utilities, a subscription, a loan payment, groceries, fuel, meals out, savings interest, card purchases and a card payment), the newest five still to review and one of them larger than usual at its merchant, so a trial opens on a day with things to do. Every record says it is sample data. Loading it again replaces the earlier sample and touches nothing else; a real sync removes it. The employer on the paycheck is a made-up name (it named the owner's company).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAMPLE_LABEL = exports.SAMPLE_DAYS = void 0;
exports.sampleImportId = sampleImportId;
exports.sampleRecords = sampleRecords;
exports.sampleLinkedPart = sampleLinkedPart;
exports.clearSample = clearSample;
exports.loadSample = loadSample;
const finance_ledger_store_1 = require("./finance-ledger-store");
const DAY_MS = 86_400_000;
/** How far back the sample's transactions go. */
exports.SAMPLE_DAYS = 89;
/** What every sample record says of itself. */
exports.SAMPLE_LABEL = 'Sample data';
/** The sample accounts: key, name, institution, type, subtype, last four, balance in cents (owed for the card and the loan). */
const ACCOUNTS = [
    ['checking', 'Everyday Checking', 'Harbor Bank', 'depository', 'checking', '4821', 482044],
    ['savings', 'Rainy-day Savings', 'Harbor Bank', 'depository', 'savings', '7730', 1840000],
    ['market', 'Money Market', 'Coastal Credit Union', 'depository', 'money market', '2214', 1250000],
    ['brokerage', 'Brokerage', 'Blue Sky Brokerage', 'investment', 'brokerage', '9043', 7718000],
    ['retirement', 'Retirement 401(k)', 'Blue Sky Brokerage', 'investment', '401k', '5512', 4670000],
    ['card', 'Travel Rewards Card', 'Harbor Bank', 'credit', 'credit card', '0082', 124032],
    ['loan', 'Auto Loan', 'Coastal Credit Union', 'loan', 'auto', '6619', 980000],
];
/** What happens every month on a fixed day of the month. */
const MONTHLY = [
    [1, ['checking', 'out', 145000, 'Maple Court Apartments', 'Rent']],
    [1, ['savings', 'in', 412, 'Interest paid', 'Income']],
    [8, ['checking', 'out', 1399, 'Streaming Plus', 'Streaming']],
    [12, ['checking', 'out', 11240, 'City Utilities', 'Utilities']],
    [16, ['checking', 'out', 30000, 'Transfer to Rainy-day Savings', 'Transfer']],
    [16, ['savings', 'in', 30000, 'Transfer from Everyday Checking', 'Transfer']],
    [20, ['checking', 'out', 28500, 'Auto loan payment', 'Loan payment']],
    [24, ['checking', 'out', 40000, 'Travel Rewards Card payment', 'Transfer']],
    [24, ['card', 'in', 40000, 'Payment thank you', 'Transfer']],
];
/** What repeats every so many days, counted back from today: every, offset, then the amounts it cycles through. */
const REPEATING = [
    [14, 5, ['checking', 'in', 320000, 'Paycheck Lakeside Design Co', 'Income'], [320000]],
    [7, 1, ['checking', 'out', 0, 'Harbor Market', 'Groceries'], [8431, 9612, 7240, 10388, 6895]],
    [10, 6, ['checking', 'out', 0, 'Corner Fuel', 'Gas'], [3855, 4210, 3690]],
    [9, 3, ['card', 'out', 0, 'Corner Trattoria', 'Dining out'], [5280, 3640, 4415]],
    [35, 45, ['checking', 'out', 4000, 'Harbor Dental', 'Health'], [4000]],
    [30, 20, ['card', 'out', 0, 'Trailhead Outfitters', 'Shopping'], [8620, 4310]],
];
/** The sample holdings the snapshot lists beside the brokerage account. */
const HOLDINGS = [
    { name: 'Total Stock Market Index', ticker: 'VTI', type: 'etf', quantity: 180, value: 48960.00, costBasis: 41200, institution: 'Blue Sky Brokerage', accountName: 'Brokerage' },
    { name: 'Apple Inc', ticker: 'AAPL', type: 'equity', quantity: 60, value: 15780.00, costBasis: 11900, institution: 'Blue Sky Brokerage', accountName: 'Brokerage' },
    { name: 'US Bond Index', ticker: 'BND', type: 'etf', quantity: 120, value: 8920.00, costBasis: 9100, institution: 'Blue Sky Brokerage', accountName: 'Brokerage' },
    { name: 'Money market sweep', ticker: null, type: 'cash', quantity: 1, value: 3520.00, costBasis: 3520, institution: 'Blue Sky Brokerage', accountName: 'Brokerage' },
];
/** The id of a person's sample account. */
function accountId(sub, key) {
    return (0, finance_ledger_store_1.hashId)('acct', sub, 'sample', key);
}
/** The id of the one import record that stands for a person's sample data. */
function sampleImportId(sub) {
    return (0, finance_ledger_store_1.hashId)('imp', sub, 'sample');
}
/** The dated lines of the sample: what repeats, what falls on a day of the month, and one charge larger than usual. */
function datedLines(now) {
    const day = (back) => new Date(now.getTime() - back * DAY_MS).toISOString().slice(0, 10);
    const lines = [];
    for (const [every, offset, line, amounts] of REPEATING) {
        for (let back = offset, n = 0; back <= exports.SAMPLE_DAYS; back += every, n++) {
            lines.push({ date: day(back), line: [line[0], line[1], amounts[n % amounts.length], line[3], line[4]] });
        }
    }
    for (let back = 0; back <= exports.SAMPLE_DAYS; back++) {
        const date = day(back), dayOfMonth = Number(date.slice(8, 10));
        for (const [on, line] of MONTHLY)
            if (on === dayOfMonth)
                lines.push({ date, line });
    }
    lines.push({ date: day(2), line: ['checking', 'out', 41200, 'Harbor Dental', 'Health'] });
    return lines.sort((a, b) => b.date.localeCompare(a.date) || a.line[3].localeCompare(b.line[3]));
}
/**
 * @description The sample household's records for one person, dated relative to today. Pure and
 * deterministic: the same person and day always give the same records and the same ids.
 * @param sub - The person the records are for.
 * @param now - Today.
 * @returns Accounts, three months of transactions (the newest five still to review) and holdings.
 */
function sampleRecords(sub, now = new Date()) {
    const stamp = now.toISOString(), today = stamp.slice(0, 10), importId = sampleImportId(sub);
    const accounts = ACCOUNTS.map(([key, name, institution, type, subtype, last4, cents]) => ({
        accountId: accountId(sub, key), bookId: finance_ledger_store_1.HOME_BOOK, name, institution, type, subtype, last4, currency: 'USD', balanceCents: cents,
        balanceAsOf: today, source: 'sample', sourceLabel: exports.SAMPLE_LABEL, posture: 'sample', linkId: '', importMap: null, state: 'open',
        createdAt: stamp, updatedAt: stamp,
    }));
    const seen = new Map();
    const transactions = datedLines(now).map(({ date, line }, index) => {
        const [key, direction, amountCents, description, category] = line;
        const identity = `${key}|${date}|${amountCents}|${direction}|${description}`, position = seen.get(identity) || 0;
        seen.set(identity, position + 1);
        return {
            txnId: (0, finance_ledger_store_1.transactionId)(accountId(sub, key), { date, amountCents, direction, description, position }), bookId: finance_ledger_store_1.HOME_BOOK,
            accountId: accountId(sub, key), month: (0, finance_ledger_store_1.monthOf)(date), date, amountCents, direction, currency: 'USD', description,
            merchant: description, category, categorySource: 'sample', review: index < 5 ? 'new' : 'reviewed', flags: [], note: '',
            source: 'sample', sourceLabel: exports.SAMPLE_LABEL, sourceRef: '', posture: 'sample', importId, matchedBillId: '',
            matchedInvoiceId: '', createdAt: stamp, updatedAt: stamp,
        };
    });
    return { importId, accounts, transactions, holdings: HOLDINGS.map((holding) => ({ ...holding })) };
}
/**
 * @description The part of the snapshot the sample's holdings travel in (Finance's records hold no
 * holdings of their own).
 * @param holdings - The sample holdings.
 * @param now - Today.
 * @returns A linked part with only holdings, marked as sample data.
 */
function sampleLinkedPart(holdings, now = new Date()) {
    return {
        generatedAt: now.toISOString(), sourceEnvironment: 'sample', currency: 'USD', netWorth: { assets: 0, liabilities: 0, net: 0 },
        accounts: [], holdings, topSpending: [], spendByMonth: [], recentTransactions: [], transactionWindowDays: exports.SAMPLE_DAYS + 1, notes: [],
    };
}
/**
 * @description Remove a person's sample records: its transactions, its accounts and its import
 * record's claim. Records the person added themselves are not touched.
 * @param db - The pool.
 * @param sub - The person.
 * @returns How many sample transactions were removed.
 */
async function clearSample(db, sub) {
    const importId = sampleImportId(sub);
    const held = await (0, finance_ledger_store_1.readImport)(db, sub, importId);
    if (!held || held.state !== 'applied')
        return 0;
    const removed = await (0, finance_ledger_store_1.deleteImportTransactions)(db, sub, importId);
    for (const [key] of ACCOUNTS)
        await (0, finance_ledger_store_1.deleteAccount)(db, sub, accountId(sub, key));
    await (0, finance_ledger_store_1.saveImport)(db, sub, { ...held, state: 'undone', rowsAdded: 0, undoneAt: (0, finance_ledger_store_1.nowStamp)() });
    return removed;
}
/**
 * @description Write the sample household into a person's records, replacing an earlier sample.
 * @param db - The pool.
 * @param sub - The person.
 * @param now - Today.
 * @returns The records written.
 */
async function loadSample(db, sub, now = new Date()) {
    await (0, finance_ledger_store_1.ensureBook)(db, sub, finance_ledger_store_1.HOME_BOOK);
    await clearSample(db, sub);
    const sample = sampleRecords(sub, now);
    for (const account of sample.accounts)
        await (0, finance_ledger_store_1.insertAccount)(db, sub, account);
    const { added } = await (0, finance_ledger_store_1.insertTransactions)(db, sub, sample.transactions);
    const dates = sample.transactions.map((t) => t.date).sort();
    const record = {
        importId: sample.importId, bookId: finance_ledger_store_1.HOME_BOOK, accountId: '', newAccount: null, kind: 'sample', fileName: exports.SAMPLE_LABEL, fingerprint: '',
        periodStart: dates[0] || null, periodEnd: dates[dates.length - 1] || null, rowsTotal: sample.transactions.length,
        rowsNew: sample.transactions.length, rowsDuplicate: 0, rowsUnreadable: 0, rowsAdded: added, closingBalanceCents: null,
        closingBalanceAsOf: null, columnMap: null, pending: null, state: 'applied', docId: '', createdAt: (0, finance_ledger_store_1.nowStamp)(), appliedAt: (0, finance_ledger_store_1.nowStamp)(), undoneAt: null,
    };
    if (await (0, finance_ledger_store_1.readImport)(db, sub, sample.importId))
        await (0, finance_ledger_store_1.saveImport)(db, sub, record);
    else
        await (0, finance_ledger_store_1.insertImport)(db, sub, record);
    return sample;
}
//# sourceMappingURL=finance-sample.js.map