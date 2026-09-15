/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The owner-scoped plan store: every statement carries
 *                     |                             | `owner_sub = $n` on top of the migration's owner RLS (belt and
 *                     |                             | braces). A plan row holds the validated spec, the plan sized
 *                     |                             | from it and the last simulated run; a spec change clears the
 *                     |                             | run so a stored result can never describe a different chain.
 *                     |                             | The list never carries the frames — only the last metrics.
 */

import type { AppContext } from '@/app/composition/app-context';
import type { ChainPlan, ChainSpec, SimResult } from './engine';

/** @description The pool surface package routes ride on — derived from the framework's own type. */
export type QueryablePool = AppContext['pool'];

/** @description A plan row as the API returns it. */
export interface PlanRow {
  plan_id: string;
  owner_sub: string;
  title: string;
  spec: ChainSpec;
  plan: ChainPlan;
  last_sim: SimResult | null;
  created_at: string;
  updated_at: string;
}

/** @description A plan row in a list: the last run's metrics stand in for the whole run. */
export interface PlanListRow {
  plan_id: string;
  owner_sub: string;
  title: string;
  spec: ChainSpec;
  plan: ChainPlan;
  last_metrics: SimResult['metrics'] | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'plan_id, owner_sub, title, spec, plan, last_sim, created_at, updated_at';
const LIST_COLUMNS = "plan_id, owner_sub, title, spec, plan, (last_sim->'metrics') AS last_metrics, created_at, updated_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @description Refuse anything that is not a UUID before it reaches SQL.
 * @param value - Candidate.
 * @returns The lower-cased UUID.
 */
export function requireUuid(value: unknown): string {
  const s = String(value ?? '').trim().toLowerCase();
  if (!UUID.test(s)) throw new RangeError('id must be a UUID');
  return s;
}

/** @description The caller's plans, newest first, without run frames. */
export async function listPlans(pool: QueryablePool, sub: string): Promise<PlanListRow[]> {
  const r = await pool.query(`SELECT ${LIST_COLUMNS} FROM drone_relay_plan WHERE owner_sub = $1 ORDER BY updated_at DESC, plan_id`, [sub]);
  return r.rows as PlanListRow[];
}

/** @description One plan with its last run, or null. */
export async function getPlan(pool: QueryablePool, sub: string, planId: string): Promise<PlanRow | null> {
  const r = await pool.query(`SELECT ${COLUMNS} FROM drone_relay_plan WHERE owner_sub = $1 AND plan_id = $2`, [sub, planId]);
  return (r.rows[0] as PlanRow | undefined) ?? null;
}

/** @description Create a plan from a validated spec and its sized plan. */
export async function createPlan(pool: QueryablePool, sub: string, input: { title: string; spec: ChainSpec; plan: ChainPlan }): Promise<PlanRow> {
  const r = await pool.query(
    `INSERT INTO drone_relay_plan (owner_sub, title, spec, plan) VALUES ($1, $2, $3::jsonb, $4::jsonb) RETURNING ${COLUMNS}`,
    [sub, input.title, JSON.stringify(input.spec), JSON.stringify(input.plan)],
  );
  return r.rows[0] as PlanRow;
}

/** @description Replace the spec and plan (the last run is cleared: it described a different chain). */
export async function updatePlan(pool: QueryablePool, sub: string, planId: string, input: { title: string; spec: ChainSpec; plan: ChainPlan }): Promise<PlanRow | null> {
  const r = await pool.query(
    `UPDATE drone_relay_plan SET title = $3, spec = $4::jsonb, plan = $5::jsonb, last_sim = NULL, updated_at = now() WHERE owner_sub = $1 AND plan_id = $2 RETURNING ${COLUMNS}`,
    [sub, planId, input.title, JSON.stringify(input.spec), JSON.stringify(input.plan)],
  );
  return (r.rows[0] as PlanRow | undefined) ?? null;
}

/** @description Store the last simulated run. */
export async function saveRun(pool: QueryablePool, sub: string, planId: string, sim: SimResult): Promise<PlanRow | null> {
  const r = await pool.query(
    `UPDATE drone_relay_plan SET last_sim = $3::jsonb, updated_at = now() WHERE owner_sub = $1 AND plan_id = $2 RETURNING ${COLUMNS}`,
    [sub, planId, JSON.stringify(sim)],
  );
  return (r.rows[0] as PlanRow | undefined) ?? null;
}

/** @description Delete a plan; true when a row went. */
export async function deletePlan(pool: QueryablePool, sub: string, planId: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM drone_relay_plan WHERE owner_sub = $1 AND plan_id = $2', [sub, planId]);
  return (r.rowCount ?? 0) > 0;
}
