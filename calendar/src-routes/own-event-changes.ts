/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Change and remove an event the person added in OSHAL, and find their events by words in a
 *   window (calendar 1.4.0). Roger, 2026-11-14: "can't cancel or modify existing meeting". A change replaces only the fields its
 *   card names (title, start, end or length, place, notes) after checking that the card names this event as it is now, and the
 *   UPDATE is bound to the revision the card was read with, so a change made elsewhere meanwhile is refused, never overwritten. A
 *   new start without an end keeps the event's length; a new start in the past is refused; a series is refused in words (these
 *   are single events). The answer says each field before and after and carries the input that undoes it; a second Approve of
 *   the same change does nothing twice. A removal checks the title and start its card showed, answers with the event and carries
 *   the add that puts it back. Mounted through routes/meetings.js at /api/calendar/meetings/oshal/:id.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: the answers say "your Open Swarm calendar" and "Events added in Open Swarm" (Roger, 2026-11-13:
 *   what a person sees names the product Open Swarm; technical identifiers keep oshal, so the path /oshal/:id and the "source"
 *   value stay). Words only.
 */
/** Change, remove and find the events a person added in OSHAL. */
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { hasOffset, localLabel, offsetOf, validZone } from './event-time';
import { Changed, changedWords, momentWords, namedMismatch, parseChangeAsk, parseNamed } from './meeting-change';
import { COLUMNS, dayInstant, freshRevision, ORIGINAL, OwnEvent, ownEvent, timedInstant } from './own-events';

const log = createChildLogger({ module: 'calendar.own-event-changes' });
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What a change or removal says it did not do when the event is gone. */
const OWN_GONE = 'That event is no longer on your Open Swarm calendar. Nothing was changed.';
const OWN_STALE = 'This event changed after it was read. Nothing was changed. Ask again, and it is read fresh.';
const SINGLE_ONLY = 'Events added in Open Swarm are single events, so there is no series to change. Nothing was changed.';
const isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

/** One of the caller's own rows by id, or undefined. */
async function ownRow(ctx: AppContext, sub: string, id: string): Promise<any> {
  const q = await ctx.pool.query({ text: `SELECT ${COLUMNS} FROM calendar_own_events WHERE user_sub = $1 AND id = $2`, values: [sub, id], query_timeout: 1800 } as any);
  return q.rows[0];
}

/** The event's current times, place and notes in the forms a card names them in (for namedMismatch). */
function ownNow(event: OwnEvent) {
  const at = (value: string | null) => (value == null ? null : event.allDay ? { day: value.slice(0, 10) } : { at: Date.parse(value) });
  return { title: event.title, start: at(event.start), zone: event.timeZone && validZone(event.timeZone) ? event.timeZone : null, end: at(event.end), location: event.location || '', notes: event.notes || '' };
}

/** A new start or end of an own event, as its stored instant: a date is all day; a wall time is read in the card's zone, else the event's. */
function ownTime(text: string, allDay: boolean, zone: string | null): string | null {
  return allDay ? dayInstant(text.slice(0, 10)) : timedInstant(text, zone);
}

/**
 * @description The row after a change: only the fields the card names; a new start without an end keeps the event's length; a
 * new start in the past and an end before the start are refused.
 * @param row - The stored row.
 * @param ask - The change card.
 * @param now - The clock.
 * @returns The new column values, or the refusal.
 */
function mergeOwn(row: any, ask: any, now: number): { ok: true; value: any } | { ok: false; error: string } {
  const was = ownEvent(row), zone = ask.zone || validZone(row.time_zone);
  const allDay = ask.newStart !== undefined ? DAY.test(ask.newStart) : was.allDay;
  const startsAt = ask.newStart !== undefined ? ownTime(ask.newStart, allDay, zone) : new Date(row.starts_at).toISOString();
  if (!startsAt) return { ok: false, error: allDay ? 'A new all-day start is a date like 2026-11-20.' : 'A new start is a local date and time like 2026-11-20T14:00 with the timeZone (the IANA zone named on the Current time line).' };
  let endsAt: string | null = row.ends_at == null ? null : new Date(row.ends_at).toISOString();
  if (ask.newEnd !== undefined) {
    endsAt = ownTime(ask.newEnd, allDay, zone);
    if (!endsAt) return { ok: false, error: 'A new end is the same form as the start, like 2026-11-20T15:00 with the timeZone.' };
  } else if (ask.newStart !== undefined) {
    const length = endsAt && allDay === was.allDay ? Date.parse(endsAt) - Date.parse(new Date(row.starts_at).toISOString()) : null;
    endsAt = length == null ? null : new Date(Date.parse(startsAt) + length).toISOString();
  }
  if (endsAt && Date.parse(endsAt) < Date.parse(startsAt)) return { ok: false, error: 'The new end is before the start. Nothing was changed.' };
  const past = allDay ? startsAt.slice(0, 10) < new Date(now).toISOString().slice(0, 10) : Date.parse(startsAt) < now;
  if (ask.newStart !== undefined && past) return { ok: false, error: `That time has already passed (${momentWords(allDay ? { day: startsAt.slice(0, 10) } : { at: Date.parse(startsAt) }, zone)}). Nothing was changed. Ask for a time still ahead.` };
  const keptZone = allDay ? null : ask.newStart !== undefined ? (ask.zone || (hasOffset(ask.newStart) ? offsetOf(ask.newStart) : row.time_zone || null)) : row.time_zone || null;
  return { ok: true, value: { title: ask.newTitle ?? was.title, startsAt, endsAt, allDay, zone: keptZone,
    location: ask.newLocation !== undefined ? ask.newLocation || null : was.location, notes: ask.newNotes !== undefined ? ask.newNotes || null : was.notes } };
}

/** Each field a change replaces, before and after, in words. */
function ownChanges(was: OwnEvent, next: OwnEvent): Changed[] {
  const out: Changed[] = [];
  if (was.title !== next.title) out.push({ field: 'Title', before: was.title, after: next.title });
  if (was.start !== next.start || was.allDay !== next.allDay) out.push({ field: 'Starts', before: was.local, after: next.local });
  if (was.end !== next.end) out.push({ field: 'Ends', before: was.end ? localLabel(was.end, was.allDay, was.timeZone) : '', after: next.end ? localLabel(next.end, next.allDay, next.timeZone) : '' });
  if ((was.location || '') !== (next.location || '')) out.push({ field: 'Where', before: was.location || '', after: next.location || '' });
  if ((was.notes || '') !== (next.notes || '')) out.push({ field: 'Notes', before: (was.notes || '').slice(0, 80), after: (next.notes || '').slice(0, 80) });
  return out;
}

/** The input that puts a changed event back as it was (calendar-change-event, with the new revision). */
function ownUndo(was: OwnEvent, next: OwnEvent, changed: Changed[]): any {
  const fields = new Set(changed.map((c) => c.field));
  return { id: next.id, revision: next.revision, title: next.title, start: next.start, ...(next.timeZone && validZone(next.timeZone) ? { timeZone: next.timeZone } : {}),
    ...(fields.has('Title') ? { newTitle: was.title } : {}), ...(fields.has('Starts') || fields.has('Ends') ? { newStart: was.start, ...(was.end ? { newEnd: was.end } : {}) } : {}),
    ...(fields.has('Where') ? { newLocation: was.location || '' } : {}), ...(fields.has('Notes') ? { newNotes: was.notes || '' } : {}), confirm: true };
}

/** Whether the event already holds every value a change asks for (a second Approve, or the same change made on the screen). */
function ownAlready(was: OwnEvent, next: any): boolean {
  const iso = (v: string | null) => (v == null ? null : new Date(v).toISOString());
  const start = was.allDay ? `${was.start}T00:00:00.000Z` : was.start, end = was.end == null ? null : was.allDay ? `${was.end}T00:00:00.000Z` : was.end;
  return was.title === next.title && iso(start) === iso(next.startsAt) && iso(end) === iso(next.endsAt) && was.allDay === next.allDay
    && (was.location || null) === (next.location || null) && (was.notes || null) === (next.notes || null);
}

/**
 * @description Change one of the caller's own events: only the fields the card names, bound to the revision it was read with.
 * @param ctx - The application context (its pool).
 * @param sub - The verified caller.
 * @param id - The event id from the path.
 * @param body - The approved card or the screen's edit.
 * @param now - The clock.
 * @returns The HTTP status and body to answer.
 */
export async function changeOwnEvent(ctx: AppContext, sub: string, id: string, body: any, now = Date.now()): Promise<{ status: number; body: any }> {
  if (!isId(id)) return { status: 400, body: { error: 'An event id is required.' } };
  if (body?.appliesTo === 'The whole series') return { status: 400, body: { error: SINGLE_ONLY } };
  const ask = parseChangeAsk(body, false);
  if (!ask.ok) return { status: 400, body: { error: ask.error } };
  if (typeof body?.revision !== 'string' || !body.revision) return { status: 400, body: { error: 'The card does not name an event this app read. Nothing was changed. Ask again, and it is read fresh.' } };
  const row = await ownRow(ctx, sub, id);
  if (!row) return { status: 404, body: { error: OWN_GONE } };
  const was = ownEvent(row), merged = mergeOwn(row, ask.value, now);
  if (!merged.ok) return { status: 400, body: { error: merged.error } };
  if (ownAlready(was, merged.value)) return { status: 200, body: { ok: true, already: true, event: was, where: 'That change is already on your Open Swarm calendar. Nothing was changed again.' } };
  const mismatch = namedMismatch(ask.value, ownNow(was));
  if (mismatch) return { status: 409, body: { error: mismatch } };
  if (was.revision !== body.revision) return { status: 409, body: { error: OWN_STALE } };
  const v = merged.value, revision = freshRevision(), bound = was.revision === ORIGINAL ? 'revision IS NULL' : 'revision = $11';
  const values = [sub, id, v.title, v.startsAt, v.endsAt, v.allDay, v.zone, v.location, v.notes, revision, ...(was.revision === ORIGINAL ? [] : [was.revision])];
  const done = await ctx.pool.query(`UPDATE calendar_own_events SET title = $3, starts_at = $4, ends_at = $5, all_day = $6, time_zone = $7, location = $8, notes = $9, revision = $10 WHERE user_sub = $1 AND id = $2 AND ${bound}`, values);
  if (!done.rowCount) return { status: 409, body: { error: OWN_STALE } };
  const next = ownEvent({ ...row, title: v.title, starts_at: v.startsAt, ends_at: v.endsAt, all_day: v.allDay, time_zone: v.zone, location: v.location, notes: v.notes, revision });
  const changed = ownChanges(was, next);
  log.info({ fields: changed.length }, 'Own calendar event changed');
  return { status: 200, body: { ok: true, event: next, changed, where: `Changed on your Open Swarm calendar: ${changedWords(changed)}. To put it back, ask to undo it.`, undo: ownUndo(was, next, changed) } };
}

/**
 * @description Remove one of the caller's own events by id. A card that names the event by its title and start is held to
 * them, so it never removes another event; the answer names the event and carries the add that puts it back.
 * @param ctx - The application context (its pool).
 * @param sub - The verified caller.
 * @param id - The event id from the path.
 * @param body - The approved card (title and start optional) or nothing from the screen.
 * @returns The HTTP status and body to answer.
 */
export async function removeOwnEvent(ctx: AppContext, sub: string, id: string, body: any = {}): Promise<{ status: number; body: any }> {
  if (!isId(id)) return { status: 400, body: { error: 'An event id is required.' } };
  const row = await ownRow(ctx, sub, id);
  if (!row) return { status: 404, body: { error: 'No such event in your Open Swarm calendar.' } };
  const event = ownEvent(row);
  if (typeof body?.title === 'string' && typeof body?.start === 'string') {
    const named = parseNamed({ ...body, confirm: true });
    const mismatch = named.ok ? namedMismatch(named.value, ownNow(event)) : named.error;
    if (mismatch) return { status: 409, body: { error: mismatch.replace('Nothing was changed.', 'Nothing was removed.') } };
  }
  const gone = await ctx.pool.query('DELETE FROM calendar_own_events WHERE user_sub = $1 AND id = $2', [sub, id]);
  if (!gone.rowCount) return { status: 404, body: { error: 'No such event in your Open Swarm calendar.' } };
  const undo = { title: event.title, start: event.start, ...(event.end ? { end: event.end } : {}), ...(event.allDay ? { allDay: true } : {}),
    ...(event.timeZone && validZone(event.timeZone) ? { timeZone: event.timeZone } : {}), ...(event.location ? { location: event.location } : {}), ...(event.notes ? { notes: event.notes } : {}), confirm: true };
  return { status: 200, body: { ok: true, removed: id, event, where: 'Removed from your Open Swarm calendar. To put it back, ask to add it again.', undo } };
}

/**
 * @description The caller's own events that start in a window, matching every word in the title, place or notes, as the meeting
 * finder lists them (each with the id and revision a change card names it by).
 * @param ctx - The application context (its pool).
 * @param sub - The verified caller.
 * @param range - The window's instants and the words.
 * @returns At most 50 events, soonest first.
 */
export async function ownMeetings(ctx: AppContext, sub: string, range: { timeMin: string; timeMax: string; words: string }) {
  const q = await ctx.pool.query({ text: `SELECT ${COLUMNS} FROM calendar_own_events WHERE user_sub = $1 AND starts_at >= $2 AND starts_at < $3 ORDER BY starts_at ASC LIMIT 100`, values: [sub, range.timeMin, range.timeMax], query_timeout: 1800 } as any);
  const words = range.words.toLowerCase().split(/\s+/).filter(Boolean);
  return q.rows.map(ownEvent).filter((e: OwnEvent) => words.every((w) => `${e.title} ${e.location || ''} ${e.notes || ''}`.toLowerCase().includes(w))).slice(0, 50)
    .map((e: OwnEvent) => ({ source: 'oshal', ...e, guests: [], you: 'organizer', organizer: null, canChange: true, repeating: null }));
}
