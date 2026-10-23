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
 * 4   | maintainer@emeraldcoastsystemsgroup.com | Flashcard and quiz generation take an optional topic (up to 200 characters) that titles the set and focuses retrieval.
 * 5   | maintainer@emeraldcoastsystemsgroup.com | Flashcard generation admits the class's owner (a student's own private class, the class teacher) or a tenant admin through authorizeLectureClassWrite instead of assertTeacherOfClass, which refused every student; the route binding moves to study.generate, which students hold.
 * 6   | maintainer@emeraldcoastsystemsgroup.com | The generated set answers studyUrl and the quiz answers quizUrl (relative Little Monsters pages), so Jarvis passes on the exact link: given only a path template, it invented https://littlemonsters.app/... links.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Flashcards from a book chapter: materialId + chapter make the chapter's text (readBookChapter, the material read rule) the cards' source and title the set "<book>: Chapter N: <title>"; the book must belong to the class, and a missing chapter answers 404 with the chapters the book has.
 * ---------------------------------------------------------------------------
 *
 * @module education-study-generator-routes
 */

import { randomUUID } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { authorizeLectureClassWrite } from './education-lecture-security';
import {
  assertClassAccess,
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
import { readBookChapter } from './education-book-routes';

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

/** A chapter source the request names (materialId + chapter): read under the material rule, in this class. */
async function chapterSource(
  ctx: AppContext,
  actor: Parameters<typeof readBookChapter>[1],
  req: Request,
  classId: string,
): Promise<{ title: string; heading: string; source: string } | null> {
  const materialId = typeof req.body?.materialId === 'string' ? req.body.materialId.trim() : '';
  if (!materialId) return null;
  const chapter = await readBookChapter(ctx, actor, materialId, Number(req.body?.chapter));
  if (chapter.classId !== classId) throw new StudyHttpError('That book belongs to a different class', 400);
  if (!chapter.found) {
    const known = chapter.chapters.length ? `Its chapters: ${chapter.chapters.join('; ')}.` : 'Its text has no chapter headings.';
    throw new StudyHttpError(`Chapter ${chapter.number} was not found in ${chapter.title}. ${known}`, 404);
  }
  const heading = chapter.heading || `Chapter ${chapter.number}`;
  return { title: chapter.title, heading, source: `${chapter.title}, ${heading}\n\n${chapter.text}` };
}

async function generateFlashcards(req: Request, res: Response, ctx: AppContext): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, ctx.pool);
    const classId = requiredClassId(req);
    await authorizeLectureClassWrite(ctx.pool, actor, classId);
    const studyClass = await loadStudyClass(ctx.pool, actor, classId);
    const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim().slice(0, 200) : '';
    const book = await chapterSource(ctx, actor, req, classId);
    const cards = await generateStudyCards(
      ctx,
      callerSub(req),
      actor.studentId,
      studyClass,
      req.body?.count,
      topic || book?.heading || undefined,
      book?.source,
    );
    const created = await createStudySet(ctx.pool, actor, {
      classId,
      title: book ? `${book.title}: ${book.heading}`
        : topic ? `Topic: ${topic} (${studyClass.className})` : `Auto: ${studyClass.className} key concepts`,
      topic: topic || book?.heading || studyClass.subject,
      sourceType: 'textbook',
      sourceReference: book ? `${book.title}, ${book.heading}`
        : topic ? `auto-generated for topic: ${topic}` : 'auto-generated from class materials',
      cards,
    });
    logger.info({ classId, ...created }, 'Generated class flashcards from authorized materials');
    res.status(201).json({ ...created, grounded: true, cards,
      studyUrl: `/api/education/flashcards?setId=${encodeURIComponent(created.setId)}&classId=${encodeURIComponent(classId)}` });
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
    const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim().slice(0, 200) : '';
    const questions = await generateStudyQuiz(
      ctx,
      callerSub(req),
      actor.studentId,
      studyClass,
      req.body?.count,
      topic || undefined,
    );
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
      quizUrl: `/api/education/quiz?classId=${encodeURIComponent(classId)}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}`,
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
