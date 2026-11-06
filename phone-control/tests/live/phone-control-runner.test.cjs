/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 T1 under the kernel's real package runner (crates/host-process/bridge/runner.js) over its stdio protocol, with this package's real catalog: the routes that remain answer through the runner's express shim and HTTP response encoding, the store persists in OSHAL_PACKAGE_DATA_DIR and never in the package folder, a caller without the route's grants is refused 403 application_resource_denied by the runner's own gate, a caller-chosen tenant is 400, and a second person reads another's phone as 404. The kernel's side of the protocol (auth.caller, auth.application) is played by this harness, as in the 1.0.0 dev-shim test it replaces. Needs the runner: OSHAL_BRIDGE_RUNNER, or OSHAL_KERNEL_ROOT naming a kernel checkout; it fails when neither is set.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.1: the readiness answer names version 1.1.1.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.1.2: and now 1.1.2.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const PKG_DIR = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(PKG_DIR, '..');

function resolveYamlLoader() {
  return require(path.join(REPO_ROOT, 'scripts', 'toolchain', 'node_modules', 'js-yaml'));
}

function resolveBridgeRunner() {
  const candidates = [process.env.OSHAL_BRIDGE_RUNNER,
    process.env.OSHAL_KERNEL_ROOT && path.join(process.env.OSHAL_KERNEL_ROOT, 'crates', 'host-process', 'bridge', 'runner.js')].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Set OSHAL_BRIDGE_RUNNER (the kernel runner.js) or OSHAL_KERNEL_ROOT (a kernel checkout).');
  return found;
}

function resolveNodePath() {
  return [process.env.OSHAL_PACKAGE_NODE_MODULES].filter((candidate) => candidate && fs.existsSync(candidate)).join(path.delimiter);
}

const person = (name) => ({ id: crypto.createHash('sha256').update(name).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5'),
  kind: 'person', issuer: 'https://issuer.example', subject: name, tenant: '11111111-2222-3333-4444-555555555555', state: 'active' });
const ALL = ['execution.view', 'execution.read', 'execution.operate', 'history.write', 'configuration.view', 'configuration.read',
  'configuration.pair', 'configuration.manage', 'configuration.revoke', 'bridge.read'];
const NODE = '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';
const text = (answer) => Buffer.from(answer.body, answer.representation?.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');

function startBridgeHarness({ dataDir, grantedPermissions, principal: who }) {
  const yaml = resolveYamlLoader();
  const manifest = yaml.load(fs.readFileSync(path.join(PKG_DIR, 'oshal-app.yaml'), 'utf8'));
  const catalog = yaml.load(fs.readFileSync(path.join(PKG_DIR, 'authorization.yaml'), 'utf8'));
  const runnerPath = resolveBridgeRunner();

  const child = spawn(process.execPath, [runnerPath, PKG_DIR], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_PATH: resolveNodePath(),
      OSHAL_PACKAGE_DIR: PKG_DIR,
      OSHAL_PACKAGE_DATA_DIR: dataDir
    }
  });

  let stderrBuf = '';
  let closing = false;
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString('utf8');
  });

  const rl = readline.createInterface({ input: child.stdout });
  const waiters = new Map();
  let readySettled = false;
  let readyResolve;
  let readyReject;
  const readyPromise = new Promise((res, rej) => {
    readyResolve = (v) => { readySettled = true; res(v); };
    readyReject = (e) => { readySettled = true; rej(e); };
  });

  child.once('exit', (code, signal) => {
    if (closing) return;
    const err = new Error(`Bridge runner exited unexpectedly (code=${code}, signal=${signal}):\n${stderrBuf}`);
    if (!readySettled) readyReject(err);
    for (const [, w] of waiters) w.reject(err);
    waiters.clear();
  });

  const principal = who;

  function buildPermissionCandidates(permNames) {
    return permNames
      .filter((name) => grantedPermissions.includes(name) && catalog.permissions[name])
      .map((name) => {
        const def = catalog.permissions[name];
        return {
          permission: name,
          resource: def.resource,
          effect: def.effect,
          candidates: [
            {
              grant: { permission: name, scope: 'own', fields: null },
              fields: []
            }
          ]
        };
      });
  }

  rl.on('line', (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if (msg.t === 'ready') {
      readyResolve(msg);
      return;
    }
    if (msg.t === 'host') {
      if (msg.fn === 'log') {
        child.stdin.write(JSON.stringify({ t: 'host_result', id: msg.id, ok: { logged: true } }) + '\n');
        return;
      }
      if (msg.fn === 'intent' && msg.args?.name === 'auth.caller') {
        child.stdin.write(
          JSON.stringify({
            t: 'host_result',
            id: msg.id,
            ok: {
              principal,
              operator: false
            }
          }) + '\n'
        );
        return;
      }
      if (msg.fn === 'intent' && msg.args?.name === 'auth.application') {
        const allGranted = buildPermissionCandidates(Object.keys(catalog.permissions));
        child.stdin.write(
          JSON.stringify({
            t: 'host_result',
            id: msg.id,
            ok: {
              app: 'phone-control',
              principal,
              roles: ['admin'],
              permissions: allGranted
            }
          }) + '\n'
        );
        return;
      }
      child.stdin.write(JSON.stringify({ t: 'host_result', id: msg.id, ok: {} }) + '\n');
      return;
    }
    if (msg.t === 'result' || msg.t === 'error') {
      if (msg.id === 0 && msg.t === 'error') {
        readyReject(new Error(`${msg.message}\n${stderrBuf}`));
        return;
      }
      const waiter = waiters.get(msg.id);
      if (waiter) {
        waiters.delete(msg.id);
        if (msg.t === 'error') waiter.reject(new Error(msg.message));
        else waiter.resolve(msg);
      }
    }
  });

  child.stdin.write(
    JSON.stringify({
      t: 'load',
      package: manifest.name,
      package_dir: PKG_DIR,
      app_routes: manifest.routes,
      routes: manifest.routes.map((r) => ({ path: r.mountPath, method: r.method || 'GET' })),
      tools: [],
      authorization: {
        catalog,
        mount_paths: manifest.routes.map((r) => r.mountPath),
        role_templates: manifest.authorization?.roleTemplates || []
      }
    }) + '\n'
  );

  let nextCallId = 1;

  function resolveBindingPermissions(method, rawRoute) {
    const cleanPath = rawRoute.split('?')[0];
    const candidates = [cleanPath];
    for (const mount of manifest.routes.map((r) => r.mountPath)) {
      if (cleanPath === mount) candidates.push('/');
      else if (cleanPath.startsWith(mount + '/')) candidates.push(cleanPath.slice(mount.length));
    }
    const matches = (catalog.bindings.http || []).filter((b) => {
      if (b.method !== method) return false;
      const expected = b.path.split('/');
      return candidates.some((cand) => {
        const actual = cand.split('/');
        return (
          expected.length === actual.length &&
          expected.every((part, i) => part === actual[i] || (part.startsWith(':') && actual[i].length > 0))
        );
      });
    });
    assert.equal(matches.length, 1, `Expected unambiguous HTTP binding for ${method} ${cleanPath}, got ${matches.length}`);
    return matches[0].allOf;
  }

  async function callHttp(method, route, { body, query, headers, overridePermissions } = {}) {
    const id = nextCallId++;
    const requiredNames = resolveBindingPermissions(method, route);
    const permissions = overridePermissions ?? buildPermissionCandidates(requiredNames);
    const proof = {
      principal,
      app: 'phone-control',
      catalog_revision: 'rev-1',
      method,
      path: route,
      permissions
    };
    const p = new Promise((resolve, reject) => waiters.set(id, { resolve, reject }));
    child.stdin.write(
      JSON.stringify({
        t: 'call',
        id,
        route,
        principal,
        profile: { email: 'operator@example.com', name: 'Test Operator' },
        authorization: proof,
        input: {
          method,
          headers: headers || { host: '127.0.0.1:38788' },
          query: query || {},
          body: body ?? {},
          bodyEncoding: 'json'
        }
      }) + '\n'
    );
    return p;
  }

  async function close() {
    closing = true;
    if (child.exitCode === null) {
      child.stdin.write(JSON.stringify({ t: 'drain' }) + '\n');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    rl.close();
  }

  return { readyPromise, callHttp, close, getStderr: () => stderrBuf };
}


test('phone-control 1.1.0 under the kernel runner: real routes, real catalog gate, owner isolation, lasting storage', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-control-runner-'));
  const alice = startBridgeHarness({ dataDir, grantedPermissions: ALL, principal: person('alice') });
  try {
    assert.equal((await alice.readyPromise).t, 'ready');
    const smoke = await alice.callHttp('GET', '/api/phone-control/_smoke');
    assert.equal(smoke.status, 200, alice.getStderr());
    assert.deepEqual(smoke.body, { status: 'ready', package: 'phone-control', version: '1.1.2', manifest: 'verified' });
    const page = await alice.callHttp('GET', '/api/phone-control/ui');
    assert.equal(page.status, 200);
    assert.match(text(page), /Pair an Android phone/);
    for (const asset of ['computer-link.js', 'phone-stage.js', 'phone-setup.js', 'phone-control.js', 'phone-control.css', 'editor-handoff.mjs']) {
      assert.equal((await alice.callHttp('GET', `/api/phone-control/ui/${asset}`)).status, 200, asset);
    }
    const created = await alice.callHttp('POST', '/api/phone-control/devices', { body: { name: 'Pixel', platform: 'android', computerNodeId: NODE, address: '10.0.0.2:5555' } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.device.id;
    const event = await alice.callHttp('POST', '/api/phone-control/history', { body: { computerNodeId: NODE, phoneId: id, action: 'key home', summary: 'Home', ok: true, exitCode: 0 } });
    assert.equal(event.status, 201);
    const manifest = await alice.callHttp('GET', '/api/phone-control/bridge/manifest.json');
    assert.equal(manifest.status, 200);
    const file = await alice.callHttp('GET', '/api/phone-control/bridge/files/oshal_phone_bridge.py');
    assert.equal(crypto.createHash('sha256').update(text(file)).digest('hex'), manifest.body.files.find((f) => f.name === 'oshal_phone_bridge.py').sha256);
    const denied = await alice.callHttp('POST', '/api/phone-control/history', { body: { computerNodeId: NODE, action: 'x', summary: 'x', ok: true }, overridePermissions: [] });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'application_resource_denied');
    assert.equal((await alice.callHttp('GET', '/api/phone-control/devices', { query: { tenantId: 'other' } })).status, 400);
    assert.equal((await alice.callHttp('GET', '/api/phone-control/devices')).body.devices.length, 1);
  } finally {
    await alice.close();
  }
  const bob = startBridgeHarness({ dataDir, grantedPermissions: ALL, principal: person('bob') });
  try {
    await bob.readyPromise;
    assert.deepEqual((await bob.callHttp('GET', '/api/phone-control/devices')).body.devices, [], 'bob sees none of alice\'s phones');
    assert.deepEqual((await bob.callHttp('GET', '/api/phone-control/history')).body.history, []);
  } finally {
    await bob.close();
  }
  assert.ok(fs.existsSync(path.join(dataDir, 'phone_control.sqlite')));
  assert.equal(fs.readdirSync(PKG_DIR).some((name) => /sqlite|vault|blobs/.test(name)), false, 'nothing written in the package folder');
  fs.rmSync(dataDir, { recursive: true, force: true });
});
