/**
 * Education Lecture Routes - Little Monsters Platform API
 *
 * Composes the lecture upload, browser-transcript, and read/export slices. The
 * security boundary shared by those slices centralizes read-only identity
 * resolution, class authorization, safe projections, and artifact containment.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@agenticfederal.us | Extracted lecture routes from education-routes.ts when it crossed the file cap.
 * 2 | roger.murphy@emeraldcoastsystemsgroup.com | Integrated on-demand and automatic PowerPoint lecture deliverables.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Split the legacy route file into cohesive authorization-first upload, transcript, read/export, and security modules.
 * -----------------------------------------------------------------------------
 *
 * @module education-lecture-routes
 */

import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { createEducationLectureUploadRoutes } from './education-lecture-upload-routes';
import { createEducationLectureTranscriptRoutes } from './education-lecture-transcript-routes';
import { createEducationLectureReadRoutes } from './education-lecture-read-routes';

const logger = createChildLogger({ module: 'education-lecture-routes' });

/**
 * @description Compose every lecture endpoint behind the parent education
 * router's authentication middleware while keeping each lifecycle slice small.
 * @param ctx - shared application context
 * @returns router with upload, processing, listing, playback, and export routes
 */
export function createEducationLectureRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(createEducationLectureUploadRoutes(ctx));
  router.use(createEducationLectureTranscriptRoutes(ctx));
  router.use(createEducationLectureReadRoutes(ctx));
  logger.info('Education lecture routes registered');
  return router;
}
