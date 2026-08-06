"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationLectureRoutes = createEducationLectureRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_lecture_upload_routes_1 = require("./education-lecture-upload-routes");
const education_lecture_transcript_routes_1 = require("./education-lecture-transcript-routes");
const education_lecture_read_routes_1 = require("./education-lecture-read-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'education-lecture-routes' });
/**
 * @description Compose every lecture endpoint behind the parent education
 * router's authentication middleware while keeping each lifecycle slice small.
 * @param ctx - shared application context
 * @returns router with upload, processing, listing, playback, and export routes
 */
function createEducationLectureRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.use((0, education_lecture_upload_routes_1.createEducationLectureUploadRoutes)(ctx));
    router.use((0, education_lecture_transcript_routes_1.createEducationLectureTranscriptRoutes)(ctx));
    router.use((0, education_lecture_read_routes_1.createEducationLectureReadRoutes)(ctx));
    logger.info('Education lecture routes registered');
    return router;
}
//# sourceMappingURL=education-lecture-routes.js.map