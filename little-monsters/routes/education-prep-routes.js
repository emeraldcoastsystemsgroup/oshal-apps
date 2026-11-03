"use strict";
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
exports.createEducationPrepRoutes = createEducationPrepRoutes;
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Authenticated SAT/ACT curriculum, practice, progress and lesson endpoints.
 */
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const education_study_errors_1 = require("./education-study-errors");
const education_prep_model_1 = require("./education-prep-model");
const education_prep_progress_1 = require("./education-prep-progress");
const store = __importStar(require("./education-prep-store"));
const training = __importStar(require("./education-prep-training"));
const logger = (0, logger_1.createChildLogger)({ module: 'education-prep' });
function createEducationPrepRoutes(ctx) {
    const router = (0, express_1.Router)();
    function endpoint(method, path, action) {
        router[method](path, async (req, res) => {
            res.set('Cache-Control', 'no-store');
            try {
                const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool, { readOnly: true });
                res.json(await action(req, actor));
            }
            catch (error) {
                if (error instanceof education_prep_model_1.PrepError) {
                    res.status(error.status).json({ error: error.message });
                    return;
                }
                if ((0, education_study_errors_1.sendStudyError)(res, error))
                    return;
                logger.error({ err: error }, 'Study Lab request failed');
                res.status(500).json({ error: 'Study Lab could not save or load your work. Please retry.' });
            }
        });
    }
    endpoint('get', '/prep/catalog', async () => ({ version: education_prep_model_1.catalog.version, lessons: education_prep_model_1.catalog.lessons, formats: education_prep_model_1.FORMATS, research: education_prep_model_1.research, officialPractice: education_prep_model_1.officialPractice }));
    endpoint('get', '/prep/topics', async (req) => ({ topics: training.topics((0, education_prep_model_1.examOf)(req.query.exam || 'SAT'), typeof req.query.query === 'string' ? req.query.query : ''), studyUrl: '/api/education/test-prep' }));
    endpoint('get', '/prep/progress', async (req, actor) => {
        const exam = (0, education_prep_model_1.examOf)(req.query.exam || 'SAT');
        const [rows, profile, active, packs] = await Promise.all([store.history(ctx.pool, actor), store.readProfile(ctx.pool, actor), store.activeSessions(ctx.pool, actor), training.listTraining(ctx.pool, actor, exam)]);
        const { seen, ...progress } = (0, education_prep_progress_1.summarize)(rows, exam, Date.now(), req.query.science === 'true');
        const recent = progress.history.slice(0, 5), count = recent.reduce((n, r) => n + r.count, 0);
        const method = education_prep_model_1.research.strategies.find((s) => s.lessonId === progress.focus[0]?.id && s.sections[exam]);
        return { ...progress, profile, active: active.filter(s => s.exam === exam), training: packs,
            dashboard: { sessions: progress.history.length, activeMinutes: Math.round(progress.history.reduce((n, r) => n + r.activeSeconds, 0) / 60),
                recentAccuracy: count ? Math.round(recent.reduce((n, r) => n + r.correct, 0) / count * 100) : null,
                reviewedPacks: packs.filter(p => p.progress.completedAt).length },
            coach: { name: 'Test Prep Coach', message: !progress.history.length ? 'Start with the diagnostic. We will use your answers and pace to choose your next step.' :
                    progress.focus[0] ? `Focus on ${progress.focus[0].title.toLowerCase()}: ${progress.focus[0].reason}.` : 'Your sampled skills are ready for a mixed practice set.',
                topicId: method?.id || null, tip: method?.shortcut || null, caution: method?.caution || null },
            studyUrl: '/api/education/test-prep' };
    });
    endpoint('get', '/prep/answers', async (req, actor) => ({ answers: await store.answerHistory(ctx.pool, actor, (0, education_prep_model_1.examOf)(req.query.exam || 'SAT'), typeof req.query.skill === 'string' ? req.query.skill : undefined), window: 'Latest 200 graded answers for the selected exam and optional skill.' }));
    endpoint('post', '/prep/profile', async (req, actor) => ({ profile: await store.saveProfile(ctx.pool, actor, req.body || {}), studyUrl: '/api/education/test-prep' }));
    endpoint('post', '/prep/launch', async (req, actor) => {
        (0, education_prep_model_1.examOf)(req.body?.exam);
        const r = await store.startSession(ctx.pool, actor, req.body || {}, true);
        return { sessionId: r.session_id, exam: r.state.exam, mode: r.state.mode, status: r.state.status,
            questionCount: r.state.blocks.reduce((n, b) => n + b.questions.length, 0),
            practiceUrl: `/api/education/test-prep?session=${r.session_id}`, message: 'Saved and ready. The clock starts when you press Begin practice.' };
    });
    endpoint('get', '/prep/training', async (req, actor) => ({ training: await training.listTraining(ctx.pool, actor, (0, education_prep_model_1.examOf)(req.query.exam || 'SAT')) }));
    endpoint('post', '/prep/training', async (req, actor) => {
        const user = req.oidc?.user, sub = user?.sub || user?.oid;
        if (!sub)
            throw new education_prep_model_1.PrepError('Not authenticated.', 401);
        return training.createTraining(ctx, actor, String(sub), req.body || {});
    });
    endpoint('get', '/prep/training/:trainingId', async (req, actor) => training.getTraining(ctx.pool, actor, String(req.params.trainingId)));
    endpoint('post', '/prep/training/:trainingId', async (req, actor) => training.updateTraining(ctx.pool, actor, String(req.params.trainingId), req.body || {}));
    endpoint('post', '/prep/sessions', async (req, actor) => {
        (0, education_prep_model_1.examOf)(req.body?.exam);
        const r = await store.startSession(ctx.pool, actor, req.body || {});
        return (0, education_prep_model_1.publicSession)(r.state, r.session_id, r.revision, Date.now());
    });
    endpoint('get', '/prep/sessions/:sessionId', async (req, actor) => {
        const r = await store.getSession(ctx.pool, actor, String(req.params.sessionId));
        return (0, education_prep_model_1.publicSession)(r.state, r.session_id, r.revision, Date.now());
    });
    endpoint('post', '/prep/sessions/:sessionId', async (req, actor) => {
        const r = await store.updateSession(ctx.pool, actor, String(req.params.sessionId), req.body || {});
        return (0, education_prep_model_1.publicSession)(r.state, r.session_id, r.revision, Date.now());
    });
    return router;
}
//# sourceMappingURL=education-prep-routes.js.map