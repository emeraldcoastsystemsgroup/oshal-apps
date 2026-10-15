/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-10-13 14:40:00 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 14: Get a Ride's Recent trips listed "Pensacola Beach, FL / Pensacola International Airport, Pensacola, FL" four times, one row per Show rides. In Chromium at 412x915 the shipped rides-app.html opens over a /history holding that trip four times (newest first) and one other: Recent trips lists each trip once, newest copy first, and the destination suggestions do the same. Seams: /api/rides answers the history and empty reads; the shell's shared assets are empty stand-ins. Needs the store toolchain (express, playwright, chromium).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const BEACH = { pickup: 'Pensacola Beach, FL', dropoff: 'Pensacola International Airport, Pensacola, FL' };
const TRIPS = [
  { ...BEACH, deep_link: 'https://m.uber.com/newest' }, { ...BEACH }, { pickup: 'Pensacola Beach, FL ', dropoff: 'pensacola international airport,  Pensacola, FL' },
  { pickup: 'Home', dropoff: 'Downtown Library' }, { ...BEACH },
];

async function serve() {
  const app = express();
  app.get('/api/rides/app', (_req, res) => res.sendFile(path.join(PKG, 'tools', 'rides-app.html')));
  app.get('/api/rides/history', (_req, res) => res.json({ trips: TRIPS }));
  app.use('/api/rides', (_req, res) => res.json({}));
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(''));
  app.use((_req, res) => res.status(404).type('text').send(''));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('Recent trips lists each trip once, newest copy first', async (t) => {
  const { server, base } = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true })).newPage();
  await page.goto(`${base}/api/rides/app`);
  await page.locator('#recentTrips .suggestion').first().waitFor();
  const recent = await page.locator('#recentTrips .suggestion strong').allTextContents();
  assert.deepEqual(recent, [BEACH.dropoff, 'Downtown Library']);
  const suggested = await page.locator('#suggestions .suggestion strong').allTextContents();
  assert.equal(suggested.filter((label) => label.toLowerCase().startsWith('pensacola international')).length, 1, suggested.join(' | '));
});
