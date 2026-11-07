/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (feeds--feeds-dashboard): before Slack was connected the bar showed a green 'Live' switch and an enabled 'Sync now' that answered 409, the drawer let the header show through, and the page called itself RSS. The guard runs the shipped setStatus(): Live, Sync now and the gear are hidden until Slack is connected and shown once it is; the drawer is opaque with a Done button and saves on change; the page says it reads Slack channels and DMs.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PKG = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(PKG, 'tools', 'feeds.html'), 'utf8');
const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');

function extract(source, name) {
  const start = source.search(new RegExp(`function ${name}\\(`));
  assert.ok(start >= 0, `${name} is not in the surface`);
  let depth = 0;
  for (let i = source.indexOf('{', source.indexOf(')', start)); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} is never closed`);
}

function run() {
  const els = new Map();
  const $ = (id) => { if (!els.has(id)) els.set(id, { id, hidden: true, textContent: '', className: '', style: {}, classList: { add() {}, remove() {} } }); return els.get(id); };
  const sandbox = { $ };
  vm.createContext(sandbox);
  vm.runInContext(extract(html, 'setStatus') + '\n' + extract(html, 'closeDrawer') + '\nglobalThis.setStatus = setStatus;', sandbox);
  return { setStatus: sandbox.setStatus, $ };
}

test('Live, Sync now and the gear are hidden until Slack is connected, then shown', () => {
  for (const id of ['liveToggle', 'syncBtn', 'gearBtn']) assert.match(html, new RegExp(`id="${id}"[^>]* hidden>`), `${id} starts hidden`);
  const p = run();
  p.setStatus(false);
  assert.equal(p.$('statusText').textContent, 'Not connected');
  for (const id of ['liveToggle', 'syncBtn', 'gearBtn']) assert.equal(p.$(id).hidden, true, `${id} hidden when not connected`);
  p.setStatus(true);
  for (const id of ['liveToggle', 'syncBtn', 'gearBtn']) assert.equal(p.$(id).hidden, false, `${id} shown when connected`);
});

test('the settings drawer is opaque, saves on change and closes with Done', () => {
  assert.match(html, /\.drawer \{[^}]*background:linear-gradient\(var\(--panel\), var\(--panel\)\), var\(--bg\)/);
  assert.match(html, /id="closeBtn">Done</);
  assert.doesNotMatch(html, /id="saveBtn"/);
  assert.match(html, /\$\('setInterval'\)\.onchange=saveSettings/);
  assert.match(html, /\$\('setPoll'\)\.onclick=\(\)=>\{ \$\('setPoll'\)\.classList\.toggle\('on'\); saveSettings\(\); \}/);
});

test('the page says what it reads: Slack channels and DMs, with a chat icon, not RSS', () => {
  assert.match(html, /<small>Slack channels and DMs<\/small>/);
  assert.match(manifest, /icon: codicon codicon-comment-discussion/);
  assert.doesNotMatch(manifest, /codicon-rss/);
});
