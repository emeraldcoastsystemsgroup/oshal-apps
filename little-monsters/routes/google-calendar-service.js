"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-12 20:40:00 | roger.murphy@agenticfederal.us   | Google Calendar v3 client — reuses the google-bot OAuth access token (injected, no cross-feature import) to push/pull events. Backs the Little Monsters calendar sync.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleCalendarService = exports.GoogleCalendarError = void 0;
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'google-calendar-service' });
const CALENDAR_BASE_URL = 'https://www.googleapis.com/calendar/v3';
/** @description Raised when the calendar API rejects a call or no token exists. */
class GoogleCalendarError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'GoogleCalendarError';
    }
}
exports.GoogleCalendarError = GoogleCalendarError;
const DEFAULT_TZ = 'America/Chicago';
/**
 * @description Thin Google Calendar v3 client. Holds no credentials of its
 * own — every call resolves a fresh bearer token via the injected provider,
 * so token storage/refresh stays owned by the google-bot OAuth profile.
 */
class GoogleCalendarService {
    getAccessToken;
    constructor(getAccessToken) {
        this.getAccessToken = getAccessToken;
    }
    /**
     * @description Issue an authenticated Calendar API request and parse JSON.
     * @param pathAndQuery - path beneath the calendar base URL (with query string)
     * @param init - fetch init (method/body); Authorization is added here
     * @returns the parsed JSON body, or null for 204 responses
     */
    async call(pathAndQuery, init = {}) {
        let token;
        try {
            token = await this.getAccessToken();
        }
        catch (err) {
            throw new GoogleCalendarError(`Google account not connected: ${err?.message || err}`);
        }
        const resp = await fetch(`${CALENDAR_BASE_URL}${pathAndQuery}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                ...(init.headers || {}),
            },
        });
        if (resp.status === 204)
            return null;
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            const msg = body?.error?.message || resp.statusText;
            logger.error({ status: resp.status, msg, pathAndQuery }, 'Google Calendar API call failed');
            throw new GoogleCalendarError(`Google Calendar API ${resp.status}: ${msg}`, resp.status);
        }
        return body;
    }
    /**
     * @description List events in a time window, expanded to single instances.
     * @param opts - calendarId (default 'primary'), ISO timeMin/timeMax, maxResults
     * @returns normalized events ordered by start time
     */
    async listUpcoming(opts = {}) {
        const calendarId = opts.calendarId || 'primary';
        const now = new Date();
        const timeMin = opts.timeMin || now.toISOString();
        const timeMax = opts.timeMax || new Date(now.getTime() + 30 * 86400000).toISOString();
        const q = new URLSearchParams({
            timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime',
            maxResults: String(opts.maxResults || 50),
        });
        const data = await this.call(`/calendars/${encodeURIComponent(calendarId)}/events?${q.toString()}`);
        return (data.items || []).map((e) => ({
            id: e.id,
            summary: e.summary || '(untitled)',
            description: e.description || '',
            start: e.start?.dateTime || e.start?.date || null,
            end: e.end?.dateTime || e.end?.date || null,
            allDay: !!e.start?.date && !e.start?.dateTime,
            htmlLink: e.htmlLink || null,
        }));
    }
    /**
     * @description Create an event. Timed events use dateTime+timeZone; events
     * without a time become all-day (start.date .. next-day end.date per the
     * Calendar API's exclusive-end convention).
     * @param input - normalized local event fields
     * @returns the new Google event id + htmlLink
     */
    async createEvent(input) {
        const calendarId = input.calendarId || 'primary';
        const tz = input.timeZone || DEFAULT_TZ;
        const body = {
            summary: input.summary,
            description: input.description || '',
        };
        if (input.time) {
            const hms = input.time.length === 5 ? `${input.time}:00` : input.time;
            body.start = { dateTime: `${input.date}T${hms}`, timeZone: tz };
            body.end = { dateTime: `${input.date}T${addOneHour(hms)}`, timeZone: tz };
        }
        else {
            body.start = { date: input.date };
            body.end = { date: nextDay(input.date) };
        }
        if (typeof input.reminderMinutes === 'number') {
            body.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: input.reminderMinutes }] };
        }
        const created = await this.call(`/calendars/${encodeURIComponent(calendarId)}/events`, {
            method: 'POST',
            body: JSON.stringify(body),
        });
        return { id: created.id, htmlLink: created.htmlLink || null };
    }
    /**
     * @description Delete an event by id. A 404/410 (already gone) is treated as
     * success so callers can clear a stale google_event_id idempotently.
     * @param eventId - the Google event id
     * @param calendarId - default 'primary'
     */
    async deleteEvent(eventId, calendarId = 'primary') {
        try {
            await this.call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
        }
        catch (err) {
            if (err instanceof GoogleCalendarError && (err.status === 404 || err.status === 410))
                return;
            throw err;
        }
    }
}
exports.GoogleCalendarService = GoogleCalendarService;
/** @description Add one hour to an HH:MM:SS string, clamping at 23:59:59. */
function addOneHour(hms) {
    const [h, m, s] = hms.split(':').map((n) => parseInt(n, 10));
    const total = Math.min(h * 3600 + m * 60 + (s || 0) + 3600, 86399);
    const hh = Math.floor(total / 3600), mm = Math.floor((total % 3600) / 60), ss = total % 60;
    return [hh, mm, ss].map((n) => String(n).padStart(2, '0')).join(':');
}
/** @description Return the YYYY-MM-DD date that follows the given date. */
function nextDay(date) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}
//# sourceMappingURL=google-calendar-service.js.map