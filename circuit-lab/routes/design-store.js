"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.listDesigns = listDesigns;
exports.getDesign = getDesign;
exports.createDesign = createDesign;
exports.updateDesign = updateDesign;
exports.recordRun = recordRun;
exports.recordFailure = recordFailure;
exports.deleteDesign = deleteDesign;
exports.listRuns = listRuns;
exports.getRun = getRun;
const COLUMNS = 'design_id, owner_sub, title, parts, wires, sim, run_count, state, report, failure_reason, source, board, created_at, updated_at';
/** @description The caller's designs, newest first. */
async function listDesigns(pool, sub) {
    const r = await pool.query(`SELECT ${COLUMNS} FROM circuit_design WHERE owner_sub = $1 ORDER BY updated_at DESC, design_id`, [sub]);
    return r.rows;
}
/** @description One design, or null. */
async function getDesign(pool, sub, designId) {
    const r = await pool.query(`SELECT ${COLUMNS} FROM circuit_design WHERE owner_sub = $1 AND design_id = $2`, [sub, designId]);
    return r.rows[0] ?? null;
}
/** @description Create a design in draft state. */
async function createDesign(pool, sub, input) {
    const r = await pool.query(`INSERT INTO circuit_design (owner_sub, title, parts, wires, sim, source) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb) RETURNING ${COLUMNS}`, [sub, input.title, JSON.stringify(input.parts), JSON.stringify(input.wires), JSON.stringify(input.sim), JSON.stringify(input.source)]);
    return r.rows[0];
}
/** @description Update title / parts / wires / sim / board (whatever is given; board null clears it). */
async function updateDesign(pool, sub, designId, patch) {
    const sets = ['updated_at = now()'];
    const values = [sub, designId];
    const add = (column, value, cast = '') => { values.push(value); sets.push(`${column} = $${values.length}${cast}`); };
    if (patch.title !== undefined)
        add('title', patch.title);
    if (patch.parts !== undefined)
        add('parts', JSON.stringify(patch.parts), '::jsonb');
    if (patch.wires !== undefined)
        add('wires', JSON.stringify(patch.wires), '::jsonb');
    if (patch.sim !== undefined)
        add('sim', JSON.stringify(patch.sim), '::jsonb');
    if (patch.board !== undefined)
        add('board', patch.board === null ? null : JSON.stringify(patch.board), '::jsonb');
    const r = await pool.query(`UPDATE circuit_design SET ${sets.join(', ')} WHERE owner_sub = $1 AND design_id = $2 RETURNING ${COLUMNS}`, values);
    return r.rows[0] ?? null;
}
/** @description Record a successful solve: bump the run count, store the report, insert the run row. */
async function recordRun(pool, sub, designId, run) {
    const r = await pool.query(`UPDATE circuit_design SET run_count = run_count + 1, state = 'ran', report = $3::jsonb, failure_reason = NULL, updated_at = now()
     WHERE owner_sub = $1 AND design_id = $2 RETURNING ${COLUMNS}`, [sub, designId, JSON.stringify(run.report)]);
    const row = r.rows[0];
    if (!row)
        return null;
    await pool.query('INSERT INTO circuit_run (design_id, run, owner_sub, parts, wires, sim, report, engine_build, ms) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)', [designId, row.run_count, sub, JSON.stringify(run.parts), JSON.stringify(run.wires), JSON.stringify(run.sim), JSON.stringify(run.report), run.engineBuild, run.ms]);
    return row;
}
/** @description Record a solve that produced nothing (engine down, circuit refused). The last run stays. */
async function recordFailure(pool, sub, designId, reason) {
    const r = await pool.query(`UPDATE circuit_design SET state = 'failed', failure_reason = $3, updated_at = now() WHERE owner_sub = $1 AND design_id = $2 RETURNING ${COLUMNS}`, [sub, designId, reason.slice(0, 2000)]);
    return r.rows[0] ?? null;
}
/** @description Delete a design (runs cascade). Returns true when a row went. */
async function deleteDesign(pool, sub, designId) {
    const r = await pool.query('DELETE FROM circuit_design WHERE owner_sub = $1 AND design_id = $2', [sub, designId]);
    return (r.rowCount ?? 0) > 0;
}
/** @description Run history, newest first (compact: no part lists or reports). */
async function listRuns(pool, sub, designId) {
    const r = await pool.query(`SELECT run, engine_build, ms, created_at, jsonb_array_length(parts) AS "partCount", jsonb_array_length(coalesce(report->'warnings', '[]'::jsonb)) AS "warningCount"
     FROM circuit_run WHERE owner_sub = $1 AND design_id = $2 ORDER BY run DESC LIMIT 200`, [sub, designId]);
    return r.rows;
}
/** @description One run with its circuit and report, or null. */
async function getRun(pool, sub, designId, run) {
    const r = await pool.query('SELECT design_id, run, parts, wires, sim, report, engine_build, ms, created_at FROM circuit_run WHERE owner_sub = $1 AND design_id = $2 AND run = $3', [sub, designId, run]);
    return r.rows[0] ?? null;
}
