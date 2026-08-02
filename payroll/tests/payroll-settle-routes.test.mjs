/**
 * Settlement route-guard suite — against the COMPILED routes, framework seams
 * stubbed at the require layer, asserted as CALLS rather than as substrings.
 *
 * What these protect:
 *
 *  - The three irreversible actions (applying a notification of change,
 *    producing an EFW2 that decrypts every SSN, allocating check numbers that
 *    can never be reissued) refuse without an explicit confirmation AND prove
 *    the database was never touched.
 *  - Importing a return file is deliberately NOT confirm-gated. It records what
 *    the bank already did, and putting friction in front of writing down that
 *    someone was not paid would preserve the exact silence this feature exists
 *    to end. It is audited instead.
 *  - Generating an ACH file PERSISTS the trace numbers. Without that the return
 *    path has no key and every returned deposit is unmatchable — so the guard
 *    asserts the UPDATE actually issues, and that a prenote does not.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-02 05:10:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — 428 zero-query proofs for NOC apply / EFW2 / check allocation, the deliberate absence of a gate on return import, trace persistence on ACH generation (and its absence on a prenote), return-vs-NOC payment transitions, NOC application refusing a non-applicable code and a bad check digit, and 401 before any query on every settlement route.
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
  express: { Router: () => fakeRouter() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
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
function fakeRouter() {
  const routes = new Map();
  const reg = (m) => (p, h) => { routes.set(`${m} ${p}`, h); };
  return { routes, get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete') };
}
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return origLoad.call(this, request, ...rest);
};
const { createPayrollRoutes } = require('../routes/payroll-routes.js');

/* ── harness ─────────────────────────────────────────────────────────────── */
function makePool(impl) {
  const pool = { calls: [] };
  pool.query = async (sql, params) => {
    pool.calls.push({ sql: String(sql), params });
    return impl ? impl(String(sql), params, pool.calls.length) : { rows: [], rowCount: 0 };
  };
  return pool;
}
function makeRes() {
  const r = { statusCode: 200, body: null, headers: {}, sent: null };
  r.status = (n) => { r.statusCode = n; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.type = () => r;
  r.set = (k, v) => { r.headers[k] = v; return r; };
  r.send = (v) => { r.sent = v; return r; };
  r.sendFile = () => r;
  return r;
}
const AUTHED = { oidc: { user: { sub: 'user-1' } } };
/**
 * A REAL employee id. Employee ids are UUIDs, and an earlier version of the
 * trace-persist path bound the 15-character NACHA Individual Identification
 * field as the database key — so `WHERE employee_id = $4` never matched and
 * ach_trace was never written, leaving every return unmatchable. A two-character
 * fixture id hid that completely. Use a full UUID here, always.
 */
const EMP_UUID = '9c74f5de-fb2f-4b89-a917-7a15c9e9af13';
const router = (pool) => createPayrollRoutes({ pool, appPackageDir: path.join(here, '..') });
async function call(pool, method, route, req) {
  const h = router(pool).routes.get(`${method} ${route}`);
  assert.ok(h, `route ${method} ${route} must be registered`);
  const res = makeRes();
  await h({ body: {}, params: {}, query: {}, ...req }, res);
  return res;
}
const mutating = (pool) => pool.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.sql));

/** A 94-character NACHA record built by width, never copied from a sample. */
function record(...parts) {
  const out = parts.map(([v, w]) => String(v).slice(0, w).padEnd(w, ' ')).join('');
  assert.equal(out.length, 94);
  return out;
}
const num = (v, w) => String(v).replace(/\D/g, '').slice(-w).padStart(w, '0');
const detail = (trace, amountCents = 125_000) => record(
  ['6', 1], ['22', 2], ['02100002', 8], ['1', 1], ['1234567890', 17],
  [num(amountCents, 10), 10], ['EMP-1', 15], ['REED DANA', 22], ['', 2], ['0', 1], [trace, 15],
);
const returnAddenda = (code, trace) => record(
  ['7', 1], ['99', 2], [code, 3], [trace, 15], ['', 6], ['02100002', 8], ['', 44], ['021000210000066', 15],
);
const nocAddenda = (code, trace, corrected) => record(
  ['7', 1], ['98', 2], [code, 3], [trace, 15], ['', 6], ['02100002', 8],
  [corrected, 29], ['', 15], ['021000210000088', 15],
);

/* ── the confirm gates ───────────────────────────────────────────────────── */

test('every irreversible settlement action refuses without confirm, with the pool UNTOUCHED', async () => {
  const cases = [
    ['post', '/returns/:eventId/apply', { params: { eventId: 'ev1' } }, 'no-noc-apply'],
    ['post', '/forms/efw2', { body: { year: 2025 } }, 'no-efw2'],
    ['post', '/runs/:id/checks', { params: { id: 'r1' } }, 'no-checks'],
  ];
  for (const [method, route, extra, guard] of cases) {
    const pool = makePool();
    const res = await call(pool, method, route, { ...AUTHED, params: {}, body: {}, ...extra });
    assert.equal(res.statusCode, 428, `${method} ${route} must refuse without confirm`);
    assert.equal(res.body.error, 'confirmation_required');
    assert.equal(res.body.guard, guard);
    assert.deepEqual(mutating(pool), [], `${method} ${route} wrote to the database before confirming`);
  }
});

test('importing a return file is deliberately NOT confirm-gated — it records what the bank did', async () => {
  const pool = makePool(() => ({ rows: [], rowCount: 0 }));
  const res = await call(pool, 'post', '/returns/import', {
    ...AUTHED,
    body: { content: `${detail('021000210000001')}\n${returnAddenda('R01', '021000210000001')}\n` },
  });
  assert.notEqual(res.statusCode, 428, 'a confirmation gate here would keep people silently unpaid');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.returnCount, 1);
});

test('an empty or unparseable return file is refused rather than recorded as nothing wrong', async () => {
  const blank = await call(makePool(), 'post', '/returns/import', { ...AUTHED, body: { content: '   ' } });
  assert.equal(blank.statusCode, 400);

  const junk = await call(makePool(), 'post', '/returns/import', {
    ...AUTHED, body: { content: 'this is not a nacha file\n' },
  });
  assert.equal(junk.statusCode, 422);
  assert.match(junk.body.message, /No return or notification-of-change records/);
});

/* ── what an import does to a payment ────────────────────────────────────── */

test('a matched RETURN moves the payment to returned; a matched NOC does NOT', async () => {
  const forKind = (addenda) => {
    const pool = makePool((sql) => {
      if (/FROM payroll_payments\s+WHERE user_sub = \$1 AND ach_trace/.test(sql)) {
        return { rows: [{ payment_id: 'p1', employee_id: 'e1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    return { pool, run: call(pool, 'post', '/returns/import', { ...AUTHED, body: { content: addenda } }) };
  };

  const ret = forKind(`${detail('021000210000001')}\n${returnAddenda('R02', '021000210000001')}\n`);
  await ret.run;
  const retUpdate = ret.pool.calls.find((c) => /UPDATE payroll_payments\s+SET status/.test(c.sql));
  assert.ok(retUpdate, 'the payment status must actually be written');
  assert.equal(retUpdate.params[2], 'returned');
  assert.equal(retUpdate.params[0], 'p1');
  assert.equal(retUpdate.params[1], 'user-1', 'scoped to the caller');

  const noc = forKind(`${detail('021000210000001')}\n${nocAddenda('C01', '021000210000001', '9876543210')}\n`);
  const res = await noc.run;
  const nocUpdate = noc.pool.calls.find((c) => /UPDATE payroll_payments\s+SET status/.test(c.sql));
  assert.equal(nocUpdate.params[2], 'corrected', 'an NOC means the money ARRIVED');
  assert.equal(res.body.events[0].unpaid, false);
});

test('an unmatched return is reported, not silently dropped', async () => {
  const pool = makePool(() => ({ rows: [], rowCount: 0 }));
  const res = await call(pool, 'post', '/returns/import', {
    ...AUTHED, body: { content: `${detail('999999990000001')}\n${returnAddenda('R03', '999999990000001')}\n` },
  });
  assert.equal(res.body.unmatched, 1);
  assert.match(res.body.note, /could not be matched/);
  assert.equal(res.body.events[0].matched, false);
});

/* ── applying a notification of change ───────────────────────────────────── */

// The stored correction seals the banking details — the apply path opens them,
// so a fixture carrying plaintext would test a shape that no longer exists.
const seal = (v) => (v ? `enc:${v}` : null);
const nocEvent = (c, kind = 'noc', originalAccountLast4 = '') => ({
  event_id: 'ev1', user_sub: 'user-1', kind, code: 'C01', employee_id: EMP_UUID,
  detail: {
    correction: {
      changeCode: 'C01',
      title: 'Incorrect DFI Account Number',
      autoApplicable: c.autoApplicable,
      note: c.note || '',
      routingSealed: seal(c.routingNumber),
      routingLast4: c.routingNumber ? String(c.routingNumber).slice(-4) : '',
      accountSealed: seal(c.accountNumber),
      accountLast4: c.accountNumber ? String(c.accountNumber).slice(-4) : '',
    },
    originalAccountLast4,
  },
});

test('a change code that must be handled by hand is refused, not applied', async () => {
  const pool = makePool((sql) => {
    if (/FROM payroll_ach_events/.test(sql)) {
      return { rows: [nocEvent({ autoApplicable: false, note: 'C04 has not been available since 2015.' })], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const res = await call(pool, 'post', '/returns/:eventId/apply', {
    ...AUTHED, params: { eventId: 'ev1' }, body: { confirm: true },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'not_auto_applicable');
  assert.match(res.body.message, /2015/);
  assert.equal(pool.calls.filter((c) => /UPDATE payroll_bank_accounts/.test(c.sql)).length, 0);
});

test('a corrected routing number that fails its ABA check digit is refused', async () => {
  const pool = makePool((sql) => {
    if (/FROM payroll_ach_events/.test(sql)) {
      return { rows: [nocEvent({ autoApplicable: true, routingNumber: '021000029' })], rowCount: 1 };
    }
    if (/FROM payroll_bank_accounts/.test(sql)) {
      return { rows: [{ account_id: 'a1', routing_last4: '0021', account_last4: '7890' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const res = await call(pool, 'post', '/returns/:eventId/apply', {
    ...AUTHED, params: { eventId: 'ev1' }, body: { confirm: true },
  });
  assert.equal(res.statusCode, 422);
  assert.match(res.body.message, /fails its ABA check digit/);
  assert.equal(pool.calls.filter((c) => /UPDATE payroll_bank_accounts/.test(c.sql)).length, 0);
});

test('a valid correction rewrites the account and records it on the audit trail', async () => {
  const pool = makePool((sql) => {
    if (/FROM payroll_ach_events/.test(sql)) {
      return { rows: [nocEvent({ autoApplicable: true, routingNumber: '021000021', accountNumber: '55566677' })], rowCount: 1 };
    }
    if (/FROM payroll_bank_accounts/.test(sql)) {
      return { rows: [{ account_id: 'a1', routing_last4: '0021', account_last4: '7890' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const res = await call(pool, 'post', '/returns/:eventId/apply', {
    ...AUTHED, params: { eventId: 'ev1' }, body: { confirm: true },
  });
  assert.equal(res.statusCode, 200);
  const upd = pool.calls.find((c) => /UPDATE payroll_bank_accounts/.test(c.sql));
  assert.ok(upd, 'the account must actually be written');
  assert.equal(upd.params[1], 'user-1');
  // Written back SEALED, exactly as the identity routes do it.
  assert.equal(upd.params[2], 'enc:021000021', 'the routing number is re-sealed, not stored raw');
  assert.equal(upd.params[4], 'enc:55566677');
  assert.ok(pool.calls.some((c) => /INSERT INTO payroll_audit/i.test(c.sql)), 'the change must be audited');
  assert.ok(pool.calls.some((c) => /UPDATE payroll_ach_events SET applied = true/.test(c.sql)));
});

test('a correction NAMES the split it concerns — the wrong account is never rewritten', async () => {
  // Two active splits. The bank's entry named the SAVINGS account (…2222).
  const accounts = [
    { account_id: 'checking', split_order: 1, routing_last4: '0021', account_last4: '1111' },
    { account_id: 'savings', split_order: 2, routing_last4: '0021', account_last4: '2222' },
  ];
  const poolFor = (last4) => makePool((sql) => {
    if (/FROM payroll_ach_events/.test(sql)) {
      return { rows: [nocEvent({ autoApplicable: true, accountNumber: '999888777' }, 'noc', last4)], rowCount: 1 };
    }
    if (/FROM payroll_bank_accounts/.test(sql)) return { rows: accounts, rowCount: 2 };
    return { rows: [], rowCount: 0 };
  });

  const right = poolFor('2222');
  const ok = await call(right, 'post', '/returns/:eventId/apply', {
    ...AUTHED, params: { eventId: 'ev1' }, body: { confirm: true },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(right.calls.find((c) => /UPDATE payroll_bank_accounts/.test(c.sql)).params[0], 'savings',
    'the split the entry named — taking the first by split_order would silently redirect part of their pay');

  // If the named account is not on file, refuse rather than guess.
  const gone = poolFor('9999');
  const res = await call(gone, 'post', '/returns/:eventId/apply', {
    ...AUTHED, params: { eventId: 'ev1' }, body: { confirm: true },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'ambiguous_account');
  assert.equal(gone.calls.filter((c) => /UPDATE payroll_bank_accounts/.test(c.sql)).length, 0);
});

test('corrected bank details are SEALED at rest and MASKED in the response', async () => {
  const ROUTING = '021000021';
  const ACCOUNT = '987654321098765';
  const pool = makePool((sql) => (/FROM payroll_payments\s+WHERE user_sub = \$1 AND ach_trace/.test(sql)
    ? { rows: [{ payment_id: 'p1', employee_id: EMP_UUID }], rowCount: 1 }
    : { rows: [{ event_id: 'ev-new' }], rowCount: 1 }));

  // C03: routing at 1-9, THREE blanks, account at 13-29.
  const corrected = `${ROUTING}   ${ACCOUNT.padEnd(17, ' ')}`.slice(0, 29);
  const res = await call(pool, 'post', '/returns/import', {
    ...AUTHED,
    body: { content: `${detail('021000210000001')}\n${nocAddenda('C03', '021000210000001', corrected)}\n` },
  });
  assert.equal(res.statusCode, 200);

  // Asserted STRUCTURALLY, not by substring: this suite's crypto stub is
  // deliberately reversible (`enc:` + the value) so other guards can prove a
  // round trip, which means the sealed form still contains the plaintext as a
  // substring. What must hold is that the plaintext FIELDS are gone and only
  // the sealed ones remain.
  const insert = pool.calls.find((c) => /INSERT INTO payroll_ach_events/.test(c.sql));
  const stored = JSON.parse(insert.params[10]);
  const c = stored.correction;
  assert.equal(c.routingNumber, undefined, 'no cleartext routing field may be persisted');
  assert.equal(c.accountNumber, undefined, 'no cleartext account field may be persisted');
  assert.equal(c.routingSealed, `enc:${ROUTING}`, 'the routing number is sealed');
  assert.equal(c.accountSealed, `enc:${ACCOUNT}`, 'and so is the account number');
  assert.equal(c.routingLast4, '0021');
  assert.equal(c.accountLast4, '8765');

  // The response carries neither the plaintext nor the sealed form.
  const body = JSON.stringify(res.body);
  assert.equal(body.includes(ROUTING), false, 'the response must not echo the corrected routing number');
  assert.equal(body.includes(ACCOUNT), false, 'nor the corrected account number');
  assert.equal(body.includes('enc:'), false, 'nor the sealed form of either');
  assert.equal(res.body.events[0].correction.accountMasked, '••••8765', 'only a mask reaches the caller');
  assert.equal(res.body.events[0].correction.routingMasked, '••••0021');
});

test('re-importing the same file returns the EXISTING event id, not a phantom one', async () => {
  // The unique index on (user_sub, return_trace) makes the second INSERT a
  // no-op. Minting a fresh UUID and returning it would hand the operator an id
  // no row has, so the NOC could never be applied.
  let firstInsert = true;
  const pool = makePool((sql) => {
    if (/INSERT INTO payroll_ach_events/.test(sql)) {
      if (firstInsert) { firstInsert = false; return { rows: [{ event_id: 'ev-real' }], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };            // ON CONFLICT DO NOTHING
    }
    if (/SELECT event_id FROM payroll_ach_events/.test(sql)) {
      return { rows: [{ event_id: 'ev-real' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const file = `${detail('021000210000001')}\n${nocAddenda('C01', '021000210000001', '9876543210')}\n`;

  const first = await call(pool, 'post', '/returns/import', { ...AUTHED, body: { content: file } });
  assert.equal(first.body.events[0].eventId, 'ev-real');

  const second = await call(pool, 'post', '/returns/import', { ...AUTHED, body: { content: file } });
  assert.equal(second.body.events[0].eventId, 'ev-real',
    'the id on the re-import must be the row that exists, not a newly minted uuid');
  assert.ok(pool.calls.some((c) => /SELECT event_id FROM payroll_ach_events/.test(c.sql)),
    'the conflict path must look the existing row up');
});

/* ── the trace numbers the whole return path depends on ──────────────────── */

function achPool(traceStart = 1) {
  return makePool((sql) => {
    if (/SELECT \* FROM payroll_runs/.test(sql)) {
      return { rows: [{ run_id: 'r1', status: 'paid', pay_date: '2026-03-13', kind: 'regular', pay_frequency: 'biweekly' }], rowCount: 1 };
    }
    if (/UPDATE payroll_company\s+SET ach_next_trace/.test(sql)) {
      return { rows: [{ start: traceStart }], rowCount: 1 };
    }
    if (/payroll_company/.test(sql)) {
      return { rows: [{ user_sub: 'user-1', ach_odfi_routing: '021000021', ach_company_id: '1123456789', legal_name: 'ACME', ach_odfi_name: 'BANK' }], rowCount: 1 };
    }
    if (/FROM payroll_payments p/.test(sql)) {
      return {
        rows: [{ amount_cents: 125_000, first_name: 'DANA', last_name: 'REED', employee_id: EMP_UUID,
          routing_encrypted: 'enc:021000021', account_encrypted: 'enc:1234567890', account_type: 'checking' }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

test('generating an ACH file PERSISTS the trace against the FULL employee id, not a truncation', async () => {
  const pool = achPool();
  const res = await call(pool, 'post', '/runs/:id/ach', {
    ...AUTHED, params: { id: 'r1' }, body: { confirm: true },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const traceWrite = pool.calls.find((c) => /UPDATE payroll_payments SET ach_trace/.test(c.sql));
  assert.ok(traceWrite, 'the trace must be stored, or every returned deposit is orphaned');
  assert.equal(traceWrite.params[0], 'user-1');
  assert.equal(traceWrite.params[1], 'r1');
  assert.equal(String(traceWrite.params[2]).length, 15, 'a NACHA trace number is 15 characters');

  // THE REGRESSION: the file's Individual Identification field is 15 characters
  // wide, so the id written INTO the record is truncated. The database key must
  // not be. Binding the truncated value matched no row and silently left
  // ach_trace empty, which made every subsequent return unmatchable.
  assert.equal(traceWrite.params[3], EMP_UUID, 'the WHERE clause must bind the FULL uuid');
  assert.notEqual(traceWrite.params[3], EMP_UUID.slice(0, 15));
  assert.ok(EMP_UUID.length > 15, 'a fixture id shorter than 15 chars cannot catch this');

  // And the trace written is the one actually in the file.
  assert.ok(String(res.sent).includes(String(traceWrite.params[2])));
});

test('trace numbers CONTINUE across files — two runs must never mint the same trace', async () => {
  // The sequence is allocated from a per-company counter, so a second file
  // starts where the first stopped. Restarting at 1 would make one run's return
  // match another run's payment.
  const first = achPool(1);
  await call(first, 'post', '/runs/:id/ach', { ...AUTHED, params: { id: 'r1' }, body: { confirm: true } });
  const traceA = first.calls.find((c) => /UPDATE payroll_payments SET ach_trace/.test(c.sql)).params[2];

  const second = achPool(2);
  await call(second, 'post', '/runs/:id/ach', { ...AUTHED, params: { id: 'r2' }, body: { confirm: true } });
  const traceB = second.calls.find((c) => /UPDATE payroll_payments SET ach_trace/.test(c.sql)).params[2];

  assert.notEqual(traceA, traceB, 'a per-file sequence restarting at 1 collides across runs');
  assert.equal(traceA.slice(0, 8), traceB.slice(0, 8), 'same ODFI prefix');
  assert.equal(Number(traceB.slice(8)) - Number(traceA.slice(8)), 1, 'the sequence advanced');

  // The allocation is one atomic statement, like check numbers.
  const alloc = first.calls.find((c) => /UPDATE payroll_company\s+SET ach_next_trace/.test(c.sql));
  assert.ok(alloc, 'the sequence must be allocated from the company row');
  assert.deepEqual(alloc.params, ['user-1', 1]);
});

test('a PRENOTE moves no money, so it does not overwrite the traces of a real file', async () => {
  const pool = achPool();
  await call(pool, 'post', '/runs/:id/ach', {
    ...AUTHED, params: { id: 'r1' }, body: { confirm: true, prenote: true },
  });
  assert.equal(pool.calls.filter((c) => /UPDATE payroll_payments SET ach_trace/.test(c.sql)).length, 0);
});

/* ── auth ────────────────────────────────────────────────────────────────── */

test('no OIDC sub → 401 before any query, on every settlement route', async () => {
  const settlement = [...router(makePool()).routes.keys()].filter((k) => /returns|settlement|calendar|rt6|efw2|checks/.test(k));
  assert.ok(settlement.length >= 7, `expected the settlement routes to be registered, saw ${settlement.length}`);
  for (const key of settlement) {
    const [method, route] = key.split(' ');
    const pool = makePool();
    const res = await call(pool, method, route, {
      params: { id: 'r1', eventId: 'ev1' }, body: { confirm: true }, query: {},
    });
    assert.equal(res.statusCode, 401, `${key} must 401 without a caller`);
    assert.deepEqual(pool.calls, [], `${key} queried the database before authenticating`);
  }
});

/* ── the calendars, through the surface ──────────────────────────────────── */

test('the holidays route returns BOTH calendars and says why they differ', async () => {
  const res = await call(makePool(), 'get', '/calendar/holidays', { ...AUTHED, query: { year: 2026 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.federalReserve.length, 10, '2026 has ten Reserve Bank closures');
  assert.equal(res.body.irs.length, 12, 'and twelve IRS legal holidays');
  assert.equal(res.body.irsVerified, true);
  assert.match(res.body.note, /Federal Reserve calendar decides whether payroll funds/);
});

test('the pay-date route reports a shift and the resulting deposit due date', async () => {
  const pool = makePool((sql) => (/payroll_company/.test(sql)
    ? { rows: [{ user_sub: 'user-1', depositor_status: 'monthly' }], rowCount: 1 }
    : { rows: [], rowCount: 0 }));
  const res = await call(pool, 'get', '/calendar/pay-date', { ...AUTHED, query: { date: '2026-12-25' } });
  assert.equal(res.body.shifted, true);
  assert.equal(res.body.payDate, '2026-12-24');
  assert.match(res.body.reason, /Christmas Day/);
  assert.equal(res.body.deposit.dueDate, '2027-01-15');
});
