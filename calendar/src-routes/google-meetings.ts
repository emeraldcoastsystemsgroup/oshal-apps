/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Change, cancel and decline meetings on the person's own primary Google Calendar, after they
 *   approve the card (Roger, 2026-11-14: "the calendar aplication can't change a meeting it can only create new ones ... can't
 *   cancel or modify existing meeting"). Each write first reads the meeting fresh: a meeting that changed elsewhere after it was
 *   read (its etag differs from the card's revision) is refused, never overwritten; a card that names another meeting than the
 *   one Google holds is refused; only the fields the card names are sent (PATCH). Guests are told unless the card says they are
 *   not (Google's sendUpdates). An invited guest's meeting is declined, never cancelled, and is changed only when its organizer
 *   lets guests change it. A second Approve of the same change does nothing twice. The kernel's egress refuses an If-Match
 *   header from a package today (oshal-kernel crates/oshald/src/package_egress.rs PACKAGE_HEADERS), so the etag is compared on
 *   the fresh read just before the write. The synced snapshot follows each change, so the Calendar screen shows it.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: without a Google connection the finder says "only events added in Open Swarm are listed" (Roger,
 *   2026-11-13: what a person sees names the product Open Swarm). In a checked conversation Jarvis repeated the old words.
 */
/** Find, change, cancel and decline meetings on the caller's own primary Google Calendar. */
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { NOT_CONNECTED, send } from './google-events';
import { alreadyHolds, attendeesAfter, cardTime, changesOf, guestNames, heldNow, meetingView, newTimes, organizes, othersOf,
  readToken, sameEtag, seriesTimes, Times, Token } from './google-meeting-edit';
import { namedMismatch, parseChangeAsk, parseNamed } from './meeting-change';
import { calendarRow } from './sync';

const log = createChildLogger({ module: 'calendar.google-meetings' });

export const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const CONNECTIONS = 'the Connections page (/utilities)';
const ALLOW = 'allow it to view and edit events on your calendars';
const RATE_LIMITS = ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'calendarUsageLimitsExceeded', 'dailyLimitExceeded', 'RATE_LIMIT_EXCEEDED'];
/** What one kind of write says it did not do, and what a read-only grant may not do. */
interface Act { nothing: string; may: string }
const CHANGE: Act = { nothing: 'Nothing was changed.', may: 'change events on' };
const CANCEL: Act = { nothing: 'Nothing was cancelled.', may: 'cancel events on' };
const DECLINE: Act = { nothing: 'Nothing was declined.', may: 'answer invitations on' };
/** Google Calendar is not connected, for a find. */
export const FIND_NOT_CONNECTED = `Google Calendar is not connected, so only events added in Open Swarm are listed. To change or cancel Google Calendar meetings, connect Google on ${CONNECTIONS} and ${ALLOW}.`;
const STALE = (act: Act) => `This meeting changed in Google Calendar after it was read. ${act.nothing} Ask again, and it is read fresh.`;
const GONE = (act: Act) => `That meeting is no longer on your Google Calendar. ${act.nothing}`;
/** The words for a connection the kernel would not use, per act. */
export const notConnected = (act: Act) => `Google Calendar is not connected. Connect Google on ${CONNECTIONS} and ${ALLOW}, then ask again. ${act.nothing}`;
const reconnect = (act: Act) => `Your Google connection is no longer accepted. Reconnect Google on ${CONNECTIONS}, then ask again. ${act.nothing}`;
/** A grant that may read the calendar but not write it. */
export const readOnly = (act: Act) => `Your Google connection lets this app read your Google Calendar but not ${act.may} it. Reconnect Google on ${CONNECTIONS} and ${ALLOW}, then ask again. ${act.nothing}`;
type Out = { status: number; body: any };
const say = (status: number, error: string): Out => ({ status, body: { error } });

/** What a refused Google answer means, in words; Google's own detail is passed on only for a 400. */
function refusal(status: number, data: any, act: Act): Out {
  const error = data?.error || {};
  const reasons = [...(Array.isArray(error.errors) ? error.errors : []), ...(Array.isArray(error.details) ? error.details : [])].map((e: any) => String(e?.reason || ''));
  if (status === 401) return say(409, reconnect(act));
  if (status === 429 || (status === 403 && reasons.some((r) => RATE_LIMITS.includes(r)))) return say(503, `Google Calendar is limiting requests right now. ${act.nothing} Try again in a few minutes.`);
  if (status === 403 && reasons.includes('forbiddenForNonOrganizer')) return say(403, `Only the meeting's organizer can do that in Google Calendar. ${act.nothing}`);
  if (status === 403) return say(409, readOnly(act));
  if (status === 404 || status === 410) return say(404, GONE(act));
  if (status === 412) return say(409, STALE(act));
  if (status === 400) return say(400, `Google Calendar refused it: ${String(error.message || 'the change is not valid').replace(/[.\s]+$/, '').slice(0, 200)}. ${act.nothing}`);
  return say(502, `Google Calendar did not take it. ${act.nothing} Try again in a few minutes.`);
}

/** One request whose refusal by the kernel (no connection, or one it cannot renew) is answered in words. */
async function google(ctx: AppContext, sub: string, method: string, url: string, act: Act, payload?: any): Promise<{ status: number; data: any } | Out> {
  const sent = await send(ctx, sub, method, url, payload);
  if ('refused' in sent) return say(409, sent.refused === NOT_CONNECTED ? notConnected(act) : reconnect(act));
  return sent;
}
const refused = (value: any): value is Out => value && 'body' in value;

/** The occurrence (or single meeting) a revision names, read fresh, and the series it belongs to. */
async function readMeeting(ctx: AppContext, sub: string, id: string, act: Act): Promise<{ event: any; parent: any | null } | Out> {
  const got = await google(ctx, sub, 'GET', `${EVENTS}/${encodeURIComponent(id)}`, act);
  if (refused(got)) return got;
  if (got.status !== 200) return refusal(got.status, got.data, act);
  if (got.data?.status === 'cancelled') return say(404, GONE(act));
  let parent = null;
  if (got.data?.recurringEventId) {
    const series = await google(ctx, sub, 'GET', `${EVENTS}/${encodeURIComponent(got.data.recurringEventId)}`, act);
    parent = !refused(series) && series.status === 200 && series.data?.status !== 'cancelled' ? series.data : null;
  }
  return { event: got.data, parent };
}

/** The guests choice a card names: tell them, do not, or the meeting has none. */
function toldOf(value: unknown): 'all' | 'none' | 'no-guests' | null {
  return value === 'Will be told' ? 'all' : value === 'Will not be told' ? 'none' : value === 'None' ? 'no-guests' : null;
}
const NEED_TOLD = 'Say whether the guests are told: "Will be told", "Will not be told", or "None" for a meeting without guests.';

/** Whether a card asks for one occurrence, the whole series, or did not say; a value that is neither is refused. */
function scopeOf(value: unknown): 'one' | 'series' | null | undefined {
  if (value == null || value === '') return null;
  return value === 'This one only' ? 'one' : value === 'The whole series' ? 'series' : undefined;
}

/**
 * @description The meeting a card acts on, checked: read fresh; the card names this meeting; it is still the version the card
 * was read from; a repeating meeting says which; the guests choice is true to the meeting.
 * @param ctx - The application context.
 * @param sub - The verified caller.
 * @param body - The card.
 * @param act - What the card does, for its words.
 * @param guestsKey - The card field that says who is told: the guests, or (for a decline) the organizer.
 * @returns The occurrence, its series, the target written (the series or the occurrence), the token and guests choice; or the refusal.
 */
async function checked(ctx: AppContext, sub: string, body: any, act: Act, guestsKey: 'guests' | 'organizer') {
  const token = readToken(body?.revision);
  if (!token) return say(400, `The card does not name a meeting this app read. ${act.nothing} Ask again, and it is read fresh.`);
  const told = toldOf(body?.[guestsKey]), scope = scopeOf(body?.appliesTo);
  if (!told || (guestsKey === 'organizer' && told === 'no-guests')) return say(400, guestsKey === 'guests' ? NEED_TOLD : 'Say whether the organizer is told: "Will be told" or "Will not be told".');
  if (scope === undefined) return say(400, '"appliesTo" is "This one only" or "The whole series".');
  const read = await readMeeting(ctx, sub, token.id, act);
  if (refused(read)) return read;
  return { token, told, scope, ...read };
}

/** The series rules shared by every write: a repeating meeting says which, a single one cannot be a series. */
function seriesRule(event: any, parent: any | null, scope: 'one' | 'series' | null, act: Act): Out | null {
  const repeats = Boolean(event.recurringEventId || event.recurrence);
  if (repeats && !scope) return say(400, `This meeting repeats. ${act.nothing} Say whether this one only or the whole series.`);
  if (!repeats && scope === 'series') return say(400, `This meeting does not repeat, so there is no series. ${act.nothing}`);
  if (scope === 'series' && event.recurringEventId && !parent) return say(404, `The series this meeting belongs to is no longer on your Google Calendar. ${act.nothing}`);
  return null;
}

/** The refusals after the series rule: the card's meeting, its version, and its guests choice. */
function versionRule(c: { token: Token; told: string; scope: string | null; event: any; parent: any | null }, named: any, act: Act): Out | null {
  const mismatch = namedMismatch(named, heldNow(c.event, named.zone));
  if (mismatch) return say(409, mismatch.replace('Nothing was changed.', act.nothing));
  const series = c.scope === 'series' && c.event.recurringEventId;
  if (!sameEtag(series ? c.parent : c.event, series ? c.token.parentEtag : c.token.etag)) return say(409, STALE(act));
  const others = othersOf(series ? c.parent : c.event);
  if (c.told === 'no-guests' && others.length) return say(409, `This meeting has ${others.length === 1 ? 'a guest' : `${others.length} guests`} (${guestNames(others)}), but the card said None. ${act.nothing} Ask again, and say whether they are told.`);
  return null;
}

/** Who was told, in words. */
function toldWords(others: any[], told: string): string {
  if (!others.length) return '';
  if (told === 'all') return ` ${guestNames(others)} ${others.length === 1 ? 'was' : 'were'} told.`;
  return others.length === 1 ? ' The guest was not told.' : ' The guests were not told.';
}

/** The instance id Google gives an occurrence of a series that starts at this moment. */
function occurrenceId(seriesId: string, times: Times): string {
  const at = times.startAt as any;
  return `${seriesId}_${'day' in at ? at.day.replace(/-/g, '') : new Date(at.at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}

/**
 * @description The synced snapshot follows a change: the rows of the changed meeting (or its whole series) are replaced by
 * what Google holds now, or dropped. Nothing happens without a snapshot; a failure here is logged and never undoes the write.
 * @param ctx - The application context.
 * @param sub - The verified caller.
 * @param drop - The rows to replace: one event id, or a series id whose occurrences all go.
 * @param put - The rows to put in their place, or a series to read again in the snapshot's window.
 */
async function followSnapshot(ctx: AppContext, sub: string, drop: { id: string; series: boolean }, put: { event?: any; series?: string }) {
  try {
    const q = await ctx.pool.query({ text: 'SELECT events,synced_at FROM calendar_preparation_snapshots WHERE user_sub = $1', values: [sub], query_timeout: 1800 } as any);
    const row = q.rows[0];
    if (!row || !Array.isArray(row.events)) return;
    let events = row.events.filter((e: any) => !(e?.id === drop.id || (drop.series && String(e?.id || '').startsWith(`${drop.id}_`))));
    if (put.event) events.push(calendarRow(put.event));
    if (put.series) {
      const from = new Date(row.synced_at).toISOString(), to = new Date(Date.parse(from) + 30 * 86_400_000).toISOString();
      const got = await send(ctx, sub, 'GET', `${EVENTS}/${encodeURIComponent(put.series)}/instances?${new URLSearchParams({ timeMin: from, timeMax: to, maxResults: '250' })}`);
      if ('status' in got && got.status === 200 && Array.isArray(got.data?.items)) events.push(...got.data.items.filter((e: any) => e.status !== 'cancelled').map(calendarRow));
    }
    events = events.sort((a: any, b: any) => String(a.start).localeCompare(String(b.start))).slice(0, 250);
    await ctx.pool.query('UPDATE calendar_preparation_snapshots SET events = $2 WHERE user_sub = $1', [sub, JSON.stringify(events)]);
  } catch (err) {
    log.error({ err }, 'Calendar snapshot did not follow the Google change');
  }
}

/** What Google is sent for a change: only the named fields, the series' times and rule when the whole series moves. */
function patchOf(c: any, ask: any, times: Times | null, attendees: any[] | null): { ok: true; value: any } | Out {
  const patch: any = {};
  if (ask.newTitle !== undefined) patch.summary = ask.newTitle;
  if (ask.newLocation !== undefined) patch.location = ask.newLocation;
  if (ask.newNotes !== undefined) patch.description = ask.newNotes;
  if (attendees) patch.attendees = attendees;
  if (times && c.scope === 'series' && c.event.recurringEventId) {
    const moved = seriesTimes(c.parent, c.event, times);
    if (!moved.ok) return say(400, moved.error);
    Object.assign(patch, moved.value);
  } else if (times) Object.assign(patch, { start: times.start, end: times.end });
  return { ok: true, value: patch };
}

/** The input that puts a changed meeting back as it was (the same tool, its new revision), or null when it cannot. */
function undoOf(before: any, after: any, ask: any, times: Times | null, c: any, zone: string | null) {
  if (!after) return null;
  const view = meetingView(after, c.parent, zone);
  return { revision: view.revision, title: view.title, start: view.start, ...(view.timeZone ? { timeZone: view.timeZone } : {}),
    ...(c.scope ? { appliesTo: c.scope === 'series' ? 'The whole series' : 'This one only' } : {}), guests: c.told === 'all' ? 'Will be told' : c.told === 'none' ? 'Will not be told' : 'None',
    ...(ask.newTitle !== undefined ? { newTitle: String(before.summary || '') } : {}), ...(times ? { newStart: cardTime(before.start), newEnd: cardTime(before.end, true) } : {}),
    ...(ask.newLocation !== undefined ? { newLocation: String(before.location || '') } : {}), ...(ask.newNotes !== undefined ? { newNotes: String(before.description || '') } : {}),
    ...(ask.addGuests.length || ask.removeGuests.length ? { addGuests: ask.removeGuests, removeGuests: ask.addGuests } : {}), confirm: true };
}

/**
 * @description Change one meeting, or its whole series, on the caller's primary Google Calendar: only the fields the card names.
 * @param ctx - The application context.
 * @param sub - The verified caller.
 * @param body - The approved card.
 * @param now - The clock.
 * @returns The HTTP status and body to answer.
 */
export async function changeGoogleMeeting(ctx: AppContext, sub: string, body: any, now = Date.now()): Promise<Out> {
  const ask = parseChangeAsk(body, true);
  if (!ask.ok) return say(400, ask.error);
  const c = await checked(ctx, sub, body, CHANGE, 'guests');
  if (refused(c)) return c;
  if (!organizes(c.event) && c.event.guestsCanModify !== true) return say(403, `${meetingView(c.event, null, null).organizer} organizes this meeting, so only they can change it. Nothing was changed. You can decline it, or open it in Google Calendar to propose a new time.`);
  const rule = seriesRule(c.event, c.parent, c.scope, CHANGE);
  if (rule) return rule;
  const series = c.scope === 'series' && c.event.recurringEventId, target = series ? c.parent : c.event;
  const times = newTimes(c.event, ask.value, now);
  if (!times.ok) return say(400, times.error);
  const attendees = attendeesAfter(target, ask.value);
  if (!attendees.ok) return say(400, attendees.error);
  if (!(series && times.value) && alreadyHolds(series ? target : c.event, ask.value, times.value)) {
    return { status: 200, body: { ok: true, already: true, event: meetingView(c.event, c.parent, ask.value.zone), where: 'That change is already on your Google Calendar. Nothing was changed again.' } };
  }
  const version = versionRule(c, ask.value, CHANGE);
  if (version) return version;
  const patch = patchOf(c, ask.value, times.value, attendees.value);
  if (refused(patch)) return patch;
  const told = c.told === 'all' ? 'all' : 'none';
  const sent = await google(ctx, sub, 'PATCH', `${EVENTS}/${encodeURIComponent(target.id)}?sendUpdates=${told}`, CHANGE, patch.value);
  if (refused(sent)) return sent;
  if (sent.status !== 200) return refusal(sent.status, sent.data, CHANGE);
  return changed(ctx, sub, { c, ask: ask.value, times: times.value, attendees: attendees.value, target, updated: sent.data });
}

/** The answer after Google took a change: the meeting as it is now, each field before and after, who was told, and the undo. */
async function changed(ctx: AppContext, sub: string, w: { c: any; ask: any; times: Times | null; attendees: any[] | null; target: any; updated: any }): Promise<Out> {
  const { c, ask, times, attendees, target, updated } = w, zone = ask.zone, series = c.scope === 'series' && c.event.recurringEventId;
  let after = series ? null : updated;
  if (series) {
    const id = times ? occurrenceId(updated.id, times) : c.event.id;
    const again = await send(ctx, sub, 'GET', `${EVENTS}/${encodeURIComponent(id)}`);
    after = 'status' in again && again.status === 200 ? again.data : null;
    await followSnapshot(ctx, sub, { id: updated.id, series: true }, { series: updated.id });
  } else await followSnapshot(ctx, sub, { id: c.event.id, series: false }, { event: updated });
  const list = changesOf(series ? { ...target, start: c.event.start, end: c.event.end } : c.event, ask, times, attendees, zone);
  const nouns: Record<string, string> = { Title: 'title', Starts: 'start', Ends: 'end', Where: 'place', Notes: 'notes', Guests: 'guests' };
  const fields = list.map((x) => nouns[x.field] || x.field.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' and $1') || 'nothing';
  const parent = series ? updated : c.parent;
  const undo = undoOf(series ? { ...target, start: c.event.start, end: c.event.end } : c.event, after, ask, times, { ...c, parent }, zone);
  const where = `Changed the ${fields} on your Google Calendar${series ? ' for every meeting in the series' : ''}.${toldWords(othersOf(updated), c.told)}${undo ? ' To put it back, ask to undo it.' : ''}`;
  log.info({ series: Boolean(series), fields: list.length }, 'Google Calendar meeting changed');
  return { status: 200, body: { ok: true, event: meetingView(after || updated, parent, zone), changed: list, where, undo } };
}

/**
 * @description Cancel one meeting, or its whole series, that the caller organizes. An invited guest declines instead.
 * @param ctx - The application context.
 * @param sub - The verified caller.
 * @param body - The approved card.
 * @returns The HTTP status and body to answer.
 */
export async function cancelGoogleMeeting(ctx: AppContext, sub: string, body: any): Promise<Out> {
  const named = parseNamed(body);
  if (!named.ok) return say(400, named.error.replace('Confirm the change.', 'Confirm the cancellation.'));
  const c = await checked(ctx, sub, body, CANCEL, 'guests');
  if (refused(c)) return c.status === 404 ? { status: 200, body: { ok: true, already: true, where: 'That meeting is already cancelled. Nothing was done twice.' } } : c;
  if (!organizes(c.event)) return say(409, `You were invited to this meeting by ${meetingView(c.event, null, null).organizer}, so it is not yours to cancel. Nothing was cancelled. You can decline it instead.`);
  const rule = seriesRule(c.event, c.parent, c.scope, CANCEL) || versionRule(c, named.value, CANCEL);
  if (rule) return rule;
  const series = c.scope === 'series' && c.event.recurringEventId, target = series ? c.parent : c.event;
  const sent = await google(ctx, sub, 'DELETE', `${EVENTS}/${encodeURIComponent(target.id)}?sendUpdates=${c.told === 'all' ? 'all' : 'none'}`, CANCEL);
  if (refused(sent)) return sent;
  if (sent.status === 410) return { status: 200, body: { ok: true, already: true, where: 'That meeting is already cancelled. Nothing was done twice.' } };
  if (sent.status !== 204 && sent.status !== 200) return refusal(sent.status, sent.data, CANCEL);
  await followSnapshot(ctx, sub, { id: target.id, series: Boolean(series) }, {});
  const others = othersOf(target), view = meetingView(c.event, c.parent, named.value.zone);
  const undo = !others.length && !series && !c.event.recurringEventId ? { title: view.title, start: cardTime(c.event.start), end: cardTime(c.event.end, true), ...(view.timeZone ? { timeZone: view.timeZone } : {}),
    ...(c.event.location ? { location: c.event.location } : {}), ...(c.event.description ? { notes: String(c.event.description).slice(0, 2000) } : {}), confirm: true } : null;
  const back = undo ? ' To put it back, ask to add it again.' : others.length ? ' It cannot be put back here, because its guests had it on their calendars; add it again if you need it.' : ' A cancelled series cannot be put back here; add it again as a new series.';
  log.info({ series: Boolean(series), guests: others.length }, 'Google Calendar meeting cancelled');
  return { status: 200, body: { ok: true, cancelled: true, event: view, where: `Cancelled on your Google Calendar${series ? ', every meeting in the series' : ''}.${toldWords(others, c.told)}${back}`, undo } };
}

/**
 * @description Decline one meeting, or its whole series, the caller was invited to; the organizer is told unless the card says not.
 * @param ctx - The application context.
 * @param sub - The verified caller.
 * @param body - The approved card.
 * @returns The HTTP status and body to answer.
 */
export async function declineGoogleMeeting(ctx: AppContext, sub: string, body: any): Promise<Out> {
  const named = parseNamed(body);
  if (!named.ok) return say(400, named.error.replace('Confirm the change.', 'Confirm declining it.'));
  const c = await checked(ctx, sub, body, DECLINE, 'organizer');
  if (refused(c)) return c;
  if (organizes(c.event)) return say(409, 'You organize this meeting, so there is no invitation to decline. Nothing was declined. You can cancel it instead.');
  const rule = seriesRule(c.event, c.parent, c.scope, DECLINE);
  if (rule) return rule;
  const series = c.scope === 'series' && c.event.recurringEventId, target = series ? c.parent : c.event;
  const attendees: any[] = Array.isArray(target.attendees) ? target.attendees : [], me = attendees.find((a) => a.self);
  if (!me) return say(409, 'This meeting does not list you as a guest, so it cannot be declined here. Nothing was declined.');
  const organizer = meetingView(c.event, null, null).organizer;
  if (me.responseStatus === 'declined') return { status: 200, body: { ok: true, already: true, event: meetingView(c.event, c.parent, named.value.zone), where: 'You already declined it. Nothing was sent twice.' } };
  const version = versionRule({ ...c, told: 'all' }, named.value, DECLINE);
  if (version) return version;
  const patch = { attendees: attendees.map((a) => (a.self ? { ...a, responseStatus: 'declined' } : a)) };
  const sent = await google(ctx, sub, 'PATCH', `${EVENTS}/${encodeURIComponent(target.id)}?sendUpdates=${c.told === 'all' ? 'all' : 'none'}`, DECLINE, patch);
  if (refused(sent)) return sent;
  if (sent.status !== 200) return refusal(sent.status, sent.data, DECLINE);
  log.info({ series: Boolean(series) }, 'Google Calendar invitation declined');
  const told = c.told === 'all' ? `${organizer} was told.` : `${organizer} was not told.`;
  return { status: 200, body: { ok: true, declined: true, event: meetingView(series ? c.event : sent.data, c.parent, named.value.zone),
    where: `Declined${series ? ' every meeting in the series' : ''}; it stays on ${organizer}'s calendar. ${told} To go after all, answer Yes on the invitation in Google Calendar.` } };
}

/**
 * @description The caller's Google meetings in a window, matching words when given, each with the revision a card names it by.
 * @param ctx - The application context.
 * @param sub - The verified caller.
 * @param range - The window's instants, the words and the person's zone.
 * @returns The meetings, and "read" or the words for why none could be read.
 */
export async function findGoogleMeetings(ctx: AppContext, sub: string, range: { timeMin: string; timeMax: string; words: string; zone: string }) {
  const query = new URLSearchParams({ timeMin: range.timeMin, timeMax: range.timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
  if (range.words) query.set('q', range.words);
  const got = await send(ctx, sub, 'GET', `${EVENTS}?${query}`);
  const only = { nothing: 'Only events added in Open Swarm are listed.', may: 'read' };
  if ('refused' in got) return { meetings: [], google: got.refused === NOT_CONNECTED ? FIND_NOT_CONNECTED : reconnect(only) };
  if (got.status === 401) return { meetings: [], google: reconnect(only) };
  if (got.status !== 200) return { meetings: [], google: `Google Calendar could not be read right now. ${only.nothing}` };
  const items: any[] = (Array.isArray(got.data?.items) ? got.data.items : []).filter((e: any) => e && e.status !== 'cancelled');
  const parents = new Map<string, any>();
  for (const id of [...new Set(items.map((e) => e.recurringEventId).filter(Boolean))].slice(0, 10)) {
    const series = await send(ctx, sub, 'GET', `${EVENTS}/${encodeURIComponent(id)}`);
    if ('status' in series && series.status === 200) parents.set(id, series.data);
  }
  return { meetings: items.map((e) => meetingView(e, parents.get(e.recurringEventId) || null, range.zone)), google: 'read' };
}

/**
 * @description One Google meeting read fresh, for the Calendar screen's event view (an event of the synced snapshot by its id).
 * @param ctx - The application context.
 * @param sub - The verified caller.
 * @param id - The Google event id.
 * @param zone - The person's zone.
 * @returns The HTTP status and body to answer.
 */
export async function oneGoogleMeeting(ctx: AppContext, sub: string, id: string, zone: string | null): Promise<Out> {
  if (!/^[A-Za-z0-9_]{1,1024}$/.test(id)) return say(400, 'A Google event id is required.');
  const read = await readMeeting(ctx, sub, id, { nothing: '', may: 'read' });
  if (refused(read)) return { status: read.status, body: { error: read.body.error.trim() } };
  return { status: 200, body: { meeting: meetingView(read.event, read.parent, zone) } };
}
