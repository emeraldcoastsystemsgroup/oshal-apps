"use strict";
/**
 * Finance brief composition: every money figure is written here from the saved accounts, and the
 * analyst model only narrates around figures it is handed.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 11: a saved brief listed 'Plaid Student Loan: $6,526.20' (the account
 *     |                                             | holds $65,262), invented 'Total Loans: $99,540.09' and 'Total Liabilities: $104,970.09', then printed
 *     |                                             | its own working ('Correction on Liabilities visibility ... ~$105k ... hidden or aggregated'). The
 *     |                                             | figures section (net worth, assets, liabilities, each account's balance) is now composed here from
 *     |                                             | computeFinanceTotals and the stored accounts. The model writes only the commentary, may quote only
 *     |                                             | listed amounts, and any amount it writes that is not one of them is caught in code: one rewrite is
 *     |                                             | asked for, then a sentence still carrying one is left out with a visible note. Sentences that
 *     |                                             | narrate its own working (verified totals, a discrepancy, hidden or unlisted figures, a correction)
 *     |                                             | are left out the same way.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Live check of 1: the commentary copied the request's section guidance into
 *     |                                             | its heading ('## The story - one or two sentences on where they stand.'). The request names the
 *     |                                             | four headings exactly and gives their guidance apart, and composeBrief cuts any text after a
 *     |                                             | section's heading words.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 12: a commentary called the buffer low from one account ('only $110.00 in
 *     |                                             | your Plaid Checking account') beside $62,589.00 cash and deposits, and called a listed Bitcoin
 *     |                                             | holding out of scope. The request names the cash-and-deposits total as the buffer and every
 *     |                                             | listed holding as part of the portfolio (bufferRules).
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 14: the Portfolio paragraph ended in the fragment "($2.11), and U S Dollar
 *     |                                             | ($0.01).": the sentence splitter broke after "Inc." before "(", the head was left
 *     |                                             | out for its amount and its tail kept. lineSentences() does not end a sentence
 *     |                                             | after an abbreviation or an initial. Guard: tests/brief-figures.test.cjs.
 * -----------------------------------------------------------------------------
 *
 * @module finance-brief
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.money = money;
exports.briefFigures = briefFigures;
exports.quotableAmounts = quotableAmounts;
exports.isQuotable = isQuotable;
exports.checkCommentary = checkCommentary;
exports.withoutUnverified = withoutUnverified;
exports.buildCommentaryPrompt = buildCommentaryPrompt;
exports.buildRewritePrompt = buildRewritePrompt;
exports.composeBrief = composeBrief;
/** Sentences that narrate the model's own working rather than the person's money. */
const WORKING = /\b(?:verified totals?|discrepanc\w*|hidden or aggregated|unlisted|aggregated liabilit\w*|correction(?: on\b|:)|recalculat\w*|re-?computed?|my (?:calculation|math|working))/i;
/** A commentary heading that carried the request's guidance after its name ("## The story - one or two sentences ..."). */
const SECTION_HEADING = /^##\s+(The story|Portfolio|Spending|Watch-outs)\b[^\n]*$/gm;
/** A written money amount: a currency sign or code, digits, optional cents and an optional k / M scale. */
const AMOUNT = /(?:[$€£]|\b(?:USD|EUR|GBP|CAD|AUD)\s?)\s?(-?\d[\d,]*(?:\.\d+)?)(\s?(?:k|K|M|million|thousand)\b)?/g;
/**
 * @description Format an amount the way the brief writes it: the account currency, two decimals.
 * @param value - Dollars (or the currency's major unit).
 * @param currency - ISO currency code.
 * @returns For example "$65,262.00" or "-$40,452.32".
 */
function money(value, currency) {
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    }
    catch {
        return `${currency} ${value.toFixed(2)}`;
    }
}
/** The account's balance as the person owes or holds it, in cents. */
function accountCents(balance) {
    return Math.round(Math.abs(Number(balance || 0)) * 100);
}
/** True for an account the person owes on (credit and loans). */
function owed(type) {
    return ['credit', 'loan'].includes(String(type || '').toLowerCase());
}
/**
 * @description The figures section, written from the accounts only. Mixed currencies are never summed.
 * @param agg - The saved aggregate.
 * @param totals - computeFinanceTotals(agg).
 * @returns Markdown with "## Where you stand" and "## Accounts".
 */
function briefFigures(agg, totals) {
    const currency = totals.currency;
    const lines = ['## Where you stand'];
    if (totals.mixedCurrencies) {
        lines.push('Your accounts are in more than one currency, so they are listed one by one and not added together.');
    }
    else {
        lines.push(`- Net worth: ${money(totals.netWorth, currency)}`, `- Total assets: ${money(totals.totalAssets, currency)} (cash and deposits ${money(totals.cashAndDeposits, currency)}, investment accounts ${money(totals.investmentAccounts, currency)}${totals.otherAssets ? `, other ${money(totals.otherAssets, currency)}` : ''})`, `- Total owed: ${money(totals.totalLiabilities, currency)} (credit cards ${money(totals.creditOwed, currency)}, loans ${money(totals.loansOwed, currency)})`);
    }
    lines.push('', '## Accounts');
    const accounts = Array.isArray(agg.accounts) ? agg.accounts : [];
    if (!accounts.length)
        lines.push('No linked accounts in the saved snapshot.');
    for (const account of accounts) {
        const where = account.institution ? ` (${account.institution})` : '';
        const value = money(accountCents(account.balance) / 100, account.currency || currency);
        lines.push(`- ${account.name || 'Account'}${where}: ${value}${owed(account.type) ? ' owed' : ''}`);
    }
    return lines.join('\n');
}
/** Push one labelled amount when it is a finite number. */
function addAmount(list, label, value) {
    const number = Number(value);
    if (Number.isFinite(number))
        list.push({ label, cents: Math.round(Math.abs(number) * 100) });
}
/**
 * @description Every amount the commentary may quote: the totals, each account, each holding, each
 * spending category, each month's spend and income (and the change between months) and each recent transaction.
 * @param agg - The saved aggregate.
 * @param totals - computeFinanceTotals(agg).
 * @returns Labelled amounts in cents.
 */
function quotableAmounts(agg, totals) {
    const list = [];
    for (const key of ['netWorth', 'totalAssets', 'totalLiabilities', 'cashAndDeposits', 'investmentAccounts', 'otherAssets', 'creditOwed', 'loansOwed', 'holdingsValue']) {
        addAmount(list, key, totals[key]);
    }
    for (const a of agg.accounts || [])
        addAmount(list, `${a.name} balance`, a.balance);
    for (const h of agg.holdings || []) {
        addAmount(list, `${h.name} value`, h.value);
        addAmount(list, `${h.name} cost basis`, h.costBasis);
    }
    for (const s of agg.topSpending || [])
        addAmount(list, `${s.category} spending`, s.total);
    const months = agg.spendByMonth || [];
    months.forEach((m, i) => {
        addAmount(list, `${m.month} spend`, m.spend);
        addAmount(list, `${m.month} income`, m.income);
        if (i > 0)
            addAmount(list, `${m.month} spend change`, Number(m.spend) - Number(months[i - 1].spend));
    });
    for (const t of agg.recentTransactions || [])
        addAmount(list, `${t.name} on ${t.date}`, t.amount);
    return list;
}
/**
 * @description Whether a written amount is one of the quotable amounts: exact to the cent when it
 * carries cents, to the dollar when it carries none, and to its scale when written as 105k or 1.2M.
 * @param digits - The amount's digits as written (commas allowed).
 * @param scale - The k / M suffix, if any.
 * @param allowed - Quotable amounts in cents.
 * @returns True when it matches one.
 */
function isQuotable(digits, scale, allowed) {
    const value = Math.abs(Number(digits.replace(/,/g, '')));
    if (!Number.isFinite(value))
        return false;
    const unit = /k|thousand/i.test(scale || '') ? 1000 : /m/i.test(scale || '') ? 1e6 : 1;
    if (unit > 1) {
        const step = unit * 10 ** -((digits.split('.')[1] || '').length);
        return allowed.some((a) => Math.abs(a.cents / 100 - value * unit) < step / 2 + 1e-9);
    }
    if (digits.includes('.'))
        return allowed.some((a) => a.cents === Math.round(value * 100));
    return allowed.some((a) => Math.round(a.cents / 100) === value);
}
/** A word whose full stop ends an abbreviation or an initial, not a sentence ("Inc.", "Corp.", "U.", "S."). */
const ABBREVIATION = /(?:^|[\s(])(?:inc|corp|co|ltd|llc|plc|lp|bros|intl|dept|mr|mrs|ms|dr|st|jr|sr|vs|no|etc|[a-z])\.$/i;
/**
 * @description One line split into its sentences. A stop after an abbreviation such as "Inc." does not end a sentence:
 * sweep 14's brief split "... Achillion Pharmaceuticals Inc. ($2.11), and U S Dollar ($0.01)." after "Inc.", left out the
 * head for its amount and kept the tail "($2.11), and U S Dollar ($0.01)." as a fragment.
 * @param line - One line of the commentary.
 * @returns Its sentences in order.
 */
function lineSentences(line) {
    const out = [];
    for (const part of line.split(/(?<=[.!?])\s+(?=[A-Z(*_])/)) {
        if (out.length && ABBREVIATION.test(out[out.length - 1]))
            out[out.length - 1] += ` ${part}`;
        else
            out.push(part);
    }
    return out;
}
/** The commentary split into sentences and lines, keeping list markers with their line. */
function sentences(text) {
    return text.split(/\n/).flatMap(lineSentences);
}
/**
 * @description Check a commentary: amounts it writes that are not quotable, and sentences narrating its working.
 * @param text - The model's commentary.
 * @param allowed - Quotable amounts.
 * @returns The offending amounts and working sentences.
 */
function checkCommentary(text, allowed) {
    const unverified = [];
    for (const match of text.matchAll(AMOUNT)) {
        if (!isQuotable(match[1], match[2], allowed))
            unverified.push(match[0].trim());
    }
    const working = sentences(text).filter((s) => WORKING.test(s)).map((s) => s.trim());
    return { unverified, working };
}
/**
 * @description Leave out every sentence that carries an unquotable amount or narrates working, and say so.
 * @param text - The commentary.
 * @param allowed - Quotable amounts.
 * @returns The commentary without those sentences, with a visible note when any were left out.
 */
function withoutUnverified(text, allowed) {
    let dropped = 0;
    const kept = text.split('\n').map((line) => {
        const parts = lineSentences(line);
        const keep = parts.filter((part) => {
            const check = checkCommentary(part, allowed);
            const bad = check.unverified.length > 0 || check.working.length > 0;
            if (bad)
                dropped += 1;
            return !bad;
        });
        return keep.length || !parts.join('').trim() ? keep.join(' ') : null;
    }).filter((line) => line !== null);
    const body = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!dropped)
        return body;
    const note = `_${dropped} statement${dropped === 1 ? ' was' : 's were'} left out because ${dropped === 1 ? 'it' : 'they'} did not match your saved accounts. The figures above are exact._`;
    return body ? `${body}\n\n${note}` : note;
}
/**
 * @description The rules that keep the commentary's buffer and holdings remarks on the figures. Sweep 12: a brief called
 * the buffer "low, with only $110.00 in your Plaid Checking account" under a figures section showing $62,589.00 cash and
 * deposits, and listed a Bitcoin holding then called Bitcoin out of scope.
 * @param allowed - quotableAmounts(agg, totals).
 * @param currency - The aggregate's currency.
 * @returns The prompt lines.
 */
function bufferRules(allowed, currency) {
    const cash = allowed.find((a) => a.label === 'cashAndDeposits');
    return [
        ...(cash ? [`Their cash buffer is cash and deposits as a whole, ${money(cash.cents / 100, currency)}, never one account's balance: never call the buffer low because one account is small.`] : []),
        'Every holding listed, crypto included, is part of their portfolio: speak of it by its value and never call it out of scope.',
    ];
}
/**
 * @description The analyst's commentary request. The figures section is shown to it as already written;
 * it may quote only the listed amounts and never adds, rounds or estimates one.
 * @param agg - The saved aggregate.
 * @param figures - briefFigures(agg, totals).
 * @param allowed - quotableAmounts(agg, totals).
 * @returns The prompt.
 */
function buildCommentaryPrompt(agg, figures, allowed) {
    const { netWorth: _ignored, ...facts } = agg;
    const currency = agg.currency || 'USD';
    return [
        'You are a personal finance analyst writing the commentary of one person\'s money brief. The app has ALREADY',
        'written the figures section below from their linked accounts, and it is shown above your commentary exactly as',
        'given. It is complete and exact. Do not repeat it, recompute it, correct it or describe how it was computed.',
        'You do NOT give regulated investment advice and you do NOT place trades; you observe and explain.',
        '',
        'Write only these Markdown sections, each under its heading written exactly as "## The story", "## Portfolio",',
        '"## Spending" and "## Watch-outs" (nothing after the heading words), short sentences and tight bullets, no',
        'preamble, no sign-off. The story: one or two sentences on where they stand. Portfolio: holdings by value,',
        'concentration or drift; leave it out when there are no holdings. Spending: top categories and the',
        'month-over-month trend. Watch-outs: bills, debts, low buffers, anything worth a glance; non-alarmist, specific.',
        ...bufferRules(allowed, currency),
        '',
        'Every money amount you write must be copied exactly from AMOUNTS YOU MAY QUOTE. Never add, subtract, round or',
        'estimate an amount, and never write a total, sum, difference or "about" figure that is not listed: say it in words',
        'instead. Never say figures are missing, hidden, unlisted or inconsistent, never write a note or correction to',
        'yourself, and never name a field name, JSON or "verified totals". Speak to the person as "you".',
        '',
        'FIGURES SECTION (already shown above your commentary):',
        figures,
        '',
        'AMOUNTS YOU MAY QUOTE:',
        ...allowed.map((a) => `- ${a.label}: ${money(a.cents / 100, currency)}`),
        '',
        'ACCOUNTS, HOLDINGS AND SPENDING (JSON, for context):',
        JSON.stringify(facts),
    ].join('\n');
}
/**
 * @description The request to rewrite a commentary that stated amounts or working it may not.
 * @param prompt - The original commentary prompt.
 * @param previous - The commentary that failed the check.
 * @param check - What the check found.
 * @returns The rewrite prompt.
 */
function buildRewritePrompt(prompt, previous, check) {
    const problems = [
        ...check.unverified.map((amount) => `- ${amount} is not one of the amounts you may quote.`),
        ...check.working.map((sentence) => `- "${sentence.slice(0, 160)}" narrates your own working.`),
    ];
    return [prompt, '', 'YOUR PREVIOUS COMMENTARY:', previous, '', 'It broke the rules:', ...problems,
        'Write the whole commentary again: quote only listed amounts (or say it in words), and leave out any working.'].join('\n');
}
/**
 * @description Compose the saved brief: the code-written figures, then the commentary with any
 * remaining unquotable amount or working sentence left out (and a note saying so).
 * @param figures - briefFigures(agg, totals).
 * @param commentary - The model's commentary after at most one rewrite.
 * @param allowed - quotableAmounts(agg, totals).
 * @returns The brief Markdown.
 */
function composeBrief(figures, commentary, allowed) {
    const headed = String(commentary || '').trim().replace(SECTION_HEADING, '## $1');
    const narration = withoutUnverified(headed, allowed);
    return narration ? `${figures}\n\n${narration}` : figures;
}
//# sourceMappingURL=finance-brief.js.map