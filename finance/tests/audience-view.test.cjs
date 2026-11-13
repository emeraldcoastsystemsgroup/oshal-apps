/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Guard incomplete and unknown transaction coverage through actual saved readers, analysis or rendered views without changing independent balances.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'finance';
const PAGE = 'tools/finance.html';
const AUDIENCES = ["family","company"];
const ALLOWED_PREFIXES = ["/api/finance"];
const GATE_FILE = 'tools/finance.html';

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
const start = html.indexOf('<script src="/shared/ui/js/app-view.js"></script>');
const block = (() => { const s = html.indexOf('<script>', start); const e = html.indexOf('</script>', s); return html.slice(s + 8, e); })();

test('the shared kit is loaded right after the theme bootstrap, stylesheet first', () => {
  const bootstrap = html.indexOf('<script src="/shared/ui/js/surface-theme.js"></script>');
  assert.ok(bootstrap >= 0, 'theme bootstrap present');
  const css = html.indexOf('<link rel="stylesheet" href="/shared/ui/css/app-view.css" />');
  assert.ok(css > bootstrap && start > css, 'app-view.css then app-view.js follow the bootstrap');
  assert.equal(html.split('/shared/ui/js/app-view.js').length - 1, 1, 'the kit is included once');
});

test('the page boots the kit with its own application name and exactly the audiences it provides', () => {
  const boot = block.match(/A\.boot\(\{([\s\S]*?)\}\);/);
  assert.ok(boot, 'A.boot({...}) present');
  assert.match(boot[1], new RegExp("app: '" + APP + "'"));
  const declared = boot[1].match(/audiences: \{([^}]*)\}/);
  assert.ok(declared, 'audiences map present');
  const names = declared[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean).sort();
  assert.deepEqual(names, [...AUDIENCES].sort());
  assert.match(boot[1], /escapeLabel: '[^']+'/, 'the escape names the full application');
});

test('the full page start is gated on the kit decision and survives a missing kit', () => {
  const gated = GATE_FILE === PAGE ? html : fs.readFileSync(path.join(ROOT, GATE_FILE), 'utf8');
  assert.match(gated, /if \(!window\.AppView \|\| !AppView\.active\(\)\)/);
});

test('the head block parses and reads only this package\x27s own routes', () => {
  assert.doesNotThrow(() => new Function(block));
  const reads = [...block.matchAll(/fetch\(\s*'([^']+)'/g)].map(m => m[1]).concat([...block.matchAll(/fetch\(\s*(BASE|API)\s*\+/g)].map(() => ALLOWED_PREFIXES[0]));
  assert.ok(reads.length >= 1, 'the block reads through fetch');
  for (const r of reads) assert.ok(ALLOWED_PREFIXES.some(p => r === p || r.startsWith(p + '/')), 'read stays on an allowed prefix: ' + r);
  assert.doesNotMatch(block, /innerHTML\s*=/, 'the block builds no HTML from data');
});


/** Execute the actual audience view callbacks; only their transport and presentation kit are doubled. */
async function audienceModel(audience, aggregate) {
  const vm = require('node:vm'); let boot;
  const kit = { boot(value) { boot = value; }, money: value => value == null ? 'Unknown' : String(value),
    when: () => 'saved date', date: value => value, num: value => String(value) };
  const context = { window: { AppView: kit, location: {} }, fetch: async url => ({ ok: true,
    json: async () => url.endsWith('/status') ? { connected: 1, institutions: ['Example'] }
      : url.endsWith('/payments') ? { payments: [] } : { aggregate, syncedAt: '2026-10-01T00:00:00Z' } }) };
  vm.runInNewContext(block, context);
  return boot.audiences[audience]({ refresh() {} });
}

for (const audience of AUDIENCES) test(`${audience} audience withholds clipped spending and explains unknown coverage`, async () => {
  const model = await audienceModel(audience, { currency: 'USD', netWorth: { net: 100, assets: 100, liabilities: 0 },
    accounts: [], holdings: [], transactionsComplete: false, transactionCoverage: { state: 'partial', returned: 2000, total: 2501, institutions: [{ institution: 'Example', state: 'partial', returned: 2000, total: 2501, pages: 4, reason: 'page_limit' }] },
    topSpending: [{ category: 'Clipped', total: 25000 }], spendByMonth: [{ month: '2026-10', spend: 25000, income: 30000 }] });
  assert.equal(model.stats.find(s => s.id === 'spend').value, 'Unknown');
  if (audience === 'company') assert.equal(model.stats.find(s => s.id === 'income').value, 'Unknown');
  assert.doesNotMatch(JSON.stringify(model), /25000|30000/);
  const section = model.sections.find(s => s.id === (audience === 'family' ? 'spending' : 'months'));
  assert.match(section.empty, /Transaction coverage is partial/);
  assert.match(section.empty, /2,000 of 2,501/);
  assert.match(section.empty, /unavailable/);
  assert.equal(model.stats.find(s => s.id === 'net').value, '100');
});
