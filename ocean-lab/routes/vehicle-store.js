"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the three durable tables behind the explorer
 *                     |                             | record: a VEHICLE (owner, kind, name, the authored design
 *                     |                             | vector, its provenance), its LIMIT rows (the kind's "What is
 *                     |                             | not true" sentences copied onto the vehicle in the SAME
 *                     |                             | statement that creates it, so a vehicle never exists without
 *                     |                             | them), and its RUNS (medium id, plant, the vector fingerprint
 *                     |                             | each was recorded at, the engine fingerprints that answered,
 *                     |                             | the result). Owner-scoped SQL only, on top of the migration's
 *                     |                             | FORCEd owner RLS; the stage is never written here because it
 *                     |                             | is computed on read (D2).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertVehicleWithLimits = insertVehicleWithLimits;
exports.getVehicle = getVehicle;
exports.findVehicleByName = findVehicleByName;
exports.listVehicles = listVehicles;
exports.updateDesignVector = updateDesignVector;
exports.deleteVehicle = deleteVehicle;
exports.listLimits = listLimits;
exports.insertRun = insertRun;
exports.listRuns = listRuns;
const VEHICLE_COLUMNS = 'vehicle_id, owner_sub, kind, name, design_vector, provenance, created_at, updated_at';
const LIMIT_COLUMNS = 'vehicle_id, owner_sub, limit_id, sentence, retire_when, blocking, status, retired_evidence, created_at';
const RUN_COLUMNS = 'run_id, vehicle_id, owner_sub, sequence, medium_id, plant, vector_fingerprint, engine_fingerprints, result, created_at';
/** @description Persist a vehicle AND its limit rows in one statement, so no vehicle exists without its "What is not true" rows (D4).
 * @param pool - The pool. @param sub - Owner. @param kind - The kind. @param name - The vehicle's name. @param designVector - The authored part. @param provenance - Where the vector came from. @param limits - The kind's limit rows.
 * @returns The stored vehicle row. */
async function insertVehicleWithLimits(pool, sub, kind, name, designVector, provenance, limits) {
    const r = await pool.query(`WITH v AS (
       INSERT INTO ocean_lab_vehicle (owner_sub, kind, name, design_vector, provenance) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       RETURNING ${VEHICLE_COLUMNS}
     ), l AS (
       INSERT INTO ocean_lab_vehicle_limit (vehicle_id, owner_sub, limit_id, sentence, retire_when, blocking)
       SELECT v.vehicle_id, $1, x.id, x.sentence, x.retire_when, x.blocking
         FROM v, jsonb_to_recordset($6::jsonb) AS x(id text, sentence text, retire_when text, blocking boolean)
       RETURNING limit_id
     )
     SELECT v.*, (SELECT count(*)::int FROM l) AS limit_count FROM v`, [sub, kind, name, JSON.stringify(designVector), JSON.stringify(provenance), JSON.stringify(limits.map((l) => ({ id: l.id, sentence: l.sentence, retire_when: l.retireWhen, blocking: l.blocking })))]);
    const row = { ...r.rows[0] };
    delete row.limit_count;
    return row;
}
/** @description One vehicle by id, owner-scoped. @param pool - The pool. @param sub - Owner. @param vehicleId - The vehicle. @returns The row, or null when it is not this owner's. */
async function getVehicle(pool, sub, vehicleId) {
    const r = await pool.query(`SELECT ${VEHICLE_COLUMNS} FROM ocean_lab_vehicle WHERE owner_sub = $1 AND vehicle_id = $2`, [sub, vehicleId]);
    return r.rows[0] ?? null;
}
/** @description The owner's vehicle of a kind and name, for idempotent seeding. @param pool - The pool. @param sub - Owner. @param kind - The kind. @param name - The name. @returns The row or null. */
async function findVehicleByName(pool, sub, kind, name) {
    const r = await pool.query(`SELECT ${VEHICLE_COLUMNS} FROM ocean_lab_vehicle WHERE owner_sub = $1 AND kind = $2 AND name = $3`, [sub, kind, name]);
    return r.rows[0] ?? null;
}
/** @description The owner's vehicles, most recently changed first. @param pool - The pool. @param sub - Owner. @param limit - At most this many. @returns The rows. */
async function listVehicles(pool, sub, limit = 50) {
    const r = await pool.query(`SELECT ${VEHICLE_COLUMNS} FROM ocean_lab_vehicle WHERE owner_sub = $1 ORDER BY updated_at DESC LIMIT $2`, [sub, limit]);
    return r.rows;
}
/** @description Replace the authored vector. The stage drops by construction: no run is pinned to the new fingerprint (D2).
 * @param pool - The pool. @param sub - Owner. @param vehicleId - The vehicle. @param designVector - The new vector. @returns The updated row, or null when it is not this owner's. */
async function updateDesignVector(pool, sub, vehicleId, designVector) {
    const r = await pool.query(`UPDATE ocean_lab_vehicle SET design_vector = $3::jsonb, updated_at = now() WHERE owner_sub = $1 AND vehicle_id = $2 RETURNING ${VEHICLE_COLUMNS}`, [sub, vehicleId, JSON.stringify(designVector)]);
    return r.rows[0] ?? null;
}
/** @description Delete a vehicle and, by cascade, its limits and runs. @param pool - The pool. @param sub - Owner. @param vehicleId - The vehicle. @returns True when a row of this owner's was deleted. */
async function deleteVehicle(pool, sub, vehicleId) {
    const r = await pool.query('DELETE FROM ocean_lab_vehicle WHERE owner_sub = $1 AND vehicle_id = $2 RETURNING vehicle_id', [sub, vehicleId]);
    return r.rows.length > 0;
}
/** @description Every limit row of a vehicle, owner-scoped, in the order they were written. @param pool - The pool. @param sub - Owner. @param vehicleId - The vehicle. @returns The rows. */
async function listLimits(pool, sub, vehicleId) {
    const r = await pool.query(`SELECT ${LIMIT_COLUMNS} FROM ocean_lab_vehicle_limit WHERE owner_sub = $1 AND vehicle_id = $2 ORDER BY created_at ASC, limit_id ASC`, [sub, vehicleId]);
    return r.rows;
}
/** @description Record a run against a vehicle as the next sequence, at the vector fingerprint it was recorded at, with the engine that answered.
 * @param pool - The pool. @param sub - Owner. @param vehicleId - The vehicle. @param draft - Medium, plant, fingerprints and result.
 * @returns The stored row. */
async function insertRun(pool, sub, vehicleId, draft) {
    const r = await pool.query(`INSERT INTO ocean_lab_vehicle_run (vehicle_id, owner_sub, sequence, medium_id, plant, vector_fingerprint, engine_fingerprints, result)
       SELECT $1, $2, COALESCE(MAX(sequence), 0) + 1, $3, $4, $5, $6::jsonb, $7::jsonb FROM ocean_lab_vehicle_run WHERE vehicle_id = $1
     RETURNING ${RUN_COLUMNS}`, [vehicleId, sub, draft.mediumId, draft.plant, draft.vectorFingerprint, JSON.stringify(draft.engineFingerprints), JSON.stringify(draft.result)]);
    return r.rows[0];
}
/** @description Every run of a vehicle, in sequence, owner-scoped. @param pool - The pool. @param sub - Owner. @param vehicleId - The vehicle. @returns The rows. */
async function listRuns(pool, sub, vehicleId) {
    const r = await pool.query(`SELECT ${RUN_COLUMNS} FROM ocean_lab_vehicle_run WHERE owner_sub = $1 AND vehicle_id = $2 ORDER BY sequence ASC`, [sub, vehicleId]);
    return r.rows;
}
