/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Calendar Preparation finds, changes, cancels and declines meetings on the person's own
 *   Google Calendar (1.4.0). Roger, 2026-11-14: "the calendar aplication can't change a meeting it can only create new ones ...
 *   can't cancel or modify existing meeting". Red before: no route listed Google meetings by words or a window (only the synced
 *   snapshot), and none changed, cancelled or declined one (routes/meetings.js did not exist). Boundary: the compiled routes
 *   over the package's declared egress, with a stand-in for the kernel's package egress (declared host only, the headers a
 *   package may set, the caller's own credential placed by the kernel, "not connected" without one) in front of a stand-in
 *   Google Calendar v3 events API on loopback (tests/fixtures/google-calendar-standin.cjs). Named seams: the in-memory caller
 *   (OIDC), a recording pool for the snapshot and the OSHAL events, the stand-in egress and Google. Made-up people only.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Fix Sunday wall-clock failure where nextWeekday(2, 3) skipped the upcoming Tuesday (2 days ahead on Sundays) to 9 days ahead, placing the second weekly occurrence 16 days out past the 14-day search window.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { modules, call, nextWeekday, dayAhead, ROOT } = require('./fixtures/calendar-modules.cjs');
const { standInGoogle, kernelEgress } = require('./fixtures/google-calendar-standin.cjs');

const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));
const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
const m = modules();
const ZONE = 'America/Chicago';
const TUE = nextWeekday(2, 1), WED = nextWeekday(3, 2), THU = nextWeekday(4, 3);
const at = (day, time) => ({ dateTime: `${day}T${time}:00`, timeZone: ZONE });
const you = { email: 'you@example.com', displayName: 'You', self: true, responseStatus: 'accepted' };
const dana = { email: 'dana@example.com', displayName: 'Dana Reyes', responseStatus: 'accepted' };
const sam = { email: 'sam@example.com', displayName: 'Sam Ortiz', responseStatus: 'needsAction' };
const morgan = { email: 'morgan@example.com', displayName: 'Morgan Lee', organizer: true, responseStatus: 'accepted' };

/** A pool holding a synced snapshot and no OSHAL events, recording every statement. */
function pool(snapshot = null) {
  const sql = [];
  const state = { snapshot };
  return { sql, state, async query(q, values) {
    const text = typeof q === 'string' ? q : q.text, vals = typeof q === 'string' ? values : q.values;
    sql.push({ text, values: vals });
    if (/FROM calendar_own_events WHERE user_sub = \$1 AND starts_at >= \$2 AND starts_at < \$3/.test(text)) return { rows: [] };
    if (/^SELECT events,synced_at FROM calendar_preparation_snapshots WHERE user_sub = \$1$/.test(text)) return { rows: state.snapshot ? [state.snapshot] : [] };
    if (/^UPDATE calendar_preparation_snapshots SET events = \$2 WHERE user_sub = \$1$/.test(text)) { state.snapshot = { ...state.snapshot, events: JSON.parse(vals[1]) }; return { rowCount: 1 }; }
    throw new Error('pool cannot answer: ' + text.slice(0, 90));
  } };
}

/** The made-up calendar: two 3 PM meetings with Dana, a dentist visit, an invitation and a weekly series. */
function seedAll(api) {
  return {
    coffee: api.seed({ summary: 'Coffee with Dana', start: at(TUE, '15:00'), end: at(TUE, '15:30'), location: 'Blue Bottle', description: 'Talk about the Q1 plan', attendees: [you, dana] }),
    budget: api.seed({ summary: 'Budget review with Dana', start: at(WED, '15:00'), end: at(WED, '16:00'), attendees: [you, dana, sam] }),
    dentist: api.seed({ summary: 'Dentist', start: at(WED, '09:00'), end: at(WED, '10:00'), location: 'Main St Dental' }),
    board: api.seed({ summary: 'Board prep', start: at(THU, '11:00'), end: at(THU, '12:00'), organizer: { email: morgan.email, displayName: morgan.displayName }, attendees: [morgan, { ...you, responseStatus: 'accepted' }], guestsCanModify: false }),
    weekly: api.seed({ summary: 'Weekly 1:1 with Sam', start: at(TUE, '10:00'), end: at(TUE, '10:30'), recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=6'], attendees: [you, sam] }),
  };
}

/** A calendar behind the stand-in egress, with its routes. */
async function withGoogle(connection, run, snapshot = null) {
  const api = await standInGoogle();
  const ids = seedAll(api), egress = kernelEgress(manifest, connection, api), p = pool(snapshot);
  try { await run({ api, ids, routes: m.meetings.createMeetingsRoutes({ pool: p }).routes, sent: egress.sent, pool: p }); }
  finally { egress.restore(); await api.close(); }
}
const find = (routes, query) => call(routes, 'GET /', { query: { timeZone: ZONE, from: dayAhead(0), to: dayAhead(15), ...query } });
const named = (found, title) => found.body.meetings.find((x) => x.title === title);
/** The card the assistant proposes for a listed meeting. */
const card = (meeting, extra) => ({ revision: meeting.revision, title: meeting.title, start: meeting.start, timeZone: ZONE, guests: 'Will be told', confirm: true, ...extra });
const patches = (api) => api.requests.filter((r) => r.method === 'PATCH');

test('the finder lists Google meetings by a guest\'s name in a window and says to ask which when two match', async () => {
  await withGoogle('person-write', async ({ api, routes, sent }) => {
    const found = await find(routes, { words: 'Dana' });
    assert.equal(found.statusCode, 200, JSON.stringify(found.body));
    assert.deepEqual(found.body.meetings.map((x) => x.title), ['Coffee with Dana', 'Budget review with Dana']);
    const coffee = named(found, 'Coffee with Dana');
    assert.match(coffee.revision, /^g\.[a-z0-9]+\.\d+$/, 'one revision names the meeting and its version');
    assert.match(coffee.local, /^Tue, .+ 3:00 PM CST$/);
    assert.deepEqual(coffee.guests, [{ name: 'Dana Reyes', email: 'dana@example.com', answer: 'yes' }]);
    assert.deepEqual([coffee.you, coffee.canChange, coffee.location, coffee.source], ['organizer', true, 'Blue Bottle', 'google']);
    assert.match(found.body.note, /Ask the person which one they mean, naming each with its day and time; never choose one yourself/);
    assert.equal(found.body.google, 'read');
    const list = api.requests.find((r) => r.method === 'GET' && r.path.endsWith('/events'));
    assert.deepEqual([list.query.q, list.query.singleEvents], ['Dana', 'true']);
    assert.ok(sent.every((s) => !('authorization' in s.headers)), 'the package sends no credential');
    const weekly = named(await find(routes, { words: 'Sam 1:1' }), 'Weekly 1:1 with Sam');
    assert.equal(weekly.repeating, 'every week on Tuesday');
    assert.match(weekly.revision, /^g\.[a-z0-9]+_\d{8}T\d{6}Z\.\d+\.\d+$/, 'an occurrence carries its series\' version too');
    const invited = named(await find(routes, { words: 'Board' }), 'Board prep');
    assert.deepEqual([invited.you, invited.organizer, invited.canChange], ['invited', 'Morgan Lee', false]);
    const none = await find(routes, { words: 'Zanzibar' });
    assert.deepEqual(none.body.meetings, []);
    assert.match(none.body.note, /matches "Zanzibar"\. Say so, and ask for another word or day; never guess\./);
  });
});

test('changing one field sends only that field: the place, notes, guests and times stay exactly as they were', async () => {
  await withGoogle('person-write', async ({ api, ids, routes }) => {
    const coffee = named(await find(routes, { words: 'Coffee' }), 'Coffee with Dana');
    const before = api.get(ids.coffee);
    const out = await call(routes, 'PATCH /google', { body: card(coffee, { newTitle: 'Coffee and roadmap with Dana' }) });
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    assert.deepEqual(patches(api).map((r) => [Object.keys(r.body), r.query.sendUpdates]), [[['summary'], 'all']]);
    const after = api.get(ids.coffee);
    assert.equal(after.summary, 'Coffee and roadmap with Dana');
    for (const key of ['start', 'end', 'location', 'description', 'attendees']) assert.deepEqual(after[key], before[key], `${key} is untouched`);
    assert.deepEqual(out.body.changed, [{ field: 'Title', before: 'Coffee with Dana', after: 'Coffee and roadmap with Dana' }]);
    assert.match(out.body.where, /^Changed the title on your Google Calendar\. Dana Reyes was told\. To put it back, ask to undo it\.$/);
    assert.equal(out.body.event.title, 'Coffee and roadmap with Dana', 'the result line names the meeting as it is now');
    assert.equal(out.body.undo.newTitle, 'Coffee with Dana', 'the undo puts the old title back');
    const undone = await call(routes, 'PATCH /google', { body: out.body.undo });
    assert.equal(undone.statusCode, 200, JSON.stringify(undone.body));
    assert.equal(api.get(ids.coffee).summary, 'Coffee with Dana');
  });
});

test('"move it to Thursday at 2" keeps its length, and "do not tell the guests" sends no update', async () => {
  await withGoogle('person-write', async ({ api, ids, routes }) => {
    const coffee = named(await find(routes, { words: 'Coffee' }), 'Coffee with Dana');
    const out = await call(routes, 'PATCH /google', { body: card(coffee, { newStart: `${THU}T14:00`, guests: 'Will not be told' }) });
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    const sentPatch = patches(api)[0];
    assert.deepEqual([Object.keys(sentPatch.body).sort(), sentPatch.query.sendUpdates], [['end', 'start'], 'none']);
    assert.deepEqual(sentPatch.body.start, { dateTime: `${THU}T14:00:00`, timeZone: ZONE });
    assert.deepEqual(sentPatch.body.end, { dateTime: `${THU}T14:30:00`, timeZone: ZONE }, 'half an hour, as before');
    assert.equal(api.get(ids.coffee).location, 'Blue Bottle');
    assert.deepEqual(out.body.changed.map((c) => c.field), ['Starts', 'Ends']);
    assert.match(out.body.changed[0].before, /^Tue, .+ 3:00 PM CST$/);
    assert.match(out.body.changed[0].after, /^Thu, .+ 2:00 PM CST$/);
    assert.match(out.body.where, /The guest was not told\./);
    assert.match(out.body.undo.newStart, new RegExp(`^${TUE}T15:00:00-06:00$`), 'the undo puts the old start back');
  });
});

test('a meeting changed elsewhere after it was read is refused, never overwritten; a card naming another meeting is refused', async () => {
  await withGoogle('person-write', async ({ api, ids, routes }) => {
    const coffee = named(await find(routes, { words: 'Coffee' }), 'Coffee with Dana');
    api.events.set(ids.coffee, { ...api.events.get(ids.coffee), location: 'Changed in Google', etag: '"3181169999999999"' });
    const stale = await call(routes, 'PATCH /google', { body: card(coffee, { newTitle: 'Lunch with Dana' }) });
    assert.equal(stale.statusCode, 409);
    assert.match(stale.body.error, /^This meeting changed in Google Calendar after it was read\. Nothing was changed\. Ask again, and it is read fresh\.$/);
    assert.equal(api.get(ids.coffee).location, 'Changed in Google', 'the change made elsewhere stands');
    const fresh = named(await find(routes, { words: 'Coffee' }), 'Coffee with Dana');
    const wrong = await call(routes, 'PATCH /google', { body: card(fresh, { title: 'Budget review with Dana', newTitle: 'Lunch' }) });
    assert.equal(wrong.statusCode, 409);
    assert.match(wrong.body.error, /^The card named "Budget review with Dana" at .+, but the calendar now holds "Coffee with Dana" at .+\. Nothing was changed\./);
    const late = await call(routes, 'PATCH /google', { body: card(fresh, { newStart: `${dayAhead(-1)}T14:00` }) });
    assert.equal(late.statusCode, 400);
    assert.match(late.body.error, /^That time has already passed \(.+\)\. Nothing was changed\. Ask for a time still ahead\.$/);
    assert.equal(patches(api).length, 0, 'nothing was written');
  });
});

test('a second Approve of the same change does nothing twice', async () => {
  await withGoogle('person-write', async ({ api, routes }) => {
    const coffee = named(await find(routes, { words: 'Coffee' }), 'Coffee with Dana');
    const body = card(coffee, { newLocation: 'Union Square' });
    assert.equal((await call(routes, 'PATCH /google', { body })).statusCode, 200);
    const again = await call(routes, 'PATCH /google', { body });
    assert.equal(again.statusCode, 200);
    assert.equal(again.body.already, true);
    assert.match(again.body.where, /already on your Google Calendar\. Nothing was changed again\./);
    assert.equal(patches(api).length, 1);
  });
});

test('guests are added and removed by address, and "None" for a meeting with guests is refused', async () => {
  await withGoogle('person-write', async ({ api, ids, routes }) => {
    const budget = named(await find(routes, { words: 'Budget' }), 'Budget review with Dana');
    const none = await call(routes, 'PATCH /google', { body: card(budget, { newTitle: 'Budget', guests: 'None' }) });
    assert.equal(none.statusCode, 409);
    assert.match(none.body.error, /has 2 guests \(Dana Reyes and Sam Ortiz\), but the card said None/);
    const stranger = await call(routes, 'PATCH /google', { body: card(budget, { removeGuests: ['lee@example.com'] }) });
    assert.match(stranger.body.error, /lee@example\.com is not a guest of this meeting/);
    const out = await call(routes, 'PATCH /google', { body: card(budget, { addGuests: ['kim@example.com'], removeGuests: ['sam@example.com'] }) });
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    assert.deepEqual(api.get(ids.budget).attendees.map((a) => a.email), ['you@example.com', 'dana@example.com', 'kim@example.com']);
    assert.deepEqual(out.body.changed.at(-1), { field: 'Guests', before: 'Dana Reyes and Sam Ortiz', after: 'Dana Reyes and kim@example.com' });
    assert.deepEqual([out.body.undo.addGuests, out.body.undo.removeGuests], [['sam@example.com'], ['kim@example.com']]);
  });
});

test('cancelling a meeting the person organizes deletes it and tells the guests; a second cancel does nothing twice', async () => {
  await withGoogle('person-write', async ({ api, ids, routes }) => {
    const coffee = named(await find(routes, { words: 'Coffee' }), 'Coffee with Dana');
    const out = await call(routes, 'POST /google/cancel', { body: card(coffee) });
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    const del = api.requests.filter((r) => r.method === 'DELETE');
    assert.deepEqual(del.map((r) => [r.path.split('/').pop(), r.query.sendUpdates]), [[ids.coffee, 'all']]);
    assert.equal(api.get(ids.coffee).status, 'cancelled');
    assert.match(out.body.where, /^Cancelled on your Google Calendar\. Dana Reyes was told\. It cannot be put back here, because its guests had it on their calendars/);
    assert.equal(out.body.undo, null, 'a meeting with guests is not put back');
    const again = await call(routes, 'POST /google/cancel', { body: card(coffee) });
    assert.deepEqual([again.statusCode, again.body.already], [200, true]);
    assert.equal(api.requests.filter((r) => r.method === 'DELETE').length, 1);
    const dentist = named(await find(routes, { words: 'Dentist' }), 'Dentist');
    const solo = await call(routes, 'POST /google/cancel', { body: card(dentist, { guests: 'None' }) });
    assert.equal(solo.statusCode, 200, JSON.stringify(solo.body));
    assert.equal(api.requests.filter((r) => r.method === 'DELETE').at(-1).query.sendUpdates, 'none');
    assert.match(solo.body.where, /To put it back, ask to add it again\.$/);
    assert.deepEqual([solo.body.undo.title, solo.body.undo.location], ['Dentist', 'Main St Dental'], 'the undo is the add that puts it back');
  });
});

test('a meeting the person was only invited to is declined, never cancelled or moved by them', async () => {
  await withGoogle('person-write', async ({ api, ids, routes }) => {
    const board = named(await find(routes, { words: 'Board' }), 'Board prep');
    const cancel = await call(routes, 'POST /google/cancel', { body: card(board) });
    assert.equal(cancel.statusCode, 409);
    assert.match(cancel.body.error, /^You were invited to this meeting by Morgan Lee, so it is not yours to cancel\. Nothing was cancelled\. You can decline it instead\.$/);
    const move = await call(routes, 'PATCH /google', { body: card(board, { newStart: `${THU}T15:00` }) });
    assert.equal(move.statusCode, 403);
    assert.match(move.body.error, /^Morgan Lee organizes this meeting, so only they can change it\. Nothing was changed\. You can decline it, or open it in Google Calendar to propose a new time\.$/);
    assert.equal(api.writes().length, 0);
    const declined = await call(routes, 'POST /google/decline', { body: { ...card(board), guests: undefined, organizer: 'Will be told' } });
    assert.equal(declined.statusCode, 200, JSON.stringify(declined.body));
    const sentPatch = patches(api)[0];
    assert.deepEqual([Object.keys(sentPatch.body), sentPatch.query.sendUpdates], [['attendees'], 'all']);
    assert.equal(api.get(ids.board).attendees.find((a) => a.self).responseStatus, 'declined');
    assert.equal(api.get(ids.board).status, 'confirmed', 'the meeting stays on the organizer\'s calendar');
    assert.match(declined.body.where, /^Declined; it stays on Morgan Lee's calendar\. Morgan Lee was told\./);
    const again = await call(routes, 'POST /google/decline', { body: { ...card(board), guests: undefined, organizer: 'Will be told' } });
    assert.equal(again.body.already, true);
    assert.equal(patches(api).length, 1);
    const coffee = named(await find(routes, { words: 'Coffee' }), 'Coffee with Dana');
    const own = await call(routes, 'POST /google/decline', { body: { ...card(coffee), organizer: 'Will be told' } });
    assert.match(own.body.error, /^You organize this meeting, so there is no invitation to decline/);
  });
});

test('a repeating meeting changes this one or the whole series, as the card says, and asks when it does not', async () => {
  await withGoogle('person-write', async ({ api, ids, routes }) => {
    const first = (await find(routes, { words: 'Weekly' })).body.meetings.filter((x) => x.title === 'Weekly 1:1 with Sam');
    assert.ok(first.length >= 2, 'two occurrences in two weeks');
    const unsaid = await call(routes, 'PATCH /google', { body: card(first[0], { newStart: `${WED}T10:00` }) });
    assert.equal(unsaid.statusCode, 400);
    assert.match(unsaid.body.error, /^This meeting repeats\. Nothing was changed\. Say whether this one only or the whole series\.$/);
    const one = await call(routes, 'PATCH /google', { body: card(first[0], { newStart: `${WED}T10:00`, appliesTo: 'This one only' }) });
    assert.equal(one.statusCode, 200, JSON.stringify(one.body));
    assert.match(patches(api)[0].path, new RegExp(`/${ids.weekly}_\\d{8}T\\d{6}Z$`), 'only that occurrence is written');
    const after = (await find(routes, { words: 'Weekly' })).body.meetings.filter((x) => x.title === 'Weekly 1:1 with Sam');
    assert.match(after[0].local, /^Wed, .+ 10:00 AM CST$/);
    assert.match(after[1].local, /^Tue, .+ 10:00 AM CST$/, 'the next one stays on Tuesday');
    const series = await call(routes, 'PATCH /google', { body: card(after[1], { newStart: `${after[1].start.slice(0, 10)}T09:00`, appliesTo: 'The whole series' }) });
    assert.equal(series.statusCode, 200, JSON.stringify(series.body));
    assert.equal(patches(api)[1].path.split('/').pop(), ids.weekly, 'the series itself is written');
    assert.deepEqual(api.get(ids.weekly).start, { dateTime: api.get(ids.weekly).start.dateTime, timeZone: ZONE });
    assert.match(api.get(ids.weekly).start.dateTime, /T09:00:00-06:00$/);
    assert.deepEqual(api.get(ids.weekly).recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=6'], 'same day: the rule is unchanged');
    assert.match(series.body.where, /for every meeting in the series/);
    const moved = (await find(routes, { words: 'Weekly' })).body.meetings.filter((x) => x.title === 'Weekly 1:1 with Sam');
    const toThursday = await call(routes, 'PATCH /google', { body: card(moved.at(-1), { newStart: `${addDays(moved.at(-1).start.slice(0, 10), 2)}T09:00`, appliesTo: 'The whole series' }) });
    assert.equal(toThursday.statusCode, 200, JSON.stringify(toThursday.body));
    assert.deepEqual(api.get(ids.weekly).recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=6'], 'Tuesdays became Thursdays');
    const cancelOne = await call(routes, 'POST /google/cancel', { body: card((await find(routes, { words: 'Weekly' })).body.meetings.find((x) => x.title === 'Weekly 1:1 with Sam'), { appliesTo: 'This one only' }) });
    assert.equal(cancelOne.statusCode, 200, JSON.stringify(cancelOne.body));
    assert.match(api.requests.filter((r) => r.method === 'DELETE')[0].path, /_\d{8}T\d{6}Z$/, 'one occurrence is cancelled, the series stays');
    assert.equal(api.get(ids.weekly).status, 'confirmed');
  });
});

/** A date moved by whole days. */
function addDays(day, n) { return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10); }

test('without a connection, with a read-only grant or an expired one, the answer says what to reconnect and nothing is written', async () => {
  await withGoogle(null, async ({ api, routes }) => {
    const found = await find(routes, { words: 'Dana' });
    assert.equal(found.statusCode, 200);
    assert.match(found.body.google, /^Google Calendar is not connected, so only events added in Open Swarm are listed\. To change or cancel Google Calendar meetings, connect Google on the Connections page \(\/utilities\) and allow it to view and edit events on your calendars\.$/);
    const out = await call(routes, 'PATCH /google', { body: { revision: 'g.abc.1', title: 'Coffee with Dana', start: `${TUE}T15:00:00-06:00`, newTitle: 'x', guests: 'Will be told', confirm: true } });
    assert.equal(out.statusCode, 409);
    assert.match(out.body.error, /^Google Calendar is not connected\. Connect Google on the Connections page \(\/utilities\) and allow it to view and edit events on your calendars, then ask again\. Nothing was changed\.$/);
    assert.equal(api.requests.length, 0);
  });
  await withGoogle('person-read-only', async ({ api, routes }) => {
    const coffee = named(await find(routes, { words: 'Coffee' }), 'Coffee with Dana');
    assert.ok(coffee, 'a read-only grant still lists');
    const out = await call(routes, 'PATCH /google', { body: card(coffee, { newTitle: 'Lunch' }) });
    assert.equal(out.statusCode, 409);
    assert.match(out.body.error, /^Your Google connection lets this app read your Google Calendar but not change events on it\. Reconnect Google on the Connections page \(\/utilities\) and allow it to view and edit events on your calendars, then ask again\. Nothing was changed\.$/);
    const cancel = await call(routes, 'POST /google/cancel', { body: card(coffee) });
    assert.match(cancel.body.error, /but not cancel events on it\. .*Nothing was cancelled\.$/);
    assert.equal(api.events.get(api.requests.find((r) => r.method === 'PATCH').path.split('/').pop()).summary, 'Coffee with Dana');
  });
  await withGoogle('expired-grant', async ({ routes }) => {
    const out = await call(routes, 'PATCH /google', { body: { revision: 'g.abc.1', title: 'x', start: `${TUE}T15:00:00-06:00`, newTitle: 'y', guests: 'Will be told', confirm: true } });
    assert.match(out.body.error, /^Your Google connection is no longer accepted\. Reconnect Google on the Connections page \(\/utilities\), then ask again\. Nothing was changed\.$/);
  });
});

test('a card without a confirmation, a meeting or a guests choice reaches nothing', async () => {
  await withGoogle('person-write', async ({ api, routes }) => {
    const coffee = named(await find(routes, { words: 'Coffee' }), 'Coffee with Dana');
    const before = api.requests.length;
    for (const [body, words] of [
      [{ ...card(coffee, { newTitle: 'x' }), confirm: undefined }, /Confirm the change/],
      [card(coffee), /Name at least one thing to change/],
      [card(coffee, { newTitle: 'x', guests: undefined }), /Say whether the guests are told/],
      [card(coffee, { newTitle: 'x', revision: 'Coffee with Dana' }), /does not name a meeting this app read/],
      [card(coffee, { newTitle: 'x', appliesTo: 'all of them' }), /"appliesTo" is "This one only" or "The whole series"/],
      [card(coffee, { addGuests: ['not an address'] }), /lists email addresses/],
    ]) {
      const out = await call(routes, 'PATCH /google', { body });
      assert.equal(out.statusCode, 400, JSON.stringify(body));
      assert.match(out.body.error, words);
    }
    assert.equal(api.requests.length, before, 'a refused card reads nothing and writes nothing');
  });
});

test('the synced snapshot follows a change and a cancellation, so the Calendar screen shows them', async () => {
  const snapshot = { synced_at: new Date().toISOString(), events: [] };
  await withGoogle('person-write', async ({ ids, routes, pool: p }) => {
    p.state.snapshot.events = [{ id: ids.coffee, title: 'Coffee with Dana', start: `${TUE}T15:00:00-06:00`, end: `${TUE}T15:30:00-06:00`, allDay: false, url: null },
      { id: ids.dentist, title: 'Dentist', start: `${WED}T09:00:00-06:00`, end: `${WED}T10:00:00-06:00`, allDay: false, url: null }];
    const coffee = named(await find(routes, { words: 'Coffee' }), 'Coffee with Dana');
    await call(routes, 'PATCH /google', { body: card(coffee, { newStart: `${THU}T14:00` }) });
    const moved = p.state.snapshot.events.find((e) => e.id === ids.coffee);
    assert.match(moved.start, new RegExp(`^${THU}T14:00:00`));
    const dentist = named(await find(routes, { words: 'Dentist' }), 'Dentist');
    await call(routes, 'POST /google/cancel', { body: card(dentist, { guests: 'None' }) });
    assert.deepEqual(p.state.snapshot.events.map((e) => e.id), [ids.coffee]);
  }, snapshot);
});

test('the manifest offers find, change, cancel and decline, the writes held for approval with cards that say what they do', () => {
  const tool = (name) => manifest.tools.find((t) => t.name === name);
  assert.deepEqual([tool('calendar-find-events').executor.apiEndpoint, tool('calendar-find-events').requiresApproval],
    ['GET /api/calendar/meetings?from={input.from}&to={input.to}&words={input.words}&timeZone={input.timeZone}', false]);
  for (const [name, endpoint] of [['calendar-change-google-event', 'PATCH /api/calendar/meetings/google'], ['calendar-cancel-google-event', 'POST /api/calendar/meetings/google/cancel'],
    ['calendar-decline-google-event', 'POST /api/calendar/meetings/google/decline'], ['calendar-change-event', 'PATCH /api/calendar/meetings/oshal/{input.id}']]) {
    assert.deepEqual([tool(name).executor.apiEndpoint, tool(name).requiresApproval], [endpoint, true], name);
    assert.ok(tool(name).inputSchema.required.includes('confirm'), name);
    assert.ok(tool(name).inputSchema.required.includes('revision'), name);
  }
  assert.deepEqual(tool('calendar-change-google-event').inputSchema.properties.guests.enum, ['Will be told', 'Will not be told', 'None']);
  assert.deepEqual(tool('calendar-change-google-event').inputSchema.properties.appliesTo.enum, ['This one only', 'The whole series']);
  assert.ok(manifest.routes.some((r) => r.mountPath === '/api/calendar/meetings' && r.module === 'routes/meetings.js' && r.requiresAuth === true));
});
