/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The package's own Uber Eats catalog: search matches a restaurant by dish, cuisine or tag and ignores words that name no food; nothing matching answers every restaurant with matched false and an ubereats.com search link; menu and order answer official ubereats.com links tagged utm_source=oshal and never a charge.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../routes/uber-catalog');

test('search matches a dish, a cuisine or a tag, ignoring words that name no food', () => {
  assert.deepEqual(catalog.search('I want tacos').items.map((i) => i.productId), ['chipotle']);
  assert.deepEqual(catalog.search('order me a pizza').items.map((i) => i.productId), ['pizza-corner']);
  assert.deepEqual(catalog.search('something vegetarian').items.map((i) => i.productId), ['green-bowl']);
  assert.equal(catalog.search('sushi', 1).items.length, 1);
});

test('nothing matching answers every restaurant, says so, and offers the ubereats.com search', () => {
  const r = catalog.search('thai food');
  assert.equal(r.matched, false);
  assert.equal(r.items.length, catalog.CATALOG.length);
  assert.equal(r.searchUrl, 'https://www.ubereats.com/search?q=thai+food&utm_source=oshal');
});

test('menu and the order handoff answer official ubereats.com links', () => {
  const m = catalog.menu('chipotle');
  assert.equal(m.store, 'Chipotle Mexican Grill');
  assert.ok(m.items.every((i) => i.productUrl === 'https://www.ubereats.com/store/chipotle-mexican-grill?utm_source=oshal'));
  assert.deepEqual(catalog.menu('nowhere').items, []);
  assert.equal(catalog.order('chipotle').checkoutUrl, 'https://www.ubereats.com/store/chipotle-mexican-grill?utm_source=oshal');
  assert.equal(catalog.order('search:pad thai').checkoutUrl, 'https://www.ubereats.com/search?q=pad+thai&utm_source=oshal');
  assert.match(catalog.order('chipotle').note, /not an in-app charge/);
  assert.equal(catalog.run(['status']).mode, 'catalog');
});
