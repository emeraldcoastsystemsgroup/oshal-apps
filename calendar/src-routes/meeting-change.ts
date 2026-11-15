/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | What a change or cancel card asks, read the same way for the person's Google Calendar meetings
 *   and the events they keep in OSHAL. Roger, 2026-11-14: "the calendar aplication can't change a meeting it can only create new
 *   ones ... can't cancel or modify existing meeting". A card names the meeting as it is now (its title and start, and the end,
 *   place or notes it changes) and each field it changes ("New start" ...); the route refuses a card whose meeting is not the one
 *   the calendar holds, so the card can never show one meeting and change another. Only the named fields change.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: the guests refusal says "Events kept in Open Swarm have no guests." (Roger, 2026-11-13: what a
 *   person sees names the product Open Swarm).
 */
/** The meeting a change or cancel card names, and the fields a change card changes. */
import { hasOffset, localLabel, validZone, wallToInstant } from './event-time';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}$/;
const MAX_GUESTS = 20;

/** The meeting as the card names it: its title and start as they are now, and any other field the card showed as it is now. */
export interface Named { title: string; start: string; zone: string | null; end?: string; location?: string; notes?: string }
/** A change card: the meeting it names and each field it changes ('' clears a place or notes from the screen). */
export interface ChangeAsk extends Named {
  newTitle?: string; newStart?: string; newEnd?: string; newLocation?: string; newNotes?: string; addGuests: string[]; removeGuests: string[];
}
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Optional text bounded to its length: undefined when absent, null when it is not such text. */
function optional(value: unknown, max: number, empty: boolean): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length > max || (!text && !empty)) return null;
  return text;
}

/**
 * @description The meeting a card names, as it is now: its title and start always, and the end, place and notes when the
 * card showed them. A card that names no meeting changes nothing.
 * @param body - The request body.
 * @returns The named meeting, or the refusal the person reads.
 */
export function parseNamed(body: any): Parsed<Named> {
  if (body?.confirm !== true) return fail('Confirm the change.');
  const title = optional(body?.title, 120, false), start = optional(body?.start, 40, false);
  if (!title) return fail('Name the meeting by its title as it is now, like "Coffee with Dana".');
  if (!start) return fail('Name the meeting by its start as it is now, like 2026-11-17T15:00:00-06:00.');
  const zone = validZone(body?.timeZone);
  if (body?.timeZone != null && body.timeZone !== '' && !zone) return fail('timeZone must be an IANA time zone such as America/Chicago.');
  const named: Named = { title, start, zone };
  for (const [key, max] of [['end', 40], ['location', 200], ['notes', 2000]] as const) {
    const value = optional(body?.[key], max, true);
    if (value === null) return fail(`"${key}" is the meeting's ${key} as it is now, as text.`);
    if (value !== undefined) named[key] = value;
  }
  return { ok: true, value: named };
}

/** A list of guest addresses: lowercase, each once, at most twenty. */
function guestList(raw: unknown, key: string): Parsed<string[]> {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw) || raw.length > MAX_GUESTS) return fail(`"${key}" lists at most ${MAX_GUESTS} guest email addresses.`);
  const out: string[] = [];
  for (const item of raw) {
    const email = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (!EMAIL.test(email)) return fail(`"${key}" lists email addresses, like dana@example.com.`);
    if (!out.includes(email)) out.push(email);
  }
  return { ok: true, value: out };
}

/**
 * @description A change card: the meeting it names and each field it changes. A new place or notes may be '' to clear it
 * (the screen's edit form can; a card cannot show an empty value, so the assistant's tool asks for text). Guests are only
 * for Google Calendar meetings.
 * @param body - The request body.
 * @param guests - Whether guests may be added or removed.
 * @returns The change, or the refusal the person reads.
 */
export function parseChangeAsk(body: any, guests: boolean): Parsed<ChangeAsk> {
  const named = parseNamed(body);
  if (!named.ok) return named;
  const ask: ChangeAsk = { ...named.value, addGuests: [], removeGuests: [] };
  for (const [key, max, empty] of [['newTitle', 120, false], ['newStart', 40, false], ['newEnd', 40, false], ['newLocation', 200, true], ['newNotes', 2000, true]] as const) {
    const value = optional(body?.[key], max, empty);
    if (value === null) return fail(key === 'newTitle' ? 'A new title is 1 to 120 characters.' : `"${key}" is text of at most ${max} characters.`);
    if (value !== undefined) ask[key] = value;
  }
  if (!guests && (body?.addGuests != null || body?.removeGuests != null)) return fail('Events kept in Open Swarm have no guests.');
  const add = guestList(body?.addGuests, 'addGuests'), remove = guestList(body?.removeGuests, 'removeGuests');
  if (!add.ok) return add;
  if (!remove.ok) return remove;
  if (add.value.some((email) => remove.value.includes(email))) return fail('A guest is either added or removed, not both.');
  ask.addGuests = add.value; ask.removeGuests = remove.value;
  const asked = ['newTitle', 'newStart', 'newEnd', 'newLocation', 'newNotes'].some((key) => (ask as any)[key] !== undefined) || add.value.length || remove.value.length;
  if (!asked) return fail('Name at least one thing to change: a new title, start, end, place, notes or guests.');
  return { ok: true, value: ask };
}

/** Two titles or places read the same: spacing and letter case aside. */
export function sameText(a: unknown, b: unknown): boolean {
  const plain = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return plain(a) === plain(b);
}

/**
 * @description The instant (or the day, for an all-day time) a time text names: a date, a time with its own offset, or a wall
 * time in a zone.
 * @param text - The time as sent.
 * @param zone - The zone a wall time is read in, or null.
 * @returns { day } for a date, { at } (epoch ms) for a time, or null when it names neither.
 */
export function moment(text: string, zone: string | null): { day: string } | { at: number } | null {
  if (DAY.test(text)) return { day: text };
  if (hasOffset(text)) { const at = Date.parse(text); return Number.isFinite(at) ? { at } : null; }
  const instant = zone ? wallToInstant(text, zone) : null;
  return instant ? { at: Date.parse(instant) } : null;
}

/** Whether a card's time names the same moment as the calendar's (a minute's rounding aside). */
export function sameMoment(card: string, zone: string | null, actual: { day: string } | { at: number } | null): boolean {
  const said = moment(card, zone);
  if (!said || !actual) return false;
  if ('day' in said || 'day' in actual) return 'day' in said && 'day' in actual && said.day === actual.day;
  return Math.abs(said.at - actual.at) < 60_000;
}

/** A time in the words people read, in its own zone: 'Tue, Nov 17, 2026, 3:00 PM CST', or '... (all day)'. */
export function momentWords(value: { day: string } | { at: number } | null, zone: string | null): string {
  if (!value) return 'no time';
  return 'day' in value ? localLabel(value.day, true, null) : localLabel(new Date(value.at).toISOString(), false, zone);
}

/** One changed field in words, as the answer and the screen show it. */
export interface Changed { field: string; before: string; after: string }

/** The changes in one sentence: 'Starts Tue, Nov 17, 3:00 PM CST → Thu, Nov 19, 2:00 PM CST; Title Coffee → Lunch'. */
export function changedWords(changed: Changed[]): string {
  return changed.map((c) => `${c.field} ${c.before || 'none'} → ${c.after || 'none'}`).join('; ');
}

/**
 * @description The refusal for a card whose meeting is not the one the calendar holds now: its title or start (or a field it
 * showed as it is now) differs, so approving it would change a meeting the card did not show.
 * @param named - The meeting as the card named it.
 * @param now - The meeting as the calendar holds it: title, start moment, zone, and end, place and notes in the card's form.
 * @returns The refusal, or null when the card names this meeting.
 */
export function namedMismatch(named: Named, now: { title: string; start: { day: string } | { at: number } | null; zone: string | null; end: { day: string } | { at: number } | null; location: string; notes: string }): string | null {
  const zone = named.zone || now.zone;
  const differs = !sameText(named.title, now.title) || !sameMoment(named.start, zone, now.start)
    || (named.end !== undefined && named.end !== '' && !sameMoment(named.end, zone, now.end))
    || (named.location !== undefined && !sameText(named.location, now.location))
    || (named.notes !== undefined && !sameText(named.notes, now.notes));
  if (!differs) return null;
  return `The card named "${named.title}" at ${momentWords(moment(named.start, zone), zone)}, but the calendar now holds "${now.title}" at ${momentWords(now.start, now.zone)}. Nothing was changed. Ask again, and the meeting is read fresh.`;
}
