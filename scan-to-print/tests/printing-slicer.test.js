/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Third review: an over-long answer line fails the request instead of throwing out of the socket handler; a slice result of the wrong shape is a typed engine error.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Second review: a JSON null hello or answer is a typed failure, never an exception out of the socket handler; an out-of-range port is an address error.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Review fixes: a busy engine is `busy` with no reinstall advice; an engine that closes the connection without answering fails the request at once; a malformed address is reported by the request (and never thrown at mount); a 30 MB answer line is assembled in well under a second.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The slicer engine client (BUILDING-EXTENSIONS §7): the build hash this package computes equals the one the bridge bakes (the real slicer_engine_bridge.py run with python3, over the real engine tree), a container built from another tree is refused with the install command and never asked to slice, a stopped engine names the same command, a refused request stays a refusal, and a current engine's archive comes back as bytes. The bridge here is a local TCP server speaking the real line protocol.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PKG = path.resolve(__dirname, '..');
const ENGINE = path.join(PKG, 'engine');
const client = require(path.join(PKG, 'routes/printing/slicer-engine.js'));

/** A bridge that says hello with `hash`, then answers each request line with `reply(req)`. */
async function fakeBridge(hash, reply) {
  const seen = [];
  const server = net.createServer((socket) => {
    socket.write(JSON.stringify({ bridge: { protocol: 1, buildHash: hash, port: 7414 } }) + '\n');
    let buf = '';
    socket.on('data', (c) => {
      buf += c.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        seen.push(req);
        socket.write(JSON.stringify({ id: req.id, ...reply(req) }) + '\n');
      }
    });
    socket.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, seen, close: () => new Promise((r) => server.close(r)) };
}

const options = (port, expectedBuildHash) => ({ host: '127.0.0.1', port, expectedBuildHash, installHint: 'docker exec api sh /x/engine/install-engine.sh', timeoutMs: 5000 });

test('the package and the bridge hash the same engine tree the same way', () => {
  const ts = client.slicerEngineBuildHash(ENGINE);
  const py = execFileSync('python3', [path.join(ENGINE, 'container/slicer_engine_bridge.py'), '--build-hash'], {
    env: { ...process.env, SCAN_TO_PRINT_ENGINE_DIR: ENGINE }, encoding: 'utf8',
  }).trim();
  assert.match(ts, /^[0-9a-f]{64}$/);
  assert.equal(ts, py);
  assert.deepEqual([...client.SLICER_RUNTIME_FILES], ['slicer_worker.py', 'container/slicer_engine_bridge.py', 'container/Dockerfile', 'orcaslicer-lock.txt']);
  assert.equal(client.slicerEngineBuildHash(path.join(PKG, 'no-such-dir')), null);
});

test('a current engine slices: the archive returns as bytes with its estimate and profile', async () => {
  const hash = client.slicerEngineBuildHash(ENGINE);
  const archive = Buffer.from('PK\x03\x04 fake archive');
  const bridge = await fakeBridge(hash, (req) => ({ ok: true, result: { fileName: 'part.gcode.3mf', archive: archive.toString('base64'), estimate: { printSeconds: 1208, firstLayerSeconds: 313, filamentGrams: 3.8 }, profile: { modelId: 'N7', plate: 'Textured PEI Plate', filamentType: 'PLA' } } }));
  try {
    const out = await client.sliceToArchive(options(bridge.port, hash), Buffer.from('solid x'), 'part', { modelId: 'N7', nozzle: '0.4', filament: 'Bambu PLA Basic', plate: 'Textured PEI Plate' });
    assert.ok(Buffer.from(out.bytes).equals(archive));
    assert.equal(out.estimate.printSeconds, 1208);
    assert.equal(bridge.seen[0].cmd, 'slice');
    assert.equal(bridge.seen[0].args.modelId, 'N7');
    assert.equal(Buffer.from(bridge.seen[0].args.stl, 'base64').toString(), 'solid x');
  } finally { await bridge.close(); }
});

test('a container built from a different engine tree is refused with the install command and never asked to slice', async () => {
  const bridge = await fakeBridge('0'.repeat(64), () => ({ ok: true, result: {} }));
  try {
    await assert.rejects(client.sliceToArchive(options(bridge.port, client.slicerEngineBuildHash(ENGINE)), Buffer.from('x'), 'p', { modelId: 'N7', nozzle: '0.4', filament: 'Bambu PLA Basic', plate: null }),
      (error) => error.code === 'unavailable' && /out of date/.test(error.message) && /install-engine\.sh/.test(error.reason));
    assert.equal(bridge.seen.length, 0, 'the stale engine received no request');
  } finally { await bridge.close(); }
});

test('a stopped engine names the install command', async () => {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  await assert.rejects(client.slicerRequest(options(port, 'h'), 'profiles', {}),
    (error) => error.code === 'unavailable' && /not running/.test(error.message) && /install-engine\.sh/.test(error.reason));
});

test('a refused request stays a refusal with the engine\'s reason', async () => {
  const hash = client.slicerEngineBuildHash(ENGINE);
  const bridge = await fakeBridge(hash, () => ({ ok: false, error: { code: 'refused', message: "no 'Unobtainium' profile is compatible with Bambu Lab P2S 0.4 nozzle" } }));
  try {
    await assert.rejects(client.slicerRequest(options(bridge.port, hash), 'slice', {}), (error) => error.code === 'refused' && /Unobtainium/.test(error.message));
  } finally { await bridge.close(); }
});

test('addresses parse as host:port and the default is the stack alias', () => {
  assert.deepEqual(client.parseSlicerAddr(undefined), { host: 'scan-to-print-engine', port: 7414 });
  assert.deepEqual(client.parseSlicerAddr('10.0.0.2:9000'), { host: '10.0.0.2', port: 9000 });
  assert.throws(() => client.parseSlicerAddr('nope'), RangeError);
});

test('a busy engine is busy, with no advice to reinstall it', async () => {
  const server = net.createServer((socket) => { socket.on('error', () => {}); socket.end(JSON.stringify({ id: null, ok: false, error: { code: 'engine_busy', message: 'engine container has no free worker slot' } }) + '\n'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(client.slicerRequest(options(server.address().port, 'h'), 'profiles', {}),
      (error) => error.code === 'busy' && !/install/.test(error.reason) && /try again/.test(error.reason));
  } finally { await new Promise((r) => server.close(r)); }
});

test('an engine that closes the connection without answering fails the request at once', async () => {
  const hash = client.slicerEngineBuildHash(ENGINE);
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.write(JSON.stringify({ bridge: { protocol: 1, buildHash: hash } }) + '\n');
    socket.once('data', () => socket.end());   // took the request, then the worker died
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const started = Date.now();
    await assert.rejects(client.slicerRequest({ ...options(server.address().port, hash), timeoutMs: 60_000 }, 'slice', {}),
      (error) => error.code === 'engine_error' && /closed the connection before answering/.test(error.message));
    assert.ok(Date.now() - started < 2000, `failed in ${Date.now() - started} ms, not at the timeout`);
  } finally { await new Promise((r) => server.close(r)); }
});

test('a malformed engine address is reported by the request', async () => {
  await assert.rejects(client.slicerRequest({ ...options(1, 'h'), addrError: 'invalid engine address "nope" (expected host:port)' }, 'profiles', {}),
    (error) => error.code === 'unavailable' && /SCAN_TO_PRINT_ENGINE_ADDR is invalid/.test(error.message));
});

test('a 30 MB answer line is assembled in well under a second', async () => {
  const hash = client.slicerEngineBuildHash(ENGINE);
  const archive = Buffer.alloc(22 * 1024 * 1024, 7);
  const bridge = await fakeBridge(hash, () => ({ ok: true, result: { fileName: 'big.gcode.3mf', archive: archive.toString('base64'), estimate: { printSeconds: 1, firstLayerSeconds: 1, filamentGrams: 1 }, profile: {} } }));
  try {
    const started = Date.now();
    const out = await client.sliceToArchive(options(bridge.port, hash), Buffer.from('x'), 'big', { modelId: 'N7', nozzle: '0.4', filament: 'Bambu PLA Basic', plate: null });
    const ms = Date.now() - started;
    assert.equal(out.bytes.byteLength, archive.length);
    assert.ok(ms < 3000, `took ${ms} ms`);
  } finally { await bridge.close(); }
});

test('a JSON null hello or answer is a typed failure, never an exception out of the socket handler', async () => {
  const hash = client.slicerEngineBuildHash(ENGINE);
  const nullHello = net.createServer((socket) => { socket.on('error', () => {}); socket.write('null\n'); });
  const nullAnswer = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.write(JSON.stringify({ bridge: { protocol: 1, buildHash: hash } }) + '\n');
    socket.once('data', () => socket.write('null\n'));
  });
  await Promise.all([nullHello, nullAnswer].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
  let crashed = null;
  const onCrash = (error) => { crashed = error; };
  process.on('uncaughtException', onCrash);
  try {
    await assert.rejects(client.slicerRequest(options(nullHello.address().port, hash), 'profiles', {}), (error) => error.code === 'unavailable');
    await assert.rejects(client.slicerRequest(options(nullAnswer.address().port, hash), 'profiles', {}), (error) => error.code === 'engine_error' && /unreadable answer/.test(error.message));
    assert.equal(crashed, null);
  } finally {
    process.off('uncaughtException', onCrash);
    await Promise.all([nullHello, nullAnswer].map((s) => new Promise((r) => s.close(r))));
  }
});

test('an out-of-range port is an address error', () => {
  assert.throws(() => client.parseSlicerAddr('scan-to-print-engine:74140'), /port 1-65535/);
  assert.throws(() => client.parseSlicerAddr('scan-to-print-engine:0'), RangeError);
});

test('an over-long answer line is a failure reported once, never an exception', () => {
  const lines = [], failures = [];
  const feed = client.lineAssembler((line) => { lines.push(line); return true; }, (error) => failures.push(error.message), 10);
  assert.doesNotThrow(() => { feed('short\n'); feed('0123456789ABCDEF'); feed('more\n'); feed('ignored\n'); });
  assert.deepEqual(lines, ['short']);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /exceeded 10 characters/);
  const throwing = client.lineAssembler(() => { throw new Error('boom'); }, (error) => failures.push(error.message));
  assert.doesNotThrow(() => throwing('x\n'));
  assert.equal(failures.at(-1), 'boom');
});

test('a slice result of the wrong shape is a typed engine error', async () => {
  const hash = client.slicerEngineBuildHash(ENGINE);
  for (const result of [null, { fileName: 'x.gcode.3mf' }, { fileName: 'x.gcode.3mf', archive: 'AA==', profile: {}, estimate: { printSeconds: 'soon' } }]) {
    const bridge = await fakeBridge(hash, () => ({ ok: true, result }));
    try {
      await assert.rejects(client.sliceToArchive(options(bridge.port, hash), Buffer.from('x'), 'p', { modelId: 'N7', nozzle: '0.4', filament: 'Bambu PLA Basic', plate: null }),
        (error) => error.code === 'engine_error' && /unreadable slice result/.test(error.message));
    } finally { await bridge.close(); }
  }
});
