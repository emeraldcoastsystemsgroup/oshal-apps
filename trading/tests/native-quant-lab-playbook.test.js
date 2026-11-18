/** CHANGE LOG
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.62.1: every options question starts with a trading_quant_options call, in the persona and in the tool's own instructions, even when no Schwab login seems connected (bot-fast had answered an AAPL implied-volatility question with no tool on blue).
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.61.3, from the 1.61.2 blue proof (bot-fast called trading_quant_run for two stock questions and stopped at trading_quant_explain for a calculation): trading_quant_run is described as the desk's own pass that answers no question, the persona never uses it to get prices, a rate or an answer, explain says it computes nothing and is followed by the tool it names, the lab tools say they work without Schwab, and no lab answer names trading_quant_run.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.61.1: the explain-first rule (a "what is" question always starts with trading_quant_explain; bot-fast had skipped it) in the persona and the tool's own description; the bill rate is the Treasury's, loaded by trading_quant_run when unavailable.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | trading_quant_options joins the lab tools; the honesty rules now name the real sources: option chains only from the person's Schwab connection, official Fama-French factors told apart from ETF proxies, and the Treasury bill rate as the default risk-free rate.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The quant's read-in and its tools agree: every lab tool is a research-only route tool under /api/trading/quant/lab that the concierge is authorized for and its playbook names, every calculator kind is offered and served, every one of the fifty ideas points only at tools that exist, and the playbook carries the honesty rules (numbers only from tools, the price source named, archived prices labelled, no order-book depth or live option chains, ETF proxies, every backtest's pitfalls, never an instruction).
 */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { LAB_ROUTES } = require('../routes/quant/lab-routes');
const { KINDS } = require('../routes/quant/lab-calculate');
const { CONCEPTS, TOOLS } = require('../routes/quant/lab-concepts');

const root = path.resolve(__dirname, '..');
const yamlRoots = [__dirname, path.resolve(__dirname, '../../scripts/toolchain'), ...(process.env.OSHAL_FRAMEWORK ? [path.resolve(process.env.OSHAL_FRAMEWORK)] : [])];
const yaml = require(require.resolve('js-yaml', { paths: yamlRoots }));
const manifest = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
const persona = yaml.load(fs.readFileSync(path.join(root, 'personas/trading-concierge.yaml'), 'utf8'));
const tools = new Map(manifest.tools.map((t) => [t.name, t]));
const LAB_TOOLS = Object.freeze({
  trading_quant_explain: 'GET /api/trading/quant/lab/explain/{input.concept}', trading_quant_calculate: 'POST /api/trading/quant/lab/calculate',
  trading_quant_stock: 'POST /api/trading/quant/lab/stock', trading_quant_portfolio: 'POST /api/trading/quant/lab/portfolio',
  trading_quant_pair: 'POST /api/trading/quant/lab/pair', trading_quant_simulate: 'POST /api/trading/quant/lab/simulate',
  trading_quant_overfitting: 'GET /api/trading/quant/lab/overfitting', trading_quant_options: 'POST /api/trading/quant/lab/options',
});

test('every lab tool is a research-only route tool over a route the lab serves', () => {
  const served = new Set(LAB_ROUTES.map(([method, p]) => `${method.toUpperCase()} /api/trading/quant${p.replace(':concept', '{input.concept}')}`));
  for (const [name, endpoint] of Object.entries(LAB_TOOLS)) {
    const t = tools.get(name);
    assert.ok(t, `${name} is declared`);
    assert.equal(t.type, 'api'); assert.equal(t.executor.executorType, 'api'); assert.equal(t.executor.apiEndpoint, endpoint);
    assert.ok(served.has(endpoint), `${endpoint} is served`);
    assert.equal(t.requiresApproval, false); assert.equal(t.defaultAuthMode, 'auto');
    for (const key of ['subject', 'owner', 'tenant', 'user', 'account', 'accountId', 'connectionKey', 'order', 'confirm']) assert.equal(t.inputSchema.properties[key], undefined, `${name} takes no ${key}`);
    assert.doesNotMatch(endpoint, /orders|mandate|protection|live|backstops|reconcil/);
  }
  assert.equal(served.size, Object.keys(LAB_TOOLS).length, 'no lab route without a tool');
});

test('the calculator offers exactly the kinds it serves', () => {
  assert.deepEqual([...tools.get('trading_quant_calculate').inputSchema.properties.kind.enum].sort(), Object.keys(KINDS).sort());
});

test('the concierge is authorized for every lab tool and its playbook names each tool and kind', () => {
  const p = persona.perspective;
  for (const name of Object.keys(LAB_TOOLS)) {
    assert.equal(persona.authorizations[name], 'auto', name);
    assert.ok(p.includes(`\`${name}\``), `the playbook names ${name}`);
  }
  for (const kind of Object.keys(KINDS)) assert.match(p, new RegExp(`\\b${kind.replace('-', '\\-')}\\b`), `the playbook names the ${kind} kind`);
  for (const view of ['risk', 'behavior', 'volatility', 'liquidity', 'factors']) assert.ok(p.includes(`view \`${view}\``), view);
});

test('the playbook carries the honesty rules of a quant answer', () => {
  const p = persona.perspective;
  assert.match(p, /never work out or invent a number yourself/);
  assert.match(p, /call them archived prices, not official closes/);
  assert.match(p, /order book behind the best bid and ask is not available/);
  assert.match(p, /Option chains come only from the person's own Schwab connection/);
  assert.match(p, /`official` is Kenneth R\. French's published daily factors/);
  assert.match(p, /ETF proxies \(SPY, IWM minus SPY, IWD minus IWF\) are stand-ins, not the official factors/);
  assert.match(p, /latest 3-month Treasury bill rate \(the U\.S\. Treasury's, with its date\) unless the person gives one/);
  assert.match(p, /unavailable right now, say so with its reason and that zero was used for the rate; the Quant desk loads them on its own passes/);
  for (const pitfall of ['look-ahead', 'survivorship', 'overfitting', 'fat tails']) assert.ok(p.includes(pitfall), pitfall);
  assert.match(p, /never a buy or sell instruction and never a promise/);
});

test('a "what is" question always starts with trading_quant_explain, in the persona and in the tool itself', () => {
  assert.match(persona.perspective, /Every "what is \.\.\.", "what does \.\.\. mean" or "explain \.\.\." question about an investing, trading or quant idea \(for example "What is the volatility smile\?"\) starts with a `trading_quant_explain` \{concept\} call, even when you know the answer/);
  assert.match(persona.perspective, /Never answer such a question without that call/);
  const explain = tools.get('trading_quant_explain');
  assert.match(explain.description, /^Call this first for every "what is" or "explain" question/);
  assert.match(explain.usageInstructions, /Always call it before explaining any quant or trading idea, even one you think you know/);
});

test('trading_quant_run is the desk\'s own pass and never an answer, in the tool and in the playbook', () => {
  const run = tools.get('trading_quant_run'), p = persona.perspective;
  assert.match(run.description, /^Starts the Quant desk's own scoring pass over its nightly stock list, inside Trading's single process/);
  assert.match(run.description, /It answers no question: a question about a stock, a portfolio, a pair, an option or an idea is answered at once by trading_quant_stock/);
  assert.doesNotMatch(run.description, /even without Schwab|reference data|Treasury|Fama-French/, 'nothing in it invites loading data for an answer');
  assert.match(run.usageInstructions, /^Only when the person asks to run or refresh the Quant desk's list, or trading_quant_today says there is no list yet\. Never to answer a question/);
  assert.match(p, /never call `trading_quant_run` to get prices, a rate or an answer/);
  assert.match(p, /`trading_quant_run` starts the Quant desk's own scoring pass in Trading's single process\. Use it only when the person asks to run or refresh the desk's list/);
  assert.doesNotMatch(p, /call `trading_quant_run` once/, 'the 1.61.x rule that sent bot-fast to the desk for a rate is gone');
});

test('explain computes nothing: the tool it names follows when a stock, a portfolio or numbers are named, with or without Schwab', () => {
  const explain = tools.get('trading_quant_explain'), p = persona.perspective;
  assert.match(explain.description, /It computes nothing: when the question also names a stock, a portfolio or numbers, call the tool it names next/);
  assert.match(explain.usageInstructions, /Then, when the question names a stock, a portfolio or numbers, call the tool it names/);
  assert.match(p, /Explain computes nothing: when the question also names a stock, a portfolio or numbers, call the tool it names next, before you answer/);
  assert.doesNotMatch(p, /Answer from what it returns/, 'the 1.61.1 line that let bot-fast stop at explain is gone');
  assert.match(p, /`trading_quant_stock`, `trading_quant_portfolio`, `trading_quant_pair`, `trading_quant_simulate` and `trading_quant_calculate` work with or without Schwab/);
  assert.match(tools.get('trading_quant_stock').usageInstructions, /with or without Schwab \(without it the answer uses the World archive's recorded day prices\)/);
  assert.match(tools.get('trading_quant_calculate').usageInstructions, /^Use whenever the person gives numbers for a formula .*never work those numbers out yourself/);
});

test('every options question starts with trading_quant_options, even when no Schwab login seems connected', () => {
  const p = persona.perspective, options = tools.get('trading_quant_options');
  assert.match(p, /Every options question \(implied volatility, the volatility smile, the Greeks, the move the options price\) starts with a `trading_quant_options` \{symbol\} call, even when you think no Schwab login is connected/);
  assert.match(p, /Never answer an options question without that call/);
  assert.match(p, /Option chains need a Schwab login, and `trading_quant_options` itself says when there is none/);
  assert.doesNotMatch(p, /Only option chains need Schwab\./, 'the 1.61.3 line that let bot-fast skip the tool is gone');
  assert.match(options.usageInstructions, /^Always call it for implied volatility, the volatility smile, put-call parity, market Greeks or the move the options market prices, even when you think no Schwab login is connected/);
});

test('no lab answer names trading_quant_run, so an answer never cues the desk\'s own pass', async () => {
  const { overfittingReport } = require('../routes/quant/lab-overfitting'), ref = require('../routes/quant/lab-reference');
  const pool = { query: async () => ({ rows: [] }) };
  const texts = [overfittingReport(null).message, overfittingReport({}).message, (await ref.readReference({ pool, time: () => 0 }, 'alice', 'rf-tbill')).unavailable];
  for (const text of texts) {
    assert.ok(text && text.length > 20, text);
    assert.doesNotMatch(text, /trading_quant_run/, text);
  }
  assert.match(texts[0], /after its evening run, or Run now on the Quant desk, with a connected Schwab login/);
  assert.match(texts[2], /The Quant desk loads it on its next pass \(its evening job, or Run now on the Quant desk\)/);
});

test('each of the fifty ideas points only at tools that exist and the concierge may call', () => {
  const named = new Set(Object.values(TOOLS));
  for (const name of named) {
    assert.ok(tools.has(name), `${name} exists`);
    assert.equal(persona.authorizations[name], 'auto', `${name} is the concierge's to call`);
  }
  for (const c of CONCEPTS) {
    const mentioned = [...c.tool.matchAll(/\btrading_[a-z_]+/g)].map((m) => m[0]);
    assert.ok(mentioned.length, `${c.id} names a tool`);
    for (const name of mentioned) assert.ok(tools.has(name), `${c.id} names ${name}, which exists`);
  }
});
