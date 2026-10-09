/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | World's page is WORLD_APP_HTML, a String.raw template in src-routes/world-app-html.ts, so the page file is that source: the tests prove the compiled routes/world-app-html.js serves the source template byte for byte and that the block holds no backtick or dollar-brace. The company view is asserted as behaviour over a stub kit and a stub fetch: on open it reads only /entities (60), /home-summary and /pulls for the most covered subject over 30 days (never sentiment, the graph, a metric or a write); the stats name what they count (60+ when the list is full, an unreadable metric as not read); quiet and never-seen subjects are marked; headlines open their source in a new tab and carry the route's own sampling note; the next recorded event and the pull-rate show as recorded; a partial, missing or refused coverage summary, a failed pull ledger, a disabled service and a failed subject read each read as what they are. The dashboard's own script is run with stubs too: under an audience view it binds no window control and reads nothing.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | 1.4.0: the full page (never an audience view) also reads /api/world/operations/ping once, to show the operator's Sources & schedules link.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'world';
const PAGE = 'src-routes/world-app-html.ts';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/world"];
const GATE_FILE = 'src-routes/world-app-html.ts';

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

test('the page the route serves is the source template, byte for byte, and the block is safe inside it', () => {
  const served = require(path.join(ROOT, 'routes', 'world-app-html.js')).WORLD_APP_HTML;
  const s = html.indexOf('String.raw`') + 'String.raw`'.length, e = html.lastIndexOf('`;');
  assert.equal(served, html.slice(s, e), 'routes/world-app-html.js is recompiled from src-routes/world-app-html.ts');
  assert.ok(served.includes(block), 'the served page carries the audience block');
  assert.doesNotMatch(block, /`|\$\{/, 'no backtick or dollar-brace in the block: the page is a String.raw template');
});

/**
 * @description Run the head block against a stub kit and a stub fetch, so the company view is asserted as the model it
 * paints and the reads it makes. The stub formatters tag their input: W = AppView.when, N = num, P = pct.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead.
 * @returns {{ company: Function, urls: string[], opened: string[] }} The builder, every URL fetched, every A.open href.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', num: (v) => 'N(' + v + ')', pct: (v) => 'P(' + v + ')', open: (href) => opened.push(href) };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url], status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body || {} : a;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, urls, opened };
}

const HOUR = 36e5, ago = (h) => new Date(Date.now() - h * HOUR).toISOString();
const ENTITIES = [
  { entity: 'world:topic:energy-oil', label: 'Energy & oil', items: 1840, lastSeen: ago(2) },
  { entity: 'world:topic:healthcare', label: 'Healthcare', items: 912, lastSeen: ago(40) },
  { entity: 'world:org:acme', label: 'Acme', items: 3, lastSeen: null },
];
const SUMMARY = {
  metrics: [{ id: 'fetched-24h', label: 'Fetched / 24h', value: '1204' }, { id: 'new-subject-items-24h', label: 'New subject items / 24h', value: '96' }, { id: 'subjects-24h', label: 'Subjects pulled / 24h', value: '14' }, { id: 'pulls-24h', label: 'Feed pulls / 24h', value: 'Unavailable' }],
  items: [
    { text: 'Synthetic refinery restarts', detail: 'Synthetic Wire · Energy & oil · Published Sep 27, 2:00 PM UTC.', sourceUrl: 'https://news.example.test/a', tone: 'neutral', actions: [] },
    { text: 'Synthetic clinic opens', detail: 'Synthetic Daily · Healthcare · Published Sep 27, 1:00 PM UTC.', tone: 'neutral', actions: [] },
    { text: 'Upcoming: Synthetic OPEC meeting', detail: 'Recorded event · world:topic:energy-oil · Sep 30, 9:00 AM UTC · synthetic-calendar', highlight: true, tone: 'neutral' },
    { text: 'Published within 48 hours · three-topic coverage sample.', detail: 'Samples the latest 100 saved items per baseline topic. Last pull: Sep 27, 3:00 PM UTC.', tone: 'neutral' },
  ],
  asOf: ago(0), partial: false,
};
const PULLS = { entity: 'world:topic:energy-oil', days: 30, archivedItems: 412, bySource: [
  { feedId: 'google-news', pulls: 60, fetched: 900, uniqueItems: 700, newItems: 180, classified: 180, freshRate: 0.2, lastPull: ago(1) },
  { feedId: 'bing-news', pulls: 2, fetched: 0, uniqueItems: 0, newItems: 0, classified: 0, freshRate: null, lastPull: null },
] };
const E = '/api/world/entities?limit=60&surface=1', S = '/api/world/home-summary', P = '/api/world/pulls?entity=world%3Atopic%3Aenergy-oil&days=30&surface=1';
const OK = { [E]: { entities: ENTITIES }, [S]: SUMMARY, [P]: PULLS };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);

test('on open the view reads the subjects, the coverage summary and one pull ledger: no sentiment, graph or write', async () => {
  const view = loadCompany(OK);
  await view.company({});
  assert.deepEqual([...view.urls].sort(), ['GET ' + E, 'GET ' + P, 'GET ' + S].sort());
  const empty = loadCompany({ ...OK, [E]: { entities: [] } });
  const model = await empty.company({});
  assert.deepEqual([...empty.urls].sort(), ['GET ' + E, 'GET ' + S].sort(), 'no subject, no pull ledger read');
  assert.equal(section(model, 'subjects').empty, 'No subjects tracked yet. Ask the World Analyst to ingest one, or run the world_ingest tool.');
  assert.equal(section(model, 'pulls'), undefined);
});

test('the stats and the subjects table say what they count, and a quiet subject is marked', async () => {
  const model = await loadCompany(OK).company({});
  assert.equal(model.lede, 'Most covered: Energy & oil (N(1840) items). One shared news archive: every member sees the same coverage.');
  assert.deepEqual(model.stats.map((x) => [x.id, x.value, x.hint]), [['subjects', 3, null], ['fetched-24h', 'N(1204)', null], ['new-subject-items-24h', 'N(96)', null], ['pulls-24h', '—', 'Could not be read'], ['subjects-24h', 'N(14)', null]]);
  assert.equal(stat(model, 'pulls-24h').tone, 'warn');
  assert.deepEqual(section(model, 'subjects').rows.map((r) => [r[0], r[1], r[3].text, r[3].tone]),
    [['Energy & oil', 'N(1840)', 'Seen in 24 h', null], ['Healthcare', 'N(912)', 'Nothing new in 24 h', 'warn'], ['Acme', 'N(3)', 'Never seen', 'warn']]);
  assert.equal(section(model, 'subjects').rows[2][2], '—');
  const many = Array.from({ length: 60 }, (_, i) => ({ entity: 'world:topic:t' + i, label: 'Synthetic ' + i, items: 60 - i, lastSeen: ago(1) }));
  const full = await loadCompany({ ...OK, [E]: { entities: many }, ['/api/world/pulls?entity=world%3Atopic%3At0&days=30&surface=1']: PULLS }).company({});
  assert.deepEqual([stat(full, 'subjects').value, stat(full, 'subjects').hint], ['60+', 'The 60 most covered are listed']);
  assert.deepEqual([section(full, 'subjects').rows.length, section(full, 'subjects').note], [12, 'The 12 most covered of the 60 listed.']);
});

test('headlines open their source in a new tab, the next event and the pull-rate read as recorded', async () => {
  const model = await loadCompany(OK).company({});
  const news = section(model, 'headlines');
  assert.deepEqual(news.items.map((i) => [i.title, i.href, i.target]), [['Synthetic refinery restarts', 'https://news.example.test/a', '_blank'], ['Synthetic clinic opens', null, null]]);
  assert.equal(news.note, 'Samples the latest 100 saved items per baseline topic. Last pull: Sep 27, 3:00 PM UTC.', 'the route\x27s own sampling note, not a re-derived time');
  assert.deepEqual(section(model, 'upcoming').items, [{ title: 'Synthetic OPEC meeting', text: 'Recorded event · world:topic:energy-oil · Sep 30, 9:00 AM UTC · synthetic-calendar', badge: 'Recorded event' }]);
  const pulls = section(model, 'pulls');
  assert.equal(pulls.title, 'Pull-rate · Energy & oil · 30 days');
  assert.deepEqual(pulls.rows, [['google-news', 'N(60)', 'N(900)', 'N(180)', 'P(0.2)', 'W(' + PULLS.bySource[0].lastPull + ')'], ['bing-news', 'N(2)', 'N(0)', 'N(0)', '—', '—']]);
  assert.equal(pulls.note, 'N(412) new items archived for Energy & oil in 30 days. Fresh rate is new items over fetched.');
  const quiet = await loadCompany({ ...OK, [S]: { ...SUMMARY, items: [{ text: 'No articles published in the last 48 hours in this coverage sample.', detail: 'Samples.', tone: 'neutral' }] } }).company({});
  assert.deepEqual([section(quiet, 'headlines').items.length, section(quiet, 'headlines').empty, section(quiet, 'upcoming').empty],
    [0, 'No articles published in the last 48 hours in this coverage sample.', 'No recorded event in the next 7 days.']);
  const failedLedger = await loadCompany({ ...OK, [P]: { http: 500, body: { error: 'read failed' } } }).company({});
  assert.deepEqual([section(failedLedger, 'pulls').rows.length, section(failedLedger, 'pulls').empty], [0, 'The pull ledger could not be read (HTTP 500).']);
});

test('a partial, missing or refused coverage summary, a disabled service and a failed subject read each read as what they are', async () => {
  const allMissing = { http: 503, body: { metrics: SUMMARY.metrics.map((m) => ({ ...m, value: 'Unavailable' })), items: [{ text: 'Cannot check coverage, headlines, events.', detail: 'Samples.', tone: 'warn' }], partial: true } };
  const partial = await loadCompany({ ...OK, [S]: allMissing }).company({});
  assert.deepEqual(section(partial, 'headlines').items, [{ title: 'Cannot check coverage, headlines, events.', tone: 'warn', badge: 'Partial' }]);
  assert.equal(section(partial, 'upcoming').empty, 'No recorded event to show; part of the coverage read failed.');
  assert.deepEqual([stat(partial, 'fetched-24h').value, stat(partial, 'fetched-24h').hint], ['—', 'Could not be read']);
  const gone = await loadCompany({ ...OK, [S]: { http: 503, body: { error: 'world_archive_unavailable' } } }).company({});
  assert.deepEqual([stat(gone, 'fetched-24h').hint, section(gone, 'headlines').empty], ['The world archive is unavailable right now.', 'The world archive is unavailable right now.']);
  const signedOut = await loadCompany({ ...OK, [S]: { http: 401, body: { error: 'not_authenticated' } } }).company({});
  assert.deepEqual([stat(signedOut, 'pulls-24h').hint, section(signedOut, 'upcoming').empty, section(signedOut, 'subjects').rows.length], ['Sign in to see the shared coverage.', 'Sign in to see the shared coverage.', 3]);
  const disabledView = loadCompany({ [E]: { enabled: false, message: 'World Intelligence is not configured. Set ENABLE_WORLD_INTELLIGENCE with graph and series backends to activate this surface.', entities: [] }, [S]: { http: 503, body: { error: 'world_archive_unavailable' } } });
  const disabled = await disabledView.company({});
  assert.deepEqual([disabled.title, disabled.stats, disabled.sections], ['World Intelligence is not configured', undefined, undefined]);
  assert.match(disabled.lede, /^World Intelligence is not configured\. Set ENABLE_WORLD_INTELLIGENCE/);
  assert.ok(!disabledView.urls.some((u) => u.includes('/pulls')), 'nothing more is read when the service is off');
  await assert.rejects(loadCompany({ ...OK, [E]: { http: 500, body: { error: 'read failed' } } }).company({}), /^Error: World Intelligence could not read the tracked subjects \(HTTP 500\)\.$/);
  const opened = loadCompany(OK);
  (await opened.company({})).actions[0].onClick();
  assert.deepEqual(opened.opened, ['/cockpit/?app=world']);
});

/**
 * @description Run the dashboard's own script (the page's last inline script) with a stub DOM and fetch.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {{ fetches: string[], bound: boolean }} What the dashboard read and whether its window control was bound.
 */
function runDashboard(activeView) {
  const src = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const fetches = [], nodes = {};
  const documentStub = { getElementById: (id) => (nodes[id] = nodes[id] || { id, innerHTML: '', onchange: null, querySelectorAll: () => [] }), querySelectorAll: () => [] };
  new Function('window', 'AppView', 'document', 'fetch', src)({ AppView: { active: () => activeView } }, { active: () => activeView }, documentStub,
    (url) => { fetches.push(url); return new Promise(() => {}); });
  return { fetches, bound: typeof (nodes.win && nodes.win.onchange) === 'function' };
}

test('under an audience view the dashboard binds no window control and reads nothing', () => {
  assert.deepEqual(runDashboard('company'), { fetches: [], bound: false });
  // The full page also probes the operator route once, to show its Sources & schedules link (1.4.0).
  assert.deepEqual(runDashboard(null), { fetches: ['/api/world/operations/ping', '/api/world/entities?limit=60&surface=1'], bound: true }, 'the full dashboard still starts');
});
