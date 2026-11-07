/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit batch 7 (switchboard--switchboard-stage): verify Stage merges into
 *   Compose (Same text everywhere switch + confirmed Send to all chosen networks fan-out), switchboard-stage tile resolves to
 *   /api/switchboard/compose while preserving business-experience surface references, and Stage disables Tailor per channel and
 *   Use as-is with a visible reason and Connect accounts empty state when no channel is connected.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit batch 7 (switchboard--switchboard-inbox, switchboard--switchboard-threads,
 *   switchboard--switchboard-today): verify Inbox withholds CHANNELS and WORKSPACES when unconnected, folds Threads into ?group=person,
 *   unifies Today and Inbox empty-state channel legends, hides Today in-page nav when framed while keeping All apps first standalone,
 *   names #refreshBtn, greets by local hour, and removes raw /utilities paths from Today and Threads route messages.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const STORE_ROOT = path.resolve(ROOT, '..');
const TOOLS = path.join(ROOT, 'tools');
const MANIFEST = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
const STAGE_HTML = fs.readFileSync(path.join(TOOLS, 'switchboard-stage.html'), 'utf8');
const COMPOSE_HTML = fs.readFileSync(path.join(TOOLS, 'switchboard-compose.html'), 'utf8');
const INBOX_HTML = fs.readFileSync(path.join(TOOLS, 'switchboard-inbox.html'), 'utf8');
const THREADS_HTML = fs.readFileSync(path.join(TOOLS, 'switchboard-threads.html'), 'utf8');
const TODAY_HTML = fs.readFileSync(path.join(TOOLS, 'switchboard-today.html'), 'utf8');
const TODAY_ROUTES = fs.readFileSync(path.join(ROOT, 'routes', 'switchboard-routes.js'), 'utf8');
const THREADS_ROUTES = fs.readFileSync(path.join(ROOT, 'routes', 'switchboard-threads-routes.js'), 'utf8');

function extractClassicScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\ssrc=)(?![^>]*\stype=["']module["'])[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]);
}

function makeEl(id) {
  const listeners = {};
  const attrs = {};
  const children = [];
  const classes = new Set();
  return {
    id,
    type: '',
    value: '',
    innerHTML: '',
    textContent: '',
    title: '',
    hidden: false,
    disabled: false,
    dataset: {},
    style: {},
    children,
    classList: {
      add: (...xs) => xs.forEach((x) => classes.add(x)),
      remove: (...xs) => xs.forEach((x) => classes.delete(x)),
      toggle: (x, force) => {
        const on = force === undefined ? !classes.has(x) : !!force;
        if (on) classes.add(x); else classes.delete(x);
        return on;
      },
      contains: (x) => classes.has(x),
    },
    set className(v) {
      classes.clear();
      String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
    get className() { return [...classes].join(' '); },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    appendChild(c) { children.push(c); return c; },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    trigger(ev) { (listeners[ev] || []).forEach((fn) => fn({ target: this })); },
    focus() { this._focused = true; },
  };
}

function makeDoc(nodes, docListeners) {
  const getNode = (id) => {
    if (!nodes[id]) nodes[id] = makeEl(id);
    return nodes[id];
  };
  return {
    documentElement: makeEl('html'),
    getElementById: getNode,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(ev, fn) { docListeners[ev] = fn; },
    createElement(tag) {
      const el = makeEl(tag);
      if (tag === 'div') {
        let raw = '';
        Object.defineProperty(el, 'textContent', { get: () => raw, set: (v) => { raw = String(v); } });
        Object.defineProperty(el, 'innerHTML', {
          get: () => raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
          set: (v) => { raw = String(v); },
        });
      }
      return el;
    },
  };
}

function bootStage({ pathname = '/api/switchboard/stage', search = '?stay=1', targets = [] } = {}) {
  const nodes = {};
  const docListeners = {};
  const doc = makeDoc(nodes, docListeners);
  doc.getElementById('emptyState').hidden = true;
  doc.getElementById('tailorBtn').disabled = true;
  doc.getElementById('asisBtn').disabled = true;
  let replacedTo = null;
  const sandbox = {
    window: null,
    location: { pathname, search, hash: '', replace(url) { replacedTo = url; } },
    localStorage: { getItem: () => '', setItem() {} },
    document: doc,
    fetch(url) {
      if (url.includes('/workspaces')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ workspaces: [] }) });
      if (url.includes('/compose/targets')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ targets }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    },
    Promise, setTimeout, clearTimeout, URLSearchParams, console: { log() {}, error() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractClassicScripts(STAGE_HTML).join('\n'), sandbox, { filename: 'switchboard-stage.html' });
  return { nodes, getReplacedTo: () => replacedTo };
}

function bootPage(html, { pathname, search = '', framed = false, answers = {} }) {
  const nodes = {};
  const docListeners = {};
  const calls = [];
  const doc = makeDoc(nodes, docListeners);
  let replacedTo = null;
  const sandbox = {
    window: null,
    location: { pathname, search, hash: '', replace(url) { replacedTo = url; } },
    history: { replaceState(_s, _t, url) { sandbox.location.replacedState = url; } },
    localStorage: { getItem: () => '', setItem() {} },
    document: doc,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    fetch(url) {
      calls.push(String(url));
      const hit = Object.keys(answers).find((k) => String(url).includes(k));
      const body = hit ? answers[hit] : {};
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    },
    Promise, setTimeout, clearTimeout, Date, URLSearchParams, console: { log() {}, error() {} },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = framed ? {} : sandbox;
  vm.createContext(sandbox);
  const scripts = extractClassicScripts(html);
  vm.runInContext(scripts[scripts.length - 1], sandbox, { filename: path.basename(pathname) });
  return { nodes, calls, docListeners, getReplacedTo: () => replacedTo };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test('stage merge: manifest points switchboard-stage to /api/switchboard/compose and /api/switchboard/stage navigates there', async () => {
  assert.match(MANIFEST, /- toolName: switchboard-stage\s+label: Stage\s+icon: codicon codicon-megaphone\s+iframeUrl: \/api\/switchboard\/compose/);
  const nav = bootStage({ pathname: '/api/switchboard/stage', search: '' });
  assert.equal(nav.getReplacedTo(), '/api/switchboard/compose');

  assert.match(COMPOSE_HTML, /id="sameTextSwitch"[^>]*role="switch"[^>]*aria-checked="false"/);
  assert.match(COMPOSE_HTML, /Same text everywhere/);
  assert.match(COMPOSE_HTML, /id="broadcastBtn"[^>]*>[\s\S]*?Send to all chosen networks<\/button>/);
  assert.match(COMPOSE_HTML, /fetch\("\/api\/switchboard\/stage\/broadcast"/);
});

test('stage broken-button guard: with no connected channel both buttons are solid-disabled with a visible reason and empty state', async () => {
  const s = bootStage({
    targets: [{ platform: 'x', label: 'X', limit: 280, publishable: true, connected: false, inWorkspace: true }],
  });
  await settle(); await settle();

  assert.equal(s.nodes.tailorBtn.disabled, true);
  assert.equal(s.nodes.asisBtn.disabled, true);
  assert.equal(s.nodes.stageHint.textContent, 'Connect an account to broadcast');
  assert.equal(s.nodes.plats.children.length, 0, 'unconnected channel X is withheld');
  assert.equal(s.nodes.emptyState.hidden, false, 'Connect accounts empty state is shown');
  assert.equal(s.nodes.broadcastPanel.hidden, true);
  assert.doesNotMatch(STAGE_HTML, /· not connected/);
  assert.doesNotMatch(STAGE_HTML, /opacity:\.5/);
  assert.match(STAGE_HTML, /--accent-grad: var\(--ds-accent, var\(--accent\)\);/);
});

test('stage broken-button guard: connected channel with empty message keeps both buttons disabled with Write your message reason', async () => {
  const s = bootStage({
    targets: [{ platform: 'x', label: 'X', limit: 280, publishable: true, connected: true, inWorkspace: true }],
  });
  await settle(); await settle();

  assert.equal(s.nodes.plats.children.length, 1);
  assert.equal(s.nodes.tailorBtn.disabled, true);
  assert.equal(s.nodes.asisBtn.disabled, true);
  assert.equal(s.nodes.stageHint.textContent, 'Write your message');

  s.nodes.src.value = 'Hello across channels';
  s.nodes.src.trigger('input');
  assert.equal(s.nodes.tailorBtn.disabled, false);
  assert.equal(s.nodes.asisBtn.disabled, false);
  assert.equal(s.nodes.stageHint.textContent, '');
});

test('inbox layout: withholds CHANNELS and WORKSPACES when unconnected, names #refreshBtn, and shares Today connector legend', async () => {
  assert.match(INBOX_HTML, /id="refreshBtn"[^>]*aria-label="Refresh"/);
  assert.doesNotMatch(INBOX_HTML, /\.hero \.accts \.a\b/, 'provider pills replaced by plain dot-and-word legend');
  assert.match(INBOX_HTML, /--accent-grad: var\(--ds-accent, var\(--accent\)\);/);

  const unconn = bootPage(INBOX_HTML, {
    pathname: '/api/switchboard/inbox',
    answers: { '/inbox/items': { connected: false }, '/accounts': { accounts: [] }, '/workspaces': { workspaces: [] } },
  });
  await settle(); await settle();
  assert.equal(unconn.nodes.filterRail.hidden, true, 'CHANNELS and WORKSPACES rail withheld when no account is connected');
  assert.equal(unconn.nodes.groupBar.hidden, true);
  assert.equal(unconn.nodes.inboxShell.classList.contains('unconnected'), true);
  for (const label of ['Gmail', 'Outlook', 'Slack', 'LinkedIn', 'X', 'Facebook']) {
    assert.match(unconn.nodes.content.innerHTML, new RegExp(label), `Inbox legend names ${label}`);
  }
});

test('threads merge: ?group=person opens person grouping in Inbox, /threads redirects, and business-experience resolves its surface', async () => {
  assert.match(MANIFEST, /- toolName: switchboard-threads\s+label: Threads\s+icon: codicon codicon-comment-discussion\s+iframeUrl: \/api\/switchboard\/inbox\?group=person/);
  const bizManifestPath = path.join(STORE_ROOT, 'business-experience', 'oshal-app.yaml');
  if (fs.existsSync(bizManifestPath)) {
    const biz = fs.readFileSync(bizManifestPath, 'utf8');
    if (biz.includes('surface: switchboard-threads')) {
      assert.match(MANIFEST, /toolName: switchboard-threads/, 'business-experience surface switchboard-threads remains declared');
    }
  }
  assert.doesNotMatch(THREADS_ROUTES, /\/utilities/, 'threads route never prints raw /utilities path');
  assert.match(THREADS_ROUTES, /Connect an account to see one thread per person\./);

  const redir = bootPage(THREADS_HTML, { pathname: '/api/switchboard/threads', search: '?workspace=w1' });
  assert.equal(redir.getReplacedTo(), '/api/switchboard/inbox?workspace=w1&group=person');

  const grouped = bootPage(INBOX_HTML, {
    pathname: '/api/switchboard/inbox',
    search: '?group=person',
    answers: {
      '/threads/items': {
        connected: true,
        threads: [{ key: 'addr:sam@acme.com', person: 'Sam Rivera', address: 'sam@acme.com', channels: ['gmail'], count: 1, lastTs: new Date().toISOString(), items: [{ id: 'm1', source: 'gmail', kind: 'mail', subject: 'Hello', snippet: 'Checking in', ts: new Date().toISOString() }] }],
      },
      '/accounts': { accounts: [{ provider: 'google' }] },
      '/workspaces': { workspaces: [] },
    },
  });
  await settle(); await settle();
  assert.equal(grouped.nodes.groupPersonBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(grouped.nodes.groupMessagesBtn.getAttribute('aria-pressed'), 'false');
  assert.ok(grouped.calls.some((u) => u.includes('/api/switchboard/threads/items?surface=1')), 'By person calls /api/switchboard/threads/items');
  assert.equal(grouped.nodes.filterRail.hidden, false);
  assert.equal(grouped.nodes.channelsSection.hidden, true, 'Channel filter applies to Messages while Workspaces stays for By person');
  assert.match(grouped.nodes.content.innerHTML, /Sam Rivera/);
});

test('today layout: hides in-page nav when framed, puts All apps first standalone, single named refresh, unified legend, local-hour greeting, no /utilities path', async () => {
  assert.doesNotMatch(TODAY_HTML, /id="topRefreshBtn"/, 'duplicate topRefreshBtn removed');
  assert.match(TODAY_HTML, /id="refreshBtn"[^>]*aria-label="Refresh"/);
  assert.match(TODAY_HTML, /<a class="sb-navlink" id="cockpitBack" href="\/cockpit\/">All apps<\/a>/);
  assert.doesNotMatch(TODAY_HTML, /\.hero \.accts \.a\b/, 'provider pills replaced by plain legend');
  assert.match(TODAY_HTML, /--accent-grad: var\(--ds-accent, var\(--accent\)\);/);
  assert.doesNotMatch(TODAY_ROUTES, /\/utilities/, 'today feed route never prints raw /utilities path');

  const framed = bootPage(TODAY_HTML, {
    pathname: '/api/switchboard/today',
    framed: true,
    answers: { '/feed': { connected: false } },
  });
  await settle(); await settle();
  assert.equal(framed.nodes.sbTopnav.hidden, true, 'framed cockpit view hides in-page nav');
  assert.match(framed.nodes.greet.textContent, /^Good (morning|afternoon|evening)\.$/);
  for (const label of ['Gmail', 'Outlook', 'Slack', 'LinkedIn', 'X', 'Facebook']) {
    assert.match(framed.nodes.content.innerHTML, new RegExp(label), `Today legend names ${label}`);
  }
  assert.doesNotMatch(framed.nodes.content.innerHTML, />Text</);

  const standalone = bootPage(TODAY_HTML, {
    pathname: '/api/switchboard/today',
    framed: false,
    answers: { '/feed': { connected: false } },
  });
  await settle(); await settle();
  assert.equal(standalone.nodes.sbTopnav.hidden, false, 'standalone tab keeps navigation bar');
});
