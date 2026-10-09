/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Behaviour of the company view against a stub kit and a stub fetch: on open it reads only GET /home-summary, GET /prefs and GET /local/list (never POST /assistant, never the Dropbox or GitHub pickers); the title, stats, files table and stores list are asserted as the model it paints; signed out, refused, nothing saved, an empty store, a partial summary, a failed prefs read, a failed listing and a failed summary each read as what they are, and only both the summary and the prefs failing rejects into the kit's failure notice. The page's own script, run against a stub document, adds no greeting under a view and still greets without the audience or without the kit.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'storage';
const PAGE = 'tools/storage-assistant.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/storage"];
const GATE_FILE = 'tools/storage-assistant.html';

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
 * @description Run the head block against a stub kit and a stub fetch, so the company view is asserted as the model it
 * paints and the reads it makes. The stub formatter tags its input: W = AppView.when.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead.
 * @returns {{ company: Function, urls: string[] }} The builder and every request made.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')' };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url], status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, urls };
}

const H = '/api/storage/home-summary', P = '/api/storage/prefs', L = '/api/storage/local/list';
const SAVED_AT = '2026-09-28T09:00:00.000Z';
const NOTE = 'Shows explicitly saved target preferences. Automatic means the Files service chooses its configured fallback at use time. A saved target is not evidence of a live connection, a successful export or provider free space. Browse and export through the existing Files surface.';
/** @returns {object[]} The route's two metrics (routes/home-summary.js), which it mirrors as tiles. */
const metrics = (code, files) => [{ id: 'code-target', label: 'Saved code target', value: code }, { id: 'files-target', label: 'Saved file target', value: files }];
/** @returns {object} A home summary as the route shapes it: tiles mirror metrics, the note item last. */
const summary = (code, files, items, partial) => ({ metrics: metrics(code, files), tiles: metrics(code, files), items, asOf: SAVED_AT, partial: !!partial });
const PREF_ITEM = { text: 'Storage preferences', detail: 'Saved ' + SAVED_AT, tone: 'neutral', fix: 'storage-settings', actions: [] };
const NOTE_ITEM = { text: NOTE, tone: 'neutral', fix: 'storage-settings' };
const SUMMARY = summary('github', 'dropbox', [PREF_ITEM, NOTE_ITEM]);
const AUTOMATIC = summary('Automatic', 'Automatic', [{ text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: 'storage-settings' }, NOTE_ITEM]);
const PARTIAL = summary('Unavailable', 'Unavailable', [{ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'storage-settings' }, NOTE_ITEM], true);
// connected is every provider on file in oshal_connections; slack is not a store and must not be counted.
const PREFS = { prefs: { code: { provider: 'github', repo: 'synthetic/oshal-demo', folder: '' }, files: { provider: 'dropbox', folder: '/' } }, connected: ['github', 'dropbox', 'slack'] };
const DEFAULTS = { prefs: { code: { provider: 'oshal-local' }, files: { provider: 'oshal-local' } }, connected: [] };
const FILES = { files: [{ name: 'synthetic-report.pdf', size: 345678 }, { name: 'Synthetic-deck.pptx', size: 1234567 }, { name: 'synthetic-notes.md', size: 2048 }] };
const OK = { [H]: SUMMARY, [P]: PREFS, [L]: FILES };
const KICKER = 'Productivity · Storage';
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const statRow = (s) => [s.id, s.label, s.value, s.hint, s.tone || null];

test('on open the view reads only the home summary, the prefs and the local listing: never the chat, never a provider', async () => {
  const view = loadCompany(OK);
  await view.company({});
  assert.deepEqual([...view.urls].sort(), ['GET ' + H, 'GET ' + L, 'GET ' + P].sort());
  assert.ok(!view.urls.some((u) => /^POST |assistant|dropbox|github/i.test(u)), 'no write, no chat turn, no provider picker');
});

test('the title names the effective targets; the stats, the files table and the stores list are the routes\x27 own answers', async () => {
  const model = await loadCompany(OK).company({});
  assert.deepEqual([model.kicker, model.title, model.lede], [KICKER, 'Code → GitHub · Files → Dropbox', 'Targets saved W(' + SAVED_AT + '). ' + NOTE]);
  assert.deepEqual(model.actions.map((a) => [a.label, a.primary || false, a.href || null]), [['Open the assistant', true, null], ['Storage settings', false, '/api/storage']]);
  assert.deepEqual(model.stats.map(statRow), [
    ['code', 'Code target', 'GitHub', 'Saved · synthetic/oshal-demo', null], ['files', 'Files target', 'Dropbox', 'Saved', null],
    ['connected', 'Connected stores', 2, 'GitHub, Dropbox', null], ['local', 'Files in oshal local', 3, '1.5 MB in all', null]]);
  const files = section(model, 'local-files');
  assert.deepEqual([files.kind, files.columns], ['table', ['File', { label: 'Size', align: 'right' }]]);
  // Sorted by name without regard to case, sizes in the unit that fits.
  assert.deepEqual(files.rows.map((r) => [r[0], r[1].text]), [['Synthetic-deck.pptx', '1.2 MB'], ['synthetic-notes.md', '2 KB'], ['synthetic-report.pdf', '338 KB']]);
  assert.match(files.note, /bot subfolders are not listed here\. Browse, download and share through Files\.$/);
  const stores = section(model, 'stores');
  assert.deepEqual(stores.items.map((i) => [i.title, i.text, i.badge, i.tone || null]), [
    ['GitHub', 'Target for code', 'Connected', 'ok'], ['Dropbox', 'Target for files', 'Connected', 'ok'], ['Google Drive', 'Not a target', 'Not connected', null], ['oshal local', 'Not a target', 'Built in', null]]);
  assert.match(stores.note, /^Connected means an authorized connection is on file in Identity\./);
});

test('nothing saved, nothing connected and an empty store each read as what they are, and the table caps at twelve', async () => {
  const none = await loadCompany({ [H]: AUTOMATIC, [P]: DEFAULTS, [L]: { files: [] } }).company({});
  assert.deepEqual([none.title, none.lede], ['Code → oshal local · Files → oshal local', 'No target saved yet: these are the automatic choices from what is connected. ' + NOTE]);
  assert.deepEqual(none.stats.map(statRow), [
    ['code', 'Code target', 'oshal local', 'Automatic', null], ['files', 'Files target', 'oshal local', 'Automatic', null],
    ['connected', 'Connected stores', 0, 'Connect GitHub, Dropbox or Google Drive in Identity', 'warn'], ['local', 'Files in oshal local', 0, 'Nothing stored locally yet', null]]);
  assert.deepEqual([section(none, 'local-files').rows.length, section(none, 'local-files').empty], [0, 'No files in the oshal local store yet.']);
  assert.deepEqual(section(none, 'stores').items.map((i) => [i.title, i.text, i.badge]).slice(2), [['Google Drive', 'Not a target', 'Not connected'], ['oshal local', 'Target for code and files', 'Built in']]);
  const many = { files: Array.from({ length: 15 }, (_, i) => ({ name: 'synthetic-' + String(i).padStart(2, '0') + '.txt', size: 10 })) };
  const capped = section(await loadCompany({ ...OK, [L]: many }).company({}), 'local-files');
  assert.deepEqual([capped.rows.length, / The first 12 of 15\.$/.test(capped.note), stat(await loadCompany({ ...OK, [L]: many }).company({}), 'local').value], [12, true, 15]);
});

test('signed out and refused read as such, and only both the summary and the prefs failing raises the failure notice', async () => {
  const out = { http: 401, body: { error: 'not_authenticated' } };
  const signedOut = await loadCompany({ [H]: out, [P]: out, [L]: out }).company({});
  assert.deepEqual([signedOut.kicker, signedOut.title, signedOut.stats, signedOut.sections], [KICKER, 'Sign in to see your storage', undefined, undefined]);
  assert.match(signedOut.lede, /this session is not signed in\.$/);
  const prefsOut = await loadCompany({ ...OK, [P]: out }).company({});
  assert.equal(prefsOut.title, 'Sign in to see your storage');
  const denied = await loadCompany({ ...OK, [H]: { http: 403, body: {} } }).company({});
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Storage', 'The Storage routes refused this account (HTTP 403).']);
  await assert.rejects(loadCompany({ [H]: { http: 503, body: { error: 'Storage records unavailable' } }, [P]: { http: 500, body: { error: 'db' } }, [L]: FILES }).company({}), /^Error: Storage records unavailable$/, 'the route\x27s own error');
  await assert.rejects(loadCompany({ [H]: { http: 503, body: PARTIAL }, [P]: { http: 500, body: undefined }, [L]: FILES }).company({}), /^Error: Storage could not read the saved targets \(HTTP 503\)\.$/);
});

test('a partial summary, a failed prefs read, a failed listing and a failed summary each degrade only their own part', async () => {
  const partial = await loadCompany({ ...OK, [H]: PARTIAL }).company({});
  assert.deepEqual([partial.title, partial.lede, statRow(stat(partial, 'code'))], ['Code → GitHub · Files → Dropbox', 'Some saved sources cannot be checked. ' + NOTE, ['code', 'Code target', 'GitHub', 'Saved state unavailable · synthetic/oshal-demo', 'warn']]);
  const noPrefs = await loadCompany({ ...OK, [P]: { http: 500, body: { error: 'db' } } }).company({});
  assert.deepEqual([noPrefs.title, statRow(stat(noPrefs, 'code')), statRow(stat(noPrefs, 'connected'))], ['Code → GitHub · Files → Dropbox',
    ['code', 'Code target', 'GitHub', 'Effective target could not be read (HTTP 500)', 'warn'], ['connected', 'Connected stores', 'Unavailable', 'Could not be read (HTTP 500)', 'warn']]);
  assert.deepEqual([section(noPrefs, 'stores').items.length, section(noPrefs, 'stores').empty, section(noPrefs, 'local-files').rows.length], [0, 'Connected stores could not be read (HTTP 500).', 3]);
  const noList = await loadCompany({ ...OK, [L]: { http: 500, body: {} } }).company({});
  assert.deepEqual([statRow(stat(noList, 'local')), section(noList, 'local-files').empty, section(noList, 'local-files').rows.length], [['local', 'Files in oshal local', 'Unavailable', 'Could not be listed (HTTP 500)', 'warn'], 'The store could not be listed (HTTP 500).', 0]);
  const noSummary = await loadCompany({ ...OK, [H]: { http: 500, body: undefined } }).company({});
  assert.deepEqual([noSummary.title, noSummary.lede, statRow(stat(noSummary, 'files'))], ['Code → GitHub · Files → Dropbox', 'Saved preferences could not be checked (HTTP 500).', ['files', 'Files target', 'Dropbox', 'Saved state unavailable', 'warn']]);
});

/**
 * @description Run the page's own script (the last inline block) against a stub document, so its one start step, the
 * greeting, is asserted under a view, without a view and without the kit. Any fetch is a failure: the page reads nothing on load.
 * @param {string|null|undefined} activeView What AppView.active() answers; undefined means no kit at all.
 * @returns {string[]} The HTML of every message appended to the log.
 */
function runFull(activeView) {
  const open = html.lastIndexOf('<script>'), src = html.slice(open + 8, html.indexOf('</script>', open));
  const added = [];
  const node = () => ({ className: '', innerHTML: '', value: '', scrollTop: 0, scrollHeight: 0, appendChild: (d) => added.push(d.innerHTML) });
  const log = node(), kit = activeView === undefined ? undefined : { active: () => activeView };
  new Function('window', 'AppView', 'document', 'fetch', src)({ AppView: kit }, kit, { getElementById: () => log, createElement: node }, () => { throw new Error('the page fetched on load'); });
  return added;
}

test('under an audience view the page adds no greeting and fetches nothing; without the audience, or without the kit, it greets as before', () => {
  assert.deepEqual(runFull('company'), []);
  assert.deepEqual(runFull(null).map((m) => m.slice(0, 27)), ['Hi — I\x27m your storage assis']);
  assert.equal(runFull(undefined).length, 1);
});
