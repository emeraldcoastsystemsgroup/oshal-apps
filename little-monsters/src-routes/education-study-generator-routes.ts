/**
 * Education Study Generator Routes — Little Monsters Platform API
 *
 * Authorization is deliberately completed before credential probing, RAG
 * retrieval, or model invocation. Generated quizzes remain ephemeral; generated
 * class flashcards are persisted only after a second teacher/admin check.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Gate class study generation before external work and shared writes.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Persist expiring quiz attempts and withhold server-side answer keys from clients.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Bind study-model execution to the authenticated caller and package-owned education bot.
 * ---------------------------------------------------------------------------
 *
 * @module education-study-generator-routes
 */

import { randomUUID } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import {
  assertClassAccess,
  assertTeacherOfClass,
  resolveAuthedStudent,
  type AuthedStudent,
} from './education-access';
import {
  sendStudyError,
  StudyHttpError,
  studyResourceNotFound,
} from './education-study-errors';
import {
  type GeneratedQuizQuestion,
  generateStudyCards,
  generateStudyQuiz,
  loadStudyClass,
} from './education-study-model';
import { createStudySet } from './education-study-store';

const logger = createChildLogger({ module: 'education-study-generator-routes' });

interface PublicQuizQuestion {
  question: string;
  options: string[];
  topic: string;
}

function requiredClassId(req: Request): string {
  const classId = String(req.body?.classId || '');
  if (!classId) throw new StudyHttpError('classId is required', 400);
  return classId;
}

function callerSub(req: Request): string {
  const user = (req as Request & { oidc?: { user?: { sub?: string; oid?: string } } }).oidc?.user;
  const sub = user?.sub || user?.oid;
  if (!sub) throw new StudyHttpError('Not authenticated', 401);
  return String(sub);
}

function fail(res: Response, error: unknown, operation: string): void {
  if (sendStudyError(res, error)) return;
  logger.error({ err: error, operation }, 'Study generation failed');
  res.status(500).json({ error: `${operation} failed` });
}

/** Keep grading data server-side while returning only question-taking fields. */
function publicQuizQuestions(questions: GeneratedQuizQuestion[]): PublicQuizQuestion[] {
  return questions.map(({ question, options, topic }) => ({ question, options, topic }));
}

/** Rebind class access in the attempt INSERT so authorization cannot go stale. */
async function persistQuizAttempt(
  ctx: AppContext,
  actor: AuthedStudent,
  classId: string,
  questions: GeneratedQuizQuestion[],
): Promise<string> {
  const attemptId = randomUUID();
  const result = await ctx.pool.query(
    `INSERT INTO lm_quiz_attempts
       (attempt_id, student_id, class_id, questions, expires_at)
     SELECT $1, $2, c.class_id, $3::jsonb, NOW() + INTERVAL '30 minutes'
       FROM lm_classes c
      WHERE c.class_id = $4 AND c.tenant_id = $5
        AND ($6::boolean OR ($7::boolean AND c.teacher_student_id = $2)
          OR EXISTS (SELECT 1 FROM lm_enrollments e
              WHERE e.student_id = $2 AND e.class_id = c.class_id))
     RETURNING attempt_id`,
    [attemptId, actor.studentId, JSON.stringify(questions), classId,
      actor.tenantId, actor.role === 'admin', actor.role === 'teacher'],
  );
  if (!result.rows[0]) throw studyResourceNotFound();
  return result.rows[0].attempt_id;
}

async function generateFlashcards(req: Request, res: Response, ctx: AppContext): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, ctx.pool);
    const classId = requiredClassId(req);
    await assertTeacherOfClass(ctx.pool, actor, classId);
    const studyClass = await loadStudyClass(ctx.pool, actor, classId);
    const cards = await generateStudyCards(ctx, callerSub(req), actor.studentId, studyClass, req.body?.count);
    const created = await createStudySet(ctx.pool, actor, {
      classId,
      title: `Auto: ${studyClass.className} key concepts`,
      topic: studyClass.subject,
      sourceType: 'textbook',
      sourceReference: 'auto-generated from class materials',
      cards,
    });
    logger.info({ classId, ...created }, 'Generated class flashcards from authorized materials');
    res.status(201).json({ ...created, grounded: true, cards });
  } catch (error) {
    fail(res, error, 'Flashcard generation');
  }
}

async function generateQuiz(req: Request, res: Response, ctx: AppContext): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, ctx.pool);
    const classId = requiredClassId(req);
    await assertClassAccess(ctx.pool, actor, classId);
    const studyClass = await loadStudyClass(ctx.pool, actor, classId);
    const questions = await generateStudyQuiz(ctx, callerSub(req), actor.studentId, studyClass, req.body?.count);
    const attemptId = await persistQuizAttempt(ctx, actor, classId, questions);
    const publicQuestions = publicQuizQuestions(questions);
    logger.info({ classId, attemptId, questionCount: questions.length }, 'Generated authorized class quiz attempt');
    res.json({
      attemptId,
      classId,
      className: studyClass.className,
      questionCount: questions.length,
      grounded: true,
      questions: publicQuestions,
    });
  } catch (error) {
    fail(res, error, 'Quiz generation');
  }
}

/** Register RAG-grounded flashcard and ephemeral quiz generation endpoints. */
export function createEducationStudyGeneratorRoutes(ctx: AppContext): Router {
  const router = Router();
  router.post('/flashcards/generate', (req, res) => generateFlashcards(req, res, ctx));
  router.post('/quiz/generate', (req, res) => generateQuiz(req, res, ctx));
  return router;
}
