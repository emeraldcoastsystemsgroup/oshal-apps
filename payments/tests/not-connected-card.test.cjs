/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-06 (payments--payments-home): before Stripe was connected the
 *   page said to paste the key three times, Check again gave no sign it checked, the payment-link form was missing, and
 *   in graphite Open Connections was white underlined text on a near-white pill. Guards the one card with one primary
 *   (Connect Stripe, a new tab), Check again's spinner and its "Still not connected" answer, the disabled form, the
 *   solid primary with no underline and the 8px gap, no title card or repeated copy, and the history status filter.
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
function extract(name) {
  const start = html.search(new RegExp(`(async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} is defined in payments.html`);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

function surface(answer) {
  const nodes = { recheckBtn: { disabled: false, textContent: '', innerHTML: '' }, recheckMsg: { className: '', textContent: '' } };
  let renders = 0;
  const ctx = {
    esc: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    $: (id) => nodes[id] || null, main: { insertAdjacentHTML() {} }, active: 'stripe',
    api: async () => answer, render: () => { renders += 1; nodes.recheckMsg = { className: 'sub', textContent: 'The connection opens in a new tab; this page stays here.' }; },
    STRIPE_MODE: {},
  };
  vm.runInNewContext(`let providers = [];\n${['stripePanel', 'recheckControl', 'recheckProviders', 'stripePreviewForm', 'stripeLive'].map(extract).join('\n')}
    this.s = { stripePanel, recheckProviders };`, ctx);
  return { ...ctx.s, nodes, renders: () => renders };
}

test('not connected: one card, one sentence on the key, one primary that opens Connections in a new tab', () => {
  const out = surface().stripePanel({ provider: 'stripe', connected: false, mode: 'not_connected', detail: 'Stripe is not connected.' });
  assert.match(out, /<h2>Connect Stripe to take payments<\/h2>/);
  assert.equal((out.match(/class="btn primary"/g) || []).length, 1, 'one primary');
  assert.match(out, /<a class="btn primary" href="\/utilities" target="_blank" rel="noopener">Connect Stripe<\/a>/);
  assert.equal((out.match(/restricted key/g) || []).length, 1, 'the key is explained once');
  assert.doesNotMatch(out, /Stripe is not connected\./, 'the route detail does not repeat the heading');
  assert.match(out, /id="recheckBtn" type="button">Check again</);
  assert.match(out, /<fieldset class="preview" disabled/);
  for (const label of ['Amount', 'Currency', 'What it is for', 'Create link']) assert.ok(out.includes(label), label);
  assert.match(out, /Connect Stripe first\./);
});

test('Check again shows a spinner, then the form when connected or "Still not connected"', async () => {
  const still = surface({ providers: [{ provider: 'stripe', connected: false }] });
  const pending = still.recheckProviders();
  assert.match(still.nodes.recheckBtn.innerHTML, /class="dot"><\/span> Checking…/);
  await pending;
  assert.equal(still.renders(), 1);
  assert.equal(still.nodes.recheckMsg.textContent, 'Still not connected.');
  const now = surface({ providers: [{ provider: 'stripe', connected: true, mode: 'test' }] });
  await now.recheckProviders();
  assert.notEqual(now.nodes.recheckMsg.textContent, 'Still not connected.', 'connected: the form is drawn, no refusal');
});

test('the page has no title card or repeated rail copy; the primary is solid with no underline and 8px between actions', () => {
  const body = html.slice(html.indexOf('<body>'));
  assert.doesNotMatch(body, /<h1>Payments<\/h1>/);
  assert.doesNotMatch(body, /or Square \/ PayPal where this installation runs those rails/);
  assert.match(html, /\.btn\.primary, a\.btn\.primary \{ background:var\(--accent-primary, var\(--pay-accent\)\); color:var\(--text-on-accent, #fff\); text-decoration:none;/);
  assert.match(html, /\.actions-row \{ display:flex; flex-wrap:wrap; align-items:center; gap:8px;/);
});

test('Recent payments get a status filter once there are payments', () => {
  const load = extract('loadHistory');
  assert.match(load, /if \(!charges\.length\) \{ host\.innerHTML = '<div class="sub">No payments yet\.<\/div>'; return; \}\s*const statuses/);
  assert.match(load, /<select id="histStatus">/);
  assert.match(load, /row\.hidden=!!want&&row\.dataset\.status!==want/);
});
