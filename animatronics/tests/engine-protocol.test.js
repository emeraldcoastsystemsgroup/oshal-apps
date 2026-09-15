/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The controller line protocol against the COMPILED engine, with the checksum vectors the firmware's README repeats: every message round-trips through the one parser, a missing or wrong checksum, an unknown verb, a malformed frame and a bad hello reply are `invalid` with the reason (never a throw), frame lines are delta-encoded (frame 0 full, then changed outputs only, a keyframe every 25, an empty heartbeat when nothing moved), a stream fits the serial budget, and the line splitter keeps a partial tail.
 *
 * Dependency-free: plain node against routes/engine. Run: node --test "tests/*-*.test.js"
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.join(__dirname, '..', 'routes', 'engine', 'index.js'));

test('checksum vectors (shared with the firmware README)', () => {
  assert.equal(E.checksum('H'), '48');
  assert.equal(E.checksum('E'), '45');
  assert.equal(E.checksum('F 7 0=1500,1=1720'), '5C');
  assert.equal(E.checksum('L 3 500 2400'), '6C');
  assert.equal(E.checksum('HELLO oshal-animatronics/1 board=pca9685 channels=16'), '21');
  assert.equal(E.checksum('ESTOP'), '5D');
  assert.equal(E.encodeHello(), 'H*48\n');
  assert.equal(E.encodeEstop(), 'E*45\n');
  assert.equal(E.encodeFrame(7, [[0, 1500], [1, 1720]]), 'F 7 0=1500,1=1720*5C\n');
  assert.equal(E.encodeLimits(3, 500, 2400), 'L 3 500 2400*' + E.checksum('L 3 500 2400') + '\n');
});

test('every message round-trips through the one parser', () => {
  const cases = [
    [E.encodeHello(), { kind: 'hello' }],
    [E.encodeEstop(), { kind: 'estop' }],
    [E.encodeRelease(), { kind: 'release' }],
    [E.encodeLimits(3, 500, 2400), { kind: 'limits', channel: 3, minUs: 500, maxUs: 2400 }],
    [E.encodeFrame(12, [[0, 1500], [15, 2400]]), { kind: 'frame', seq: 12, pairs: [[0, 1500], [15, 2400]] }],
    [E.encodeFrame(13, []), { kind: 'frame', seq: 13, pairs: [] }],
    [E.encodeOk('12'), { kind: 'ok', ref: '12' }],
    [E.encodeErr('12', 'channel 40 out of range'), { kind: 'err', ref: '12', reason: 'channel 40 out of range' }],
    [E.encodeHelloReply('pca9685', 16), { kind: 'hello-reply', name: 'oshal-animatronics', version: 1, board: 'pca9685', channels: 16 }],
    [E.encodeEstopped(), { kind: 'estopped' }],
  ];
  for (const [line, expected] of cases) { assert.match(line, /\*[0-9A-F]{2}\n$/); assert.deepEqual(E.parseLine(line), expected, line); }
  assert.deepEqual(E.parseLine('h*68'), { kind: 'invalid', reason: 'unknown message h', line: 'h*68' });
});

test('malformed lines are invalid with a reason, never a throw', () => {
  const invalid = (line, reason) => { const m = E.parseLine(line); assert.equal(m.kind, 'invalid', line); assert.match(m.reason, reason, line); };
  invalid('F 1 0=1500', /missing checksum/);
  invalid('F 1 0=1500*00', /bad checksum/);
  invalid(E.withChecksum('Q 1'), /unknown message Q/);
  invalid(E.withChecksum('F x'), /sequence number/);
  invalid(E.withChecksum('F 1 0=15'), /bad output 0=15/);
  invalid(E.withChecksum('F 1 0=1500 extra'), /sequence number/);
  invalid(E.withChecksum('L 1 2400 500'), /limits need channel min max/);
  invalid(E.withChecksum('H now'), /takes no arguments/);
  invalid(E.withChecksum('HELLO something'), /hello reply needs/);
  invalid(E.withChecksum('OK'), /ok needs a reference/);
  invalid('', /missing checksum/);
});

test('frame lines are delta-encoded with keyframes and heartbeats, and fit the serial budget', () => {
  const rows = E.servoMap(E.loadServoCatalog(path.join(__dirname, '..', 'catalog', 'servos.json')).servos);
  const skull = E.buildTemplates(rows).find((t) => t.id === 'skull');
  const c = E.compileSteps(skull.rig, { poses: skull.poses, scenarios: skull.scenarios }, [{ kind: 'move', pose: 'JAW_OPEN', ms: 200, ease: 'linear' }, { kind: 'hold', ms: 1000 }]);
  const lines = E.frameLines(c.outputs, c.pulses, 100);
  assert.equal(lines.length, c.pulses.length);
  const first = E.parseLine(lines[0]);
  assert.equal(first.seq, 100); assert.equal(first.pairs.length, 7, 'frame 0 carries every output');
  const second = E.parseLine(lines[1]);
  assert.deepEqual(second.pairs.map(([ch]) => ch), [6], 'only the jaw changed');
  assert.equal(E.parseLine(lines[25]).pairs.length, 7, 'a keyframe every 25 frames');
  assert.deepEqual(E.parseLine(lines[30]).pairs, [], 'nothing moved during the hold → heartbeat');
  const bytesPerSecond = lines.slice(0, 50).join('').length;
  assert.ok(bytesPerSecond < 11520, `one second of frames (${bytesPerSecond} B) fits 115200 baud`);
  assert.equal(E.KEYFRAME_EVERY, 25); assert.equal(E.WATCHDOG_MS, 3000);
  assert.equal(E.describeProtocol().example.hello, 'H*48');
});

test('the line splitter keeps a partial tail and drops blank lines', () => {
  assert.deepEqual(E.splitLines('OK 1*XX\nOK 2*YY\n\nOK 3'), { lines: ['OK 1*XX', 'OK 2*YY'], rest: 'OK 3' });
  assert.deepEqual(E.splitLines('partial'), { lines: [], rest: 'partial' });
  assert.deepEqual(E.splitLines(''), { lines: [], rest: '' });
});
