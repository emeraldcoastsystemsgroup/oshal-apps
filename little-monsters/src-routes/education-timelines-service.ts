/**
 * Named student timelines service (RP-LM-05).
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Persist owner-scoped named timelines in the student account with idempotent localStorage import, rename, delete, and event sync
 * ---------------------------------------------------------------------------
 *
 * @module education-timelines-service
 */

import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { EducationAccessError, resolveAuthedStudent, type AuthedStudent } from './education-access';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TimelineEventItem {
  id: string;
  date: string;
  sortKey: number;
  title: string;
  note: string;
}

function parseEvents(raw: unknown): TimelineEventItem[] {
  const arr = typeof raw === 'string'
    ? (() => { try { return JSON.parse(raw); } catch { return []; } })()
    : raw;
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, 250)
    .map((item: any) => ({
      id: typeof item?.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 80) : randomUUID(),
      date: typeof item?.date === 'string' ? item.date.trim().slice(0, 80) : '',
      sortKey: Number.isFinite(Number(item?.sortKey)) ? Number(item.sortKey) : 0,
      title: typeof item?.title === 'string' ? item.title.trim().slice(0, 200) : '',
      note: typeof item?.note === 'string' ? item.note.trim().slice(0, 1000) : '',
    }))
    .filter((item) => item.date && item.title)
    .sort((a, b) => a.sortKey - b.sortKey);
}

function normalizeTitle(raw: unknown, fallback = 'Timeline'): string {
  const title = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return (title || fallback).slice(0, 120);
}

function mapTimelineRow(row: any): Record<string, unknown> {
  return {
    timelineId: row.timeline_id,
    title: row.title,
    events: parseEvents(row.events),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Serve GET /student/timelines/dashboard listing the signed-in student's saved timelines. */
export async function listStudentTimelines(pool: any, req: Request, res: Response): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, pool);
    const result = await pool.query(
      `SELECT timeline_id, title, events, created_at, updated_at
       FROM lm_timelines
       WHERE student_id = $1 AND tenant_id = $2
       ORDER BY updated_at DESC`,
      [actor.studentId, actor.tenantId],
    );
    res.json({
      timelines: result.rows.map(mapTimelineRow),
    });
  } catch (err) {
    if (err instanceof EducationAccessError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load timelines' });
  }
}

async function createOrImportTimeline(
  pool: any,
  actor: AuthedStudent,
  body: Record<string, unknown>,
  onlyIfEmpty: boolean,
): Promise<Record<string, unknown>> {
  if (onlyIfEmpty) {
    const existing = await pool.query(
      `SELECT timeline_id, title, events, created_at, updated_at
       FROM lm_timelines
       WHERE student_id = $1 AND tenant_id = $2
       ORDER BY updated_at DESC`,
      [actor.studentId, actor.tenantId],
    );
    if (existing.rows.length > 0) {
      return { imported: false, timeline: mapTimelineRow(existing.rows[0]) };
    }
  }
  const timelineId = randomUUID();
  const title = normalizeTitle(body.title, 'Timeline');
  const events = parseEvents(body.events);
  const inserted = await pool.query(
    `INSERT INTO lm_timelines (timeline_id, student_id, tenant_id, title, events)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING timeline_id, title, events, created_at, updated_at`,
    [timelineId, actor.studentId, actor.tenantId, title, JSON.stringify(events)],
  );
  return { imported: onlyIfEmpty, timeline: mapTimelineRow(inserted.rows[0]) };
}

async function renameTimeline(
  pool: any,
  actor: AuthedStudent,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const timelineId = typeof body.timelineId === 'string' ? body.timelineId.trim() : '';
  if (!UUID_PATTERN.test(timelineId)) throw new EducationAccessError('Valid timelineId is required.', 400);
  const title = normalizeTitle(body.title, '');
  if (!title) throw new EducationAccessError('Timeline title is required.', 400);
  const updated = await pool.query(
    `UPDATE lm_timelines
     SET title = $1, updated_at = NOW()
     WHERE timeline_id = $2 AND student_id = $3 AND tenant_id = $4
     RETURNING timeline_id, title, events, created_at, updated_at`,
    [title, timelineId, actor.studentId, actor.tenantId],
  );
  if (updated.rows.length === 0) throw new EducationAccessError('Timeline not found.', 404);
  return { timeline: mapTimelineRow(updated.rows[0]) };
}

async function saveTimelineEvents(
  pool: any,
  actor: AuthedStudent,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const timelineId = typeof body.timelineId === 'string' ? body.timelineId.trim() : '';
  if (!UUID_PATTERN.test(timelineId)) throw new EducationAccessError('Valid timelineId is required.', 400);
  const events = parseEvents(body.events);
  const updated = await pool.query(
    `UPDATE lm_timelines
     SET events = $1::jsonb, updated_at = NOW()
     WHERE timeline_id = $2 AND student_id = $3 AND tenant_id = $4
     RETURNING timeline_id, title, events, created_at, updated_at`,
    [JSON.stringify(events), timelineId, actor.studentId, actor.tenantId],
  );
  if (updated.rows.length === 0) throw new EducationAccessError('Timeline not found.', 404);
  return { timeline: mapTimelineRow(updated.rows[0]) };
}

async function deleteTimeline(
  pool: any,
  actor: AuthedStudent,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const timelineId = typeof body.timelineId === 'string' ? body.timelineId.trim() : '';
  if (!UUID_PATTERN.test(timelineId)) throw new EducationAccessError('Valid timelineId is required.', 400);
  const deleted = await pool.query(
    `DELETE FROM lm_timelines
     WHERE timeline_id = $1 AND student_id = $2 AND tenant_id = $3
     RETURNING timeline_id`,
    [timelineId, actor.studentId, actor.tenantId],
  );
  if (deleted.rows.length === 0) throw new EducationAccessError('Timeline not found.', 404);
  return { deleted: true, timelineId };
}

/** Handle timeline mutations posted through POST /notify with timelineAction. */
export async function handleTimelineMutation(pool: any, req: Request, res: Response): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, pool);
    const body = (req.body || {}) as Record<string, unknown>;
    const action = String(body.timelineAction || '');
    if (action === 'create') {
      res.status(201).json({ success: true, ...(await createOrImportTimeline(pool, actor, body, false)) });
      return;
    }
    if (action === 'import') {
      res.json({ success: true, ...(await createOrImportTimeline(pool, actor, body, true)) });
      return;
    }
    if (action === 'rename') {
      res.json({ success: true, ...(await renameTimeline(pool, actor, body)) });
      return;
    }
    if (action === 'update') {
      res.json({ success: true, ...(await saveTimelineEvents(pool, actor, body)) });
      return;
    }
    if (action === 'delete') {
      res.json({ success: true, ...(await deleteTimeline(pool, actor, body)) });
      return;
    }
    res.status(400).json({ error: 'Unsupported timelineAction' });
  } catch (err) {
    if (err instanceof EducationAccessError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Timeline update failed' });
  }
}
