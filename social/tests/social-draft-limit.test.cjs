/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 14: the X AI draft came back at 315 of 280 characters (the prompt said "HARD LIMIT 280",
 *   nothing checked it), so the person had to trim it before it could publish. In Chromium at 412x915 the person types a topic
 *   into the shipped social composer and presses Draft with X selected; the request reaches the COMPILED social router on real
 *   express, whose drafting bot is scripted. A 315-character draft is sent back to be shortened and the 250-character rewrite
 *   lands in the editor; a bot that never fits gets its draft with the limit said in words. Seams: the platform imports
 *   (bot dispatch, connector tokens, logger) are stand-ins and the shell's shared assets are empty. Needs the store toolchain
 *   (express, playwright, chromium).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const LONG = 'L'.repeat(315);
const SHORT = 'S'.repeat(250);
let replies = [];
const prompts = [];
const silent = { error() {}, info() {}, warn() {}, debug() {}, child() { return silent; } };
const STUBS = {
  '@/shared/logger': { createChildLogger: () => silent },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async (_ctx, _client, _agent, req) => { prompts.push(req.text); return { response: replies.shift() ?? '' }; } },
};
const stand = (request) => new Proxy(STUBS[request] || {}, { get: (t, k) => (k in t ? t[k] : k === '__esModule' ? true : async () => null) });
const original = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'express') return express;
  if (request.startsWith('@/')) return stand(request);
  return original.call(this, request, parent, isMain);
};
const { createSocialRoutes } = require(path.join(PKG, 'routes', 'social-routes.js'));
Module._load = original;

async function serve() {
  const app = express();
  app.use(express.json());
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(''));
  app.get('/api/social/profiles', (_req, res) => res.json({}));
  app.use('/api/social', (req, _res, next) => { req.oidc = { isAuthenticated: () => true, user: { sub: 'writer-1' } }; next(); },
    createSocialRoutes({ pool: { query: async () => ({ rows: [] }) }, appPackageDir: PKG }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function draftOnce(browser, base) {
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true })).newPage();
  await page.goto(`${base}/api/social/composer`);
  await page.locator('#topic').fill('round21 our new trail map');
  await page.locator('#draftBtn').click();
  await page.waitForFunction(() => document.getElementById('draftBtn').textContent.includes('Draft') && !document.getElementById('draftBtn').disabled && document.getElementById('text').value.length > 0);
  return { text: await page.locator('#text').inputValue(), result: await page.locator('#result').textContent(), page };
}

test('an X draft over 280 is shortened before it reaches the editor; one that never fits is said in words', async (t) => {
  const { server, base } = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });

  replies = [LONG, SHORT];
  prompts.length = 0;
  const fitted = await draftOnce(browser, base);
  assert.equal(fitted.text, SHORT, 'the shortened draft is the one in the editor');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /This X post is 315 characters; X allows at most 280\./);
  assert.doesNotMatch(fitted.result, /Shorten it/);

  replies = [LONG, LONG, LONG];
  prompts.length = 0;
  const over = await draftOnce(browser, base);
  assert.equal(over.text, LONG);
  assert.equal(prompts.length, 3, 'asked to shorten at most twice');
  assert.match(over.result, /This draft is 315 characters; X allows 280\. Shorten it before publishing\./);
});
