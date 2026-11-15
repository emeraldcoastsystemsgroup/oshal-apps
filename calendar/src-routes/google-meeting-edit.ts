/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | How one change to a meeting on the person's Google Calendar is worked out before it is sent
 *   (Roger, 2026-11-14: "can't cancel or modify existing meeting"). A meeting is named to the assistant and the cards by one
 *   revision that holds its event id and Google's etag (and its series' etag), so a meeting changed elsewhere after it was read
 *   is refused, never overwritten. Only the named fields are sent. A new start without an end keeps the meeting's length. The
 *   whole series moves by as far as the named occurrence moves, in the series' own clock, and its weekdays and last date move
 *   with it; a rule this app cannot move to another day (a monthly "second Tuesday", dates added or left out by hand) is
 *   refused in words. Guests are added or removed by address; the person and the organizer are never removed.
 */
/** One change to a Google Calendar meeting, worked out before anything is sent. */
import { localLabel, validZone } from './event-time';
import { addDays, when } from './google-events';
import { ChangeAsk, Changed, moment, momentWords, Parsed, sameText } from './meeting-change';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const TOKEN = /^g\.([A-Za-z0-9_]{1,1024})\.([A-Za-z0-9]{1,200})(?:\.([A-Za-z0-9]{1,200}))?$/;
const CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOUR = 3_600_000;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
/** A rule this app cannot move to another day. */
const RULE_DAYS = 'This series repeats by a rule this app cannot move to another day (like the second Tuesday of a month). Nothing was changed. Change this one only, or move the series in Google Calendar itself.';
/** A series with dates added or left out by hand. */
const HAND_DATES = 'This series has dates added or left out by hand, so its time is changed in Google Calendar itself. Nothing was changed. You can change this one only.';

/** A Google start or end: a date, or a date-time with an offset or a zone. */
export interface GTime { date?: string; dateTime?: string; timeZone?: string }
/** The new times of one meeting: what Google is sent and the moments they name. */
export interface Times { start: GTime; end: GTime; startAt: { day: string } | { at: number }; endAt: { day: string } | { at: number } }
/** A meeting's event id and the etags it was read with. */
export interface Token { id: string; etag: string; parentEtag: string | null }

/** An etag as the revision carries it: Google's quoted digits without quotes or a weak mark. */
const bare = (etag: unknown) => String(etag || '').replace(/^W\//, '').replace(/[^A-Za-z0-9]/g, '');
/** The revision the assistant and the cards name a meeting by: its id, its etag, and its series' etag when it repeats. */
export function tokenOf(event: any, parent: any | null): string {
  return `g.${event.id}.${bare(event.etag) || '0'}${parent ? `.${bare(parent.etag) || '0'}` : ''}`;
}
/** A revision read back, or null when it is not one. */
export function readToken(text: unknown): Token | null {
  const m = typeof text === 'string' ? TOKEN.exec(text.trim()) : null;
  return m ? { id: m[1], etag: m[2], parentEtag: m[3] || null } : null;
}
/** Whether an event is still the version a revision was read from. */
export const sameEtag = (event: any, etag: string | null) => etag != null && bare(event?.etag) === etag;

/** A Google start or end as a moment: its day, or its instant. */
export function eventMoment(time: GTime | undefined): { day: string } | { at: number } | null {
  if (time?.date && !time.dateTime) return { day: time.date };
  const at = Date.parse(String(time?.dateTime || ''));
  return Number.isFinite(at) ? { at } : null;
}

/** The wall-clock time of an instant in a zone: 'YYYY-MM-DDTHH:mm:ss'. */
export function wallIn(at: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at));
  const p = (type: string) => parts.find((x) => x.type === type)?.value || '00';
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour') === '24' ? '00' : p('hour')}:${p('minute')}:${p('second')}`;
}
const plusWall = (wall: string, ms: number) => new Date(Date.parse(`${wall.length === 16 ? `${wall}:00` : wall}Z`) + ms).toISOString().slice(0, 19);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
/** The last day an all-day Google end covers (Google's end date is the day after it). */
const lastDay = (time: GTime | undefined) => (time?.date ? addDays(time.date, -1) : '');

/** Whether the person organizes this meeting. */
export const organizes = (event: any) => event?.organizer?.self === true || (!event?.organizer && event?.creator?.self !== false);
/** The meeting's guests other than the person and its rooms. */
export const othersOf = (event: any): any[] => (Array.isArray(event?.attendees) ? event.attendees : []).filter((a: any) => a && !a.self && !a.resource && !(a.organizer && organizes(event) && a.self));
const ANSWERS: Record<string, string> = { accepted: 'yes', declined: 'no', tentative: 'maybe', needsAction: 'not answered' };

/** How a series repeats, in words, from its rule: 'every week on Tuesday', or 'repeats'. */
export function repeatWords(recurrence: unknown): string | null {
  const line = (Array.isArray(recurrence) ? recurrence : []).find((l: any) => /^RRULE:/i.test(String(l)));
  if (!line) return null;
  const parts = Object.fromEntries(String(line).slice(6).split(';').map((kv) => kv.split('=')));
  const every: Record<string, string> = { DAILY: 'every day', WEEKLY: 'every week', MONTHLY: 'every month', YEARLY: 'every year' };
  const days = String(parts.BYDAY || '').split(',').map((code) => NAMES[CODES.indexOf(code)]).filter(Boolean);
  return `${every[parts.FREQ] || 'repeats'}${days.length && parts.FREQ === 'WEEKLY' ? ` on ${days.join(' and ')}` : ''}`;
}

/**
 * @description A Google meeting as the assistant and the screen read it: its revision, title, times (an all-day end is the last
 * day it covers), the start in words in its own zone, place, notes, guests with their answers, whether the person organizes it,
 * and how it repeats.
 * @param e - The event (an occurrence of a series, a single event, or a series).
 * @param parent - The series an occurrence belongs to, or null.
 * @param fallbackZone - The person's zone, for an event that names none.
 * @returns The meeting.
 */
export function meetingView(e: any, parent: any | null, fallbackZone: string | null) {
  const allDay = Boolean(e?.start?.date && !e?.start?.dateTime);
  const zone = validZone(e?.start?.timeZone) || validZone(parent?.start?.timeZone) || fallbackZone;
  const start = allDay ? e.start.date : String(e?.start?.dateTime || ''), end = allDay ? lastDay(e?.end) : String(e?.end?.dateTime || '');
  const guests = othersOf(e).map((a: any) => ({ name: String(a.displayName || a.email || ''), email: String(a.email || '').toLowerCase(), answer: ANSWERS[a.responseStatus] || 'not answered' }));
  const mine = organizes(e), notes = typeof e?.description === 'string' ? e.description.slice(0, 500) : null;
  return { source: 'google', revision: tokenOf(e, parent), title: String(e?.summary || '(untitled)').slice(0, 120), start, end, allDay, timeZone: zone,
    local: localLabel(allDay ? start : new Date(Date.parse(start)).toISOString(), allDay, zone), location: e?.location || null, notes, guests,
    you: mine ? 'organizer' : 'invited', organizer: mine ? null : String(e?.organizer?.displayName || e?.organizer?.email || 'its organizer'),
    canChange: mine || e?.guestsCanModify === true, repeating: repeatWords(parent?.recurrence || e?.recurrence), url: typeof e?.htmlLink === 'string' ? e.htmlLink : null };
}

/** The meeting's current start, end, place and notes in the forms a card names them in (for namedMismatch). */
export function heldNow(e: any, zone: string | null) {
  const end = e?.end?.date && !e?.end?.dateTime ? { day: lastDay(e.end) } : eventMoment(e?.end);
  return { title: String(e?.summary || ''), start: eventMoment(e?.start), zone: validZone(e?.start?.timeZone) || zone, end, location: String(e?.location || ''), notes: String(e?.description || '') };
}

/** The start a meeting keeps when only its end changes, in the form CAL1's parser gives. */
function keptStart(e: any): { date: string; instant: string; google: GTime } {
  if (e.start?.date && !e.start?.dateTime) return { date: e.start.date, instant: `${e.start.date}T00:00:00.000Z`, google: { date: e.start.date } };
  const google: GTime = e.start.timeZone ? { dateTime: e.start.dateTime, timeZone: e.start.timeZone } : { dateTime: e.start.dateTime };
  return { date: String(e.start.dateTime).slice(0, 10), instant: new Date(Date.parse(e.start.dateTime)).toISOString(), google };
}

/** The end that keeps the meeting's length after a new start, or the default length when its kind changed. */
function keptEnd(e: any, start: { date: string; instant: string; google: GTime }, allDay: boolean): GTime {
  const wasAllDay = Boolean(e.start?.date && !e.start?.dateTime);
  if (allDay) return { date: addDays(start.date, wasAllDay ? Math.max(1, dayDiff(e.end?.date || start.date, e.start.date)) : 1) };
  const length = wasAllDay ? HOUR : Math.max(0, Date.parse(e.end?.dateTime) - Date.parse(e.start?.dateTime)) || HOUR;
  if (start.google.timeZone && WALL.test(String(start.google.dateTime))) return { dateTime: plusWall(String(start.google.dateTime), length), timeZone: start.google.timeZone };
  return { ...(start.google.timeZone ? { timeZone: start.google.timeZone } : {}), dateTime: new Date(Date.parse(start.instant) + length).toISOString() };
}

/**
 * @description The new start and end Google is sent for one meeting, or null when the card changes no time. A wall time is read
 * in the card's zone, else the meeting's own; a new start without an end keeps the meeting's length; a new start in the past
 * is refused.
 * @param e - The meeting as Google holds it now.
 * @param ask - The change card.
 * @param now - The clock.
 * @returns The times, null, or the refusal.
 */
export function newTimes(e: any, ask: ChangeAsk, now: number): Parsed<Times | null> {
  if (ask.newStart === undefined && ask.newEnd === undefined) return { ok: true, value: null };
  const zone = ask.zone || validZone(e?.start?.timeZone);
  const allDay = ask.newStart !== undefined ? DAY.test(ask.newStart) : Boolean(e.start?.date && !e.start?.dateTime);
  const start = ask.newStart !== undefined ? when(ask.newStart, zone, allDay) : keptStart(e);
  if (!start) return fail(allDay ? 'A new all-day start is a date like 2026-11-20.' : 'A new start is a local date and time like 2026-11-20T14:00 with the timeZone (the IANA zone named on the Current time line).');
  let end: GTime;
  if (ask.newEnd !== undefined) {
    const parsed = when(ask.newEnd, zone, allDay);
    if (!parsed) return fail(allDay ? 'A new all-day end is the last date it covers, like 2026-11-22.' : 'A new end is the same form as the start, like 2026-11-20T15:00 with the timeZone.');
    end = allDay ? { date: addDays(parsed.date, 1) } : parsed.google;
  } else end = keptEnd(e, start, allDay);
  const startAt: { day: string } | { at: number } = allDay ? { day: start.date } : { at: Date.parse(start.instant) };
  const endAt = allDay ? { day: addDays(String(end.date), -1) } : moment(String(end.dateTime), end.timeZone || zone);
  if (!endAt) return fail('A new end is the same form as the start.');
  if ('day' in startAt ? (endAt as any).day < startAt.day : (endAt as any).at < startAt.at) return fail('The new end is before the start. Nothing was changed.');
  const past = 'day' in startAt ? startAt.day < wallIn(now, zone || 'UTC').slice(0, 10) : startAt.at < now;
  if (ask.newStart !== undefined && past) return fail(`That time has already passed (${momentWords(startAt, zone)}). Nothing was changed. Ask for a time still ahead.`);
  return { ok: true, value: { start: start.google, end, startAt, endAt } };
}

/** A rule's last date moved by whole days, keeping its time part ('20270403T045959Z'). */
function shiftUntil(value: string, days: number): string {
  const m = /^(\d{4})(\d{2})(\d{2})(T\d{6}Z?)?$/.exec(value);
  if (!m) return value;
  return `${addDays(`${m[1]}-${m[2]}-${m[3]}`, days).replace(/-/g, '')}${m[4] || ''}`;
}

/**
 * @description A series' rule moved by whole days: its weekdays and its last date move with its start. Dates added or left
 * out by hand, and day rules other than plain weekdays, are refused when the series moves at all.
 * @param lines - The series' recurrence lines.
 * @param days - Whole days the series moves (negative for earlier).
 * @param moved - Whether the series' time or day changes.
 * @returns The new lines, or the refusal.
 */
export function shiftRule(lines: string[], days: number, moved: boolean): Parsed<string[]> {
  if (!moved) return { ok: true, value: lines };
  if (lines.some((line) => !/^RRULE:/i.test(line))) return fail(HAND_DATES);
  if (!days) return { ok: true, value: lines };
  const out: string[] = [];
  for (const line of lines) {
    const parts = line.slice(6).split(';').map((kv) => kv.split('='));
    if (parts.some(([key]) => /^BY(MONTHDAY|YEARDAY|WEEKNO|SETPOS|MONTH)$/i.test(key))) return fail(RULE_DAYS);
    const next: string[] = [];
    for (const [key, value] of parts) {
      if (key === 'BYDAY') {
        const codes = value.split(',');
        if (codes.some((code) => !CODES.includes(code))) return fail(RULE_DAYS);
        next.push(`BYDAY=${codes.map((code) => CODES[(((CODES.indexOf(code) + days) % 7) + 7) % 7]).join(',')}`);
      } else next.push(key === 'UNTIL' ? `UNTIL=${shiftUntil(value, days)}` : `${key}=${value}`);
    }
    out.push(`RRULE:${next.join(';')}`);
  }
  return { ok: true, value: out };
}

/**
 * @description The series' new start, end and rule: it moves by as far as the named occurrence moves, in the series' own clock.
 * @param parent - The series as Google holds it now.
 * @param occurrence - The occurrence the card named.
 * @param times - That occurrence's new times.
 * @returns What the series is sent, or the refusal.
 */
export function seriesTimes(parent: any, occurrence: any, times: Times): Parsed<{ start: GTime; end: GTime; recurrence: string[] }> {
  const allDay = Boolean(parent.start?.date && !parent.start?.dateTime);
  if (allDay !== 'day' in times.startAt) return fail('A whole series keeps being all-day or at a time. Nothing was changed. Change this one only, or change the series in Google Calendar itself.');
  const lines: string[] = Array.isArray(parent.recurrence) ? parent.recurrence.map(String) : [];
  if (allDay) {
    const was = String(occurrence.originalStartTime?.date || occurrence.start?.date), now = (times.startAt as { day: string }).day;
    const days = dayDiff(now, was), length = dayDiff(addDays(String(times.end.date), 0), now);
    const rule = shiftRule(lines, days, days !== 0);
    if (!rule.ok) return rule;
    const first = addDays(parent.start.date, days);
    return { ok: true, value: { start: { date: first }, end: { date: addDays(first, Math.max(1, length)) }, recurrence: rule.value } };
  }
  const zone = validZone(parent.start?.timeZone) || validZone(occurrence.start?.timeZone) || 'UTC';
  const was = wallIn(Date.parse(occurrence.originalStartTime?.dateTime || occurrence.start?.dateTime), zone);
  const now = wallIn((times.startAt as { at: number }).at, zone), length = (times.endAt as { at: number }).at - (times.startAt as { at: number }).at;
  const shift = Date.parse(`${now}Z`) - Date.parse(`${was}Z`), days = dayDiff(now.slice(0, 10), was.slice(0, 10));
  const rule = shiftRule(lines, days, shift !== 0);
  if (!rule.ok) return rule;
  const first = plusWall(wallIn(Date.parse(parent.start.dateTime), zone), shift);
  return { ok: true, value: { start: { dateTime: first, timeZone: zone }, end: { dateTime: plusWall(first, length), timeZone: zone }, recurrence: rule.value } };
}

/**
 * @description The guest list after the card's additions and removals, or null when it changes no guest. A guest to remove
 * must be on the meeting; the person and the organizer stay.
 * @param e - The meeting (or series) as Google holds it now.
 * @param ask - The change card.
 * @returns The whole attendee list Google is sent, null, or the refusal.
 */
export function attendeesAfter(e: any, ask: ChangeAsk): Parsed<any[] | null> {
  if (!ask.addGuests.length && !ask.removeGuests.length) return { ok: true, value: null };
  const list: any[] = (Array.isArray(e?.attendees) ? e.attendees : []).map((a: any) => ({ ...a }));
  for (const email of ask.removeGuests) {
    const at = list.findIndex((a) => String(a.email || '').toLowerCase() === email);
    if (at < 0) return fail(`${email} is not a guest of this meeting. Nothing was changed.`);
    if (list[at].self || list[at].organizer) return fail(`${email} ${list[at].self ? 'is you' : 'organizes this meeting'}, so it stays on it. Nothing was changed.`);
    list.splice(at, 1);
  }
  for (const email of ask.addGuests) if (!list.some((a) => String(a.email || '').toLowerCase() === email)) list.push({ email });
  return { ok: true, value: list };
}

/** Whether the meeting already holds every value the card asks for (a second Approve, or a change made elsewhere). */
export function alreadyHolds(e: any, ask: ChangeAsk, times: Times | null): boolean {
  const same = (a: any, b: any) => (a && b && 'day' in a && 'day' in b ? a.day === b.day : a && b && 'at' in a && 'at' in b && Math.abs(a.at - b.at) < 60_000);
  if (ask.newTitle !== undefined && !sameText(e?.summary, ask.newTitle)) return false;
  if (ask.newLocation !== undefined && !sameText(e?.location, ask.newLocation)) return false;
  if (ask.newNotes !== undefined && !sameText(e?.description, ask.newNotes)) return false;
  if (times && (!same(eventMoment(e?.start), times.startAt) || !same(heldNow(e, null).end, times.endAt))) return false;
  const emails = (Array.isArray(e?.attendees) ? e.attendees : []).map((a: any) => String(a.email || '').toLowerCase());
  return ask.addGuests.every((g) => emails.includes(g)) && ask.removeGuests.every((g) => !emails.includes(g));
}

/** Guests in words: 'Dana Reyes and Sam Ortiz', or ''. */
export function guestNames(list: any[]): string {
  const names = list.filter((a) => a && !a.self && !a.resource).map((a) => String(a.displayName || a.email));
  return names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * @description Each field the change replaces, before and after, in words.
 * @param e - The meeting as it was.
 * @param ask - The change card.
 * @param times - The new times, or null.
 * @param attendees - The new guest list, or null.
 * @param zone - The zone the times are said in.
 * @returns The changed fields.
 */
export function changesOf(e: any, ask: ChangeAsk, times: Times | null, attendees: any[] | null, zone: string | null): Changed[] {
  const out: Changed[] = [], clip = (v: unknown) => String(v ?? '').slice(0, 80);
  if (ask.newTitle !== undefined && !sameText(e.summary, ask.newTitle)) out.push({ field: 'Title', before: clip(e.summary), after: ask.newTitle });
  if (times) {
    out.push({ field: 'Starts', before: momentWords(eventMoment(e.start), zone), after: momentWords(times.startAt, zone) });
    const endWas = heldNow(e, zone).end;
    out.push({ field: 'Ends', before: momentWords(endWas, zone), after: momentWords(times.endAt, zone) });
  }
  if (ask.newLocation !== undefined && !sameText(e.location, ask.newLocation)) out.push({ field: 'Where', before: clip(e.location), after: clip(ask.newLocation) });
  if (ask.newNotes !== undefined && !sameText(e.description, ask.newNotes)) out.push({ field: 'Notes', before: clip(e.description), after: clip(ask.newNotes) });
  if (attendees) out.push({ field: 'Guests', before: guestNames(e.attendees || []), after: guestNames(attendees) });
  return out;
}

/** A time in the form a card sends it back in, to undo a change: the date, or the date-time with its offset. */
export function cardTime(time: GTime | undefined, end = false): string | undefined {
  if (!time) return undefined;
  if (time.date && !time.dateTime) return end ? lastDay(time) : time.date;
  return time.dateTime;
}
