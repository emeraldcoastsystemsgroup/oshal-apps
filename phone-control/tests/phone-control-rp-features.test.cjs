/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.4.0 Reference-Product backend & handoff regression suite: real HTTP + SQLite + OSHAL_PACKAGE_DATA_DIR verification for preferences, chat, whiteboard, binary captures, and file-transfer records, including validation refusals and cross-user isolation.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const PKG = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-control-rp-routes-'));
process.env.OSHAL_PACKAGE_DATA_DIR = work;

const store = require(path.join(PKG, 'lib', 'db.js'));
const { createPhoneControlRoutes } = require(path.join(PKG, 'routes', 'phone-control-routes.js'));

const PEOPLE = {
  alice: { isActive: true, issuer: 'https://issuer.example', sub: 'alice' },
  bob: { isActive: true, issuer: 'https://issuer.example', sub: 'bob' }
};
const TARGET = 'computer:44444444-4444-4444-8444-444444444444';

let server;
let base;
let current = null;

before(async () => {
  const db = store.getDatabase(path.join(work, 'rp.sqlite'));
  const routes = createPhoneControlRoutes({
    appPackageDir: PKG,
    db,
    authorization: { currentActor: () => current, registerResource() {} }
  });
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
  const response = await fetch(`${base}/api/phone-control${route}${query}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const buf = Buffer.from(await response.arrayBuffer());
  const text = buf.toString('utf8');
  let json = null;
  try { json = JSON.parse(text); } catch { /* binary file */ }
  return { status: response.status, json, buf, headers: response.headers };
}

test('preferences validate targetKey/enums, persist partial updates, and isolate per owner', async () => {
  const defaults = await call('GET', '/sessions/preferences', { query: `?targetKey=${encodeURIComponent(TARGET)}` });
  assert.equal(defaults.status, 200);
  assert.equal(defaults.json.preferences.quality, 'balanced');
  assert.equal(defaults.json.preferences.inputMode, 'touch');

  const updated = await call('POST', '/sessions/preferences', {
    body: { targetKey: TARGET, quality: 'high', inputMode: 'mouse', monitorId: 'HDMI-1', lockOnEnd: true }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.preferences.quality, 'high');
  assert.equal(updated.json.preferences.inputMode, 'mouse');
  assert.equal(updated.json.preferences.monitorId, 'HDMI-1');
  assert.equal(updated.json.preferences.lockOnEnd, true);

  const partial = await call('POST', '/sessions/preferences', { body: { targetKey: TARGET, privacyScreen: true } });
  assert.equal(partial.json.preferences.quality, 'high', 'unspecified fields stay intact');
  assert.equal(partial.json.preferences.privacyScreen, true);

  const bobPrefs = await call('GET', '/sessions/preferences', { person: 'bob', query: `?targetKey=${encodeURIComponent(TARGET)}` });
  assert.equal(bobPrefs.json.preferences.quality, 'balanced');
  assert.equal(bobPrefs.json.preferences.lockOnEnd, false);

  assert.equal((await call('POST', '/sessions/preferences', { body: { targetKey: 'invalid key!', quality: 'high' } })).status, 400);
  assert.equal((await call('POST', '/sessions/preferences', { body: { targetKey: TARGET, quality: 'ultra' } })).status, 400);
  assert.equal((await call('POST', '/sessions/preferences', { body: { targetKey: TARGET, owner: 'bob' } })).status, 400);
});

test('chat messages and whiteboard overlays validate inputs, isolate owners, and clear cleanly', async () => {
  const m1 = await call('POST', '/sessions/chat', { body: { targetKey: TARGET, sender: 'operator', body: 'Are you ready to share?' } });
  const m2 = await call('POST', '/sessions/chat', { body: { targetKey: TARGET, sender: 'remote', body: 'Yes, go ahead.' } });
  assert.equal(m1.status, 201);
  assert.equal(m2.status, 201);

  const thread = await call('GET', '/sessions/chat', { query: `?targetKey=${encodeURIComponent(TARGET)}` });
  assert.deepEqual(thread.json.messages.map((m) => [m.sender, m.body]), [
    ['operator', 'Are you ready to share?'],
    ['remote', 'Yes, go ahead.']
  ]);
  assert.deepEqual((await call('GET', '/sessions/chat', { person: 'bob', query: `?targetKey=${encodeURIComponent(TARGET)}` })).json.messages, []);
  assert.equal((await call('POST', '/sessions/chat', { body: { targetKey: TARGET, sender: 'system', body: 'bad' } })).status, 400);
  assert.equal((await call('POST', '/sessions/chat', { body: { targetKey: TARGET, sender: 'operator', body: '' } })).status, 400);
  assert.equal((await call('DELETE', '/sessions/chat', { query: `?targetKey=${encodeURIComponent(TARGET)}` })).status, 200);
  assert.deepEqual((await call('GET', '/sessions/chat', { query: `?targetKey=${encodeURIComponent(TARGET)}` })).json.messages, []);

  const stroke = { color: '#ef4444', width: 4, points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.7 }] };
  const wbSaved = await call('POST', '/sessions/whiteboard', { body: { targetKey: TARGET, strokes: [stroke] } });
  assert.equal(wbSaved.status, 200);
  assert.equal(wbSaved.json.whiteboard.strokes.length, 1);
  assert.deepEqual((await call('GET', '/sessions/whiteboard', { person: 'bob', query: `?targetKey=${encodeURIComponent(TARGET)}` })).json.whiteboard.strokes, []);
  assert.equal((await call('POST', '/sessions/whiteboard', { body: { targetKey: TARGET, strokes: [{ color: 'red', points: [{ x: 0, y: 0 }] }] } })).status, 400);
  assert.equal((await call('DELETE', '/sessions/whiteboard', { query: `?targetKey=${encodeURIComponent(TARGET)}` })).status, 200);
  assert.deepEqual((await call('GET', '/sessions/whiteboard', { query: `?targetKey=${encodeURIComponent(TARGET)}` })).json.whiteboard.strokes, []);
});

test('captures and file transfers store binary payloads under OSHAL_PACKAGE_DATA_DIR, enforce owner 404, and unlink on delete', async () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const shot = await call('POST', '/sessions/captures', {
    body: {
      targetKey: TARGET, kind: 'screenshot', mimeType: 'image/png',
      fileName: 'screen.png', width: 1280, height: 720, dataBase64: pngBytes.toString('base64')
    }
  });
  assert.equal(shot.status, 201);
  const shotId = shot.json.capture.id;
  const downloaded = await call('GET', `/sessions/captures/${shotId}`);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.buf, pngBytes);
  assert.match(downloaded.headers.get('content-disposition') || '', /attachment; filename="screen\.png"/);
  assert.equal((await call('GET', `/sessions/captures/${shotId}`, { person: 'bob' })).status, 404);
  assert.equal((await call('DELETE', `/sessions/captures/${shotId}`, { person: 'bob' })).status, 404);
  assert.equal((await call('DELETE', `/sessions/captures/${shotId}`)).status, 204);
  assert.equal((await call('GET', `/sessions/captures/${shotId}`)).status, 404);
  assert.equal((await call('POST', '/sessions/captures', { body: { targetKey: TARGET, kind: 'screenshot', mimeType: 'text/html', dataBase64: 'YWJj' } })).status, 400);

  const docBytes = Buffer.from('Diagnostic log content\n', 'utf8');
  const xfer = await call('POST', '/sessions/transfers', {
    body: {
      targetKey: TARGET, direction: 'upload', fileName: 'diag.log', mimeType: 'text/plain',
      byteSize: docBytes.length, remotePath: '~/Downloads/diag.log', status: 'completed',
      dataBase64: docBytes.toString('base64')
    }
  });
  assert.equal(xfer.status, 201);
  const xferId = xfer.json.transfer.id;
  assert.deepEqual((await call('GET', `/sessions/transfers/${xferId}`)).buf, docBytes);
  assert.equal((await call('GET', `/sessions/transfers/${xferId}`, { person: 'bob' })).status, 404);
  assert.equal((await call('DELETE', `/sessions/transfers/${xferId}`)).status, 204);
  assert.equal((await call('GET', `/sessions/transfers/${xferId}`)).status, 404);
});

test('editor-handoff builds accurate context snapshots for TV, phone, computer, and connect mode', async () => {
  const handoff = await import(path.join(PKG, 'tools', 'editor-handoff.mjs'));
  const tvSnap = handoff.buildPhoneControlContextSnapshot({
    mode: 'devices',
    selectedPhone: { id: 'ph_tv1', name: 'Living Room TV', platform: 'android', form: 'tv', controlEnabled: true },
    phones: [{}],
    computers: [{}, {}]
  });
  assert.equal(tvSnap.surface, 'phone-control-execution');
  assert.match(tvSnap.digest, /Living Room TV \(TV\)/);
  assert.equal(tvSnap.fields.targetKey, 'phone:ph_tv1');

  let prepared = null;
  handoff.connectPhoneControlHandoff({
    getState: () => ({ mode: 'connect', computer: { id: 'c1', name: 'Spark' }, phones: [], computers: [{}] }),
    registerSession(reg) { prepared = reg; return () => {}; }
  });
  const doc = await prepared.prepare();
  assert.equal(doc.surface, 'phone-control-config');
  assert.equal(doc.fields.targetKey, 'computer:c1');
});
