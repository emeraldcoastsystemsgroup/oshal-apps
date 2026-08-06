"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationStudyReviewRoutes = createEducationStudyReviewRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const education_study_errors_1 = require("./education-study-errors");
const education_study_store_1 = require("./education-study-store");
const logger = (0, logger_1.createChildLogger)({ module: 'education-study-review-routes' });
async function reviewCard(req, res, ctx) {
    try {
        const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        if (!req.body?.cardId || req.body?.score === undefined) {
            throw new education_study_errors_1.StudyHttpError('cardId and score (0-2) are required', 400);
        }
        const review = await (0, education_study_store_1.recordStudyReview)(ctx.pool, actor, req.body.cardId, req.body.score);
        res.json({ success: true, ...review });
    }
    catch (error) {
        if ((0, education_study_errors_1.sendStudyError)(res, error))
            return;
        logger.error({ err: error }, 'Failed to record flashcard review');
        res.status(500).json({ error: 'Could not record the review' });
    }
}
/** Register authenticated flashcard review recording. */
function createEducationStudyReviewRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.post('/flashcards/review', (req, res) => reviewCard(req, res, ctx));
    return router;
}
//# sourceMappingURL=education-study-review-routes.js.map