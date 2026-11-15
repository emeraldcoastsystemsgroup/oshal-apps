"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The money day as pure functions (Roger, 2026-11-12: Finance as the day of someone looking after their money). From a person's own accounts and transactions this file works out what Home's steps need, in the order of the day: what came in and went out and is still to review, what is unusual, what is planned to run low, the payday set-aside, an account gone stale, the month to close, the year pack, this week, net worth and how long the cash would last. The four unusual marks are rules stated as facts about the person's own records, never a verdict: larger than usual (over twice the median of the last six charges there, and over $50), charged twice (same place and amount within a day), a new repeating charge (three charges 26 to 33 days apart within 10 percent) and a first charge over $200 somewhere new. A repeating charge becomes a bill only when the person says so. Every amount is a figure with its source and its date: a sum of flows carries the date its records reach, a total of balances carries its oldest date, a forward figure says Estimate or Planned, and what is not known is null, never zero. Nothing here reads a store, writes, calls a model or gives advice.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUNWAY_MONTHS = exports.YEAR_PACK_WINDOW = exports.DAY_MONTHS = exports.AHEAD_DAYS = exports.PAYDAY_DAYS = exports.STALE_DAYS = exports.INCOME_GAPS = exports.REPEAT_TOLERANCE = exports.REPEAT_GAP_DAYS = exports.FIRST_LARGE_HISTORY_DAYS = exports.FIRST_LARGE_CENTS = exports.LARGER_HISTORY = exports.LARGER_FLOOR_CENTS = exports.LARGER_FACTOR = exports.UNUSUAL_FLAGS = exports.DAY_MS = void 0;
exports.dayNumber = dayNumber;
exports.addDays = addDays;
exports.daysBetween = daysBetween;
exports.addMonths = addMonths;
exports.daysInMonth = daysInMonth;
exports.dayInMonth = dayInMonth;
exports.recentMonths = recentMonths;
exports.todayOf = todayOf;
exports.dayWords = dayWords;
exports.together = together;
exports.forward = forward;
exports.flowFigure = flowFigure;
exports.isFlow = isFlow;
exports.merchantKey = merchantKey;
exports.findRepeating = findRepeating;
exports.mainIncome = mainIncome;
exports.detectUnusual = detectUnusual;
exports.withMarks = withMarks;
exports.newTransactions = newTransactions;
exports.unusualItems = unusualItems;
exports.netWorth = netWorth;
exports.staleAccounts = staleAccounts;
exports.payday = payday;
exports.plannedLow = plannedLow;
exports.monthToClose = monthToClose;
exports.yearPack = yearPack;
exports.weekView = weekView;
exports.runway = runway;
exports.buildDay = buildDay;
/**
 * No framework runtime import and no store: every function takes records and a day and returns
 * values, so the page and the assistant get the same answer from the same records.
 *
 * @module finance-day-model
 */
const finance_ledger_store_1 = require("./finance-ledger-store");
/** One day in milliseconds. */
exports.DAY_MS = 86_400_000;
/** The marks a transaction can carry, in the order Home names them. */
exports.UNUSUAL_FLAGS = Object.freeze(['larger-than-usual', 'charged-twice', 'new-repeating', 'first-large']);
/** Larger than usual: over this many times the median of the earlier charges at that merchant. */
exports.LARGER_FACTOR = 2;
/** Larger than usual: and over this amount ($50). */
exports.LARGER_FLOOR_CENTS = 5000;
/** Larger than usual: the median is taken over at most this many earlier charges, and at least two. */
exports.LARGER_HISTORY = 6;
/** A first charge somewhere new is named when it is over this amount ($200). */
exports.FIRST_LARGE_CENTS = 20000;
/** A merchant is only called new when the records reach back at least this many days before the charge. */
exports.FIRST_LARGE_HISTORY_DAYS = 30;
/** A repeating charge: three charges this many days apart. */
exports.REPEAT_GAP_DAYS = Object.freeze([26, 33]);
/** A repeating charge or income: amounts within this share of their median. */
exports.REPEAT_TOLERANCE = 0.10;
/** Income repeats weekly, every two weeks (or twice a month) or monthly: the gaps each allows, in days. */
exports.INCOME_GAPS = Object.freeze([
    Object.freeze(['weekly', 6, 8]), Object.freeze(['every-two-weeks', 12, 17]), Object.freeze(['monthly', 26, 33]),
]);
/** An account whose balance is older than this many days is worth updating. */
exports.STALE_DAYS = 35;
/** The payday step stays for this many days after the income arrived. */
exports.PAYDAY_DAYS = 7;
/** With no income date known, the plan ahead looks this many days out. */
exports.AHEAD_DAYS = 14;
/** The months of transactions the day reads: this month and the two before. */
exports.DAY_MONTHS = 3;
/** The year pack is offered from 15 January to 15 April. */
exports.YEAR_PACK_WINDOW = Object.freeze(['01-15', '04-15']);
/** The closed months the runway averages over. */
exports.RUNWAY_MONTHS = 3;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/* ─── days and months ───────────────────────────────────────────────────────── */
/**
 * @description A date as a count of days, so two dates can be subtracted.
 * @param date - YYYY-MM-DD.
 * @returns Days since 1970-01-01.
 */
function dayNumber(date) {
    return Math.round(Date.parse(`${date}T00:00:00Z`) / exports.DAY_MS);
}
/**
 * @description The date some days after (or before) another.
 * @param date - YYYY-MM-DD.
 * @param days - Days to add; negative goes back.
 * @returns YYYY-MM-DD.
 */
function addDays(date, days) {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * exports.DAY_MS).toISOString().slice(0, 10);
}
/**
 * @description How many days lie from one date to another.
 * @param from - YYYY-MM-DD.
 * @param to - YYYY-MM-DD.
 * @returns to minus from, in days (negative when to is earlier).
 */
function daysBetween(from, to) {
    return dayNumber(to) - dayNumber(from);
}
/**
 * @description The month some months after (or before) another.
 * @param month - YYYY-MM.
 * @param count - Months to add; negative goes back.
 * @returns YYYY-MM.
 */
function addMonths(month, count) {
    const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + count;
    return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}
/**
 * @description How many days a month has.
 * @param month - YYYY-MM.
 * @returns 28 to 31.
 */
function daysInMonth(month) {
    return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
}
/**
 * @description A day of a month as a date; a day the month does not have becomes its last day.
 * @param month - YYYY-MM.
 * @param day - 1 to 31.
 * @returns YYYY-MM-DD.
 */
function dayInMonth(month, day) {
    return `${month}-${String(Math.min(Math.max(1, Math.floor(day)), daysInMonth(month))).padStart(2, '0')}`;
}
/**
 * @description The months before and including a day's month, newest first.
 * @param today - YYYY-MM-DD.
 * @param count - How many months, counting this one.
 * @returns YYYY-MM values.
 */
function recentMonths(today, count) {
    return Array.from({ length: count }, (_, back) => addMonths((0, finance_ledger_store_1.monthOf)(today), -back));
}
/**
 * @description The person's day. A page sends its own local day; it is used when it is a real date
 * within a day of the server's, so a person in another time zone still gets their own "today".
 * @param value - The request's day, if any.
 * @param now - The server's clock.
 * @returns YYYY-MM-DD.
 */
function todayOf(value, now = new Date()) {
    const server = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    return (0, finance_ledger_store_1.isDate)(value) && Math.abs(daysBetween(server, value)) <= 1 ? value : server;
}
/**
 * @description A date as a person says it: "today", "tomorrow", "yesterday", "on Monday" for the
 * week around today, else "on 16 November" (with the year when it is not this one).
 * @param date - YYYY-MM-DD.
 * @param today - YYYY-MM-DD.
 * @returns The words.
 */
function dayWords(date, today) {
    const gap = daysBetween(today, date);
    if (gap === 0)
        return 'today';
    if (gap === 1)
        return 'tomorrow';
    if (gap === -1)
        return 'yesterday';
    const at = new Date(`${date}T00:00:00Z`);
    if (Math.abs(gap) < 7)
        return `on ${WEEKDAYS[at.getUTCDay()]}`;
    const year = date.slice(0, 4) === today.slice(0, 4) ? '' : ` ${date.slice(0, 4)}`;
    return `on ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}${year}`;
}
/* ─── figures ───────────────────────────────────────────────────────────────── */
/** The oldest and the newest of some dates. */
function dateRange(dates) {
    const sorted = [...dates].sort();
    return { oldest: sorted[0], newest: sorted[sorted.length - 1] };
}
/**
 * @description One figure for several: their shared source when they share one, else the given
 * words; the posture they share, else none; and the date given.
 * @param cents - The amount the figure states.
 * @param parts - The figures it is made from.
 * @param words - What to call them together ("Your records").
 * @param asOf - The date the result is true for.
 * @returns The figure, or null when there are no parts.
 */
function together(cents, parts, words, asOf) {
    if (!parts.length || !(0, finance_ledger_store_1.isDate)(asOf))
        return null;
    const same = parts.every((part) => part.source === parts[0].source && part.sourceKind === parts[0].sourceKind);
    const posture = parts.every((part) => part.posture === parts[0].posture) ? parts[0].posture : null;
    return (0, finance_ledger_store_1.figure)(cents, parts[0].currency, same ? parts[0].source : words, same ? parts[0].sourceKind : 'mixed', asOf, posture || '');
}
/**
 * @description A figure that looks forward. Sample data stays marked as sample.
 * @param f - The figure.
 * @param posture - 'estimate' or 'planned'.
 * @returns The same figure with its posture set.
 */
function forward(f, posture) {
    return { ...f, posture: f.posture === 'sample' ? 'sample' : posture };
}
/**
 * @description The sum of some transactions as a figure. A sum of flows is true up to its newest record.
 * @param txns - The transactions (all one direction).
 * @returns The figure, or null when there are none: no records is not zero.
 */
function flowFigure(txns) {
    if (!txns.length)
        return null;
    return together(txns.reduce((sum, t) => sum + t.amountCents, 0), txns.map(finance_ledger_store_1.amountFigure), 'Your records', dateRange(txns.map((t) => t.date)).newest);
}
/**
 * @description Whether a transaction is income or spending, and not money moved between the person's own accounts.
 * @param t - The transaction.
 * @returns True for income or spending.
 */
function isFlow(t) {
    return !/^transfers?\b/.test((0, finance_ledger_store_1.matchText)(t.category));
}
/**
 * @description The name a merchant is compared by: its words without reference numbers.
 * @param t - The transaction, or anything with a merchant and a description.
 * @returns The folded name ('' when it has none).
 */
function merchantKey(t) {
    const text = (0, finance_ledger_store_1.matchText)(t.merchant || t.description);
    const words = text.split(' ').filter((word) => word && !/\d/.test(word)).join(' ').replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return words || text;
}
/** Oldest first, then by id so the order never changes between reads. */
function oldestFirst(a, b) {
    return a.date.localeCompare(b.date) || a.txnId.localeCompare(b.txnId);
}
/** Transactions of one direction that count as income or spending, grouped by merchant, each group oldest first. */
function byMerchant(txns, direction) {
    const groups = new Map();
    for (const t of [...txns].sort(oldestFirst)) {
        const key = merchantKey(t);
        if (t.direction !== direction || !isFlow(t) || !key)
            continue;
        groups.set(key, [...(groups.get(key) || []), t]);
    }
    return groups;
}
/** The middle value of some amounts. */
function median(values) {
    const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
/* ─── what repeats ──────────────────────────────────────────────────────────── */
/** The cadence two gaps fit: about a month for a charge; weekly, two-weekly or monthly for income. */
function cadenceOf(gaps, direction) {
    const bands = direction === 'out' ? [['monthly', exports.REPEAT_GAP_DAYS[0], exports.REPEAT_GAP_DAYS[1]]] : exports.INCOME_GAPS;
    return bands.find(([, low, high]) => gaps.every((gap) => gap >= low && gap <= high))?.[0] || '';
}
/** A merchant's last three transactions as a repeating series, when their gaps and amounts fit the rule. */
function seriesOf(key, group, direction) {
    if (group.length < 3)
        return null;
    const last = group.slice(-3), gaps = [daysBetween(last[0].date, last[1].date), daysBetween(last[1].date, last[2].date)];
    const cadence = cadenceOf(gaps, direction), middle = median(last.map((t) => t.amountCents));
    if (!cadence || last.some((t) => Math.abs(t.amountCents - middle) > middle * exports.REPEAT_TOLERANCE))
        return null;
    const latest = last[2], gapDays = Math.round((gaps[0] + gaps[1]) / 2), dueDay = Number(latest.date.slice(8, 10));
    const nextDate = cadence === 'monthly' ? dayInMonth(addMonths((0, finance_ledger_store_1.monthOf)(latest.date), 1), dueDay) : addDays(latest.date, gapDays);
    return {
        key, payee: latest.merchant || latest.description, direction, cadence, gapDays, amountCents: latest.amountCents, dueDay, nextDate,
        accountId: latest.accountId, category: latest.category, isNew: group.length === 3, charges: last, last: latest,
    };
}
/**
 * @description The charges (or the income) that repeat in a person's own transactions: a merchant's
 * last three, evenly spaced and within 10 percent of each other.
 * @param txns - The transactions to look through (several months).
 * @param direction - 'out' for charges, 'in' for income.
 * @returns The series found, by payee.
 */
function findRepeating(txns, direction) {
    const found = [];
    for (const [key, group] of byMerchant(txns, direction)) {
        const series = seriesOf(key, group, direction);
        if (series)
            found.push(series);
    }
    return found.sort((a, b) => a.payee.localeCompare(b.payee) || a.key.localeCompare(b.key));
}
/**
 * @description The income a household counts on: the repeating income with the largest amount.
 * @param txns - The transactions to look through.
 * @returns The series, or null when no income repeats yet.
 */
function mainIncome(txns) {
    return findRepeating(txns, 'in').sort((a, b) => b.amountCents - a.amountCents || a.key.localeCompare(b.key))[0] || null;
}
/* ─── what is unusual ───────────────────────────────────────────────────────── */
/** The marks one charge earns against the earlier charges at the same merchant. */
function marksFor(t, earlier, recordsStart, newlyRepeating) {
    const marks = [], usual = earlier.slice(-exports.LARGER_HISTORY).map((e) => e.amountCents);
    if (usual.length >= 2 && t.amountCents > exports.LARGER_FACTOR * median(usual) && t.amountCents > exports.LARGER_FLOOR_CENTS)
        marks.push('larger-than-usual');
    if (earlier.some((e) => e.amountCents === t.amountCents && daysBetween(e.date, t.date) <= 1))
        marks.push('charged-twice');
    if (newlyRepeating.has(t.txnId))
        marks.push('new-repeating');
    if (!earlier.length && t.amountCents > exports.FIRST_LARGE_CENTS && daysBetween(recordsStart, t.date) >= exports.FIRST_LARGE_HISTORY_DAYS)
        marks.push('first-large');
    return marks;
}
/**
 * @description What is unusual among the charges still to review, each a fact about the person's own
 * records. A reviewed transaction is never judged again.
 * @param txns - The transactions to look through (several months).
 * @param repeating - The repeating charges found in the same transactions.
 * @returns For every charge still to review, the marks that apply (often none).
 */
function detectUnusual(txns, repeating = findRepeating(txns, 'out')) {
    const marks = new Map();
    if (!txns.length)
        return marks;
    const recordsStart = dateRange(txns.map((t) => t.date)).oldest;
    const newlyRepeating = new Set(repeating.filter((series) => series.isNew).map((series) => series.last.txnId));
    for (const group of byMerchant(txns, 'out').values()) {
        group.forEach((t, index) => {
            if (t.review === 'new')
                marks.set(t.txnId, marksFor(t, group.slice(0, index), recordsStart, newlyRepeating));
        });
    }
    return marks;
}
/**
 * @description A transaction's flags with its unusual marks replaced by what the rules say now.
 * @param flags - The flags it carries.
 * @param marks - The unusual marks that apply now.
 * @returns The flags to keep, and whether they changed.
 */
function withMarks(flags, marks) {
    const next = [...flags.filter((flag) => !exports.UNUSUAL_FLAGS.includes(flag)), ...exports.UNUSUAL_FLAGS.filter((flag) => marks.includes(flag))];
    return { flags: next, changed: next.join(',') !== flags.join(',') };
}
/** What a larger-than-usual charge was compared with: the median of the earlier charges there, as a figure. */
function usualFigure(t, all) {
    const earlier = (byMerchant(all, 'out').get(merchantKey(t)) || []).filter((e) => oldestFirst(e, t) < 0).slice(-exports.LARGER_HISTORY);
    if (earlier.length < 2)
        return null;
    return together(median(earlier.map((e) => e.amountCents)), earlier.map(finance_ledger_store_1.amountFigure), 'Your records', earlier[earlier.length - 1].date);
}
/* ─── the day's parts ───────────────────────────────────────────────────────── */
/**
 * @description What came in and went out and is still to review.
 * @param txns - The day's transactions.
 * @returns The count, the two sums and the oldest date among them; null when nothing is new.
 */
function newTransactions(txns) {
    const fresh = txns.filter((t) => t.review === 'new');
    if (!fresh.length)
        return null;
    const dates = dateRange(fresh.map((t) => t.date));
    return {
        count: fresh.length, since: dates.oldest, to: dates.newest,
        in: flowFigure(fresh.filter((t) => t.direction === 'in')), out: flowFigure(fresh.filter((t) => t.direction === 'out')),
    };
}
/**
 * @description The charges still to review that carry an unusual mark, newest first.
 * @param txns - The day's transactions.
 * @returns One item for each, with the mark, the amount and what it was compared with.
 */
function unusualItems(txns) {
    return txns.filter((t) => t.review === 'new' && t.flags.some((flag) => exports.UNUSUAL_FLAGS.includes(flag)))
        .sort((a, b) => oldestFirst(b, a))
        .map((t) => {
        const kinds = exports.UNUSUAL_FLAGS.filter((flag) => t.flags.includes(flag));
        return {
            txnId: t.txnId, kind: kinds[0], kinds, merchant: t.merchant || t.description, date: t.date, accountId: t.accountId,
            amount: (0, finance_ledger_store_1.amountFigure)(t), usual: kinds[0] === 'larger-than-usual' ? usualFigure(t, txns) : null,
        };
    });
}
/** Whether an account is money owed (a card or a loan). */
function owes(account) {
    return finance_ledger_store_1.OWED_TYPES.includes(account.type);
}
/** The accounts that count: open, and not left behind by a bank link that was removed. */
function counted(accounts, linked) {
    return accounts.filter((a) => a.state === 'open' && !(a.source === 'plaid' && !linked.has(a.linkId)));
}
/** One total over several balances: the oldest date, one source by name or several as a count. */
function totalOf(cents, parts) {
    if (!parts.length)
        return null;
    const labels = new Set(parts.map((part) => part.source));
    return together(cents, parts, `${labels.size} sources`, dateRange(parts.map((part) => part.asOf)).oldest);
}
/**
 * @description Net worth from the accounts: what the person has less what they owe, in the shape the
 * Accounts screen reads. An account with no known balance is left out and named, never counted as
 * zero; the total carries its oldest date; accounts in more than one currency give no total.
 * @param accounts - The person's accounts.
 * @param linked - The ids of the person's bank links.
 * @returns assets, liabilities and net (each a figure or null), the parts, and the accounts left out.
 */
function netWorth(accounts, linked) {
    const open = counted(accounts, linked);
    const parts = open.flatMap((a) => { const f = (0, finance_ledger_store_1.balanceFigure)(a); return f ? [{ accountId: a.accountId, name: a.name, institution: a.institution, type: a.type, owed: owes(a), figure: f }] : []; });
    const without = open.filter((a) => !(0, finance_ledger_store_1.balanceFigure)(a)).map((a) => a.name);
    if (new Set(parts.map((part) => part.figure.currency)).size > 1) {
        return { assets: null, liabilities: null, net: null, parts, without, note: 'These accounts are in more than one currency, so no total is shown.' };
    }
    const have = parts.filter((part) => !part.owed), owe = parts.filter((part) => part.owed);
    const assets = have.reduce((sum, part) => sum + part.figure.cents, 0), liabilities = owe.reduce((sum, part) => sum + Math.max(part.figure.cents, 0), 0);
    return {
        assets: totalOf(assets, have.map((part) => part.figure)), liabilities: totalOf(liabilities, owe.map((part) => part.figure)),
        net: totalOf(assets - liabilities, parts.map((part) => part.figure)), parts, without,
        note: without.length ? `Without ${without.join(', ')}: no balance is known yet.` : null,
    };
}
/**
 * @description The accounts whose balance has gone stale, stalest first.
 * @param accounts - The person's accounts.
 * @param today - YYYY-MM-DD.
 * @returns Each with its balance date and how many days old it is.
 */
function staleAccounts(accounts, today) {
    return accounts.filter((a) => a.state === 'open' && (0, finance_ledger_store_1.isDate)(a.balanceAsOf))
        .map((a) => ({ accountId: a.accountId, name: a.name, balanceAsOf: a.balanceAsOf, days: daysBetween(a.balanceAsOf, today) }))
        .filter((a) => a.days > exports.STALE_DAYS)
        .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
}
/** The income that arrived in the last week: the repeating income when one is known, else income large enough to fund the set-aside. */
function arrivedIncome(input, income, needed) {
    const recent = input.transactions.filter((t) => t.direction === 'in' && isFlow(t) && daysBetween(t.date, input.today) >= 0 && daysBetween(t.date, input.today) <= exports.PAYDAY_DAYS);
    const fits = (t) => (income ? merchantKey(t) === income.key : (0, finance_ledger_store_1.matchText)(t.category) === 'income' && t.amountCents >= needed);
    return recent.filter(fits).sort((a, b) => oldestFirst(b, a))[0] || null;
}
/**
 * @description The payday step: income arrived in the last week and a goal still has this month's
 * set-aside to make. It goes once the person has set aside against that income.
 * @param input - The day's records.
 * @param income - The repeating income, when one was found.
 * @returns The set-aside to offer, or null.
 */
function payday(input, income) {
    const goal = input.goals.find((g) => g.state === 'open' && g.leftThisMonth !== null && g.leftThisMonth.cents > 0 && (!g.leftToTarget || g.leftToTarget.cents > 0));
    if (!goal || !goal.leftThisMonth)
        return null;
    const cents = goal.leftToTarget ? Math.min(goal.leftThisMonth.cents, goal.leftToTarget.cents) : goal.leftThisMonth.cents;
    const arrived = arrivedIncome(input, income, cents);
    if (!arrived || input.goals.some((g) => g.answeredIncome.includes(arrived.txnId)))
        return null;
    return { date: arrived.date, txnId: arrived.txnId, goalId: goal.goalId, goal: goal.name, amount: { ...goal.leftThisMonth, cents }, income: (0, finance_ledger_store_1.amountFigure)(arrived) };
}
/** The lowest point an account's balance is planned to reach as its unpaid bills come due. */
function lowPoint(account, balance, bills, today, until) {
    const mine = bills.filter((b) => b.amount !== null && b.due < until && (b.accountId === account.accountId || !b.accountId))
        .sort((a, b) => a.due.localeCompare(b.due));
    let running = balance.cents, low = { cents: balance.cents, date: today, counted: [] };
    mine.forEach((bill, index) => {
        running -= bill.amount.cents;
        if (running < low.cents)
            low = { cents: running, date: bill.due < today ? today : bill.due, counted: mine.slice(0, index + 1) };
    });
    return low;
}
/**
 * @description The planned balance that dips under zero, or under the lowest balance the person
 * wants to keep, before their next income: the account's balance as it stands, less the unpaid bills
 * that come due first. An estimate; it changes no balance.
 * @param input - The day's records.
 * @param income - The repeating income, when one was found.
 * @returns The lowest such point, or null when no account is planned to dip.
 */
function plannedLow(input, income) {
    const unpaid = [...input.bills.overdue, ...input.bills.week, ...input.bills.later].filter((b) => b.state === 'due');
    const incomeDate = income && income.nextDate >= input.today ? income.nextDate : null;
    const until = incomeDate || addDays(input.today, exports.AHEAD_DAYS), floorCents = input.floor ? input.floor.cents : 0;
    let worst = null, worstCents = Infinity;
    for (const account of counted(input.accounts, input.linked).filter((a) => a.type === 'depository')) {
        const balance = (0, finance_ledger_store_1.balanceFigure)(account);
        if (!balance)
            continue;
        const low = lowPoint(account, balance, unpaid, input.today, until);
        if (!low.counted.length || low.cents >= floorCents || low.cents >= worstCents)
            continue;
        worstCents = low.cents;
        worst = {
            account: account.name, accountId: account.accountId, date: low.date, incomeDate,
            low: forward((0, finance_ledger_store_1.figure)(low.cents, balance.currency, `${balance.source} balance, less your bills`, 'mixed', balance.asOf, balance.posture || ''), 'estimate'),
            floor: input.floor, balance, bills: low.counted.map((b) => ({ billId: b.billId, payee: b.payee, due: b.due, amount: b.amount })),
        };
    }
    return worst;
}
/**
 * @description The month to close: last month, when it has records and is not closed.
 * @param input - The day's records.
 * @returns The month, or null.
 */
function monthToClose(input) {
    const last = addMonths((0, finance_ledger_store_1.monthOf)(input.today), -1);
    if (input.closedThrough && last <= input.closedThrough)
        return null;
    return input.transactions.some((t) => t.month === last) ? { month: last, label: (0, finance_ledger_store_1.monthWords)(last) } : null;
}
/**
 * @description The year pack: offered from 15 January to 15 April for the year before, until done.
 * @param input - The day's records.
 * @returns The year, or null.
 */
function yearPack(input) {
    const day = input.today.slice(5), year = String(Number(input.today.slice(0, 4)) - 1);
    if (day < exports.YEAR_PACK_WINDOW[0] || day > exports.YEAR_PACK_WINDOW[1])
        return null;
    if (input.closes.some((c) => c.kind === 'year-pack' && c.period === year && c.state === 'closed'))
        return null;
    const hadRecords = input.closes.some((c) => c.kind === 'month' && c.period.startsWith(year))
        || input.transactions.some((t) => t.month.startsWith(year)) || Boolean(input.bookCreatedAt && input.bookCreatedAt.slice(0, 4) <= year);
    return hadRecords ? { year: Number(year) } : null;
}
/** The repeating income as the amount expected next: an estimate from the last deposit. */
function expectedIncome(income) {
    return forward({ ...(0, finance_ledger_store_1.amountFigure)(income.last), source: `Your last deposit from ${income.payee}` }, 'estimate');
}
/** Bills and expected income in the next seven days, soonest first. */
function upcoming(input, income) {
    const end = addDays(input.today, 7);
    const items = [...input.bills.week, ...input.bills.later]
        .filter((b) => b.state === 'due' && b.due >= input.today && b.due <= end)
        .map((b) => ({ date: b.due, label: b.payee, kind: 'bill', billId: b.billId, eventId: b.eventId, amount: b.amount }));
    if (income && income.nextDate >= input.today && income.nextDate <= end) {
        items.push({ date: income.nextDate, label: income.payee, kind: 'income', amount: expectedIncome(income) });
    }
    return items.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.label).localeCompare(String(b.label)));
}
/**
 * @description This week: money in and out over the last seven days, what is left to spend for the
 * next seven, and the bills and income ahead.
 * @param input - The day's records.
 * @param income - The repeating income, when one was found.
 * @returns The week. A figure the records do not hold is null.
 */
function weekView(input, income) {
    const recent = input.transactions.filter((t) => isFlow(t) && daysBetween(t.date, input.today) >= 0 && daysBetween(t.date, input.today) < 7);
    const monthLeft = input.month.left, perDay = input.month.perDay;
    const left = monthLeft && perDay ? { ...monthLeft, cents: Math.min(monthLeft.cents, perDay.cents * 7), parts: undefined } : null;
    return {
        from: addDays(input.today, -6), to: input.today,
        in: flowFigure(recent.filter((t) => t.direction === 'in')), out: flowFigure(recent.filter((t) => t.direction === 'out')), left,
        upcoming: upcoming(input, income),
    };
}
/**
 * @description How long the cash would last at the average spending of the last closed months.
 * @param accounts - The person's accounts.
 * @param linked - The ids of the person's bank links.
 * @param closes - The closed months.
 * @returns Months of cover with the two figures behind it, or null when no month is closed or no cash balance is known.
 */
function runway(accounts, linked, closes) {
    const closed = closes.filter((c) => c.kind === 'month' && c.state === 'closed' && c.out !== null && c.out.cents > 0)
        .sort((a, b) => b.period.localeCompare(a.period)).slice(0, exports.RUNWAY_MONTHS);
    const balances = counted(accounts, linked).filter((a) => a.type === 'depository').map(finance_ledger_store_1.balanceFigure).filter((f) => Boolean(f));
    const cash = totalOf(balances.reduce((sum, f) => sum + f.cents, 0), balances);
    if (!closed.length || !cash || cash.cents <= 0)
        return null;
    const spent = closed.map((c) => c.out), average = Math.round(spent.reduce((sum, f) => sum + f.cents, 0) / spent.length);
    const words = closed.length === 1 ? 'Your last closed month' : `Your last ${closed.length} closed months`;
    const spending = together(average, spent, words, dateRange(spent.map((f) => f.asOf)).newest);
    return {
        months: Math.floor((cash.cents / average) * 10) / 10, basisMonths: closed.length, from: closed[closed.length - 1].period, to: closed[0].period,
        cash, spending: { ...spending, source: words },
    };
}
/**
 * @description The day: every input Home's steps and its week, month and net worth need, each amount
 * a figure with its source and date. Invoices are not in this answer; they belong to the business records.
 * @param input - The day's records, already read.
 * @returns The answer of GET /api/finance/day.
 */
function buildDay(input) {
    const open = counted(input.accounts, input.linked);
    const income = mainIncome(input.transactions);
    return {
        book: input.bookId, asOf: input.today, currency: input.currency, accounts: open.length, firstRun: open.length === 0,
        sample: open.length > 0 && open.every((a) => a.posture === 'sample'),
        window: { months: recentMonths(input.today, exports.DAY_MONTHS) },
        newTransactions: newTransactions(input.transactions),
        unusual: unusualItems(input.transactions),
        bills: input.bills,
        plannedLow: plannedLow(input, income),
        payday: payday(input, income),
        staleAccounts: staleAccounts(open, input.today),
        close: monthToClose(input),
        yearPack: yearPack(input),
        streak: { monthsClosed: input.streak },
        week: weekView(input, income),
        month: input.month,
        goals: input.goals,
        netWorth: netWorth(input.accounts, input.linked),
        runway: runway(input.accounts, input.linked, input.closes),
        income: income ? { payee: income.payee, cadence: income.cadence, nextDate: income.nextDate, amount: expectedIncome(income) } : null,
    };
}
//# sourceMappingURL=finance-day-model.js.map