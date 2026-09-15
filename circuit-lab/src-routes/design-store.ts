/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The `board` column (the breadboard beside the schematic, or NULL).
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — every SQL statement the package runs, in one
 *                     |                             | file, each carrying `owner_sub = $n` in addition to the owner
 *                     |                             | RLS the migration installs (belt and braces). A design's parts
 *                     |                             | and wires are JSONB columns rewritten whole on every change; a
 *                     |                             | run row is inserted only by a successful solve, so the run
 *                     |                             | history never lies about what was solved.
 */

import type { AppContext } from '@/app/composition/app-context';
import type { BoardLayout } from './board-bridge';
import type { CircuitPart, CircuitWire, SimSettings } from './circuit-contract';

/** @description The pool surface package routes ride on — derived from the framework's own type. */
export type QueryablePool = AppContext['pool'];

/** @description A design row as the API returns it. */
export interface DesignRow {
  design_id: string;
  owner_sub: string;
  title: string;
  parts: CircuitPart[];
  wires: CircuitWire[];
  sim: SimSettings;
  run_count: number;
  state: 'draft' | 'ran' | 'failed';
  report: Record<string, unknown> | null;
  failure_reason: string | null;
  source: Record<string, unknown>;
  board: BoardLayout | null;
  created_at: string;
  updated_at: string;
}

/** @description A run row. */
export interface RunRow {
  design_id: string;
  run: number;
  parts: CircuitPart[];
  wires: CircuitWire[];
  sim: SimSettings;
  report: Record<string, unknown>;
  engine_build: string | null;
  ms: number | null;
  created_at: string;
}

const COLUMNS = 'design_id, owner_sub, title, parts, wires, sim, run_count, state, report, failure_reason, source, board, created_at, updated_at';

/** @description The caller's designs, newest first. */
export async function listDesigns(pool: QueryablePool, sub: string): Promise<DesignRow[]> {
  const r = await pool.query(`SELECT ${COLUMNS} FROM circuit_design WHERE owner_sub = $1 ORDER BY updated_at DESC, design_id`, [sub]);
  return r.rows as DesignRow[];
}

/** @description One design, or null. */
export async function getDesign(pool: QueryablePool, sub: string, designId: string): Promise<DesignRow | null> {
  const r = await pool.query(`SELECT ${COLUMNS} FROM circuit_design WHERE owner_sub = $1 AND design_id = $2`, [sub, designId]);
  return (r.rows[0] as DesignRow | undefined) ?? null;
}

/** @description Create a design in draft state. */
export async function createDesign(pool: QueryablePool, sub: string, input: { title: string; parts: CircuitPart[]; wires: CircuitWire[]; sim: SimSettings; source: Record<string, unknown> }): Promise<DesignRow> {
  const r = await pool.query(
    `INSERT INTO circuit_design (owner_sub, title, parts, wires, sim, source) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb) RETURNING ${COLUMNS}`,
    [sub, input.title, JSON.stringify(input.parts), JSON.stringify(input.wires), JSON.stringify(input.sim), JSON.stringify(input.source)],
  );
  return r.rows[0] as DesignRow;
}

/** @description Update title / parts / wires / sim / board (whatever is given; board null clears it). */
export async function updateDesign(pool: QueryablePool, sub: string, designId: string, patch: { title?: string; parts?: CircuitPart[]; wires?: CircuitWire[]; sim?: SimSettings; board?: BoardLayout | null }): Promise<DesignRow | null> {
  const sets: string[] = ['updated_at = now()'];
  const values: unknown[] = [sub, designId];
  const add = (column: string, value: unknown, cast = '') => { values.push(value); sets.push(`${column} = $${values.length}${cast}`); };
  if (patch.title !== undefined) add('title', patch.title);
  if (patch.parts !== undefined) add('parts', JSON.stringify(patch.parts), '::jsonb');
  if (patch.wires !== undefined) add('wires', JSON.stringify(patch.wires), '::jsonb');
  if (patch.sim !== undefined) add('sim', JSON.stringify(patch.sim), '::jsonb');
  if (patch.board !== undefined) add('board', patch.board === null ? null : JSON.stringify(patch.board), '::jsonb');
  const r = await pool.query(`UPDATE circuit_design SET ${sets.join(', ')} WHERE owner_sub = $1 AND design_id = $2 RETURNING ${COLUMNS}`, values);
  return (r.rows[0] as DesignRow | undefined) ?? null;
}

/** @description Record a successful solve: bump the run count, store the report, insert the run row. */
export async function recordRun(pool: QueryablePool, sub: string, designId: string, run: { parts: CircuitPart[]; wires: CircuitWire[]; sim: SimSettings; report: Record<string, unknown>; engineBuild: string | null; ms: number }): Promise<DesignRow | null> {
  const r = await pool.query(
    `UPDATE circuit_design SET run_count = run_count + 1, state = 'ran', report = $3::jsonb, failure_reason = NULL, updated_at = now()
     WHERE owner_sub = $1 AND design_id = $2 RETURNING ${COLUMNS}`,
    [sub, designId, JSON.stringify(run.report)],
  );
  const row = r.rows[0] as DesignRow | undefined;
  if (!row) return null;
  await pool.query(
    'INSERT INTO circuit_run (design_id, run, owner_sub, parts, wires, sim, report, engine_build, ms) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)',
    [designId, row.run_count, sub, JSON.stringify(run.parts), JSON.stringify(run.wires), JSON.stringify(run.sim), JSON.stringify(run.report), run.engineBuild, run.ms],
  );
  return row;
}

/** @description Record a solve that produced nothing (engine down, circuit refused). The last run stays. */
export async function recordFailure(pool: QueryablePool, sub: string, designId: string, reason: string): Promise<DesignRow | null> {
  const r = await pool.query(
    `UPDATE circuit_design SET state = 'failed', failure_reason = $3, updated_at = now() WHERE owner_sub = $1 AND design_id = $2 RETURNING ${COLUMNS}`,
    [sub, designId, reason.slice(0, 2000)],
  );
  return (r.rows[0] as DesignRow | undefined) ?? null;
}

/** @description Delete a design (runs cascade). Returns true when a row went. */
export async function deleteDesign(pool: QueryablePool, sub: string, designId: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM circuit_design WHERE owner_sub = $1 AND design_id = $2', [sub, designId]);
  return (r.rowCount ?? 0) > 0;
}

/** @description Run history, newest first (compact: no part lists or reports). */
export async function listRuns(pool: QueryablePool, sub: string, designId: string): Promise<Array<{ run: number; engine_build: string | null; ms: number | null; created_at: string; partCount: number; warningCount: number }>> {
  const r = await pool.query(
    `SELECT run, engine_build, ms, created_at, jsonb_array_length(parts) AS "partCount", jsonb_array_length(coalesce(report->'warnings', '[]'::jsonb)) AS "warningCount"
     FROM circuit_run WHERE owner_sub = $1 AND design_id = $2 ORDER BY run DESC LIMIT 200`, [sub, designId]);
  return r.rows;
}

/** @description One run with its circuit and report, or null. */
export async function getRun(pool: QueryablePool, sub: string, designId: string, run: number): Promise<RunRow | null> {
  const r = await pool.query('SELECT design_id, run, parts, wires, sim, report, engine_build, ms, created_at FROM circuit_run WHERE owner_sub = $1 AND design_id = $2 AND run = $3', [sub, designId, run]);
  return (r.rows[0] as RunRow | undefined) ?? null;
}
