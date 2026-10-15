/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The administrator saw the raw refusal JSON ({"status":403,"error":"dev_workspace_unavailable","reason":"dev_console_disabled"}) and "super-admin: false". GET /dev-mode now names the failing check and the operator settings that open each gate (the native names when the kernel's super-admin module says how a package setting is carried), and the surface EXECUTED here renders every state and refusal as a sentence.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The page's inputs are bounded by the screen width (the 48-character query field overflowed a 412px phone).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The page paints its own background and text from the shared theme tokens (it set none, so black text sat on the dark shell).
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: Enter in the Query field runs the search, as the Search button does (it did nothing).
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const vm = require('node:vm');

const ROUTES = require.resolve('../routes/dev-workspace.js');
const actor = { sub: 'admin', issuer: 'https://identity.example.test', isActive: true };
const SILENT = { debug() {}, info() {}, warn() {}, error() {} };

/** Load the route with `superadmin` served as '@/shared/middleware/superadmin', the way the kernel bridge does. */
function routesWith(superadmin) {
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === '@/shared/middleware/superadmin') return superadmin;
    return original.call(this, request, ...rest);
  };
  try {
    delete require.cache[ROUTES];
    const { createDevWorkspaceIndexRoutes } = require(ROUTES);
    return createDevWorkspaceIndexRoutes({ authorization: { currentActor: () => actor }, devWorkspaceLogger: SILENT });
  } finally { Module._load = original; }
}

function get(handler, url) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; },
    type() { return this; }, send(body) { this.body = body; return this; } };
  handler({ method: 'GET', url, protocol: 'http', get: () => undefined }, res, () => { res.statusCode = 404; });
  return res;
}

const NATIVE = { DEV_CONSOLE_SETTING: 'DEV_CONSOLE_ENABLED', superAdminEnabled: () => false, isSuperAdminSub: (sub) => sub === 'admin',
  operatorSetting: (pkg, name) => `OSHAL_PACKAGE_ENV_${pkg.toUpperCase().replace(/-/g, '_')}__${name}` };

test('GET /dev-mode names the failing check and the native operator settings', () => {
  const body = get(routesWith(NATIVE), '/dev-mode').body;
  assert.equal(body.superAdmin, true, 'the verified administrator is the super-admin');
  assert.equal(body.devConsoleEnabled, false);
  assert.equal(body.reason, 'dev_console_disabled');
  assert.deepEqual(body.settings, { devConsole: 'OSHAL_PACKAGE_ENV_DEV_WORKSPACE_INDEX__DEV_CONSOLE_ENABLED',
    package: 'OSHAL_PACKAGE_ENV_DEV_WORKSPACE_INDEX__DEV_WORKSPACE_INDEX_ENABLED' });
});

/** Run the served page's script against a fetch that answers `answer` and return the state line. */
async function pageState(html, answer) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const elements = new Map();
  const el = (id) => { if (!elements.has(id)) elements.set(id, { textContent: '', value: '' }); return elements.get(id); };
  const sandbox = { document: { getElementById: el }, encodeURIComponent, Date,
    fetch: async () => ({ status: answer[0], json: async () => answer[1] }) };
  vm.createContext(sandbox);
  new vm.Script(script).runInContext(sandbox);
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return el('state').textContent;
}

test('the page explains a closed console in words, naming the setting, and never prints the JSON', async () => {
  const handler = routesWith(NATIVE);
  const html = get(handler, '/app').body;
  const state = await pageState(html, [200, get(handler, '/dev-mode').body]);
  assert.match(state, /The developer console is off on this installation/);
  assert.match(state, /OSHAL_PACKAGE_ENV_DEV_WORKSPACE_INDEX__DEV_CONSOLE_ENABLED=true/);
  assert.match(state, /Administrator: yes/);
  assert.doesNotMatch(state, /[{}"]|dev_console_disabled/);
});

test('a refused status read is a sentence too', async () => {
  const html = get(routesWith(NATIVE), '/app').body;
  const state = await pageState(html, [401, { error: 'signed_in_owner_required' }]);
  assert.equal(state, 'Sign in to use the developer console.');
});

test('the page bounds its inputs by the screen width', () => {
  const html = get(routesWith(NATIVE), '/app').body;
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  assert.match(style, /fieldset\{min-width:0\}input\{max-width:100%;box-sizing:border-box\}/, "a fieldset grows to its widest input unless its min-width is 0");
});

test('the page paints its own background and text from the framework theme', () => {
  const html = get(routesWith(NATIVE), '/app').body;
  assert.match(html, /<html lang="en" data-theme="midnight">/, 'theme files scope to [data-theme]; without a default the page gets no tokens');
  assert.match(html, /href="\/shared\/ui\/css\/surface-themes\.css"/);
  assert.match(html, /src="\/shared\/ui\/js\/surface-theme\.js"/);
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const body = /html,body\{([^}]*)\}/.exec(style);
  assert.ok(body, 'the document sets its own background and color: a transparent frame shows the dark shell behind black text');
  assert.match(body[1], /background:var\(--dw-bg\)/);
  assert.match(body[1], /color:var\(--dw-text\)/);
  assert.match(style, /--dw-bg:var\(--bg-primary,#[0-9a-f]{6}\)/, 'a dark fallback when the theme sheet cannot load');
  assert.match(style, /--dw-text:var\(--text-primary,#[0-9a-f]{6}\)/);
  for (const sel of ['fieldset', 'pre', 'button,input']) {
    const rule = new RegExp(sel.replace(/[,]/g, ',') + '\\{[^}]*(color|background):var\\(--dw-').exec(style);
    assert.ok(rule, `${sel} is themed`);
  }
});

test('Enter in the Query field runs the search the Search button runs (sweep 12)', async () => {
  const html = get(routesWith(NATIVE), '/app').body;
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const elements = new Map();
  const el = (id) => { if (!elements.has(id)) elements.set(id, { textContent: '', value: '' }); return elements.get(id); };
  const urls = [];
  const sandbox = { document: { getElementById: el }, encodeURIComponent, Date,
    fetch: async (url) => { urls.push(url); return { status: 200, json: async () => ({ query: 'ADR-077', results: [] }) }; } };
  vm.createContext(sandbox);
  new vm.Script(script).runInContext(sandbox);
  el('q').value = 'ADR-077';
  let prevented = false;
  assert.equal(typeof el('q').onkeydown, 'function', 'the query field listens for keys');
  el('q').onkeydown({ key: 'a', preventDefault() { prevented = true; } });
  assert.equal(urls.filter((u) => u.includes('/query')).length, 0, 'a letter does not search');
  el('q').onkeydown({ key: 'Enter', preventDefault() { prevented = true; } });
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(prevented);
  assert.deepEqual(urls.filter((u) => u.includes('/query')), ['/api/dev-workspace-index/query?q=ADR-077']);
  assert.match(el('out').textContent, /No document in the index matches "ADR-077"/);
});
