/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Shared fixture for the ledger suites (tests/ledger-*.test.cjs, sample-ledger, demo-data): a disposable PostgreSQL database with Finance's declared migrations applied twice, the compiled routes loaded over it with only the framework's own modules doubled (Express's Router, the logger, the artifact relay, and for the older routes the Plaid module and the analyst), a caller for one handler, and the check that every amount an answer carries names its source and its date. Every statement, person and figure in these suites is invented; no bank, provider or real person's record is read. The database server must be the loopback test server named by OSHAL_TEST_POSTGRES; the suites fail when it is not set.
 * -----------------------------------------------------------------------------
 */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.join(__dirname, '..');
const ROUTES = path.join(PKG, 'routes');
const FIXTURES = path.join(__dirname, 'fixtures', 'ledger');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
/** Database ports that belong to running installations; a test never connects to one. */
const LIVE_PORTS = new Set(['5432', '55432', '55433', '55434', '55438']);

/** The disposable test server's address, or a loud failure: a suite that skips is a guard that does not exist. */
function testServer() {
  const dsn = process.env.OSHAL_TEST_POSTGRES;
  if (!dsn) throw new Error('OSHAL_TEST_POSTGRES must name the disposable PostgreSQL server for the Finance ledger suites');
  const url = new URL(dsn);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || LIVE_PORTS.has(url.port || '5432')) {
    throw new Error('The Finance ledger suites run only against a disposable loopback PostgreSQL, never an installation\'s database');
  }
  return dsn;
}

/** The migrations the manifest declares, in order. */
function declaredMigrations() {
  const yaml = require(path.join(TOOLCHAIN, 'js-yaml'));
  const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
  return manifest.migrations;
}

/**
 * A fresh database with every declared migration applied twice (each must be idempotent), dropped when the test ends.
 * @param {object} t The node:test context.
 * @returns {Promise<object>} A pg Pool on the new database.
 */
async function database(t) {
  const { Pool, Client } = require(path.join(TOOLCHAIN, 'pg'));
  const dsn = testServer();
  const name = 'finance_ledger_' + crypto.randomBytes(6).toString('hex');
  const admin = new Client({ connectionString: dsn });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(dsn); url.pathname = '/' + name;
  const pool = new Pool({ connectionString: url.toString(), max: 4 });
  t.after(async () => {
    await pool.end();
    // pool.end() answers before the server has closed each connection. Dropping the database at once ends those
    // connections by force, and the notice arrives as an error in whichever test runs next (seen twice in four full
    // runs). Wait until the server shows none left; the forced drop is only the last resort after two seconds.
    for (let tries = 0; tries < 100; tries++) {
      const open = (await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1', [name])).rows[0].n;
      if (!open) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });
  for (const migration of declaredMigrations()) {
    const sql = fs.readFileSync(path.join(PKG, migration), 'utf8');
    await pool.query(sql);
    await pool.query(sql);
  }
  return pool;
}

/** A Router double that records each handler by "METHOD /path". */
function recordingRouter(handlers) {
  const record = (method) => (route, ...chain) => { handlers[`${method} ${route}`] = chain[chain.length - 1]; };
  return { get: record('GET'), post: record('POST'), delete: record('DELETE') };
}

/** Require a compiled route module with the named requests answered by doubles, for it and the modules it loads. */
function requireWith(file, doubles) {
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && String(parent.filename || '').startsWith(ROUTES) && Object.prototype.hasOwnProperty.call(doubles, request)) return doubles[request];
    if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
    return original.call(this, request, parent, isMain);
  };
  try {
    for (const key of Object.keys(require.cache)) if (key.startsWith(ROUTES)) delete require.cache[key];
    return require(file);
  } finally { Module._load = original; }
}

const quietLogger = { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) };

/**
 * The compiled ledger router over a pool. Only the framework's own modules are doubled.
 * @param {object} pool A pg Pool.
 * @param {object} [options] artifacts: ref to { name, type, text | buffer } the relay double answers for the caller that owns it.
 * @returns {object} Handlers by "METHOD /path".
 */
function ledgerRoutes(pool, options = {}) {
  const handlers = {};
  const artifacts = options.artifacts || {};
  const relay = {
    redeemArtifactViaRelay: async ({ callerSub, ref }) => {
      const held = artifacts[ref];
      if (!held || held.owner !== callerSub) return { ok: false, status: 404, error: 'artifact handle not found or expired' };
      return { ok: true, name: held.name, type: held.type, buffer: held.buffer || Buffer.from(held.text, 'utf8') };
    },
  };
  const doubles = { express: { Router: () => recordingRouter(handlers) }, '@/shared/logger': quietLogger, '@/shared/artifact-exchange': relay };
  requireWith(path.join(ROUTES, 'finance-ledger.js'), doubles).createFinanceLedgerRoutes({ pool, appPackageDir: PKG });
  return handlers;
}

/**
 * The compiled Finance routes (sync, demo data, summary) over a pool, with the Plaid module doubled by a recorded bank.
 * @param {object} pool A pg Pool.
 * @param {object} [plaid] Overrides for the Plaid module double.
 * @returns {object} Handlers by "METHOD /path".
 */
function financeRoutes(pool, plaid = {}) {
  const handlers = {};
  const doubles = {
    express: { Router: () => recordingRouter(handlers) },
    '@/shared/logger': quietLogger,
    '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => null },
    '@/features/payments': { getPaymentAdapter: () => null },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({}) },
    '@/app/routes/free-tier-rotation': { resolveUserLlmConnection: async () => null },
    '@/shared/security/explicit-write-confirmation': { confirmationRequiredPayload: () => ({}), hasExplicitWriteConfirmation: () => false },
    './finance-plaid': { plaidConfigured: () => true, plaidEnv: () => 'sandbox', removeItem: async () => ({ providerDisconnected: true }),
      fetchFinanceAggregate: async () => ({ notes: [] }), plaidRequest: async () => ({ accounts: [], transactions: [] }), ...plaid },
    './session-crypto': { encryptSessionValue: (v) => v, decryptSessionValue: (v) => v },
  };
  requireWith(path.join(ROUTES, 'finance-routes.js'), doubles).createFinanceRoutes({ pool, appPackageDir: PKG });
  return handlers;
}

/**
 * Call one handler as a signed-in person (or nobody) and capture its answer.
 * @param {Function} handler The route handler.
 * @param {string|null} sub The caller.
 * @param {object} [request] body, query, params.
 * @returns {Promise<{statusCode:number, body:any}>} The answer.
 */
async function call(handler, sub, request = {}) {
  assert.equal(typeof handler, 'function', 'the route is registered');
  const res = { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ oidc: sub ? { user: { sub } } : undefined, params: request.params || {}, query: request.query || {}, body: request.body || {}, headers: {}, socket: {} }, res);
  return res;
}

/** A synthetic statement file's text. */
function statement(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

/** A date some days before today, as YYYY-MM-DD. */
function day(back) {
  return new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
}

/**
 * A synthetic CSV statement dated relative to today, so a suite about the 90-day snapshot never ages out.
 * @param {Array<[number, string, string]>} lines [days back, description, signed amount].
 * @param {string} [balance] The balance printed beside the first (newest) line.
 * @returns {string} The CSV text.
 */
function recentCsv(lines, balance) {
  const head = balance ? 'Date,Description,Amount,Balance' : 'Date,Description,Amount';
  return [head, ...lines.map(([back, description, amount], index) => `${day(back)},${description},${amount}${balance ? ',' + (index === 0 ? balance : '') : ''}`)].join('\n') + '\n';
}

/** Preview a statement and apply it, as one person; returns both answers. */
async function importStatement(routes, sub, body) {
  const preview = await call(routes['POST /imports/preview'], sub, { body });
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
  const applied = await call(routes['POST /imports/:id/apply'], sub, { params: { id: preview.body.importId }, body: { confirm: true } });
  assert.equal(applied.statusCode, 200, JSON.stringify(applied.body));
  return { preview: preview.body, applied: applied.body };
}

const MONEY_KEYS = new Set(['amount', 'balance', 'closingBalance', 'assets', 'liabilities', 'net', 'amountDue', 'figure']);

/**
 * Every amount an answer carries is a figure with its source, the kind of source and a real date; no bare cents ride beside it.
 * @param {any} value An answer (walked to every depth).
 * @param {string} [where] The path walked so far.
 * @returns {number} How many figures were checked.
 */
function assertFigures(value, where = 'answer') {
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value)) return value.reduce((sum, item, index) => sum + assertFigures(item, `${where}[${index}]`), 0);
  let checked = 0;
  if (Object.prototype.hasOwnProperty.call(value, 'cents')) {
    assert.ok(Number.isSafeInteger(value.cents), `${where}.cents is whole cents`);
    assert.ok(typeof value.source === 'string' && value.source.trim(), `${where} says where it came from`);
    assert.ok(typeof value.sourceKind === 'string' && value.sourceKind, `${where} names its kind of source`);
    assert.match(String(value.asOf), /^\d{4}-\d{2}-\d{2}$/, `${where} carries its date`);
    assert.ok(typeof value.currency === 'string' && value.currency.length === 3, `${where} names its currency`);
    checked += 1;
  }
  for (const [key, inner] of Object.entries(value)) {
    if (key === 'columnMap') continue; // column numbers, not money
    if (/cents/i.test(key) && key !== 'cents') assert.fail(`${where}.${key} is a bare amount; an answer carries figures`);
    if (MONEY_KEYS.has(key)) assert.ok(inner === null || (typeof inner === 'object' && 'cents' in inner), `${where}.${key} is a figure or null, never a bare number`);
    checked += assertFigures(inner, `${where}.${key}`);
  }
  return checked;
}

module.exports = { PKG, ROUTES, FIXTURES, TOOLCHAIN, database, ledgerRoutes, financeRoutes, requireWith, call, statement, assertFigures, declaredMigrations, day, recentCsv, importStatement };
