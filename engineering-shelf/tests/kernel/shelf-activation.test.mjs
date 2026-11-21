/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.0.0: the engineering shelf as the kernel's own package runner activates and serves it (oshal-kernel crates/host-process/bridge/runner.js, spawned and spoken to over its stdin/stdout protocol the way crates/host-process/bridge/runner_ctx.test.js does). The store's readiness pair alone is refused at activation ("An installed authorization resource has no registered adapter", authorization.js `seal`), which is why the manifest declares routes/shelf-routes.js beside it; the manifest's two declarations activate, readiness answers 200 at the one mount for a caller holding the Engineer role's own grant, a tenant grant is refused 403 by the package's adapter, and no other path under the mount is served. Needs the kernel checkout at OSHAL_KERNEL_ROOT or its default folder and fails, never skips, without it.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const store = path.resolve(root, '..');
const toolchain = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(store, 'scripts', 'toolchain'));
const need = createRequire(path.join(toolchain, 'package.json'));
const yaml = need('js-yaml');
const KERNEL = process.env.OSHAL_KERNEL_ROOT || path.join(os.homedir(), 'Documents', 'projects', 'oshal-kernel');
const RUNNER = path.join(KERNEL, 'crates', 'host-process', 'bridge', 'runner.js');
const MOUNT = '/api/engineering-shelf/_smoke';

const manifest = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
const catalog = yaml.load(fs.readFileSync(path.join(root, 'authorization.yaml'), 'utf8'));
const principal = Object.freeze({ id: 'shelf-fixture', kind: 'person', subject: 'shelf-fixture', issuer: 'fixture',
  tenant: 'fixture-tenant', state: 'active' });

/** @description Answer the runner's host frames as the kernel does for this caller: who is calling, and nothing else. */
function kernel(message) {
  if (message.fn === 'intent' && message.args?.name === 'auth.caller') return { ok: { principal, operator: false } };
  if (message.fn === 'intent') return { err: `intent ${message.args?.name} has no executor in this host context` };
  return { ok: {} };
}

/**
 * @description Start the kernel's runner on this package with the given route declarations, as the kernel's load
 * message carries them (the manifest's module-bearing routes, the installed catalog and its distinct mounts).
 * @param {import('node:test').TestContext} t The test, which stops the runner when it ends.
 * @param {object[]} routes Route declarations from this manifest.
 * @returns {{loaded: Promise<object>, call: Function}} The first `ready` or load `error` frame, and a call sender.
 */
function runner(t, routes) {
  assert.ok(fs.existsSync(RUNNER), `the kernel checkout must be present to run its package runner (set OSHAL_KERNEL_ROOT); missing ${RUNNER}`);
  // A kernel source checkout installs none of the bridge's own npm modules (accepts and the like); they are answered
  // from the store's pinned toolchain, which holds the same Express stack.
  const child = spawn(process.execPath, [RUNNER, root], { stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_PATH: path.join(toolchain, 'node_modules') } });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(() => child.kill());
  const waiting = new Map();
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.t === 'host') { send({ t: 'host_result', id: message.id, ...kernel(message) }); return; }
    const key = message.t === 'ready' || (message.t === 'error' && message.id === 0) ? 'load' : message.id;
    waiting.get(key)?.(message);
    waiting.delete(key);
  });
  const wait = (key) => new Promise((resolve) => waiting.set(key, resolve));
  const loaded = wait('load');
  child.on('exit', (code) => waiting.get('load')?.({ t: 'exit', code, stderr }));
  send({ t: 'load', package: manifest.name, package_dir: root, app_routes: routes, tools: [],
    authorization: { catalog, mount_paths: [...new Set(routes.map((route) => route.mountPath))], role_templates: [] } });
  return { loaded, call(id, route, scope) {
    const answer = wait(id);
    const grant = { permission: 'app.open', scope, fields: null };
    send({ t: 'call', id, route, input: { method: 'GET', body: {}, headers: {} }, principal,
      authorization: { principal, app: manifest.name, catalog_revision: 'fixture', method: 'GET', path: route,
        permissions: [{ permission: 'app.open', resource: 'shelf', effect: 'read', candidates: [{ grant, fields: [] }] }] } });
    return answer;
  } };
}

const declared = () => manifest.routes.filter((route) => typeof route.module === 'string');

test('the store\'s readiness pair alone does not activate a package with a catalog', { timeout: 20000 }, async (t) => {
  const smokeOnly = declared().filter((route) => route.module === 'routes/package-smoke.js');
  assert.equal(smokeOnly.length, 1);
  const { loaded } = runner(t, smokeOnly);
  const frame = await loaded;
  assert.deepEqual([frame.t, frame.message], ['error', 'load failed: An installed authorization resource has no registered adapter']);
});

test('the manifest\'s two declarations activate, and readiness answers at the one mount for the Engineer role\'s own grant', { timeout: 20000 }, async (t) => {
  assert.deepEqual(declared().map((route) => route.mountPath), [MOUNT, MOUNT]);
  const shelf = runner(t, declared());
  const frame = await shelf.loaded;
  assert.equal(frame.t, 'ready', `the runner did not activate the package: ${JSON.stringify(frame)}`);
  const ready = await shelf.call(1, MOUNT, 'own');
  assert.deepEqual([ready.status, ready.body], [200, { status: 'ready', package: 'engineering-shelf', version: manifest.version, manifest: 'verified' }]);
  const tenant = await shelf.call(2, MOUNT, 'tenant');
  assert.deepEqual([tenant.status, tenant.body], [403, { error: 'application_resource_denied' }], 'the shelf adapter admits an own grant only');
  const other = await shelf.call(3, `${MOUNT}/anything`, 'own');
  assert.equal(other.status, 404, 'the mount serves readiness and nothing else');
});
