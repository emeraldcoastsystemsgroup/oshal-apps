/** CHANGE LOG
 * 2026-11-05 | maintainer@emeraldcoastsystemsgroup.com | Exercise native first-use preparation without sockets or writes, invalid/refused readiness, and the shipped progress renderer with bounded read-only polling.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (name, parent, main) {
  if (name === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
  return originalLoad.call(this, name, parent, main);
};
const PKG = path.resolve(__dirname, '..');
const app = path.basename(PKG);
const clientModule = require(path.join(PKG, 'routes/engine-client.js'));
const { EngineClient } = clientModule;
const client = (readStatus, exchange = async () => { throw new Error('preparation must not send engine commands'); }) => new EngineClient({ host: 'unused', port: 1, expectedBuildHash: null, installHint: 'automatic preparation', exchange, readStatus });

test('only an explicit native readiness request asks this caller engine to prepare; lifecycle is not transport contact', async () => {
  let calls = 0;
  const states = [{ state: 'not-prepared' }, { state: 'preparing', doneBytes: 2, totalBytes: 4 }, { state: 'ready' }, { state: 'running' }];
  const c = client(async () => { calls++; return states[calls - 1]; });
  assert.equal(c.status().connected, false);
  assert.equal(c.status().lifecycle, null);
  assert.equal(calls, 0, 'constructing/reading cached status cannot trigger first use');
  for (const row of states) {
    const status = await c.refreshStatus();
    assert.deepEqual(status.lifecycle, row);
    assert.equal(status.connected, false, 'image/process readiness is not a verified transport reply');
    assert.equal(status.contacted, false);
  }
  assert.equal(calls, 4);
});

test('refused and malformed readiness propagates and cannot retain a previous ready result', async () => {
  const refused = new Error('admitted caller revoked');
  for (const value of [null, [], {}, { state: 'invented' }, { state: ['ready'] }, { state: 'ready', detail: 7 }, { state: 'preparing', doneBytes: -1 }, { state: 'preparing', totalBytes: 1.5 }, { state: 'preparing', totalBytes: Number.MAX_SAFE_INTEGER + 1 }, refused]) {
    let first = true;
    const c = client(async () => { if (first) { first = false; return { state: 'ready' }; } if (value === refused) throw refused; return value; });
    await c.refreshStatus();
    await assert.rejects(c.refreshStatus(), value === refused ? (error) => error === refused : /invalid engine readiness/);
    assert.equal(c.status().lifecycle.state, 'failed');
    assert.equal(c.status().connected, false);
  }
});

test('the actual native route factory uses only the calling package admitted engine.status intent; legacy client stays passive', async () => {
  const source = fs.readFileSync(path.join(PKG, 'routes', app + '-routes.js'), 'utf8');
  const a = source.indexOf('function engineClient('), b = source.indexOf('\n}', a) + 2;
  assert.ok(a > 0 && b > a);
  const calls = [];
  const context = { engine_client_1: clientModule, nativeContext: (ctx) => ctx.pool.storageModel === 'kernel-scoped-documents', installHint: () => 'legacy setup', NATIVE_INSTALL_HINT: 'automatic preparation' };
  vm.createContext(context);vm.runInContext(source.slice(a, b) + ';this.make = engineClient;', context);
  const native = context.make({ pool: { storageModel: 'kernel-scoped-documents' }, intent: async (name, body) => { calls.push([name, JSON.stringify(body)]); return { state: 'preparing', doneBytes: 1, totalBytes: null }; } }, {}, null);
  assert.equal(calls.length, 0);
  assert.equal((await native.refreshStatus()).lifecycle.state, 'preparing');
  assert.deepEqual(calls, [['engine.status', '{}']]);
  const legacy = context.make({ pool: {} }, {}, null);
  assert.equal((await legacy.refreshStatus()).lifecycle, null);
  assert.equal(calls.length, 1, 'legacy capability query never reaches a native intent');
});

function surface() {
  const script = fs.readFileSync(path.join(PKG, 'tools', app + '.js'), 'utf8');
  const start = script.indexOf('  let enginePoll = null;'), end = script.indexOf('  /** A person', start);
  const nodes = {}, timers = [], gets = [];
  let now = 1000;
  const context = { $: (id) => nodes[id] ||= { textContent: '', className: '', hidden: true }, ENGINE_DOWN: 'Engine not answering. Try again shortly.', state: {}, Date: { now: () => now }, clearTimeout() {}, setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; }, api: async (route, opts) => { assert.equal(route, '/capabilities');assert.equal(opts, undefined, 'readiness polling cannot mutate a model/design');gets.push(route);return { engine: { connected: false, lifecycle: { state: 'ready' } } }; } };
  assert.ok(start > 0 && end > start);
  vm.createContext(context);vm.runInContext(script.slice(start, end) + ';this.render = renderEngine;this.stop = stopEnginePoll;', context);
  return { nodes, timers, gets, render: context.render, stop: context.stop, advance: () => { now += 600001; } };
}

test('shipped renderer shows honest downloading/ready/refusal states; bounded polling only reads capabilities', async () => {
  const s = surface();
  s.render({ connected: false, lifecycle: { state: 'preparing', doneBytes: 2, totalBytes: 4 } });
  assert.match(s.nodes['engine-pill'].textContent, /Downloading/);
  assert.match(s.nodes['engine-reason'].textContent, /automatically.*50%/);
  assert.doesNotMatch(s.nodes['engine-reason'].textContent, /administrator|install-engine|OSHAL_/);
  assert.equal(s.timers.length, 1);assert.equal(s.timers[0].delay, 2000);
  await s.timers[0].fn();
  assert.equal(s.gets.length, 1);assert.equal(s.nodes['engine-pill'].textContent, 'Ready');
  assert.equal(s.nodes['engine-banner'].hidden, true);
  s.render({ connected: false, lifecycle: { state: 'failed', detail: 'private diagnostic' } });
  assert.match(s.nodes['engine-pill'].textContent, /failed/);
  assert.equal(s.nodes['engine-banner'].hidden, false);
  assert.doesNotMatch(s.nodes['engine-reason'].textContent, /private diagnostic|administrator/);
  s.render({ lifecycle: { state: 'preparing' } });s.advance();
  const count = s.timers.length;s.render({ lifecycle: { state: 'preparing' } });
  assert.equal(s.timers.length, count, 'ten-minute preparation observation is bounded');
  assert.match(s.nodes['engine-reason'].textContent, /Refresh/);
});

test('navigation stops pending readiness timers without sending another request', async () => {
  const s = surface();
  s.render({ lifecycle: { state: 'preparing' } });
  assert.equal(s.timers.length, 1);
  s.stop();await s.timers[0].fn();
  assert.equal(s.gets.length, 0);
  s.render({ lifecycle: { state: 'preparing' } });
  assert.equal(s.timers.length, 1, 'a late reply cannot restart observation after navigation');
});

test('a pending first create retains its saved circuit; the next explicit Run uses that exact ID without another create', async () => {
  const script = fs.readFileSync(path.join(PKG, 'tools', app + '.js'), 'utf8');
  const a = script.indexOf('  async function createDesign(example) {'), b = script.indexOf('  async function openDesign', a);
  const c = script.indexOf('  async function run() {'), d = script.indexOf('  function renderRun', c);
  assert.ok(a > 0 && b > a && c > 0 && d > c);
  const id = 'f0178d6f-188a-47e0-adb5-98a8284c329e', calls = [], adopted = [], nodes = {};
  const context = { state: { design: null }, $: (key) => nodes[key] ||= {}, toast() {}, flushSave: async () => {}, simFromInputs: () => ({}), loadDesigns: async () => {}, adopt: async (out) => { adopted.push(out.design.design_id);context.state.design = out.design; }, api: async (route, opts) => {
    calls.push({ route, method: opts.method });
    if (route === '/designs') { const error = new Error('engine preparing');error.body = { design: { design_id: id }, run: null, build: { ok: false, code: 'capability_unavailable' } };throw error; }
    assert.equal(route, '/designs/' + id + '/run');return { design: { design_id: id }, build: { ok: true } };
  } };
  vm.createContext(context);vm.runInContext(script.slice(a, b) + script.slice(c, d) + ';this.create = createDesign;this.runAgain = run;', context);
  await context.create('rc-charge');
  assert.deepEqual(calls, [{ route: '/designs', method: 'POST' }], 'the failed create is never retried automatically');
  assert.equal(context.state.design.design_id, id);
  await context.runAgain();
  assert.deepEqual(calls, [{ route: '/designs', method: 'POST' }, { route: '/designs/' + id + '/run', method: 'POST' }]);
  assert.deepEqual(adopted, [id, id]);
});
