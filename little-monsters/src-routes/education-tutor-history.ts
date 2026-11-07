/**
 * Owner-scoped tutoring thread history service (RP-LM-02).
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Persist per-class student tutoring threads, list newest-first, restore prior turns, delete threads, and refuse teacher reads unless school policy allows
 * ---------------------------------------------------------------------------
 *
 * @module education-tutor-history
 */

import { randomUUID } from 'crypto';
import { wrapUntrustedPromptContent } from '@/features/swarm-orchestration/services/prompt-containment';
import {
  assertClassAccess,
  EducationAccessError,
  type AuthedStudent,
} from './education-access';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TutorHistoryActionInput {
  action: 'list' | 'get' | 'delete';
  classId?: string;
  threadId?: string;
  studentId?: string;
}

export interface StoredTutorTurn {
  role: 'user' | 'assistant';
  content: string;
  sources: Array<{ n: number; text: string }>;
  createdAt: string;
}

function parseSources(raw: unknown): Array<{ n: number; text: string }> {
  if (!raw) return [];
  const parsed = typeof raw === 'string' ? (() => {
    try { return JSON.parse(raw); } catch { return []; }
  })() : raw;
  return Array.isArray(parsed) ? parsed : [];
}

function clipTitle(question: string): string {
  const clean = question.replace(/\s+/g, ' ').trim() || 'Homework question';
  return clean.length > 96 ? `${clean.slice(0, 93)}...` : clean;
}

async function assertTeacherThreadVisibility(
  pool: any,
  actor: AuthedStudent,
  targetStudentId: string,
  classId?: string,
): Promise<void> {
  if (targetStudentId === actor.studentId) return;
  if (actor.role !== 'teacher' && actor.role !== 'admin') {
    throw new EducationAccessError('Students may view only their own tutoring threads.', 403);
  }
  const policy = await pool.query(
    'SELECT tutor_history_teacher_visible FROM lm_tenants WHERE tenant_id = $1',
    [actor.tenantId],
  );
  const allowed = Boolean(policy.rows[0]?.tutor_history_teacher_visible);
  if (!allowed) {
    throw new EducationAccessError(
      'School policy keeps student tutoring threads private to each learner.',
      403,
    );
  }
  if (!classId || !UUID_PATTERN.test(classId)) {
    throw new EducationAccessError('classId is required when viewing class tutoring threads.', 400);
  }
  const cls = await pool.query(
    'SELECT teacher_student_id FROM lm_classes WHERE class_id = $1 AND tenant_id = $2',
    [classId, actor.tenantId],
  );
  if (cls.rows.length === 0) throw new EducationAccessError('Class not found.', 404);
  if (actor.role !== 'admin' && cls.rows[0].teacher_student_id !== actor.studentId) {
    throw new EducationAccessError('Teachers may view threads only for classes they teach.', 403);
  }
}

/** List tutoring threads newest-first for the caller (or policy-permitted class student). */
export async function listTutorThreads(
  pool: any,
  actor: AuthedStudent,
  input: TutorHistoryActionInput,
): Promise<Record<string, unknown>> {
  const targetStudentId = input.studentId ? String(input.studentId).trim() : actor.studentId;
  if (!UUID_PATTERN.test(targetStudentId)) {
    throw new EducationAccessError('studentId must be a UUID.', 400);
  }
  await assertTeacherThreadVisibility(pool, actor, targetStudentId, input.classId);
  if (input.classId) {
    if (!UUID_PATTERN.test(input.classId)) {
      throw new EducationAccessError('classId must be a UUID.', 400);
    }
    const rows = await pool.query(
      `SELECT thread_id, class_id, title, first_question, created_at, updated_at
       FROM lm_tutor_threads
       WHERE student_id = $1 AND tenant_id = $2 AND class_id = $3
       ORDER BY updated_at DESC
       LIMIT 50`,
      [targetStudentId, actor.tenantId, input.classId],
    );
    return { success: true, threads: mapThreadRows(rows.rows) };
  }
  const rows = await pool.query(
    `SELECT thread_id, class_id, title, first_question, created_at, updated_at
     FROM lm_tutor_threads
     WHERE student_id = $1 AND tenant_id = $2
     ORDER BY updated_at DESC
     LIMIT 50`,
    [targetStudentId, actor.tenantId],
  );
  return { success: true, threads: mapThreadRows(rows.rows) };
}

function mapThreadRows(rows: any[]): Array<Record<string, unknown>> {
  return rows.map((r) => ({
    threadId: r.thread_id,
    classId: r.class_id || null,
    title: r.title,
    firstQuestion: r.first_question,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** Load one saved tutoring thread and its ordered messages. */
export async function getTutorThread(
  pool: any,
  actor: AuthedStudent,
  input: TutorHistoryActionInput,
): Promise<Record<string, unknown>> {
  const threadId = typeof input.threadId === 'string' ? input.threadId.trim() : '';
  if (!UUID_PATTERN.test(threadId)) throw new EducationAccessError('threadId must be a UUID.', 400);
  const head = await pool.query(
    `SELECT thread_id, student_id, class_id, title, first_question, created_at, updated_at
     FROM lm_tutor_threads
     WHERE thread_id = $1 AND tenant_id = $2`,
    [threadId, actor.tenantId],
  );
  if (head.rows.length === 0) throw new EducationAccessError('Tutoring thread not found.', 404);
  const thread = head.rows[0];
  await assertTeacherThreadVisibility(
    pool,
    actor,
    String(thread.student_id),
    thread.class_id ? String(thread.class_id) : undefined,
  );
  const msgs = await pool.query(
    `SELECT role, content, sources, created_at
     FROM lm_tutor_messages
     WHERE thread_id = $1 AND tenant_id = $2
     ORDER BY turn_index ASC`,
    [threadId, actor.tenantId],
  );
  return {
    success: true,
    thread: {
      threadId: thread.thread_id,
      classId: thread.class_id || null,
      title: thread.title,
      firstQuestion: thread.first_question,
      createdAt: thread.created_at,
      updatedAt: thread.updated_at,
      messages: msgs.rows.map((m: any) => ({
        role: m.role,
        content: m.content,
        sources: parseSources(m.sources),
        createdAt: m.created_at,
      })),
    },
  };
}

/** Delete one tutoring thread owned by the signed-in learner. */
export async function deleteTutorThread(
  pool: any,
  actor: AuthedStudent,
  input: TutorHistoryActionInput,
): Promise<Record<string, unknown>> {
  const threadId = typeof input.threadId === 'string' ? input.threadId.trim() : '';
  if (!UUID_PATTERN.test(threadId)) throw new EducationAccessError('threadId must be a UUID.', 400);
  await pool.query(
    'DELETE FROM lm_tutor_messages WHERE thread_id = $1 AND student_id = $2 AND tenant_id = $3',
    [threadId, actor.studentId, actor.tenantId],
  );
  const deleted = await pool.query(
    `DELETE FROM lm_tutor_threads
     WHERE thread_id = $1 AND student_id = $2 AND tenant_id = $3
     RETURNING thread_id`,
    [threadId, actor.studentId, actor.tenantId],
  );
  if (deleted.rows.length === 0) throw new EducationAccessError('Tutoring thread not found.', 404);
  return { success: true, deleted: true, threadId };
}

/** Load bounded prior conversation context when continuing an existing thread. */
export async function loadPriorThreadContext(
  pool: any,
  actor: AuthedStudent,
  threadId?: string,
  classId?: string,
): Promise<{ resolvedThreadId: string | null; contextBlock: string; nextIndex: number }> {
  if (!threadId) return { resolvedThreadId: null, contextBlock: '', nextIndex: 0 };
  if (!UUID_PATTERN.test(threadId)) throw new EducationAccessError('threadId must be a UUID.', 400);
  const head = await pool.query(
    `SELECT thread_id, class_id FROM lm_tutor_threads
     WHERE thread_id = $1 AND student_id = $2 AND tenant_id = $3`,
    [threadId, actor.studentId, actor.tenantId],
  );
  if (head.rows.length === 0) throw new EducationAccessError('Tutoring thread not found.', 404);
  const savedClass = head.rows[0].class_id ? String(head.rows[0].class_id) : undefined;
  if (savedClass && classId && savedClass !== classId) {
    throw new EducationAccessError('Thread belongs to a different class.', 400);
  }
  if (savedClass) await assertClassAccess(pool, actor, savedClass);
  const turns = await pool.query(
    `SELECT turn_index, role, content
     FROM lm_tutor_messages
     WHERE thread_id = $1 AND student_id = $2 AND tenant_id = $3
     ORDER BY turn_index ASC`,
    [threadId, actor.studentId, actor.tenantId],
  );
  const count = turns.rows.length;
  const recent = turns.rows.slice(-6).map((r: any) =>
    `${r.role === 'assistant' ? 'Tutor' : 'Student'}: ${String(r.content || '').slice(0, 600)}`,
  );
  const contextBlock = recent.length > 0
    ? `\nEARLIER IN THIS TUTORING THREAD:\n${wrapUntrustedPromptContent('little-monsters-prior-tutor-turns', recent.join('\n'), 2_400)}\n`
    : '';
  return { resolvedThreadId: threadId, contextBlock, nextIndex: count };
}

/** Persist the student question and tutor response inside a new or existing thread. */
export async function recordTutorTurn(
  pool: any,
  actor: AuthedStudent,
  params: {
    threadId: string | null;
    nextIndex: number;
    classId?: string;
    question: string;
    response: string;
    sources: Array<{ n: number; text: string }>;
  },
): Promise<string> {
  const activeThreadId = params.threadId || randomUUID();
  if (!params.threadId) {
    await pool.query(
      `INSERT INTO lm_tutor_threads
         (thread_id, student_id, tenant_id, class_id, title, first_question)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        activeThreadId,
        actor.studentId,
        actor.tenantId,
        params.classId || null,
        clipTitle(params.question),
        params.question.slice(0, 1000),
      ],
    );
  } else {
    await pool.query(
      `UPDATE lm_tutor_threads SET updated_at = NOW()
       WHERE thread_id = $1 AND student_id = $2 AND tenant_id = $3`,
      [activeThreadId, actor.studentId, actor.tenantId],
    );
  }
  await pool.query(
    `INSERT INTO lm_tutor_messages
       (message_id, thread_id, student_id, tenant_id, turn_index, role, content, sources)
     VALUES ($1, $2, $3, $4, $5, 'user', $6, '[]'::jsonb)`,
    [randomUUID(), activeThreadId, actor.studentId, actor.tenantId, params.nextIndex, params.question],
  );
  await pool.query(
    `INSERT INTO lm_tutor_messages
       (message_id, thread_id, student_id, tenant_id, turn_index, role, content, sources)
     VALUES ($1, $2, $3, $4, $5, 'assistant', $6, $7::jsonb)`,
    [
      randomUUID(),
      activeThreadId,
      actor.studentId,
      actor.tenantId,
      params.nextIndex + 1,
      params.response,
      JSON.stringify(params.sources || []),
    ],
  );
  return activeThreadId;
}
