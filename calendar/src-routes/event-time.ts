/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Time zones for the events a person adds in OSHAL. Sweep 9: an added event showed as '2026-11-07T01:00:00.000Z' on the screen and the Home card, and the concierge demanded a UTC offset although the kernel tells it the person's time zone. A timed start may now be a wall-clock time with an IANA zone (the zone named on the turn's "Current time" line), converted here with the zone's own rules for that date; every saved event is shown in the zone it was entered in.
 */
/** Time zones for the events a person adds in OSHAL: validation, wall-clock conversion and the label people read. */

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;
const OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const FIXED = /^([+-])(\d{2}):?(\d{2})$/;
const MINUTE = 60_000;

/**
 * @description An IANA time zone the runtime knows, in its canonical spelling, or null. A fixed offset or an unknown
 * name is not a zone here, so a typo never becomes UTC silently.
 * @param zone - Untrusted text such as 'America/Chicago'.
 * @returns The canonical zone name, or null.
 */
export function validZone(zone: unknown): string | null {
  if (typeof zone !== 'string') return null;
  const name = zone.trim();
  if (!name || name.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(name)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * @description How far a zone's clock is ahead of UTC at one instant, in milliseconds (negative west of Greenwich).
 * @param at - The instant in epoch milliseconds.
 * @param zone - A valid IANA zone.
 * @returns The offset in milliseconds.
 */
function zoneOffset(at: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second'));
  return wall - Math.floor(at / 1000) * 1000;
}

/**
 * @description A wall-clock date-time in a zone as an instant, using that zone's rules for that date (so a November date in
 * Chicago is UTC-6 even when today is UTC-5). The calendar date must be real (2026-02-30 is refused).
 * @param text - 'YYYY-MM-DDTHH:mm' with optional seconds, and no offset.
 * @param zone - A valid IANA zone.
 * @returns The instant as an ISO string, or null.
 */
export function wallToInstant(text: string, zone: string): string | null {
  const m = WALL.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] || '0'].map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(guess);
  if (h > 23 || mi > 59 || s > 59 || check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const first = zoneOffset(guess, zone);
  let at = guess - first;
  const second = zoneOffset(at, zone);
  if (second !== first) at = guess - second;
  return new Date(at).toISOString();
}

/**
 * @description The UTC offset a timed text carries, as '+HH:MM' / '-HH:MM' ('Z' is '+00:00'), or null when it has none.
 * @param text - An ISO 8601 date-time.
 * @returns The normalized offset, or null.
 */
export function offsetOf(text: string): string | null {
  const m = OFFSET.exec(text);
  if (!m) return null;
  if (m[1].toUpperCase() === 'Z') return '+00:00';
  const f = FIXED.exec(m[1]);
  return f ? `${f[1]}${f[2]}:${f[3]}` : null;
}

/**
 * @description Whether a timed text carries its own offset (or Z).
 * @param text - An ISO 8601 date-time.
 * @returns True when it does.
 */
export function hasOffset(text: string): boolean {
  return OFFSET.test(text);
}

const DAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
const TIME_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };

/**
 * @description The words a person reads for an event's start, in the zone it was entered in: 'Fri, Nov 6, 2026, 6:00 PM CST'
 * for a named zone, 'Fri, Nov 6, 2026, 6:00 PM (UTC-06:00)' for a fixed offset, '... UTC' when neither was saved, and
 * 'Sat, Nov 7, 2026 (all day)' for an all-day event.
 * @param start - An all-day 'YYYY-MM-DD' day or an ISO instant.
 * @param allDay - Whether the event is all-day.
 * @param zone - The saved zone: an IANA name, a '+HH:MM' offset, or null.
 * @returns The label, or the start unchanged when it cannot be read.
 */
export function localLabel(start: string, allDay: boolean, zone: string | null): string {
  const at = Date.parse(allDay ? `${start.slice(0, 10)}T00:00:00.000Z` : start);
  if (!Number.isFinite(at)) return start;
  if (allDay) return `${new Intl.DateTimeFormat('en-US', DAY_FORMAT).format(new Date(at))} (all day)`;
  const named = zone ? validZone(zone) : null;
  if (named) return new Intl.DateTimeFormat('en-US', { ...TIME_FORMAT, timeZone: named, timeZoneName: 'short' }).format(new Date(at));
  const fixed = zone ? FIXED.exec(zone) : null;
  if (fixed) {
    const minutes = (fixed[1] === '-' ? -1 : 1) * (Number(fixed[2]) * 60 + Number(fixed[3]));
    const shifted = new Date(at + minutes * MINUTE);
    return `${new Intl.DateTimeFormat('en-US', { ...TIME_FORMAT, timeZone: 'UTC' }).format(shifted)} (UTC${fixed[1]}${fixed[2]}:${fixed[3]})`;
  }
  return `${new Intl.DateTimeFormat('en-US', { ...TIME_FORMAT, timeZone: 'UTC' }).format(new Date(at))} UTC`;
}
