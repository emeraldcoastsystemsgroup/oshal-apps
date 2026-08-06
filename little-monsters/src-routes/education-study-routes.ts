/**
 * Education Study Routes — Little Monsters Platform API
 *
 * Composes flashcard CRUD, grounded generation, and SM-2 review subrouters.
 * Authorization and persistence details remain in focused source modules so the
 * package route entrypoint stays auditable.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | roger.murphy@agenticfederal.us              | Extracted flashcard/quiz routes from education-routes.ts.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Split study routes and close class/private authorization boundaries.
 * ---------------------------------------------------------------------------
 *
 * @module education-study-routes
 */

import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createEducationStudyFlashcardRoutes } from './education-study-flashcard-routes';
import { createEducationStudyGeneratorRoutes } from './education-study-generator-routes';
import { createEducationStudyReviewRoutes } from './education-study-review-routes';

/** Create the study router mounted by the Little Monsters education surface. */
export function createEducationStudyRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(createEducationStudyFlashcardRoutes(ctx));
  router.use(createEducationStudyGeneratorRoutes(ctx));
  router.use(createEducationStudyReviewRoutes(ctx));
  return router;
}
