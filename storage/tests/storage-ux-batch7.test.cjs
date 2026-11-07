/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-06 regression guard for storage--storage-assistant (MERGE) and storage--storage-settings (FIX-LAYOUT): chatBot is storage-assistant, ribbon.defaultView is storage-files, storage-assistant leaves ui.static with zero cross-store experience surface references, assistant chips are <button> controls with one greeting and Graphite-safe on-accent ink, unconnected backends are disabled <option> elements with a Connections link beneath the select, changing a select sends PUT /api/storage/prefs immediately and displays Saved (or role="alert" on failure), and local usage / 250 MB limit sits in the help text with lowercase oshal copy.
 * -----------------------------------------------------------------------------
 * @module storage-ux-batch7.test
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const PKG = path.resolve(__dirname, '..');
const STORE = path.resolve(PKG, '..');

function extractLastScript(html) {
  const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  return matches[matches.length - 1][1];
}

function makeEl(id = '') {
  const listeners = {};
  const attrs = {};
  return {
    id,
    value: '',
    innerHTML: '',
    textContent: '',
    className: '',
    hidden: false,
    disabled: false,
    style: {},
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return attrs[k]; },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    focus() {},
    async trigger(ev) {
      for (const fn of listeners[ev] || []) await fn({ key: '' });
    },
  };
}

function mountSettingsDom(fetchImpl, appViewActive = null) {
  const html = fs.readFileSync(path.join(PKG, 'tools', 'storage-settings.html'), 'utf8');
  const script = extractLastScript(html);
  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  };
  getEl('result').hidden = true;
  const ctx = {
    window: appViewActive ? { AppView: { active: () => appViewActive } } : {},
    AppView: appViewActive ? { active: () => appViewActive } : undefined,
    document: { getElementById: getEl },
    fetch: fetchImpl,
    Promise,
  };
  vm.runInNewContext(script, ctx);
  return { els, getEl };
}

test('storage--storage-assistant: manifest sets chatBot and defaultView, removes tile safely, and assistant UI uses buttons and on-accent ink', () => {
  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /^chatBot:\s*storage-assistant$/m);
  assert.match(manifest, /ribbon:[\s\S]*?defaultView:\s*storage-files/);
  assert.doesNotMatch(manifest, /^\s*-\s*toolName:\s*storage-assistant$/m);
  assert.match(manifest, /^\s*-\s*toolName:\s*storage-settings$/m);
  assert.match(manifest, /^\s*-\s*toolName:\s*storage-files$/m);

  for (const entry of fs.readdirSync(STORE, { withFileTypes: true })) {
    const mPath = path.join(STORE, entry.name, 'oshal-app.yaml');
    if (!entry.isDirectory() || entry.name === 'storage' || !fs.existsSync(mPath)) continue;
    const peer = fs.readFileSync(mPath, 'utf8');
    assert.doesNotMatch(peer, /surface:\s*storage-assistant\b/, `${entry.name} must not require storage-assistant tile`);
  }

  const assistant = fs.readFileSync(path.join(PKG, 'tools', 'storage-assistant.html'), 'utf8');
  const chipButtons = [...assistant.matchAll(/<button[^>]*class="chip"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
  assert.deepEqual(chipButtons, [
    'Where do my files save?',
    'List my files',
    'Save my files to Dropbox',
    'Make a GitHub repo',
  ]);
  assert.equal((assistant.match(/add\('bot',\s*"Hi —/g) || []).length, 1, 'exactly one greeting');
  assert.match(assistant, /href="\/api\/files"/, 'assistant links to /api/files');
  assert.match(assistant, /\.msg\.user\s*\{[^}]*color:var\(--on-accent\)/);
  assert.match(assistant, /\.bar button\s*\{[^}]*color:var\(--on-accent\)/);
});

test('storage--storage-settings: static structure removes Save bar and opacity:.5, uses lowercase oshal, and gates on AppView', () => {
  const html = fs.readFileSync(path.join(PKG, 'tools', 'storage-settings.html'), 'utf8');
  assert.doesNotMatch(html, /id="saveBtn"/, 'Save bar button removed');
  assert.doesNotMatch(html, /opacity\s*:\s*\.5/, 'no opacity:.5 disabled styling');
  assert.match(html, /\.btn:disabled\s*\{[^}]*opacity:1/);
  assert.match(html, /\.btn\.primary\s*\{[^}]*color:var\(--on-accent\)/);
  assert.match(html, /<title>Storage Settings — oshal<\/title>/);
  assert.match(html, /Choose where oshal saves what it generates/);
  assert.match(html, /href="\/api\/files"/);
  assert.doesNotMatch(html, /OSHAL/, 'copy uses lowercase oshal');
  assert.match(html, /if \(!window\.AppView \|\| !AppView\.active\(\)\) load\(\);/);
});

test('storage--storage-settings: unconnected options are disabled, local usage renders in help, and changing a select sends PUT /api/storage/prefs', async () => {
  const calls = [];
  let failSave = false;
  const fetchStub = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ method, url, body: opts.body ? JSON.parse(opts.body) : null });
    if (method === 'GET' && url === '/api/storage/prefs') {
      return { ok: true, status: 200, json: async () => ({ connected: ['github'], prefs: { code: { provider: 'oshal-local' }, files: { provider: 'oshal-local' } } }) };
    }
    if (method === 'GET' && url === '/api/storage/local/list') {
      return { ok: true, status: 200, json: async () => ({ files: [{ name: 'a.pdf', size: 12582912 }], usage: { used: '12.0 MB of 250.0 MB' } }) };
    }
    if (method === 'GET' && url === '/api/storage/github/repos') {
      return { ok: true, status: 200, json: async () => ({ repos: [{ name: 'demo', fullName: 'org/demo', private: true }] }) };
    }
    if (method === 'PUT' && url === '/api/storage/prefs') {
      if (failSave) return { ok: false, status: 500, json: async () => ({ error: 'database offline' }) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    throw new Error('Unexpected fetch: ' + method + ' ' + url);
  };

  const { getEl } = mountSettingsDom(fetchStub);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const bodyHtml = getEl('body').innerHTML;
  assert.match(bodyHtml, /<option value="oshal-local" selected>oshal \(local\)<\/option>/);
  assert.doesNotMatch(bodyHtml, /<option[^>]*250 MB/, '250 MB limit is not inside option labels');
  assert.match(bodyHtml, /<option value="dropbox" disabled>Dropbox \(not connected\)<\/option>/);
  assert.match(bodyHtml, /<option value="github">GitHub<\/option>/);
  assert.match(bodyHtml, /Connect Dropbox or GitHub in <a href="\/utilities" target="_top">Connections<\/a>\./);
  assert.match(bodyHtml, /Local storage: 12 MB of 250 MB used\./);

  // Sync select values with initial defaults, then change code-provider to github.
  getEl('code-provider').value = 'github';
  getEl('files-provider').value = 'oshal-local';
  await getEl('code-provider').trigger('change');

  const putCalls = calls.filter((c) => c.method === 'PUT' && c.url === '/api/storage/prefs');
  assert.equal(putCalls.length, 1, 'changing select immediately sends PUT /api/storage/prefs');
  assert.equal(putCalls[0].body.code.provider, 'github');
  assert.equal(putCalls[0].body.files.provider, 'oshal-local');
  assert.equal(getEl('code-saved').textContent, 'Saved');
  assert.equal(getEl('result').hidden, true);

  // Failed save surfaces role="alert" with the reason.
  failSave = true;
  await getEl('files-provider').trigger('change');
  assert.equal(getEl('result').hidden, false);
  assert.equal(getEl('result').getAttribute('role'), 'alert');
  assert.match(getEl('result').textContent, /Save failed: database offline/);
});
