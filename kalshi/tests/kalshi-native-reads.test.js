/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Reads on the native kernel. Every scan read awaited ensureScanSchema, whose runtime ALTER and DESC index the kernel refuses on a read ("SQL mutation requires original writer admission", logged as "kalshi scan schema ensure failed" once per read): under OSHAL_EGRESS=kernel it now sends no SQL at all, while off the kernel it still declares the tables, with batch_id in the alert table as migration 076 has it. GET /portfolio with no Kalshi connection answered 404, which the kernel serves as "application asset not found": the compiled route now answers 409 { connected: false } with the connect-your-key sentence.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const logger = { info() {}, warn() {}, error() {}, debug() {} };
/** Callable, constructible and readable at any depth, but never a thenable: module-scope framework calls stay inert. */
const inert = new Proxy(function inertFramework() {}, {
  get: (_t, key) => (key === '__esModule' || key === 'then' || typeof key === 'symbol' ? undefined : inert),
  apply: () => inert,
  construct: () => inert,
});

/**
 * @description Load one compiled route module, and its compiled siblings, with the given ports; anything
 * else under @/ is inert. Each call is a fresh module graph, so environment read at load time is honoured.
 */
function load(file, ports, loaded = new Map()) {
  const compiled = path.resolve(__dirname, '../routes', file);
  if (loaded.has(compiled)) return loaded.get(compiled).exports;
  const subject = new Module(compiled, module);
  loaded.set(compiled, subject);
  subject.filename = compiled;
  subject.require = (request) => {
    if (Object.hasOwn(ports, request)) return ports[request];
    if (request.startsWith('@/')) return inert;
    if (request.startsWith('./')) return load(`${request.slice(2).replace(/\.js$/, '')}.js`, ports, loaded);
    return require(request);
  };
  subject._compile(fs.readFileSync(compiled, 'utf8'), compiled);
  return subject.exports;
}

/** @description A pool that records every statement it is sent. */
function recordingPool() {
  const statements = [];
  return { statements, query: async (text) => { statements.push(String(text)); return { rows: [], rowCount: 0 }; } };
}

test('on the native kernel ensureScanSchema sends no SQL; off it the tables are still declared', async (t) => {
  const previous = process.env.OSHAL_EGRESS;
  t.after(() => { if (previous === undefined) delete process.env.OSHAL_EGRESS; else process.env.OSHAL_EGRESS = previous; });

  process.env.OSHAL_EGRESS = 'kernel';
  const native = load('kalshi-scan-engine.js', { '@/shared/logger': { createChildLogger: () => logger } });
  const nativePool = recordingPool();
  await native.ensureScanSchema(nativePool);
  assert.deepEqual(nativePool.statements, []);

  delete process.env.OSHAL_EGRESS;
  const legacy = load('kalshi-scan-engine.js', { '@/shared/logger': { createChildLogger: () => logger } });
  const legacyPool = recordingPool();
  await legacy.ensureScanSchema(legacyPool);
  assert.equal(legacyPool.statements.length, 1);
  const alerts = /CREATE TABLE IF NOT EXISTS kalshi_scan_alerts \(([\s\S]*?)\);/.exec(legacyPool.statements[0]);
  assert.ok(alerts, 'the alert table is declared off the kernel');
  assert.match(alerts[1], /\bbatch_id UUID\b/, 'the runtime declaration carries batch_id as migration 076 does');
});

test('GET /portfolio without a Kalshi connection answers 409 connected:false, never 404', async () => {
  const routes = {};
  const router = new Proxy({}, {
    get: (_t, verb) => (verb === 'use' ? () => {} : (p, ...handlers) => { routes[`${String(verb).toUpperCase()} ${p}`] = handlers[handlers.length - 1]; }),
  });
  const kalshi = load('kalshi-routes.js', {
    express: { Router: () => router },
    '@/shared/logger': { createChildLogger: () => logger },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/trading-routes-helpers': { callerSub: (req) => req.oidc.user.sub, servePage: () => () => {} },
    './kalshi-scan-cron': { startKalshiScanCron: () => {} },
  });
  kalshi.createKalshiRoutes({ pool: recordingPool(), appPackageDir: path.resolve(__dirname, '..') });
  for (const key of ['GET /portfolio', 'POST /orders', 'DELETE /orders/:orderId']) {
    const reply = { status: 200, body: null };
    const res = { status(code) { reply.status = code; return res; }, json(body) { reply.body = body; return res; } };
    await routes[key]({ oidc: { user: { sub: 'kalshi-native-fixture' } }, body: {}, params: { orderId: 'x' }, query: {} }, res);
    assert.equal(reply.status, 409, key);
    assert.equal(reply.body.connected, false, key);
    assert.match(reply.body.error, /no Kalshi connection/, key);
  }
});
