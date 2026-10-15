/**
 * Guide-bot surface contract. The route must turn a signed-in deck-builder turn into bounded,
 * editor-ready actions; arbitrary operations and malformed fields never cross the surface boundary.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-24 21:20:00 | maintainer@emeraldcoastsystemsgroup.com   | Prove the deck-builder guide reaches the editor through the validated action contract and denies anonymous callers.
 * 2026-09-26 06:22:00 | maintainer@emeraldcoastsystemsgroup.com   | Pin protected direct, non-agentic reasoning for the tool-less Guide turn.
 */

import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const here = path.dirname(fileURLToPath(import.meta.url));

function fakeRouter() {
  const routes = new Map();
  const register = (method) => (routePath, ...handlers) => routes.set(`${method} ${routePath}`, handlers.at(-1));
  return { routes, get: register('get'), post: register('post'), put: register('put'), delete: register('delete') };
}

const calls = [];
let cellProposals = [];
const STUBS = {
  express: { Router: () => fakeRouter(), raw: () => (_req, _res, next) => next?.() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/features/presentation-generation': {
    PresentationEngine: class {}, renderPptx: async () => Buffer.alloc(0), renderDocx: async () => Buffer.alloc(0),
    renderXlsx: async () => Buffer.alloc(0), themeCatalog: () => [{ id: 'executive', mood: 'clear' }],
    layoutCatalog: () => [], isThemeId: (value) => value === 'executive', DEFAULT_THEME_ID: 'executive', importOffice: async () => ({}),
  },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
  '@/app/routes/storage-target': {
    resolveStorageTarget: async () => ({ provider: 'test' }), saveContent: async () => ({}),
    listFolder: async () => ({ provider: 'test', files: [] }), deleteStoredFile: async () => ({}),
  },
  '@/app/routes/inline-bot-execution': {
    executeBotOrInline: async (...args) => {
      calls.push(args);
      return { response: JSON.stringify({
        reply: 'I updated the outline.',
        actions: [
          { op: 'set_title', title: 'Quarterly review' },
          { op: 'add_slide', title: 'Next steps', bullets: ['Confirm owner', 7] },
          { op: 'update_slide', index: 2, bullets: ['bounded'] },
          { op: 'delete_all', path: '/tmp/should-not-cross' },
          { op: 'update_slide', index: 0, title: 'invalid' },
          { op: 'set_theme', theme: 'executive' },
          ...cellProposals,
        ],
      }) };
    },
  },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
  '@/app/routes/slack-client': { uploadSlackFile: async () => { throw new Error('unexpected Slack upload'); } },
  '@/app/routes/email-routes': { sendGmail: async () => ({}), sendOutlookMail: async () => ({}) },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: () => false,
    confirmationRequiredPayload: () => ({ error: 'confirmation_required' }),
  },
};

const toolchain = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.resolve(here,'../../scripts/toolchain'));
const express = require(path.join(toolchain,'node_modules','express'));
STUBS.express = {Router: express.Router,raw:express.raw};
const originalLoad = Module._load;
Module._load = function loadWithFrameworkSeams(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const { createBotPresentationRoutes } = require('../routes/bot-presentation-routes.js');

function response() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.sendFile = () => res;
  return res;
}

function guideHandler() {
  const router = createBotPresentationRoutes({ pool: { query: async () => ({ rows: [] }) }, appPackageDir: path.resolve(here, '..') });
  const handler = router.routes.get('post /guide');
  assert.ok(handler, 'POST /guide is not registered');
  return handler;
}



test('actual compiled Office asset router delivers every workspace asset under a named authenticated mount',async()=>{
  const app=express();
  app.use('/api/presentations/sections',(req,res,next)=>{if(req.headers['x-office-fixture-owner']!=='owner')return res.status(401).json({error:'not_authenticated'});req.oidc={user:{sub:'owner'}};next();},createBotPresentationRoutes({pool:{query:async()=>({rows:[]})},appPackageDir:path.resolve(here,'..')}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}/api/presentations/sections/assets/`;
  try{
    for(const name of ['office-workspace.css','office-assistant.mjs','slide-workspace.css','slide-workspace.mjs','sheet-workspace.css','sheet-workspace.mjs']){
      const unauthorized=await fetch(base+name);assert.equal(unauthorized.status,401);
      const response=await fetch(base+name,{headers:{'x-office-fixture-owner':'owner'}});
      assert.equal(response.status,200,name);assert.match(response.headers.get('content-type'),name.endsWith('.css')?/text\/css/:/text\/javascript/);
      assert.equal(response.headers.get('cache-control'),'private, no-store');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(path.resolve(here,'..','tools',name)));
    }
    for(const name of ['constructor','presentations.html','not-shipped.mjs','..%2Foshal-app.yaml']){
      const response=await fetch(base+name,{headers:{'x-office-fixture-owner':'owner'}});assert.equal(response.status,404,name);
    }
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));Module._load=originalLoad;}
});
