/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: the operator Sources & schedules route, compiled bytes with the kernel modules stubbed: the manifest mounts it auth: operator ahead of the public /api/world router; /ping and /app answer; /sources returns core's description and 503s when World is off; PATCH /sources/:id refuses a non-boolean and an unknown id before touching the store, and records the switch under the caller's subject.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | /ping answers 503 on a core without World source control (so the dashboard keeps its link hidden). The declaration-order assertion is gone: it matched the change-log line, so it could not fail, and the kernel mounter runs the longest mount first anyway.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Exercise compiled collector routes, current writer admission, bounded input and truthful partial/provider outcomes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.join(__dirname, '..');

/** Load routes/world-operations.js with the kernel modules it imports replaced by recorders. */
function load(world, kernel = 'current') {
  const handlers = {};
  const switches = [];
  const logs = [];
  const module = { exports: {} };
  const router = {
    get: (p, fn) => { handlers['GET ' + p] = fn; },
    patch: (p, fn) => { handlers['PATCH ' + p] = fn; },
    post: (p, fn) => { handlers['POST ' + p] = fn; },
  };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(PKG, 'routes/world-operations.js'), 'utf8'))((name) => {
    if (name === 'express') return { Router: () => router };
    if (name === '@/shared/logger') return { createChildLogger: () => Object.fromEntries(['info','warn','error'].map(level => [level, (...args) => logs.push({level,args})])) };
    if (name === '@/shared/middleware/authz') return { getCaller: (req) => ({ sub: req.oidc?.user?.sub, email: null }) };
    if (name === '@/features/world-data') return {
      createWorldIntelligenceService: () => (world === false ? null : world && typeof world === 'object' ? world : {
        sourceControl: () => ({ setSwitch: async (id, enabled, actor) => { switches.push({ id, enabled, actor }); } }),
      }),
      ...(kernel === 'current' ? {
        describeWorldSources: async () => ({ sources: [{ id: 'reddit', kind: 'feed', switchedOn: switches.length === 0 }], switchTtlMs: 30000, firehoseEveryNPulses: 8 }),
        isWorldSourceId: (id) => ['reddit', 'congress-trades', 'firehose'].includes(id),
      } : {}),
    };
    if (name === './world-ops-html') return { WORLD_OPS_HTML: '<!doctype html><title>World Sources and Schedules</title>' };
    throw new Error('Unexpected dependency: ' + name);
  }, module, module.exports);
  module.exports.createWorldOperationsRoutes();
  const call = async (key, req = {}) => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; }, send(b) { this.body = b; } };
    await handlers[key]({ params: {}, body: {}, oidc: { user: { sub: 'operator-fixture' } }, ...req }, res);
    return res;
  };
  return { call, switches, logs };
}

test('the manifest mounts the route auth: operator', () => {
  const yaml = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const block = yaml.match(/\n  - module: routes\/world-operations\.js\n(?:\s{4}.+\n)+/);
  assert.ok(block, 'the operations route is declared');
  assert.match(block[0], /mountPath: \/api\/world\/operations\n/);
  assert.match(block[0], /auth: operator\n/);
});

test('/ping answers 503 on a core without World source control, so the link stays hidden', async () => {
  const res = await load(undefined, 'old').call('GET /ping');
  assert.equal(res.code, 503);
  assert.equal(res.body.ok, false);
});

test('/ping and /app answer', async () => {
  const { call } = load();
  assert.deepEqual((await call('GET /ping')).body, { ok: true });
  const app = await call('GET /app');
  assert.match(app.body, /World Sources and Schedules/);
  assert.equal(app.headers['content-type'], 'text/html; charset=utf-8');
});

test('/sources returns core\'s description, and 503 when World is not configured', async () => {
  assert.equal((await load(false).call('GET /sources')).code, 503);
  const res = await load().call('GET /sources');
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.sources.map((s) => s.id), ['reddit']);
});

test('a switch refuses a non-boolean and an unknown source before touching the store', async () => {
  const { call, switches } = load();
  assert.equal((await call('PATCH /sources/:id', { params: { id: 'reddit' }, body: { enabled: 'no' } })).code, 400);
  assert.equal((await call('PATCH /sources/:id', { params: { id: 'not-a-source' }, body: { enabled: false } })).code, 404);
  assert.deepEqual(switches, []);
});

test('a switch is recorded under the caller\'s subject and answers the refreshed row', async () => {
  const { call, switches } = load();
  const res = await call('PATCH /sources/:id', { params: { id: 'reddit' }, body: { enabled: false } });
  assert.equal(res.code, 200);
  assert.deepEqual(switches, [{ id: 'reddit', enabled: false, actor: 'operator-fixture' }]);
  assert.deepEqual(res.body.source, { id: 'reddit', kind: 'feed', switchedOn: false });
  assert.equal((await load(false).call('PATCH /sources/:id', { params: { id: 'reddit' }, body: { enabled: true } })).code, 503);
});

const COLLECTORS = ['market-events','short-interest','gov-contracts','congress-trades','insider-trades'];
const REQUEST = {tickers:[{symbol:'TEST',name:'Synthetic Company'}],days:30,lookaheadDays:2};
const RUN = 'POST /collectors/:id/run';

test('compiled collector routes preserve explicit inputs and actual partial outcomes after admission',async()=>{
  const calls=[];
  const result={status:'partial',written:2,failures:[{source:'fixture',error:'upstream_unavailable'}]};
  const {call}=load({runtimeKind:'native-scoped',
    authorizeWrite:async()=>calls.push('admit'),
    collector:async(id,body)=>{calls.push({id,body});return result;},
  });
  for(const id of COLLECTORS){
    const res=await call(RUN,{params:{id},body:REQUEST});
    assert.equal(res.code,200);assert.equal(res.body,result);
    assert.deepEqual(calls.slice(-2),['admit',{id,body:REQUEST}]);
  }
});

test('missing callers, unknown IDs and invalid envelopes fail before native execution',async()=>{
  let calls=0;
  const {call}=load({runtimeKind:'native-scoped',authorizeWrite:async()=>{calls++;},collector:async()=>{calls++;}});
  assert.equal((await call(RUN,{oidc:undefined,params:{id:'market-events'},body:REQUEST})).code,401);
  assert.equal((await call(RUN,{params:{id:'reddit'},body:REQUEST})).code,404);
  for(const body of [null,[],{url:'https://example.invalid'},{token:'fixture-secret'},
    {tickers:null},{days:366},{lookaheadDays:15}]){
    assert.equal((await call(RUN,{params:{id:'market-events'},body})).code,400);
  }
  assert.equal(calls,0);
});

test('absent native service refuses and current writer denial cannot execute a collector',async()=>{
  let calls=0;
  for(const service of [false,undefined,{collectMarketEvents:async()=>{calls++;}}]){
    const res=await load(service).call(RUN,{params:{id:'market-events'},body:REQUEST});
    assert.equal(res.code,503);assert.equal(res.body.error,'native_world_collector_unavailable');
  }
  const {call,logs}=load({runtimeKind:'native-scoped',
    authorizeWrite:async()=>{throw new Error('fixture-secret');},collector:async()=>{calls++;},
  });
  assert.equal((await call(RUN,{params:{id:'market-events'},body:REQUEST})).code,403);
  assert.equal(calls,0);assert.doesNotMatch(JSON.stringify(logs),/fixture-secret/);
});

test('provider errors remain truthful failures without leaking payloads into responses or logs',async()=>{
  const {call,logs}=load({runtimeKind:'native-scoped',authorizeWrite:async()=>{},
    collector:async()=>{throw Object.assign(new Error('fixture-secret'),{status:503});},
  });
  const res=await call(RUN,{params:{id:'market-events'},body:REQUEST});
  assert.equal(res.code,503);assert.deepEqual(res.body,{error:'world_collector_unavailable'});
  assert.doesNotMatch(JSON.stringify({body:res.body,logs}),/fixture-secret/);
});
