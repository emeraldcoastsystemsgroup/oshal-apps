"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — every SQL statement the package runs, in one
 *                     |                             | file, each carrying `owner_sub = $n` in addition to the owner
 *                     |                             | RLS the migration installs (belt and braces). A model's
 *                     |                             | feature list is one JSONB column rewritten whole on every
 *                     |                             | change; a revision row is inserted only by a successful
 *                     |                             | rebuild, so the revision history never lies about what built.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listModels = listModels;
exports.getModel = getModel;
exports.createModel = createModel;
exports.updateModel = updateModel;
exports.recordBuild = recordBuild;
exports.recordFailure = recordFailure;
exports.deleteModel = deleteModel;
exports.listRevisions = listRevisions;
exports.getRevision = getRevision;
const MODEL_COLUMNS = 'model_id, owner_sub, title, base, features, revision, state, report, feature_status, failure_reason, source, settings, created_at, updated_at';
/** @description The caller's models, newest first (base and features included: a list is a few KB). */
async function listModels(pool, sub) {
    const r = await pool.query(`SELECT ${MODEL_COLUMNS} FROM cad_model WHERE owner_sub = $1 ORDER BY updated_at DESC, model_id`, [sub]);
    return r.rows;
}
/** @description One model, or null. */
async function getModel(pool, sub, modelId) {
    const r = await pool.query(`SELECT ${MODEL_COLUMNS} FROM cad_model WHERE owner_sub = $1 AND model_id = $2`, [sub, modelId]);
    return r.rows[0] ?? null;
}
/** @description Create a model in draft state. */
async function createModel(pool, sub, input) {
    const r = await pool.query(`INSERT INTO cad_model (owner_sub, title, base, features, source, settings) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb) RETURNING ${MODEL_COLUMNS}`, [sub, input.title, JSON.stringify(input.base), JSON.stringify(input.features), JSON.stringify(input.source), JSON.stringify(input.settings)]);
    return r.rows[0];
}
/** @description Update title / base / features / settings (whatever is given). */
async function updateModel(pool, sub, modelId, patch) {
    const sets = ['updated_at = now()'];
    const values = [sub, modelId];
    const add = (column, value, cast = '') => { values.push(value); sets.push(`${column} = $${values.length}${cast}`); };
    if (patch.title !== undefined)
        add('title', patch.title);
    if (patch.base !== undefined)
        add('base', JSON.stringify(patch.base), '::jsonb');
    if (patch.features !== undefined)
        add('features', JSON.stringify(patch.features), '::jsonb');
    if (patch.settings !== undefined)
        add('settings', JSON.stringify(patch.settings), '::jsonb');
    const r = await pool.query(`UPDATE cad_model SET ${sets.join(', ')} WHERE owner_sub = $1 AND model_id = $2 RETURNING ${MODEL_COLUMNS}`, values);
    return r.rows[0] ?? null;
}
/** @description Record a successful rebuild: bump the revision, store report + status, insert the revision row. */
async function recordBuild(pool, sub, modelId, build) {
    const r = await pool.query(`UPDATE cad_model SET revision = revision + 1, state = 'built', report = $3::jsonb, feature_status = $4::jsonb, failure_reason = NULL, updated_at = now()
     WHERE owner_sub = $1 AND model_id = $2 RETURNING ${MODEL_COLUMNS}`, [sub, modelId, JSON.stringify(build.report), JSON.stringify(build.featureStatus)]);
    const row = r.rows[0];
    if (!row)
        return null;
    await pool.query('INSERT INTO cad_revision (model_id, revision, owner_sub, features, report, feature_status, engine_build, ms) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8)', [modelId, row.revision, sub, JSON.stringify(build.features), JSON.stringify(build.report), JSON.stringify(build.featureStatus), build.engineBuild, build.ms]);
    return row;
}
/** @description Record a rebuild that did not produce a model (engine down, base refused). The last built revision stays. */
async function recordFailure(pool, sub, modelId, reason) {
    const r = await pool.query(`UPDATE cad_model SET state = 'failed', failure_reason = $3, updated_at = now() WHERE owner_sub = $1 AND model_id = $2 RETURNING ${MODEL_COLUMNS}`, [sub, modelId, reason.slice(0, 2000)]);
    return r.rows[0] ?? null;
}
/** @description Delete a model (revisions cascade). Returns true when a row went. */
async function deleteModel(pool, sub, modelId) {
    const r = await pool.query('DELETE FROM cad_model WHERE owner_sub = $1 AND model_id = $2', [sub, modelId]);
    return (r.rowCount ?? 0) > 0;
}
/** @description Revision history, newest first (compact: no feature lists). */
async function listRevisions(pool, sub, modelId) {
    const r = await pool.query(`SELECT revision, engine_build, ms, created_at, jsonb_array_length(features) AS "featureCount", report->'volumeMm3' AS "volumeMm3"
     FROM cad_revision WHERE owner_sub = $1 AND model_id = $2 ORDER BY revision DESC LIMIT 200`, [sub, modelId]);
    return r.rows;
}
/** @description One revision with its feature list, or null. */
async function getRevision(pool, sub, modelId, revision) {
    const r = await pool.query('SELECT model_id, revision, features, report, feature_status, engine_build, ms, created_at FROM cad_revision WHERE owner_sub = $1 AND model_id = $2 AND revision = $3', [sub, modelId, revision]);
    return r.rows[0] ?? null;
}
//# sourceMappingURL=model-store.js.map