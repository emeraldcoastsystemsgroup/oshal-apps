/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | With no brokerage connected the shipped Strategies landing lists the person's paper accounts (label, value, assigned strategy, armed state, last pass) with working paths to Reports and Strategy research, and keeps the honest dead-end copy only when the paper read itself failed. Guard for the trial-demo regression (Roger, 2026-11-03): the landing said only "No connected trading accounts" although the person's paper rail and saved strategies existed.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../tools/ui/native-account-controls.js'), 'utf8');

/** The shipped module in a context with the page globals the landing reads; routes answer from fixtures. */
function landing({ portfolio, paper }) {
  const host = { id: 'nativeAccountOverview', innerHTML: '', isConnected: true, onclick: null, contains: () => true };
  const moves = [];
  const context = vm.createContext({
    console,
    $: (id) => (id === 'nativeAccountOverview' ? host : null),
    api: async (p) => {
      if (p === '/portfolio') return portfolio;
      if (p === '/paper/books') { if (paper instanceof Error) throw paper; return paper; }
      throw Error('unavailable ' + p);
    },
    stale: () => false,
    showFocusedNativeAccount: () => false,
    esc: (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])),
    accountValue: (v) => (v == null ? 'Unknown' : '$' + v),
    navigate: (view, opts) => moves.push([view, opts && opts.sub]),
    main: { innerHTML: '', querySelectorAll: () => [] },
  });
  vm.runInContext(SOURCE + '\nthis.load = loadNativeAccountOverview;', context);
  return { host, moves, run: () => context.load(1) };
}

test('no brokerage: the Strategies landing lists paper accounts with their strategy, state and paths onward', async () => {
  const paper = {
    reference: { account: { equity: 100000, cash: 100000 }, config: { armed: true } },
    accounts: [
      { label: 'Strategy paper account', archived: false, account: { equity: 100000, cash: 897.8 }, config: { armed: true },
        strategy: { strategyName: 'Balanced index core', lastResult: 'rebalanced', lastDecisionAsOf: '2026-11-02' },
        lastTick: { outcome: 'traded', orders: 4, at: '2026-11-03T19:25:11Z' } },
      { label: 'Archived book', archived: true, account: { equity: 1 }, config: { armed: false } },
    ],
  };
  const t = landing({ portfolio: { accounts: [] }, paper });
  await t.run();
  assert.match(t.host.innerHTML, /Your paper accounts/);
  assert.match(t.host.innerHTML, /Strategy paper account/);
  assert.match(t.host.innerHTML, /Balanced index core/);
  assert.match(t.host.innerHTML, /Rebalanced to its targets of 2026-11-02/);
  assert.match(t.host.innerHTML, /traded · 4 orders/);
  assert.match(t.host.innerHTML, /Paper \(reference book\)/);
  assert.match(t.host.innerHTML, /Paper autopilot rules/);
  assert.doesNotMatch(t.host.innerHTML, /Archived book/, 'an archived paper account is not offered as current');
  assert.doesNotMatch(t.host.innerHTML, /No connected trading accounts/);
  const click = (go) => t.host.onclick({ target: { closest: () => ({ dataset: { nativePaperGo: go } }) } });
  click('reports'); click('library');
  assert.deepEqual(t.moves, [['reports', 'paper'], ['strategies', 'library']], 'both buttons navigate to real sections');
});

test('no brokerage and a failed paper read: the landing keeps the honest dead-end copy, never an invented roster', async () => {
  const t = landing({ portfolio: { accounts: [] }, paper: new Error('paper route unavailable') });
  await t.run();
  assert.match(t.host.innerHTML, /No connected trading accounts/);
  assert.doesNotMatch(t.host.innerHTML, /Your paper accounts/);
});

test('a connected live account keeps the live roster path: the paper panel never replaces account strategy controls', async () => {
  const live = { accountId: 'a', connectionKey: 'owned-login', kind: 'live', label: 'Schwab …1234', equity: 10000, holdings: [] };
  const t = landing({ portfolio: { accounts: [live] }, paper: { reference: null, accounts: [] } });
  await t.run();
  assert.match(t.host.innerHTML, /Account strategies/);
  assert.doesNotMatch(t.host.innerHTML, /Your paper accounts/);
});
