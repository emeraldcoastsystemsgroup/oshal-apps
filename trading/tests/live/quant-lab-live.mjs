#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The quant toolkit's live proof on the test slot (Roger, 2026-11-17: a quant read in fifty named ideas with working tools). A made-up person with no Schwab login (editor tier over Intelligent Trades) calls every lab route directly, then asks the trading concierge questions across the list, graded by the tool trace (which tool ran, and the inputs its answer echoes), not by the prose. Prices are the World archive's recorded ones and must be labelled archived. With --order it runs on the swarm default order (Gemini 4 Medium first) or on bot-fast, and puts the slot's saved order back. Refuses production (:38788) and any non-loopback address; removes the person at the end.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0: the risk and factors answers must name their risk-free rate's source (the Treasury bill rate via FRED, or the reason zero was used) and carry the official Fama-French factors or the reason they are absent; the options route must answer the made-up person (no Schwab) that no chain is shown; one more concierge question (implied volatility) must run trading_quant_options. The receipt records whether the slot reached FRED and the French library.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.61.1: every lab route must answer within 2 seconds (the 1.61.0 run saw 20); before the risk and factors checks the desk's own run (POST /api/trading/quant/run) loads the reference data, at most three passes of under 2 seconds each, and the receipt records what each pass loaded; the risk answer must then name the Treasury bill rate or say why it is unavailable right now.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.61.3: after the direct checks the first stock question is asked again; the archived prices are kept in Trading's process by then, so the repeat must answer well inside 2 seconds (recorded as `repeat`, against the first answer's time).
 * -----------------------------------------------------------------------------
 *
 * usage: node trading/tests/live/quant-lab-live.mjs <base http://127.0.0.1:38798> <slot oshald.env> <out folder>
 *          [--order=current|swarm|bot-fast] [--skip-concierge] [--only=1,4,9]
 * Exit 0 when every check holds. The administrator credential is read by name from the env file and never printed;
 * the receipt (0600) holds statuses, tool names and echoed inputs, never a credential.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const APP = 'intelligent-trades', ORDER_KEY = 'inference.order.conversations';
const FIRST = Object.freeze({ swarm: { provider: 'antigravity-account', model: 'gemini-4-argon-medium' }, 'bot-fast': { provider: 'vllm', model: 'bot-fast' } });
const receipt = { startedAt: new Date().toISOString(), direct: [], concierge: [], failures: [] };
const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

/** Questions across the fifty ideas, each with the tool (and the inputs its answer echoes) that must run. */
const QUESTIONS = Object.freeze([
  { q: 'In plain words, what is the Sharpe ratio, and what is SPY\'s from the prices you have?', expect: [{ tool: 'trading_quant_stock', body: { symbol: 'SPY', view: 'risk' } }] },
  { q: 'What is a 95% one-day value at risk for SPY, and do its returns have fat tails compared with a bell curve?', expect: [{ tool: 'trading_quant_stock', body: { symbol: 'SPY', view: 'risk' } }] },
  { q: 'Does NVDA behave like a random walk, or does it mean-revert or trend?', expect: [{ tool: 'trading_quant_stock', body: { symbol: 'NVDA', view: 'behavior' } }] },
  { q: 'Fit a GARCH and a GJR-GARCH model to AAPL\'s volatility and tell me what they forecast.', expect: [{ tool: 'trading_quant_stock', body: { symbol: 'AAPL', view: 'volatility' } }] },
  { q: 'What would it cost to trade 50,000 shares of AAPL: the bid-ask spread and the market impact?', expect: [{ tool: 'trading_quant_stock', body: { symbol: 'AAPL', view: 'liquidity' } }] },
  { q: 'What is AAPL\'s beta, and its exposure in a Fama-French three-factor model?', expect: [{ tool: 'trading_quant_stock', body: { symbol: 'AAPL', view: 'factors' } }] },
  { q: 'Build a risk parity portfolio from SPY, AAPL and NVDA and show each one\'s share of the risk.', expect: [{ tool: 'trading_quant_portfolio', body: { method: 'risk-parity' } }] },
  { q: 'Are SPY and IWM cointegrated? Could they be a statistical arbitrage pair, and what is the Kalman hedge ratio?', expect: [{ tool: 'trading_quant_pair' }] },
  { q: 'Run a Monte Carlo simulation of where NVDA could be in three months.', expect: [{ tool: 'trading_quant_simulate', body: { symbol: 'NVDA' } }] },
  { q: 'Price a call option with Black-Scholes: stock 100, strike 105, six months, 4% interest, 25% volatility. What are the Greeks?', expect: [{ tool: 'trading_quant_calculate', body: { kind: 'black-scholes' } }] },
  { q: 'A bet wins 55% of the time and pays 2 to 1. How much of my bankroll does the Kelly criterion say to bet?', expect: [{ tool: 'trading_quant_calculate', body: { kind: 'kelly' } }] },
  { q: 'Explain how market makers set the spread against informed traders, with values 90 and 110 and 20% of traders informed.', expect: [{ tool: 'trading_quant_calculate', body: { kind: 'glosten-milgrom' } }] },
  { q: 'Is the Quant desk\'s momentum backtest overfit? What is the deflated Sharpe ratio?', expect: [{ tool: 'trading_quant_overfitting' }] },
  { q: 'What is the volatility smile, in plain words?', expect: [{ tool: 'trading_quant_explain' }] },
  { q: 'What implied volatility are AAPL options pricing right now, and what move does that imply?', expect: [{ tool: 'trading_quant_options', body: { symbol: 'AAPL' } }] },
]);

/** @description The loopback test slot, never production. @param {string} base Address. @returns {string} Origin. */
function testSlot(base) {
  const origin = new URL(String(base || '')).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('this proof runs only against a loopback kernel, http://127.0.0.1:<port>');
  if (new URL(origin).port === '38788') throw new Error('this proof writes a test person; it runs on the test slot (http://127.0.0.1:38798), never on production');
  return origin;
}

/** @description The administrator credential from an env file, by name; never printed. @param {string} file Env file. @returns {string} Token. */
function adminToken(file) {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((value) => value.startsWith('OSHAL_ADMIN_TOKEN='));
  if (!line) throw new Error('the env file names no OSHAL_ADMIN_TOKEN');
  return line.slice('OSHAL_ADMIN_TOKEN='.length).trim().replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * @description One request to the kernel's own origin, waiting as long as a model turn takes; answers status, JSON and milliseconds.
 * @param {string} origin Kernel. @param {string} credential Bearer or ''. @param {string} method Verb. @param {string} route Path.
 * @param {{body?:object, headers?:object}} [options] Body and extra headers.
 * @returns {Promise<{status:number, body:any, ms:number}>} The answer.
 */
function request(origin, credential, method, route, { body, headers = {} } = {}) {
  const started = Date.now(), url = new URL(route, origin);
  if (url.origin !== origin) return Promise.reject(new Error('refusing a request outside the kernel'));
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { let parsed = null; try { parsed = JSON.parse(text); } catch { parsed = null; } resolve({ status: res.statusCode, body: parsed, ms: Date.now() - started }); });
    });
    req.on('error', (error) => reject(new Error(`${method} ${route.split('?')[0]} did not answer: ${error.code || error.name}`)));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** @description A fresh confirmation for an administrator write. @param {string} origin Kernel. @param {string} admin Credential. @returns {Promise<object>} Header. */
async function confirmed(origin, admin) {
  return { 'x-oshal-confirm': (await request(origin, admin, 'POST', '/confirmations', { body: {} })).body.confirmation };
}

/** @description A made-up person holding the editor tier over Intelligent Trades, signed in. @param {string} origin Kernel. @param {string} admin Credential. @returns {Promise<object>} Person. */
async function makePerson(origin, admin) {
  const subject = `quantkit1-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 4)}`;
  const invite = await request(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } });
  if (invite.status >= 300) throw new Error(`invitation refused: ${invite.status}`);
  const accepted = await request(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.body.token)}/accept`, { body: { subject, display_name: 'Quant Sample (test)' } });
  if (accepted.status >= 300) throw new Error(`accept refused: ${accepted.status}`);
  const person = { subject, principal: accepted.body.principal, token: accepted.body.token, sessions: [] };
  const grant = await request(origin, admin, 'PUT', `/grants/${person.principal}/${APP}`, { body: { tier: 'editor' }, headers: await confirmed(origin, admin) });
  if (grant.status !== 200) throw new Error(`the Trades tier grant was refused: ${grant.status}`);
  const session = await request(origin, '', 'POST', '/sessions', { body: { token: person.token } });
  if (session.status !== 201 && session.status !== 200) throw new Error(`sign-in refused: ${session.status}`);
  person.sessions.push(session.body.session);
  say('test person', { subject });
  return person;
}

/** @description Take the grant back, sign out and deactivate the person. @param {string} origin Kernel. @param {string} admin Credential. @param {object} person Person. @returns {Promise<void>} */
async function removePerson(origin, admin, person) {
  for (const session of person.sessions) await request(origin, session, 'DELETE', '/sessions').catch(() => null);
  const deny = await request(origin, admin, 'PUT', `/grants/${person.principal}/${APP}`, { body: { tier: 'deny' }, headers: await confirmed(origin, admin) }).catch((e) => ({ status: message(e) }));
  const off = await request(origin, admin, 'POST', `/people/${person.principal}/deactivate`, { body: {}, headers: await confirmed(origin, admin) });
  const after = await request(origin, person.token, 'GET', '/api/authorization/me');
  say('test person removed', { subject: person.subject, grantDenied: deny.status, deactivated: off.status, tokenAfter: after.status });
}

/** @description Record a failed check. @param {string} what Check. @param {object} detail Facts. @returns {void} */
function failed(what, detail) {
  receipt.failures.push({ what, ...detail });
  say('FAIL', { what, ...detail });
}

/** The direct calls: each lab route answers as the person within the time a question may take, with its source labelled. */
const DIRECT = Object.freeze([
  ['GET', '/api/trading/quant/lab/explain/sharpe%20ratio', null, (b) => b.ok && b.concept.id === 'sharpe-ratio'],
  ['POST', '/api/trading/quant/lab/calculate', { kind: 'black-scholes', inputs: { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2 } }, (b) => b.result.price === 10.4506],
  ...Object.entries({ risk: (r) => r.returns && r.volatility, behavior: (r) => r.verdict, volatility: (r) => r.closeToClose && (r.garch.persistence || /needs at least 250/.test(r.garch.unavailable)), liquidity: (r) => r.roll && r.quoted.unavailable, factors: (r) => r.beta && r.beta.beta != null && r.official && (r.official.loadings || r.official.unavailable) })
    .map(([view, holds]) => ['POST', '/api/trading/quant/lab/stock', { symbol: view === 'factors' ? 'AAPL' : 'SPY', view }, (b) => b.ok && b.source === 'world-archive' && /not official exchange closes/.test(b.sourceNote) && b.view === view && holds(b.result)]),
  ['POST', '/api/trading/quant/lab/portfolio', { symbols: ['SPY', 'AAPL', 'NVDA'], method: 'risk-parity' }, (b) => b.ok && b.source === 'world-archive' && b.result.riskContributions],
  ['POST', '/api/trading/quant/lab/pair', { a: 'SPY', b: 'IWM' }, (b) => b.source === 'world-archive' && Array.isArray(b.names)],
  ['POST', '/api/trading/quant/lab/simulate', { symbol: 'NVDA', horizonDays: 63 }, (b) => b.ok && b.end && b.end.percentiles.p50 > 0],
  ['GET', '/api/trading/quant/lab/overfitting', null, (b) => b.researchOnly && (b.ready === true || /history test/.test(b.message))],
  ['POST', '/api/trading/quant/lab/options', { symbol: 'AAPL' }, (b) => b.ok === false && /none is connected, so no chain is shown/.test(b.message)],
]);

/** @description Let the desk's own run load the reference data (one source per pass, each pass bounded). @param {string} origin Kernel. @param {object} person Person. @returns {Promise<void>} */
async function loadReferences(origin, person) {
  receipt.reference = [];
  for (let pass = 1; pass <= 3; pass += 1) {
    const answer = await request(origin, person.sessions[0], 'POST', '/api/trading/quant/run', { body: {} });
    const fact = { pass, status: answer.status, ms: answer.ms, reference: answer.body && answer.body.reference };
    receipt.reference.push(fact);
    say('reference pass', fact);
    if (answer.ms > 2500) failed('a desk run that refreshes reference data took too long', fact);
    if (!fact.reference || fact.reference.refreshed == null) break;
  }
}

/** @description Call every lab route directly as the person. @param {string} origin Kernel. @param {object} person Person. @returns {Promise<void>} */
async function directChecks(origin, person) {
  await loadReferences(origin, person);
  for (const [method, route, body, holds] of DIRECT) {
    const answer = await request(origin, person.sessions[0], method, route, body ? { body } : {});
    const fact = { route: route.replace('/api/trading/quant/lab', 'lab'), view: body && body.view, status: answer.status, ms: answer.ms, source: answer.body && answer.body.source, sessions: answer.body && answer.body.sessions };
    if (answer.body && answer.body.riskFree) fact.riskFree = answer.body.riskFree.source;
    if (answer.body && answer.body.result && answer.body.result.official) fact.officialFactors = answer.body.result.official.unavailable || `${answer.body.result.official.days} days to ${answer.body.result.official.to}`;
    if (body && ['risk', 'factors'].includes(body.view) && !(answer.body && answer.body.riskFree && answer.body.riskFree.source)) failed('the risk-free rate names its source', fact);
    receipt.direct.push(fact);
    say('direct', fact);
    let ok = false;
    try { ok = answer.status === 200 && Boolean(holds(answer.body)); } catch { ok = false; }
    if (!ok) failed('direct route', { ...fact, body: JSON.stringify(answer.body).slice(0, 300) });
    if (answer.ms > 2000) failed('direct route over 2 seconds', fact);
    if (body && body.view === 'risk' && !(answer.body && answer.body.riskFree && /U\.S\. Treasury|unavailable right now/.test(answer.body.riskFree.source))) failed('the risk answer names the Treasury bill rate or why it is unavailable', fact);
  }
  const [method, route, body] = DIRECT.find(([, r, b]) => b && b.view === 'risk'), repeat = await request(origin, person.sessions[0], method, route, { body });
  receipt.repeat = { route: 'lab/stock', view: 'risk', status: repeat.status, ms: repeat.ms, first: (receipt.direct.find((d) => d.view === 'risk') || {}).ms };
  say('repeat', receipt.repeat);
  if (repeat.status !== 200 || repeat.ms > 1000) failed('the repeated stock question answers from the kept prices, well inside 2 seconds', receipt.repeat);
}

/** @description The answer a tool returned, from its receipt (the observation's body), when the receipt carries one. @param {object} run Receipt. @returns {object|null} Body. */
function toolBody(run) {
  const raw = run && (run.result ?? run.observation);
  try { const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; return (parsed && (parsed.body || parsed)) || null; } catch { return null; }
}

/** @description Whether a turn's tool trace holds an expected call. @param {Array<object>} used Receipts. @param {object} want Expected tool and echoed inputs. @returns {boolean} Held. */
function traced(used, want) {
  return used.some((run) => {
    if ((run.tool || run.name) !== want.tool) return false;
    if (!want.body) return true;
    const echoed = { ...(run.arguments || run.input || {}), ...(toolBody(run) || {}) };
    return Object.entries(want.body).every(([key, value]) => String(echoed[key] ?? '').toUpperCase() === String(value).toUpperCase());
  });
}

/** @description Ask the trading concierge each question and grade its tool trace. @param {string} origin Kernel. @param {object} person Person. @param {Set<number>|null} only Question numbers. @returns {Promise<void>} */
async function conciergeChecks(origin, person, only) {
  for (const [index, item] of QUESTIONS.entries()) {
    if (only && !only.has(index + 1)) continue;
    const answer = await request(origin, person.sessions[0], 'POST', '/api/swarm/bots/trading-concierge/ask', { body: { message: item.q, sessionId: `quantkit1-${index + 1}-${randomUUID().slice(0, 6)}` } });
    const used = Array.isArray(answer.body && answer.body.toolsUsed) ? answer.body.toolsUsed : [];
    const fact = { n: index + 1, status: answer.status, seconds: Math.round(answer.ms / 1000), tools: used.map((r) => r.tool || r.name), held: item.expect.every((want) => traced(used, want)), reply: String((answer.body && answer.body.reply) || '').slice(0, 160) };
    receipt.concierge.push(fact);
    say('concierge', fact);
    if (answer.status !== 200 || !fact.held) failed(`question ${index + 1}`, { expected: item.expect, tools: fact.tools, status: answer.status });
  }
}

/** @description Put a model first in the slot's conversation order, keeping the saved value to restore. @param {string} origin Kernel. @param {string} admin Credential. @param {string} order swarm or bot-fast. @param {string} out Folder. @returns {Promise<string|null>} The saved value. */
async function setOrder(origin, admin, order, out) {
  if (order === 'current') return null;
  if (!FIRST[order]) throw new Error('--order must be current, swarm or bot-fast');
  const saved = (await request(origin, admin, 'GET', `/settings/${ORDER_KEY}`)).body.value;
  fs.writeFileSync(path.join(out, 'saved-conversation-order.json'), JSON.stringify({ key: ORDER_KEY, value: saved }), { mode: 0o600 });
  const rest = JSON.parse(saved).filter((e) => !(e.provider === FIRST[order].provider && e.model === FIRST[order].model));
  const next = order === 'swarm' ? [FIRST.swarm, FIRST['bot-fast'], ...rest.filter((e) => e.model !== 'bot-fast')] : [FIRST[order], ...rest];
  const put = await request(origin, admin, 'PUT', `/settings/${ORDER_KEY}`, { body: { scope: 'deployment', value: JSON.stringify(next) }, headers: await confirmed(origin, admin) });
  if (put.status !== 200) throw new Error(`the conversation order could not be set: ${put.status}`);
  say('conversation order', { first: `${next[0].provider}/${next[0].model}` });
  return saved;
}

/** @description Restore a saved conversation order. @param {string} origin Kernel. @param {string} admin Credential. @param {string|null} saved Value. @returns {Promise<void>} */
async function restoreOrder(origin, admin, saved) {
  if (saved == null) return;
  const put = await request(origin, admin, 'PUT', `/settings/${ORDER_KEY}`, { body: { scope: 'deployment', value: saved }, headers: await confirmed(origin, admin) });
  say('conversation order restored', { status: put.status });
  if (put.status !== 200) failed('restore the conversation order (saved-conversation-order.json holds it)', { status: put.status });
}

/** @description Run the proof. @param {string[]} argv Arguments. @returns {Promise<number>} Exit code. */
async function main(argv) {
  const [base, envFile, out] = argv.filter((a) => !a.startsWith('--')), flag = (name) => (argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1];
  if (!base || !envFile || !out) throw new Error('usage: <base http://127.0.0.1:38798> <slot oshald.env> <out folder> [--order=current|swarm|bot-fast] [--skip-concierge] [--only=1,4]');
  const origin = testSlot(base), admin = adminToken(envFile), order = flag('order') || 'current', only = flag('only') ? new Set(flag('only').split(',').map(Number)) : null;
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const person = await makePerson(origin, admin);
  let saved = null;
  try {
    await directChecks(origin, person);
    if (!argv.includes('--skip-concierge')) { saved = await setOrder(origin, admin, order, out); receipt.order = order; await conciergeChecks(origin, person, only); }
  } finally {
    await restoreOrder(origin, admin, saved).catch((e) => failed('restore the conversation order', { error: message(e) }));
    await removePerson(origin, admin, person).catch((e) => failed('remove the test person', { error: message(e) }));
    fs.writeFileSync(path.join(out, `quant-lab-live-${order}.json`), JSON.stringify({ ...receipt, finishedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  }
  say('done', { order, direct: receipt.direct.length, concierge: receipt.concierge.length, failures: receipt.failures.length });
  return receipt.failures.length ? 1 : 0;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.error(`quant-lab-live: ${message(error)}`); process.exitCode = 1; });
