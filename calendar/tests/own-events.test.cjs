/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Events a person adds in OSHAL (routes/own-events.js): adding needs confirm, a title and a real start
 *   (a date is all day; a timed start must carry its UTC offset, never guessed), an end not before the start and bounded text; every
 *   statement is pinned to the verified caller; a full calendar answers 409 without a write; removal names an id of the caller's own;
 *   the Home summary lists the added events beside synced ones, marked "added in OSHAL", and is unchanged when there are none; the
 *   manifest offers calendar-add-event and calendar-remove-event held for approval and mounts the route. Red before: no route or tool
 *   could add an event, so Jarvis's calendar hand-off ended with "I only have read-only tools".
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 9: a local start with the person's timeZone is saved as that zone's instant and listed with
 *   its "local" words; a start with neither an offset nor a zone, or an unknown zone, is refused naming the timeZone field; an
 *   identical event answers 409 without a second row; the Home summary names an added event's start in words, never the raw
 *   UTC instant; the add tool declares timeZone and tells the concierge never to re-propose an approved event.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: the remove tool's id is `format: uuid` (a title such as "sweep10-dentist" was proposed as the id and
 *   the approved card failed "An event id is required"); the route still refuses a title with 400 and removes by the listed id; the
 *   persona reads calendar-my-events before removing, answers a status question without a card and guesses no zone abbreviation.
 *   The kernel's own validator is exercised against this manifest in oshal-kernel crates/packages/tests/store_tool_contracts.rs.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Sweep 11: a trip agreed from Friday 6 PM to Sunday 3 PM was proposed start-only and saved with no
 *   end. The add tool's end field and the persona say a span is one event with its start and end, and the route saves a local
 *   multi-day span with its end in the person's zone. The removal card showed the tool's model instruction as its sentence (the
 *   kernel builds the card label from the description): every approval-held tool's description is now a person-facing sentence
 *   with no tool name, id or call instruction, and the read-first rule lives on the remove tool's id field. Each held tool also
 *   declares a people-facing cardText, the card sentence the kernel reads once its card label change is deployed.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: a removal was answered with a Google sync card, and an add reply said five events were
 *   proposed beside one card. calendar-sync is never a step of an OSHAL add or removal, and the add tool and persona say one call is
 *   one card for one event and a reply names only the events it made a card for.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: proposals said 'approve the card that appeared with my previous reply'. The persona names a card by
 *   its event, never by where it sits or when it appeared.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Demo sweep 2: an Add Event card carried the delegating model's routing text ("Please attempt to add the
 *   event. If it fails due to sync/identity issues, report back ...") as the event's Notes. The add tool's notes field, as the
 *   kernel offers it to the model, says it is optional and only the person's own note, never an explanation, a status or failure
 *   instructions; the field stays optional and the route still saves a note the person gave.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const logger = { createChildLogger: () => ({ error() {}, info() {}, warn() {} }) };
/** Load a compiled route with only its declared dependencies; any other import fails the test. */
function load(file, deps) {
  const m = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(ROOT, 'routes', file), 'utf8'))((name) => {
    if (name in deps) return deps[name];
    throw new Error('unexpected require ' + name);
  }, m, m.exports);
  return m.exports;
}
const router = () => { const routes = {}; const add = (m) => (p, f) => { routes[`${m} ${p}`] = f; }; return { routes, get: add('GET'), post: add('POST'), delete: add('DELETE') }; };
const time = load('event-time.js', {});
const own = load('own-events.js', { express: { Router: router }, crypto: require('node:crypto'), '@/shared/logger': logger, './event-time': time });
const summary = load('home-summary.js', { express: { Router: router }, '@/shared/logger': logger, './own-events': own });

/** A pool that keeps calendar_own_events rows per owner and records every statement. */
function pool(seed = {}) {
  const rows = JSON.parse(JSON.stringify(seed)), sql = [];
  return { rows, sql, async query(q, values) {
    const text = typeof q === 'string' ? q : q.text, vals = typeof q === 'string' ? values : q.values;
    sql.push({ text, values: vals });
    const mine = rows[vals[0]] || (rows[vals[0]] = []);
    if (/^SELECT COUNT\(\*\) AS n FROM calendar_own_events WHERE user_sub = \$1$/.test(text)) return { rows: [{ n: String(mine.length) }] };
    if (/^SELECT .* FROM calendar_own_events WHERE user_sub = \$1 AND starts_at >= \$2 ORDER BY starts_at ASC LIMIT 100$/.test(text)) {
      return { rows: mine.filter((r) => r.starts_at >= vals[1]).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, 100) };
    }
    if (/^SELECT .* FROM calendar_own_events WHERE user_sub = \$1 AND title = \$2 AND starts_at = \$3 AND all_day = \$4 LIMIT 1$/.test(text)) {
      return { rows: mine.filter((r) => r.title === vals[1] && r.starts_at === vals[2] && r.all_day === vals[3]).slice(0, 1) };
    }
    if (/^INSERT INTO calendar_own_events\(user_sub,id,title,starts_at,ends_at,all_day,time_zone,location,notes,created_at\) VALUES\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10\)$/.test(text)) {
      const [, id, title, starts_at, ends_at, all_day, time_zone, location, notes, created_at] = vals;
      mine.push({ id, title, starts_at, ends_at, all_day, time_zone, location, notes, created_at });
      return { rowCount: 1, rows: [] };
    }
    if (/^DELETE FROM calendar_own_events WHERE user_sub = \$1 AND id = \$2$/.test(text)) {
      const before = mine.length; rows[vals[0]] = mine.filter((r) => r.id !== vals[1]);
      return { rowCount: before - rows[vals[0]].length, rows: [] };
    }
    if (/FROM calendar_preparation_snapshots WHERE user_sub = \$1$/.test(text)) return { rows: [] };
    throw new Error('pool cannot answer: ' + text.slice(0, 80));
  } };
}
const req = (body = {}, params = {}, sub = 'alice') => ({ oidc: { user: { sub }, isAuthenticated: () => true }, body, params });
const res = () => ({ statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; } });
const call = async (routes, key, ...args) => { const out = res(); await routes[key](req(...args), out); return out; };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

test('a confirmed event with a real start is saved for the caller only and listed back', async () => {
  const p = pool(), r = own.createOwnEventsRoutes({ pool: p }).routes;
  const trip = { title: 'sweep8 Denver trip', start: `${day(25)}T18:00:00-06:00`, end: `${day(27)}T21:00:00-06:00`, location: 'Denver', notes: 'Leave Friday evening' };
  assert.equal((await call(r, 'POST /', trip)).statusCode, 400, 'confirm is required');
  assert.equal(p.sql.length, 0, 'an unconfirmed add touches nothing');
  const added = await call(r, 'POST /', { ...trip, confirm: true });
  assert.equal(added.statusCode, 201);
  assert.equal(added.body.event.title, 'sweep8 Denver trip');
  assert.equal(added.body.event.start, new Date(trip.start).toISOString(), 'stored as the instant the offset names');
  assert.equal(added.body.event.allDay, false);
  assert.match(added.body.where, /not added to Google Calendar/);
  const hike = await call(r, 'POST /', { title: 'sweep8 Red Rocks hike', start: day(26), confirm: true });
  assert.deepEqual([hike.statusCode, hike.body.event.start, hike.body.event.allDay], [201, day(26), true], 'a date is an all-day event');
  for (const s of p.sql) assert.equal(s.values[0], 'alice', 'every statement is pinned to the caller');
  const listed = await call(r, 'GET /');
  assert.deepEqual(listed.body.events.map((e) => e.title), ['sweep8 Denver trip', 'sweep8 Red Rocks hike']);
  const other = res();
  await r['GET /'](req({}, {}, 'bob'), other);
  assert.deepEqual(other.body.events, [], 'another person sees none of them');
});

test('a start without its offset, an impossible date, an end before the start and unbounded text are refused unwritten', async () => {
  const p = pool(), r = own.createOwnEventsRoutes({ pool: p }).routes;
  for (const body of [
    { title: 'x', start: `${day(3)}T10:00:00` },
    { title: 'x', start: '2026-02-30' },
    { title: 'x', start: `${day(3)}T10:00:00Z`, end: `${day(2)}T10:00:00Z` },
    { title: '', start: day(3) },
    { title: 'x'.repeat(121), start: day(3) },
    { title: 'x', start: day(3), notes: 'n'.repeat(2001) },
    { title: 'x', start: day(3), location: 7 },
  ]) {
    const out = await call(r, 'POST /', { ...body, confirm: true });
    assert.equal(out.statusCode, 400, JSON.stringify(body));
  }
  assert.match((await call(r, 'POST /', { title: 'x', start: `${day(3)}T10:00:00`, confirm: true })).body.error, /timeZone.*UTC offset/);
  assert.match((await call(r, 'POST /', { title: 'x', start: `${day(3)}T10:00`, timeZone: 'Central', confirm: true })).body.error, /IANA time zone/);
  assert.equal(p.sql.length, 0);
});

test('a full calendar answers 409 without a write, and removal takes only the caller\'s own event', async () => {
  const full = pool({ alice: Array.from({ length: own.MAX_OWN_EVENTS }, (_, i) => ({ id: String(i), title: 't', starts_at: '2030-01-01T00:00:00.000Z', all_day: false })) });
  const out = await call(own.createOwnEventsRoutes({ pool: full }).routes, 'POST /', { title: 'one more', start: day(4), confirm: true });
  assert.equal(out.statusCode, 409);
  assert.ok(!full.sql.some((s) => /^INSERT/.test(s.text)));
  const p = pool(), r = own.createOwnEventsRoutes({ pool: p }).routes;
  const id = (await call(r, 'POST /', { title: 'remove me', start: day(5), confirm: true })).body.event.id;
  const stranger = res();
  await r['DELETE /:id'](req({}, { id }, 'bob'), stranger);
  assert.equal(stranger.statusCode, 404, 'another person cannot remove it');
  assert.equal((await call(r, 'DELETE /:id', {}, { id: 'not-an-id' })).statusCode, 400);
  assert.deepEqual((await call(r, 'DELETE /:id', {}, { id })).body, { ok: true, removed: id });
  assert.deepEqual((await call(r, 'GET /')).body.events, []);
});

test('the Home summary lists added events marked "added in OSHAL" and is unchanged when there are none', async () => {
  const now = new Date('2026-10-12T16:00:00Z');
  const added = [own.ownEvent({ id: 'a', title: 'sweep8 Denver trip', starts_at: '2026-11-07T00:00:00.000Z', ends_at: '2026-11-09T00:00:00.000Z', all_day: true, location: 'Denver', created_at: now })];
  const none = summary.calendarEvidence(null, now, 'not-connected');
  assert.deepEqual(summary.calendarEvidence(null, now, 'not-connected', []), none);
  const withOwn = summary.calendarEvidence(null, now, 'not-connected', added);
  assert.deepEqual(withOwn.metrics.map((m) => [m.id, m.value]), [['upcoming-5d', 'Not synced'], ['upcoming-30d', 'Not synced'], ['own-upcoming', '1']]);
  assert.deepEqual([withOwn.items[0].text, withOwn.items[0].detail], ['sweep8 Denver trip', 'Sat, Nov 7, 2026 (all day) / added in OSHAL / Denver']);
  assert.deepEqual([withOwn.items[0].start, withOwn.items[0].allDay], ['2026-11-07', true], 'the machine start rides beside the words');
  assert.equal(withOwn.items[0].actions.length, 4, 'an added event carries the planning offers');
  assert.equal(withOwn.items.at(-1).text, none.items.at(-1).text, 'the Google note still says what is missing');
  const p = pool({ alice: [{ id: 'a', title: 'sweep8 Denver trip', starts_at: '2099-11-07T00:00:00.000Z', all_day: true, created_at: now.toISOString() }] });
  const out = res();
  await summary.createHomeSummaryRoutes({ pool: p }).routes['GET /'](req(), out);
  assert.equal(out.body.items[0].text, 'sweep8 Denver trip', 'the real route reads the caller\'s own events');
});

test('the manifest mounts the route, applies the migration and holds both writes for approval', () => {
  const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const tool = (name) => manifest.tools.find((t) => t.name === name);
  assert.deepEqual([tool('calendar-add-event').executor.apiEndpoint, tool('calendar-add-event').requiresApproval], ['POST /api/calendar/events', true]);
  assert.deepEqual([tool('calendar-remove-event').executor.apiEndpoint, tool('calendar-remove-event').requiresApproval], ['DELETE /api/calendar/events/{input.id}', true]);
  assert.deepEqual([tool('calendar-my-events').executor.apiEndpoint, tool('calendar-my-events').requiresApproval], ['GET /api/calendar/events', false]);
  assert.ok(manifest.routes.some((r) => r.mountPath === '/api/calendar/events' && r.module === 'routes/own-events.js' && r.requiresAuth === true));
  assert.ok(manifest.migrations.includes('migrations/003-calendar-own-events.sql'));
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'migrations/003-calendar-own-events.sql'), 'utf8'), /\bDO\b|ROW LEVEL SECURITY|pg_policies/, 'one file the native kernel and PostgreSQL both apply');
});

test('a local start with the person\'s timeZone is saved as that zone\'s instant and listed in its own words', async () => {
  const p = pool(), r = own.createOwnEventsRoutes({ pool: p }).routes;
  const added = await call(r, 'POST /', { title: 'sweep10 Denver drive', start: '2099-11-06T18:00', timeZone: 'America/Chicago', confirm: true });
  assert.equal(added.statusCode, 201, JSON.stringify(added.body));
  assert.equal(added.body.event.start, '2099-11-07T00:00:00.000Z', 'November in Chicago is UTC-6, whatever the offset is today');
  assert.deepEqual([added.body.event.timeZone, added.body.event.local], ['America/Chicago', 'Fri, Nov 6, 2099, 6:00 PM CST']);
  assert.equal(p.rows.alice[0].time_zone, 'America/Chicago', 'the zone is stored with the event');
  const offset = await call(r, 'POST /', { title: 'sweep10 offset', start: '2099-11-06T18:00:00-06:00', confirm: true });
  assert.deepEqual([offset.body.event.timeZone, offset.body.event.local], ['-06:00', 'Fri, Nov 6, 2099, 6:00 PM (UTC-06:00)'], 'an offset start keeps the offset it was given');
  const listed = (await call(r, 'GET /')).body.events;
  assert.ok(listed.every((e) => !/Z$/.test(e.local)), 'no listed event is shown as a raw UTC instant');
  const legacy = own.ownEvent({ id: 'x', title: 'old', starts_at: '2099-11-07T01:00:00.000Z', all_day: false, created_at: new Date() });
  assert.equal(legacy.local, 'Sat, Nov 7, 2099, 1:00 AM UTC', 'a row saved before the zone column says UTC in words');
});

test('an event identical to a saved one answers 409 and writes no second row', async () => {
  const p = pool(), r = own.createOwnEventsRoutes({ pool: p }).routes;
  const body = { title: 'sweep10 checkup', start: '2099-10-20', confirm: true };
  assert.equal((await call(r, 'POST /', body)).statusCode, 201);
  const again = await call(r, 'POST /', body);
  assert.equal(again.statusCode, 409);
  assert.match(again.body.error, /already on your OSHAL calendar; nothing was added/);
  assert.equal(again.body.duplicate, true);
  assert.equal(p.rows.alice.length, 1, 'approving a re-proposed card adds nothing');
  assert.equal((await call(r, 'POST /', { ...body, title: 'sweep10 checkup 2' })).statusCode, 201, 'a different event is still added');
  assert.equal((await call(r, 'POST /', { title: 'sweep10 checkup', start: '2099-10-20', confirm: true }, {}, 'bob')).statusCode, 201, 'another person may hold the same title and day');
});

test('the add tool takes timeZone and tells the concierge never to re-propose an approved event', () => {
  const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const add = manifest.tools.find((t) => t.name === 'calendar-add-event');
  assert.equal(add.inputSchema.properties.timeZone.type, 'string');
  assert.match(add.usageInstructions, /Never call it again/);
  assert.ok(manifest.migrations.includes('migrations/005-calendar-own-events-zone.sql'));
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'migrations/005-calendar-own-events-zone.sql'), 'utf8'), /\bDO\b|ROW LEVEL SECURITY|pg_policies/);
  const persona = fs.readFileSync(path.join(ROOT, 'personas/calendar-concierge.yaml'), 'utf8');
  assert.match(persona, /Never ask\s+for a UTC offset/);
  assert.match(persona, /never call calendar-add-event again/);
  assert.match(persona, /after such a reply call\s+calendar-my-events instead/);
  assert.match(persona, /call calendar-add-event in that same reply; never\s+ask "shall I save it\?" or for a typed yes first/);
  assert.match(persona, /never makes an\s+OSHAL event appear there/);
});

test('removal takes the listed uuid, never a title: the tool declares it and the route refuses a title', async () => {
  const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const remove = manifest.tools.find((t) => t.name === 'calendar-remove-event');
  assert.deepEqual([remove.inputSchema.properties.id.type, remove.inputSchema.properties.id.format], ['string', 'uuid']);
  assert.match(remove.inputSchema.properties.id.description, /Call calendar-my-events first[\s\S]*never its title/);
  const p = pool(), r = own.createOwnEventsRoutes({ pool: p }).routes;
  const added = await call(r, 'POST /', { title: 'sweep10-dentist', start: '2099-10-21', confirm: true });
  const byTitle = await call(r, 'DELETE /:id', {}, { id: 'sweep10-dentist' });
  assert.deepEqual([byTitle.statusCode, byTitle.body.error], [400, 'An event id is required.']);
  assert.equal(p.rows.alice.length, 1, 'a title removes nothing');
  const byId = await call(r, 'DELETE /:id', {}, { id: added.body.event.id });
  assert.equal(byId.statusCode, 200, JSON.stringify(byId.body));
  assert.equal(p.rows.alice.length, 0);
  const persona = fs.readFileSync(path.join(ROOT, 'personas/calendar-concierge.yaml'), 'utf8');
  assert.match(persona, /first call calendar-my-events[\s\S]*then call calendar-remove-event with that event's "id" exactly as listed/);
  assert.match(persona, /An event's title is never\s+its id/);
  assert.match(persona, /Never\s+propose an add or a removal in answer to a question/);
  assert.match(persona, /never guess CST or CDT yourself/);
});

test('an approval card reads a person-facing sentence: no held tool description carries model instructions (sweep 11)', () => {
  const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const held = manifest.tools.filter((t) => t.requiresApproval === true);
  assert.deepEqual(held.map((t) => t.name).sort(), ['calendar-add-event', 'calendar-remove-event', 'calendar-sync']);
  for (const tool of held) {
    assert.doesNotMatch(tool.description, /calendar-[a-z-]+|uuid|\bids?\b|\bcall\b|never its title/i, `${tool.name}: ${tool.description}`);
    assert.match(tool.description, /Held for the person's approval\.$/, tool.name);
  }
  assert.equal(manifest.tools.find((t) => t.name === 'calendar-remove-event').description,
    "Remove one event the person added in OSHAL. Held for the person's approval.");
  for (const tool of held) {
    assert.match(tool.cardText, /^[A-Z][^.]*(?:your|this)[^]*\.$/, `${tool.name} declares a people-facing cardText`);
    assert.doesNotMatch(tool.cardText, /calendar-[a-z-]+|uuid|\bids?\b|\bcall\b|the person/i, tool.name);
  }
  assert.equal(manifest.tools.find((t) => t.name === 'calendar-remove-event').cardText, 'Removes this event from your OSHAL calendar.');
});

test('a span the person gave is one event with its end: the tool and persona say so and the route keeps the end (sweep 11)', async () => {
  const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const end = manifest.tools.find((t) => t.name === 'calendar-add-event').inputSchema.properties.end.description;
  assert.match(end, /Send it whenever the person said when it ends/);
  assert.match(end, /ONE event with that start and this end, never a start-only event/);
  const persona = fs.readFileSync(path.join(ROOT, 'personas/calendar-concierge.yaml'), 'utf8');
  assert.match(persona, /is ONE event with that start and that end,\s+never a start-only event/);
  assert.match(persona, /Never work out a weekday yourself/);
  const p = pool(), r = own.createOwnEventsRoutes({ pool: p }).routes;
  const trip = { title: 'sweep16 Denver weekend', start: '2099-11-13T18:00', end: '2099-11-15T15:00', timeZone: 'America/Denver', confirm: true };
  const added = await call(r, 'POST /', trip);
  assert.equal(added.statusCode, 201, JSON.stringify(added.body));
  assert.equal(added.body.event.start, '2099-11-14T01:00:00.000Z', 'Friday 6 PM MST');
  assert.equal(added.body.event.end, '2099-11-15T22:00:00.000Z', 'Sunday 3 PM MST is kept as the end');
  assert.equal(p.rows.alice.length, 1, 'one event for the whole span');
});

test('a removal never starts with a sync, and a reply names only the events it made a card for (sweep 12)', () => {
  const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(__dirname, '../../scripts/toolchain')] }));
  const manifest = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8'));
  const tool = (name) => manifest.tools.find((t) => t.name === name);
  assert.match(tool('calendar-sync').usageInstructions, /Never call it as a step of adding, finding or removing an event added in OSHAL/);
  assert.match(tool('calendar-add-event').usageInstructions, /Each call makes one card for one event, so in the reply name only the events you called it for in that reply, with their count/);
  assert.match(tool('calendar-add-event').usageInstructions, /say an event is saved only when its result or calendar-my-events shows it/);
  const persona = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'personas', 'calendar-concierge.yaml'), 'utf8')).perspective;
  assert.match(persona, /A removal never\s+starts with calendar-sync/);
  assert.match(persona, /never say you proposed, added or\s+saved an event you made no card for/);
});

test('the persona names a card by its event, never by where it sits (sweep 13)', () => {
  const persona = fs.readFileSync(path.join(ROOT, 'personas/calendar-concierge.yaml'), 'utf8');
  const served = persona.slice(persona.indexOf('\nperspective:')).replace(/\s+/g, ' ');
  assert.match(served, /Name a card by the event it holds \("the card for <title>"\)\. Never say where it sits on the screen or when it appeared: no "above", "below", "previous reply" or "earlier"/);
});

test('the add tool offers notes as the person\'s own optional note, never routing text (demo sweep 2)', () => {
  const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const add = manifest.tools.find((t) => t.name === 'calendar-add-event');
  const notes = add.inputSchema.properties.notes;
  assert.deepEqual([notes.type, notes.maxLength], ['string', 2000]);
  assert.ok(!add.inputSchema.required.includes('notes'), 'notes stays optional');
  assert.match(notes.description, /^Optional\. Only a note the person asked to keep on this event, in their own words/);
  assert.match(notes.description, /Leave it out when they gave none\. Never your own explanation, a sync or connection status, or instructions about what to do if the add fails/);
});
