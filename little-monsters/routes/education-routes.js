"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureEducationSchema = exports.levelFromXP = exports.XP_TABLE = void 0;
exports.serveFile = serveFile;
exports.createEducationRoutes = createEducationRoutes;
const path = __importStar(require("path"));
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_assignment_routes_1 = require("./education-assignment-routes");
const education_catalog_routes_1 = require("./education-catalog-routes");
const education_class_routes_1 = require("./education-class-routes");
const education_lecture_routes_1 = require("./education-lecture-routes");
const education_materials_routes_1 = require("./education-materials-routes");
const education_progress_routes_1 = require("./education-progress-routes");
const education_rewards_routes_1 = require("./education-rewards-routes");
const education_roster_routes_1 = require("./education-roster-routes");
const education_study_routes_1 = require("./education-study-routes");
const education_teacher_routes_1 = require("./education-teacher-routes");
const education_tutor_routes_1 = require("./education-tutor-routes");
const education_schema_1 = require("./education-schema");
const logger = (0, logger_1.createChildLogger)({ module: 'education-routes' });
/** Canonical XP award table and level calculator retained as public route exports. */
var education_progress_1 = require("./education-progress");
Object.defineProperty(exports, "XP_TABLE", { enumerable: true, get: function () { return education_progress_1.XP_TABLE; } });
Object.defineProperty(exports, "levelFromXP", { enumerable: true, get: function () { return education_progress_1.levelFromXP; } });
/** Schema readiness helper retained as a public route export. */
var education_schema_2 = require("./education-schema");
Object.defineProperty(exports, "ensureEducationSchema", { enumerable: true, get: function () { return education_schema_2.ensureEducationSchema; } });
/**
 * Package tools root captured during package load. The mounting context refreshes
 * it once at factory time so later package mounts cannot redirect these assets.
 */
let packageToolsRoot = process.env.OSHAL_APP_PACKAGE_DIR
    ? path.join(process.env.OSHAL_APP_PACKAGE_DIR, 'tools')
    : path.resolve(process.cwd(), 'any-bot/server/services/tools/education');
/** Serve a bundled education UI file and safely handle aborted responses. */
function serveFile(fileName) {
    return (_req, res) => {
        const filePath = path.resolve(packageToolsRoot, fileName);
        res.sendFile(filePath, (err) => {
            if (!err)
                return;
            if (res.headersSent || res.writableEnded) {
                logger.warn({ err, fileName }, `Aborted while serving ${fileName}`);
                return;
            }
            logger.error({ err, fileName }, `Failed to serve ${fileName}`);
            res.status(404).send(`Page not found: ${fileName}`);
        });
    };
}
function registerEducationUiRoutes(router) {
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
    router.use('/games', (0, express_1.static)(path.join(packageToolsRoot, 'games')));
}
function mountEducationFeatureRoutes(router, ctx) {
    router.use((0, education_class_routes_1.createEducationClassRoutes)(ctx));
    router.use((0, education_roster_routes_1.createEducationRosterRoutes)(ctx));
    router.use((0, education_materials_routes_1.createEducationMaterialsRoutes)(ctx));
    router.use((0, education_rewards_routes_1.createEducationRewardsRoutes)(ctx));
    router.use((0, education_lecture_routes_1.createEducationLectureRoutes)(ctx));
    router.use((0, education_tutor_routes_1.createEducationTutorRoutes)(ctx));
    router.use((0, education_study_routes_1.createEducationStudyRoutes)(ctx));
    router.use((0, education_teacher_routes_1.createEducationTeacherRoutes)(ctx));
    router.use((0, education_catalog_routes_1.createEducationCatalogRoutes)(ctx));
    router.use((0, education_assignment_routes_1.createEducationAssignmentRoutes)(ctx));
    router.use((0, education_progress_routes_1.createEducationProgressRoutes)(ctx));
}
/** Create and compose all Little Monsters education API and UI routes. */
function createEducationRoutes(ctx) {
    if (ctx.appPackageDir)
        packageToolsRoot = path.join(ctx.appPackageDir, 'tools');
    const router = (0, express_1.Router)();
    (0, education_schema_1.ensureEducationSchema)(ctx.pool).catch(err => {
        logger.error({ err }, 'Education schema bootstrap deferred; tables may not exist yet');
    });
    registerEducationUiRoutes(router);
    mountEducationFeatureRoutes(router, ctx);
    logger.info('Education routes registered (ribbon UIs owned by swarm-app manifest)');
    return router;
}
//# sourceMappingURL=education-routes.js.map