/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.6.5: Request analysis runs after the press has answered, on a kernel that can run one turn of the analyst in the background. Against the compiled routes: the press records the request as working with the exact snapshot it reads, asks the kernel and answers 202 without asking the analyst inside the request; the kernel's hand-over saves the analysis over that snapshot, with the figures written in code and an unlisted amount left out; only the kernel's hand-over is taken, and only for the working request; a late, refused or empty answer and a changed snapshot save nothing and say so in words; one request runs at a time; a request the kernel no longer holds, or one past its time, reads as not finished; and without the kernel's port, or when it cannot start the turn, the 45 second path answers as before. Scoped doubles: the store (both tables), the framework modules and the kernel's `@/shared/package-runs` port. The kernel's own side is proved in the kernel repository (crates/oshald/tests/package_background_turn.rs).
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The store gate's home-summary job failed on this branch: scripts/business-home.test.cjs loads the routes with every module it does not name replaced by one stub, the request's module among them, and the cached saved read answered 502 where it must answer a plain 404. The saved read now answers exactly as before whenever the request's state cannot be read, for any reason; with a request working it still only reads and initialises nothing.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const ROUTES = path.join(ROOT, 'routes', 'finance-routes.js');
const ANALYSIS = path.join(ROOT, 'routes', 'finance-analysis.js');
const { analysisView, ANALYSIS_OVERDUE_MS, ANALYSIS_LOST_GRACE_MS } = require(ANALYSIS);
const ANALYST = 'a0000000-0000-0000-0000-000000000044';
const START = Date.parse('2026-11-14T03:00:00.000Z');
const EARLIER = { brief: '## Earlier analysis\nSaved before.', brief_at: '2026-11-12T19:05:00.000Z' };
const PORT_MISSING = Symbol('this platform has no background-run port');
/** Node's own loader, put back after every test however many times a test loaded the routes. */
const REAL_LOAD = Module._load;

/** One synthetic household: two accounts, so the quotable amounts are known. */
function aggregate() {
  return { generatedAt: '2026-11-13T00:00:00Z', currency: 'USD', netWorth: { assets: 1500, liabilities: 0, net: 1500 },
    accounts: [{ name: 'Everyday', type: 'depository', balance: 1000, currency: 'USD', institution: 'Example Bank' },
      { name: 'Savings', type: 'depository', balance: 500, currency: 'USD', institution: 'Example Bank' }],
    holdings: [], topSpending: [], spendByMonth: [], recentTransactions: [], transactionWindowDays: 90, notes: [],
    transactionsComplete: true, transactionCoverage: { state: 'complete', returned: 0, total: 0, institutions: [] } };
}

/** A store double holding the person's one snapshot row and their one analysis request row. */
function financeStore() {
  const now = () => new Date().toISOString();
  const store = { statements: [], data: { aggregate: aggregate(), ...EARLIER }, analysis: null,
    async query(text, values = []) {
      const sql = text.trim().replace(/\s+/g, ' ');
      store.statements.push(sql);
      if (/^INSERT INTO oshal_finance_analysis/.test(sql)) {
        store.analysis = { run_id: values[1], state: 'working', snapshot: values[2], requested_at: now(), finished_at: null, failure: null };
        return { rows: [], rowCount: 1 };
      }
      if (/^UPDATE oshal_finance_analysis SET state/.test(sql)) {
        const open = store.analysis && store.analysis.run_id === values[1] && store.analysis.state === 'working';
        if (open) Object.assign(store.analysis, { state: values[2], failure: values[3], finished_at: now() });
        return { rows: [], rowCount: open ? 1 : 0 };
      }
      if (/^DELETE FROM oshal_finance_analysis/.test(sql)) {
        const mine = Boolean(store.analysis) && store.analysis.run_id === values[1];
        if (mine) store.analysis = null;
        return { rows: [], rowCount: mine ? 1 : 0 };
      }
      if (/FROM oshal_finance_analysis/.test(sql)) return { rows: store.analysis ? [structuredClone(store.analysis)] : [], rowCount: store.analysis ? 1 : 0 };
      if (/^UPDATE oshal_finance_data SET brief/.test(sql)) {
        if (JSON.stringify(store.data.aggregate) !== values[2]) return { rows: [], rowCount: 0 };
        store.data.brief = values[1]; store.data.brief_at = now();
        return { rows: [{ brief_at: store.data.brief_at }], rowCount: 1 };
      }
      return { rows: [structuredClone(store.data)], rowCount: 1 };
    } };
  return store;
}

/** The kernel's port double: it records what it was asked, holds the runs it started and may refuse. */
function kernelPort() {
  const kernel = { asked: [], held: [], refusal: null };
  kernel.port = { native: true,
    async backgroundTurn(request) {
      kernel.asked.push(request);
      if (kernel.refusal) throw new Error(kernel.refusal);
      kernel.held.push(request.runId);
      return { runId: request.runId, state: 'running', maxSeconds: request.maxSeconds, deadline: 0 };
    },
    async status() { return { runs: kernel.held.map((runId) => ({ runId, state: 'running' })), cancelled: [] }; } };
  return kernel;
}

/** The compiled router with the bridge's modules replaced. `port` is the kernel's port, PORT_MISSING for none. */
function loadRoutes(t, store, port, analyst = async () => 'Your savings hold $500.', replaced = {}) {
  const handlers = {}, prompts = [];
  const record = (method) => (route, handler) => { handlers[`${method} ${route}`] = handler; };
  const doubles = {
    express: { Router: () => ({ get: record('GET'), post: record('POST'), delete: record('DELETE') }) },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
    '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => null },
    '@/features/payments': { getPaymentAdapter: () => { throw new Error('no rail'); } },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async (_c, _b, _a, request) => { prompts.push(request.text); return { response: await analyst(request.text, prompts.length) }; } },
    '@/app/routes/free-tier-rotation': { resolveUserLlmConnection: async () => null },
    '@/shared/security/explicit-write-confirmation': { confirmationRequiredPayload: () => ({}), hasExplicitWriteConfirmation: () => false },
  };
  if (port !== PORT_MISSING) doubles['@/shared/package-runs'] = port;
  Object.assign(doubles, replaced);
  // The routes ask for the kernel's port when a request arrives, so the doubles stay in place until the test ends.
  Module._load = function (request, parent, isMain) {
    if (parent && [ROUTES, ANALYSIS].includes(parent.filename) && request in doubles) return doubles[request];
    return REAL_LOAD.call(this, request, parent, isMain);
  };
  t.after(() => { Module._load = REAL_LOAD; delete require.cache[ROUTES]; });
  delete require.cache[ROUTES];
  require(ROUTES).createFinanceRoutes({ pool: store, appPackageDir: ROOT });
  const call = (key, { body = {}, headers = {}, query = {} } = {}) => {
    const res = { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    const req = { method: key.split(' ')[0], oidc: { user: { sub: 'alice' }, isAuthenticated: () => true }, params: {}, query, body,
      get: (name) => headers[String(name).toLowerCase()] };
    return handlers[key](req, res).then(() => res);
  };
  return { prompts,
    press: () => call('POST /brief/refresh'),
    state: () => call('GET /brief/analysis').then((res) => res.body.analysis),
    saved: () => call('GET /brief', { query: { cached: '1' } }),
    handOver: (body, trigger = 'background-turn') => call('POST /brief/analysis-result',
      { body, headers: trigger === null ? {} : { 'x-oshal-trigger': trigger } }) };
}

const clock = (t) => t.mock.timers.enable({ apis: ['Date'], now: START });
const briefSaves = (store) => store.statements.filter((sql) => /^UPDATE oshal_finance_data SET brief/.test(sql));

test('Request analysis is answered at once: the kernel is asked for the analyst, not the request', async (t) => {
  clock(t);
  const store = financeStore(), kernel = kernelPort();
  const routes = loadRoutes(t, store, kernel.port);
  const res = await routes.press();
  assert.equal(res.statusCode, 202, JSON.stringify(res.body));
  assert.deepEqual(res.body, { analysis: { state: 'working', requestedAt: '2026-11-14T03:00:00.000Z', finishedAt: null, message: null } });
  assert.equal(routes.prompts.length, 0, 'the analyst is not asked inside the request');
  assert.equal(kernel.asked.length, 1);
  const asked = kernel.asked[0];
  assert.deepEqual({ agentId: asked.agentId, deliverTo: asked.deliverTo, maxSeconds: asked.maxSeconds },
    { agentId: ANALYST, deliverTo: '/api/finance/brief/analysis-result', maxSeconds: 300 });
  assert.match(asked.runId, /^analysis-[0-9a-f-]{36}$/);
  assert.match(asked.text, /Savings/, 'the kernel is handed the commentary request over the saved accounts');
  assert.deepEqual(Object.keys(asked).sort(), ['agentId', 'deliverTo', 'maxSeconds', 'runId', 'text']);
  assert.equal(store.analysis.snapshot, JSON.stringify(store.data.aggregate), 'the request is fenced to the exact snapshot it read');
  assert.deepEqual(briefSaves(store), [], 'nothing is saved by the press');
  assert.equal(store.data.brief, EARLIER.brief, 'the earlier analysis stays');
});

test('the kernel\'s hand-over saves the analysis over the snapshot it was asked about', async (t) => {
  clock(t);
  const store = financeStore(), kernel = kernelPort();
  const routes = loadRoutes(t, store, kernel.port);
  await routes.press();
  t.mock.timers.tick(75_000);
  const handed = await routes.handOver({ runId: kernel.asked[0].runId, ok: true, response: 'Your savings hold $500. You also have $9,999 elsewhere.' });
  assert.equal(handed.statusCode, 200, JSON.stringify(handed.body));
  assert.deepEqual(handed.body, { taken: true, saved: true });
  assert.equal(routes.prompts.length, 0, 'the hand-over asks the analyst nothing');
  assert.match(store.data.brief, /Your savings hold \$500\./);
  assert.match(store.data.brief, /\$1,500\.00/, 'the figures are written in code from the saved accounts');
  assert.doesNotMatch(store.data.brief, /9,999/);
  assert.match(store.data.brief, /1 statement was left out because it did not match your saved accounts/);
  assert.equal(store.data.brief_at, '2026-11-14T03:01:15.000Z');
  assert.deepEqual(await routes.state(), { state: 'done', requestedAt: '2026-11-14T03:00:00.000Z', finishedAt: '2026-11-14T03:01:15.000Z', message: null });
  const read = await routes.saved();
  assert.equal(read.body.brief, store.data.brief);
  assert.equal(read.body.analysis.state, 'done');
});

test('only the kernel hands an analysis over, and only for the working request', async (t) => {
  clock(t);
  const store = financeStore(), kernel = kernelPort();
  const routes = loadRoutes(t, store, kernel.port);
  await routes.press();
  const runId = kernel.asked[0].runId;
  const forged = { runId, ok: true, response: 'Your savings hold $500.' };
  for (const trigger of [null, 'schedule', 'Background-Turn']) {
    const res = await routes.handOver(forged, trigger);
    assert.equal(res.statusCode, 403, `trigger ${trigger}`);
    assert.equal(res.body.error, 'kernel_only');
  }
  const other = await routes.handOver({ ...forged, runId: 'analysis-00000000-0000-4000-8000-000000000000' });
  assert.equal(other.statusCode, 409);
  assert.deepEqual(other.body, { taken: false, saved: false });
  assert.deepEqual(briefSaves(store), []);
  assert.equal((await routes.state()).state, 'working');
  assert.equal((await routes.handOver(forged)).statusCode, 200);
  const again = await routes.handOver({ ...forged, response: 'Your everyday account holds $1,000.' });
  assert.equal(again.statusCode, 409, 'a closed request takes no second hand-over');
  assert.equal(briefSaves(store).length, 1);
  assert.match(store.data.brief, /Your savings hold \$500\./);
});

test('an analyst that did not answer, was refused or said nothing: words, and nothing saved', async (t) => {
  clock(t);
  const cases = [
    [{ ok: false, error: 'background_turn_time_limit', message: 'the turn did not answer within 300 seconds' }, /^Your finance analyst did not answer within 5 minutes, so nothing was saved\. Your earlier analysis, if any, is unchanged\./],
    [{ ok: false, error: 'background_turn_failed', message: 'unavailable: provider fixture-api answered 502' }, /^Your finance analyst could not answer just now, so nothing was saved\./],
    [{ ok: true, response: '   ' }, /^Your finance analyst could not answer just now, so nothing was saved\./],
  ];
  for (const [outcome, words] of cases) {
    const store = financeStore(), kernel = kernelPort();
    const routes = loadRoutes(t, store, kernel.port);
    await routes.press();
    const handed = await routes.handOver({ runId: kernel.asked[0].runId, ...outcome });
    assert.equal(handed.statusCode, 200);
    assert.deepEqual(handed.body, { taken: true, saved: false });
    const state = await routes.state();
    assert.equal(state.state, 'failed');
    assert.match(state.message, words);
    assert.doesNotMatch(state.message, /provider|fixture-api|background_turn/, 'the kernel\'s own text is not shown');
    assert.deepEqual(briefSaves(store), [], 'nothing is saved');
    assert.equal(store.data.brief, EARLIER.brief);
    assert.equal((await routes.saved()).body.analysis.state, 'failed');
  }
});

test('a snapshot that changed while the analyst worked saves nothing', async (t) => {
  clock(t);
  const store = financeStore(), kernel = kernelPort();
  const routes = loadRoutes(t, store, kernel.port);
  await routes.press();
  store.data.aggregate.accounts[1].balance = 750;
  const handed = await routes.handOver({ runId: kernel.asked[0].runId, ok: true, response: 'Your savings hold $500.' });
  assert.deepEqual(handed.body, { taken: true, saved: false });
  assert.equal(store.data.brief, EARLIER.brief);
  const state = await routes.state();
  assert.equal(state.state, 'failed');
  assert.match(state.message, /^The account snapshot changed while analysis was running\. The previous saved analysis is unchanged\./);
});

test('one request at a time: a second press while the first is working starts nothing', async (t) => {
  clock(t);
  const store = financeStore(), kernel = kernelPort();
  const routes = loadRoutes(t, store, kernel.port);
  const first = await routes.press();
  t.mock.timers.tick(30_000);
  const second = await routes.press();
  assert.equal(second.statusCode, 202);
  assert.deepEqual(second.body, first.body, 'the same working request is answered');
  assert.equal(kernel.asked.length, 1);
});

test('the kernel still holds an earlier turn of this person: said in words, and nothing started', async (t) => {
  clock(t);
  const store = financeStore(), kernel = kernelPort();
  kernel.refusal = 'refused: background_turn_in_progress: this person\'s earlier background turn is still running';
  const routes = loadRoutes(t, store, kernel.port);
  const res = await routes.press();
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'analysis_in_progress');
  assert.match(res.body.message, /^Another request of yours is still being worked on, so this analysis was not started and nothing was saved\./);
  assert.equal(routes.prompts.length, 0);
  const state = await routes.state();
  assert.deepEqual([state.state, state.message], ['failed', res.body.message]);
  assert.equal(store.data.brief, EARLIER.brief);
});

test('a kernel that cannot start the turn: the 45 second path answers in the same press', async (t) => {
  const store = financeStore(), kernel = kernelPort();
  kernel.refusal = 'refused: continued process needs a verified local source identity';
  const routes = loadRoutes(t, store, kernel.port);
  const res = await routes.press();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(kernel.asked.length, 1);
  assert.equal(routes.prompts.length, 1, 'the analyst answered inside the request');
  assert.match(res.body.brief, /Your savings hold \$500\./);
  assert.equal(store.data.brief, res.body.brief);
  assert.equal(store.analysis, null, 'no request is left working');
  assert.equal((await routes.state()).state, 'idle');
});

test('without the kernel\'s background turn the 45 second path runs as before', async (t) => {
  for (const port of [PORT_MISSING, { native: true, async keepRunAlive() { throw new Error('not asked'); } }, undefined]) {
    const store = financeStore();
    const routes = loadRoutes(t, store, port);
    const res = await routes.press();
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(routes.prompts.length, 1);
    assert.equal(store.data.brief, res.body.brief);
    assert.equal(store.statements.some((sql) => /oshal_finance_analysis/.test(sql) && /^(INSERT|UPDATE|DELETE)/.test(sql)), false, 'no request row is written');
    assert.deepEqual(Object.keys((await routes.saved()).body).sort(), ['brief', 'briefAt', 'cached'], 'the saved read is as before');
  }
});

test('a request the kernel no longer holds, or one past its time, reads as not finished; a new press starts again', async (t) => {
  clock(t);
  const store = financeStore(), kernel = kernelPort();
  const routes = loadRoutes(t, store, kernel.port);
  await routes.press();
  kernel.held.length = 0;
  t.mock.timers.tick(ANALYSIS_LOST_GRACE_MS - 1000);
  assert.equal((await routes.state()).state, 'working', 'a request this young is not called lost');
  t.mock.timers.tick(2000);
  const lost = await routes.state();
  assert.equal(lost.state, 'failed');
  assert.match(lost.message, /^The analysis did not finish, so nothing was saved\. Your earlier analysis, if any, is unchanged\. Request analysis again\.$/);
  const again = await routes.press();
  assert.equal(again.statusCode, 202);
  assert.equal(kernel.asked.length, 2, 'the person can ask again at once');
  t.mock.timers.tick(ANALYSIS_OVERDUE_MS + 1000);
  assert.equal((await routes.state()).state, 'failed', 'a held request past its time is over');
});

test('what a saved request reads as', () => {
  const at = (seconds) => new Date(START + seconds * 1000).toISOString();
  const working = { run_id: 'analysis-1', state: 'working', snapshot: '{}', requested_at: at(0), finished_at: null, failure: null };
  const idle = { state: 'idle', requestedAt: null, finishedAt: null, message: null };
  assert.deepEqual(analysisView(undefined, null, START, null), idle);
  assert.deepEqual(analysisView({ aggregate: {}, brief: null }, null, START, null), idle, 'a row that is not a request is no request');
  assert.equal(analysisView(working, at(-60), START + 60_000, ['analysis-1']).state, 'working');
  assert.equal(analysisView(working, at(-60), START + 60_000, null).state, 'working', 'the kernel was not asked');
  assert.deepEqual(analysisView(working, at(70), START + 80_000, []),
    { state: 'done', requestedAt: at(0), finishedAt: at(70), message: null }, 'a brief saved after the request means it is done');
  assert.equal(analysisView({ ...working, state: 'done', finished_at: at(70) }, null, START + 80_000, null).finishedAt, at(70));
  const failed = analysisView({ ...working, state: 'failed', finished_at: at(5), failure: 'Said in words.' }, null, START + 80_000, null);
  assert.deepEqual([failed.state, failed.message], ['failed', 'Said in words.']);
});

/** A double that fails the test when a read initialises the schema. */
const NO_BOOTSTRAP = { '@/shared/services/database': {
  runRuntimeSchemaBootstrap: () => assert.fail('a cached read must not initialise the schema'), buildOwnerRlsPolicyStatements: () => [] } };

/** A store that only answers reads: any other statement fails the test. The request's table may be missing. */
function readOnlyStore({ brief = null, tableMissing = false } = {}) {
  const store = { statements: [],
    async query(text) {
      const sql = text.trim().replace(/\s+/g, ' ');
      store.statements.push(sql);
      assert.match(sql, /^SELECT /, 'the saved read only reads');
      if (/FROM oshal_finance_analysis/.test(sql)) {
        if (tableMissing) throw new Error('relation "oshal_finance_analysis" does not exist');
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ aggregate: aggregate(), brief, brief_at: brief ? EARLIER.brief_at : null }], rowCount: 1 };
    } };
  return store;
}

test('the saved read answers exactly as before when the request\'s state cannot be read at all', async (t) => {
  // The gate's home-summary job hands the routes one stub for every module it does not name, so the request's
  // module answers nothing there; a store from before migration 002 has no table to read.
  const cases = [['the request\'s module is a stub', { ...NO_BOOTSTRAP, './finance-analysis': {} }, false],
    ['the store has no request table', NO_BOOTSTRAP, true]];
  for (const [label, replaced, tableMissing] of cases) {
    for (const brief of [null, EARLIER.brief]) {
      const routes = loadRoutes(t, readOnlyStore({ brief, tableMissing }), PORT_MISSING, undefined, replaced);
      const res = await routes.saved();
      assert.equal(res.statusCode, brief ? 200 : 404, `${label}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, brief ? { brief, briefAt: EARLIER.brief_at, cached: true }
        : { error: 'no_saved_brief', message: 'No saved analysis yet. Choose Re-analyze to request one.' }, label);
    }
  }
});

test('the saved read with a request working only reads and initialises nothing', async (t) => {
  clock(t);
  const store = financeStore(), kernel = kernelPort();
  await loadRoutes(t, store, kernel.port).press();
  const before = store.statements.length;
  const res = await loadRoutes(t, store, kernel.port, undefined, NO_BOOTSTRAP).saved();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.analysis.state, 'working');
  assert.equal(res.body.brief, EARLIER.brief, 'the earlier analysis is what is saved');
  const read = store.statements.slice(before);
  assert.ok(read.length >= 2, 'the saved analysis and the request were read');
  for (const sql of read) assert.match(sql, /^SELECT /);
});
