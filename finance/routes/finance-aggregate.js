"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The saved snapshot stays the one thing the kernel's Finance summary, Jarvis and the Home and Business views read, and it is now rebuilt from Finance's own records after every import, typed entry, sample load and sync. It keeps its present shape (net worth, accounts, holdings, top spending, spend and income by month, 25 recent transactions, the 90-day window, notes) and gains sourceEnvironment 'imported' or 'mixed', a sources list (kind, label and date) and, on each account, the date and source of its balance. What a bank link read stays as that link's part of the snapshot and is carried through later rebuilds, so a snapshot saved before Finance had records loses nothing when a statement is added. An account with no known balance is left out of the totals and named in a note, never shown as zero. A sync also writes the bank's accounts and every transaction in the window into the records, not the 25 the snapshot keeps.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOT_SPENDING = exports.SNAPSHOT_WINDOW_DAYS = void 0;
exports.windowMonths = windowMonths;
exports.buildSnapshot = buildSnapshot;
exports.rebuildSnapshot = rebuildSnapshot;
const finance_ledger_store_1 = require("./finance-ledger-store");
/** Days of transactions the snapshot's spending figures cover. */
exports.SNAPSHOT_WINDOW_DAYS = 90;
/** Categories that move money between a person's own accounts: neither spending nor income. */
exports.NOT_SPENDING = Object.freeze(['transfer']);
const DAY_MS = 86_400_000;
const SAVE_SNAPSHOT = `INSERT INTO oshal_finance_data (user_sub, aggregate, brief, synced_at, brief_at)
       VALUES ($1, $2, NULL, now(), NULL)
     ON CONFLICT (user_sub) DO UPDATE SET aggregate = EXCLUDED.aggregate, brief = NULL, synced_at = now(), brief_at = NULL`;
/** Round cents to the dollars-and-cents number the snapshot's readers expect. */
function dollars(cents) {
    return Math.round(cents) / 100;
}
/** Whole cents out of a dollars number a provider or an older snapshot holds. */
function centsOf(value) {
    const n = Math.round(Number(value || 0) * 100);
    return Number.isSafeInteger(n) ? n : 0;
}
/**
 * @description The months (YYYY-MM) a window of days ending today touches, oldest first.
 * @param now - Today.
 * @param days - The window's length.
 * @returns The months.
 */
function windowMonths(now, days = exports.SNAPSHOT_WINDOW_DAYS) {
    const months = [];
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const first = new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 7);
    for (let i = 0; i < 24; i++) {
        const month = cursor.toISOString().slice(0, 7);
        months.unshift(month);
        if (month <= first)
            break;
        cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    }
    return months;
}
/** Whether a linked part holds anything worth keeping. */
function linkedHasContent(linked) {
    return Boolean(linked && ((linked.accounts || []).length || (linked.holdings || []).length || (linked.recentTransactions || []).length || (linked.notes || []).length));
}
/** One of Finance's own accounts as the snapshot lists it; an amount owed is never negative there. */
function snapshotAccount(a) {
    const owed = finance_ledger_store_1.OWED_TYPES.includes(a.type);
    const cents = owed ? Math.max(a.balanceCents, 0) : a.balanceCents;
    return {
        name: a.name, type: a.type, subtype: a.subtype || null, mask: a.last4 || null, balance: dollars(cents), currency: a.currency,
        institution: a.institution, balanceAsOf: a.balanceAsOf, source: a.source, sourceLabel: a.sourceLabel, posture: a.posture || null,
    };
}
/** Notes about accounts the totals leave out or read differently, in words. */
function accountNotes(accounts) {
    const notes = [];
    for (const a of accounts) {
        if (a.balanceCents === null || !a.balanceAsOf)
            notes.push(`${a.name} has no balance yet, so it is not in these totals.`);
        else if (finance_ledger_store_1.OWED_TYPES.includes(a.type) && a.balanceCents < 0)
            notes.push(`${a.name} has a balance in your favour, so nothing is counted as owed on it.`);
    }
    if (accounts.some((a) => a.source === 'sample'))
        notes.push('Sample data for this demo installation. Link a real account to replace it.');
    return notes;
}
/** Start a rollup from the figures a linked part already added up. */
function rollupOf(linked) {
    const rollup = { categories: new Map(), months: new Map() };
    for (const row of linked?.topSpending || [])
        rollup.categories.set(String(row.category), { cents: centsOf(row.total), count: Number(row.count) || 0 });
    for (const row of linked?.spendByMonth || [])
        rollup.months.set(String(row.month), { spend: centsOf(row.spend), income: centsOf(row.income) });
    return rollup;
}
/** Add Finance's own transactions to a rollup; a transfer between a person's accounts is neither spending nor income. */
function addTransactions(rollup, txns) {
    for (const t of txns) {
        if (exports.NOT_SPENDING.includes(t.category.toLowerCase()))
            continue;
        const month = rollup.months.get(t.month) || { spend: 0, income: 0 };
        if (t.direction === 'out') {
            month.spend += t.amountCents;
            const category = rollup.categories.get(t.category || 'Other') || { cents: 0, count: 0 };
            category.cents += t.amountCents;
            category.count += 1;
            rollup.categories.set(t.category || 'Other', category);
        }
        else
            month.income += t.amountCents;
        rollup.months.set(t.month, month);
    }
}
/** The environment word for the whole snapshot: one source's own word, or 'mixed'. */
function environmentOf(linked, accounts, txns) {
    const kinds = new Set();
    if (linkedHasContent(linked))
        kinds.add(String(linked?.sourceEnvironment || 'sandbox'));
    for (const kind of [...accounts.map((a) => a.source), ...txns.map((t) => t.source)])
        kinds.add(kind === 'sample' ? 'sample' : 'imported');
    if (kinds.size === 1)
        return [...kinds][0];
    return kinds.size ? 'mixed' : String(linked?.sourceEnvironment || 'imported');
}
/** Where the snapshot's figures came from: the bank link's part, then each of Finance's own sources with its newest date. */
function sourcesOf(linked, accounts) {
    const sources = new Map();
    if (linkedHasContent(linked)) {
        const sample = linked?.sourceEnvironment === 'sample';
        const asOf = (0, finance_ledger_store_1.isDate)(String(linked?.generatedAt || '').slice(0, 10)) ? String(linked?.generatedAt).slice(0, 10) : null;
        sources.set('linked', { kind: sample ? 'sample' : 'plaid', label: sample ? 'Sample data' : 'Bank link', asOf });
    }
    for (const a of accounts) {
        const key = `${a.source}|${a.sourceLabel}`, held = sources.get(key);
        if (!held || (a.balanceAsOf && (!held.asOf || a.balanceAsOf > held.asOf)))
            sources.set(key, { kind: a.source, label: a.sourceLabel || a.source, asOf: a.balanceAsOf });
    }
    return [...sources.values()];
}
/** Net worth over every account the snapshot lists, in whole cents. */
function netWorthOf(accounts) {
    let assets = 0, liabilities = 0;
    for (const account of accounts) {
        const cents = centsOf(account.balance);
        if (finance_ledger_store_1.OWED_TYPES.includes(String(account.type)))
            liabilities += Math.abs(cents);
        else
            assets += cents;
    }
    return { assets: dollars(assets), liabilities: dollars(liabilities), net: dollars(assets - liabilities) };
}
/**
 * @description Build the snapshot from a bank link's part and Finance's own records. Pure: the
 * same inputs always give the same snapshot.
 * @param linked - What a bank link read (or an older snapshot held), or null.
 * @param accounts - Finance's own accounts that did not come from a bank link.
 * @param txns - Their transactions inside the window.
 * @param now - Today.
 * @returns The snapshot in the shape its readers know.
 */
function buildSnapshot(linked, accounts, txns, now) {
    const known = accounts.filter((a) => a.balanceCents !== null && a.balanceAsOf);
    const listed = [...(linked?.accounts || []), ...known.map(snapshotAccount)];
    const rollup = rollupOf(linked);
    addTransactions(rollup, txns);
    const recent = [
        ...(linked?.recentTransactions || []),
        ...txns.map((t) => ({ date: t.date, name: t.merchant || t.description, amount: t.direction === 'out' ? dollars(t.amountCents) : -dollars(t.amountCents), category: t.category || 'Other' })),
    ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 25);
    return {
        generatedAt: now.toISOString(), sourceEnvironment: environmentOf(linked, accounts, txns),
        currency: linked?.currency || accounts[0]?.currency || 'USD', netWorth: netWorthOf(listed),
        accounts: listed, holdings: linked?.holdings || [],
        topSpending: [...rollup.categories].map(([category, v]) => ({ category, total: dollars(v.cents), count: v.count })).sort((a, b) => b.total - a.total).slice(0, 10),
        spendByMonth: [...rollup.months].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, spend: dollars(v.spend), income: dollars(v.income) })),
        recentTransactions: recent, transactionWindowDays: exports.SNAPSHOT_WINDOW_DAYS,
        notes: [...(linked?.notes || []), ...accountNotes(accounts)],
        sources: sourcesOf(linked, known), ledger: true, ...(linkedHasContent(linked) ? { linked } : {}),
    };
}
/** What a saved snapshot the records did not write may lend a rebuild: only the demo's sample holdings. */
function carriedPart(previous) {
    if (!previous || typeof previous !== 'object')
        return null;
    if (previous.ledger === true)
        return previous.linked && typeof previous.linked === 'object' ? previous.linked : null;
    if (previous.sourceEnvironment !== 'sample' || !Array.isArray(previous.holdings) || !previous.holdings.length)
        return null;
    return {
        generatedAt: String(previous.generatedAt || ''), sourceEnvironment: 'sample', currency: String(previous.currency || 'USD'),
        netWorth: { assets: 0, liabilities: 0, net: 0 }, accounts: [], holdings: previous.holdings, topSpending: [], spendByMonth: [],
        recentTransactions: [], transactionWindowDays: exports.SNAPSHOT_WINDOW_DAYS, notes: [],
    };
}
/** The 1.6 completeness marks of a records-only snapshot: no balance is assumed, no window is claimed whole. */
function completeness(accounts) {
    return { balancesComplete: accounts.every((a) => a.balanceCents !== null && Boolean(a.balanceAsOf)), transactionsComplete: false };
}
/**
 * @description Rebuild and save the caller's snapshot from their records, by 1.6.5's rules. Call
 * after any import, typed entry or sample load, from a POST only. A person with a linked bank keeps
 * the snapshot the sync wrote. Without one, the snapshot is the records' own; with no records, a
 * snapshot the records wrote is removed (Finance then reads as not set up instead of showing zeros)
 * and any other saved snapshot is left as it is.
 * @param db - The pool.
 * @param sub - The caller.
 * @param options - linked: a part to lend the snapshot (the sample's holdings; omit to carry what may be carried); now: today.
 * @returns The saved snapshot, or null when nothing was written.
 */
async function rebuildSnapshot(db, sub, options = {}) {
    const now = options.now || new Date();
    if ((await db.query('SELECT item_id FROM oshal_finance_items WHERE user_sub = $1', [sub])).rows.length)
        return null;
    const raw = (await db.query('SELECT aggregate FROM oshal_finance_data WHERE user_sub = $1', [sub])).rows[0]?.aggregate;
    const previous = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const linked = options.linked === undefined ? carriedPart(previous) : options.linked;
    const accounts = (await (0, finance_ledger_store_1.listAccounts)(db, sub, finance_ledger_store_1.HOME_BOOK)).filter((a) => a.source !== 'plaid' && a.state === 'open');
    const start = new Date(now.getTime() - exports.SNAPSHOT_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
    const txns = (await (0, finance_ledger_store_1.listMonths)(db, sub, finance_ledger_store_1.HOME_BOOK, windowMonths(now))).filter((t) => t.source !== 'plaid' && t.date >= start);
    if (!accounts.length && !txns.length) {
        if (previous?.ledger === true)
            await db.query('DELETE FROM oshal_finance_data WHERE user_sub = $1', [sub]);
        return null;
    }
    const snapshot = { ...buildSnapshot(linked, accounts, txns, now), ...completeness(accounts) };
    await db.query(SAVE_SNAPSHOT, [sub, JSON.stringify(snapshot)]);
    return snapshot;
}
//# sourceMappingURL=finance-aggregate.js.map