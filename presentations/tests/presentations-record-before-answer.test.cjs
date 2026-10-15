/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Live 2026-10-11: My files showed 'Dec 31' for a deck saved moments earlier; GET /list answered createdAt null, slides null, theme null, and DELETE /file answered rows: 0. The "My decks" INSERT was fire-and-forget and the native kernel refuses a package's SQL once its request has answered, so the record never ran. The compiled POST /pptx route runs against a pool that, like the kernel, refuses every query after res.json: the INSERT must land before the answer, with the saved name, slide count and format. A refused record still answers with the saved file. The surface's when() shows no date for a missing createdAt instead of the 1970 epoch.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; }; return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }; }, raw: () => (_q, _s, next) => next && next() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/features/presentation-generation': {
    PresentationEngine: class {}, renderPptx: async () => Buffer.from('PK'), renderDocx: async () => Buffer.from('PK'), renderXlsx: async () => Buffer.from('PK'),
    themeCatalog: () => [], layoutCatalog: () => [], isThemeId: () => false, DEFAULT_THEME_ID: 'executive', importOffice: async () => ({}),
    brandTheme: () => { throw new Error('no brand in these cases'); },
  },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
  '@/app/routes/storage-target': {
    resolveStorageTarget: async () => ({}), listFolder: async () => ({ files: [] }), deleteStoredFile: async () => ({}),
    saveContent: async (_ctx, _sub, _kind, name) => ({ provider: 'oshal-local', location: `oshal/a0000000-0000-0000-0000-000000000042/${name}`, downloadUrl: '/dl/x' }),
  },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: '[]' }) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
  '@/app/routes/slack-client': { uploadSlackFile: async () => ({}) },
  '@/app/routes/email-routes': { sendGmail: async () => ({}), sendOutlookMail: async () => ({}) },
  '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: () => false, confirmationRequiredPayload: () => ({}) },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createBotPresentationRoutes } = require('../routes/bot-presentation-routes.js');
test.after(() => { Module._load = original; });

/** A pool that behaves like the native kernel: once the request has answered, every query is refused. */
function nativePool(refuseInsert = false) {
  const state = { answered: false, inserts: [], refusedAfterAnswer: 0 };
  const pool = {
    async query(sql, params) {
      await new Promise((resolve) => setImmediate(resolve));
      if (state.answered) { state.refusedAfterAnswer += 1; throw new Error('Completed application request is unavailable in this native runtime'); }
      if (/INSERT INTO oshal_presentations/.test(sql)) {
        if (refuseInsert) throw new Error('relation is not provisioned');
        state.inserts.push(params);
      }
      return { rows: [], rowCount: 1 };
    },
  };
  return { pool, state };
}

async function post(db, body) {
  const ctx = { pool: db.pool, appPackageDir: path.resolve(__dirname, '..') };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; db.state.answered = true; }, send(b) { this.body = b; db.state.answered = true; }, setHeader() {} };
  await createBotPresentationRoutes(ctx).routes['POST /pptx']({ oidc: { user: { sub: 'alice' } }, query: {}, params: {}, body }, res);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return res;
}

test('the My decks record lands before the request answers', async () => {
  const db = nativePool();
  const res = await post(db, { title: 'Quarterly review', sections: [{ title: 'One', content: 'a' }, { title: 'Two', content: 'b' }] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(db.state.refusedAfterAnswer, 0, 'no query ran after the answer');
  assert.equal(db.state.inserts.length, 1);
  const [sub, title, fileName, provider, , , slides, , , format] = db.state.inserts[0];
  assert.deepEqual([sub, title, fileName, provider, slides, format], ['alice', 'Quarterly review', 'Quarterly review.pptx', 'oshal-local', 2, 'pptx']);
});

test('a refused record still answers with the saved file', async () => {
  const db = nativePool(true);
  const res = await post(db, { title: 'Still saved', sections: [{ title: 'One', content: 'a' }] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.savedTo, 'oshal/a0000000-0000-0000-0000-000000000042/Still saved.pptx');
});

test('the surface shows no date for a deck with no recorded save time', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'presentations.html'), 'utf8');
  const line = html.split('\n').find((l) => l.startsWith('function when(iso)'));
  assert.ok(line, 'the surface defines when()');
  const when = new Function(`${line}; return when;`)();
  assert.equal(when(null), '');
  assert.equal(when(undefined), '');
  assert.equal(when('not a date'), '');
  assert.match(when('2026-10-11T10:50:12.672Z'), /Oct/);
});


test('saved edit source retains every section and raw structured body line',async()=>{
  const db=nativePool();
  const sections=Array.from({length:15},(_,i)=>({title:'Section '+i,content:'  raw line  \n| A | B |\n| Value | =B2*2 |\nFourth line'}));
  const res=await post(db,{title:'Complete edit source',sections});assert.equal(res.statusCode,200);
  const outline=JSON.parse(db.state.inserts[0][7]);
  assert.equal(outline.length,15);
  assert.deepEqual(outline.map(s=>({title:s.title,content:s.bullets.join('\n')})),sections);
  assert.equal(outline.every(s=>s.sourceVersion===2),true);
});
