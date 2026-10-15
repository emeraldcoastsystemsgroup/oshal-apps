"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WHERE = exports.MAX_OWN_EVENTS = void 0;
exports.parseEvent = parseEvent;
exports.ownEvent = ownEvent;
exports.readOwnEvents = readOwnEvents;
exports.agendaWindow = agendaWindow;
exports.agendaEvent = agendaEvent;
exports.readAgenda = readAgenda;
exports.createOwnEventsRoutes = createOwnEventsRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Events a person adds in OSHAL (by hand or through the concierge with their approval): list, add and remove the caller's own rows in calendar_own_events. Jarvis routed "put it on my calendar" to this app, whose concierge had only read tools, so a drafted event could never be saved. These rows stay in OSHAL; nothing is written to Google Calendar.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 9. A timed start may be a wall-clock time with the person's IANA "timeZone" (the concierge demanded a UTC offset although the kernel names the zone on every turn); the zone, or the offset the start carried, is saved (migration 005) and every event answers "local", its start in that zone, so the screen and the Home card stop showing '2026-11-07T01:00:00.000Z'. An add identical to a saved event (same title, start and all-day) answers 409 and writes nothing: a confirmation turn re-proposed an approved event and its approval saved a duplicate.
 */
/** Events a person adds in OSHAL: the caller's own rows, never written to Google Calendar. */
const express_1 = require("express");
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const event_time_1 = require("./event-time");
const log = (0, logger_1.createChildLogger)({ module: 'calendar.own-events' });
/** The most events one person keeps here; a full calendar answers 409 instead of growing without bound. */
exports.MAX_OWN_EVENTS = 500;
/** Where a saved event lives, said in every answer so nobody reads it as a Google write. */
exports.WHERE = 'Saved to your OSHAL calendar in Calendar Preparation. It is not added to Google Calendar.';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NEEDS_ZONE = 'A start time needs the person\'s time zone: send "timeZone" (the IANA zone named on the Current time line, like America/Chicago) with a local start like 2026-11-06T18:00, or a start with its UTC offset like 2026-11-06T18:00:00-06:00.';
/**
 * @description A calendar day as midnight UTC, only when the text is a real date (2026-02-30 is refused).
 * @param text - A 'YYYY-MM-DD' day.
 * @returns The instant, or null.
 */
function dayInstant(text) {
    if (!DAY.test(text))
        return null;
    const at = new Date(`${text}T00:00:00.000Z`);
    return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === text ? at.toISOString() : null;
}
/**
 * @description A timed start or end. With its own UTC offset (or Z) it names its instant; without one it is the person's
 * wall-clock time in their zone, converted with that zone's rules for that date. Without either the clock time is unknown
 * here, and guessing would put the event at the wrong hour.
 * @param text - An ISO 8601 date-time.
 * @param zone - The person's valid IANA zone, or null.
 * @returns The instant, or null.
 */
function timedInstant(text, zone) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text))
        return null;
    if (!(0, event_time_1.hasOffset)(text))
        return zone ? (0, event_time_1.wallToInstant)(text, zone) : null;
    const at = Date.parse(text);
    return Number.isFinite(at) ? new Date(at).toISOString() : null;
}
/** Optional text bounded to its column, or null. */
function bounded(value, max) {
    if (value == null || value === '')
        return null;
    if (typeof value !== 'string')
        return undefined;
    const text = value.trim();
    return text.length <= max ? text || null : undefined;
}
/**
 * @description Validate a new event exactly as the add route stores it. A date-only start is an all-day event; a timed start
 * needs its UTC offset or the person's "timeZone"; an end may not precede the start. The saved zone is the named zone, else the
 * offset the start carried, so the event is shown later in the time the person meant.
 * @param body - The request body: { title, start, end?, allDay?, timeZone?, location?, notes? }.
 * @returns The stored values, or the refusal the person reads.
 */
function parseEvent(body) {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 120)
        return { ok: false, error: 'A title of 1 to 120 characters is required.' };
    const zone = (0, event_time_1.validZone)(body?.timeZone);
    if (body?.timeZone != null && body.timeZone !== '' && !zone)
        return { ok: false, error: 'timeZone must be an IANA time zone such as America/Chicago.' };
    const start = typeof body?.start === 'string' ? body.start.trim() : '';
    const allDay = body?.allDay === true || DAY.test(start);
    const startsAt = allDay ? dayInstant(start.slice(0, 10)) : timedInstant(start, zone);
    if (!startsAt)
        return { ok: false, error: allDay ? 'An all-day start is a date like 2026-11-07.' : NEEDS_ZONE };
    const endText = typeof body?.end === 'string' ? body.end.trim() : '';
    const endsAt = !endText ? null : allDay ? dayInstant(endText.slice(0, 10)) : timedInstant(endText, zone);
    if (endText && !endsAt)
        return { ok: false, error: allDay ? 'An all-day end is a date like 2026-11-08.' : 'An end time is the same form as the start, like 2026-11-08T21:00 with the timeZone.' };
    if (endsAt && Date.parse(endsAt) < Date.parse(startsAt))
        return { ok: false, error: 'The end is before the start.' };
    const location = bounded(body?.location, 200), notes = bounded(body?.notes, 2000);
    if (location === undefined)
        return { ok: false, error: 'A location is text of at most 200 characters.' };
    if (notes === undefined)
        return { ok: false, error: 'Notes are text of at most 2000 characters.' };
    return { ok: true, title, startsAt, endsAt, allDay, zone: allDay ? null : zone || (0, event_time_1.offsetOf)(start), location, notes };
}
/**
 * @description A stored row as the routes answer it: an all-day start is its 'YYYY-MM-DD' day (the shape a synced all-day
 * event has), a timed one an ISO instant, and "local" is the start in words in the zone it was entered in.
 * @param row - A calendar_own_events row.
 * @returns The event.
 */
function ownEvent(row) {
    const iso = (value) => (value == null ? null : new Date(value).toISOString());
    const start = iso(row.starts_at), end = iso(row.ends_at), allDay = row.all_day === true;
    const shown = allDay ? start.slice(0, 10) : start, timeZone = typeof row.time_zone === 'string' && row.time_zone ? row.time_zone : null;
    return { id: String(row.id), title: String(row.title), start: shown, end: end && allDay ? end.slice(0, 10) : end,
        allDay, timeZone, local: (0, event_time_1.localLabel)(shown, allDay, timeZone), location: row.location ?? null, notes: row.notes ?? null, createdAt: iso(row.created_at) };
}
/**
 * @description The caller's own events from the start of today (UTC) on, soonest first.
 * @param ctx - The application context (its pool).
 * @param sub - The verified caller.
 * @param now - Clock seam.
 * @returns At most 100 events.
 */
async function readOwnEvents(ctx, sub, now = new Date()) {
    const from = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
    const q = await ctx.pool.query({ text: 'SELECT id,title,starts_at,ends_at,all_day,time_zone,location,notes,created_at FROM calendar_own_events WHERE user_sub = $1 AND starts_at >= $2 ORDER BY starts_at ASC LIMIT 100', values: [sub, from], query_timeout: 1800 });
    return q.rows.map(ownEvent);
}
/** A closed civil-day window; timed events are projected into this viewer zone. */
function agendaWindow(query) {
    if (!query || Object.keys(query).some(k => !['from', 'to', 'tz'].includes(k)))
        throw new Error('invalid_calendar_window');
    const { from, to, tz } = query;
    if (typeof from !== 'string' || typeof to !== 'string' || typeof tz !== 'string' || !dayInstant(from) || !dayInstant(to) || !(0, event_time_1.validZone)(tz))
        throw new Error('invalid_calendar_window');
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days < 0 || days > 61)
        throw new Error('invalid_calendar_window');
    return { from, to, tz };
}
function civilDay(value, zone) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
    const field = (type) => parts.find(p => p.type === type).value;
    return `${field('year')}-${field('month')}-${field('day')}`;
}
/** Exclusive event ends never spill into the next civil day. All-day dates never shift zones. */
function agendaEvent(event, source, zone, index = 0) {
    if (!event || typeof event.title !== 'string' || typeof event.start !== 'string')
        throw new Error('invalid_saved_event');
    const allDay = event.allDay === true;
    const start = allDay ? dayInstant(event.start) : (0, event_time_1.hasOffset)(event.start) ? Date.parse(event.start) : NaN;
    const startMs = typeof start === 'string' ? Date.parse(start) : start;
    const end = event.end == null ? null : allDay ? dayInstant(event.end) : typeof event.end === 'string' && (0, event_time_1.hasOffset)(event.end) ? Date.parse(event.end) : NaN;
    const endMs = typeof end === 'string' ? Date.parse(end) : end;
    if (!Number.isFinite(startMs) || (event.end != null && (!Number.isFinite(endMs) || Number(endMs) < startMs)))
        throw new Error('invalid_saved_event');
    const last = endMs != null && endMs > startMs ? endMs - 1 : startMs;
    return { id: String(event.id || ''), key: `${source}:${event.id || index}`, source, title: event.title.slice(0, 120),
        start: event.start, end: event.end ?? null, allDay, timeZone: event.timeZone ?? null,
        firstDay: allDay ? event.start : civilDay(startMs, zone), lastDay: allDay ? new Date(last).toISOString().slice(0, 10) : civilDay(last, zone),
        location: source === 'oshal' ? event.location ?? null : null, notes: source === 'oshal' ? event.notes ?? null : null,
        url: source === 'google' && typeof event.url === 'string' ? event.url : null };
}
/** Read the complete bounded owned calendar, including history and events already underway. */
async function readAgenda(ctx, sub, window) {
    const own = await ctx.pool.query({ text: 'SELECT id,title,starts_at,ends_at,all_day,time_zone,location,notes,created_at FROM calendar_own_events WHERE user_sub = $1 ORDER BY starts_at ASC LIMIT 501', values: [sub], query_timeout: 1800 });
    if (own.rows.length > exports.MAX_OWN_EVENTS)
        throw new Error('calendar_capacity_exceeded');
    const saved = await ctx.pool.query({ text: 'SELECT events,synced_at FROM calendar_preparation_snapshots WHERE user_sub = $1', values: [sub], query_timeout: 1800 });
    const row = saved.rows[0], google = row ? row.events : [];
    if (!Array.isArray(google) || google.length > 250)
        throw new Error('calendar_snapshot_invalid_or_overflow');
    const warnings = [], events = [];
    for (const [source, rows] of [['oshal', own.rows.map(ownEvent)], ['google', google]]) {
        rows.forEach((event, index) => {
            try {
                const item = agendaEvent(event, source, window.tz, index);
                if (item.firstDay <= window.to && item.lastDay >= window.from)
                    events.push(item);
            }
            catch (_) {
                warnings.push(`An invalid saved ${source} event could not be displayed.`);
            }
        });
    }
    const syncedAt = row ? new Date(row.synced_at).toISOString() : null;
    events.sort((a, b) => a.firstDay.localeCompare(b.firstDay) || Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start) || a.key.localeCompare(b.key));
    return { window, events, partial: warnings.length > 0, warnings,
        snapshot: { state: row ? 'saved' : 'missing', syncedAt, coverageFrom: syncedAt, coverageTo: syncedAt ? new Date(Date.parse(syncedAt) + 30 * 86400000).toISOString() : null, primaryOnly: true, maxEvents: 250, complete: false } };
}
/** The verified caller, or null after answering 401. */
function caller(req, res) {
    const o = req.oidc, sub = o?.user?.sub;
    if (!sub || o?.isAuthenticated?.() !== true) {
        res.status(401).json({ error: 'not_authenticated' });
        return null;
    }
    return String(sub);
}
/**
 * @description Add one event for the caller: confirm required, validated, at most MAX_OWN_EVENTS, and never a second copy of an
 * event already saved with the same title, start and all-day flag.
 * @param ctx - The application context (its pool).
 * @param sub - The verified caller.
 * @param body - The request body.
 * @returns The HTTP status and body to answer.
 */
async function addEvent(ctx, sub, body) {
    if (body?.confirm !== true)
        return { status: 400, body: { error: 'Confirm adding the event' } };
    const parsed = parseEvent(body);
    if (!parsed.ok)
        return { status: 400, body: { error: parsed.error } };
    const count = await ctx.pool.query({ text: 'SELECT COUNT(*) AS n FROM calendar_own_events WHERE user_sub = $1', values: [sub], query_timeout: 1800 });
    if (Number(count.rows[0]?.n || 0) >= exports.MAX_OWN_EVENTS)
        return { status: 409, body: { error: `Your OSHAL calendar already holds ${exports.MAX_OWN_EVENTS} events. Remove some before adding more.` } };
    const same = await ctx.pool.query({ text: 'SELECT id,title,starts_at,ends_at,all_day,time_zone,location,notes,created_at FROM calendar_own_events WHERE user_sub = $1 AND title = $2 AND starts_at = $3 AND all_day = $4 LIMIT 1', values: [sub, parsed.title, parsed.startsAt, parsed.allDay], query_timeout: 1800 });
    if (same.rows.length) {
        const saved = ownEvent(same.rows[0]);
        return { status: 409, body: { error: `"${saved.title}" on ${saved.local} is already on your OSHAL calendar; nothing was added.`, duplicate: true, event: saved, where: exports.WHERE } };
    }
    const id = (0, crypto_1.randomUUID)(), createdAt = new Date().toISOString();
    await ctx.pool.query('INSERT INTO calendar_own_events(user_sub,id,title,starts_at,ends_at,all_day,time_zone,location,notes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [sub, id, parsed.title, parsed.startsAt, parsed.endsAt, parsed.allDay, parsed.zone, parsed.location, parsed.notes, createdAt]);
    const event = ownEvent({ id, title: parsed.title, starts_at: parsed.startsAt, ends_at: parsed.endsAt, all_day: parsed.allDay, time_zone: parsed.zone, location: parsed.location, notes: parsed.notes, created_at: createdAt });
    return { status: 201, body: { ok: true, event, where: exports.WHERE } };
}
/**
 * @description Remove one of the caller's own events by id.
 * @param ctx - The application context (its pool).
 * @param sub - The verified caller.
 * @param id - The event id from the path.
 * @returns The HTTP status and body to answer.
 */
async function removeEvent(ctx, sub, id) {
    if (!/^[0-9a-f-]{36}$/i.test(id))
        return { status: 400, body: { error: 'An event id is required.' } };
    const gone = await ctx.pool.query('DELETE FROM calendar_own_events WHERE user_sub = $1 AND id = $2', [sub, id]);
    if (!gone.rowCount)
        return { status: 404, body: { error: 'No such event in your OSHAL calendar.' } };
    return { status: 200, body: { ok: true, removed: id } };
}
/** Mounted at /api/calendar/events: the caller's own events, never another person's and never Google's. */
function createOwnEventsRoutes(ctx) {
    const r = (0, express_1.Router)();
    r.get('/agenda', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const sub = caller(req, res);
        if (!sub)
            return;
        if (['x-oshal-tenant-id', 'x-tenant-id', 'x-oshal-owner', 'x-oshal-principal-id'].some(k => req.headers[k] != null)) {
            res.status(400).json({ error: 'caller_override_refused' });
            return;
        }
        let window;
        try {
            window = agendaWindow(req.query);
        }
        catch (_) {
            res.status(400).json({ error: 'invalid_calendar_window' });
            return;
        }
        try {
            res.json(await readAgenda(ctx, sub, window));
        }
        catch (err) {
            log.error({ err }, 'Personal calendar read failed');
            res.status(503).json({ error: err instanceof Error && /^calendar_/.test(err.message) ? err.message : 'calendar_read_unavailable' });
        }
    });
    r.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const sub = caller(req, res);
        if (!sub)
            return;
        try {
            res.json({ events: await readOwnEvents(ctx, sub), where: exports.WHERE });
        }
        catch (err) {
            log.error({ err }, 'Own calendar events read failed');
            res.status(503).json({ error: 'Your saved events cannot be read right now.' });
        }
    });
    r.post('/', async (req, res) => {
        const sub = caller(req, res);
        if (!sub)
            return;
        try {
            const out = await addEvent(ctx, sub, req.body);
            res.status(out.status).json(out.body);
        }
        catch (err) {
            log.error({ err }, 'Own calendar event add failed');
            res.status(503).json({ error: 'The event was not saved. Try again.' });
        }
    });
    r.delete('/:id', async (req, res) => {
        const sub = caller(req, res);
        if (!sub)
            return;
        try {
            const out = await removeEvent(ctx, sub, String(req.params.id || ''));
            res.status(out.status).json(out.body);
        }
        catch (err) {
            log.error({ err }, 'Own calendar event removal failed');
            res.status(503).json({ error: 'The event was not removed. Try again.' });
        }
    });
    return r;
}
