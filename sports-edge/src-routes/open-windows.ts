/**
 * Per-league expected line-open windows and adaptive capture cadence.
 *
 * Books do not open a slate at random hours:
 *   - NCAAF: Sunday afternoon/evening Eastern (12:00–22:00 ET) for the coming week's slate
 *     (1–8 days before kickoff, covering Tue–Sat games and early-week bowls).
 *   - NFL:   Sunday night through Monday afternoon Eastern (Sun 19:00–Mon 18:00 ET) for the next
 *     week's slate (2–9 days before kickoff, covering TNF, Sunday and MNF while excluding games
 *     already kicking off that night).
 *   - NBA:   Prior evening (17:00–24:00 ET, 14–30 hours before tipoff) and game-day morning
 *     (08:00–13:00 ET, 4–16 hours before tipoff).
 *
 * Inside any tracked game's expected open window, line capture polls on the tight cadence
 * (`TIGHT_CADENCE_MINUTES = 15`, minutes rather than hours) so a fresh opener is caught shortly
 * after posting. Outside every open window, capture stays on the slow cadence (`180` minutes) so
 * intermediate scheduler ticks spend zero ESPN calls.
 *
 * Pure module — no I/O, no framework imports, DST-aware via America/New_York Intl formatting.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Item C (0.12.4): define per-league expected line-open windows (NFL, NCAAF, NBA), DST-aware Eastern clock helpers, and adaptive tight (15 min) vs slow (180 min) capture cadence functions.
 *
 * @module open-windows
 */

import type { League } from './sports-odds';

/** Tight polling cadence inside a league's expected open window, in minutes. */
export const TIGHT_CADENCE_MINUTES = 15;

/** Default slow polling cadence outside all expected open windows, in minutes. */
export const SLOW_CADENCE_MINUTES = 180;

/** Slack for tight-cadence due checks so a 15-minute cron tick landing a few seconds early runs. */
const TIGHT_SLACK_MINUTES = 2;

/** Slack for slow-cadence due checks, matching sports-refresh DUE_SLACK_MS. */
const SLOW_SLACK_MINUTES = 10;

/** Documented open-window rule for one supported league. */
export interface OpenWindowRule {
  league: League;
  label: string;
  tightCadenceMinutes: number;
  slowCadenceMinutes: number;
  scheduleSummary: string;
}

/** Result of evaluating whether one capture instant fell inside a game's expected open window. */
export interface OpenWindowCheck {
  inWindow: boolean;
  windowLabel: string;
  cadenceMinutes: number;
}

/** Minimal upcoming-game shape needed to determine whether any league's open window is active. */
export interface UpcomingGameWindowRef {
  league: League;
  gameDate: string | null | undefined;
}

/** Declared per-league expected line-open windows for every league Sports Edge supports. */
export const LEAGUE_OPEN_WINDOWS: Record<League, OpenWindowRule> = Object.freeze({
  ncaaf: Object.freeze({
    league: 'ncaaf' as League,
    label: 'Sun 12:00-22:00 ET (24-192h pre-kickoff)',
    tightCadenceMinutes: TIGHT_CADENCE_MINUTES,
    slowCadenceMinutes: SLOW_CADENCE_MINUTES,
    scheduleSummary: 'Sundays 12:00-22:00 America/New_York for upcoming games 1-8 days out',
  }),
  nfl: Object.freeze({
    league: 'nfl' as League,
    label: 'Sun 19:00-Mon 18:00 ET (48-216h pre-kickoff)',
    tightCadenceMinutes: TIGHT_CADENCE_MINUTES,
    slowCadenceMinutes: SLOW_CADENCE_MINUTES,
    scheduleSummary: 'Sunday 19:00 through Monday 18:00 America/New_York for next week (2-9 days out)',
  }),
  nba: Object.freeze({
    league: 'nba' as League,
    label: 'Prior eve 17:00-24:00 ET (14-30h) or gameday 08:00-13:00 ET (4-16h)',
    tightCadenceMinutes: TIGHT_CADENCE_MINUTES,
    slowCadenceMinutes: SLOW_CADENCE_MINUTES,
    scheduleSummary: 'Evening before tipoff (17:00-24:00 ET) and game-day morning (08:00-13:00 ET)',
  }),
});

const ET_WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const ET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Converts any Date or ISO timestamp into epoch milliseconds, or NaN if invalid. */
function toMs(value: Date | string | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && value.trim()) return Date.parse(value);
  return NaN;
}

/** Extracts US Eastern (America/New_York, DST-aware) weekday (0=Sun..6=Sat), hour (0-23) and minute. */
export function easternClock(instant: Date | string): { day: number; hour: number; minute: number } | null {
  const ms = toMs(instant);
  if (!Number.isFinite(ms)) return null;
  const parts = ET_FORMATTER.formatToParts(new Date(ms));
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hourRaw = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  const day = ET_WEEKDAY[weekday];
  if (day === undefined || !Number.isFinite(hourRaw) || !Number.isFinite(minute)) return null;
  return { day, hour: hourRaw === 24 ? 0 : hourRaw, minute };
}

/** Evaluates the league-specific clock + pre-kickoff lead-time bounds. */
function matchesLeagueRule(league: League, day: number, hour: number, leadHours: number): boolean {
  if (league === 'ncaaf') {
    return day === 0 && hour >= 12 && hour < 22 && leadHours >= 24 && leadHours <= 192;
  }
  if (league === 'nfl') {
    const inClock = (day === 0 && hour >= 19) || (day === 1 && hour < 18);
    return inClock && leadHours >= 48 && leadHours <= 216;
  }
  if (league === 'nba') {
    const priorEvening = hour >= 17 && leadHours >= 14 && leadHours <= 30;
    const gameMorning = hour >= 8 && hour < 13 && leadHours >= 4 && leadHours <= 16;
    return priorEvening || gameMorning;
  }
  return false;
}

/**
 * @description Determine whether a capture timestamp for one game falls inside its league's
 * expected line-open window. Fails closed (inWindow: false) when kickoff or league is unknown,
 * because a capture cannot be claimed to have landed in a pre-kickoff open window without a
 * known kickoff instant.
 * @param league - League the game belongs to.
 * @param capturedAt - Instant the quote was observed.
 * @param kickoffAt - Scheduled kickoff/tipoff instant.
 * @returns Window membership, human-readable window label, and applicable poll cadence.
 */
export function isInOpenWindow(
  league: League,
  capturedAt: Date | string,
  kickoffAt: Date | string | null | undefined,
): OpenWindowCheck {
  const rule = LEAGUE_OPEN_WINDOWS[league];
  if (!rule) return { inWindow: false, windowLabel: 'unknown league', cadenceMinutes: SLOW_CADENCE_MINUTES };
  const capMs = toMs(capturedAt);
  const kickMs = toMs(kickoffAt);
  const clock = easternClock(capturedAt);
  if (!clock || !Number.isFinite(capMs) || !Number.isFinite(kickMs)) {
    return { inWindow: false, windowLabel: rule.label, cadenceMinutes: rule.slowCadenceMinutes };
  }
  const leadHours = (kickMs - capMs) / 3600000;
  const inWindow = matchesLeagueRule(league, clock.day, clock.hour, leadHours);
  return {
    inWindow,
    windowLabel: rule.label,
    cadenceMinutes: inWindow ? rule.tightCadenceMinutes : rule.slowCadenceMinutes,
  };
}

/**
 * @description Leagues that currently have at least one tracked upcoming game inside their
 * expected open window. Ordered deterministically.
 * @param now - Current instant.
 * @param upcomingGames - Tracked upcoming games with league and kickoff timestamp.
 * @returns Distinct leagues currently in their expected open window.
 */
export function activeOpenWindowLeagues(
  now: Date | string,
  upcomingGames: UpcomingGameWindowRef[],
): League[] {
  const active = new Set<League>();
  for (const game of upcomingGames || []) {
    if (isInOpenWindow(game.league, now, game.gameDate).inWindow) active.add(game.league);
  }
  return (['nfl', 'nba', 'ncaaf'] as League[]).filter((l) => active.has(l));
}

/**
 * @description Required line-capture cadence at `now` given the tracked upcoming slate.
 * Returns `TIGHT_CADENCE_MINUTES` (15 min) whenever ANY tracked upcoming game is currently inside
 * its league's expected open window, and `slowCadenceMinutes` (default 180 min) otherwise.
 * @param now - Current instant.
 * @param upcomingGames - Tracked upcoming games.
 * @param slowCadenceMinutes - Slow cadence outside open windows (clamped >= 30).
 * @returns Cadence in minutes.
 */
export function nextCaptureCadenceMinutes(
  now: Date | string,
  upcomingGames: UpcomingGameWindowRef[],
  slowCadenceMinutes: number = SLOW_CADENCE_MINUTES,
): number {
  const slow = Math.max(30, Number(slowCadenceMinutes) || SLOW_CADENCE_MINUTES);
  return activeOpenWindowLeagues(now, upcomingGames).length > 0 ? TIGHT_CADENCE_MINUTES : slow;
}

/**
 * @description Next instant a line-capture poll becomes due, or null when a poll is due now.
 * @param now - Current instant.
 * @param lastPollAt - Timestamp of the previous line capture poll, or null if none yet.
 * @param upcomingGames - Tracked upcoming games.
 * @param slowCadenceMinutes - Slow cadence outside open windows.
 * @returns ISO timestamp when next due, or null if due immediately.
 */
export function nextLinePollDueAt(
  now: Date | string,
  lastPollAt: Date | string | null | undefined,
  upcomingGames: UpcomingGameWindowRef[],
  slowCadenceMinutes: number = SLOW_CADENCE_MINUTES,
): string | null {
  const nowMs = toMs(now);
  const lastMs = toMs(lastPollAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastMs)) return null;
  const cadence = nextCaptureCadenceMinutes(now, upcomingGames, slowCadenceMinutes);
  const slack = cadence <= TIGHT_CADENCE_MINUTES ? TIGHT_SLACK_MINUTES : SLOW_SLACK_MINUTES;
  const dueMs = lastMs + Math.max(1, cadence - slack) * 60000;
  return nowMs >= dueMs ? null : new Date(dueMs).toISOString();
}

/**
 * @description Whether the scheduler should poll sportsbook lines right now.
 * Enforces the tight (15-minute) cadence while any upcoming game is inside its league's expected
 * open window and stays on the slow (180-minute) cadence outside all windows.
 * @param now - Current instant.
 * @param lastPollAt - Timestamp of the previous line capture poll, or null if none yet.
 * @param upcomingGames - Tracked upcoming games.
 * @param slowCadenceMinutes - Slow cadence outside open windows.
 * @returns True when a line poll should execute now.
 */
export function shouldPollLinesNow(
  now: Date | string,
  lastPollAt: Date | string | null | undefined,
  upcomingGames: UpcomingGameWindowRef[],
  slowCadenceMinutes: number = SLOW_CADENCE_MINUTES,
): boolean {
  return nextLinePollDueAt(now, lastPollAt, upcomingGames, slowCadenceMinutes) === null;
}
