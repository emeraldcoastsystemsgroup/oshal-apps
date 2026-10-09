/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive the compiled ADR-139 class-material receiver (POST /import-artifact) over loopback HTTP: teacher import is approved and visible to the class, student import is a teacher-review request listed in share-requests, and a non-member, a refused relay redemption, disguised bytes, a missing subject and a malformed class id are refused before any row or file is written.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The receiver hands the redeem its own request (the session or PAT the loopback must carry, because the core relay refuses the service rail for a principal-bound handle): the relay double records the verified subject on the request it was handed, and every redeem must carry the caller's own.
 * -----------------------------------------------------------------------------
 *
 * Dependency-free on purpose: the store gate runs `tests/*.test.cjs` on a bare checkout.
 *
 * Real: the compiled routes/education-materials-routes.js, education-access.js (issuer-bound
 * identity and class access) and education-material-storage.js (byte classification, contained
 * no-clobber file write, rollback cleanup), a node:http loopback socket and JSON bodies.
 *
 * Named doubles, each outside the claim under test:
 * - express Router: a minimal exact-segment loopback router (no framework checkout in this job);
 * - pg pool: an in-memory model of exactly the SQL this receiver issues; unknown SQL fails the case;
 * - core redeemArtifactViaRelay: an owner-bound handle table returning the statuses core
 *   src/shared/artifact-exchange/redeem.ts returns (404 for a foreign, expired or unknown handle,
 *   413 above the destination's maxBytes), recording the verified subject on the request it is
 *   handed. Its real HTTP owner and principal binding is guarded in core
 *   (tests/unit/artifact-redeem-principal.spec.ts);
 * - pdf-parse, the OCR binary and RagService: deterministic recorders, so no binary, network or
 *   vector store is touched.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const ISSUER = 'https://school.example.test/realms/lm';
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEACHER = '10000000-0000-4000-8000-000000000101';
const STUDENT = '10000000-0000-4000-8000-000000000001';
const OUTSIDER = '10000000-0000-4000-8000-000000000002';
const CLASS_A = '30000000-0000-4000-8000-00000000000a';
const CLASS_B = '30000000-0000-4000-8000-00000000000b';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('IHDR-fixture')]);
const NOT_FOUND = 'artifact handle not found — it may have expired; use Send to… again';

const relay = { handles: new Map(), calls: [] };
const rag = { ingested: [], deleted: [] };
const ocr = { calls: [] };

function loopbackRouter() {
  const router = { routes: [] };
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    router[method] = (pattern, ...handlers) => {
      router.routes.push({ method: method.toUpperCase(), pattern, handler: handlers.at(-1) });
      return router;
    };
  }
  return router;
}

/** Mirror core redeem.ts: owner-bound, expiry and foreign handles are one 404, size cap is 413. */
async function redeemDouble(input) {
  const { request, ...rest } = input;
  relay.calls.push({ ...rest, requestSub: request?.oidc?.user?.sub ?? null });
  const handle = relay.handles.get(input.ref);
  if (!handle || handle.ownerSub !== input.callerSub || handle.expired) {
    return { ok: false, status: 404, error: NOT_FOUND };
  }
  if (handle.bytes.length > input.maxBytes) {
    return { ok: false, status: 413, error: 'artifact exceeds this destination’s size limit' };
  }
  return { ok: true, name: handle.name, type: handle.type, buffer: Buffer.from(handle.bytes) };
}

class RagDouble {
  async ingest(texts, collection, metadata) {
    rag.ingested.push({ texts, collection, metadata });
    return { collection, chunkCount: texts.length };
  }
  async deleteCollection(collection) { rag.deleted.push(collection); }
}

function ocrExecFile(...args) {
  ocr.calls.push(args[0]);
  const callback = args.at(-1);
  const err = Object.assign(new Error('spawn ENOENT (test double: no OCR binary)'), { code: 'ENOENT' });
  process.nextTick(() => callback(err));
}

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };
const fakeMulter = () => ({ single: () => (_req, _res, next) => next() });
fakeMulter.memoryStorage = () => ({});
const STUBS = {
  express: { Router: loopbackRouter },
  multer: fakeMulter,
  '@/shared/logger': { createChildLogger: () => quietLogger },
  '@/shared/artifact-exchange': { redeemArtifactViaRelay: redeemDouble },
  '@/features/rag': { RagService: RagDouble },
  'pdf-parse': async () => ({ text: 'Fractions worksheet: add 1/2 and 1/4.' }),
};
const STORAGE_MODULE = path.join(PKG, 'routes', 'education-material-storage.js');
const originalLoad = Module._load;
Module._load = function loadWithScopedDoubles(request, parent, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request === 'child_process' && parent?.filename === STORAGE_MODULE) {
    return { ...originalLoad.call(this, request, parent, ...rest), execFile: ocrExecFile };
  }
  return originalLoad.call(this, request, parent, ...rest);
};
process.once('exit', () => { Module._load = originalLoad; });
delete process.env.LM_TEACHER_EMAILS;
const { createEducationMaterialsRoutes } = require(path.join(PKG, 'routes', 'education-materials-routes.js'));

// saveMaterialFile writes under process.cwd(); every case runs in its own disposable directory.
const WORKDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-artifact-import-'));
const ORIGINAL_CWD = process.cwd();
test.after(() => {
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(WORKDIR, { recursive: true, force: true });
});

function person(studentId, sub, name, role) {
  return { student_id: studentId, external_issuer: ISSUER, external_id: sub, name,
    email: `${sub}@school.example.test`, role, tenant_id: TENANT };
}

function baseState() {
  return {
    students: [person(TEACHER, 'oidc-teacher', 'Teacher T', 'teacher'),
      person(STUDENT, 'oidc-student', 'Student S', 'student'),
      person(OUTSIDER, 'oidc-outsider', 'Student O', 'student')],
    classes: [{ class_id: CLASS_A, tenant_id: TENANT, teacher_student_id: TEACHER },
      { class_id: CLASS_B, tenant_id: TENANT, teacher_student_id: TEACHER }],
    enrollments: [{ student_id: STUDENT, class_id: CLASS_A, tenant_id: TENANT },
      { student_id: OUTSIDER, class_id: CLASS_B, tenant_id: TENANT }],
    materials: [],
    snapshot: null,
  };
}

const rows = list => ({ rows: list, rowCount: list.length });
const one = found => rows(found ? [{ '?column?': 1 }] : []);
const byId = (state, id) => state.students.find(student => student.student_id === id);
const classOf = (state, id) => state.classes.find(cls => cls.class_id === id);
const enrolled = (state, studentId, classId) => state.enrollments
  .some(row => row.student_id === studentId && row.class_id === classId);

function identityAndAccess(state, sql, p) {
  if (/^SELECT student_id, email, name, role, tenant_id, external_id, external_issuer FROM lm_students WHERE external_issuer = \$1 AND external_id = \$2 LIMIT 2$/.test(sql)) {
    return rows(state.students.filter(s => s.external_issuer === p[0] && s.external_id === p[1]));
  }
  if (/^SELECT 1 FROM lm_classes WHERE class_id = \$1 AND teacher_student_id = \$2 AND tenant_id = \$3$/.test(sql)) {
    return one(state.classes.some(c => c.class_id === p[0] && c.teacher_student_id === p[1] && c.tenant_id === p[2]));
  }
  if (/^SELECT 1 FROM lm_enrollments e JOIN lm_classes c ON c\.class_id = e\.class_id WHERE e\.student_id = \$1 AND e\.class_id = \$2 AND c\.tenant_id = \$3$/.test(sql)) {
    return one(enrolled(state, p[0], p[1]) && classOf(state, p[1])?.tenant_id === p[2]);
  }
  if (/^SELECT c\.teacher_student_id, a\.role AS actor_role FROM lm_classes c JOIN lm_students a ON a\.student_id = \$2 AND a\.tenant_id = c\.tenant_id WHERE c\.class_id = \$1 AND c\.tenant_id = \$3 FOR (SHARE|UPDATE) OF c FOR \1 OF a$/.test(sql)) {
    const cls = classOf(state, p[0]), actor = byId(state, p[1]);
    const ok = cls && actor && cls.tenant_id === p[2] && actor.tenant_id === cls.tenant_id;
    return rows(ok ? [{ teacher_student_id: cls.teacher_student_id, actor_role: actor.role }] : []);
  }
  if (/^SELECT 1 FROM lm_enrollments WHERE student_id = \$1 AND class_id = \$2 AND tenant_id = \$3 FOR SHARE$/.test(sql)) {
    return one(state.enrollments.some(e => e.student_id === p[0] && e.class_id === p[1] && e.tenant_id === p[2]));
  }
  return undefined;
}

function insertMaterial(state, p) {
  const row = { material_id: randomUUID(), class_id: p[0], uploaded_by: p[1], original_name: p[2],
    stored_path: p[3], mime_type: p[4], size_bytes: p[5], kind: p[6], title: p[7], shared: p[8],
    share_status: p[9], rag_collection: null, created_at: new Date().toISOString() };
  state.materials.push(row);
  return rows([{ ...row }]);
}

function materialWrites(state, sql, p) {
  if (/^SELECT COALESCE\(SUM\(size_bytes\), 0\)::bigint AS used FROM lm_materials WHERE uploaded_by = \$1 AND created_at >= NOW\(\) - interval '24 hours'$/.test(sql)) {
    return rows([{ used: String(state.materials.filter(m => m.uploaded_by === p[0])
      .reduce((sum, m) => sum + m.size_bytes, 0)) }]);
  }
  if (/^INSERT INTO lm_materials \(class_id, uploaded_by, original_name, stored_path, mime_type, size_bytes, kind, title, shared, share_status\) VALUES/.test(sql)) {
    return insertMaterial(state, p);
  }
  if (/^SELECT class_id FROM lm_materials WHERE material_id = \$1$/.test(sql)) {
    return rows(state.materials.filter(m => m.material_id === p[0]).map(m => ({ class_id: m.class_id })));
  }
  if (/^SELECT m\.material_id, m\.class_id, m\.uploaded_by, .* FROM lm_materials m JOIN lm_students uploader ON uploader\.student_id = m\.uploaded_by AND uploader\.tenant_id = \$3 WHERE m\.material_id = \$1 AND m\.class_id = \$2 FOR UPDATE OF m FOR UPDATE OF uploader$/.test(sql)) {
    const found = state.materials.find(m => m.material_id === p[0] && m.class_id === p[1]);
    return rows(found && byId(state, found.uploaded_by)?.tenant_id === p[2] ? [{ ...found }] : []);
  }
  if (/^UPDATE lm_materials SET rag_collection = \$2 WHERE material_id = \$1 AND rag_collection IS NULL$/.test(sql)) {
    const found = state.materials.find(m => m.material_id === p[0] && m.rag_collection === null);
    if (found) found.rag_collection = p[1];
    return { rows: [], rowCount: found ? 1 : 0 };
  }
  return undefined;
}

function classListings(state, sql, p) {
  if (/^SELECT m\.material_id, m\.original_name, m\.kind, m\.title, m\.created_at, s\.name AS requested_by_name FROM lm_materials m .* WHERE m\.class_id = \$1 AND m\.share_status = 'requested' AND c\.tenant_id = \$2 AND \(\$3::boolean OR c\.teacher_student_id = \$4\) ORDER BY m\.created_at$/.test(sql)) {
    const cls = classOf(state, p[0]);
    const allowed = cls && cls.tenant_id === p[1] && (p[2] || cls.teacher_student_id === p[3]);
    return rows(!allowed ? [] : state.materials.filter(m => m.class_id === p[0] && m.share_status === 'requested')
      .map(m => ({ material_id: m.material_id, title: m.title, requested_by_name: byId(state, m.uploaded_by)?.name })));
  }
  if (/^SELECT m\.material_id, m\.original_name, m\.mime_type, m\.size_bytes, m\.kind, m\.title, m\.created_at, s\.name AS shared_by_name FROM lm_materials m .* WHERE m\.class_id = \$1 AND m\.share_status = 'approved' AND EXISTS/.test(sql)) {
    const cls = classOf(state, p[0]);
    const member = cls && cls.tenant_id === p[1]
      && (p[2] || (p[3] && cls.teacher_student_id === p[4]) || enrolled(state, p[4], p[0]));
    return rows(!member ? [] : state.materials.filter(m => m.class_id === p[0] && m.share_status === 'approved')
      .map(m => ({ material_id: m.material_id, title: m.title, shared_by_name: byId(state, m.uploaded_by)?.name })));
  }
  return undefined;
}

function transactionControl(state, sql) {
  if (sql === 'BEGIN') state.snapshot = state.materials.map(m => ({ ...m }));
  else if (sql === 'COMMIT') state.snapshot = null;
  else if (sql === 'ROLLBACK') { state.materials = state.snapshot || state.materials; state.snapshot = null; }
  else if (!/^SELECT pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)$/.test(sql)) return undefined;
  return rows([]);
}

function makePool(state) {
  const pool = { calls: [], unexpected: [] };
  pool.query = async (text, params = []) => {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    pool.calls.push({ sql, params });
    for (const handler of [transactionControl, identityAndAccess, materialWrites, classListings]) {
      const handled = handler(state, sql, params);
      if (handled !== undefined) return handled;
    }
    pool.unexpected.push(sql);
    throw new Error(`unexpected SQL in class-material import test: ${sql}`);
  };
  pool.connect = async () => ({ query: pool.query, release() {} });
  return pool;
}

function matchRoute(routes, method, pathname) {
  for (const route of routes) {
    const expected = route.pattern.split('/'), actual = pathname.split('/'), params = {};
    if (route.method !== method || expected.length !== actual.length) continue;
    const same = expected.every((part, i) => {
      if (!part.startsWith(':')) return part === actual[i];
      params[part.slice(1)] = decodeURIComponent(actual[i]);
      return actual[i] !== '';
    });
    if (same) return { handler: route.handler, params };
  }
  return null;
}

/** A browser session carries the issuer on the verified idTokenClaims, the subject on user. */
function attachSession(req) {
  const sub = req.headers['x-test-sub'];
  if (sub === undefined) return;
  req.oidc = { isAuthenticated: () => true, user: { sub, name: 'fixture' }, idTokenClaims: { iss: ISSUER } };
}

function dispatch(router, req, res) {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', async () => {
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); return res; };
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname.replace(/^\/api\/education/, '');
    const found = matchRoute(router.routes, req.method, pathname);
    if (!found) return res.status(404).json({ error: 'no such route in fixture' });
    try {
      req.params = found.params;
      req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      attachSession(req);
      await found.handler(req, res);
    } catch (err) {
      res.status(599).json({ error: `fixture dispatch failed: ${err.message}` });
    }
  });
}

async function serve() {
  process.chdir(fs.mkdtempSync(path.join(WORKDIR, 'case-')));
  const state = baseState(), pool = makePool(state);
  relay.handles.clear(); relay.calls.length = 0; rag.ingested.length = 0; rag.deleted.length = 0; ocr.calls.length = 0;
  const router = createEducationMaterialsRoutes({ pool });
  const server = http.createServer((req, res) => dispatch(router, req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const call = async (method, url, sub, body) => {
    const headers = { 'content-type': 'application/json', ...(sub === undefined ? {} : { 'x-test-sub': sub }) };
    const res = await fetch(`http://127.0.0.1:${port}/api/education${url}`,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const close = () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  return { state, pool, port, call, close };
}

function mint(ref, ownerSub, name, type, bytes, extra = {}) {
  relay.handles.set(ref, { ownerSub, name, type, bytes, ...extra });
}

function storedFiles() {
  const root = path.join(process.cwd(), 'workspace-shared');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath ?? entry.path, entry.name));
}

function writesOf(pool) {
  return pool.calls.filter(call => /^(INSERT|UPDATE|DELETE)\b/.test(call.sql));
}

function assertNothingWritten(f, label) {
  assert.deepEqual(writesOf(f.pool), [], `${label}: no SQL write`);
  assert.deepEqual(f.state.materials, [], `${label}: no material row`);
  assert.deepEqual(storedFiles(), [], `${label}: no stored file`);
  assert.deepEqual(f.pool.unexpected, [], `${label}: every statement was modelled`);
}

test('a teacher files an owned PDF into their class: approved, stored, grounded and visible to the class', async () => {
  const f = await serve();
  try {
    mint('art_teacherpdf01', 'oidc-teacher', 'fractions.pdf', 'application/pdf', PDF);
    const res = await f.call('POST', '/import-artifact', 'oidc-teacher',
      { ref: 'art_teacherpdf01', classId: CLASS_A, callerSub: 'oidc-student', studentId: STUDENT });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.shareStatus, 'approved');
    assert.equal(res.body.grounded, true);
    assert.deepEqual(relay.calls, [{ port: f.port, callerSub: 'oidc-teacher', ref: 'art_teacherpdf01', maxBytes: 10 * 1024 * 1024, requestSub: 'oidc-teacher' }]);
    const [row] = f.state.materials;
    assert.deepEqual([row.uploaded_by, row.class_id, row.share_status, row.shared, row.mime_type, row.kind],
      [TEACHER, CLASS_A, 'approved', true, 'application/pdf', 'handout']);
    assert.deepEqual(storedFiles(), [path.resolve(row.stored_path)]);
    assert.ok(fs.readFileSync(row.stored_path).equals(PDF));
    assert.equal(rag.ingested.length, 1);
    assert.equal(rag.ingested[0].collection, `lm-material-${row.material_id.replace(/-/g, '')}`);
    assert.equal(row.rag_collection, rag.ingested[0].collection);
    const shared = await f.call('GET', `/classes/${CLASS_A}/shared-materials`, 'oidc-student');
    assert.deepEqual(shared.body.materials.map(m => m.material_id), [row.material_id]);
    assert.deepEqual(f.pool.unexpected, []);
  } finally { await f.close(); }
});

test('an enrolled student files an image: a teacher-review request listed for the class teacher only', async () => {
  const f = await serve();
  try {
    mint('art_studentpng01', 'oidc-student', 'notes.png', 'image/png', PNG);
    const res = await f.call('POST', '/import-artifact', 'oidc-student', { ref: 'art_studentpng01', classId: CLASS_A });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.shareStatus, 'requested');
    const [row] = f.state.materials;
    assert.deepEqual([row.uploaded_by, row.share_status, row.shared, row.mime_type], [STUDENT, 'requested', false, 'image/png']);
    assert.ok(fs.readFileSync(row.stored_path).equals(PNG));
    assert.deepEqual(ocr.calls, ['tesseract']);
    assert.equal(res.body.grounded, false);
    const requests = await f.call('GET', `/classes/${CLASS_A}/share-requests`, 'oidc-teacher');
    assert.equal(requests.status, 200);
    assert.deepEqual(requests.body.requests.map(r => [r.material_id, r.requested_by_name]), [[row.material_id, 'Student S']]);
    const shared = await f.call('GET', `/classes/${CLASS_A}/shared-materials`, 'oidc-student');
    assert.deepEqual(shared.body.materials, []);
    assert.equal((await f.call('GET', `/classes/${CLASS_A}/share-requests`, 'oidc-student')).status, 403);
    assert.deepEqual(f.pool.unexpected, []);
  } finally { await f.close(); }
});

test('a student not enrolled in the chosen class is refused before the handle is redeemed or anything is written', async () => {
  const f = await serve();
  try {
    mint('art_outsider001', 'oidc-outsider', 'notes.pdf', 'application/pdf', PDF);
    const res = await f.call('POST', '/import-artifact', 'oidc-outsider', { ref: 'art_outsider001', classId: CLASS_A });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'You do not have access to this class');
    assert.deepEqual(relay.calls, []);
    assertNothingWritten(f, 'non-member');
  } finally { await f.close(); }
});

test('relay refusals pass through unchanged and write nothing: foreign, expired and oversize handles', async () => {
  const f = await serve();
  try {
    mint('art_teacheronly1', 'oidc-teacher', 'key.pdf', 'application/pdf', PDF);
    mint('art_expired0001', 'oidc-student', 'old.pdf', 'application/pdf', PDF, { expired: true });
    mint('art_oversize001', 'oidc-student', 'big.pdf', 'application/pdf', Buffer.alloc(10 * 1024 * 1024 + 1, 0x25));
    for (const [ref, status] of [['art_teacheronly1', 404], ['art_expired0001', 404], ['art_missing0001', 404], ['art_oversize001', 413]]) {
      const res = await f.call('POST', '/import-artifact', 'oidc-student', { ref, classId: CLASS_A });
      assert.equal(res.status, status, ref);
      assert.equal(res.body.error, status === 404 ? NOT_FOUND : 'artifact exceeds this destination’s size limit', ref);
    }
    assert.equal(relay.calls.length, 4);
    assert.ok(relay.calls.every(call => call.callerSub === 'oidc-student' && call.requestSub === 'oidc-student'));
    assertNothingWritten(f, 'relay refusal');
  } finally { await f.close(); }
});

test('bytes that are not a PDF or image are refused with 415 whatever MIME type the handle claims', async () => {
  const f = await serve();
  try {
    mint('art_disguised01', 'oidc-teacher', 'photo.png', 'image/png', Buffer.from('<html><script>alert(1)</script></html>'));
    mint('art_plaintext01', 'oidc-teacher', 'notes.txt', 'text/plain', Buffer.from('plain notes'));
    for (const ref of ['art_disguised01', 'art_plaintext01']) {
      const res = await f.call('POST', '/import-artifact', 'oidc-teacher', { ref, classId: CLASS_A });
      assert.equal(res.status, 415, ref);
      assert.deepEqual(res.body, { error: 'unsupported_artifact_type', accepts: ['application/pdf', 'image/*'] });
    }
    assertNothingWritten(f, 'disguised bytes');
  } finally { await f.close(); }
});

test('a request without a verified subject is 401 and a malformed class id is 400, both before any lookup', async () => {
  const f = await serve();
  try {
    mint('art_studentpdf01', 'oidc-student', 'notes.pdf', 'application/pdf', PDF);
    const anonymous = await f.call('POST', '/import-artifact', undefined, { ref: 'art_studentpdf01', classId: CLASS_A });
    assert.deepEqual([anonymous.status, anonymous.body.error], [401, 'Not authenticated']);
    const blank = await f.call('POST', '/import-artifact', '', { ref: 'art_studentpdf01', classId: CLASS_A });
    assert.equal(blank.status, 401);
    const malformed = await f.call('POST', '/import-artifact', 'oidc-student', { ref: 'art_studentpdf01', classId: 'class-a' });
    assert.deepEqual([malformed.status, malformed.body.error], [400, 'classId must be a UUID']);
    const missing = await f.call('POST', '/import-artifact', 'oidc-student', { ref: 'art_studentpdf01' });
    assert.equal(missing.status, 400);
    assert.deepEqual(relay.calls, []);
    assert.deepEqual(f.pool.calls, []);
    assertNothingWritten(f, 'identity or class id refusal');
  } finally { await f.close(); }
});
