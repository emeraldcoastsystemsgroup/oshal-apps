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
 * ---------------------------------------------------------------------------
 *
 * @module education-study-flashcard-routes
 */

import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { assertClassAccess, resolveAuthedStudent } from './education-access';
import { sendStudyError } from './education-study-errors';
import {
  addStudyCard,
  createStudySet,
  deleteStudyCard,
  deleteStudySet,
  listReadableCards,
  listReadableSets,
  updateStudyCard,
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

async function listCards(req: Request, res: Response, ctx: AppContext): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, ctx.pool);
    const cards = await listReadableCards(ctx.pool, actor, req.params.setId);
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
