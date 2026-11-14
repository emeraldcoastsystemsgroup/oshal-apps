/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lists 1.0.0 screen in Chromium at 1280x900 and 412x915. Real: the page and its two files as the package's router serves them, the Lists routes over the memory pool, and Shopping's own compiled routes (purchasing/routes/purchasing-routes.js over its test pool) for the grocery list the page shows. Stand-ins: the signed-in person (a cookie) and the two shared theme files (empty). The page is driven the way a person uses it: make a list, add, tick, edit the details, move, drag, remove and undo, rename, clear the done items, delete; then the grocery list through Shopping; then a phone.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { app, dependency, STORE } = require('../support/fixture.cjs');

const { chromium } = dependency('playwright');
const express = dependency('express');
const shoppingHarness = require(path.join(STORE, 'purchasing', 'tests', 'shopping-routes-harness.js'));

/** @description Shopping's real routes over its own test pool, for whoever the cookie names; `open: false` refuses everyone, as for a person without Shopping. */
function shopping(state) {
  const pool = shoppingHarness.fakePool();
  const { router } = shoppingHarness.loadRoutes({ express, pool });
  state.pool = pool;
  return (server) => server.use('/api/purchasing', (req, res, next) => {
    if (!state.open) { res.status(403).json({ error: 'authorization_denied' }); return; }
    const match = /(?:^|;\s*)person=([a-z0-9-]+)/.exec(req.headers.cookie || '');
    req.oidc = { user: match ? { sub: match[1] } : undefined, isAuthenticated: () => Boolean(match) };
    router(req, res, next);
  });
}

/** @description A server, a browser page signed in as alice at one size, and what went wrong on the page. */
async function open(t, viewport, { shop = false } = {}) {
  const state = { open: shop, pool: null };
  const f = await app({ shopping: shopping(state) });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 760, isMobile: viewport.width < 760 });
  await context.addCookies([{ name: 'person', value: 'alice', url: f.base }]);
  const page = await context.newPage(), errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(String(error.message)));
  page.on('console', (message) => { if (message.type() === 'error' && !/403|404|409|400/.test(message.text())) errors.push(message.text()); });
  page.on('request', (request) => { if (new URL(request.url()).origin !== f.base) outside.push(request.url()); });
  t.after(async () => { await browser.close(); await f.close(); });
  await page.goto(f.base + '/api/lists/app');
  await page.waitForFunction(() => document.getElementById('side-empty') && (!document.getElementById('side-empty').hidden || document.querySelectorAll('#lists li').length > 0));
  return { f, page, errors, outside, state };
}

const openTitles = (page) => page.locator('#open-items .lx-title').allTextContents();
const doneTitles = (page) => page.locator('#done-items .lx-title').allTextContents();
async function addItem(page, title) {
  await page.fill('#add-title', title);
  await page.press('#add-title', 'Enter');
  await page.waitForFunction((words) => [...document.querySelectorAll('.lx-title')].some((node) => node.textContent === words), title);
}
async function rowMenu(page, title, entry) {
  const row = page.locator('.lx-item', { has: page.locator('.lx-title', { hasText: new RegExp(`^${title}$`) }) });
  await row.locator('.lx-more > summary').click();
  await row.locator('.lx-menu button', { hasText: entry }).click();
}
const settled = (page, check, arg) => page.waitForFunction(check, arg, { timeout: 5000 });

test('a person makes a list and works it: add, tick, details, move, drag, remove and undo, rename, clear done, delete', { timeout: 120000 }, async (t) => {
  const { f, page, errors, outside } = await open(t, { width: 1280, height: 900 });
  assert.equal(await page.locator('#none h2').textContent(), 'Make your first list');
  assert.equal(await page.locator('#side-empty').textContent(), 'No lists yet.');

  await page.fill('#new-list-name', 'Packing');
  await page.press('#new-list-name', 'Enter');
  await settled(page, () => document.getElementById('list-name').textContent === 'Packing');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'add-title', 'the new list is ready to type into');
  for (const title of ['Passport', 'Socks', 'Charger', 'Sunscreen']) await addItem(page, title);
  assert.deepEqual(await openTitles(page), ['Passport', 'Socks', 'Charger', 'Sunscreen']);
  assert.equal(await page.locator('#lists .lx-count').textContent(), '4');

  await page.locator('.lx-item', { hasText: 'Socks' }).locator('input[type=checkbox]').check();
  await settled(page, () => document.querySelectorAll('#done-items .lx-item').length === 1);
  assert.deepEqual([await openTitles(page), await doneTitles(page)], [['Passport', 'Charger', 'Sunscreen'], ['Socks']]);
  assert.equal(await page.locator('#done-count').textContent(), 'Done (1)');
  assert.equal(await page.locator('#done').evaluate((node) => node.open), false, 'done items sit under a collapsed row');
  assert.match(await page.locator('#done-items .lx-title').evaluate((node) => getComputedStyle(node).textDecorationLine), /line-through/);

  await page.locator('#open-items .lx-words', { hasText: 'Passport' }).click();
  await page.fill('#d-note', 'in the blue folder');
  await page.fill('#d-quantity', '2');
  await page.fill('#d-due', '2026-12-01');
  await page.click('#d-save');
  await settled(page, () => (document.querySelector('#open-items .lx-meta') || {}).textContent === '×2 · Due Dec 1 · in the blue folder');
  const kept = (await f.call('GET', '/show?list=Packing')).body.items.find((item) => item.title === 'Passport');
  assert.deepEqual([kept.note, kept.quantity, kept.due], ['in the blue folder', 2, '2026-12-01']);

  await rowMenu(page, 'Passport', 'Move down');
  await settled(page, () => document.querySelector('#open-items .lx-title').textContent === 'Charger');
  assert.deepEqual(await openTitles(page), ['Charger', 'Passport', 'Sunscreen']);
  await page.locator('.lx-item', { hasText: 'Sunscreen' }).locator('.lx-grip').dragTo(page.locator('.lx-item', { hasText: 'Charger' }));
  await settled(page, () => document.querySelector('#open-items .lx-title').textContent === 'Sunscreen');
  assert.deepEqual(await openTitles(page), ['Sunscreen', 'Charger', 'Passport'], 'a dragged row takes the place it was dropped on');

  await rowMenu(page, 'Charger', 'Remove');
  await settled(page, () => document.getElementById('status-text').textContent === 'Removed Charger.');
  assert.deepEqual(await openTitles(page), ['Sunscreen', 'Passport']);
  await page.click('#undo');
  await settled(page, () => document.querySelectorAll('#open-items .lx-item').length === 3);
  assert.deepEqual(await openTitles(page), ['Sunscreen', 'Passport', 'Charger']);

  await page.click('#list-menu > summary');
  await page.click('#rename');
  await page.fill('#ask-input', 'Denver packing');
  await page.click('#ask-ok');
  await settled(page, () => document.getElementById('list-name').textContent === 'Denver packing');
  assert.equal(await page.locator('#lists .lx-name').textContent(), 'Denver packing');

  await page.click('#list-menu > summary');
  await page.click('#clear-done');
  assert.equal(await page.locator('#ask-title').textContent(), 'Clear 1 done item?');
  await page.click('#ask-ok');
  await settled(page, () => document.getElementById('done').hidden);
  assert.deepEqual((await f.call('GET', '/show?list=Denver packing')).body.items.map((item) => item.title), ['Sunscreen', 'Passport', 'Charger']);

  await page.click('#list-menu > summary');
  await page.click('#delete-list');
  assert.equal(await page.locator('#ask-title').textContent(), 'Delete Denver packing and its 3 items?');
  await page.click('#ask-cancel');
  assert.equal((await f.call('GET', '/lists')).body.lists.length, 1, 'Cancel deletes nothing');
  await page.click('#list-menu > summary');
  await page.click('#delete-list');
  await page.click('#ask-ok');
  await settled(page, () => !document.getElementById('none').hidden);
  assert.deepEqual((await f.call('GET', '/lists')).body.lists, []);
  assert.deepEqual([errors, outside], [[], []], 'no page error and no request outside the installation');
});

test('a refusal is said where the work is: a grocery name is Shopping\'s, an item already there is not added twice', { timeout: 60000 }, async (t) => {
  const { page, errors } = await open(t, { width: 1280, height: 900 });
  await page.fill('#new-list-name', 'Groceries');
  await page.press('#new-list-name', 'Enter');
  await settled(page, () => !document.getElementById('side-alert').hidden);
  assert.match(await page.locator('#side-alert').textContent(), /kept by Shopping/);
  assert.equal(await page.locator('#lists li').count(), 0);
  await page.fill('#new-list-name', 'Chores');
  await page.press('#new-list-name', 'Enter');
  await settled(page, () => document.getElementById('list-name').textContent === 'Chores');
  await addItem(page, 'Laundry');
  await page.fill('#add-title', 'laundry');
  await page.press('#add-title', 'Enter');
  await settled(page, () => document.getElementById('status-text').textContent === 'Laundry is already on the list.');
  assert.equal(await page.locator('#open-items .lx-item').count(), 1);
  assert.deepEqual(errors, []);
});

test('the grocery list is Shopping\'s: shown first with its mark, changed through Shopping\'s own routes, ordered in Shopping', { timeout: 60000 }, async (t) => {
  const { f, page, errors, state } = await open(t, { width: 1280, height: 900 }, { shop: true });
  await f.call('POST', '/items/add', { list: 'Packing', title: 'Tent' });
  await page.reload();
  await settled(page, () => document.querySelectorAll('#lists li').length === 2);
  assert.deepEqual(await page.locator('#lists .lx-name').allTextContents(), ['Groceries', 'Packing']);
  assert.equal(await page.locator('#lists li').first().locator('.lx-chip').textContent(), 'Shopping');
  await page.locator('#lists .lx-list', { hasText: 'Groceries' }).click();
  await settled(page, () => document.getElementById('list-name').textContent === 'Groceries');
  assert.deepEqual([await page.locator('#list-chip').isVisible(), await page.locator('#list-menu').isVisible()], [true, false], 'the list is marked as Shopping\'s and has no rename, clear or delete here');
  const order = page.locator('#order');
  assert.deepEqual([await order.isVisible(), await order.getAttribute('href'), await order.getAttribute('target')], [true, '/cockpit/?app=purchasing', '_top']);

  for (const title of ['eggs', 'bread', 'bananas']) await addItem(page, title);
  const lines = () => state.pool.tables.items.filter((row) => row.user_sub === 'alice').map((row) => [row.title, row.status]);
  assert.deepEqual(lines(), [['eggs', 'pending'], ['bread', 'pending'], ['bananas', 'pending']], 'the items are on Shopping\'s own list');
  assert.deepEqual(f.pool.tables.items.map((row) => row.title), ['Tent'], 'and never on a list of the Lists application');
  assert.equal(await page.locator('#lists li').first().locator('.lx-count').textContent(), '3');

  await page.locator('.lx-item', { hasText: 'bread' }).locator('input[type=checkbox]').check();
  await settled(page, () => document.querySelectorAll('#done-items .lx-item').length === 1);
  assert.deepEqual(lines()[1], ['bread', 'done']);
  await rowMenu(page, 'bananas', 'Remove');
  await settled(page, () => document.querySelectorAll('#open-items .lx-item').length === 1);
  assert.deepEqual(lines(), [['eggs', 'pending'], ['bread', 'done'], ['bananas', 'removed']]);
  assert.equal(await page.locator('.lx-item', { hasText: 'eggs' }).locator('.lx-menu button').count(), 1, 'a grocery row offers Remove only');
  assert.deepEqual(errors, []);
});

test('a person who cannot open Shopping sees their own lists and no grocery list', { timeout: 60000 }, async (t) => {
  const { f, page, errors } = await open(t, { width: 1280, height: 900 }, { shop: false });
  await f.call('POST', '/items/add', { list: 'Books', title: 'Dune' });
  await page.reload();
  await settled(page, () => document.querySelectorAll('#lists li').length === 1);
  assert.deepEqual(await page.locator('#lists .lx-name').allTextContents(), ['Books']);
  assert.deepEqual(errors, []);
});

test('on a phone the lists are their own screen with Back, nothing scrolls sideways and every control is at least 44px', { timeout: 60000 }, async (t) => {
  const { f, page, errors } = await open(t, { width: 412, height: 915 }, { shop: true });
  await f.call('POST', '/items/add', { list: 'Weekend', items: [{ title: 'Mow the lawn' }, { title: 'A very long item name that has to wrap instead of pushing the row wider than the phone screen ever is' }] });
  await page.reload();
  await settled(page, () => document.querySelectorAll('#lists li').length === 2);
  assert.deepEqual([await page.locator('.lx-side').isVisible(), await page.locator('.lx-main').isVisible()], [true, false], 'the lists come first');
  await page.locator('#lists .lx-list', { hasText: 'Weekend' }).tap();
  await settled(page, () => document.querySelectorAll('#open-items .lx-item').length === 2);
  assert.deepEqual([await page.locator('.lx-side').isVisible(), await page.locator('.lx-main').isVisible()], [false, true]);
  const measure = () => page.evaluate(() => ({
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    small: [...document.querySelectorAll('button, summary, input:not([type=checkbox]), a.lx-button, .lx-tick')].filter((node) => node.offsetParent !== null)
      .map((node) => [node.id || node.className, Math.round(node.getBoundingClientRect().height)]).filter(([, height]) => height < 44),
  }));
  assert.deepEqual(await measure(), { sideways: 0, small: [] });
  await page.locator('#open-items .lx-words', { hasText: 'Mow the lawn' }).tap();
  assert.equal(await page.locator('#details').evaluate((node) => node.open), true);
  assert.deepEqual(await measure(), { sideways: 0, small: [] }, 'the details dialog fits a phone');
  await page.locator('#d-cancel').tap();
  await page.locator('#back').tap();
  assert.deepEqual([await page.locator('.lx-side').isVisible(), await page.locator('.lx-main').isVisible()], [true, false]);
  assert.deepEqual(await measure(), { sideways: 0, small: [] });
  assert.deepEqual(errors, []);
});
