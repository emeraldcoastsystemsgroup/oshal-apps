/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Item E: prove single-flight auto-install/refresh of aero-lab's engine container on missing/stale first call, failure cooldown + honest refusal preservation, and native engine.status probing.
 */
'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const ENGINE_DIR = path.join(PKG, 'engine');

function loadModule(relPath) {
  const origLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'express') return { Router: () => ({ get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} }) };
    if (request === '@/shared/logger') {
      return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
    }
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(path.join(PKG, relPath))];
    return require(path.join(PKG, relPath));
  } finally {
    Module._load = origLoad;
  }
}

function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function startStubBridge(port, buildHash, replyBuilder) {
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write(JSON.stringify({ bridge: { protocol: 1, buildHash, python: 'stub' } }) + '\n');
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk;
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) {
          const msg = JSON.parse(line);
          socket.write(JSON.stringify({ id: msg.id, ok: true, result: replyBuilder(msg) }) + '\n');
        }
        nl = buf.indexOf('\n');
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      close: () => new Promise((done) => server.close(() => done())),
    }));
  });
}

test('Item E: missing container auto-runs install-engine.sh once and retries to real result', async () => {
  const { AeroEngineAdapter } = loadModule('routes/engine-adapter.js');
  const { engineBuildHash } = loadModule('routes/engine-build-hash.js');
  const expectedHash = engineBuildHash(ENGINE_DIR);
  const port = await reserveFreePort();
  let bridge = null;
  const installCalls = [];
  const adapter = new AeroEngineAdapter({
    engineAddr: `127.0.0.1:${port}`,
    appPackageDir: PKG,
    autoInstall: true,
    dockerAvailable: true,
    runInstaller: async (scriptPath) => {
      installCalls.push(scriptPath);
      bridge = await startStubBridge(port, expectedHash, (msg) => ({ echoed: msg.cmd, engineVersion: 'stub-1' }));
      return { ok: true };
    },
  });
  try {
    const out = await adapter.request('polar', { design: {} });
    assert.equal(out.echoed, 'polar');
    assert.equal(installCalls.length, 1);
    assert.match(installCalls[0], /engine[\\/]install-engine\.sh$/);
  } finally {
    adapter.dispose();
    if (bridge) await bridge.close();
  }
});

test('Item E: stale container buildHash triggers single-flight refresh and succeeds on retry', async () => {
  const { AeroEngineAdapter } = loadModule('routes/engine-adapter.js');
  const { engineBuildHash } = loadModule('routes/engine-build-hash.js');
  const expectedHash = engineBuildHash(ENGINE_DIR);
  const port = await reserveFreePort();
  let currentHash = '0'.repeat(64);
  const bridge = await startStubBridge(port, '', () => ({}));
  await bridge.close();

  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write(JSON.stringify({ bridge: { protocol: 1, buildHash: currentHash, python: 'stub' } }) + '\n');
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk;
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) {
          const msg = JSON.parse(line);
          socket.write(JSON.stringify({ id: msg.id, ok: true, result: { refreshed: true, cmd: msg.cmd } }) + '\n');
        }
        nl = buf.indexOf('\n');
      }
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  let runs = 0;
  const adapter = new AeroEngineAdapter({
    engineAddr: `127.0.0.1:${port}`,
    appPackageDir: PKG,
    autoInstall: true,
    dockerAvailable: true,
    runInstaller: async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 25));
      currentHash = expectedHash;
      return { ok: true };
    },
  });
  try {
    const [r1, r2] = await Promise.all([
      adapter.request('polar', { design: {} }),
      adapter.request('screen', { design: {} }),
    ]);
    assert.equal(r1.refreshed, true);
    assert.equal(r2.refreshed, true);
    assert.equal(runs, 1, 'concurrent calls share one single-flight install');
  } finally {
    adapter.dispose();
    await new Promise((done) => server.close(() => done()));
  }
});

test('Item E: failed auto-install preserves exact refusal with installHint and honors cooldown', async () => {
  const { AeroEngineAdapter, AeroEngineError } = loadModule('routes/engine-adapter.js');
  const port = await reserveFreePort();
  let runs = 0;
  const adapter = new AeroEngineAdapter({
    engineAddr: `127.0.0.1:${port}`,
    appPackageDir: PKG,
    autoInstall: true,
    dockerAvailable: true,
    installCooldownMs: 60_000,
    runInstaller: async () => {
      runs += 1;
      return { ok: false, error: 'cannot reach Docker daemon' };
    },
  });
  try {
    await assert.rejects(
      adapter.request('capabilities', {}),
      (err) => err instanceof AeroEngineError
        && err.code === 'capability_unavailable'
        && String(err.reason).includes('install-engine.sh'),
    );
    await assert.rejects(
      adapter.request('capabilities', {}),
      (err) => err instanceof AeroEngineError && err.code === 'capability_unavailable',
    );
    assert.equal(runs, 1, 'failure cooldown prevents repeated install attempts');
  } finally {
    adapter.dispose();
  }
});

test('Item E: disabled auto-install or missing Docker socket skips installer and preserves refusal', async () => {
  const { AeroEngineAdapter, AeroEngineError } = loadModule('routes/engine-adapter.js');
  const port = await reserveFreePort();
  let runs = 0;
  const adapter = new AeroEngineAdapter({
    engineAddr: `127.0.0.1:${port}`,
    appPackageDir: PKG,
    autoInstall: true,
    dockerAvailable: false,
    runInstaller: async () => { runs += 1; return { ok: true }; },
  });
  try {
    await assert.rejects(
      adapter.request('capabilities', {}),
      (err) => err instanceof AeroEngineError
        && err.code === 'capability_unavailable'
        && String(err.reason).includes('install-engine.sh'),
    );
    assert.equal(runs, 0, 'no Docker socket means installer is never spawned');
  } finally {
    adapter.dispose();
  }
});

test('Item E: nativeStatus probes engine.status only on native kernel context', async () => {
  const { nativeStatus } = loadModule('routes/aero-lab-routes.js');
  assert.equal(nativeStatus({ pool: { storageModel: 'pg' }, intent: async () => ({}) }), undefined);
  const calls = [];
  const probe = nativeStatus({
    pool: { storageModel: 'kernel-scoped-documents' },
    intent: async (name, input) => { calls.push([name, input]); return { state: 'preparing' }; },
  });
  assert.equal(typeof probe, 'function');
  const out = await probe();
  assert.deepEqual(out, { state: 'preparing' });
  assert.deepEqual(calls, [['engine.status', {}]]);
});
