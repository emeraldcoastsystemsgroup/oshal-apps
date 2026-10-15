/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Demo sweep 2: right after "I have noted your peanut allergy" the Eats concierge suggested a
 *   Vegetarian Pad Thai with no warning. In Chromium at 412x915 the person types the demo's message into the shipped Eats page's
 *   concierge and presses Send; the request reaches the COMPILED chat route on real express (route harness: in-memory pool, an
 *   Uber Eats provider that reports no rail, and the demo's own concierge reply as the scripted model). The page shows the reply
 *   as written and, on its own status line under it, "Pad Thai usually contains peanuts (you avoid peanuts)". Seams: the shell's
 *   shared assets are empty stand-ins. Needs the store toolchain (express, playwright, chromium).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const harness = require('./eats-routes-harness');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const DEMO_REPLY = 'I have noted your peanut allergy. While I cannot pull live menu data, I can still suggest a vegetarian dinner idea based on general knowledge. For example, a Vegetarian Pad Thai or a Margherita Pizza with extra vegetables are popular choices.';
const refuse = () => { throw Object.assign(new Error('Uber Eats provider operation is unavailable in this native runtime'), { status: 503 }); };

async function serve() {
  const provider = harness.fakeProvider({
    status: () => ({ configured: false, connected: false, live: false, mode: 'not_connected', provider: 'Uber Eats', reason: 'no native connector' }),
    search: refuse, menu: refuse, order: refuse,
  });
  const { router } = harness.loadRoutes({ provider, express, reply: { say: DEMO_REPLY } });
  const app = express();
  app.use(express.json());
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(''));
  app.use('/api/eats', (req, _res, next) => { req.oidc = { isAuthenticated: () => true, user: { sub: 'diner-allergy' } }; next(); }, router);
  app.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('after a stated peanut allergy the page shows the Pad Thai reply with its own allergy-check line', async (t) => {
  const { server, base } = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/api/eats/app`);
  await page.locator('#chatInput').fill('I am allergic to peanuts. Suggest a vegetarian dinner for tonight.');
  await page.locator('#chatSend').click();
  const check = page.locator('#messages .msg.allergy-check');
  await check.waitFor({ timeout: 15000 });
  assert.equal(await check.textContent(), 'Allergy and diet check: Pad Thai usually contains peanuts (you avoid peanuts). Ask the restaurant before ordering it.');
  assert.equal(await check.getAttribute('role'), 'status');
  const bubbles = await page.locator('#messages .msg.bot').allTextContents();
  assert.equal(bubbles.at(-2), DEMO_REPLY, 'the reply is shown as the concierge wrote it, the check on its own line after it');
  assert.deepEqual(errors, []);
});
