/**
 * Payroll route-guard suite — runs against the COMPILED routes/payroll-routes.js
 * (the same bytes the framework mounts) with the framework seams stubbed at the
 * require layer. Dependency-free plain node:test.
 *
 * The guards that matter, asserted as CALLS (never substrings of source):
 * neither money action (approve, void) touches the database without confirm;
 * a paid run is immutable and can only be corrected by a linked void; a void
 * cannot be voided; every handler 401s before querying; EVERY payroll query
 * carries a user_sub predicate; and the surface's inline scripts parse.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 23:45:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — no-confirm 428 zero-query proof, paid-run immutability, 401 gate, company auto-create, vm.Script parse guard.
 * 2026-08-01 12:00:00 | maintainer@emeraldcoastsystemsgroup.com | v1.1 — void-run gates (no confirm → 428 untouched; a draft cannot be voided; a void cannot be voided; a duplicate void surfaces 409 not 500), the approval audit trail is recorded, run-creation date validation, and a BLANKET tenant-isolation sweep that fails if any payroll query anywhere reaches the database without a user_sub predicate.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const here = path.dirname(fileURLToPath(import.meta.url));

/* ── require-layer stubs for the framework seams ─────────────────────────── */
function fakeRouter() {
  const routes = new Map();
  const reg = (m) => (p, h) => { routes.set(`${m} ${p}`, h); };
  return { routes, get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete') };
}
const STUBS = {
  express: { Router: () => fakeRouter() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  // Faithful copy of the core contract: confirm must be literally true.
  // The vault crypto is a declared kernel skill (memory -> @/features/personal-data).
  // Stubbed reversibly so the guards can assert that a full SSN never leaves by
  // any route except the audited one.
  '@/features/personal-data': {
    isEncrypted: (v) => typeof v === 'string' && v.startsWith('enc:'),
    encryptField: (_sub, v) => (v === null || v === undefined ? null : `enc:${v}`),
    decryptField: (_sub, v) => (typeof v === 'string' && v.startsWith('enc:') ? v.slice(4) : v),
  },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (b) => !!b && typeof b === 'object' && b.confirm === true,
    confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm: true. No write was attempted.` }),
  },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return origLoad.call(this, request, ...rest);
};
const { createPayrollRoutes } = require('../routes/payroll-routes.js');
const { VOID_NEGATED_COLUMNS } = require('../routes/payroll-store.js');

/* ── tiny harness ────────────────────────────────────────────────────────── */
function makePool(impl) {
  const pool = { calls: [] };
  pool.query = async (sql, params) => {
    pool.calls.push({ sql: String(sql), params });
    return impl ? impl(String(sql), params, pool.calls.length) : { rows: [], rowCount: 0 };
  };
  return pool;
}
function makeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (n) => { r.statusCode = n; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.send = () => r; r.sendFile = () => r;
  return r;
}
const AUTHED = { oidc: { user: { sub: 'user-1' } } };
function router(pool) {
  return createPayrollRoutes({ pool, appPackageDir: path.join(here, '..') });
}
async function call(pool, method, route, req) {
  const h = router(pool).routes.get(`${method} ${route}`);
  assert.ok(h, `route ${method} ${route} must be registered`);
  const res = makeRes();
  await h({ body: {}, params: {}, query: {}, ...req }, res);
  return res;
}
// Match the STATEMENT verb, not the word anywhere — `SELECT … FOR UPDATE` is a
// read, and counting it as a write made this helper lie.
const mutating = (pool) => pool.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.sql));

/* ── money-action gates ──────────────────────────────────────────────────── */

test('approve without confirm → 428 and the pool is NEVER touched', async () => {
  const pool = makePool();
  const res = await call(pool, 'post', '/runs/:id/approve', { ...AUTHED, params: { id: 'r1' }, body: {} });
  assert.equal(res.statusCode, 428);
  assert.equal(res.body.error, 'confirmation_required');
  assert.equal(pool.calls.length, 0, 'not even the schema bootstrap may write before the gate');
});

test('VOID without confirm → 428 and the pool is NEVER touched', async () => {
  const pool = makePool();
  const res = await call(pool, 'post', '/runs/:id/void', { ...AUTHED, params: { id: 'r1' }, body: {} });
  assert.equal(res.statusCode, 428);
  assert.equal(res.body.guard, 'no-void');
  assert.equal(pool.calls.length, 0);
});

test('confirm must be literally true on EVERY money route — enumerated, not named', async () => {
  // Enumerated from the router so a future confirm-gated route is covered the
  // day it is added, instead of the day someone remembers to extend this list.
  const gated = [...router(makePool()).routes.keys()].filter((k) => /\/(approve|void)$/.test(k));
  assert.ok(gated.length >= 2, `expected approve and void to be gated, saw ${gated.join(', ')}`);
  for (const key of gated) {
    const [method, route] = key.split(' ');
    for (const body of [{}, { confirm: 'true' }, { confirm: 1 }, { confirm: [true] }, { confirm: { ok: true } }]) {
      const pool = makePool();
      const res = await call(pool, method, route, { ...AUTHED, params: { id: 'r1' }, body });
      assert.equal(res.statusCode, 428, `${key} with confirm=${JSON.stringify(body.confirm)} must not pass`);
      assert.equal(pool.calls.length, 0, `${key} must not touch the database before the gate`);
    }
  }
});

test('approve on a non-draft writes NOTHING at all', async () => {
  const pool = makePool(() => ({ rows: [], rowCount: 0 }));
  const res = await call(pool, 'post', '/runs/:id/approve', { ...AUTHED, params: { id: 'r1' }, body: { confirm: true } });
  assert.equal(res.statusCode, 409, 'nothing matched the draft predicate');
  assert.equal(mutating(pool).length, 0, 'no UPDATE may be attempted when no draft was locked');
});

test('approve locks the draft, RECOMPUTES every line, then records who approved it', async () => {
  const seen = [];
  const pool = makePool((sql) => {
    seen.push(sql.replace(/\s+/g, ' ').trim());
    if (/SELECT \* FROM payroll_runs .* FOR UPDATE/s.test(sql)) {
      return { rows: [{ run_id: 'r1', status: 'draft', kind: 'regular', pay_date: '2026-07-24', pay_frequency: 'biweekly' }], rowCount: 1 };
    }
    if (/FROM payroll_run_lines WHERE run_id/.test(sql)) {
      return { rows: [{ run_id: 'r1', employee_id: 'e1', hours: 80, net_cents: 100 }], rowCount: 1 };
    }
    if (/FROM payroll_employees WHERE employee_id/.test(sql)) {
      return { rows: [{ employee_id: 'e1', user_sub: 'user-1', comp_type: 'hourly', hourly_rate_cents: 2000, filing_status: 'single' }], rowCount: 1 };
    }
    if (/payroll_company/.test(sql)) return { rows: [{ user_sub: 'user-1', pay_frequency: 'biweekly' }], rowCount: 1 };
    if (/net_cents < 0/.test(sql)) return { rows: [], rowCount: 0 };
    if (/UPDATE payroll_runs SET status = 'paid'/.test(sql)) {
      return { rows: [{ run_id: 'r1', status: 'paid', approved_by: 'user-1' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const res = await call(pool, 'post', '/runs/:id/approve', { ...AUTHED, params: { id: 'r1' }, body: { confirm: true } });
  assert.equal(res.statusCode, 200);

  const lockAt = seen.findIndex((s) => /FOR UPDATE/.test(s));
  const recomputeAt = seen.findIndex((s) => /INSERT INTO payroll_run_lines/.test(s));
  const flipAt = seen.findIndex((s) => /UPDATE payroll_runs SET status = 'paid'/.test(s));
  assert.ok(lockAt >= 0, 'the draft must be locked FOR UPDATE');
  assert.ok(recomputeAt > lockAt, 'lines must be recomputed after the lock');
  assert.ok(flipAt > recomputeAt,
    'the status flip must come AFTER the recompute — otherwise two parallel drafts each consume the same wage-base room');

  const flip = pool.calls.find((c) => /UPDATE payroll_runs SET status = 'paid'/.test(c.sql));
  assert.match(flip.sql, /AND status = 'draft'/);
  assert.deepEqual(flip.params, ['r1', 'user-1', 'user-1'], 'approver recorded on the audit trail');
});

test('approve REFUSES a run containing an unpayable check unless overridden', async () => {
  const mock = (sql) => {
    if (/SELECT \* FROM payroll_runs .* FOR UPDATE/s.test(sql)) {
      return { rows: [{ run_id: 'r1', status: 'draft', kind: 'regular', pay_date: '2026-07-24', pay_frequency: 'biweekly' }], rowCount: 1 };
    }
    if (/payroll_company/.test(sql)) return { rows: [{ user_sub: 'user-1', pay_frequency: 'biweekly' }], rowCount: 1 };
    if (/net_cents < 0/.test(sql)) return { rows: [{ employee_id: 'e1', first_name: 'Dana', last_name: 'Reed', net_cents: -1200 }], rowCount: 1 };
    if (/UPDATE payroll_runs SET status = 'paid'/.test(sql)) return { rows: [{ run_id: 'r1' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const blocked = makePool(mock);
  const res = await call(blocked, 'post', '/runs/:id/approve', { ...AUTHED, params: { id: 'r1' }, body: { confirm: true } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'negative_net_pay');
  assert.equal(res.body.employees[0].last_name, 'Reed');
  assert.ok(!blocked.calls.some((c) => /UPDATE payroll_runs SET status = 'paid'/.test(c.sql)),
    'the run must not be marked paid when a check is unpayable');

  const forced = makePool(mock);
  const ok = await call(forced, 'post', '/runs/:id/approve', {
    ...AUTHED, params: { id: 'r1' }, body: { confirm: true, acceptNegativeNet: true } });
  assert.equal(ok.statusCode, 200, 'an explicit override records it anyway');
});

test('a void may not wander into another tax year', async () => {
  const pool = makePool((sql) => /SELECT \* FROM payroll_runs/.test(sql)
    ? { rows: [{ run_id: 'r1', status: 'paid', kind: 'regular', pay_date: '2026-03-15', period_end: '2026-03-14', period_start: '2026-03-01', pay_frequency: 'biweekly' }], rowCount: 1 }
    : { rows: [], rowCount: 0 });
  const res = await call(pool, 'post', '/runs/:id/void', {
    ...AUTHED, params: { id: 'r1' }, body: { confirm: true, payDate: '2027-01-05' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad_void_pay_date');
  assert.equal(mutating(pool).length, 0);
});

/* ── the correction mechanism ────────────────────────────────────────────── */

test('a DRAFT cannot be voided — discard it instead', async () => {
  const pool = makePool((sql) => /SELECT \* FROM payroll_runs/.test(sql)
    ? { rows: [{ run_id: 'r1', status: 'draft', kind: 'regular' }], rowCount: 1 }
    : { rows: [], rowCount: 0 });
  const res = await call(pool, 'post', '/runs/:id/void', { ...AUTHED, params: { id: 'r1' }, body: { confirm: true } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'run_not_paid');
  assert.equal(mutating(pool).length, 0);
});

test('a VOID run cannot itself be voided (no infinite correction chains)', async () => {
  const pool = makePool((sql) => /SELECT \* FROM payroll_runs/.test(sql)
    ? { rows: [{ run_id: 'v1', status: 'paid', kind: 'void' }], rowCount: 1 }
    : { rows: [], rowCount: 0 });
  const res = await call(pool, 'post', '/runs/:id/void', { ...AUTHED, params: { id: 'v1' }, body: { confirm: true } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'cannot_void_a_void');
  assert.equal(mutating(pool).length, 0);
});

test('a duplicate void surfaces 409, not a 500 — the unique index is caught', async () => {
  const pool = makePool((sql) => {
    if (/SELECT \* FROM payroll_runs/.test(sql)) return { rows: [{ run_id: 'r1', status: 'paid', kind: 'regular', pay_date: '2026-07-24', period_end: '2026-07-14', period_start: '2026-07-01', pay_frequency: 'biweekly' }], rowCount: 1 };
    if (/INSERT INTO payroll_runs/.test(sql)) throw new Error('duplicate key value violates unique constraint "payroll_runs_one_void_per_run"');
    return { rows: [], rowCount: 0 };
  });
  const res = await call(pool, 'post', '/runs/:id/void', { ...AUTHED, params: { id: 'r1' }, body: { confirm: true } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'already_voided');
});

test('the void NEGATES every signed money column of the run it reverses', async () => {
  const captured = [];
  const pool = makePool((sql) => {
    captured.push(sql);
    if (/SELECT \* FROM payroll_runs/.test(sql)) return { rows: [{ run_id: 'r1', status: 'paid', kind: 'regular', pay_date: '2026-07-24', period_start: '2026-07-01', period_end: '2026-07-14', pay_frequency: 'biweekly' }], rowCount: 1 };
    if (/INSERT INTO payroll_runs/.test(sql)) return { rows: [{ run_id: 'v-new', kind: 'void' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const res = await call(pool, 'post', '/runs/:id/void', { ...AUTHED, params: { id: 'r1' }, body: { confirm: true } });
  assert.equal(res.statusCode, 200);
  const copy = captured.find((s) => /INSERT INTO payroll_run_lines/.test(s) && /SELECT/.test(s));
  assert.ok(copy, 'the void must copy the original lines');
  // Asserted against the module's OWN exported list, not a hand-typed copy: add a
  // money column to the schema without adding it here and this goes red, instead
  // of silently under-reversing every future correction.
  const expected = [...VOID_NEGATED_COLUMNS].sort();
  const negated = [...copy.matchAll(/-([a-z0-9_]+)\b/g)].map((m) => m[1]);
  const got = [...new Set(negated)].sort();
  assert.deepEqual(got.filter((c) => c !== 'hours' && c !== 'ot_hours'), expected,
    'the negated column set must equal VOID_NEGATED_COLUMNS exactly');
});

/* ── immutability + auth + isolation ─────────────────────────────────────── */

test('a PAID run is immutable: line edit → 409 with no mutating SQL', async () => {
  const pool = makePool((sql) => /SELECT \* FROM payroll_runs/.test(sql)
    ? { rows: [{ run_id: 'r1', status: 'paid', pay_frequency: 'biweekly', pay_date: '2026-07-24' }], rowCount: 1 }
    : { rows: [], rowCount: 0 });
  const res = await call(pool, 'put', '/runs/:id/lines/:employeeId', {
    ...AUTHED, params: { id: 'r1', employeeId: 'e1' }, body: { hours: 80 } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'run_not_draft');
  assert.equal(mutating(pool).length, 0);
});

test('a PAID run cannot be deleted: 409 with no DELETE issued', async () => {
  const pool = makePool((sql) => /SELECT \* FROM payroll_runs/.test(sql)
    ? { rows: [{ run_id: 'r1', status: 'paid', kind: 'regular' }], rowCount: 1 }
    : { rows: [], rowCount: 0 });
  const res = await call(pool, 'delete', '/runs/:id', { ...AUTHED, params: { id: 'r1' } });
  assert.equal(res.statusCode, 409);
  assert.equal(mutating(pool).length, 0);
});

test('no OIDC sub → 401 before any query, on every route', async () => {
  const all = [...router(makePool()).routes.keys()].filter((k) => !/ \/$|\/ui$/.test(k));
  assert.ok(all.length >= 12, `expected the full route surface, saw ${all.length}`);
  for (const key of all) {
    const [method, route] = key.split(' ');
    const pool = makePool();
    const res = await call(pool, method, route, { oidc: {}, body: { confirm: true }, params: { id: 'r1', employeeId: 'e1' } });
    assert.equal(res.statusCode, 401, `${key} must 401`);
    assert.equal(pool.calls.length, 0, `${key} must not query`);
  }
});

test('TENANT ISOLATION: every payroll query BINDS user_sub to the caller', async () => {
  const all = [...router(makePool()).routes.keys()].filter((k) => !/ \/$|\/ui$/.test(k));
  const offenders = [];
  for (const key of all) {
    const [method, route] = key.split(' ');
    const pool = makePool((sql) => {
      if (/SELECT \* FROM payroll_runs/.test(sql)) return { rows: [{ run_id: 'r1', status: 'draft', kind: 'regular', pay_date: '2026-07-24', pay_frequency: 'biweekly' }], rowCount: 1 };
      if (/FROM payroll_employees/.test(sql)) return { rows: [{ employee_id: 'e1', user_sub: 'user-1', comp_type: 'hourly', filing_status: 'single' }], rowCount: 1 };
      if (/payroll_company/.test(sql)) return { rows: [{ user_sub: 'user-1', pay_frequency: 'biweekly' }], rowCount: 1 };
      return { rows: [{}], rowCount: 1 };
    });
    await call(pool, method, route, {
      ...AUTHED, params: { id: 'r1', employeeId: 'e1', runId: 'r1' },
      body: { confirm: true, hours: 8 }, query: {},
    });
    for (const c of pool.calls) {
      const sql = c.sql;
      // EVERY payroll table, not a named subset. The earlier list covered four
      // of twelve, so payments, bank accounts, elections, earning/deduction
      // rows, the audit trail, imported ACH events and filings were all
      // unchecked — a new table joined the app and the guard silently ignored it.
      if (!/\bpayroll_\w+/.test(sql)) continue;
      if (/^\s*(CREATE|ALTER|DROP|BEGIN|COMMIT|ROLLBACK)/i.test(sql)) continue;
      const short = `${key} :: ${sql.replace(/\s+/g, ' ').slice(0, 110)}`;
      // A plain INSERT scopes by the VALUE it writes, not by a predicate.
      if (/^\s*INSERT\s+INTO/i.test(sql) && !/\bWHERE\b/i.test(sql)) {
        if (!/\buser_sub\b/.test(sql)) offenders.push(`INSERT WITHOUT user_sub — ${short}`);
        else if (!(c.params || []).includes('user-1')) offenders.push(`INSERT NOT BOUND TO CALLER — ${short}`);
        continue;
      }
      // Presence of the token proves nothing — `SELECT *, user_sub FROM …` with no
      // WHERE would pass a substring test while returning every tenant's rows. The
      // predicate must exist AND its placeholder must resolve to the caller's sub.
      const pred = /\buser_sub\s*=\s*\$(\d+)/.exec(sql);
      if (!pred) { offenders.push(`NO PREDICATE — ${short}`); continue; }
      const bound = (c.params || [])[Number(pred[1]) - 1];
      if (bound !== 'user-1') offenders.push(`PREDICATE NOT BOUND TO CALLER (got ${JSON.stringify(bound)}) — ${short}`);
      // A JOIN that forgets to re-scope the joined table leaks through the join.
      for (const j of sql.matchAll(/JOIN\s+(payroll_\w+)\s+(\w+)/g)) {
        const alias = j[2];
        if (!new RegExp(`${alias}\\.user_sub\\s*=`).test(sql)) {
          offenders.push(`JOIN ${j[1]} ${alias} NOT re-scoped — ${short}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `queries missing tenant scoping:\n${offenders.join('\n')}`);
});

test('GET /company auto-creates the settings row for a new caller', async () => {
  const pool = makePool((sql) => /INSERT INTO payroll_company/.test(sql)
    ? { rows: [{ user_sub: 'user-1', company_name: 'My Company', pay_frequency: 'biweekly' }], rowCount: 1 }
    : { rows: [], rowCount: 0 });
  const res = await call(pool, 'get', '/company', { ...AUTHED });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.company.pay_frequency, 'biweekly');
  assert.equal(typeof res.body.taxYear, 'number');
});

test('run creation rejects an inverted period and a pay date before period end', async () => {
  const base = (sql) => /payroll_company/.test(sql)
    ? { rows: [{ user_sub: 'user-1', pay_frequency: 'biweekly', shift_pay_date: false }], rowCount: 1 }
    : { rows: [], rowCount: 0 };
  const bad = await call(makePool(base), 'post', '/runs', {
    ...AUTHED, body: { periodStart: '2026-07-14', periodEnd: '2026-07-01', payDate: '2026-07-20' } });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error, 'bad_period');
  const early = await call(makePool(base), 'post', '/runs', {
    ...AUTHED, body: { periodStart: '2026-07-01', periodEnd: '2026-07-14', payDate: '2026-07-02' } });
  assert.equal(early.statusCode, 400);
  assert.equal(early.body.error, 'bad_pay_date');
});

test('surface inline scripts parse (vm.Script — the world 1.0.1 lesson)', () => {
  const html = readFileSync(path.join(here, '..', 'tools', 'payroll.html'), 'utf8');
  const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim());
  assert.ok(blocks.length >= 2, 'expected the theme bootstrap and the app script');
  for (const [i, src] of blocks.entries()) {
    assert.doesNotThrow(() => new vm.Script(src), `inline script #${i + 1} must parse`);
  }
});
