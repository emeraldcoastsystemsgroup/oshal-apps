/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Lesson media route and video installer: a video goes out by reference to the exact copy its manifest names; only a lesson's own file names are served; a video never installed answers 404 and is logged. Regression: real videos exceed the 8 MiB package reply, and every package file is copied into every sandbox.
 * -----------------------------------------------------------------------------
 *
 * Real Express, a real filesystem and the real installer. The kernel side of a lasting-file
 * reply (its 206 answer) is covered by tests/authorization/native-prep.rs and the live proof.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const INSTALLER = path.join(PKG, 'scripts/lesson-studio/install-videos.py');

const load = Module._load;
const logged = [];
Module._load = function (name, ...rest) {
  if (name === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error: (...args) => logged.push(args) }) };
  return load.call(this, name, ...rest);
};
const { createPrepMediaHandler, keptVideoPath } = require('../routes/education-prep-media');
Module._load = load;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-prep-media-'));
const mediaRoot = path.join(work, 'media');
const videos = path.join(work, 'videos');
const dataDir = path.join(work, 'data');
const bytes = crypto.randomBytes(1 << 20);
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const other = crypto.randomBytes(4096);
const otherSha = crypto.createHash('sha256').update(other).digest('hex');
for (const dir of [mediaRoot, videos, dataDir]) fs.mkdirSync(dir);
fs.writeFileSync(path.join(videos, 'linear.mp4'), bytes);
fs.writeFileSync(path.join(videos, 'trig.mp4'), other);
fs.writeFileSync(path.join(mediaRoot, 'linear.vtt'), 'WEBVTT\n');
fs.writeFileSync(path.join(mediaRoot, 'linear.jpg'), 'poster');
fs.writeFileSync(path.join(work, 'secret.mp4'), 'secret');
fs.writeFileSync(path.join(mediaRoot, 'old.webm'), 'old');
const manifest = path.join(mediaRoot, 'manifest.json');
const lessons = { linear: { sha256 }, trig: { sha256: otherSha }, 'never-installed': { sha256: 'a'.repeat(64) } };
fs.writeFileSync(manifest, JSON.stringify({ lessons: { linear: lessons.linear, trig: lessons.trig } }));

const install = (...extra) => execFileSync('python3', [INSTALLER, '--data', dataDir, '--videos', videos, '--manifest', manifest, ...extra], { encoding: 'utf8' });

let server, base;
test.before(async () => {
  const app = express();
  const kernel = createPrepMediaHandler(mediaRoot, { OSHAL_PACKAGE_DATA_DIR: dataDir });
  app.get('/kernel/:file', (req, res, next) => {
    res.lastingFile = (relative, options) => res.json({ relative, options, type: res.getHeader('content-type') });
    return kernel(req, res, next);
  });
  app.get('/plain/:file', createPrepMediaHandler(mediaRoot, { OSHAL_PACKAGE_DATA_DIR: dataDir }));
  app.get('/nostorage/:file', createPrepMediaHandler(mediaRoot, {}));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); fs.rmSync(work, { recursive: true, force: true }); });

test('a video that was never installed answers 404 and the failure is logged', async () => {
  logged.length = 0;
  const res = await fetch(`${base}/kernel/linear.mp4`);
  assert.equal(res.status, 404);
  assert.equal(logged.length, 1);
  assert.match(logged[0][1], /install-videos/);
  logged.length = 0;
  assert.equal((await fetch(`${base}/nostorage/linear.mp4`)).status, 404);
  assert.equal(logged.length, 1);
});

test('the installer copies each video whole under the name the route asks for', () => {
  assert.match(install(), /2 lesson videos .*2 copied/);
  const kept = path.join(dataDir, keptVideoPath('linear', sha256));
  assert.ok(fs.readFileSync(kept).equals(bytes));
  assert.equal(fs.statSync(kept).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'prep-media')).filter((n) => n.startsWith('.')), [], 'no partial copy is left');
});

test('running the installer again copies nothing, and a damaged copy is replaced', () => {
  assert.match(install(), /0 copied/);
  const kept = path.join(dataDir, keptVideoPath('linear', sha256));
  fs.truncateSync(kept, 100);
  assert.match(install(), /1 copied/);
  assert.ok(fs.readFileSync(kept).equals(bytes));
});

test('the installer refuses a video that does not match its manifest', () => {
  const bad = path.join(work, 'bad');
  fs.mkdirSync(bad);
  fs.writeFileSync(path.join(bad, 'linear.mp4'), 'not the video that was filmed');
  fs.writeFileSync(path.join(bad, 'trig.mp4'), other);
  const fresh = path.join(work, 'fresh');
  fs.mkdirSync(fresh);
  const run = spawnSync('python3', [INSTALLER, '--data', fresh, '--videos', bad, '--manifest', manifest], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /does not match the manifest/);
  assert.deepEqual(fs.readdirSync(path.join(fresh, 'prep-media')), []);
});

test('--prune removes videos the manifest no longer names, and only those', () => {
  const folder = path.join(dataDir, 'prep-media');
  const older = path.join(folder, `linear-${'0'.repeat(16)}.mp4`);
  const unrelated = path.join(folder, 'notes.txt');
  fs.writeFileSync(older, 'old take');
  fs.writeFileSync(unrelated, 'keep');
  assert.match(install(), /0 removed/);
  assert.ok(fs.existsSync(older), 'a plain install leaves the old video for the package still running');
  assert.match(install('--prune'), /1 removed/);
  assert.ok(!fs.existsSync(older));
  assert.ok(fs.existsSync(unrelated));
});

test('a video is answered by reference to the exact copy its manifest names', async () => {
  const reply = await (await fetch(`${base}/kernel/linear.mp4`)).json();
  assert.equal(reply.relative, `prep-media/linear-${sha256.slice(0, 16)}.mp4`);
  assert.equal(reply.type, 'video/mp4');
  assert.deepEqual(reply.options, { filename: 'linear.mp4', inline: true });
});

test('with no lasting-file reply the kept copy goes out directly with real byte ranges', async () => {
  const res = await fetch(`${base}/plain/linear.mp4`, { headers: { range: 'bytes=10-109' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 10-109/${bytes.length}`);
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(bytes.subarray(10, 110)));
});

test('captions and posters are sent directly, with their media types', async () => {
  const vtt = await fetch(`${base}/kernel/linear.vtt`);
  assert.equal(vtt.status, 200);
  assert.match(vtt.headers.get('content-type'), /^text\/vtt/);
  assert.equal(await vtt.text(), 'WEBVTT\n');
  const jpg = await fetch(`${base}/kernel/linear.jpg`);
  assert.equal(jpg.status, 200);
  assert.match(jpg.headers.get('content-type'), /^image\/jpeg/);
});

test('only a lesson\'s own file names are served', async () => {
  for (const name of ['..%2Fsecret.mp4', 'manifest.json', 'old.webm', '.linear.mp4', 'LINEAR.mp4', 'linear.mp4.exe', 'nope.mp4', 'nope.jpg', 'linear%00.mp4']) {
    const res = await fetch(`${base}/kernel/${name}`);
    assert.equal(res.status, 404, name);
    assert.notEqual(await res.text(), 'secret', name);
  }
});

test('the videos are left out of what the kernel copies into each sandbox', () => {
  const attributes = fs.readFileSync(path.join(PKG, '..', '.gitattributes'), 'utf8');
  assert.match(attributes, /^little-monsters\/\.videos\/\*\* export-ignore$/m, 'and out of git archive, so app roots stay small');
  for (const name of fs.readdirSync(path.join(PKG, 'tools/prep-media'))) assert.doesNotMatch(name, /\.(mp4|webm)$/, `${name} would be copied into every sandbox`);
});
