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

import { randomUUID } from 'node:crypto';
import type { AppContext } from '@/app/composition/app-context';
import type { Artifact, Brief, ClosureInput, PhaseEntry, PhaseKind } from './phase-model';

type Pool = AppContext['pool'];

/** @description A project row as the routes answer it. */
export interface ProjectRow { id: string; name: string; brief: Brief; phases: PhaseEntry[]; created_at: string; updated_at: string }

/** @description A binding row: one bind of an artifact to a phase; `revision` counts binds of that phase. */
export interface BindingRow { id: string; phase: PhaseKind; artifact: Artifact; revision: number; bound_at: string }

/** @description A closure row (D2): the evidence line and the artifact revision it was read at; `step` for the build checklist (D8). */
export interface ClosureRow { id: string; phase: PhaseKind; step: string | null; evidence: string; revision: string; closed_by: string; closed_at: string }

const PROJECT_COLUMNS = 'id, name, brief, phases, created_at, updated_at';
/** Closures are ordered by their clock; two closes in one millisecond would tie, so the stamp is kept strictly increasing within a process. */
let lastStampMs = 0;
const stamp = (): string => { const ms = Math.max(Date.now(), lastStampMs + 1); lastStampMs = ms; return new Date(ms).toISOString(); };
const BINDING_COLUMNS = 'id, phase, artifact, revision, bound_at';
const CLOSURE_COLUMNS = 'id, phase, step, evidence, revision, closed_by, closed_at';

const j = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
const iso = (v: unknown): string => { const d = new Date(v as string); return Number.isFinite(d.getTime()) ? d.toISOString() : String(v); };
const project = (r: Record<string, unknown>): ProjectRow => ({ id: String(r.id), name: String(r.name), brief: j<Brief>(r.brief), phases: j<PhaseEntry[]>(r.phases), created_at: iso(r.created_at), updated_at: iso(r.updated_at) });
const binding = (r: Record<string, unknown>): BindingRow => ({ id: String(r.id), phase: r.phase as PhaseKind, artifact: j<Artifact>(r.artifact), revision: Number(r.revision), bound_at: iso(r.bound_at) });
const closure = (r: Record<string, unknown>): ClosureRow => ({ id: String(r.id), phase: r.phase as PhaseKind, step: r.step === null || r.step === undefined ? null : String(r.step), evidence: String(r.evidence), revision: String(r.revision), closed_by: String(r.closed_by), closed_at: iso(r.closed_at) });

/**
 * @description Create a project.
 * @param pool - The owner-scoped pool. @param sub - The owner. @param input - Name, brief and chain.
 * @returns The row.
 */
export async function createProject(pool: Pool, sub: string, input: { name: string; brief: Brief; phases: PhaseEntry[] }): Promise<ProjectRow> {
  const now = new Date().toISOString();
  const id = randomUUID();
  await pool.query(
    'INSERT INTO design_project (id, owner_sub, name, brief, phases, created_at, updated_at) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)',
    [id, sub, input.name, JSON.stringify(input.brief), JSON.stringify(input.phases), now, now],
  );
  return { id, name: input.name, brief: input.brief, phases: input.phases, created_at: now, updated_at: now };
}

/**
 * @description The owner's projects, newest change first (sorted here, never by the database).
 * @param pool - The pool. @param sub - The owner.
 * @returns The rows.
 */
export async function listProjects(pool: Pool, sub: string): Promise<ProjectRow[]> {
  const r = await pool.query(`SELECT ${PROJECT_COLUMNS} FROM design_project WHERE owner_sub = $1`, [sub]);
  return r.rows.map(project).sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : a.id < b.id ? -1 : 1));
}

/**
 * @description One project of the owner, or null (another owner's id is null too: the rows are theirs).
 * @param pool - The pool. @param sub - The owner. @param id - The project id.
 * @returns The row or null.
 */
export async function getProject(pool: Pool, sub: string, id: string): Promise<ProjectRow | null> {
  const r = await pool.query(`SELECT ${PROJECT_COLUMNS} FROM design_project WHERE owner_sub = $1 AND id = $2`, [sub, id]);
  return r.rows.length ? project(r.rows[0]) : null;
}

/**
 * @description Write the whole project row back (name, brief, chain) with a fresh updated_at.
 * @param pool - The pool. @param sub - The owner. @param row - The row to persist.
 * @returns The row as persisted.
 */
export async function updateProject(pool: Pool, sub: string, row: ProjectRow): Promise<ProjectRow> {
  const now = new Date().toISOString();
  await pool.query('UPDATE design_project SET name = $3, brief = $4::jsonb, phases = $5::jsonb, updated_at = $6 WHERE owner_sub = $1 AND id = $2', [sub, row.id, row.name, JSON.stringify(row.brief), JSON.stringify(row.phases), now]);
  return { ...row, updated_at: now };
}

/**
 * @description Delete a project; its bindings and closures go with it (ON DELETE CASCADE).
 * @param pool - The pool. @param sub - The owner. @param id - The project id.
 * @returns Whether a row was removed.
 */
export async function deleteProject(pool: Pool, sub: string, id: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM design_project WHERE owner_sub = $1 AND id = $2', [sub, id]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * @description Every binding of a project, oldest first by revision then time (sorted here).
 * @param pool - The pool. @param sub - The owner. @param projectId - The project.
 * @returns The rows.
 */
export async function listBindings(pool: Pool, sub: string, projectId: string): Promise<BindingRow[]> {
  const r = await pool.query(`SELECT ${BINDING_COLUMNS} FROM design_binding WHERE owner_sub = $1 AND project_id = $2`, [sub, projectId]);
  return r.rows.map(binding).sort((a, b) => a.revision - b.revision || (a.bound_at < b.bound_at ? -1 : 1));
}

/**
 * @description The newest binding per phase.
 * @param rows - Every binding of the project.
 * @returns A map kind to its latest binding.
 */
export function latestBindings(rows: BindingRow[]): Partial<Record<PhaseKind, BindingRow>> {
  const out: Partial<Record<PhaseKind, BindingRow>> = {};
  for (const row of rows) { const cur = out[row.phase]; if (!cur || row.revision > cur.revision) out[row.phase] = row; }
  return out;
}

/**
 * @description Bind an artifact to a phase as the next revision of that phase's bindings.
 * @param pool - The pool. @param sub - The owner. @param projectId - The project. @param phase - The phase. @param artifact - The validated artifact.
 * @returns The new row.
 */
export async function bindArtifact(pool: Pool, sub: string, projectId: string, phase: PhaseKind, artifact: Artifact): Promise<BindingRow> {
  const existing = (await listBindings(pool, sub, projectId)).filter((b) => b.phase === phase);
  const revision = existing.reduce((m, b) => Math.max(m, b.revision), 0) + 1;
  const row: BindingRow = { id: randomUUID(), phase, artifact, revision, bound_at: stamp() };
  await pool.query(
    'INSERT INTO design_binding (id, project_id, owner_sub, phase, artifact, revision, bound_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)',
    [row.id, projectId, sub, phase, JSON.stringify(artifact), revision, row.bound_at],
  );
  await touch(pool, sub, projectId);
  return row;
}

/**
 * @description Every closure of a project, oldest first (sorted here).
 * @param pool - The pool. @param sub - The owner. @param projectId - The project.
 * @returns The rows.
 */
export async function listClosures(pool: Pool, sub: string, projectId: string): Promise<ClosureRow[]> {
  const r = await pool.query(`SELECT ${CLOSURE_COLUMNS} FROM design_closure WHERE owner_sub = $1 AND project_id = $2`, [sub, projectId]);
  return r.rows.map(closure).sort((a, b) => (a.closed_at < b.closed_at ? -1 : a.closed_at > b.closed_at ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * @description Every closure of the owner across projects (the Home tile and the list count them), as {project_id, phase, step}.
 * @param pool - The pool. @param sub - The owner.
 * @returns Minimal rows.
 */
export async function listOwnerClosures(pool: Pool, sub: string): Promise<Array<{ project_id: string; phase: PhaseKind; step: string | null }>> {
  const r = await pool.query('SELECT project_id, phase, step FROM design_closure WHERE owner_sub = $1', [sub]);
  return r.rows.map((x) => ({ project_id: String(x.project_id), phase: x.phase as PhaseKind, step: x.step === null || x.step === undefined ? null : String(x.step) }));
}

/**
 * @description Record a closure (D2/D8). One row per close; the newest row per phase (or per build step) is the one that counts.
 * @param pool - The pool. @param sub - The owner. @param projectId - The project. @param phase - The phase. @param input - The validated closure.
 * @returns The new row.
 */
export async function closePhase(pool: Pool, sub: string, projectId: string, phase: PhaseKind, input: ClosureInput): Promise<ClosureRow> {
  const row: ClosureRow = { id: randomUUID(), phase, step: input.step, evidence: input.evidence, revision: input.revision, closed_by: input.by, closed_at: stamp() };
  await pool.query(
    'INSERT INTO design_closure (id, project_id, owner_sub, phase, step, evidence, revision, closed_by, closed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [row.id, projectId, sub, phase, row.step, row.evidence, row.revision, row.closed_by, row.closed_at],
  );
  await touch(pool, sub, projectId);
  return row;
}

/** Move the project's updated_at so a listing shows the change. */
async function touch(pool: Pool, sub: string, projectId: string): Promise<void> {
  await pool.query('UPDATE design_project SET updated_at = $3 WHERE owner_sub = $1 AND id = $2', [sub, projectId, new Date().toISOString()]);
}
