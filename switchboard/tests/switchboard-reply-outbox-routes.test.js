/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Exercise the compiled reply route and executor: confirmation-before-I/O, owned-source recipient binding, idempotency replay/conflict, encrypted persistence, owner-only status, atomic claims, and terminal uncertain outcomes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Use the declared synthetic placeholder for the idempotency fixture, matching the sibling model spec. See that file's entry 2: the public-store gitleaks gate refused the cut on the previous value's entropy, and the store policy is to fix the fixture, not widen the allowlist.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Register the new Streams pane sibling in the parent-mount stub list (the parent now requires ./switchboard-streams-routes); the /replies exactly-once assertion is unchanged.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const ROUTE_FILE = path.join(PKG, 'routes', 'switchboard-reply-outbox-routes.js');
const realModel = require(path.join(PKG, 'routes', 'switchboard-reply-outbox-model.js'));
const KEY = 'replace-with-idempotency-key';
const REPLY_ID = '11111111-2222-4333-8444-555555555555';

/** Reversible test envelope; production uses the real owner-derived AES-GCM helper. */
function encrypt(owner, value) { return `v1:${owner}:${Buffer.from(value).toString('base64')}`; }
function decrypt(owner, stored) {
  const prefix = `v1:${owner}:`;
  return stored.startsWith(prefix) ? Buffer.from(stored.slice(prefix.length), 'base64').toString() : stored;
}

/** Build one content-free database status row. */
function statusRow(hash, status = 'pending') {
  return {
    reply_id: REPLY_ID, status, provider: 'google', attempt_count: status === 'pending' ? 0 : 1,
    provider_message_id: status === 'sent' ? 'gmail-sent-1' : null, delivery_error: null,
    created_at: '2026-08-06T00:00:00Z', updated_at: '2026-08-06T00:00:00Z',
    sent_at: status === 'sent' ? '2026-08-06T00:00:01Z' : null, request_hash: hash,
  };
}

/** Recording response used by direct invocation of compiled Express handlers. */
function fakeRes() {
  return {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

/** Authenticated request with an exact Idempotency-Key header. */
function authedReq(body, key = KEY) {
  return {
    oidc: { user: { sub: 'owner-1' } }, body, params: {}, query: {},
    get(name) { return name.toLowerCase() === 'idempotency-key' ? key : undefined; },
  };
}

/** In-memory SQL boundary for enqueue/status route behavior. */
function makeRoutePool(options = {}) {
  const queries = [];
  const byKey = new Map();
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/SELECT from_addr, subject, category FROM oshal_inbox_messages/.test(sql)) {
        return { rows: options.source === null ? [] : [options.source || { from_addr: 'Sam <sam@example.com>', subject: 'Status', category: 'primary' }], rowCount: options.source === null ? 0 : 1 };
      }
      if (/JOIN oshal_connections/.test(sql) && /workspace_accounts/.test(sql)) {
        return { rows: options.workspaceAllowed === false ? [] : [{ '?column?': 1 }], rowCount: options.workspaceAllowed === false ? 0 : 1 };
      }
      if (/INSERT INTO oshal_switchboard_reply_outbox/.test(sql)) {
        const key = `${params[0]}:${params[1]}`;
        if (byKey.has(key)) return { rows: [], rowCount: 0 };
        const row = {
          ...statusRow(params[2]), workspace_id: params[8], source_message_id_ciphertext: params[4],
          recipient_ciphertext: params[5], subject_ciphertext: params[6], body_ciphertext: params[7],
        };
        byKey.set(key, row);
        return { rows: [row], rowCount: 1 };
      }
      if (/WHERE user_sub=\$1 AND idempotency_key=\$2/.test(sql)) {
        const row = byKey.get(`${params[0]}:${params[1]}`);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (/WHERE user_sub=\$1 AND reply_id=\$2/.test(sql)) {
        const row = options.statusRow || statusRow('a'.repeat(64), 'sent');
        return { rows: params[1] === REPLY_ID ? [row] : [], rowCount: params[1] === REPLY_ID ? 1 : 0 };
      }
      if (/WHERE user_sub=\$1 ORDER BY created_at DESC/.test(sql)) {
        return { rows: [options.statusRow || statusRow('a'.repeat(64), 'sent')], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return { pool, queries, byKey };
}

/** Load the exact compiled route bytes with only framework boundaries replaced. */
function loadRoute(options = {}) {
  const handlers = { get: new Map(), post: new Map() };
  const fakeRouter = {
    get(route, handler) { handlers.get.set(route, handler); return this; },
    post(route, handler) { handlers.post.set(route, handler); return this; },
  };
  const sends = [];
  const systemRuns = [];
  const schemaCalls = [];
  const stubs = {
    express: { Router: () => fakeRouter },
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => options.token === undefined ? 'token-1' : options.token },
    '@/app/routes/email-routes': {
      sendGmail: async (token, message) => {
        sends.push({ token, message });
        if (options.sendError) throw new Error(options.sendError);
        return { id: 'gmail-sent-1' };
      },
    },
    '@/shared/security/explicit-write-confirmation': {
      hasExplicitWriteConfirmation: (body) => !!body && body.confirm === true,
      confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm: true.` }),
    },
    '@/shared/services/database': {
      buildOwnerRlsPolicyStatements: () => ['RLS'],
      runRuntimeSchemaBootstrap: async (arg) => { schemaCalls.push(arg); },
    },
    '@/shared/services/database/request-identity': {
      runWithSystemIdentity: async (fn) => { systemRuns.push(true); return fn(); },
    },
    '@/features/personal-data': {
      encryptField: encrypt,
      decryptField: decrypt,
      isEncrypted: (value) => typeof value === 'string' && value.startsWith('v1:'),
    },
    './switchboard-reply-outbox-model': realModel,
  };
  const shimRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    throw new Error(`unexpected require in reply route: ${id}`);
  };
  const code = fs.readFileSync(ROUTE_FILE, 'utf8');
  const mod = { exports: {} };
  const previous = process.env.SWITCHBOARD_REPLY_EXECUTOR;
  process.env.SWITCHBOARD_REPLY_EXECUTOR = 'false';
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)(
    shimRequire, mod, mod.exports, ROUTE_FILE, path.dirname(ROUTE_FILE),
  );
  if (previous === undefined) delete process.env.SWITCHBOARD_REPLY_EXECUTOR;
  else process.env.SWITCHBOARD_REPLY_EXECUTOR = previous;
  return { handlers, mod: mod.exports, sends, systemRuns, schemaCalls };
}

/** Load the compiled parent to prove the new router is reachable through /api/switchboard. */
function parentMounts() {
  const file = path.join(PKG, 'routes', 'switchboard-routes.js');
  const uses = [];
  const router = {
    get() { return this; }, post() { return this; }, patch() { return this; },
    put() { return this; }, delete() { return this; },
    use(route, child) { uses.push({ route, child }); return this; },
  };
  const child = (name) => ({ name });
  const stubs = {
    express: { Router: () => router }, path,
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/email-routes': { summarizeGmailMetadata: () => ({}) },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    './switchboard-inbox-routes': { createInboxRoutes: () => child('inbox') },
    './switchboard-calendar-routes': { createCalendarRoutes: () => child('calendar') },
    './switchboard-compose-routes': { createComposeRoutes: () => child('compose') },
    './switchboard-threads-routes': { createThreadsRoutes: () => child('threads') },
    './switchboard-stage-routes': { createStageRoutes: () => child('stage') },
    './switchboard-reply-outbox-routes': { createReplyOutboxRoutes: () => child('replies') },
    './switchboard-streams-routes': { createStreamsRoutes: () => child('streams') },
  };
  const code = fs.readFileSync(file, 'utf8');
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)(
    (id) => {
      if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
      throw new Error(`unexpected parent require: ${id}`);
    }, mod, mod.exports, file, path.dirname(file),
  );
  mod.exports.createSwitchboardRoutes({ pool: { query: async () => ({ rows: [], rowCount: 0 }) }, appPackageDir: PKG });
  return uses;
}

test('compiled router wires enqueue plus owner status routes', () => {
  const db = makeRoutePool();
  const loaded = loadRoute();
  loaded.mod.createReplyOutboxRoutes({ pool: db.pool });
  assert.ok(loaded.handlers.post.has('/outbox'));
  assert.ok(loaded.handlers.get.has('/outbox'));
  assert.ok(loaded.handlers.get.has('/outbox/:id'));
});

test('compiled parent mounts the reply router exactly once under /replies', () => {
  const mounts = parentMounts().filter((entry) => entry.route === '/replies');
  assert.deepEqual(mounts, [{ route: '/replies', child: { name: 'replies' } }]);
});

test('authentication and literal confirmation happen before every database or provider operation', async () => {
  const db = makeRoutePool();
  const loaded = loadRoute();
  loaded.mod.createReplyOutboxRoutes({ pool: db.pool });
  const handler = loaded.handlers.post.get('/outbox');
  const unauth = fakeRes();
  await handler({ oidc: {}, body: { ...validBody(), confirm: true }, get: () => KEY }, unauth);
  assert.equal(unauth.statusCode, 401);
  const unconfirmed = fakeRes();
  await handler(authedReq({ ...validBody(), confirm: 'true' }), unconfirmed);
  assert.equal(unconfirmed.statusCode, 428);
  assert.equal(db.queries.length, 0);
  assert.equal(loaded.sends.length, 0);
});

/** One valid, source-bound reply request. */
function validBody(overrides = {}) {
  return { sourceMessageId: 'gmail-msg-1', body: 'Exact approved reply.', confirm: true, ...overrides };
}

test('missing idempotency key fails before source lookup', async () => {
  const db = makeRoutePool();
  const loaded = loadRoute();
  loaded.mod.createReplyOutboxRoutes({ pool: db.pool });
  const res = fakeRes();
  await loaded.handlers.post.get('/outbox')(authedReq(validBody(), ''), res);
  assert.equal(res.statusCode, 400);
  assert.equal(db.queries.length, 0);
});

test('confirmed enqueue derives recipient/subject from the owned source and encrypts every content field', async () => {
  const db = makeRoutePool({ source: { from_addr: 'Sam <sam@example.com>', subject: 'Status', category: 'primary' } });
  const loaded = loadRoute();
  loaded.mod.createReplyOutboxRoutes({ pool: db.pool });
  const res = fakeRes();
  await loaded.handlers.post.get('/outbox')(authedReq(validBody({ to: 'attacker@example.com' })), res);
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.deduplicated, false);
  const insert = db.queries.find((q) => /INSERT INTO oshal_switchboard_reply_outbox/.test(q.sql));
  assert.ok(insert);
  assert.equal(decrypt('owner-1', insert.params[4]), 'gmail-msg-1');
  assert.equal(decrypt('owner-1', insert.params[5]), 'sam@example.com');
  assert.equal(decrypt('owner-1', insert.params[6]), 'Re: Status');
  assert.equal(decrypt('owner-1', insert.params[7]), 'Exact approved reply.');
  assert.ok(insert.params.slice(4, 8).every((value) => !String(value).includes('attacker@example.com')));
  assert.equal(loaded.sends.length, 0, 'HTTP enqueue never bypasses the durable worker');
});

test('unknown or non-replyable sources fail closed without an outbox insert', async () => {
  for (const source of [null, { from_addr: 'not an address', subject: 'Status', category: 'primary' }]) {
    const db = makeRoutePool({ source });
    const loaded = loadRoute();
    loaded.mod.createReplyOutboxRoutes({ pool: db.pool });
    const res = fakeRes();
    await loaded.handlers.post.get('/outbox')(authedReq(validBody()), res);
    assert.ok([404, 409].includes(res.statusCode));
    assert.equal(db.queries.filter((q) => /INSERT INTO/.test(q.sql)).length, 0);
  }
});

test('workspace excluding Google rejects before insert', async () => {
  const db = makeRoutePool({ workspaceAllowed: false });
  const loaded = loadRoute();
  loaded.mod.createReplyOutboxRoutes({ pool: db.pool });
  const res = fakeRes();
  await loaded.handlers.post.get('/outbox')(authedReq(validBody({ workspaceId: '11111111-2222-4333-8444-555555555555' })), res);
  assert.equal(res.statusCode, 403);
  assert.equal(db.queries.filter((q) => /INSERT INTO/.test(q.sql)).length, 0);
});

test('same key and exact request deduplicates; changed content with that key is a 409 conflict', async () => {
  const db = makeRoutePool();
  const loaded = loadRoute();
  loaded.mod.createReplyOutboxRoutes({ pool: db.pool });
  const handler = loaded.handlers.post.get('/outbox');
  const first = fakeRes();
  await handler(authedReq(validBody()), first);
  assert.equal(first.statusCode, 202);
  const replay = fakeRes();
  await handler(authedReq(validBody()), replay);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.deduplicated, true);
  const changed = fakeRes();
  await handler(authedReq(validBody({ body: 'Different reply.' })), changed);
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.body.error, 'idempotency_conflict');
});

test('durable replay returns the original row even after the mutable source inbox row is gone', async () => {
  const options = {};
  const db = makeRoutePool(options);
  const loaded = loadRoute();
  loaded.mod.createReplyOutboxRoutes({ pool: db.pool });
  const handler = loaded.handlers.post.get('/outbox');
  const first = fakeRes();
  await handler(authedReq(validBody()), first);
  assert.equal(first.statusCode, 202);
  options.source = null;
  const replay = fakeRes();
  await handler(authedReq(validBody()), replay);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.deduplicated, true);
  assert.equal(db.queries.filter((query) => /SELECT from_addr/.test(query.sql)).length, 1);
});

test('owner status endpoint returns no encrypted content columns', async () => {
  const db = makeRoutePool();
  const loaded = loadRoute();
  loaded.mod.createReplyOutboxRoutes({ pool: db.pool });
  const req = authedReq({}); req.params = { id: REPLY_ID };
  const res = fakeRes();
  await loaded.handlers.get.get('/outbox/:id')(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply.status, 'sent');
  assert.doesNotMatch(JSON.stringify(res.body), /ciphertext|secret|recipient|subject|body/i);
  const statusQuery = db.queries.at(-1);
  assert.match(statusQuery.sql, /WHERE user_sub=\$1 AND reply_id=\$2/);
});

/** Atomic executor pool with one pending encrypted reply. */
function makeExecutorPool(claimOverrides = {}) {
  const queries = [];
  const state = { status: 'pending', claimCount: 0, settlement: null };
  const claim = {
    reply_id: REPLY_ID, user_sub: 'owner-1', provider: 'google', claim_token: 'claim-1',
    request_hash: realModel.replyRequestHash({
      idempotencyKey: '', sourceMessageId: 'gmail-msg-1', body: 'Approved', workspaceId: null,
      provider: 'google', recipient: 'sam@example.com', subject: 'Re: Status',
    }),
    workspace_id: null, source_message_id_ciphertext: encrypt('owner-1', 'gmail-msg-1'),
    recipient_ciphertext: encrypt('owner-1', 'sam@example.com'),
    subject_ciphertext: encrypt('owner-1', 'Re: Status'), body_ciphertext: encrypt('owner-1', 'Approved'),
    ...claimOverrides,
  };
  return {
    state, queries,
    pool: {
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (/claim_expired_manual_review_required/.test(sql)) return { rows: [], rowCount: 0 };
        if (/FOR UPDATE SKIP LOCKED/.test(sql)) {
          if (state.status !== 'pending') return { rows: [], rowCount: 0 };
          state.status = 'sending'; state.claimCount += 1;
          return { rows: [claim], rowCount: 1 };
        }
        if (/WHERE reply_id=\$1 AND claim_token=\$2/.test(sql)) {
          state.status = params[2]; state.settlement = { providerId: params[3], error: params[4] };
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unexpected executor SQL: ${sql}`);
      },
    },
  };
}

test('executor claims atomically, sends exact decrypted content once, and settles sent', async () => {
  const db = makeExecutorPool();
  const loaded = loadRoute();
  const count = await loaded.mod.runReplyOutboxBatch({ pool: db.pool }, 10);
  assert.equal(count, 1);
  assert.equal(loaded.systemRuns.length, 1);
  assert.equal(db.state.claimCount, 1);
  assert.deepEqual(loaded.sends, [{ token: 'token-1', message: { to: 'sam@example.com', subject: 'Re: Status', body: 'Approved' } }]);
  assert.equal(db.state.status, 'sent');
  assert.deepEqual(db.state.settlement, { providerId: 'gmail-sent-1', error: null });
  assert.ok(db.queries.some((q) => /FOR UPDATE SKIP LOCKED/.test(q.sql)));
});

test('provider exception becomes terminal uncertain and is never claimed again', async () => {
  const db = makeExecutorPool();
  const loaded = loadRoute({ sendError: 'connection reset after upload' });
  assert.equal(await loaded.mod.runReplyOutboxBatch({ pool: db.pool }, 10), 1);
  assert.equal(db.state.status, 'uncertain');
  assert.equal(db.state.settlement.error, 'provider_result_unknown_manual_review_required');
  assert.equal(await loaded.mod.runReplyOutboxBatch({ pool: db.pool }, 10), 0);
  assert.equal(db.state.claimCount, 1, 'an ambiguous provider result must never auto-retry');
  assert.equal(loaded.sends.length, 1);
});

test('missing connector token fails before provider invocation', async () => {
  const db = makeExecutorPool();
  const loaded = loadRoute({ token: null });
  assert.equal(await loaded.mod.runReplyOutboxBatch({ pool: db.pool }, 10), 1);
  assert.equal(db.state.status, 'failed');
  assert.equal(db.state.settlement.error, 'delivery_not_attempted');
  assert.equal(loaded.sends.length, 0);
});

test('plaintext or corrupt stored content fails closed before token or provider use', async () => {
  const db = makeExecutorPool({ body_ciphertext: 'Approved but not encrypted' });
  const loaded = loadRoute();
  assert.equal(await loaded.mod.runReplyOutboxBatch({ pool: db.pool }, 10), 1);
  assert.equal(db.state.status, 'failed');
  assert.equal(db.state.settlement.error, 'delivery_not_attempted');
  assert.equal(loaded.sends.length, 0);
});

test('validly encrypted content mutation fails its request digest before provider use', async () => {
  const db = makeExecutorPool({ body_ciphertext: encrypt('owner-1', 'Tampered body') });
  const loaded = loadRoute();
  assert.equal(await loaded.mod.runReplyOutboxBatch({ pool: db.pool }, 10), 1);
  assert.equal(db.state.status, 'failed');
  assert.equal(db.state.settlement.error, 'delivery_not_attempted');
  assert.equal(loaded.sends.length, 0);
});
