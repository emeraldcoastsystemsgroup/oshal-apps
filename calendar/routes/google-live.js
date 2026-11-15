"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOOGLE_NOTE = exports.MAX_EVENTS = exports.MAX_CALENDARS = exports.LIVE_BUDGET_MS = exports.CALENDAR_LIST = void 0;
exports.readGoogleLive = readGoogleLive;
exports.savedAtWords = savedAtWords;
exports.copyNote = copyNote;
exports.readWords = readWords;
exports.namesInWords = namesInWords;
exports.liveGaps = liveGaps;
const logger_1 = require("@/shared/logger");
const google_events_1 = require("./google-events");
const event_time_1 = require("./event-time");
const sync_1 = require("./sync");
const log = (0, logger_1.createChildLogger)({ module: 'calendar.google-live' });
const API = 'https://www.googleapis.com/calendar/v3';
/** The calendar list: every calendar the person has in Google Calendar, and whether they show it there. */
exports.CALENDAR_LIST = `${API}/users/me/calendarList`;
/** How long one answer waits for Google in all, list and calendars together. */
exports.LIVE_BUDGET_MS = 5000;
/** The most calendars one answer reads, the primary one included. */
exports.MAX_CALENDARS = 10;
/** The most events read from one calendar, and kept in one answer. */
exports.MAX_EVENTS = 250;
const READABLE = new Set(['owner', 'writer', 'reader']);
const RATE_LIMITS = ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'calendarUsageLimitsExceeded', 'dailyLimitExceeded', 'RATE_LIMIT_EXCEEDED'];
/**
 * @description One deadline for every read of one answer. A read is started only while time is left, and one that has not
 * answered by the deadline is not waited for (the kernel's own egress limit still bounds a request already sent).
 * @param ms - The whole budget in milliseconds.
 * @returns The budget's guard.
 */
function budget(ms) {
    const end = Date.now() + ms;
    return {
        async within(start) {
            const left = end - Date.now();
            if (left <= 0)
                return 'late';
            const work = start();
            work.catch(() => undefined);
            let timer;
            const late = new Promise((resolve) => { timer = setTimeout(() => resolve('late'), left); });
            try {
                return await Promise.race([work, late]);
            }
            finally {
                clearTimeout(timer);
            }
        },
    };
}
/** Why a refused or failed Google answer leaves a calendar unread. */
function downOf(got) {
    if (got === 'late')
        return 'no-answer';
    if ('refused' in got)
        return got.refused === google_events_1.NOT_CONNECTED ? 'not-connected' : 'reconnect';
    if (got.status === 401)
        return 'reconnect';
    const error = got.data?.error || {};
    const reasons = [...(Array.isArray(error.errors) ? error.errors : []), ...(Array.isArray(error.details) ? error.details : [])].map((e) => String(e?.reason || ''));
    if (got.status === 403 && !reasons.some((r) => RATE_LIMITS.includes(r)))
        return 'not-allowed';
    return 'no-answer';
}
/** The calendars the person shows in Google Calendar, other than the primary one, from the list's one page. */
function shownCalendars(items) {
    return items.filter((c) => c && typeof c.id === 'string' && c.primary !== true && c.selected === true && c.hidden !== true && c.deleted !== true && READABLE.has(c.accessRole))
        .map((c) => ({ id: c.id, name: String(c.summaryOverride || c.summary || c.id).slice(0, 80), primary: false }));
}
/**
 * @description Which calendars to read: the primary one first, then up to nine the person shows in Google Calendar. A list
 * Google refuses for this grant, or does not answer, leaves the primary one only, with the reason.
 * @returns The calendars and how the list answered, or why nothing can be read.
 */
async function calendarsToRead(ctx, sub, b) {
    const got = await b.within(() => (0, google_events_1.send)(ctx, sub, 'GET', `${exports.CALENDAR_LIST}?${new URLSearchParams({ minAccessRole: 'reader', maxResults: '50' })}`));
    const primary = { id: 'primary', name: 'primary', primary: true };
    if (got !== 'late' && 'status' in got && got.status === 200) {
        const others = shownCalendars(Array.isArray(got.data?.items) ? got.data.items : []);
        return { calendars: [primary, ...others.slice(0, exports.MAX_CALENDARS - 1)], unlisted: null, beyond: Math.max(0, others.length - (exports.MAX_CALENDARS - 1)) };
    }
    const down = downOf(got);
    if (got === 'late' || down === 'not-connected' || down === 'reconnect')
        return { down };
    return { calendars: [primary], unlisted: down === 'not-allowed' ? 'not-allowed' : 'no-answer', beyond: 0 };
}
/** One calendar's events in the window, minimized, each with the calendar it is on and its start in words. */
async function eventsOf(ctx, sub, cal, window, b) {
    const query = new URLSearchParams({ timeMin: window.timeMin, timeMax: window.timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: String(exports.MAX_EVENTS) });
    const got = await b.within(() => (0, google_events_1.send)(ctx, sub, 'GET', `${API}/calendars/${encodeURIComponent(cal.id)}/events?${query}`));
    if (got === 'late' || 'refused' in got || got.status !== 200)
        return { ok: false, down: downOf(got) };
    const zone = typeof got.data?.timeZone === 'string' ? got.data.timeZone : null;
    const items = (Array.isArray(got.data?.items) ? got.data.items : []).filter((e) => e && e.status !== 'cancelled' && (e.start?.dateTime || e.start?.date));
    const rows = items.slice(0, exports.MAX_EVENTS).map((e) => {
        const row = (0, sync_1.calendarRow)(e), at = String(row.start);
        return { ...row, uid: String(e.iCalUID || row.id), calendar: cal.primary ? null : cal.name, local: (0, event_time_1.localLabel)(at, row.allDay, e.start?.timeZone || zone || (0, event_time_1.offsetOf)(at)) };
    });
    return { ok: true, rows, full: Boolean(got.data?.nextPageToken) };
}
/** Every calendar's events as one list by start, an event on two calendars once (the primary copy), at most MAX_EVENTS. */
function combined(rows) {
    const seen = new Set(), events = [];
    for (const { uid, ...row } of rows) {
        const key = `${uid}|${row.start}`;
        if (!seen.has(key)) {
            seen.add(key);
            events.push(row);
        }
    }
    events.sort((a, b) => Date.parse(String(a.start)) - Date.parse(String(b.start)));
    return { events: events.slice(0, exports.MAX_EVENTS), capped: events.length > exports.MAX_EVENTS };
}
/**
 * @description Read the caller's Google calendars live in a window: the primary one, then the others they show in Google
 * Calendar, one request each, one after another, inside one budget. Nothing is written.
 * @param ctx - The application context (the legacy token broker's pool outside the native kernel).
 * @param sub - The verified caller.
 * @param window - The window's instants (timeMin inclusive, timeMax exclusive).
 * @param budgetMs - The whole time budget; LIVE_BUDGET_MS unless a test shortens it.
 * @returns The events with what was and was not read, or why nothing could be read.
 */
async function readGoogleLive(ctx, sub, window, budgetMs = exports.LIVE_BUDGET_MS) {
    const b = budget(budgetMs), readAt = new Date().toISOString();
    try {
        const plan = await calendarsToRead(ctx, sub, b);
        if (plan.down)
            return { state: plan.down, readAt };
        const rows = [], read = [], unread = [], full = [];
        for (const cal of plan.calendars) {
            const got = await eventsOf(ctx, sub, cal, window, b);
            if (!got.ok && cal.primary)
                return { state: got.down, readAt };
            if (!got.ok) {
                unread.push(cal.name);
                continue;
            }
            rows.push(...got.rows);
            if (!cal.primary)
                read.push(cal.name);
            if (got.full)
                full.push(cal.primary ? 'your primary calendar' : cal.name);
        }
        const { events, capped } = combined(rows);
        return { state: 'live', readAt, events, read, unread, listed: !plan.unlisted, unlisted: plan.unlisted, beyond: plan.beyond, full, capped };
    }
    catch (err) {
        log.error({ err }, 'Google Calendar could not be read live');
        return { state: 'no-answer', readAt };
    }
}
const CONNECTIONS = 'the Connections page (/utilities)';
/** What a person reads when Google Calendar was not read, by why. None of it asks them to sync. */
exports.GOOGLE_NOTE = {
    'not-connected': `Connect Google on ${CONNECTIONS} to see your Google Calendar here. Events added in Open Swarm are shown without it.`,
    reconnect: `Your Google connection is no longer accepted. Reconnect Google on ${CONNECTIONS} to see your Google Calendar here.`,
    'not-allowed': `Your Google connection does not let Open Swarm read your calendar. Reconnect Google on ${CONNECTIONS} and allow it to view your calendars.`,
    'no-answer': 'Google Calendar did not answer just now, so your Google events are not shown. They are read again the next time this opens.',
};
/**
 * @description An instant in words, in UTC: 'Nov 14, 2026, 9:00 PM UTC'. A read route has no viewer zone.
 * @param at - The instant.
 * @returns The words.
 */
function savedAtWords(at) {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(at);
}
/**
 * @description The note for the saved copy shown because Google did not answer.
 * @param syncedAt - When the copy was saved.
 * @returns The words.
 */
function copyNote(syncedAt) {
    return `Showing your last synced copy from ${savedAtWords(syncedAt)}: Google did not answer.`;
}
/**
 * @description The line that says which calendars were read just now.
 * @param live - A live read.
 * @param also - Words to add after the calendars (', with the events added in Open Swarm'), or none.
 * @returns The sentence.
 */
function readWords(live, also = '') {
    const which = live.read.length ? `your primary calendar and ${namesInWords(live.read)}` : 'your primary calendar';
    return `Read from Google Calendar just now: ${which}${also}.`;
}
/**
 * @description Names in a sentence: 'Family', 'Family and Work', 'Family, Work and 2 more'.
 * @param names - The names.
 * @returns The words.
 */
function namesInWords(names) {
    if (names.length <= 2)
        return names.join(' and ');
    if (names.length === 3)
        return `${names[0]}, ${names[1]} and ${names[2]}`;
    return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}
/**
 * @description What a live read could not cover, in the words a person reads after the line that says it was read.
 * @param live - A live read.
 * @returns The sentences, possibly none.
 */
function liveGaps(live) {
    const out = [];
    if (live.unlisted === 'not-allowed')
        out.push('Your Google connection does not let Open Swarm list your other calendars, so only your primary calendar is shown.');
    if (live.unlisted === 'no-answer')
        out.push('Google did not list your other calendars just now, so only your primary calendar is shown.');
    if (live.unread.length)
        out.push(`${namesInWords(live.unread)} did not answer in time, so ${live.unread.length === 1 ? 'its' : 'their'} events are not shown.`);
    if (live.beyond)
        out.push(`${live.beyond} more of the calendars you show in Google Calendar ${live.beyond === 1 ? 'is' : 'are'} not read here; the first ${exports.MAX_CALENDARS} are.`);
    if (live.full.length)
        out.push(`${namesInWords(live.full)} ${live.full.length === 1 ? 'has' : 'have'} more events than the ${exports.MAX_EVENTS} read from each calendar; only the soonest are shown.`);
    else if (live.capped)
        out.push(`Only the soonest ${exports.MAX_EVENTS} events are shown.`);
    return out;
}
//# sourceMappingURL=google-live.js.map