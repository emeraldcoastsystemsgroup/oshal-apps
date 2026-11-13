/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 routes over real HTTP and a real SQLite file: what remains answers, everything 1.0.0 faked answers 404, records are the caller's own (another person reads 404), history and reports validate, the bridge file bytes match their manifest sha256, and every device row 1.0.0 made up (each carries its invented handshake) is deleted from an existing 1.0.0 store with its drawn frames. The kernel caller is the one boundary doubled here (a fixed actor per test header); the real runner's admission is tests/live/phone-control-runner.test.cjs.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.1: the bridge manifest names version 1.1.1.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.1.2: and now 1.1.2.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.2.0: manifest 1.2.0, form ('phone' | 'tv') round-trips and validates, and bob sees none of alice's TV records, history or computer reports.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: manifest 1.3.0 includes oshal_phone_mirror.py, and home-summary points empty-state setup to phone-control-execution.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: manifest 1.4.0 and /ui serves session-computer.js, session-media.js, and session-collab.js.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: verify manifest 1.4.1 sha256 integrity.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | 1.4.2: verify Swarm device registration auto-resolution, POST /devices/:id/execute single/multi-step and prompt execution, and Concierge register_device + multi-step D-Pad planning.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | 1.5.0: manifest 1.5.0; a device registered without a computer by a person with no computer of their own is refused in words (400 computer_required), never given a fixed computer.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | 1.5.1: the Connection Concierge never offers Connect in console (hidden until an RDP session backend exists): an RDP question over HTTP gets Check RDP port only, or Use this computer first with no computer chosen, and a model reply naming connect_rdp is dropped by the route's own sanitizer. Red on 1.5.0, whose planner put Connect in console first. Manifest 1.5.1.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | 1.5.2: manifest 1.5.2 (device-concierge routing words).
 * 12 | maintainer@emeraldcoastsystemsgroup.com | 1.5.3: manifest 1.5.3 (the missing isTvNode import on Your devices).
 * 13 | maintainer@emeraldcoastsystemsgroup.com | 1.7.0 (T45 part 3): POST /devices/:id/open-link plans a link opened on a saved Android or Fire TV in its streaming app (lan-control launch_url with app), refuses a non-https or spaced address, an unknown app, a phone and another person's TV; the bridge carries oshal_phone_links.py (1.7.0).
 * 14 | maintainer@emeraldcoastsystemsgroup.com | 1.8.0: the version pin follows the release.
 * 15 | maintainer@emeraldcoastsystemsgroup.com | 1.9.0: open-link takes app oshal for a Marquee page and refuses any other address with it; the version pin follows the release.
 * 16 | maintainer@emeraldcoastsystemsgroup.com | 1.9.1: the version pin follows the release.
 * 17 | maintainer@emeraldcoastsystemsgroup.com | 1.10.0: the version pin follows the release.
 * 18 | maintainer@emeraldcoastsystemsgroup.com | 1.11.0 (T80): POST /devices/:id/play plans lan-control play_title (a show by its name in Prime Video) from the TV's computer with a minute to finish; a missing or overlong name, another app, control characters folded to spaces and a phone instead of a TV are said in words; the version pin follows the release.
 * 19 | maintainer@emeraldcoastsystemsgroup.com | 1.12.0 (T79): POST /devices/:id/apps plans lan-control tv_apps (which streaming apps the TV has) from the TV's computer, its command carrying exactly those arguments, for the TV by id or by name, and records the read against the TV; a phone is said in words, an unknown TV and another person's TV are 404; the bridge manifest names oshal_phone_apps.py and the version pin follows the release.
 * 20 | maintainer@emeraldcoastsystemsgroup.com | 1.12.1: the bridge manifest is version 1.12.1.
 * 21 | maintainer@emeraldcoastsystemsgroup.com | 1.13.0: the bridge manifest is version 1.13.0, and the What a TV can play plan names the TV's own computer and says to record the computer's answer with phone-control-tv-apps-record (the record route has phone-control-inventory.test.cjs).
 * 22 | maintainer@emeraldcoastsystemsgroup.com | 1.14.0: the bridge manifest is version 1.14.0 (who may use these routes is phone-control-own-devices.test.cjs).
 * 23 | maintainer@emeraldcoastsystemsgroup.com | Expect the unchanged bridge protocol at package version1.15.0.
 * 25 | maintainer@emeraldcoastsystemsgroup.com | Single-command TV link/show plans pin the saved host for the kernel closed-plan runner; caller host overrides cannot redirect them.
 * 24 | maintainer@emeraldcoastsystemsgroup.com | Plan creation does not execute commands or write successful history; explicit computer outcomes remain owner-scoped.
 * 26 | maintainer@emeraldcoastsystemsgroup.com | Expect bridge metadata to follow package1.16.0 while retaining manifest bytes, compression, history and owner-isolation checks.
 * 27 | maintainer@emeraldcoastsystemsgroup.com | Expect bridge metadata1.17.0 while preserving byte, compression, history and owner-isolation guards.
 * 28 | maintainer@emeraldcoastsystemsgroup.com | Expect bridge metadata 1.18.0, the release that adds the Fire TV phone-app guide; every byte, compression, history and owner-isolation guard is unchanged.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const PKG = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-control-routes-'));
process.env.OSHAL_PACKAGE_DATA_DIR = work;
const store = require(path.join(PKG, 'lib', 'db.js'));
const { createPhoneControlRoutes } = require(path.join(PKG, 'routes', 'phone-control-routes.js'));
const concierge = require(path.join(PKG, 'routes', 'phone-control-concierge-routes.js'));

const PEOPLE = {
  alice: { isActive: true, issuer: 'https://issuer.example', sub: 'alice' },
  bob: { isActive: true, issuer: 'https://issuer.example', sub: 'bob' }
};
const NODE = '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';
let server;
let base;
let current = null;

before(async () => {
  const db = store.getDatabase(path.join(work, 'routes.sqlite'));
  const ctx = { appPackageDir: PKG, db, authorization: { currentActor: () => current, registerResource() {} } };
  const routes = createPhoneControlRoutes(ctx);
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      req.body = raw ? JSON.parse(raw) : {};
      current = PEOPLE[req.headers['x-test-person']] || null;
      req.url = req.url.slice('/api/phone-control'.length) || '/';
      routes.handle(req, res, () => { res.statusCode = 404; res.end('{}'); });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(work, { recursive: true, force: true });
});

async function call(method, route, { person = 'alice', body, query = '' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (person) headers['x-test-person'] = person;
  const response = await fetch(`${base}/api/phone-control${route}${query}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* a page or a file */ }
  return { status: response.status, json, text, type: response.headers.get('content-type') || '' };
}

test('everything 1.0.0 faked is gone: those routes answer 404', async () => {
  for (const [method, route] of [['GET', '/devices/x1/screen'], ['POST', '/devices/x1/operations'], ['POST', '/devices/x1/frame'],
    ['POST', '/concierge'], ['POST', '/import-artifact'], ['GET', '/control-contract'], ['POST', '/agent-devices'], ['GET', '/artifacts'],
    ['GET', '/blobs/abc'], ['GET', '/config/hardware-status'], ['POST', '/config/pair-ble'], ['POST', '/config/pair-adb'],
    ['POST', '/config/pair-mirror'], ['GET', '/assets/app.js']]) {
    const answer = await call(method, route, { body: method === 'POST' ? {} : undefined });
    assert.equal(answer.status, 404, `${method} ${route} must not answer`);
  }
});

test('no kernel caller is 401 and a chosen owner or tenant is 400', async () => {
  assert.equal((await call('GET', '/devices', { person: null })).status, 401);
  assert.equal((await call('GET', '/devices', { query: '?tenantId=other' })).status, 400);
  assert.equal((await call('POST', '/devices', { body: { owner: 'bob', name: 'x' } })).status, 400);
});

test('a phone record is the caller\'s own, deduplicated by computer, platform and address', async () => {
  const input = { name: 'Pixel 9', platform: 'android', computerNodeId: NODE, address: '192.168.1.42:37123' };
  const first = await call('POST', '/devices', { body: input });
  assert.equal(first.status, 201);
  assert.equal(first.json.device.controlEnabled, true);
  const again = await call('POST', '/devices', { body: { ...input, name: 'Pixel 9 Pro' } });
  assert.equal(again.status, 200);
  assert.equal(again.json.device.id, first.json.device.id);
  assert.equal(again.json.device.name, 'Pixel 9 Pro');
  for (const bad of [{ ...input, platform: 'linux' }, { ...input, computerNodeId: 'x' }, { ...input, address: 'a b' }, { ...input, name: '' }]) {
    assert.equal((await call('POST', '/devices', { body: bad })).status, 400, JSON.stringify(bad));
  }
  const id = first.json.device.id;
  assert.equal((await call('GET', `/devices/${id}`, { person: 'bob' })).status, 404, 'another person reads 404');
  assert.deepEqual((await call('GET', '/devices', { person: 'bob' })).json.devices, []);
  const off = await call('POST', `/devices/${id}`, { body: { controlEnabled: false } });
  assert.equal(off.json.device.controlEnabled, false);
  assert.equal((await call('POST', `/devices/${id}`, { body: { controlEnabled: 'no' } })).status, 400);
  assert.equal((await call('POST', `/devices/${id}`, { person: 'bob', body: { controlEnabled: true } })).status, 404);
  assert.equal((await call('DELETE', `/devices/${id}`, { person: 'bob' })).status, 404);
  assert.equal((await call('DELETE', `/devices/${id}`)).status, 204);
  assert.equal((await call('GET', `/devices/${id}`)).status, 404);
  const tv = await call('POST', '/devices', { body: { name: 'Living Room Fire TV', platform: 'android', form: 'tv', computerNodeId: NODE, address: '192.168.1.60:5555' } });
  assert.equal(tv.status, 201);
  assert.equal(tv.json.device.form, 'tv');
  assert.equal((await call('GET', `/devices/${tv.json.device.id}`)).json.device.form, 'tv');
  assert.equal((await call('POST', '/devices', { body: { ...input, form: 'tablet' } })).status, 400);
  assert.equal((await call('POST', '/devices', { body: { name: 'Bad iPad', platform: 'ios', form: 'tablet', computerNodeId: NODE, address: '7C:4B:26:00:00:09' } })).status, 400);
  const bleTv = await call('POST', '/devices', { body: { name: 'Fire Stick BLE', platform: 'ios', form: 'tv', computerNodeId: NODE, address: '7C:4B:26:00:00:09' } });
  assert.equal(bleTv.status, 201);
  assert.equal(bleTv.json.device.form, 'tv');
  assert.equal((await call('DELETE', `/devices/${bleTv.json.device.id}`)).status, 204);
  assert.deepEqual((await call('GET', '/devices', { person: 'bob' })).json.devices, []);
  assert.equal((await call('GET', `/devices/${tv.json.device.id}`, { person: 'bob' })).status, 404);
  assert.equal((await call('POST', `/devices/${tv.json.device.id}`, { person: 'bob', body: { name: 'Stolen TV' } })).status, 404);
  assert.equal((await call('DELETE', `/devices/${tv.json.device.id}`, { person: 'bob' })).status, 404);
  assert.equal((await call('POST', '/history', { person: 'bob', body: { computerNodeId: NODE, phoneId: tv.json.device.id, action: 'key ok', summary: 'OK', ok: true } })).status, 404);
  assert.equal((await call('DELETE', `/devices/${tv.json.device.id}`)).status, 204);
});

test('history records what was sent and what the computer answered, for its owner only', async () => {
  const phone = (await call('POST', '/devices', { body: { name: 'iPhone', platform: 'ios', computerNodeId: NODE, address: '7C:4B:26:00:00:01' } })).json.device;
  const sent = await call('POST', '/history', { body: { computerNodeId: NODE, phoneId: phone.id, action: 'key home', summary: 'Home', ok: false, exitCode: 3, error: 'No phone is listening' } });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.event.ok, false);
  assert.equal(sent.json.event.error, 'No phone is listening');
  assert.equal((await call('POST', '/history', { body: { computerNodeId: NODE, action: 'x', summary: 'x' } })).status, 400, 'ok is required');
  assert.equal((await call('POST', '/history', { person: 'bob', body: { computerNodeId: NODE, phoneId: phone.id, action: 'x', summary: 'x', ok: true } })).status, 404);
  const mine = await call('GET', '/history', { query: `?deviceId=${phone.id}` });
  assert.equal(mine.json.history.length, 1);
  assert.equal(mine.json.history[0].summary, 'Home');
  assert.deepEqual((await call('GET', '/history', { person: 'bob' })).json.history, []);
  const read = await call('GET', `/devices/${phone.id}`);
  assert.equal(read.json.history[0].action, 'key home');
});

const PLANNERS = [
  { route: 'execute', body: { prompt: 'move down one and select', mode: 'background' }, timeout: 45000, limit: 50000 },
  { route: 'open-link', body: { url: 'https://www.netflix.com/title/80057281', app: 'netflix' }, timeout: 45000, limit: 50000 },
  { route: 'play', body: { title: 'The Rings of Power', app: 'prime' }, timeout: 55000, limit: 60000 },
  { route: 'apps', timeout: 45000, limit: 50000 }
];

/** Create a synthetic owned TV with no existing history. */
async function receiptTv(name, address) {
  const saved = await call('POST', '/devices', { body: { name, address, platform: 'android', form: 'tv', computerNodeId: NODE } });
  assert.equal(saved.status, 201);
  return saved.json.device;
}

for (const [index, planner] of PLANNERS.entries()) {
  test(`${planner.route}: a prepared command explicitly says it has not executed`, async () => {
    const tv = await receiptTv(`Receipt ${planner.route}`, `192.168.1.${71 + index}`);
    const planned = await call('POST', `/devices/${tv.id}/${planner.route}`, { body: planner.body });
    assert.equal(planned.status, 200);
    assert.deepEqual([planned.json.ok, planned.json.planned, planned.json.executed, planned.json.status], [true, true, false, 'planned']);
    assert.equal(planned.json.device.id, tv.id);
    assert.equal(planned.json.computerNodeId, NODE);
    assert.deepEqual(planned.json.computerRunRequest, {
      endpoint: `/api/computers/${NODE}/run`, method: 'POST',
      body: { tool: 'shell.exec', arguments: { command: planned.json.command, timeout_ms: planner.timeout }, limit_ms: planner.limit }
    }, 'the caller must still send the unchanged command to the selected computer');
    if (planner.route === 'execute') {
      assert.equal(planned.json.mode, 'background', 'the requested mode is kept without claiming a scheduled run');
      assert.deepEqual(planned.json.steps.map((step) => step.args.key), ['DOWN', 'OK']);
      assert.equal(planned.json.command, planned.json.steps.map((step) => step.command).join(' && '));
    } else {
      const encoded = planned.json.command.split(' --b64 ')[1];
      assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')), planned.json.args);
    }
  });

  test(`${planner.route}: planning creates no successful execution history`, async () => {
    const tv = await receiptTv(`History ${planner.route}`, `192.168.1.${81 + index}`);
    const earlier = { computerNodeId: NODE, phoneId: tv.id, action: 'key', summary: 'Earlier attempt', ok: false, exitCode: 3, error: 'The computer did not answer' };
    assert.equal((await call('POST', '/history', { body: earlier })).status, 201);
    const before = (await call('GET', `/devices/${tv.id}`)).json.history;
    assert.equal((await call('POST', `/devices/${tv.id}/${planner.route}`, { body: planner.body })).status, 200);
    assert.deepEqual((await call('GET', `/devices/${tv.id}`)).json.history, before, 'preparing commands cannot become Worked in the execution history');
    assert.equal((await call('POST', `/devices/${tv.id}/${planner.route}`, { person: 'bob', body: planner.body })).status, 404);
    assert.deepEqual((await call('GET', '/history', { person: 'bob', query: `?deviceId=${tv.id}` })).json.history, []);
    assert.deepEqual((await call('GET', `/devices/${tv.id}`)).json.history, before, 'a refused foreign plan changes no history');
  });
}

test('actual success and failure records survive planning and remain isolated', async () => {
  const tv = await receiptTv('Recorded outcomes', '192.168.1.91');
  for (const [ok, exitCode, error] of [[false, 7, 'The TV refused the action'], [true, 0, null]]) {
    const recorded = await call('POST', '/history', { body: { computerNodeId: NODE, phoneId: tv.id, action: 'key', summary: 'OK', ok, exitCode, error } });
    assert.equal(recorded.status, 201);
    assert.deepEqual([recorded.json.event.ok, recorded.json.event.exitCode, recorded.json.event.error], [ok, exitCode, error]);
  }
  const before = (await call('GET', `/devices/${tv.id}`)).json.history;
  assert.equal(before.length, 2);
  await call('POST', `/devices/${tv.id}/execute`, { body: { action: 'key', key: 'OK' } });
  assert.deepEqual((await call('GET', `/devices/${tv.id}`)).json.history, before, 'planning preserves both actual outcomes');
  assert.equal((await call('POST', '/history', { person: 'bob', body: { computerNodeId: NODE, phoneId: tv.id, action: 'key', summary: 'OK', ok: true } })).status, 404);
});

test('a computer report keeps what the bridge said with the time it was read', async () => {
  const saved = await call('POST', `/computers/${NODE}/report`, { body: { report: { version: '1.1.0', adb: { ready: true } } } });
  assert.equal(saved.status, 200);
  assert.ok(Date.parse(saved.json.reportedAt));
  assert.equal((await call('POST', `/computers/${NODE}/report`, { body: { report: 'x' } })).status, 400);
  assert.equal((await call('POST', `/computers/${NODE}/report`, { body: { report: { big: 'x'.repeat(20000) } } })).status, 413);
  const reports = await call('GET', '/computers/reports');
  assert.equal(reports.json.reports[0].report.version, '1.1.0');
  assert.deepEqual((await call('GET', '/computers/reports', { person: 'bob' })).json.reports, []);
  const emptySummary = await call('GET', '/home-summary', { person: 'bob' });
  assert.equal(emptySummary.json.items[0].fix, 'phone-control-execution');
  const summary = await call('GET', '/home-summary');
  assert.equal(summary.json.metrics.computersSetUp, 1);
  assert.ok(summary.json.tiles.every((tile) => typeof tile.value === 'string'));
});

test('the bridge files served match their manifest sha256, compressed and plain', async () => {
  const manifest = (await call('GET', '/bridge/manifest.json')).json;
  assert.equal(manifest.version, '1.18.0');
  assert.deepEqual(manifest.files.map((file) => file.name).sort(), [
    'oshal-phone-bridge', 'oshal_phone_apps.py', 'oshal_phone_ble.py', 'oshal_phone_bridge.py', 'oshal_phone_lan.py', 'oshal_phone_links.py', 'oshal_phone_mirror.py', 'oshal_phone_ops.py', 'oshal_phone_play.py'
  ]);
  for (const file of manifest.files) {
    const plain = await call('GET', `/bridge/files/${file.name}`);
    assert.equal(plain.status, 200);
    assert.equal(crypto.createHash('sha256').update(plain.text).digest('hex'), file.sha256, file.name);
    assert.equal(crypto.createHash('sha256').update(zlib.gunzipSync(Buffer.from(file.gz, 'base64'))).digest('hex'), file.sha256);
  }
  assert.equal((await call('GET', '/bridge/files/db.js')).status, 404);
});

test('command-plan translates move, click, drag, type, key and screen into owner-scoped closed bridge commands', async () => {
  const ios = (await call('POST', '/devices', {
    body: { name: 'Roger iPhone', platform: 'ios', computerNodeId: NODE, address: '7C:4B:26:11:22:33' }
  })).json.device;
  const clickPlan = await call('POST', `/devices/${ios.id}/command-plan`, {
    body: { action: 'click', x: 249, y: 540, width: 498, height: 1080 }
  });
  assert.equal(clickPlan.status, 200);
  assert.equal(clickPlan.json.verb, 'pointer-click');
  assert.equal(clickPlan.json.computerNodeId, NODE);
  assert.match(clickPlan.json.command, / pointer-click --b64 /);
  assert.equal((await call('POST', `/devices/${ios.id}/command-plan`, {
    person: 'bob', body: { action: 'click', x: 10, y: 10, width: 498, height: 1080 }
  })).status, 404);
  assert.equal((await call('POST', `/devices/${ios.id}/command-plan`, { body: { action: 'exec' } })).status, 400);
  await call('POST', `/devices/${ios.id}`, { body: { controlEnabled: false } });
  assert.equal((await call('POST', `/devices/${ios.id}/command-plan`, { body: { action: 'screen' } })).status, 409);

  const rdpPlan = await call('POST', '/rdp/command-plan', {
    body: { rdpSessionId: 'rdp_win_1', action: 'click', x: 640, y: 400 }
  });
  assert.equal(rdpPlan.status, 200);
  assert.equal(rdpPlan.json.endpoint, '/api/rdp/sessions/rdp_win_1/input');
  assert.deepEqual(rdpPlan.json.body, { action: 'click', x: 640, y: 400 });
  assert.equal((await call('POST', '/rdp/command-plan', {
    body: { rdpSessionId: 'rdp_win_1', action: 'exec' }
  })).status, 400);

  const autoTv = await call('POST', '/devices', {
    body: { name: 'Living Room Fire TV', address: '192.168.1.60' }
  });
  assert.equal(autoTv.status, 201);
  assert.equal(autoTv.json.device.platform, 'android');
  assert.equal(autoTv.json.device.form, 'tv');
  assert.equal(autoTv.json.device.address, '192.168.1.60:5555');
  assert.equal(autoTv.json.device.computerNodeId, NODE);

  const execPrompt = await call('POST', '/devices/192.168.1.60/execute', {
    body: { prompt: 'move down one and select', mode: 'background' }
  });
  assert.equal(execPrompt.status, 200);
  assert.equal(execPrompt.json.ok, true);
  assert.equal(execPrompt.json.mode, 'background');
  assert.equal(execPrompt.json.steps.length, 2);
  assert.equal(execPrompt.json.steps[0].args.key, 'DOWN');
  assert.equal(execPrompt.json.steps[1].args.key, 'OK');
  assert.match(execPrompt.json.command, /&&/);

  const execSteps = await call('POST', `/devices/${autoTv.json.device.id}/execute`, {
    body: { steps: [{ action: 'key', key: 'DPAD_DOWN' }, { action: 'key', key: 'DPAD_CENTER' }] }
  });
  assert.equal(execSteps.status, 200);
  assert.equal(execSteps.json.steps.length, 2);
  assert.equal(execSteps.json.steps[0].args.key, 'DOWN');
  assert.equal(execSteps.json.steps[1].args.key, 'OK');

  // 1.7.0 (T45 part 3): a link opens on a saved Android or Fire TV in the named streaming app, from the TV's computer.
  const link = await call('POST', `/devices/${autoTv.json.device.id}/open-link`, {
    body: { url: 'https://www.netflix.com/title/80057281', app: 'netflix' }
  });
  assert.equal(link.status, 200, JSON.stringify(link.json));
  assert.equal(link.json.verb, 'lan-control');
  assert.deepEqual(link.json.args, { kind: 'android-tv', address: '192.168.1.60', action: 'launch_url', url: 'https://www.netflix.com/title/80057281', app: 'netflix' });
  assert.match(link.json.command, /^python3 -I "\$HOME\/\.local\/share\/oshal-phone-bridge\/oshal_phone_bridge\.py" lan-control --b64 [A-Za-z0-9+/=]+$/);
  assert.equal(link.json.computerRunRequest.endpoint, `/api/computers/${encodeURIComponent(NODE)}/run`);
  assert.equal(link.json.computerRunRequest.body.arguments.command, link.json.command);
  // 1.11.0 (T80): a show plays by its name on the TV (the app's search, the matching result, Resume or Play).
  const show = await call('POST', `/devices/${autoTv.json.device.id}/play`, { body: { title: 'The Rings of Power' } });
  assert.equal(show.status, 200, JSON.stringify(show.json));
  assert.deepEqual(show.json.args, { kind: 'android-tv', address: '192.168.1.60', action: 'play_title', title: 'The Rings of Power', app: 'prime' }, 'Prime Video unless named');
  assert.match(show.json.command, /^python3 -I "\$HOME\/\.local\/share\/oshal-phone-bridge\/oshal_phone_bridge\.py" lan-control --b64 [A-Za-z0-9+/=]+$/);
  assert.equal(show.json.computerRunRequest.body.arguments.command, show.json.command);
  assert.equal(show.json.computerRunRequest.body.limit_ms, 60000, 'a minute: search, page, Resume and the check');
  const folded = await call('POST', `/devices/${autoTv.json.device.id}/play`, { body: { title: 'Rings\u0007 of\nPower', app: 'PRIME' } });
  assert.deepEqual([folded.status, folded.json.args.title, folded.json.args.app], [200, 'Rings of Power', 'prime'], 'control characters fold to spaces');
  for (const [body, code] of [[{ title: 'x' }, 'title_invalid'], [{ title: 'y'.repeat(81) }, 'title_invalid'], [{ title: 'Stranger Things', app: 'netflix' }, 'app_invalid']]) {
    const refused = await call('POST', `/devices/${autoTv.json.device.id}/play`, { body });
    assert.deepEqual([refused.status, refused.json.error], [400, code], JSON.stringify(body));
  }
  // 1.12.0 (T79): which streaming apps the TV has, read on the TV's computer from its app list; nothing is pressed.
  const tvApps = await call('POST', `/devices/${autoTv.json.device.id}/apps`);
  assert.equal(tvApps.status, 200, JSON.stringify(tvApps.json));
  assert.equal(tvApps.json.verb, 'lan-control');
  assert.deepEqual(tvApps.json.args, { kind: 'android-tv', address: '192.168.1.60', action: 'tv_apps' });
  assert.match(tvApps.json.command, /^python3 -I "\$HOME\/\.local\/share\/oshal-phone-bridge\/oshal_phone_bridge\.py" lan-control --b64 [A-Za-z0-9+/=]+$/);
  assert.deepEqual(JSON.parse(Buffer.from(tvApps.json.command.split(' --b64 ')[1], 'base64').toString('utf8')), tvApps.json.args, 'the command carries exactly the planned arguments');
  assert.equal(tvApps.json.computerRunRequest.endpoint, `/api/computers/${encodeURIComponent(NODE)}/run`);
  assert.equal(tvApps.json.computerRunRequest.body.arguments.command, tvApps.json.command);
  assert.deepEqual(tvApps.json.computer, { id: NODE }, '1.13.0: the plan names the TV\'s own computer for computer.run_plan');
  assert.match(tvApps.json.next, /phone-control-tv-apps-record/);
  assert.equal((await call('POST', '/devices/living-room-fire-tv/apps')).json.device.id, autoTv.json.device.id, 'the TV by its name');
  assert.deepEqual((await call('GET', `/devices/${autoTv.json.device.id}`)).json.history, [], 'plans do not record a TV read or a successful action');
  const phoneApps = await call('POST', `/devices/${ios.id}/apps`);
  assert.deepEqual([phoneApps.status, phoneApps.json.error], [400, 'not_android_tv'], 'a phone is said in words');
  assert.match(phoneApps.json.message, /Android or Fire TV/);
  assert.equal((await call('POST', '/devices/no-such-tv/apps')).status, 404);
  assert.equal((await call('POST', `/devices/${autoTv.json.device.id}/apps`, { person: 'bob' })).status, 404, 'another person cannot read this TV');
  // 1.9.0: a Marquee page opens in the TV's oshal app.
  const marquee = await call('POST', `/devices/${autoTv.json.device.id}/open-link`, { body: { url: 'https://home.test/api/free-library/app#/guide/movie/35/play', app: 'oshal' } });
  assert.equal(marquee.status, 200, JSON.stringify(marquee.json));
  assert.deepEqual(marquee.json.args, { kind: 'android-tv', address: '192.168.1.60', action: 'launch_url', url: 'https://home.test/api/free-library/app#/guide/movie/35/play', app: 'oshal' });
  const plain = await call('POST', '/devices/192.168.1.60/open-link', { body: { url: 'https://example.org/watch' } });
  assert.equal(plain.status, 200);
  assert.equal(plain.json.args.app, undefined, 'no app named: the TV chooses');
  for (const [body, code] of [
    [{ url: 'http://www.netflix.com/title/1', app: 'netflix' }, 'url_invalid'],
    [{ url: 'https://www.netflix.com/title/1 ; reboot', app: 'netflix' }, 'url_invalid'],
    [{ url: 'https://www.netflix.com/title/1', app: 'kodi' }, 'app_invalid'],
    [{ url: 'https://www.netflix.com/title/1', app: 'oshal' }, 'url_invalid'],
    [{ url: 'https://home.test/api/free-library/app?x=1', app: 'oshal' }, 'url_invalid'],
    [{ url: 'https://home.test/api/computers', app: 'oshal' }, 'url_invalid'],
  ]) {
    const refused = await call('POST', `/devices/${autoTv.json.device.id}/open-link`, { body });
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.equal(refused.json.error, code);
  }
  assert.equal((await call('POST', `/devices/${ios.id}/open-link`, { body: { url: 'https://www.netflix.com/title/1' } })).json.error, 'not_android_tv');
  assert.equal((await call('POST', '/devices/no-such-tv/open-link', { body: { url: 'https://www.netflix.com/title/1' } })).status, 404);
  assert.equal((await call('POST', `/devices/${autoTv.json.device.id}/open-link`, { person: 'bob', body: { url: 'https://www.netflix.com/title/1' } })).status, 404, 'another person cannot reach this TV');

  const navTurn = await call('POST', '/concierge/turn', {
    body: { mode: 'phone', prompt: 'move down one and select', device: { name: 'Living Room Fire TV', platform: 'android', form: 'tv' } }
  });
  assert.equal(navTurn.status, 200);
  assert.deepEqual(navTurn.json.actions, [{ kind: 'key', key: 'Down' }, { kind: 'key', key: 'Select' }]);

  const regTurn = await call('POST', '/concierge/turn', {
    body: { mode: 'phone', prompt: 'register Fire TV 192.168.1.60' }
  });
  assert.equal(regTurn.status, 200);
  assert.equal(regTurn.json.actions[0].kind, 'register_device');
  assert.equal(regTurn.json.actions[0].address, '192.168.1.60:5555');
});

test('the Connection Concierge never offers Connect in console, which nothing can serve yet', async () => {
  const kinds = (answer) => answer.json.actions.map((action) => action.kind);
  const chosen = await call('POST', '/concierge/turn', {
    body: { mode: 'connect', prompt: 'How do I connect to my Windows PC over remote desktop?', context: { selectedComputer: { id: NODE, name: 'Spark' } } }
  });
  assert.equal(chosen.status, 200);
  assert.deepEqual(kinds(chosen), ['probe_rdp']);
  assert.deepEqual(chosen.json.actions[0], { kind: 'probe_rdp', label: 'Check RDP port' });
  assert.doesNotMatch(chosen.json.reply, /Connect in console|password/i);
  assert.match(chosen.json.reply, /does not open RDP desktops/);
  const none = await call('POST', '/concierge/turn', { body: { mode: 'connect', prompt: 'RDP on 3389 will not answer' } });
  assert.deepEqual(kinds(none), [], 'without a computer there is nothing to press yet');
  assert.match(none.json.reply, /Use this computer/);
  assert.equal(concierge.sanitizeConnectAction({ kind: 'connect_rdp', label: 'Connect in console' }), null);
  const modelReply = JSON.stringify({ reply: 'Open it here.', done: true, actions: [{ kind: 'connect_rdp' }, { kind: 'probe_rdp' }] });
  const parsed = concierge.parseStructuredReply(modelReply, concierge.sanitizeConnectAction);
  assert.deepEqual(parsed.actions, [{ kind: 'probe_rdp', label: 'Check RDP port' }]);
});

test('a device registered without a computer gets one of the caller\'s own computers or a refusal in words', async () => {
  const refused = await call('POST', '/devices', { person: 'bob', body: { name: 'Bedroom TV', address: '192.0.2.31' } });
  assert.equal(refused.status, 400);
  assert.equal(refused.json.error, 'computer_required');
  assert.match(refused.json.message, /Set up this computer/);
  assert.deepEqual((await call('GET', '/devices', { person: 'bob' })).json.devices, [], 'nothing was saved for bob');
  const source = fs.readFileSync(path.join(PKG, 'routes', 'phone-control-routes.js'), 'utf8');
  assert.doesNotMatch(source, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'no fixed computer id in the routes');
});

test('the page, its modules and the launcher are served; another asset name is not', async () => {
  for (const route of ['/ui', '/config/ui']) {
    const page = await call('GET', route);
    assert.equal(page.status, 200);
    assert.match(page.text, /Set up this computer/);
  }
  for (const asset of [
    'phone-control.css', 'phone-control.js', 'computer-link.js', 'phone-stage.js', 'phone-setup.js',
    'phone-concierge.js', 'phone-rdp.js', 'session-computer.js', 'session-media.js', 'session-collab.js', 'editor-handoff.mjs'
  ]) {
    assert.equal((await call('GET', `/ui/${asset}`)).status, 200, asset);
  }
  assert.equal((await call('GET', '/ui/..%2Flib%2Fdb.js')).status, 404);
  assert.equal((await call('GET', '/ui/phone-control.html')).status, 404);
  assert.match((await call('GET', '/cockpit')).text, /cockpit\/\?app=phone-control/);
});

test('an existing 1.0.0 store loses every row 1.0.0 made up, with its drawn frames, and keeps everything else', () => {
  const file = path.join(work, 'v100.sqlite');
  const old = new DatabaseSync(file);
  old.exec('PRAGMA foreign_keys = ON;');
  old.exec('CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);');
  old.close();
  // The 1.0.0 schema exactly as 1.0.0 applied it: the same file and the same conversion.
  const first = store.getDatabase(file);
  const blob = crypto.createHash('sha256').update('svg').digest('hex');
  const blobPath = path.join(work, 'blobs', blob.slice(0, 2), blob.slice(2, 4), `${blob}.blob`);
  fs.mkdirSync(path.dirname(blobPath), { recursive: true });
  fs.writeFileSync(blobPath, 'svg');
  first.prepare("INSERT INTO phone_control_blobs (sha256, byte_size, mime_type, storage_path) VALUES (?, 3, 'image/svg+xml', ?)").run(blob, blobPath);
  const insert = first.prepare(`INSERT INTO phone_control_devices (device_id, owner_sub, user_sub, name, platform, connection_mode, config_json)
    VALUES (?, 'admin', 'admin', ?, ?, ?, ?)`);
  // The shape 1.0.0 wrote for every device: its invented handshake in config_json (key and PIN made up here).
  const fake = JSON.stringify({ pairingKey: 'TBS-00000000-00000000', pairingPin: '000000', receiverName: 'OSHAL-Mirror', bleTargetName: 'OSHAL-KB' });
  for (const [index, [name, platform, mode]] of [['Starter iPhone', 'ios', 'ble-airplay'], ['Starter Android', 'android', 'adb-wireless'],
    ['Starter computer', 'linux', 'orbit-computer'], ['Paired by the fake button', 'ios', 'ble-airplay']].entries()) insert.run(`dev_seed${index}`, name, platform, mode, fake);
  insert.run('dev_mine0', 'Workbench phone', 'android', 'adb-usb', '{"model":"kept"}');
  first.prepare("INSERT INTO phone_control_frames (frame_id, device_id, owner_sub, user_sub, blob_sha256) VALUES ('frm_1', 'dev_seed0', 'admin', 'admin', ?)").run(blob);
  first.prepare("DELETE FROM schema_migrations WHERE migration_id = 'phone-control-1.1.0-remove-1.0.0-starter-rows'").run();
  first.close();
  const reopened = store.getDatabase(file);
  const names = reopened.prepare('SELECT name FROM phone_control_devices').all().map((row) => row.name);
  assert.deepEqual(names, ['Workbench phone']);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS c FROM phone_control_frames').get().c, 0);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS c FROM phone_control_blobs').get().c, 0);
  assert.equal(fs.existsSync(blobPath), false);
  reopened.close();
  const third = store.getDatabase(file);
  assert.equal(third.prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE migration_id LIKE 'phone-control-1.1.0-%'").get().c, 2);
  third.close();
});

test('TV link and show plans name exactly the saved host for the closed plan runner', async () => {
  const tv = await receiptTv('Pinned plan TV', '192.168.1.96');
  for (const [route, body] of [['open-link', {url:'https://www.netflix.com/watch/80000000',app:'netflix'}],
    ['play', {title:'Example show',app:'prime'}]]) {
    const response = await call('POST', `/devices/${tv.id}/${route}`, {body:{...body,computer:{id:'other-host'},computerNodeId:'other-host'}});
    assert.equal(response.status, 200);
    assert.deepEqual(response.json.computer, {id:NODE});
    assert.match(response.json.next, /computer.run_plan/);
    assert.match(response.json.next, /planId/);
    assert.match(response.json.command, /^python3 -I "\$HOME\/\.local\/share\/oshal-phone-bridge\/oshal_phone_bridge\.py" lan-control --b64 [A-Za-z0-9+/]+={0,2}$/);
    assert.equal(response.json.executed, false);
    assert.equal((await call('POST', `/devices/${tv.id}/${route}`, {person:'bob',body})).status, 404);
  }
  await call('POST', `/devices/${tv.id}`, {body:{controlEnabled:false}});
  assert.equal((await call('POST', `/devices/${tv.id}/play`, {body:{title:'Example show'}})).status, 409);
  assert.equal((await call('POST', `/devices/${tv.id}/open-link`, {body:{url:'https://www.netflix.com/watch/80000000'}})).status, 409);
});
