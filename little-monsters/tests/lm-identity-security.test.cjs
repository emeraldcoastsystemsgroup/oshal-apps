/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Guard issuer-bound OIDC linking, tenant bootstrap closure, migration 032, rollback visibility, and collision-resistant RAG names
 * -----------------------------------------------------------------------------
 *
 * Dependency-free node:test coverage over the compiled module the package loads.
 * The source lane does not hand-edit generated routes; run this after the normal
 * package build has compiled src-routes/education-access.ts.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const LOGS = [];
const logger = {
  info(...args) { LOGS.push(['info', ...args]); },
  warn(...args) { LOGS.push(['warn', ...args]); },
  error(...args) { LOGS.push(['error', ...args]); },
  debug(...args) { LOGS.push(['debug', ...args]); },
};

const originalLoad = Module._load;
Module._load = function loadWithLoggerStub(request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => logger };
  return originalLoad.call(this, request, ...rest);
};
let access;
try {
  access = require(path.join(PKG, 'routes', 'education-access.js'));
} finally {
  Module._load = originalLoad;
}

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ISSUER_A = 'https://idp-a.example/';
const ISSUER_B = 'https://idp-b.example/';

function result(rows) {
  return { rows, rowCount: rows.length };
}

function student(overrides = {}) {
  return {
    student_id: overrides.student_id || 'student-existing',
    name: overrides.name || 'Student',
    email: Object.hasOwn(overrides, 'email') ? overrides.email : 'student@school.example',
    external_issuer: Object.hasOwn(overrides, 'external_issuer') ? overrides.external_issuer : ISSUER_A,
    external_id: Object.hasOwn(overrides, 'external_id') ? overrides.external_id : 'subject-a',
    role: overrides.role || 'student',
    tenant_id: overrides.tenant_id || TENANT_A,
  };
}

function makeState(overrides = {}) {
  return {
    mappings: overrides.mappings || [],
    students: overrides.students || [],
    nextStudent: 1,
  };
}

function handleSelect(state, sql, params) {
  if (/external_issuer = \$1 AND external_id = \$2/i.test(sql)) {
    return result(state.students.filter((row) => (
      row.external_issuer === params[0] && row.external_id === params[1]
    )));
  }
  if (/SELECT tenant_id FROM lm_tenants WHERE lower\(domain\) = \$1 LIMIT 2/i.test(sql)) {
    return result(state.mappings.filter((row) => row.domain.toLowerCase() === params[0]));
  }
  if (/SELECT 1 FROM lm_tenants WHERE domain IS NOT NULL LIMIT 1/i.test(sql)) {
    return result(state.mappings.length > 0 ? [{ '?column?': 1 }] : []);
  }
  if (/lower\(email\) = \$1 AND tenant_id = \$2[\s\S]*LIMIT 2/i.test(sql)) {
    return result(state.students.filter((row) => (
      row.email?.toLowerCase() === params[0] && row.tenant_id === params[1]
    )).slice(0, 2));
  }
  return undefined;
}

function updatePlaceholder(state, params) {
  const row = state.students.find((candidate) => (
    candidate.student_id === params[2]
      && candidate.external_issuer === null
      && candidate.external_id === null
  ));
  if (!row) return result([]);
  row.external_issuer = params[0];
  row.external_id = params[1];
  return result([row]);
}

function updateLegacy(state, params) {
  const row = state.students.find((candidate) => (
    candidate.student_id === params[1]
      && candidate.external_id === params[2]
      && candidate.external_issuer === null
  ));
  if (!row) return result([]);
  row.external_issuer = params[0];
  return result([row]);
}

function insertStudent(state, params) {
  const row = student({
    student_id: `student-new-${state.nextStudent++}`,
    name: params[0], email: params[1], external_issuer: params[2],
    external_id: params[3], role: params[4], tenant_id: params[5],
  });
  state.students.push(row);
  return result([row]);
}

function handleMutation(state, sql, params) {
  if (/SET external_issuer = \$1, external_id = \$2/i.test(sql)) {
    return updatePlaceholder(state, params);
  }
  if (/SET external_issuer = \$1[\s\S]*external_id = \$3/i.test(sql)) {
    return updateLegacy(state, params);
  }
  if (/INSERT INTO lm_students \(name, email, external_issuer, external_id, role, tenant_id\)/i.test(sql)) {
    return insertStudent(state, params);
  }
  if (/UPDATE lm_students SET role = \$1 WHERE student_id = \$2/i.test(sql)) {
    const row = state.students.find((candidate) => candidate.student_id === params[1]);
    if (row) row.role = params[0];
    return result([]);
  }
  return undefined;
}

function makePool(state, options = {}) {
  const calls = [];
  const query = async (rawSql, params = []) => {
    const sql = String(rawSql).replace(/\s+/g, ' ').trim();
    calls.push({ sql, params });
    if (sql === 'ROLLBACK' && options.failRollback) throw new Error('rollback unavailable');
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return result([]);
    if (/pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/i.test(sql)) return result([]);
    const selected = handleSelect(state, sql, params);
    if (selected !== undefined) return selected;
    const mutated = handleMutation(state, sql, params);
    if (mutated !== undefined) return mutated;
    throw new Error(`unexpected identity SQL: ${sql}`);
  };
  return {
    calls,
    query,
    async connect() { return { query, release() {} }; },
  };
}

function oidcRequest({ issuer, sub, email = 'student@school.example', name = 'Student' }) {
  return {
    oidc: {
      isAuthenticated: () => true,
      user: { iss: issuer, sub, email, name },
    },
  };
}

function dataWrites(pool) {
  return pool.calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)\b/i.test(sql));
}

async function withMockOidc(value, action) {
  const previous = process.env.MOCK_OIDC;
  if (value === undefined) delete process.env.MOCK_OIDC;
  else process.env.MOCK_OIDC = value;
  try {
    return await action();
  } finally {
    if (previous === undefined) delete process.env.MOCK_OIDC;
    else process.env.MOCK_OIDC = previous;
  }
}

test('the same subject from a different issuer is a different account', async () => {
  const existing = student({ external_id: 'shared-subject', email: 'first@school.example' });
  const state = makeState({
    mappings: [{ domain: 'school.example', tenant_id: TENANT_A }],
    students: [existing],
  });
  const pool = makePool(state);
  const resolved = await access.resolveAuthedStudent(oidcRequest({
    issuer: ISSUER_B, sub: 'shared-subject', email: 'second@school.example',
  }), pool);
  assert.notEqual(resolved.studentId, existing.student_id);
  assert.equal(state.students.at(-1).external_issuer, ISSUER_B);
  assert.deepEqual(pool.calls[0].params, [ISSUER_B, 'shared-subject']);
});

test('a bound same-tenant email cannot be claimed by a different subject', async () => {
  const state = makeState({
    mappings: [{ domain: 'school.example', tenant_id: TENANT_A }],
    students: [student({ external_id: 'original-subject' })],
  });
  const pool = makePool(state);
  await assert.rejects(
    access.resolveAuthedStudent(oidcRequest({ issuer: ISSUER_A, sub: 'attacker-subject' }), pool),
    (err) => err instanceof access.EducationAccessError && err.status === 409,
  );
  assert.equal(dataWrites(pool).length, 0);
  assert.equal(pool.calls.some(({ sql }) => sql === 'ROLLBACK'), true);
});

test('an explicit placeholder links once after deterministic advisory locks', async () => {
  const placeholder = student({ external_issuer: null, external_id: null });
  const state = makeState({
    mappings: [{ domain: 'school.example', tenant_id: TENANT_A }],
    students: [placeholder],
  });
  const pool = makePool(state);
  const first = await access.resolveAuthedStudent(
    oidcRequest({ issuer: ISSUER_A, sub: 'linked-subject' }), pool,
  );
  assert.equal(first.studentId, placeholder.student_id);
  assert.equal(placeholder.external_issuer, ISSUER_A);
  const emailRead = pool.calls.findIndex(({ sql }) => /lower\(email\)/i.test(sql));
  const locks = pool.calls.filter(({ sql }) => /pg_advisory_xact_lock/i.test(sql));
  assert.equal(locks.length, 2);
  assert.deepEqual(locks.map(({ params }) => params[0]), [
    JSON.stringify(['lm-email', TENANT_A, 'student@school.example']),
    JSON.stringify(['lm-principal', ISSUER_A, 'linked-subject']),
  ].sort());
  assert.ok(pool.calls.indexOf(locks.at(-1)) < emailRead);
  const writeCount = dataWrites(pool).length;
  await assert.rejects(
    access.resolveAuthedStudent(oidcRequest({ issuer: ISSUER_B, sub: 'other-subject' }), pool),
    (err) => err instanceof access.EducationAccessError && err.status === 409,
  );
  assert.equal(dataWrites(pool).length, writeCount);
});

test('legacy subject adoption is one-time, tenant-local, and issuer-bound', async () => {
  const legacy = student({ external_issuer: null, external_id: 'legacy-subject' });
  const state = makeState({
    mappings: [{ domain: 'school.example', tenant_id: TENANT_A }],
    students: [legacy],
  });
  const pool = makePool(state);
  const resolved = await access.resolveAuthedStudent(
    oidcRequest({ issuer: ISSUER_A, sub: 'legacy-subject' }), pool,
  );
  assert.equal(resolved.studentId, legacy.student_id);
  assert.equal(legacy.external_issuer, ISSUER_A);
  const update = dataWrites(pool).find(({ sql }) => /SET external_issuer = \$1/.test(sql));
  assert.deepEqual(update.params, [ISSUER_A, legacy.student_id, 'legacy-subject']);
});

test('missing subject or issuer fails unless the safe mock issuer is explicitly enabled', async () => {
  await withMockOidc(undefined, async () => {
    for (const request of [
      oidcRequest({ issuer: ISSUER_A, sub: undefined }),
      oidcRequest({ issuer: undefined, sub: 'subject' }),
    ]) {
      const pool = makePool(makeState());
      await assert.rejects(
        access.resolveAuthedStudent(request, pool),
        (err) => err instanceof access.EducationAccessError && err.status === 401,
      );
      assert.equal(pool.calls.length, 0);
    }
  });
  await withMockOidc('true', async () => {
    const state = makeState();
    const resolved = await access.resolveAuthedStudent(
      oidcRequest({ issuer: undefined, sub: 'mock-subject', email: 'mock@local.test' }),
      makePool(state),
    );
    assert.equal(resolved.tenantId, access.DEFAULT_TENANT_ID);
    assert.equal(state.students[0].external_issuer, 'urn:oshal:mock-oidc');
  });
});

test('default-school bootstrap closes as soon as any domain mapping exists', async () => {
  const bootstrapState = makeState();
  const bootstrap = await access.resolveAuthedStudent(
    oidcRequest({ issuer: ISSUER_A, sub: 'bootstrap', email: 'new@unknown.example' }),
    makePool(bootstrapState),
  );
  assert.equal(bootstrap.tenantId, access.DEFAULT_TENANT_ID);

  for (const [label, mappings, status] of [
    ['unknown domain', [{ domain: 'school.example', tenant_id: TENANT_A }], 403],
    ['ambiguous domain', [
      { domain: 'unknown.example', tenant_id: TENANT_A },
      { domain: 'UNKNOWN.EXAMPLE', tenant_id: 'tenant-b' },
    ], 503],
  ]) {
    const pool = makePool(makeState({ mappings }));
    await assert.rejects(
      access.resolveAuthedStudent(
        oidcRequest({ issuer: ISSUER_A, sub: label, email: 'new@unknown.example' }), pool,
      ),
      (err) => err instanceof access.EducationAccessError && err.status === status,
    );
    assert.equal(dataWrites(pool).length, 0, label);
  }
});

test('rollback failures are observable through the structured logger', async () => {
  LOGS.length = 0;
  const state = makeState({
    mappings: [{ domain: 'school.example', tenant_id: TENANT_A }],
    students: [student()],
  });
  const pool = makePool(state, { failRollback: true });
  await assert.rejects(
    access.resolveAuthedStudent(oidcRequest({ issuer: ISSUER_B, sub: 'other' }), pool),
    (err) => err instanceof access.EducationAccessError && err.status === 409,
  );
  assert.equal(LOGS.some((entry) => (
    entry[0] === 'error' && entry.at(-1) === 'Student identity transaction rollback failed'
  )), true);
});

test('RAG collection names hash complete identities and stay below 63 characters', () => {
  const classA = 'aaaaaaaa-1111-4111-8111-111111111111';
  const classB = 'aaaaaaaa-2222-4222-8222-222222222222';
  const studentA = 'bbbbbbbb-1111-4111-8111-111111111111';
  const studentB = 'bbbbbbbb-2222-4222-8222-222222222222';
  const privateA = access.privateMaterialsCollection(classA, studentA);
  const privateB = access.privateMaterialsCollection(classB, studentB);
  const sharedA = access.sharedMaterialsCollection(classA);
  assert.match(privateA, /^lm-prv-[a-f0-9]{24}-[a-f0-9]{24}$/);
  assert.match(sharedA, /^lm-shr-[a-f0-9]{24}$/);
  assert.notEqual(privateA, privateB);
  assert.notEqual(sharedA, access.sharedMaterialsCollection(classB));
  assert.equal(access.privateMaterialsCollection(classA.toUpperCase(), studentA), privateA);
  assert.ok(privateA.length <= 63 && sharedA.length <= 63);
});

test('migration 032 and bootstrap enforce the issuer-bound principal invariant', () => {
  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const migration = fs.readFileSync(
    path.join(PKG, 'migrations', '032-oidc-principal-binding.sql'), 'utf8',
  );
  const schema = fs.readFileSync(path.join(PKG, 'src-routes', 'education-schema.ts'), 'utf8');
  assert.match(manifest, /migrations\/032-oidc-principal-binding\.sql/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS external_issuer TEXT/i);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS idx_lm_students_external_principal/i);
  assert.match(migration, /\(external_issuer, external_id\)[\s\S]*WHERE external_issuer IS NOT NULL AND external_id IS NOT NULL/i);
  assert.match(migration, /DROP INDEX IF EXISTS idx_lm_students_external_id/i);
  assert.match(schema, /columns: \[[^\]]*'external_issuer'/i);
  assert.match(schema, /idx_lm_students_external_principal/);
  assert.match(schema, /legacy_index_present/);
});
