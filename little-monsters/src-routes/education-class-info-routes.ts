/**
 * Tenant-bound class metadata routes retained by the calendar package surface.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Extracted class metadata routes and added final tenant/owner predicates
 * ---------------------------------------------------------------------------
 *
 * @module education-class-info-routes
 */

import { Router, type Request, type Response } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { deregisterDynamicToolUI, registerDynamicToolUI } from '@/app/routes/tool-routes';
import {
  assertTeacher,
  assertTeacherOfClass,
  resolveAuthedStudent,
  type AuthedStudent,
} from './education-access';
import { requirePattern, sendCalendarAccessError, UUID_PATTERN } from './education-calendar-support';

const logger = createChildLogger({ module: 'education-class-info-routes' });

/** Build only metadata keys the caller actually supplied, preserving the rest. */
function editableMetadata(input: any): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const key of ['website', 'schedule', 'room']) {
    if (Object.prototype.hasOwnProperty.call(input, key)) metadata[key] = String(input[key] ?? '');
  }
  return metadata;
}

/** Keep the dynamic ribbon registration aligned with the persisted status. */
async function syncClassTool(ctx: AppContext, classId: string, status: string | null): Promise<void> {
  if (!status) return;
  const stableId = classId.substring(0, 8);
  const iconName = `lm-class-${stableId}`;
  if (status === 'archived') {
    deregisterDynamicToolUI(iconName);
    return;
  }
  const result = await ctx.pool.query('SELECT name FROM lm_classes WHERE class_id = $1', [classId]);
  if (!result.rows[0]) return;
  registerDynamicToolUI(
    iconName,
    result.rows[0].name,
    'codicon codicon-book',
    `/api/education/class?classId=${classId}`,
    `class-tutor-${stableId}`,
  );
}

/** Apply an owner/tenant-bound class update and reject a stale authorization. */
async function updateClassRecord(
  ctx: AppContext,
  caller: AuthedStudent,
  classId: string,
  input: any,
  status: string | null,
  published: boolean | null,
): Promise<void> {
  const result = await ctx.pool.query(
    `UPDATE lm_classes SET
       name = COALESCE($2, name), subject = COALESCE($3, subject),
       teacher_name = COALESCE($4, teacher_name), grade_level = COALESCE($5, grade_level),
       description = COALESCE($6, description), metadata = COALESCE(metadata, '{}'::jsonb) || $7::jsonb,
       status = COALESCE($8, status), published = COALESCE($9, published), updated_at = NOW()
     WHERE class_id = $1 AND tenant_id = $10
       AND ($11 = 'admin' OR teacher_student_id = $12)`,
    [classId, input.name, input.subject, input.teacherName, input.gradeLevel, input.description,
      JSON.stringify(editableMetadata(input)), status, published, caller.tenantId, caller.role, caller.studentId],
  );
  if (!result.rowCount) throw new Error('Class authorization changed before the update completed');
}

/** Update one class only while the caller remains its teacher or tenant admin. */
async function patchClassInfo(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const classId = String(req.params.classId);
    requirePattern(classId, UUID_PATTERN, 'classId');
    const caller = await resolveAuthedStudent(req, ctx.pool);
    await assertTeacherOfClass(ctx.pool, caller, classId);
    const input = req.body ?? {};
    const status = input.status === 'active' || input.status === 'archived' ? input.status : null;
    const published = typeof input.published === 'boolean' ? input.published : null;
    if (published === true) assertTeacher(caller);
    await updateClassRecord(ctx, caller, classId, input, status, published);
    await syncClassTool(ctx, classId, status);
    logger.info({ classId, studentId: caller.studentId, status, published }, 'Class metadata updated');
    res.json({ success: true, status: status || undefined });
  } catch (err) {
    if (sendCalendarAccessError(res, err)) return;
    logger.error({ err, classId: req.params.classId }, 'Failed to update class');
    res.status(500).json({ error: 'Failed to update class' });
  }
}

/** Register the class metadata compatibility routes. */
export function createEducationClassInfoRoutes(ctx: AppContext): Router {
  const router = Router();
  router.patch('/classes/:classId', (req, res) => patchClassInfo(ctx, req, res));
  return router;
}
