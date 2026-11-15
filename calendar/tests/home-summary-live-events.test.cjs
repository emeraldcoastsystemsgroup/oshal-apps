/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Home reads Google Calendar live (calendar 1.5.0). Roger, 2026-11-15: "I put a calendar event
 *   on my Google calendar and its not showing on the landing home ... i would think it would have a combination of calendars".
 *   Red before: the Home summary (GET /api/calendar/home-summary, the Home card and the concierge's calendar-upcoming) and the
 *   agenda (GET /api/calendar/events/agenda, the Calendar screen and Home's "Your calendar" frame) showed only the copy saved by
 *   the last press of Sync, primary calendar only, with "Sync explicitly for changes". Asserted: a Google event that is not in
 *   the saved copy shows on the next read, marked "Google Calendar", in one list by start with an event added in Open Swarm;
 *   a second calendar the person shows in Google Calendar is included and named, one they hide or do not show is not, at most
 *   ten calendars are read and the rest are named; a grant that may not list calendars reads the primary one only and says
 *   so; both GETs run under a read-only SQL admission that refuses any write (as presentations-read-does-not-write does) and
 *   leave the saved copy as it was; a Google that does not answer within the budget falls back to the saved copy with
 *   "Showing your last synced copy from <time>: Google did not answer." and starts no further read; no connection says to
 *   connect Google and nothing about syncing. Boundary: the compiled routes, loaded with their own relative imports, over the
 *   package's real manifest egress, with the stand-in kernel egress and stand-in Google Calendar API on loopback
 *   (tests/fixtures/google-calendar-standin.cjs). Named seams: the in-memory caller (OIDC), the read-only recording pool, the
 *   stand-in egress and Google. Made-up people and events only; no real account is touched.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { router, call, dayAhead, ROOT } = require('./fixtures/calendar-modules.cjs');
const { standInGoogle, kernelEgress, wallAt } = require('./fixtures/google-calendar-standin.cjs');

const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));
const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
const ZONE = 'America/Chicago';
const D1 = dayAhead(1), D2 = dayAhead(2), D3 = dayAhead(3);
const at = (day, time) => ({ dateTime: `${day}T${time}:00`, timeZone: ZONE });
const READER_REFUSAL = 'refused: SQL mutation requires original writer admission';
const MUTATION = /^(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE|BEGIN)\b/i;

/** The compiled route modules, each loaded with its own relative imports; any framework import other than the logger fails. */
function routesModules() {
  const loaded = {};
  const load = (name) => {
    if (loaded[name]) return loaded[name];
    const m = { exports: {} };
    loaded[name] = m.exports;
    new Function('require', 'module', 'exports', fs.readFileSync(path.join(ROOT, 'routes', `${name}.js`), 'utf8'))((id) => {
      if (id === 'express') return { Router: router };
      if (id === 'crypto') return require('node:crypto');
      if (id === '@/shared/logger') return { createChildLogger: () => ({ error() {}, info() {}, warn() {} }) };
      if (/^\.\/[a-z-]+$/.test(id)) return load(id.slice(2));
      throw new Error(`${name} requires ${id}: the legacy broker is never reached under the kernel egress`);
    }, m, m.exports);
    loaded[name] = m.exports;
    return m.exports;
  };
  return { summary: load('home-summary'), own: load('own-events') };
}
const m = routesModules();

/** An own-event row as calendar_own_events holds it. */
const ownRow = (id, title, day, time) => ({ id, title, starts_at: new Date(wallAt(`${day}T${time}`, ZONE)).toISOString(), ends_at: null, all_day: false, time_zone: ZONE,
  location: null, notes: null, created_at: new Date().toISOString(), revision: 'o.fixture' });
/** The copy the last press of Sync saved, three days ago: an event Google no longer holds. */
const SYNCED_AT = new Date(Date.now() - 3 * 86_400_000);
const SNAPSHOT = { events: [{ id: 'old1', title: 'Saved standup', start: `${D2}T14:00:00-06:00`, end: `${D2}T14:15:00-06:00`, allDay: false, url: null }], synced_at: SYNCED_AT.toISOString() };

/**
 * @description A pool under a read-only admission: it answers the routes' SELECTs from per-owner rows and refuses every write
 * with the kernel's reader refusal, recording each statement.
 * @returns {{ query: Function, sql: object[], refused: string[], db: object }} The pool.
 */
function readOnlyPool({ own = {}, snapshots = {} } = {}) {
  const sql = [], refused = [], db = { own, snapshots: JSON.parse(JSON.stringify(snapshots)) };
  return { sql, refused, db, async query(q, values) {
    const text = String(typeof q === 'string' ? q : q.text).trim(), vals = (typeof q === 'string' ? values : q.values) || [];
    sql.push({ text, values: vals });
    if (MUTATION.test(text) || /pg_advisory/i.test(text)) { refused.push(text); throw new Error(READER_REFUSAL); }
    if (/FROM calendar_own_events WHERE user_sub = \$1 AND starts_at >= \$2 ORDER BY starts_at ASC LIMIT 100$/.test(text)) return { rows: (db.own[vals[0]] || []).filter((r) => r.starts_at >= vals[1]) };
    if (/FROM calendar_own_events WHERE user_sub = \$1 ORDER BY starts_at ASC LIMIT 501$/.test(text)) return { rows: db.own[vals[0]] || [] };
    if (/^SELECT events,synced_at FROM calendar_preparation_snapshots WHERE user_sub = \$1$/.test(text)) return { rows: db.snapshots[vals[0]] ? [db.snapshots[vals[0]]] : [] };
    throw new Error('read-only pool cannot answer: ' + text.slice(0, 90));
  } };
}

/** A made-up Google Calendar behind the stand-in kernel egress for one grant; `run` gets the stand-in and the routes. */
async function withGoogle({ connection = 'person-full', calendars = [], pool = readOnlyPool(), budget } = {}, run) {
  const api = await standInGoogle({ calendars }), egress = kernelEgress(manifest, connection, api);
  try {
    const options = budget ? { liveBudgetMs: budget } : undefined;
    await run({ api, pool, summary: m.summary.createHomeSummaryRoutes({ pool }, options).routes, agenda: m.own.createOwnEventsRoutes({ pool }, options).routes });
  } finally { egress.restore(); await api.close(); }
}
const items = (body) => body.items.filter((i) => Array.isArray(i.actions)).map((i) => [i.text, i.detail.replace(/^.* \/ (?=Google|added)/, '… / ')]);
const note = (body) => body.items.at(-1).text;
const agendaQuery = { from: dayAhead(0), to: dayAhead(10), tz: ZONE };

test('Home shows a Google event the saved copy does not hold, read live, in one list by start with an event added in Open Swarm', async () => {
  const pool = readOnlyPool({ own: { alice: [ownRow('a0000000-0000-4000-8000-000000000001', 'Pick up the cake', D1, '08:00')] }, snapshots: { alice: SNAPSHOT } });
  await withGoogle({ pool }, async ({ api, summary }) => {
    api.seed({ summary: 'Dentist', start: at(D1, '09:00'), end: at(D1, '10:00') });
    const out = await call(summary, 'GET /');
    assert.equal(out.statusCode, 200);
    assert.deepEqual(items(out.body), [['Pick up the cake', '… / added in Open Swarm'], ['Dentist', '… / Google Calendar']]);
    assert.match(out.body.items[1].detail, /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d{4}, 9:00 AM C[SD]T \/ Google Calendar$/, 'its start in words, in the calendar\'s zone');
    assert.deepEqual([out.body.items[1].source, out.body.items[1].calendar, out.body.items[0].source], ['google', null, 'oshal']);
    assert.equal(note(out.body), 'Read from Google Calendar just now: your primary calendar, with the events added in Open Swarm.');
    assert.deepEqual(out.body.metrics.map((x) => [x.id, x.label, x.value]), [['upcoming-5d', 'Events / 5d', '2'], ['upcoming-30d', 'Events / 30d', '2'], ['own-upcoming', 'Added in Open Swarm', '1']]);
    assert.ok(!JSON.stringify(out.body).includes('Saved standup'), 'the saved copy is not shown while Google answers');
    assert.equal(out.body.google.state, 'live');
  });
});

test('Home includes the other calendars the person shows in Google Calendar, names each, and reads at most ten', async () => {
  const calendars = [{ id: 'family@group.calendar.google.com', summary: 'Family', selected: true, accessRole: 'writer' },
    { id: 'holidays@group.v.calendar.google.com', summary: 'Holidays in United States', selected: false, accessRole: 'reader' },
    { id: 'old@group.calendar.google.com', summary: 'Old project', selected: true, hidden: true, accessRole: 'owner' }];
  await withGoogle({ calendars }, async ({ api, summary }) => {
    api.seed({ summary: 'Dentist', start: at(D1, '09:00'), end: at(D1, '10:00') });
    api.seedOn('family@group.calendar.google.com', { summary: 'Soccer practice', start: at(D2, '17:00'), end: at(D2, '18:00') });
    api.seedOn('holidays@group.v.calendar.google.com', { summary: 'A holiday', start: { date: D3 }, end: { date: dayAhead(4) } });
    api.seedOn('old@group.calendar.google.com', { summary: 'Hidden thing', start: at(D2, '12:00'), end: at(D2, '13:00') });
    const out = await call(summary, 'GET /');
    assert.deepEqual(items(out.body), [['Dentist', '… / Google Calendar'], ['Soccer practice', '… / Google Calendar: Family']]);
    assert.equal(note(out.body), 'Read from Google Calendar just now: your primary calendar and Family.');
    assert.deepEqual([out.body.google.calendars, out.body.google.primaryOnly], [['primary', 'Family'], false]);
    assert.deepEqual(api.requests.map((r) => decodeURIComponent(r.path)), ['/calendar/v3/users/me/calendarList', '/calendar/v3/calendars/primary/events', '/calendar/v3/calendars/family@group.calendar.google.com/events']);
    assert.deepEqual(api.writes(), [], 'a read sends Google nothing but GETs');
  });
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}@group.calendar.google.com`, summary: `Club ${i}`, selected: true, accessRole: 'reader' }));
  await withGoogle({ calendars: many }, async ({ api, summary }) => {
    const out = await call(summary, 'GET /');
    assert.equal(api.requests.filter((r) => /\/events$/.test(r.path)).length, 10, 'the primary calendar and nine more');
    assert.match(note(out.body), / 3 more of the calendars you show in Google Calendar are not read here; the first 10 are\.$/);
  });
});

test('a grant that may not list calendars (calendar.events alone) shows the primary calendar only and says so', async () => {
  const calendars = [{ id: 'family@group.calendar.google.com', summary: 'Family', selected: true, accessRole: 'writer' }];
  await withGoogle({ connection: 'person-write', calendars }, async ({ api, summary }) => {
    api.seed({ summary: 'Dentist', start: at(D1, '09:00'), end: at(D1, '10:00') });
    api.seedOn('family@group.calendar.google.com', { summary: 'Soccer practice', start: at(D2, '17:00'), end: at(D2, '18:00') });
    const out = await call(summary, 'GET /');
    assert.deepEqual(items(out.body), [['Dentist', '… / Google Calendar']]);
    assert.equal(note(out.body), 'Read from Google Calendar just now: your primary calendar. Your Google connection does not let Open Swarm list your other calendars, so only your primary calendar is shown.');
    assert.equal(out.body.google.primaryOnly, true);
  });
});

test('a GET writes nothing: the Home summary and the agenda run under a read-only admission and leave the saved copy as it was', async () => {
  for (const stalled of [null, 'primary']) {
    const pool = readOnlyPool({ snapshots: { alice: SNAPSHOT } }), before = JSON.stringify(pool.db.snapshots);
    await withGoogle({ pool, budget: stalled ? 150 : undefined }, async ({ api, summary, agenda }) => {
      api.seed({ summary: 'Dentist', start: at(D1, '09:00'), end: at(D1, '10:00') });
      if (stalled) api.stall(stalled);
      const home = await call(summary, 'GET /'), month = await call(agenda, 'GET /agenda', { query: agendaQuery });
      assert.deepEqual([home.statusCode, month.statusCode], [200, 200]);
      const shown = stalled ? 'Saved standup' : 'Dentist';
      assert.ok(items(home.body).some(([t]) => t === shown) && month.body.events.some((e) => e.title === shown), `${shown} is shown on Home and in the agenda`);
      assert.deepEqual(pool.refused, [], 'no write was attempted');
      assert.ok(pool.sql.every((s) => /^SELECT /.test(s.text) && s.values[0] === 'alice'), 'only SELECTs, pinned to the caller');
      assert.equal(JSON.stringify(pool.db.snapshots), before, 'the saved copy is unchanged');
      assert.deepEqual(api.writes(), []);
    });
  }
});

test('a Google that does not answer in time: the saved copy with the honest note, and no read started after the budget', async () => {
  const pool = readOnlyPool({ snapshots: { alice: SNAPSHOT } });
  await withGoogle({ pool, budget: 150 }, async ({ api, summary, agenda }) => {
    api.stall('primary');
    const started = Date.now(), out = await call(summary, 'GET /');
    assert.ok(Date.now() - started < 2000, 'the card does not wait past its budget');
    const words = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(SYNCED_AT);
    assert.equal(note(out.body), `Showing your last synced copy from ${words}: Google did not answer.`);
    assert.deepEqual(items(out.body), [['Saved standup', '… / Google Calendar, last synced copy']]);
    assert.deepEqual([out.body.google.state, out.body.partial, out.body.metrics[0].value], ['saved-copy', true, '1']);
    const month = await call(agenda, 'GET /agenda', { query: agendaQuery });
    assert.deepEqual([month.body.partial, month.body.warnings, month.body.google.state], [true, [`Showing your last synced copy from ${words}: Google did not answer.`], 'saved-copy']);
  });
  await withGoogle({ budget: 150 }, async ({ api, summary }) => {
    api.stall('list');
    const out = await call(summary, 'GET /');
    assert.equal(note(out.body), 'Google Calendar did not answer just now, so your Google events are not shown. They are read again the next time this opens.');
    assert.deepEqual(out.body.metrics.map((x) => x.value), ['No answer', 'No answer']);
    assert.deepEqual(api.requests.map((r) => r.path), ['/calendar/v3/users/me/calendarList'], 'one round: nothing more is started once the budget is spent');
  });
});

test('no Google connection: the card says to connect Google, never to sync, and still lists the events added in Open Swarm', async () => {
  const pool = readOnlyPool({ own: { alice: [ownRow('a0000000-0000-4000-8000-000000000002', 'Book club', D2, '19:00')] } });
  await withGoogle({ connection: null, pool }, async ({ summary, agenda }) => {
    const out = await call(summary, 'GET /');
    assert.equal(note(out.body), 'Connect Google on the Connections page (/utilities) to see your Google Calendar here. Events added in Open Swarm are shown without it.');
    const words = [...out.body.items.map((i) => `${i.text} ${i.detail || ''}`), ...out.body.metrics.map((x) => `${x.label} ${x.value}`)].join(' ');
    assert.ok(!/sync/i.test(words), 'nothing a person reads says sync');
    assert.deepEqual(out.body.metrics.map((x) => [x.id, x.value]), [['upcoming-5d', 'Not connected'], ['upcoming-30d', 'Not connected'], ['own-upcoming', '1']]);
    assert.deepEqual(items(out.body), [['Book club', '… / added in Open Swarm']]);
    const month = await call(agenda, 'GET /agenda', { query: agendaQuery });
    assert.deepEqual([month.body.partial, month.body.google.state, month.body.events.map((e) => e.title)], [false, 'not-connected', ['Book club']]);
  });
  await withGoogle({ connection: 'a-grant-google-no-longer-accepts' }, async ({ summary }) => {
    assert.equal(note((await call(summary, 'GET /')).body), 'Your Google connection is no longer accepted. Reconnect Google on the Connections page (/utilities) to see your Google Calendar here.');
  });
});

test('the agenda (the Calendar screen and Home\'s "Your calendar" frame) reads Google live, each event with the calendar it is on', async () => {
  const calendars = [{ id: 'family@group.calendar.google.com', summary: 'Family', selected: true, accessRole: 'writer' }];
  const pool = readOnlyPool({ own: { alice: [ownRow('a0000000-0000-4000-8000-000000000003', 'Pick up the cake', D1, '08:00')] }, snapshots: { alice: SNAPSHOT } });
  await withGoogle({ calendars, pool }, async ({ api, agenda }) => {
    api.seed({ summary: 'Dentist', start: at(D1, '09:00'), end: at(D1, '10:00') });
    api.seedOn('family@group.calendar.google.com', { summary: 'Soccer practice', start: at(D2, '17:00'), end: at(D2, '18:00') });
    const out = await call(agenda, 'GET /agenda', { query: agendaQuery });
    assert.equal(out.statusCode, 200);
    assert.deepEqual(out.body.events.map((e) => [e.title, e.source, e.calendar, e.firstDay]), [['Pick up the cake', 'oshal', null, D1], ['Dentist', 'google', null, D1], ['Soccer practice', 'google', 'Family', D2]]);
    assert.deepEqual([out.body.partial, out.body.warnings], [false, []], 'a calendar that read fine says nothing in the status line');
    assert.equal(out.body.google.note, 'Read from Google Calendar just now: your primary calendar and Family.');
    const asked = api.requests.find((r) => r.path === '/calendar/v3/calendars/primary/events').query;
    const after = new Date(Date.parse(`${agendaQuery.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    assert.deepEqual([asked.timeMin, asked.timeMax], [new Date(wallAt(`${agendaQuery.from}T00:00`, ZONE)).toISOString(), new Date(wallAt(`${after}T00:00`, ZONE)).toISOString()], 'the window\'s days in the viewer\'s zone');
  });
});
