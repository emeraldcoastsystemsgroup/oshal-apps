/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (switchboard--switchboard-workspaces, FIX-BROKEN): with no connected account
 *   the page was one gate whose only button, "+ Connect accounts", loaded the kernel Connections page INSIDE Switchboard's
 *   frame (a second cockpit header), and New workspace never showed although POST /workspaces takes a name and colour only.
 *   The page's own script, run in a sandbox with no accounts and no workspaces: New workspace and a Personal desk are
 *   offered, Create Personal posts {name:"Personal"}, and every Connections link in every Switchboard surface opens at the
 *   top level. The primary's ink is the theme's on-accent token, with no border.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TOOLS = path.resolve(__dirname, '..', 'tools');
const HTML = fs.readFileSync(path.join(TOOLS, 'switchboard-workspaces.html'), 'utf8');
const inline = () => [...HTML.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

/** The page in a sandbox: GET answers come from `answers`, every request is recorded. */
function page(answers) {
  const nodes = {}; const listeners = {}; const calls = [];
  const node = (id) => (nodes[id] = nodes[id] || { id, innerHTML: '', value: '', textContent: '', classList: { add() {}, remove() {} }, focus() {} });
  const sandbox = {
    document: {
      getElementById: node, createElement: () => ({ set textContent(v) { this.t = String(v); }, get innerHTML() { return this.t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } }),
      addEventListener(type, fn) { listeners[type] = fn; },
    },
    fetch: (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
      const key = (init.method || 'GET') + ' ' + url;
      const body = answers[key] || answers[url] || {};
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    },
    confirm: () => true, setTimeout, clearTimeout, Set, Promise, console: { log() {}, error() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(inline(), sandbox, { filename: 'switchboard-workspaces.html' });
  return { nodes, listeners, calls };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('with no accounts and no workspaces the page offers New workspace and a Personal desk, not a gate', async () => {
  const p = page({ '/api/switchboard/accounts': { accounts: [] }, '/api/switchboard/workspaces': { workspaces: [] } });
  await settle(); await settle();
  const html = p.nodes.content.innerHTML;
  assert.match(html, /id="newname"/);
  assert.match(html, /id="createBtn"[^>]*>.*New workspace<\/button>/);
  assert.match(html, /data-name="Personal">Create Personal<\/button>/);
  assert.match(html, /<a href="\/utilities" target="_top">Connect accounts<\/a>/);
  assert.doesNotMatch(html, /Connect accounts first/);
});

test('Create Personal posts a workspace with no accounts', async () => {
  const p = page({ '/api/switchboard/accounts': { accounts: [] }, '/api/switchboard/workspaces': { workspaces: [] },
    'POST /api/switchboard/workspaces': { workspace: { workspaceId: 'w-1', name: 'Personal', color: 'brass', accounts: [] } } });
  await settle(); await settle();
  const target = { id: '', closest: (sel) => (sel === '.sugbtn' ? { getAttribute: (n) => (n === 'data-name' ? 'Personal' : null), hasAttribute: (n) => n === 'data-name', textContent: 'Create Personal' } : null) };
  p.listeners.click({ target });
  await settle(); await settle();
  const post = p.calls.find((c) => c.method === 'POST');
  assert.ok(post, 'a workspace was created');
  assert.equal(post.url, '/api/switchboard/workspaces');
  assert.equal(post.body.name, 'Personal');
  assert.match(p.nodes.content.innerHTML, /value="Personal"/, 'the new desk is drawn');
  assert.match(p.nodes.content.innerHTML, /No accounts connected yet/);
});

test('no Switchboard surface loads the Connections page inside its own frame', () => {
  for (const file of fs.readdirSync(TOOLS).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(TOOLS, file), 'utf8');
    for (const m of html.matchAll(/<a\b[^>]*href=["']\/utilities[^"']*["'][^>]*>/g)) {
      assert.match(m[0], /target=["']_top["']/, `${file}: ${m[0]}`);
    }
  }
  assert.ok(HTML.includes('<a href="\'+CONNECT_HREF+\'" target="_top">Connect accounts</a>'), 'the drawn Connect accounts link opens at the top level');
});

test('the primary button wears the theme on-accent ink and no border', () => {
  assert.match(HTML, /\.btn\.pri\{ background:var\(--accent\);border:0;color:var\(--ds-on-accent,var\(--text-on-accent,#fff\)\); \}/);
});
