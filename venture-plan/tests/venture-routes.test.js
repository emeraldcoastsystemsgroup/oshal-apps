/**
 * Venture Plan — route-gate guards, asserted as CALLS.
 *
 * FIVE THINGS THIS SUITE EXISTS TO STOP.
 *
 * 1. **An anonymous request reaching the database.** Every handler must 401 with
 *    the pool PROVABLY untouched. A handler that queries first and checks after
 *    has already given an unauthenticated caller a round trip, and one of those
 *    queries will eventually be the one missing its owner predicate.
 *
 * 2. **A recompute costing money.** `POST /model`, `GET /sensitivity` and every
 *    document read are pure arithmetic. The product's central interaction is
 *    "edit a guess, watch the answer move" — the moment that spends, people stop
 *    exploring, and exploring is the only way anyone finds out which guess is
 *    load-bearing. Asserted by counting bot-client calls, not by reading source.
 *
 * 3. **A double-spend on a double click.** Two authoring runs on one venture
 *    would write two revisions of every assumption and race into the ledger, at
 *    twice the price. The second call must return the SAME run id.
 *
 * 4. **An export rendered from nothing.** A `.docx` looks finished in a way a web
 *    page does not, and it travels. Without a computed model every export answers
 *    409 rather than producing a confident-looking artefact from unresolved
 *    inputs.
 *
 * 5. **A surface that does not parse.** The console is one served HTML file whose
 *    inline scripts no compiler ever reads — a SyntaxError there is a blank page
 *    nobody's build catches.
 *
 * Runs against the COMPILED routes/*.js with the framework seams stubbed at the
 * require layer. Dependency-free node:test.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guards — the blanket 401-before-any-query sweep, cross-sub 404s, the LLM-free proof for every compute and read path, the exactly-one-call proof for the two paid paths, run single-flight, export 409 without a snapshot, and a classic-script parse of every inline script in the served surface.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Guard immutable FX route ownership/idempotency, foreign-quote refusal, and retired scenario-cent input.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Guard owner-scoped rebaseline policy CRUD and mutation-free forced-dry-run preview behavior.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');

/* ── a router that records its registrations ─────────────────────────────── */
function fakeRouter() {
  const routes = new Map();
  const reg = (m) => (p, h) => { routes.set(`${m} ${p}`, h); };
  return { routes, get: reg('get'), post: reg('post'), patch: reg('patch'), put: reg('put'), delete: reg('delete') };
}

/* ── require-layer stubs for the framework seams ─────────────────────────── */
const bot = { calls: [] };
const STUBS = {
  express: { Router: () => fakeRouter() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/shared/services/database': {
    buildOwnerRlsPolicyStatements: () => [],
    runRuntimeSchemaBootstrap: async () => {},
  },
  '@/app/routes/caller-sub': {
    callerSub: (req) => (req && req.oidc && req.oidc.user && req.oidc.user.sub) || null,
  },
  '@/features/agent-management': {
    BotNodeClient: class { hasEndpoint() { return false; } },
    createRegistryEndpointResolver: () => ({}),
  },
  // THE COST BOUNDARY. Every model call in the package goes through here, so
  // counting these calls is a direct measurement of what an endpoint spends.
  '@/app/routes/inline-bot-execution': {
    executeBotOrInline: async (_ctx, _client, agentId, request) => {
      bot.calls.push({ agentId, taskId: request.taskId, userSub: request.userSub });
      return { success: true, response: '{"sections":{}}', cost: 0.01, model: 'stub', usage: {} };
    },
  },
};
const origLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return origLoad.call(this, request, ...rest);
};

const { createVentureRoutes } = require(path.join(PKG, 'routes', 'venture-routes.js'));
const { DOC_CATALOG } = require(path.join(PKG, 'routes', 'venture-doc-catalog.js'));

/* ── harness ─────────────────────────────────────────────────────────────── */
function makePool(impl) {
  const pool = { calls: [] };
  pool.query = async (sql, params) => {
    pool.calls.push({ sql: String(sql), params: params || [] });
    return impl ? impl(String(sql), params || [], pool.calls.length) : { rows: [], rowCount: 0 };
  };
  pool.connect = async () => ({ query: pool.query, release() {} });
  return pool;
}
function makeRes() {
  const r = { statusCode: 200, body: null, headers: {}, sent: null };
  r.status = (n) => { r.statusCode = n; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.send = (o) => { r.sent = o; return r; };
  r.type = () => r;
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.sendFile = (f) => { r.sent = f; return r; };
  return r;
}
const AUTHED = { oidc: { user: { sub: 'alice' } } };
const FOREIGN = { oidc: { user: { sub: 'mallory' } } };

function router(pool) {
  return createVentureRoutes({ pool, appPackageDir: PKG, orchestrator: {} });
}
async function call(pool, method, route, req) {
  const handler = router(pool).routes.get(`${method} ${route}`);
  assert.ok(handler, `route ${method} ${route} must be registered`);
  const res = makeRes();
  await handler(Object.assign({ body: {}, params: {}, query: {}, originalUrl: route }, req), res);
  return res;
}

/** A ventures row the mappers accept. */
function ventureRow(over) {
  return Object.assign({
    id: 'v1', owner_sub: 'alice', name: 'Widget', idea_text: 'an idea about a thing', spec: {},
    currency: 'USD', target_launch_date: null, stage: 'scoped', horizon_months: 36,
    open_questions: [], created_at: new Date(0), updated_at: new Date(0),
  }, over || {});
}

/** An immutable FX row returned by the route store. */
function fxRow(over) {
  return Object.assign({
    id: 'fx1', venture_id: 'v1', owner_sub: 'alice', source_currency: 'EUR',
    reporting_currency: 'USD', rate_nanos: '1085000000', source_kind: 'published-source',
    source_ref: 'ECB reference rate', observed_at: new Date('2026-08-01T00:00:00Z'),
    idempotency_key: 'quote-eur-20260801', authored_by: 'user:alice',
    created_at: new Date('2026-08-01T00:00:00Z'), was_inserted: true,
  }, over || {});
}

/** One owner-scoped scheduled rebaseline policy row. */
function rebaselinePolicyRow(over) {
  return Object.assign({
    venture_id: 'v1', owner_sub: 'alice', enabled: true, dry_run: false,
    cadence: 'nightly', weekly_day: 1, max_cost_micros: '25000',
    updated_at: new Date('2026-08-01T00:00:00Z'),
  }, over || {});
}

/** A pool that owns exactly one venture, belonging to `sub`. */
function ownedBy(sub, extra) {
  return makePool((sql, params) => {
    if (extra) {
      const hit = extra(sql, params);
      if (hit) return hit;
    }
    if (/FROM venture_ventures/.test(sql)) {
      return params.includes(sub) ? { rows: [ventureRow({ owner_sub: sub })], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

/** Every route the router registers, as `method path` strings. */
function allRoutes() {
  return [...router(makePool()).routes.keys()];
}

/* ══ 1. nothing anonymous reaches the database ═══════════════════════════ */

test('EVERY registered route except the surface 401s before any query', async () => {
  const skip = new Set(['get /', 'get /app']);
  const checked = [];
  for (const key of allRoutes()) {
    if (skip.has(key)) continue;
    const [method, route] = key.split(' ');
    const pool = makePool();
    const before = bot.calls.length;
    const res = await call(pool, method, route, { params: { id: 'v1', runId: 'r1', key: 'k', docKey: 'funding-ask', lineId: 'l1', vendorId: 'x1', scenarioId: 's1', figureKey: 'f' } });
    assert.equal(res.statusCode, 401, `${key} must refuse an anonymous caller`);
    assert.equal(pool.calls.length, 0, `${key} must not query the database before the auth gate`);
    assert.equal(bot.calls.length, before, `${key} must not spend before the auth gate`);
    checked.push(key);
  }
  assert.ok(checked.length >= 31, `the sweep must cover the whole route table (covered ${checked.length})`);
});

/* ══ 2. cross-sub isolation at the HTTP boundary ═════════════════════════ */

test("a foreign caller gets 404 on someone else's venture, with the query scoped to THEM", async () => {
  const pool = ownedBy('alice');
  const res = await call(pool, 'get', '/ventures/:id', Object.assign({ params: { id: 'v1' } }, FOREIGN));
  assert.equal(res.statusCode, 404);
  assert.ok(pool.calls.length >= 1);
  for (const c of pool.calls) {
    assert.ok(c.params.includes('mallory'), 'the read is scoped to the caller');
    assert.ok(!c.params.includes('alice'), "the owner's sub never appears in a foreign caller's query");
    // Binding the sub as a PARAMETER is not the same as USING it: a statement can
    // carry owner_sub in its parameter list and never mention it in the WHERE
    // clause, in which case RLS is the only thing left between two users' plans.
    assert.match(c.sql, /owner_sub/, 'the predicate must be in the statement, not only in the params');
  }
});

test('a foreign caller cannot start a run, read documents, or export', async () => {
  for (const [method, route] of [
    ['post', '/ventures/:id/runs'], ['get', '/ventures/:id/documents'],
    ['get', '/ventures/:id/export/bundle.zip'], ['get', '/ventures/:id/assumptions'],
    ['post', '/ventures/:id/model'], ['get', '/ventures/:id/fx-assumptions'],
    ['post', '/ventures/:id/fx-assumptions'],
    ['get', '/ventures/:id/rebaseline-policy'],
    ['put', '/ventures/:id/rebaseline-policy'],
    ['post', '/ventures/:id/rebaseline-policy/preview'],
  ]) {
    const pool = ownedBy('alice');
    const before = bot.calls.length;
    const res = await call(pool, method, route, Object.assign({ params: { id: 'v1' } }, FOREIGN));
    assert.equal(res.statusCode, 404, `${method} ${route} must 404 for a foreign caller`);
    assert.equal(bot.calls.length, before, `${method} ${route} must not spend for a foreign caller`);
  }
});

/* ══ 3. the arithmetic is free, forever ══════════════════════════════════ */

test('a missing rebaseline policy is visibly disabled and costs nothing', async () => {
  const pool = ownedBy('alice');
  const before = bot.calls.length;
  const res = await call(pool, 'get', '/ventures/:id/rebaseline-policy', Object.assign({
    params: { id: 'v1' },
  }, AUTHED));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.policy.enabled, false);
  assert.equal(res.body.policy.dryRun, true);
  assert.equal(res.body.policy.maxCostMicros, 0);
  assert.equal(bot.calls.length, before);
  assert.equal(pool.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length, 0);
});

test('paid rebaseline enablement without a cap is refused before policy write', async () => {
  const pool = ownedBy('alice');
  const res = await call(pool, 'put', '/ventures/:id/rebaseline-policy', Object.assign({
    params: { id: 'v1' }, body: { enabled: true, dryRun: false },
  }, AUTHED));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'rebaseline_cost_cap_required');
  assert.equal(pool.calls.filter((c) => /INSERT INTO venture_rebaseline_policies/.test(c.sql)).length, 0);
});

test('valid rebaseline policy write selects through the owner venture', async () => {
  const pool = ownedBy('alice', (sql) => (/INSERT INTO venture_rebaseline_policies/.test(sql)
    ? { rows: [rebaselinePolicyRow()], rowCount: 1 } : null));
  const res = await call(pool, 'put', '/ventures/:id/rebaseline-policy', Object.assign({
    params: { id: 'v1' },
    body: { enabled: true, dryRun: false, cadence: 'nightly', maxCostMicros: 25_000 },
  }, AUTHED));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.policy.maxCostMicros, 25_000);
  const write = pool.calls.find((c) => /INSERT INTO venture_rebaseline_policies/.test(c.sql));
  assert.ok(write);
  assert.match(write.sql, /v\.id = \$1 AND v\.owner_sub = \$2/);
  assert.deepEqual(write.params.slice(0, 2), ['v1', 'alice']);
});

test('rebaseline preview forces dry-run and performs no writes or bot calls', async () => {
  const pool = ownedBy('alice', (sql) => (/FROM venture_rebaseline_policies/.test(sql)
    ? { rows: [rebaselinePolicyRow()], rowCount: 1 } : null));
  const before = bot.calls.length;
  const res = await call(pool, 'post', '/ventures/:id/rebaseline-policy/preview', Object.assign({
    params: { id: 'v1' }, body: { atIso: '2026-08-06T12:00:00Z' },
  }, AUTHED));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.decision.outcome, 'dry-run');
  assert.equal(res.body.decision.wouldStart, false);
  assert.equal(res.body.decision.slot, 'nightly:2026-08-06');
  assert.equal(bot.calls.length, before);
  assert.equal(pool.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length, 0);
});

test('FX evidence creation is owner-scoped, immutable and idempotency-aware', async () => {
  const pool = ownedBy('alice', (sql) => (/WITH inserted AS/.test(sql)
    ? { rows: [fxRow()], rowCount: 1 } : null));
  const res = await call(pool, 'post', '/ventures/:id/fx-assumptions', Object.assign({
    params: { id: 'v1' },
    body: {
      sourceCurrency: 'EUR', reportingCurrency: 'USD', rateNanos: 1_085_000_000,
      sourceKind: 'published-source', sourceRef: 'ECB reference rate',
      observedAt: '2026-08-01T00:00:00.000Z', idempotencyKey: 'quote-eur-20260801',
    },
  }, AUTHED));
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.fxAssumption.id, 'fx1');
  assert.equal(res.body.idempotentReplay, false);
  const insert = pool.calls.find((c) => /WITH inserted AS/.test(c.sql));
  assert.ok(insert.params.includes('alice'));
  assert.match(insert.sql, /ON CONFLICT \(venture_id, idempotency_key\) DO NOTHING/);
  assert.equal(pool.calls.filter((c) => /^\s*(UPDATE|DELETE)/i.test(c.sql)).length, 0);
});

test('foreign quote and retired scenario cents inputs fail with explicit 400s before writes', async () => {
  const quotePool = ownedBy('alice');
  const quote = await call(quotePool, 'post', '/ventures/:id/quotes', Object.assign({
    params: { id: 'v1' },
    body: { vendorId: 'ven1', unitCostMicros: 41_000_000, currency: 'EUR' },
  }, AUTHED));
  assert.equal(quote.statusCode, 400);
  assert.equal(quote.body.error, 'fx_assumption_required');
  assert.equal(quotePool.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length, 0);

  const scenarioPool = ownedBy('alice');
  const scenario = await call(scenarioPool, 'post', '/ventures/:id/scenarios', Object.assign({
    params: { id: 'v1' }, body: { name: 'Old cents', retailPriceCents: 1234 },
  }, AUTHED));
  assert.equal(scenario.statusCode, 400);
  assert.equal(scenario.body.error, 'retail_price_cents_retired');
  assert.equal(scenarioPool.calls.filter((c) => /INSERT INTO venture_scenarios/.test(c.sql)).length, 0);
});

test('POST /model recomputes WITHOUT ever calling a bot', async () => {
  const pool = ownedBy('alice', (sql) => (/INSERT INTO venture_models/.test(sql)
    ? {
      rows: [{
        id: 'm1', venture_id: 'v1', owner_sub: 'alice', scenario_id: null, run_id: null,
        engine_version: '1.0.0', inputs_hash: 'x'.repeat(64), figures: {}, tables: {},
        coverage: {}, warnings: [], posture: 'estimate', can_publish: false, computed_at: new Date(0),
      }],
      rowCount: 1,
    }
    : null));
  const before = bot.calls.length;
  const res = await call(pool, 'post', '/ventures/:id/model', Object.assign({ params: { id: 'v1' } }, AUTHED));
  assert.equal(res.statusCode, 200);
  assert.equal(bot.calls.length, before,
    'a recompute must NEVER spend — this is the promise the whole editing loop rests on');
  assert.ok(res.body.model.inputsHash, 'the snapshot records the inputs it was computed from');
  assert.ok(Array.isArray(res.body.model.missingAssumptionKeys),
    'the model reports which numbers it refused to invent');
  assert.ok(pool.calls.some((c) => /INSERT INTO venture_models/.test(c.sql)),
    'the snapshot is persisted, so a document can name the model it came from');
});

test('a brand-new venture will NOT publish, and says which assumptions are missing', async () => {
  const pool = ownedBy('alice', (sql) => (/INSERT INTO venture_models/.test(sql)
    ? {
      rows: [{
        id: 'm1', venture_id: 'v1', owner_sub: 'alice', scenario_id: null, run_id: null,
        engine_version: '1.0.0', inputs_hash: 'y'.repeat(64), figures: {}, tables: {},
        coverage: {}, warnings: [], posture: 'estimate', can_publish: false, computed_at: new Date(0),
      }],
      rowCount: 1,
    }
    : null));
  const res = await call(pool, 'post', '/ventures/:id/model', Object.assign({ params: { id: 'v1' } }, AUTHED));
  const insert = pool.calls.find((c) => /INSERT INTO venture_models/.test(c.sql));
  assert.equal(insert.params[insert.params.length - 1], false,
    'canPublish is FALSE with an empty register — the app refuses rather than footnotes');
  assert.ok(res.body.model.missingAssumptionKeys.includes('bom.final-assembly.cost'),
    'the final-assembly charge is a real cost nobody else accounts for, and it is not invented');
});

test('GET /sensitivity sweeps in code, spends nothing, and excludes unbanded inputs', async () => {
  const pool = ownedBy('alice');
  const before = bot.calls.length;
  const res = await call(pool, 'get', '/ventures/:id/sensitivity', Object.assign({ params: { id: 'v1' } }, AUTHED));
  assert.equal(res.statusCode, 200);
  assert.equal(bot.calls.length, before, 'the tornado is arithmetic, not an opinion');
  assert.ok(Array.isArray(res.body.tornado));
  assert.equal(typeof res.body.excludedForNoBand, 'number',
    'an assumption with no stated band is EXCLUDED, never swung over an invented range');
});

test('reading a document renders from the snapshot without a bot call', async () => {
  const pool = ownedBy('alice', (sql) => {
    if (/FROM venture_models/.test(sql)) {
      return {
        rows: [{
          id: 'm1', venture_id: 'v1', owner_sub: 'alice', scenario_id: null, run_id: null,
          engine_version: '1.0.0', inputs_hash: 'z'.repeat(64),
          figures: {}, tables: {}, coverage: { totalAssumptions: 0, bySourceKind: { 'model-estimate': 0 }, estimatePct: 0 },
          warnings: [], posture: 'estimate', can_publish: false, computed_at: new Date(0),
        }],
        rowCount: 1,
      };
    }
    return null;
  });
  const before = bot.calls.length;
  const res = await call(pool, 'get', '/ventures/:id/documents/:docKey',
    Object.assign({ params: { id: 'v1', docKey: 'assumption-register' } }, AUTHED));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.live, true, 'a plan is readable the moment it computes, before anyone pays for prose');
  assert.equal(bot.calls.length, before);
  assert.ok(/Posture: estimate/.test(res.body.document.bodyMd),
    'the computed posture line is in the body, and it moves as the evidence does');
});

/* ══ 4. the two paid paths spend exactly once, on the declared bot ════════ */

test('POST /ventures makes exactly ONE scoping call, on the strategist', async () => {
  bot.calls.length = 0;
  const pool = makePool((sql) => (/INSERT INTO venture_ventures/.test(sql)
    ? { rows: [ventureRow()], rowCount: 1 } : { rows: [], rowCount: 0 }));
  const res = await call(pool, 'post', '/ventures',
    Object.assign({ body: { idea: 'an inflatable pumpkin with a projector inside it' } }, AUTHED));
  assert.equal(res.statusCode, 201);
  assert.equal(bot.calls.length, 1, 'scoping is one short call — everything longer runs out of band');
  assert.equal(bot.calls[0].agentId, 'b7000000-0000-0000-0000-000000000001');
  assert.equal(bot.calls[0].userSub, 'alice', 'the spend is attributed to the caller, not the app');
});

test('a too-short idea is refused before any spend or any write', async () => {
  bot.calls.length = 0;
  const pool = makePool();
  const res = await call(pool, 'post', '/ventures', Object.assign({ body: { idea: 'hmm' } }, AUTHED));
  assert.equal(res.statusCode, 400);
  assert.equal(bot.calls.length, 0);
  assert.equal(pool.calls.length, 0);
});

test('POST /runs answers 202 immediately and is single-flighted per venture', async () => {
  const pool = ownedBy('alice', (sql) => (/INSERT INTO venture_runs/.test(sql)
    ? { rows: [{ id: 'run-1' }], rowCount: 1 } : null));
  const first = await call(pool, 'post', '/ventures/:id/runs',
    Object.assign({ params: { id: 'v1' }, body: { kind: 'full' } }, AUTHED));
  assert.equal(first.statusCode, 202, 'minutes of bot work never run on the request path');
  assert.equal(first.body.runId, 'run-1');
  assert.deepEqual(first.body.phases, ['bom', 'market', 'ops', 'compute', 'narrate']);

  const second = await call(pool, 'post', '/ventures/:id/runs',
    Object.assign({ params: { id: 'v1' }, body: { kind: 'full' } }, AUTHED));
  assert.equal(second.body.runId, 'run-1', 'a second click returns the SAME run — never a second spend');
  assert.equal(second.body.alreadyRunning, true);
  assert.equal(pool.calls.filter((c) => /INSERT INTO venture_runs/.test(c.sql)).length, 1,
    'exactly one run row exists');
});

test('an unknown run kind falls back to a full run rather than being coerced into nonsense', async () => {
  const pool = ownedBy('alice', (sql) => (/INSERT INTO venture_runs/.test(sql)
    ? { rows: [{ id: 'run-2' }], rowCount: 1 } : null));
  const res = await call(pool, 'post', '/ventures/:id/runs',
    Object.assign({ params: { id: 'v2' }, body: { kind: 'DROP TABLE' } }, AUTHED));
  assert.equal(res.body.kind, 'full');
});

/* ══ 5. exports refuse without a computed model ══════════════════════════ */

test('every export answers 409 no_model when nothing has been computed', async () => {
  for (const route of ['/ventures/:id/export/plan.docx', '/ventures/:id/export/model.xlsx',
    '/ventures/:id/export/deck.pptx', '/ventures/:id/export/bundle.zip']) {
    const pool = ownedBy('alice');
    const res = await call(pool, 'get', route, Object.assign({ params: { id: 'v1' } }, AUTHED));
    assert.equal(res.statusCode, 409, `${route} must refuse without a snapshot`);
    assert.equal(res.body.error, 'no_model');
  }
});

test('the print view also refuses without a computed model', async () => {
  const pool = ownedBy('alice');
  const res = await call(pool, 'get', '/ventures/:id/documents/:docKey/print',
    Object.assign({ params: { id: 'v1', docKey: 'funding-ask' } }, AUTHED));
  assert.equal(res.statusCode, 409);
});

/* ══ 6. the route table is what the surface expects ══════════════════════ */

test('the router registers the document read and regenerate routes for the catalogue', () => {
  const routes = allRoutes();
  for (const key of ['get /ventures/:id/documents', 'get /ventures/:id/documents/:docKey',
    'post /ventures/:id/documents/:docKey/regenerate', 'get /ventures/:id/documents/:docKey/print',
    'get /ventures/:id/assumptions/:key/history', 'patch /ventures/:id/assumptions/:key',
    'get /ventures/:id/fx-assumptions', 'get /ventures/:id/fx-assumptions/:fxId',
    'post /ventures/:id/fx-assumptions',
    'get /ventures/:id/model/figures/:figureKey', 'post /chat']) {
    assert.ok(routes.includes(key), `${key} must be registered`);
  }
  assert.equal(DOC_CATALOG.length, 17, 'the catalogue is seventeen documents');
});

/* ══ 7. the served surface parses ═══════════════════════════════════════ */

test('every inline script in the served surface parses as a classic script', () => {
  const file = path.join(PKG, 'tools', 'venture.html');
  assert.ok(fs.existsSync(file), 'the manifest points the ribbon at this file');
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  assert.ok(scripts.length >= 1, 'the console is driven by at least one inline script');
  scripts.forEach((src, i) => {
    // A SyntaxError in a served string is caught by no compiler and no console —
    // the page simply never loads and the app looks installed but dead.
    assert.doesNotThrow(() => new vm.Script(src), `inline script #${i + 1} must parse`);
  });
});

/**
 * Reconstruct the path each `api(METHOD, PATH, …)` call in the surface targets.
 *
 * The surface builds paths by concatenation — `'/ventures/' +
 * encodeURIComponent(id) + '/assumptions'` — so the string literals are kept
 * verbatim and every interpolated expression collapses to a single `X` segment
 * placeholder. Scanned character by character rather than by one clever regex,
 * because the thing being parsed is JavaScript and a regex that gets it subtly
 * wrong would quietly match nothing, which is the failure mode this guard exists
 * to prevent in the first place.
 *
 * @param html - The served surface file.
 * @returns The distinct request paths, with dynamic segments as `X`.
 */
function surfacePaths(html) {
  const found = new Set();
  const MARKER = "api('";
  for (let at = html.indexOf(MARKER); at >= 0; at = html.indexOf(MARKER, at + 1)) {
    const methodEnd = html.indexOf("'", at + MARKER.length);
    const method = html.slice(at + MARKER.length, methodEnd);
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) continue;
    // Walk the SECOND argument to its terminating comma or close paren.
    let i = html.indexOf(',', methodEnd) + 1;
    let depth = 0;
    let arg = '';
    while (i < html.length) {
      const ch = html[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') { if (depth === 0) break; depth -= 1; }
      else if (ch === ',' && depth === 0) break;
      arg += ch;
      i += 1;
    }
    // Keep the literals; everything between two of them was an expression.
    let built = '';
    let cursor = 0;
    let sawLiteral = false;
    while (cursor < arg.length) {
      const open = arg.indexOf("'", cursor);
      if (open < 0) break;
      const close = arg.indexOf("'", open + 1);
      if (close < 0) break;
      if (arg.slice(cursor, open).replace(/[\s+]/g, '') !== '') built += 'X';
      built += arg.slice(open + 1, close);
      sawLiteral = true;
      cursor = close + 1;
    }
    if (arg.slice(cursor).replace(/[\s+]/g, '') !== '') built += 'X';
    if (sawLiteral && built.startsWith('/')) found.add(built);
  }
  return [...found];
}

test('every path the surface fetches is a route the compiled router registers', () => {
  const html = fs.readFileSync(path.join(PKG, 'tools', 'venture.html'), 'utf8');
  const registered = allRoutes().map((k) => k.split(' ')[1]);
  const paths = surfacePaths(html);
  // A guard that matched nothing would pass forever. It has to FIND the calls
  // before it can prove anything about them.
  assert.ok(paths.length >= 12, `the surface makes at least a dozen API calls (found ${paths.length})`);
  for (const raw of paths) {
    // A trailing query string is appended as an expression; it is not a segment.
    const normalised = raw.replace(/([^/])X/g, '$1').replace(/\/$/, '') || '/';
    const matched = registered.some(
      (r) => new RegExp(`^${r.replace(/:[A-Za-z]+/g, '[^/]+')}$`).test(normalised),
    );
    assert.ok(matched, `the surface calls "${raw}" but no route registers "${normalised}"`);
  }
});

