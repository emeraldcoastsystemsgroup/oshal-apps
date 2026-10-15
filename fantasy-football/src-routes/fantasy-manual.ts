/**
 * Hand-typed leagues — the credential-free way into every weekly recommendation.
 *
 * MANUAL ENTRY IS A FIRST-CLASS INPUT, NOT A FALLBACK (ADR-146 Amendment A). Managing a team needs
 * your roster and your opponents', which in a private ESPN league means the account cookies, and the
 * operator reported that ESPN team "having some issues". So a league can be typed in once — scoring,
 * slots, every team's roster by ESPN player id, the schedule — and the lineup, the waiver board, the
 * trade finder and the week ledger all run on it with no connector at all. The public projection
 * feed still supplies the numbers; it needs no credential.
 *
 * THE SCORING MAP IS STAT ID → POINTS, the same keys the projections carry. There is no stat
 * dictionary here either: a hand-typed league states what a reception is worth exactly as ESPN's
 * `scoringItems` would, and nothing in this package assumes what stat 53 means.
 *
 * Validation is strict and names every problem, because a league typed in wrong produces a lineup
 * that is confidently wrong. Every statement is owner-scoped like the rest of the store.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the hand-typed league document, its validation (one team is yours, integer ids, bounded sizes, numeric scoring, weeks in range), and owner-scoped create, replace, read, list and delete.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Deleting a hand-typed league also deletes its own week-ledger rows (ff_weeks, league key `manual:<id>`), owner-scoped. Sweep 8: a deleted league's week-5 row stayed behind in every later league's record. Guard: tests/fantasy-week-record-league.test.js.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Deleting a hand-typed league also deletes its own start/sit calls (ff_calls, league_id `manual:<id>`), owner-scoped; they stayed behind after the league and its weeks were gone. Guard: tests/fantasy-week-record-league.test.js and the real-PostgreSQL tests/fantasy-isolation.spec.ts.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | A scoring table that gives every stat 0 points is refused (zeroScoringReason). Sweep 9: a league saved with the form's "0 = 0" line projected every player 0.0 and the boards still advised on it ("Your lineup is already the best legal one"). The boards refuse such a league from either source with the same reason. Guard: tests/fantasy-zero-scoring.test.js.
 *
 * @module fantasy-manual
 */

import type { Pool } from 'pg';
import type { LineupSlot, ScoringItem } from './fantasy-scoring';
import type { LeagueContext } from './fantasy-context';

/** Bounds that keep a hand-typed league a league, not a payload. */
export const MANUAL_LIMITS = { teams: 20, roster: 30, scoring: 200, slots: 20, schedule: 400, name: 120 } as const;

/** One team in a hand-typed league. */
export interface ManualTeam {
  teamId: number;
  name: string;
  /** Exactly one team is yours. */
  mine: boolean;
  /** Every player on the roster, by ESPN player id. */
  roster: number[];
  /** The players started this week (a subset of the roster). */
  starting: number[];
}

/** A hand-typed league. */
export interface ManualLeague {
  name: string;
  season: number;
  scoring: ScoringItem[];
  slots: LineupSlot[];
  teams: ManualTeam[];
  schedule: Array<{ week: number; home: number; away: number | null }>;
  /** Pro-team id → bye week. */
  byes: Record<string, number>;
  faab: { budget: number; spent: number } | null;
  lastWeek: number;
  playoffStart: number | null;
}

/** The result of validating a submitted league. */
export type ManualParse = { ok: true; league: ManualLeague } | { ok: false; errors: string[] };

/** A finite integer within [lo, hi], else null. */
function int(v: unknown, lo: number, hi: number): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}

/** A list of distinct integer player ids, else null. */
function idList(v: unknown, max: number): number[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const ids = v.map((x) => int(x, 1, 2_147_483_647));
  return ids.every((x) => x !== null) && new Set(ids).size === ids.length ? ids as number[] : null;
}

/**
 * @description Why a scoring table cannot rank anyone: no rule, or every rule worth 0 points. Under such a table
 * every player projects 0.0, so a lineup, a waiver board or a trade drawn from it is noise presented as advice.
 * Nothing here says what a stat id means; it only checks that the league's own table scores something.
 * @param scoring - The league's {statId, points} rules.
 * @returns The reason in words, or null when at least one rule is worth points.
 */
export function zeroScoringReason(scoring: readonly ScoringItem[] | null | undefined): string | null {
  const rules = Array.isArray(scoring) ? scoring : [];
  if (rules.some((r) => Number.isFinite(r.points) && r.points !== 0)) return null;
  return rules.length
    ? `this league's scoring gives every stat 0 points (${rules.length} rule${rules.length === 1 ? '' : 's'}), so every player would project 0.0. `
      + "Enter the league's own scoring as ESPN stat id = points, one rule per line, as its settings state it."
    : "this league has no scoring rules, so every player would project 0.0. Enter the league's own scoring as ESPN stat id = points.";
}

/**
 * @description The answer a lineup or board gives for a league whose scoring scores nothing: the league, the team
 * and why, with no numbers and nothing recorded.
 * @param ctx - The league.
 * @param reason - zeroScoringReason's words.
 * @returns The body.
 */
export function scoringRefusedBody(ctx: LeagueContext, reason: string): Record<string, unknown> {
  return {
    source: ctx.source,
    league: { name: ctx.settings.name, leagueId: ctx.key, season: ctx.season, week: ctx.week },
    team: { teamId: ctx.own.teamId, name: ctx.own.name },
    scoring: { ok: false, reason },
    projectionsAvailable: 0,
    optimal: null,
    meanOptimal: null,
    calls: [],
    recorded: false,
  };
}

/**
 * @description Validate the scoring rules and the starting slots.
 * @param body - The submitted document.
 * @param errors - Collector.
 * @returns The parsed rules and slots.
 */
function parseRules(body: any, errors: string[]): { scoring: ScoringItem[]; slots: LineupSlot[] } {
  const scoring: ScoringItem[] = [];
  if (!Array.isArray(body?.scoring) || !body.scoring.length || body.scoring.length > MANUAL_LIMITS.scoring) {
    errors.push(`scoring must be 1-${MANUAL_LIMITS.scoring} {statId, points} rules`);
  } else {
    for (const r of body.scoring) {
      const statId = int(r?.statId, 0, 100_000);
      const points = Number(r?.points);
      if (statId === null || !Number.isFinite(points)) errors.push('each scoring rule needs an integer statId and a numeric points value');
      else scoring.push({ statId, points });
    }
    const zero = scoring.length === body.scoring.length ? zeroScoringReason(scoring) : null;
    if (zero) errors.push(`scoring: ${zero}`);
  }
  const slots: LineupSlot[] = [];
  if (!Array.isArray(body?.slots) || !body.slots.length || body.slots.length > MANUAL_LIMITS.slots) {
    errors.push(`slots must be 1-${MANUAL_LIMITS.slots} {slotId, count} starting slots`);
  } else {
    for (const s of body.slots) {
      const slotId = int(s?.slotId, 0, 100);
      const count = int(s?.count, 1, 10);
      if (slotId === null || count === null || slotId === 20 || slotId === 21) errors.push('each slot needs a starting slotId (not bench 20 or IR 21) and a count of 1-10');
      else slots.push({ slotId, count });
    }
  }
  return { scoring, slots };
}

/**
 * @description Validate the teams: bounded rosters of distinct ids, starters on the roster, exactly
 * one team marked as yours.
 * @param body - The submitted document.
 * @param errors - Collector.
 * @returns The parsed teams.
 */
function parseTeams(body: any, errors: string[]): ManualTeam[] {
  if (!Array.isArray(body?.teams) || body.teams.length < 2 || body.teams.length > MANUAL_LIMITS.teams) {
    errors.push(`teams must list 2-${MANUAL_LIMITS.teams} teams`);
    return [];
  }
  const teams: ManualTeam[] = [];
  for (const t of body.teams) {
    const teamId = int(t?.teamId, 1, 1000);
    const roster = idList(t?.roster, MANUAL_LIMITS.roster);
    const starting = idList(t?.starting ?? [], MANUAL_LIMITS.roster);
    if (teamId === null || !roster || !starting) { errors.push('each team needs an integer teamId and a roster/starting list of distinct ESPN player ids'); continue; }
    if (starting.some((id) => !roster.includes(id))) errors.push(`team ${teamId}: every starter must be on its roster`);
    teams.push({ teamId, name: String(t?.name || `Team ${teamId}`).slice(0, MANUAL_LIMITS.name), mine: t?.mine === true, roster, starting });
  }
  if (new Set(teams.map((t) => t.teamId)).size !== teams.length) errors.push('teamId values must be distinct');
  if (teams.filter((t) => t.mine).length !== 1) errors.push('exactly one team must be marked mine: true');
  return teams;
}

/**
 * @description Validate the schedule, byes, FAAB and season shape.
 * @param body - The submitted document.
 * @param teams - The parsed teams.
 * @param errors - Collector.
 * @returns The parsed fields.
 */
function parseSeason(body: any, teams: ManualTeam[], errors: string[]): Pick<ManualLeague, 'schedule' | 'byes' | 'faab' | 'lastWeek' | 'playoffStart'> {
  const ids = new Set(teams.map((t) => t.teamId));
  const schedule: ManualLeague['schedule'] = [];
  for (const m of Array.isArray(body?.schedule) ? body.schedule.slice(0, MANUAL_LIMITS.schedule) : []) {
    const week = int(m?.week, 1, 25);
    const home = int(m?.home, 1, 1000);
    const away = m?.away === null || m?.away === undefined ? null : int(m.away, 1, 1000);
    if (week === null || home === null || !ids.has(home) || (away !== null && !ids.has(away))) errors.push('each schedule entry needs a week of 1-25 and home/away teamIds from teams');
    else schedule.push({ week, home, away });
  }
  const byes: Record<string, number> = {};
  for (const [team, week] of Object.entries(body?.byes && typeof body.byes === 'object' ? body.byes : {})) {
    const w = int(week, 1, 25);
    if (int(team, 0, 1000) === null || w === null) errors.push('byes maps a pro-team id to its bye week (1-25)');
    else byes[String(Number(team))] = w;
  }
  const faab = body?.faab ? { budget: int(body.faab.budget, 0, 100_000), spent: int(body.faab.spent ?? 0, 0, 100_000) } : null;
  if (faab && (faab.budget === null || faab.spent === null)) errors.push('faab needs whole-dollar budget and spent values');
  const lastWeek = int(body?.lastWeek ?? 17, 1, 25);
  const playoffStart = body?.playoffStart === null || body?.playoffStart === undefined ? null : int(body.playoffStart, 1, 25);
  if (lastWeek === null) errors.push('lastWeek must be 1-25');
  if (body?.playoffStart !== undefined && body?.playoffStart !== null && playoffStart === null) errors.push('playoffStart must be 1-25');
  return { schedule, byes, faab: faab && faab.budget !== null ? { budget: faab.budget, spent: faab.spent as number } : null, lastWeek: lastWeek ?? 17, playoffStart };
}

/**
 * @description Validate a submitted hand-typed league.
 * @param body - The request body.
 * @returns The league, or every problem found.
 */
export function parseManualLeague(body: unknown): ManualParse {
  const b = body as any;
  const errors: string[] = [];
  const name = String(b?.name || '').trim();
  if (!name || name.length > MANUAL_LIMITS.name) errors.push(`name is required (at most ${MANUAL_LIMITS.name} characters)`);
  const season = int(b?.season, 2000, 2100);
  if (season === null) errors.push('season must be a year');
  const { scoring, slots } = parseRules(b, errors);
  const teams = parseTeams(b, errors);
  const rest = parseSeason(b, teams, errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, league: { name, season: season as number, scoring, slots, teams, ...rest } };
}

/** A stored hand-typed league. */
export interface StoredManualLeague {
  id: number;
  league: ManualLeague;
  updatedAt: string;
}

/**
 * @description Create a hand-typed league for the caller, or replace one of theirs by id.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param league - The validated league.
 * @param id - The caller's league to replace, or null to create.
 * @returns The id, or null when the id is not the caller's.
 */
export async function saveManualLeague(pool: Pool, userSub: string, league: ManualLeague, id: number | null): Promise<number | null> {
  if (id === null) {
    const r = await pool.query(
      'INSERT INTO ff_manual_leagues (user_sub, name, season, doc) VALUES ($1,$2,$3,$4) RETURNING id',
      [userSub, league.name, league.season, JSON.stringify(league)],
    );
    return Number(r.rows[0].id);
  }
  const r = await pool.query(
    'UPDATE ff_manual_leagues SET name = $3, season = $4, doc = $5, updated_at = now() WHERE user_sub = $1 AND id = $2 RETURNING id',
    [userSub, id, league.name, league.season, JSON.stringify(league)],
  );
  return r.rows.length ? Number(r.rows[0].id) : null;
}

/**
 * @description One of the caller's hand-typed leagues.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param id - League id.
 * @returns The league, or null when it is not the caller's.
 */
export async function readManualLeague(pool: Pool, userSub: string, id: number): Promise<StoredManualLeague | null> {
  const r = await pool.query('SELECT id, doc, updated_at FROM ff_manual_leagues WHERE user_sub = $1 AND id = $2', [userSub, id]);
  if (!r.rows.length) return null;
  return { id: Number(r.rows[0].id), league: r.rows[0].doc as ManualLeague, updatedAt: new Date(r.rows[0].updated_at).toISOString() };
}

/**
 * @description The caller's hand-typed leagues, newest first, without their documents.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @returns Summaries.
 */
export async function listManualLeagues(pool: Pool, userSub: string): Promise<Array<{ id: number; name: string; season: number; updatedAt: string }>> {
  const r = await pool.query(
    'SELECT id, name, season, updated_at FROM ff_manual_leagues WHERE user_sub = $1 ORDER BY updated_at DESC LIMIT 50',
    [userSub],
  );
  return r.rows.map((x: any) => ({ id: Number(x.id), name: x.name, season: Number(x.season), updatedAt: new Date(x.updated_at).toISOString() }));
}

/**
 * @description Delete one of the caller's hand-typed leagues with its own week-ledger and start/sit call rows, so the
 * league's weeks and calls never linger in another league's record.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param id - League id.
 * @returns League rows removed.
 */
export async function deleteManualLeague(pool: Pool, userSub: string, id: number): Promise<number> {
  const r = await pool.query('DELETE FROM ff_manual_leagues WHERE user_sub = $1 AND id = $2', [userSub, id]);
  await pool.query('DELETE FROM ff_weeks WHERE user_sub = $1 AND league_key = $2', [userSub, `manual:${id}`]);
  await pool.query('DELETE FROM ff_calls WHERE user_sub = $1 AND league_id = $2', [userSub, `manual:${id}`]);
  return r.rowCount || 0;
}
