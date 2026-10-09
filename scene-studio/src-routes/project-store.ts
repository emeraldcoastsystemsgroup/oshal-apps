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

import type { AppContext } from '@/app/composition/app-context';

/** @description The pool surface package routes ride on — derived from the framework's own type. */
export type QueryablePool = AppContext['pool'];
export type ProjectKind = 'godot' | 'blender';

/** @description A project row as the API returns it. */
export interface ProjectRow {
  project_id: string;
  owner_sub: string;
  title: string;
  kind: ProjectKind;
  template: string | null;
  revision: number;
  file_count: number;
  total_bytes: number;
  preview: Record<string, unknown> | null;
  last_run: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** @description A revision row. */
export interface RevisionRow {
  project_id: string;
  revision: number;
  action: string;
  detail: Record<string, unknown>;
  file_count: number;
  total_bytes: number;
  blob: string;
  engine_build: string | null;
  created_at: string;
}

/** @description What a new revision records. */
export interface NewRevision {
  action: string;
  detail: Record<string, unknown>;
  fileCount: number;
  totalBytes: number;
  blob: string;
  engineBuild: string | null;
}

const PROJECT_COLUMNS = 'project_id, owner_sub, title, kind, template, revision, file_count, total_bytes::float8 AS total_bytes, preview, last_run, created_at, updated_at';
const REVISION_COLUMNS = 'project_id, revision, action, detail, file_count, total_bytes::float8 AS total_bytes, blob, engine_build, created_at';

/** @description The caller's projects, newest first. */
export async function listProjects(pool: QueryablePool, sub: string): Promise<ProjectRow[]> {
  const r = await pool.query(`SELECT ${PROJECT_COLUMNS} FROM scene_project WHERE owner_sub = $1 ORDER BY updated_at DESC, project_id`, [sub]);
  return r.rows as ProjectRow[];
}

/** @description One project, or null. */
export async function getProject(pool: QueryablePool, sub: string, projectId: string): Promise<ProjectRow | null> {
  const r = await pool.query(`SELECT ${PROJECT_COLUMNS} FROM scene_project WHERE owner_sub = $1 AND project_id = $2`, [sub, projectId]);
  return (r.rows[0] as ProjectRow | undefined) ?? null;
}

/** @description Insert a project at revision 0 (no files yet). */
export async function insertProject(pool: QueryablePool, sub: string, input: { title: string; kind: ProjectKind; template: string }): Promise<ProjectRow> {
  const r = await pool.query(
    `INSERT INTO scene_project (owner_sub, title, kind, template) VALUES ($1, $2, $3, $4) RETURNING ${PROJECT_COLUMNS}`,
    [sub, input.title, input.kind, input.template],
  );
  return r.rows[0] as ProjectRow;
}

/** @description Rename a project. @returns The updated row, or null. */
export async function renameProject(pool: QueryablePool, sub: string, projectId: string, title: string): Promise<ProjectRow | null> {
  const r = await pool.query(
    `UPDATE scene_project SET title = $3, updated_at = now() WHERE owner_sub = $1 AND project_id = $2 RETURNING ${PROJECT_COLUMNS}`,
    [sub, projectId, title],
  );
  return (r.rows[0] as ProjectRow | undefined) ?? null;
}

/** @description Delete a project (its revisions cascade). @returns True when a row was deleted. */
export async function deleteProject(pool: QueryablePool, sub: string, projectId: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM scene_project WHERE owner_sub = $1 AND project_id = $2', [sub, projectId]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * @description Advance a project from `expected` to `expected + 1` and record the revision, in one
 * statement. @returns The updated project, or null when another write got there first.
 */
export async function commitRevision(pool: QueryablePool, sub: string, projectId: string, expected: number, rev: NewRevision): Promise<ProjectRow | null> {
  if ((pool as unknown as {storageModel?:string}).storageModel === 'kernel-scoped-documents')
    return nativeRevision(pool, sub, projectId, expected, rev);
  const r = await pool.query(
    `WITH up AS (
       UPDATE scene_project SET revision = revision + 1, file_count = $4, total_bytes = $5, updated_at = now()
        WHERE owner_sub = $1 AND project_id = $2 AND revision = $3
        RETURNING ${PROJECT_COLUMNS}
     ), ins AS (
       INSERT INTO scene_revision (project_id, revision, owner_sub, action, detail, file_count, total_bytes, blob, engine_build)
       SELECT project_id, revision, owner_sub, $6, $7::jsonb, $4, $5, $8, $9 FROM up
       RETURNING revision
     )
     SELECT up.* FROM up JOIN ins ON ins.revision = up.revision`,
    [sub, projectId, expected, rev.fileCount, rev.totalBytes, rev.action, JSON.stringify(rev.detail), rev.blob, rev.engineBuild],
  );
  return (r.rows[0] as ProjectRow | undefined) ?? null;
}

/** The native runner holds the SQL/file transaction; either statement failure rolls back the whole request. */
async function nativeRevision(pool: QueryablePool, sub: string, projectId: string, expected: number, rev: NewRevision): Promise<ProjectRow|null> {
  if (!(pool as unknown as {nativeAtomicRequest?:()=>boolean}).nativeAtomicRequest?.())
    throw new Error('Native Scene revision requires its held atomic file transaction');
  const updated = await pool.query(`UPDATE scene_project SET revision = revision + 1, file_count = $4,
    total_bytes = $5, updated_at = now() WHERE owner_sub = $1 AND project_id = $2 AND revision = $3
    RETURNING ${PROJECT_COLUMNS}`, [sub, projectId, expected, rev.fileCount, rev.totalBytes]);
  if (updated.rowCount === 0) return null;
  if (updated.rowCount !== 1) throw new Error('Native Scene revision acknowledgement mismatch');
  const inserted = await pool.query(`INSERT INTO scene_revision
    (project_id, revision, owner_sub, action, detail, file_count, total_bytes, blob, engine_build)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) RETURNING revision`,
    [projectId, expected+1, sub, rev.action, JSON.stringify(rev.detail), rev.fileCount, rev.totalBytes, rev.blob, rev.engineBuild]);
  if (inserted.rowCount !== 1) throw new Error('Native Scene revision insertion acknowledgement mismatch');
  return updated.rows[0] as ProjectRow;
}

/** @description One revision, or null. */
export async function getRevision(pool: QueryablePool, sub: string, projectId: string, revision: number): Promise<RevisionRow | null> {
  const r = await pool.query(`SELECT ${REVISION_COLUMNS} FROM scene_revision WHERE owner_sub = $1 AND project_id = $2 AND revision = $3`, [sub, projectId, revision]);
  return (r.rows[0] as RevisionRow | undefined) ?? null;
}

/** @description The newest revisions of a project (blob names are not returned to callers). */
export async function listRevisions(pool: QueryablePool, sub: string, projectId: string, limit = 50): Promise<RevisionRow[]> {
  const r = await pool.query(
    `SELECT ${REVISION_COLUMNS} FROM scene_revision WHERE owner_sub = $1 AND project_id = $2 ORDER BY revision DESC LIMIT $3`,
    [sub, projectId, limit],
  );
  return r.rows as RevisionRow[];
}

/** @description Drop revisions older than `keepFrom`. @returns The dropped rows' revision and blob. */
export async function pruneRevisions(pool: QueryablePool, sub: string, projectId: string, keepFrom: number): Promise<Array<{ revision: number; blob: string }>> {
  const r = await pool.query(
    'DELETE FROM scene_revision WHERE owner_sub = $1 AND project_id = $2 AND revision < $3 RETURNING revision, blob',
    [sub, projectId, keepFrom],
  );
  return r.rows as Array<{ revision: number; blob: string }>;
}

/** @description Record the last preview render or the last run on the project. */
export async function setProjectRecord(pool: QueryablePool, sub: string, projectId: string, column: 'preview' | 'last_run', value: Record<string, unknown>): Promise<ProjectRow | null> {
  const r = await pool.query(
    `UPDATE scene_project SET ${column === 'preview' ? 'preview' : 'last_run'} = $3::jsonb, updated_at = now()
      WHERE owner_sub = $1 AND project_id = $2 RETURNING ${PROJECT_COLUMNS}`,
    [sub, projectId, JSON.stringify(value)],
  );
  return (r.rows[0] as ProjectRow | undefined) ?? null;
}
