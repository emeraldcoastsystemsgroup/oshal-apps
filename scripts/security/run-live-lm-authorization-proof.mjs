#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Add an explicit mounted Little Monsters two-tenant authorization, transactional roster, and immutable-audit proof against disposable PostgreSQL.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIRM_FLAG = '--confirm-live-lm-authorization-proof';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultStoreRoot = resolve(scriptDir, '..', '..');
const ISSUER = 'https://lm-proof.invalid/oidc';

const IDs = Object.freeze({
  tenantA: '10000000-0000-4000-8000-000000000001',
  tenantB: '20000000-0000-4000-8000-000000000002',
  studentA: '11000000-0000-4000-8000-000000000001',
  studentAPeer: '12000000-0000-4000-8000-000000000002',
  studentAOther: '13000000-0000-4000-8000-000000000003',
  teacherA: '14000000-0000-4000-8000-000000000004',
  teacherA2: '15000000-0000-4000-8000-000000000005',
  adminA: '16000000-0000-4000-8000-000000000006',
  classA: '17000000-0000-4000-8000-000000000001',
  classA2: '18000000-0000-4000-8000-000000000002',
  classAArchived: '19000000-0000-4000-8000-000000000003',
  studentB: '21000000-0000-4000-8000-000000000001',
  teacherB: '24000000-0000-4000-8000-000000000004',
  classB: '27000000-0000-4000-8000-000000000001',
});

const USAGE = `Usage:
  node scripts/security/run-live-lm-authorization-proof.mjs ${CONFIRM_FLAG} \\
    --database-url <postgres-admin-url> --framework <oshal-checkout> [--store <store-checkout>]

Environment alternatives (the confirmation flag remains mandatory):
  OSHAL_SECURITY_DATABASE_URL
  OSHAL_SECURITY_FRAMEWORK_ROOT

The admin principal must be able to create/drop databases and roles. The runner creates a
collision-resistant disposable database plus LOGIN NOSUPERUSER/NOBYPASSRLS application role,
mounts the compiled manifest entrypoint in real Express, and guarantees cleanup.`;

/** Read a required CLI value without accepting another option as data. */
function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

/** Parse an explicit destructive proof target; never borrow the application's normal DSN. */
export function parseLiveLmOptions(argv, env = process.env) {
  const options = {
    confirmed: false,
    databaseUrl: env.OSHAL_SECURITY_DATABASE_URL?.trim() || '',
    frameworkRoot: env.OSHAL_SECURITY_FRAMEWORK_ROOT?.trim() || '',
    storeRoot: defaultStoreRoot,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === CONFIRM_FLAG) options.confirmed = true;
    else if (argument === '--database-url') options.databaseUrl = optionValue(argv, index++, argument);
    else if (argument === '--framework') options.frameworkRoot = optionValue(argv, index++, argument);
    else if (argument === '--store') options.storeRoot = optionValue(argv, index++, argument);
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!options.confirmed) throw new Error(`Live database mutation requires ${CONFIRM_FLAG}`);
  validatePostgresUrl(options.databaseUrl);
  if (!options.frameworkRoot) throw new Error('--framework is required');
  options.frameworkRoot = resolve(options.frameworkRoot);
  options.storeRoot = resolve(options.storeRoot);
  return options;
}

/** Reject non-PostgreSQL and database-less administration URLs. */
function validatePostgresUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('The security database URL is not a valid URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('The security database URL must use postgres:// or postgresql://');
  }
  if (!parsed.pathname.replace(/^\//, '')) throw new Error('The security database URL must name an admin database');
}

/** Produce SQL-safe unique identifiers and a non-logged application password. */
function temporaryIdentity() {
  const suffix = `${Date.now().toString(36)}_${process.pid.toString(36)}_${randomBytes(4).toString('hex')}`;
  return {
    database: `oshal_lm_auth_db_${suffix}`,
    role: `oshal_lm_auth_role_${suffix}`,
    password: randomBytes(24).toString('hex'),
  };
}

/** Require generated names before interpolating administrative SQL identifiers. */
function assertIdentifier(value, label) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error(`${label} is not a safe PostgreSQL identifier`);
}

/** Retarget a reviewed URL and optionally replace its login without exposing it. */
function connectionUrl(base, database, role, password) {
  const parsed = new URL(base);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  if (role) parsed.username = role;
  if (password) parsed.password = password;
  return parsed.toString();
}

/** Load only migrations needed by the mounted authorization boundary, in install order. */
function migrationSql(storeRoot) {
  const migrations = [
    '019-education-platform.sql', '026-education-identity.sql',
    '027-class-publishing.sql', '030-multi-tenant.sql',
    '031-tenant-domain-uniqueness.sql', '032-oidc-principal-binding.sql',
    '035-enrollment-tenant-invariant.sql', '037-authorization-audit.sql',
  ];
  return migrations.map((name) => {
    const contents = readFileSync(join(storeRoot, 'little-monsters', 'migrations', name), 'utf8');
    return `\n-- BEGIN little-monsters/migrations/${name}\n${contents}\n-- END ${name}\n`;
  }).join('');
}

/** Seed two schools, three local educators, a foreign educator, and scoped dashboard data. */
function fixtureSql() {
  return `
INSERT INTO lm_tenants (tenant_id, slug, name, domain) VALUES
  ('${IDs.tenantA}', 'proof-a', 'Proof School A', 'a.school'),
  ('${IDs.tenantB}', 'proof-b', 'Proof School B', 'b.school');

INSERT INTO lm_students
  (student_id, name, email, external_issuer, external_id, role, tenant_id, xp, level) VALUES
  ('${IDs.studentA}', 'Student A', 'student-a@a.school', '${ISSUER}', 'student-a', 'student', '${IDs.tenantA}', 120, 2),
  ('${IDs.studentAPeer}', 'Student A Peer', 'student-peer@a.school', '${ISSUER}', 'student-a-peer', 'student', '${IDs.tenantA}', 20, 1),
  ('${IDs.studentAOther}', 'Student A Other', 'student-other@a.school', '${ISSUER}', 'student-a-other', 'student', '${IDs.tenantA}', 30, 1),
  ('${IDs.teacherA}', 'Teacher A', 'teacher-a@a.school', '${ISSUER}', 'teacher-a', 'teacher', '${IDs.tenantA}', 0, 1),
  ('${IDs.teacherA2}', 'Teacher A2', 'teacher-a2@a.school', '${ISSUER}', 'teacher-a2', 'teacher', '${IDs.tenantA}', 0, 1),
  ('${IDs.adminA}', 'Admin A', 'admin-a@a.school', '${ISSUER}', 'admin-a', 'admin', '${IDs.tenantA}', 0, 1),
  ('${IDs.studentB}', 'Student B', 'student-b@b.school', '${ISSUER}', 'student-b', 'student', '${IDs.tenantB}', 75, 1),
  ('${IDs.teacherB}', 'Teacher B', 'teacher-b@b.school', '${ISSUER}', 'teacher-b', 'teacher', '${IDs.tenantB}', 0, 1);

INSERT INTO lm_classes
  (class_id, name, subject, chroma_collection_prefix, status, published, teacher_student_id, tenant_id) VALUES
  ('${IDs.classA}', 'Math A', 'math', 'proof-a-math', 'active', true, '${IDs.teacherA}', '${IDs.tenantA}'),
  ('${IDs.classA2}', 'Science A', 'science', 'proof-a-science', 'active', true, '${IDs.teacherA2}', '${IDs.tenantA}'),
  ('${IDs.classAArchived}', 'Archived A', 'history', 'proof-a-archived', 'archived', false, '${IDs.teacherA}', '${IDs.tenantA}'),
  ('${IDs.classB}', 'Math B', 'math', 'proof-b-math', 'active', true, '${IDs.teacherB}', '${IDs.tenantB}');

INSERT INTO lm_enrollments (student_id, class_id, tenant_id) VALUES
  ('${IDs.studentA}', '${IDs.classA}', '${IDs.tenantA}'),
  ('${IDs.studentA}', '${IDs.classA2}', '${IDs.tenantA}'),
  ('${IDs.studentAPeer}', '${IDs.classA}', '${IDs.tenantA}'),
  ('${IDs.studentAOther}', '${IDs.classA}', '${IDs.tenantA}'),
  ('${IDs.studentB}', '${IDs.classB}', '${IDs.tenantB}');

INSERT INTO lm_assignments (assignment_id, class_id, title, due_date, status) VALUES
  ('31000000-0000-4000-8000-000000000001', '${IDs.classA}', 'Teacher A work', CURRENT_DATE + 1, 'active'),
  ('32000000-0000-4000-8000-000000000002', '${IDs.classA2}', 'Teacher A2 work', CURRENT_DATE + 1, 'active');
INSERT INTO lm_quiz_results
  (result_id, student_id, class_id, score_percent, total_questions, correct_answers) VALUES
  ('33000000-0000-4000-8000-000000000001', '${IDs.studentA}', '${IDs.classA}', 70, 10, 7),
  ('34000000-0000-4000-8000-000000000002', '${IDs.studentA}', '${IDs.classA2}', 10, 10, 1);
INSERT INTO lm_flashcard_sets (set_id, class_id, title, card_count) VALUES
  ('35000000-0000-4000-8000-000000000001', '${IDs.classA}', 'Math cards', 1),
  ('36000000-0000-4000-8000-000000000002', '${IDs.classA2}', 'Science cards', 1);
INSERT INTO lm_flashcards (card_id, set_id, front, back) VALUES
  ('37000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000001', 'M', 'A'),
  ('38000000-0000-4000-8000-000000000002', '36000000-0000-4000-8000-000000000002', 'S', 'A');
INSERT INTO lm_flashcard_progress (student_id, card_id, last_reviewed) VALUES
  ('${IDs.studentA}', '37000000-0000-4000-8000-000000000001', NOW()),
  ('${IDs.studentA}', '38000000-0000-4000-8000-000000000002', NOW());
`;
}

/** Grant the disposable runtime role only what the mounted routes require. */
function applicationGrantSql(role) {
  return `
GRANT USAGE ON SCHEMA public TO ${role};
GRANT SELECT, INSERT, UPDATE ON lm_students TO ${role};
GRANT SELECT, UPDATE ON lm_classes TO ${role};
GRANT SELECT, INSERT, DELETE ON lm_enrollments TO ${role};
GRANT SELECT ON lm_assignments, lm_lectures, lm_flashcard_sets, lm_flashcards,
  lm_flashcard_progress, lm_quiz_results TO ${role};
GRANT SELECT, INSERT ON lm_authorization_audit TO ${role};
GRANT EXECUTE ON FUNCTION lm_enrollment_bind_tenant() TO ${role};
GRANT EXECUTE ON FUNCTION lm_authorization_audit_stamp() TO ${role};
GRANT EXECUTE ON FUNCTION lm_authorization_audit_reject_mutation() TO ${role};
`;
}

/** Minimal quiet logger seam for the same framework import used by mounted routes. */
function loggerStub() {
  const logger = { child: () => logger, debug() {}, info() {}, warn() {}, error() {} };
  return { createChildLogger: () => logger, logger };
}

/** Load the compiled manifest entrypoint while stubbing only unrelated feature routers. */
function loadMountedFactory(storeRoot, express) {
  const emptyFactory = () => express.Router();
  const stubs = new Map([
    ['./education-assignment-routes', { createEducationAssignmentRoutes: emptyFactory }],
    ['./education-catalog-routes', { createEducationCatalogRoutes: emptyFactory }],
    ['./education-class-routes', { createEducationClassRoutes: emptyFactory }],
    ['./education-lecture-routes', { createEducationLectureRoutes: emptyFactory }],
    ['./education-materials-routes', { createEducationMaterialsRoutes: emptyFactory }],
    ['./education-rewards-routes', { createEducationRewardsRoutes: emptyFactory }],
    ['./education-study-routes', { createEducationStudyRoutes: emptyFactory }],
    ['./education-teacher-routes', { createEducationTeacherRoutes: emptyFactory }],
    ['./education-tutor-routes', { createEducationTutorRoutes: emptyFactory }],
    ['./education-schema', { ensureEducationSchema: async () => {} }],
  ]);
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'express') return express;
    if (request === '@/shared/logger') return loggerStub();
    if (stubs.has(request)) return stubs.get(request);
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const routePath = join(storeRoot, 'little-monsters', 'routes', 'education-routes.js');
    return createRequire(routePath)(routePath).createEducationRoutes;
  } finally {
    Module._load = originalLoad;
  }
}

/** Mount the exact compiled manifest entrypoint behind a proof-only OIDC seam. */
async function mountApplication(storeRoot, frameworkRoot, pool) {
  const frameworkRequire = createRequire(join(frameworkRoot, 'package.json'));
  const express = frameworkRequire('express');
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use((req, _res, next) => {
    const sub = String(req.get('x-proof-principal') || '');
    req.oidc = { isAuthenticated: () => Boolean(sub), user: { iss: ISSUER, sub } };
    next();
  });
  const factory = loadMountedFactory(storeRoot, express);
  const priorPackageDir = process.env.OSHAL_APP_PACKAGE_DIR;
  process.env.OSHAL_APP_PACKAGE_DIR = join(storeRoot, 'little-monsters');
  try {
    app.use('/api/education', factory({
      pool,
      appPackageDir: join(storeRoot, 'little-monsters'),
    }));
  } finally {
    if (priorPackageDir === undefined) delete process.env.OSHAL_APP_PACKAGE_DIR;
    else process.env.OSHAL_APP_PACKAGE_DIR = priorPackageDir;
  }
  const server = await new Promise((resolveServer, reject) => {
    const candidate = app.listen(0, '127.0.0.1', () => resolveServer(candidate));
    candidate.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mounted proof server did not expose a TCP port');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

/** Call one authenticated mounted route and parse its JSON response. */
async function requestJson(baseUrl, principal, path, method = 'GET', body) {
  const response = await fetch(`${baseUrl}/api/education${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-proof-principal': principal,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Throw a terse proof failure without leaking database connection details. */
function ensure(condition, message) {
  if (!condition) throw new Error(`Little Monsters mounted proof failed: ${message}`);
}

/** Require an operation to fail at the database boundary. */
async function ensureRejected(operation, message) {
  try { await operation(); } catch { return; }
  throw new Error(`Little Monsters mounted proof failed: ${message}`);
}

/** Exercise self, teacher, unrelated-teacher, admin, and cross-tenant dashboard reads. */
async function proveReadMatrix(baseUrl) {
  const cases = [
    ['student-a', IDs.studentA, 200, 'student self'],
    ['student-a', IDs.studentAPeer, 404, 'student peer'],
    ['teacher-a', IDs.studentA, 200, 'assigned teacher'],
    ['teacher-a2', IDs.studentAPeer, 404, 'unrelated teacher'],
    ['admin-a', IDs.studentAPeer, 200, 'tenant admin'],
    ['admin-a', IDs.studentB, 404, 'tenant admin cross-tenant'],
    ['teacher-b', IDs.studentA, 404, 'cross-tenant teacher'],
  ];
  for (const [principal, target, status, label] of cases) {
    const response = await requestJson(baseUrl, principal, `/student/${target}/dashboard`);
    ensure(response.status === status, `${label} dashboard returned ${response.status}`);
    if (status === 404) ensure(response.body.error === 'Student not found', `${label} leaked existence`);
  }
  const teacher = await requestJson(baseUrl, 'teacher-a', `/student/${IDs.studentA}/dashboard`);
  ensure(JSON.stringify(teacher.body.classes.map((row) => row.class_id)) === JSON.stringify([IDs.classA]),
    'teacher dashboard included another teacher class');
  ensure(teacher.body.upcoming.length === 1 && teacher.body.upcoming[0].title === 'Teacher A work',
    'teacher dashboard included another teacher assignment');
  ensure(teacher.body.stats.quizAverage === 70 && teacher.body.stats.quizCount === 1,
    'teacher quiz aggregate crossed class ownership');
  ensure(teacher.body.stats.flashcardsReviewed === 1,
    'teacher flashcard aggregate crossed class ownership');
}

/** Exercise denied writes, rollback-on-audit-failure, successful add/remove, and retired routes. */
async function proveRosterWrites(baseUrl, adminClient, appPool, role) {
  const before = Number((await adminClient.query('SELECT count(*) AS count FROM lm_authorization_audit')).rows[0].count);
  for (const [principal, classId, expected, label] of [
    ['student-a', IDs.classA, 403, 'student roster write'],
    ['teacher-a2', IDs.classA, 403, 'unrelated teacher roster write'],
    ['teacher-b', IDs.classA, 403, 'cross-tenant teacher roster write'],
    ['teacher-a', IDs.classAArchived, 409, 'archived class roster write'],
  ]) {
    const response = await requestJson(baseUrl, principal, `/classes/${classId}/students`, 'POST', {
      email: `${label.replaceAll(' ', '-')}@a.school`,
    });
    ensure(response.status === expected, `${label} returned ${response.status}`);
  }
  ensure(Number((await adminClient.query('SELECT count(*) AS count FROM lm_authorization_audit')).rows[0].count) === before,
    'denied writes created audit rows');

  for (const path of ['/students', '/enroll']) {
    const response = await requestJson(baseUrl, 'admin-a', path, 'POST', {
      studentId: IDs.studentB, classId: IDs.classA, email: 'legacy@b.school',
    });
    ensure(response.status === 410 && response.body.error === 'legacy_roster_endpoint_removed',
      `${path} was not permanently retired`);
  }

  await adminClient.query(`REVOKE INSERT ON lm_authorization_audit FROM ${role}`);
  const atomic = await requestJson(baseUrl, 'teacher-a', `/classes/${IDs.classA}/students`, 'POST', {
    email: 'atomic-rollback@a.school',
  });
  ensure(atomic.status === 500, 'audit denial did not fail the roster transaction');
  const rolledBack = await adminClient.query(
    "SELECT count(*) AS count FROM lm_students WHERE lower(email)='atomic-rollback@a.school'",
  );
  ensure(Number(rolledBack.rows[0].count) === 0, 'audit denial left a provisioned student behind');
  await adminClient.query(`GRANT INSERT ON lm_authorization_audit TO ${role}`);

  const added = await requestJson(baseUrl, 'teacher-a', `/classes/${IDs.classA}/students`, 'POST', {
    email: 'new-student@a.school',
  });
  ensure(added.status === 201, `authorized roster add returned ${added.status}`);
  const student = await adminClient.query(
    "SELECT student_id, tenant_id FROM lm_students WHERE lower(email)='new-student@a.school'",
  );
  ensure(student.rows.length === 1 && student.rows[0].tenant_id === IDs.tenantA,
    'provisioned student was not stamped with actor tenant');
  const enrollment = await adminClient.query(
    'SELECT tenant_id FROM lm_enrollments WHERE student_id=$1 AND class_id=$2',
    [student.rows[0].student_id, IDs.classA],
  );
  ensure(enrollment.rows[0]?.tenant_id === IDs.tenantA, 'enrollment tenant was not enforced');

  const actions = await adminClient.query(
    `SELECT actor_student_id, student_id, class_id, action, occurred_at
       FROM lm_authorization_audit WHERE student_id=$1 ORDER BY occurred_at, action`,
    [student.rows[0].student_id],
  );
  ensure(actions.rows.length === 2, 'roster add did not append both audit facts');
  ensure(actions.rows.every((row) => row.actor_student_id === IDs.teacherA
    && row.class_id === IDs.classA && row.occurred_at instanceof Date),
  'roster audit omitted actor, student, class, or database timestamp');

  const removed = await requestJson(
    baseUrl, 'teacher-a', `/classes/${IDs.classA}/students/${student.rows[0].student_id}`, 'DELETE',
  );
  ensure(removed.status === 200, `authorized roster removal returned ${removed.status}`);
  const afterRemoval = await adminClient.query(
    'SELECT action FROM lm_authorization_audit WHERE student_id=$1 ORDER BY occurred_at, action',
    [student.rows[0].student_id],
  );
  ensure(afterRemoval.rows.length === 3
    && afterRemoval.rows.some((row) => row.action === 'roster.enrollment_removed'),
  'roster removal omitted its audit fact');

  await ensureRejected(
    () => appPool.query(
      'INSERT INTO lm_enrollments (student_id,class_id,tenant_id) VALUES ($1,$2,$3)',
      [IDs.studentA, IDs.classB, IDs.tenantA],
    ),
    'application role created a cross-tenant enrollment',
  );
}

/** Prove least privilege, server time, and update/delete/truncate immutability. */
async function proveAuditImmutability(adminClient, appPool, role) {
  const roleState = await adminClient.query(
    'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=$1', [role],
  );
  ensure(roleState.rows.length === 1 && !roleState.rows[0].rolsuper && !roleState.rows[0].rolbypassrls,
    'application role is privileged');
  const privileges = await adminClient.query(
    `SELECT has_table_privilege($1, 'lm_authorization_audit', 'INSERT') AS can_insert,
            has_table_privilege($1, 'lm_authorization_audit', 'UPDATE') AS can_update,
            has_table_privilege($1, 'lm_authorization_audit', 'DELETE') AS can_delete`,
    [role],
  );
  ensure(privileges.rows[0].can_insert && !privileges.rows[0].can_update && !privileges.rows[0].can_delete,
    'application audit privileges are not append-only');

  const stamped = await appPool.query(
    `INSERT INTO lm_authorization_audit
       (actor_student_id,student_id,class_id,action,occurred_at)
     VALUES ($1,$2,$3,'roster.enrollment_created','2000-01-01') RETURNING occurred_at`,
    [IDs.adminA, IDs.studentAPeer, IDs.classA],
  );
  ensure(stamped.rows[0].occurred_at.getUTCFullYear() >= 2026, 'caller overrode database audit time');
  await ensureRejected(
    () => appPool.query("UPDATE lm_authorization_audit SET action='roster.enrollment_removed'"),
    'application role updated audit rows',
  );
  await ensureRejected(() => appPool.query('DELETE FROM lm_authorization_audit'),
    'application role deleted audit rows');
  await ensureRejected(() => appPool.query('TRUNCATE lm_authorization_audit'),
    'application role truncated audit rows');
  await ensureRejected(() => adminClient.query("UPDATE lm_authorization_audit SET action=action"),
    'table owner bypassed immutable update trigger');
  await ensureRejected(() => adminClient.query('DELETE FROM lm_authorization_audit'),
    'table owner bypassed immutable delete trigger');
  await ensureRejected(() => adminClient.query('TRUNCATE lm_authorization_audit'),
    'table owner bypassed immutable truncate trigger');
}

/** Close an HTTP server without leaving the disposable database in use. */
async function closeServer(server) {
  if (!server) return;
  await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
}

/** Remove both disposable PostgreSQL objects after terminating any failed proof sessions. */
async function cleanup(adminClient, identity) {
  const failures = [];
  try {
    await adminClient.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [identity.database]);
    await adminClient.query(`DROP DATABASE IF EXISTS ${identity.database}`);
  } catch (error) { failures.push(error); }
  try { await adminClient.query(`DROP ROLE IF EXISTS ${identity.role}`); }
  catch (error) { failures.push(error); }
  return failures;
}

/** Execute the disposable mounted authorization proof and guarantee cleanup. */
export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseLiveLmOptions(argv, env);
  if (options.help) { console.log(USAGE); return; }
  const frameworkRequire = createRequire(join(options.frameworkRoot, 'package.json'));
  const { Client, Pool } = frameworkRequire('pg');
  const identity = temporaryIdentity();
  assertIdentifier(identity.database, 'database');
  assertIdentifier(identity.role, 'role');
  const adminUrl = new URL(options.databaseUrl);
  const adminDatabase = decodeURIComponent(adminUrl.pathname.replace(/^\//, ''));
  const rootClient = new Client({ connectionString: options.databaseUrl });
  let databaseClient;
  let appPool;
  let server;
  let failure;
  await rootClient.connect();
  try {
    await rootClient.query(
      `CREATE ROLE ${identity.role} LOGIN PASSWORD '${identity.password}'
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
    await rootClient.query(`CREATE DATABASE ${identity.database}`);
    await rootClient.query(`GRANT CONNECT ON DATABASE ${identity.database} TO ${identity.role}`);
    databaseClient = new Client({ connectionString: connectionUrl(options.databaseUrl, identity.database) });
    await databaseClient.connect();
    await databaseClient.query(migrationSql(options.storeRoot));
    await databaseClient.query(fixtureSql());
    await databaseClient.query(applicationGrantSql(identity.role));
    appPool = new Pool({
      connectionString: connectionUrl(options.databaseUrl, identity.database, identity.role, identity.password),
      max: 4,
    });
    const mounted = await mountApplication(options.storeRoot, options.frameworkRoot, appPool);
    server = mounted.server;
    await proveReadMatrix(mounted.baseUrl);
    await proveRosterWrites(mounted.baseUrl, databaseClient, appPool, identity.role);
    await proveAuditImmutability(databaseClient, appPool, identity.role);
    console.log('Little Monsters live mounted authorization proof passed: two tenants, assigned/unrelated teachers, self/admin/cross-tenant reads, atomic roster writes, and immutable database audit.');
  } catch (error) { failure = error; }
  try { await closeServer(server); } catch (error) { if (!failure) failure = error; }
  try { if (appPool) await appPool.end(); } catch (error) { if (!failure) failure = error; }
  try { if (databaseClient) await databaseClient.end(); } catch (error) { if (!failure) failure = error; }
  const cleanupFailures = await cleanup(rootClient, identity);
  await rootClient.end();
  if (failure) throw failure;
  if (cleanupFailures.length) throw cleanupFailures[0];
  ensure(adminDatabase.length > 0, 'admin database disappeared during cleanup');
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exitCode = 1;
  });
}
