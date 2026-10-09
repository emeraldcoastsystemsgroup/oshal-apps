/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Vids Studio has no page file: GET /api/vids/app sends SURFACE_HTML, a template literal in src-routes/vids-routes.ts, so the page file is that source. The tests prove the compiled routes/vids-routes.js serves the source template unchanged and that the block holds no backtick, dollar-brace or backslash (a template literal would alter any of them). The family view is asserted as behaviour over a stub kit and a stub fetch: on open it reads only GET /jobs (the newest nine), /home-summary and the artifact record of each finished video shown, never a write; the stats name what they count (queued and running together, finished in five days, not finished, the video maker) and a queued video is never called being made; each tile names its kind and where it stands, and only a finished video with its export attached opens its same-origin private preview in a new tab; the video maker reads as ready, registered but not online, or not connected; signed out, refused, failed, unreachable and malformed reads each read as what they are. The page's own inline start and module script are run with stubs too: under an audience view they bind no control, read nothing, do not poll, add no handoff listener and append no connected-actions section.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'vids';
const PAGE = 'src-routes/vids-routes.ts';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/vids"];
const GATE_FILE = 'src-routes/vids-routes.ts';

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
 * @description Evaluate a route file's SURFACE_HTML template literal exactly as GET /api/vids/app serves it.
 * @param {string} file Package-relative path of the TypeScript source or the compiled module.
 * @returns {string} The served page.
 */
function servedPage(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const marker = 'const SURFACE_HTML = `', s = source.indexOf(marker), e = source.indexOf('`;', s + marker.length);
  assert.ok(s >= 0 && e > s, file + ': the SURFACE_HTML literal is present');
  return new Function('return `' + source.slice(s + marker.length, e) + '`;')();
}
const served = servedPage('routes/vids-routes.js');

test('the page the route serves is the source template, and the block reaches it unchanged', () => {
  assert.equal(served, servedPage(PAGE), 'routes/vids-routes.js is recompiled from src-routes/vids-routes.ts');
  assert.ok(served.includes(block), 'the served page carries the audience block byte for byte');
  assert.doesNotMatch(block, /`|\$\{|\\/, 'no backtick, dollar-brace or backslash: the template literal would alter them');
});

/**
 * @description Run the head block against a stub kit and a stub fetch, so the family view is asserted as the model it
 * paints and the reads it makes. The stub AppView.when tags its input as W(value).
 * @param {Record<string, object|string>} answers URL -> JSON body; `{ http, body }` answers with that status instead;
 *   'offline' rejects the fetch; a body of 'not-json' fails to parse.
 * @returns {{ family: Function, urls: string[], opened: string[] }} The builder, every request made, every A.open href.
 */
function loadFamily(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', open: (href) => opened.push(href) };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url];
    if (a === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
    const status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === 'not-json' ? Promise.reject(new SyntaxError('Unexpected token <')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  assert.deepEqual(Object.keys(config.audiences), ['family', 'company']); assert.equal(config.audiences.company, config.audiences.family, 'the company audience is the family builder (ADR-164 D6)');
  return { family: config.audiences.family, urls, opened };
}

const HOUR = 36e5, ago = (h) => new Date(Date.now() - h * HOUR).toISOString();
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const job = (n, status, extra) => ({ job_id: id(n), status, idea: 'Synthetic idea ' + n, final_prompt: null, orientation: 'Landscape', insert_mode: 'Insert',
  client_id: 'synthetic-worker', task_id: null, created_at: ago(n + 10), updated_at: ago(n), ...extra });
const JOBS = [
  job(1, 'running', { idea: 'A synthetic anchor recaps the day' }),
  job(2, 'queued', { insert_mode: 'story', idea: 'story: The Synthetic Tortoise and the Hare', orientation: 'Portrait' }),
  job(3, 'done', { idea: 'Sunset over a synthetic harbour' }),
  job(4, 'done', { insert_mode: 'brand', idea: 'Synthetic Bakery intro', orientation: null }),
  job(5, 'failed', { orientation: 'Square' }),
  job(6, 'done'),
];
const metrics = (active, failed, day, five) => [['jobs-active', 'Queued / rendering', active], ['jobs-failed', 'Failed jobs', failed], ['jobs-done-24h', 'Done jobs updated / 24h', day], ['jobs-done-5d', 'Done jobs updated / 5d', five]]
  .map(([mid, label, value]) => ({ id: mid, label, value }));
const SUMMARY = { metrics: metrics('2', '1', '1', '3'), tiles: metrics('2', '1', '1', '3'), items: [], asOf: ago(0), partial: false };
const LIST = '/api/vids/jobs?limit=9', SUM = '/api/vids/home-summary', ART = (n) => '/api/vids/jobs/' + id(n) + '/artifact';
const PREVIEW3 = '/api/vids/jobs/' + id(3) + '/artifact/video.mp4';
const OK = {
  [LIST]: { jobs: JOBS, workers: [{ clientId: 'synthetic-worker', name: 'Synthetic operator', status: 'online', healthy: true, lastSeenAt: ago(0), queueDepth: 1 }] },
  [SUM]: SUMMARY,
  [ART(3)]: { artifact: { jobId: id(3), sha256: 'a'.repeat(64), byteLength: 1024, previewUrl: PREVIEW3, publicUrl: '/api/vids-public/' + 'b'.repeat(64) + '/video.mp4', publishedAt: ago(1) } },
  [ART(4)]: { artifact: null },
  [ART(6)]: { http: 503, body: { error: 'artifact_storage_unavailable' } },
};
const videos = (model) => model.sections.find((x) => x && x.id === 'videos');
const stat = (model, sid) => model.stats.find((x) => x.id === sid);

test('on open the view reads the job list, the summary and each finished video\x27s artifact record: nothing else, never a write', async () => {
  const view = loadFamily(OK);
  await view.family({});
  assert.deepEqual([...view.urls].sort(), ['GET ' + LIST, 'GET ' + SUM, 'GET ' + ART(3), 'GET ' + ART(4), 'GET ' + ART(6)].sort());
  const nine = [...JOBS, job(7, 'running'), job(8, 'queued'), job(9, 'done')];
  const long = loadFamily({ ...OK, [LIST]: { jobs: nine, workers: OK[LIST].workers } });
  const model = await long.family({});
  assert.ok(!long.urls.includes('GET ' + ART(9)), 'the ninth job is only a "more exist" probe: its artifact is not read');
  assert.equal(videos(model).items.length, 8);
  assert.match(videos(model).note, /Only the newest 8 show here\./);
  assert.ok([...view.urls, ...long.urls].every((u) => u.startsWith('GET /api/vids/')), 'every request is a GET on this package');
});

test('the stats and the title say what they count, and a queued video is never called being made', async () => {
  const model = await loadFamily(OK).family({});
  assert.deepEqual(model.stats.map((s) => [s.id, s.value, s.hint, s.tone]),
    [['active', 2, null, null], ['finished', 3, null, null], ['unfinished', 1, 'All time', 'warn'], ['maker', 'Ready', null, null]]);
  assert.deepEqual([model.kicker, model.title], ['Our videos', '2 videos waiting or being made']);
  assert.equal(model.lede, 'Newest: A synthetic anchor recaps the day (being made now, updated W(' + JOBS[0].updated_at + ')).');
  const withSummary = (s, jobs) => loadFamily({ ...OK, [SUM]: { ...SUMMARY, metrics: s }, [LIST]: { jobs, workers: OK[LIST].workers } }).family({});
  assert.equal((await withSummary(metrics('0', '1', '0', '3'), JOBS)).title, '3 videos finished in the last 5 days');
  assert.equal((await withSummary(metrics('0', '1', '0', '0'), JOBS)).title, 'Nothing waiting or being made right now');
  const none = await withSummary(metrics('0', '0', '0', '0'), []);
  assert.deepEqual([none.title, none.lede, videos(none).items.length, videos(none).empty],
    ['No videos yet', 'Vids Studio turns an idea into a short generated video. The videos made for this account show up here.', 0, 'No videos yet.']);
  const queuedOnly = await withSummary(metrics('1', '0', '0', '0'), [job(2, 'queued')]);
  assert.equal(queuedOnly.title, '1 video waiting or being made');
  assert.equal(videos(queuedOnly).items[0].text, 'Waiting its turn · Clip, landscape');
  assert.ok(!/being made now/i.test(queuedOnly.lede + ' ' + videos(queuedOnly).items[0].text), 'a queued video waits; it is not being made');
  const unread = await withSummary(metrics('Unavailable', 'Unavailable', 'Unavailable', 'Unavailable'), JOBS);
  assert.deepEqual([unread.title, stat(unread, 'active').value, stat(unread, 'active').hint, stat(unread, 'unfinished').tone], ['The newest videos', '—', 'Could not check', null]);
  const nothing = await loadFamily({ ...OK, [SUM]: { http: 503, body: { metrics: metrics('Unavailable', 'Unavailable', 'Unavailable', 'Unavailable'), partial: true } }, [LIST]: { jobs: [], workers: [] } }).family({});
  assert.equal(nothing.title, 'Some saved work could not be checked');
});

test('each tile names its kind and where it stands; only a finished video with its export attached opens its private preview in a new tab', async () => {
  const model = await loadFamily(OK).family({});
  assert.deepEqual(videos(model).items.map((t) => [t.icon, t.title, t.text, t.badge, t.tone, t.href, t.target]), [
    ['🎬', 'A synthetic anchor recaps the day', 'Being made now · Clip, landscape', null, null, null, null],
    ['📖', 'The Synthetic Tortoise and the Hare', 'Waiting its turn · Story video, portrait', null, null, null, null],
    ['🎬', 'Sunset over a synthetic harbour', 'Finished · Clip, landscape · public link on', 'Ready to watch', null, PREVIEW3, '_blank'],
    ['✨', 'Synthetic Bakery intro', 'Finished · Brand graphic', null, null, null, null],
    ['⚠️', 'Synthetic idea 5', 'Did not finish · Clip, square', null, 'warn', null, null],
    ['🎬', 'Synthetic idea 6', 'Finished · Clip, landscape', null, null, null, null],
  ]);
  assert.equal(videos(model).items[0].meta, 'updated W(' + JOBS[0].updated_at + ')');
  assert.equal(videos(model).note, 'Tap a video marked Ready to watch to play it in a new tab. Finished means the video maker reported it done, not that it was posted anywhere; a finished video can be watched here once its file is added in Vids Studio. For 1 finished video the file could not be checked just now.');
  const offOrigin = { ...OK, [ART(3)]: { artifact: { ...OK[ART(3)].artifact, previewUrl: 'https://elsewhere.example.test/video.mp4' } }, [ART(4)]: { artifact: { previewUrl: '/api/vids-public/' + 'c'.repeat(64) + '/video.mp4' } } };
  const guarded = await loadFamily(offOrigin).family({});
  assert.deepEqual(videos(guarded).items.slice(2, 4).map((t) => [t.href, t.target, t.badge]), [[null, null, null], [null, null, null]], 'only this origin\x27s private preview path is followed');
  const odd = await loadFamily({ ...OK, [LIST]: { jobs: [job(1, 'paused', { idea: 'x'.repeat(120) }), job(2, 'done', { idea: '   ', insert_mode: null, orientation: '' })], workers: OK[LIST].workers }, [ART(2)]: { artifact: null } }).family({});
  assert.deepEqual(videos(odd).items.map((t) => [t.title.length, t.title.slice(-1), t.text]), [[90, '…', 'Status: paused · Clip, landscape'], [14, 'o', 'Finished · Clip']]);
  assert.equal(videos(odd).items[1].title, 'Untitled video');
});

test('the video maker reads as ready, registered but not online, or not connected', async () => {
  const maker = async (workers) => { const m = await loadFamily({ ...OK, [LIST]: { jobs: JOBS, workers } }).family({}); return [stat(m, 'maker').value, stat(m, 'maker').hint, stat(m, 'maker').tone, /The video maker is not online right now/.test(videos(m).note)]; };
  assert.deepEqual(await maker([{ clientId: 'a', status: 'online' }]), ['Ready', null, null, false]);
  assert.deepEqual(await maker([{ clientId: 'a', status: 'offline', healthy: true }]), ['Ready', null, null, false]);
  assert.deepEqual(await maker([{ clientId: 'a', status: 'offline', healthy: false }]), ['Not answering', 'Registered, but not online right now', 'warn', true]);
  assert.deepEqual(await maker([]), ['Not connected', 'Needed to make new videos', 'warn', true]);
  assert.deepEqual(await maker(undefined), ['Not connected', 'Needed to make new videos', 'warn', true]);
});

test('signed out, refused, failed, unreachable and malformed reads each read as what they are', async () => {
  const signedOut = loadFamily({ ...OK, [LIST]: { http: 401, body: { error: 'user_identity_required' } } });
  const out = await signedOut.family({});
  assert.deepEqual([out.title, out.lede, out.stats, out.sections], ['Sign in to see the saved videos', 'Vids Studio shows the videos of whoever is signed in, and this session is not signed in.', undefined, undefined]);
  assert.ok(!signedOut.urls.some((u) => u.includes('/artifact')), 'nothing more is read when the list is refused');
  const refused = await loadFamily({ ...OK, [LIST]: { http: 403, body: { error: 'forbidden' } } }).family({});
  assert.deepEqual([refused.title, refused.lede], ['This account cannot open Vids Studio', 'The Vids Studio routes refused this account (HTTP 403).']);
  await assert.rejects(loadFamily({ ...OK, [LIST]: { http: 500, body: { error: 'boom' } } }).family({}), /^Error: Vids Studio could not read the saved videos \(HTTP 500\)\.$/);
  await assert.rejects(loadFamily({ ...OK, [LIST]: { http: 502, body: 'not-json' } }).family({}), /^Error: Vids Studio could not read the saved videos \(HTTP 502\)\.$/);
  await assert.rejects(loadFamily({ ...OK, [LIST]: 'offline' }).family({}), /^Error: Vids Studio could not be reached just now\.$/);
  await assert.rejects(loadFamily({ ...OK, [LIST]: 'not-json' }).family({}), /^Error: Vids Studio answered without its list of saved videos\.$/);
  for (const summary of [{ http: 401, body: { error: 'not_authenticated' } }, { http: 503, body: {} }, 'offline']) {
    const partial = await loadFamily({ ...OK, [SUM]: summary }).family({});
    assert.deepEqual([stat(partial, 'finished').value, stat(partial, 'finished').hint, videos(partial).items.length, partial.title], ['—', 'Could not check', 6, 'The newest videos']);
  }
  const opened = loadFamily(OK);
  (await opened.family({})).actions[0].onClick();
  assert.deepEqual(opened.opened, ['/cockpit/?app=vids']);
});

/**
 * @description Run the page's own inline start (the first inline script after <body>) with a stub DOM, fetch and timer.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {{ fetches: string[], timers: number[], bound: string[] }} What it read, what it scheduled, which controls it bound.
 */
function runInline(activeView) {
  const s = served.indexOf('<script>', served.indexOf('<body>')) + 8, src = served.slice(s, served.indexOf('</script>', s));
  const fetches = [], timers = [], nodes = {}, kit = { active: () => activeView };
  const documentStub = { documentElement: { setAttribute() {} }, getElementById: (nid) => (nodes[nid] = nodes[nid] || { id: nid, value: '', onclick: null, onchange: null }) };
  new Function('window', 'AppView', 'document', 'fetch', 'setInterval', src)({ AppView: kit }, kit, documentStub,
    (url, opt) => { fetches.push(((opt && opt.method) || 'GET') + ' ' + url); return new Promise(() => {}); }, (_fn, ms) => { timers.push(ms); });
  return { fetches, timers, bound: Object.values(nodes).filter((n) => n.onclick || n.onchange).map((n) => n.id).sort() };
}

/**
 * @description Run the page's module script with its imports replaced by recording stubs.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {{ calls: string[], appended: number }} The handoff and connected-actions calls made, and the sections appended to <body>.
 */
function runModule(activeView) {
  const open = '<script type="module">', s = served.indexOf(open) + open.length;
  const src = served.slice(s, served.indexOf('</script>', s)).replace(/^import .*$/gm, '');
  const calls = [], appended = [], kit = { active: () => activeView };
  const node = () => ({ value: '', style: {}, setAttribute() {}, dispatchEvent() {}, focus() {} });
  const documentStub = { getElementById: node, createElement: node, body: { append: (el) => appended.push(el) } };
  new Function('window', 'AppView', 'document', 'receiveHandoff', 'mountConnectedActions', 'Event', src)({ AppView: kit }, kit, documentStub,
    (spec) => { calls.push('receiveHandoff ' + spec.app); }, (spec) => { calls.push('mountConnectedActions ' + spec.app); return Promise.resolve(); }, function Event() {});
  return { calls, appended: appended.length };
}

test('under an audience view the full page binds no control, reads nothing, does not poll and mounts no handoff or offer', () => {
  assert.deepEqual(runInline('family'), { fetches: [], timers: [], bound: [] });
  assert.deepEqual(runInline(null), { fetches: ['GET /api/vids/jobs'], timers: [4000], bound: ['go', 'rows'] }, 'the full page still starts');
  assert.deepEqual(runModule('family'), { calls: [], appended: 0 });
  assert.deepEqual(runModule(null), { calls: ['receiveHandoff vids', 'mountConnectedActions vids'], appended: 1 }, 'the full page still mounts its handoff and offer');
});
