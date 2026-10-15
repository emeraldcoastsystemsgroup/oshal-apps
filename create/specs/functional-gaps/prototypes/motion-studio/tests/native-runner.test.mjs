/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mount the actual Motion routes in the native Node runner, preserving original-person admission and real engine replies; host proofs remain explicit fixtures.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { startMotionBridge } from '../engine/bridge.mjs';

const kernel = process.env.OSHAL_KERNEL_ROOT;
if (!kernel) throw new Error('Set OSHAL_KERNEL_ROOT to the actual native kernel checkout.');
const root = resolve(import.meta.dirname, '..');
const principal = Object.freeze({ id: 'motion-runner-person', kind: 'person', subject: 'alice',
  issuer: 'motion-runner-fixture', tenant: 'fixture', state: 'active' });
const names = ['view', 'read', 'create', 'change', 'delete', 'export'].map(name => 'project.' + name);
const permission = name => ({ permission: name, resource: 'projects',
  candidates: [{ grant: { permission: name, scope: 'own' }, fields: [] }] });
let child, bridge, stderr = '', nextId = 0;
const frames = [], pending = new Map(), denied = new Set();

function exchange(request) {
  return new Promise((done, reject) => {
    const socket = connect(bridge.address.port, '127.0.0.1');
    let buffer = '', hello, settled = false;
    const timer = setTimeout(() => fail(new Error('runner fixture relay timeout')), 10000);
    function fail(error) {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy(); reject(error);
    }
    socket.on('error', fail);
    socket.on('close', () => { if (!settled) fail(new Error('runner fixture relay closed')); });
    socket.on('data', data => {
      buffer += data.toString('utf8');
      if (Buffer.byteLength(buffer) > 12 * 1024 * 1024) return fail(new Error('relay fixture byte limit'));
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        let value;
        try { value = JSON.parse(buffer.slice(0, end)); } catch (error) { return fail(error); }
        buffer = buffer.slice(end + 1);
        if (!hello) {
          hello = value;
          if (value.error) return fail(new Error(value.error));
          socket.write(JSON.stringify({ ...request, id: 1 }) + '\n');
        } else {
          settled = true; clearTimeout(timer); socket.destroy(); done({ hello, reply: value });
        }
      }
    });
  });
}
function wait(key) {
  return new Promise((done, reject) => {
    const timer = setTimeout(() => { pending.delete(key); reject(new Error('runner fixture deadline: ' + stderr)); }, 15000);
    pending.set(key, { done: value => { clearTimeout(timer); done(value); },
      reject: error => { clearTimeout(timer); reject(error); } });
  });
}
function send(message) { child.stdin.write(JSON.stringify(message) + '\n'); }
async function host(message) {
  frames.push(message);
  if (message.fn === 'intent' && message.args.name === 'auth.caller') return { principal, operator: false };
  if (message.fn === 'intent' && message.args.name === 'auth.application') {
    return { app: 'motion-studio', principal, roles: ['fixture'],
      permissions: names.filter(name => !denied.has(name)).map(permission) };
  }
  if (message.fn === 'intent' && message.args.name === 'engine.exchange') {
    return exchange(message.args.input.request);
  }
  if (message.fn === 'log') return {};
  throw new Error('Unexpected host service: ' + message.fn);
}
async function call(path, method = 'GET', body = {}, held = principal) {
  const id = ++nextId, route = '/api/motion-studio' + path, result = wait(id);
  send({ t: 'call', id, route, principal,
    authorization: { app: 'motion-studio', principal: held, path: route, method,
      permissions: [permission('project.view')] },
    input: { method, body, headers: { 'x-fixture-user': 'bob', 'content-type': 'application/json' } } });
  return result;
}
const engineCalls = () => frames.filter(frame => frame.fn === 'intent' && frame.args.name === 'engine.exchange').length;

before(async () => {
  bridge = await startMotionBridge({ binary: process.env.MOTION_ENGINE_BINARY });
  // Fixture dependencies supply the pinned accepts parser. Select the actual kernel
  // Express shim explicitly, since the fixture toolchain also contains Express.
  const toolchain = process.env.STORE_CI_TOOLCHAIN;
  if (!toolchain) throw new Error('Set STORE_CI_TOOLCHAIN for the runner fixture dependency directory.');
  const env = { ...process.env, NODE_PATH: resolve(toolchain, 'node_modules') }; delete env.NODE_OPTIONS;
  const preload = `import Module, {createRequire} from 'node:module';
    const require = createRequire(${JSON.stringify(resolve(kernel, 'crates/host-process/bridge/runner.js'))});
    const shim = require('./express_shim.js').createExpressShim();
    const original = Module._load;
    Module._load = function(name,...args) { return name === 'express' ? shim : original.call(this,name,...args); };`;
  child = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload),
    resolve(kernel, 'crates/host-process/bridge/runner.js'), root],
    { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', chunk => { if (stderr.length < 8192) stderr += chunk; });
  child.on('error', error => { for (const value of pending.values()) value.reject(error); pending.clear(); });
  child.on('exit', () => { for (const value of pending.values()) value.reject(new Error('Runner exited: ' + stderr)); pending.clear(); });
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    if (message.t === 'host') {
      host(message).then(ok => send({ t: 'host_result', id: message.id, ok }),
        error => send({ t: 'host_result', id: message.id, err: error.message }));
      return;
    }
    const key = message.t === 'ready' ? 'ready' : message.id;
    pending.get(key)?.done(message); pending.delete(key);
  });
  const ready = wait('ready');
  send({ t: 'load', package: 'motion-studio', package_dir: root,
    authorization: { catalog: { resources: { projects: { scopes: ['own'] } } } },
    app_routes: [{ module: 'routes/application.mjs', factory: 'createMotionRoutes', mountPath: '/api/motion-studio' }] });
  assert.equal((await ready).t, 'ready', stderr);
});
after(async () => {
  if (child?.exitCode === null) {
    const closed = new Promise(done => child.once('close', done));
    child.kill('SIGTERM'); await closed;
  }
  await bridge?.close();
});

test('actual runner mounts ESM factory and serves only the declared manual assets', async () => {
  for (const path of ['/app', '/ui/workbench.mjs', '/ui/workbench.css']) {
    const answer = await call(path); assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.ok(String(answer.body).length > 100);
  }
  assert.equal((await call('/ui/authorization.mjs')).status, 404);
  assert.equal((await call('/ui/../routes/project-store.mjs')).status, 404);
});
test('actual runner authorization port preserves admitted actor and uses real catalog engine relay', async () => {
  const answer = await call('/editing-contract');
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.engine.ticksPerSecond, 254016000000);
  assert.ok(answer.body.engine.commands.some(command => command.id === 'asset.import'));
  assert.ok(frames.some(frame => frame.fn === 'intent' && frame.args.name === 'auth.application'));
});
test('mismatched protocol proof refuses before any worker call', async () => {
  const before = engineCalls();
  const answer = await call('/editing-contract', 'GET', {}, { ...principal, subject: 'bob' });
  assert.equal(answer.status, 403); assert.equal(answer.body.error, 'application_resource_denied');
  assert.equal(engineCalls(), before);
});
test('native route denies missing read before malformed preview input and refuses body authority', async () => {
  const before = engineCalls(); denied.add('project.read');
  try {
    const answer = await call('/preview', 'POST', { document: 'malformed' });
    assert.equal(answer.status, 403); assert.equal(answer.body.error, 'motion_permission_denied');
    assert.equal(engineCalls(), before);
  } finally { denied.clear(); }
  const answer = await call('/preview', 'POST', { document: {}, owner: 'bob' });
  assert.equal(answer.status, 400); assert.equal(answer.body.error, 'motion_invalid_input');
  assert.equal(engineCalls(), before);
});
