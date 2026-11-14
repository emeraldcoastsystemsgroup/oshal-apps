/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Calendar Preparation adds single and repeating events to the person's own Google
 *   Calendar (routes/google-events.js, the approval-held calendar-add-google-event tool). Production, 2026-11-13: a person asked
 *   Jarvis for "a new appointment at 6:00 p.m. to 7:00 p.m. every Friday ... at T. C. music lessons ... add that to my Google
 *   calendar"; the app answered that it could not write to Google Calendar and had no repeating events, and after "Yes make the
 *   event for 20 weeks" its only add tool made ONE card for one OSHAL event dated Friday, February 5, 2027. Red before: no route
 *   or tool could write Google Calendar or express a repeat, so a repeat request could only become one event on a wrong date.
 *   Boundary: the compiled route over the package's declared egress, with a stand-in for the kernel's package egress
 *   (crates/oshald/src/package_egress.rs: declared host only, the package's closed header list, the caller's own
 *   google-calendar credential placed by the kernel, "not connected" when the caller has none) in front of a stand-in Google
 *   Calendar v3 events API on a loopback HTTP server that checks the bearer's scopes and the event as Google does.
 *   Named seams: the in-memory caller (OIDC) and the stand-in egress and Google; no real Google account is touched.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));
const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
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
const google = () => load('google-events.js', { express: { Router: router }, crypto: require('node:crypto'), '@/shared/logger': logger, './event-time': time });

const WRITE = 'https://www.googleapis.com/auth/calendar.events';
const READ_ONLY = 'https://www.googleapis.com/auth/calendar.readonly';
const BASE32HEX = /^[a-v0-9]{5,1024}$/;

/**
 * A stand-in Google Calendar v3 events API: insert, get and update on the primary calendar, with a bearer whose
 * grant decides what it may do (an events or full calendar scope may write; a read-only grant answers 403
 * insufficient scopes), a client-chosen id that already exists answering 409, and the checks Google makes on an
 * event (a recurring event needs its start's time zone; start and end are both dates or both date-times).
 */
async function standInGoogle(tokens) {
  const events = new Map(), requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const answer = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      const grant = tokens[String(req.headers.authorization || '').replace(/^Bearer /, '')];
      if (!grant) return answer(401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } });
      const base = '/calendar/v3/calendars/primary/events';
      const one = new RegExp(`^${base}/([a-v0-9]+)$`).exec(req.url);
      if (req.method === 'GET' && one) return events.has(one[1]) ? answer(200, events.get(one[1])) : answer(404, { error: { code: 404, message: 'Not Found' } });
      if (!grant.some((s) => s === WRITE || s === 'https://www.googleapis.com/auth/calendar')) {
        return answer(403, { error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED',
          errors: [{ message: 'Insufficient Permission', domain: 'global', reason: 'insufficientPermissions' }],
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } });
      }
      const invalid = check(body);
      if (invalid) return answer(400, { error: { code: 400, message: invalid, errors: [{ reason: 'invalid', message: invalid }] } });
      if (req.method === 'PUT' && one) {
        if (!events.has(one[1])) return answer(404, { error: { code: 404, message: 'Not Found' } });
        const saved = { ...body, id: one[1], status: body.status || 'confirmed', htmlLink: `https://www.google.com/calendar/event?eid=${one[1]}` };
        events.set(one[1], saved);
        return answer(200, saved);
      }
      if (req.method === 'POST' && req.url === base) {
        if (body.id && events.has(body.id)) return answer(409, { error: { code: 409, message: 'The requested identifier already exists.', errors: [{ reason: 'duplicate' }] } });
        const id = body.id || `standin${events.size + 1}`;
        const saved = { ...body, id, status: 'confirmed', htmlLink: `https://www.google.com/calendar/event?eid=${id}` };
        events.set(id, saved);
        return answer(200, saved);
      }
      return answer(404, { error: { code: 404, message: 'Not Found' } });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { events, requests, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** What Google refuses in an event it is asked to insert. */
function check(event) {
  if (!event || typeof event.summary !== 'string' || !event.start || !event.end) return 'Missing start or end.';
  if (event.id != null && !BASE32HEX.test(event.id)) return 'Invalid resource id value.';
  const timed = 'dateTime' in event.start;
  if (timed !== ('dateTime' in event.end)) return 'The start and end times must both be dates or both be date-times.';
  if (Array.isArray(event.recurrence) && event.recurrence.length) {
    if (timed && !event.start.timeZone) return 'Missing time zone definition for start time.';
    if (!event.recurrence.every((line) => /^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Z0-9,]+)*$/.test(line))) return 'Invalid recurrence rule.';
  }
  return null;
}

/** The headers a package may set on a kernel egress request (crates/oshald/src/package_egress.rs PACKAGE_HEADERS). */
const PACKAGE_HEADERS = ['accept', 'accept-language', 'content-type', 'user-agent', 'if-none-match', 'if-modified-since'];

/**
 * The kernel's package egress in front of the stand-in Google: the host must be declared in this manifest, the package
 * sets only plain headers (never Authorization), and the kernel places the credential the declaration binds from the
 * caller's own connection, refusing "not connected" when there is none.
 */
async function withEgress(connection, run) {
  const tokens = { 'person-write': [WRITE], 'person-read-only': [READ_ONLY] };
  const api = await standInGoogle(tokens);
  const saved = globalThis.fetch, sent = [];
  process.env.OSHAL_EGRESS = 'kernel';
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(url);
    const declared = (manifest.egress || []).find((e) => e.host === target.host);
    if (!declared) throw new Error(`${target.host} is not a declared outbound host of calendar`);
    const headers = {};
    for (const [name, value] of Object.entries(init.headers || {})) {
      if (!PACKAGE_HEADERS.includes(name.toLowerCase())) throw new Error(`header ${name.toLowerCase()} is not one a package may set`);
      headers[name.toLowerCase()] = value;
    }
    sent.push({ url: target.href, method: init.method || 'GET', headers: { ...headers } });
    if (!connection) throw Object.assign(new Error(`${declared.credential.connector} is not connected: connect your own ${declared.credential.connector} account on Utilities`), { code: 'native_executor_unavailable' });
    headers[declared.credential.header] = `${declared.credential.prefix}${connection}`;
    return saved(`${api.origin}${target.pathname}${target.search}`, { method: init.method || 'GET', headers, body: init.body });
  };
  try { await run(api, sent); } finally { globalThis.fetch = saved; delete process.env.OSHAL_EGRESS; await api.close(); }
}

const caller = (sub = 'alice') => ({ oidc: { user: { sub }, isAuthenticated: () => true } });
function res() { return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } }; }
async function post(body, who = caller()) {
  const r = res();
  await google().createGoogleEventsRoutes({ pool: { query: async () => assert.fail('Google events are never written to the database') } }).routes['POST /']({ ...who, body }, r);
  return r;
}
const inserts = (api) => api.requests.filter((r) => r.method === 'POST');

// The production request: Gabriel's music lessons, every Friday 6 to 7 PM at T. C. Music Lessons, for 20 weeks.
const LESSONS = { title: "Gabriel's music lessons", start: '2026-11-13T18:00', end: '2026-11-13T19:00', timeZone: 'America/Chicago',
  location: 'T. C. Music Lessons', repeat: { every: 'week', on: ['Friday'], times: 20 }, confirm: true };

test('"every Friday 6 to 7 PM for 20 weeks" is ONE repeating Google event starting on the first Friday asked', async () => {
  await withEgress('person-write', async (api, sent) => {
    const r = await post(LESSONS);
    assert.equal(r.statusCode, 201, JSON.stringify(r.body));
    assert.equal(inserts(api).length, 1, 'one series, never one event per week');
    const event = inserts(api)[0].body;
    assert.deepEqual(event.start, { dateTime: '2026-11-13T18:00:00', timeZone: 'America/Chicago' });
    assert.deepEqual(event.end, { dateTime: '2026-11-13T19:00:00', timeZone: 'America/Chicago' });
    assert.deepEqual(event.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=20']);
    assert.equal(event.summary, "Gabriel's music lessons");
    assert.equal(event.location, 'T. C. Music Lessons');
    assert.match(event.id, BASE32HEX, 'a client id Google accepts, so a second approval of the same series is refused');
    assert.equal(inserts(api)[0].url, '/calendar/v3/calendars/primary/events', 'the primary calendar');
    assert.ok(!('authorization' in sent[0].headers), 'the package sends no credential; the kernel places it');
    assert.equal(r.body.event.local, 'Fri, Nov 13, 2026, 6:00 PM CST');
    assert.equal(r.body.event.repeat, 'every Friday, 20 times');
    assert.equal(r.body.event.calendar, 'primary');
    assert.match(r.body.where, /^Added to your primary Google Calendar as one repeating series: every Friday, 20 times, from Fri, Nov 13, 2026\.$/);
    assert.match(r.body.url, /^https:\/\/www\.google\.com\/calendar\/event\?eid=/, 'the result offers the event in Google Calendar');
  });
});

test('a series that ends on a date carries UNTIL at the end of that local day, in UTC', async () => {
  await withEgress('person-write', async (api) => {
    const r = await post({ ...LESSONS, repeat: { every: 'week', on: ['Friday'], until: '2027-04-02' } });
    assert.equal(r.statusCode, 201, JSON.stringify(r.body));
    assert.deepEqual(inserts(api)[0].body.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20270403T045959Z']);
    assert.equal(r.body.event.repeat, 'every Friday, until Fri, Apr 2, 2027');
  });
});

test('a single event has no recurrence, and an all-day one covers its days with Google\'s exclusive end', async () => {
  await withEgress('person-write', async (api) => {
    const single = await post({ title: 'Dentist', start: '2026-11-19T14:00', end: '2026-11-19T15:00', timeZone: 'America/Chicago', confirm: true });
    assert.equal(single.statusCode, 201, JSON.stringify(single.body));
    assert.equal(inserts(api)[0].body.recurrence, undefined);
    assert.equal(single.body.where, 'Added to your primary Google Calendar.');
    const trip = await post({ title: 'Denver trip', start: '2026-11-20', end: '2026-11-22', confirm: true });
    assert.equal(trip.statusCode, 201, JSON.stringify(trip.body));
    assert.deepEqual([inserts(api)[1].body.start, inserts(api)[1].body.end], [{ date: '2026-11-20' }, { date: '2026-11-23' }], 'the last day is included');
    const birthday = await post({ title: 'Mom', start: '2026-12-02', repeat: { every: 'year', times: 5 }, confirm: true });
    assert.equal(birthday.statusCode, 201, JSON.stringify(birthday.body));
    assert.deepEqual(inserts(api)[2].body.recurrence, ['RRULE:FREQ=YEARLY;COUNT=5']);
    assert.deepEqual(inserts(api)[2].body.end, { date: '2026-12-03' });
  });
});

test('a timed event the person gave no end for lasts one hour', async () => {
  await withEgress('person-write', async (api) => {
    const r = await post({ title: 'Call', start: '2026-11-19T09:30', timeZone: 'America/Denver', confirm: true });
    assert.equal(r.statusCode, 201, JSON.stringify(r.body));
    assert.deepEqual(inserts(api)[0].body.end, { dateTime: '2026-11-19T10:30:00', timeZone: 'America/Denver' });
  });
});

test('without a Google connection nothing is sent to Google and the answer says what to connect', async () => {
  await withEgress(null, async (api) => {
    const r = await post(LESSONS);
    assert.equal(r.statusCode, 409);
    assert.match(r.body.error, /^Google Calendar is not connected\. Connect Google on the Connections page \(\/utilities\) and allow it to view and edit events on your calendars, then ask again\. Nothing was added\.$/);
    assert.equal(api.requests.length, 0);
  });
});

test('a grant that may only read the calendar is refused by Google and the answer says to reconnect with event access', async () => {
  await withEgress('person-read-only', async (api) => {
    const r = await post(LESSONS);
    assert.equal(r.statusCode, 409);
    assert.match(r.body.error, /lets this app read your Google Calendar but not add events to it\. Reconnect Google on the Connections page \(\/utilities\) and allow it to view and edit events on your calendars/);
    assert.equal(api.events.size, 0);
  });
  await withEgress('expired-or-revoked', async (api) => {
    const r = await post(LESSONS);
    assert.equal(r.statusCode, 409);
    assert.match(r.body.error, /^Your Google connection is no longer accepted\. Reconnect Google on the Connections page \(\/utilities\)/);
    assert.equal(api.events.size, 0);
  });
});

test('approving the same series twice adds it once; a series removed in Google can be added again', async () => {
  await withEgress('person-write', async (api) => {
    assert.equal((await post(LESSONS)).statusCode, 201);
    const again = await post(LESSONS);
    assert.equal(again.statusCode, 409);
    assert.match(again.body.error, /^"Gabriel's music lessons" from Fri, Nov 13, 2026, 6:00 PM CST is already on your Google Calendar; nothing was added\.$/);
    assert.equal(api.events.size, 1);
    const [id] = api.events.keys();
    api.events.set(id, { ...api.events.get(id), status: 'cancelled' });
    const restored = await post(LESSONS);
    assert.equal(restored.statusCode, 201, JSON.stringify(restored.body));
    assert.equal(api.events.get(id).status, 'confirmed');
    assert.equal(api.events.size, 1);
  });
});

test('nothing reaches Google without the caller, the confirmation and a valid event', async () => {
  await withEgress('person-write', async (api) => {
    const anonymous = res();
    await google().createGoogleEventsRoutes({}).routes['POST /']({ oidc: null, body: LESSONS }, anonymous);
    assert.equal(anonymous.statusCode, 401);
    const refused = [
      [{ ...LESSONS, confirm: undefined }, /Confirm adding the event/],
      [{ ...LESSONS, title: '' }, /title of 1 to 120 characters/],
      [{ ...LESSONS, start: '2026-11-13T18:00:00-06:00', end: '2026-11-13T19:00:00-06:00', timeZone: undefined }, /repeating event at a time needs its time zone/],
      [{ title: 'Dentist', start: '2026-11-19T14:00', confirm: true }, /needs the person's time zone/],
      [{ ...LESSONS, end: '2026-11-13T17:00' }, /end is before the start/],
      [{ ...LESSONS, repeat: { every: 'week', on: ['Friday'] } }, /how many times it happens \("times"\) or its last date \("until"\)/],
      [{ ...LESSONS, repeat: { every: 'week', on: ['Friday'], times: 20, until: '2027-04-02' } }, /either "times" or "until", not both/],
      [{ ...LESSONS, repeat: { every: 'fortnight', times: 3 } }, /"every" is day, week, month or year/],
      [{ ...LESSONS, repeat: { every: 'month', on: ['Friday'], times: 3 } }, /"on" names weekdays of a weekly series only/],
      [{ ...LESSONS, repeat: { every: 'week', on: ['Friday'], times: 1 } }, /"times" is a whole number from 2 to 730/],
      [{ ...LESSONS, repeat: { every: 'week', on: ['Friday'], until: '2026-11-01' } }, /last date is before its first/],
      [{ ...LESSONS, start: '2026-11-12T18:00', end: '2026-11-12T19:00' }, /^The first date, Thu, Nov 12, 2026, is not a Friday\. The first Friday on or after it is Fri, Nov 13, 2026\.$/],
      [{ ...LESSONS, timeZone: 'Central' }, /IANA time zone/],
    ];
    for (const [body, message] of refused) {
      const r = await post(body);
      assert.equal(r.statusCode, 400, JSON.stringify(body));
      assert.match(r.body.error, message, JSON.stringify(r.body));
    }
    assert.equal(api.requests.length, 0, 'a refused request reaches nothing');
  });
});

test('a failure inside Google keeps its detail out of the answer and adds nothing', async () => {
  await withEgress('person-write', async (api) => {
    const saved = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'SECRET backend detail' } }), { status: 500, headers: { 'content-type': 'application/json' } });
    try {
      const r = await post(LESSONS);
      assert.equal(r.statusCode, 502);
      assert.ok(!JSON.stringify(r.body).includes('SECRET'));
      assert.match(r.body.error, /Nothing was added/);
    } finally { globalThis.fetch = saved; }
    assert.equal(api.events.size, 0);
  });
});

test('the manifest mounts the route and holds the Google add for the person\'s approval with a card that says where it goes', () => {
  const route = manifest.routes.find((r) => r.mountPath === '/api/calendar/google-events');
  assert.deepEqual([route.module, route.factory, route.requiresAuth, route.auth], ['routes/google-events.js', 'createGoogleEventsRoutes', true, 'oidc']);
  const tool = manifest.tools.find((t) => t.name === 'calendar-add-google-event');
  assert.equal(tool.requiresApproval, true);
  assert.equal(tool.executor.apiEndpoint, 'POST /api/calendar/google-events');
  assert.equal(tool.displayName, 'Add to Google Calendar');
  assert.equal(tool.cardText, 'Adds this to your primary Google Calendar, as one event or one repeating series. Nothing is written to Google until you approve.');
  const schema = tool.inputSchema;
  assert.deepEqual(schema.required, ['title', 'start', 'confirm']);
  assert.deepEqual(schema.properties.repeat.properties.every.enum, ['day', 'week', 'month', 'year']);
  assert.deepEqual(schema.properties.repeat.properties.on.items.enum, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  assert.deepEqual([schema.properties.repeat.properties.times.minimum, schema.properties.repeat.properties.times.maximum], [2, 730]);
  assert.match(schema.properties.start.description, /^The FIRST occurrence/);
  assert.match(schema.properties.repeat.properties.times.description, /"for 20 weeks" every week is 20/);
  assert.match(tool.usageInstructions, /never a date worked out from the number of weeks/);
  assert.match(tool.usageInstructions, /A repeating event is ONE call/);
});

test('a repeat sent to the OSHAL-only add is refused instead of saved as one event (the 20-weeks defect)', async () => {
  const own = load('own-events.js', { express: { Router: router }, crypto: require('node:crypto'), '@/shared/logger': logger, './event-time': time });
  const parsed = own.parseEvent({ title: "Gabriel's music lessons", start: '2027-02-05T18:00', end: '2027-02-05T19:00', timeZone: 'America/Chicago', repeat: { every: 'week', times: 20 } });
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /keeps single events only/);
  const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas', 'calendar-concierge.yaml'), 'utf8')).perspective.replace(/\s+/g, ' ');
  assert.match(persona, /A repeating event \("every Friday", "weekly for 20 weeks", "every day until June 1"\) is ONE calendar-add-google-event call/);
  assert.match(persona, /"start" is the FIRST date/);
  assert.match(persona, /never the last date, and never a date worked out from the number of weeks/);
  assert.match(persona, /When the person names Google Calendar, or asks for an event that repeats, add it with calendar-add-google-event/);
});
