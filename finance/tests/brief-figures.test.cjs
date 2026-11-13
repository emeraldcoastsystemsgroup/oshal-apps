/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 11: the saved brief said 'Plaid Student Loan (First Platypus Bank): $6,526.20' for an
 *     |                                             | account holding $65,262, invented 'Total Loans: $99,540.09' and 'Total Liabilities: $104,970.09',
 *     |                                             | and printed its own working ('(Note: Verified Total Liabilities state ..., implying other unlisted
 *     |                                             | or aggregated liabilities exist)', '*Correction on Liabilities visibility:* ... ~$105k ... hidden or
 *     |                                             | aggregated'). Drives the compiled POST /brief/refresh with the real finance-brief module and a
 *     |                                             | recorded analyst: the figures are written in code from the accounts, that commentary is asked once
 *     |                                             | to rewrite, and when it repeats them every offending sentence is left out with a visible note while
 *     |                                             | correct sentences stay. A commentary quoting only listed amounts is saved as written.
 *     |                                             | Run: node --test tests/brief-figures.test.cjs
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Live check: the commentary's heading read '## The story - one or two sentences on where
 *     |                                             | they stand.' (the request's guidance copied). Headings are cut to their section name.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 12: a commentary called the buffer 'low, with only $110.00 in your Plaid Checking
 *     |                                             | account' beside $62,589.00 cash and deposits, and called a listed Bitcoin holding out of scope.
 *     |                                             | The request sent to the analyst names the cash-and-deposits total as the buffer and every listed
 *     |                                             | holding as part of the portfolio; the served persona no longer says crypto is out of scope.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 14: a sentence left out after "Inc." goes whole; its tail "($2.11), and U S
 *     |                                             | Dollar ($0.01)." is never kept as a fragment.
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | Model the saved analysis date returned by PostgreSQL and require unknown balances/totals to stay unknown in the written figures and quotable amounts.
 * 6   | maintainer@emeraldcoastsystemsgroup.com | Refuse cross-currency commentary money and keep negative asset balances signed.
 * -----------------------------------------------------------------------------
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Guard incomplete and unknown transaction coverage through actual saved readers, analysis or rendered views without changing independent balances.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const ROUTES = path.join(ROOT, 'routes', 'finance-routes.js');
const brief = require(path.join(ROOT, 'routes', 'finance-brief.js'));

/** The Plaid Sandbox institution's accounts (the live brief's data). */
const ACCOUNTS = [
  ['Plaid Checking', 'depository', 110], ['Plaid Saving', 'depository', 210], ['Plaid CD', 'depository', 1000],
  ['Plaid Credit Card', 'credit', 410], ['Plaid Money Market', 'depository', 43200], ['Plaid IRA', 'investment', 320.76],
  ['Plaid 401k', 'investment', 23631.98], ['Plaid Student Loan', 'loan', 65262], ['Plaid Mortgage', 'loan', 56302.06],
  ['Plaid HSA', 'depository', 6009], ['Plaid Cash Management', 'depository', 12060], ['Plaid Business Credit Card', 'credit', 5020],
].map(([name, type, balance]) => ({ name, type, subtype: null, mask: null, balance, currency: 'USD', institution: 'First Platypus Bank' }));

function aggregate() {
  return { generatedAt: '2026-10-12T00:00:00Z', currency: 'USD', netWorth: { assets: 1, liabilities: 2, net: -1 },
    accounts: ACCOUNTS, holdings: [{ name: 'Fund', value: 1000.1 }, { name: 'Stock', value: 2000.2 }],
    topSpending: [{ category: 'Groceries', total: 412.5, count: 9 }], spendByMonth: [{ month: '2026-09', spend: 1200, income: 3000 }, { month: '2026-10', spend: 1450, income: 3000 }],
    transactionsComplete: true, transactionCoverage: { state: 'complete', returned: 30, total: 30, institutions: [{ institution: 'Example Bank', state: 'complete', returned: 30, total: 30, pages: 1, reason: null }] },
    recentTransactions: [], transactionWindowDays: 90, notes: [] };
}

/** The sweep-11 commentary: a misread balance, invented totals and the model's own working. */
const SWEEP11 = [
  '## The story',
  'You owe more than you hold.',
  '- Plaid Student Loan (First Platypus Bank): $6,526.20',
  '- Total Loans: $99,540.09',
  '- Total Liabilities: $104,970.09',
  '(Note: Verified Total Liabilities state $126,994.06, implying other unlisted or aggregated liabilities exist.)',
  '*Correction on Liabilities visibility:* The visible accounts sum to ~$105k. The discrepancy suggests hidden or aggregated accounts.',
  '## Spending',
  'Groceries led at $412.50. Spending rose $300 from September.',
].join('\n');

/** A pool double holding one saved aggregate and recording the saved brief. */
function financePool() {
  const pool = { data: { aggregate: aggregate(), brief: null }, saved: [],
    async query(text, values = []) {
      if (/^\s*UPDATE oshal_finance_data SET brief/.test(text)) { pool.saved.push(values[1]); return { rows: [{ brief_at: '2026-11-12T19:05:00.000Z' }], rowCount: 1 }; }
      if (/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(text)) return { rows: [], rowCount: 0 };
      return { rows: [pool.data], rowCount: 1 };
    } };
  return pool;
}

/** The compiled router with framework modules doubled; the analyst answers from a queue. */
function loadRoutes(pool, answers) {
  const handlers = {}; const prompts = [];
  const record = (method) => (route, handler) => { handlers[`${method} ${route}`] = handler; };
  const doubles = {
    express: { Router: () => ({ get: record('GET'), post: record('POST'), delete: record('DELETE') }) },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
    '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => null },
    '@/features/payments': { getPaymentAdapter: () => { throw new Error('none'); } },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async (_c, _b, _a, request) => { prompts.push(request.text); return { response: answers.shift() || '' }; } },
    '@/app/routes/free-tier-rotation': { resolveUserLlmConnection: async () => null },
    '@/shared/security/explicit-write-confirmation': { confirmationRequiredPayload: () => ({}), hasExplicitWriteConfirmation: () => false },
    './finance-plaid': { plaidConfigured: () => true, plaidEnv: () => 'sandbox' },
    './session-crypto': { encryptSessionValue: (v) => v, decryptSessionValue: (v) => v },
  };
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === ROUTES && request in doubles) return doubles[request];
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[ROUTES];
    require(ROUTES).createFinanceRoutes({ pool, appPackageDir: ROOT });
  } finally { Module._load = original; delete require.cache[ROUTES]; }
  return { handlers, prompts };
}

async function refresh(answers) {
  const pool = financePool();
  const { handlers, prompts } = loadRoutes(pool, answers);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await handlers['POST /brief/refresh']({ method: 'POST', oidc: { user: { sub: 'alice' }, isAuthenticated: () => true }, params: {}, query: {}, body: {} }, res);
  return { res, prompts, saved: pool.saved };
}

const INVENTED = [/\$6,526\.20/, /\$99,540\.09/, /\$104,970\.09/, /105k/, /Correction/, /discrepancy/i, /unlisted/, /hidden/];

test('the figures are written in code from the accounts: each balance and total is exact', async () => {
  const { res, saved } = await refresh(['## The story\nYou owe more than you hold.']);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const text = saved[0];
  assert.match(text, /- Plaid Student Loan \(First Platypus Bank\): \$65,262\.00 owed/);
  assert.match(text, /- Net worth: -\$40,452\.32/);
  assert.match(text, /- Total owed: \$126,994\.06 \(credit cards \$5,430\.00, loans \$121,564\.06\)/);
  assert.match(text, /- Total assets: \$86,541\.74 \(cash and deposits \$62,589\.00, investment accounts \$23,952\.74\)/);
  assert.equal((text.match(/^- Plaid /gm) || []).length, 12, 'every account, once');
});

test('the sweep-11 commentary is sent back once; a clean rewrite is saved after the figures', async () => {
  const rewrite = '## The story\nYou owe more than you hold.\n## Spending\nGroceries led at $412.50.';
  const { res, prompts, saved } = await refresh([SWEEP11, rewrite]);
  assert.equal(res.statusCode, 200);
  assert.equal(prompts.length, 2, 'one rewrite request');
  for (const amount of ['$6,526.20', '$99,540.09', '$104,970.09', '$105k', '$300']) assert.ok(prompts[1].includes(`- ${amount} is not one of the amounts you may quote.`), amount);
  assert.match(prompts[1], /narrates your own working/);
  assert.ok(saved[0].endsWith(`\n\n${rewrite}`), saved[0]);
  for (const pattern of INVENTED) assert.doesNotMatch(saved[0], pattern);
});

test('repeated invented figures and working are left out with a visible note; correct sentences stay', async () => {
  const { saved } = await refresh([SWEEP11, SWEEP11]);
  const text = saved[0];
  for (const pattern of INVENTED) assert.doesNotMatch(text, pattern);
  assert.match(text, /You owe more than you hold\./);
  assert.match(text, /## Spending/);
  assert.doesNotMatch(text, /rose \$300/, 'an unlisted difference goes with its sentence');
  assert.match(text, /Groceries led at \$412\.50\./, 'a correct sentence beside it stays');
  assert.match(text, /_7 statements were left out because they did not match your saved accounts\. The figures above are exact\._$/);
});

test('a sentence left out after "Inc." goes whole, never leaving its tail as a fragment (sweep 14)', async () => {
  const portfolio = '## Portfolio\nYour largest holding is Stock at $2,000.20. Smaller ones include Achillion Pharmaceuticals Inc. ($2.11), and U S Dollar ($0.01).';
  const { saved } = await refresh([portfolio, portfolio]);
  const text = saved[0];
  assert.match(text, /Your largest holding is Stock at \$2,000\.20\./);
  assert.doesNotMatch(text, /\(\$2\.11\)|U S Dollar|Achillion/, 'the whole sentence is left out, tail included');
  assert.match(text, /_1 statement was left out because it did not match your saved accounts\. The figures above are exact\._$/);
});

test('a commentary quoting listed amounts, whole dollars or a listed amount at its scale is saved as written', async () => {
  const fine = '## The story\nYour student loan of $65,262 and mortgage of $56,302.06 lead what you owe.\n## Portfolio\nYour holdings come to about $3k.\n## Spending\nSpending rose $250.00 to $1,450.00 in October.';
  const { prompts, saved } = await refresh([fine]);
  assert.equal(prompts.length, 1, 'no rewrite');
  assert.ok(saved[0].endsWith(`\n\n${fine}`));
  assert.match(prompts[0], /AMOUNTS YOU MAY QUOTE:\n/);
  assert.match(prompts[0], /- Plaid Student Loan balance: \$65,262\.00\n/);
  assert.match(prompts[0], /FIGURES SECTION \(already shown above your commentary\):\n## Where you stand\n/);
  assert.doesNotMatch(prompts[0], /"netWorth":\{/, 'the aggregate\'s own stored net worth is not offered beside the exact one');
});

test('mixed currencies are listed one by one and never summed', () => {
  const agg = aggregate(); agg.accounts = [{ ...ACCOUNTS[0], currency: 'EUR' }, ACCOUNTS[1]];
  const totals = { currency: 'USD', mixedCurrencies: true, netWorth: 320, totalAssets: 320, totalLiabilities: 0, cashAndDeposits: 320, investmentAccounts: 0, otherAssets: 0, creditOwed: 0, loansOwed: 0, holdingsValue: 0 };
  const figures = brief.briefFigures(agg, totals);
  assert.match(figures, /more than one currency/);
  assert.doesNotMatch(figures, /Net worth/);
  assert.match(figures, /- Plaid Checking \(First Platypus Bank\): €110\.00/);
});

test('unknown account figures and required totals are never written or offered to the analyst as zero', () => {
  const agg = aggregate(); agg.accounts = [{ ...ACCOUNTS[0], balance: null }, { ...ACCOUNTS[1], name: 'Known zero', balance: 0 }];
  const totals = { currency: 'USD', mixedCurrencies: false, netWorth: null, totalAssets: null, totalLiabilities: 0, cashAndDeposits: null, investmentAccounts: 0, otherAssets: 0, creditOwed: 0, loansOwed: 0, holdingsValue: 0 };
  const figures = brief.briefFigures(agg, totals);
  assert.match(figures, /- Net worth: Unknown/);
  assert.match(figures, /- Total assets: Unknown/);
  assert.match(figures, /- Plaid Checking \(First Platypus Bank\): Unknown/);
  assert.match(figures, /- Known zero \(First Platypus Bank\): \$0\.00/);
  const allowed = brief.quotableAmounts(agg, totals);
  assert.equal(allowed.some((a) => ['netWorth', 'totalAssets', 'cashAndDeposits', 'Plaid Checking balance'].includes(a.label)), false);
  assert.equal(allowed.find((a) => a.label === 'Known zero balance').cents, 0);
  agg.balancesComplete = false; agg.accounts = [];
  const unreadable = brief.briefFigures(agg, totals);
  assert.match(unreadable, /Account balances could not all be read/);
  assert.doesNotMatch(unreadable, /No linked accounts/);
});

test('isQuotable matches to the cent, to the dollar and to a written scale only', () => {
  const allowed = [{ label: 'loan', cents: 6526200 }, { label: 'fund', cents: 300030 }];
  assert.equal(brief.isQuotable('65,262.00', undefined, allowed), true);
  assert.equal(brief.isQuotable('65,262', undefined, allowed), true);
  assert.equal(brief.isQuotable('6,526.20', undefined, allowed), false);
  assert.equal(brief.isQuotable('65', ' k', allowed), true);
  assert.equal(brief.isQuotable('3', 'k', allowed), true);
  assert.equal(brief.isQuotable('105', 'k', allowed), false);
});

test('a heading that copied the request\'s guidance is cut to the section name (live check)', async () => {
  const { prompts, saved } = await refresh(['## The story - one or two sentences on where they stand.\nYou owe more than you hold.\n## Watch-outs: bills, debts\n- Your checking holds $110.00.']);
  assert.ok(saved[0].endsWith('\n\n## The story\nYou owe more than you hold.\n## Watch-outs\n- Your checking holds $110.00.'), saved[0]);
  assert.match(prompts[0], /each under its heading written exactly as "## The story", "## Portfolio",\n"## Spending" and "## Watch-outs"/);
  assert.doesNotMatch(prompts[0], /^## The story - /m);
});

test('the analyst is told the buffer is cash and deposits as a whole and no holding is out of scope (sweep 12)', async () => {
  const { prompts } = await refresh(['## The story\nYou hold more than you owe.']);
  assert.match(prompts[0], /Their cash buffer is cash and deposits as a whole, \$62,589\.00, never one account's balance: never call the buffer low because one account is small\./);
  assert.match(prompts[0], /Every holding listed, crypto included, is part of their portfolio: speak of it by its value and never call it out of scope\./);
  const fs = require('node:fs');
  const persona = fs.readFileSync(path.join(ROOT, 'personas', 'finance-analyst.yaml'), 'utf8');
  const served = persona.slice(persona.indexOf('\nperspective:'), persona.indexOf('\nselector_descriptor:'));
  assert.doesNotMatch(served, /note that they are out of scope/);
  assert.match(served, /never call it out of scope/);
});


test('mixed-currency figures retain units but commentary cannot relabel or sum money', () => {
  const agg = aggregate();
  agg.accounts = [{ name: 'Dollar cash', type: 'depository', balance: 100, currency: 'USD' }, { name: 'Euro cash', type: 'depository', balance: 80, currency: 'EUR' }];
  const totals = { currency: 'USD', mixedCurrencies: true, accountCount: 2, netWorth: null, totalAssets: null, totalLiabilities: null };
  const figures = brief.briefFigures(agg, totals), allowed = brief.quotableAmounts(agg, totals);
  assert.match(figures, /Dollar cash: \$100.00/); assert.match(figures, /Euro cash: €80.00/);
  assert.deepEqual(allowed, []);
  const prompt = brief.buildCommentaryPrompt(agg, figures, allowed);
  assert.match(prompt, /do not write any money amounts or combine currencies/);
  const output = brief.composeBrief(figures, '## The story\nYour euro cash is $80.00.\nYou can combine the accounts for $180.00.', allowed);
  assert.doesNotMatch(output, /euro cash is \$80|for \$180/);
});

test('negative asset balances stay signed and missing-unit money remains unknown', () => {
  const agg = aggregate(); agg.accounts = [{ name: 'Overdrawn', type: 'depository', balance: -25, currency: 'USD' }, { name: 'Unknown unit', type: 'depository', balance: 100, currency: null }];
  const figures = brief.briefFigures(agg, { currency: 'USD', mixedCurrencies: false, netWorth: null, totalAssets: null, totalLiabilities: null });
  assert.match(figures, /Overdrawn: -\$25.00/); assert.match(figures, /Unknown unit: Unknown/);
  assert.deepEqual(brief.quotableAmounts(agg, { mixedCurrencies: false }), []);
});


for (const state of ['partial', 'unknown', 'legacy']) test(`new analysis excludes ${state} full-window rollups from quotes and context`, () => {
  const agg = aggregate();
  agg.topSpending = [{ category: 'Incomplete category', total: 9173.49, count: 2000 }];
  agg.spendByMonth = [{ month: '2026-10', spend: 9173.49, income: 8261.37 }];
  agg.recentTransactions = [{ date: '2026-10-01', name: 'Available transaction', amount: 12.5, currency: 'USD' }];
  agg.transactionsComplete = state === 'legacy' ? undefined : false;
  agg.transactionCoverage = state === 'legacy' ? undefined : { state, returned: 2000, total: state === 'partial' ? 2501 : null, institutions: [{ institution: 'Example', state, returned: 2000, total: state === 'partial' ? 2501 : null, pages: 4, reason: state === 'partial' ? 'page_limit' : 'unknown_total' }] };
  const totals = { currency: 'USD', mixedCurrencies: false, netWorth: 1, totalAssets: 2, totalLiabilities: 1 };
  const allowed = brief.quotableAmounts(agg, totals), figures = brief.briefFigures(agg, totals);
  assert.equal(allowed.some(a => /spending| spend| income/.test(a.label)), false);
  assert.equal(allowed.find(a => a.label === 'Available transaction on 2026-10-01').cents, 1250);
  assert.match(figures, /Transaction coverage.*(?:partial|unknown)/i);
  const prompt = brief.buildCommentaryPrompt(agg, figures, allowed);
  assert.doesNotMatch(prompt, /9173\.49|8261\.37/);
  assert.match(prompt, /Full-window spending, income and trends are unavailable/);
  assert.equal(agg.topSpending[0].total, 9173.49, 'reading analysis inputs never rewrites a saved snapshot');
});
