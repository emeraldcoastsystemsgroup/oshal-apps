/**
 * Education Study Flashcard Routes — Little Monsters Platform API
 *
 * HTTP adapters for permission-bound flashcard CRUD. The store owns the final
 * SQL authorization so guessed identifiers never escape the caller's scope.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Add owner/class-scoped flashcard CRUD route adapters.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Include per-student study preferences when requested on GET /flashcards/sets/:setId/cards?includePrefs=1 (RP-LM-04).
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The preferences are optional on that read: when they cannot be read the cards still answer, with preferences null, and the failure is logged. An installation whose relationship policy was installed before 1.9.0 refuses every statement on lm_flashcard_study_prefs ("SQL table is outside installed relationship policy"); the whole request answered 500, so Study opened every set empty (Roger's phone, 2026-11-16). Guard: tests/lm-flashcard-study-opens.test.cjs.
 * ---------------------------------------------------------------------------
 *
 * @module education-study-flashcard-routes
 */

import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { assertClassAccess, resolveAuthedStudent, type AuthedStudent } from './education-access';
import { sendStudyError } from './education-study-errors';
import {
  addStudyCard,
  createStudySet,
  deleteStudyCard,
  deleteStudySet,
  getStudySetPreferences,
  listReadableCards,
  listReadableSets,
  updateStudyCard,
  type StudySetPreferences,
} from './education-study-store';

const logger = createChildLogger({ module: 'education-study-flashcard-routes' });

function fail(res: Response, error: unknown, operation: string): void {
  if (sendStudyError(res, error)) return;
  logger.error({ err: error, operation }, 'Study flashcard operation failed');
  res.status(500).json({ error: `Could not ${operation}` });
}

async function listSets(req: Request, res: Response, ctx: AppContext): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, ctx.pool);
    const classId = req.query.classId ? String(req.query.classId) : undefined;
    if (classId) await assertClassAccess(ctx.pool, actor, classId);
    const sets = await listReadableSets(ctx.pool, actor, classId);
    res.json({ sets });
  } catch (error) {
    fail(res, error, 'load flashcard sets');
  }
}

/**
 * @description The learner's saved Shuffle and Term/Definition choice for a set the cards read already admitted, or
 * null when it cannot be read. The choice is optional (the study page keeps it on the device too), so it never takes
 * the cards down with it: an installation whose relationship policy predates lm_flashcard_study_prefs refuses every
 * statement on that table.
 * @param ctx - Application context holding the request's pool.
 * @param actor - The signed-in learner.
 * @param setId - The set whose cards were just read.
 * @returns The saved choice, or null when it is unavailable.
 */
async function readPreferences(ctx: AppContext, actor: AuthedStudent, setId: unknown): Promise<StudySetPreferences | null> {
  try {
    return await getStudySetPreferences(ctx.pool, actor, setId);
  } catch (error) {
    logger.error({ err: error, operation: 'read the study preferences' }, 'Study preferences unavailable; the cards answer without them');
    return null;
  }
}

async function listCards(req: Request, res: Response, ctx: AppContext): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, ctx.pool);
    const cards = await listReadableCards(ctx.pool, actor, req.params.setId);
    if (req.query.includePrefs === '1') {
      res.json({ cards, preferences: await readPreferences(ctx, actor, req.params.setId) });
      return;
    }
    res.json({ cards });
  } catch (error) {
    fail(res, error, 'load the cards');
  }
}

async function editCard(req: Request, res: Response, ctx: AppContext): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, ctx.pool);
    await updateStudyCard(ctx.pool, actor, req.params.cardId, req.body?.front, req.body?.back);
    res.json({ ok: true });
  } catch (error) {
    fail(res, error, 'edit the card');
  }
}

async function removeCard(req: Request, res: Response, ctx: AppContext): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, ctx.pool);
    await deleteStudyCard(ctx.pool, actor, req.params.cardId);
    res.json({ ok: true });
  } catch (error) {
    fail(res, error, 'delete the card');
  }
}

async function addCard(req: Request, res: Response, ctx: AppContext): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, ctx.pool);
    const cardId = await addStudyCard(ctx.pool, actor, req.params.setId, req.body || {});
    res.status(201).json({ ok: true, cardId });
  } catch (error) {
    fail(res, error, 'add the card');
  }
}

async function removeSet(req: Request, res: Response, ctx: AppContext): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, ctx.pool);
    await deleteStudySet(ctx.pool, actor, req.params.setId);
    res.json({ ok: true });
  } catch (error) {
    fail(res, error, 'delete the set');
  }
}

async function createSet(req: Request, res: Response, ctx: AppContext): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, ctx.pool);
    const created = await createStudySet(ctx.pool, actor, {
      classId: req.body?.classId,
      title: req.body?.title,
      topic: req.body?.topic,
      sourceType: req.body?.sourceType,
      sourceReference: req.body?.sourceReference,
      cards: req.body?.cards,
    });
    logger.info(created, 'Flashcard set created');
    res.status(201).json(created);
  } catch (error) {
    fail(res, error, 'create the flashcard set');
  }
}

/** Register flashcard set/card CRUD endpoints. */
export function createEducationStudyFlashcardRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get('/flashcards/sets', (req, res) => listSets(req, res, ctx));
  router.get('/flashcards/sets/:setId/cards', (req, res) => listCards(req, res, ctx));
  router.patch('/flashcards/cards/:cardId', (req, res) => editCard(req, res, ctx));
  router.delete('/flashcards/cards/:cardId', (req, res) => removeCard(req, res, ctx));
  router.post('/flashcards/sets/:setId/cards', (req, res) => addCard(req, res, ctx));
  router.delete('/flashcards/sets/:setId', (req, res) => removeSet(req, res, ctx));
  router.post('/flashcards/sets', (req, res) => createSet(req, res, ctx));
  return router;
}
