/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The finance-analyst's specialist-context facts and its Jarvis routing words. Live, "How is my finance doing?" was answered by the assistant alone (Finance declared no "finance" word), and once routed the analyst answered "No data provided ... please provide the aggregate data" because it had no data channel. Pins: the compiled reader returns exactly the declared scalar keys for no link, linked-but-unsynced, a synced snapshot, a mixed-currency snapshot and a failed read; the manifest declares uses: specialist-context, the finance_facts tool and the bot the reader registers for; the route factory registers it; the persona authorizes finance_facts, answers a conversation from the facts without asking for data, and declares the money phrases. Run: node --test tests/finance-facts.test.cjs
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The money phrases no longer include "my accounts", "linked accounts", "i spend", "i spent", "my financial situation" or "my financial health", and no routing entry declares linked/health/situation/spent/spend: the kernel splits phrases into keywords, and those took Identity's account questions and unrelated "I spent ..." questions. The real scoring over every shipped vocabulary is the kernel's jarvis_routing_store_tests.rs.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const facts = require(path.join(ROOT, 'routes', 'finance-facts.js'));
const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
const persona = fs.readFileSync(path.join(ROOT, 'personas', 'finance-analyst.yaml'), 'utf8');
const NOW = new Date('2026-10-11T12:00:00Z');

/** A pool that answers the two reads from fixed rows and records what it was asked. */
function pool(items, saved, calls = []) {
  return { calls, async query(config) {
    calls.push(config);
    if (/oshal_finance_items/.test(config.text)) return { rows: [{ count: items }] };
    return { rows: saved ? [saved] : [] };
  } };
}

/** The kernel's own admission rule: exactly the declared keys, each null, boolean or finite. */
function admissible(result) {
  assert.deepEqual(Object.keys(result).sort(), [...facts.FINANCE_FACT_KEYS].sort());
  for (const [key, value] of Object.entries(result)) {
    assert.ok(value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)),
      `${key} is ${typeof value}`);
  }
}

const SNAPSHOT = {
  currency: 'USD', sourceEnvironment: 'sandbox',
  netWorth: { assets: 52000.456, liabilities: 1800, net: 50200.456 },
  accounts: [{ currency: 'USD' }, { currency: 'USD' }, { currency: 'USD' }],
  holdings: [{ value: 12000 }, { value: 3500.5 }],
  spendByMonth: [{ month: '2026-09', spend: 2400, income: 5100 }, { month: '2026-10', spend: 900.25, income: 2550 }],
};

test('no linked bank reads as zero institutions, never synced, complete', async () => {
  const calls = [];
  const result = await facts.readFinanceFacts(pool(0, null, calls), { sub: 'person-1' }, undefined, () => NOW);
  admissible(result);
  assert.equal(result['facts.complete'], true);
  assert.equal(result.linked_institutions, 0);
  assert.equal(result.synced, false);
  assert.equal(result.net_worth, null);
  assert.equal(result.brief_saved, false);
  assert.ok(calls.every((call) => call.values.length === 1 && call.values[0] === 'person-1'), 'owner-scoped by the principal sub');
  assert.ok(calls.every((call) => call.query_timeout < 1800), 'each read fits inside the kernel deadline');
});

test('a linked but never synced bank says linked and not synced', async () => {
  const result = await facts.readFinanceFacts(pool(2, null), { sub: 'person-1' }, undefined, () => NOW);
  admissible(result);
  assert.equal(result.linked_institutions, 2);
  assert.equal(result.synced, false);
});

test('a synced snapshot gives its figures, its age and that it is sandbox data', async () => {
  const saved = { aggregate: SNAPSHOT, synced_at: '2026-10-11T09:30:00Z', has_brief: true };
  const result = await facts.readFinanceFacts(pool(1, saved), { sub: 'person-1' }, undefined, () => NOW);
  admissible(result);
  assert.equal(result.synced, true);
  assert.equal(result.synced_hours_ago, 2.5);
  assert.equal(result.sandbox_data, true);
  assert.equal(result.single_currency, true);
  assert.equal(result.currency_is_usd, true);
  assert.equal(result.net_worth, 50200.46);
  assert.equal(result.assets, 52000.46);
  assert.equal(result.liabilities, 1800);
  assert.equal(result.accounts, 3);
  assert.equal(result.holdings, 2);
  assert.equal(result.holdings_value, 15500.5);
  assert.equal(result.latest_month_spend, 900.25, 'the latest month, not the first listed');
  assert.equal(result.latest_month_income, 2550);
  assert.equal(result.brief_saved, true);
});

test('a snapshot that mixes currencies gives counts but no money figure', async () => {
  const mixed = { ...SNAPSHOT, accounts: [{ currency: 'USD' }, { currency: 'EUR' }] };
  const result = facts.financeFacts(1, { aggregate: mixed, synced_at: NOW.toISOString() }, NOW);
  admissible(result);
  assert.equal(result.single_currency, false);
  assert.equal(result.accounts, 2);
  for (const key of ['net_worth', 'assets', 'liabilities', 'holdings_value', 'latest_month_spend', 'latest_month_income']) {
    assert.equal(result[key], null, key);
  }
});

test('a failed read never throws: every fact unknown, incomplete, and the error is reported', async () => {
  const errors = [];
  const broken = { async query() { throw new Error('relation "oshal_finance_items" does not exist'); } };
  const result = await facts.readFinanceFacts(broken, { sub: 'person-1' }, (err) => errors.push(err), () => NOW);
  admissible(result);
  assert.equal(result['facts.complete'], false);
  assert.equal(result.linked_institutions, null);
  assert.equal(errors.length, 1);
});

test('the manifest declares the channel, the tool and the bot the reader registers for', () => {
  assert.match(manifest, /^uses:\n(?:  .*\n)*  - specialist-context$/m);
  assert.match(manifest, new RegExp(`^  - name: ${facts.FINANCE_FACTS_TOOL}$`, 'm'));
  const tool = manifest.split(`\n  - name: ${facts.FINANCE_FACTS_TOOL}\n`)[1].split('\n\n')[0];
  assert.match(tool, /apiEndpoint: "GET \/api\/finance\/home-summary"/);
  assert.match(tool, /requiresApproval: false/);
  const routes = fs.readFileSync(path.join(ROOT, 'routes', 'finance-routes.js'), 'utf8');
  const agentId = routes.match(/const FINANCE_AGENT_ID = '([0-9a-f-]+)';/)[1];
  assert.match(manifest, new RegExp(`agentId: ${agentId}\\n    name: finance-analyst`), 'the reader registers for the declared bot');
});

test('the route factory registers the reader under the declared tool', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'routes', 'finance-routes.js'), 'utf8');
  const factory = routes.split('function createFinanceRoutes(ctx) {')[1];
  assert.match(factory.split('router.get(')[0], /registerFinanceFacts\(ctx\);/);
  assert.match(routes, /agentId: FINANCE_AGENT_ID,\n\s+toolName: finance_facts_1\.FINANCE_FACTS_TOOL/);
  assert.match(routes, /facts: \[\.\.\.finance_facts_1\.FINANCE_FACT_KEYS\]/);
});

test('the persona authorizes the read and answers a conversation from the facts, never asking for data', () => {
  assert.match(persona, /^authorizations:\n  finance_facts: "auto"$/m);
  assert.match(persona, /A person's question in conversation \("how is my finance doing\?"\) is answered in a few plain\n\s+sentences/);
  assert.match(persona, /Zero linked institutions means\n\s+no bank or brokerage is linked: say exactly that/);
  assert.match(persona, /A\n?\s*figure that is null was not recorded; that is not a failed read\. Only when facts\.complete is\n\s+false/);
  assert.match(persona, /Never ask the person to paste, attach or\n\s+provide their data/);
});

test('a question about the person\'s own money carries a declared word or phrase so Jarvis routes it here', () => {
  const keywords = persona.split('\nrouting_keywords:\n')[1];
  for (const phrase of ['finance', 'my finance', 'my finances', 'my money', 'my net worth', 'my spending', 'my budget']) {
    assert.match(keywords, new RegExp(`^- ${phrase}$`, 'm'), `${phrase} is not a routing word`);
  }
  // The kernel splits a phrase into keywords: these took Identity's account questions and
  // "I spent the afternoon in the garden". The scoring itself is pinned by the kernel's
  // jarvis_routing_store_tests.rs over every shipped vocabulary.
  for (const taken of ['my accounts', 'linked accounts', 'i spend', 'i spent', 'my financial situation', 'my financial health']) {
    assert.doesNotMatch(keywords, new RegExp(`^- ${taken}$`, 'm'), `${taken} declares a word that is not about money`);
  }
  for (const line of keywords.split('\n').filter((entry) => entry.startsWith('- '))) {
    for (const word of line.slice(2).split(' ')) {
      assert.ok(!['linked', 'health', 'situation', 'spent', 'spend'].includes(word), `${line} declares "${word}"`);
    }
  }
  for (const trading of ['stock', 'trade', 'my stocks', 'my portfolio', 'ticker']) {
    assert.doesNotMatch(keywords, new RegExp(`^- ${trading}$`, 'm'), `${trading} belongs to Intelligent Trades`);
  }
});
