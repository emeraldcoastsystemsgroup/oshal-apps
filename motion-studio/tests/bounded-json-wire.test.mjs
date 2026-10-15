/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify fixture frame bounds before newline parsing, split UTF-8 preservation and malformed-packet refusal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { boundedJsonFrames } from './bounded-json-wire.mjs';
function fixture(maxBytes) {
  const stream = new PassThrough(), values = [], failures = [];
  const frames = boundedJsonFrames(stream, { maxBytes, onError: error => failures.push(error.message) });
  frames.on('frame', value => values.push(value));
  return { stream, values, failures, close() { frames.close(); stream.destroy(); } };
}
test('split UTF-8 packets and multiple frames retain exact decoded JSON under byte bounds', () => {
  const f = fixture(100);
  try {
    const packet = Buffer.from(JSON.stringify({ name: 'café 🌅' }) + '\n' + JSON.stringify({ id: 2 }) + '\n');
    for (const byte of packet) f.stream.write(Buffer.from([byte]));
    assert.deepEqual(f.values, [{ name: 'café 🌅' }, { id: 2 }]); assert.deepEqual(f.failures, []);
  } finally { f.close(); }
});
test('oversized unterminated output refuses before a full stdout line is buffered', () => {
  const f = fixture(64);
  try {
    f.stream.write(Buffer.alloc(32, 32)); f.stream.write(Buffer.alloc(32, 32));
    assert.deepEqual(f.failures, []);
    f.stream.write(Buffer.from(' '));
    assert.match(f.failures[0], /bounded bytes/); assert.equal(f.stream.listenerCount('data'), 0);
    f.stream.write(Buffer.alloc(1024, 32)); assert.equal(f.failures.length, 1); assert.deepEqual(f.values, []);
  } finally { f.close(); }
});
test('invalid UTF-8 or JSON cannot enter native fixture dispatch', () => {
  for (const packet of [Buffer.from([0xff, 10]), Buffer.from('{broken}\n')]) {
    const f = fixture(64);
    try { f.stream.write(packet); assert.deepEqual(f.values, []); assert.match(f.failures[0], /valid UTF-8 JSON/); }
    finally { f.close(); }
  }
});
test('a final incomplete frame refuses and closing the reader releases its partial buffer', async () => {
  const f = fixture(64);
  try {
    f.stream.end('{"id":1}'); await new Promise(done => setImmediate(done));
    assert.match(f.failures[0], /without a newline/); assert.deepEqual(f.values, []);
  } finally { f.close(); }
});

test('primitive JSON frames cannot reach object-based fixture dispatch', () => {
  for (const packet of ['null\n', '42\n', '[]\n']) {
    const f = fixture(64);
    try { f.stream.write(packet); assert.deepEqual(f.values, []); assert.match(f.failures[0], /JSON object/); }
    finally { f.close(); }
  }
});
