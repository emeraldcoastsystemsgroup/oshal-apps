/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise native refresh health without corpus access, preserve managed refresh behavior, and pin truthful refresh-status wording.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Check running, failed and unavailable native timer observations without reporting unknown progress as idle.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import Module from 'node:module';

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
const originalEgress = process.env.OSHAL_EGRESS;
let opened = 0, cronReads = 0;
let nativeIntent;
Module._load = function (request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {} }) };
  if (request === '@/shared/middleware/authz') return { getTrustedServiceUserSub: () => null };
  if (request === './career-user-store') return {
    callerSub: req => req.userSub || null,
    listStoreUsers: () => [],
    openUserDb: () => {
      opened++;
      return { prepare: () => ({ get: () => ({ m: '2026-10-25T21:00:00Z' }) }), close() {} };
    },
  };
  if (request === './career-hunter-cron') return {
    isEveningChainRunning: () => { cronReads++; return true; },
    lastEveningCompletedAt: () => '2026-10-24T21:00:00Z',
  };
  if (request === './career-company-routes') return { isCareerAdmin: () => true };
  if (['./career-match-prefs', './career-engine-dispatch', './career-engine-response', '../lib/career-engine-runs'].includes(request)) return {};
  return originalLoad.call(this, request, ...rest);
};
const { registerCareerRunRoutes } = require('../routes/career-run-routes.js');
after(() => {
  Module._load = originalLoad;
  if (originalEgress === undefined) delete process.env.OSHAL_EGRESS;
  else process.env.OSHAL_EGRESS = originalEgress;
});

async function readRefresh(userSub, native) {
  if (native) process.env.OSHAL_EGRESS = 'kernel';
  else delete process.env.OSHAL_EGRESS;
  const mounted = new Map();
  registerCareerRunRoutes({ get: (path, handler) => mounted.set(path, handler), post() {} }, {intent:nativeIntent});
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
  await mounted.get('/run/refresh')({ userSub }, res);
  return res;
}

test('native health returns promptly without opening the corpus or reading a private cron instance', async () => {
  const before = { opened, cronReads };
  const response = await readRefresh('owner', true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { running: null, corpusFreshAt: null, lastCompletedAt: null,
    manualRefreshAvailable: false, refreshMode: 'installation-managed',observationAvailable:false,status:'unavailable' });
  assert.deepEqual({ opened, cronReads }, before);
});

test('native health still requires the caller identity', async () => {
  const response = await readRefresh(null, true);
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: 'unauthorized' });
});

test('application-managed refresh preserves its own cron and corpus observations', async () => {
  const response = await readRefresh('owner', false);
  assert.deepEqual(response.body, { running: true, corpusFreshAt: '2026-10-25T21:00:00Z',
    lastCompletedAt: '2026-10-24T21:00:00Z', manualRefreshAvailable: true, refreshMode: 'application-managed' });
});

const observation={observationAvailable:true,source:'native-scheduler',status:'running',enabled:true,running:true,lastOk:true,
  lastStartedAt:'2026-10-27T23:22:59.749Z',lastFinishedAt:'2026-10-27T06:05:06.658Z',
  lastPublishedAt:'2026-10-27T06:05:06.657Z',lastCompletedAt:'2026-10-27T06:05:06.658Z',nextRunAt:'2026-10-28T23:00:00.000Z',
  lastPublication:{publishedAt:'2026-10-27T06:05:06.657Z',completedAt:'2026-10-27T06:05:06.658Z',
    counts:{new:14281,refreshed:442361,closed:3841},sources:{confirmed:511,unconfirmed:600}}};

test('normal native readers receive actual operational evidence without a corpus scan or private operator fields',async()=>{
  const before={opened,cronReads},calls=[];
  nativeIntent=async(...args)=>{calls.push(args);return {...observation,reason:'secret /private/path',history:[{token:'private'}],principal:'other'};};
  const response=await readRefresh('owner',true);
  assert.equal(response.body.running,true);assert.equal(response.body.lastPublishedAt,observation.lastPublishedAt);
  assert.equal(response.body.lastPublication.sources.unconfirmed,600);
  assert.equal(response.body.corpusFreshAt,null,'publication time is not a row-freshness scan');
  assert.deepEqual(calls,[['career.corpus_status',{}]]);
  assert.deepEqual({opened,cronReads},before);
  assert.doesNotMatch(JSON.stringify(response.body),/secret|private|principal|history/);
  nativeIntent=undefined;
});

test('native observation failure stays unavailable and malformed auxiliary counts do not discard valid state',async()=>{
  nativeIntent=async()=>{throw Error('secret failed path');};
  let response=await readRefresh('owner',true);
  assert.equal(response.body.running,null);assert.equal(response.body.status,'unavailable');
  assert.doesNotMatch(JSON.stringify(response.body),/secret|failed path/);
  nativeIntent=async()=>({...observation,status:'idle',running:null});
  assert.equal((await readRefresh('owner',true)).body.observationAvailable,false);
  nativeIntent=async()=>({...observation,lastPublication:{...observation.lastPublication,counts:{new:'1'},sources:{confirmed:-1,unconfirmed:0}}});
  response=await readRefresh('owner',true);
  assert.equal(response.body.running,true);assert.equal(response.body.lastPublication.counts,null);assert.equal(response.body.lastPublication.sources,null);
  nativeIntent=undefined;
});

const support = readFileSync(new URL('../tools/career-settings-support.js', import.meta.url), 'utf8');
const start = support.indexOf('/* native-refresh:start */'), end = support.indexOf('/* native-refresh:end */');
assert.ok(start >= 0 && end > start);
const nativeRefreshText = new Function(support.slice(start, end) + '\nreturn nativeRefreshText;')();

test('the native pull observation explains fetching, publication and separate scoring', () => {
  const text = nativeRefreshText({ running: true, lastStartedAt: '2026-10-25T21:00:00Z',
    history: [{ outcome: 'failed', publishedAt: null }, { outcome: 'completed', publishedAt: 1792880000000 }] });
  assert.match(text, /Pull running since/);
  assert.match(text, /private copy/);
  assert.match(text, /when the pull completes/);
  assert.doesNotMatch(text, /not recorded/);
  assert.match(text, /AI fit scoring runs separately/);
  assert.match(support, /json\('\/api\/admin\/jobs'\)/);
});

test('failed and unknown pull status never claim a new successful refresh', () => {
  assert.match(nativeRefreshText({ running: false, lastOk: false }), /latest pull failed.*previously published jobs remain available/);
  assert.match(nativeRefreshText(null), /Live progress could not be checked/);
  assert.doesNotMatch(nativeRefreshText(null), /No pull is running/);
  assert.match(nativeRefreshText({ running: false, lastOk: true }), /No pull is running/);
  assert.match(nativeRefreshText({}),/Live pull progress could not be checked/);
});

test('native display keeps prior source counts distinct from the running pull and handles disabled/unknown states',()=>{
  const text=nativeRefreshText(observation);
  assert.match(text,/Pull running since/);assert.match(text,/That publication reported 511 confirmed and 600 unconfirmed sources/);
  assert.match(nativeRefreshText({...observation,status:'disabled',running:false}),/pulls are disabled/);
  assert.match(nativeRefreshText({...observation,status:'unavailable',running:null}),/Live pull progress could not be checked/);
  assert.match(support,/data\.observationAvailable===true/,'safe observations are preferred before any admin fallback');
});
