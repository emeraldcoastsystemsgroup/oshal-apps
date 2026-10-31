/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the Eats commerce smoke in real Chromium at 390 x 844, the actual surface iframed by a parent page over the compiled router (search, menu, adds, the confirm-gated hand-off, the relayed ops, the context envelopes, no page errors).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The fixture applies the native admission rule, so no GET in the whole session may attempt a SQL write.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | 1.4.0: real restaurants and no cart. The page starts on the diner's saved address and shows the restaurants Google Places answered; a search fills the grid the page scrolls through with no horizontal overflow; a card's Order on Uber Eats fires exactly one POST /order carrying only the place id and the address and opens Uber Eats once at that address with the restaurant searched; a chat "order" renders the shared confirm card with no POST and no window.open until Confirm; a relayed open_uber_eats proposes the same card and Cancel hands off nothing; a relayed search and set_field land through the page and the parent sees the restaurants as context; the hand-off list shows what was opened; no page errors; no GET attempted a SQL write.
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
const handoffs = () => f.requests.filter((r) => r.method === 'POST' && r.path === '/api/eats/order');
const opened = () => frame.evaluate(() => window.__opened);
const inbox = (op) => page.evaluate((want) => window.__inbox.filter((e) => e.op === want), op);
const cards = () => frame.evaluate(() => [...document.querySelectorAll('#grid [data-place]')].map((c) => c.dataset.place));
/** Post one bridge op into the surface the way the cockpit relay delivers the floating assistant's. */
const relay = (op) => page.evaluate((message) => {
  document.getElementById('surface').contentWindow.postMessage({ channel: 'oshal-surface-bridge', v: 1, app: 'eats', ...message }, location.origin);
}, op);
const UBER_SEARCH = /^https:\/\/www\.ubereats\.com\/search\?q=Taco\+Mahal&pl=[A-Za-z0-9%=]+$/;

test.before(async () => {
  f = await startFixture();
  const { chromium } = coreRequire('playwright');
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // Only the fixture origin is reachable. The one outside host the page loads is Google's image host for a
  // restaurant photo (the URL the server resolved); it is answered with a 1x1 PNG so the image renders offline.
  const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === f.origin) return route.continue();
    if (url.hostname === 'lh3.googleusercontent.com') return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
    return route.abort();
  });
  await context.addInitScript(() => { window.__opened = []; window.open = (...args) => { window.__opened.push(args.map(String)); return null; }; });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(f.origin + '/harness.html?src=/api/eats/app');
  frame = page.frames().find((candidate) => new URL(candidate.url()).pathname === '/api/eats/app');
  assert.ok(frame, 'the surface is iframed');
  await frame.waitForSelector('#grid [data-place]');
  await frame.waitForFunction(() => Boolean(window.__bridge && window.__bridgeProducer));
});
test.after(async () => { await browser?.close(); await f?.close(); });

test('the page starts on the saved address with the real restaurants, fits 390 px, and a search fills a grid the page scrolls through', async () => {
  assert.equal(await frame.inputValue('#address'), '1 Synthetic Way, Pensacola', 'the profile address is the delivery address');
  assert.deepEqual(await cards(), ['ChIJ-taco-mahal', 'ChIJ-sushi-house', 'ChIJ-thai-garden']);
  assert.match(await frame.locator('#sectionSub').innerText(), /Delivering to 1 Synthetic Way, Pensacola, FL 32502, USA/, 'the resolved address is shown');
  const first = frame.locator('#grid [data-place="ChIJ-taco-mahal"]');
  assert.match(await first.innerText(), /Taco Mahal[\s\S]*Mexican restaurant · \$ · Open now · [\d.]+ km[\s\S]*Order on Uber Eats/);
  const width = () => frame.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  let fit = await width();
  assert.ok(fit.scroll <= fit.client, `no horizontal overflow (${fit.scroll} > ${fit.client})`);
  await frame.fill('#query', 'tacos');
  await frame.click('#searchBtn');
  await frame.waitForFunction(() => /Results for "tacos"/.test(document.querySelector('#sectionTitle').textContent) && document.querySelectorAll('#grid [data-place]').length === 3);
  const scrolled = await frame.evaluate(async () => {
    const root = document.scrollingElement;
    const last = [...document.querySelectorAll('#grid .card')].pop();
    last.scrollIntoView({ block: 'end' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = last.getBoundingClientRect();
    return { scrollable: root.scrollHeight > root.clientHeight, top: root.scrollTop, visible: box.bottom <= innerHeight + 1 && box.top >= 0 };
  });
  assert.equal(scrolled.scrollable, true, 'the list runs past one screen');
  assert.ok(scrolled.top > 0, 'the page scrolled');
  assert.equal(scrolled.visible, true, 'the last restaurant is reachable');
  fit = await width();
  assert.ok(fit.scroll <= fit.client, 'still no horizontal overflow');
  const photo = await frame.locator('#grid [data-place="ChIJ-taco-mahal"] .photo img').getAttribute('src');
  assert.equal(photo, 'https://lh3.googleusercontent.com/synthetic/photo-1', 'the photo came through the server, never with a key');
});

test('a card\'s Order on Uber Eats fires exactly one hand-off POST with the id and address, and opens Uber Eats once at that address', async () => {
  await frame.locator('#grid [data-place="ChIJ-taco-mahal"] [data-order]').click();
  await frame.waitForFunction(() => window.__opened.length === 1);
  assert.equal(handoffs().length, 1);
  assert.deepEqual(handoffs()[0].body, { placeId: 'ChIJ-taco-mahal', address: '1 Synthetic Way, Pensacola' });
  assert.match((await opened())[0][0], UBER_SEARCH);
  assert.deepEqual(f.pool.tables.orders.map((o) => [o.store_id, o.store_name]), [['ChIJ-taco-mahal', 'Taco Mahal']]);
  await frame.waitForFunction(() => /Taco Mahal/.test(document.querySelector('#handoffList').textContent));
  assert.match(await frame.locator('#orderHistory').innerText(), /1 opened/);
});

test('a chat order is a confirm card: nothing is handed off until Confirm, then exactly once', async () => {
  f.setReply({ say: 'Sushi House is the pick.', show: ['ChIJ-sushi-house'], remember: [], order: 'ChIJ-sushi-house' });
  await frame.fill('#chatInput', 'sushi, order it');
  await frame.click('#chatSend');
  const card = frame.locator('#bridgeOptions .bridge-propose');
  await card.waitFor();
  assert.match(await card.innerText(), /Open Uber Eats at 1 Synthetic Way, Pensacola, FL 32502, USA with Sushi House searched\?/);
  assert.deepEqual(await cards(), ['ChIJ-sushi-house'], 'the chat shows its pick');
  assert.equal(handoffs().length, 1, 'no new hand-off POST before the confirm');
  assert.equal((await opened()).length, 1, 'no window.open before the confirm');
  await frame.locator('#bridgeOptions .bridge-confirm').click();
  await frame.waitForFunction(() => window.__opened.length === 2);
  assert.equal(handoffs().length, 2, 'the confirm fires exactly one hand-off POST');
  assert.deepEqual(handoffs()[1].body, { placeId: 'ChIJ-sushi-house', address: '1 Synthetic Way, Pensacola' });
  assert.match((await opened())[1][0], /^https:\/\/www\.ubereats\.com\/search\?q=Sushi\+House&pl=/);
  assert.deepEqual((await inbox('submit')).map((e) => [e.actionId, e.confirmed]), [['open_uber_eats', true]], 'the answer travels back to the assistant');
});

test('the floating assistant drives the same card: a relayed open_uber_eats proposes and Cancel hands off nothing', async () => {
  await relay({ op: 'custom', name: 'open_uber_eats', data: { placeId: 'ChIJ-sushi-house' } });
  await frame.locator('#bridgeOptions .bridge-propose').waitFor();
  assert.match(await frame.locator('#bridgeOptions .bridge-propose').innerText(), /with Sushi House searched\?/);
  await frame.locator('#bridgeOptions .bridge-cancel').click();
  await frame.waitForFunction(() => !document.querySelector('#bridgeOptions .bridge-propose'));
  assert.equal(handoffs().length, 2, 'still only the two confirmed hand-offs');
  assert.equal((await opened()).length, 2);
});

test('relayed search and set_field land through the page, and the parent sees the restaurants as context', async () => {
  await relay({ op: 'custom', name: 'search', data: { query: 'thai' } });
  await frame.waitForFunction(() => /Results for "thai"/.test(document.querySelector('#sectionTitle').textContent) && document.querySelectorAll('#grid [data-place]').length === 3);
  await relay({ op: 'set_field', field: 'query', value: 'ramen' });
  await page.waitForFunction(() => {
    const context = window.__inbox.filter((e) => e.op === 'context').pop();
    return context && context.fields.restaurants === 3 && context.fields.query === 'ramen';
  });
  const context = (await inbox('context')).pop();
  assert.equal(context.app, 'eats');
  assert.equal(context.surface, 'eats-restaurants');
  assert.equal(context.fields.address, '1 Synthetic Way, Pensacola');
  assert.match(context.digest, /^Deliver to: 1 Synthetic Way, Pensacola\nShowing: Results for "thai"\nRestaurants: ChIJ-taco-mahal Taco Mahal \(Mexican restaurant\) 4\.6★ \$ open; ChIJ-sushi-house Sushi House/);
  assert.match(context.digest, /Ordering opens Uber Eats at the address; no menu or prices are known here\./);
  assert.ok(context.digest.length <= 4000);
  assert.deepEqual(context.customOps.map((o) => o.name), ['search', 'open_uber_eats']);
  assert.ok((await inbox('field_change')).some((e) => e.field === 'query' && e.value === 'ramen'));
});

test('the page raised no errors', () => {
  assert.deepEqual(errors, []);
});

test('no GET in the whole session attempted a SQL write, which the native host would refuse', () => {
  assert.deepEqual(f.pool.refused, []);
});
