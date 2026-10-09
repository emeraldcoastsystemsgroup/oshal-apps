/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Hello OSHAL's page is APP_HTML, a template literal in routes/hello.js, so the page file is that module. The company view is asserted as behaviour over the package's REAL route factory (createHelloRoutes, served in process with the mount path stripped): on open it makes one plain GET of /api/hello-oshal/ping and nothing else; a responding route shows its state, the answer time it reports through AppView.when and whether the factory received the swarm context; unreachable, 401, 403, a failing status, a non-JSON answer and an answer without the hello-oshal identity each read as what they are, never as responding. The 'what this package ships' list is held to the manifest (one surface, which is the first ui.static entry, two route modules, no migrations, bots or schedules). The status script is run with a stub DOM: it reads nothing under a view and still starts with or without the kit. The route serves the source template byte for byte, and the full page's centred layout is scoped so the kit's main root is not boxed.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'hello-oshal';
const PAGE = 'routes/hello.js';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/hello-oshal"];
const GATE_FILE = 'routes/hello.js';

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

const { createHelloRoutes } = require('../routes/hello.js');
const MOUNT = '/api/hello-oshal';
const MESSAGE = 'Hello from an installed OSHAL app package!';

/**
 * @description Serve one GET through the package's REAL route factory the way the loader mounts it: the mount path
 * stripped from the URL, the headers and body collected from the response.
 * @param {string} url Path relative to the mount (/app, /ping?x=1).
 * @param {object} [ctx] The app context handed to the factory.
 * @returns {{ status: number, type: string, body: string|null, handled: boolean }} What the route sent, or handled false when it fell through.
 */
function route(url, ctx) {
  const headers = {};
  let body = null, handled = true;
  const res = { statusCode: 200, setHeader: (k, v) => { headers[String(k).toLowerCase()] = v; }, end: (b) => { body = String(b); } };
  createHelloRoutes(ctx)({ url, method: 'GET' }, res, () => { handled = false; });
  return { status: res.statusCode, type: headers['content-type'] || '', body, handled };
}

/**
 * @description A fetch that answers package URLs from the real route (JSON parsed as the browser would), 404 otherwise.
 * @param {object} [ctx] The app context handed to the factory.
 * @returns {Function} fetch(url) resolving to a minimal Response.
 */
function realFetch(ctx) {
  return (url) => {
    const sent = url.startsWith(MOUNT + '/') ? route(url.slice(MOUNT.length), ctx) : { handled: false };
    const status = sent.handled ? sent.status : 404;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve().then(() => JSON.parse(sent.body)) });
  };
}

/** @description A fetch answering every URL with one status and JSON body; an undefined body is not JSON. @param {number} status @param {*} [body] @returns {Function} */
function answer(status, body) {
  return () => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('Unexpected token <')) : Promise.resolve(body)) });
}

/**
 * @description Run the head block against a stub kit and a recording fetch. The stub A.when tags its input as W(...).
 * @param {Function} fetchImpl The fetch behaviour behind the recorder.
 * @returns {{ config: object, company: Function, calls: Array<{ url: string, opt: object }> }} The boot config, the builder and every fetch.
 */
function loadCompany(fetchImpl) {
  let config = null;
  const calls = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')' };
  new Function('window', 'fetch', block)({ AppView: kit }, (url, opt) => { calls.push({ url, opt: opt || {} }); return fetchImpl(url, opt); });
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { config, company: config.audiences.company, calls };
}

const section = (model, id) => model.sections.find((s) => s && s.id === id);
const statRows = (model) => model.stats.map((s) => [s.id, s.value, s.tone || null, s.hint || null]);

test('on open the view reads the package route once, as a plain GET, and nothing else', async () => {
  const view = loadCompany(realFetch());
  assert.deepEqual(view.calls, [], 'nothing is read before the kit asks for the view');
  await view.company({});
  assert.deepEqual(view.calls.map((c) => c.url), ['/api/hello-oshal/ping']);
  const opt = view.calls[0].opt;
  assert.equal(opt.method, undefined, 'a GET');
  assert.equal(opt.body, undefined, 'no body');
  assert.equal(opt.credentials, 'same-origin');
  assert.equal(view.config.escapeLabel, 'Open Hello OSHAL in the cockpit');
});

test('a responding route: its state, its own answer and what the package ships, from the real route', async () => {
  for (const [ctx, context] of [[{ synthetic: true }, 'Received'], [undefined, 'Not received']]) {
    const model = await loadCompany(realFetch(ctx)).company({});
    assert.equal(model.kicker, 'Engineering · Hello OSHAL');
    assert.equal(model.title, 'The package route is responding');
    assert.match(model.lede, /^The minimal example package: one JSON route and this page\./);
    const rows = statRows(model);
    assert.deepEqual(rows[0], ['route', 'Responding', 'ok', 'HTTP 200']);
    assert.match(rows[1][1], /^W\(\d{4}-\d{2}-\d{2}T[^)]+Z\)$/, 'the answer time the route reports, through AppView.when');
    assert.deepEqual([rows[1][0], rows[1][3]], ['answered', 'The time the route reports']);
    assert.deepEqual(rows[2], ['context', context, null, 'As the route reports it']);
    const table = section(model, 'route');
    assert.deepEqual(table.columns, ['Route', 'Status', 'Package', 'Answer', 'Answered']);
    assert.deepEqual(table.rows[0].slice(0, 4), ['GET /api/hello-oshal/ping', { text: 'HTTP 200', tone: 'ok' }, 'hello-oshal', MESSAGE]);
    assert.equal(table.rows[0][4], rows[1][1]);
    assert.deepEqual(section(model, 'package').items.map((i) => i.title), ['One JSON route', 'One ribbon surface', 'Nothing saved']);
    assert.equal(model.actions, undefined, 'no action but the kit escape');
  }
});

test('every other outcome is named for what it is and never reads as responding', async () => {
  const cases = [
    [() => Promise.reject(new TypeError('Failed to fetch')), 'Unreachable', 'bad', 'No answer', 'The package route could not be reached', 'The request to the package route did not reach the server.'],
    [answer(401, { error: 'not_authenticated' }), 'Refused', 'warn', 'HTTP 401', 'Sign in to check the package route', 'The package route refused this session (HTTP 401).'],
    [answer(403, { error: 'forbidden' }), 'Refused', 'warn', 'HTTP 403', 'This account cannot open the package route', 'The package route refused this account (HTTP 403).'],
    [answer(500, { error: 'synthetic failure' }), 'Failing', 'bad', 'HTTP 500', 'The package route is failing', 'The package route answered HTTP 500.'],
    [answer(404), 'Failing', 'bad', 'HTTP 404', 'The package route is failing', 'The package route answered HTTP 404.'],
    [answer(200), 'Unexpected answer', 'warn', 'HTTP 200', 'The package route answered unexpectedly', 'The package route answered HTTP 200, but not with JSON.'],
    [answer(200, { ok: true, app: 'synthetic-other' }), 'Unexpected answer', 'warn', 'HTTP 200', 'The package route answered unexpectedly', 'The answer does not carry the hello-oshal identity.'],
    [answer(200, { ok: false, app: 'hello-oshal', message: MESSAGE }), 'Unexpected answer', 'warn', 'HTTP 200', 'The package route answered unexpectedly', 'The answer does not carry the hello-oshal identity.'],
  ];
  for (const [fetchImpl, value, tone, hint, title, lede] of cases) {
    const model = await loadCompany(fetchImpl).company({});
    assert.deepEqual([model.title, model.lede], [title, lede]);
    assert.deepEqual(statRows(model), [['route', value, tone, hint], ['answered', '—', null, null], ['context', '—', null, null]]);
    assert.deepEqual(section(model, 'route').rows, [['GET /api/hello-oshal/ping', { text: hint, tone }, '—', lede, '—']]);
    assert.ok(section(model, 'package'), 'what the package is still shows');
  }
});

test('the package list stays true to the manifest and the view sits on its first surface', () => {
  const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
  const surfaces = [...manifest.slice(manifest.indexOf('\nui:')).matchAll(/iframeUrl: (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(surfaces, ['/api/hello-oshal/app'], 'one ribbon surface, the page the shells open');
  assert.doesNotMatch(manifest, /^(migrations|bots|agents|schedules):/m, 'no migrations, packaged bot or background work');
  assert.deepEqual([...manifest.matchAll(/^\s+- module: (\S+)/gm)].map((m) => m[1]), ['routes/package-smoke.js', 'routes/hello.js']);
  const ping = route('/ping');
  assert.match(ping.type, /application\/json/);
  assert.deepEqual(Object.keys(JSON.parse(ping.body)).sort(), ['app', 'at', 'contextAvailable', 'message', 'ok'], 'the fields the view reads');
});

/**
 * @description Run the page's status script (its last inline script) with a stub DOM and a recording fetch.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @param {boolean} withKit Whether the kit loaded at all (an older core serves none).
 * @returns {{ fetches: string[], status: object, settled: Promise<void> }} What it read, the status node, a tick to await.
 */
function runStatusScript(activeView, withKit) {
  const src = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const fetches = [], status = { className: 'status', lastElementChild: { textContent: '' } };
  const kit = withKit ? { active: () => activeView } : undefined;
  const documentStub = { getElementById: (id) => (id === 'status' ? status : null) };
  new Function('window', 'AppView', 'document', 'fetch', src)({ AppView: kit }, kit, documentStub,
    (url) => { fetches.push(url); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ message: 'Synthetic hello' }) }); });
  return { fetches, status, settled: new Promise((done) => setImmediate(done)) };
}

test('the status script runs only when no view renders, and the full page still starts', async () => {
  assert.deepEqual(runStatusScript('company', true).fetches, [], 'under the view the page does not read the route again');
  for (const withKit of [true, false]) {
    const full = runStatusScript(null, withKit);
    assert.deepEqual(full.fetches, ['/api/hello-oshal/ping']);
    await full.settled;
    assert.deepEqual([full.status.className, full.status.lastElementChild.textContent], ['status ok', 'Synthetic hello']);
  }
});

test('the route serves this source template byte for byte, and the full-page layout leaves the kit root alone', () => {
  const s = html.indexOf('const APP_HTML = `') + 'const APP_HTML = `'.length, e = html.lastIndexOf('`;');
  const template = html.slice(s, e);
  assert.doesNotMatch(template, /`|\$\{|\\/, 'no backtick, dollar-brace or backslash: the served bytes are the source bytes');
  for (const url of ['/app', '/app?audience=company']) {
    const served = route(url);
    assert.match(served.type, /text\/html/);
    assert.equal(served.body, template, url + ' serves the template');
  }
  assert.ok(template.includes(block), 'the served page carries the audience block');
  assert.match(template, /html:not\(\[data-audience\]\) body \{[^}]*display: grid/, 'the centred grid is the full page only');
  assert.doesNotMatch(template, /^\s*main\s*\{/m, 'no bare main rule: the kit root is a main element');
  assert.match(template, /<main class="hello">/);
});
