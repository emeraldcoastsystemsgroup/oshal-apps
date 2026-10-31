"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant: the per-person store of a project's
 *                     |                             | mechanism over design_mechanism (migrations/002-design-mechanism.sql):
 *                     |                             | one row per project, a plain INSERT on the first save and a
 *                     |                             | whole-row UPDATE after (revision counts the saves), owner
 *                     |                             | scoped, no ON CONFLICT -- the native kernel's rules. The plant
 *                     |                             | the engine builds from it is never stored.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMechanism = getMechanism;
exports.saveMechanism = saveMechanism;
const node_crypto_1 = require("node:crypto");
const COLUMNS = 'id, mechanism, revision, saved_at';
const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const iso = (v) => { const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString() : String(v); };
const row = (r) => ({ id: String(r.id), mechanism: j(r.mechanism), revision: Number(r.revision), saved_at: iso(r.saved_at) });
/**
 * @description The project's mechanism, or null when none was saved.
 * @param pool - The owner-scoped pool. @param sub - The owner. @param projectId - The project.
 * @returns The row or null.
 */
async function getMechanism(pool, sub, projectId) {
    const r = await pool.query(`SELECT ${COLUMNS} FROM design_mechanism WHERE owner_sub = $1 AND project_id = $2`, [sub, projectId]);
    return r.rows.length ? row(r.rows[0]) : null;
}
/**
 * @description Save the mechanism: the first save inserts, every later one rewrites the row as the next revision.
 * @param pool - The pool. @param sub - The owner. @param projectId - The project. @param mechanism - The validated mechanism.
 * @returns The row as persisted.
 */
async function saveMechanism(pool, sub, projectId, mechanism) {
    const now = new Date().toISOString();
    const current = await getMechanism(pool, sub, projectId);
    if (!current) {
        const id = (0, node_crypto_1.randomUUID)();
        await pool.query('INSERT INTO design_mechanism (id, project_id, owner_sub, mechanism, revision, saved_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6)', [id, projectId, sub, JSON.stringify(mechanism), 1, now]);
        await touch(pool, sub, projectId, now);
        return { id, mechanism, revision: 1, saved_at: now };
    }
    const revision = current.revision + 1;
    await pool.query('UPDATE design_mechanism SET mechanism = $3::jsonb, revision = $4, saved_at = $5 WHERE owner_sub = $1 AND id = $2', [sub, current.id, JSON.stringify(mechanism), revision, now]);
    await touch(pool, sub, projectId, now);
    return { id: current.id, mechanism, revision, saved_at: now };
}
/** Move the project's updated_at so a listing shows the change. */
async function touch(pool, sub, projectId, now) {
    await pool.query('UPDATE design_project SET updated_at = $3 WHERE owner_sub = $1 AND id = $2', [sub, projectId, now]);
}
//# sourceMappingURL=mechanism-store.js.map