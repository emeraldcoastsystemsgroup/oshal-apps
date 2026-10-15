/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 9: while every configured model failed, POST /rooms/ask answered 500
 *   {"error":"internal_error"} though the kernel had refused the turn with its reason. Through the COMPILED routes with the real
 *   room registry and reply parser: a bot turn that rejects the way the native bridge rejects a refused intent (an Error whose
 *   message is the kernel's reason, crates/host-process/bridge/runner.js host_result) answers 503 model_unavailable on
 *   /rooms/ask and /chat, with "message" naming what happened and the reason, "detail" the bounded reason, and nothing pushed to
 *   the room or saved; the busy answer and a working reply are unchanged. Named seams: the logger, the bot turn and the two
 *   database-backed engine services.
 */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const ROUTES_DIR = path.resolve(__dirname, '..', 'routes');
const KERNEL_REASON = 'unavailable: provider unavailable: every configured model failed - vllm/bot-fast: connection error; then ollama/qwen3:4b: no answer within 30000 ms';
let botImpl = async () => ({ response: '{"say":"Boo.","expression":"spooky","intensity":0.8}' });
const saved = [];

class FakePresetService { async ensureSchema() {} async listPresets() { return []; } async getPreset() { return null; } async getSettings() { return {}; } async saveSettings() {} }
class FakeResponseService { async ensureSchema() {} async record(sub, candidate) { saved.push({ sub, candidate }); return { id: 's', ...candidate }; } async list() { return []; } async get() { return null; } async markPlayed() {} }

let handlers = null;
const origLoad = Module._load;
Module._load = function shimmedLoad(request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  if (request === '@/shared/services/database') return { buildOwnerRlsPolicyStatements: () => [] };
  if (request === '@/shared/middleware/authz') return { hasValidServiceSecret: () => false, getTrustedServiceUserSub: () => null, getCaller: () => ({}), isOperatorIdentity: () => false };
  if (request === '@/features/agent-management') return { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null };
  if (request === '@/app/routes/inline-bot-execution') return { executeBotOrInline: async (_c, _b, _a, payload) => botImpl(payload) };
  if (request === 'express') {
    return { Router: () => { handlers = new Map(); const rec = (m) => (p, ...fns) => { handlers.set(`${m} ${p}`, fns[fns.length - 1]); }; return { get: rec('GET'), post: rec('POST'), put: rec('PUT'), patch: rec('PATCH'), delete: rec('DELETE'), use() {} }; } };
  }
  if (request === './pumpkin-engine') return engine;
  return origLoad.call(this, request, ...rest);
};
const registry = require(path.join(ROUTES_DIR, 'pumpkin-engine-room-registry.js'));
const engine = { ...registry, parsePumpkinReply: require(path.join(ROUTES_DIR, 'pumpkin-engine-reply.js')).parsePumpkinReply, PumpkinPresetService: FakePresetService, PumpkinResponseService: FakeResponseService };
const { createPumpkinRoutes } = require(path.join(ROUTES_DIR, 'pumpkin-routes.js'));
createPumpkinRoutes({ pool: { query: async () => ({ rows: [] }) }, appPackageDir: path.resolve(__dirname, '..') });
test.after(() => { Module._load = origLoad; });

const browser = (sub, body) => ({ headers: {}, body, query: {}, params: {}, path: '/', oidc: { isAuthenticated: () => true, user: { sub } }, on() {} });
async function call(route, req) {
  const res = { statusCode: 200, body: undefined, headersSent: false, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; }, setHeader() {} };
  await handlers.get(route)(req, res);
  return res;
}

test('a refused bot turn answers 503 model_unavailable with the kernel\'s reason, and nothing is spoken or saved', async () => {
  const { room, token } = registry.pumpkinRooms.register('owner-1', 'Front Porch');
  const cursor = registry.pumpkinRooms.poll('owner-1', room, 'screen', null).cursor;
  botImpl = async () => { throw new Error(KERNEL_REASON); };
  const asked = await call('POST /rooms/ask', browser('owner-1', { room, token, text: 'trick or treat' }));
  assert.equal(asked.statusCode, 503, JSON.stringify(asked.body));
  assert.equal(asked.body.error, 'model_unavailable');
  assert.match(asked.body.message, /^The pumpkin's voice model did not answer, so nothing was spoken\. Try again in a minute\. \(unavailable: provider unavailable: every configured model failed/);
  assert.equal(asked.body.detail, KERNEL_REASON);
  const chat = await call('POST /chat', browser('owner-1', { text: 'hello' }));
  assert.deepEqual([chat.statusCode, chat.body.error], [503, 'model_unavailable']);
  assert.equal(saved.length, 0, 'no line is saved when nothing was said');
  assert.deepEqual(registry.pumpkinRooms.poll('owner-1', room, 'screen', cursor).events, [], 'nothing is pushed to the room');
  botImpl = async () => ({ response: '{"say":"Boo.","expression":"spooky","intensity":0.8}' });
  assert.equal((await call('POST /rooms/ask', browser('owner-1', { room, token, text: 'boo' }))).statusCode, 200);
  assert.equal(registry.pumpkinRooms.poll('owner-1', room, 'screen', cursor).events.length, 1, 'the room does receive a line that was said');
});

test('a long reason is bounded to one line and a working reply is unchanged', async () => {
  botImpl = async () => { throw new Error('x'.repeat(500) + '\n' + 'y'); };
  const res = await call('POST /chat', browser('owner-2', { text: 'hello' }));
  assert.equal(res.body.detail.length, 300);
  assert.doesNotMatch(res.body.detail, /\n/);
  botImpl = async () => ({ response: '{"say":"Boo.","expression":"spooky","intensity":0.8}' });
  const ok = await call('POST /chat', browser('owner-2', { text: 'hello' }));
  assert.deepEqual([ok.statusCode, ok.body.reply.say], [200, 'Boo.']);
});
