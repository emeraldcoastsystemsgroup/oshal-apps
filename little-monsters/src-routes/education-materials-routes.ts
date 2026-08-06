/**
 * Education material routes with private ownership and teacher-moderated sharing.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | roger.murphy@agenticfederal.us              | Added enrolled-student material upload, list, and file routes
 * 2   | roger.murphy@agenticfederal.us              | Added private grounding, OCR, and teacher sharing decisions
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Isolated every material in a revocable RAG collection and hardened file lifecycle boundaries
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | Locked tenant, ownership, sharing, grounding, and deletion lifecycle decisions against concurrent authorization changes
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | Replace wildcard material reads and mutation results with the lifecycle fields the authorization boundary actually consumes
 * ---------------------------------------------------------------------------
 *
 * @module education-materials-routes
 */

import * as fs from 'fs';
import { Router, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import {
  assertClassAccess,
  assertTeacherOfClass,
  EducationAccessError,
  resolveAuthedStudent,
  type AuthedStudent,
} from './education-access';
import {
  deleteMaterialCollection,
  deleteStoredMaterial,
  extractMaterialText,
  extractStoredMaterialText,
  ingestMaterialText,
  materialCollectionName,
  resolveStoredMaterialPath,
  saveMaterialFile,
  type StoredMaterialRow,
} from './education-material-storage';

const logger = createChildLogger({ module: 'education-materials-routes' });
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_DAILY_BYTES = 50 * 1024 * 1024;

interface UploadedFile {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
  size?: number;
}

interface MaterialRow extends StoredMaterialRow {
  kind?: string;
  title?: string;
  share_status: 'private' | 'requested' | 'approved' | 'denied';
  shared?: boolean;
  created_at?: string;
}

interface LockedMaterialRow extends MaterialRow {
  actor_role: AuthedStudent['role'];
  teacher_student_id: string | null;
}

interface MaterialTransaction {
  client: PoolClient;
  row: LockedMaterialRow;
  /** Set only after this transaction creates a previously untracked collection. */
  createdCollection: string | null;
}

/** Map only deliberate access failures to their public status. */
function sendAccessError(res: Response, err: unknown): boolean {
  if (!(err instanceof EducationAccessError)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

/** Reject malformed UUIDs before they reach filesystem or PostgreSQL casts. */
function requireUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new EducationAccessError(`${field} must be a UUID`, 400);
}

/** Classify a display kind independently from the security-sensitive MIME type. */
function normalizeKind(hint: unknown, mimeType?: string): string {
  const value = String(hint || '').toLowerCase();
  if (['textbook', 'syllabus', 'handout', 'assignment'].includes(value)) return value;
  if (String(mimeType || '').startsWith('image/')) return 'image';
  return 'document';
}

/** Load all lifecycle fields needed for authorization, containment, and RAG cleanup. */
async function loadMaterial(ctx: AppContext, materialId: string): Promise<MaterialRow | null> {
  requireUuid(materialId, 'materialId');
  const result = await ctx.pool.query(
    `SELECT material_id, class_id, uploaded_by, original_name, stored_path,
            mime_type, size_bytes, kind, title, created_at, shared,
            share_status, rag_collection
       FROM lm_materials WHERE material_id = $1`,
    [materialId],
  );
  return result.rows[0] || null;
}

/**
 * Lock the mutable authorization graph in class-first order.
 *
 * Class deletion uses the same class-then-material order. The initial unlocked
 * lookup is only a locator; both identifiers and every tenant relationship are
 * rechecked after their authoritative rows have been locked.
 */
async function lockMaterialBoundary(
  client: PoolClient,
  caller: AuthedStudent,
  materialId: string,
): Promise<LockedMaterialRow | null> {
  requireUuid(materialId, 'materialId');
  const located = await client.query('SELECT class_id FROM lm_materials WHERE material_id = $1', [materialId]);
  const classId = located.rows[0]?.class_id;
  if (!classId) return null;
  const authority = await client.query(
    `SELECT c.teacher_student_id, a.role AS actor_role
       FROM lm_classes c
       JOIN lm_students a ON a.student_id = $2 AND a.tenant_id = c.tenant_id
      WHERE c.class_id = $1 AND c.tenant_id = $3
      FOR UPDATE OF c, a`,
    [classId, caller.studentId, caller.tenantId],
  );
  if (!authority.rows[0]) return null;
  const material = await client.query<MaterialRow>(
    `SELECT m.material_id, m.class_id, m.uploaded_by, m.original_name,
            m.stored_path, m.mime_type, m.size_bytes, m.kind, m.title,
            m.created_at, m.shared, m.share_status, m.rag_collection
       FROM lm_materials m
       JOIN lm_students uploader ON uploader.student_id = m.uploaded_by AND uploader.tenant_id = $3
      WHERE m.material_id = $1 AND m.class_id = $2
      FOR UPDATE OF m, uploader`,
    [materialId, classId, caller.tenantId],
  );
  if (!material.rows[0]) return null;
  return { ...material.rows[0], ...authority.rows[0] } as LockedMaterialRow;
}

/** Use the live locked role and class owner, never the request's earlier snapshot. */
function hasLockedTeacherControl(caller: AuthedStudent, row: LockedMaterialRow): boolean {
  return row.actor_role === 'admin'
    || (row.actor_role === 'teacher' && row.teacher_student_id === caller.studentId);
}

/** Lock a student's current enrollment when elevated class control is absent. */
async function assertLockedClassAccess(
  client: PoolClient,
  caller: AuthedStudent,
  row: LockedMaterialRow,
): Promise<void> {
  if (hasLockedTeacherControl(caller, row)) return;
  const result = await client.query(
    `SELECT 1 FROM lm_enrollments
      WHERE student_id = $1 AND class_id = $2 AND tenant_id = $3
      FOR SHARE`,
    [caller.studentId, row.class_id, caller.tenantId],
  );
  if (!result.rows[0]) throw new EducationAccessError('Class access changed', 409);
}

/** Fail closed when the live locked actor no longer controls this class. */
function assertLockedTeacherControl(caller: AuthedStudent, row: LockedMaterialRow): void {
  if (!hasLockedTeacherControl(caller, row)) {
    throw new EducationAccessError('Class authorization changed', 409);
  }
}

/** Roll back without hiding the lifecycle operation's original failure. */
async function rollbackMaterialTransaction(client: PoolClient, materialId: string, cause: unknown): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch (err) {
    logger.error({ err, cause, materialId }, 'Material lifecycle transaction rollback failed');
  }
}

/** Remove newly ingested data when a pre-commit SQL operation is rolled back. */
async function compensateGrounding(collection: string, materialId: string, cause: unknown): Promise<void> {
  try {
    await deleteMaterialCollection(collection);
    logger.info({ collection, materialId }, 'Rolled-back material grounding removed');
  } catch (err) {
    logger.error({ err, cause, collection, materialId }, 'Rolled-back material grounding cleanup failed');
  }
}

/** Run one lifecycle change while all tenant and ownership rows remain locked. */
async function runLockedMaterialTransaction<T>(
  ctx: AppContext,
  caller: AuthedStudent,
  materialId: string,
  operation: (transaction: MaterialTransaction) => Promise<T>,
): Promise<T> {
  const client = await ctx.pool.connect();
  let transaction: MaterialTransaction | null = null;
  let commitAttempted = false;
  try {
    await client.query('BEGIN');
    const row = await lockMaterialBoundary(client, caller, materialId);
    if (!row) throw new EducationAccessError('Material not found', 404);
    transaction = { client, row, createdCollection: null };
    const output = await operation(transaction);
    commitAttempted = true;
    await client.query('COMMIT');
    return output;
  } catch (err) {
    await rollbackMaterialTransaction(client, materialId, err);
    if (transaction?.createdCollection && !commitAttempted) {
      await compensateGrounding(transaction.createdCollection, materialId, err);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Bound repeated uploads for one student; multer also bounds each individual body. */
async function assertDailyUploadQuota(db: Pick<PoolClient, 'query'>, studentId: string, incomingBytes: number): Promise<void> {
  const result = await db.query(
    `SELECT COALESCE(SUM(size_bytes), 0)::bigint AS used
       FROM lm_materials WHERE uploaded_by = $1 AND created_at >= NOW() - interval '24 hours'`,
    [studentId],
  );
  if (Number(result.rows[0]?.used || 0) + incomingBytes > MAX_DAILY_BYTES) {
    throw new EducationAccessError('Daily material upload limit exceeded', 429);
  }
}

/** Lock current actor role, class ownership, and enrollment during storage. */
async function assertLockedMaterialClass(
  client: PoolClient,
  caller: AuthedStudent,
  classId: string,
): Promise<boolean> {
  const classRow = (await client.query(
    `SELECT c.teacher_student_id, a.role AS actor_role
       FROM lm_classes c
       JOIN lm_students a ON a.student_id = $2 AND a.tenant_id = c.tenant_id
      WHERE c.class_id = $1 AND c.tenant_id = $3
      FOR SHARE OF c, a`,
    [classId, caller.studentId, caller.tenantId],
  )).rows[0];
  if (!classRow) throw new EducationAccessError('Class not found', 404);
  const teacher = classRow.actor_role === 'admin'
    || (classRow.actor_role === 'teacher' && classRow.teacher_student_id === caller.studentId);
  if (teacher) return true;
  const enrollment = await client.query(
    `SELECT 1 FROM lm_enrollments
      WHERE student_id = $1 AND class_id = $2 AND tenant_id = $3
      FOR SHARE`,
    [caller.studentId, classId, caller.tenantId],
  );
  if (!enrollment.rows[0]) throw new EducationAccessError('Class access changed', 409);
  return false;
}

/** Insert the material row through the same transaction that reserved its quota. */
async function insertMaterialRow(
  client: PoolClient,
  caller: AuthedStudent,
  classId: string,
  file: UploadedFile,
  input: any,
  shareStatus: MaterialRow['share_status'],
  storedPath: string,
  mimeType: string,
): Promise<MaterialRow> {
  const result = await client.query(
    `INSERT INTO lm_materials
       (class_id, uploaded_by, original_name, stored_path, mime_type, size_bytes, kind, title, shared, share_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING material_id, class_id, uploaded_by, original_name, stored_path,
               mime_type, size_bytes, kind, title, created_at, shared,
               share_status, rag_collection`,
    [classId, caller.studentId, file.originalname || 'material', storedPath, mimeType,
      file.buffer.length, normalizeKind(input.kind || input.type, mimeType),
      String(input.title || file.originalname || 'Material').slice(0, 500),
      shareStatus === 'approved', shareStatus],
  );
  return result.rows[0];
}

/** Serialize the student's daily quota and row creation around the exclusive file write. */
async function insertUploadedMaterial(
  ctx: AppContext,
  caller: AuthedStudent,
  classId: string,
  file: UploadedFile,
  input: any,
  wantsShare: boolean,
): Promise<MaterialRow> {
  const client = await ctx.pool.connect();
  let pending: StoredMaterialRow | null = null;
  try {
    await client.query('BEGIN');
    const teacher = await assertLockedMaterialClass(client, caller, classId);
    const shareStatus = wantsShare ? (teacher ? 'approved' : 'requested') : 'private';
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`lm-upload:${caller.studentId}`]);
    await assertDailyUploadQuota(client, caller.studentId, file.buffer.length);
    const saved = saveMaterialFile(classId, caller.studentId, file);
    pending = { material_id: 'pending', class_id: classId, uploaded_by: caller.studentId,
      stored_path: saved.storedPath, mime_type: saved.mimeType };
    const row = await insertMaterialRow(
      client, caller, classId, file, input, shareStatus, saved.storedPath, saved.mimeType,
    );
    await client.query('COMMIT');
    return row;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rollbackErr) {
      logger.error({ err: rollbackErr, cause: err }, 'Material upload transaction rollback failed');
    }
    if (pending) {
      try { deleteStoredMaterial(pending); } catch (cleanupErr) {
        logger.error({ err: cleanupErr, cause: err }, 'Uncommitted material file cleanup failed');
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Ingest once while the material, uploader, class, and acting identity are locked.
 *
 * The collection pointer is written through the transaction's own client. This
 * avoids self-blocking on a second pooled connection and keeps readers from
 * observing an approved pointer until the authorization transaction commits.
 */
async function ensureMaterialGrounding(
  transaction: MaterialTransaction,
  text?: string,
): Promise<string | null> {
  const { client, row } = transaction;
  if (row.rag_collection) return row.rag_collection;
  const extracted = text === undefined ? await extractStoredMaterialText(row) : text;
  if (!extracted) return null;
  const collection = materialCollectionName(row.material_id);
  const ingested = await ingestMaterialText(extracted, collection, {
    classId: row.class_id,
    materialId: row.material_id,
    studentId: row.uploaded_by,
    source: row.original_name || 'material',
  });
  if (!ingested) return null;
  transaction.createdCollection = collection;
  const result = await client.query(
    `UPDATE lm_materials SET rag_collection = $2
      WHERE material_id = $1 AND rag_collection IS NULL`,
    [row.material_id, collection],
  );
  if (result.rowCount !== 1) throw new EducationAccessError('Material grounding state changed', 409);
  row.rag_collection = collection;
  return collection;
}

/** Revalidate an uploaded row before its content enters the retrieval system. */
async function groundUploadedMaterial(
  ctx: AppContext,
  caller: AuthedStudent,
  materialId: string,
  text: string,
): Promise<string | null> {
  return runLockedMaterialTransaction(ctx, caller, materialId, async transaction => {
    if (transaction.row.uploaded_by !== caller.studentId) {
      throw new EducationAccessError('Material ownership changed', 409);
    }
    await assertLockedClassAccess(transaction.client, caller, transaction.row);
    if (transaction.row.share_status === 'approved') {
      assertLockedTeacherControl(caller, transaction.row);
    }
    return ensureMaterialGrounding(transaction, text);
  });
}

/** Accept a bounded upload only after identity and class enrollment are proven. */
async function uploadMaterial(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const classId = String(req.body?.classId || '');
    const file = (req as Request & { file?: UploadedFile }).file;
    requireUuid(classId, 'classId');
    if (!file?.buffer) {
      res.status(400).json({ error: 'file is required' });
      return;
    }
    const caller = await resolveAuthedStudent(req, ctx.pool);
    await assertClassAccess(ctx.pool, caller, classId);
    const wantsShare = req.body?.share === true || String(req.body?.share || '') === 'true';
    const row = await insertUploadedMaterial(ctx, caller, classId, file, req.body || {}, wantsShare);
    const shareStatus = row.share_status;
    const text = await extractMaterialText(file);
    const collection = await groundUploadedMaterial(ctx, caller, row.material_id, text);
    logger.info({ classId, materialId: row.material_id, shareStatus, grounded: Boolean(collection) }, 'Material uploaded');
    res.status(201).json({ success: true, material: row, grounded: Boolean(collection), shareStatus });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Material upload failed');
    res.status(500).json({ error: 'Material upload failed' });
  }
}

/** List only materials owned by the authenticated caller in the requested class. */
async function listOwnMaterials(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const classId = String(req.params.classId);
    requireUuid(classId, 'classId');
    const caller = await resolveAuthedStudent(req, ctx.pool);
    await assertClassAccess(ctx.pool, caller, classId);
    const result = await ctx.pool.query(
      `SELECT material_id, original_name, mime_type, size_bytes, kind, title, shared, share_status, created_at
       FROM lm_materials m WHERE m.class_id = $1 AND m.uploaded_by = $2
         AND EXISTS (SELECT 1 FROM lm_classes c WHERE c.class_id = m.class_id AND c.tenant_id = $3
           AND ($4::boolean OR ($5::boolean AND c.teacher_student_id = $2)
             OR EXISTS (SELECT 1 FROM lm_enrollments e
               WHERE e.student_id = $2 AND e.class_id = c.class_id)))
       ORDER BY created_at DESC`,
      [classId, caller.studentId, caller.tenantId,
        caller.role === 'admin', caller.role === 'teacher'],
    );
    res.json({ materials: result.rows });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Failed to list owned materials');
    res.status(500).json({ error: 'Failed to list materials' });
  }
}

/** List only currently approved rows after proving membership in the class. */
async function listSharedMaterials(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const classId = String(req.params.classId);
    requireUuid(classId, 'classId');
    const caller = await resolveAuthedStudent(req, ctx.pool);
    await assertClassAccess(ctx.pool, caller, classId);
    const result = await ctx.pool.query(
      `SELECT m.material_id, m.original_name, m.mime_type, m.size_bytes, m.kind, m.title, m.created_at,
              s.name AS shared_by_name
       FROM lm_materials m LEFT JOIN lm_students s ON s.student_id = m.uploaded_by
       WHERE m.class_id = $1 AND m.share_status = 'approved'
         AND EXISTS (SELECT 1 FROM lm_classes c WHERE c.class_id = m.class_id AND c.tenant_id = $2
           AND ($3::boolean OR ($4::boolean AND c.teacher_student_id = $5)
             OR EXISTS (SELECT 1 FROM lm_enrollments e
               WHERE e.student_id = $5 AND e.class_id = c.class_id)))
       ORDER BY m.created_at DESC`,
      [classId, caller.tenantId, caller.role === 'admin',
        caller.role === 'teacher', caller.studentId],
    );
    res.json({ materials: result.rows });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Failed to list shared materials');
    res.status(500).json({ error: 'Failed to list shared materials' });
  }
}

/** List pending requests for the class's current teacher or tenant admin. */
async function listShareRequests(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const classId = String(req.params.classId);
    requireUuid(classId, 'classId');
    const caller = await resolveAuthedStudent(req, ctx.pool);
    await assertTeacherOfClass(ctx.pool, caller, classId);
    const result = await ctx.pool.query(
      `SELECT m.material_id, m.original_name, m.kind, m.title, m.created_at, s.name AS requested_by_name
       FROM lm_materials m LEFT JOIN lm_students s ON s.student_id = m.uploaded_by
       JOIN lm_classes c ON c.class_id = m.class_id
       WHERE m.class_id = $1 AND m.share_status = 'requested' AND c.tenant_id = $2
         AND ($3::boolean OR c.teacher_student_id = $4)
       ORDER BY m.created_at`,
      [classId, caller.tenantId, caller.role === 'admin', caller.studentId],
    );
    res.json({ requests: result.rows });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Failed to list material share requests');
    res.status(500).json({ error: 'Failed to list share requests' });
  }
}

/** Bind an uploader's final share update to live tenant and class access. */
async function updateOwnedShareStatus(
  transaction: MaterialTransaction,
  caller: AuthedStudent,
  status: 'requested' | 'approved',
): Promise<void> {
  const result = await transaction.client.query(
    `UPDATE lm_materials m SET share_status = $2, shared = $3
       FROM lm_classes c, lm_students a
      WHERE m.material_id = $1 AND m.uploaded_by = $4
        AND c.class_id = m.class_id AND c.tenant_id = $5
        AND a.student_id = $4 AND a.tenant_id = c.tenant_id
        AND (a.role = 'admin'
          OR (a.role = 'teacher' AND c.teacher_student_id = a.student_id)
          OR EXISTS (SELECT 1 FROM lm_enrollments e
            WHERE e.student_id = a.student_id AND e.class_id = c.class_id
              AND e.tenant_id = c.tenant_id))`,
    [transaction.row.material_id, status, status === 'approved', caller.studentId, caller.tenantId],
  );
  if (result.rowCount !== 1) throw new EducationAccessError('Material class access changed', 409);
}

/** Revalidate uploader, enrollment, and direct-approval authority under locks. */
async function requestMaterialShareRows(
  ctx: AppContext,
  caller: AuthedStudent,
  materialId: string,
): Promise<'requested' | 'approved'> {
  return runLockedMaterialTransaction(ctx, caller, materialId, async transaction => {
    if (transaction.row.uploaded_by !== caller.studentId) {
      throw new EducationAccessError('Only the uploader can request sharing', 403);
    }
    await assertLockedClassAccess(transaction.client, caller, transaction.row);
    const teacher = hasLockedTeacherControl(caller, transaction.row);
    if (teacher) await ensureMaterialGrounding(transaction);
    const status = teacher ? 'approved' : 'requested';
    await updateOwnedShareStatus(transaction, caller, status);
    return status;
  });
}

/** Let only the uploader request sharing; live class owners approve directly. */
async function requestMaterialShare(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const caller = await resolveAuthedStudent(req, ctx.pool);
    const materialId = String(req.params.materialId);
    const status = await requestMaterialShareRows(ctx, caller, materialId);
    logger.info({ materialId, status, studentId: caller.studentId }, 'Material share request applied');
    res.json({ success: true, share_status: status });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Material share request failed');
    res.status(500).json({ error: 'Material share request failed' });
  }
}

/** Bind moderation to the live tenant, owner, actor role, and class owner. */
async function updateModeratedShareStatus(
  transaction: MaterialTransaction,
  caller: AuthedStudent,
  status: 'approved' | 'denied',
): Promise<void> {
  const result = await transaction.client.query(
    `UPDATE lm_materials m SET share_status = $2, shared = $3
       FROM lm_classes c, lm_students a, lm_students uploader
      WHERE m.material_id = $1 AND c.class_id = m.class_id
        AND c.tenant_id = $4 AND a.student_id = $5 AND a.tenant_id = c.tenant_id
        AND uploader.student_id = m.uploaded_by AND uploader.tenant_id = c.tenant_id
        AND (a.role = 'admin'
          OR (a.role = 'teacher' AND c.teacher_student_id = a.student_id))`,
    [transaction.row.material_id, status, status === 'approved', caller.tenantId, caller.studentId],
  );
  if (result.rowCount !== 1) throw new EducationAccessError('Class authorization changed', 409);
}

/** Apply moderation only after locking the live class and material authority. */
async function decideMaterialShareRows(
  ctx: AppContext,
  caller: AuthedStudent,
  materialId: string,
  approved: boolean,
): Promise<'approved' | 'denied'> {
  return runLockedMaterialTransaction(ctx, caller, materialId, async transaction => {
    assertLockedTeacherControl(caller, transaction.row);
    if (approved) await ensureMaterialGrounding(transaction);
    // Denial removes the row from class-wide lookup. The isolated collection
    // remains private to the uploader and can be approved again without re-OCR.
    const status = approved ? 'approved' : 'denied';
    await updateModeratedShareStatus(transaction, caller, status);
    return status;
  });
}

/** Apply a teacher decision through the locked lifecycle transaction. */
async function decideMaterialShare(
  ctx: AppContext,
  req: Request,
  res: Response,
  approved: boolean,
): Promise<void> {
  try {
    const caller = await resolveAuthedStudent(req, ctx.pool);
    const materialId = String(req.params.materialId);
    const status = await decideMaterialShareRows(ctx, caller, materialId, approved);
    logger.info({ materialId, status, studentId: caller.studentId }, 'Material share decision applied');
    res.json({ success: true, share_status: status });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Material share decision failed');
    res.status(500).json({ error: 'Material share decision failed' });
  }
}

/** Stream a contained file only to its owner or an enrolled member after approval. */
async function streamMaterial(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const caller = await resolveAuthedStudent(req, ctx.pool);
    const row = await loadMaterial(ctx, String(req.params.materialId));
    if (!row) {
      res.status(404).json({ error: 'Material not found' });
      return;
    }
    if (row.uploaded_by !== caller.studentId) {
      if (row.share_status !== 'approved') throw new EducationAccessError('This material is private', 403);
      await assertClassAccess(ctx.pool, caller, row.class_id);
    }
    const storedPath = resolveStoredMaterialPath(row);
    const mimeType = row.mime_type || 'application/octet-stream';
    const disposition = mimeType === 'application/pdf' || mimeType.startsWith('image/') || mimeType.startsWith('text/plain')
      ? 'inline' : 'attachment';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(row.original_name || 'material')}`);
    fs.createReadStream(storedPath).on('error', err => {
      logger.error({ err, materialId: row.material_id }, 'Material stream failed');
      if (!res.headersSent) res.status(500).end();
      else res.destroy(err);
    }).pipe(res);
  } catch (err) {
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Failed to stream material');
    res.status(404).json({ error: 'Material file is unavailable' });
  }
}

/** Remove the locked row only while the current database authority still matches. */
async function deleteAuthorizedMaterialRow(
  transaction: MaterialTransaction,
  caller: AuthedStudent,
): Promise<void> {
  const result = await transaction.client.query(
    `DELETE FROM lm_materials m
       USING lm_classes c, lm_students a, lm_students uploader
      WHERE m.material_id = $1 AND c.class_id = m.class_id
        AND c.tenant_id = $3 AND a.student_id = $2 AND a.tenant_id = c.tenant_id
        AND uploader.student_id = m.uploaded_by AND uploader.tenant_id = c.tenant_id
        AND (m.uploaded_by = a.student_id OR a.role = 'admin'
          OR (a.role = 'teacher' AND c.teacher_student_id = a.student_id))`,
    [transaction.row.material_id, caller.studentId, caller.tenantId],
  );
  if (result.rowCount !== 1) {
    throw new EducationAccessError('Material authorization changed before deletion completed', 409);
  }
}

/**
 * Reach the irreversible external desired state before deleting its SQL pointer.
 *
 * Collection and file deletes are exact and idempotent. If either store fails,
 * the callback throws and PostgreSQL retains the locked row for a safe retry;
 * partially completed cleanup is therefore not mistaken for full deletion.
 */
async function deleteLockedMaterial(
  transaction: MaterialTransaction,
  caller: AuthedStudent,
): Promise<LockedMaterialRow> {
  const owner = transaction.row.uploaded_by === caller.studentId;
  if (!owner && !hasLockedTeacherControl(caller, transaction.row)) {
    throw new EducationAccessError('Only the uploader or class teacher can delete this material', 403);
  }
  if (transaction.row.rag_collection) {
    await deleteMaterialCollection(transaction.row.rag_collection);
  }
  deleteStoredMaterial(transaction.row);
  await deleteAuthorizedMaterialRow(transaction, caller);
  return transaction.row;
}

/** Delete material artifacts only after locking and revalidating live authority. */
async function deleteMaterial(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const caller = await resolveAuthedStudent(req, ctx.pool);
    const materialId = String(req.params.materialId);
    const row = await runLockedMaterialTransaction(
      ctx,
      caller,
      materialId,
      transaction => deleteLockedMaterial(transaction, caller),
    );
    logger.info({ materialId: row.material_id, studentId: caller.studentId }, 'Material fully deleted');
    res.json({ success: true });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Material deletion failed');
    res.status(503).json({ error: 'Material deletion could not be completed safely' });
  }
}

/** Register small named handlers so each authorization boundary is testable. */
export function createEducationMaterialsRoutes(ctx: AppContext): Router {
  const router = Router();
  const multer = require('multer');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  router.post('/materials', upload.single('file'), (req, res) => uploadMaterial(ctx, req, res));
  router.post('/upload-material', upload.single('file'), (req, res) => uploadMaterial(ctx, req, res));
  router.get('/classes/:classId/materials', (req, res) => listOwnMaterials(ctx, req, res));
  router.get('/classes/:classId/shared-materials', (req, res) => listSharedMaterials(ctx, req, res));
  router.get('/classes/:classId/share-requests', (req, res) => listShareRequests(ctx, req, res));
  router.post('/materials/:materialId/share-request', (req, res) => requestMaterialShare(ctx, req, res));
  router.post('/materials/:materialId/approve', (req, res) => decideMaterialShare(ctx, req, res, true));
  router.post('/materials/:materialId/deny', (req, res) => decideMaterialShare(ctx, req, res, false));
  router.get('/materials/:materialId/file', (req, res) => streamMaterial(ctx, req, res));
  router.delete('/materials/:materialId', (req, res) => deleteMaterial(ctx, req, res));
  return router;
}
