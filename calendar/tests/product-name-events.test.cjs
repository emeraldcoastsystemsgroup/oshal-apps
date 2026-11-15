/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | What a person reads or hears from Calendar names the product Open Swarm (calendar 1.4.1).
 *   Roger, 2026-11-13: what a person sees says "Open Swarm"; technical identifiers keep oshal. Red before: 1.4.0 answered "That
 *   event is no longer on your OSHAL calendar. Nothing was changed." and "Events added in OSHAL are single events ...", its
 *   cards read "Changes this event on your OSHAL calendar ...", and Jarvis repeated "only events added here in OSHAL are
 *   listed". Boundary: the compiled routes (own events, their changes and removals, the finder, a decline and the Home summary)
 *   driven through their refusals and success lines over a recording pool and the stand-in Google behind the stand-in kernel
 *   egress; the manifest and the persona as parsed YAML, so every string the kernel hands a card or the model is read and the
 *   Change Log comments are not; and the shipped route and screen files with their comments left out. IDENTIFIERS is the whole
 *   list of forms that keep oshal. Named seam: the in-memory caller (OIDC). Made-up people and events only.
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
const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas/calendar-concierge.yaml'), 'utf8'));
const m = modules();
const ZONE = 'America/Chicago';

/** The forms that keep oshal: identifiers, never words for a person. Each is taken out before the words are read. */
const IDENTIFIERS = [
  [/\bOSHAL_[A-Z0-9_]+\b/g, 'an environment variable (OSHAL_EGRESS)'],
  [/(["'])oshal\1|^oshal$/g, 'the "source" value of an event kept in this app, as the tools list it'],
  [/\/oshal\//g, 'the route path /api/calendar/meetings/oshal/{id}'],
  [/\boshal-app\.yaml\b/g, 'the manifest\'s file name'],
  [/\bx-oshal-[a-z-]+/g, 'a request header name'],
  [/--oshal-[a-z-]+/g, 'a CSS custom property of the shell'],
  [/`oshal\$\{/g, 'the prefix of the event id this app sends Google'],
  [/github\.com\/[\w-]+\/oshal-apps\b/g, 'the store repository\'s address'],
];

/**
 * @description Where a text still names the product OSHAL, in any letter case, once its identifiers are taken out.
 * @param {string} text - Words a person may read, or a line of shipped code.
 * @returns {string[]} The words around each place.
 */
function productNames(text) {
  const words = IDENTIFIERS.reduce((left, [form]) => left.replace(form, ' '), String(text));
  return [...words.matchAll(/oshal/gi)].map((hit) => words.slice(Math.max(0, hit.index - 45), hit.index + 50).replace(/\s+/g, ' ').trim());
}

/** Every string a parsed answer or document holds, with the path to it. */
function strings(value, at = '', out = []) {
  if (typeof value === 'string') out.push([at, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, at ? `${at}.${k}` : k, out);
  return out;
}
/** Each place a parsed answer or document says OSHAL: "<what> <path>: <the words around it>". */
const said = (what, value) => strings(value).flatMap(([at, text]) => productNames(text).map((near) => `${what} ${at}: ${near}`));

/** A shipped file's lines without its comments: block comments (script or HTML) and lines that are only a comment. */
function codeLines(text) {
  const out = [];
  let open = '';
  text.split('\n').forEach((line, i) => {
    let rest = line.trim();
    if (open) { if (!rest.includes(open)) return; rest = rest.slice(rest.indexOf(open) + open.length).trim(); open = ''; }
    while (rest.startsWith('/*') || rest.startsWith('<!--')) {
      const close = rest.startsWith('/*') ? '*/' : '-->', end = rest.indexOf(close, 2);
      if (end < 0) { open = close; return; }
      rest = rest.slice(end + close.length).trim();
    }
    if (rest && !rest.startsWith('//')) out.push([i + 1, rest]);
  });
  return out;
}

/** A pool that keeps calendar_own_events rows per owner and answers the statements the own-event routes send. */
function pool(seed = {}) {
  const rows = JSON.parse(JSON.stringify(seed)), mine = (sub) => rows[sub] || (rows[sub] = []);
  const answers = [
    [/^SELECT COUNT\(\*\) AS n FROM calendar_own_events WHERE user_sub = \$1$/, (v) => ({ rows: [{ n: String(mine(v[0]).length) }] })],
    [/AND title = \$2 AND starts_at = \$3 AND all_day = \$4 LIMIT 1$/, (v) => ({ rows: mine(v[0]).filter((r) => r.title === v[1] && r.starts_at === v[2] && r.all_day === v[3]) })],
    [/^INSERT INTO calendar_own_events/, (v) => {
      const [, id, title, starts_at, ends_at, all_day, time_zone, location, notes, created_at, revision] = v;
      mine(v[0]).push({ id, title, starts_at, ends_at, all_day, time_zone, location, notes, created_at, revision });
      return { rowCount: 1, rows: [] };
    }],
    [/^SELECT .* FROM calendar_own_events WHERE user_sub = \$1 AND id = \$2$/, (v) => ({ rows: mine(v[0]).filter((r) => r.id === v[1]) })],
    [/AND starts_at >= \$2 AND starts_at < \$3/, (v) => ({ rows: mine(v[0]).filter((r) => r.starts_at >= v[1] && r.starts_at < v[2]) })],
    [/^UPDATE calendar_own_events/, (v, text) => {
      const row = mine(v[0]).find((r) => r.id === v[1] && (/IS NULL$/.test(text) ? r.revision == null : r.revision === v[10]));
      if (row) Object.assign(row, { title: v[2], starts_at: v[3], ends_at: v[4], all_day: v[5], time_zone: v[6], location: v[7], notes: v[8], revision: v[9] });
      return { rowCount: row ? 1 : 0, rows: [] };
    }],
    [/^DELETE FROM calendar_own_events WHERE user_sub = \$1 AND id = \$2$/, (v) => {
      const before = mine(v[0]).length;
      rows[v[0]] = mine(v[0]).filter((r) => r.id !== v[1]);
      return { rowCount: before - rows[v[0]].length, rows: [] };
    }],
    [/^SELECT events,synced_at FROM calendar_preparation_snapshots/, () => ({ rows: [] })],
  ];
  return { rows, async query(q, values) {
    const text = typeof q === 'string' ? q : q.text, hit = answers.find(([form]) => form.test(text));
    if (!hit) throw new Error('pool cannot answer: ' + text.slice(0, 90));
    return hit[1](typeof q === 'string' ? values : q.values, text);
  } };
}

/** The routes over one pool, and a way to ask them that keeps [what was asked, the status, the answer]. */
function desk(seed) {
  const p = pool(seed), heard = [];
  const routes = { own: m['own-events'].createOwnEventsRoutes({ pool: p }).routes, meetings: m.meetings.createMeetingsRoutes({ pool: p }).routes };
  const ask = async (what, mount, key, options) => {
    const answer = await call(routes[mount], key, options);
    heard.push([what, answer.statusCode, answer.body]);
    return answer.body;
  };
  return { ask, heard };
}
const find = (ask, what, words) => ask(what, 'meetings', 'GET /', { query: { timeZone: ZONE, from: dayAhead(0), to: dayAhead(14), ...(words ? { words } : {}) } });
const card = (e, extra) => ({ id: e.id, revision: e.revision, title: e.title, start: e.start, timeZone: ZONE, confirm: true, ...extra });

/** Run over a stand-in Google Calendar behind the stand-in kernel egress; `connection` null is a person who connected none. */
async function withGoogle(connection, run) {
  const api = await standInGoogle(), egress = kernelEgress(manifest, connection, api);
  try { return await run(api); } finally { egress.restore(); await api.close(); }
}

/** The answers of adding, finding, changing and removing an event kept in the app, with Google not connected. */
async function ownAnswers() {
  const full = Array.from({ length: m['own-events'].MAX_OWN_EVENTS }, (_, i) => ({ id: String(i), title: 't', starts_at: '2099-01-01T00:00:00.000Z', all_day: false }));
  const { ask, heard } = desk({ carol: full });
  const lunch = { title: 'Team lunch', start: `${dayAhead(5)}T12:00`, end: `${dayAhead(5)}T13:00`, timeZone: ZONE, location: 'Cafe Rio', confirm: true };
  await ask('add an event', 'own', 'POST /', { body: lunch });
  await ask('add the same event again', 'own', 'POST /', { body: lunch });
  await ask('add a repeating event', 'own', 'POST /', { body: { ...lunch, title: 'Standup', repeat: { every: 'week' } } });
  await ask('add to a full calendar', 'own', 'POST /', { body: lunch, sub: 'carol' });
  await ask('remove an event that is not there', 'own', 'DELETE /:id', { params: { id: '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f' } });
  const [event] = (await find(ask, 'find events without Google connected')).meetings;
  const change = (what, extra, sub) => ask(what, 'meetings', 'PATCH /oshal/:id', { params: { id: event.id }, body: card(event, extra), sub });
  await change('change with nothing named', {});
  await change('change the whole series', { newTitle: 'x', appliesTo: 'The whole series' });
  await change('change its guests', { addGuests: ['dana@example.com'] });
  await change('change to a time that has passed', { newStart: `${dayAhead(-2)}T11:00` });
  await change('change another person\'s event', { newTitle: 'Taken' }, 'bob');
  await change('change named as another event', { title: 'Denver trip', newTitle: 'x' });
  await change('change the place', { newLocation: 'Union Kitchen', location: 'Cafe Rio' });
  await change('approve the same change again', { newLocation: 'Union Kitchen', location: 'Cafe Rio' });
  await change('change with the version read before', { newTitle: 'Planning lunch' });
  const remove = (what, body, sub) => ask(what, 'meetings', 'DELETE /oshal/:id', { params: { id: event.id }, body, sub });
  await remove('remove named as another event', { title: 'Denver trip', start: event.start, timeZone: ZONE });
  await remove('remove another person\'s event', { title: event.title, start: event.start, timeZone: ZONE }, 'bob');
  await remove('remove the event', { title: event.title, start: event.start, timeZone: ZONE });
  await remove('remove it again', {});
  return heard;
}

/** The answers of finding, declining and cancelling on a connected Google Calendar holding an invitation. */
async function googleAnswers(api) {
  const { ask, heard } = desk();
  const THU = nextWeekday(4, 5), at = (time) => ({ dateTime: `${THU}T${time}:00`, timeZone: ZONE });
  const you = { email: 'you@example.com', displayName: 'You', self: true, responseStatus: 'accepted' };
  api.seed({ summary: 'Board prep', start: at('11:00'), end: at('12:00'), organizer: { email: 'morgan@example.com', displayName: 'Morgan Lee' },
    attendees: [{ email: 'morgan@example.com', displayName: 'Morgan Lee', organizer: true, responseStatus: 'accepted' }, you], guestsCanModify: false });
  const board = (await find(ask, 'find a Google meeting', 'Board')).meetings.find((x) => x.title === 'Board prep');
  const named = { revision: board.revision, title: board.title, start: board.start, timeZone: ZONE, confirm: true };
  await ask('cancel a meeting they were invited to', 'meetings', 'POST /google/cancel', { body: { ...named, guests: 'Will be told' } });
  await ask('move a meeting they were invited to', 'meetings', 'PATCH /google', { body: { ...named, guests: 'Will be told', newStart: `${THU}T15:00` } });
  await ask('decline without saying whether the organizer is told', 'meetings', 'POST /google/decline', { body: named });
  await ask('decline the invitation', 'meetings', 'POST /google/decline', { body: { ...named, organizer: 'Will be told' } });
  await ask('decline it again', 'meetings', 'POST /google/decline', { body: { ...named, organizer: 'Will be told' } });
  return heard;
}

test('the guard itself: OSHAL in any letter case is a product name, and each identifier form is not', () => {
  for (const words of ['That event is no longer on your OSHAL calendar.', 'only events added here in oshal are listed', 'saved in OSHAL\'s Calendar app', 'My Oshal Events']) {
    assert.equal(productNames(words).length, 1, words);
  }
  for (const code of ['process.env.OSHAL_EGRESS === \'kernel\'', 'one with source "oshal" is changed', 'ev.source===\'oshal\'', 'PATCH /api/calendar/meetings/oshal/{input.id}',
    'path.join(packageRoot, \'oshal-app.yaml\')', 'req.headers[\'x-oshal-tenant-id\']', 'style.removeProperty(\'--oshal-app-bottom-inset\')', 'const id = `oshal${hash}`',
    'https://github.com/emeraldcoastsystemsgroup/oshal-apps']) {
    assert.deepEqual(productNames(code), [], code);
  }
  assert.deepEqual(said('answer', { error: 'No such event in your OSHAL calendar.', event: { source: 'oshal', title: 'Lunch' } }), ['answer error: No such event in your OSHAL calendar.']);
  assert.deepEqual(codeLines('/** An OSHAL event. */\nconst a = 1; // kept\n  // an OSHAL note\n/*\n OSHAL\n*/ const b = \'OSHAL\';\n<!-- OSHAL -->\n<!--\n OSHAL\n--><h2>OSHAL</h2>').map(([n]) => n), [2, 6, 10]);
});

test('every answer about an event kept in the app names Open Swarm: adding, finding, changing and removing, refused or done', async () => {
  const heard = await withGoogle(null, ownAnswers);
  assert.deepEqual(heard.map(([what, status]) => `${status} ${what}`), ['201 add an event', '409 add the same event again', '400 add a repeating event', '409 add to a full calendar',
    '404 remove an event that is not there', '200 find events without Google connected', '400 change with nothing named', '400 change the whole series', '400 change its guests',
    '400 change to a time that has passed', '404 change another person\'s event', '409 change named as another event', '200 change the place', '200 approve the same change again',
    '409 change with the version read before', '409 remove named as another event', '404 remove another person\'s event', '200 remove the event', '404 remove it again'],
  'each refusal and success line was reached');
  assert.deepEqual(heard.flatMap(([what, , body]) => said(what, body)), []);
  const lines = heard.flatMap(([, , body]) => strings(body).map(([, text]) => text)).filter((text) => /Open Swarm/.test(text));
  for (const line of ['Saved to your Open Swarm calendar in Calendar Preparation. It is not added to Google Calendar.',
    'Events added in Open Swarm are single events, so there is no series to change. Nothing was changed.',
    'That event is no longer on your Open Swarm calendar. Nothing was changed.', 'That change is already on your Open Swarm calendar. Nothing was changed again.',
    'No such event in your Open Swarm calendar.', 'Removed from your Open Swarm calendar. To put it back, ask to add it again.']) {
    assert.ok(lines.includes(line), `an answer says: ${line}`);
  }
  assert.ok(lines.some((line) => /^Google Calendar is not connected, so only events added in Open Swarm are listed\. /.test(line)), 'the finder says whose events it lists');
});

test('a decline, and the refusals around it, never name OSHAL', async () => {
  const heard = await withGoogle('person-write', googleAnswers);
  assert.deepEqual(heard.map(([what, status]) => `${status} ${what}`), ['200 find a Google meeting', '409 cancel a meeting they were invited to', '403 move a meeting they were invited to',
    '400 decline without saying whether the organizer is told', '200 decline the invitation', '200 decline it again']);
  assert.deepEqual(heard.flatMap(([what, , body]) => said(what, body)), []);
  assert.match(heard[4][2].where, /^Declined; it stays on Morgan Lee's calendar\./);
});

test('the Home summary marks an added event "added in Open Swarm" under an Added in Open Swarm tile', () => {
  const now = new Date('2026-10-12T16:00:00Z');
  const added = [m['own-events'].ownEvent({ id: 'a', title: 'Denver trip', starts_at: '2026-11-07T00:00:00.000Z', all_day: true, location: 'Denver', created_at: now })];
  const summary = m['home-summary'].calendarEvidence(null, now, 'not-connected', added);
  assert.deepEqual(said('Home summary', summary), []);
  assert.deepEqual([summary.metrics.at(-1).label, summary.items[0].detail], ['Added in Open Swarm', 'Sat, Nov 7, 2026 (all day) / added in Open Swarm / Denver']);
});

test('the manifest and the persona name Open Swarm in every string the kernel hands a card or the model', () => {
  assert.deepEqual(said('manifest', manifest), []);
  assert.deepEqual(said('persona', persona), []);
  const tool = (name) => manifest.tools.find((t) => t.name === name);
  assert.equal(tool('calendar-my-events').displayName, 'My Open Swarm Events');
  for (const name of ['calendar-add-event', 'calendar-change-event', 'calendar-remove-event']) {
    assert.match(tool(name).description, /Open Swarm/, `${name} says which calendar`);
    assert.match(tool(name).cardText, /your Open Swarm calendar/, `${name}'s card says which calendar`);
  }
  for (const name of ['calendar-find-events', 'calendar-my-events']) assert.match(tool(name).description, /added in Open Swarm/, name);
  const told = persona.perspective.replace(/\s+/g, ' ');
  assert.match(told, /^You are the concierge in Open Swarm's Calendar Preparation app\./);
  assert.match(told, /The product's name is Open Swarm\. The word in a meeting's "source" is a label for you to read, never a word to say/);
});

test('the shipped routes and screen name Open Swarm outside their comments', () => {
  const shipped = ['routes', 'src-routes', 'tools'].flatMap((folder) => fs.readdirSync(path.join(ROOT, folder)).filter((f) => /[.](?:js|ts|mjs|html|css)$/.test(f)).map((f) => `${folder}/${f}`));
  assert.ok(shipped.length >= 30 && shipped.includes('routes/own-event-changes.js') && shipped.includes('tools/review.html'), `the route and screen files are read (${shipped.length})`);
  const named = shipped.flatMap((file) => codeLines(fs.readFileSync(path.join(ROOT, file), 'utf8')).flatMap(([line, code]) => productNames(code).map((near) => `${file}:${line}: ${near}`)));
  assert.deepEqual(named, []);
  const screen = ['tools/calendar-workspace.mjs', 'tools/calendar-event-view.mjs', 'tools/review.html'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  for (const words of ['Events stay in Open Swarm; they are not written to Google.', 'Event saved in Open Swarm.', 'In your Open Swarm calendar', 'It comes off your Open Swarm calendar.',
    '>Added in Open Swarm</h2>', ' from your Open Swarm calendar']) {
    assert.ok(screen.includes(words), `the screen says: ${words}`);
  }
});
