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

import { randomUUID } from 'node:crypto';
import type { AppContext } from '@/app/composition/app-context';
import type { Mechanism } from './mechanism-model';

type Pool = AppContext['pool'];

/** @description A mechanism row as the routes answer it. */
export interface MechanismRow { id: string; mechanism: Mechanism; revision: number; saved_at: string }

const COLUMNS = 'id, mechanism, revision, saved_at';
const j = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
const iso = (v: unknown): string => { const d = new Date(v as string); return Number.isFinite(d.getTime()) ? d.toISOString() : String(v); };
const row = (r: Record<string, unknown>): MechanismRow => ({ id: String(r.id), mechanism: j<Mechanism>(r.mechanism), revision: Number(r.revision), saved_at: iso(r.saved_at) });

/**
 * @description The project's mechanism, or null when none was saved.
 * @param pool - The owner-scoped pool. @param sub - The owner. @param projectId - The project.
 * @returns The row or null.
 */
export async function getMechanism(pool: Pool, sub: string, projectId: string): Promise<MechanismRow | null> {
  const r = await pool.query(`SELECT ${COLUMNS} FROM design_mechanism WHERE owner_sub = $1 AND project_id = $2`, [sub, projectId]);
  return r.rows.length ? row(r.rows[0]) : null;
}

/**
 * @description Save the mechanism: the first save inserts, every later one rewrites the row as the next revision.
 * @param pool - The pool. @param sub - The owner. @param projectId - The project. @param mechanism - The validated mechanism.
 * @returns The row as persisted.
 */
export async function saveMechanism(pool: Pool, sub: string, projectId: string, mechanism: Mechanism): Promise<MechanismRow> {
  const now = new Date().toISOString();
  const current = await getMechanism(pool, sub, projectId);
  if (!current) {
    const id = randomUUID();
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
async function touch(pool: Pool, sub: string, projectId: string, now: string): Promise<void> {
  await pool.query('UPDATE design_project SET updated_at = $3 WHERE owner_sub = $1 AND id = $2', [sub, projectId, now]);
}
