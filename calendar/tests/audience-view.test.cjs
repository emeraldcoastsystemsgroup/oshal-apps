/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company view asserted as behaviour: the head block runs against a stub kit and a stub fetch, so the tests prove what it reads on open (only GET /home-summary and GET /meeting-briefs; never POST /sync, the one write on this page, which asks Google), that the stats are the route's own saved-event tiles plus the last sync, that the events table names each event's day and its clock time or "All day" from the route's detail string, that the briefs list names the meeting, its time and whether it was cited (newest first as the route orders them, capped at ten), and that not synced, an empty snapshot, no delivered brief, a 401, a 403, a failed summary read and a failed briefs read each read as what they are. The page's module script (top-level await, so run as an async function body) is proved to mount no connected actions and read nothing under the view while the full page still runs every start step.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The Day column's formatter is asserted per start shape: the stub kit tags AppView.date as T, an all-day start ('YYYY-MM-DD', Google's start.date) must go through AppView.day and a timed start (an RFC3339 instant, Google's start.dateTime) through AppView.date, with a timed midnight-UTC start ('...T00:00:00.000Z', what a UTC-zone calendar emits) in the summary proving it is never read as a calendar day, which would have printed the UTC day beside a local clock time of the evening before.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | The family view (the Jarvis shell) beside the company view: the boot declares exactly company and family; the family builder is asserted over a stub fetch AND over the package's REAL compiled handlers (routes/home-summary.js and routes/meeting-brief-view.js with only express stubbed, over a seeded pool, every body JSON round-tripped), so its reads are exactly GET /home-summary and GET /meeting-briefs, the routes run only SELECTs pinned to the caller, and the model is proved over the fields the routes really return. Asserted: "Coming up" in plain words with each all-day start through AppView.day and each timed start through AppView.date plus the clock and AppView.when (a midnight-UTC timed start never read as a calendar day), the three-of-N note against the thirty-day tile, the briefs in plain words capped at five, and not synced ("Nothing on the calendar yet", with the full page's own Google link in a new tab), an empty snapshot, nothing in five days, no brief, the real 401, a 403, the real 503 and a non-JSON 500 each named; the page's module script mounts nothing and reads nothing under the family view.
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | The real home-summary handler also reads the caller's own events (routes/own-events.js, loaded real with its logger stubbed): the seeded pool answers that owner-pinned SELECT too, so the family view makes three reads, all SELECTs pinned to the caller, and with no own events its model is unchanged.
 * 6   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 9: own-events.js loads routes/event-time.js (the zone helpers), and the full page also reads GET /api/calendar/events for its "Added in OSHAL" list with Remove.
 * 7   | maintainer@emeraldcoastsystemsgroup.com     | The DOM stand-in answers querySelector: the full page now checks whether a connected application can take the brief before it shows the form.
 * 8   | maintainer@emeraldcoastsystemsgroup.com     | 1.5.0: the Home summary reads Google Calendar live (Roger, 2026-11-15: "I put a calendar event on my Google calendar and its not showing on the landing home ... i would think it would have a combination of calendars"). The stub answers are calendarEvidence's new shape (Events tiles, each event item with its start, allDay, source and calendar, the "Read from Google Calendar just now" note and the `google` block), and the views are asserted to end their stats with when Google Calendar was read (or the saved copy shown because Google did not answer), to name each event's calendar, to offer Manage Google connection when Google is not connected and never to say sync. The real-handler family cases run the compiled routes over the stand-in kernel egress and stand-in Google Calendar (tests/fixtures/google-calendar-standin.cjs): the summary reads Google live and runs only owner-pinned SELECTs, and the saved copy is not read while Google answers.
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
const READ = '2026-09-28T10:00:00.000Z', SYNCED = '2026-09-25T10:00:00.000Z';
/** @returns {object} An event item as calendarEvidence (routes/home-summary.js) writes it, with the four planning offers. */
const event = (title, startAt, allDay, calendar = null) => {
  const detail = 'words for ' + startAt + ' / ' + (calendar ? 'Google Calendar: ' + calendar : 'Google Calendar');
  return { text: title, detail, start: startAt, allDay, source: 'google', calendar, fix: 'calendar-review', actions: ['plan-gift', 'plan-meal', 'plan-trip', 'prepare-meeting'].map((integration) => ({ integration, context: { title, notes: detail } })) };
};
const NOTE = { text: 'Read from Google Calendar just now: your primary calendar.', fix: 'calendar-review', tone: 'neutral' };
const CONNECT = { text: 'Connect Google on the Connections page (/utilities) to see your Google Calendar here. Events added in Open Swarm are shown without it.', fix: 'calendar-review', tone: 'neutral' };
const COPY = { text: 'Showing your last synced copy from Sep 25, 2026, 10:00 AM UTC: Google did not answer.', fix: 'calendar-review', tone: 'neutral' };
const LIVE = { state: 'live', readAt: READ, syncedAt: null, calendars: ['primary'], unread: [], primaryOnly: false };
const UNREAD = { state: 'not-connected', readAt: null, syncedAt: null, calendars: [], unread: [], primaryOnly: null };
/** @returns {object[]} The route's two metrics, which it mirrors as tiles. */
const tiles = (five, thirty) => [{ id: 'upcoming-5d', label: 'Events / 5d', value: five }, { id: 'upcoming-30d', label: 'Events / 30d', value: thirty }];
/** @returns {object} A home summary: tiles mirror metrics, event items first, the note last, and the `google` block. */
const summary = (counts, items, google = LIVE) => ({ metrics: tiles(counts[0], counts[1]), tiles: tiles(counts[0], counts[1]), items, asOf: READ, partial: google.state === 'saved-copy', google });
// The midnight-UTC timed event is the shape a UTC-zone calendar emits ('Z'-suffixed dateTime): AppView.day would read it as
// that UTC calendar day, which is the evening before west of Greenwich, so the Day column must route it through AppView.date.
const SUMMARY = summary(['2', '4'], [event('Synthetic standup', '2026-09-29T14:00:00.000Z', false), event('Synthetic offsite', '2026-10-01', true), event('Synthetic midnight call', '2026-10-05T00:00:00.000Z', false, 'Family'), event('Synthetic board review', '2026-10-10T16:30:00.000Z', false), NOTE]);
const NOT_CONNECTED = summary(['Not connected', 'Not connected'], [CONNECT], UNREAD);
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

test('the stats are the route\x27s own event tiles plus when Google Calendar was read, and the events table names each day (a calendar day only when all day), time or all day, and calendar', async () => {
  const model = await loadCompany(OK).company({});
  assert.deepEqual([model.kicker, model.title, model.lede, model.actions.map((a) => a.label)], ['Office · Calendar', 'Office calendar', NOTE.text, ['Open the full calendar']]);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null]), [['upcoming-5d', 'Events / 5d', '2', null], ['upcoming-30d', 'Events / 30d', '4', null], ['google', 'Google Calendar', 'W(' + READ + ')', 'ok']]);
  const events = section(model, 'events');
  assert.deepEqual([events.title, events.columns], ['Next events', ['Event', 'Day', 'Time', 'Calendar']]);
  // Only the all-day start ('YYYY-MM-DD', Google's start.date) is a date-only field; a timed start is an instant, formatted as a local date.
  assert.deepEqual(events.rows.map((r) => [r[0], r[1], r[2] === 'All day', r[3]]), [['Synthetic standup', 'T(2026-09-29T14:00:00.000Z)', false, 'Google'], ['Synthetic offsite', 'D(2026-10-01)', true, 'Google'], ['Synthetic midnight call', 'T(2026-10-05T00:00:00.000Z)', false, 'Google · Family'], ['Synthetic board review', 'T(2026-10-10T16:30:00.000Z)', false, 'Google']]);
  assert.ok(!events.rows.some((r) => /^D\(.*T00:00:00/.test(r[1])), 'a timed midnight-UTC start is never read as a calendar day');
  assert.match(events.rows[0][2], /\d/, 'a timed event shows a clock time');
  assert.match(events.rows[2][2], /\d/, 'a timed midnight-UTC event shows a clock time, not All day');
  assert.match(events.note, /^Your Google calendars read just now and the events added in Open Swarm: titles and times only\. Attendees and descriptions are not shown here\.$/);
  assert.ok(!/sync/i.test(JSON.stringify([model.title, model.lede, model.actions, model.stats, events])), 'nothing says sync');
});

test('not connected, the saved copy, an empty calendar and no delivered brief each read as what they are', async () => {
  const none = await loadCompany({ ...OK, [H]: NOT_CONNECTED }).company({});
  assert.deepEqual([none.title, none.lede, none.actions.map((a) => [a.label, a.href || null])], ['Connect Google Calendar', CONNECT.text, [['Open the full calendar', null], ['Manage Google connection', '/utilities']]]);
  assert.deepEqual(none.stats.map((x) => [x.id, x.value, x.tone, x.hint || null]), [['upcoming-5d', 'Not connected', 'warn', null], ['upcoming-30d', 'Not connected', 'warn', null], ['google', 'Not connected', 'warn', 'Connect Google on the Connections page']]);
  assert.deepEqual([section(none, 'events').rows.length, section(none, 'events').empty], [0, CONNECT.text]);
  const copy = await loadCompany({ ...OK, [H]: summary(['1', '1'], [event('Synthetic standup', '2026-09-29T14:00:00.000Z', false), COPY], { ...LIVE, state: 'saved-copy', readAt: null, syncedAt: SYNCED, calendars: [] }) }).company({});
  assert.deepEqual([copy.title, copy.lede, stat(copy, 'google').label, stat(copy, 'google').value, stat(copy, 'google').tone], ['Office calendar', COPY.text, 'Saved copy', 'W(' + SYNCED + ')', 'warn']);
  assert.match(section(copy, 'events').note, /^From your last synced copy of Google Calendar and the events added in Open Swarm/);
  const quiet = await loadCompany({ [H]: summary(['0', '0'], [NOTE]), [B]: { briefs: [], note: BRIEFS.note } }).company({});
  assert.deepEqual([quiet.title, stat(quiet, 'google').value, stat(quiet, 'google').tone, section(quiet, 'events').empty, section(quiet, 'briefs').items.length],
    ['Office calendar', 'W(' + READ + ')', 'ok', 'Nothing in the next 30 days.', 0]);
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
  await assert.rejects(loadCompany({ ...OK, [H]: { http: 500, body: undefined } }).company({}), /^Error: Calendar could not be read \(HTTP 500\)\.$/);
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
    'Next: Synthetic standup, W(2026-09-29T14:00:00.000Z).', ['Open the full calendar']]);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null]), [['upcoming-5d', 'Next 5 days', 2, null], ['upcoming-30d', 'Next 30 days', 4, null], ['google', 'Google Calendar', 'W(' + READ + ')', 'ok']]);
  const coming = section(model, 'coming-up');
  assert.deepEqual([coming.kind, coming.title], ['list', 'Coming up']);
  assert.deepEqual(coming.items.map((i) => [i.title, i.text.replace(/ at .*? · /, ' at <clock> · '), i.meta]), [
    ['Synthetic standup', 'T(2026-09-29T14:00:00.000Z) at <clock> · Google', 'W(2026-09-29T14:00:00.000Z)'],
    ['Synthetic offsite', 'D(2026-10-01) · Google', 'All day'],
    ['Synthetic midnight call', 'T(2026-10-05T00:00:00.000Z) at <clock> · Google · Family', 'W(2026-10-05T00:00:00.000Z)'],
    ['Synthetic board review', 'T(2026-10-10T16:30:00.000Z) at <clock> · Google', 'W(2026-10-10T16:30:00.000Z)'],
  ]);
  assert.ok(coming.items.filter((i) => i.meta !== 'All day').every((i) => / at .*\d/.test(i.text)), 'a timed event shows a clock time');
  assert.ok(!coming.items.some((i) => /D\(.*T00:00:00/.test(i.text + i.meta)), 'a timed midnight-UTC start is never read as a calendar day');
  assert.equal(coming.note, 'Only titles and times are shown here: never who is coming or what the event says.');
  assert.ok(!coming.items.some((i) => i.href), 'an event links nowhere: the full page does not link events out either');
});

test('family: the note says when the summary shows only the next few of the saved events, and nothing in five days reads as that', async () => {
  const three = [event('Synthetic retro', '2026-10-06T14:00:00.000Z', false), event('Synthetic fair', '2026-10-08', true), event('Synthetic review', '2026-10-09T14:00:00.000Z', false), NOTE];
  const model = await loadFamily({ ...OK, [H]: summary(['0', '9'], three) }).family({});
  assert.deepEqual([model.title, model.lede], ['Nothing in the next 5 days', 'Next: Synthetic retro, W(2026-10-06T14:00:00.000Z).']);
  assert.equal(section(model, 'coming-up').note, 'The next 3 of 9 in the next 30 days. Only titles and times are shown here: never who is coming or what the event says.');
  const allDayFirst = await loadFamily({ ...OK, [H]: summary(['1', '1'], [event('Synthetic holiday', '2026-09-30', true), NOTE]) }).family({});
  assert.deepEqual([allDayFirst.title, allDayFirst.lede], ['1 event in the next 5 days', 'Next: Synthetic holiday, all day D(2026-09-30).']);
  const copy = await loadFamily({ ...OK, [H]: summary(['1', '1'], [event('Synthetic holiday', '2026-09-30', true), COPY], { ...LIVE, state: 'saved-copy', readAt: null, syncedAt: SYNCED }) }).family({});
  assert.deepEqual([copy.lede, stat(copy, 'google').label, stat(copy, 'google').value], ['Next: Synthetic holiday, all day D(2026-09-30). From your last synced copy, W(' + SYNCED + ').', 'Saved copy', 'W(' + SYNCED + ')']);
});

test('family: not connected, an empty calendar and no delivered brief each read as what they are', async () => {
  const none = await loadFamily({ ...OK, [H]: NOT_CONNECTED }).family({});
  assert.deepEqual([none.title, none.lede], ['Nothing on the calendar yet', CONNECT.text]);
  assert.deepEqual(none.actions.map((a) => [a.label, a.href || null, a.target || null, !!a.primary]), [['Open the full calendar', null, null, true], ['Manage Google connection', '/utilities', '_blank', false]]);
  assert.deepEqual(none.stats.map((x) => [x.id, x.value, x.tone || null, x.hint || null]), [['upcoming-5d', '—', null, null], ['upcoming-30d', '—', null, null], ['google', 'Not connected', 'warn', 'Connect Google on the Connections page']]);
  assert.deepEqual([section(none, 'coming-up').items.length, section(none, 'coming-up').empty, section(none, 'coming-up').note], [0, CONNECT.text, null]);
  const quiet = await loadFamily({ [H]: summary(['0', '0'], [NOTE]), [B]: { briefs: [], note: BRIEFS.note } }).family({});
  assert.deepEqual([quiet.title, quiet.lede, quiet.actions.map((a) => a.label), stat(quiet, 'google').value, section(quiet, 'coming-up').empty],
    ['Nothing coming up', 'Nothing on your calendars in the next 30 days.', ['Open the full calendar'], 'W(' + READ + ')', 'Nothing in the next 30 days.']);
  assert.ok(!/sync/i.test(JSON.stringify([none.title, none.lede, none.actions, none.stats, section(none, 'coming-up'), quiet.title, quiet.lede, section(quiet, 'coming-up')])), 'nothing says sync');
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
  await assert.rejects(loadFamily({ ...OK, [H]: { http: 500, body: undefined } }).family({}), /^Error: Calendar could not be read \(HTTP 500\)\.$/);
  const noBriefs = await loadFamily({ ...OK, [B]: { http: 503, body: { error: 'Meeting briefs are unavailable' } } }).family({});
  assert.deepEqual([noBriefs.title, section(noBriefs, 'briefs').items.length, section(noBriefs, 'briefs').empty, section(noBriefs, 'coming-up').items.length],
    ['2 events in the next 5 days', 0, 'Meeting briefs could not be read right now (HTTP 503).', 4]);
  assert.equal(section(await loadFamily({ ...OK, [B]: { http: 401, body: {} } }).family({}), 'briefs').empty, 'Sign in to see meeting briefs.');
});

// ── The family view over the package's REAL handlers ────────────────────────────────────────────────────────────────

const { modules } = require('./fixtures/calendar-modules.cjs');
const { standInGoogle, kernelEgress, withOffset } = require('./fixtures/google-calendar-standin.cjs');
const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));
const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
const real = modules();

/**
 * @description Load the compiled meeting-brief view with only express stubbed, and build it over a pool, as the core mounts
 * it; its own SQL, owner pinning and body shape run unchanged.
 * @param {object} pool The pool it queries.
 * @returns {Function} Its GET / handler.
 */
function briefsRoute(pool) {
  let handler = null;
  const mod = { exports: {} };
  const shim = (request) => { if (request === 'express') return { Router: () => ({ get: (_p, h) => { handler = h; } }) }; if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {}, info() {} }) }; throw new Error('unexpected require: ' + request); };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(ROOT, 'routes', 'meeting-brief-view.js'), 'utf8'))(shim, mod, mod.exports);
  mod.exports.createMeetingBriefViewRoutes({ pool });
  assert.equal(typeof handler, 'function', 'meeting-brief-view.js registers GET /');
  return handler;
}

/**
 * @description A pool that answers the SELECTs the view's routes issue from a seed keyed by owner, and records every
 * statement with its values.
 * @param {{ snapshots?: object, briefs: object, own?: object }} seed Rows per user_sub, briefs already in the route's starts_at DESC order.
 * @param {Array} sql Receives { text, values } per statement.
 * @param {string|null} failing 'all' fails every statement, 'briefs' only the briefs read (a statement timeout).
 * @returns {{ query: Function }} The pool.
 */
function seededPool(seed, sql, failing) {
  return { async query(q) {
    sql.push({ text: q.text.trim(), values: q.values });
    if (failing === 'all' || (failing === 'briefs' && /calendar_meeting_briefs/.test(q.text))) throw new Error('canceling statement due to statement timeout');
    if (/FROM calendar_preparation_snapshots WHERE user_sub = \$1$/.test(q.text)) return { rows: seed.snapshots && seed.snapshots[q.values[0]] ? [seed.snapshots[q.values[0]]] : [] };
    if (/FROM calendar_meeting_briefs\s+WHERE user_sub = \$1 ORDER BY starts_at DESC LIMIT \$2$/.test(q.text)) return { rows: (seed.briefs[q.values[0]] || []).slice(0, q.values[1]) };
    if (/FROM calendar_own_events WHERE user_sub = \$1 AND starts_at >= \$2 ORDER BY starts_at ASC LIMIT 100$/.test(q.text)) return { rows: (seed.own && seed.own[q.values[0]]) || [] };
    throw new Error('seeded pool cannot answer: ' + q.text.slice(0, 90));
  } };
}

/** @returns {object} A response recorder with the members both routes use. */
function recorder() { return { statusCode: 200, body: undefined, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; }

/**
 * @description The family builder with its fetch answered by the package's real home-summary and meeting-brief-view
 * handlers over a seeded pool, each body JSON round-tripped as Express sends it; the summary reads a stand-in Google
 * Calendar (UTC zone) through the stand-in kernel egress with the caller's grant, or none.
 * @param {{ seed: object, sub?: string, signedIn?: boolean, failing?: string|null, connection?: string|null, google?: object[], stall?: boolean }} opts
 * @returns {Promise<{ family: Function, urls: string[], sql: object[] }>} The builder (which closes the stand-in), every request and every statement.
 */
async function loadFamilyReal({ seed, sub = 'person-a', signedIn = true, failing = null, connection = 'person-full', google = REAL_GOOGLE, stall = false }) {
  const urls = [], sql = [], pool = seededPool(seed, sql, failing);
  const api = await standInGoogle({ zone: 'UTC' }), egress = kernelEgress(manifest, connection, api);
  for (const e of google) api.seed(e);
  if (stall) api.stall('primary');
  const routes = { [H]: real['home-summary'].createHomeSummaryRoutes({ pool }, stall ? { liveBudgetMs: 100 } : undefined).routes['GET /'], [B]: briefsRoute(pool) };
  const req = { oidc: signedIn ? { user: { sub }, isAuthenticated: () => true } : { isAuthenticated: () => false } };
  const config = runBlock(async (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const res = recorder();
    if (routes[url]) await routes[url](req, res); else res.status(404).json({ error: 'Synthetic endpoint unavailable' });
    const body = res.body === undefined ? undefined : JSON.parse(JSON.stringify(res.body));
    return { ok: res.statusCode < 400, status: res.statusCode, json: () => (body === undefined ? Promise.reject(new SyntaxError('Unexpected end of JSON input')) : Promise.resolve(body)) };
  });
  return { family: async () => { try { return await config.audiences.family({}); } finally { egress.restore(); await api.close(); } }, urls, sql };
}

const at = (hours) => new Date(Date.now() + hours * 36e5).toISOString();
/** @returns {string} The UTC calendar day `days` from now, as Google's start.date carries it. */
const utcDay = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
/** @returns {string} A timed start as the UTC-zone stand-in answers it ('...+00:00'). */
const asGoogle = (iso) => withOffset(Date.parse(iso), 'UTC');
const MIDNIGHT = utcDay(4) + 'T00:00:00.000Z';
const SYNCED_REAL = new Date(Date.now() - 2 * 36e5);
const timed = (summary, start, end) => ({ summary, start: { dateTime: start, timeZone: 'UTC' }, end: { dateTime: end, timeZone: 'UTC' } });
const STANDUP = at(26);
const REAL_GOOGLE = [
  timed('Synthetic yesterday', at(-24), at(-23)),
  timed('Synthetic midnight call', MIDNIGHT, MIDNIGHT),
  timed('Synthetic standup', STANDUP, at(27)),
  timed('Synthetic board review', at(24 * 12), at(24 * 12 + 1)),
  { summary: 'Synthetic offsite', start: { date: utcDay(3) }, end: { date: utcDay(4) } },
  timed('Synthetic retro', at(24 * 20), at(24 * 20 + 1)),
  timed('Synthetic far away', at(24 * 40), at(24 * 40 + 1)),
];
/** @returns {object} A stored calendar_meeting_briefs row as the pool returns it (jsonb parsed, timestamptz a Date). */
const briefRow = (i, cited) => ({ event_id: 'evt-' + i, title: 'Synthetic brief ' + i, starts_at: new Date(at(48 - i * 24)), built_at: new Date(at(24 - i * 24)),
  brief: { deliveryText: 'Synthetic delivered text ' + i, hasHistory: cited > 0, claims: Array.from({ length: cited }, (_, c) => ({ id: 'c' + c })) } });
const SEED = {
  snapshots: { 'person-a': { events: [{ id: 's1', title: 'Synthetic saved standup', start: at(30), end: at(31), allDay: false, url: '' }], synced_at: SYNCED_REAL } },
  own: { 'person-b': [{ id: 'b0000000-0000-4000-8000-000000000001', title: 'Synthetic other person', starts_at: at(5), all_day: false, created_at: at(-1) }] },
  // Newest meeting first, as ORDER BY starts_at DESC returns them; the unreadable row (no delivered text) is dropped by the route.
  briefs: { 'person-a': [briefRow(0, 2), { event_id: 'evt-x', title: 'Synthetic unreadable', starts_at: new Date(at(40)), built_at: new Date(at(10)), brief: {} }, briefRow(1, 0), briefRow(2, 1), briefRow(3, 3), briefRow(4, 0), briefRow(5, 1)] },
};

test('family over the real routes: Google Calendar read live, only SELECTs pinned to the caller, and the model over the fields the routes really return', async () => {
  const view = await loadFamilyReal({ seed: SEED });
  const model = await view.family();
  assert.deepEqual([...view.urls].sort(), ['GET ' + H, 'GET ' + B].sort());
  assert.equal(view.sql.length, 2, 'the caller\x27s own events and the briefs; the saved copy is not read while Google answers');
  for (const s of view.sql) { assert.match(s.text, /^SELECT /, 'a read, never a write'); assert.equal(s.values[0], 'person-a', 'pinned to the caller'); }
  assert.deepEqual([model.title, model.lede], ['3 events in the next 5 days', 'Next: Synthetic standup, W(' + asGoogle(STANDUP) + ').']);
  assert.deepEqual(model.stats.slice(0, 2).map((x) => [x.id, x.value]), [['upcoming-5d', 3], ['upcoming-30d', 5]]);
  assert.match(stat(model, 'google').value, /^W\(\d{4}-\d{2}-\d{2}T/, 'when Google Calendar was read');
  const coming = section(model, 'coming-up');
  assert.deepEqual(coming.items.map((i) => [i.title, i.text.replace(/ at .*? · /, ' at <clock> · '), i.meta]), [
    ['Synthetic standup', 'T(' + asGoogle(STANDUP) + ') at <clock> · Google', 'W(' + asGoogle(STANDUP) + ')'],
    ['Synthetic offsite', 'D(' + utcDay(3) + ') · Google', 'All day'],
    ['Synthetic midnight call', 'T(' + asGoogle(MIDNIGHT) + ') at <clock> · Google', 'W(' + asGoogle(MIDNIGHT) + ')'],
  ]);
  assert.equal(coming.note, 'The next 3 of 5 in the next 30 days. Only titles and times are shown here: never who is coming or what the event says.');
  assert.ok(!JSON.stringify(model).includes('Synthetic other person'), 'another person\x27s events never show');
  assert.ok(!JSON.stringify(model).includes('Synthetic saved standup'), 'the saved copy is not shown while Google answers');
  const briefs = section(model, 'briefs');
  assert.deepEqual(briefs.items.map((i) => [i.title, i.text.split(' · ')[0]]), [['Synthetic brief 0', '2 sources cited'], ['Synthetic brief 1', 'Nothing earlier recorded'],
    ['Synthetic brief 2', '1 source cited'], ['Synthetic brief 3', '3 sources cited'], ['Synthetic brief 4', 'Nothing earlier recorded']]);
  assert.equal(briefs.note, 'Read the whole brief on the full page. Showing the latest 5.');
});

test('family over the real routes: no connection, a signed-out session, Google not answering, a failed own-events read and a failed briefs read', async () => {
  const none = await (await loadFamilyReal({ seed: { briefs: {} }, connection: null })).family();
  assert.deepEqual([none.title, none.lede, stat(none, 'upcoming-5d').value, stat(none, 'google').value, section(none, 'coming-up').empty],
    ['Nothing on the calendar yet', CONNECT.text, '—', 'Not connected', CONNECT.text]);
  const signedOut = await loadFamilyReal({ seed: SEED, signedIn: false });
  assert.deepEqual([(await signedOut.family()).title, signedOut.sql.length], ['Sign in to see your calendar', 0]);
  const silent = await loadFamilyReal({ seed: SEED, stall: true });
  const copy = await silent.family();
  assert.deepEqual([copy.lede, stat(copy, 'google').label, stat(copy, 'google').value],
    ['Next: Synthetic saved standup, W(' + SEED.snapshots['person-a'].events[0].start + '). From your last synced copy, W(' + SYNCED_REAL.toISOString() + ').', 'Saved copy', 'W(' + SYNCED_REAL.toISOString() + ')']);
  assert.ok(silent.sql.every((s) => /^SELECT /.test(s.text)) && silent.sql.some((s) => /calendar_preparation_snapshots/.test(s.text)), 'the saved copy is read, never written');
  const noOwn = await (await loadFamilyReal({ seed: SEED, failing: 'all' })).family();
  assert.equal(noOwn.title, '3 events in the next 5 days', 'Google Calendar still shows when the own-events read fails');
  const noBriefs = await (await loadFamilyReal({ seed: SEED, failing: 'briefs' })).family();
  assert.deepEqual([noBriefs.title, section(noBriefs, 'coming-up').items.length, section(noBriefs, 'briefs').empty],
    ['3 events in the next 5 days', 3, 'Meeting briefs could not be read right now (HTTP 503).']);
});

/** @returns {object} A stub element with the members the page's module script touches on start. */
function node() { return { value: '', textContent: '', className: '', disabled: false, hidden: false, append() {}, replaceChildren() {}, addEventListener() {}, querySelector() { return null; } }; }

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
  assert.deepEqual(await runModule(null),{ mounted: 1, reads: ['GET /api/calendar/home-summary', 'GET /api/calendar/meeting-briefs', 'GET /api/calendar/events'] });
});
