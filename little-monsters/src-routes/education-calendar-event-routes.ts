/**
 * Caller-scoped calendar event routes.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Extracted personal and teacher-owned event mutations with strict scope checks
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Replace wildcard event reads with the caller-visible calendar projection
 * ---------------------------------------------------------------------------
 *
 * @module education-calendar-event-routes
 */

import { Router, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import {
  assertClassAccess,
  assertTeacherOfClass,
  EducationAccessError,
  resolveAuthedStudent,
  type AuthedStudent,
} from './education-access';
import {
  formatDueUrgency,
  ISO_DATE_PATTERN,
  MONTH_PATTERN,
  requirePattern,
  sendCalendarAccessError,
  UUID_PATTERN,
} from './education-calendar-support';

const logger = createChildLogger({ module: 'education-calendar-event-routes' });

interface CalendarQuery {
  sql: string;
  params: unknown[];
}

/** Build the visibility predicate from the server-resolved principal. */
async function buildCalendarQuery(ctx: AppContext, caller: AuthedStudent, req: Request): Promise<CalendarQuery> {
  const classId = req.query.classId ? String(req.query.classId) : '';
  const month = req.query.month ? String(req.query.month) : '';
  const params: unknown[] = [
    caller.studentId,
    caller.tenantId,
    caller.role === 'admin',
    caller.role === 'teacher',
  ];
  let sql = `SELECT e.event_id, e.class_id, e.student_id, e.title,
                    e.description, e.event_type, e.event_date, e.event_time,
                    e.remind_at, e.created_at, c.name AS class_name, c.subject
               FROM lm_calendar_events e
               LEFT JOIN lm_classes c ON c.class_id = e.class_id
              WHERE (e.student_id = $1 OR (
                e.student_id IS NULL AND c.tenant_id = $2 AND (
                  $3::boolean OR ($4::boolean AND c.teacher_student_id = $1)
                  OR EXISTS (SELECT 1 FROM lm_enrollments ae
                    WHERE ae.student_id = $1 AND ae.class_id = c.class_id)
                )
              ))`;
  if (classId) {
    requirePattern(classId, UUID_PATTERN, 'classId');
    await assertClassAccess(ctx.pool, caller, classId);
    params.push(classId);
    sql += ` AND e.class_id = $${params.length}`;
  }
  if (month) {
    requirePattern(month, MONTH_PATTERN, 'month');
    params.push(`${month}-01`);
    sql += ` AND e.event_date >= $${params.length}::date
             AND e.event_date < ($${params.length}::date + interval '1 month')`;
  }
  return { sql: `${sql} ORDER BY e.event_date, e.event_time NULLS LAST`, params };
}

/** List only personal events and shared events from classes the caller may access. */
async function listCalendarEvents(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const caller = await resolveAuthedStudent(req, ctx.pool);
    const query = await buildCalendarQuery(ctx, caller, req);
    const result = await ctx.pool.query(query.sql, query.params);
    const events = result.rows.map(event => ({
      ...event,
      urgency: formatDueUrgency(event.event_date),
    }));
    res.json({ events });
  } catch (err) {
    if (sendCalendarAccessError(res, err)) return;
    logger.error({ err }, 'Failed to list calendar events');
    res.status(500).json({ error: 'Failed to list calendar events' });
  }
}

/** Create a personal event; clients cannot create class-wide rows through this route. */
async function createPersonalEvent(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const caller = await resolveAuthedStudent(req, ctx.pool);
    const input = req.body ?? {};
    const classId = input.classId ? String(input.classId) : null;
    const title = String(input.title ?? '').trim();
    const eventDate = String(input.eventDate ?? '');
    if (!title || title.length > 500) throw new Error('title must contain 1-500 characters');
    requirePattern(eventDate, ISO_DATE_PATTERN, 'eventDate');
    if (classId) {
      requirePattern(classId, UUID_PATTERN, 'classId');
      await assertClassAccess(ctx.pool, caller, classId);
    }
    const eventType = String(input.eventType || 'custom');
    if (!['assignment', 'quiz', 'test', 'lecture', 'study-session', 'reminder', 'custom'].includes(eventType)) {
      throw new EducationAccessError('eventType is invalid', 400);
    }
    const metadata = JSON.stringify(input.metadata || {});
    if (metadata.length > 10_000) throw new EducationAccessError('metadata is too large', 400);
    const result = await ctx.pool.query(
      `INSERT INTO lm_calendar_events
         (class_id, student_id, title, description, event_type, event_date, event_time, remind_at, metadata)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
        WHERE $1::uuid IS NULL OR EXISTS (
          SELECT 1 FROM lm_classes c WHERE c.class_id = $1 AND c.tenant_id = $10
            AND ($11::boolean OR ($12::boolean AND c.teacher_student_id = $2)
              OR EXISTS (SELECT 1 FROM lm_enrollments e
                WHERE e.student_id = $2 AND e.class_id = c.class_id))
        ) RETURNING event_id`,
      [classId, caller.studentId, title, String(input.description ?? ''), eventType,
        eventDate, input.eventTime || null, input.remindAt || null, metadata,
        caller.tenantId, caller.role === 'admin', caller.role === 'teacher'],
    );
    if (!result.rows[0]) throw new EducationAccessError('Class access changed', 409);
    logger.info({ eventId: result.rows[0].event_id, studentId: caller.studentId }, 'Personal calendar event created');
    res.status(201).json({ eventId: result.rows[0].event_id });
  } catch (err) {
    if (sendCalendarAccessError(res, err)) return;
    const message = err instanceof Error ? err.message : 'Invalid calendar event';
    logger.error({ err }, 'Failed to create personal calendar event');
    res.status(message.startsWith('title ') ? 400 : 500).json({ error: message });
  }
}

/** Lock and re-authorize the class inside the write transaction. */
async function lockAssignmentClass(
  client: PoolClient,
  caller: AuthedStudent,
  classId: string,
): Promise<string> {
  const result = await client.query(
    `SELECT name FROM lm_classes WHERE class_id = $1 AND tenant_id = $2
       AND status = 'active'
       AND ($3::boolean OR ($4::boolean AND teacher_student_id = $5))
       FOR UPDATE`,
    [classId, caller.tenantId, caller.role === 'admin', caller.role === 'teacher', caller.studentId],
  );
  if (!result.rows[0]) throw new EducationAccessError('Class authorization changed', 409);
  return result.rows[0].name;
}

/** Store the assignment and its shared event atomically after ownership was proven. */
async function insertAssignmentWithEvent(
  ctx: AppContext,
  caller: AuthedStudent,
  input: any,
): Promise<Record<string, unknown>> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const className = await lockAssignmentClass(client, caller, input.classId);
    const assignment = await client.query(
      `INSERT INTO lm_assignments (class_id, title, description, assignment_type, due_date, resources)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING assignment_id`,
      [input.classId, input.title, input.description || '', input.assignmentType || 'homework',
        input.dueDate || null, JSON.stringify(input.resources || [])],
    );
    const assignmentId = assignment.rows[0].assignment_id;
    let eventId: string | null = null;
    if (input.dueDate) {
      const remindDate = new Date(`${input.dueDate}T17:00:00`);
      remindDate.setDate(remindDate.getDate() - 1);
      const eventType = input.assignmentType === 'test' ? 'test' : input.assignmentType === 'quiz-prep' ? 'quiz' : 'assignment';
      const event = await client.query(
        `INSERT INTO lm_calendar_events
           (class_id, title, description, event_type, event_date, event_time, source_assignment_id, remind_at, metadata)
         VALUES ($1, $2, $3, $4, $5, '17:00', $6, $7, $8) RETURNING event_id`,
        [input.classId, `${className || 'Class'}: ${input.title}`,
          `${input.description || ''}\n\n${formatDueUrgency(input.dueDate)}`, eventType, input.dueDate,
          assignmentId, remindDate.toISOString(), JSON.stringify({ assignmentType: input.assignmentType, resources: input.resources || [] })],
      );
      eventId = event.rows[0].event_id;
    }
    await client.query('COMMIT');
    return { assignmentId, eventId, dueDate: input.dueDate || null };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Teacher-owned compatibility route for assignment plus calendar creation. */
async function createAssignmentWithEvent(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const input = req.body ?? {};
    input.classId = String(input.classId ?? '');
    input.title = String(input.title ?? '').trim();
    requirePattern(input.classId, UUID_PATTERN, 'classId');
    if (!input.title || input.title.length > 500) throw new Error('title must contain 1-500 characters');
    if (input.dueDate) requirePattern(String(input.dueDate), ISO_DATE_PATTERN, 'dueDate');
    const caller = await resolveAuthedStudent(req, ctx.pool);
    await assertTeacherOfClass(ctx.pool, caller, input.classId);
    const output = await insertAssignmentWithEvent(ctx, caller, input);
    logger.info({ classId: input.classId, assignmentId: output.assignmentId }, 'Assignment calendar event created');
    res.status(201).json({ ...output, urgency: input.dueDate ? formatDueUrgency(input.dueDate) : null });
  } catch (err) {
    if (sendCalendarAccessError(res, err)) return;
    const message = err instanceof Error ? err.message : 'Failed to create assignment';
    logger.error({ err }, 'Failed to create assignment calendar event');
    res.status(message.startsWith('title ') ? 400 : 500).json({ error: message });
  }
}

/** Register the personal event and teacher-owned assignment event routes. */
export function createCalendarEventRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get('/calendar', (req, res) => listCalendarEvents(ctx, req, res));
  router.post('/calendar', (req, res) => createPersonalEvent(ctx, req, res));
  router.post('/assignments-with-events', (req, res) => createAssignmentWithEvent(ctx, req, res));
  return router;
}
