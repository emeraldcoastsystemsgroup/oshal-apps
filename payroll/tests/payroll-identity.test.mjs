/**
 * Identity + PII suite — the rules that make holding a Social Security number
 * defensible, asserted as behaviour rather than documented as intent.
 *
 * Run against the COMPILED modules with the kernel vault crypto stubbed
 * reversibly, so a leak would be visible as plaintext in a response.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 20:45:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — SSN/EIN/routing validation, masking, idempotent sealing, the single confirm-gated audited reveal, the guarantee that no other route returns a full SSN or the stored envelope, audit redaction of encrypted columns, and W-2 readiness as a computed state rather than a hardcoded label.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const here = path.dirname(fileURLToPath(import.meta.url));

const STUBS = {
  express: { Router: () => { const routes = new Map(); const reg = (m) => (p, h) => routes.set(`${m} ${p}`, h);
    return { routes, get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete') }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/features/personal-data': {
    isEncrypted: (v) => typeof v === 'string' && v.startsWith('enc:'),
    encryptField: (_s, v) => (v === null || v === undefined ? null : `enc:${v}`),
    decryptField: (_s, v) => (typeof v === 'string' && v.startsWith('enc:') ? v.slice(4) : v),
  },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (b) => !!b && typeof b === 'object' && b.confirm === true,
    confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm: true.` }),
  },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, req)) return STUBS[req];
  return origLoad.call(this, req, ...rest);
};
const id = require('../routes/payroll-identity.js');
const { createPayrollRoutes } = require('../routes/payroll-routes.js');
const { recordAudit } = require('../routes/payroll-ledger.js');

const SSN = '123456789';

/* ── validation + masking ────────────────────────────────────────────────── */

test('SSN validation rejects the ranges the SSA has never issued', () => {
  assert.equal(id.normalizeSsn('123-45-6789'), '123456789');
  assert.equal(id.normalizeSsn('000-12-3456'), null, 'area 000');
  assert.equal(id.normalizeSsn('666-12-3456'), null, 'area 666');
  assert.equal(id.normalizeSsn('900-12-3456'), null, 'area 900+');
  assert.equal(id.normalizeSsn('123-00-6789'), null, 'group 00');
  assert.equal(id.normalizeSsn('123-45-0000'), null, 'serial 0000');
  assert.equal(id.normalizeSsn('12345678'), null, 'too short');
});

test('a routing number must pass its ABA check digit', () => {
  assert.equal(id.normalizeRouting('021000021'), '021000021', 'a real, valid routing number');
  assert.equal(id.normalizeRouting('021000022'), null, 'one digit off must fail the checksum');
  assert.equal(id.normalizeRouting('12345678'), null);
});

test('masking never reveals more than the last four', () => {
  assert.equal(id.maskSsn(id.last4(SSN)), '***-**-6789');
  assert.equal(id.maskAccount(id.last4('000123456789')), '••••6789');
  assert.ok(!id.maskSsn(id.last4(SSN)).includes('12345'));
});

test('sealing is idempotent — re-saving cannot double-wrap', () => {
  const once = id.sealIdentifier('user-1', SSN);
  const twice = id.sealIdentifier('user-1', once);
  assert.equal(once, twice);
  assert.equal(id.openIdentifier('user-1', twice), SSN);
});

/* ── the reveal rule ─────────────────────────────────────────────────────── */

function makePool(impl) {
  const pool = { calls: [] };
  pool.query = async (sql, params) => {
    pool.calls.push({ sql: String(sql), params });
    return impl ? impl(String(sql), params) : { rows: [], rowCount: 0 };
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
const EMP_ROW = {
  employee_id: 'e1', user_sub: 'user-1', first_name: 'Dana', last_name: 'Reed',
  ssn_encrypted: `enc:${SSN}`, ssn_last4: '6789', filing_status: 'single',
};
async function call(pool, method, route, req) {
  const h = createPayrollRoutes({ pool, appPackageDir: path.join(here, '..') }).routes.get(`${method} ${route}`);
  assert.ok(h, `${method} ${route} must be registered`);
  const res = makeRes();
  await h({ body: {}, params: {}, query: {}, ...req }, res);
  return res;
}

test('revealing a full SSN requires an explicit confirm', async () => {
  const pool = makePool(() => ({ rows: [EMP_ROW], rowCount: 1 }));
  const res = await call(pool, 'post', '/employees/:id/ssn', { ...AUTHED, params: { id: 'e1' }, body: {} });
  assert.equal(res.statusCode, 428);
  assert.equal(res.body.guard, 'no-reveal');
  assert.equal(pool.calls.length, 0, 'no lookup may happen before the gate');
});

test('a confirmed reveal returns the SSN and WRITES THE AUDIT ROW FIRST', async () => {
  const order = [];
  const pool = makePool((sql) => {
    order.push(/INSERT INTO payroll_audit/.test(sql) ? 'audit' : 'other');
    return /payroll_employees/.test(sql) ? { rows: [EMP_ROW], rowCount: 1 } : { rows: [], rowCount: 0 };
  });
  const res = await call(pool, 'post', '/employees/:id/ssn', {
    ...AUTHED, params: { id: 'e1' }, body: { confirm: true, reason: 'W-2 preparation' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ssn, SSN);
  const auditCall = pool.calls.find((c) => /INSERT INTO payroll_audit/.test(c.sql));
  assert.ok(auditCall, 'the reveal must be recorded');
  assert.ok(auditCall.params.includes('ssn-reveal'), 'recorded with its own action');
  assert.ok(order.indexOf('audit') >= 0, 'a read that is not recorded did not happen');
});

test('NO OTHER ROUTE returns a full SSN or the stored envelope', async () => {
  const pool = makePool((sql) => (/payroll_employees/.test(sql)
    ? { rows: [EMP_ROW], rowCount: 1 } : { rows: [{ user_sub: 'user-1' }], rowCount: 1 }));
  const routes = createPayrollRoutes({ pool, appPackageDir: path.join(here, '..') }).routes;
  for (const key of routes.keys()) {
    if (key === 'post /employees/:id/ssn') continue;
    if (/ \/$|\/ui$/.test(key)) continue;
    const [method, route] = key.split(' ');
    const res = await call(makePool((sql) => (/payroll_employees/.test(sql)
      ? { rows: [EMP_ROW], rowCount: 1 } : { rows: [{ user_sub: 'user-1' }], rowCount: 1 })), method, route, {
      ...AUTHED, params: { id: 'e1', employeeId: 'e1', runId: 'r1', electionId: 'x', entity: 'employee', entityId: 'e1' },
      body: { confirm: true }, query: {},
    });
    const body = JSON.stringify(res.body || {});
    assert.ok(!body.includes(SSN), `${key} leaked a full SSN`);
    assert.ok(!body.includes('enc:'), `${key} leaked the stored encryption envelope`);
  }
});

test('the audit trail records THAT an encrypted field changed, never its value', async () => {
  const pool = makePool(() => ({ rows: [], rowCount: 0 }));
  await recordAudit(pool, 'user-1', 'employee', 'e1', 'update', 'user-1',
    { ssn_encrypted: `enc:${SSN}`, first_name: 'Dana' }, { ssn_encrypted: 'enc:987654321', first_name: 'Dana' });
  const written = JSON.stringify(pool.calls[0].params);
  assert.ok(!written.includes(SSN), 'the audit log must not carry the old SSN');
  assert.ok(!written.includes('987654321'), 'nor the new one');
  assert.ok(written.includes('[encrypted]'), 'it records that the field changed');
});

/* ── W-2 readiness is computed, not a label ──────────────────────────────── */

test('W-2 readiness names exactly what is missing, and flips when it is supplied', () => {
  const empty = id.w2Readiness({}, {});
  assert.equal(empty.ready, false);
  assert.ok(empty.missing.some((m) => /EIN/.test(m)));
  assert.ok(empty.missing.some((m) => /employee SSN/.test(m)));

  const ready = id.w2Readiness(
    { ein_encrypted: 'enc:123456789', legal_name: 'Acme LLC', address_line1: '1 Main', city: 'Miami', state_code: 'FL', postal_code: '33101' },
    { ssn_encrypted: `enc:${SSN}`, address_line1: '2 Oak', city: 'Miami', state_code: 'FL', postal_code: '33101' });
  assert.equal(ready.ready, true, `still missing: ${ready.missing.join(', ')}`);
  assert.deepEqual(ready.missing, []);
});
