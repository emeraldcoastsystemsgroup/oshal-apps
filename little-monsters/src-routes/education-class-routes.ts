/**
 * Class lifecycle routes for Little Monsters.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Extracted tenant-aware class list, create, read, delete, and ribbon visibility routes
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Recheck the tenant in the final class-info query after access authorization
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Delete classes and dependent rows atomically under row locks while rechecking the actor's current tenant, role, and ownership in the final delete
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | Fail class deletion closed until every locked material file and exact RAG collection is removed, then delete its material rows in the class transaction
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | Replace wildcard class reads with the reviewed client-facing class projection
 * ---------------------------------------------------------------------------
 *
 * @module education-class-routes
 */

import { randomUUID } from 'crypto';
import { Router, type Request, type Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { createChildLogger } from '@/shared/logger';
import { deregisterDynamicToolUI, registerDynamicToolUI } from '@/app/routes/tool-routes';
import type { AppContext } from '@/app/composition/app-context';
import {
  assertClassAccess,
  assertTeacherOfClass,
  EducationAccessError,
  listAccessibleClassIds,
  resolveAuthedStudent,
} from './education-access';
import {
  deleteMaterialCollection,
  deleteStoredMaterial,
  type StoredMaterialRow,
} from './education-material-storage';

const logger = createChildLogger({ module: 'education-class-routes' });

function sendAccessError(res: Response, err: unknown): boolean {
  if (!(err instanceof EducationAccessError)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unexpected class-management error';
}

async function listClassToolKeys(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const student = await resolveAuthedStudent(req, ctx.pool);
    const accessible = await listAccessibleClassIds(ctx.pool, student);
    res.json({ keys: accessible.map((id: string) => `lm-class-${String(id).slice(0, 8)}`) });
  } catch (err) {
    logger.error({ err }, 'Failed to resolve class-tool visibility');
    res.json({ keys: [] });
  }
}

async function listClasses(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const student = await resolveAuthedStudent(req, ctx.pool);
    const accessible = await listAccessibleClassIds(ctx.pool, student);
    if (accessible.length === 0) {
      res.json({ classes: [] });
      return;
    }
    const includeArchived = String(req.query.includeArchived || '') === 'true';
    const statusClause = includeArchived ? `c.status IN ('active','archived')` : `c.status = 'active'`;
    const result = await ctx.pool.query(
      `SELECT c.class_id, c.name, c.subject, c.grade_level, c.teacher_name,
        c.description, c.metadata, c.status, c.created_at, c.updated_at,
        c.teacher_student_id, c.published,
        (SELECT COUNT(*) FROM lm_enrollments e WHERE e.class_id = c.class_id) as student_count,
        (SELECT COUNT(*) FROM lm_lectures l WHERE l.class_id = c.class_id) as lecture_count,
        (SELECT COUNT(*) FROM lm_flashcard_sets fs WHERE fs.class_id = c.class_id) as flashcard_set_count
       FROM lm_classes c WHERE ${statusClause} AND c.class_id = ANY($1)
       ORDER BY c.status, c.name`,
      [accessible],
    );
    res.json({ classes: result.rows });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Failed to list classes');
    res.status(500).json({ error: errorMessage(err) });
  }
}

async function getClassInfo(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const classId = String(req.params.classId);
    const student = await resolveAuthedStudent(req, ctx.pool);
    await assertClassAccess(ctx.pool, student, classId);
    const { rows } = await ctx.pool.query(
      `SELECT class_id, name, subject, grade_level, teacher_name, description,
              metadata, status, created_at, updated_at, teacher_student_id, published
         FROM lm_classes WHERE class_id = $1 AND tenant_id = $2 LIMIT 1`,
      [classId, student.tenantId],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Failed to get class info');
    res.status(500).json({ error: errorMessage(err) });
  }
}

/** Lock both authorization rows so ownership cannot change during deletion. */
async function lockClassDeletion(client: PoolClient, actorId: string, classId: string): Promise<void> {
  const result = await client.query(
    `SELECT 1
       FROM lm_classes c
       JOIN lm_students a ON a.student_id = $2 AND a.tenant_id = c.tenant_id
      WHERE c.class_id = $1
        AND (a.role = 'admin' OR (a.role = 'teacher' AND c.teacher_student_id = a.student_id))
      FOR UPDATE OF c, a`,
    [classId, actorId],
  );
  if (result.rows.length === 0) {
    throw new EducationAccessError('You do not teach this class', 403);
  }
}

/** Lock every material pointer before crossing into non-transactional stores. */
async function lockClassMaterials(client: PoolClient, classId: string): Promise<StoredMaterialRow[]> {
  const result = await client.query<StoredMaterialRow>(
    `SELECT material_id, class_id, uploaded_by, stored_path, mime_type, rag_collection
       FROM lm_materials
      WHERE class_id = $1
      FOR UPDATE`,
    [classId],
  );
  return result.rows;
}

/**
 * Reach the irreversible desired state before removing database pointers.
 *
 * RAG and filesystem operations cannot join the PostgreSQL transaction. Their
 * deletes are therefore idempotent and run while the class and material rows
 * remain locked. Any failure rolls the relational transaction back, preserving
 * pointers for a safe retry instead of committing an untracked orphan.
 */
async function deleteClassMaterialArtifacts(materials: StoredMaterialRow[]): Promise<void> {
  for (const material of materials) {
    if (material.rag_collection) await deleteMaterialCollection(material.rag_collection);
    deleteStoredMaterial(material);
  }
}

/** Delete relational dependents inside the same transaction as the class row. */
async function deleteClassDependents(client: PoolClient, classId: string): Promise<void> {
  await client.query('DELETE FROM lm_materials WHERE class_id = $1', [classId]);
  await client.query(
    'DELETE FROM lm_flashcards WHERE set_id IN (SELECT set_id FROM lm_flashcard_sets WHERE class_id = $1)',
    [classId],
  );
  await client.query('DELETE FROM lm_flashcard_sets WHERE class_id = $1', [classId]);
  await client.query('DELETE FROM lm_assignments WHERE class_id = $1', [classId]);
  await client.query('DELETE FROM lm_enrollments WHERE class_id = $1', [classId]);
}

/** Rebind the destructive statement to the locked actor and class relationship. */
async function deleteAuthorizedClass(
  client: PoolClient,
  actorId: string,
  classId: string,
): Promise<number | null> {
  const result = await client.query(
    `DELETE FROM lm_classes c USING lm_students a
      WHERE c.class_id = $1 AND a.student_id = $2 AND a.tenant_id = c.tenant_id
        AND (a.role = 'admin' OR (a.role = 'teacher' AND c.teacher_student_id = a.student_id))`,
    [classId, actorId],
  );
  return result.rowCount;
}

/** Roll back without hiding the original class-deletion failure. */
async function rollbackClassDeletion(client: PoolClient, classId: string, cause: unknown): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch (err) {
    logger.error({ err, cause, classId }, 'Class deletion rollback failed');
  }
}

/** Atomically remove one class only while its current authorization stays locked. */
async function deleteClassRows(pool: Pool, actorId: string, classId: string): Promise<number | null> {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await lockClassDeletion(client, actorId, classId);
    const materials = await lockClassMaterials(client, classId);
    await deleteClassMaterialArtifacts(materials);
    await deleteClassDependents(client, classId);
    const rowCount = await deleteAuthorizedClass(client, actorId, classId);
    if (rowCount !== 1) {
      throw new EducationAccessError('Class authorization changed; no data was deleted', 409);
    }
    await client.query('COMMIT');
    transactionOpen = false;
    return rowCount;
  } catch (err) {
    if (transactionOpen) await rollbackClassDeletion(client, classId, err);
    throw err;
  } finally {
    client.release();
  }
}

async function deleteClass(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const classId = String(req.params.classId);
  try {
    const deleter = await resolveAuthedStudent(req, ctx.pool);
    await assertTeacherOfClass(ctx.pool, deleter, classId);
    const rowCount = await deleteClassRows(ctx.pool, deleter.studentId, classId);
    if (rowCount === 0) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }
    deregisterDynamicToolUI(`lm-class-${classId.substring(0, 8)}`);
    logger.info({ classId }, 'Class deleted and ribbon icon deregistered');
    res.json({ success: true, classId });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    logger.error({ err, classId }, 'Failed to delete class');
    res.status(503).json({ error: 'Class deletion could not be completed safely' });
  }
}

async function persistClass(ctx: AppContext, req: Request, classId: string): Promise<void> {
  const { name, subject, gradeLevel, teacherName, description, website, schedule, room } = req.body;
  const creator = await resolveAuthedStudent(req, ctx.pool);
  const prefix = `lm-class-${classId.substring(0, 8)}`;
  const metadata = { website: website || '', schedule: schedule || '', room: room || '' };
  const isTeacher = creator.role === 'teacher' || creator.role === 'admin';
  await ctx.pool.query(
    `INSERT INTO lm_classes
     (class_id, name, subject, grade_level, teacher_name, description,
      chroma_collection_prefix, metadata, teacher_student_id, published, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [classId, name, subject, gradeLevel || '', teacherName || creator.name || '',
      description || '', prefix, JSON.stringify(metadata), creator.studentId, isTeacher, creator.tenantId],
  );
  await ctx.pool.query(
    'INSERT INTO lm_enrollments (student_id, class_id) VALUES ($1, $2) ON CONFLICT (student_id, class_id) DO NOTHING',
    [creator.studentId, classId],
  );
  logger.info({ classId, name, subject, creator: creator.studentId }, 'Class created and creator enrolled');
}

async function createClass(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const { name, subject } = req.body;
    if (!name || !subject) {
      res.status(400).json({ error: 'name and subject are required' });
      return;
    }
    const classId = randomUUID();
    await persistClass(ctx, req, classId);
    registerDynamicToolUI(
      `lm-class-${classId.substring(0, 8)}`,
      name,
      'codicon codicon-book',
      `/api/education/class?classId=${classId}`,
      `class-tutor-${classId.substring(0, 8)}`,
    );
    res.status(201).json({ classId, name, subject, chromaPrefix: `lm-class-${classId.substring(0, 8)}` });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Failed to create class');
    res.status(500).json({ error: errorMessage(err) });
  }
}

/** Create class lifecycle routes with caller-scoped reads and owner-gated deletion. */
export function createEducationClassRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get('/class-tool-keys', (req, res) => listClassToolKeys(ctx, req, res));
  router.get('/classes', (req, res) => listClasses(ctx, req, res));
  router.get('/classes/:classId/info', (req, res) => getClassInfo(ctx, req, res));
  router.delete('/classes/:classId', (req, res) => deleteClass(ctx, req, res));
  router.post('/classes', (req, res) => createClass(ctx, req, res));
  return router;
}
