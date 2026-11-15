/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Regression suite proving every Presentations GET route runs under read-only SQL admission without executing INSERT, UPDATE, DELETE, CREATE, ALTER, writable BEGIN, advisory locks, or mirror disk writes.
 * -----------------------------------------------------------------------------
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const READER_REFUSAL = 'refused: SQL mutation requires original writer admission';
const RO_TX_REFUSAL = 'refused: SQL mutation refused in a read-only transaction';
const MUTATION_RE = /^(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE)\b/i;
const IDEMPOTENT_DDL_RE = /^CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\b/i;

function makeExpressRecorder() {
  const makeRouter = () => {
    const handlers = new Map();
    const reg = (method) => (routePath, ...fns) => handlers.set(`${method} ${routePath}`, fns.at(-1));
    return { handlers, get: reg('GET'), post: reg('POST'), put: reg('PUT'), patch: reg('PATCH'), delete: reg('DELETE'), use() {} };
  };
  const pass = () => (_req, _res, next) => next?.();
  return { Router: makeRouter, json: pass, raw: pass };
}

function makeOfficeStandIns() {
  class MiniZip {
    constructor(files = new Map([['[Content_Types].xml', '<Types></Types>'], ['_rels/.rels', '<Relationships></Relationships>']])) {
      this._map = new Map(files);
      this._sync();
    }
    _sync() {
      this.files = Object.fromEntries([...this._map.keys()].map((k) => [k, { name: k, dir: false, _data: { uncompressedSize: Buffer.byteLength(this._map.get(k)) } }]));
    }
    file(name, content) {
      if (content !== undefined) { this._map.set(name, Buffer.isBuffer(content) ? content : Buffer.from(String(content))); this._sync(); return this; }
      if (!this._map.has(name)) return null;
      const buf = Buffer.from(this._map.get(name));
      return { name, dir: false, _data: { uncompressedSize: buf.length }, async: async (t) => (t === 'string' ? buf.toString('utf8') : buf) };
    }
    async generateAsync() { return Buffer.from(JSON.stringify([...this._map.entries()].map(([k, v]) => [k, Buffer.from(v).toString('base64')]))); }
    static async loadAsync(buf) {
      const parsed = JSON.parse(Buffer.from(buf).toString('utf8'));
      return new MiniZip(new Map(parsed.map(([k, b64]) => [k, Buffer.from(b64, 'base64')])));
    }
  }
  class MiniPptx {
    constructor() { this.ShapeType = { ellipse: 'ellipse', rect: 'rect' }; }
    defineLayout() {}
    addSlide() { return { addText() {}, addImage() {}, addTable() {}, addShape() {} }; }
    async write() { return new MiniZip().generateAsync(); }
  }
  return { pptxgenjs: MiniPptx, jszip: MiniZip, docx: {}, exceljs: { Workbook: class {} } };
}

function resolveOptional(mod) {
  const roots = [process.env.STORE_CI_TOOLCHAIN, path.resolve(HERE, '../../scripts/toolchain'), process.env.OSHAL_FRAMEWORK].filter(Boolean);
  for (const root of roots) {
    const candidate = path.join(path.resolve(root), 'node_modules', mod);
    if (existsSync(candidate)) return require(candidate);
  }
  try { return require(mod); } catch { return null; }
}

function installSeams() {
  const standIns = makeOfficeStandIns();
  const stubs = {
    express: makeExpressRecorder(),
    '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    '@/features/presentation-generation': {
      PresentationEngine: class {}, renderPptx: async () => Buffer.alloc(0), renderDocx: async () => Buffer.alloc(0),
      renderXlsx: async () => Buffer.alloc(0), themeCatalog: () => [{ id: 'executive', mood: 'clear' }],
      layoutCatalog: () => [], isThemeId: (v) => v === 'executive', DEFAULT_THEME_ID: 'executive', importOffice: async () => ({}),
    },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
    '@/app/routes/storage-target': {
      resolveStorageTarget: async () => ({ provider: 'local', label: 'Workspace' }), saveContent: async () => ({}),
      listFolder: async () => ({ provider: 'local', files: [] }), deleteStoredFile: async () => ({}),
    },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: '{}' }) },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/slack-client': { uploadSlackFile: async () => ({}) },
    '@/app/routes/email-routes': { sendGmail: async () => ({}), sendOutlookMail: async () => ({}) },
    '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: () => false, confirmationRequiredPayload: () => ({}) },
  };
  for (const mod of ['pptxgenjs', 'jszip', 'docx', 'exceljs']) stubs[mod] = resolveOptional(mod) ?? standIns[mod];
  const originalLoad = Module._load;
  Module._load = function loadWithSeams(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  return () => { Module._load = originalLoad; };
}

function createMemorySqlHarness() {
  const db = {
    docs: [], revisions: [], requests: [], shares: [], audit: [],
    mode: 'writer', refusedMutations: [], writableBegins: [], advisoryLocks: [],
  };
  const resetTelemetry = (mode) => {
    db.mode = mode;
    db.refusedMutations = [];
    db.writableBegins = [];
    db.advisoryLocks = [];
  };
  const execute = (rawSql, params = [], txState = { readOnly: false }) => {
    const sql = String(typeof rawSql === 'object' ? rawSql?.text : rawSql).trim();
    const vals = Array.isArray(params) && params.length ? params : (rawSql?.values ?? []);
    if (/^BEGIN\s+READ\s+ONLY$/i.test(sql)) { txState.readOnly = true; return { rows: [], rowCount: 0 }; }
    if (/^BEGIN$/i.test(sql)) {
      txState.readOnly = false;
      if (db.mode === 'reader') db.writableBegins.push(sql);
      return { rows: [], rowCount: 0 };
    }
    if (/^(COMMIT|ROLLBACK|SET\s+LOCAL\b)/i.test(sql) || /^SELECT\s+set_config\(/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/pg_advisory_xact_lock/i.test(sql)) {
      if (db.mode === 'reader') db.advisoryLocks.push(sql);
      return { rows: [{ pg_advisory_xact_lock: '' }], rowCount: 1 };
    }
    const isMutation = MUTATION_RE.test(sql) && !IDEMPOTENT_DDL_RE.test(sql);
    if (isMutation && db.mode !== 'writer') { db.refusedMutations.push(sql); throw new Error(READER_REFUSAL); }
    if (isMutation && txState.readOnly) { db.refusedMutations.push(sql); throw new Error(RO_TX_REFUSAL); }
    return runTableQuery(db, sql, vals);
  };
  const pool = {
    query: async (sql, params) => execute(sql, params, { readOnly: false }),
    connect: async () => {
      const txState = { readOnly: false };
      return { query: async (sql, params) => execute(sql, params, txState), release() {} };
    },
  };
  return { db, pool, resetTelemetry };
}

function runTableQuery(db, sql, p) {
  const now = new Date().toISOString();
  if (sql === 'SELECT count(*)::int AS n FROM office_editor_documents WHERE owner_key=$1') {
    return { rows: [{ n: db.docs.filter((d) => d.owner_key === p[0]).length }] };
  }
  if (sql.startsWith('INSERT INTO office_editor_documents(owner_key,id,title,kind,current_revision)')) {
    db.docs.push({ owner_key: p[0], id: p[1], title: p[2], kind: p[3], current_revision: 1, updated_at: now, original_id: null });
    return { rows: [], rowCount: 1 };
  }
  if (sql.startsWith('SELECT COALESCE(sum(bytes),0)::text AS bytes FROM office_editor_revisions')) {
    const sum = db.revisions.filter((r) => r.owner_key === p[0]).reduce((acc, r) => acc + r.bytes, 0);
    return { rows: [{ bytes: String(sum) }] };
  }
  if (sql.startsWith('SELECT COALESCE(sum(bytes),0)::text AS bytes FROM office_editor_originals')) return { rows: [{ bytes: '0' }] };
  if (sql.startsWith('INSERT INTO office_editor_revisions')) {
    db.revisions.push({ owner_key: p[0], document_id: p[1], revision: Number(p[2]), model: p[3], sha256: p[4], bytes: Number(p[5]), created_at: now });
    return { rows: [], rowCount: 1 };
  }
  if (sql.startsWith('UPDATE office_editor_documents SET title=$3')) {
    const doc = db.docs.find((d) => d.owner_key === p[0] && d.id === p[1] && d.current_revision === Number(p[4]));
    if (!doc) return { rows: [], rowCount: 0 };
    Object.assign(doc, { title: p[2], current_revision: Number(p[3]), updated_at: now });
    return { rows: [{ id: doc.id, updated_at: now }], rowCount: 1 };
  }
  return runReadOrAuxQuery(db, sql, p, now);
}

function runReadOrAuxQuery(db, sql, p, now) {
  if (sql === 'SELECT * FROM office_editor_requests WHERE owner_key=$1 AND request_key=$2') {
    return { rows: db.requests.filter((r) => r.owner_key === p[0] && r.request_key === p[1]) };
  }
  if (sql.startsWith('DELETE FROM office_editor_requests')) return { rows: [], rowCount: 0 };
  if (sql === 'SELECT count(*)::int AS n FROM office_editor_requests WHERE owner_key=$1') {
    return { rows: [{ n: db.requests.filter((r) => r.owner_key === p[0]).length }] };
  }
  if (sql.startsWith('INSERT INTO office_editor_requests')) {
    db.requests.push({ owner_key: p[0], request_key: p[1], fingerprint: p[2], document_id: p[3], revision: p[4], expires_at: p[5], tombstone: false });
    return { rows: [], rowCount: 1 };
  }
  if (sql.startsWith('SELECT * FROM office_editor_documents WHERE owner_key=$1 AND id=$2')
      || sql.startsWith('SELECT id FROM office_editor_documents WHERE owner_key=$1 AND id=$2')
      || sql.startsWith('SELECT id,title,kind,current_revision,updated_at FROM office_editor_documents WHERE owner_key=$1 AND id=$2')) {
    return { rows: db.docs.filter((d) => d.owner_key === p[0] && d.id === p[1]) };
  }
  if (sql === 'SELECT id FROM office_editor_documents WHERE owner_key=$1'
      || sql.startsWith('SELECT id,title,kind,current_revision,updated_at FROM office_editor_documents WHERE owner_key=$1 ORDER BY')) {
    return { rows: db.docs.filter((d) => d.owner_key === p[0]) };
  }
  return runRevisionShareQuery(db, sql, p, now);
}

function runRevisionShareQuery(db, sql, p, now) {
  if (sql === 'SELECT * FROM office_editor_revisions WHERE owner_key=$1 AND document_id=$2 AND revision=$3') {
    return { rows: db.revisions.filter((r) => r.owner_key === p[0] && r.document_id === p[1] && r.revision === Number(p[2])) };
  }
  if (sql.startsWith('SELECT revision,created_at FROM office_editor_revisions WHERE owner_key=$1 AND document_id=$2')) {
    return { rows: db.revisions.filter((r) => r.owner_key === p[0] && r.document_id === p[1]).sort((a, b) => b.revision - a.revision) };
  }
  if (sql.startsWith('SELECT * FROM office_editor_revisions WHERE owner_key=$1 AND document_id=$2 ORDER BY revision ASC')) {
    return { rows: db.revisions.filter((r) => r.owner_key === p[0] && r.document_id === p[1]).sort((a, b) => a.revision - b.revision) };
  }
  if (sql.startsWith('SELECT sha256 FROM office_editor_revisions WHERE owner_key=$1 AND sha256=$2')) {
    return { rows: db.revisions.filter((r) => r.owner_key === p[0] && r.sha256 === p[1]).slice(0, 1) };
  }
  if (sql.startsWith('SELECT count(*)::int AS n FROM office_editor_shares')) {
    return { rows: [{ n: db.shares.filter((s) => s.owner_key === p[0] && s.document_id === p[1]).length }] };
  }
  if (sql.startsWith('INSERT INTO office_editor_shares')) {
    db.shares.push({ owner_key: p[0], id: p[1], document_id: p[2], tenant_id: p[3], owner_issuer: p[4], owner_sub: p[5], grantee_issuer: p[6], grantee_sub: p[7], role: p[8], created_at: now, updated_at: now });
    return { rows: [], rowCount: 1 };
  }
  return runRemainingShareAndLegacyQuery(db, sql, p, now);
}

function runRemainingShareAndLegacyQuery(db, sql, p, now) {
  if (sql.startsWith('SELECT * FROM office_editor_shares WHERE owner_key=$1 AND document_id=$2')
      || sql.startsWith('SELECT id,grantee_issuer,grantee_sub,role,created_at,updated_at FROM office_editor_shares WHERE owner_key=$1 AND document_id=$2')) {
    const rows = db.shares.filter((s) => s.owner_key === p[0] && s.document_id === p[1]);
    return { rows: p[2] ? rows.filter((s) => s.grantee_issuer === p[2] && s.grantee_sub === p[3]) : rows };
  }
  if (sql.startsWith('SELECT * FROM office_editor_shares WHERE tenant_id=$1')) {
    return { rows: db.shares.filter((s) => s.tenant_id === p[0] && s.grantee_issuer === p[1] && s.grantee_sub === p[2]) };
  }
  if (sql.startsWith('SELECT * FROM office_editor_shares WHERE document_id=$1')
      || sql.startsWith('SELECT id FROM office_editor_shares WHERE document_id=$1')) {
    return { rows: db.shares.filter((s) => s.document_id === p[0] && s.tenant_id === p[1] && s.grantee_issuer === p[2] && s.grantee_sub === p[3]) };
  }
  if (sql.startsWith('INSERT INTO office_editor_share_audit')) {
    db.audit.unshift({ id: p[0], owner_key: p[1], document_id: p[2], tenant_id: p[3], actor_issuer: p[4], actor_sub: p[5], action: p[6], role: p[7], detail: p[8], created_at: p[9] ?? now });
    return { rows: [], rowCount: 1 };
  }
  if (sql.startsWith('SELECT id,actor_sub,action,role,detail,created_at FROM office_editor_share_audit')) {
    return { rows: db.audit.filter((a) => a.owner_key === p[0] && a.document_id === p[1]).slice(0, 50) };
  }
  if (/oshal_presentations/i.test(sql)) {
    return { rows: /count\(\*\)/i.test(sql) ? [{ day: '0', five: '0', total: '0', week: '0', kinds: '0' }] : [] };
  }
  return { rows: [], rowCount: 0 };
}

async function invokeHandler(router, key, { params = {}, query = {}, body = {} } = {}) {
  const handler = router.handlers.get(key);
  assert.ok(handler, `Missing route handler ${key}`);
  const out = { status: 200, headers: {}, body: undefined, raw: undefined, file: undefined };
  const res = {
    headersSent: false,
    setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
    status(c) { out.status = c; return res; },
    json(b) { out.body = b; res.headersSent = true; return res; },
    send(b) { out.raw = b; res.headersSent = true; return res; },
    sendFile(f) { out.file = f; res.headersSent = true; return res; },
  };
  await handler({ params, query, body, headers: {}, oidc: { user: { sub: 'alice' }, isAuthenticated: () => true } }, res);
  return out;
}

async function seedMirroredCollaboratorDoc(editor, db, actorState) {
  const created = await invokeHandler(editor, 'POST /documents', { body: { kind: 'pptx', title: 'Initial Deck', requestKey: randomUUID() } });
  const docId = created.body.document.id;
  const slideId = created.body.document.model.pages[0].id;
  const textObjId = created.body.document.model.pages[0].objects[0].id;
  await invokeHandler(editor, 'POST /documents/:id/shares', { params: { id: docId }, body: { granteeSub: 'bob', role: 'edit', requestKey: randomUUID() } });
  const savedShares = [...db.shares];
  db.shares = [];
  actorState.sub = 'bob';
  const collabRes = await invokeHandler(editor, 'POST /documents/:id/collaborate', {
    params: { id: docId },
    body: { baseRevision: 1, requestKey: randomUUID(), operations: [{ op: 'document', patch: { title: 'Collaborator Deck' } }] },
  });
  assert.equal(collabRes.status, 201, JSON.stringify(collabRes.body));
  db.shares = savedShares;
  actorState.sub = 'alice';
  return { docId, slideId, textObjId };
}

async function buildSharedEditorFixture(t) {
  const restoreSeams = installSeams();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'presentations-read-only-'));
  const prevDataDir = process.env.OSHAL_PACKAGE_DATA_DIR;
  process.env.OSHAL_PACKAGE_DATA_DIR = dataDir;
  t.after(() => {
    if (prevDataDir === undefined) delete process.env.OSHAL_PACKAGE_DATA_DIR;
    else process.env.OSHAL_PACKAGE_DATA_DIR = prevDataDir;
    rmSync(dataDir, { recursive: true, force: true });
    restoreSeams();
  });

  const { createOfficeEditorRoutes } = await import('../routes/office-editor/application.mjs');
  const { createHomeSummaryRoutes } = require('../routes/home-summary.js');
  const { createPackageSmokeRoutes } = require('../routes/package-smoke.js');
  const { createBotPresentationRoutes } = require('../routes/bot-presentation-routes.js');
  const { db, pool, resetTelemetry } = createMemorySqlHarness();
  const actorState = { sub: 'alice' };
  const ctx = {
    appPackageDir: APP_ROOT,
    pool,
    authorization: {
      registerResource() {},
      currentActor: () => ({ isActive: true, issuer: 'oshal-test', sub: actorState.sub, principalId: `person-${actorState.sub}`, tenantIds: ['tenant-1'] }),
      authorize: async () => ({ allowed: true }),
    },
  };
  const editor = createOfficeEditorRoutes(ctx);
  const { docId, slideId, textObjId } = await seedMirroredCollaboratorDoc(editor, db, actorState);
  const mirrorFile = path.join(dataDir, 'office-shares', `${docId}.json`);
  const mirrorMtime = statSync(mirrorFile).mtimeMs;
  const assertCleanRead = async (label, run) => {
    resetTelemetry('reader');
    const result = await run();
    assert.deepEqual(db.refusedMutations, [], `${label} attempted mutating SQL under reader admission`);
    assert.deepEqual(db.writableBegins, [], `${label} opened a writable BEGIN transaction during a read`);
    assert.deepEqual(db.advisoryLocks, [], `${label} acquired pg_advisory_xact_lock during a read`);
    assert.equal(statSync(mirrorFile).mtimeMs, mirrorMtime, `${label} mutated mirror file on disk`);
    return result;
  };
  return { editor, summary: createHomeSummaryRoutes(ctx), smoke: createPackageSmokeRoutes(ctx), sections: createBotPresentationRoutes(ctx), db, resetTelemetry, actorState, docId, slideId, textObjId, dataDir, assertCleanRead };
}

test('reading and exporting an unshared owner document attempts zero auditAccess or office_editor_exports SQL writes', async (t) => {
  const restoreSeams = installSeams();
  const prevDataDir = process.env.OSHAL_PACKAGE_DATA_DIR;
  delete process.env.OSHAL_PACKAGE_DATA_DIR;
  t.after(() => {
    if (prevDataDir !== undefined) process.env.OSHAL_PACKAGE_DATA_DIR = prevDataDir;
    restoreSeams();
  });
  const { createOfficeEditorRoutes } = await import('../routes/office-editor/application.mjs');
  const { db, pool, resetTelemetry } = createMemorySqlHarness();
  const editor = createOfficeEditorRoutes({
    appPackageDir: APP_ROOT,
    pool,
    authorization: {
      registerResource() {},
      currentActor: () => ({ isActive: true, issuer: 'oshal-test', sub: 'alice', principalId: 'person-alice', tenantIds: ['tenant-1'] }),
      authorize: async () => ({ allowed: true }),
    },
  });
  const created = await invokeHandler(editor, 'POST /documents', { body: { kind: 'pptx', title: 'Private Deck', requestKey: randomUUID() } });
  const id = created.body.document.id;

  resetTelemetry('reader');
  const readRes = await invokeHandler(editor, 'GET /documents/:id', { params: { id } });
  assert.equal(readRes.status, 200);
  assert.deepEqual(db.refusedMutations, [], 'GET /documents/:id attempted auditAccess INSERT under reader admission');

  resetTelemetry('reader');
  const exportRes = await invokeHandler(editor, 'GET /documents/:id/export', { params: { id }, query: { revision: '1', format: 'pptx' } });
  assert.equal(exportRes.status, 200, JSON.stringify(exportRes.body));
  assert.deepEqual(db.refusedMutations, [], 'GET /documents/:id/export attempted office_editor_exports or auditAccess SQL writes');
});

test('GET /documents under reader admission overlays mirror revisions without SQL writes or writable transactions', async (t) => {
  const fx = await buildSharedEditorFixture(t);
  const res = await fx.assertCleanRead('GET /documents', () => invokeHandler(fx.editor, 'GET /documents'));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.documents[0].revision, 2);
  assert.equal(res.body.documents[0].title, 'Collaborator Deck');
  assert.equal(fx.db.docs[0].current_revision, 1, 'owner SQL row stays untouched during GET');
});

test('GET /documents/:id, /model-part, and /selection-part read owned, mirrored, and missing documents without SQL writes', async (t) => {
  const fx = await buildSharedEditorFixture(t);
  const readRes = await fx.assertCleanRead('GET /documents/:id', () => invokeHandler(fx.editor, 'GET /documents/:id', { params: { id: fx.docId } }));
  assert.equal(readRes.status, 200, JSON.stringify(readRes.body));
  assert.equal(readRes.body.document.revision, 2);
  assert.equal(readRes.body.document.title, 'Collaborator Deck');

  const missingRes = await fx.assertCleanRead('GET /documents/:missing', () => invokeHandler(fx.editor, 'GET /documents/:id', { params: { id: randomUUID() } }));
  assert.equal(missingRes.status, 404);

  const partRes = await fx.assertCleanRead('GET /documents/:id/model-part', () =>
    invokeHandler(fx.editor, 'GET /documents/:id/model-part', { params: { id: fx.docId }, query: { revision: '2', offset: '0' } }));
  assert.equal(partRes.status, 200);

  const selRes = await fx.assertCleanRead('GET /documents/:id/selection-part', () =>
    invokeHandler(fx.editor, 'GET /documents/:id/selection-part', {
      params: { id: fx.docId },
      query: { revision: '2', offset: '0', selectionJson: JSON.stringify({ page: fx.slideId, ids: [fx.textObjId] }) },
    }));
  assert.equal(selRes.status, 200);
});

test('GET /documents/:id/shares returns owner shares and refuses non-owners without SQL writes', async (t) => {
  const fx = await buildSharedEditorFixture(t);
  const ownerRes = await fx.assertCleanRead('GET /documents/:id/shares (owner)', () =>
    invokeHandler(fx.editor, 'GET /documents/:id/shares', { params: { id: fx.docId } }));
  assert.equal(ownerRes.status, 200, JSON.stringify(ownerRes.body));
  assert.equal(ownerRes.body.shares.length, 1);

  fx.actorState.sub = 'bob';
  const nonOwnerRes = await fx.assertCleanRead('GET /documents/:id/shares (non-owner)', () =>
    invokeHandler(fx.editor, 'GET /documents/:id/shares', { params: { id: fx.docId } }));
  assert.equal(nonOwnerRes.status, 403);
});

test('GET /documents/:id/export and /revisions/:revision/content render txt and pptx without writing office_editor_exports or audit rows', async (t) => {
  const fx = await buildSharedEditorFixture(t);
  const txtRes = await fx.assertCleanRead('GET /documents/:id/export?format=txt', () =>
    invokeHandler(fx.editor, 'GET /documents/:id/export', { params: { id: fx.docId }, query: { revision: '2', format: 'txt' } }));
  assert.equal(txtRes.status, 200, JSON.stringify(txtRes.body));

  const pptxRes = await fx.assertCleanRead('GET /documents/:id/export?format=pptx', () =>
    invokeHandler(fx.editor, 'GET /documents/:id/export', { params: { id: fx.docId }, query: { revision: '2', format: 'pptx' } }));
  assert.equal(pptxRes.status, 200, JSON.stringify(pptxRes.body));

  const dlRes = await fx.assertCleanRead('GET /documents/:id/revisions/:revision/content', () =>
    invokeHandler(fx.editor, 'GET /documents/:id/revisions/:revision/content', { params: { id: fx.docId, revision: '2' }, query: { format: 'pptx' } }));
  assert.equal(dlRes.status, 200);
  assert.ok(Buffer.isBuffer(dlRes.raw) && dlRes.raw.length > 0);

  const missingRes = await fx.assertCleanRead('GET /documents/:missing/export', () =>
    invokeHandler(fx.editor, 'GET /documents/:id/export', { params: { id: randomUUID() }, query: { revision: '1', format: 'txt' } }));
  assert.equal(missingRes.status, 404);
});

test('metadata, summary, smoke, and legacy section GET routes execute read-only and create no mirror directory', async (t) => {
  const fx = await buildSharedEditorFixture(t);
  const emptyDir = mkdtempSync(path.join(tmpdir(), 'presentations-empty-data-'));
  process.env.OSHAL_PACKAGE_DATA_DIR = emptyDir;
  try {
    fx.resetTelemetry('reader');
    assert.equal((await invokeHandler(fx.editor, 'GET /documents')).status, 200);
    assert.equal((await invokeHandler(fx.editor, 'GET /permissions')).status, 200);
    assert.equal((await invokeHandler(fx.editor, 'GET /editing-contract')).status, 200);
    assert.equal((await invokeHandler(fx.summary, 'GET /')).status, 200);
    assert.equal((await invokeHandler(fx.smoke, 'GET /')).status, 200);
    assert.equal((await invokeHandler(fx.sections, 'GET /list')).status, 200);
    assert.equal((await invokeHandler(fx.sections, 'GET /themes')).status, 200);
    assert.equal((await invokeHandler(fx.sections, 'GET /starters')).status, 200);
    assert.equal((await invokeHandler(fx.sections, 'GET /destination')).status, 200);
    assert.deepEqual(fx.db.refusedMutations, []);
    assert.deepEqual(fx.db.writableBegins, []);
    assert.deepEqual(readdirSync(emptyDir), [], 'GET routes never create office-shares directory on disk');
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
    process.env.OSHAL_PACKAGE_DATA_DIR = fx.dataDir;
  }
});
