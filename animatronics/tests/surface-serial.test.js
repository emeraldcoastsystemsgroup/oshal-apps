/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The browser-side pieces under plain node: the controller link over a fake Web Serial port (connect opens at the baud, lines are written exactly as given, a stream is paced at the frame period and reports progress, E-STOP aborts a running stream and goes out, the controller's replies are parsed through the shared protocol and counted, a hello reply is remembered, disconnect closes the port, and a browser without Web Serial is refused with a plain message); and the view's pure layout (pupils follow pan/tilt, lids close by fraction, the head shifts with the neck, the jaw drops, arm axes become bars).
 *
 * Dependency-free: plain node against tools/ and routes/engine. Run: node --test "tests/*-*.test.js"
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Serial = require(path.join(__dirname, '..', 'tools', 'animatronics-serial.js'));
const View = require(path.join(__dirname, '..', 'tools', 'animatronics-view.js'));
const E = require(path.join(__dirname, '..', 'routes', 'engine', 'index.js'));

function fakePort() {
  const written = [];
  let feed;
  const readable = new ReadableStream({ start(controller) { feed = controller; } });
  const writable = new WritableStream({ write(chunk) { written.push(new TextDecoder().decode(chunk)); } });
  return { written, readable, writable, opened: null, closed: false, feed: (text) => feed.enqueue(new TextEncoder().encode(text)), async open(o) { this.opened = o; }, async close() { this.closed = true; feed.close(); } };
}
function fakeSerial(port) { return { requestPort: async () => port }; }
const tick = () => new Promise((r) => setTimeout(r, 5));

test('connect opens the port at the baud; lines go out exactly; replies are parsed and counted', async () => {
  const port = fakePort();
  const messages = []; const states = [];
  const link = Serial.createControllerLink({ serial: fakeSerial(port), protocol: E, onMessage: (m) => messages.push(m), onState: (s) => states.push(s), baud: 115200 });
  await link.connect();
  assert.deepEqual(port.opened, { baudRate: 115200 }); assert.equal(link.state, 'connected'); assert.equal(link.isConnected(), true);
  await link.sendLines([E.encodeHello(), E.encodeLimits(0, 500, 2400)]);
  await link.send('F 0 0=1450*7A');
  assert.deepEqual(port.written, ['H*48\n', E.encodeLimits(0, 500, 2400), 'F 0 0=1450*7A\n']);
  assert.equal(link.counters.sent, 3);
  port.feed(E.encodeHelloReply('pca9685', 16) + 'OK L 0*' + E.checksum('OK L 0') + '\nOK 0*');
  await tick();
  port.feed(E.checksum('OK 0') + '\nERR 9 channel 40 out of range*' + E.checksum('ERR 9 channel 40 out of range') + '\ngarbage\n');
  await tick();
  assert.deepEqual(link.hello, { kind: 'hello-reply', name: 'oshal-animatronics', version: 1, board: 'pca9685', channels: 16 });
  assert.deepEqual(link.counters, { sent: 3, ok: 2, err: 1, invalid: 1 });
  assert.equal(link.lastError, 'channel 40 out of range');
  assert.deepEqual(messages.map((m) => m.kind), ['hello-reply', 'ok', 'ok', 'err', 'invalid']);
  await link.disconnect();
  assert.equal(port.closed, true); assert.equal(link.state, 'disconnected'); assert.equal(link.hello, null);
  assert.deepEqual(states, ['connecting', 'connected', 'disconnected']);
});

test('a stream is paced at the frame period and reports progress; E-STOP aborts it and goes out', async () => {
  const port = fakePort();
  let clock = 0; const waits = [];
  const link = Serial.createControllerLink({ serial: fakeSerial(port), protocol: E, now: () => clock, setTimeout: (fn, ms) => { waits.push(ms); clock += ms; fn(); } });
  await link.connect();
  const lines = E.frameLines([0, 1], [[1500, 1500], [1510, 1500], [1520, 1500], [1530, 1500]]);
  const progress = [];
  const result = await link.stream(lines, 20, { onProgress: (i, n) => progress.push([i, n]) });
  assert.deepEqual(result, { sent: 4, aborted: false });
  assert.deepEqual(waits, [20, 40, 60].map((v, i) => v - i * 20), 'each frame waits until its due time');
  assert.deepEqual(progress, [[0, 4], [1, 4], [2, 4], [3, 4]]);
  assert.deepEqual(port.written, lines);
  assert.equal(link.state, 'connected');
  const long = E.frameLines([0], Array.from({ length: 50 }, (_, i) => [1500 + i]));
  let stopping = null;
  const streaming = link.stream(long, 20, { onProgress: (i) => { if (i === 4 && !stopping) stopping = link.estop(E.encodeEstop()); } });
  const r2 = await streaming;
  await stopping;
  assert.equal(r2.aborted, true); assert.ok(r2.sent <= 6, `stopped early (${r2.sent})`);
  assert.equal(port.written[port.written.length - 1], 'E*45\n', 'the stop line is the last thing written');
  assert.equal(link.state, 'estopped');
  await link.release(E.encodeRelease());
  assert.equal(link.state, 'connected');
  await link.disconnect();
});

test('a browser without Web Serial is refused with a plain message; support is detected', async () => {
  const link = Serial.createControllerLink({ serial: undefined, protocol: E });
  await assert.rejects(() => link.connect(), /Web Serial is not available/);
  assert.equal(link.state, 'disconnected');
  await assert.rejects(() => link.send('H*48'), /not connected/);
  assert.equal(Serial.supported({ serial: { requestPort() {} } }), true);
  assert.equal(Serial.supported({}), false);
});

test('the view layout follows the angles (pure)', () => {
  const rows = E.servoMap(E.loadServoCatalog(path.join(__dirname, '..', 'catalog', 'servos.json')).servos);
  const skull = E.buildTemplates(rows).find((t) => t.id === 'skull');
  const neutral = View.layout(skull.rig, E.neutralPose(skull.rig));
  assert.deepEqual(neutral.has, { eyes: true, lids: true, neck: true, jaw: true });
  assert.deepEqual(neutral.pupil, { dx: 0, dy: -0 }); assert.equal(neutral.jaw.dy, 0); assert.equal(neutral.head.dx, 0);
  const look = View.layout(skull.rig, { 'eyes.pan': 30, 'eyes.tilt': 25, 'lids.upper': 60, 'lids.lower': 40, 'neck.yaw': -45, 'neck.pitch': 25, 'jaw.open': 35 });
  assert.equal(look.pupil.dx, 14); assert.equal(look.pupil.dy, -10);
  assert.equal(look.lids.upper, 1); assert.equal(look.lids.lower, 1);
  assert.equal(look.head.dx, -40); assert.equal(look.head.dy, -24); assert.equal(look.jaw.dy, 36);
  const arm = E.validateRig({ channels: [skull.rig.channels[0], skull.rig.channels[1]], mechanisms: [{ id: 'arm', kind: 'arm', axes: { shoulder: 'eye-pan', elbow: 'eye-tilt' } }] });
  const bars = View.layout(arm, { 'arm.shoulder': 30, 'arm.elbow': 0 });
  assert.deepEqual(bars.bars.map((b) => [b.key, b.frac]), [['arm.shoulder', 1], ['arm.elbow', 0.5]]);
  assert.equal(bars.has.eyes, false);
});
