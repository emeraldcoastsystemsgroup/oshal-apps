/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.5.0: the person's Google calendars read live, for every place Open Swarm shows their
 *   upcoming events (Roger, 2026-11-15: "I put a calendar event on my Google calendar and its not showing on the landing home ...
 *   i would think it would have a combination of calendars"). Home showed only the copy saved by the last press of Sync. Read
 *   here: the primary calendar, then up to nine more that the person shows in Google Calendar (the calendar list's selected
 *   calendars: family, shared, subscribed), one request each in the window, no paging and no retry, all inside one time budget
 *   (5 seconds). The kernel answers a package's requests one at a time, so the reads go one after another and none is started
 *   once the budget is spent; a calendar that did not answer is named, never silently dropped. A connection that may not list
 *   calendars (a grant without calendar.readonly) reads the primary calendar only and says so; no new permission is asked for.
 *   Nothing here writes: no snapshot, no row, no Google change.
 */
/** The person's Google calendars read live: the primary one, then the other calendars they show in Google Calendar. */
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { NOT_CONNECTED, send } from './google-events';
import { localLabel, offsetOf } from './event-time';
import { calendarRow, type CalendarRow } from './sync';

const log = createChildLogger({ module: 'calendar.google-live' });
const API = 'https://www.googleapis.com/calendar/v3';
/** The calendar list: every calendar the person has in Google Calendar, and whether they show it there. */
export const CALENDAR_LIST = `${API}/users/me/calendarList`;
/** How long one answer waits for Google in all, list and calendars together. */
export const LIVE_BUDGET_MS = 5000;
/** The most calendars one answer reads, the primary one included. */
export const MAX_CALENDARS = 10;
/** The most events read from one calendar, and kept in one answer. */
export const MAX_EVENTS = 250;
const READABLE = new Set(['owner', 'writer', 'reader']);
const RATE_LIMITS = ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'calendarUsageLimitsExceeded', 'dailyLimitExceeded', 'RATE_LIMIT_EXCEEDED'];

/** One event read live: the minimized row (title, times, link), the calendar it is on (null for primary) and its start in words. */
export interface LiveEvent extends CalendarRow { calendar: string | null; local: string }
/** One calendar to read: Google's id ('primary' for the primary one) and the name the person gave it. */
interface LiveCalendar { id: string; name: string; primary: boolean }
/** Why Google Calendar could not be read at all. */
export type GoogleDown = 'not-connected' | 'reconnect' | 'not-allowed' | 'no-answer';
/** What one live read found. */
export type GoogleLive =
  | { state: 'live'; readAt: string; events: LiveEvent[]; read: string[]; unread: string[]; listed: boolean; unlisted: 'not-allowed' | 'no-answer' | null; beyond: number; full: string[]; capped: boolean }
  | { state: GoogleDown; readAt: string };
type Late = 'late';
type Budget = { within: <T>(start: () => Promise<T>) => Promise<T | Late> };

/**
 * @description One deadline for every read of one answer. A read is started only while time is left, and one that has not
 * answered by the deadline is not waited for (the kernel's own egress limit still bounds a request already sent).
 * @param ms - The whole budget in milliseconds.
 * @returns The budget's guard.
 */
function budget(ms: number): Budget {
  const end = Date.now() + ms;
  return {
    async within<T>(start: () => Promise<T>): Promise<T | Late> {
      const left = end - Date.now();
      if (left <= 0) return 'late';
      const work = start();
      work.catch(() => undefined);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<Late>((resolve) => { timer = setTimeout(() => resolve('late'), left); });
      try { return await Promise.race([work, late]); } finally { clearTimeout(timer); }
    },
  };
}

/** Why a refused or failed Google answer leaves a calendar unread. */
function downOf(got: any): GoogleDown {
  if (got === 'late') return 'no-answer';
  if ('refused' in got) return got.refused === NOT_CONNECTED ? 'not-connected' : 'reconnect';
  if (got.status === 401) return 'reconnect';
  const error = got.data?.error || {};
  const reasons = [...(Array.isArray(error.errors) ? error.errors : []), ...(Array.isArray(error.details) ? error.details : [])].map((e: any) => String(e?.reason || ''));
  if (got.status === 403 && !reasons.some((r) => RATE_LIMITS.includes(r))) return 'not-allowed';
  return 'no-answer';
}

/** The calendars the person shows in Google Calendar, other than the primary one, from the list's one page. */
function shownCalendars(items: any[]): LiveCalendar[] {
  return items.filter((c) => c && typeof c.id === 'string' && c.primary !== true && c.selected === true && c.hidden !== true && c.deleted !== true && READABLE.has(c.accessRole))
    .map((c) => ({ id: c.id, name: String(c.summaryOverride || c.summary || c.id).slice(0, 80), primary: false }));
}

/**
 * @description Which calendars to read: the primary one first, then up to nine the person shows in Google Calendar. A list
 * Google refuses for this grant, or does not answer, leaves the primary one only, with the reason.
 * @returns The calendars and how the list answered, or why nothing can be read.
 */
async function calendarsToRead(ctx: AppContext, sub: string, b: Budget) {
  const got: any = await b.within(() => send(ctx, sub, 'GET', `${CALENDAR_LIST}?${new URLSearchParams({ minAccessRole: 'reader', maxResults: '50' })}`));
  const primary: LiveCalendar = { id: 'primary', name: 'primary', primary: true };
  if (got !== 'late' && 'status' in got && got.status === 200) {
    const others = shownCalendars(Array.isArray(got.data?.items) ? got.data.items : []);
    return { calendars: [primary, ...others.slice(0, MAX_CALENDARS - 1)], unlisted: null, beyond: Math.max(0, others.length - (MAX_CALENDARS - 1)) };
  }
  const down = downOf(got);
  if (got === 'late' || down === 'not-connected' || down === 'reconnect') return { down };
  return { calendars: [primary], unlisted: down === 'not-allowed' ? 'not-allowed' as const : 'no-answer' as const, beyond: 0 };
}

/** One calendar's events in the window, minimized, each with the calendar it is on and its start in words. */
async function eventsOf(ctx: AppContext, sub: string, cal: LiveCalendar, window: { timeMin: string; timeMax: string }, b: Budget) {
  const query = new URLSearchParams({ timeMin: window.timeMin, timeMax: window.timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: String(MAX_EVENTS) });
  const got: any = await b.within(() => send(ctx, sub, 'GET', `${API}/calendars/${encodeURIComponent(cal.id)}/events?${query}`));
  if (got === 'late' || 'refused' in got || got.status !== 200) return { ok: false as const, down: downOf(got) };
  const zone = typeof got.data?.timeZone === 'string' ? got.data.timeZone : null;
  const items = (Array.isArray(got.data?.items) ? got.data.items : []).filter((e: any) => e && e.status !== 'cancelled' && (e.start?.dateTime || e.start?.date));
  const rows = items.slice(0, MAX_EVENTS).map((e: any) => {
    const row = calendarRow(e), at = String(row.start);
    return { ...row, uid: String(e.iCalUID || row.id), calendar: cal.primary ? null : cal.name, local: localLabel(at, row.allDay, e.start?.timeZone || zone || offsetOf(at)) };
  });
  return { ok: true as const, rows, full: Boolean(got.data?.nextPageToken) };
}

/** Every calendar's events as one list by start, an event on two calendars once (the primary copy), at most MAX_EVENTS. */
function combined(rows: Array<LiveEvent & { uid: string }>): { events: LiveEvent[]; capped: boolean } {
  const seen = new Set<string>(), events: LiveEvent[] = [];
  for (const { uid, ...row } of rows) {
    const key = `${uid}|${row.start}`;
    if (!seen.has(key)) { seen.add(key); events.push(row); }
  }
  events.sort((a, b) => Date.parse(String(a.start)) - Date.parse(String(b.start)));
  return { events: events.slice(0, MAX_EVENTS), capped: events.length > MAX_EVENTS };
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
export async function readGoogleLive(ctx: AppContext, sub: string, window: { timeMin: string; timeMax: string }, budgetMs = LIVE_BUDGET_MS): Promise<GoogleLive> {
  const b = budget(budgetMs), readAt = new Date().toISOString();
  try {
    const plan: any = await calendarsToRead(ctx, sub, b);
    if (plan.down) return { state: plan.down, readAt };
    const rows: Array<LiveEvent & { uid: string }> = [], read: string[] = [], unread: string[] = [], full: string[] = [];
    for (const cal of plan.calendars as LiveCalendar[]) {
      const got = await eventsOf(ctx, sub, cal, window, b);
      if (!got.ok && cal.primary) return { state: got.down, readAt };
      if (!got.ok) { unread.push(cal.name); continue; }
      rows.push(...got.rows);
      if (!cal.primary) read.push(cal.name);
      if (got.full) full.push(cal.primary ? 'your primary calendar' : cal.name);
    }
    const { events, capped } = combined(rows);
    return { state: 'live', readAt, events, read, unread, listed: !plan.unlisted, unlisted: plan.unlisted, beyond: plan.beyond, full, capped };
  } catch (err) {
    log.error({ err }, 'Google Calendar could not be read live');
    return { state: 'no-answer', readAt };
  }
}

const CONNECTIONS = 'the Connections page (/utilities)';
/** What a person reads when Google Calendar was not read, by why. None of it asks them to sync. */
export const GOOGLE_NOTE: Record<GoogleDown, string> = {
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
export function savedAtWords(at: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(at);
}

/**
 * @description The note for the saved copy shown because Google did not answer.
 * @param syncedAt - When the copy was saved.
 * @returns The words.
 */
export function copyNote(syncedAt: Date): string {
  return `Showing your last synced copy from ${savedAtWords(syncedAt)}: Google did not answer.`;
}

/**
 * @description The line that says which calendars were read just now.
 * @param live - A live read.
 * @param also - Words to add after the calendars (', with the events added in Open Swarm'), or none.
 * @returns The sentence.
 */
export function readWords(live: Extract<GoogleLive, { state: 'live' }>, also = ''): string {
  const which = live.read.length ? `your primary calendar and ${namesInWords(live.read)}` : 'your primary calendar';
  return `Read from Google Calendar just now: ${which}${also}.`;
}

/**
 * @description Names in a sentence: 'Family', 'Family and Work', 'Family, Work and 2 more'.
 * @param names - The names.
 * @returns The words.
 */
export function namesInWords(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * @description What a live read could not cover, in the words a person reads after the line that says it was read.
 * @param live - A live read.
 * @returns The sentences, possibly none.
 */
export function liveGaps(live: Extract<GoogleLive, { state: 'live' }>): string[] {
  const out: string[] = [];
  if (live.unlisted === 'not-allowed') out.push('Your Google connection does not let Open Swarm list your other calendars, so only your primary calendar is shown.');
  if (live.unlisted === 'no-answer') out.push('Google did not list your other calendars just now, so only your primary calendar is shown.');
  if (live.unread.length) out.push(`${namesInWords(live.unread)} did not answer in time, so ${live.unread.length === 1 ? 'its' : 'their'} events are not shown.`);
  if (live.beyond) out.push(`${live.beyond} more of the calendars you show in Google Calendar ${live.beyond === 1 ? 'is' : 'are'} not read here; the first ${MAX_CALENDARS} are.`);
  if (live.full.length) out.push(`${namesInWords(live.full)} ${live.full.length === 1 ? 'has' : 'have'} more events than the ${MAX_EVENTS} read from each calendar; only the soonest are shown.`);
  else if (live.capped) out.push(`Only the soonest ${MAX_EVENTS} events are shown.`);
  return out;
}
