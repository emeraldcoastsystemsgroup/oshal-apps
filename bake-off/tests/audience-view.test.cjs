/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company view asserted as behaviour: the head block runs against a stub kit and a stub fetch, so the tests prove what it reads on open (only GET /home-summary and GET /jobs, both owner-scoped reads; never a write, never a run, a verdict, the live lane roster or the connected-actions plan), that the stats are the route's four counts with their tones (a failed run wants attention, a completed run in 5 days is the figure with graded results, an unavailable count is named as not checked), that the runs table reads status and start from the route's detail and the lanes recorded, best scored lane, score, judge and observed cost from the route's own sentence (a zero or missing cost stays unknown, a sub-cent cost is named, a lexical fallback judge is flagged, a sentence that does not match leaves those columns unknown), that the saved benchmarks table shows quality bar, monthly volume and lane choice and notes when more than eight exist, that the title names the account's state (in progress, latest failed, completed in 5 days, none completed in 5 days, saved but never run, nothing saved, some sources not checked), and that a 401, a 403, a 503 with the route's body, a non-JSON failure, a failure with its own error and an unreadable saved-benchmarks list each read as what they are. The page's module script (top-level await, so run as an async function body) is proved to mount no connected actions, bind no Refresh handler and read nothing under the view while the full page still runs every start step.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The saved-benchmarks note never states a false total: GET /jobs answers at most 200 rows (bake-off-store listJobs, LIMIT 200), so an account with 250 saved benchmarks was told "The newest 8 of 200". The note now names the home summary's saved-benchmarks count when it is readable and no smaller than the list, otherwise "at least 200" for a list at the cap. Asserted with a 200-row /jobs answer under a readable count (250), under an unreadable count (at least 200), and a count smaller than the list (the list length).
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'bake-off';
const PAGE = 'tools/review.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/bake-off"];
const GATE_FILE = 'tools/review.html';

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
 * paints and the reads it makes. The stub formatters tag their input: W = AppView.when, M = AppView.money, N = AppView.num.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead;
 * `{ reject: true }` fails the request itself (a network error).
 * @returns {{ company: Function, urls: string[] }} The builder and every request made.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', money: (v) => 'M(' + v + ')', num: (v) => 'N(' + v + ')' };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url];
    if (a && a.reject) return Promise.reject(new TypeError('Failed to fetch'));
    const status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, urls };
}

const H = '/api/bake-off/home-summary';
const J = '/api/bake-off/jobs';
const NOW = '2026-09-28T12:00:00.000Z';
/** @returns {object[]} The route's four metrics (mirrored as tiles), each value a digit string or 'Unavailable'. */
const metrics = (jobs, active, failed, five) => [
  { id: 'saved-benchmarks', label: 'Saved benchmarks', value: jobs },
  { id: 'runs-active', label: 'Benchmarks running', value: active },
  { id: 'runs-failed', label: 'Failed benchmark runs', value: failed },
  { id: 'completed-5d', label: 'Runs completed / 5d', value: five },
];
/**
 * @description A run item exactly as routes/home-summary.js builds it: detail '<status> / started <iso or date unavailable>',
 * the one prepare-document offer whose notes are the detail and the lane sentence (clip collapses the newline to a space).
 * NUMERIC columns reach the route as text ('88.50', '0.042100'); a null or zero cost is written 'unknown'.
 * @returns {object} The item.
 */
const run = (name, status, started, done, asked, model, score, mode, cost) => {
  const detail = status + ' / started ' + started;
  const body = 'Recorded lanes ' + done + ' of ' + asked + '. Best recorded successful lane by score: ' + (model || 'model not captured') + '; score ' + (score || 'unavailable') + '; judge mode ' + (mode || 'unknown') + '; observed USD cost ' + (Number(cost) > 0 ? cost : 'unknown') + '. Compare rubric and unscored lanes in Bake-Off before selecting a model.';
  return { text: name, detail, tone: status === 'failed' ? 'warn' : 'neutral', fix: 'bake-off-home', actions: [{ integration: 'prepare-document', context: { title: name, notes: detail + ' ' + body } }] };
};
const OWNERSHIP = { text: 'Benchmark jobs and runs are owner-scoped through their parent job, and each result must match the same owner. A missing or zero observed lane cost stays unknown, never free. The selected lane is only the best scored successful observation in that run, not a universal model recommendation. Prepare a comparison document without running a benchmark or changing providers.', tone: 'neutral', fix: 'bake-off-home' };
const NO_WORK = { text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: 'bake-off-home' };
const NOT_CHECKED = { text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'bake-off-home' };
/** @returns {object} A home summary as the route answers it: tiles mirror metrics, run items first, the notes last. */
const summary = (m, items, partial) => ({ metrics: m, tiles: m, items, asOf: NOW, partial: !!partial });
/** @returns {object} A saved job as GET /jobs returns it (bake-off-store toJob: numbers, JSONB arrays, ISO instants). */
const job = (name, bar, volume, lanes, created) => ({ id: 'job-' + name.length, ownerSub: 'synthetic-sub', name, prompt: 'Synthetic prompt long enough to separate one lane from another.', rubric: ['Synthetic criterion'], reference: null, qualityBar: bar, monthlyVolume: volume, laneAgentIds: lanes, createdAt: created, updatedAt: created });
const RUNS = [
  run('Synthetic ticket triage', 'running', '2026-09-28T11:00:00.000Z', 0, 4, 'claude-sonnet-4-5', '88.50', 'llm', '0.042100'),
  run('Synthetic release notes', 'complete', '2026-09-27T09:00:00.000Z', 3, 3, 'qwen2.5:7b', '74.00', 'lexical-fallback', '0.000400'),
  run('Synthetic SQL review', 'failed', 'date unavailable', 0, 3, null, null, null, null),
];
const JOBS = { jobs: [
  job('Synthetic ticket triage', 80, 1200, [], '2026-09-20T10:00:00.000Z'),
  job('Synthetic release notes', 72.5, 30, ['lane-a', 'lane-b'], '2026-09-10T10:00:00.000Z'),
  job('Synthetic SQL review', 70, 1, ['lane-c'], '2026-09-01T10:00:00.000Z'),
] };
const OK = { [H]: summary(metrics('3', '1', '1', '2'), RUNS.concat([OWNERSHIP])), [J]: JOBS };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const build = (body, jobs) => loadCompany({ [H]: body, [J]: jobs === undefined ? JOBS : jobs }).company({});

test('on open the view reads only the home summary and the saved jobs: never a write, a run, a verdict, the lane roster or the connected-actions plan', async () => {
  const view = loadCompany(OK);
  await view.company({});
  assert.deepEqual(view.urls, ['GET ' + H, 'GET ' + J]);
  assert.doesNotMatch(block, /\/run\b|\/verdict|\/lanes|home-plan|method: 'POST'|method: 'DELETE'/, 'no start, narration, roster, plan or write path in the view');
});

test('the stats are the route\x27s four counts with their tones, and the runs table reads the detail and the lane sentence', async () => {
  const model = await loadCompany(OK).company({});
  assert.deepEqual([model.kicker, model.title, model.actions.map((a) => a.label)], ['Engineering · AI Bake-Off', '1 benchmark run in progress', ['Open AI Bake-Off Review']]);
  assert.match(model.lede, /never starts a run or spends on a model\.$/);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null, x.hint || null]), [
    ['saved-benchmarks', 'Saved benchmarks', '3', null, null],
    ['runs-active', 'Benchmarks running', '1', null, null],
    ['runs-failed', 'Failed benchmark runs', '1', 'warn', null],
    ['completed-5d', 'Runs completed / 5d', '2', 'ok', null],
  ]);
  const runs = section(model, 'runs');
  assert.deepEqual(runs.columns.map((c) => (typeof c === 'string' ? c : c.label)), ['Benchmark', 'Status', 'Lanes recorded', 'Best scored lane', 'Score', 'Judge', 'Observed cost', 'Started']);
  assert.deepEqual(runs.rows, [
    ['Synthetic ticket triage', { text: 'running', tone: null }, '0 of 4', 'claude-sonnet-4-5', '88.5', { text: 'LLM judge', tone: null }, 'M(0.0421)', 'W(2026-09-28T11:00:00.000Z)'],
    ['Synthetic release notes', { text: 'complete', tone: 'ok' }, '3 of 3', 'qwen2.5:7b', '74', { text: 'lexical fallback', tone: 'warn' }, '< M(0.01)', 'W(2026-09-27T09:00:00.000Z)'],
    ['Synthetic SQL review', { text: 'failed', tone: 'warn' }, '0 of 3', 'model not captured', 'unavailable', { text: 'unknown', tone: null }, 'unknown', 'date unavailable'],
  ]);
  assert.match(runs.note, /a missing or zero observed cost stays unknown, never free\./);
  const saved = section(model, 'benchmarks');
  assert.deepEqual(saved.columns.map((c) => (typeof c === 'string' ? c : c.label)), ['Benchmark', 'Quality bar', 'Runs / month', 'Lanes', 'Saved']);
  assert.deepEqual(saved.rows, [
    ['Synthetic ticket triage', '80 / 100', 'N(1200)', 'Every reachable lane', 'W(2026-09-20T10:00:00.000Z)'],
    ['Synthetic release notes', '72.5 / 100', 'N(30)', '2 chosen lanes', 'W(2026-09-10T10:00:00.000Z)'],
    ['Synthetic SQL review', '70 / 100', 'N(1)', '1 chosen lane', 'W(2026-09-01T10:00:00.000Z)'],
  ]);
  assert.equal(saved.note, null);
  assert.deepEqual(section(model, 'notes').items.map((i) => [i.title, i.tone]), [[OWNERSHIP.text, null]]);
});

test('the title names the account\x27s state: latest failed, completed in 5 days, none completed in 5 days, saved but never run, nothing saved', async () => {
  const failed = await build(summary(metrics('3', '0', '1', '2'), [RUNS[2], RUNS[1], OWNERSHIP]));
  assert.equal(failed.title, 'The latest benchmark run failed');
  const done = await build(summary(metrics('3', '0', '1', '2'), [RUNS[1], RUNS[2], OWNERSHIP]));
  assert.deepEqual([done.title, stat(done, 'completed-5d').tone], ['2 benchmark runs completed in 5 days', 'ok']);
  const one = await build(summary(metrics('1', '0', '0', '1'), [RUNS[1], OWNERSHIP]));
  assert.deepEqual([one.title, stat(one, 'runs-failed').tone || null], ['1 benchmark run completed in 5 days', null]);
  const stale = await build(summary(metrics('1', '0', '0', '0'), [RUNS[1], OWNERSHIP]));
  assert.equal(stale.title, 'No benchmark run completed in 5 days');
  const unrun = await build(summary(metrics('2', '0', '0', '0'), [NO_WORK, OWNERSHIP]));
  assert.deepEqual([unrun.title, section(unrun, 'runs').rows.length, section(unrun, 'runs').empty], ['2 saved benchmarks, none run yet', 0, 'No benchmark runs recorded yet. A run starts in AI Bake-Off, never from this view.']);
  const none = await build(summary(metrics('0', '0', '0', '0'), [NO_WORK, OWNERSHIP]), { jobs: [] });
  assert.deepEqual([none.title, section(none, 'benchmarks').rows.length, section(none, 'benchmarks').empty], ['No saved benchmarks yet', 0, 'No saved benchmarks yet.']);
  assert.deepEqual(section(none, 'notes').items.map((i) => [i.title, i.tone]), [[NO_WORK.text, null], [OWNERSHIP.text, null]]);
});

test('a lane sentence that does not match leaves the lane columns unknown; more than eight saved benchmarks are named', async () => {
  const odd = { text: 'Synthetic odd run', detail: 'complete / started 2026-09-26T08:00:00.000Z', tone: 'neutral', fix: 'bake-off-home', actions: [{ integration: 'prepare-document', context: { title: 'Synthetic odd run', notes: 'Synthetic unrelated sentence.' } }] };
  const many = { jobs: Array.from({ length: 9 }, (_, i) => job('Synthetic job ' + i, 70, 10, [], '2026-09-0' + (i + 1) + 'T10:00:00.000Z')) };
  const model = await build(summary(metrics('9', '0', '0', '1'), [odd, OWNERSHIP]), many);
  assert.deepEqual(section(model, 'runs').rows, [['Synthetic odd run', { text: 'complete', tone: 'ok' }, '—', '—', '—', '—', '—', 'W(2026-09-26T08:00:00.000Z)']]);
  assert.deepEqual([section(model, 'benchmarks').rows.length, section(model, 'benchmarks').note], [8, 'The newest 8 of 9 saved benchmarks.']);
});

test('a /jobs answer at the 200-row cap never names 200 as the total: the summary count when readable, otherwise at least 200', async () => {
  // bake-off-store listJobs answers ORDER BY created_at DESC LIMIT 200, so an account with 250 saved benchmarks gets 200 rows.
  const capped = { jobs: Array.from({ length: 200 }, (_, i) => job('Synthetic job ' + i, 70, 10, [], '2026-09-01T10:00:00.000Z')) };
  const counted = await build(summary(metrics('250', '0', '0', '1'), [RUNS[1], OWNERSHIP]), capped);
  assert.deepEqual([section(counted, 'benchmarks').rows.length, section(counted, 'benchmarks').note], [8, 'The newest 8 of 250 saved benchmarks.']);
  const unchecked = await build(summary(metrics('Unavailable', '0', '0', '1'), [RUNS[1], NOT_CHECKED, OWNERSHIP], true), capped);
  assert.deepEqual([section(unchecked, 'benchmarks').rows.length, section(unchecked, 'benchmarks').note], [8, 'The newest 8 of at least 200 saved benchmarks.']);
  // A count taken before a benchmark saved between the two reads is smaller than the list: the list length is named, never less.
  const raced = await build(summary(metrics('9', '0', '0', '1'), [RUNS[1], OWNERSHIP]), { jobs: capped.jobs.slice(0, 10) });
  assert.equal(section(raced, 'benchmarks').note, 'The newest 8 of 10 saved benchmarks.');
});

test('a source the route could not check reads as not checked; an unreadable saved-benchmarks list is named, never shown as empty', async () => {
  const some = await build(summary(metrics('Unavailable', '0', '0', '1'), [RUNS[1], NOT_CHECKED, OWNERSHIP], true));
  assert.equal(some.title, 'Some saved sources cannot be checked');
  assert.deepEqual([stat(some, 'saved-benchmarks').value, stat(some, 'saved-benchmarks').tone, stat(some, 'saved-benchmarks').hint], ['Unavailable', 'warn', 'Could not be checked']);
  assert.deepEqual([section(some, 'runs').rows.length, section(some, 'notes').items.map((i) => [i.title, i.tone])], [1, [[NOT_CHECKED.text, 'warn'], [OWNERSHIP.text, null]]]);
  const noRows = await build(summary(metrics('1', 'Unavailable', 'Unavailable', 'Unavailable'), [NOT_CHECKED, OWNERSHIP], true));
  assert.deepEqual([noRows.title, section(noRows, 'runs').empty], ['Some saved sources cannot be checked', 'Some saved sources cannot be checked.']);
  const down = await build(summary(metrics('3', '0', '0', '1'), [RUNS[1], OWNERSHIP]), { http: 500, body: { error: 'internal error' } });
  assert.deepEqual([section(down, 'benchmarks').rows.length, section(down, 'benchmarks').empty], [0, 'The saved benchmarks cannot be read right now (HTTP 500).']);
  const denied = await build(summary(metrics('3', '0', '0', '1'), [RUNS[1], OWNERSHIP]), { http: 403, body: {} });
  assert.equal(section(denied, 'benchmarks').empty, 'The saved benchmarks were refused for this account (HTTP 403).');
  const offline = await build(summary(metrics('3', '0', '0', '1'), [RUNS[1], OWNERSHIP]), { reject: true });
  assert.deepEqual([offline.title, section(offline, 'benchmarks').empty], ['1 benchmark run completed in 5 days', 'The saved benchmarks cannot be read right now.']);
});

test('a refusal and a failure each read as what they are', async () => {
  const signedOut = await build({ http: 401, body: { error: 'not_authenticated' } });
  assert.deepEqual([signedOut.title, signedOut.sections, signedOut.stats], ['Sign in to see benchmark runs', undefined, undefined]);
  const denied = await build({ http: 403, body: {} });
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open AI Bake-Off', 'The AI Bake-Off routes refused this account (HTTP 403).']);
  // Every source failed: the route answers 503 with its own body (counts Unavailable, the not-checked note) and no error field.
  await assert.rejects(build({ http: 503, body: summary(metrics('Unavailable', 'Unavailable', 'Unavailable', 'Unavailable'), [NOT_CHECKED, OWNERSHIP], true) }), /^Error: Saved evidence cannot be checked right now \(HTTP 503\)\.$/);
  await assert.rejects(build({ http: 500, body: undefined }), /^Error: Saved evidence cannot be checked right now \(HTTP 500\)\.$/, 'a non-JSON failure keeps its status');
  await assert.rejects(build({ http: 502, body: { error: 'Synthetic summary offline' } }), /^Error: Synthetic summary offline$/, 'a failure with its own error keeps it');
});

/**
 * @description A stub element with the members the page's module script touches on start; listeners are counted.
 * @param {{ listeners: number }} calls The shared counters.
 * @returns {object} The element.
 */
function node(calls) { return { value: '', textContent: '', className: '', disabled: false, append() {}, replaceChildren() {}, addEventListener() { calls.listeners++; } }; }

/**
 * @description Run the page's module script (imports stripped) against stub modules, a stub DOM and a stub fetch. The
 * script awaits at top level, so it runs as an async function body.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {Promise<{ mounted: number, listeners: number, reads: string[] }>} Connected-actions mounts, listeners bound and every URL fetched.
 */
async function runModule(activeView) {
  const open = html.indexOf('<script type="module">'), src = html.slice(open + 22, html.indexOf('</script>', open)).replace(/^import .*$/gm, '');
  const calls = { mounted: 0, listeners: 0, reads: [] };
  const AsyncFunction = (async () => {}).constructor;
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ metrics: [], items: [] }) }); };
  const doc = { querySelector: () => node(calls), createElement: () => node(calls) };
  await new AsyncFunction('window', 'AppView', 'document', 'fetch', 'receiveHandoff', 'mountConnectedActions', src)(
    { AppView: { active: () => activeView } }, { active: () => activeView }, doc, fetchStub, () => {}, () => { calls.mounted++; return Promise.resolve(); });
  return calls;
}

test('under an audience view the page\x27s module script mounts nothing, binds nothing and reads nothing; the full page still runs every start step', async () => {
  assert.deepEqual(await runModule('company'), { mounted: 0, listeners: 0, reads: [] });
  assert.deepEqual(await runModule(null), { mounted: 1, listeners: 1, reads: ['GET /api/bake-off/home-summary'] });
});
