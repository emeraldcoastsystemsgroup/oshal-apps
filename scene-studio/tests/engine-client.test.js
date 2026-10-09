/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the engine client against a fake bridge on loopback
 *                     |                             | speaking the real wire protocol (the cad-studio suite's shape):
 *                     |                             | a good hello releases the held request and the op travels as
 *                     |                             | {id, op, …fields}; a wrong protocol, a stale build hash and a
 *                     |                             | busy answer are typed failures naming the install command;
 *                     |                             | requests are serialised and answered by id; the bridge's error
 *                     |                             | codes map to the client's; a timeout drops the connection and
 *                     |                             | the next request reconnects; a dropped bridge fails the queue;
 *                     |                             | a multi-megabyte reply split across many chunks arrives whole;
 *                     |                             | an oversized reply is refused; the queue is bounded; the
 *                     |                             | address parser is strict. The framework logger is stubbed
 *                     |                             | through the module loader.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const Module = require('node:module');

// The compiled client imports the framework logger by its `@/` alias; resolve it to a silent stub.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
  return originalLoad.call(this, request, parent, isMain);
};
const { EngineClient, EngineFailure, LineSplitter, parseEngineAddr, BRIDGE_PROTOCOL } = require(path.resolve(__dirname, '..', 'routes', 'engine-client.js'));

const HASH = 'a'.repeat(64);

/** A fake bridge: sends a hello line, then answers each request line through `answer`. */
function fakeBridge(opts = {}) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    if (!opts.silent) socket.write(JSON.stringify(opts.hello ?? { bridge: { protocol: BRIDGE_PROTOCOL, buildHash: HASH } }) + '\n');
    let tail = '';
    socket.on('data', (chunk) => {
      const parts = (tail + chunk).split('\n'); tail = parts.pop();
      for (const line of parts) {
        if (!line.trim()) continue;
        const req = JSON.parse(line);
        const reply = opts.answer ? opts.answer(req, socket) : { id: req.id, ok: true, result: { op: req.op, fields: req } };
        if (reply === 'hang') continue;
        if (reply === 'drop') { socket.destroy(); continue; }
        if (reply && reply.raw) { socket.write(reply.raw); continue; }
        setTimeout(() => { if (!socket.destroyed) socket.write(JSON.stringify(reply) + '\n'); }, opts.replyDelayMs || 0);
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => { for (const s of sockets) s.destroy(); server.close(); }, sockets })));
}
const client = (port, extra = {}) => new EngineClient({ host: '127.0.0.1', port, expectedBuildHash: HASH, installHint: 'docker exec api sh install-engine.sh', helloTimeoutMs: 500, requestTimeoutMs: 500, ...extra });

test('a good hello releases the request; ops travel as {id, op, fields} and are answered by id on one connection', async () => {
  const bridge = await fakeBridge({ replyDelayMs: 20 });
  const c = client(bridge.port);
  const [a, b] = await Promise.all([c.request('preview', { kind: 'godot', width: 320 }), c.request('export', { format: 'zip' })]);
  assert.equal(a.op, 'preview');
  assert.equal(a.fields.kind, 'godot');
  assert.equal(a.fields.width, 320);
  assert.equal(b.op, 'export');
  assert.equal(c.status().connected, true);
  assert.equal(c.status().buildHash, HASH);
  assert.equal(bridge.sockets.size, 1, 'one persistent connection carried both requests');
  c.close(); bridge.close();
});

test('a caller field named op or id cannot override the envelope', async () => {
  const bridge = await fakeBridge();
  const c = client(bridge.port);
  const out = await c.request('preview', { op: 'export', id: 999 });
  assert.equal(out.op, 'preview');
  assert.notEqual(out.fields.id, 999);
  c.close(); bridge.close();
});

test('wrong protocol, stale build hash and a busy bridge are typed failures naming the install command', async () => {
  for (const [hello, code, pattern] of [
    [{ bridge: { protocol: 99, buildHash: HASH } }, 'capability_unavailable', /bridge protocol 99/],
    [{ bridge: { protocol: BRIDGE_PROTOCOL, buildHash: 'b'.repeat(64) } }, 'capability_unavailable', /out of date/],
    [{ error: { code: 'engine_busy', message: 'no free connection slot' } }, 'engine_busy', /no free connection slot/],
  ]) {
    const bridge = await fakeBridge({ hello });
    const c = client(bridge.port);
    await assert.rejects(c.request('ping'), (err) => err instanceof EngineFailure && err.code === code && pattern.test(err.message) && (code !== 'capability_unavailable' || /install-engine\.sh/.test(err.reason)));
    c.close(); bridge.close();
  }
  const bridge = await fakeBridge();
  const unverifiable = new EngineClient({ host: '127.0.0.1', port: bridge.port, expectedBuildHash: null, installHint: 'x', helloTimeoutMs: 500 });
  await assert.rejects(unverifiable.request('ping'), /could not be read/);
  unverifiable.close(); bridge.close();
});

test('nothing listening and a silent bridge are capability_unavailable', async () => {
  const dead = await fakeBridge(); const port = dead.port; dead.close();
  await new Promise((r) => setTimeout(r, 50));
  const c = client(port);
  await assert.rejects(c.request('ping'), (err) => err.code === 'capability_unavailable' && /not running/.test(err.message));
  const silent = await fakeBridge({ silent: true });
  const c2 = client(silent.port);
  await assert.rejects(c2.request('ping'), (err) => err.code === 'capability_unavailable' && /did not identify itself/.test(err.message));
  c2.close(); silent.close();
});

test("the bridge's error codes map to typed failures and keep the connection", async () => {
  const codes = { refused: 'refused', engine_timeout: 'engine_timeout', engine_busy: 'engine_busy', engine_error: 'engine_error', surprise: 'engine_error' };
  const bridge = await fakeBridge({ answer: (req) => (req.code ? { id: req.id, ok: false, error: { code: req.code, message: `bridge said ${req.code}` } } : { id: req.id, ok: true, result: 'ok' }) });
  const c = client(bridge.port);
  for (const [sent, expected] of Object.entries(codes)) {
    await assert.rejects(c.request('mcp_call', { code: sent }), (err) => err instanceof EngineFailure && err.code === expected && err.message === `bridge said ${sent}`);
  }
  assert.equal(await c.request('ping'), 'ok');
  assert.equal(c.status().connected, true);
  c.close(); bridge.close();
});

test('a timeout drops the connection and the next request reconnects', async () => {
  let calls = 0;
  const bridge = await fakeBridge({ answer: (req) => (++calls === 1 ? 'hang' : { id: req.id, ok: true, result: 'second' }) });
  const c = client(bridge.port, { requestTimeoutMs: 120 });
  await assert.rejects(c.request('preview'), (err) => err.code === 'engine_timeout' && /did not answer/.test(err.message));
  assert.equal(c.status().connected, false);
  assert.equal(await c.request('preview'), 'second');
  c.close(); bridge.close();
});

test('a bridge that drops mid-request fails the in-flight and every queued request', async () => {
  const bridge = await fakeBridge({ answer: () => 'drop' });
  const c = client(bridge.port);
  const results = await Promise.allSettled([c.request('preview'), c.request('export')]);
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected']);
  assert.match(results[0].reason.message, /closed the connection/);
  c.close(); bridge.close();
});

test('a multi-megabyte reply split across many chunks arrives whole', async () => {
  const blob = 'x'.repeat(6 * 1024 * 1024);
  const bridge = await fakeBridge({ answer: (req) => {
    const line = JSON.stringify({ id: req.id, ok: true, result: { files: [{ path: 'scene.blend', data: blob }] } }) + '\n';
    const pieces = [];
    for (let i = 0; i < line.length; i += 4096) pieces.push(line.slice(i, i + 4096));
    return { raw: pieces.join('') };
  } });
  const c = client(bridge.port, { requestTimeoutMs: 10_000 });
  const out = await c.request('new_project', { kind: 'blender' });
  assert.equal(out.files[0].data.length, blob.length);
  c.close(); bridge.close();
});

test('the line splitter is linear, keeps partial tails and refuses an oversized line', () => {
  const lines = [];
  const splitter = new LineSplitter((l) => lines.push(l), 64, () => lines.push('<overflow>'));
  splitter.push('{"a":1}\n{"b"');
  splitter.push(':2}\n\n');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  splitter.push('y'.repeat(40));
  splitter.push('y'.repeat(40));
  assert.equal(lines[2], '<overflow>');
  splitter.push('\n{"c":3}\n');
  assert.deepEqual(lines.slice(3), ['{"c":3}'], 'the oversized line was dropped, the next one parses');
});

test('the queue is bounded and the address parser is strict', async () => {
  const bridge = await fakeBridge({ answer: () => 'hang' });
  const c = client(bridge.port, { maxQueue: 1, requestTimeoutMs: 5000 });
  const first = c.request('preview');
  const second = c.request('preview');
  await assert.rejects(c.request('preview'), (err) => err.code === 'engine_busy');
  c.close(); bridge.close();
  await Promise.allSettled([first, second]);
  assert.deepEqual(parseEngineAddr(undefined), { host: 'scene-studio-engine', port: 7414 });
  assert.deepEqual(parseEngineAddr('10.0.0.5:7000'), { host: '10.0.0.5', port: 7000 });
  assert.throws(() => parseEngineAddr('nope'), /host:port/);
});
