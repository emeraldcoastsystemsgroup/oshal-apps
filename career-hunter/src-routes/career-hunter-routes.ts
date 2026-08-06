/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Added caller-scoped board, approvals, settings, and engine routes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Named the Express 5 board wildcard to keep package mounting valid.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Added the phone-first Career Hunter surface.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Added the path-shaped generated-resume alias after static resume routes.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Moved long engine runs off the controller event loop and bounded concurrency.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Shared scoring admission with the scheduled title pass.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Added administrator-triggered shared refresh controls.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | Excluded dismissed roles from the default native board feed.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | Resolved the engine CLI from the installed package before the legacy path.
 * 10 | maintainer@emeraldcoastsystemsgroup.com   | Made automated application drafts an explicit per-user opt-in.
 * 11 | maintainer@emeraldcoastsystemsgroup.com   | Brokered caller credentials through the bounded asynchronous engine runner.
 * 12 | maintainer@emeraldcoastsystemsgroup.com   | Moved caller identity and store primitives into a cycle-free dependency leaf.
 * 13 | maintainer@emeraldcoastsystemsgroup.com   | Decomposed the composition root into bounded route-family modules while preserving its public exports.
 * 14 | maintainer@emeraldcoastsystemsgroup.com   | Registered caller-scoped offline application autofill bookmarklet generation.
 */

/**
 * Career Hunter route composition root.
 *
 * The mounted router stays deliberately small: each route family owns its handlers and data
 * dependencies, while this module preserves the historical helper exports consumed by package
 * integrations and tests.
 * @module career-hunter-routes
 */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import {
  registerCareerApplicationMutationRoutes,
  registerCareerApplicationReadRoutes,
} from './career-application-routes';
import { registerCareerArtifacts } from './career-artifacts';
import { registerCareerAutofillRoutes } from './career-autofill-routes';
import { registerCareerAutomationRoutes } from './career-automation';
import { registerCareerBoardRoutes, registerCareerResumeAlias } from './career-board-routes';
import { registerCareerCompanyRoutes } from './career-company-routes';
import { registerCareerDigestRoutes } from './career-digest';
import { registerCareerJobGuide } from './career-job-guide';
import { registerCareerOnboardingRoutes } from './career-onboarding-routes';
import { registerCareerProfileStudio } from './career-profile-studio-routes';
import { registerCareerRecruiterRoutes } from './career-recruiter-routes';
import { registerCareerResumeStudio } from './career-resume-studio-routes';
import { registerCareerResumeUpload } from './career-resume-upload';
import { registerCareerRunRoutes, startCareerCron } from './career-run-routes';
import { registerCareerSettingsRoutes } from './career-settings-routes';
import { registerCareerStrengthenRoutes } from './career-strengthen-routes';
import {
  registerCareerClassicBoardRoutes,
  registerCareerSurfaceRoutes,
} from './career-surface-routes';
import { registerCareerTitleScoreRoutes } from './career-title-score';
import { resolveEngineCli as resolveRunnerEngineCli } from './career-engine-runner';

export { enqueueForUser } from './career-application-routes';
export { buildJobFilters } from './career-board-feed';
export { isCareerAdmin } from './career-company-routes';
export { callerSub, listStoreUsers, openUserDb, userPaths } from './career-user-store';

/**
 * @description Resolves the installed Career Hunter engine entrypoint through the shared runner.
 * @returns Absolute engine CLI path, honoring the explicit override and legacy fallback order.
 */
export function resolveEngineCli(): string {
  return resolveRunnerEngineCli();
}

function registerExistingFeatureRoutes(router: Router, ctx: AppContext): void {
  registerCareerResumeStudio(router, ctx);
  registerCareerResumeUpload(router, ctx);
  registerCareerProfileStudio(router, ctx);
  registerCareerDigestRoutes(router, ctx);
  registerCareerAutomationRoutes(router, ctx);
  registerCareerArtifacts(router, ctx);
  registerCareerAutofillRoutes(router);
  registerCareerJobGuide(router, ctx);
  registerCareerTitleScoreRoutes(router, ctx);
}

function registerExtractedRouteFamilies(router: Router, ctx: AppContext): void {
  registerCareerClassicBoardRoutes(router, ctx);
  registerCareerCompanyRoutes(router, ctx);
  registerCareerApplicationReadRoutes(router, ctx);
  registerCareerBoardRoutes(router, ctx);
  registerCareerRecruiterRoutes(router);
  registerCareerStrengthenRoutes(router, ctx);
  registerCareerApplicationMutationRoutes(router, ctx);
  registerCareerSettingsRoutes(router, ctx);
  registerCareerRunRoutes(router, ctx);
  registerCareerOnboardingRoutes(router);
}

/**
 * @description Composes all authenticated Career Hunter route families in precedence-safe order.
 * @param ctx - Kernel application context shared by package route registrars.
 * @returns The complete Career Hunter Express router.
 */
export function createCareerHunterRoutes(ctx: AppContext): Router {
  const router = Router();
  startCareerCron(ctx);
  registerCareerSurfaceRoutes(router);
  registerExistingFeatureRoutes(router, ctx);
  registerExtractedRouteFamilies(router, ctx);
  registerCareerResumeAlias(router);
  return router;
}
