"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.listTutorThreads = listTutorThreads;
exports.getTutorThread = getTutorThread;
exports.deleteTutorThread = deleteTutorThread;
exports.loadPriorThreadContext = loadPriorThreadContext;
exports.recordTutorTurn = recordTutorTurn;
const crypto_1 = require("crypto");
const prompt_containment_1 = require("@/features/swarm-orchestration/services/prompt-containment");
const education_access_1 = require("./education-access");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseSources(raw) {
    if (!raw)
        return [];
    const parsed = typeof raw === 'string' ? (() => {
        try {
            return JSON.parse(raw);
        }
        catch {
            return [];
        }
    })() : raw;
    return Array.isArray(parsed) ? parsed : [];
}
function clipTitle(question) {
    const clean = question.replace(/\s+/g, ' ').trim() || 'Homework question';
    return clean.length > 96 ? `${clean.slice(0, 93)}...` : clean;
}
async function assertTeacherThreadVisibility(pool, actor, targetStudentId, classId) {
    if (targetStudentId === actor.studentId)
        return;
    if (actor.role !== 'teacher' && actor.role !== 'admin') {
        throw new education_access_1.EducationAccessError('Students may view only their own tutoring threads.', 403);
    }
    const policy = await pool.query('SELECT tutor_history_teacher_visible FROM lm_tenants WHERE tenant_id = $1', [actor.tenantId]);
    const allowed = Boolean(policy.rows[0]?.tutor_history_teacher_visible);
    if (!allowed) {
        throw new education_access_1.EducationAccessError('School policy keeps student tutoring threads private to each learner.', 403);
    }
    if (!classId || !UUID_PATTERN.test(classId)) {
        throw new education_access_1.EducationAccessError('classId is required when viewing class tutoring threads.', 400);
    }
    const cls = await pool.query('SELECT teacher_student_id FROM lm_classes WHERE class_id = $1 AND tenant_id = $2', [classId, actor.tenantId]);
    if (cls.rows.length === 0)
        throw new education_access_1.EducationAccessError('Class not found.', 404);
    if (actor.role !== 'admin' && cls.rows[0].teacher_student_id !== actor.studentId) {
        throw new education_access_1.EducationAccessError('Teachers may view threads only for classes they teach.', 403);
    }
}
/** List tutoring threads newest-first for the caller (or policy-permitted class student). */
async function listTutorThreads(pool, actor, input) {
    const targetStudentId = input.studentId ? String(input.studentId).trim() : actor.studentId;
    if (!UUID_PATTERN.test(targetStudentId)) {
        throw new education_access_1.EducationAccessError('studentId must be a UUID.', 400);
    }
    await assertTeacherThreadVisibility(pool, actor, targetStudentId, input.classId);
    if (input.classId) {
        if (!UUID_PATTERN.test(input.classId)) {
            throw new education_access_1.EducationAccessError('classId must be a UUID.', 400);
        }
        const rows = await pool.query(`SELECT thread_id, class_id, title, first_question, created_at, updated_at
       FROM lm_tutor_threads
       WHERE student_id = $1 AND tenant_id = $2 AND class_id = $3
       ORDER BY updated_at DESC
       LIMIT 50`, [targetStudentId, actor.tenantId, input.classId]);
        return { success: true, threads: mapThreadRows(rows.rows) };
    }
    const rows = await pool.query(`SELECT thread_id, class_id, title, first_question, created_at, updated_at
     FROM lm_tutor_threads
     WHERE student_id = $1 AND tenant_id = $2
     ORDER BY updated_at DESC
     LIMIT 50`, [targetStudentId, actor.tenantId]);
    return { success: true, threads: mapThreadRows(rows.rows) };
}
function mapThreadRows(rows) {
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
async function getTutorThread(pool, actor, input) {
    const threadId = typeof input.threadId === 'string' ? input.threadId.trim() : '';
    if (!UUID_PATTERN.test(threadId))
        throw new education_access_1.EducationAccessError('threadId must be a UUID.', 400);
    const head = await pool.query(`SELECT thread_id, student_id, class_id, title, first_question, created_at, updated_at
     FROM lm_tutor_threads
     WHERE thread_id = $1 AND tenant_id = $2`, [threadId, actor.tenantId]);
    if (head.rows.length === 0)
        throw new education_access_1.EducationAccessError('Tutoring thread not found.', 404);
    const thread = head.rows[0];
    await assertTeacherThreadVisibility(pool, actor, String(thread.student_id), thread.class_id ? String(thread.class_id) : undefined);
    const msgs = await pool.query(`SELECT role, content, sources, created_at
     FROM lm_tutor_messages
     WHERE thread_id = $1 AND tenant_id = $2
     ORDER BY turn_index ASC`, [threadId, actor.tenantId]);
    return {
        success: true,
        thread: {
            threadId: thread.thread_id,
            classId: thread.class_id || null,
            title: thread.title,
            firstQuestion: thread.first_question,
            createdAt: thread.created_at,
            updatedAt: thread.updated_at,
            messages: msgs.rows.map((m) => ({
                role: m.role,
                content: m.content,
                sources: parseSources(m.sources),
                createdAt: m.created_at,
            })),
        },
    };
}
/** Delete one tutoring thread owned by the signed-in learner. */
async function deleteTutorThread(pool, actor, input) {
    const threadId = typeof input.threadId === 'string' ? input.threadId.trim() : '';
    if (!UUID_PATTERN.test(threadId))
        throw new education_access_1.EducationAccessError('threadId must be a UUID.', 400);
    await pool.query('DELETE FROM lm_tutor_messages WHERE thread_id = $1 AND student_id = $2 AND tenant_id = $3', [threadId, actor.studentId, actor.tenantId]);
    const deleted = await pool.query(`DELETE FROM lm_tutor_threads
     WHERE thread_id = $1 AND student_id = $2 AND tenant_id = $3
     RETURNING thread_id`, [threadId, actor.studentId, actor.tenantId]);
    if (deleted.rows.length === 0)
        throw new education_access_1.EducationAccessError('Tutoring thread not found.', 404);
    return { success: true, deleted: true, threadId };
}
/** Load bounded prior conversation context when continuing an existing thread. */
async function loadPriorThreadContext(pool, actor, threadId, classId) {
    if (!threadId)
        return { resolvedThreadId: null, contextBlock: '', nextIndex: 0 };
    if (!UUID_PATTERN.test(threadId))
        throw new education_access_1.EducationAccessError('threadId must be a UUID.', 400);
    const head = await pool.query(`SELECT thread_id, class_id FROM lm_tutor_threads
     WHERE thread_id = $1 AND student_id = $2 AND tenant_id = $3`, [threadId, actor.studentId, actor.tenantId]);
    if (head.rows.length === 0)
        throw new education_access_1.EducationAccessError('Tutoring thread not found.', 404);
    const savedClass = head.rows[0].class_id ? String(head.rows[0].class_id) : undefined;
    if (savedClass && classId && savedClass !== classId) {
        throw new education_access_1.EducationAccessError('Thread belongs to a different class.', 400);
    }
    if (savedClass)
        await (0, education_access_1.assertClassAccess)(pool, actor, savedClass);
    const turns = await pool.query(`SELECT turn_index, role, content
     FROM lm_tutor_messages
     WHERE thread_id = $1 AND student_id = $2 AND tenant_id = $3
     ORDER BY turn_index ASC`, [threadId, actor.studentId, actor.tenantId]);
    const count = turns.rows.length;
    const recent = turns.rows.slice(-6).map((r) => `${r.role === 'assistant' ? 'Tutor' : 'Student'}: ${String(r.content || '').slice(0, 600)}`);
    const contextBlock = recent.length > 0
        ? `\nEARLIER IN THIS TUTORING THREAD:\n${(0, prompt_containment_1.wrapUntrustedPromptContent)('little-monsters-prior-tutor-turns', recent.join('\n'), 2_400)}\n`
        : '';
    return { resolvedThreadId: threadId, contextBlock, nextIndex: count };
}
/** Persist the student question and tutor response inside a new or existing thread. */
async function recordTutorTurn(pool, actor, params) {
    const activeThreadId = params.threadId || (0, crypto_1.randomUUID)();
    if (!params.threadId) {
        await pool.query(`INSERT INTO lm_tutor_threads
         (thread_id, student_id, tenant_id, class_id, title, first_question)
       VALUES ($1, $2, $3, $4, $5, $6)`, [
            activeThreadId,
            actor.studentId,
            actor.tenantId,
            params.classId || null,
            clipTitle(params.question),
            params.question.slice(0, 1000),
        ]);
    }
    else {
        await pool.query(`UPDATE lm_tutor_threads SET updated_at = NOW()
       WHERE thread_id = $1 AND student_id = $2 AND tenant_id = $3`, [activeThreadId, actor.studentId, actor.tenantId]);
    }
    await pool.query(`INSERT INTO lm_tutor_messages
       (message_id, thread_id, student_id, tenant_id, turn_index, role, content, sources)
     VALUES ($1, $2, $3, $4, $5, 'user', $6, '[]'::jsonb)`, [(0, crypto_1.randomUUID)(), activeThreadId, actor.studentId, actor.tenantId, params.nextIndex, params.question]);
    await pool.query(`INSERT INTO lm_tutor_messages
       (message_id, thread_id, student_id, tenant_id, turn_index, role, content, sources)
     VALUES ($1, $2, $3, $4, $5, 'assistant', $6, $7::jsonb)`, [
        (0, crypto_1.randomUUID)(),
        activeThreadId,
        actor.studentId,
        actor.tenantId,
        params.nextIndex + 1,
        params.response,
        JSON.stringify(params.sources || []),
    ]);
    return activeThreadId;
}
//# sourceMappingURL=education-tutor-history.js.map