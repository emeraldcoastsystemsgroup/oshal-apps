/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The day summary is sealed by the kernel with no SESSION_SECRET in the process, a summary from the earlier platform reads as none, and POST /summary saves what the model answered. The seal here is a double; the real kernel seal is crates/oshald/tests/personal_data_intent.rs, and the summary was proven on the Docker dev kernel.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const SEALED = 'opd1:';
const calls = [];
let openFailure = null;
const personalData = {
  isEncrypted: (value) => typeof value === 'string' && (value.startsWith(SEALED) || value.startsWith('v1:')),
  encryptField: async (owner, value) => { calls.push(['seal', owner]); return `${SEALED}${owner}:${Buffer.from(value).toString('base64')}`; },
  decryptField: async (owner, value) => {
    calls.push(['open', owner]);
    if (openFailure) throw openFailure;
    return Buffer.from(value.split(':')[2], 'base64').toString();
  },
};
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; }; return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), use() {} }; } },
  '@/features/personal-data': personalData,
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
  '@/shared/skill-profiles': { resolveSkillProfileByApp: () => null, composeSkillProfilePrompt: (p) => p },
  '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
  '@/app/routes/free-tier-rotation': { resolveUserLlmConnection: async () => null },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: 'Reply to Dana today.' }) },
  '@/app/routes/email-routes': { sendGmail: async () => ({}), sendOutlookMail: async () => ({}), summarizeGmailMetadata: () => ({}) },
  '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: () => false, confirmationRequiredPayload: () => ({}) },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { openDigest, sealDigest } = require('../routes/digest-seal.js');
const { createEmailRoutes } = require('../routes/email-app-routes.js');
test.after(() => { Module._load = original; });
test.beforeEach(() => { calls.length = 0; openFailure = null; delete process.env.SESSION_SECRET; });

test('a summary is sealed for its owner and opens again with no SESSION_SECRET in the process', async () => {
  const sealed = await sealDigest('alice', 'Reply to Dana.');
  assert.ok(sealed.startsWith(SEALED));
  assert.ok(!sealed.includes('Reply to Dana'));
  assert.equal(await openDigest('alice', sealed), 'Reply to Dana.');
  assert.deepEqual(calls, [['seal', 'alice'], ['open', 'alice']]);
});

test('a summary from the earlier platform reads as none, and the kernel is not asked to open it', async () => {
  assert.equal(await openDigest('alice', 'aXY=:dGFn:Y2lwaGVy'), null);
  assert.deepEqual(calls, []);
});

test('only the reentry refusal reads as none: another failure is not "nothing saved"', async () => {
  openFailure = Object.assign(new Error('old key'), { code: 'personal_data_reentry_required' });
  assert.equal(await openDigest('alice', 'v1:old'), null);
  openFailure = Object.assign(new Error('kernel down'), { code: 'host_unavailable' });
  await assert.rejects(openDigest('alice', `${SEALED}x:eA==`), /kernel down/);
});

test('POST /summary saves what the model answered, sealed, and the cached read returns it', async () => {
  process.env.EMAIL_DEMO_MAIL = '1';
  const stored = new Map(), writes = [];
  const pool = { query: async (sql, params) => {
    assert.doesNotMatch(sql, /ON CONFLICT/, 'the native kernel refuses it on this table');
    if (/^(INSERT INTO|UPDATE) oshal_email_digests/.test(sql)) { writes.push(sql.split(' ')[0]); stored.set(params[0], params[1]); return { rows: [] }; }
    if (/FROM oshal_email_digests/.test(sql)) return { rows: stored.has(params[0]) ? [{ user_sub: params[0], summary: stored.get(params[0]), updated_at: 'now' }] : [] };
    return { rows: [] };
  } };
  const answer = () => ({ statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; } });
  const req = { oidc: { user: { sub: 'alice' } }, query: { provider: 'google' }, params: {}, body: {}, headers: {} };
  const routes = createEmailRoutes({ pool, intent: async () => ({ connections: [] }) }).routes;
  const made = answer();
  try {
    await routes['POST /summary'](req, made);
    await routes['POST /summary'](req, answer());
  } finally {
    delete process.env.EMAIL_DEMO_MAIL;
  }
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  assert.equal(made.body.summary, 'Reply to Dana today.');
  assert.ok(stored.get('alice').startsWith(SEALED), 'the stored row is sealed');
  assert.deepEqual(writes, ['INSERT', 'UPDATE'], 'added the first time, replaced after');
  const read = answer();
  await routes['GET /summary/cached'](req, read);
  assert.equal(read.body.cached.summary, 'Reply to Dana today.');
});
