/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The shipped Stripe panel says the mode Stripe reported: not connected / key rejected point to the Connections page and offer no payment form; a test key shows TEST MODE; a live or unknown key shows LIVE and asks twice, the second time naming LIVE, and only then sends confirmLive. Runs the page's own functions in a VM.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The not-connected panel opens Connections in a new tab and offers to check again in place; it replaced the whole tab (target=_top) while saying 'Then reload this page'.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'payments.html'), 'utf8');

/** Pull one top-level `function name(...){...}` out of the page by brace matching. */
function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is defined in payments.html`);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

/** The page's Stripe helpers with a scripted confirm(). */
function page(answers = []) {
  const asked = [];
  const ctx = {
    esc: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    confirm: (q) => { asked.push(q); return answers.length ? answers.shift() : true; },
  };
  const modes = html.slice(html.indexOf('const STRIPE_MODE = {'), html.indexOf('};', html.indexOf('const STRIPE_MODE = {')) + 2);
  vm.runInNewContext(`${modes}\n${['stripeTabState', 'stripeLive', 'stripePanel', 'stripeConfirm', 'recheckControl'].map(extract).join('\n')}
    this.api = {stripeTabState, stripeLive, stripePanel, stripeConfirm};`, ctx);
  return { ...ctx.api, asked };
}

test('not connected and a rejected key point to Connections and offer no payment form', () => {
  const { stripePanel, stripeTabState } = page();
  for (const mode of ['not_connected', 'key_rejected']) {
    const p = { provider: 'stripe', connected: false, mode, detail: 'reason <b>' };
    const out = stripePanel(p);
    assert.match(out, /href="\/utilities" target="_blank" rel="noopener"/, 'Connections opens beside the docked app, not over it');
    assert.doesNotMatch(out, /target="_top"|Then reload this page/);
    assert.match(out, /id="recheckBtn"/);
    assert.match(out, /restricted key/);
    assert.doesNotMatch(out, /id="sCreate"/, 'no payment form without a key');
    assert.doesNotMatch(out, /<b>'?$|reason <b>/, 'the reason is escaped');
  }
  assert.equal(stripeTabState({ connected: false, mode: 'not_connected' }), '○ not connected');
  assert.equal(stripeTabState({ connected: false, mode: 'key_rejected' }), '○ key rejected');
});

test('a test key shows TEST MODE; a live key shows LIVE; an unknown mode is treated as LIVE', () => {
  const { stripePanel, stripeTabState } = page();
  const test = stripePanel({ connected: true, mode: 'test' });
  assert.match(test, /TEST MODE — no real money/);
  assert.match(test, /id="sCreate"/);
  assert.doesNotMatch(test, /LIVE — real money/);
  const live = stripePanel({ connected: true, mode: 'live' });
  assert.match(live, /class="chip live">LIVE — real money/);
  assert.match(live, /confirm twice/);
  assert.match(stripePanel({ connected: true, mode: 'unknown' }), /MODE UNKNOWN — treated as LIVE/);
  assert.deepEqual(['test', 'live', 'unknown'].map((mode) => stripeTabState({ connected: true, mode })), ['● test mode', '● LIVE', '● mode unknown']);
});

test('confirmations: one for a test key, two naming LIVE otherwise, and a refusal sends nothing', () => {
  let ui = page([true]);
  assert.deepEqual({ ...ui.stripeConfirm({ mode: 'test' }, 'Create?') }, { confirm: true });
  assert.equal(ui.asked.length, 1);
  ui = page([true, true]);
  assert.deepEqual({ ...ui.stripeConfirm({ mode: 'live' }, 'Create?') }, { confirm: true, confirmLive: true });
  assert.match(ui.asked[1], /LIVE STRIPE KEY — this is REAL money/);
  ui = page([true, false]);
  assert.equal(ui.stripeConfirm({ mode: 'unknown' }, 'Refund?'), null, 'declining the LIVE question sends nothing');
  ui = page([false]);
  assert.equal(ui.stripeConfirm({ mode: 'test' }, 'Refund?'), null);
});
