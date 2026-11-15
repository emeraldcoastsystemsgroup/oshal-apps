/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Changing and removing an event the person added in OSHAL (calendar 1.4.0). Roger, 2026-11-14:
 *   "can't cancel or modify existing meeting". Red before: no route changed an OSHAL event (PATCH /api/calendar/meetings/oshal/:id
 *   did not exist and calendar_own_events had no revision), and a removal card named only a reference. Boundary: the compiled
 *   routes (routes/meetings.js and routes/own-event-changes.js) over a recording pool that keeps calendar_own_events rows per
 *   owner and answers exactly the statements the routes send (the real SQL and row security run in
 *   own-event-changes-postgres.test.cjs). Named seam: the in-memory caller (OIDC). Made-up events only.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: the answers say "your Open Swarm calendar" and "Events added in Open Swarm" (Roger, 2026-11-13: what a
 *   person sees names the product Open Swarm); the route path and the "source" value keep oshal.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { modules, call } = require('./fixtures/calendar-modules.cjs');

const m = modules();
const ZONE = 'America/Chicago';
const UPDATE = /^UPDATE calendar_own_events SET title = \$3, starts_at = \$4, ends_at = \$5, all_day = \$6, time_zone = \$7, location = \$8, notes = \$9, revision = \$10 WHERE user_sub = \$1 AND id = \$2 AND (revision = \$11|revision IS NULL)$/;

/** A pool that keeps calendar_own_events rows per owner and answers the change and removal statements. */
function pool(seed = {}) {
  const rows = JSON.parse(JSON.stringify(seed)), sql = [];
  return { rows, sql, async query(q, values) {
    const text = typeof q === 'string' ? q : q.text, vals = typeof q === 'string' ? values : q.values;
    sql.push({ text, values: vals });
    const mine = rows[vals[0]] || (rows[vals[0]] = []);
    if (/^SELECT .* FROM calendar_own_events WHERE user_sub = \$1 AND id = \$2$/.test(text)) return { rows: mine.filter((r) => r.id === vals[1]) };
    if (/^SELECT .* FROM calendar_own_events WHERE user_sub = \$1 AND starts_at >= \$2 AND starts_at < \$3 ORDER BY starts_at ASC LIMIT 100$/.test(text)) {
      return { rows: mine.filter((r) => r.starts_at >= vals[1] && r.starts_at < vals[2]).sort((a, b) => a.starts_at.localeCompare(b.starts_at)) };
    }
    const update = UPDATE.exec(text);
    if (update) {
      const row = mine.find((r) => r.id === vals[1] && (update[1] === 'revision IS NULL' ? r.revision == null : r.revision === vals[10]));
      if (!row) return { rowCount: 0, rows: [] };
      Object.assign(row, { title: vals[2], starts_at: vals[3], ends_at: vals[4], all_day: vals[5], time_zone: vals[6], location: vals[7], notes: vals[8], revision: vals[9] });
      return { rowCount: 1, rows: [] };
    }
    if (/^DELETE FROM calendar_own_events WHERE user_sub = \$1 AND id = \$2$/.test(text)) {
      const before = mine.length; rows[vals[0]] = mine.filter((r) => r.id !== vals[1]);
      return { rowCount: before - rows[vals[0]].length, rows: [] };
    }
    throw new Error('pool cannot answer: ' + text.slice(0, 90));
  } };
}
const LUNCH = '6b0d7e2a-1c4f-4a8e-9d3b-5f2e8c1a7b90', TRIP = '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f';
/** A day ahead, as a 'YYYY-MM-DD' in UTC (the rows are seeded in UTC instants). */
const ahead = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const seed = () => ({ alice: [
  { id: LUNCH, title: 'Team lunch', starts_at: `${ahead(5)}T18:00:00.000Z`, ends_at: `${ahead(5)}T19:30:00.000Z`, all_day: false, time_zone: ZONE, location: 'Cafe Rio', notes: 'Bring the slides', created_at: new Date().toISOString(), revision: 'o.first1' },
  { id: TRIP, title: 'Denver trip', starts_at: `${ahead(9)}T00:00:00.000Z`, ends_at: `${ahead(11)}T00:00:00.000Z`, all_day: true, time_zone: null, location: null, notes: null, created_at: new Date().toISOString(), revision: null },
] });
const routes = (p) => m.meetings.createMeetingsRoutes({ pool: p }).routes;
const listed = (p, words) => m['own-event-changes'].ownMeetings({ pool: p }, 'alice', { timeMin: `${ahead(0)}T00:00:00.000Z`, timeMax: `${ahead(30)}T00:00:00.000Z`, words });
const card = (e, extra) => ({ id: e.id, revision: e.revision, title: e.title, start: e.start, ...(e.timeZone ? { timeZone: e.timeZone } : {}), confirm: true, ...extra });
const change = (r, e, extra) => call(r, 'PATCH /oshal/:id', { params: { id: e.id }, body: card(e, extra) });
const updates = (p) => p.sql.filter((s) => /^UPDATE/.test(s.text));

test('the finder lists OSHAL events in a window by words, each with its id and revision', async () => {
  const p = pool(seed());
  const lunch = await listed(p, 'lunch rio');
  assert.deepEqual(lunch.map((e) => [e.title, e.source, e.id, e.revision, e.you]), [['Team lunch', 'oshal', LUNCH, 'o.first1', 'organizer']]);
  assert.match(lunch[0].local, /CST$|CDT$/);
  assert.deepEqual((await listed(p, 'Denver')).map((e) => e.revision), ['o.original'], 'a row saved before revisions reads as the original');
  assert.deepEqual(await listed(p, 'dentist'), []);
});

test('changing one field changes only that field, and the undo puts it back', async () => {
  const p = pool(seed()), r = routes(p);
  const [lunch] = await listed(p, 'lunch');
  const out = await change(r, lunch, { newTitle: 'Team lunch and planning' });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  const row = p.rows.alice.find((x) => x.id === LUNCH);
  assert.equal(row.title, 'Team lunch and planning');
  assert.deepEqual([row.starts_at, row.ends_at, row.location, row.notes, row.time_zone, row.all_day], [`${ahead(5)}T18:00:00.000Z`, `${ahead(5)}T19:30:00.000Z`, 'Cafe Rio', 'Bring the slides', ZONE, false]);
  assert.notEqual(row.revision, 'o.first1', 'a change gets a new revision');
  assert.deepEqual(out.body.changed, [{ field: 'Title', before: 'Team lunch', after: 'Team lunch and planning' }]);
  assert.match(out.body.where, /^Changed on your Open Swarm calendar: Title Team lunch → Team lunch and planning\. To put it back, ask to undo it\.$/);
  for (const s of p.sql) assert.equal(s.values[0], 'alice', 'every statement is pinned to the caller');
  const undone = await call(r, 'PATCH /oshal/:id', { params: { id: LUNCH }, body: out.body.undo });
  assert.equal(undone.statusCode, 200, JSON.stringify(undone.body));
  assert.equal(p.rows.alice.find((x) => x.id === LUNCH).title, 'Team lunch');
});

test('a new start keeps the length; an end, a place and notes change only when named', async () => {
  const p = pool(seed()), r = routes(p);
  const [lunch] = await listed(p, 'lunch');
  const out = await change(r, lunch, { newStart: `${ahead(6)}T11:00`, timeZone: ZONE, newLocation: 'Union Kitchen', location: 'Cafe Rio' });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  const row = p.rows.alice.find((x) => x.id === LUNCH);
  assert.equal(Date.parse(row.ends_at) - Date.parse(row.starts_at), 90 * 60_000, 'an hour and a half, as before');
  assert.deepEqual([row.location, row.notes], ['Union Kitchen', 'Bring the slides']);
  assert.deepEqual(out.body.changed.map((c) => c.field), ['Starts', 'Ends', 'Where']);
  const trip = (await listed(p, 'Denver'))[0];
  const moved = await change(r, trip, { newStart: ahead(12) });
  assert.equal(moved.statusCode, 200, JSON.stringify(moved.body));
  const tripRow = p.rows.alice.find((x) => x.id === TRIP);
  assert.deepEqual([tripRow.starts_at, tripRow.ends_at, tripRow.all_day], [`${ahead(12)}T00:00:00.000Z`, `${ahead(14)}T00:00:00.000Z`, true], 'two days, as before');
  assert.match(updates(p).at(-1).text, /revision IS NULL$/, 'a row saved before revisions is bound to having none');
});

test('a change made elsewhere meanwhile, or a card naming another event, is refused and writes nothing', async () => {
  const p = pool(seed()), r = routes(p);
  const [lunch] = await listed(p, 'lunch');
  assert.equal((await change(r, lunch, { newNotes: 'Changed on the screen' })).statusCode, 200);
  const stale = await change(r, lunch, { newTitle: 'Planning lunch' });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.error, 'This event changed after it was read. Nothing was changed. Ask again, and it is read fresh.');
  const fresh = (await listed(p, 'lunch'))[0];
  const other = await change(r, fresh, { title: 'Denver trip', newTitle: 'x' });
  assert.equal(other.statusCode, 409);
  assert.match(other.body.error, /^The card named "Denver trip" at .+, but the calendar now holds "Team lunch" at .+\. Nothing was changed\./);
  assert.equal(p.rows.alice.find((x) => x.id === LUNCH).title, 'Team lunch');
  assert.equal(updates(p).length, 1, 'only the first change was written');
});

test('a time in the past, an end before the start, a series and another person\'s event are refused in words', async () => {
  const p = pool(seed()), r = routes(p);
  const [lunch] = await listed(p, 'lunch');
  const past = await change(r, lunch, { newStart: `${ahead(-2)}T11:00`, timeZone: ZONE });
  assert.equal(past.statusCode, 400);
  assert.match(past.body.error, /^That time has already passed \(.+\)\. Nothing was changed\. Ask for a time still ahead\.$/);
  const backwards = await change(r, lunch, { newEnd: `${ahead(5)}T09:00`, timeZone: ZONE });
  assert.match(backwards.body.error, /The new end is before the start/);
  const series = await change(r, lunch, { newTitle: 'x', appliesTo: 'The whole series' });
  assert.equal(series.body.error, 'Events added in Open Swarm are single events, so there is no series to change. Nothing was changed.');
  const bob = await call(r, 'PATCH /oshal/:id', { params: { id: LUNCH }, body: card(lunch, { newTitle: 'Taken' }), sub: 'bob' });
  assert.equal(bob.statusCode, 404);
  assert.equal(bob.body.error, 'That event is no longer on your Open Swarm calendar. Nothing was changed.');
  assert.equal((await change(r, lunch, {})).body.error, 'Name at least one thing to change: a new title, start, end, place, notes or guests.');
  assert.equal(updates(p).length, 0);
});

test('a second Approve of the same change does nothing twice', async () => {
  const p = pool(seed()), r = routes(p);
  const [lunch] = await listed(p, 'lunch');
  const body = card(lunch, { newLocation: 'Union Kitchen' });
  assert.equal((await call(r, 'PATCH /oshal/:id', { params: { id: LUNCH }, body })).statusCode, 200);
  const again = await call(r, 'PATCH /oshal/:id', { params: { id: LUNCH }, body });
  assert.deepEqual([again.statusCode, again.body.already], [200, true]);
  assert.equal(again.body.where, 'That change is already on your Open Swarm calendar. Nothing was changed again.');
  assert.equal(updates(p).length, 1);
});

test('a removal card is held to the title and start it shows, answers with the event and carries the add that puts it back', async () => {
  const p = pool(seed()), r = routes(p);
  const [lunch] = await listed(p, 'lunch');
  const wrong = await call(r, 'DELETE /oshal/:id', { params: { id: LUNCH }, body: { title: 'Denver trip', start: lunch.start, timeZone: ZONE } });
  assert.equal(wrong.statusCode, 409);
  assert.match(wrong.body.error, /Nothing was removed\./);
  assert.equal(p.rows.alice.length, 2);
  const out = await call(r, 'DELETE /oshal/:id', { params: { id: LUNCH }, body: { id: LUNCH, title: 'Team lunch', start: lunch.start, timeZone: ZONE } });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(out.body.event.title, 'Team lunch', 'the result line names the event');
  assert.equal(out.body.where, 'Removed from your Open Swarm calendar. To put it back, ask to add it again.');
  assert.deepEqual([out.body.undo.title, out.body.undo.location, out.body.undo.notes, out.body.undo.confirm], ['Team lunch', 'Cafe Rio', 'Bring the slides', true]);
  assert.equal(p.rows.alice.length, 1);
  const parsed = m['own-events'].parseEvent(out.body.undo);
  assert.equal(parsed.ok, true, 'the undo is a valid add');
  assert.equal(parsed.startsAt, `${ahead(5)}T18:00:00.000Z`);
  const again = await call(r, 'DELETE /oshal/:id', { params: { id: LUNCH }, body: {} });
  assert.equal(again.statusCode, 404, 'a second removal removes nothing');
});
