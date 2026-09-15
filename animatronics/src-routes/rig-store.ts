/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — every SQL statement the package runs, in one
 *                     |                             | file, each carrying `owner_sub = $n` on top of the owner RLS
 *                     |                             | the migration installs. A rig row holds the rig, its pose and
 *                     |                             | scenario libraries, the ARMED flag and the pose the server
 *                     |                             | believes the prop is in; a run row is the command log — every
 *                     |                             | rehearsal, arm, play, look-at, jog and disarm with its report.
 */

import type { AppContext } from '@/app/composition/app-context';
import type { RigSpec } from './engine/rig-contract';
import type { Pose, Scenario } from './engine/scenario';

/** @description The pool surface package routes ride on — derived from the framework's own type. */
export type QueryablePool = AppContext['pool'];

/** @description A rig row as the API returns it. */
export interface RigRow {
  rig_id: string;
  owner_sub: string;
  title: string;
  rig: RigSpec;
  poses: Record<string, Pose>;
  scenarios: Record<string, Scenario>;
  armed: boolean;
  armed_at: string | null;
  current_pose: Pose;
  run_count: number;
  last_report: Record<string, unknown> | null;
  source: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** @description The kinds a run row may record. */
export type RunKind = 'rehearse' | 'arm' | 'disarm' | 'play' | 'look-at' | 'jog';

const COLUMNS = 'rig_id, owner_sub, title, rig, poses, scenarios, armed, armed_at, current_pose, run_count, last_report, source, created_at, updated_at';

/** @description The caller's rigs, newest first. */
export async function listRigs(pool: QueryablePool, sub: string): Promise<RigRow[]> {
  const r = await pool.query(`SELECT ${COLUMNS} FROM animatronic_rig WHERE owner_sub = $1 ORDER BY updated_at DESC, rig_id`, [sub]);
  return r.rows as RigRow[];
}

/** @description One rig, or null. */
export async function getRig(pool: QueryablePool, sub: string, rigId: string): Promise<RigRow | null> {
  const r = await pool.query(`SELECT ${COLUMNS} FROM animatronic_rig WHERE owner_sub = $1 AND rig_id = $2`, [sub, rigId]);
  return (r.rows[0] as RigRow | undefined) ?? null;
}

/** @description Create a rig (disarmed, at its neutral pose). */
export async function createRig(pool: QueryablePool, sub: string, input: { title: string; rig: RigSpec; poses: Record<string, Pose>; scenarios: Record<string, Scenario>; currentPose: Pose; source: Record<string, unknown> }): Promise<RigRow> {
  const r = await pool.query(
    `INSERT INTO animatronic_rig (owner_sub, title, rig, poses, scenarios, current_pose, source) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb) RETURNING ${COLUMNS}`,
    [sub, input.title, JSON.stringify(input.rig), JSON.stringify(input.poses), JSON.stringify(input.scenarios), JSON.stringify(input.currentPose), JSON.stringify(input.source)],
  );
  return r.rows[0] as RigRow;
}

/** @description Update whatever is given (a rig change disarms and re-neutralises the pose when asked). */
export async function updateRig(pool: QueryablePool, sub: string, rigId: string, patch: { title?: string; rig?: RigSpec; poses?: Record<string, Pose>; scenarios?: Record<string, Scenario>; currentPose?: Pose; armed?: boolean; lastReport?: Record<string, unknown> | null }): Promise<RigRow | null> {
  const sets: string[] = ['updated_at = now()'];
  const values: unknown[] = [sub, rigId];
  const add = (column: string, value: unknown, cast = '') => { values.push(value); sets.push(`${column} = $${values.length}${cast}`); };
  if (patch.title !== undefined) add('title', patch.title);
  if (patch.rig !== undefined) add('rig', JSON.stringify(patch.rig), '::jsonb');
  if (patch.poses !== undefined) add('poses', JSON.stringify(patch.poses), '::jsonb');
  if (patch.scenarios !== undefined) add('scenarios', JSON.stringify(patch.scenarios), '::jsonb');
  if (patch.currentPose !== undefined) add('current_pose', JSON.stringify(patch.currentPose), '::jsonb');
  if (patch.armed !== undefined) { add('armed', patch.armed); sets.push(patch.armed ? 'armed_at = now()' : 'armed_at = NULL'); }
  if (patch.lastReport !== undefined) add('last_report', patch.lastReport === null ? null : JSON.stringify(patch.lastReport), '::jsonb');
  const r = await pool.query(`UPDATE animatronic_rig SET ${sets.join(', ')} WHERE owner_sub = $1 AND rig_id = $2 RETURNING ${COLUMNS}`, values);
  return (r.rows[0] as RigRow | undefined) ?? null;
}

/** @description Append a run (command-log) row and bump the rig's run count. */
export async function recordRun(pool: QueryablePool, sub: string, rigId: string, run: { kind: RunKind; scenario: string | null; report: Record<string, unknown>; frames: number }): Promise<number> {
  const r = await pool.query('UPDATE animatronic_rig SET run_count = run_count + 1, updated_at = now() WHERE owner_sub = $1 AND rig_id = $2 RETURNING run_count', [sub, rigId]);
  const n = Number((r.rows[0] as { run_count: number } | undefined)?.run_count ?? 0);
  if (!n) return 0;
  await pool.query('INSERT INTO animatronic_run (rig_id, run, owner_sub, kind, scenario, report, frames) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)', [rigId, n, sub, run.kind, run.scenario, JSON.stringify(run.report), run.frames]);
  return n;
}

/** @description Delete a rig (runs cascade). */
export async function deleteRig(pool: QueryablePool, sub: string, rigId: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM animatronic_rig WHERE owner_sub = $1 AND rig_id = $2', [sub, rigId]);
  return (r.rowCount ?? 0) > 0;
}

/** @description The command log, newest first. */
export async function listRuns(pool: QueryablePool, sub: string, rigId: string): Promise<Array<{ run: number; kind: RunKind; scenario: string | null; frames: number; created_at: string; verdict: string | null }>> {
  const r = await pool.query(`SELECT run, kind, scenario, frames, created_at, report->'verdict'->>'summary' AS verdict FROM animatronic_run WHERE owner_sub = $1 AND rig_id = $2 ORDER BY run DESC LIMIT 200`, [sub, rigId]);
  return r.rows;
}
