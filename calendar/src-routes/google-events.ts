/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add one event, or one repeating series, to the person's own primary Google Calendar, after they
 *   approve the calendar-add-google-event card. Production, 2026-11-13: "a new appointment at 6:00 p.m. to 7:00 p.m. every Friday ...
 *   add that to my Google calendar" was answered that this app could not write Google Calendar or repeat an event, and "make the
 *   event for 20 weeks" became one OSHAL event on Friday, February 5, 2027. A series is ONE Google event with an RRULE (every day,
 *   week on named weekdays, month or year; ending after a number of times or on a last date), starting on its first date, which must
 *   fall on one of its weekdays. Under the native kernel the request goes through the declared egress with no Authorization header:
 *   the kernel places the caller's own google-calendar grant. No connection, an expired one, or a grant that may only read the
 *   calendar answers 409 in words saying what to connect; nothing is written to Google before the approval, and a second approval
 *   of the same series is refused by Google itself through a client-chosen event id (one removed in Google is restored).
 */
/** Events the person adds to their own primary Google Calendar, one event or one repeating series per approved card. */
import { Router } from 'express';
import { createHash } from 'crypto';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { hasOffset, localLabel, offsetOf, validZone, wallToInstant } from './event-time';

const log = createChildLogger({ module: 'calendar.google-events' });

const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WALL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const WITH_OFFSET = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/i;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const FREQ: Record<string, string> = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' };
const HOUR = 3_600_000;
const MAX_TIMES = 730;
const MAX_SPAN_DAYS = 3653;
const CONNECTIONS = 'the Connections page (/utilities)';
const ALLOW = 'allow it to view and edit events on your calendars';
/** No connection reaches Google Calendar for this person. */
export const NOT_CONNECTED = `Google Calendar is not connected. Connect Google on ${CONNECTIONS} and ${ALLOW}, then ask again. Nothing was added.`;
/** The connection may read the calendar but not write events (a grant without calendar.events). */
export const READ_ONLY = `Your Google connection lets this app read your Google Calendar but not add events to it. Reconnect Google on ${CONNECTIONS} and ${ALLOW}, then ask again. Nothing was added.`;
/** Google refused the saved credential (expired, revoked or renewed elsewhere). */
export const RECONNECT = `Your Google connection is no longer accepted. Reconnect Google on ${CONNECTIONS}, then ask again. Nothing was added.`;
const LIMITED = 'Google Calendar is limiting requests right now. Nothing was added; try again in a few minutes.';
const FAILED = 'Google Calendar did not take the event. Nothing was added; try again in a few minutes.';
const NEEDS_ZONE = 'A start time needs the person\'s time zone: send "timeZone" (the IANA zone named on the Current time line, like America/Chicago) with a local start like 2026-11-13T18:00.';
const RATE_LIMITS = ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'calendarUsageLimitsExceeded', 'dailyLimitExceeded', 'RATE_LIMIT_EXCEEDED'];

/** The start or end of an event: its calendar date, the instant it names (midnight UTC for a date) and what Google is sent. */
interface When { date: string; instant: string; google: { date?: string; dateTime?: string; timeZone?: string } }
/** A validated event: what Google is sent and the words the answer and the duplicate refusal use. */
export interface GoogleEvent { google: any; title: string; allDay: boolean; zone: string | null; start: When; end: When; rule: string | null; repeat: string | null }
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** A real calendar date ('2026-02-30' is refused). */
function realDay(text: string): boolean {
  const at = new Date(`${text}T00:00:00.000Z`);
  return DAY.test(text) && !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === text;
}
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();
/** A date in the words people read: 'Fri, Nov 13, 2026'. */
export function dayWords(date: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00.000Z`));
}

/**
 * @description One time of the event. A date is all day. A date-time without an offset is the person's wall-clock time in their
 * zone (Google keeps the zone, so a weekly series stays at 6 PM across a daylight-saving change); one with its own offset names
 * its instant. Without either the clock time is unknown here, and guessing would put the event at the wrong hour.
 * @param text - The start or end as sent.
 * @param zone - The person's valid IANA zone, or null.
 * @param allDay - Whether the event is all day (decided by the start).
 * @returns The time, or null when it is not a real date or time of the event's kind.
 */
function when(text: string, zone: string | null, allDay: boolean): When | null {
  if (allDay) return realDay(text) ? { date: text, instant: `${text}T00:00:00.000Z`, google: { date: text } } : null;
  const wall = WALL.exec(text);
  if (wall) {
    const seconds = `${wall[1]}T${wall[2]}:${wall[3]}:${wall[4] || '00'}`;
    const instant = zone && realDay(wall[1]) ? wallToInstant(seconds, zone) : null;
    return instant ? { date: wall[1], instant, google: { dateTime: seconds, timeZone: zone as string } } : null;
  }
  const own = WITH_OFFSET.exec(text);
  const at = own && realDay(own[1]) ? Date.parse(text) : NaN;
  if (!Number.isFinite(at)) return null;
  return { date: own![1], instant: new Date(at).toISOString(), google: zone ? { dateTime: text, timeZone: zone } : { dateTime: text } };
}

/**
 * @description The end Google is sent. A date-only end is the LAST day the event covers (Google's end date is the day after it);
 * a timed end is the same form as the start. Without an end a timed event lasts one hour and an all-day one its day.
 * @param body - The request body.
 * @param start - The parsed start.
 * @param zone - The person's zone, or null.
 * @param allDay - Whether the event is all day.
 * @returns The end, or the refusal.
 */
function endOf(body: any, start: When, zone: string | null, allDay: boolean): Parsed<When> {
  const text = typeof body?.end === 'string' ? body.end.trim() : '';
  if (!text && allDay) return { ok: true, value: { ...start, google: { date: addDays(start.date, 1) } } };
  if (!text) {
    const instant = new Date(Date.parse(start.instant) + HOUR).toISOString();
    const shifted = start.google.timeZone && WALL.test(String(start.google.dateTime))
      ? new Date(Date.parse(`${start.google.dateTime}Z`) + HOUR).toISOString().slice(0, 19) : instant;
    return { ok: true, value: { date: instant.slice(0, 10), instant, google: { ...start.google, dateTime: shifted } } };
  }
  const end = when(text, zone, allDay);
  if (!end) return fail(allDay ? 'An all-day end is the last date it covers, like 2026-11-22.' : 'An end time is the same form as the start, like 2026-11-13T19:00 with the timeZone.');
  if (Date.parse(end.instant) < Date.parse(start.instant)) return fail('The end is before the start.');
  return { ok: true, value: allDay ? { ...end, google: { date: addDays(end.date, 1) } } : end };
}

/** The weekday names a weekly series repeats on, in the person's words, or the refusal. */
function weekdaysOf(raw: unknown): Parsed<number[]> {
  if (!Array.isArray(raw) || !raw.length || raw.length > 7) return fail('"on" lists the weekdays it repeats on, like ["Friday"].');
  const days: number[] = [];
  for (const name of raw) {
    const at = WEEKDAYS.findIndex((day) => typeof name === 'string' && day.toLowerCase() === name.trim().toLowerCase());
    if (at < 0) return fail('"on" lists weekdays by name: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday or Sunday.');
    if (!days.includes(at)) days.push(at);
  }
  return { ok: true, value: days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) };
}

/** Days named in words ('Monday and Wednesday', 'Monday or Wednesday'). */
const named = (days: number[], joiner: string) => days.map((day) => WEEKDAYS[day]).join(` ${joiner} `);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** How the series repeats in words: 'every Friday', 'every month on the 13th'. */
function cadence(every: string, days: number[], start: When): string {
  if (every === 'day') return 'every day';
  if (every === 'week') return `every ${named(days.length ? days : [weekday(start.date)], 'and')}`;
  if (every === 'month') return `every month on the ${ordinal(Number(start.date.slice(8, 10)))}`;
  return `every year on ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${start.date}T00:00:00.000Z`))}`;
}

/**
 * @description How the series ends: after a number of times (the first included) or on a last date, never both and never open.
 * A last date is the end of that local day in the event's zone, in UTC, as RFC 5545 requires beside a zoned start.
 * @param raw - The repeat block.
 * @param start - The parsed start.
 * @param zone - The event's zone (required for a timed series), or null for an all-day one.
 * @returns The RRULE ending and its words, or the refusal.
 */
function endingOf(raw: any, start: When, zone: string | null): Parsed<{ part: string; words: string }> {
  const hasTimes = raw.times != null, hasUntil = raw.until != null;
  if (hasTimes && hasUntil) return fail('A repeating event ends with either "times" or "until", not both.');
  if (!hasTimes && !hasUntil) return fail('A repeating event needs how many times it happens ("times") or its last date ("until"); ask the person which.');
  if (hasTimes) {
    if (!Number.isInteger(raw.times) || raw.times < 2 || raw.times > MAX_TIMES) return fail(`"times" is a whole number from 2 to ${MAX_TIMES}: how many times it happens, the first included.`);
    return { ok: true, value: { part: `COUNT=${raw.times}`, words: `${raw.times} times` } };
  }
  const until = typeof raw.until === 'string' ? raw.until.trim() : '';
  if (!realDay(until)) return fail('"until" is the last date it may happen, like 2027-04-02.');
  if (until < start.date) return fail('The last date is before its first.');
  if (until > addDays(start.date, MAX_SPAN_DAYS)) return fail('The last date is more than ten years after the first.');
  const stamp = zone ? (wallToInstant(`${until}T23:59:59`, zone) as string).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') : until.replace(/-/g, '');
  return { ok: true, value: { part: `UNTIL=${stamp}`, words: `until ${dayWords(until)}` } };
}

/**
 * @description The repeat rule of a series, or null for a single event. A weekly series repeats on the named weekdays (the start's
 * own weekday when none is named), and its first date must be one of them: otherwise the answer names the first matching date.
 * @param raw - The request's repeat block, or nothing.
 * @param start - The parsed start.
 * @param zone - The event's zone, or null.
 * @param allDay - Whether the event is all day.
 * @returns The RRULE line and its words, or the refusal.
 */
function repeatOf(raw: any, start: When, zone: string | null, allDay: boolean): Parsed<{ rule: string; words: string } | null> {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return fail('"repeat" says how the event repeats, like {"every":"week","on":["Friday"],"times":20}.');
  if (!(raw.every in FREQ)) return fail('"every" is day, week, month or year.');
  if (!allDay && !zone) return fail('A repeating event at a time needs its time zone: send "timeZone" (the IANA zone named on the Current time line, like America/Chicago).');
  if (raw.on != null && raw.every !== 'week') return fail('"on" names weekdays of a weekly series only.');
  let days: number[] = [];
  if (raw.on != null) {
    const parsed = weekdaysOf(raw.on);
    if (!parsed.ok) return parsed;
    days = parsed.value;
    if (!days.includes(weekday(start.date))) {
      let first = start.date;
      while (!days.includes(weekday(first))) first = addDays(first, 1);
      return fail(`The first date, ${dayWords(start.date)}, is not a ${named(days, 'or')}. The first ${named(days, 'or')} on or after it is ${dayWords(first)}.`);
    }
  }
  const ending = endingOf(raw, start, zone);
  if (!ending.ok) return ending;
  const byDay = days.length ? `;BYDAY=${days.map((day) => CODES[day]).join(',')}` : '';
  return { ok: true, value: { rule: `RRULE:FREQ=${FREQ[raw.every]}${byDay};${ending.value.part}`, words: `${cadence(raw.every, days, start)}, ${ending.value.words}` } };
}

/** Optional text bounded to its length, null when absent, undefined when it is not such text. */
function bounded(value: unknown, max: number): string | null | undefined {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length <= max ? text || null : undefined;
}

/**
 * @description Validate a new Google event exactly as the route sends it, and give it the id Google refuses a second time.
 * @param body - { title, start, end?, timeZone?, location?, notes?, repeat? }.
 * @param sub - The verified caller, part of the event's id.
 * @returns The event, or the refusal the person reads.
 */
export function parseGoogleEvent(body: any, sub: string): Parsed<GoogleEvent> {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 120) return fail('A title of 1 to 120 characters is required.');
  const zone = validZone(body?.timeZone);
  if (body?.timeZone != null && body.timeZone !== '' && !zone) return fail('timeZone must be an IANA time zone such as America/Chicago.');
  const text = typeof body?.start === 'string' ? body.start.trim() : '';
  const allDay = DAY.test(text);
  const start = when(text, zone, allDay);
  if (!start) return fail(allDay ? 'An all-day start is a date like 2026-11-20.' : hasOffset(text) ? 'The start is not a real date and time.' : NEEDS_ZONE);
  const end = endOf(body, start, zone, allDay);
  if (!end.ok) return end;
  const repeat = repeatOf(body?.repeat, start, zone, allDay);
  if (!repeat.ok) return repeat;
  const location = bounded(body?.location, 200), notes = bounded(body?.notes, 2000);
  if (location === undefined) return fail('A location is text of at most 200 characters.');
  if (notes === undefined) return fail('Notes are text of at most 2000 characters.');
  const rule = repeat.value ? repeat.value.rule : null;
  const id = `oshal${createHash('sha256').update([sub, title, allDay ? start.date : start.instant, rule || ''].join('\n')).digest('hex').slice(0, 40)}`;
  const google: any = { id, summary: title, start: start.google, end: end.value.google };
  if (location) google.location = location;
  if (notes) google.description = notes;
  if (rule) google.recurrence = [rule];
  return { ok: true, value: { google, title, allDay, zone, start, end: end.value, rule, repeat: repeat.value ? repeat.value.words : null } };
}

/** The legacy framework's brokered Google token for this caller (outside the native kernel only). */
async function legacyToken(ctx: AppContext, sub: string): Promise<string | null> {
  const { getValidAccessToken } = require('@/app/routes/connectors-routes') as typeof import('@/app/routes/connectors-routes');
  return getValidAccessToken(ctx.pool, sub, 'google');
}

type Sent = { refused: string } | { status: number; data: any };

/**
 * @description One Calendar API request. Under the native kernel it carries no Authorization header: the kernel's egress applies
 * the caller's own google-calendar grant and refuses, before anything is sent, when the caller has none or it cannot be renewed.
 * @param ctx - The application context (the legacy token broker's pool).
 * @param sub - The verified caller.
 * @param method - GET, POST or PUT.
 * @param url - The Calendar API address.
 * @param payload - The event, for a write.
 * @returns Google's status and body, or the words for a missing connection.
 */
async function send(ctx: AppContext, sub: string, method: string, url: string, payload?: any): Promise<Sent> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (payload) headers['content-type'] = 'application/json';
  if (process.env.OSHAL_EGRESS !== 'kernel') {
    const token = await legacyToken(ctx, sub);
    if (!token) return { refused: NOT_CONNECTED };
    headers.authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(url, payload ? { method, headers, body: JSON.stringify(payload) } : { method, headers });
  } catch (err) {
    const message = String((err as Error)?.message || '');
    if (/not connected/i.test(message)) return { refused: NOT_CONNECTED };
    if (/renew|reconnect/i.test(message)) return { refused: RECONNECT };
    throw err;
  }
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/** What a refused Google answer means for the person, in words; Google's own detail is passed on only for a 400. */
function refusal(status: number, data: any): { status: number; body: any } {
  const error = data?.error || {};
  const reasons = [...(Array.isArray(error.errors) ? error.errors : []), ...(Array.isArray(error.details) ? error.details : [])].map((e: any) => String(e?.reason || ''));
  if (status === 401) return { status: 409, body: { error: RECONNECT } };
  if (status === 403 || status === 429) return reasons.some((r) => RATE_LIMITS.includes(r)) || status === 429 ? { status: 503, body: { error: LIMITED } } : { status: 409, body: { error: READ_ONLY } };
  if (status === 400) {
    const said = String(error.message || 'the event is not valid').replace(/[.\s]+$/, '').slice(0, 200);
    return { status: 400, body: { error: `Google Calendar refused the event: ${said}. Nothing was added.` } };
  }
  return { status: 502, body: { error: FAILED } };
}

/** The saved event as the answer shows it, in the person's words. */
function shown(event: GoogleEvent, id: string) {
  const start = event.allDay ? event.start.date : event.start.instant;
  return { id, title: event.title, start, end: event.allDay ? event.end.date : event.end.instant, allDay: event.allDay, timeZone: event.zone,
    local: localLabel(start, event.allDay, event.zone || offsetOf(String(event.start.google.dateTime || ''))), repeat: event.repeat,
    location: event.google.location || null, calendar: 'primary' };
}
const link = (value: unknown) => (typeof value === 'string' && /^https:\/\/(www\.)?google\.com\/calendar\//.test(value) ? value : null);

/** The answer for an event Google now holds. */
function added(event: GoogleEvent, data: any): { status: number; body: any } {
  const where = event.repeat ? `Added to your primary Google Calendar as one repeating series: ${event.repeat}, from ${dayWords(event.start.date)}.` : 'Added to your primary Google Calendar.';
  log.info({ repeating: Boolean(event.rule) }, 'Google Calendar event added');
  return { status: 201, body: { ok: true, event: shown(event, String(data?.id || event.google.id)), url: link(data?.htmlLink), where } };
}

/**
 * @description Google already holds an event with this id: the same event approved again (refused, nothing added) or one the
 * person removed in Google (restored, since they asked for it again).
 * @param ctx - The application context.
 * @param sub - The verified caller.
 * @param event - The validated event.
 * @returns The HTTP status and body to answer.
 */
async function existing(ctx: AppContext, sub: string, event: GoogleEvent): Promise<{ status: number; body: any }> {
  const url = `${EVENTS}/${event.google.id}`;
  const held = await send(ctx, sub, 'GET', url);
  if ('refused' in held) return { status: 409, body: { error: held.refused } };
  if (held.status !== 200) return refusal(held.status, held.data);
  if (held.data?.status === 'cancelled') {
    const restored = await send(ctx, sub, 'PUT', url, { ...event.google, status: 'confirmed' });
    if ('refused' in restored) return { status: 409, body: { error: restored.refused } };
    return restored.status === 200 ? added(event, restored.data) : refusal(restored.status, restored.data);
  }
  const saved = shown(event, event.google.id);
  return { status: 409, body: { error: `"${event.title}" ${event.repeat ? 'from' : 'on'} ${saved.local} is already on your Google Calendar; nothing was added.`,
    duplicate: true, event: saved, url: link(held.data?.htmlLink) } };
}

/**
 * @description Add one approved event or series to the caller's primary Google Calendar.
 * @param ctx - The application context.
 * @param sub - The verified caller.
 * @param body - The request body.
 * @returns The HTTP status and body to answer.
 */
async function addEvent(ctx: AppContext, sub: string, body: any): Promise<{ status: number; body: any }> {
  if (body?.confirm !== true) return { status: 400, body: { error: 'Confirm adding the event' } };
  const parsed = parseGoogleEvent(body, sub);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const sent = await send(ctx, sub, 'POST', EVENTS, parsed.value.google);
  if ('refused' in sent) return { status: 409, body: { error: sent.refused } };
  if (sent.status === 200 || sent.status === 201) return added(parsed.value, sent.data);
  if (sent.status === 409) return existing(ctx, sub, parsed.value);
  return refusal(sent.status, sent.data);
}

/** The verified caller, or null after answering 401. */
function caller(req: any, res: any): string | null {
  const o = req.oidc, sub = o?.user?.sub;
  if (!sub || o?.isAuthenticated?.() !== true) {
    res.status(401).json({ error: 'not_authenticated' });
    return null;
  }
  return String(sub);
}

/** Mounted at /api/calendar/google-events: the caller's own primary Google Calendar, written only on an approved card. */
export function createGoogleEventsRoutes(ctx: AppContext) {
  const r = Router();
  r.post('/', async (req, res) => {
    const sub = caller(req, res);
    if (!sub) return;
    try {
      const out = await addEvent(ctx, sub, req.body);
      res.status(out.status).json(out.body);
    } catch (err) {
      log.error({ err }, 'Google Calendar add failed');
      res.status(502).json({ error: FAILED });
    }
  });
  return r;
}
