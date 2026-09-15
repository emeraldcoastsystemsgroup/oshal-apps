"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireUuid = requireUuid;
exports.listPlans = listPlans;
exports.getPlan = getPlan;
exports.createPlan = createPlan;
exports.updatePlan = updatePlan;
exports.saveRun = saveRun;
exports.deletePlan = deletePlan;
const COLUMNS = 'plan_id, owner_sub, title, spec, plan, last_sim, created_at, updated_at';
const LIST_COLUMNS = "plan_id, owner_sub, title, spec, plan, (last_sim->'metrics') AS last_metrics, created_at, updated_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * @description Refuse anything that is not a UUID before it reaches SQL.
 * @param value - Candidate.
 * @returns The lower-cased UUID.
 */
function requireUuid(value) {
    const s = String(value ?? '').trim().toLowerCase();
    if (!UUID.test(s))
        throw new RangeError('id must be a UUID');
    return s;
}
/** @description The caller's plans, newest first, without run frames. */
async function listPlans(pool, sub) {
    const r = await pool.query(`SELECT ${LIST_COLUMNS} FROM drone_relay_plan WHERE owner_sub = $1 ORDER BY updated_at DESC, plan_id`, [sub]);
    return r.rows;
}
/** @description One plan with its last run, or null. */
async function getPlan(pool, sub, planId) {
    const r = await pool.query(`SELECT ${COLUMNS} FROM drone_relay_plan WHERE owner_sub = $1 AND plan_id = $2`, [sub, planId]);
    return r.rows[0] ?? null;
}
/** @description Create a plan from a validated spec and its sized plan. */
async function createPlan(pool, sub, input) {
    const r = await pool.query(`INSERT INTO drone_relay_plan (owner_sub, title, spec, plan) VALUES ($1, $2, $3::jsonb, $4::jsonb) RETURNING ${COLUMNS}`, [sub, input.title, JSON.stringify(input.spec), JSON.stringify(input.plan)]);
    return r.rows[0];
}
/** @description Replace the spec and plan (the last run is cleared: it described a different chain). */
async function updatePlan(pool, sub, planId, input) {
    const r = await pool.query(`UPDATE drone_relay_plan SET title = $3, spec = $4::jsonb, plan = $5::jsonb, last_sim = NULL, updated_at = now() WHERE owner_sub = $1 AND plan_id = $2 RETURNING ${COLUMNS}`, [sub, planId, input.title, JSON.stringify(input.spec), JSON.stringify(input.plan)]);
    return r.rows[0] ?? null;
}
/** @description Store the last simulated run. */
async function saveRun(pool, sub, planId, sim) {
    const r = await pool.query(`UPDATE drone_relay_plan SET last_sim = $3::jsonb, updated_at = now() WHERE owner_sub = $1 AND plan_id = $2 RETURNING ${COLUMNS}`, [sub, planId, JSON.stringify(sim)]);
    return r.rows[0] ?? null;
}
/** @description Delete a plan; true when a row went. */
async function deletePlan(pool, sub, planId) {
    const r = await pool.query('DELETE FROM drone_relay_plan WHERE owner_sub = $1 AND plan_id = $2', [sub, planId]);
    return (r.rowCount ?? 0) > 0;
}
//# sourceMappingURL=plan-store.js.map