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
  const tv = await call('POST', '/devices', { body: { name: 'Living Room Fire TV', platform: 'android', form: 'tv', computerNodeId: NODE, address: '192.168.1.138:5555' } });
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
  assert.equal(manifest.version, '1.4.0');
  assert.deepEqual(manifest.files.map((file) => file.name).sort(), [
    'oshal-phone-bridge', 'oshal_phone_ble.py', 'oshal_phone_bridge.py', 'oshal_phone_mirror.py', 'oshal_phone_ops.py'
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
