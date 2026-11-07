/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-05 (finance-home, C), Finance is a live trial door. The brief sits directly under the four tiles (it was the last thing on a 2,400 px page, so Re-analyze looked dead); the overview carries no money-sending form and no typed payment-method field; Accounts are two groups with owed amounts negative; Linked banks, Add account and the transfer history are their own screen; the header has one primary. The shipped renderAccounts runs as written.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'tools', 'finance.html'), 'utf8');
const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
const dashboard = html.slice(html.indexOf('async function renderDashboard('), html.indexOf('\n}\n', html.indexOf('async function renderDashboard(')));

test('the brief sits directly under the tiles, above Accounts, Holdings and Spending', () => {
  const tiles = dashboard.indexOf('<div class="stats">');
  const brief = dashboard.indexOf('id="briefPanel"');
  const accounts = dashboard.indexOf('${renderAccounts(a, cur)}');
  assert.ok(tiles >= 0 && brief > tiles && accounts > brief, 'tiles, then the brief, then the accounts');
  assert.ok(dashboard.indexOf('renderHoldings') > brief && dashboard.indexOf('renderSpending') > brief);
  assert.match(html, /\$\('briefBtn'\)\.onclick = \(\) => loadBrief\(true\);/);
  assert.match(html, /api\('\/brief\/refresh', \{ method: 'POST'/, 'Re-analyze asks for a new brief');
});

test('the overview moves no money and never asks for a payment-method id', () => {
  assert.doesNotMatch(html, /pm_/);
  assert.doesNotMatch(html, /id="paySrc"|id="payBtn"|submitPay/);
  assert.doesNotMatch(html, /api\('\/pay'/, 'no transfer request anywhere on the page');
  const overview = dashboard.slice(dashboard.indexOf('const a = summary.aggregate'));
  assert.doesNotMatch(overview, /loadPay|payPanel|linksPanel|loadLinks/, 'banks and transfers are not on the overview');
});

test('the header has one primary (Re-analyze); Sync is an icon beside the synced date', () => {
  const head = html.slice(html.indexOf('<div class="actions" id="actions"'), html.indexOf('</div>', html.indexOf('<div class="actions" id="actions"')));
  assert.equal((head.match(/<button/g) || []).length, 1);
  assert.match(head, /id="briefBtn">Re-analyze</);
  assert.match(dashboard, /Synced \$\{fmtDate\(summary\.syncedAt\)\} <button class="icon-btn" id="syncIcon" type="button" aria-label="Sync accounts"/);
  assert.doesNotMatch(html, /Reading is read-only; the only action that moves funds/, 'no policy subtitle');
});

test('Accounts are Assets and Liabilities, owed amounts read negative, and the tables sort', () => {
  const money = html.match(/^const money = .*$/m)[0];
  const render = html.match(/^function renderAccounts\(a, cur\) \{[\s\S]*?\n\}/m)[0];
  const out = new Function('data', `${money}\n${render}\nreturn renderAccounts(data, 'USD');`)({ accounts: [
    { name: 'Plaid Checking', institution: 'First Platypus Bank', type: 'depository', subtype: 'checking', balance: 110 },
    { name: 'Plaid Student Loan', institution: 'First Platypus Bank', type: 'loan', subtype: 'student', balance: 65262 },
    { name: 'Plaid Credit Card', institution: 'First Platypus Bank', type: 'credit', subtype: 'credit card', balance: 410 },
  ] });
  const assets = out.indexOf('<span>Assets</span>'), liabilities = out.indexOf('<span>Liabilities</span>');
  assert.ok(assets >= 0 && liabilities > assets);
  assert.ok(out.indexOf('Plaid Checking') < liabilities && out.indexOf('Plaid Student Loan') > liabilities);
  assert.match(out, /<td class="num owed">−\$65,262<\/td>/);
  assert.match(out, /<td class="num owed">−\$410<\/td>/);
  assert.match(out, /<td class="num">\$110<\/td>/);
  assert.equal((out.match(/<table class="accounts" data-sortable>/g) || []).length, 2);
  assert.match(html, /<script src="\/ui\/kernel\/table\.js" defer><\/script>/);
  const onlyAssets = new Function('data', `${money}\n${render}\nreturn renderAccounts(data, 'USD');`)({ accounts: [{ name: 'A', institution: 'B', type: 'depository', balance: 1 }] });
  assert.doesNotMatch(onlyAssets, /Liabilities/, 'an empty group is not drawn');
});

test('Linked banks is its own screen with Add account and the transfer history', () => {
  assert.match(manifest, /toolName: finance-banks\n\s+label: Linked banks\n\s+icon: [^\n]+\n\s+iframeUrl: \/api\/finance\/\?view=banks/);
  assert.match(html, /get\('view'\) === 'banks'\) \{ await renderBanks\(\); return; \}/);
  const banks = html.slice(html.indexOf('async function renderBanks()'), html.indexOf('\n}\n', html.indexOf('async function renderBanks()')));
  assert.match(banks, /id="addAccount"/);
  assert.match(banks, /loadLinks\(\)/);
  assert.match(banks, /loadPayHistory\(\)/);
});

test('from 1040 px Accounts sit left and Holdings and Spending right', () => {
  assert.match(html, /@media \(min-width:1040px\) \{\s*\.page \{ max-width:1200px; \}\s*\.cols \{ display:grid; grid-template-columns:minmax\(0,1\.1fr\) minmax\(0,1fr\)/);
  assert.match(dashboard, /<div class="cols">\s*<div>\$\{renderAccounts\(a, cur\)\}<\/div>\s*<div>\$\{a\.holdings\.length/);
});
