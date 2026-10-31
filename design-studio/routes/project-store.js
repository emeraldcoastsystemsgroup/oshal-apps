"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D1, lane @ds-app: the per-person store of projects, their
 *                     |                             | bindings and their closures over the package's three tables
 *                     |                             | (migrations/001-design-studio.sql). Every statement is owner
 *                     |                             | scoped, keyed by a text id the package mints, a plain INSERT
 *                     |                             | or a whole-row UPDATE, with no ORDER BY, ON CONFLICT or
 *                     |                             | DISTINCT ON (the native kernel's SQL rules for growing tables):
 *                     |                             | the newest binding per phase and the ordering of a listing are
 *                     |                             | computed here, in code. An engine's artifact is never stored,
 *                     |                             | only its reference and the excerpt the body contract publishes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProject = createProject;
exports.listProjects = listProjects;
exports.getProject = getProject;
exports.updateProject = updateProject;
exports.deleteProject = deleteProject;
exports.listBindings = listBindings;
exports.latestBindings = latestBindings;
exports.bindArtifact = bindArtifact;
exports.listClosures = listClosures;
exports.listOwnerClosures = listOwnerClosures;
exports.closePhase = closePhase;
const node_crypto_1 = require("node:crypto");
const PROJECT_COLUMNS = 'id, name, brief, phases, created_at, updated_at';
/** Closures are ordered by their clock; two closes in one millisecond would tie, so the stamp is kept strictly increasing within a process. */
let lastStampMs = 0;
const stamp = () => { const ms = Math.max(Date.now(), lastStampMs + 1); lastStampMs = ms; return new Date(ms).toISOString(); };
const BINDING_COLUMNS = 'id, phase, artifact, revision, bound_at';
const CLOSURE_COLUMNS = 'id, phase, step, evidence, revision, closed_by, closed_at';
const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const iso = (v) => { const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString() : String(v); };
const project = (r) => ({ id: String(r.id), name: String(r.name), brief: j(r.brief), phases: j(r.phases), created_at: iso(r.created_at), updated_at: iso(r.updated_at) });
const binding = (r) => ({ id: String(r.id), phase: r.phase, artifact: j(r.artifact), revision: Number(r.revision), bound_at: iso(r.bound_at) });
const closure = (r) => ({ id: String(r.id), phase: r.phase, step: r.step === null || r.step === undefined ? null : String(r.step), evidence: String(r.evidence), revision: String(r.revision), closed_by: String(r.closed_by), closed_at: iso(r.closed_at) });
/**
 * @description Create a project.
 * @param pool - The owner-scoped pool. @param sub - The owner. @param input - Name, brief and chain.
 * @returns The row.
 */
async function createProject(pool, sub, input) {
    const now = new Date().toISOString();
    const id = (0, node_crypto_1.randomUUID)();
    await pool.query('INSERT INTO design_project (id, owner_sub, name, brief, phases, created_at, updated_at) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)', [id, sub, input.name, JSON.stringify(input.brief), JSON.stringify(input.phases), now, now]);
    return { id, name: input.name, brief: input.brief, phases: input.phases, created_at: now, updated_at: now };
}
/**
 * @description The owner's projects, newest change first (sorted here, never by the database).
 * @param pool - The pool. @param sub - The owner.
 * @returns The rows.
 */
async function listProjects(pool, sub) {
    const r = await pool.query(`SELECT ${PROJECT_COLUMNS} FROM design_project WHERE owner_sub = $1`, [sub]);
    return r.rows.map(project).sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : a.id < b.id ? -1 : 1));
}
/**
 * @description One project of the owner, or null (another owner's id is null too: the rows are theirs).
 * @param pool - The pool. @param sub - The owner. @param id - The project id.
 * @returns The row or null.
 */
async function getProject(pool, sub, id) {
    const r = await pool.query(`SELECT ${PROJECT_COLUMNS} FROM design_project WHERE owner_sub = $1 AND id = $2`, [sub, id]);
    return r.rows.length ? project(r.rows[0]) : null;
}
/**
 * @description Write the whole project row back (name, brief, chain) with a fresh updated_at.
 * @param pool - The pool. @param sub - The owner. @param row - The row to persist.
 * @returns The row as persisted.
 */
async function updateProject(pool, sub, row) {
    const now = new Date().toISOString();
    await pool.query('UPDATE design_project SET name = $3, brief = $4::jsonb, phases = $5::jsonb, updated_at = $6 WHERE owner_sub = $1 AND id = $2', [sub, row.id, row.name, JSON.stringify(row.brief), JSON.stringify(row.phases), now]);
    return { ...row, updated_at: now };
}
/**
 * @description Delete a project; its bindings and closures go with it (ON DELETE CASCADE).
 * @param pool - The pool. @param sub - The owner. @param id - The project id.
 * @returns Whether a row was removed.
 */
async function deleteProject(pool, sub, id) {
    const r = await pool.query('DELETE FROM design_project WHERE owner_sub = $1 AND id = $2', [sub, id]);
    return (r.rowCount ?? 0) > 0;
}
/**
 * @description Every binding of a project, oldest first by revision then time (sorted here).
 * @param pool - The pool. @param sub - The owner. @param projectId - The project.
 * @returns The rows.
 */
async function listBindings(pool, sub, projectId) {
    const r = await pool.query(`SELECT ${BINDING_COLUMNS} FROM design_binding WHERE owner_sub = $1 AND project_id = $2`, [sub, projectId]);
    return r.rows.map(binding).sort((a, b) => a.revision - b.revision || (a.bound_at < b.bound_at ? -1 : 1));
}
/**
 * @description The newest binding per phase.
 * @param rows - Every binding of the project.
 * @returns A map kind to its latest binding.
 */
function latestBindings(rows) {
    const out = {};
    for (const row of rows) {
        const cur = out[row.phase];
        if (!cur || row.revision > cur.revision)
            out[row.phase] = row;
    }
    return out;
}
/**
 * @description Bind an artifact to a phase as the next revision of that phase's bindings.
 * @param pool - The pool. @param sub - The owner. @param projectId - The project. @param phase - The phase. @param artifact - The validated artifact.
 * @returns The new row.
 */
async function bindArtifact(pool, sub, projectId, phase, artifact) {
    const existing = (await listBindings(pool, sub, projectId)).filter((b) => b.phase === phase);
    const revision = existing.reduce((m, b) => Math.max(m, b.revision), 0) + 1;
    const row = { id: (0, node_crypto_1.randomUUID)(), phase, artifact, revision, bound_at: stamp() };
    await pool.query('INSERT INTO design_binding (id, project_id, owner_sub, phase, artifact, revision, bound_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)', [row.id, projectId, sub, phase, JSON.stringify(artifact), revision, row.bound_at]);
    await touch(pool, sub, projectId);
    return row;
}
/**
 * @description Every closure of a project, oldest first (sorted here).
 * @param pool - The pool. @param sub - The owner. @param projectId - The project.
 * @returns The rows.
 */
async function listClosures(pool, sub, projectId) {
    const r = await pool.query(`SELECT ${CLOSURE_COLUMNS} FROM design_closure WHERE owner_sub = $1 AND project_id = $2`, [sub, projectId]);
    return r.rows.map(closure).sort((a, b) => (a.closed_at < b.closed_at ? -1 : a.closed_at > b.closed_at ? 1 : a.id < b.id ? -1 : 1));
}
/**
 * @description Every closure of the owner across projects (the Home tile and the list count them), as {project_id, phase, step}.
 * @param pool - The pool. @param sub - The owner.
 * @returns Minimal rows.
 */
async function listOwnerClosures(pool, sub) {
    const r = await pool.query('SELECT project_id, phase, step FROM design_closure WHERE owner_sub = $1', [sub]);
    return r.rows.map((x) => ({ project_id: String(x.project_id), phase: x.phase, step: x.step === null || x.step === undefined ? null : String(x.step) }));
}
/**
 * @description Record a closure (D2/D8). One row per close; the newest row per phase (or per build step) is the one that counts.
 * @param pool - The pool. @param sub - The owner. @param projectId - The project. @param phase - The phase. @param input - The validated closure.
 * @returns The new row.
 */
async function closePhase(pool, sub, projectId, phase, input) {
    const row = { id: (0, node_crypto_1.randomUUID)(), phase, step: input.step, evidence: input.evidence, revision: input.revision, closed_by: input.by, closed_at: stamp() };
    await pool.query('INSERT INTO design_closure (id, project_id, owner_sub, phase, step, evidence, revision, closed_by, closed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [row.id, projectId, sub, phase, row.step, row.evidence, row.revision, row.closed_by, row.closed_at]);
    await touch(pool, sub, projectId);
    return row;
}
/** Move the project's updated_at so a listing shows the change. */
async function touch(pool, sub, projectId) {
    await pool.query('UPDATE design_project SET updated_at = $3 WHERE owner_sub = $1 AND id = $2', [sub, projectId, new Date().toISOString()]);
}
//# sourceMappingURL=project-store.js.map