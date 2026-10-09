/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — known-value checks on the COMPILED cart-totals module: prices become whole cents once (2.78 is 278, never 277), float sums that drift in dollars are exact in cents (0.10 + 0.20 is 30), an unpriced line is counted rather than priced at zero, quantities clamp to 1..10, and the two-decimal formatter never goes back through floating point.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { toCents, lineQuantity, cartTotalCents, formatCents, centsToDollars, MAX_LINE_QUANTITY } =
  require(path.join(__dirname, '..', 'routes', 'cart-totals.js'));

test('a price becomes whole cents once, at the boundary', () => {
  assert.equal(toCents(2.78), 278, '2.78 * 100 is 277.99999999999997 in floating point');
  assert.equal(toCents('2.78'), 278, 'PostgreSQL returns NUMERIC as a string');
  assert.equal(toCents('0.24'), 24);
  assert.equal(toCents(0), 0);
  assert.equal(toCents('19.999'), 2000, 'rounded to the nearest cent');
  for (const bad of [null, undefined, '', 'abc', -1, Infinity, NaN, 1e9]) assert.equal(toCents(bad), null, String(bad));
});

test('quantities clamp to whole numbers from 1 to the line cap', () => {
  assert.equal(MAX_LINE_QUANTITY, 10);
  assert.equal(lineQuantity(3), 3);
  assert.equal(lineQuantity('4'), 4);
  assert.equal(lineQuantity(2.9), 2);
  assert.equal(lineQuantity(0), 1);
  assert.equal(lineQuantity(-5), 1);
  assert.equal(lineQuantity('x'), 1);
  assert.equal(lineQuantity(99), 10);
});

test('a cart adds up exactly in cents where dollars drift', () => {
  const dollars = 0.1 + 0.2;
  assert.notEqual(dollars, 0.3, 'the float trap this module exists for');
  assert.deepEqual(cartTotalCents([{ unit_price: 0.1, quantity: 1 }, { unit_price: 0.2, quantity: 1 }]), { totalCents: 30, pricedLines: 2, unpricedLines: 0 });
  const cart = [
    { unit_price: '2.78', quantity: 2 },
    { unit_price: '0.24', quantity: 3 },
    { unit_price: '8.98', quantity: 1 },
    { unit_price: null, quantity: 4 },
  ];
  assert.deepEqual(cartTotalCents(cart), { totalCents: 1526, pricedLines: 3, unpricedLines: 1 });
  assert.deepEqual(cartTotalCents([]), { totalCents: 0, pricedLines: 0, unpricedLines: 0 });
});

test('formatting integer cents never goes back through floating point', () => {
  assert.equal(formatCents(1526), '15.26');
  assert.equal(formatCents(5), '0.05');
  assert.equal(formatCents(0), '0.00');
  assert.equal(formatCents(100), '1.00');
  assert.equal(formatCents(-3), '0.00');
  assert.equal(centsToDollars(30), 0.3);
  assert.equal(centsToDollars(1526), 15.26);
});
