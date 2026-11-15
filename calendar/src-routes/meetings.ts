/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The meeting finder and the Google meeting writes, mounted at /api/calendar/meetings (Roger,
 *   2026-11-14: "can't cancel or modify existing meeting"). GET / lists the caller's meetings in a window of days, from their
 *   primary Google Calendar (read live) and the events they added in OSHAL, matching words in a title, place, notes or a guest's
 *   name, each with the revision a change or cancel card names it by, so "move my 3 PM with Dana" can be matched to one meeting;
 *   when more than one matches, the answer says to ask which. GET /google/:id reads one Google meeting fresh for the Calendar
 *   screen. PATCH /google, POST /google/cancel and POST /google/decline are the approved cards' writes (google-meetings.ts);
 *   PATCH and DELETE /oshal/:id change and remove an event added in OSHAL (own-event-changes.ts).
 */
/** The meeting finder and the Google meeting writes. */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { validZone, wallToInstant } from './event-time';
import { addDays } from './google-events';
import { wallIn } from './google-meeting-edit';
import { cancelGoogleMeeting, changeGoogleMeeting, declineGoogleMeeting, findGoogleMeetings, oneGoogleMeeting } from './google-meetings';
import { changeOwnEvent, ownMeetings, removeOwnEvent } from './own-event-changes';

const log = createChildLogger({ module: 'calendar.meetings' });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The longest window one find reads, in days. */
export const MAX_DAYS = 92;

/** A real calendar date. */
const realDay = (text: string) => DAY.test(text) && new Date(`${text}T00:00:00.000Z`).toISOString().slice(0, 10) === text;

/**
 * @description The window a find reads: whole days in the person's zone, from today for 30 days unless given, at most 92 days.
 * @param query - { from?, to?, words?, timeZone? } as the route receives them.
 * @param now - The clock.
 * @returns The window, or the refusal.
 */
export function rangeOf(query: any, now: number): { ok: true; value: { from: string; to: string; zone: string; words: string; timeMin: string; timeMax: string } } | { ok: false; error: string } {
  const text = (key: string) => (typeof query?.[key] === 'string' ? query[key].trim() : '');
  const zone = text('timeZone') ? validZone(text('timeZone')) : 'UTC';
  if (!zone) return { ok: false, error: 'timeZone must be an IANA time zone such as America/Chicago.' };
  const from = text('from') || wallIn(now, zone).slice(0, 10), to = text('to') || addDays(from, 30);
  if (!realDay(from) || !realDay(to)) return { ok: false, error: '"from" and "to" are dates like 2026-11-17.' };
  if (to < from) return { ok: false, error: 'The last day is before the first.' };
  if (Date.parse(to) - Date.parse(from) > MAX_DAYS * 86_400_000) return { ok: false, error: `One find reads at most ${MAX_DAYS} days.` };
  const words = text('words');
  if (words.length > 100) return { ok: false, error: 'The words to match are at most 100 characters.' };
  return { ok: true, value: { from, to, zone, words, timeMin: wallToInstant(`${from}T00:00`, zone) as string, timeMax: wallToInstant(`${addDays(to, 1)}T00:00`, zone) as string } };
}

/** When a meeting starts, for ordering: its instant, or its day's midnight UTC. */
const startOf = (m: any) => Date.parse(m.allDay ? `${String(m.start).slice(0, 10)}T00:00:00.000Z` : m.start);

/**
 * @description The caller's meetings in the window: Google's (live) and the events added in OSHAL, soonest first, and what to
 * do when none or several match the words.
 * @param ctx - The application context.
 * @param sub - The verified caller.
 * @param query - The find's query.
 * @param now - The clock.
 * @returns The HTTP status and body to answer.
 */
export async function findMeetings(ctx: AppContext, sub: string, query: any, now = Date.now()): Promise<{ status: number; body: any }> {
  const range = rangeOf(query, now);
  if (!range.ok) return { status: 400, body: { error: range.error } };
  const r = range.value;
  const own = await ownMeetings(ctx, sub, r);
  const google = await findGoogleMeetings(ctx, sub, r);
  const meetings = [...own, ...google.meetings].sort((a, b) => startOf(a) - startOf(b)).slice(0, 60);
  const note = !meetings.length ? (r.words ? `No meeting from ${r.from} to ${r.to} matches "${r.words}". Say so, and ask for another word or day; never guess.` : `No meetings from ${r.from} to ${r.to}.`)
    : meetings.length > 1 && r.words ? 'More than one meeting matches. Ask the person which one they mean, naming each with its day and time; never choose one yourself.' : null;
  return { status: 200, body: { from: r.from, to: r.to, timeZone: r.zone, words: r.words || null, meetings, google: google.google, note } };
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

/** One route: the caller, the work, its answer, and the words when it throws. */
function handle(run: (sub: string, req: any) => Promise<{ status: number; body: any }>, failed: string) {
  return async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'no-store');
    const sub = caller(req, res);
    if (!sub) return;
    try {
      const out = await run(sub, req);
      res.status(out.status).json(out.body);
    } catch (err) {
      log.error({ err }, failed);
      res.status(502).json({ error: `${failed}. Try again in a few minutes.` });
    }
  };
}

/** Mounted at /api/calendar/meetings: the caller's own meetings, found, changed, cancelled or declined on an approved card. */
export function createMeetingsRoutes(ctx: AppContext) {
  const r = Router();
  r.get('/', handle((sub, req) => findMeetings(ctx, sub, req.query), 'Your meetings could not be read'));
  r.get('/google/:id', handle((sub, req) => oneGoogleMeeting(ctx, sub, String(req.params.id || ''), validZone(req.query?.timeZone)), 'That Google meeting could not be read'));
  r.patch('/google', handle((sub, req) => changeGoogleMeeting(ctx, sub, req.body), 'The Google meeting was not changed'));
  r.post('/google/cancel', handle((sub, req) => cancelGoogleMeeting(ctx, sub, req.body), 'The Google meeting was not cancelled'));
  r.post('/google/decline', handle((sub, req) => declineGoogleMeeting(ctx, sub, req.body), 'The invitation was not declined'));
  r.patch('/oshal/:id', handle((sub, req) => changeOwnEvent(ctx, sub, String(req.params.id || ''), req.body), 'The event was not changed'));
  r.delete('/oshal/:id', handle((sub, req) => removeOwnEvent(ctx, sub, String(req.params.id || ''), req.body), 'The event was not removed'));
  return r;
}
