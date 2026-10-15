/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bind actual Motion runner calls to genuine original-person native SQL hosts, exact native migrations and framed compositor children on shared disposable PostgreSQL.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bound child stdout and outbound packets before line decoding/parsing; failures target only their owned fixture child.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Load the actual extraction catalog and resolve fixture HTTP bindings through the genuine SDK; named assignments remain controlled fixtures.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Preserve exact native numeric text and original authority across the updated transport.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Keep private fixture bytes across real runner replacement and expose controlled SQL failure hooks.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Expose genuine original fixture principals for explicitly identified history-cardinality seeding.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Expose controlled boundary hooks and SIGKILL only exact owned package children with safe dead-pipe handling.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Expose direct controlled source-service contexts backed by genuine SDK pools, original-person native SQL and compositor relay.
 */
import {parseNative} from '../tools/native-json.mjs';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, delimiter, join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { boundedJsonFrames } from './bounded-json-wire.mjs';
import { connect } from 'node:net';
import { startMotionBridge } from '../engine/bridge.mjs';
const root = resolve(import.meta.dirname, '..');
const kernel = process.env.OSHAL_KERNEL_ROOT;
const toolchain = process.env.STORE_CI_TOOLCHAIN;
if (!kernel || !toolchain) throw new Error('Explicit kernel checkout and fixture toolchain required.');
const deps = createRequire(resolve(toolchain, 'package.json'));
const { Pool } = deps('pg');
const { createPgPool } = createRequire(resolve(kernel, 'package.json'))('./crates/host-process/bridge/pg_pool.js');
const raster = process.env.MOTION_RASTER_DEPS || '/tmp/oshal-create-proof-ZFGNIA';
const sharp = createRequire(resolve(raster, 'package.json'))('sharp');
const exec = promisify(execFile);
const candidate = permission => ({ permission, resource: 'projects', candidates: [{ grant: { permission, scope: 'own' }, fields: [] }] });

function wire(child, maxBytes = 12 * 1024 * 1024) {
  let nextId = 0, stderr = '';
  const pending = new Map();
  child.stderr.on('data', part => { if (stderr.length < 16384) stderr += part; });
  function fail(error) { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); }
  child.on('error', fail); child.stdin.on('error', fail);
  child.on('exit', code => fail(new Error('Fixture exited ' + code + ': ' + stderr)));
  const lines = boundedJsonFrames(child.stdout, { maxBytes, onError: error => { fail(error); child.kill('SIGTERM'); } });
  function wait(key) {
    return new Promise((done, reject) => {
      const timer = setTimeout(() => { pending.delete(key); reject(new Error('Fixture deadline: ' + stderr)); }, 45000);
      pending.set(key, { done: value => { clearTimeout(timer); done(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    });
  }
  const send = value => {
    const packet = JSON.stringify(value);
    if (Buffer.byteLength(packet) > maxBytes) throw new Error('Outbound fixture frame exceeds bounded bytes');
    child.stdin.write(packet + '\n');
  };
  const dispatch = value => { const key = value.ready || value.t === 'ready' ? 'ready' : value.id;
    pending.get(key)?.done(value); pending.delete(key); };
  return { child, lines, wait, send, dispatch, stderr: () => stderr,
    async request(input) {
      const id = ++nextId, result = wait(id);
      try { send({ ...input, id }); }
      catch (error) { pending.get(id)?.reject(error); pending.delete(id); }
      return result;
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = new Promise(done => child.once('close', done));
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGTERM'), 1000);
      const force = setTimeout(() => child.kill('SIGKILL'), 2000);
      await closed; clearTimeout(timer); clearTimeout(force); lines.close();
    } };
}
async function exchange(bridge, input) {
  return new Promise((done, reject) => {
    const socket = connect(bridge.address.port, '127.0.0.1'), decoder = new TextDecoder('utf-8', { fatal: true }); let text = '', hello, ended = false;
    const timer = setTimeout(() => finish(new Error('Native fixture engine deadline')), 10000);
    function finish(error, value) { if (ended) return; ended = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : done(value); }
    socket.on('error', error => finish(error)); socket.on('close', () => { if (!ended) finish(new Error('Native fixture relay closed')); });
    socket.on('data', bytes => {
      try { text += decoder.decode(bytes, { stream: true }); } catch (error) { return finish(error); } if (Buffer.byteLength(text) > 12 * 1024 * 1024) return finish(new Error('Native fixture output bound'));
      for (;;) {
        const end = text.indexOf('\n'); if (end < 0) break;
        let value; try { value = JSON.parse(text.slice(0, end)); } catch (error) { return finish(error); }
        text = text.slice(end + 1);
        if (!hello) { hello = value; if (value.error) return finish(new Error(value.error)); socket.write(JSON.stringify({ ...input, id: 1 }) + '\n'); }
        else finish(null, { hello, reply: value });
      }
    });
  });
}

export async function startNativeSqlFixture({ durable = true } = {}) {
  const raw = (await readFile(process.env.MOTION_TEST_DSN_FILE, 'utf8')).trim();
  const dsn = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(dsn.protocol) || dsn.hostname !== '127.0.0.1' || dsn.port !== '35689') {
    throw new Error('Only shared disposable PG127.0.0.1:35689 permitted.');
  }
  const database = 'motion_native_' + randomUUID().replaceAll('-', '');
  const nativeDsn = new URL(dsn); nativeDsn.pathname = '/' + database;
  const binary = process.env.MOTION_NATIVE_BINARY || '/tmp/oshal-creative-motion-native-target/debug/oshal-motion-native-fixture';
  const definition = resolve(root, 'oshal-app.yaml');
  const { stdout } = await exec(binary, ['--package-contract', definition], { maxBuffer: 512 * 1024 });
  const contract = JSON.parse(stdout), catalog = contract.authorization.catalog;
  if (contract.tools.some(tool => !tool.bound)) throw new Error('Extraction tool is not bound to its HTTP permissions');
  const dataDir = await mkdtemp(join(tmpdir(), 'motion-native-bytes-'));
  const env = { ...process.env, MOTION_PACKAGE_DIR: root, MOTION_NATIVE_DATABASE: database,
    MOTION_NATIVE_DSN: nativeDsn.href, OSHAL_LEDGER_SPILL_PATH: '/tmp/' + database + '-ledger.jsonl' };
  delete env.NODE_OPTIONS;
  delete env.OSHAL_PACKAGE_DATA_DIR;
  if (durable) env.OSHAL_PACKAGE_DATA_DIR = dataDir;
  const native = wire(spawn(binary, [], { env, stdio: ['pipe', 'pipe', 'pipe'] }));
  native.lines.on('frame', frame => native.dispatch(frame));
  let bridge; const runners = new Map(), calls = []; let afterSql, beforeSql, beforeIntent;
  const admin = new Pool({ connectionString: dsn.href, max: 1 });
  const rpc = async (actor, op, input) => {
    const answer = await native.request({ actor, op, input });
    if (answer.err) throw new Error(answer.err); return answer.ok;
  };
  async function close() {
    await Promise.allSettled([...runners.values()].map(runner => runner.close()));
    await bridge?.close(); await native.close();
    // Rust normally removes its own database; this also cleans startup/crash cases.
    try { const found = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]);
      if (found.rowCount) await admin.query('DROP DATABASE ' + database + ' WITH (FORCE)').catch(error => { if (error.code !== '3D000') throw error; }); }
    finally { await admin.end(); await rm(dataDir, { recursive: true, force: true }); }
  }
  try {
    const ready = await native.wait('ready');
    bridge = await startMotionBridge({ binary: process.env.MOTION_ENGINE_BINARY });
    async function startRunner(actor, { lasting = durable } = {}) {
      const principal = ready.principals.find(value => value.subject === actor);
      const migration = await rpc(actor, 'migrate');
      if (!migration.complete || ![0,1].includes(migration.applied)) throw new Error('Native migration incomplete');
      const preload = `import Module,{createRequire} from 'node:module';
        const require=createRequire(${JSON.stringify(resolve(kernel, 'crates/host-process/bridge/runner.js'))});
        const shim=require('./express_shim.js').createExpressShim(), original=Module._load;
        Module._load=function(name,...args){return name==='express'?shim:original.call(this,name,...args);};`;
      const runnerEnv = { ...env, NODE_PATH: [resolve(toolchain, 'node_modules'), resolve(raster, 'node_modules')].join(delimiter) };
      if (!lasting) delete runnerEnv.OSHAL_PACKAGE_DATA_DIR;
      const runner = wire(spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload),
        resolve(kernel, 'crates/host-process/bridge/runner.js'), root],
      { env: runnerEnv,
        stdio: ['pipe', 'pipe', 'pipe'] }), 16 * 1024 * 1024);
      runners.set(actor, runner);
      const grants = new Set(catalog.roles.administrator.grants.map(grant => grant.permission));
      runner.principal = principal; runner.grants = grants; runner.role = 'administrator';
      async function host(frame) {
        calls.push({ actor, ...frame });
        if (frame.fn === 'log') return {};
        // Controlled host keep acknowledgement; real kernel admission has separate sandbox proof.
        if (frame.fn === 'package_run_finished') return {finished:true};
        if (frame.fn === 'sql_query') { await beforeSql?.(actor, frame.args); const result = await rpc(actor, 'sql', frame.args); await afterSql?.(actor, frame.args, result); return result; }
        if (frame.fn === 'intent') await beforeIntent?.(actor, frame.args.name, frame.args.input);
        if (frame.fn === 'intent' && frame.args.name === 'package.keep_run_alive') return {kept:true};
        if (frame.fn === 'intent' && frame.args.name === 'auth.caller') return { principal, operator: false };
        if (frame.fn === 'intent' && frame.args.name === 'auth.application') return { app: 'motion-studio', principal,
          roles: [runner.role], permissions: [...grants].map(candidate) };
        if (frame.fn === 'intent' && frame.args.name === 'engine.exchange') return exchange(bridge, frame.args.input.request);
        throw new Error('Unexpected native fixture service: ' + frame.fn);
      }
      runner.lines.on('frame', frame => {
        if (frame.t !== 'host') return runner.dispatch(frame);
        host(frame).then(ok => { if (runner.child.exitCode === null && runner.child.signalCode === null) runner.send({ t: 'host_result', id: frame.id, ok }); },
          error => { if (runner.child.exitCode === null && runner.child.signalCode === null) runner.send({ t: 'host_result', id: frame.id, err: error.message }); });
      });
      const loaded = runner.wait('ready');
      runner.send({ t: 'load', package: 'motion-studio', package_dir: root,
        authorization: { catalog },
        app_routes: [{ module: 'routes/application.mjs', factory: 'createMotionRoutes', mountPath: '/api/motion-studio' }] });
      if ((await loaded).t !== 'ready') throw new Error('Native runner did not mount');
    }
    for (const actor of ['alice', 'bob']) await startRunner(actor);
    return { calls, rpc, close, sharp, contract, definition, dataDir,
      principal(actor) { return structuredClone(runners.get(actor).principal); },
      service(actor) {
        const runner = runners.get(actor), principal = runner.principal;
        const host = async (name, args) => {
          if (name !== 'sql_query') throw new Error('Unexpected direct service fixture host');
          await beforeSql?.(actor, args); const result = await rpc(actor, 'sql', args); await afterSql?.(actor, args, result); return result;
        };
        return { authorization: { currentActor: () => ({ issuer: principal.issuer, sub: principal.subject, isActive: true }),
          authorize: async ({ permission }) => ({ allowed: runner.grants.has(permission) }) },
          pool: createPgPool(host, () => true, { debug() {}, error() {} }),
          intent: async (name, input) => { await beforeIntent?.(actor, name, input);
            if (name === 'auth.caller') return { principal };
            if (name === 'engine.exchange') return exchange(bridge, input.request);
            throw new Error('Unexpected portable fixture intent'); } };
      },
      onSql(hook) { afterSql = hook; },
      beforeSql(hook) { beforeSql = hook; },
      beforeIntent(hook) { beforeIntent = hook; },
      async crash(actor) {
        const runner = runners.get(actor), child = runner.child;
        if (child.exitCode !== null || child.signalCode !== null) return;
        const ended = new Promise(done => child.once('close', done));
        child.kill('SIGKILL'); await ended; runner.lines.close();
      },
      async restart(actor, options) { await runners.get(actor).close(); await startRunner(actor, options); },
      assign(actor, role) {
        const runner = runners.get(actor), assigned = catalog.roles[role];
        if (!runner || !assigned) throw new Error('Unknown fixture role');
        runner.role = role; runner.grants.clear();
        for (const grant of assigned.grants) runner.grants.add(grant.permission);
      },
      deny(actor, permission) { runners.get(actor).grants.delete(permission); },
      allow(actor, permission) { runners.get(actor).grants.add(permission); },
      async call(path, { actor = 'alice', method = 'GET', body = {}, headers = {}, bodyEncoding = 'json' } = {}) {
        const runner = runners.get(actor); if (!runner) throw new Error('Unknown runner fixture identity');
        const route = '/api/motion-studio' + path;
        const resolved = JSON.parse((await exec(binary, ['--http-permissions', definition, method, route], { maxBuffer: 65536 })).stdout).permissions;
        if (!resolved) return { status: 403, body: { error: 'fixture_operation_unbound' } };
        const result=await runner.request({ t: 'call', route, principal: runner.principal,
          authorization: { app: 'motion-studio', principal: runner.principal, path: route, method,
            permissions: resolved.map(candidate) }, input: { method, body, headers, bodyEncoding } });
        if(typeof result.body==='string'&&result.representation?.content_type?.startsWith('application/json')&&!path.endsWith('/export')){result.rawBody=result.body;result.body=parseNative(result.body);}
        return result;
      } };
  } catch (error) { await close(); throw error; }
}
