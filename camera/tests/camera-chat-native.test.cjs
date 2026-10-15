/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Camera Ops concierge (POST /chat) asks this package's own declared camera-operator through the bot
 *   turn (executeBotOrInline), never ctx.orchestrator, and a runtime with no camera answers its own availability reason with no model call
 *   and no command instead of throwing native_executor_unavailable from the default-camera telemetry fallback; an empty fleet never reads
 *   telemetry, because the native runtime fails the whole call on any unavailable engine read, caught or not.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const OPERATOR = 'b0200000-0000-0000-0000-000000000001';
const unavailable = () => Object.assign(new Error('camera telemetry is unavailable in this native runtime'), { code: 'native_executor_unavailable' });
class CameraCommandError extends Error {}
class CameraConfirmationRequiredError extends Error {}
const engine = { telemetry: null, fleet: [], availability: undefined, executed: [], reads: 0 };
class CameraService {
  constructor() { if (engine.availability) this.availability = engine.availability; }
  list() { return engine.fleet; }
  getTelemetry() { engine.reads += 1; if (!engine.telemetry) throw unavailable(); return engine.telemetry; }
  async execute(cameraId, command) { engine.executed.push([cameraId, command.op]); return { ...engine.telemetry, mode: command.op }; }
}
const turns = [];
const bot = { reply: '{"say":"Recording now.","action":{"op":"record"}}' };
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...f) => { routes[`${m} ${p}`] = f[f.length - 1]; }; return { routes, get: add('GET'), post: add('POST') }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => undefined },
  '@/shared/middleware/authz': { getTrustedServiceUserSub: () => null, hasValidServiceSecret: () => false },
  '@/features/camera': {
    CameraService, CameraCommandError, CameraConfirmationRequiredError, DEFAULT_CAMERA_ID: 'cam-default',
    normalizeCameraCommand: (a) => (a && a.op ? { command: { op: a.op }, errors: [] } : { command: null, errors: a ? ['bad op'] : [] }),
  },
  '@/app/routes/concierge-envelope': {
    extractEnvelopeJson: (t) => { try { return JSON.parse(t); } catch { return null; } },
    sayOr: (o, f) => String(o.say || f || ''),
  },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/inline-bot-execution': {
    executeBotOrInline: async (_ctx, _client, agentId, params) => { turns.push({ agentId, params }); return { response: bot.reply }; },
  },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createCameraRoutes } = require('../routes/camera-routes.js');
test.after(() => { Module._load = original; });

function call(body) {
  const pool = { query: async () => ({ rows: [] }) };
  const orchestrator = { processMessage: async () => { throw new Error('the platform orchestrator must not be used'); } };
  const { routes } = createCameraRoutes({ pool, orchestrator, appPackageDir: path.resolve(__dirname, '..') });
  const req = { body, params: {}, query: {}, oidc: { user: { sub: 'alice' }, isAuthenticated: () => true } };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; } };
  return routes['POST /chat'](req, res).then(() => res);
}

test('a runtime with no camera answers its own reason, with no model call and no command', async () => {
  Object.assign(engine, { telemetry: null, fleet: [], executed: [], reads: 0,
    availability: { native: true, configured: false, reason: 'no_camera_node', detail: 'No camera node is registered with this native runtime, so there are no cameras to show.' } });
  turns.length = 0;
  const res = await call({ message: 'start recording' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.available, false);
  assert.equal(res.body.reason, 'no_camera_node');
  assert.match(res.body.reply, /No camera node is registered/);
  assert.equal(turns.length, 0);
  assert.deepEqual(engine.executed, []);
  assert.equal(engine.reads, 0, 'the native runtime fails the whole call on an unavailable read, even a caught one');
});

test('with a camera the concierge asks the declared camera-operator through the bot turn and runs one command', async () => {
  Object.assign(engine, { telemetry: { status: 'ready', mode: 'video', recording: false, batteryPct: 80, previewActive: false, model: 'sim' },
    fleet: [{ cameraId: 'cam-default', kind: 'sim', online: true }], executed: [], availability: undefined });
  turns.length = 0;
  const res = await call({ message: 'start recording' });
  assert.equal(res.statusCode, 200);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].agentId, OPERATOR);
  assert.equal(turns[0].params.agentId, OPERATOR);
  assert.equal(res.body.reply, 'Recording now.');
  assert.deepEqual(engine.executed, [['cam-default', 'record']]);
});

test('the declared camera-operator is the bot the route names', () => {
  const manifest = fs.readFileSync(path.resolve(__dirname, '../oshal-app.yaml'), 'utf8');
  assert.match(manifest, new RegExp(`agentId:\\s*${OPERATOR}\\s*\\n\\s*name:\\s*camera-operator`));
});
