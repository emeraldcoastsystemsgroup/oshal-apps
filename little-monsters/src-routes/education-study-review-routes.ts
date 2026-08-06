/**
 * Education Study Review Routes — Little Monsters Platform API
 *
 * SM-2 progress always belongs to the authenticated caller and only references
 * a card that caller can currently read.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Add authenticated-self, permission-bound flashcard review recording.
 * ---------------------------------------------------------------------------
 *
 * @module education-study-review-routes
 */

import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { resolveAuthedStudent } from './education-access';
import { sendStudyError, StudyHttpError } from './education-study-errors';
import { recordStudyReview } from './education-study-store';

const logger = createChildLogger({ module: 'education-study-review-routes' });

async function reviewCard(req: Request, res: Response, ctx: AppContext): Promise<void> {
  try {
    const actor = await resolveAuthedStudent(req, ctx.pool);
    if (!req.body?.cardId || req.body?.score === undefined) {
      throw new StudyHttpError('cardId and score (0-2) are required', 400);
    }
    const review = await recordStudyReview(
      ctx.pool,
      actor,
      req.body.cardId,
      req.body.score,
    );
    res.json({ success: true, ...review });
  } catch (error) {
    if (sendStudyError(res, error)) return;
    logger.error({ err: error }, 'Failed to record flashcard review');
    res.status(500).json({ error: 'Could not record the review' });
  }
}

/** Register authenticated flashcard review recording. */
export function createEducationStudyReviewRoutes(ctx: AppContext): Router {
  const router = Router();
  router.post('/flashcards/review', (req, res) => reviewCard(req, res, ctx));
  return router;
}
