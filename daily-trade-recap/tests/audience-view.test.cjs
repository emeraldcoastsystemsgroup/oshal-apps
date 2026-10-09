/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company view asserted as behaviour: the head block runs against a stub kit and a stub fetch, so the tests prove what it reads on open (only GET /home-summary; never the framework plan that lists connected-actions offers, never a write), that the stats are the route's own four counts with their tones, that the title names the week's state (sessions with no recap, every session recapped, no closed session, sources that could not be checked), that the sessions table names each closed Eastern trading day through AppView.day (to_char emits a calendar day, never an instant) with whether and when its recap was recorded, that the review list names each parked ticket with its status and wait and says when the backlog is longer than the three tickets the route lists, and that a partly unreadable record, a 401, a 403 and a failed read each read as what they are. The page's module script (top-level await, so run as an async function body) is proved to register no handoff listener, mount no connected actions and read nothing under the view while the full page still runs every start step.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The expected lede names the window as routes/home-summary.js defines it: the closed Eastern trading days in the last 7 days, today excluded (et_day between today-6 and today-1 Eastern, at most five sessions in a normal week, LIMIT 5 listed). The previous wording read as seven sessions, which the data never is.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'daily-trade-recap';
const PAGE = 'tools/review.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/daily-trade-recap"];
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
 * paints and the reads it makes. The stub formatters tag their input: W = AppView.when, D = AppView.day, T = AppView.date.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead.
 * @returns {{ company: Function, urls: string[] }} The builder and every request made.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', day: (v) => 'D(' + v + ')', date: (v) => 'T(' + v + ')' };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url], status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, urls };
}

const H = '/api/daily-trade-recap/home-summary';
const NOW = '2026-09-28T21:30:00.000Z';
/** The route's closing note (routes/home-summary.js): the last item, carrying no actions. */
const BOUNDS = { text: 'Counts exact-owner Eastern trading days: sessions recorded by the trading schedule, published reports recorded by the recap pipeline, and recap tickets parked at their approval gate. Today is excluded because the after-close recap has not run yet. A recorded report is not proof that an email arrived or a video was published. Review actions prepare a production handoff; Home never reruns the existing render/email pipeline.', tone: 'neutral', fix: 'recap-review' };
const EMPTY_NOTE = { text: 'No recorded trading session in the window. Open the app to begin.', tone: 'neutral', fix: 'recap-review' };
const PARTIAL_NOTE = { text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'recap-review' };
/** @returns {object[]} The route's four metrics in its order, which it mirrors as tiles. */
const tiles = (missed, recorded, sessions, review) => [
  { id: 'recaps-missed', label: 'Sessions with no recap / 7 days', value: missed },
  { id: 'recaps-recorded', label: 'Recaps recorded / 7 days', value: recorded },
  { id: 'trading-sessions', label: 'Trading sessions / 7 days', value: sessions },
  { id: 'recaps-awaiting-review', label: 'Recaps awaiting review', value: review },
];
/** @returns {object[]} The two preparation offers the route attaches to every session and ticket item. */
const offers = (title, notes) => ['prepare-document', 'prepare-episode'].map((integration) => ({ integration, context: { title, notes } }));
/** @returns {object} A closed session whose recap was recorded, as the route writes it (session_day is a calendar day). */
const recorded = (day, at) => ({ text: 'Recap recorded for ' + day, detail: 'recorded ' + at, tone: 'neutral', fix: 'recap-review', actions: offers('Recap recorded for ' + day, 'recorded ' + at) });
/** @returns {object} A closed session with no published report, as the route writes it. */
const missing = (day) => ({ text: 'No recap recorded for ' + day, detail: 'closed session with no published report', tone: 'warn', fix: 'recap-review', actions: offers('No recap recorded for ' + day, 'closed session with no published report') });
/** @returns {object} A recap ticket parked at its approval gate, as the route writes it. */
const ticket = (title, at) => ({ text: title, detail: 'approval_required since ' + at, tone: 'warn', fix: 'recap-review', actions: offers(title, 'approval_required since ' + at) });
/** @returns {object} A home summary: tiles mirror metrics, sessions newest first, tickets, then the notes, as the route orders them. */
const summary = (m, items, partial) => ({ metrics: m, tiles: m, items, asOf: NOW, partial: !!partial });
const R1 = '2026-09-25T21:40:00.000Z', R3 = '2026-09-23T21:38:00.000Z', T1 = '2026-06-12T22:05:00.000Z';
const SUMMARY = summary(tiles('1', '2', '3', '1'), [recorded('2026-09-25', R1), missing('2026-09-24'), recorded('2026-09-23', R3), ticket('Synthetic recap ticket', T1), BOUNDS]);
const OK = { [H]: SUMMARY };
const LEDE = 'Closed Eastern trading days in the last 7 days for the signed-in owner, today excluded. ';
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);

test('on open the view reads only the home summary: never the framework plan for connected actions, never a write', async () => {
  const view = loadCompany(OK);
  await view.company({});
  assert.deepEqual(view.urls, ['GET ' + H]);
});

test('the stats are the route\x27s own four counts, the title names the week, and the sessions table names each closed day (a calendar day, never an instant) with whether and when its recap was recorded', async () => {
  const model = await loadCompany(OK).company({});
  assert.deepEqual([model.kicker, model.title, model.lede, model.actions.map((a) => a.label)],
    ['Finance · Daily Trade Recap', '1 closed session with no recap', LEDE + '1 recap ticket parked at its approval gate.', ['Open Recap Review']]);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null, x.hint || null]), [
    ['recaps-missed', 'Sessions with no recap / 7 days', '1', 'warn', null],
    ['recaps-recorded', 'Recaps recorded / 7 days', '2', 'ok', null],
    ['trading-sessions', 'Trading sessions / 7 days', '3', null, null],
    ['recaps-awaiting-review', 'Recaps awaiting review', '1', 'warn', null],
  ]);
  const sessions = section(model, 'sessions');
  assert.deepEqual(sessions.columns, ['Session', 'Recap', 'Recorded']);
  assert.deepEqual(sessions.rows.map((r) => [r[0], r[1].text, r[1].tone, r[2]]), [
    ['D(2026-09-25)', 'Recorded', 'ok', 'W(' + R1 + ')'],
    ['D(2026-09-24)', 'Missing', 'warn', '—'],
    ['D(2026-09-23)', 'Recorded', 'ok', 'W(' + R3 + ')'],
  ]);
  assert.ok(sessions.rows.every((r) => /^D\(\d{4}-\d{2}-\d{2}\)$/.test(r[0])), 'a session day goes through AppView.day, never AppView.date or AppView.when');
  assert.equal(sessions.note, BOUNDS.text);
});

test('the review list names each parked ticket with its status and wait, and says when the backlog is longer than the tickets the route lists', async () => {
  const review = section(await loadCompany(OK).company({}), 'review');
  assert.deepEqual(review.items.map((i) => [i.title, i.text, i.badge, i.tone]), [['Synthetic recap ticket', 'Approval required since W(' + T1 + ')', 'Parked', 'warn']]);
  assert.equal(review.note, 'Approving or cancelling a parked ticket is the only thing that clears it; this view changes nothing.');
  const more = await loadCompany({ [H]: summary(tiles('0', '3', '3', '5'), [recorded('2026-09-25', R1), ticket('Synthetic a', T1), ticket('Synthetic b', T1), ticket('Synthetic c', T1), BOUNDS]) }).company({});
  assert.deepEqual([section(more, 'review').items.length, / The newest 3 of 5\.$/.test(section(more, 'review').note), more.lede],
    [3, true, LEDE + '5 recap tickets parked at their approval gates.']);
});

test('every session recapped, no closed session and a partly unreadable record each read as what they are', async () => {
  const all = await loadCompany({ [H]: summary(tiles('0', '3', '3', '0'), [recorded('2026-09-25', R1), recorded('2026-09-24', R1), recorded('2026-09-23', R3), BOUNDS]) }).company({});
  assert.deepEqual([all.title, all.lede, stat(all, 'recaps-missed').tone || null, section(all, 'review').items.length, section(all, 'review').empty],
    ['Every closed session has a recap', LEDE + 'No recap ticket is parked at its approval gate.', null, 0, 'No recap ticket is parked at its approval gate.']);
  const none = await loadCompany({ [H]: summary(tiles('0', '0', '0', '0'), [EMPTY_NOTE, BOUNDS]) }).company({});
  assert.deepEqual([none.title, section(none, 'sessions').rows.length, section(none, 'sessions').empty, section(none, 'sessions').note],
    ['No closed trading session in the last 7 days', 0, 'No closed trading session in the last 7 days. A market holiday records no session.', BOUNDS.text]);
  const partial = await loadCompany({ [H]: summary(tiles('Unavailable', 'Unavailable', 'Unavailable', '0'), [PARTIAL_NOTE, BOUNDS], true) }).company({});
  assert.deepEqual([partial.title, section(partial, 'sessions').empty, stat(partial, 'trading-sessions').tone, stat(partial, 'trading-sessions').hint, stat(partial, 'recaps-awaiting-review').tone || null],
    ['Some saved sources cannot be checked', 'Closed sessions could not be checked.', 'warn', 'Could not check', null]);
  const backlog = await loadCompany({ [H]: summary(tiles('0', '2', '2', 'Unavailable'), [recorded('2026-09-25', R1), recorded('2026-09-24', R1), PARTIAL_NOTE, BOUNDS], true) }).company({});
  assert.deepEqual([backlog.title, /The approval backlog could not be checked\.$/.test(backlog.lede), section(backlog, 'review').empty, section(backlog, 'sessions').rows.length],
    ['Some saved sources cannot be checked', true, 'The approval backlog could not be checked.', 2]);
});

test('a refusal and a failure each read as what they are', async () => {
  const signedOut = await loadCompany({ [H]: { http: 401, body: { error: 'not_authenticated' } } }).company({});
  assert.deepEqual([signedOut.title, signedOut.sections, signedOut.stats], ['Sign in to see the recap record', undefined, undefined]);
  const denied = await loadCompany({ [H]: { http: 403, body: {} } }).company({});
  assert.equal(denied.title, 'This account cannot open Daily Trade Recap');
  const down = summary(tiles('Unavailable', 'Unavailable', 'Unavailable', 'Unavailable'), [PARTIAL_NOTE, BOUNDS], true);
  await assert.rejects(loadCompany({ [H]: { http: 503, body: down } }).company({}), /^Error: Daily Trade Recap could not read the saved record \(HTTP 503\)\.$/, 'every source failed: the route answers 503');
  await assert.rejects(loadCompany({ [H]: { http: 500, body: undefined } }).company({}), /^Error: Daily Trade Recap could not read the saved record \(HTTP 500\)\.$/, 'an answer that is not JSON');
  await assert.rejects(loadCompany({ [H]: { http: 502, body: { error: 'Synthetic outage' } } }).company({}), /^Error: Synthetic outage$/, 'a named error is shown as sent');
});

/** @returns {object} A stub element with the members the page's module script touches on start. */
function node() { return { value: '', textContent: '', className: '', disabled: false, append() {}, replaceChildren() {}, addEventListener() {} }; }

/**
 * @description Run the page's module script (imports stripped) against stub modules, a stub DOM and a stub fetch. The
 * script awaits at top level, so it runs as an async function body.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {Promise<{ handoffs: number, mounted: number, reads: string[] }>} Handoff listeners registered, connected-action mounts and every URL fetched.
 */
async function runModule(activeView) {
  const open = html.indexOf('<script type="module">'), src = html.slice(open + 22, html.indexOf('</script>', open)).replace(/^import .*$/gm, '');
  const calls = { handoffs: 0, mounted: 0, reads: [] };
  const AsyncFunction = (async () => {}).constructor;
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ metrics: [], items: [] }) }); };
  await new AsyncFunction('window', 'AppView', 'document', 'fetch', 'receiveHandoff', 'mountConnectedActions', src)(
    { AppView: { active: () => activeView } }, { active: () => activeView }, { querySelector: node, createElement: node }, fetchStub, () => { calls.handoffs++; }, () => { calls.mounted++; return Promise.resolve(); });
  return calls;
}

test('under an audience view the page\x27s module script registers no handoff listener, mounts nothing and reads nothing; the full page still runs every start step', async () => {
  assert.deepEqual(await runModule('company'), { handoffs: 0, mounted: 0, reads: [] });
  assert.deepEqual(await runModule(null), { handoffs: 1, mounted: 1, reads: ['GET ' + H] });
});
