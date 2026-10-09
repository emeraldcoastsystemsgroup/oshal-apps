/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company view asserted as behaviour: the head block runs against a stub kit and a stub fetch, so the tests prove what it reads on open (only GET /home-summary and GET /meeting-briefs; never POST /sync, the one write on this page, which asks Google), that the stats are the route's own saved-event tiles plus the last sync, that the events table names each event's day and its clock time or "All day" from the route's detail string, that the briefs list names the meeting, its time and whether it was cited (newest first as the route orders them, capped at ten), and that not synced, an empty snapshot, no delivered brief, a 401, a 403, a failed summary read and a failed briefs read each read as what they are. The page's module script (top-level await, so run as an async function body) is proved to mount no connected actions and read nothing under the view while the full page still runs every start step.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The Day column's formatter is asserted per start shape: the stub kit tags AppView.date as T, an all-day start ('YYYY-MM-DD', Google's start.date) must go through AppView.day and a timed start (an RFC3339 instant, Google's start.dateTime) through AppView.date, with a timed midnight-UTC start ('...T00:00:00.000Z', what a UTC-zone calendar emits) in the summary proving it is never read as a calendar day, which would have printed the UTC day beside a local clock time of the evening before.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | The family view (the Jarvis shell) beside the company view: the boot declares exactly company and family; the family builder is asserted over a stub fetch AND over the package's REAL compiled handlers (routes/home-summary.js and routes/meeting-brief-view.js with only express stubbed, over a seeded pool, every body JSON round-tripped), so its reads are exactly GET /home-summary and GET /meeting-briefs, the routes run only SELECTs pinned to the caller, and the model is proved over the fields the routes really return. Asserted: "Coming up" in plain words with each all-day start through AppView.day and each timed start through AppView.date plus the clock and AppView.when (a midnight-UTC timed start never read as a calendar day), the three-of-N note against the thirty-day tile, the briefs in plain words capped at five, and not synced ("Nothing on the calendar yet", with the full page's own Google link in a new tab), an empty snapshot, nothing in five days, no brief, the real 401, a 403, the real 503 and a non-JSON 500 each named; the page's module script mounts nothing and reads nothing under the family view.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'calendar';
const PAGE = 'tools/review.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/calendar"];
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
 * @description Run the head block against a stub kit and the given fetch, and hand back what it booted. The stub
 * formatters tag their input: W = AppView.when, D = AppView.day, T = AppView.date.
 * @param {Function} fetchStub The fetch the block's reads go through.
 * @returns {object} The spec the block passed to AppView.boot.
 */
function runBlock(fetchStub) {
  let config = null;
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', day: (v) => 'D(' + v + ')', date: (v) => 'T(' + v + ')' };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && config.audiences, 'the block boots the kit');
  return config;
}

/**
 * @description A fetch answered from a URL table, recording every request as '<METHOD> <url>'.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead.
 * @param {string[]} urls Receives every request made.
 * @returns {Function} The stub fetch.
 */
function stubFetch(answers, urls) {
  return (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url], status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
}

/**
 * @description Run the head block against a stub kit and a stub fetch, so the company view is asserted as the model it
 * paints and the reads it makes.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead.
 * @returns {{ company: Function, urls: string[] }} The builder and every request made.
 */
function loadCompany(answers) {
  const urls = [], config = runBlock(stubFetch(answers, urls));
  assert.ok(typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, urls };
}

/**
 * @description The family builder over a stub fetch, as loadCompany gives the company builder.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead.
 * @returns {{ family: Function, urls: string[] }} The builder and every request made.
 */
function loadFamily(answers) {
  const urls = [], config = runBlock(stubFetch(answers, urls));
  assert.ok(typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls };
}

const H = '/api/calendar/home-summary', B = '/api/calendar/meeting-briefs';
const SYNCED = '2026-09-28T10:00:00.000Z';
/** @returns {string} An event item's detail exactly as calendarEvidence (routes/home-summary.js) writes it. */
const detail = (startAt, allDay) => startAt + (allDay ? ' / all day' : '') + ' / synced ' + SYNCED;
/** @returns {object} An event item with the four planning offers the route attaches. */
const event = (title, startAt, allDay) => ({ text: title, detail: detail(startAt, allDay), fix: 'calendar-review', actions: ['plan-gift', 'plan-meal', 'plan-trip', 'prepare-meeting'].map((integration) => ({ integration, context: { title, notes: detail(startAt, allDay) } })) });
const NOTE = { text: 'Saved primary-calendar snapshot, up to 250 events. Sync explicitly for changes; this is not a complete multi-calendar agenda.', fix: 'calendar-review', tone: 'neutral' };
const CONNECT = { text: 'Connect Google in Identity, then open Calendar and sync upcoming events.', fix: 'calendar-review', tone: 'neutral' };
/** @returns {object[]} The route's two metrics, which it mirrors as tiles. */
const tiles = (five, thirty) => [{ id: 'upcoming-5d', label: 'Saved events / 5d', value: five }, { id: 'upcoming-30d', label: 'Saved events / 30d', value: thirty }];
/** @returns {object} A home summary: tiles mirror metrics, event items first, the note last, as the route orders them. */
const summary = (counts, items) => ({ metrics: tiles(counts[0], counts[1]), tiles: tiles(counts[0], counts[1]), items, asOf: SYNCED, partial: false });
// The midnight-UTC timed event is the shape a UTC-zone calendar emits ('Z'-suffixed dateTime): AppView.day would read it as
// that UTC calendar day, which is the evening before west of Greenwich, so the Day column must route it through AppView.date.
const SUMMARY = summary(['2', '4'], [event('Synthetic standup', '2026-09-29T14:00:00.000Z', false), event('Synthetic offsite', '2026-10-01', true), event('Synthetic midnight call', '2026-10-05T00:00:00.000Z', false), event('Synthetic board review', '2026-10-10T16:30:00.000Z', false), NOTE]);
const NOT_SYNCED = summary(['Not synced', 'Not synced'], [CONNECT]);
const BRIEFS = { briefs: [
  { eventId: 'evt-1', title: 'Synthetic weekly sync', startsAt: '2026-09-29T15:00:00.000Z', builtAt: '2026-09-28T15:00:00.000Z', hasHistory: true, citations: 2, deliveryText: 'Synthetic brief.' },
  { eventId: 'evt-0', title: 'Synthetic kickoff', startsAt: '2026-09-22T15:00:00.000Z', builtAt: '2026-09-21T15:00:00.000Z', hasHistory: false, citations: 0, deliveryText: 'No prior context recorded for this meeting.' },
  { eventId: 'evt-2', title: 'Synthetic one-to-one', startsAt: '2026-09-20T15:00:00.000Z', builtAt: '2026-09-19T15:00:00.000Z', hasHistory: true, citations: 1, deliveryText: 'Synthetic brief.' },
], note: 'Each brief is the exact text that was delivered for that meeting.' };
const OK = { [H]: SUMMARY, [B]: BRIEFS };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);

test('on open the view reads only the home summary and the delivered briefs: never a sync, never Google', async () => {
  const view = loadCompany(OK);
  await view.company({});
  assert.deepEqual([...view.urls].sort(), ['GET ' + H, 'GET ' + B].sort());
  assert.ok(!view.urls.some((u) => /^POST |sync|google/i.test(u)), 'no write and no provider call');
});

test('the stats are the route\x27s own saved-event tiles plus the last sync, and the events table names each day (a calendar day only when all day) and time or all day', async () => {
  const model = await loadCompany(OK).company({});
  assert.deepEqual([model.kicker, model.title, model.lede, model.actions.map((a) => a.label)], ['Office · Calendar', 'Office calendar', NOTE.text, ['Open the full calendar']]);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null]), [['upcoming-5d', 'Saved events / 5d', '2', null], ['upcoming-30d', 'Saved events / 30d', '4', null], ['sync', 'Last sync', 'W(' + SYNCED + ')', 'ok']]);
  const events = section(model, 'events');
  assert.deepEqual(events.columns, ['Event', 'Day', 'Time']);
  // Only the all-day start ('YYYY-MM-DD', Google's start.date) is a date-only field; a timed start is an instant, formatted as a local date.
  assert.deepEqual(events.rows.map((r) => [r[0], r[1], r[2] === 'All day']), [['Synthetic standup', 'T(2026-09-29T14:00:00.000Z)', false], ['Synthetic offsite', 'D(2026-10-01)', true], ['Synthetic midnight call', 'T(2026-10-05T00:00:00.000Z)', false], ['Synthetic board review', 'T(2026-10-10T16:30:00.000Z)', false]]);
  assert.ok(!events.rows.some((r) => /^D\(.*T00:00:00/.test(r[1])), 'a timed midnight-UTC start is never read as a calendar day');
  assert.match(events.rows[0][2], /\d/, 'a timed event shows a clock time');
  assert.match(events.rows[2][2], /\d/, 'a timed midnight-UTC event shows a clock time, not All day');
  assert.match(events.note, /Attendees and descriptions are never saved\.$/);
});

test('not synced, an empty snapshot and no delivered brief each read as what they are', async () => {
  const none = await loadCompany({ ...OK, [H]: NOT_SYNCED }).company({});
  assert.deepEqual([none.title, none.lede, none.actions[0].label], ['Not synced yet', CONNECT.text, 'Sync from the full page']);
  assert.deepEqual(none.stats.map((x) => [x.id, x.value, x.tone, x.hint || null]), [['upcoming-5d', 'Not synced', 'warn', null], ['upcoming-30d', 'Not synced', 'warn', null], ['sync', 'Not synced', 'warn', 'Connect Google in Identity']]);
  assert.deepEqual([section(none, 'events').rows.length, section(none, 'events').empty], [0, 'Nothing saved yet. Sync from the full page to see upcoming events.']);
  const quiet = await loadCompany({ [H]: summary(['0', '0'], [NOTE]), [B]: { briefs: [], note: BRIEFS.note } }).company({});
  assert.deepEqual([quiet.title, stat(quiet, 'sync').value, stat(quiet, 'sync').tone, section(quiet, 'events').empty, section(quiet, 'briefs').items.length],
    ['Office calendar', 'Synced', 'ok', 'No saved events in the next 30 days.', 0]);
  assert.match(section(quiet, 'briefs').empty, /^No brief has been delivered yet\. Nothing is assembled until you turn the meeting-brief source on/);
});

test('the briefs list names the meeting, its time and whether it was cited, newest first as the route orders them, capped at ten', async () => {
  const briefs = section(await loadCompany(OK).company({}), 'briefs');
  assert.deepEqual(briefs.items.map((i) => [i.title, i.text, i.meta]), [
    ['Synthetic weekly sync', '2 cited sources · delivered W(2026-09-28T15:00:00.000Z)', 'W(2026-09-29T15:00:00.000Z)'],
    ['Synthetic kickoff', 'No prior context · delivered W(2026-09-21T15:00:00.000Z)', 'W(2026-09-22T15:00:00.000Z)'],
    ['Synthetic one-to-one', '1 cited source · delivered W(2026-09-19T15:00:00.000Z)', 'W(2026-09-20T15:00:00.000Z)'],
  ]);
  assert.equal(briefs.note, 'Each brief is the exact text that was delivered for that meeting. Read them on the full page.');
  const many = { briefs: Array.from({ length: 14 }, (_, i) => ({ eventId: 'm' + i, title: 'Synthetic ' + i, startsAt: SYNCED, builtAt: SYNCED, hasHistory: false, citations: 0, deliveryText: 'x' })), note: BRIEFS.note };
  const capped = section(await loadCompany({ ...OK, [B]: many }).company({}), 'briefs');
  assert.deepEqual([capped.items.length, / The latest 10 of 14\.$/.test(capped.note)], [10, true]);
});

test('a refusal and a failure each read as what they are, and a failed briefs read never hides the calendar', async () => {
  const signedOut = await loadCompany({ [H]: { http: 401, body: { error: 'not_authenticated' } }, [B]: { http: 401, body: { error: 'not_authenticated' } } }).company({});
  assert.deepEqual([signedOut.title, signedOut.sections, signedOut.stats], ['Sign in to see the office calendar', undefined, undefined]);
  const denied = await loadCompany({ ...OK, [H]: { http: 403, body: {} } }).company({});
  assert.equal(denied.title, 'This account cannot open Calendar');
  await assert.rejects(loadCompany({ ...OK, [H]: { http: 503, body: { error: 'Calendar snapshot unavailable' } } }).company({}), /^Error: Calendar snapshot unavailable$/, 'the route\x27s own error');
  await assert.rejects(loadCompany({ ...OK, [H]: { http: 500, body: undefined } }).company({}), /^Error: Calendar could not read the saved snapshot \(HTTP 500\)\.$/);
  const noBriefs = await loadCompany({ ...OK, [B]: { http: 503, body: { error: 'Meeting briefs are unavailable' } } }).company({});
  assert.deepEqual([noBriefs.title, section(noBriefs, 'briefs').items.length, section(noBriefs, 'briefs').empty, section(noBriefs, 'events').rows.length],
    ['Office calendar', 0, 'Delivered briefs could not be read (HTTP 503).', 4]);
  const briefsRefused = await loadCompany({ ...OK, [B]: { http: 401, body: {} } }).company({});
  assert.equal(section(briefsRefused, 'briefs').empty, 'Sign in to see delivered briefs.');
});

// ── The family view (the Jarvis shell): the same two reads, roomy and in plain words ─────────────────────────────────

test('family: on open the view reads only the home summary and the delivered briefs: never a sync, never Google', async () => {
  const view = loadFamily(OK);
  await view.family({});
  assert.deepEqual([...view.urls].sort(), ['GET ' + H, 'GET ' + B].sort());
  assert.ok(!view.urls.some((u) => /^POST |sync|google/i.test(u)), 'no write and no provider call');
});

test('family: "Coming up" names each event in plain words, an all-day start as its calendar day and a timed start as a local date, clock and relative time', async () => {
  const model = await loadFamily(OK).family({});
  assert.deepEqual([model.kicker, model.title, model.lede, model.actions.map((a) => a.label)], ['Your calendar', '2 events in the next 5 days',
    'Next: Synthetic standup, W(2026-09-29T14:00:00.000Z). Saved from your last sync, W(' + SYNCED + ').', ['Open the full calendar']]);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null]), [['upcoming-5d', 'Next 5 days', 2, null], ['upcoming-30d', 'Next 30 days', 4, null], ['sync', 'Last sync', 'W(' + SYNCED + ')', 'ok']]);
  const coming = section(model, 'coming-up');
  assert.deepEqual([coming.kind, coming.title], ['list', 'Coming up']);
  assert.deepEqual(coming.items.map((i) => [i.title, i.text.replace(/ at .*$/, ' at <clock>'), i.meta]), [
    ['Synthetic standup', 'T(2026-09-29T14:00:00.000Z) at <clock>', 'W(2026-09-29T14:00:00.000Z)'],
    ['Synthetic offsite', 'D(2026-10-01)', 'All day'],
    ['Synthetic midnight call', 'T(2026-10-05T00:00:00.000Z) at <clock>', 'W(2026-10-05T00:00:00.000Z)'],
    ['Synthetic board review', 'T(2026-10-10T16:30:00.000Z) at <clock>', 'W(2026-10-10T16:30:00.000Z)'],
  ]);
  assert.ok(coming.items.filter((i) => i.meta !== 'All day').every((i) => / at .*\d/.test(i.text)), 'a timed event shows a clock time');
  assert.ok(!coming.items.some((i) => /D\(.*T00:00:00/.test(i.text + i.meta)), 'a timed midnight-UTC start is never read as a calendar day');
  assert.equal(coming.note, 'Only titles and times are saved: never who is coming or what the event says.');
  assert.ok(!coming.items.some((i) => i.href), 'an event links nowhere: the full page does not link events out either');
});

test('family: the note says when the summary shows only the next few of the saved events, and nothing in five days reads as that', async () => {
  const three = [event('Synthetic retro', '2026-10-06T14:00:00.000Z', false), event('Synthetic fair', '2026-10-08', true), event('Synthetic review', '2026-10-09T14:00:00.000Z', false), NOTE];
  const model = await loadFamily({ ...OK, [H]: summary(['0', '9'], three) }).family({});
  assert.deepEqual([model.title, model.lede], ['Nothing in the next 5 days', 'Next: Synthetic retro, W(2026-10-06T14:00:00.000Z). Saved from your last sync, W(' + SYNCED + ').']);
  assert.equal(section(model, 'coming-up').note, 'The next 3 of 9 saved for the next 30 days. Only titles and times are saved: never who is coming or what the event says.');
  const allDayFirst = await loadFamily({ ...OK, [H]: summary(['1', '1'], [event('Synthetic holiday', '2026-09-30', true), NOTE]) }).family({});
  assert.deepEqual([allDayFirst.title, allDayFirst.lede], ['1 event in the next 5 days', 'Next: Synthetic holiday, all day D(2026-09-30). Saved from your last sync, W(' + SYNCED + ').']);
});

test('family: not synced, an empty snapshot and no delivered brief each read as what they are', async () => {
  const none = await loadFamily({ ...OK, [H]: NOT_SYNCED }).family({});
  assert.deepEqual([none.title, none.lede], ['Nothing on the calendar yet', 'Connect Google in Identity and sync from the full page.']);
  assert.deepEqual(none.actions.map((a) => [a.label, a.href || null, a.target || null, !!a.primary]), [['Sync from the full page', null, null, true], ['Manage Google connection', '/utilities', '_blank', false]]);
  assert.deepEqual(none.stats.map((x) => [x.id, x.value, x.tone || null, x.hint || null]), [['upcoming-5d', '—', null, null], ['upcoming-30d', '—', null, null], ['sync', 'Not yet', 'warn', 'Connect Google in Identity']]);
  assert.deepEqual([section(none, 'coming-up').items.length, section(none, 'coming-up').empty, section(none, 'coming-up').note],
    [0, 'Nothing on the calendar yet — connect Google in Identity and sync from the full page.', null]);
  const quiet = await loadFamily({ [H]: summary(['0', '0'], [NOTE]), [B]: { briefs: [], note: BRIEFS.note } }).family({});
  assert.deepEqual([quiet.title, quiet.lede, quiet.actions.map((a) => a.label), stat(quiet, 'sync').value, section(quiet, 'coming-up').empty],
    ['Nothing coming up', 'Your last sync saved nothing for the next 30 days.', ['Open the full calendar'], 'Synced', 'Nothing saved for the next 30 days.']);
  assert.deepEqual([section(quiet, 'briefs').items.length, section(quiet, 'briefs').note], [0, null]);
  assert.equal(section(quiet, 'briefs').empty, 'No meeting brief yet. They start once you turn on "Brief me before the meeting" in Jarvis briefing settings.');
});

test('family: the briefs name the meeting, when it is and whether anything was cited, in plain words, capped at five', async () => {
  const briefs = section(await loadFamily(OK).family({}), 'briefs');
  assert.deepEqual(briefs.items.map((i) => [i.title, i.text, i.meta]), [
    ['Synthetic weekly sync', '2 sources cited · sent W(2026-09-28T15:00:00.000Z)', 'W(2026-09-29T15:00:00.000Z)'],
    ['Synthetic kickoff', 'Nothing earlier recorded · sent W(2026-09-21T15:00:00.000Z)', 'W(2026-09-22T15:00:00.000Z)'],
    ['Synthetic one-to-one', '1 source cited · sent W(2026-09-19T15:00:00.000Z)', 'W(2026-09-20T15:00:00.000Z)'],
  ]);
  assert.equal(briefs.note, 'Read the whole brief on the full page.');
  const many = { briefs: Array.from({ length: 8 }, (_, i) => ({ eventId: 'm' + i, title: 'Synthetic ' + i, startsAt: SYNCED, builtAt: SYNCED, hasHistory: false, citations: 0, deliveryText: 'x' })), note: BRIEFS.note };
  const capped = section(await loadFamily({ ...OK, [B]: many }).family({}), 'briefs');
  assert.deepEqual([capped.items.length, capped.items[0].title, capped.note], [5, 'Synthetic 0', 'Read the whole brief on the full page. Showing the latest 5.']);
});

test('family: a refusal and a failure each read as what they are, and a failed briefs read never hides the calendar', async () => {
  const signedOut = await loadFamily({ [H]: { http: 401, body: { error: 'not_authenticated' } }, [B]: { http: 401, body: { error: 'not_authenticated' } } }).family({});
  assert.deepEqual([signedOut.kicker, signedOut.title, signedOut.sections, signedOut.stats, signedOut.actions], ['Your calendar', 'Sign in to see your calendar', undefined, undefined, undefined]);
  const denied = await loadFamily({ ...OK, [H]: { http: 403, body: {} } }).family({});
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Calendar', 'The Calendar routes refused this account (HTTP 403).']);
  await assert.rejects(loadFamily({ ...OK, [H]: { http: 503, body: { error: 'Calendar snapshot unavailable' } } }).family({}), /^Error: Calendar snapshot unavailable$/, 'the route\x27s own error');
  await assert.rejects(loadFamily({ ...OK, [H]: { http: 500, body: undefined } }).family({}), /^Error: Calendar could not read the saved snapshot \(HTTP 500\)\.$/);
  const noBriefs = await loadFamily({ ...OK, [B]: { http: 503, body: { error: 'Meeting briefs are unavailable' } } }).family({});
  assert.deepEqual([noBriefs.title, section(noBriefs, 'briefs').items.length, section(noBriefs, 'briefs').empty, section(noBriefs, 'coming-up').items.length],
    ['2 events in the next 5 days', 0, 'Meeting briefs could not be read right now (HTTP 503).', 4]);
  assert.equal(section(await loadFamily({ ...OK, [B]: { http: 401, body: {} } }).family({}), 'briefs').empty, 'Sign in to see meeting briefs.');
});

// ── The family view over the package's REAL handlers ────────────────────────────────────────────────────────────────

/**
 * @description Load one of this package's compiled route modules with only express stubbed, and build it over a pool,
 * as the core mounts it; the module's own SQL, owner pinning and body shape run unchanged.
 * @param {string} file The compiled module under routes/.
 * @param {string} factory Its exported route factory.
 * @param {object} pool The pool it queries.
 * @returns {Function} Its GET / handler.
 */
function realRoute(file, factory, pool) {
  let handler = null;
  const mod = { exports: {} };
  const shim = (request) => { if (request === 'express') return { Router: () => ({ get: (_p, h) => { handler = h; } }) }; throw new Error('unexpected require: ' + request); };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(ROOT, 'routes', file), 'utf8'))(shim, mod, mod.exports);
  mod.exports[factory]({ pool });
  assert.equal(typeof handler, 'function', file + ' registers GET /');
  return handler;
}

/**
 * @description A pool that answers the two SELECTs the view's routes issue from a seed keyed by owner, and records
 * every statement with its values.
 * @param {{ snapshots: object, briefs: object }} seed Rows per user_sub, briefs already in the route's starts_at DESC order.
 * @param {Array} sql Receives { text, values } per statement.
 * @param {string|null} failing 'all' fails every statement, 'briefs' only the briefs read (a statement timeout).
 * @returns {{ query: Function }} The pool.
 */
function seededPool(seed, sql, failing) {
  return { async query(q) {
    sql.push({ text: q.text.trim(), values: q.values });
    if (failing === 'all' || (failing === 'briefs' && /calendar_meeting_briefs/.test(q.text))) throw new Error('canceling statement due to statement timeout');
    if (/FROM calendar_preparation_snapshots WHERE user_sub = \$1$/.test(q.text)) return { rows: seed.snapshots[q.values[0]] ? [seed.snapshots[q.values[0]]] : [] };
    if (/FROM calendar_meeting_briefs\s+WHERE user_sub = \$1 ORDER BY starts_at DESC LIMIT \$2$/.test(q.text)) return { rows: (seed.briefs[q.values[0]] || []).slice(0, q.values[1]) };
    throw new Error('seeded pool cannot answer: ' + q.text.slice(0, 90));
  } };
}

/** @returns {object} A response recorder with the members both routes use. */
function recorder() { return { statusCode: 200, body: undefined, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; }

/**
 * @description The family builder with its fetch answered by the package's real home-summary and meeting-brief-view
 * handlers over a seeded pool, each body JSON round-tripped as Express sends it.
 * @param {{ seed: object, sub?: string, signedIn?: boolean, failing?: string|null }} opts Who asks and what the pool holds.
 * @returns {{ family: Function, urls: string[], sql: object[] }} The builder, every request and every statement.
 */
function loadFamilyReal({ seed, sub = 'person-a', signedIn = true, failing = null }) {
  const urls = [], sql = [], pool = seededPool(seed, sql, failing);
  const routes = { [H]: realRoute('home-summary.js', 'createHomeSummaryRoutes', pool), [B]: realRoute('meeting-brief-view.js', 'createMeetingBriefViewRoutes', pool) };
  const req = { oidc: signedIn ? { user: { sub }, isAuthenticated: () => true } : { isAuthenticated: () => false } };
  const config = runBlock(async (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const res = recorder();
    if (routes[url]) await routes[url](req, res); else res.status(404).json({ error: 'Synthetic endpoint unavailable' });
    const body = res.body === undefined ? undefined : JSON.parse(JSON.stringify(res.body));
    return { ok: res.statusCode < 400, status: res.statusCode, json: () => (body === undefined ? Promise.reject(new SyntaxError('Unexpected end of JSON input')) : Promise.resolve(body)) };
  });
  return { family: () => config.audiences.family({}), urls, sql };
}

const at = (hours) => new Date(Date.now() + hours * 36e5).toISOString();
/** @returns {string} The UTC calendar day `days` from now, as Google's start.date reaches the snapshot. */
const utcDay = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const MIDNIGHT = utcDay(4) + 'T00:00:00.000Z';
const SYNCED_REAL = new Date(Date.now() - 2 * 36e5);
const REAL_EVENTS = [
  { id: 'p', title: 'Synthetic yesterday', start: at(-24), end: at(-23), allDay: false, url: '' },
  { id: 'e3', title: 'Synthetic midnight call', start: MIDNIGHT, end: MIDNIGHT, allDay: false, url: '' },
  { id: 'e1', title: 'Synthetic standup', start: at(26), end: at(27), allDay: false, url: 'https://calendar.google.com/calendar/event?eid=synthetic1' },
  { id: 'e4', title: 'Synthetic board review', start: at(24 * 12), end: at(24 * 12 + 1), allDay: false, url: '' },
  { id: 'e2', title: 'Synthetic offsite', start: utcDay(3), end: utcDay(4), allDay: true, url: '' },
  { id: 'e5', title: 'Synthetic retro', start: at(24 * 20), end: at(24 * 20 + 1), allDay: false, url: '' },
  { id: 'f', title: 'Synthetic far away', start: at(24 * 40), end: at(24 * 40 + 1), allDay: false, url: '' },
];
/** @returns {object} A stored calendar_meeting_briefs row as the pool returns it (jsonb parsed, timestamptz a Date). */
const briefRow = (i, cited) => ({ event_id: 'evt-' + i, title: 'Synthetic brief ' + i, starts_at: new Date(at(48 - i * 24)), built_at: new Date(at(24 - i * 24)),
  brief: { deliveryText: 'Synthetic delivered text ' + i, hasHistory: cited > 0, claims: Array.from({ length: cited }, (_, c) => ({ id: 'c' + c })) } });
const SEED = {
  snapshots: { 'person-a': { events: REAL_EVENTS, synced_at: SYNCED_REAL }, 'person-b': { events: [{ id: 'b', title: 'Synthetic other person', start: at(5), end: at(6), allDay: false }], synced_at: SYNCED_REAL } },
  // Newest meeting first, as ORDER BY starts_at DESC returns them; the unreadable row (no delivered text) is dropped by the route.
  briefs: { 'person-a': [briefRow(0, 2), { event_id: 'evt-x', title: 'Synthetic unreadable', starts_at: new Date(at(40)), built_at: new Date(at(10)), brief: {} }, briefRow(1, 0), briefRow(2, 1), briefRow(3, 3), briefRow(4, 0), briefRow(5, 1)] },
};

test('family over the real routes: exactly two reads, only SELECTs pinned to the caller, and the model over the fields the routes really return', async () => {
  const view = loadFamilyReal({ seed: SEED });
  const model = await view.family();
  assert.deepEqual([...view.urls].sort(), ['GET ' + H, 'GET ' + B].sort());
  assert.equal(view.sql.length, 2);
  for (const s of view.sql) { assert.match(s.text, /^SELECT /, 'a read, never a write'); assert.equal(s.values[0], 'person-a', 'pinned to the caller'); }
  const synced = SYNCED_REAL.toISOString();
  assert.deepEqual([model.title, model.lede], ['3 events in the next 5 days', 'Next: Synthetic standup, W(' + REAL_EVENTS[2].start + '). Saved from your last sync, W(' + synced + ').']);
  assert.deepEqual(model.stats.map((x) => [x.id, x.value]), [['upcoming-5d', 3], ['upcoming-30d', 5], ['sync', 'W(' + synced + ')']]);
  const coming = section(model, 'coming-up');
  assert.deepEqual(coming.items.map((i) => [i.title, i.text.replace(/ at .*$/, ' at <clock>'), i.meta]), [
    ['Synthetic standup', 'T(' + REAL_EVENTS[2].start + ') at <clock>', 'W(' + REAL_EVENTS[2].start + ')'],
    ['Synthetic offsite', 'D(' + utcDay(3) + ')', 'All day'],
    ['Synthetic midnight call', 'T(' + MIDNIGHT + ') at <clock>', 'W(' + MIDNIGHT + ')'],
  ]);
  assert.equal(coming.note, 'The next 3 of 5 saved for the next 30 days. Only titles and times are saved: never who is coming or what the event says.');
  assert.ok(!JSON.stringify(model).includes('Synthetic other person'), 'another person\x27s snapshot never shows');
  const briefs = section(model, 'briefs');
  assert.deepEqual(briefs.items.map((i) => [i.title, i.text.split(' · ')[0]]), [['Synthetic brief 0', '2 sources cited'], ['Synthetic brief 1', 'Nothing earlier recorded'],
    ['Synthetic brief 2', '1 source cited'], ['Synthetic brief 3', '3 sources cited'], ['Synthetic brief 4', 'Nothing earlier recorded']]);
  assert.equal(briefs.note, 'Read the whole brief on the full page. Showing the latest 5.');
});

test('family over the real routes: no snapshot, a signed-out session, a failed snapshot read and a failed briefs read', async () => {
  const none = await loadFamilyReal({ seed: { snapshots: {}, briefs: {} } }).family();
  assert.deepEqual([none.title, none.lede, stat(none, 'upcoming-5d').value, stat(none, 'sync').value, section(none, 'coming-up').empty],
    ['Nothing on the calendar yet', 'Connect Google in Identity and sync from the full page.', '—', 'Not yet', 'Nothing on the calendar yet — connect Google in Identity and sync from the full page.']);
  const signedOut = loadFamilyReal({ seed: SEED, signedIn: false });
  assert.deepEqual([(await signedOut.family()).title, signedOut.sql.length], ['Sign in to see your calendar', 0]);
  await assert.rejects(loadFamilyReal({ seed: SEED, failing: 'all' }).family(), /^Error: Calendar snapshot unavailable$/);
  const noBriefs = await loadFamilyReal({ seed: SEED, failing: 'briefs' }).family();
  assert.deepEqual([noBriefs.title, section(noBriefs, 'coming-up').items.length, section(noBriefs, 'briefs').empty],
    ['3 events in the next 5 days', 3, 'Meeting briefs could not be read right now (HTTP 503).']);
});

/** @returns {object} A stub element with the members the page's module script touches on start. */
function node() { return { value: '', textContent: '', className: '', disabled: false, append() {}, replaceChildren() {}, addEventListener() {} }; }

/**
 * @description Run the page's module script (imports stripped) against stub modules, a stub DOM and a stub fetch. The
 * script awaits at top level, so it runs as an async function body.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {Promise<{ mounted: number, reads: string[] }>} How often connected actions mounted and every URL fetched.
 */
async function runModule(activeView) {
  const open = html.indexOf('<script type="module">'), src = html.slice(open + 22, html.indexOf('</script>', open)).replace(/^import .*$/gm, '');
  const calls = { mounted: 0, reads: [] };
  const AsyncFunction = (async () => {}).constructor;
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ metrics: [], items: [], briefs: [] }) }); };
  await new AsyncFunction('window', 'AppView', 'document', 'fetch', 'receiveHandoff', 'mountConnectedActions', src)(
    { AppView: { active: () => activeView } }, { active: () => activeView }, { querySelector: node, createElement: node }, fetchStub, () => {}, () => { calls.mounted++; return Promise.resolve(); });
  return calls;
}

test('under an audience view the page\x27s module script mounts nothing and reads nothing; the full page still runs every start step', async () => {
  assert.deepEqual(await runModule('company'), { mounted: 0, reads: [] });
  assert.deepEqual(await runModule('family'), { mounted: 0, reads: [] });
  assert.deepEqual(await runModule(null),{ mounted: 1, reads: ['GET /api/calendar/home-summary', 'GET /api/calendar/meeting-briefs'] });
});
