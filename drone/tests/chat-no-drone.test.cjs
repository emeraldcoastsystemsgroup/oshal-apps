/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | K4 regression: with no drone registered POST /api/drone/chat answered 503 'drone.getState is unavailable in this native runtime' and the chat printed 'Error: drone.getState is unavailable…'. The fallback after a failed getState(droneId) called getState() again, which the native bridge throws the same way. Drives the compiled route with a double of the native DroneService (availability marker configured:false, every read throws, as crates/host-process/bridge/unavailable_executor_services.js does) and with an engine whose reads fail without a marker: both answer 200 { noDrone: true, draft: null } in plain words, never call the planner and never draft. The surface's own applyFleetAvailability keeps the chat input and Send off with the reason, and a chat failure reads in plain words.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Draft show is switched off (with the reason) while no drone is registered, like the other flight commands; it answered "pattern generation failed" before.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SUB = 'synthetic-sub';
delete process.env.MOCK_OIDC;
const UNAVAILABLE = (name) => Object.assign(new Error(`${name} is unavailable in this native runtime`), { code: 'native_executor_unavailable' });

/** The native runtime's drone service: no fleet, no fence, an availability marker, every read throws. */
class NativeDroneService {
  get fence() { return null; }
  get availability() { return { native: true, configured: false, reason: 'no_drone_node', detail: 'No drone or flight simulator is registered with this native runtime, so there are no drones to show.' }; }
  listFleet() { return []; }
  getState() { throw UNAVAILABLE('drone.getState'); }
}
/** An engine with no marker whose drone reads fail (a node that dropped and an embedded sim that is not there). */
class UnreadableDroneService {
  get fence() { return null; }
  listFleet() { return []; }
  getState() { throw new Error('drone not found'); }
}

/** Load the compiled route module over a recording router with the given drone service. */
function load(DroneService) {
  const routes = []; const router = {};
  const seen = { planner: 0, messages: [], queries: [] };
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach((m) => { router[m] = (p, ...fns) => { routes.push({ method: m, path: p, handler: fns[fns.length - 1] }); }; });
  const stubs = {
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/services/database': { runRuntimeSchemaBootstrap: () => Promise.resolve(), buildOwnerRlsPolicyStatements: () => [] },
    '@/shared/middleware/authz': { getTrustedServiceUserSub: () => null, hasValidServiceSecret: () => false },
    '@/features/drone': { DroneService, FleetShowRunner: class {}, DroneValidationError: class extends Error {}, DroneCommandError: class extends Error {}, DEFAULT_DRONE_ID: 'alpha' },
    '@/app/routes/concierge-envelope': { extractEnvelopeJson: () => null, sayOr: (v, d) => v || d },
    '@/app/routes/concierge-store': { ConciergeStore: class {
      async ensureConversation() { return 'conv-1'; }
      async addMessage(id, sub, role, text) { seen.messages.push([role, text]); }
      async loadHistory() { return []; }
      async touch() {}
    } },
    '@/features/location': { locatedDevice: async () => null },
  };
  const req = (name) => {
    if (name === 'express') return { Router: () => router };
    if (['path', 'fs', 'crypto'].includes(name)) return require(name);
    assert.ok(Object.prototype.hasOwnProperty.call(stubs, name), 'unexpected import: ' + name);
    return stubs[name];
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', fs.readFileSync(path.join(ROOT, 'routes/drone-routes.js'), 'utf8'))(req, mod, mod.exports, path.join(ROOT, 'routes'));
  const pool = { query: async (text) => { seen.queries.push(String(text)); return { rows: [] }; } };
  const orchestrator = { processMessage: async () => { seen.planner += 1; return { response: '{"say":"drafted"}' }; } };
  mod.exports.createDroneRoutes({ pool, appPackageDir: ROOT, orchestrator });
  return { routes, seen };
}

/** One signed-in POST /chat. */
async function chat(routes, body) {
  const found = routes.filter((r) => r.method === 'post' && r.path === '/chat');
  assert.equal(found.length, 1);
  const res = { statusCode: 200, body: undefined, setHeader() {}, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; } };
  await found[0].handler({ oidc: { user: { sub: SUB }, isAuthenticated: () => true }, params: {}, query: {}, body, path: '/chat' }, res);
  return res;
}

test('on the native runtime with no drone the chat answers a plain no-drone reply, never the raw executor error, and drafts nothing', async () => {
  const { routes, seen } = load(NativeDroneService);
  const res = await chat(routes, { message: 'fly a 100m box at 40m and come home' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.noDrone, true);
  assert.equal(res.body.draft, null);
  assert.match(res.body.reply, /No drone or flight simulator is registered/);
  assert.doesNotMatch(JSON.stringify(res.body), /getState|native runtime|unavailable/);
  assert.equal(seen.planner, 0, 'the planner is not asked');
  assert.ok(!seen.queries.some((q) => /INSERT INTO drone_missions/.test(q)), 'no mission row is written');
});

test('when every drone read fails without a marker the chat still answers the plain no-drone reply instead of a 503', async () => {
  const { routes, seen } = load(UnreadableDroneService);
  const res = await chat(routes, { message: 'orbit the house', droneId: 'beta' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.noDrone, true);
  assert.equal(res.body.conversationId, 'conv-1');
  assert.equal(res.body.draft, null);
  assert.equal(seen.planner, 0);
  assert.deepEqual(seen.messages.map((m) => m[0]), ['user', 'assistant'], 'the reply is kept in the conversation');
});

const PAGE = fs.readFileSync(path.join(ROOT, 'tools', 'drone-ops.html'), 'utf8');

test('the surface keeps the operator chat off with the reason while no drone is registered', () => {
  const source = PAGE.match(/function applyFleetAvailability\(r\) \{[\s\S]*?\n\}\n/);
  assert.ok(source, 'applyFleetAvailability is on the page');
  const el = (id) => ({ id, hidden: false, disabled: false, title: '', placeholder: 'e.g.', textContent: '', className: '', innerHTML: '', dataset: {}, getAttribute: () => '' });
  const nodes = { noDroneBanner: el('noDroneBanner'), providerPill: el('providerPill'), statusPill: el('statusPill'), modeGoto: el('modeGoto'), chatInput: el('chatInput') };
  const send = el('send');
  const document = { querySelectorAll: (sel) => (sel === 'button[onclick="sendChat()"]' ? [send] : []) };
  const run = (answer) => new Function('$', 'document', 'esc', 'NO_FENCE', 'FLIGHT_COMMANDS', 'let fleetUnavailable = null;\n' + source[0] + '\napplyFleetAvailability(arguments[5]);')(
    (id) => nodes[id], document, (s) => String(s), 'no fence', /arm|takeoff/, answer);
  run({ configured: false, reason: 'no_drone_node', detail: 'No drone or flight simulator is registered with this native runtime.', fence: null, fleet: [] });
  assert.equal(nodes.chatInput.disabled, true);
  assert.equal(send.disabled, true);
  assert.match(send.title, /none is registered/);
  run({ fleet: [{ droneId: 'alpha' }], fence: { maxRadiusM: 500 } });
  assert.equal(nodes.chatInput.disabled, false, 'with a drone the chat is on');
  assert.equal(send.disabled, false);
});

test('a chat failure reads in plain words, not the raw error', () => {
  const send = PAGE.match(/async function sendChat\(\) \{[\s\S]*?\n\}\n/)[0];
  assert.doesNotMatch(send, /'Error: ' \+ e\.message/);
  assert.match(send, /could not answer just now/);
  assert.match(send, /if \(r\.noDrone\) return;/);
});

test('Draft show is off with the other flight commands while no drone is registered, and back on with its hint when one is', () => {
  const source = PAGE.match(/function applyFleetAvailability\(r\) \{[\s\S]*?\n\}\n/)[0];
  const commands = eval(PAGE.match(/const FLIGHT_COMMANDS = (\/.*\/);/)[1]);
  assert.match(PAGE, /<button class="btn primary" onclick="draftPattern\(\)">Draft show<\/button>/, 'the Draft show button is on the page');
  const el = (id) => ({ id, hidden: false, disabled: false, title: '', placeholder: '', textContent: '', className: '', innerHTML: '', dataset: {} });
  const nodes = { noDroneBanner: el('noDroneBanner'), providerPill: el('providerPill'), statusPill: el('statusPill'), modeGoto: el('modeGoto'), chatInput: el('chatInput') };
  const button = (onclick, title) => Object.assign(el(onclick), { title, getAttribute: () => onclick });
  const show = button('draftPattern()', ''); const ballet = button('draftBallet()', 'A 5-cue timeline');
  const document = { querySelectorAll: (sel) => (sel === 'button[onclick]' ? [show, ballet] : []) };
  const run = (answer) => new Function('$', 'document', 'esc', 'NO_FENCE', 'FLIGHT_COMMANDS', 'let fleetUnavailable = null;\n' + source + '\napplyFleetAvailability(arguments[5]);')(
    (id) => nodes[id], document, (s) => String(s), 'no fence', commands, answer);
  run({ configured: false, reason: 'no_drone_node', detail: 'No drone or flight simulator is registered.', fence: null, fleet: [] });
  assert.equal(show.disabled, true, 'Draft show cannot lay a pattern over zero drones');
  assert.match(show.title, /none is registered/);
  assert.equal(ballet.disabled, true);
  run({ fleet: [{ droneId: 'alpha' }, { droneId: 'beta' }], fence: { maxRadiusM: 500 } });
  assert.equal(show.disabled, false);
  assert.equal(ballet.disabled, false);
  assert.equal(ballet.title, 'A 5-cue timeline', 'its own hint comes back');
});
