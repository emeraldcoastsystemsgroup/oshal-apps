/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A stand-in Google Calendar v3 events API on a loopback HTTP server, and the kernel's package
 *   egress in front of it, for the meeting change and cancel suites (calendar 1.4.0). It keeps single events and weekly or daily
 *   series with their occurrences (ids "<series>_<UTC start>"), each with an etag that changes on every write; lists a window
 *   with Google's free-text search over the title, notes, place, guests and organizer; reads, patches and deletes an event or
 *   one occurrence (an occurrence's change is kept as its own exception); records sendUpdates; refuses a write with a read-only
 *   grant (403 insufficient scopes), a guest's change to a meeting whose organizer did not let guests change it (403
 *   forbiddenForNonOrganizer), a stale If-Match (412), a second delete (410), and an event Google itself refuses (400). The
 *   egress stand-in admits only the manifest's declared host, only the headers a package may set (oshal-kernel
 *   crates/oshald/src/package_egress.rs PACKAGE_HEADERS: no Authorization, no If-Match), places the caller's own credential,
 *   and refuses "not connected" without one. Made-up people and meetings only; no real account is touched.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.5.0 (Home reads Google Calendar live): the calendar list
 *   (/users/me/calendarList, which needs calendar.readonly or calendar, never calendar.events alone, as Google's own list does)
 *   with the primary calendar and any other calendars a test gives (selected or not, hidden or not, an access role), each other
 *   calendar's events at /calendars/<id>/events, the calendar's own zone on a list of events, a "person-full" grant (the
 *   kernel's default Google scopes: calendar.readonly and calendar.events), and stall(<calendar id or "list">) for a Google that
 *   does not answer.
 */
'use strict';
const http = require('node:http');

const WRITE = 'https://www.googleapis.com/auth/calendar.events';
const READ_ONLY = 'https://www.googleapis.com/auth/calendar.readonly';
const BASE = '/calendar/v3/calendars/primary/events';
const PACKAGE_HEADERS = ['accept', 'accept-language', 'content-type', 'user-agent', 'if-none-match', 'if-modified-since', 'x-requested-with', 'cache-control', 'range', 'x-fantasy-filter', 'duffel-version'];
const CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_MS = 86_400_000;

/** The offset of a zone at an instant, in ms. */
function zoneOffset(at, zone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(at / 1000) * 1000;
}
/** A wall time 'YYYY-MM-DDTHH:mm(:ss)' in a zone as an instant (ms). */
function wallAt(wall, zone) {
  const guess = Date.parse(`${wall.length === 16 ? `${wall}:00` : wall.slice(0, 19)}Z`);
  const first = guess - zoneOffset(guess, zone);
  return guess - zoneOffset(first, zone);
}
/** An instant as Google writes it in a zone: '2026-11-17T15:00:00-06:00'. */
function withOffset(at, zone) {
  const off = zoneOffset(at, zone), sign = off < 0 ? '-' : '+', abs = Math.abs(off) / 60000;
  return `${new Date(at + off).toISOString().slice(0, 19)}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
/** A start or end as an instant (ms), or a date's midnight UTC. */
function instantOf(time, zone) {
  if (time?.date && !time.dateTime) return Date.parse(`${time.date}T00:00:00Z`);
  const text = String(time?.dateTime || '');
  return /(Z|[+-]\d{2}:?\d{2})$/.test(text) ? Date.parse(text) : wallAt(text, time.timeZone || zone);
}
/** A time as Google answers it: a date, or a date-time with its offset and zone. */
function shown(time, zone) {
  if (!time) return time;
  if (time.date && !time.dateTime) return { date: time.date };
  const tz = time.timeZone || zone;
  return { dateTime: withOffset(instantOf(time, tz), tz), timeZone: tz };
}

/**
 * The stand-in API. `tokens` maps a bearer to its granted scopes; `zone` is the calendar's own zone.
 * @returns {{seed, get, requests, events, overrides, origin, close}}
 */
async function standInGoogle({ tokens = { 'person-write': [WRITE], 'person-read-only': [READ_ONLY], 'person-full': [READ_ONLY, WRITE] }, zone = 'America/Chicago', calendars = [] } = {}) {
  const events = new Map(), overrides = new Map(), requests = [], stalled = new Set(), held = [];
  const others = new Map(calendars.map((c) => [c.id, { ...c, events: new Map() }]));
  let counter = 1000;
  const etag = () => `"${3181160000000000 + (++counter)}"`;
  const digits = (tag) => String(tag || '').replace(/\D/g, '');

  /** The occurrences of a series in [from, to), each as Google answers it (with its exception applied). */
  function occurrences(parent, from = -Infinity, to = Infinity) {
    const rule = Object.fromEntries(String((parent.recurrence || []).find((l) => /^RRULE:/.test(l)) || 'RRULE:FREQ=DAILY;COUNT=1').slice(6).split(';').map((kv) => kv.split('=')));
    const allDay = Boolean(parent.start.date), tz = parent.start.timeZone || zone;
    const startDay = allDay ? parent.start.date : new Date(instantOf(parent.start, tz) + zoneOffset(instantOf(parent.start, tz), tz)).toISOString().slice(0, 10);
    const wallTime = allDay ? '' : new Date(instantOf(parent.start, tz) + zoneOffset(instantOf(parent.start, tz), tz)).toISOString().slice(11, 19);
    const length = instantOf(parent.end, tz) - instantOf(parent.start, tz);
    const days = rule.BYDAY ? rule.BYDAY.split(',').map((c) => CODES.indexOf(c)) : [new Date(`${startDay}T00:00:00Z`).getUTCDay()];
    const until = rule.UNTIL ? Date.parse(rule.UNTIL.replace(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/, (_, y, m, d, h = '23', mi = '59', s = '59') => `${y}-${m}-${d}T${h}:${mi}:${s}Z`)) : Infinity;
    const out = [];
    let count = 0;
    for (let i = 0; i < 800 && count < Number(rule.COUNT || 400); i++) {
      const day = new Date(Date.parse(`${startDay}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10);
      if (rule.FREQ === 'WEEKLY' && !days.includes(new Date(`${day}T00:00:00Z`).getUTCDay())) continue;
      const at = allDay ? Date.parse(`${day}T00:00:00Z`) : wallAt(`${day}T${wallTime}`, tz);
      if (at > until) break;
      count++;
      const id = `${parent.id}_${allDay ? day.replace(/-/g, '') : new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
      const original = allDay ? { date: day } : { dateTime: withOffset(at, tz), timeZone: tz };
      const end = allDay ? { date: new Date(at + length).toISOString().slice(0, 10) } : { dateTime: withOffset(at + length, tz), timeZone: tz };
      const own = overrides.get(id) || {};
      const item = { ...parent, ...own, id, recurringEventId: parent.id, originalStartTime: original, recurrence: undefined,
        start: own.start ? shown(own.start, tz) : original, end: own.end ? shown(own.end, tz) : end,
        etag: `"${digits(parent.etag)}${digits(own.etag) || '0'}"`, status: own.status || parent.status || 'confirmed', htmlLink: `https://www.google.com/calendar/event?eid=${id}` };
      delete item.recurrence;
      const s = instantOf(item.start, tz), e = instantOf(item.end, tz);
      if (s < to && Math.max(e, s + 1) > from) out.push(item);
    }
    return out;
  }

  /** An event as Google answers it, or one occurrence of a series by its id. */
  function get(id) {
    if (events.has(id)) { const e = events.get(id); return { ...e, start: shown(e.start, e.start.timeZone || zone), end: shown(e.end, e.start.timeZone || zone) }; }
    const m = /^(.+)_(\d{8}(?:T\d{6}Z)?)$/.exec(id);
    if (!m || !events.has(m[1])) return null;
    return occurrences(events.get(m[1])).find((o) => o.id === id) || (overrides.has(id) ? { ...overrides.get(id), id } : null);
  }

  /** Put a made-up event or series on the calendar. */
  function seed(event) {
    const id = event.id || `standin${events.size + 1}`;
    events.set(id, { kind: 'calendar#event', status: 'confirmed', organizer: { email: 'you@example.com', displayName: 'You', self: true }, ...event, id, etag: etag(), htmlLink: `https://www.google.com/calendar/event?eid=${id}` });
    return id;
  }

  /** Put a made-up event on another calendar of the person. */
  function seedOn(calendarId, event) {
    const cal = others.get(calendarId), id = event.id || `${calendarId.replace(/[^a-z0-9]/gi, '')}e${cal.events.size + 1}`;
    cal.events.set(id, { kind: 'calendar#event', status: 'confirmed', ...event, id, etag: etag(), htmlLink: `https://www.google.com/calendar/event?eid=${id}` });
    return id;
  }

  /** The calendar list as Google answers it: the primary calendar, then the others a test gave. */
  function calendarList() {
    return [{ id: 'you@example.com', summary: 'you@example.com', primary: true, selected: true, accessRole: 'owner', timeZone: zone },
      ...[...others.values()].map(({ events: _e, ...c }) => ({ accessRole: 'reader', ...c }))];
  }

  /** One other calendar's events in a window, by start. */
  function listOn(cal, query) {
    const from = Date.parse(query.get('timeMin')), to = Date.parse(query.get('timeMax'));
    return [...cal.events.values()].map((e) => ({ ...e, start: shown(e.start, cal.timeZone || zone), end: shown(e.end, cal.timeZone || zone) }))
      .filter((e) => e.status !== 'cancelled' && instantOf(e.start, zone) < to && Math.max(instantOf(e.end, zone), instantOf(e.start, zone) + 1) > from)
      .sort((a, b) => instantOf(a.start, zone) - instantOf(b.start, zone)).slice(0, Number(query.get('maxResults') || 250));
  }

  /** Google's free-text search: every term somewhere in the title, notes, place, guests or organizer. */
  function matches(e, q) {
    if (!q) return true;
    const hay = [e.summary, e.description, e.location, e.organizer?.displayName, e.organizer?.email, ...(e.attendees || []).flatMap((a) => [a.displayName, a.email])].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
  }

  function list(query) {
    const from = Date.parse(query.get('timeMin') || '1970-01-01T00:00:00Z'), to = Date.parse(query.get('timeMax') || '2100-01-01T00:00:00Z');
    const items = [];
    for (const e of events.values()) {
      if (e.status === 'cancelled') continue;
      if (e.recurrence) items.push(...occurrences(e, from, to).filter((o) => o.status !== 'cancelled'));
      else { const g = get(e.id), s = instantOf(g.start, zone), en = instantOf(g.end, zone); if (s < to && Math.max(en, s + 1) > from) items.push(g); }
    }
    return items.filter((e) => matches(e, query.get('q'))).sort((a, b) => instantOf(a.start, zone) - instantOf(b.start, zone)).slice(0, Number(query.get('maxResults') || 250));
  }

  /** What Google refuses in an event it is asked to write. */
  function invalid(e) {
    if (!e.start || !e.end) return 'Missing start or end.';
    if (Boolean(e.start.dateTime) !== Boolean(e.end.dateTime)) return 'The start and end times must both be dates or both be date-times.';
    if (e.recurrence && e.start.dateTime && !e.start.timeZone) return 'Missing time zone definition for start time.';
    if (instantOf(e.end, e.start.timeZone || zone) < instantOf(e.start, e.start.timeZone || zone)) return 'The specified time range is empty.';
    return null;
  }

  /** A guest may change only their own answer unless the organizer let guests change the meeting. */
  function guestMayNot(before, body) {
    if (before.organizer?.self || before.guestsCanModify) return false;
    const keys = Object.keys(body);
    if (keys.some((k) => k !== 'attendees')) return true;
    const strip = (list) => (list || []).map((a) => ({ ...a, responseStatus: a.self ? 'mine' : a.responseStatus }));
    return JSON.stringify(strip(before.attendees)) !== JSON.stringify(strip(body.attendees));
  }

  function patch(id, body, headers) {
    const before = get(id);
    if (!before || (before.status === 'cancelled' && !events.has(id))) return [404, { error: { code: 404, message: 'Not Found' } }];
    if (headers['if-match'] && headers['if-match'] !== before.etag) return [412, { error: { code: 412, message: 'Precondition Failed', errors: [{ reason: 'conditionNotMet' }] } }];
    if (guestMayNot(before, body)) return [403, { error: { code: 403, message: 'Forbidden', errors: [{ reason: 'forbiddenForNonOrganizer' }] } }];
    const merged = { ...(events.get(id) || before), ...body };
    const bad = invalid(merged);
    if (bad) return [400, { error: { code: 400, message: bad, errors: [{ reason: 'invalid', message: bad }] } }];
    if (events.has(id)) events.set(id, { ...merged, etag: etag() });
    else overrides.set(id, { ...(overrides.get(id) || {}), ...body, etag: etag() });
    return [200, get(id)];
  }

  function remove(id) {
    const before = get(id);
    if (!before) return [404, { error: { code: 404, message: 'Not Found' } }];
    if (before.status === 'cancelled') return [410, { error: { code: 410, message: 'Resource has been deleted', errors: [{ reason: 'deleted' }] } }];
    if (events.has(id)) events.set(id, { ...events.get(id), status: 'cancelled', etag: etag() });
    else overrides.set(id, { ...(overrides.get(id) || {}), status: 'cancelled', etag: etag() });
    return [204, null];
  }

  function insert(body) {
    if (body.id && events.has(body.id)) return [409, { error: { code: 409, message: 'The requested identifier already exists.', errors: [{ reason: 'duplicate' }] } }];
    const bad = invalid(body);
    if (bad) return [400, { error: { code: 400, message: bad } }];
    return [200, get(seed({ ...body }))];
  }

  function route(req, body) {
    const url = new URL(req.url, 'http://standin'), path = url.pathname;
    const grant = tokens[String(req.headers.authorization || '').replace(/^Bearer /, '')];
    if (!grant) return [401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } }];
    const writes = req.method !== 'GET';
    if (writes && !grant.some((s) => s === WRITE || s === 'https://www.googleapis.com/auth/calendar')) {
      return [403, { error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED', errors: [{ reason: 'insufficientPermissions' }], details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }];
    }
    if (req.method === 'GET' && path === '/calendar/v3/users/me/calendarList') {
      if (!grant.some((s) => s === READ_ONLY || s === 'https://www.googleapis.com/auth/calendar')) {
        return [403, { error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED', errors: [{ reason: 'insufficientPermissions' }], details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }];
      }
      return [200, { kind: 'calendar#calendarList', items: calendarList() }];
    }
    if (req.method === 'GET' && path === BASE) return [200, { kind: 'calendar#events', timeZone: zone, items: list(url.searchParams) }];
    const other = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(path);
    if (req.method === 'GET' && other && others.has(decodeURIComponent(other[1]))) {
      const cal = others.get(decodeURIComponent(other[1]));
      return [200, { kind: 'calendar#events', summary: cal.summary, timeZone: cal.timeZone || zone, items: listOn(cal, url.searchParams) }];
    }
    const inst = new RegExp(`^${BASE}/([A-Za-z0-9_]+)/instances$`).exec(path);
    if (req.method === 'GET' && inst) {
      const parent = events.get(inst[1]);
      return parent ? [200, { items: occurrences(parent, Date.parse(url.searchParams.get('timeMin')), Date.parse(url.searchParams.get('timeMax'))) }] : [404, { error: { code: 404 } }];
    }
    const one = new RegExp(`^${BASE}/([A-Za-z0-9_]+)$`).exec(path);
    if (req.method === 'GET' && one) { const e = get(one[1]); return e ? [200, e] : [404, { error: { code: 404, message: 'Not Found' } }]; }
    if (req.method === 'PATCH' && one) return patch(one[1], body || {}, req.headers);
    if (req.method === 'DELETE' && one) return remove(one[1]);
    if (req.method === 'POST' && path === BASE) return insert(body || {});
    return [404, { error: { code: 404, message: 'Not Found' } }];
  }

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null, url = new URL(req.url, 'http://standin');
      requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
      const asked = url.pathname === '/calendar/v3/users/me/calendarList' ? 'list' : decodeURIComponent((/^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname) || [])[1] || '');
      if (stalled.has(asked)) { held.push(res); return; }
      const [status, value] = route(req, body);
      res.writeHead(status, value == null ? {} : { 'content-type': 'application/json' });
      res.end(value == null ? '' : JSON.stringify(value));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { seed, seedOn, get, events, overrides, requests, writes: () => requests.filter((r) => r.method !== 'GET'),
    stall: (what) => stalled.add(what), origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => { for (const res of held) res.destroy(); server.closeAllConnections?.(); server.close(resolve); }) };
}

/**
 * The kernel's package egress in front of the stand-in: only the manifest's declared host, only the headers a package may
 * set, the caller's own credential placed by the kernel, "not connected" without one. Other hosts (a test's own loopback
 * server) pass through unchanged.
 * @returns {{sent: Array, restore: Function}}
 */
function kernelEgress(manifest, connection, api) {
  const real = globalThis.fetch, sent = [];
  process.env.OSHAL_EGRESS = 'kernel';
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(typeof url === 'string' ? url : url.href);
    if (target.hostname === '127.0.0.1' || target.hostname === 'localhost') return real(url, init);
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
    return real(`${api.origin}${target.pathname}${target.search}`, { method: init.method || 'GET', headers, body: init.body });
  };
  return { sent, restore() { globalThis.fetch = real; delete process.env.OSHAL_EGRESS; } };
}

module.exports = { standInGoogle, kernelEgress, WRITE, READ_ONLY, withOffset, wallAt };
