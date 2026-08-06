/**
 * Education Routes - Little Monsters Platform API
 *
 * Composes focused education route modules and serves bundled application UI.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | roger.murphy@emeraldcoastsystemsgroup.com   | Initial creation - education routes
 * 2   | roger.murphy@agenticfederal.us              | Tutor-chat RAG grounding for class textbook and lecture collections
 * 3   | roger.murphy@emeraldcoastsystemsgroup.com   | Replaced stubs with real implementations
 * 4   | roger.murphy@agenticfederal.us              | Manifest owns static and dynamic class icons
 * 5   | roger.murphy@agenticfederal.us              | Tutor chat uses AnthropicProvider SDK
 * 6   | roger.murphy@agenticfederal.us              | Lecture processing transcribes before ticket dispatch
 * 7   | roger.murphy@agenticfederal.us              | Tutor chat supports claude-code OAuth with API-key fallback
 * 8   | roger.murphy@agenticfederal.us              | Lecture processing creates persisted presentation slides
 * 9   | roger.murphy@agenticfederal.us              | Lecture audio persistence and recent replay route
 * 10  | roger.murphy@agenticfederal.us              | Extracted lecture and study route modules
 * 11  | roger.murphy@agenticfederal.us              | Added archived classes, owner delete, and class sharing
 * 12  | roger.murphy@agenticfederal.us              | Added published class bank and role-based class creation
 * 13  | roger.murphy@agenticfederal.us              | Extracted enrolled-gated class materials routes
 * 14  | roger.murphy@emeraldcoastsystemsgroup.com   | Bound package asset paths to the mounting application context
 * 15  | maintainer@emeraldcoastsystemsgroup.com     | Closed tenant/authz gaps and decomposed class, roster, tutor, assignment, progress, dashboard, and schema boundaries
 * ---------------------------------------------------------------------------
 *
 * @module education-routes
 */

import * as path from 'path';
import {
  Router,
  static as expressStatic,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { createEducationAssignmentRoutes } from './education-assignment-routes';
import { createEducationCatalogRoutes } from './education-catalog-routes';
import { createEducationClassRoutes } from './education-class-routes';
import { createEducationLectureRoutes } from './education-lecture-routes';
import { createEducationMaterialsRoutes } from './education-materials-routes';
import { createEducationProgressRoutes } from './education-progress-routes';
import { createEducationRewardsRoutes } from './education-rewards-routes';
import { createEducationRosterRoutes } from './education-roster-routes';
import { createEducationStudyRoutes } from './education-study-routes';
import { createEducationTeacherRoutes } from './education-teacher-routes';
import { createEducationTutorRoutes } from './education-tutor-routes';
import { ensureEducationSchema } from './education-schema';

const logger = createChildLogger({ module: 'education-routes' });

/** Canonical XP award table and level calculator retained as public route exports. */
export { XP_TABLE, levelFromXP } from './education-progress';

/** Schema readiness helper retained as a public route export. */
export { ensureEducationSchema } from './education-schema';

/**
 * Package tools root captured during package load. The mounting context refreshes
 * it once at factory time so later package mounts cannot redirect these assets.
 */
let packageToolsRoot = process.env.OSHAL_APP_PACKAGE_DIR
  ? path.join(process.env.OSHAL_APP_PACKAGE_DIR, 'tools')
  : path.resolve(process.cwd(), 'any-bot/server/services/tools/education');

/** Serve a bundled education UI file and safely handle aborted responses. */
export function serveFile(fileName: string): RequestHandler {
  return (_req: Request, res: Response) => {
    const filePath = path.resolve(packageToolsRoot, fileName);
    res.sendFile(filePath, (err: Error | undefined) => {
      if (!err) return;
      if (res.headersSent || res.writableEnded) {
        logger.warn({ err, fileName }, `Aborted while serving ${fileName}`);
        return;
      }
      logger.error({ err, fileName }, `Failed to serve ${fileName}`);
      res.status(404).send(`Page not found: ${fileName}`);
    });
  };
}

function registerEducationUiRoutes(router: Router): void {
  router.get('/dashboard', serveFile('student-dashboard.html'));
  router.get('/my-day', serveFile('my-day.html'));
  router.get('/class', serveFile('class-view.html'));
  router.get('/recorder', serveFile('lecture-recorder.html'));
  router.get('/tutor', serveFile('tutor-chat.html'));
  router.get('/flashcards', serveFile('flashcard-study.html'));
  router.get('/flashcards-hub', serveFile('flashcard-hub.html'));
  router.get('/quiz', serveFile('quiz.html'));
  router.get('/teacher', serveFile('teacher-analytics.html'));
  router.get('/presentation', serveFile('presentation.html'));
  router.get('/mascot.js', serveFile('lm-mascot.js'));
  router.get('/lm-voice.js', serveFile('lm-voice.js'));
  router.get('/logo.png', serveFile('little-monsters-logo.png'));
  router.get('/logo-256.png', serveFile('lm-logo-256.png'));
  router.get('/logo-96.png', serveFile('lm-logo-96.png'));
  router.get('/mascot.png', serveFile('lm-mask.png'));
  router.get('/icons.png', serveFile('lm-icons.png'));
  router.get('/education.css', serveFile('education.css'));
  router.get('/arcade', serveFile('games-arcade.html'));
  router.get('/index.html', (_req, res) => res.redirect('/api/education/arcade'));
  router.get('/formula-lab', serveFile('formula-lab.html'));
  router.get('/stem-helpers', serveFile('stem-helpers.html'));
  router.get('/citations', serveFile('citations.html'));
  router.get('/files', serveFile('files.html'));
  router.get('/my-monsters', serveFile('my-monsters.html'));
  router.get('/flashcard-builder', serveFile('flashcard-builder.html'));
  router.get('/timelines', serveFile('timelines.html'));
  router.use('/games', expressStatic(path.join(packageToolsRoot, 'games')));
}

function mountEducationFeatureRoutes(router: Router, ctx: AppContext): void {
  router.use(createEducationClassRoutes(ctx));
  router.use(createEducationRosterRoutes(ctx));
  router.use(createEducationMaterialsRoutes(ctx));
  router.use(createEducationRewardsRoutes(ctx));
  router.use(createEducationLectureRoutes(ctx));
  router.use(createEducationTutorRoutes(ctx));
  router.use(createEducationStudyRoutes(ctx));
  router.use(createEducationTeacherRoutes(ctx));
  router.use(createEducationCatalogRoutes(ctx));
  router.use(createEducationAssignmentRoutes(ctx));
  router.use(createEducationProgressRoutes(ctx));
}

/** Create and compose all Little Monsters education API and UI routes. */
export function createEducationRoutes(ctx: AppContext): Router {
  if (ctx.appPackageDir) packageToolsRoot = path.join(ctx.appPackageDir, 'tools');
  const router = Router();
  ensureEducationSchema(ctx.pool).catch(err => {
    logger.error({ err }, 'Education schema bootstrap deferred; tables may not exist yet');
  });
  registerEducationUiRoutes(router);
  mountEducationFeatureRoutes(router, ctx);
  logger.info('Education routes registered (ribbon UIs owned by swarm-app manifest)');
  return router;
}
