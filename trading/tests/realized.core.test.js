/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The trading surfaces' realized P&L on the engine's own cost: the compiled routes/trading-realized.js tallies engine-priced closes the way the Day P&L tile reads them, re-prices order rows by order id with the venue figure alongside, leaves an unpriceable close without a figure, and asks the kernel only for sells. The kernel import (@/app/trading-engine-cost-basis) is a recording double here; the replay itself is proven against the real schema by core's trading-engine-cost-basis specs. FRAMEWORK-COUPLED by its kernel import, so the manual gate runs it: node --test tests/realized.core.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const calls = [];
let sales = new Map();
const KERNEL = {
  '@/app/trading-engine-cost-basis': {
    engineRealizedForBook: async (ctx, sub, bookId, symbols) => { calls.push({ ctx, sub, bookId, symbols }); return sales; },
  },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (KERNEL[request]) return KERNEL[request];
  if (request.startsWith('@/')) throw new Error(`Unexpected kernel import: ${request}`);
  return originalLoad.call(this, request, parent, isMain);
};
const { tallyRealized, applyEngineRealized, priceOrdersOnEngineCost } = require(path.join(__dirname, '..', 'routes', 'trading-realized.js'));
test.after(() => { Module._load = originalLoad; });

test('tallies engine-priced closes in the shape the Day P&L tile reads, and counts unpriced closes apart', () => {
  const t = tallyRealized([12.5, -40, 7.25, null, -2.5, null]);
  assert.deepEqual(t, { trades: 4, wins: 2, losses: 2, net: -22.75, avg_win: 9.88, avg_loss: -21.25, biggest_win: 12.5, biggest_loss: -40, unpriced: 2 });
  assert.deepEqual(tallyRealized([]), { trades: 0, wins: 0, losses: 0, net: 0, avg_win: 0, avg_loss: 0, biggest_win: 0, biggest_loss: 0, unpriced: 0 });
});

test('a day of only losses has no biggest win above zero, and a day of only wins no biggest loss below it', () => {
  assert.equal(tallyRealized([-3, -9]).biggest_win, 0);
  assert.equal(tallyRealized([4, 1]).biggest_loss, 0);
});

test('re-prices each sell by order id, keeps the venue figure, and leaves buys and unpriceable closes honest', () => {
  const rows = [
    { order_id: 'b1', symbol: 'ANET', side: 'buy', realized_pnl: null },
    { order_id: 's1', symbol: 'ANET', side: 'sell', realized_pnl: '-154.66' },
    { order_id: 's2', symbol: 'MPC', side: 'sell', realized_pnl: '-57.29' },
  ];
  const out = applyEngineRealized(rows, new Map([['s1', { costBasis: 187.595, realizedPnl: 14.43 }]]));
  assert.deepEqual(out.map((r) => [r.order_id, r.realized_pnl, r.venue_realized_pnl, r.realized_basis]), [
    ['b1', null, null, 'engine'],
    ['s1', 14.43, '-154.66', 'engine'],
    ['s2', null, '-57.29', 'engine'],
  ]);
  assert.equal(rows[1].realized_pnl, '-154.66', 'the input rows are not mutated');
});

test('asks the kernel once per list, for the book and the distinct sell symbols only', async () => {
  calls.length = 0;
  sales = new Map([['s9', { costBasis: 10, realizedPnl: 5.006 }]]);
  const ctx = { pool: {} };
  const out = await priceOrdersOnEngineCost(ctx, 'owner', 'book-live', [
    { order_id: 's9', symbol: 'NTAP', side: 'sell', realized_pnl: '1' },
    { order_id: 's8', symbol: 'NTAP', side: 'sell', realized_pnl: '2' },
    { order_id: 'b7', symbol: 'IBM', side: 'buy', realized_pnl: null },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ctx, ctx);
  assert.equal(calls[0].bookId, 'book-live');
  assert.deepEqual(calls[0].symbols, ['NTAP']);
  assert.equal(out[0].realized_pnl, 5.01);
  assert.equal(out[1].realized_pnl, null);
});

test('a list with no sells never reaches the kernel', async () => {
  calls.length = 0;
  const out = await priceOrdersOnEngineCost({ pool: {} }, 'owner', 'book-live', [{ order_id: 'b1', symbol: 'IBM', side: 'buy', realized_pnl: null }]);
  assert.equal(calls.length, 0);
  assert.equal(out[0].realized_basis, 'engine');
});
