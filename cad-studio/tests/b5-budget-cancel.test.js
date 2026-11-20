/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | BACKLOG B5 (0.5.3): deterministic tests for per-feature timing
 *                     |                             | budget telemetry, structured budgetExceeded reporting, native
 *                     |                             | engine.exchange in-flight cancellation preserving last good
 *                     |                             | revision and freeing slots, REAL cad_engine_bridge.py
 *                     |                             | kill-on-close SIGKILL proof (verifying hung worker PID exits
 *                     |                             | and slot is freed for the next rebuild), and UI per-feature
 *                     |                             | timing / featureBudgetMs / Stop rebuild wiring.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { spawn, spawnSync } = require('node:child_process');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
  return originalLoad.call(this, request, parent, isMain);
};

const PKG = path.resolve(__dirname, '..');
const { EngineClient, EngineFailure, BRIDGE_PROTOCOL } = require(path.join(PKG, 'routes', 'engine-client.js'));
const { rebuildModel, cancelRebuild } = require(path.join(PKG, 'routes', 'rebuild-service.js'));
const { engineBuildHash } = require(path.join(PKG, 'routes', 'engine-build-hash.js'));

const HASH = 'c'.repeat(64);
const MODEL_ID = '11111111-2222-4333-8444-555555555555';

function pythonBin() {
  return ['python3', 'python'].find((b) => {
    const p = spawnSync(b, ['--version'], { encoding: 'utf8' });
    return !p.error && p.status === 0;
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const port = srv.address().port; srv.close(() => resolve(port)); });
  });
}

async function waitUntil(pred, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`condition not met within ${timeoutMs} ms`);
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code !== 'ESRCH'; }
}

function fakeModelPool(initialRow) {
  const row = { ...initialRow };
  const revisions = [];
  return {
    row,
    revisions,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (/^UPDATE cad_model SET revision = revision \+ 1, state = 'built'/i.test(q)) {
        row.state = 'built';
        row.revision += 1;
        row.report = JSON.parse(params[2]);
        row.feature_status = JSON.parse(params[3]);
        row.failure_reason = null;
        revisions.push({ revision: row.revision, report: row.report, feature_status: row.feature_status });
        return { rows: [{ ...row }], rowCount: 1 };
      }
      if (/^INSERT INTO cad_revision/i.test(q)) return { rows: [], rowCount: 1 };
      if (/^UPDATE cad_model SET state = 'failed'/i.test(q)) {
        row.state = 'failed';
        row.failure_reason = params[2];
        return { rows: [{ ...row }], rowCount: 1 };
      }
      return { rows: [{ ...row }], rowCount: 1 };
    },
  };
}

test('native engine.exchange: cancelRebuild aborts in-flight build, frees slot, discards late reply, and preserves last good revision', async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-b5-native-'));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  let resolveFirst;
  let calls = 0;
  const engine = new EngineClient({
    host: 'cad-studio-engine', port: 7412, expectedBuildHash: null, installHint: 'pin', maxQueue: 1,
    exchange: (request) => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return Promise.resolve({
        hello: { bridge: { protocol: BRIDGE_PROTOCOL, buildHash: HASH } },
        reply: { id: 1, ok: true, result: { report: { volumeMm3: 1000, valid: true }, features: [{ id: 'f1', index: 0, ok: true, ms: 9 }], exports: {}, ms: 12 } },
      });
    },
  });
  const pool = fakeModelPool({
    model_id: MODEL_ID, owner_sub: 'alice', title: 'Bracket', revision: 2, state: 'built',
    base: { kind: 'box', sizeX: 40, sizeY: 40, sizeZ: 20 },
    features: [{ id: 'f1', type: 'hole', params: { diameter: 6 }, enabled: true }],
    settings: { densityGcm3: 1.24, stlToleranceMm: 0.05, featureBudgetMs: 5000 },
    report: { volumeMm3: 32000, valid: true }, feature_status: [], failure_reason: null,
  });
  const deps = { pool, engine, dataRoot, engineBuild: HASH };
  const pending = rebuildModel(deps, { ...pool.row });
  await waitUntil(() => typeof resolveFirst === 'function');
  const stage = await cancelRebuild(deps, 'alice', MODEL_ID);
  assert.equal(stage, 'inflight');
  const outcome = await pending;
  assert.equal(outcome.build.ok, false);
  assert.equal(outcome.build.code, 'cancelled');
  assert.equal(pool.row.revision, 2, 'cancelled rebuild must keep the last good revision');
  assert.equal(pool.row.state, 'failed');
  assert.match(pool.row.failure_reason, /^cancelled:/);
  // Late engine reply arrives after cancel: must be discarded without advancing revision.
  resolveFirst({ hello: { bridge: { protocol: BRIDGE_PROTOCOL, buildHash: HASH } }, reply: { id: 1, ok: true, result: { report: { volumeMm3: 999 }, features: [], exports: {}, ms: 50 } } });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(pool.row.revision, 2, 'late cancelled reply must never advance revision');
  // Because maxQueue is 1 and cancel freed the slot, the next native rebuild succeeds immediately.
  const next = await rebuildModel(deps, { ...pool.row });
  assert.equal(next.build.ok, true);
  assert.equal(pool.row.revision, 3);
  assert.equal(pool.row.state, 'built');
});

test('rebuildModel surfaces structured budgetExceeded telemetry naming the slow feature and elapsed ms', async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-b5-budget-'));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const engine = new EngineClient({
    host: 'cad-studio-engine', port: 7412, expectedBuildHash: null, installHint: 'pin',
    exchange: async () => ({
      hello: { bridge: { protocol: BRIDGE_PROTOCOL, buildHash: HASH } },
      reply: {
        id: 1, ok: true,
        result: {
          report: { volumeMm3: 30000, valid: true },
          features: [
            { id: 'fast-hole', index: 0, ok: true, ms: 8 },
            { id: 'slow-shell', index: 1, ok: false, code: 'budget_exceeded', ms: 245, error: 'took 245 ms, over the 150 ms per-feature budget; its result was discarded' },
          ],
          exports: {}, ms: 260,
        },
      },
    }),
  });
  const pool = fakeModelPool({
    model_id: MODEL_ID, owner_sub: 'alice', title: 'Housing', revision: 1, state: 'built',
    base: { kind: 'box', sizeX: 40, sizeY: 40, sizeZ: 20 },
    features: [{ id: 'fast-hole', type: 'hole', params: { diameter: 6 }, enabled: true }, { id: 'slow-shell', type: 'shell', params: { thickness: 2 }, enabled: true }],
    settings: { featureBudgetMs: 150 }, report: null, feature_status: [], failure_reason: null,
  });
  const out = await rebuildModel({ pool, engine, dataRoot, engineBuild: HASH }, { ...pool.row });
  assert.equal(out.build.ok, true);
  assert.deepEqual(out.build.budgetExceeded, [
    { featureId: 'slow-shell', index: 1, ms: 245, error: 'took 245 ms, over the 150 ms per-feature budget; its result was discarded' },
  ]);
  assert.equal(pool.row.feature_status[0].ms, 8);
  assert.equal(pool.row.feature_status[1].code, 'budget_exceeded');
});

test('real cad_engine_bridge.py SIGKILLs a hung worker process group on cancel and releases its slot', async (t) => {
  const py = pythonBin();
  assert.ok(py, 'python3 or python is required');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-b5-bridge-'));
  const pidFile = path.join(tmp, 'worker.pid');
  fs.mkdirSync(path.join(tmp, 'container'), { recursive: true });
  fs.copyFileSync(path.join(PKG, 'engine', 'container', 'cad_engine_bridge.py'), path.join(tmp, 'container', 'cad_engine_bridge.py'));
  fs.copyFileSync(path.join(PKG, 'engine', 'requirements.txt'), path.join(tmp, 'requirements.txt'));
  fs.copyFileSync(path.join(PKG, 'engine', 'requirements-lock.txt'), path.join(tmp, 'requirements-lock.txt'));
  fs.writeFileSync(path.join(tmp, 'cad_worker.py'), [
    'import json, os, sys, time',
    'for raw in sys.stdin:',
    '    raw = raw.strip()',
    '    if not raw: continue',
    '    req = json.loads(raw)',
    '    if req.get("cmd") == "hang":',
    `        open(${JSON.stringify(pidFile)}, "w").write(str(os.getpid()))`,
    '        time.sleep(60)',
    '    sys.stdout.write(json.dumps({"id": req.get("id"), "ok": True, "result": {"pid": os.getpid()}}) + "\\n")',
    '    sys.stdout.flush()',
  ].join('\n'), 'utf8');
  const expectedHash = engineBuildHash(tmp);
  const port = await freePort();
  const bridge = spawn(py, [path.join(tmp, 'container', 'cad_engine_bridge.py'), '--host', '127.0.0.1', '--port', String(port), '--max-connections', '1'], {
    env: { ...process.env, CAD_STUDIO_ENGINE_DIR: tmp, PYTHONDONTWRITEBYTECODE: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  bridge.stderr.on('data', (d) => { stderr += d.toString(); });
  t.after(() => {
    try { bridge.kill('SIGKILL'); } catch (_) {}
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  await waitUntil(() => stderr.includes('listening on 127.0.0.1:' + port), 5000);
  const client = new EngineClient({ host: '127.0.0.1', port, expectedBuildHash: expectedHash, installHint: 'sh install-engine.sh', helloTimeoutMs: 3000, requestTimeoutMs: 10000 });
  t.after(() => client.close());
  const hung = client.request('hang', {}, 10000, 'alice:m1');
  hung.catch(() => {});
  await waitUntil(() => fs.existsSync(pidFile) && Number(fs.readFileSync(pidFile, 'utf8')) > 0, 5000);
  const workerPid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.equal(pidAlive(workerPid), true, 'hung worker must be running before cancel');
  assert.equal(client.cancel('alice:m1', 'owner pressed stop'), 'inflight');
  await assert.rejects(hung, (err) => err instanceof EngineFailure && err.code === 'cancelled');
  await waitUntil(() => !pidAlive(workerPid), 5000);
  assert.equal(pidAlive(workerPid), false, 'bridge stop_worker() SIGKILLed the hung worker process group');
  // The single slot (--max-connections 1) was released; a fresh request succeeds on a new worker PID.
  const next = await client.request('fast', {}, 5000, 'alice:m2');
  assert.ok(Number.isInteger(next.pid) && next.pid !== workerPid, 'fresh worker answered on released slot');
});

test('CAD Studio surface exposes per-feature timing, featureBudgetMs setting, and Stop rebuild control', () => {
  const html = fs.readFileSync(path.join(PKG, 'tools', 'cad-studio.html'), 'utf8');
  const js = fs.readFileSync(path.join(PKG, 'tools', 'cad-studio.js'), 'utf8');
  assert.match(html, /id="cancel-rebuild"[^>]*>Stop rebuild<\/button>/);
  assert.match(html, /id="feature-budget-ms"[^>]*min="1"[^>]*max="600000"/);
  assert.match(html, /\.feature-timing\.over-budget/);
  assert.match(js, /'data-feature-ms'/);
  assert.match(js, /budget_exceeded/);
  assert.match(js, /settings\.featureBudgetMs/);
  assert.match(js, /\/cancel/);
});
