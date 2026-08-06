"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationStudyRoutes = createEducationStudyRoutes;
const express_1 = require("express");
const education_study_flashcard_routes_1 = require("./education-study-flashcard-routes");
const education_study_generator_routes_1 = require("./education-study-generator-routes");
const education_study_review_routes_1 = require("./education-study-review-routes");
/** Create the study router mounted by the Little Monsters education surface. */
function createEducationStudyRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.use((0, education_study_flashcard_routes_1.createEducationStudyFlashcardRoutes)(ctx));
    router.use((0, education_study_generator_routes_1.createEducationStudyGeneratorRoutes)(ctx));
    router.use((0, education_study_review_routes_1.createEducationStudyReviewRoutes)(ctx));
    return router;
}
//# sourceMappingURL=education-study-routes.js.map