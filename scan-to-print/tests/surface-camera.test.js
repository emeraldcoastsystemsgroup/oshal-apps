/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the surface's camera module under plain node:
 *                     |                             | the six-view order and its framing guidance, frame
 *                     |                             | bounding, upload names, the countdown sequence driven by
 *                     |                             | a fake clock (ticks, capture, skip, stop, a failing
 *                     |                             | capture halts), and the stream wrapper against a fake
 *                     |                             | mediaDevices (rear camera first, flip, stop releases
 *                     |                             | tracks, capture bounds the JPEG, no frame → reject).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const cam = require(path.resolve(__dirname, '..', 'tools', 'scan-to-print-camera.js'));

test('the sequence is the six canonical views, front/top/right required, with front-edge guidance', () => {
  assert.deepEqual(cam.VIEWS, ['front', 'top', 'right', 'left', 'back', 'bottom']);
  assert.deepEqual(cam.SEQUENCE.filter((s) => s.required).map((s) => s.view), ['front', 'top', 'right']);
  assert.match(cam.guideFor('top'), /FRONT edge at the BOTTOM/);
  assert.match(cam.guideFor('right'), /FRONT edge is on the LEFT/);
  assert.match(cam.guideFor('left'), /FRONT edge is on the RIGHT/);
  assert.match(cam.guideFor('bottom'), /FRONT edge at the TOP/);
  assert.match(cam.guideFor('nonsense'), /square to the face/);
  assert.equal(cam.nextView([]), 'front');
  assert.equal(cam.nextView(['front', 'top']), 'right');
  assert.equal(cam.nextView(cam.VIEWS), null);
});

test('frameSize bounds the long side, keeps the aspect ratio and never collapses', () => {
  assert.deepEqual(cam.frameSize(4032, 3024, 1280), { width: 1280, height: 960 });
  assert.deepEqual(cam.frameSize(1080, 1920, 1280), { width: 720, height: 1280 });
  assert.deepEqual(cam.frameSize(640, 480, 1280), { width: 640, height: 480 });
  assert.deepEqual(cam.frameSize(0, 0, 1280), { width: 1, height: 1 });
  assert.deepEqual(cam.frameSize(100000, 1, 1280), { width: 1280, height: 1 });
});

test('upload names are view-prefixed, sanitised JPEG names', () => {
  assert.equal(cam.fileNameFor('front', 1700000000000), 'front-1700000000000.jpg');
  assert.equal(cam.fileNameFor('../x', 'a b'), 'x-ab.jpg');
  assert.match(cam.fileNameFor('top'), /^top-\d+\.jpg$/);
});

test('hasCamera needs mediaDevices.getUserMedia and a secure context', () => {
  assert.equal(cam.hasCamera({ mediaDevices: { getUserMedia() {} } }, true), true);
  assert.equal(cam.hasCamera({ mediaDevices: { getUserMedia() {} } }, false), false);
  assert.equal(cam.hasCamera({ mediaDevices: {} }, true), false);
  assert.equal(cam.hasCamera(undefined, true), false);
});

/** A deterministic clock: setTimeout queues, run() drains in order (and anything queued meanwhile). */
function fakeClock() {
  const queue = [];
  let seq = 0;
  return {
    setTimeout(fn, ms) { const id = ++seq; queue.push({ id, fn, ms }); return id; },
    clearTimeout(id) { const i = queue.findIndex((q) => q.id === id); if (i >= 0) queue.splice(i, 1); },
    // A macrotask turn after each callback lets an async capture settle before the next timer is queued.
    async run() { while (queue.length) { const q = queue.shift(); q.fn(); await new Promise((r) => setImmediate(r)); } },
    pending() { return queue.length; },
  };
}

test('the sequence counts down each view, captures at zero and reports completion in order', async () => {
  const clock = fakeClock();
  const ticks = [], captured = [];
  let done = null;
  const seq = cam.createSequence({
    views: ['front', 'top', 'right'], countdownMs: 3000, tickMs: 1000,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    onTick: (view, ms) => ticks.push(view + ':' + ms),
    onCapture: async (view) => { captured.push(view); return { view }; },
    onDone: (list) => { done = list; },
  });
  assert.equal(seq.start(), true);
  assert.equal(seq.start(), false, 'a running sequence does not restart');
  assert.deepEqual(seq.state(), { index: 0, view: 'front', remainingMs: 3000, running: true, capturing: false, captured: 0, total: 3 });
  await clock.run();
  assert.deepEqual(ticks, ['front:3000', 'front:2000', 'front:1000', 'top:3000', 'top:2000', 'top:1000', 'right:3000', 'right:2000', 'right:1000']);
  assert.deepEqual(captured, ['front', 'top', 'right']);
  assert.deepEqual(done.map((d) => d.view), ['front', 'top', 'right']);
  assert.equal(seq.state().running, false);
  assert.equal(clock.pending(), 0);
});

test('skip jumps to the next view without capturing; stop halts and clears the timer', async () => {
  const clock = fakeClock();
  const captured = [];
  const seq = cam.createSequence({ views: ['front', 'top', 'right'], countdownMs: 2000, tickMs: 1000, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, onCapture: (v) => { captured.push(v); } });
  seq.start();
  assert.equal(seq.skip(), true);
  assert.equal(seq.state().view, 'top');
  assert.equal(clock.pending(), 1, 'the skipped view timer was cleared, the next one is queued');
  seq.stop();
  assert.equal(clock.pending(), 0);
  assert.equal(seq.state().running, false);
  assert.equal(seq.skip(), false, 'skip is a no-op once stopped');
  await clock.run();
  assert.deepEqual(captured, []);
});

test('a failing capture halts the sequence and reports the view', async () => {
  const clock = fakeClock();
  let failure = null;
  let finished = false;
  const seq = cam.createSequence({
    views: ['front', 'top'], countdownMs: 1000, tickMs: 1000, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    onCapture: async (view) => { if (view === 'front') throw new Error('upload refused'); },
    onError: (err, view) => { failure = { message: err.message, view }; }, onDone: () => { finished = true; },
  });
  seq.start();
  await clock.run();
  assert.deepEqual(failure, { message: 'upload refused', view: 'front' });
  assert.equal(finished, false);
  assert.equal(seq.state().running, false);
});

/** Fakes for the stream wrapper: a mediaDevices that records constraints and a <video> with a frame. */
function fakeMedia(settings) {
  const calls = [];
  const stopped = [];
  const stream = { getTracks: () => [{ stop: () => stopped.push('v'), label: 'Back camera', getSettings: () => settings }], getVideoTracks() { return this.getTracks(); } };
  return { calls, stopped, mediaDevices: { async getUserMedia(c) { calls.push(c); return stream; } } };
}
function fakeVideo(w, h) { return { videoWidth: w, videoHeight: h, srcObject: null, played: 0, play() { this.played += 1; return Promise.resolve(); } }; }
function fakeCanvasFactory(log) {
  return (w, h) => ({ width: w, height: h, getContext: () => ({ drawImage: (...args) => log.push(['draw', args[3], args[4]]) }), toBlob: (cb, type, q) => { log.push(['blob', type, q]); cb({ type, size: 1234 }); } });
}

test('the stream wrapper asks for the rear camera first, flips to the front, and stop releases the tracks', async () => {
  const media = fakeMedia({ facingMode: 'environment', width: 1920, height: 1080 });
  const video = fakeVideo(1920, 1080);
  const stream = cam.createCameraStream(media.mediaDevices, video);
  assert.equal(stream.active(), false);
  const info = await stream.start();
  assert.deepEqual(media.calls[0], { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  assert.deepEqual(info, { facing: 'environment', width: 1920, height: 1080, label: 'Back camera' });
  assert.equal(video.played, 1);
  assert.equal(stream.active(), true);
  await stream.flip();
  assert.equal(media.calls[1].video.facingMode.ideal, 'user');
  assert.equal(media.stopped.length, 1, 'flipping released the first stream');
  stream.stop();
  assert.equal(media.stopped.length, 2);
  assert.equal(video.srcObject, null);
  assert.equal(stream.active(), false);
});

test('capture draws the bounded frame into a JPEG and rejects before the first frame', async () => {
  const media = fakeMedia({});
  const video = fakeVideo(4032, 3024);
  const stream = cam.createCameraStream(media.mediaDevices, video);
  await stream.start();
  const log = [];
  const shot = await stream.capture(fakeCanvasFactory(log), 1280, 0.9);
  assert.deepEqual([shot.width, shot.height], [1280, 960]);
  assert.deepEqual(log, [['draw', 1280, 960], ['blob', 'image/jpeg', 0.9]]);
  assert.equal(shot.blob.size, 1234);
  const blank = cam.createCameraStream(media.mediaDevices, fakeVideo(0, 0));
  await blank.start();
  await assert.rejects(blank.capture(fakeCanvasFactory([]), 1280), /has not delivered a frame/);
});
