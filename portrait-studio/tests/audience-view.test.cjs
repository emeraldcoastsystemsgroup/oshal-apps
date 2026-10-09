/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family view asserted as behaviour: the head block runs against a stub kit and a stub fetch, so the tests prove what it reads on open (GET /portraits and /catalog only: never /provider, whose answer runs the image provider's live credential probe, never /permissions, the brand kit, an artifact handle or a write), that the stats are the saved ready, waiting-or-being-made and did-not-finish counts plus the last start, that the title names the gallery's state (on the way, ready to see, at least N when the route's 60-row list is full, no finished portraits, no portraits), that a ready portrait is a tile opening its picture in a new tab, that style names come from the catalog and fall back to the style id, that a data key such as 'constructor' stays a word, and that a 401, a 403, a failed read, a non-JSON answer and an unreachable server each read as what they are. Every inline body script is proved gated: the studio start touches nothing under the view and starts with the kit absent or idle; the two package modules loaded by src only define their globals.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const APP = 'portrait-studio';
const PAGE = 'tools/portrait-studio.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/portrait-studio"];
const GATE_FILE = 'tools/portrait-studio.html';

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

/**
 * @description Run the head block against a stub kit and a stub fetch, so the family view is asserted as the model it
 * paints and the reads it makes. The stub formatter tags its input: W = AppView.when.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead
 * (body undefined = not JSON); `{ offline: true }` rejects as a network failure does.
 * @returns {{ family: Function, urls: string[], opened: string[] }} The builder, every request made, every A.open href.
 */
function loadFamily(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', open: (href) => opened.push(href) };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url];
    if (a && a.offline) return Promise.reject(new TypeError('Failed to fetch'));
    const status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls, opened };
}

const P = '/api/portrait-studio/portraits', C = '/api/portrait-studio/catalog';
const T1 = '2026-09-28T21:30:00.000Z', T2 = '2026-09-28T21:10:00.000Z', T3 = '2026-09-28T18:00:00.000Z', T4 = '2026-09-27T20:00:00.000Z', T5 = '2026-09-26T09:00:00.000Z', T6 = '2026-09-20T12:00:00.000Z';
/** The static style catalog as GET /catalog shapes it (clientCatalog), with synthetic presets. */
const CATALOG = {
  presets: {
    professional: [{ id: 'syn-boardroom', label: 'Synthetic Boardroom', icon: '🏢', blurb: '', group: 'Synthetic' }],
    character: [{ id: 'syn-farmer', label: 'Synthetic Gothic Farmer', icon: '🌾', blurb: '', group: 'Synthetic' }],
    group: [{ id: 'syn-heroes', label: 'Synthetic Hero Team', icon: '🦸', blurb: '', group: 'Synthetic' }],
  },
  groupLimits: { min: 2, max: 6 }, backgrounds: [], attire: [], headwear: [], props: [], finishes: [], framings: [],
};
/** @returns {object} A ps_portraits row as GET /portraits selects it (newest first); `over` replaces fields. */
const row = (id, created, over) => ({ portrait_id: id, title: null, mode: 'professional', style: 'syn-boardroom', status: 'done', error: null, model: 'synthetic-image', cost_usd: '0.040000', created_at: created, updated_at: created, subjects: null, ...over });
const ROWS = [
  row('a1', T1, { mode: 'group', style: 'syn-heroes', status: 'generating', subjects: 4 }),
  row('a2', T2, { mode: 'character', style: 'syn-farmer', status: 'queued' }),
  row('a3', T3, { title: 'Synthetic Office Headshot' }),
  row('a4', T4, { mode: 'character', style: 'syn-farmer' }),
  row('a5', T5, { status: 'failed', error: 'Synthetic provider refused the photo' }),
  row('a6', T6, { style: 'retired-style' }),
];
const OK = { [P]: { portraits: ROWS }, [C]: CATALOG };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const image = (id) => '/api/portrait-studio/portraits/' + id + '/image';

test('on open the family view makes two plain GET reads: never the provider probe, permissions, the brand kit, a handle or a write', async () => {
  const view = loadFamily(OK);
  await view.family({});
  assert.deepEqual([...view.urls].sort(), ['GET ' + C, 'GET ' + P]);
  for (const url of view.urls) assert.doesNotMatch(url, /\/(provider|permissions|home-summary|artifacts|handles|brand-kit|export|email|source|image)\b/, 'no probe, handle, export or image read: ' + url);
  assert.doesNotMatch(block, /method\s*:/, 'the head block never sets a request method');
  assert.deepEqual(view.opened, [], 'nothing opens on its own');
});

test('the stats, title and lede name the gallery in plain words; ready portraits open their picture in a new tab', async () => {
  const view = loadFamily(OK), model = await view.family({});
  assert.deepEqual([model.kicker, model.title, model.lede, model.actions.map((a) => a.label)],
    ['Our portraits', '2 portraits on the way', 'Newest: Synthetic Hero Team, being made now, started W(' + T1 + ').', ['Open Portrait Studio']]);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, ['/cockpit/?app=portrait-studio'], 'the one action opens Portrait Studio in the cockpit');
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null, x.hint || null]), [
    ['ready', 'Ready to see', 3, null, null],
    ['waiting', 'Waiting or being made', 2, null, null],
    ['failed', 'Did not finish', 1, 'warn', null],
    ['newest', 'Last started', 'W(' + T1 + ')', null, null],
  ]);
  const ready = section(model, 'ready');
  assert.deepEqual(ready.items.map((i) => [i.icon, i.title, i.text, i.meta, i.href, i.target]), [
    ['🏢', 'Synthetic Office Headshot', 'Headshot · Synthetic Boardroom', 'started W(' + T3 + ')', image('a3'), '_blank'],
    ['🌾', 'Synthetic Gothic Farmer', 'Character portrait', 'started W(' + T4 + ')', image('a4'), '_blank'],
    ['💼', 'retired-style', 'Headshot', 'started W(' + T6 + ')', image('a6'), '_blank'],
  ], 'a style missing from the catalog keeps its id and the mode icon');
  assert.ok(ready.items.every((i) => !i.onClick), 'a tile only opens the saved picture; nothing is exported, renamed or sent');
  assert.equal(ready.note, 'Tap a portrait to open the picture in a new tab.');
  assert.deepEqual(section(model, 'waiting').items.map((i) => [i.icon, i.title, i.text, i.meta, i.href || null]), [
    ['🦸', 'Synthetic Hero Team', 'Group of 4 · Being made now', 'started W(' + T1 + ')', null],
    ['🌾', 'Synthetic Gothic Farmer', 'Character portrait · Waiting its turn', 'started W(' + T2 + ')', null],
  ], 'a queued portrait is waiting, never called being made');
  const failed = section(model, 'failed');
  assert.deepEqual(failed.items.map((i) => [i.title, i.text, i.tone, i.href || null]), [['Synthetic Boardroom', 'Headshot · Did not finish', 'warn', null]]);
  assert.equal(failed.note, 'Open Portrait Studio to see why and to make a new one.');
});

test('ready, nothing finished, no portraits and a full 60-row list each read as what they are', async () => {
  const one = await loadFamily({ ...OK, [P]: { portraits: [row('b1', T3)] } }).family({});
  assert.deepEqual([one.title, one.sections.filter(Boolean).map((s) => s.id)], ['1 portrait ready to see', ['ready']]);
  const failedOnly = await loadFamily({ ...OK, [P]: { portraits: [row('b2', T4, { status: 'failed' })] } }).family({});
  assert.deepEqual([failedOnly.title, failedOnly.lede, section(failedOnly, 'ready').items, section(failedOnly, 'ready').empty, section(failedOnly, 'ready').note],
    ['No finished portraits yet', 'Newest: Synthetic Boardroom, did not finish, started W(' + T4 + ').', [], 'No finished portraits yet.', null]);
  const none = await loadFamily({ ...OK, [P]: { portraits: [] } }).family({});
  assert.deepEqual([none.title, none.lede, section(none, 'ready').empty, none.sections.filter(Boolean).length],
    ['No portraits yet', 'Open Portrait Studio, take or upload a photo and pick a style. Your portraits show up here.', 'No portraits yet. Finished portraits show up here.', 1]);
  assert.deepEqual(none.stats.map((x) => x.value), [0, 0, 0, '—']);
  const shapeless = await loadFamily({ ...OK, [P]: {} }).family({});
  assert.equal(shapeless.title, 'No portraits yet', 'an answer without a portraits array reads as an empty gallery');
  const many = Array.from({ length: 60 }, (_, i) => row('c' + i, T3));
  const full = await loadFamily({ ...OK, [P]: { portraits: many } }).family({});
  assert.equal(full.title, 'At least 60 portraits ready to see', 'the route lists the newest 60, so the count is a floor');
  assert.deepEqual(full.stats.map((x) => x.hint || null), ['Newest 60 checked', 'Newest 60 checked', 'Newest 60 checked', null]);
  assert.equal(section(full, 'ready').items.length, 12, 'the tiles show the newest twelve');
});

test('without the style catalog a portrait keeps its style id; a data key stays a word', async () => {
  for (const broken of [{ http: 500, body: { error: 'synthetic' } }, { http: 200, body: undefined }, { offline: true }]) {
    const model = await loadFamily({ ...OK, [C]: broken }).family({});
    const ready = section(model, 'ready');
    assert.deepEqual(ready.items.slice(0, 2).map((i) => [i.icon, i.title, i.text]), [['💼', 'Synthetic Office Headshot', 'Headshot · syn-boardroom'], ['🎭', 'syn-farmer', 'Character portrait']]);
    assert.equal(model.title, '2 portraits on the way', 'the portraits still show');
  }
  const odd = row('d1', T1, { mode: 'constructor', status: 'toString', style: '__proto__', title: '   ' });
  const model = await loadFamily({ ...OK, [P]: { portraits: [odd, row('d2', T3, { mode: 'toString', style: 'constructor' })] } }).family({});
  assert.deepEqual([model.title, model.lede], ['1 portrait ready to see', 'Newest: __proto__, tostring, started W(' + T1 + ').']);
  assert.deepEqual(section(model, 'ready').items.map((i) => [i.icon, i.title, i.text]), [['🖼️', 'constructor', 'Portrait']]);
});

test('a refusal and a failure each read as what they are', async () => {
  const signedOut = await loadFamily({ ...OK, [P]: { http: 401, body: { error: 'sign in to see your portraits' } } }).family({});
  assert.deepEqual([signedOut.title, signedOut.lede, signedOut.sections, signedOut.stats],
    ['Sign in to see your portraits', 'Portrait Studio shows the portraits of whoever is signed in, and this session is not signed in.', undefined, undefined]);
  const denied = await loadFamily({ ...OK, [P]: { http: 403, body: { error: 'portrait list failed' } } }).family({});
  assert.deepEqual([denied.title, denied.lede], ['This account cannot see saved portraits', 'The Portrait Studio routes refused this account (HTTP 403): seeing saved portraits needs permission to read them.']);
  const catalogDenied = await loadFamily({ ...OK, [C]: { http: 403, body: {} } }).family({});
  assert.equal(catalogDenied.title, '2 portraits on the way', 'the portraits read decides refusal; the names are fail-soft');
  await assert.rejects(loadFamily({ ...OK, [P]: { http: 500, body: { error: 'portrait list failed' } } }).family({}), /^Error: Portrait Studio could not read your portraits \(HTTP 500\)\.$/);
  await assert.rejects(loadFamily({ ...OK, [P]: { http: 502, body: undefined } }).family({}), /^Error: Portrait Studio could not read your portraits \(HTTP 502\)\.$/, 'a failure that is not JSON');
  await assert.rejects(loadFamily({ ...OK, [P]: { http: 200, body: undefined } }).family({}), /^Error: Portrait Studio could not read your portraits\.$/, 'an answer that is not JSON');
  await assert.rejects(loadFamily({ ...OK, [P]: { offline: true } }).family({}), /^Error: Portrait Studio could not read your portraits\.$/, 'a network failure');
});

test('every inline body script starts behind the kit gate', () => {
  const body = html.slice(html.indexOf('<body'));
  const inline = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1].replace(/^\s*(\/\*[\s\S]*?\*\/\s*)*/, ''));
  assert.equal(inline.length, 2, 'the brand-kit script and the studio script');
  for (const src of inline) assert.ok(src.startsWith('if (!window.AppView || !AppView.active()) (function () {'), 'gated: ' + src.slice(0, 80));
  const sources = [...body.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(sources, ['/api/portrait-studio/capture-module', '/api/portrait-studio/face-module', '/api/artifacts/picker.js'], 'a new body script must be checked for start work under the view');
});

/**
 * @description Run the page's studio script against a stub window, document and fetch whose every member records its
 * use and stops the script, so the first thing the start touches is observed and nothing further runs.
 * @param {string|null|undefined} activeView What AppView.active() answers; undefined = the kit is not loaded.
 * @returns {string[]} The members touched before the script stopped (empty = it never started).
 */
function runStudio(activeView) {
  const open = html.indexOf('/* The full studio starts only when no audience view renders.');
  const src = html.slice(open, html.indexOf('</script>', open));
  const touched = [], STARTED = new Error('studio started');
  const trap = (name) => () => { touched.push(name); throw STARTED; };
  const document = { getElementById: trap('getElementById'), querySelector: trap('querySelector'), querySelectorAll: trap('querySelectorAll'), createElement: trap('createElement'), addEventListener: trap('document.addEventListener') };
  const window = { addEventListener: trap('window.addEventListener'), PortraitCapture: {}, PortraitFaces: { install: trap('PortraitFaces.install') } };
  if (activeView !== undefined) window.AppView = { active: () => activeView };
  try { new Function('window', 'AppView', 'document', 'fetch', src)(window, window.AppView, document, trap('fetch')); } catch (e) { if (e !== STARTED) throw e; }
  return touched;
}

test('under an audience view the studio never starts; with the kit idle or absent it starts as before', () => {
  assert.deepEqual(runStudio('family'), [], 'no permissions, catalog, provider or gallery read, no handler, camera or face finder');
  assert.deepEqual(runStudio(null), ['getElementById'], 'the full page starts (its first step wires the mode buttons)');
  assert.deepEqual(runStudio(undefined), ['getElementById'], 'a core without the kit starts the full page');
});

/**
 * @description Load a package module the page includes by src in a fresh context whose every DOM, network and worker
 * member records its use, and report which globals it defined.
 * @param {string} file The module under tools/.
 * @returns {{ touched: string[], globals: string[] }} Members used on load and the names the module added.
 */
function loadModule(file) {
  const touched = [], trap = (name) => () => { touched.push(name); };
  const context = { document: { getElementById: trap('getElementById'), querySelector: trap('querySelector'), createElement: trap('createElement'), addEventListener: trap('document.addEventListener') },
    fetch: trap('fetch'), Worker: trap('Worker'), addEventListener: trap('addEventListener') };
  context.window = context; context.self = context;
  const before = new Set(Object.keys(context));
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'tools', file), 'utf8'), context);
  return { touched, globals: Object.keys(context).filter((k) => !before.has(k)) };
}

test('the two package modules loaded by src only define their globals: no read, listener or worker on load', () => {
  assert.deepEqual(loadModule('portrait-capture.js'), { touched: [], globals: ['PortraitCapture'] });
  assert.deepEqual(loadModule('portrait-face.js'), { touched: [], globals: ['PortraitFaces'] });
});
