/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.7.0's record pages, read from the shipped files (no browser). The page route serves each of the five pages and the two files they share, and refuses any other name or a path that leaves tools/. Each page is called by its manifest label in its title and heading, has one filled button in its markup, reaches only Finance's own record routes, and never a pay, transfer, order, sync or bank-link route; Bills says Mark paid pays nothing and Goals says no money moved. The shared helpers show an amount Finance does not know as "Not known yet" (never zero), name a figure's source and date, and read typed amounts as whole cents. Run: node --test tests/record-pages.test.cjs
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | 1.8.0: Bills also reaches Finance's own mail routes (/api/finance/mail: Found in your mail); Recurring is a sixth record page and reaches only /api/finance/recurring.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PKG, ROUTES, requireWith } = require('./ledger.fixture.cjs');

const TOOLS = path.join(PKG, 'tools');
const PAGES = { accounts: 'Accounts', transactions: 'Transactions', bills: 'Bills', recurring: 'Recurring', spending: 'Spending', goals: 'Goals' };
const ROUTES_USED = { accounts: ['/ledger/accounts', '/ledger/imports', '/bills'], transactions: ['/ledger/transactions', '/ledger/accounts'], bills: ['/bills', '/mail'], recurring: ['/recurring'], spending: ['/month'], goals: ['/goals'] };
const read = (name) => fs.readFileSync(path.join(TOOLS, name), 'utf8');

/** The page route's handlers, by path. */
function pageRoutes() {
  const handlers = {};
  requireWith(path.join(ROUTES, 'finance-pages.js'), { express: { Router: () => ({ get: (route, handler) => { handlers[route] = handler; } }) } }).createFinancePagesRoutes({ appPackageDir: PKG });
  return handlers;
}
async function serve(handler, params) {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, type(t) { this.headers['content-type'] = t; return this; }, send(b) { this.body = b; return this; } };
  await handler({ params }, res);
  return res;
}

test('the page route serves the five pages and their two shared files, and nothing else', async () => {
  const routes = pageRoutes();
  for (const name of Object.keys(PAGES)) {
    const res = await serve(routes['/:page'], { page: name });
    assert.equal(res.statusCode, 200, name);
    assert.match(res.headers['content-type'], /text\/html/);
  }
  for (const file of ['finance-records.css', 'finance-records.js']) assert.equal((await serve(routes['/static/:file'], { file })).statusCode, 200, file);
  for (const page of ['../oshal-app', 'nope', 'Accounts', '%2e%2e']) assert.equal((await serve(routes['/:page'], { page })).statusCode, 404, page);
  for (const file of ['../oshal-app.yaml', 'finance-records.html', 'other.js']) assert.equal((await serve(routes['/static/:file'], { file })).statusCode, 404, file);
});

test('each page is called by its label, has one filled button, and reaches only Finance\'s own record routes', () => {
  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  for (const [name, label] of Object.entries(PAGES)) {
    const html = read(`finance-${name}.html`);
    assert.match(manifest, new RegExp(`- toolName: finance-${name}\\n\\s+label: ${label}\\n\\s+icon: .+\\n\\s+iframeUrl: /api/finance/p/${name}\\n`), `${name} is a screen`);
    assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], `${label} · Finance`);
    assert.equal(html.match(/<h1[^>]*>([^<]*)<\/h1>/)[1], label);
    assert.equal((html.match(/class="fr-primary"/g) || []).length, 1, `${name}: one filled button in the markup`);
    const calls = [...html.matchAll(/F\.api\('([^'?]+)/g)].map((m) => m[1].replace(/\/' \+.*$/, ''));
    assert.ok(calls.length, `${name} reads its records`);
    for (const call of calls) assert.ok(ROUTES_USED[name].some((root) => call === root || call.startsWith(root + '/')), `${name} calls ${call}`);
    assert.doesNotMatch(html, /\/pay\b|\/transfers?\b|createTransfer|\/orders|\/sync|link-token|\/exchange|\/link-sandbox|\/api\/trading/i, `${name} moves no money and links no bank`);
  }
  assert.match(read('finance-bills.html'), /Marks it paid in Finance\. It does not pay the bill\./);
  assert.match(read('finance-goals.html'), /Recorded in Finance\. No money moved\./);
  assert.match(read('finance-accounts.html'), /accept="\.csv,\.ofx,\.qfx,\.txt/, 'Accounts takes a CSV, OFX or QFX file');
  assert.match(read('finance-accounts.html'), /confirm: true/, 'adding and undoing need the person\'s yes');
});

test('the shared helpers never show an unknown amount as zero and always say where an amount came from', () => {
  const sandbox = { window: {}, Intl, document: { getElementById: () => null } };
  vm.runInNewContext(read('finance-records.js'), sandbox);
  const F = sandbox.window.FinanceRecords;
  assert.equal(F.money(null), 'Not known yet');
  assert.equal(F.money({ cents: null }), 'Not known yet');
  assert.match(F.money({ cents: 482044, currency: 'USD' }), /4,820\.44/);
  assert.match(F.sourceWords({ cents: 1, source: 'Harbor Bank statement', asOf: '2026-10-31' }), /^Harbor Bank statement, to /);
  assert.deepEqual(['1,234.50', '$12', '-20', '12.345', 'abc', ''].map(F.centsOf), [123450, 1200, -2000, null, null, null]);
});
