/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.20.4: the test-slot check (tests/phone-control-play-way-live-proof.mjs) is itself checked, so its first run on an installed package is not its first run. It runs as a child process against a stand-in kernel on a loopback port that answers the kernel's own addresses with made-up values: the invitation and its acceptance, the role's preview and apply, a join code and a join, the application's device and record routes, the inventory read, a Jarvis turn whose tool record carries a device.path answer in the kernel's words (crates/api/src/device_paths_plan.rs), and the removal. It proves the check's own judgment and exit codes, and that it prints no credential and never asks for a command as the made-up computer. It proves nothing about the kernel: that is what the check is for.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.20.4, the same release: the stand-in lists the installation's applications and roles, so the cases hold the two roles the person is given (and none of Jarvis's where no Jarvis application is listed), the wait before the first turn, and a removal that stops before the person is deactivated when a record stays.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const proof = fileURLToPath(new URL('./phone-control-play-way-live-proof.mjs', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-play-way-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const ADMIN = 'made-up-admin-credential', PERSON = 'made-up-person-credential', NODE = 'made-up-computer-credential';
const TV = 'Lantern Room TV', RECORD = 'pkg-0123456789abcdef01234567';
const COMPUTER = '0f0f0f0f-0000-4000-8000-000000000001', PRINCIPAL = '0a0a0a0a-0000-4000-8000-000000000002';
const BY_TOOL = 'an application\'s own tool, run by a plan on your computer';
const WAITS = 'not now: a device that is no longer among yours is not connected now';
const READ_FIRST = 'read it first with this way; wake it once only if that read says it is off or asleep';

/** One way of a plan as the kernel's view gives it: its steps, its state, its check and its wake words. */
function way(last, { wake = READ_FIRST, state = WAITS } = {}) {
  return { path: `path-${last === BY_TOOL ? 'b' : 'a'}${'0'.repeat(23)}`, replay: null, standing: 'planned', state, wake,
    way: `a computer by Orbit, then ${TV} by ${last} through a computer`,
    steps: [{ on: '', how: 'Orbit on a computer', use: 'computer.run' }, { on: '', how: last, use: last === BY_TOOL
      ? `hand this step to Phone & Device Control (a handoff with app phone-control): its tool phone-control-play-show with id: "${TV}", title: the title. It prepares a plan that a computer runs. Afterwards read the device's own screen when the check says it can be read`
      : 'computer.open_link' }],
    check: 'ask Phone & Device Control what the TV says is playing; that read is not counted as a check here yet, so also ask the person' };
}

/** The Jarvis turn of one scenario: its tool record, with the device.path answer the scenario names. */
function turn(kind) {
  const adb = way('ADB over the network');
  const ways = { offered: [adb, way(BY_TOOL)], 'no-way': [adb], 'no-wake': [adb, way(BY_TOOL, { wake: 'this way cannot wake it' })],
    connected: [way(BY_TOOL, { state: 'ready' })], withheld: [adb] }[kind];
  if (!ways) return { reply: 'It is reached through your computer.', tool_executions: kind === 'other-job' ? [{ tool: 'device.path', result: JSON.stringify({ job: 'tv.keys', ways: [] }) }] : [] };
  const withheld = kind === 'withheld' ? [{ way: `${TV} by ${BY_TOOL} through a computer`, why: 'Let Jarvis control this device is off on a computer' }] : [];
  const plan = { target: { device: RECORD, name: TV, type: 'Fire TV', settled: 'record' }, label: TV, job: 'tv.play-title', reads_as: 'not read', ways, withheld };
  return { reply: 'Two ways.', tool_executions: [{ tool: 'device.inventory', result: '{}' }, { tool: 'device.path', arguments: { target: TV, job: 'tv.play-title' }, result: JSON.stringify(plan) }] };
}

// The kernel's addresses the check calls, each with a made-up answer. An address that is not here answers 404.
const ROUTES = [
  ['POST', /^\/people\/invitations$/, () => [200, { token: 'made-up-invitation' }]],
  ['POST', /^\/people\/invitations\/[^/]+\/accept$/, () => [200, { principal: PRINCIPAL, token: PERSON }]],
  ['GET', /^\/api\/authorization\/composites$/, (state) => [200, { revision: 7, applications: state.applications }]],
  ['POST', /^\/api\/authorization\/composites\/preview$/, () => [200, { plan_revision: 'made-up-plan' }]],
  ['POST', /^\/api\/authorization\/composites\/apply$/, () => [200, {}]],
  ['POST', /^\/nodes\/join-codes$/, () => [200, { code: 'made-up-code' }]],
  ['POST', /^\/nodes\/join$/, () => [200, { node: { id: COMPUTER }, token: NODE }]],
  ['POST', /^\/api\/phone-control\/devices$/, () => [201, { device: { id: 'ph_made-up' }, created: true }]],
  ['POST', /^\/api\/phone-control\/devices\/[^/]+\/apps\/record$/, () => [200, { ok: true, inventory: { recorded: true, id: RECORD } }]],
  ['GET', /^\/api\/phone-control\/_smoke$/, (state) => [200, { status: 'ready', package: 'phone-control', version: state.version, manifest: 'verified' }]],
  ['GET', /^\/api\/devices\/inventory$/, () => [200, { devices: [{ id: RECORD, name: TV, kind: 'fire-tv', routes: [{ kind: 'adb', state: 'up', source: 'Phone & Device Control' }] }] }]],
  ['POST', /^\/api\/jarvis\/ask$/, (state) => [200, turn(state.ask)]],
  ['GET', /^\/api\/devices\/paths$/, () => [200, { paths: [{ id: `path-${'c'.repeat(24)}` }] }]],
  ['DELETE', /^\/api\/devices\/paths\/path-[0-9a-f]{24}$/, () => [200, {}]],
  ['DELETE', /^\/api\/phone-control\/devices\/[^/]+$/, () => [204, null]],
  ['DELETE', /^\/api\/computers\/[^/]+$/, () => [200, {}]],
  ['POST', /^\/confirmations$/, () => [200, { confirmation: 'made-up-confirmation' }]],
  ['POST', /^\/people\/[^/]+\/deactivate$/, () => [200, {}]],
  ['GET', /^\/api\/authorization\/me$/, () => [401, { refused: 'no_identity' }]],
];

/** A stand-in kernel on a loopback port: it keeps every call it was sent and answers by the table. */
async function standIn() {
  const state = { version: '1.20.4', ask: 'offered', calls: [], broken: null,
    applications: [{ app: 'jarvis', roles: ['chat-user'] }, { app: 'phone-control', roles: ['admin', 'editor', 'operator', 'reader', 'viewer'] }] };
  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const where = new URL(request.url, 'http://stand-in').pathname;
      const found = ROUTES.find(([method, shape]) => method === request.method && shape.test(where));
      state.calls.push({ line: `${request.method} ${where}`, bearer: String(request.headers.authorization || '').replace(/^Bearer /, ''),
        confirm: request.headers['x-oshal-confirm'], body: raw ? JSON.parse(raw) : null });
      const [status, answer] = !found ? [404, { refused: 'not_found' }] : state.broken === found[1] ? [500, { refused: 'store_unavailable' }] : found[2](state);
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(answer === null ? undefined : JSON.stringify(answer));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  after(() => server.close());
  return { state, base: `http://127.0.0.1:${server.address().port}` };
}

/** Run the check as a child process; answers its exit code and what it printed. */
function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [proof, ...args], { env: { PATH: process.env.PATH, PLAY_WAY_SETTLE_MS: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let printed = '';
    child.stdout.on('data', (chunk) => { printed += chunk; });
    child.stderr.on('data', (chunk) => { printed += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, printed }));
  });
}

const kernel = await standIn();
const envFile = path.join(root, 'slot.env'), personFile = path.join(root, 'private', 'person.json'), out = path.join(root, 'out');
fs.writeFileSync(envFile, `OSHAL_OTHER=1\nOSHAL_ADMIN_TOKEN='${ADMIN}'\n`);
const receipt = () => JSON.parse(fs.readFileSync(path.join(out, 'phone-control-play-way-live.json'), 'utf8'));
const sent = (line) => kernel.state.calls.filter((call) => call.line === line);

test('production\'s port and an address that is not loopback are refused before any request', async () => {
  for (const [base, words] of [['http://127.0.0.1:38788', 'never on production'], ['http://192.0.2.9:38798', 'only against a loopback kernel'], ['https://127.0.0.1:38798', 'only against a loopback kernel']]) {
    for (const args of [['person', base, envFile, personFile], ['check', base, personFile, out], ['remove', base, envFile, personFile]]) {
      const done = await run(args);
      assert.equal(done.code, 1, `${args[0]} ${base}`);
      assert.match(done.printed, new RegExp(words));
    }
  }
  assert.equal(kernel.state.calls.length, 0);
  assert.equal(fs.existsSync(personFile), false);
});

test('person makes a made-up person, a computer that never connects and a TV the application saved', async () => {
  const done = await run(['person', kernel.base, envFile, personFile]);
  assert.equal(done.code, 0, done.printed);
  assert.equal(fs.statSync(personFile).mode & 0o777, 0o600, 'the person file is the user\'s alone');
  const person = JSON.parse(fs.readFileSync(personFile, 'utf8'));
  assert.deepEqual([person.token, Object.keys(person.computer), person.computer.id, person.tv], [PERSON, ['id', 'joinedAt'], COMPUTER, { id: 'ph_made-up', record: RECORD }], 'the computer\'s credential is not kept');
  assert.deepEqual(person.grants.map((held) => [held.app, held.role]), [['phone-control', 'operator'], ['jarvis', 'chat-user']], 'their own devices, and a turn with Jarvis');
  assert.deepEqual(sent('POST /api/authorization/composites/apply').map((call) => [call.bearer, call.body.selection]),
    [[ADMIN, { kind: 'granular', app: 'phone-control', role: 'operator' }], [ADMIN, { kind: 'granular', app: 'jarvis', role: 'chat-user' }]]);
  assert.deepEqual([sent('POST /nodes/join-codes')[0].bearer, sent('POST /nodes/join')[0].bearer], [PERSON, ''], 'the person makes the code; the join carries none of theirs');
  assert.equal(sent('POST /nodes/join')[0].body.harness.custom, 'oshal-node-desktop');
  assert.deepEqual(sent('POST /api/phone-control/devices')[0].body, { name: TV, platform: 'android', form: 'tv', computerNodeId: COMPUTER, address: '192.0.2.44:5555' });
  assert.deepEqual(sent('POST /api/phone-control/devices/ph_made-up/apps/record')[0].body.reply, { ok: true, action: 'tv_apps', apps: [], unknownCount: 0, model: 'AFTXX001', maker: 'Maker' });
  for (const secret of [ADMIN, PERSON, NODE]) assert.equal(done.printed.includes(secret), false, 'no credential is printed');
});

test('an installation that lists no Jarvis application is asked for no Jarvis role', async () => {
  const other = await standIn();
  other.state.applications = [{ app: 'phone-control', roles: ['operator'] }];
  const file = path.join(root, 'private', 'no-jarvis.json');
  assert.equal((await run(['person', other.base, envFile, file])).code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).grants.map((held) => held.app), ['phone-control']);
  assert.equal(other.state.calls.filter((call) => call.line === 'POST /api/authorization/composites/apply').length, 1);
});

test('check exits 0 when the kernel\'s plan offers the tool as declared, and never asks for a command as the computer', async () => {
  const done = await run(['check', kernel.base, personFile, out]);
  assert.equal(done.code, 0, done.printed);
  const kept = receipt();
  assert.deepEqual([kept.result, kept.failures, kept.package.version, kept.inventory.kind], ['offered', [], '1.20.4', 'fire-tv']);
  assert.equal(kept.way.steps[1].how, BY_TOOL);
  assert.match(kept.way.steps[1].use, /its tool phone-control-play-show with id: "Lantern Room TV", title: the title\./);
  assert.match(sent('POST /api/jarvis/ask')[0].body.message, /device\.path .*Do not play, wake or press anything\.$/);
  assert.deepEqual(kernel.state.calls.filter((call) => /\/commands\//.test(call.line)), [], 'the made-up computer never connects');
  for (const secret of [ADMIN, PERSON, NODE]) assert.equal(`${done.printed}${JSON.stringify(kept)}`.includes(secret), false, 'no credential is printed or kept in the receipt');
});

test('check waits until the made-up computer reads as not connected before it asks', async () => {
  const started = Date.now();
  const joined = JSON.parse(fs.readFileSync(personFile, 'utf8')).computer.joinedAt;
  const done = await run(['check', kernel.base, personFile, out], { PLAY_WAY_SETTLE_MS: String(started - joined + 1500) });
  assert.equal(done.code, 0, done.printed);
  assert.match(done.printed, /"waiting until the made-up computer reads as not connected","seconds":[12]\}/);
  assert.ok(Date.now() - started >= 1200, 'it waited');
});

test('check exits 2 when Jarvis did not call device.path for the job, and 1 on a plan that is not the declaration', async () => {
  for (const ask of ['silent', 'other-job']) {
    kernel.state.ask = ask;
    const done = await run(['check', kernel.base, personFile, out], { PLAY_WAY_ASKS: '1' });
    assert.equal(done.code, 2, `${ask}: ${done.printed}`);
    assert.match(receipt().result, /^not asked: Jarvis did not call device\.path/);
  }
  for (const [ask, words] of [['no-way', /lists no way by the application's own tool/], ['no-wake', /cannot wake the TV, and the declaration says it can/],
    ['withheld', /was withheld: Let Jarvis control this device is off/], ['connected', /does not read as waiting on the made-up computer/]]) {
    kernel.state.ask = ask;
    const done = await run(['check', kernel.base, personFile, out], { PLAY_WAY_ASKS: '1' });
    assert.equal(done.code, 1, `${ask}: ${done.printed}`);
    assert.match(receipt().failures.join(' | '), words);
  }
  kernel.state.ask = 'offered';
  kernel.state.version = '1.20.3';
  const older = await run(['check', kernel.base, personFile, out]);
  assert.equal(older.code, 1);
  assert.match(older.printed, /phone-control 1\.20\.4 is not installed on this slot \(it answers 1\.20\.3\)/);
  kernel.state.version = '1.21.0';
  assert.equal((await run(['check', kernel.base, personFile, out])).code, 0, 'a later release is the declaration too');
});

test('remove stops before the person is deactivated when one of their records could not be removed', async () => {
  kernel.state.calls.length = 0;
  kernel.state.broken = ROUTES.find(([method, shape]) => method === 'DELETE' && shape.test('/api/computers/x'))[1];
  const done = await run(['remove', kernel.base, envFile, personFile]);
  kernel.state.broken = null;
  assert.equal(done.code, 1, done.printed);
  assert.match(done.printed, /"made-up computer removed","done":false,"message":"DELETE \/api\/computers\/:id: 500"/);
  assert.match(done.printed, /the person was not deactivated; run remove again/);
  assert.deepEqual(kernel.state.calls.filter((call) => /deactivate|composites/.test(call.line)), [], 'nothing of the administrator\'s was asked');
  assert.equal(fs.existsSync(personFile), true, 'the person file is kept for the next run');
});

test('remove forgets the kept ways, removes the TV and the computer, takes the role back and deactivates the person', async () => {
  kernel.state.calls.length = 0;
  const done = await run(['remove', kernel.base, envFile, personFile]);
  assert.equal(done.code, 0, done.printed);
  assert.deepEqual(kernel.state.calls.map((call) => call.line).filter((line) => !/composites$|composites\/preview$/.test(line)), [
    'GET /api/devices/paths', `DELETE /api/devices/paths/path-${'c'.repeat(24)}`, 'DELETE /api/phone-control/devices/ph_made-up', `DELETE /api/computers/${COMPUTER}`,
    'POST /api/authorization/composites/apply', 'POST /api/authorization/composites/apply', 'POST /confirmations', `POST /people/${PRINCIPAL}/deactivate`, 'GET /api/authorization/me']);
  assert.deepEqual(sent('POST /api/authorization/composites/apply').map((call) => call.body.action), ['revoke', 'revoke']);
  assert.deepEqual([sent(`POST /people/${PRINCIPAL}/deactivate`)[0].bearer, sent(`POST /people/${PRINCIPAL}/deactivate`)[0].confirm], [ADMIN, 'made-up-confirmation']);
  assert.equal(fs.existsSync(personFile), false, 'the person file is gone');
  for (const secret of [ADMIN, PERSON, NODE]) assert.equal(done.printed.includes(secret), false, 'no credential is printed');
});
