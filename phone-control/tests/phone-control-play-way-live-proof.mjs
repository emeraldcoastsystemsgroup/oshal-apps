#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.20.4 (kernel ADR-219 decision 11; the owner, 2026-11-20: "next time it just happens without thought so long as the right devices are online"). The check, on a test slot, that the kernel offers Play a Show on a TV (phone-control-play-show, devicePath how: computer-plan) as a way to a Fire TV this application saved. The kernel shows a declared way in one place only, the answer of its own device.path tool in a person's own Jarvis turn (crates/oshald/src/device_path_tool.rs); no route lists a declaration, and GET /api/devices/paths lists only ways already kept. So `person` makes a made-up person who holds this application's operator role and, where the installation lists a Jarvis application, its chat-user role (a turn is refused without it), a made-up computer (a join code and a join; it never asks for a command, so it reads as not connected and nothing can be sent to it) and a made-up Fire TV saved through the application's own routes (POST /devices, then POST /devices/:id/apps/record with a made-up answer, which hands the kernel's device.inventory.record the TV with its ADB route through that computer). `check` reads the installed version and the inventory record, asks Jarvis how it reaches the TV to play a title, and reads the device.path answer in the reply's tool record: the way through the application's tool, the application, tool and fields the step names, that it may wake the TV and that its check is what the TV says is playing. `remove` forgets the person's kept ways, removes the TV and the computer, takes the role back and deactivates the person. No real device is contacted: the TV's address is a documentation address no device has, and the made-up computer is a record that never connects, so the way reads as not available now and no step can be taken.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.20.4, the same release, from the check's first run on a throwaway kernel (tests/live/play-way-disposable.sh, kernel 2816eff1). A turn with Jarvis was refused (403, "application access is not granted"): the person now also holds the Jarvis application's chat-user role where the installation's catalog lists it. And the way was withheld ("Let Jarvis control this device is off on lantern desk"): a join gives the computer a first presence with no tools, so it reads as connected with its control off for 45 seconds, which is a no; `check` now waits until that time has passed since the join (PLAY_WAY_SETTLE_MS) and then finds the way offered as not available now. `remove` stops before the person is deactivated when one of their records could not be removed, so it can be run again.
 *
 * What it does not prove: that a title plays on a real TV, that a try is recorded and kept, and that a kept way is
 * offered first (the kernel's own chain test covers those with a fixture application:
 * crates/oshald/tests/device_paths_app_tool.rs). The reply depends on Jarvis calling device.path; when it does not,
 * the check exits 2 and nothing is proven either way.
 *
 * On an installation whose test slot copies its device records to another slot (the kernel's dev-mode sync copies the
 * collections join_codes and nodes: crates/oshald/src/dev_mode_auth_sync.rs AUTH_COLLECTIONS), the made-up computer's
 * join code and record are copied there by the kernel, and `remove` takes the computer back through the same copy.
 *
 * Usage (a loopback kernel only; the administrator credential is read by name from the env file and never printed, the
 * person's credential stays in the 0600 person file and the made-up computer's is never kept; all three refuse port 38788):
 *   node phone-control/tests/phone-control-play-way-live-proof.mjs person http://127.0.0.1:38798 <slot env file> <person file>
 *   node phone-control/tests/phone-control-play-way-live-proof.mjs check  http://127.0.0.1:38798 <person file> <out folder>
 *   node phone-control/tests/phone-control-play-way-live-proof.mjs remove http://127.0.0.1:38798 <slot env file> <person file>
 * PLAY_WAY_ASKS (default 2) is how many turns `check` may ask before it says Jarvis did not call device.path.
 * PLAY_WAY_SETTLE_MS (default 50000) is how long after the join `check` waits before it asks: a computer reads as
 * connected, with its control off, for 45 seconds after it joins (crates/nodes/src/commands.rs CONNECTED_MS and
 * crates/nodes/src/enrollment.rs seed_identity), and a way through it is withheld as a no until then.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const APP = 'phone-control';
const TOOL = 'phone-control-play-show';
// The roles the person holds: this application's own devices, and the turn with Jarvis where the kernel lists that application.
const ROLES = [{ app: APP, role: 'operator', needed: true }, { app: 'jarvis', role: 'chat-user', needed: false }];
const NEEDS = [1, 20, 4];
// Made-up names. 192.0.2.0/24 is kept for documentation (RFC 5737): no device has this address.
const TV = 'Lantern Room TV';
const DESK = 'lantern desk';
const ADDRESS = '192.0.2.44:5555';
const APPS_ANSWER = { ok: true, action: 'tv_apps', apps: [], unknownCount: 0, model: 'AFTXX001', maker: 'Maker' };
// The kernel's words (crates/api/src/device_paths_plan.rs how_words, tool_words, wake_words, check_words).
const BY_TOOL = 'an application\'s own tool, run by a plan on your computer';
const HAND = `(a handoff with app ${APP}): its tool ${TOOL} with id: "${TV}", title: the title.`;
const NO_WAKE = 'this way cannot wake it';
const PLAYING = 'what the TV says is playing';
// The made-up computer never connects, so the way is offered as not available now (crates/nodes/src/paths.rs readiness).
const NOT_CONNECTED = /^not now: .*is not connected now$/;
const QUESTION = `Plan the ways to play a title by its name on ${TV}: call device.path for it (job tv.play-title) and tell me the ways it gives. Do not play, wake or press anything.`;

const say = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String((error && error.message) || error).split('\n')[0].slice(0, 300);

/** @description The loopback test slot's origin, or a refusal (never production's port). @param {string} base An address. @returns {string} */
function testSlot(base) {
  const origin = new URL(String(base || '')).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('this proof runs only against a loopback kernel, http://127.0.0.1:<port>');
  if (new URL(origin).port === '38788') throw new Error('this proof writes; it runs on the test slot (http://127.0.0.1:38798), never on production');
  return origin;
}

/** @description The administrator credential from an env file, by name; never printed. @param {string} file The env file. @returns {string} */
function adminToken(file) {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((value) => value.startsWith('OSHAL_ADMIN_TOKEN='));
  if (!line) throw new Error('the env file names no OSHAL_ADMIN_TOKEN');
  return line.slice('OSHAL_ADMIN_TOKEN='.length).trim().replace(/^(['"])(.*)\1$/, '$2');
}

/** @description A JSON file only this user can read. @param {string} file Where. @param {object} value What. @returns {void} */
function privateWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** @description A route as an error may name it: no invitation token, no device or record id. @param {string} route The path. @returns {string} */
function shown(route) {
  return route.split('?')[0].replace(/\/people\/invitations\/[^/]+\/accept/, '/people/invitations/:private/accept')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id').replace(/path-[0-9a-f]{24}/g, ':path');
}

/**
 * @description One request to the kernel's own origin; a failure names the method, the route and the status, nothing else.
 * @param {string} origin The kernel. @param {string} credential A bearer or ''. @param {string} method The method.
 * @param {string} route The path. @param {object} [options] body (JSON), the accepted statuses, headers.
 * @returns {Promise<{status:number,body:any}>} The status and the parsed answer.
 */
async function http(origin, credential, method, route, { body, accepted = [200], headers = {} } = {}) {
  const url = new URL(route, origin);
  if (url.origin !== origin) throw new Error('refusing a request outside the kernel');
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(280000),
    headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  if (!accepted.includes(response.status)) throw new Error(`${method} ${shown(route)}: ${response.status}`);
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; } // an answer that is not JSON has no body to read; its status is what was checked
  return { status: response.status, body: parsed };
}

/**
 * @description Assign or take back one application role for the person (preview, then apply).
 * @returns {Promise<boolean>} False when the installation's catalog lists no such role of an application the check
 *   can do without (an installation with no Jarvis application asks no role for a turn); nothing is assigned then.
 */
async function grant(origin, admin, principal, held, action = 'assign') {
  const catalog = (await http(origin, admin, 'GET', '/api/authorization/composites')).body;
  const listed = (catalog.applications || []).some((entry) => entry.app === held.app && (entry.roles || []).includes(held.role));
  if (action === 'assign' && !listed && !held.needed) return false;
  const input = { target: principal, assignment_id: held.id, action, expected_revision: catalog.revision,
    reason: 'Play a Show way proof (test person)', idempotency_key: randomUUID(),
    ...(action === 'revoke' ? {} : { selection: { kind: 'granular', app: held.app, role: held.role } }) };
  if (action !== 'revoke') input.expected_plan_revision = (await http(origin, admin, 'POST', '/api/authorization/composites/preview', { body: input })).body.plan_revision;
  await http(origin, admin, 'POST', '/api/authorization/composites/apply', { body: input });
  return true;
}

/**
 * @description A made-up computer of the person's: a join code, then a join, and nothing after. Its credential is
 *   dropped here, so nothing can ever ask for a command as it: it stays a record that reads as not connected.
 * @param {string} origin The kernel. @param {string} token The person's credential.
 * @returns {Promise<{id:string,joinedAt:number}>} The computer's id and when it joined.
 */
async function enrol(origin, token) {
  const code = (await http(origin, token, 'POST', '/nodes/join-codes', { body: { lifetime_ms: 120000 } })).body.code;
  const joined = (await http(origin, '', 'POST', '/nodes/join', { body: { code, kind: 'remote', harness: { custom: 'oshal-node-desktop' },
    capabilities: { display: false, shell: true }, machine: randomBytes(16).toString('hex'), name: DESK, platform: 'linux', arch: 'arm64' } })).body;
  return { id: joined.node.id, joinedAt: Date.now() };
}

/** @description The made-up Fire TV, saved through the application's own routes and handed to the kernel's inventory. */
async function saveTv(origin, token, computer) {
  const saved = (await http(origin, token, 'POST', `/api/${APP}/devices`, { accepted: [200, 201],
    body: { name: TV, platform: 'android', form: 'tv', computerNodeId: computer.id, address: ADDRESS } })).body.device;
  const recorded = (await http(origin, token, 'POST', `/api/${APP}/devices/${saved.id}/apps/record`, { body: { reply: APPS_ANSWER } })).body;
  if (!recorded || !recorded.inventory || recorded.inventory.recorded !== true || !recorded.inventory.id) {
    throw new Error(`the kernel's device inventory did not keep the TV: ${String(recorded && recorded.inventory && recorded.inventory.reason).slice(0, 200)}`);
  }
  return { id: saved.id, record: recorded.inventory.id };
}

/** @description `person`: make (or keep) the test person, their made-up computer and the made-up TV the application saved. */
async function makePerson(origin, envFile, file) {
  const admin = adminToken(envFile);
  if (fs.existsSync(file)) { say('test person kept', { subject: JSON.parse(fs.readFileSync(file, 'utf8')).subject }); return; }
  const subject = `playway1-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const invite = (await http(origin, admin, 'POST', '/people/invitations', { body: { invitee: subject, tier: 'editor', lifetime_ms: 3600000 } })).body;
  const accepted = (await http(origin, '', 'POST', `/people/invitations/${encodeURIComponent(invite.token)}/accept`, { body: { subject, display_name: 'Morgan Sample (test)' } })).body;
  const person = { base: origin, subject, principal: accepted.principal, token: accepted.token, grants: [] };
  privateWrite(file, person);
  for (const role of ROLES) {
    const held = { id: `playway1-${role.app}-${randomUUID().slice(0, 8)}`, ...role };
    if (await grant(origin, admin, person.principal, held)) person.grants.push(held);
    privateWrite(file, person);
  }
  person.computer = await enrol(origin, person.token);
  privateWrite(file, person);
  person.tv = await saveTv(origin, person.token, person.computer);
  privateWrite(file, person);
  say('test person', { subject, tv: TV, inventoryRecord: Boolean(person.tv.record) });
}

/** @description Whether a version is at least the release that declares the way. @param {string} version x.y.z. @returns {boolean} */
function recent(version) {
  const parts = String(version || '').split('.').map((part) => parseInt(part, 10));
  if (parts.length < 3 || parts.some((part) => !Number.isInteger(part))) return false;
  for (let i = 0; i < 3; i += 1) { if (parts[i] !== NEEDS[i]) return parts[i] > NEEDS[i]; }
  return true;
}

/** @description The person's inventory row for the made-up TV, with what the way needs of it; failures are listed. */
async function inventoryRow(origin, person, failures) {
  const devices = ((await http(origin, person.token, 'GET', '/api/devices/inventory')).body || {}).devices || [];
  const row = devices.find((device) => device.id === person.tv.record);
  if (!row) { failures.push('the person\'s device inventory does not hold the TV the application saved'); return null; }
  const route = (row.routes || []).find((one) => one.kind === 'adb');
  if (row.kind !== 'fire-tv') failures.push(`the inventory holds the TV as ${row.kind}, not fire-tv`);
  if (!route) failures.push('the TV\'s record has no ADB route');
  return { name: row.name, kind: row.kind, route: route ? { state: route.state, recordedBy: route.source } : null };
}

/** @description The device.path answers of one reply for the play-title job, parsed. @param {object} reply The turn. @returns {object[]} */
function plansOf(reply) {
  const runs = Array.isArray(reply && reply.tool_executions) ? reply.tool_executions : [];
  const plans = [];
  for (const run of runs.filter((one) => one && one.tool === 'device.path')) {
    let plan = run.result;
    if (typeof plan === 'string') { try { plan = JSON.parse(plan); } catch { plan = null; } } // a result that is not JSON is no plan
    if (plan && plan.job === 'tv.play-title') plans.push(plan);
  }
  return plans;
}

/** @description Ask Jarvis for the plan, up to the allowed turns; the first reply that carries a play-title plan ends it. */
async function askForPlan(origin, person, receipt) {
  const turns = Math.max(1, Math.min(4, parseInt(process.env.PLAY_WAY_ASKS || '2', 10) || 2));
  for (let turn = 1; turn <= turns; turn += 1) {
    const answer = await http(origin, person.token, 'POST', '/api/jarvis/ask', { accepted: [200, 202],
      body: { message: QUESTION, sessionId: `play-way-proof-${randomUUID()}` } });
    const reply = answer.body || {};
    const called = (Array.isArray(reply.tool_executions) ? reply.tool_executions : []).map((run) => String(run && run.tool));
    const plans = plansOf(reply);
    receipt.asks.push({ turn, status: answer.status, pending: reply.status === 'pending', called, plans: plans.length });
    if (plans.length) return plans[plans.length - 1];
    if (turn < turns) await wait(2000);
  }
  return null;
}

/** @description Hold the kernel's plan to the declaration: the way by the tool, its words, its wake and its check. */
function judge(plan, receipt) {
  const byTool = (way) => (way.steps || []).some((step) => step.how === BY_TOOL);
  const way = (plan.ways || []).find(byTool);
  receipt.plan = { target: plan.target, reads_as: plan.reads_as, ways: (plan.ways || []).length, withheld: plan.withheld || [] };
  if (!way) {
    const held = (plan.withheld || []).find((one) => String(one.way).includes(BY_TOOL));
    receipt.failures.push(held ? `the way by the application's tool was withheld: ${String(held.why).slice(0, 200)}` : 'the plan lists no way by the application\'s own tool');
    return;
  }
  const last = way.steps[way.steps.length - 1];
  receipt.way = { path: way.path, way: way.way, state: way.state, standing: way.standing, wake: way.wake, check: way.check,
    steps: way.steps.map((step) => ({ on: step.on, how: step.how, use: step.use })) };
  if (way.steps.length !== 2) receipt.failures.push('the way is not two steps, the person\'s computer and then the TV');
  if (last.how !== BY_TOOL) receipt.failures.push('the last step is not the application\'s own tool');
  if (!String(last.use).includes(HAND)) receipt.failures.push('the step does not name the application, the tool, id as the saved TV and title as the title');
  if (way.wake === NO_WAKE) receipt.failures.push('the plan says the way cannot wake the TV, and the declaration says it can');
  if (!String(way.check).includes(PLAYING)) receipt.failures.push('the plan\'s check is not what the TV says is playing');
  if (!NOT_CONNECTED.test(String(way.state))) receipt.failures.push(`the way does not read as waiting on the made-up computer, which never connects: ${String(way.state).slice(0, 160)}`);
}

/** @description `check`: exit 0 when the kernel's plan offers the tool as declared, 2 when Jarvis did not call device.path, else 1. */
async function check(origin, file, out) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const receipt = { origin, at: new Date().toISOString(), subject: person.subject, tv: TV, asks: [], failures: [] };
  const smoke = (await http(origin, person.token, 'GET', `/api/${APP}/_smoke`)).body || {};
  receipt.package = { version: smoke.version, status: smoke.status };
  if (!recent(smoke.version)) throw new Error(`${APP} ${NEEDS.join('.')} is not installed on this slot (it answers ${String(smoke.version).slice(0, 20)})`);
  receipt.inventory = await inventoryRow(origin, person, receipt.failures);
  const settle = parseInt(process.env.PLAY_WAY_SETTLE_MS || '50000', 10);
  const left = (Number(person.computer.joinedAt) || 0) + (Number.isInteger(settle) ? settle : 50000) - Date.now();
  if (left > 0 && !receipt.failures.length) { say('waiting until the made-up computer reads as not connected', { seconds: Math.ceil(left / 1000) }); await wait(left); }
  const plan = receipt.failures.length ? null : await askForPlan(origin, person, receipt);
  if (plan) judge(plan, receipt);
  const notAsked = !plan && !receipt.failures.length;
  receipt.result = receipt.failures.length ? 'failed' : notAsked ? 'not asked: Jarvis did not call device.path, so nothing is proven either way' : 'offered';
  fs.writeFileSync(path.join(out, 'phone-control-play-way-live.json'), JSON.stringify(receipt, null, 2));
  say('check', receipt);
  return receipt.failures.length ? 1 : notAsked ? 2 : 0;
}

/** @description One step of the removal: what happened is said, and a failure is answered as false so the caller can stop. */
async function step(label, action) {
  try { await action(); say(label, { done: true }); return true; } catch (error) { say(label, { done: false, message: message(error) }); return false; }
}

/**
 * @description `remove`: forget the kept ways, remove the TV and the computer, take the role back, deactivate the person.
 *   The person's own records go first, with the person's credential. If one of them could not be removed, the person
 *   is left as they are and the file is kept, so `remove` can be run again.
 */
async function remove(origin, envFile, file) {
  const admin = adminToken(envFile), person = JSON.parse(fs.readFileSync(file, 'utf8'));
  const own = [await step('kept ways forgotten', async () => {
    const kept = ((await http(origin, person.token, 'GET', '/api/devices/paths')).body || {}).paths || [];
    for (const one of kept) await http(origin, person.token, 'DELETE', `/api/devices/paths/${encodeURIComponent(one.id)}`, { accepted: [200, 204, 404] });
  })];
  if (person.tv) own.push(await step('saved TV removed', () => http(origin, person.token, 'DELETE', `/api/${APP}/devices/${encodeURIComponent(person.tv.id)}`, { accepted: [200, 204, 404] })));
  if (person.computer) own.push(await step('made-up computer removed', () => http(origin, person.token, 'DELETE', `/api/computers/${person.computer.id}`, { accepted: [200, 204, 404] })));
  if (own.includes(false)) throw new Error('a record of the test person could not be removed, so the person was not deactivated; run remove again');
  for (const held of person.grants || []) await grant(origin, admin, person.principal, held, 'revoke');
  const confirmation = (await http(origin, admin, 'POST', '/confirmations', { body: {} })).body;
  await http(origin, admin, 'POST', `/people/${person.principal}/deactivate`, { body: {}, headers: { 'x-oshal-confirm': confirmation.confirmation } });
  await http(origin, person.token, 'GET', '/api/authorization/me', { accepted: [401, 403] });
  fs.rmSync(file, { force: true });
  say('test person removed', { subject: person.subject, grantsRevoked: (person.grants || []).length });
}

const [mode, base, second, third] = process.argv.slice(2);
try {
  if (!['person', 'check', 'remove'].includes(mode) || !base || !second || !third) throw new Error('usage: person <base> <env file> <person file> | check <base> <person file> <out folder> | remove <base> <env file> <person file>');
  const origin = testSlot(base);
  if (mode === 'person') await makePerson(origin, second, third);
  else if (mode === 'check') process.exitCode = await check(origin, second, third);
  else await remove(origin, second, third);
} catch (error) {
  console.error(`phone-control-play-way-live-proof: ${message(error)}`);
  process.exitCode = 1;
}
