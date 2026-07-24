"use strict";
/**
 * Education Routes — Little Monsters Platform API
 *
 * Production routes for the Little Monsters education platform.
 * Handles lecture upload + ticket creation, tutor chat via LLM,
 * student/class CRUD, flashcard management, and UI page serving.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * DATE           | AUTHOR                    | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 2026-04-19     | roger.murphy@emeraldcoastsystemsgroup.com    | Initial creation — education routes
 * 2026-06-09 01:30:00 | roger.murphy@agenticfederal.us   | Tutor-chat now RAG-grounds answers in the class's own textbook/lecture collections (lm-class-{id}-{type}) with inline citations + returns grounded/sources — making the UI's "I'll use your textbook" promise real
 * 2026-04-19     | roger.murphy@emeraldcoastsystemsgroup.com    | Replace stubs with real implementations
 * 2026-04-21 19:50:00 | roger.murphy@agenticfederal.us   | Removed ribbon-UI drift: manifest now owns static + dynamic class icons
 * 2026-04-21 21:25:00 | roger.murphy@agenticfederal.us   | Tutor chat now uses AnthropicProvider SDK (ANTHROPIC_API_KEY) instead of claude CLI OAuth
 * 2026-04-22 15:00:00 | roger.murphy@agenticfederal.us   | /process-lecture now transcribes synchronously via the STT registry (Gemini) before dispatching the bot ticket — lecture-scribe gets the transcript in the ticket description and only does downstream analysis (notes/flashcards/assignments) rather than having to call OpenAI Whisper
 * 2026-04-25 00:35:00 | roger.murphy@agenticfederal.us   | Tutor chat: prefer claude-code OAuth (~/.claude/.credentials.json) via `claude` CLI subprocess; only fall back to ANTHROPIC_API_KEY when set. The sandbox does not carry an API key — OAuth file mounted from the host is the supported auth path.
 * 2026-06-12 18:05:00 | roger.murphy@agenticfederal.us   | Lecture → presentation: process-transcript now also generates a slide deck in the same LLM pass (persisted to slides_path, migration 024); new GET /lectures/:lectureId/slides + /presentation viewer page route
 * 2026-06-12 19:30:00 | roger.murphy@agenticfederal.us   | Recording durability: POST/GET /lectures/:lectureId/audio persist + replay the class recording (audio_path); GET /lectures/recent powers the dashboard replay strip (registered before /lectures/:lectureId so 'recent' isn't captured as an id)
 * 2026-06-12 19:45:00 | roger.murphy@agenticfederal.us   | Decomposed past the 1000-line cap: lecture routes -> education-lecture-routes.ts, flashcard/quiz routes -> education-study-routes.ts (moved verbatim, mounted as sub-routers in place)
 * 2026-06-13 09:30:00 | roger.murphy@agenticfederal.us   | Class management: GET /classes ?includeArchived for the archive toggle; owner-gated DELETE /classes/:id; share endpoints GET/POST/DELETE /classes/:id/students (enroll-by-email, provisions a placeholder student row on first share so progress attaches at first login)
 * 2026-06-13 14:10:00 | roger.murphy@agenticfederal.us   | Class bank: lm_classes.published column (migration 027) + role-based create (teachers publish to the school bank, students get a private class); mount createEducationCatalogRoutes for /catalog + self-enroll
 * 2026-06-13 16:00:00 | roger.murphy@agenticfederal.us   | Materials: extracted PDF-only owner upload to createEducationMaterialsRoutes (any filetype + mobile photo, enrolled-gated, list/view) which clears the 1000-line cap; added lm_materials table (migration 028) to schema bootstrap
 * 2026-07-12 19:40:00 | roger.murphy@emeraldcoastsystemsgroup.com | D10 fix: bundled-asset paths (serveFile, /games static) no longer read OSHAL_APP_PACKAGE_DIR inside request handlers — with 2+ packages mounted the env var points at whichever mounted LAST, serving cross-app assets. Now a module-level packageToolsRoot captured at load time and re-affirmed from ctx.appPackageDir at factory time (the mounter's per-package channel).
 * ---------------------------------------------------------------------------
 *
 * @module education-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.XP_TABLE = void 0;
exports.serveFile = serveFile;
exports.levelFromXP = levelFromXP;
exports.createEducationRoutes = createEducationRoutes;
exports.ensureEducationSchema = ensureEducationSchema;
const express_1 = require("express");
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const tool_routes_1 = require("@/app/routes/tool-routes");
const education_lecture_routes_1 = require("./education-lecture-routes");
const education_study_routes_1 = require("./education-study-routes");
const education_teacher_routes_1 = require("./education-teacher-routes");
const education_catalog_routes_1 = require("./education-catalog-routes");
const education_materials_routes_1 = require("./education-materials-routes");
const education_rewards_routes_1 = require("./education-rewards-routes");
const education_access_1 = require("./education-access");
/** Map an EducationAccessError to its HTTP status; returns true if it handled the error. */
function sendAccessError(res, err) {
    if (err instanceof education_access_1.EducationAccessError) {
        res.status(err.status).json({ error: err.message });
        return true;
    }
    return false;
}
const logger = (0, logger_1.createChildLogger)({ module: 'education-routes' });
/** Package tools root. Captured at LOAD time (the mounter guarantees OSHAL_APP_PACKAGE_DIR
 *  points at THIS package while it is being required; at REQUEST time it points at whichever
 *  package mounted LAST — the D10 hazard) and re-affirmed per-package from ctx.appPackageDir
 *  in createEducationRoutes, which is the sanctioned channel on frameworks that provide it. */
let packageToolsRoot = process.env.OSHAL_APP_PACKAGE_DIR
    ? require('path').join(process.env.OSHAL_APP_PACKAGE_DIR, 'tools')
    : require('path').resolve(process.cwd(), 'any-bot/server/services/tools/education');
/** Serve a static file from the education tools directory. Exported for regression
 *  testing of the aborted-request guard (see tests/unit/education-serve-file.spec.ts). */
function serveFile(fileName) {
    return (_req, res) => {
        const path = require('path');
        const filePath = path.resolve(packageToolsRoot, fileName);
        res.sendFile(filePath, (err) => {
            if (!err)
                return;
            // A client that aborts mid-send (ECONNABORTED) fires this callback AFTER the
            // response is already finished. Writing again throws ERR_HTTP_HEADERS_SENT,
            // which was uncaught and crashed the whole control plane. Only respond when
            // the response is still open.
            if (res.headersSent || res.writableEnded) {
                logger.warn({ err, fileName }, `Aborted while serving ${fileName}`);
                return;
            }
            logger.error({ err, fileName }, `Failed to serve ${fileName}`);
            res.status(404).send(`Page not found: ${fileName}`);
        });
    };
}
/** XP awards by event type. */
exports.XP_TABLE = {
    lecture_uploaded: 25,
    notes_reviewed: 10,
    flashcard_session: 50,
    quiz_completed: 30,
    quiz_high_score: 20,
    streak_bonus: 15,
    tutor_question: 5,
    study_session: 40,
    // Game arcade (ADR-075 §G): warm-up answered correctly before a game, and finishing a play session.
    game_warmup: 10,
    game_played: 15,
};
/** Calculate level from total XP (exponential curve: 100 * 1.5^(level-1)). Exported for tests. */
function levelFromXP(xp) {
    let level = 1;
    let threshold = 100;
    while (xp >= threshold) {
        xp -= threshold;
        level++;
        threshold = Math.floor(100 * Math.pow(1.5, level - 1));
    }
    return level;
}
/**
 * Create education routes. Requires AppContext for database, ticket service,
 * and LLM provider access.
 */
function createEducationRoutes(ctx) {
    // Per-package dir from the mounter (D10): capture once at factory time so bundled-asset
    // serving stays correct no matter which package mounts or reloads after us.
    if (ctx.appPackageDir) {
        packageToolsRoot = require('path').join(ctx.appPackageDir, 'tools');
    }
    const router = (0, express_1.Router)();
    const fs = require('fs');
    const path = require('path');
    // Ensure education schema exists on startup
    ensureEducationSchema(ctx.pool).catch(err => {
        logger.warn({ err }, 'Education schema bootstrap deferred — tables may not exist yet');
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // UI PAGES
    // ═══════════════════════════════════════════════════════════════════════════
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
    // Web-optimized brand art (small) for the cockpit header badge, mascot, and avatars.
    router.get('/logo-256.png', serveFile('lm-logo-256.png'));
    router.get('/logo-96.png', serveFile('lm-logo-96.png'));
    // Alternate monster character (pink) + the gamification icon sheet (badges/achievements).
    router.get('/mascot.png', serveFile('lm-mask.png'));
    router.get('/icons.png', serveFile('lm-icons.png'));
    router.get('/education.css', serveFile('education.css'));
    // ── Toolkit + games surfaces (ADR-075 §F/§G) ──
    router.get('/arcade', serveFile('games-arcade.html'));
    // The bundled games' built-in "back to hub" links resolve to /api/education/index.html
    // (from /api/education/games/<game>/index.html → ../../index.html). Send that to the arcade
    // instead of a "Cannot GET" 404.
    router.get('/index.html', (_req, res) => res.redirect('/api/education/arcade'));
    router.get('/formula-lab', serveFile('formula-lab.html'));
    router.get('/stem-helpers', serveFile('stem-helpers.html'));
    router.get('/citations', serveFile('citations.html'));
    router.get('/files', serveFile('files.html'));
    router.get('/my-monsters', serveFile('my-monsters.html'));
    router.get('/flashcard-builder', serveFile('flashcard-builder.html'));
    router.get('/timelines', serveFile('timelines.html'));
    // Static mount for the bundled study mini-games (each is a self-contained folder).
    router.use('/games', require('express').static(require('path').join(packageToolsRoot, 'games')));
    // ═══════════════════════════════════════════════════════════════════════════
    // CLASS MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════
    /** GET /api/education/class-tool-keys — the ADR-085 visibility contract: the exact
     *  ribbon toolNames THIS caller may see (lm-class-<id8> per accessible class). The
     *  framework's /api/tools/dynamic loopback-calls this with the caller's session and
     *  hides every lm-class-* icon not listed (fail-closed). Mirrors the manifest's
     *  toolNameTemplate (first 8 chars of class_id). */
    router.get('/class-tool-keys', async (req, res) => {
        try {
            const student = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const accessible = await (0, education_access_1.listAccessibleClassIds)(ctx.pool, student);
            res.json({ keys: accessible.map((id) => `lm-class-${String(id).slice(0, 8)}`) });
        }
        catch {
            res.json({ keys: [] }); // can't resolve a student → no class icons (fail closed)
        }
    });
    /** GET /api/education/classes — list the classes THIS student can access
     *  (enrolled-in, or taught for a teacher). Never lists other students' classes. */
    router.get('/classes', async (req, res) => {
        try {
            const student = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const accessible = await (0, education_access_1.listAccessibleClassIds)(ctx.pool, student);
            if (accessible.length === 0) {
                res.json({ classes: [] });
                return;
            }
            // Active-only by default; ?includeArchived=true also returns hidden classes
            // (their history is intact — archive is non-destructive).
            const includeArchived = String(req.query.includeArchived || '') === 'true';
            const statusClause = includeArchived ? `c.status IN ('active','archived')` : `c.status = 'active'`;
            const result = await ctx.pool.query(`SELECT c.*,
          (SELECT COUNT(*) FROM lm_enrollments e WHERE e.class_id = c.class_id) as student_count,
          (SELECT COUNT(*) FROM lm_lectures l WHERE l.class_id = c.class_id) as lecture_count,
          (SELECT COUNT(*) FROM lm_flashcard_sets fs WHERE fs.class_id = c.class_id) as flashcard_set_count
         FROM lm_classes c WHERE ${statusClause} AND c.class_id = ANY($1) ORDER BY c.status, c.name`, [accessible]);
            res.json({ classes: result.rows });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to list classes');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/education/classes/:classId/info — single class row by id */
    router.get('/classes/:classId/info', async (req, res) => {
        try {
            const classId = String(req.params.classId);
            const student = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertClassAccess)(ctx.pool, student, classId); // 403 unless enrolled/teacher
            const { rows } = await ctx.pool.query('SELECT * FROM lm_classes WHERE class_id = $1 LIMIT 1', [classId]);
            if (rows.length === 0) {
                res.status(404).json({ error: 'Class not found' });
                return;
            }
            res.json(rows[0]);
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to get class info');
            res.status(500).json({ error: err.message });
        }
    });
    /** DELETE /api/education/classes/:classId — PERMANENT hard-delete (cascade) of a
     *  class and all its history. Owner-only. Prefer PATCH {status:'archived'} to hide
     *  a class while keeping its lectures/flashcards/progress. */
    router.delete('/classes/:classId', async (req, res) => {
        try {
            const classId = String(req.params.classId);
            const deleter = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertTeacherOfClass)(ctx.pool, deleter, classId); // 403 unless owner/admin
            // Cascade delete — order matters for FK constraints
            await ctx.pool.query('DELETE FROM lm_flashcards WHERE set_id IN (SELECT set_id FROM lm_flashcard_sets WHERE class_id = $1)', [classId]);
            await ctx.pool.query('DELETE FROM lm_flashcard_sets WHERE class_id = $1', [classId]);
            await ctx.pool.query('DELETE FROM lm_assignments WHERE class_id = $1', [classId]);
            await ctx.pool.query('DELETE FROM lm_enrollments WHERE class_id = $1', [classId]);
            const { rowCount } = await ctx.pool.query('DELETE FROM lm_classes WHERE class_id = $1', [classId]);
            if (rowCount === 0) {
                res.status(404).json({ error: 'Class not found' });
                return;
            }
            // Remove the ribbon icon immediately so operators see the change
            (0, tool_routes_1.deregisterDynamicToolUI)(`lm-class-${classId.substring(0, 8)}`);
            logger.info({ classId }, 'Class deleted + ribbon icon deregistered');
            res.json({ success: true, classId });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err, classId: req.params.classId }, 'Failed to delete class');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/education/classes/:classId/students — roster (owner-only). */
    router.get('/classes/:classId/students', async (req, res) => {
        try {
            const classId = String(req.params.classId);
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertTeacherOfClass)(ctx.pool, me, classId);
            const r = await ctx.pool.query(`SELECT s.student_id, s.name, s.email, e.enrolled_at
         FROM lm_enrollments e JOIN lm_students s ON s.student_id = e.student_id
         WHERE e.class_id = $1 ORDER BY s.name`, [classId]);
            res.json({ students: r.rows });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to list class students');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/education/classes/:classId/students {email} — share a class by
     *  enrolling a student by email (owner-only). Provisions a placeholder student
     *  row if they haven't signed in yet; their progress attaches on first login. */
    router.post('/classes/:classId/students', async (req, res) => {
        try {
            const classId = String(req.params.classId);
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertTeacherOfClass)(ctx.pool, me, classId);
            const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
            if (!email || !email.includes('@')) {
                res.status(400).json({ error: 'a valid email is required' });
                return;
            }
            let s = (await ctx.pool.query('SELECT student_id, name FROM lm_students WHERE lower(email) = $1', [email])).rows[0];
            if (!s) {
                s = (await ctx.pool.query(`INSERT INTO lm_students (name, email, role) VALUES ($1, $2, 'student') RETURNING student_id, name`, [email.split('@')[0], email])).rows[0];
            }
            await ctx.pool.query(`INSERT INTO lm_enrollments (student_id, class_id) VALUES ($1, $2) ON CONFLICT (student_id, class_id) DO NOTHING`, [s.student_id, classId]);
            logger.info({ classId, studentId: s.student_id, byOwner: me.studentId }, 'Student shared into class');
            res.status(201).json({ studentId: s.student_id, name: s.name, email });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to add student to class');
            res.status(500).json({ error: err.message });
        }
    });
    /** DELETE /api/education/classes/:classId/students/:studentId — unenroll a
     *  student (owner-only). Their private progress rows are left intact. */
    router.delete('/classes/:classId/students/:studentId', async (req, res) => {
        try {
            const classId = String(req.params.classId);
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertTeacherOfClass)(ctx.pool, me, classId);
            if (req.params.studentId === me.studentId) {
                res.status(400).json({ error: "the owner can't remove themselves" });
                return;
            }
            await ctx.pool.query('DELETE FROM lm_enrollments WHERE class_id = $1 AND student_id = $2', [classId, req.params.studentId]);
            res.json({ success: true });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to remove student from class');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/education/classes — create a class with full setup. ANY authenticated
     *  user may create one: a teacher for their students, or a student for their own
     *  self-study when they can't find a class to join. The creator becomes the class
     *  OWNER (teacher_student_id) AND is enrolled, so they can immediately access and
     *  manage it through the same enrollment-based access model. */
    router.post('/classes', async (req, res) => {
        try {
            const { name, subject, gradeLevel, teacherName, description, website, schedule, room } = req.body;
            if (!name || !subject) {
                res.status(400).json({ error: 'name and subject are required' });
                return;
            }
            const creator = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const classId = (0, crypto_1.randomUUID)();
            const prefix = `lm-class-${classId.substring(0, 8)}`;
            const metadata = { website: website || '', schedule: schedule || '', room: room || '' };
            // Teachers publish to the school-wide class bank by default; students get a
            // PRIVATE class (only on their screen) they can later publish if they own it.
            const isTeacher = creator.role === 'teacher' || creator.role === 'admin';
            await ctx.pool.query(`INSERT INTO lm_classes (class_id, name, subject, grade_level, teacher_name, description, chroma_collection_prefix, metadata, teacher_student_id, published, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [classId, name, subject, gradeLevel || '', teacherName || creator.name || '', description || '', prefix, JSON.stringify(metadata), creator.studentId, isTeacher, creator.tenantId]);
            // Enroll the creator so the class shows in their dashboard + is accessible.
            await ctx.pool.query(`INSERT INTO lm_enrollments (student_id, class_id) VALUES ($1, $2) ON CONFLICT (student_id, class_id) DO NOTHING`, [creator.studentId, classId]);
            // Auto-register this class as a ribbon icon immediately
            (0, tool_routes_1.registerDynamicToolUI)(`lm-class-${classId.substring(0, 8)}`, name, 'codicon codicon-book', `/api/education/class?classId=${classId}`, `class-tutor-${classId.substring(0, 8)}`);
            logger.info({ classId, name, subject, creator: creator.studentId }, 'Class created (creator owns + enrolled) and registered in ribbon');
            res.status(201).json({ classId, name, subject, chromaPrefix: prefix });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to create class');
            res.status(500).json({ error: err.message });
        }
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // MATERIALS — upload (any file + mobile photo) / list / view; enrolled-gated.
    // Extracted to education-materials-routes.ts (1000-line cap).
    // ═══════════════════════════════════════════════════════════════════════════
    router.use((0, education_materials_routes_1.createEducationMaterialsRoutes)(ctx));
    router.use((0, education_rewards_routes_1.createEducationRewardsRoutes)(ctx));
    // ═══════════════════════════════════════════════════════════════════════════
    // LECTURE PROCESSING — extracted to education-lecture-routes.ts (1000-line cap)
    // ═══════════════════════════════════════════════════════════════════════════
    router.use((0, education_lecture_routes_1.createEducationLectureRoutes)(ctx));
    // ═══════════════════════════════════════════════════════════════════════════
    // TUTOR CHAT (real LLM execution)
    // ═══════════════════════════════════════════════════════════════════════════
    /** POST /api/education/tutor-chat — send message to LLM with class context */
    router.post('/tutor-chat', async (req, res) => {
        try {
            const { message, classId, conversationId, imageData, imageMediaType } = req.body;
            // A student may send a photo of their work with no typed question, so accept
            // an image on its own. imageData is base64 (no data: prefix); imageMediaType
            // is the MIME type (image/* for vision, application/pdf for a document block).
            const hasImage = typeof imageData === 'string' && imageData.length > 0 && typeof imageMediaType === 'string';
            if (!message && !hasImage) {
                res.status(400).json({ error: 'message or image is required' });
                return;
            }
            const fsMod = require('fs');
            const claudeOauthExists = (() => {
                try {
                    return fsMod.existsSync('/root/.claude/.credentials.json') || fsMod.existsSync(`${process.env.HOME || ''}/.claude/.credentials.json`);
                }
                catch {
                    return false;
                }
            })();
            const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
            if (!hasAnthropicKey && !claudeOauthExists) {
                logger.warn({ classId }, 'Tutor chat unavailable: no claude-code OAuth file and no ANTHROPIC_API_KEY');
                res.status(503).json({
                    error: 'Tutor unavailable',
                    reason: 'Neither claude-code OAuth (~/.claude/.credentials.json) nor ANTHROPIC_API_KEY is available. Mount the OAuth file or set the API key, then restart the api container.',
                });
                return;
            }
            // `message` is optional (an image-only request has none) — guard so logging never throws.
            logger.info({ classId, messageLength: (message || '').length }, 'Tutor chat message');
            // Build class-specific system prompt
            let classContext = '';
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (classId && uuidPattern.test(classId)) {
                try {
                    const classResult = await ctx.pool.query('SELECT name, subject, teacher_name FROM lm_classes WHERE class_id = $1', [classId]);
                    if (classResult.rows.length > 0) {
                        const cls = classResult.rows[0];
                        classContext = `\nYou are tutoring for ${cls.name} (${cls.subject}), taught by ${cls.teacher_name || 'the teacher'}.`;
                    }
                }
                catch (dbErr) {
                    logger.debug({ err: dbErr, classId }, 'Class lookup failed — proceeding without class context');
                }
            }
            // RAG grounding: retrieve from this class's own ingested textbook + lecture
            // collections so the tutor answers from the student's actual materials (with
            // citations) instead of generic knowledge. This is the differentiator the UI
            // already promises ("I'll use your textbook and notes"). Collections follow the
            // education tool naming `lm-class-{classId}-{type}` (see classKnowledgeTool.js).
            let materialsContext = '';
            let sources = [];
            if (classId && uuidPattern.test(classId)) {
                try {
                    const { RagService } = require('@/features/rag');
                    const rag = new RagService();
                    // Class-shared collections (teacher materials + lectures) PLUS the
                    // caller's own private materials collection, so a student's uploaded
                    // textbook/handout/photo grounds THEIR tutor without leaking to others.
                    const collections = [`lm-class-${classId}-textbook`, `lm-class-${classId}-lecture`, (0, education_access_1.sharedMaterialsCollection)(classId)];
                    try {
                        const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
                        collections.push((0, education_access_1.privateMaterialsCollection)(classId, me.studentId));
                    }
                    catch { /* unauthenticated context — ground in shared collections only */ }
                    const hitGroups = await Promise.all(collections.map((c) => rag.search(message, c, 4).catch(() => [])));
                    const hits = hitGroups.flat()
                        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                        .slice(0, 5);
                    if (hits.length > 0) {
                        sources = hits.map((h, i) => ({ n: i + 1, text: String(h.text ?? '').slice(0, 600) }));
                        materialsContext = sources.map((s) => `[${s.n}] ${s.text}`).join('\n\n');
                        logger.info({ classId, hitCount: hits.length }, 'Tutor RAG grounding: retrieved class materials');
                    }
                }
                catch (ragErr) {
                    logger.debug({ err: ragErr, classId }, 'Tutor RAG retrieval failed — answering without grounding');
                }
            }
            const systemPrompt = [
                'You are a patient, encouraging AI tutor for the Little Monsters education platform.',
                'Your student has ADHD. Adapt your teaching style accordingly.',
                classContext,
                materialsContext
                    ? `\nCLASS MATERIALS (retrieved from THIS class's own textbook/notes — ground your answer in these and cite them inline like [1], [2]. If they don't cover the question, say so in one line, then help from general knowledge):\n${materialsContext}\n`
                    : '\n(No class materials are loaded for this class yet — answer from general knowledge, and if helpful, gently suggest the student upload their textbook so future answers can be grounded in their actual class content.)',
                '',
                'TEACHING METHOD:',
                '- Use Socratic method — ask guiding questions before giving direct answers',
                '- Break complex problems into smaller, concrete steps (ADHD students need this)',
                '- Celebrate progress and normalize mistakes — every attempt is growth',
                '- Keep responses SHORT and focused. Long walls of text lose ADHD students.',
                '- Use bullet points, numbered steps, and bold for key terms',
                '- One concept at a time. Ask "Ready for the next part?" before continuing',
                '- If the student seems stuck, try a completely different angle or analogy',
                '',
                'ADHD SUPPORT:',
                '- If the student says they are frustrated or overwhelmed, acknowledge it: "I get it, this is tough. Let me try explaining it differently."',
                '- If they seem scattered, gently refocus: "Let me bring us back to the main question."',
                '- Suggest breaks when appropriate: "We have been at this for a while. Want to take a quick stretch break?"',
                '- Break big tasks down: "This looks like a lot. Let me help you split it into 3 smaller pieces."',
                '- Use real-world analogies they can relate to',
                '',
                'ACADEMIC INTEGRITY GUARDRAILS (HARD RULES — protect the student\'s real learning):',
                'When a student uploads or describes an assignment, worksheet, or homework problem, you must NOT',
                'give the direct answer or do the work for them. Instead, help using ONLY these four moves:',
                '  1. LECTURE RECAP — point them back to the exact spot in their recorded lecture or the flashcard',
                '     set that covers the concept (cite the class materials above when you can).',
                '  2. PARALLEL PROBLEM — make up a SIMILAR problem and solve THAT one step by step to show the',
                '     method, then ask them to apply it to their own problem. Never solve their actual problem.',
                '  3. SOCRATIC DEBUGGING — if they show their own work (including a photo), find the FIRST step',
                '     where their logic went wrong, point to that step, explain why, and ask them to try again.',
                '  4. CUSTOM TUTORIAL — teach the underlying theory as a short step-by-step, not the answer.',
                'NEVER write their essay, lab report, or final answers. If it looks like an active test, redirect to studying.',
                '',
                'STYLE:',
                '- Keep explanations age-appropriate and clear',
                '- Responses should be 2-4 short paragraphs MAX, not essays',
            ].join('\n');
            const promptText = message || 'I uploaded a picture of my work. Please help me with it using the guardrails (no direct answers).';
            let responseText = '';
            if (hasImage && hasAnthropicKey) {
                // Vision path: the shared AnthropicProvider flattens non-string content to a
                // JSON string, so it can't carry image blocks. Call the SDK directly with a
                // proper multimodal user turn (image/document block + text). haiku-4-5 supports
                // image input. This is what powers "take a photo of your handwritten work".
                logger.info({ classId, mediaType: imageMediaType }, 'Calling Anthropic API (haiku, vision) for tutor response');
                try {
                    const AnthropicSdk = require('@anthropic-ai/sdk');
                    const AnthropicClient = AnthropicSdk.default ?? AnthropicSdk;
                    const client = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });
                    const blocks = [];
                    if (imageMediaType.startsWith('image/')) {
                        blocks.push({ type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageData } });
                    }
                    else if (imageMediaType === 'application/pdf') {
                        blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageData } });
                    }
                    blocks.push({ type: 'text', text: promptText });
                    const result = await client.messages.create({
                        model: 'claude-haiku-4-5-20251001',
                        max_tokens: 800,
                        system: systemPrompt,
                        messages: [{ role: 'user', content: blocks }],
                    });
                    const textBlock = result.content.find(b => b.type === 'text');
                    responseText = textBlock?.text ?? '';
                }
                catch (visionErr) {
                    logger.error({ err: visionErr, classId }, 'Anthropic vision call failed');
                }
            }
            else if (hasAnthropicKey) {
                logger.info({ classId, messageLength: promptText.length }, 'Calling Anthropic API (haiku) for tutor response');
                const { AnthropicProvider } = require('@/features/llm-provider');
                const provider = new AnthropicProvider({ model: 'claude-haiku-4-5-20251001', maxTokens: 800 });
                try {
                    const result = await provider.sendRequest({
                        systemPrompt,
                        messages: [{ role: 'user', content: promptText }],
                    });
                    const textBlock = result.content
                        .find(b => b.type === 'text');
                    responseText = textBlock?.text ?? '';
                }
                catch (llmErr) {
                    logger.error({ err: llmErr, classId }, 'Anthropic API call failed');
                }
            }
            else {
                logger.info({ classId, messageLength: promptText.length }, 'Calling claude CLI (claude-code OAuth) for tutor response');
                const { spawn } = require('child_process');
                const args = [
                    '-p', promptText,
                    '--output-format', 'json',
                    '--system-prompt', systemPrompt,
                    '--model', 'claude-haiku-4-5-20251001',
                    '--allowedTools', '',
                ];
                try {
                    responseText = await new Promise((resolve, reject) => {
                        const child = spawn('claude', args, { env: { ...process.env, ANTHROPIC_API_KEY: '' } });
                        let stdout = '', stderr = '';
                        child.stdout?.on('data', d => stdout += d.toString());
                        child.stderr?.on('data', d => stderr += d.toString());
                        child.on('error', reject);
                        child.on('close', code => {
                            if (code !== 0) {
                                reject(new Error(`claude CLI exit ${code}: ${stderr.slice(0, 400)}`));
                                return;
                            }
                            try {
                                const parsed = JSON.parse(stdout);
                                resolve(parsed.result || parsed.content || '');
                            }
                            catch {
                                resolve(stdout.trim());
                            }
                        });
                        setTimeout(() => { try {
                            child.kill();
                        }
                        catch { } reject(new Error('claude CLI timed out after 60s')); }, 60_000);
                    });
                }
                catch (cliErr) {
                    logger.error({ err: cliErr, classId }, 'claude CLI call failed');
                }
            }
            if (!responseText) {
                responseText = 'I had trouble processing that. Could you rephrase your question?';
            }
            // Award XP for asking a tutor question. awardXP no-ops on a null studentId, so resolve
            // the asker first (best-effort) — otherwise this silently never awarded despite the comment.
            try {
                const asker = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
                await awardXP(ctx, asker.studentId, 'tutor_question', { classId });
            }
            catch { /* unauthenticated tutor context — no XP to award */ }
            logger.info({ classId, responseLength: responseText.length }, 'Tutor response generated via Anthropic API');
            res.json({
                success: true,
                response: responseText,
                conversationId: conversationId || `tutor-${(0, crypto_1.randomUUID)()}`,
                grounded: sources.length > 0,
                sources,
            });
        }
        catch (err) {
            logger.error({ err }, 'Tutor chat failed');
            res.status(500).json({ error: err.message });
        }
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // FLASHCARDS + QUIZ — extracted to education-study-routes.ts (1000-line cap)
    // ═══════════════════════════════════════════════════════════════════════════
    router.use((0, education_study_routes_1.createEducationStudyRoutes)(ctx));
    // ═══════════════════════════════════════════════════════════════════════════
    // TEACHER ANALYTICS — teacher-gated class/roster progress views
    // ═══════════════════════════════════════════════════════════════════════════
    router.use((0, education_teacher_routes_1.createEducationTeacherRoutes)(ctx));
    // ═══════════════════════════════════════════════════════════════════════════
    // CLASS BANK — school-wide published-class catalog + student self-enroll
    // ═══════════════════════════════════════════════════════════════════════════
    router.use((0, education_catalog_routes_1.createEducationCatalogRoutes)(ctx));
    // ═══════════════════════════════════════════════════════════════════════════
    // ASSIGNMENTS
    // ═══════════════════════════════════════════════════════════════════════════
    /** GET /api/education/assignments?classId=X — list assignments (shared class
     *  material). A specific class requires enrollment; otherwise scoped to the
     *  student's accessible classes. */
    router.get('/assignments', async (req, res) => {
        try {
            const { classId, status } = req.query;
            const student = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            let sql = `SELECT a.*, c.name as class_name FROM lm_assignments a
                 JOIN lm_classes c ON a.class_id = c.class_id WHERE 1=1`;
            const params = [];
            if (classId) {
                await (0, education_access_1.assertClassAccess)(ctx.pool, student, String(classId)); // 403 unless enrolled/teacher
                params.push(classId);
                sql += ` AND a.class_id = $${params.length}`;
            }
            else {
                const accessible = await (0, education_access_1.listAccessibleClassIds)(ctx.pool, student);
                if (accessible.length === 0) {
                    res.json({ assignments: [] });
                    return;
                }
                params.push(accessible);
                sql += ` AND a.class_id = ANY($${params.length})`;
            }
            if (status) {
                params.push(status);
                sql += ` AND a.status = $${params.length}`;
            }
            sql += ' ORDER BY a.due_date ASC NULLS LAST';
            const result = await ctx.pool.query(sql, params);
            res.json({ assignments: result.rows });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to list assignments');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/education/assignments — create an assignment (teacher of the class). */
    router.post('/assignments', async (req, res) => {
        try {
            const { classId, title, description, assignmentType, dueDate, resources } = req.body;
            if (!classId || !title) {
                res.status(400).json({ error: 'classId and title are required' });
                return;
            }
            // Only a teacher of the class (or admin) may create assignments for it.
            const teacher = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertTeacherOfClass)(ctx.pool, teacher, String(classId));
            const result = await ctx.pool.query(`INSERT INTO lm_assignments (class_id, title, description, assignment_type, due_date, resources)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING assignment_id`, [classId, title, description || '', assignmentType || 'homework', dueDate || null, JSON.stringify(resources || [])]);
            res.status(201).json({ assignmentId: result.rows[0].assignment_id });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to create assignment');
            res.status(500).json({ error: err.message });
        }
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // STUDENT & XP
    // ═══════════════════════════════════════════════════════════════════════════
    /** GET /api/education/me — the authenticated user's identity + onboarding state.
     *  Lets the UI greet by name, branch teacher-vs-student, and decide whether to
     *  show the first-run onboarding (classCount === 0). No client id needed. */
    router.get('/me', async (req, res) => {
        try {
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const classIds = await (0, education_access_1.listAccessibleClassIds)(ctx.pool, me);
            res.json({
                studentId: me.studentId,
                name: me.name,
                email: me.email,
                role: me.role,
                classCount: classIds.length,
                isNew: classIds.length === 0,
            });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to resolve current user');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/education/student/:studentId/dashboard — full dashboard data.
     *  PRIVATE: a student can only read their OWN dashboard; the :studentId path
     *  param is ignored for students (forced to the authenticated identity) and
     *  honored only for teachers/admins viewing one of their students. */
    router.get('/student/:studentId/dashboard', async (req, res) => {
        try {
            const authed = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const studentId = authed.role === 'student' ? authed.studentId : req.params.studentId;
            // Get student
            const studentResult = await ctx.pool.query('SELECT * FROM lm_students WHERE student_id = $1', [studentId]);
            if (studentResult.rows.length === 0) {
                res.status(404).json({ error: 'Student not found' });
                return;
            }
            const student = studentResult.rows[0];
            // Get enrolled classes with stats
            const classesResult = await ctx.pool.query(`SELECT c.*,
          (SELECT COUNT(*) FROM lm_lectures l WHERE l.class_id = c.class_id) as lecture_count,
          (SELECT COALESCE(SUM(card_count), 0) FROM lm_flashcard_sets fs WHERE fs.class_id = c.class_id) as flashcard_count
         FROM lm_classes c
         JOIN lm_enrollments e ON c.class_id = e.class_id
         WHERE e.student_id = $1 AND c.status = 'active'`, [studentId]);
            // Get upcoming assignments
            const assignmentsResult = await ctx.pool.query(`SELECT a.*, c.name as class_name FROM lm_assignments a
         JOIN lm_classes c ON a.class_id = c.class_id
         JOIN lm_enrollments e ON c.class_id = e.class_id
         WHERE e.student_id = $1 AND a.status = 'active' AND (a.due_date >= CURRENT_DATE OR a.due_date IS NULL)
         ORDER BY a.due_date ASC NULLS LAST LIMIT 10`, [studentId]);
            // Quiz average
            const quizResult = await ctx.pool.query('SELECT COALESCE(AVG(score_percent), 0) as avg_score, COUNT(*) as quiz_count FROM lm_quiz_results WHERE student_id = $1', [studentId]);
            // Total flashcards reviewed
            const fcResult = await ctx.pool.query('SELECT COUNT(*) as reviewed FROM lm_flashcard_progress WHERE student_id = $1 AND last_reviewed IS NOT NULL', [studentId]);
            res.json({
                student: {
                    ...student,
                    level: levelFromXP(student.xp),
                },
                classes: classesResult.rows,
                upcoming: assignmentsResult.rows,
                stats: {
                    quizAverage: Math.round(quizResult.rows[0].avg_score),
                    quizCount: parseInt(quizResult.rows[0].quiz_count),
                    flashcardsReviewed: parseInt(fcResult.rows[0].reviewed),
                },
            });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to get dashboard');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/education/students — create a student */
    router.post('/students', async (req, res) => {
        try {
            const { name, email } = req.body;
            if (!name) {
                res.status(400).json({ error: 'name is required' });
                return;
            }
            const result = await ctx.pool.query(`INSERT INTO lm_students (name, email) VALUES ($1, $2) RETURNING student_id`, [name, email || null]);
            res.status(201).json({ studentId: result.rows[0].student_id });
        }
        catch (err) {
            logger.error({ err }, 'Failed to create student');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/education/enroll — enroll student in class */
    router.post('/enroll', async (req, res) => {
        try {
            const { studentId, classId } = req.body;
            if (!studentId || !classId) {
                res.status(400).json({ error: 'studentId and classId are required' });
                return;
            }
            await ctx.pool.query(`INSERT INTO lm_enrollments (student_id, class_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [studentId, classId]);
            res.json({ success: true });
        }
        catch (err) {
            logger.error({ err }, 'Failed to enroll student');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/education/xp — award XP to a student */
    router.post('/xp', async (req, res) => {
        try {
            const { eventType, metadata } = req.body;
            // PRIVATE write: XP always accrues to the AUTHENTICATED student, never a
            // client-supplied id — a student cannot inflate another student's XP.
            const authed = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            if (!eventType) {
                res.status(400).json({ error: 'eventType is required' });
                return;
            }
            const result = await awardXP(ctx, authed.studentId, eventType, metadata);
            res.json(result);
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to award XP');
            res.status(500).json({ error: err.message });
        }
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // QUIZ RESULTS
    // ═══════════════════════════════════════════════════════════════════════════
    /** POST /api/education/quiz-results — record a quiz result */
    router.post('/quiz-results', async (req, res) => {
        try {
            const { classId, scorePercent, totalQuestions, correctAnswers, topics, missedQuestions } = req.body;
            // PRIVATE write: a quiz result is always recorded for the AUTHENTICATED
            // student. If a class is named, the student must be enrolled in it.
            const authed = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            if (scorePercent === undefined || !totalQuestions) {
                res.status(400).json({ error: 'scorePercent and totalQuestions are required' });
                return;
            }
            if (classId)
                await (0, education_access_1.assertClassAccess)(ctx.pool, authed, String(classId));
            const studentId = authed.studentId;
            await ctx.pool.query(`INSERT INTO lm_quiz_results (student_id, class_id, score_percent, total_questions, correct_answers, topics, missed_questions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`, [studentId, classId || null, scorePercent, totalQuestions, correctAnswers || 0,
                JSON.stringify(topics || []), JSON.stringify(missedQuestions || [])]);
            // Award XP
            await awardXP(ctx, studentId, 'quiz_completed', { classId, scorePercent });
            if (scorePercent >= 90) {
                await awardXP(ctx, studentId, 'quiz_high_score', { classId, scorePercent });
            }
            res.status(201).json({ success: true });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to record quiz result');
            res.status(500).json({ error: err.message });
        }
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // HEALTH
    // ═══════════════════════════════════════════════════════════════════════════
    router.get('/status', async (_req, res) => {
        let dbOk = false;
        try {
            await ctx.pool.query('SELECT 1');
            dbOk = true;
        }
        catch { /* db down */ }
        res.json({
            platform: 'little-monsters',
            status: dbOk ? 'healthy' : 'degraded',
            database: dbOk ? 'connected' : 'unavailable',
            timestamp: new Date().toISOString(),
        });
    });
    // Ribbon UI registrations are OWNED BY THE SWARM-APP MANIFEST.
    // The manifest at swarm-apps/little-monsters.yaml declares the static
    // education tool icons and the per-class dynamic icons. SwarmAppService
    // registers them at app-activation time. This function must not also
    // register — that caused double-registration drift where icons persisted
    // after the app was toggled off.
    logger.info('Education routes registered (ribbon UIs owned by swarm-app manifest)');
    return router;
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Award XP to a student and update their level. */
async function awardXP(ctx, studentId, eventType, metadata = {}) {
    const xpAmount = exports.XP_TABLE[eventType] || 0;
    if (xpAmount === 0 || !studentId)
        return { xpAwarded: 0 };
    await ctx.pool.query(`INSERT INTO lm_xp_events (student_id, event_type, xp_amount, metadata) VALUES ($1, $2, $3, $4)`, [studentId, eventType, xpAmount, JSON.stringify(metadata)]);
    const result = await ctx.pool.query(`UPDATE lm_students SET xp = xp + $1, updated_at = NOW() WHERE student_id = $2 RETURNING xp`, [xpAmount, studentId]);
    if (result.rows.length > 0) {
        const totalXP = result.rows[0].xp;
        const level = levelFromXP(totalXP);
        const oldLevel = levelFromXP(totalXP - xpAmount);
        await ctx.pool.query('UPDATE lm_students SET level = $1 WHERE student_id = $2', [level, studentId]);
        // Rewards: every level gained drops a mystery box the student opens in "My Monsters".
        let boxesGranted = 0;
        if (level > oldLevel) {
            boxesGranted = level - oldLevel;
            try {
                await ctx.pool.query(`INSERT INTO lm_rewards (student_id, boxes) VALUES ($1, $2)
           ON CONFLICT (student_id) DO UPDATE SET boxes = lm_rewards.boxes + $2, updated_at = NOW()`, [studentId, boxesGranted]);
            }
            catch (e) {
                boxesGranted = 0; /* rewards table not ready yet — non-fatal */
            }
        }
        return { xpAwarded: xpAmount, totalXP, level, boxesGranted };
    }
    return { xpAwarded: xpAmount };
}
// registerClassBots() removed — per-class ribbon icons are owned by the
// swarm-app manifest's ui.dynamic block (SwarmAppService.registerDynamicRowUis).
// Live registration on class creation still happens in POST /classes (line ~147)
// so a freshly created class immediately gets its icon without needing an app reload.
/** Bootstrap education tables if they don't exist. Idempotent. */
async function ensureEducationSchema(pool) {
    const fs = require('fs');
    const path = require('path');
    if (!(0, database_1.runtimeSchemaBootstrapEnabled)()) {
        await (0, database_1.assertSchemaReady)(pool, 'education routes', [
            { table: 'lm_classes', columns: ['class_id', 'name', 'subject', 'status', 'published', 'tenant_id', 'teacher_student_id'] },
            { table: 'lm_students', columns: ['student_id', 'name', 'email', 'xp', 'level', 'external_id', 'role', 'tenant_id'] },
            { table: 'lm_enrollments', columns: ['student_id', 'class_id', 'enrolled_at'] },
            { table: 'lm_flashcard_sets', columns: ['set_id', 'class_id', 'title', 'card_count', 'created_at'] },
            { table: 'lm_flashcards', columns: ['card_id', 'set_id', 'front', 'back', 'card_type', 'difficulty', 'created_at'] },
            { table: 'lm_flashcard_progress', columns: ['student_id', 'card_id', 'repetitions', 'next_review'] },
            { table: 'lm_assignments', columns: ['assignment_id', 'class_id', 'title', 'assignment_type', 'status', 'created_at'] },
            { table: 'lm_xp_events', columns: ['event_id', 'student_id', 'event_type', 'xp_amount', 'metadata', 'created_at'] },
            { table: 'lm_quiz_results', columns: ['result_id', 'student_id', 'class_id', 'score_percent', 'total_questions', 'completed_at'] },
            { table: 'lm_lectures', columns: ['lecture_id', 'class_id', 'lecture_date', 'audio_path', 'transcript_path', 'slides_path', 'status', 'created_at'] },
            { table: 'lm_calendar_events', columns: ['event_id', 'class_id', 'title', 'event_date', 'google_event_id', 'google_synced_at'] },
            { table: 'lm_materials', columns: ['material_id', 'class_id', 'uploaded_by', 'stored_path', 'shared', 'share_status', 'created_at'] },
            { table: 'lm_tenants', columns: ['tenant_id', 'slug', 'name', 'domain', 'created_at'] },
        ]);
        logger.info('Education schema validate-only requirements are present');
        return;
    }
    const migrationPath = path.resolve(process.cwd(), 'scripts/migrations/019-education-platform.sql');
    if (!fs.existsSync(migrationPath)) {
        logger.warn('Education migration file not found — skipping schema bootstrap');
        return;
    }
    try {
        const sql = fs.readFileSync(migrationPath, 'utf-8');
        await pool.query(sql);
        logger.info('Education schema bootstrapped successfully');
    }
    catch (err) {
        // Tables may already exist — that's fine (CREATE TABLE IF NOT EXISTS)
        if (!err.message.includes('already exists')) {
            logger.warn({ err }, 'Education schema bootstrap warning');
        }
    }
    // Idempotent column additions newer than the base 019 migration (mirrors
    // scripts/migrations/024-lecture-slides.sql + 025-calendar-google-sync.sql for
    // deployments that bootstrap here instead of via DatabaseBootstrapService).
    try {
        await pool.query(`ALTER TABLE lm_lectures ADD COLUMN IF NOT EXISTS slides_path VARCHAR(500)`);
    }
    catch (err) {
        logger.warn({ err }, 'Education schema column upgrade warning (slides_path)');
    }
    try {
        await pool.query(`ALTER TABLE lm_calendar_events ADD COLUMN IF NOT EXISTS google_event_id VARCHAR(255)`);
        await pool.query(`ALTER TABLE lm_calendar_events ADD COLUMN IF NOT EXISTS google_synced_at TIMESTAMPTZ`);
    }
    catch (err) {
        logger.warn({ err }, 'Education schema column upgrade warning (calendar google sync)');
    }
    // Education identity (migration 026): SSO mapping + role + class ownership.
    try {
        await pool.query(`ALTER TABLE lm_students ADD COLUMN IF NOT EXISTS external_id VARCHAR(255)`);
        await pool.query(`ALTER TABLE lm_students ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'student'`);
        await pool.query(`ALTER TABLE lm_classes ADD COLUMN IF NOT EXISTS teacher_student_id UUID`);
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_students_external_id ON lm_students (external_id) WHERE external_id IS NOT NULL`);
    }
    catch (err) {
        logger.warn({ err }, 'Education schema column upgrade warning (identity 026)');
    }
    // Class publishing (migration 027): published classes form the school-wide
    // "class bank" that any member can browse + self-enroll into. Student-created
    // classes stay private (published = false) until an owner publishes them.
    try {
        await pool.query(`ALTER TABLE lm_classes ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT false`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_lm_classes_published ON lm_classes (published) WHERE published = true`);
    }
    catch (err) {
        logger.warn({ err }, 'Education schema column upgrade warning (publishing 027)');
    }
    // Class materials (migration 028): any-filetype documents attached to a class
    // (textbooks, handouts, photos of assignments). Uploadable by any enrolled member.
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS lm_materials (
      material_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID NOT NULL,
      uploaded_by UUID,
      original_name TEXT,
      stored_path TEXT NOT NULL,
      mime_type TEXT,
      size_bytes BIGINT DEFAULT 0,
      kind VARCHAR(20) NOT NULL DEFAULT 'document',
      title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_lm_materials_class ON lm_materials (class_id, created_at DESC)`);
    }
    catch (err) {
        logger.warn({ err }, 'Education schema column upgrade warning (materials 028)');
    }
    // Material sharing (migration 029): private by default; a teacher can share a
    // material with the class, and a student can request a share a teacher approves.
    // share_status: private | requested | approved | denied.
    try {
        await pool.query(`ALTER TABLE lm_materials ADD COLUMN IF NOT EXISTS shared BOOLEAN NOT NULL DEFAULT false`);
        await pool.query(`ALTER TABLE lm_materials ADD COLUMN IF NOT EXISTS share_status VARCHAR(20) NOT NULL DEFAULT 'private'`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_lm_materials_shared ON lm_materials (class_id, share_status)`);
    }
    catch (err) {
        logger.warn({ err }, 'Education schema column upgrade warning (material sharing 029)');
    }
    // Multi-tenant foundation (migration 030): a school = a tenant. Existing data
    // belongs to the seeded "default school"; an operator carves out a new school
    // by inserting an lm_tenants row with a matching email domain. Additive — the
    // single-tenant demo is unchanged (everyone resolves to the default tenant).
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS lm_tenants (
      tenant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug VARCHAR(64) UNIQUE NOT NULL,
      name TEXT NOT NULL,
      domain VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
        await pool.query(`INSERT INTO lm_tenants (tenant_id, slug, name) VALUES ('00000000-0000-4000-8000-00000000d001', 'default', 'Default School')
       ON CONFLICT (tenant_id) DO NOTHING`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_lm_tenants_domain ON lm_tenants (lower(domain)) WHERE domain IS NOT NULL`);
        await pool.query(`ALTER TABLE lm_students ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000d001'`);
        await pool.query(`ALTER TABLE lm_classes ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000d001'`);
    }
    catch (err) {
        logger.warn({ err }, 'Education schema column upgrade warning (multi-tenant 030)');
    }
}
//# sourceMappingURL=education-routes.js.map