/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Square-on frame suggestions over loopback HTTP (BACKLOG B12): a video of a 60 x 40 x 20 box on a turntable goes through the real video route (a fake ffmpeg writes the frames), and /frame-suggestions proposes its 0, 90 and 180 degree frames for front, right and back while top, left and bottom get no proposal; once the person assigns front, that view and that frame drop out of the proposals; a job without a video answers 409 and another owner 404.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express/multer/sharp. Not part of the store-CI
 * wildcard; run locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/frames.core.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startFixture, json, coreRequire } = require('./routes-core.fixture.js');

const sharp = coreRequire('sharp');
let fixture;
test.before(async () => { fixture = await startFixture(); });
test.after(async () => fixture.close());
const call = (...args) => fixture.call(...args);

const BOX = { x: 60, y: 40, z: 20 };
const YAWS = Array.from({ length: 17 }, (_, i) => -30 + 15 * i); // -30 .. 210: 0, 90 and 180 are frames 3, 9 and 15

/** A photo of the box turned `yawDeg` about Z, seen by a fixed front camera at 2 px/mm. */
async function turnedBox(yawDeg) {
  const w = 220, h = 120, a = (yawDeg * Math.PI) / 180;
  const halfW = (Math.abs(Math.cos(a)) * BOX.x + Math.abs(Math.sin(a)) * BOX.y) / 2; // a box turned about Z projects to a rectangle
  const data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const inside = Math.abs(x + 0.5 - w / 2) < 2 * halfW && Math.abs(y + 0.5 - h / 2) < BOX.z;
    data.set(inside ? [40, 70, 160] : [214, 200, 176], (y * w + x) * 3);
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

/** Stand in for ffmpeg: write one frame per yaw where the extractor's output pattern points. */
async function fakeFfmpeg(_file, args) {
  const dir = path.dirname(args.at(-1));
  for (const [i, yaw] of YAWS.entries()) fs.writeFileSync(path.join(dir, `frame-${String(i + 1).padStart(3, '0')}.png`), await turnedBox(yaw));
  return { stdout: '', stderr: '' };
}

async function videoJob() {
  const id = (await call('/jobs', json('POST', { title: 'turntable' }))).body.job.job_id;
  assert.equal((await call(`/jobs/${id}`, json('PATCH', { knownDimensions: [{ axis: 'x', mm: 60 }, { axis: 'y', mm: 40 }, { axis: 'z', mm: 20 }] }))).status, 200);
  fixture.control.execFile = fakeFfmpeg;
  try {
    const form = new FormData();
    form.append('video', new Blob([Buffer.from('not really a video')]), 'spin.mp4');
    const up = await call(`/jobs/${id}/video`, { method: 'POST', body: form });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.frames, YAWS.length);
  } finally { fixture.control.execFile = null; }
  return id;
}

test('B12: a turntable video yields its square-on frames as front, right and back; unseen views get none', async () => {
  const id = await videoJob();
  const out = await call(`/jobs/${id}/frame-suggestions`);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.frames, YAWS.length);
  const byView = Object.fromEntries(out.body.suggestions.map((s) => [s.view, s.fileName]));
  assert.deepEqual(byView, { front: 'frame-003.png', right: 'frame-009.png', back: 'frame-015.png' }, JSON.stringify(out.body.suggestions));
  assert.deepEqual(out.body.unmatched, ['top', 'left', 'bottom']);
  assert.equal(out.body.proportionsKnown, 3);

  const front = out.body.suggestions.find((s) => s.view === 'front');
  assert.equal((await call(`/jobs/${id}/images/${front.imageId}`, json('PATCH', { view: 'front' }))).status, 200, 'the person confirms by assigning');
  const after = await call(`/jobs/${id}/frame-suggestions`);
  assert.deepEqual(after.body.suggestions.map((s) => s.view), ['right', 'back'], 'an assigned view is not proposed again');
  assert.ok(after.body.suggestions.every((s) => s.imageId !== front.imageId), 'nor is the assigned frame');
});

test('B12: a job without a video answers 409; another owner gets 404', async () => {
  const id = (await call('/jobs', json('POST', { title: 'photos only' }))).body.job.job_id;
  const none = await call(`/jobs/${id}/frame-suggestions`);
  assert.equal(none.status, 409);
  assert.equal(none.body.error, 'no_video_frames');
  fixture.control.sub = 'mallory';
  try { assert.equal((await call(`/jobs/${id}/frame-suggestions`)).status, 404); } finally { fixture.control.sub = 'alice'; }
});
