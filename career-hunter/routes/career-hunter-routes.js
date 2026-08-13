"use strict";
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
 * 15 | maintainer@emeraldcoastsystemsgroup.com   | Registered the corpus-only browse feed used before a resume is indexed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.userPaths = exports.openUserDb = exports.listStoreUsers = exports.callerSub = exports.isCareerAdmin = exports.buildJobFilters = exports.enqueueForUser = void 0;
exports.resolveEngineCli = resolveEngineCli;
exports.createCareerHunterRoutes = createCareerHunterRoutes;
/**
 * Career Hunter route composition root.
 *
 * The mounted router stays deliberately small: each route family owns its handlers and data
 * dependencies, while this module preserves the historical helper exports consumed by package
 * integrations and tests.
 * @module career-hunter-routes
 */
const express_1 = require("express");
const career_application_routes_1 = require("./career-application-routes");
const career_artifacts_1 = require("./career-artifacts");
const career_autofill_routes_1 = require("./career-autofill-routes");
const career_automation_1 = require("./career-automation");
const career_board_routes_1 = require("./career-board-routes");
const career_browse_routes_1 = require("./career-browse-routes");
const career_company_routes_1 = require("./career-company-routes");
const career_digest_1 = require("./career-digest");
const career_job_guide_1 = require("./career-job-guide");
const career_onboarding_routes_1 = require("./career-onboarding-routes");
const career_profile_studio_routes_1 = require("./career-profile-studio-routes");
const career_recruiter_routes_1 = require("./career-recruiter-routes");
const career_resume_studio_routes_1 = require("./career-resume-studio-routes");
const career_resume_upload_1 = require("./career-resume-upload");
const career_run_routes_1 = require("./career-run-routes");
const career_settings_routes_1 = require("./career-settings-routes");
const career_strengthen_routes_1 = require("./career-strengthen-routes");
const career_surface_routes_1 = require("./career-surface-routes");
const career_title_score_1 = require("./career-title-score");
const career_engine_runner_1 = require("./career-engine-runner");
var career_application_routes_2 = require("./career-application-routes");
Object.defineProperty(exports, "enqueueForUser", { enumerable: true, get: function () { return career_application_routes_2.enqueueForUser; } });
var career_board_feed_1 = require("./career-board-feed");
Object.defineProperty(exports, "buildJobFilters", { enumerable: true, get: function () { return career_board_feed_1.buildJobFilters; } });
var career_company_routes_2 = require("./career-company-routes");
Object.defineProperty(exports, "isCareerAdmin", { enumerable: true, get: function () { return career_company_routes_2.isCareerAdmin; } });
var career_user_store_1 = require("./career-user-store");
Object.defineProperty(exports, "callerSub", { enumerable: true, get: function () { return career_user_store_1.callerSub; } });
Object.defineProperty(exports, "listStoreUsers", { enumerable: true, get: function () { return career_user_store_1.listStoreUsers; } });
Object.defineProperty(exports, "openUserDb", { enumerable: true, get: function () { return career_user_store_1.openUserDb; } });
Object.defineProperty(exports, "userPaths", { enumerable: true, get: function () { return career_user_store_1.userPaths; } });
/**
 * @description Resolves the installed Career Hunter engine entrypoint through the shared runner.
 * @returns Absolute engine CLI path, honoring the explicit override and legacy fallback order.
 */
function resolveEngineCli() {
    return (0, career_engine_runner_1.resolveEngineCli)();
}
function registerExistingFeatureRoutes(router, ctx) {
    (0, career_resume_studio_routes_1.registerCareerResumeStudio)(router, ctx);
    (0, career_resume_upload_1.registerCareerResumeUpload)(router, ctx);
    (0, career_profile_studio_routes_1.registerCareerProfileStudio)(router, ctx);
    (0, career_digest_1.registerCareerDigestRoutes)(router, ctx);
    (0, career_automation_1.registerCareerAutomationRoutes)(router, ctx);
    (0, career_artifacts_1.registerCareerArtifacts)(router, ctx);
    (0, career_autofill_routes_1.registerCareerAutofillRoutes)(router);
    (0, career_job_guide_1.registerCareerJobGuide)(router, ctx);
    (0, career_title_score_1.registerCareerTitleScoreRoutes)(router, ctx);
}
function registerExtractedRouteFamilies(router, ctx) {
    (0, career_surface_routes_1.registerCareerClassicBoardRoutes)(router, ctx);
    (0, career_company_routes_1.registerCareerCompanyRoutes)(router, ctx);
    (0, career_application_routes_1.registerCareerApplicationReadRoutes)(router, ctx);
    (0, career_board_routes_1.registerCareerBoardRoutes)(router, ctx);
    (0, career_browse_routes_1.registerCareerBrowseRoutes)(router);
    (0, career_recruiter_routes_1.registerCareerRecruiterRoutes)(router);
    (0, career_strengthen_routes_1.registerCareerStrengthenRoutes)(router, ctx);
    (0, career_application_routes_1.registerCareerApplicationMutationRoutes)(router, ctx);
    (0, career_settings_routes_1.registerCareerSettingsRoutes)(router, ctx);
    (0, career_run_routes_1.registerCareerRunRoutes)(router, ctx);
    (0, career_onboarding_routes_1.registerCareerOnboardingRoutes)(router);
}
/**
 * @description Composes all authenticated Career Hunter route families in precedence-safe order.
 * @param ctx - Kernel application context shared by package route registrars.
 * @returns The complete Career Hunter Express router.
 */
function createCareerHunterRoutes(ctx) {
    const router = (0, express_1.Router)();
    (0, career_run_routes_1.startCareerCron)(ctx);
    (0, career_surface_routes_1.registerCareerSurfaceRoutes)(router);
    registerExistingFeatureRoutes(router, ctx);
    registerExtractedRouteFamilies(router, ctx);
    (0, career_board_routes_1.registerCareerResumeAlias)(router);
    return router;
}
//# sourceMappingURL=career-hunter-routes.js.map