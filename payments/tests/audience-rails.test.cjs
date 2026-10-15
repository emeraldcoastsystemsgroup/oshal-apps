/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The audience view ("Open here" in Orbit, the Business and Home shells) agrees with the rails GET /providers lists. With none it said "Connect a payment provider", named Square, PayPal and Stripe and offered "Take a payment"; it now says there is no payment rail here and offers only Open Payments. A rail reported not configured gives its reason; "Connect" names only rails with a connector; "Take a payment" needs a connected rail. Executes the shipped head script against a stub kit and a fetch double.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The full page's no-rail panel says the same: the runtime runs no merchant operations (square is in this installation's connector list, so "offers no merchant connector ... nothing to connect" was untrue).
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'payments.html'), 'utf8');
const start = html.indexOf('<script src="/shared/ui/js/app-view.js"></script>');
const block = (() => { const s = html.indexOf('<script>', start); const e = html.indexOf('</script>', s); return html.slice(s + 8, e); })();

/** Run the head script with a stub kit; resolve the company view's model for these /providers and /history answers. */
async function view(providers, charges = []) {
  let audiences = null;
  const A = { boot(o) { audiences = o.audiences; }, when: () => 'now', money: (v) => '$' + v, date: () => 'today' };
  const fetch = async (url) => ({ ok: true, status: 200, json: async () => (/providers/.test(url) ? { providers } : { charges }) });
  new Function('window', 'fetch', block)({ AppView: A, location: { pathname: '/api/payments', assign() {} } }, fetch);
  return audiences.company({});
}

test('no rail at all: no "Take a payment", no providers named, and the reason in words', async () => {
  const m = await view([]);
  assert.equal(m.title, 'No payment rail here');
  assert.deepEqual(m.actions.map((a) => a.label), ['Open Payments']);
  assert.match(m.lede, /runs no payment rail/);
  assert.doesNotMatch(m.lede, /nothing to connect|offers no merchant connector/, 'square is in this installation\'s connector list; the runtime runs no merchant operations');
  assert.doesNotMatch(m.lede, /Stripe|Link Square/);
  assert.equal(m.sections[0].empty, 'This installation offers no payment rail.');
});

test('rails reported not configured give their reason and are not offered for connecting', async () => {
  const detail = 'No native merchant connector is configured for this rail; payments cannot be taken until one is.';
  const m = await view([{ provider: 'square', connected: false, configured: false, detail }]);
  assert.deepEqual([m.title, m.lede, m.actions[0].label], ['No payment rail here', detail, 'Open Payments']);
  assert.deepEqual([m.sections[0].items[0].text, m.sections[0].items[0].badge], ['Not available here', 'unavailable']);
});

test('a connectable rail is named for connecting, and a connected one takes payments', async () => {
  const connectable = await view([{ provider: 'square', connected: false }]);
  assert.deepEqual([connectable.title, connectable.lede, connectable.actions[0].label],
    ['Connect a payment provider', 'Connect Square in Payments to take a payment and see it here.', 'Open Payments to connect']);
  const connected = await view([{ provider: 'square', connected: true, testMode: true }]);
  assert.deepEqual([connected.title, connected.actions[0].label], ['Money in', 'Take a payment']);
});

test('the full page with no rail says the runtime runs none, not that no connector exists', () => {
  const start = html.indexOf('function noRails()');
  const body = html.slice(start, html.indexOf('\n}\n', start));
  assert.match(body, /This installation runs no payment rail \(no Square or PayPal merchant operations\), so no payment can be taken here, and connecting an account does not change that\./);
  assert.doesNotMatch(body, /nothing to connect|offers no merchant connector/);
});
