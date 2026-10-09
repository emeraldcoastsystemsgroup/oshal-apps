/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the Rides commerce smoke in real Chromium at 390 x 844, the actual surface (with its vendored Leaflet map) iframed by a parent page over the compiled router: no horizontal overflow; typing a destination filters the suggestions, picking one prices four ride options from the deterministic estimate and the page scrolls to the last; a chat booking selects the proposed ride and renders the shared client's confirm card with no hand-off POST and no window.open until Confirm, which fires exactly one POST /request and opens Uber once; a relayed request_ride from the floating assistant shows the same card and Cancel hands off nothing; relayed select_ride, set_field and estimate land through the page's own functions; the parent receives `context` envelopes with the trip and fare and `submit` for the confirm; no page errors.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express, playwright and the shared bridge client.
 * Not part of the store-CI wildcard; run locally:
 *   OSHAL_CORE_DIR=<framework checkout> node --test tests/surface.core.spec.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startFixture, coreRequire } from './surface.core.fixture.mjs';

let f, browser, page, frame;
const errors = [];
const booked = { say: 'Booking a Comfort to the airport.', pickup: 'my location', dropoff: 'Airport', rideType: 'comfort', showOptions: false, book: true, remember: [] };
const handoffs = () => f.requests.filter((r) => r.method === 'POST' && r.path === '/api/rides/request');
const opened = () => frame.evaluate(() => window.__opened);
const inbox = (op) => page.evaluate((want) => window.__inbox.filter((e) => e.op === want), op);
const lastContext = () => page.evaluate(() => window.__inbox.filter((e) => e.op === 'context').pop());
/** Post one bridge op into the surface the way the cockpit relay delivers the floating assistant's. */
const relay = (op) => page.evaluate((message) => {
  document.getElementById('surface').contentWindow.postMessage({ channel: 'oshal-surface-bridge', v: 1, app: 'rides', ...message }, location.origin);
}, op);

test.before(async () => {
  f = await startFixture();
  const { chromium } = coreRequire('playwright');
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === f.origin ? route.continue() : route.abort()));
  await context.addInitScript(() => { window.__opened = []; window.open = (...args) => { window.__opened.push(args.map(String)); return null; }; });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(f.origin + '/harness.html?src=/api/rides/app');
  frame = page.frames().find((candidate) => new URL(candidate.url()).pathname === '/api/rides/app');
  assert.ok(frame, 'the surface is iframed');
  await frame.waitForSelector('#osmMap.leaflet-container');
  await frame.waitForFunction(() => Boolean(window.__bridge && window.__bridgeProducer));
});
test.after(async () => { await browser?.close(); await f?.close(); });

test('at 390 px the surface fits the width; a destination search prices four rides the page scrolls through', async () => {
  const width = () => frame.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  let fit = await width();
  assert.ok(fit.scroll <= fit.client, `no horizontal overflow (${fit.scroll} > ${fit.client})`);
  await frame.fill('#dropoff', 'air');
  await frame.waitForFunction(() => [...document.querySelectorAll('#suggestions [data-suggestion]')].map((b) => b.dataset.suggestion).join('|') === 'airport');
  await frame.locator('#suggestions [data-suggestion="airport"]').click();
  await frame.waitForFunction(() => document.querySelectorAll('#options .ride-card').length === 4);
  assert.match(await frame.locator('#options .ride-card').nth(1).innerText(), /Comfort[\s\S]*\$23-30/, 'fares come from the deterministic estimate');
  const scrolled = await frame.evaluate(async () => {
    const root = document.scrollingElement;
    const last = [...document.querySelectorAll('#options .ride-card')].pop();
    last.scrollIntoView({ block: 'end' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = last.getBoundingClientRect();
    return { scrollable: root.scrollHeight > root.clientHeight, top: root.scrollTop, visible: box.bottom <= innerHeight + 1 && box.top >= 0 };
  });
  assert.equal(scrolled.scrollable, true, 'the page runs past one screen');
  assert.ok(scrolled.top > 0, 'the page scrolled');
  assert.equal(scrolled.visible, true, 'the last ride option is reachable');
  fit = await width();
  assert.ok(fit.scroll <= fit.client, 'still no horizontal overflow with options');
});

test('a chat booking selects the ride and is a confirm card: nothing is handed off until Confirm, then exactly once', async () => {
  f.setReply(booked);
  await frame.fill('#chatInput', 'comfort to the airport, go');
  await frame.click('#chatSend');
  const card = frame.locator('#bridgeOptions .bridge-propose');
  await card.waitFor();
  assert.match(await card.innerText(), /Open Uber for Comfort from my location to Airport \(estimated \$23-30\)\?/);
  assert.match(await frame.locator('#options .ride-card.is-selected').innerText(), /Comfort/, 'the proposed ride is the selected one');
  assert.equal(handoffs().length, 0, 'no hand-off POST before the confirm');
  assert.deepEqual(await opened(), [], 'no window.open before the confirm');
  assert.equal(f.pool.tables.requests.length, 0, 'nothing recorded before the confirm');
  await frame.locator('#bridgeOptions .bridge-confirm').click();
  await frame.waitForFunction(() => window.__opened.length === 1);
  assert.equal(handoffs().length, 1, 'the confirm fires exactly one hand-off POST');
  assert.equal(handoffs()[0].body.rideType, 'comfort');
  assert.match((await opened())[0][0], /^https:\/\/m\.uber\.com\/ul\//);
  assert.equal(f.pool.tables.requests.length, 1);
  assert.deepEqual((await inbox('submit')).map((e) => [e.actionId, e.confirmed]), [['request_ride', true]], 'the answer travels back to the assistant');
});

test('the floating assistant drives the same card: a relayed request_ride proposes and Cancel hands off nothing', async () => {
  await relay({ op: 'custom', name: 'request_ride', data: {} });
  await frame.locator('#bridgeOptions .bridge-propose').waitFor();
  assert.match(await frame.locator('#bridgeOptions .bridge-propose').innerText(), /Comfort from my location to Airport/);
  await frame.locator('#bridgeOptions .bridge-cancel').click();
  await frame.waitForFunction(() => !document.querySelector('#bridgeOptions .bridge-propose'));
  assert.equal(handoffs().length, 1, 'still only the one confirmed hand-off');
  assert.equal((await opened()).length, 1);
});

test('relayed select_ride, set_field and estimate land through the page, and the parent sees the trip as context', async () => {
  await relay({ op: 'custom', name: 'select_ride', data: { rideType: 'xl' } });
  await frame.waitForFunction(() => /UberXL/.test(document.querySelector('#options .ride-card.is-selected')?.textContent || ''));
  await page.waitForFunction(() => {
    const context = window.__inbox.filter((e) => e.op === 'context').pop();
    return context && context.fields.rideType === 'xl' && context.fields.fareLow === 30 && context.fields.fareHigh === 38;
  });
  await relay({ op: 'set_field', field: 'dropoff', value: 'Conference center' });
  await page.waitForFunction(() => window.__inbox.some((e) => e.op === 'field_change' && e.field === 'dropoff' && e.value === 'Conference center'));
  await relay({ op: 'custom', name: 'estimate', data: { dropoff: 'Conference center' } });
  await page.waitForFunction(() => {
    const context = window.__inbox.filter((e) => e.op === 'context').pop();
    return context && context.fields.dropoff === 'Conference center' && context.fields.options === 4;
  });
  const context = await lastContext();
  assert.equal(context.app, 'rides');
  assert.equal(context.surface, 'rides');
  assert.equal(context.title, 'Ride to Conference center');
  assert.match(context.digest, /^Trip: my location to Conference center/);
  assert.match(context.digest, /Options: uberx UberX \$18-23 ~20 min; comfort Comfort \$23-30/);
  assert.ok(context.digest.length <= 4000);
  assert.deepEqual(context.customOps.map((o) => o.name), ['estimate', 'select_ride', 'request_ride']);
  assert.equal(handoffs().length, 1, 'pricing and selecting never hand off');
});

test('the page raised no errors', () => {
  assert.deepEqual(errors, []);
});
