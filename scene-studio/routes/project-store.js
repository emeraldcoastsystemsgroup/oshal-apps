"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the owner-scoped SQL for projects and their
 *                     |                             | revisions. Every statement filters on owner_sub as well as riding
 *                     |                             | the table's forced RLS; a new revision lands in ONE statement
 *                     |                             | (CTE) that advances the project only from the revision the writer
 *                     |                             | started from, so a concurrent writer gets a conflict, never a
 *                     |                             | half-written revision.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Stage native revision CAS and insert in the same held atomic request as its durable files.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProjects = listProjects;
exports.getProject = getProject;
exports.insertProject = insertProject;
exports.renameProject = renameProject;
exports.deleteProject = deleteProject;
exports.commitRevision = commitRevision;
exports.getRevision = getRevision;
exports.listRevisions = listRevisions;
exports.pruneRevisions = pruneRevisions;
exports.setProjectRecord = setProjectRecord;
const PROJECT_COLUMNS = 'project_id, owner_sub, title, kind, template, revision, file_count, total_bytes::float8 AS total_bytes, preview, last_run, created_at, updated_at';
const REVISION_COLUMNS = 'project_id, revision, action, detail, file_count, total_bytes::float8 AS total_bytes, blob, engine_build, created_at';
/** @description The caller's projects, newest first. */
async function listProjects(pool, sub) {
    const r = await pool.query(`SELECT ${PROJECT_COLUMNS} FROM scene_project WHERE owner_sub = $1 ORDER BY updated_at DESC, project_id`, [sub]);
    return r.rows;
}
/** @description One project, or null. */
async function getProject(pool, sub, projectId) {
    const r = await pool.query(`SELECT ${PROJECT_COLUMNS} FROM scene_project WHERE owner_sub = $1 AND project_id = $2`, [sub, projectId]);
    return r.rows[0] ?? null;
}
/** @description Insert a project at revision 0 (no files yet). */
async function insertProject(pool, sub, input) {
    const r = await pool.query(`INSERT INTO scene_project (owner_sub, title, kind, template) VALUES ($1, $2, $3, $4) RETURNING ${PROJECT_COLUMNS}`, [sub, input.title, input.kind, input.template]);
    return r.rows[0];
}
/** @description Rename a project. @returns The updated row, or null. */
async function renameProject(pool, sub, projectId, title) {
    const r = await pool.query(`UPDATE scene_project SET title = $3, updated_at = now() WHERE owner_sub = $1 AND project_id = $2 RETURNING ${PROJECT_COLUMNS}`, [sub, projectId, title]);
    return r.rows[0] ?? null;
}
/** @description Delete a project (its revisions cascade). @returns True when a row was deleted. */
async function deleteProject(pool, sub, projectId) {
    const r = await pool.query('DELETE FROM scene_project WHERE owner_sub = $1 AND project_id = $2', [sub, projectId]);
    return (r.rowCount ?? 0) > 0;
}
/**
 * @description Advance a project from `expected` to `expected + 1` and record the revision, in one
 * statement. @returns The updated project, or null when another write got there first.
 */
async function commitRevision(pool, sub, projectId, expected, rev) {
    if (pool.storageModel === 'kernel-scoped-documents')
        return nativeRevision(pool, sub, projectId, expected, rev);
    const r = await pool.query(`WITH up AS (
       UPDATE scene_project SET revision = revision + 1, file_count = $4, total_bytes = $5, updated_at = now()
        WHERE owner_sub = $1 AND project_id = $2 AND revision = $3
        RETURNING ${PROJECT_COLUMNS}
     ), ins AS (
       INSERT INTO scene_revision (project_id, revision, owner_sub, action, detail, file_count, total_bytes, blob, engine_build)
       SELECT project_id, revision, owner_sub, $6, $7::jsonb, $4, $5, $8, $9 FROM up
       RETURNING revision
     )
     SELECT up.* FROM up JOIN ins ON ins.revision = up.revision`, [sub, projectId, expected, rev.fileCount, rev.totalBytes, rev.action, JSON.stringify(rev.detail), rev.blob, rev.engineBuild]);
    return r.rows[0] ?? null;
}
/** The native runner holds the SQL/file transaction; either statement failure rolls back the whole request. */
async function nativeRevision(pool, sub, projectId, expected, rev) {
    if (!pool.nativeAtomicRequest?.())
        throw new Error('Native Scene revision requires its held atomic file transaction');
    const updated = await pool.query(`UPDATE scene_project SET revision = revision + 1, file_count = $4,
    total_bytes = $5, updated_at = now() WHERE owner_sub = $1 AND project_id = $2 AND revision = $3
    RETURNING ${PROJECT_COLUMNS}`, [sub, projectId, expected, rev.fileCount, rev.totalBytes]);
    if (updated.rowCount === 0)
        return null;
    if (updated.rowCount !== 1)
        throw new Error('Native Scene revision acknowledgement mismatch');
    const inserted = await pool.query(`INSERT INTO scene_revision
    (project_id, revision, owner_sub, action, detail, file_count, total_bytes, blob, engine_build)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) RETURNING revision`, [projectId, expected + 1, sub, rev.action, JSON.stringify(rev.detail), rev.fileCount, rev.totalBytes, rev.blob, rev.engineBuild]);
    if (inserted.rowCount !== 1)
        throw new Error('Native Scene revision insertion acknowledgement mismatch');
    return updated.rows[0];
}
/** @description One revision, or null. */
async function getRevision(pool, sub, projectId, revision) {
    const r = await pool.query(`SELECT ${REVISION_COLUMNS} FROM scene_revision WHERE owner_sub = $1 AND project_id = $2 AND revision = $3`, [sub, projectId, revision]);
    return r.rows[0] ?? null;
}
/** @description The newest revisions of a project (blob names are not returned to callers). */
async function listRevisions(pool, sub, projectId, limit = 50) {
    const r = await pool.query(`SELECT ${REVISION_COLUMNS} FROM scene_revision WHERE owner_sub = $1 AND project_id = $2 ORDER BY revision DESC LIMIT $3`, [sub, projectId, limit]);
    return r.rows;
}
/** @description Drop revisions older than `keepFrom`. @returns The dropped rows' revision and blob. */
async function pruneRevisions(pool, sub, projectId, keepFrom) {
    const r = await pool.query('DELETE FROM scene_revision WHERE owner_sub = $1 AND project_id = $2 AND revision < $3 RETURNING revision, blob', [sub, projectId, keepFrom]);
    return r.rows;
}
/** @description Record the last preview render or the last run on the project. */
async function setProjectRecord(pool, sub, projectId, column, value) {
    const r = await pool.query(`UPDATE scene_project SET ${column === 'preview' ? 'preview' : 'last_run'} = $3::jsonb, updated_at = now()
      WHERE owner_sub = $1 AND project_id = $2 RETURNING ${PROJECT_COLUMNS}`, [sub, projectId, JSON.stringify(value)]);
    return r.rows[0] ?? null;
}
