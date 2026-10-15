/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 7: 'Open Connections' replaced the whole tab with /utilities while the panel said 'Then reload this page'. Runs the page's own recheckControl/recheckProviders/connectPrompt in a VM: every connect link opens a new tab, the page offers a check-again button, and that button re-reads GET /providers and redraws in place (or says the check failed).
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

function page(answer) {
  const calls = []; let renders = 0;
  const btn = { disabled: false, textContent: '' };
  const main = { inserted: [], insertAdjacentHTML(where, h) { this.inserted.push(h); } };
  const ctx = {
    PROVIDER_LABEL: { square: 'Square' }, main, $: (id) => (id === 'recheckBtn' ? btn : null),
    esc: (v) => String(v), api: async (p) => { calls.push(p); if (answer instanceof Error) throw answer; return answer; },
    render: () => { renders += 1; },
  };
  vm.runInNewContext(`let providers = [];\n${['recheckControl', 'recheckProviders', 'connectPrompt'].map(extract).join('\n')}
    this.api2 = { recheckControl, recheckProviders, connectPrompt, get providers() { return providers; } };`, ctx);
  return { ...ctx.api2, calls, btn, main, renders: () => renders, get providers() { return ctx.api2.providers; } };
}

test('a Connect link opens a new tab and the page offers to check again', () => {
  const p = page({ providers: [] });
  const out = p.connectPrompt({ provider: 'square', connected: false });
  assert.match(out, /href="\/api\/connect\/square\/start" target="_blank" rel="noopener"/);
  assert.match(out, /id="recheckBtn"/);
  assert.doesNotMatch(out, /reload this page/);
  assert.doesNotMatch(html, /href="\/utilities" target="_top"/, 'no link replaces the whole tab');
});

test('check again re-reads /providers and redraws in place', async () => {
  const p = page({ providers: [{ provider: 'stripe', connected: true, mode: 'test' }] });
  await p.recheckProviders();
  assert.deepEqual(p.calls, ['/providers']);
  assert.equal(p.renders(), 1);
  assert.equal(p.providers[0].connected, true);
});

test('a failed check says so and leaves the button usable', async () => {
  const p = page(new Error('HTTP 503'));
  await p.recheckProviders();
  assert.equal(p.btn.disabled, false);
  assert.match(p.main.inserted[0], /Could not check the connection: HTTP 503/);
  assert.match(html, /if \(\$\('recheckBtn'\)\) \$\('recheckBtn'\)\.onclick = recheckProviders;/, 'render binds the button');
});
