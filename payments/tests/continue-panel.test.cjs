/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Regression for "Select a saved payment below" shown with no payment list on the page: the "Continue from a payment" panel starts hidden and the shipped loadHistory() shows it only when Recent payments holds at least one payment.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The VM carries the page's esc(): loadHistory() now escapes each history cell (a Stripe description is free text) and links only an https payer URL.
 *
 * Runs loadHistory() out of tools/payments.html in a VM with element and fetch doubles.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'payments.html'), 'utf8');

/** Pull one top-level `async function name(...){...}` out of the page by brace matching. */
function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} is defined in payments.html`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

/** Run loadHistory against a history answer; returns the panel's hidden flag and the list host. */
async function run(charges) {
  const review = { hidden: true };
  const host = { innerHTML: '', querySelectorAll: () => [] };
  const ctx = {
    $: (id) => ({ paymentReview: review, hist: host })[id] || { textContent: '' },
    api: async (p) => { assert.equal(p, '/history'); return { charges }; },
    fmtDate: (v) => String(v), money: (c) => String(c), PROVIDER_LABEL: {}, document: {},
    esc: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
  };
  vm.runInNewContext(`${extractFunction(html, 'loadHistory')}; this.loadHistory = loadHistory;`, ctx);
  await ctx.loadHistory();
  return { review, host };
}

test('the panel starts hidden and says where the payments are', () => {
  assert.match(html, /<section class="panel" id="paymentReview" hidden>/);
  assert.doesNotMatch(html, /Select a saved payment below/);
  assert.match(html, /Press Review on a payment under Recent payments/);
});

test('with no recorded payment the panel stays hidden', async () => {
  const { review, host } = await run([]);
  assert.equal(review.hidden, true);
  assert.match(host.innerHTML, /No payments yet/);
});

test('with a recorded payment the panel shows above the list', async () => {
  const { review, host } = await run([{ created_at: '2026-10-12T00:00:00Z', provider: 'square', amount_cents: 2500, status: 'COMPLETED', note: '' }]);
  assert.equal(review.hidden, false);
  assert.match(host.innerHTML, /<table>/);
});
