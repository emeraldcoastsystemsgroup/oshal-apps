/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S4 — the two durable tables behind the vehicle record:
 *                     |                             | a VEHICLE (owner, kind, name, the authored design vector, its
 *                     |                             | provenance) and its EVALUATIONS (medium id, the vector
 *                     |                             | fingerprint each was computed at, the engine fingerprints that
 *                     |                             | answered, the result). Owner-scoped SQL only, on top of the
 *                     |                             | migration's FORCEd owner RLS; the stage is never written here
 *                     |                             | because it is computed on read (D2).
 */

import type { AppContext } from '@/app/composition/app-context';

/** @description The pool type the framework hands package routes. */
export type Pool = AppContext['pool'];

/** @description A vehicle row as returned to callers. */
export interface VehicleRow {
  vehicle_id: string;
  owner_sub: string;
  kind: string;
  name: string;
  design_vector: Record<string, unknown>;
  provenance: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** @description An evaluation row as returned to callers. */
export interface EvaluationRow {
  evaluation_id: string;
  vehicle_id: string;
  owner_sub: string;
  sequence: number;
  medium_id: string;
  vector_fingerprint: string;
  engine_fingerprints: Record<string, unknown>;
  result: Record<string, unknown>;
  created_at: string;
}

const VEHICLE_COLUMNS = 'vehicle_id, owner_sub, kind, name, design_vector, provenance, created_at, updated_at';
const EVALUATION_COLUMNS = 'evaluation_id, vehicle_id, owner_sub, sequence, medium_id, vector_fingerprint, engine_fingerprints, result, created_at';

/** @description Persist a vehicle: the authored vector and where it came from.
 * @param pool - The pool. @param sub - Owner. @param kind - The kind this lab owns. @param name - The vehicle's name. @param designVector - The authored part. @param provenance - Where the vector came from.
 * @returns The stored row. */
export async function insertVehicle(pool: Pool, sub: string, kind: string, name: string, designVector: Record<string, unknown>, provenance: Record<string, unknown>): Promise<VehicleRow> {
  const r = await pool.query(
    `INSERT INTO aero_lab_vehicle (owner_sub, kind, name, design_vector, provenance) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb) RETURNING ${VEHICLE_COLUMNS}`,
    [sub, kind, name, JSON.stringify(designVector), JSON.stringify(provenance)],
  );
  return r.rows[0] as VehicleRow;
}

/** @description One vehicle by id, owner-scoped. @param pool - The pool. @param sub - Owner. @param vehicleId - The vehicle. @returns The row, or null when it is not this owner's. */
export async function getVehicle(pool: Pool, sub: string, vehicleId: string): Promise<VehicleRow | null> {
  const r = await pool.query(`SELECT ${VEHICLE_COLUMNS} FROM aero_lab_vehicle WHERE owner_sub = $1 AND vehicle_id = $2`, [sub, vehicleId]);
  return (r.rows[0] as VehicleRow | undefined) ?? null;
}

/** @description The owner's vehicle of a kind and name, for idempotent seeding. @param pool - The pool. @param sub - Owner. @param kind - The kind. @param name - The name. @returns The row or null. */
export async function findVehicleByName(pool: Pool, sub: string, kind: string, name: string): Promise<VehicleRow | null> {
  const r = await pool.query(`SELECT ${VEHICLE_COLUMNS} FROM aero_lab_vehicle WHERE owner_sub = $1 AND kind = $2 AND name = $3`, [sub, kind, name]);
  return (r.rows[0] as VehicleRow | undefined) ?? null;
}

/** @description The owner's vehicles, most recently changed first. @param pool - The pool. @param sub - Owner. @param limit - At most this many. @returns The rows. */
export async function listVehicles(pool: Pool, sub: string, limit = 50): Promise<VehicleRow[]> {
  const r = await pool.query(`SELECT ${VEHICLE_COLUMNS} FROM aero_lab_vehicle WHERE owner_sub = $1 ORDER BY updated_at DESC LIMIT $2`, [sub, limit]);
  return r.rows as VehicleRow[];
}

/** @description Replace the authored vector. The stage drops by construction: no evaluation is pinned to the new fingerprint (D2).
 * @param pool - The pool. @param sub - Owner. @param vehicleId - The vehicle. @param designVector - The new vector. @returns The updated row, or null when it is not this owner's. */
export async function updateDesignVector(pool: Pool, sub: string, vehicleId: string, designVector: Record<string, unknown>): Promise<VehicleRow | null> {
  const r = await pool.query(
    `UPDATE aero_lab_vehicle SET design_vector = $3::jsonb, updated_at = now() WHERE owner_sub = $1 AND vehicle_id = $2 RETURNING ${VEHICLE_COLUMNS}`,
    [sub, vehicleId, JSON.stringify(designVector)],
  );
  return (r.rows[0] as VehicleRow | undefined) ?? null;
}

/** @description Record an evaluation against a vehicle, at the vector fingerprint it was computed at, with the engine that answered.
 * @param pool - The pool. @param sub - Owner. @param vehicleId - The vehicle. @param draft - Sequence, medium, fingerprints and result.
 * @returns The stored row. */
export async function insertEvaluation(
  pool: Pool,
  sub: string,
  vehicleId: string,
  draft: { sequence: number; mediumId: string; vectorFingerprint: string; engineFingerprints: Record<string, unknown>; result: Record<string, unknown> },
): Promise<EvaluationRow> {
  const r = await pool.query(
    `INSERT INTO aero_lab_vehicle_evaluation (vehicle_id, owner_sub, sequence, medium_id, vector_fingerprint, engine_fingerprints, result)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING ${EVALUATION_COLUMNS}`,
    [vehicleId, sub, draft.sequence, draft.mediumId, draft.vectorFingerprint, JSON.stringify(draft.engineFingerprints), JSON.stringify(draft.result)],
  );
  return r.rows[0] as EvaluationRow;
}

/** @description Every evaluation of a vehicle, in sequence, owner-scoped. @param pool - The pool. @param sub - Owner. @param vehicleId - The vehicle. @returns The rows. */
export async function listEvaluations(pool: Pool, sub: string, vehicleId: string): Promise<EvaluationRow[]> {
  const r = await pool.query(`SELECT ${EVALUATION_COLUMNS} FROM aero_lab_vehicle_evaluation WHERE owner_sub = $1 AND vehicle_id = $2 ORDER BY sequence ASC`, [sub, vehicleId]);
  return r.rows as EvaluationRow[];
}
