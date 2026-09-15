/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the engine client against a fake bridge on
 *                     |                             | loopback speaking the real wire protocol: a good hello
 *                     |                             | releases the held request; a wrong protocol, a stale
 *                     |                             | build hash and a busy answer are capability_unavailable /
 *                     |                             | engine_busy naming the install command; requests are
 *                     |                             | serialised and answered by id; a refused command is a
 *                     |                             | typed refusal; a timeout kills the connection and the
 *                     |                             | next request reconnects; a dropped bridge fails every
 *                     |                             | queued request; the address parser. The framework
 *                     |                             | logger is stubbed through the module loader.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Cancel (BACKLOG B5): cancelling the in-flight request closes
 *                     |                             | the connection the bridge would kill its worker on, rejects
 *                     |                             | it `cancelled`, and another caller's queued request is sent
 *                     |                             | again on a fresh connection and answered; cancelling a
 *                     |                             | queued request leaves the in-flight one and its connection
 *                     |                             | alone; an unknown tag touches nothing.
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
const { EngineClient, EngineFailure, parseEngineAddr, BRIDGE_PROTOCOL } = require(path.resolve(__dirname, '..', 'routes', 'engine-client.js'));

const HASH = 'a'.repeat(64);

/** A fake bridge: sends a hello line, then answers each request line through `answer`. */
function fakeBridge(opts = {}) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    if (opts.helloDelayMs) setTimeout(() => socket.write(JSON.stringify(opts.hello ?? { bridge: { protocol: BRIDGE_PROTOCOL, buildHash: HASH } }) + '\n'), opts.helloDelayMs);
    else if (!opts.silent) socket.write(JSON.stringify(opts.hello ?? { bridge: { protocol: BRIDGE_PROTOCOL, buildHash: HASH } }) + '\n');
    let tail = '';
    socket.on('data', (chunk) => {
      const parts = (tail + chunk).split('\n'); tail = parts.pop();
      for (const line of parts) {
        if (!line.trim()) continue;
        const req = JSON.parse(line);
        const reply = opts.answer ? opts.answer(req, socket) : { id: req.id, ok: true, result: { echo: req.args, cmd: req.cmd } };
        if (reply === 'hang') continue;
        if (reply === 'drop') { socket.destroy(); continue; }
        setTimeout(() => { if (!socket.destroyed) socket.write(JSON.stringify(reply) + '\n'); }, opts.replyDelayMs || 0);
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => { for (const s of sockets) s.destroy(); server.close(); }, sockets })));
}
const client = (port, extra = {}) => new EngineClient({ host: '127.0.0.1', port, expectedBuildHash: HASH, installHint: 'docker exec api sh install-engine.sh', helloTimeoutMs: 500, requestTimeoutMs: 500, ...extra });

test('a good hello releases the request; requests are serialised and answered by id', async () => {
  const bridge = await fakeBridge({ replyDelayMs: 20 });
  const c = client(bridge.port);
  const [a, b] = await Promise.all([c.request('check', { n: 1 }), c.request('check', { n: 2 })]);
  assert.deepEqual(a, { echo: { n: 1 }, cmd: 'check' });
  assert.deepEqual(b, { echo: { n: 2 }, cmd: 'check' });
  assert.equal(c.status().connected, true);
  assert.equal(c.status().buildHash, HASH);
  assert.equal(bridge.sockets.size, 1, 'one persistent connection carried both requests');
  c.close(); bridge.close();
});

test('wrong protocol, stale build hash and a busy bridge are typed failures naming the install command', async () => {
  for (const [hello, code, pattern] of [
    [{ bridge: { protocol: 99, buildHash: HASH } }, 'capability_unavailable', /bridge protocol 99/],
    [{ bridge: { protocol: BRIDGE_PROTOCOL, buildHash: 'b'.repeat(64) } }, 'capability_unavailable', /out of date/],
    [{ error: { code: 'engine_busy', message: 'no free worker slot' } }, 'engine_busy', /no free worker slot/],
  ]) {
    const bridge = await fakeBridge({ hello });
    const c = client(bridge.port);
    await assert.rejects(c.request('hello', {}), (err) => err instanceof EngineFailure && err.code === code && pattern.test(err.message) && (code !== 'capability_unavailable' || /install-engine\.sh/.test(err.reason)));
    c.close(); bridge.close();
  }
  const unread = client(1, { expectedBuildHash: null });
  const bridge = await fakeBridge();
  const c2 = new EngineClient({ host: '127.0.0.1', port: bridge.port, expectedBuildHash: null, installHint: 'x', helloTimeoutMs: 500 });
  await assert.rejects(c2.request('hello', {}), /could not be read/);
  c2.close(); unread.close(); bridge.close();
});

test('nothing listening and a silent bridge are capability_unavailable', async () => {
  const dead = await fakeBridge(); const port = dead.port; dead.close();
  await new Promise((r) => setTimeout(r, 50));
  const c = client(port);
  await assert.rejects(c.request('hello', {}), (err) => err.code === 'capability_unavailable' && /not running/.test(err.message));
  const silent = await fakeBridge({ silent: true });
  const c2 = client(silent.port);
  await assert.rejects(c2.request('hello', {}), (err) => err.code === 'capability_unavailable' && /did not identify itself/.test(err.message));
  c2.close(); silent.close();
});

test('a refused command is a typed refusal that keeps the connection', async () => {
  const bridge = await fakeBridge({ answer: (req) => (req.args.bad ? { id: req.id, ok: false, error: { code: 'refused', message: 'base.kind must be one of …' } } : { id: req.id, ok: true, result: 1 }) });
  const c = client(bridge.port);
  await assert.rejects(c.request('check', { bad: true }), (err) => err instanceof EngineFailure && err.code === 'refused' && /base\.kind/.test(err.message));
  assert.equal(await c.request('check', {}), 1);
  assert.equal(c.status().connected, true);
  c.close(); bridge.close();
});

test('a timeout kills the connection (so the bridge kills its worker) and the next request reconnects', async () => {
  let calls = 0;
  const bridge = await fakeBridge({ answer: (req) => (++calls === 1 ? 'hang' : { id: req.id, ok: true, result: 'second' }) });
  const c = client(bridge.port, { requestTimeoutMs: 120 });
  await assert.rejects(c.request('rebuild', {}), (err) => err.code === 'engine_timeout' && /killed/.test(err.message));
  assert.equal(c.status().connected, false);
  assert.equal(await c.request('rebuild', {}), 'second');
  assert.equal(bridge.sockets.size, 1, 'a fresh connection replaced the killed one');
  c.close(); bridge.close();
});

test('a bridge that drops mid-request fails the in-flight and every queued request', async () => {
  const bridge = await fakeBridge({ answer: () => 'drop' });
  const c = client(bridge.port);
  const results = await Promise.allSettled([c.request('rebuild', { n: 1 }), c.request('rebuild', { n: 2 })]);
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected']);
  assert.match(results[0].reason.message, /closed the connection/);
  c.close(); bridge.close();
});

/** Resolve once the fake bridge has received `count` request lines in total. */
function receivedLines(seen, count) {
  return new Promise((resolve) => { const tick = () => (seen.length >= count ? resolve() : setTimeout(tick, 5)); tick(); });
}

test('cancelling the in-flight request closes its connection; another caller\'s queued request is answered on a fresh one', async (t) => {
  const seen = [];
  let connections = 0;
  const bridge = await fakeBridge({ answer: (req, socket) => {
    seen.push(req.args.n);
    if (!socket.counted) { socket.counted = true; connections += 1; }
    return req.args.n === 1 ? 'hang' : { id: req.id, ok: true, result: `answered ${req.args.n}` };
  } });
  const c = client(bridge.port, { requestTimeoutMs: 5000 });
  // Cleanup runs even when an assertion fails, so a regression reports instead of hanging.
  t.after(() => { c.close(); bridge.close(); });
  const slow = c.request('rebuild', { n: 1 }, undefined, 'alice-model');
  const other = c.request('rebuild', { n: 2 }, undefined, 'bob-model');
  slow.catch(() => {}); other.catch(() => {});
  await receivedLines(seen, 1);
  const firstSocket = [...bridge.sockets][0];
  const closed = new Promise((resolve) => firstSocket.once('close', resolve));
  assert.equal(c.cancel('alice-model', 'owner pressed stop'), 'inflight');
  await assert.rejects(slow, (err) => err instanceof EngineFailure && err.code === 'cancelled' && /owner pressed stop/.test(err.message) && /worker was stopped/.test(err.message));
  await closed;
  assert.equal(await other, 'answered 2', 'the other caller was not cancelled');
  assert.deepEqual(seen, [1, 2]);
  assert.equal(connections, 2, 'the queued request went out on a fresh connection');
  assert.equal(c.cancel('alice-model'), null, 'nothing left to cancel');
});

test('cancelling a queued request drops only it; the in-flight request keeps its connection', async (t) => {
  const seen = [];
  const bridge = await fakeBridge({ answer: (req) => { seen.push(req.args.n); return req.args.n === 1 ? { id: req.id, ok: true, result: 'first' } : { id: req.id, ok: true, result: 'third' }; }, replyDelayMs: 60 });
  const c = client(bridge.port, { requestTimeoutMs: 5000 });
  t.after(() => { c.close(); bridge.close(); });
  const first = c.request('rebuild', { n: 1 }, undefined, 'm1');
  const queued = c.request('rebuild', { n: 2 }, undefined, 'm2');
  const third = c.request('rebuild', { n: 3 }, undefined, 'm3');
  queued.catch(() => {});
  await receivedLines(seen, 1);
  assert.equal(c.cancel('m2'), 'queued');
  await assert.rejects(queued, (err) => err.code === 'cancelled' && /before it reached the engine/.test(err.message));
  assert.equal(await first, 'first');
  assert.equal(await third, 'third');
  assert.deepEqual(seen, [1, 3], 'the cancelled request never reached the bridge');
  assert.equal(bridge.sockets.size, 1, 'one connection throughout');
  assert.equal(c.cancel('no-such-model'), null);
  assert.equal(c.status().connected, true);
});

test('the queue is bounded and the address parser is strict', async () => {
  const bridge = await fakeBridge({ answer: () => 'hang' });
  const c = client(bridge.port, { maxQueue: 1, requestTimeoutMs: 5000 });
  const first = c.request('rebuild', {});
  const second = c.request('rebuild', {});
  await assert.rejects(c.request('rebuild', {}), (err) => err.code === 'engine_busy');
  c.close(); bridge.close();
  await Promise.allSettled([first, second]);
  assert.deepEqual(parseEngineAddr(undefined), { host: 'cad-studio-engine', port: 7412 });
  assert.deepEqual(parseEngineAddr('10.0.0.5:7000'), { host: '10.0.0.5', port: 7000 });
  assert.throws(() => parseEngineAddr('nope'), /host:port/);
});
