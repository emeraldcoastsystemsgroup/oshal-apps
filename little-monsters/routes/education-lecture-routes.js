"use strict";
/**
 * Education Lecture Routes — Little Monsters Platform API
 *
 * Lecture lifecycle endpoints: audio upload + ticket pipeline, browser-STT
 * transcript processing (notes/flashcards/assignments/slides in one LLM pass),
 * lecture listing, slide decks, and persisted class recordings.
 * Extracted from education-routes.ts when it crossed the 1000-line cap.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 2026-06-12 19:45:00 | roger.murphy@agenticfederal.us   | Extracted lecture routes from education-routes.ts (1522 lines > 1000 cap); endpoints moved verbatim
 * 2026-06-17 19:21:00 | roger.murphy@emeraldcoastsystemsgroup.com | Integrate the presentation generator: POST /lectures/:lectureId/pptx renders the deck to a real .pptx (via renderAndSaveLectureDeck), and /process-transcript auto-emits one as a deliverable alongside notes/flashcards/slides.
 * ---------------------------------------------------------------------------
 *
 * @module education-lecture-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationLectureRoutes = createEducationLectureRoutes;
const express_1 = require("express");
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const internal_ticket_1 = require("@/entities/ticket/internal-ticket");
const education_voice_routes_1 = require("./education-voice-routes");
const education_pptx_1 = require("./education-pptx");
const education_access_1 = require("./education-access");
const logger = (0, logger_1.createChildLogger)({ module: 'education-lecture-routes' });
/** Map an EducationAccessError to its HTTP status; returns true if handled. */
function sendAccessError(res, err) {
    if (err instanceof education_access_1.EducationAccessError) {
        res.status(err.status).json({ error: err.message });
        return true;
    }
    return false;
}
/**
 * @description Creates the lecture-lifecycle sub-router mounted inside
 * createEducationRoutes: process-lecture (audio → STT → bot ticket),
 * process-transcript (browser STT → grounded study materials + slides),
 * lecture listing/detail, slide decks, and saved class recordings.
 * @param ctx - shared app context (db pool, ticket service)
 * @returns an Express router with all /lectures* and /process-* endpoints
 */
function createEducationLectureRoutes(ctx) {
    const router = (0, express_1.Router)();
    const multer = require('multer');
    const fs = require('fs');
    const path = require('path');
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 25 * 1024 * 1024 }, // 25MB (Whisper API limit)
        fileFilter: (_req, file, cb) => {
            if (file.mimetype.startsWith('audio/') || file.mimetype === 'application/octet-stream') {
                cb(null, true);
            }
            else {
                cb(new Error('Only audio files are allowed'));
            }
        },
    });
    // Separate multer instance for lecture recordings: a full class period of
    // webm/opus runs ~10-30MB, well past the 25MB STT-upload limit above.
    const recordingUpload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 80 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
            if (file.mimetype.startsWith('audio/') || file.mimetype === 'video/webm' || file.mimetype === 'application/octet-stream')
                cb(null, true);
            else
                cb(new Error('Only audio recordings are allowed'));
        },
    });
    /** POST /api/education/process-lecture — upload audio, create processing ticket */
    router.post('/process-lecture', upload.single('audio'), async (req, res) => {
        try {
            const { classId, lectureDate } = req.body;
            const file = req.file;
            if (!classId) {
                res.status(400).json({ error: 'classId is required' });
                return;
            }
            if (!file) {
                res.status(400).json({ error: 'audio file is required' });
                return;
            }
            // Verify class exists
            const classCheck = await ctx.pool.query('SELECT name, subject FROM lm_classes WHERE class_id = $1', [classId]);
            if (classCheck.rows.length === 0) {
                res.status(404).json({ error: 'Class not found' });
                return;
            }
            const cls = classCheck.rows[0];
            // Save audio to workspace
            const date = lectureDate || new Date().toISOString().split('T')[0];
            const workspaceDir = path.resolve(process.cwd(), 'workspace-shared', 'education', classId);
            if (!fs.existsSync(workspaceDir))
                fs.mkdirSync(workspaceDir, { recursive: true });
            const ext = file.originalname?.split('.').pop() || 'webm';
            const audioFileName = `lecture-${date}.${ext}`;
            const audioPath = path.join(workspaceDir, audioFileName);
            fs.writeFileSync(audioPath, file.buffer);
            logger.info({ classId, audioPath, size: file.size }, 'Audio saved to workspace');
            // Create lecture record
            const lectureId = (0, crypto_1.randomUUID)();
            await ctx.pool.query(`INSERT INTO lm_lectures (lecture_id, class_id, lecture_date, audio_path, status)
         VALUES ($1, $2, $3, $4, 'processing')`, [lectureId, classId, date, audioPath]);
            // Transcribe synchronously via the STT provider registry (Gemini by default).
            // Success writes TRANSCRIPT-<date>.md next to the audio and sets
            // lm_lectures.transcript_path; unconfigured providers are logged but don't
            // block ticket dispatch (the bot can still try its BYOK Whisper tool).
            const transcription = await (0, education_voice_routes_1.runSynchronousTranscription)({
                audioBuffer: file.buffer,
                mimeType: file.mimetype,
                workspaceDir,
                date,
                classId,
                lectureId,
                subject: cls.subject,
                pool: ctx.pool,
            });
            // Create a real ticket for the lecture-scribe bot via the swarm pipeline.
            // When transcription succeeded, include the transcript in the description
            // so the bot can skip straight to notes/flashcards/assignments.
            const ticketInput = internal_ticket_1.CreateInternalTicketSchema.parse({
                title: `Process lecture: ${cls.name} — ${date}`,
                description: (0, education_voice_routes_1.buildLectureTicketDescription)({
                    className: cls.name,
                    subject: cls.subject,
                    date,
                    audioPath,
                    lectureId,
                    classId,
                    transcription,
                }),
                ticketType: 'education',
                labels: ['education', 'lecture-processing', `class:${classId}`],
                metadata: {
                    educationType: 'lecture-processing',
                    classId,
                    lectureId,
                    lectureDate: date,
                    audioPath,
                    subject: cls.subject,
                    transcriptPath: transcription.transcriptPath,
                    transcriptProviderId: transcription.providerId,
                    transcriptStatus: transcription.status,
                },
            });
            const ticket = await ctx.ticketService.createTicket(ticketInput);
            logger.info({ ticketId: ticket.ticketId, lectureId, classId, transcriptStatus: transcription.status }, 'Lecture processing ticket created');
            res.status(201).json({
                success: true,
                lectureId,
                ticketId: ticket.ticketId,
                status: 'processing',
                classId,
                lectureDate: date,
                transcript: {
                    status: transcription.status,
                    providerId: transcription.providerId,
                    path: transcription.transcriptPath,
                    message: transcription.message,
                },
            });
        }
        catch (err) {
            logger.error({ err }, 'Lecture processing failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/education/process-transcript — turn a lecture transcript (from the browser's
     *  Web Speech API or pasted) into grounded study materials: ingest into the class's -lecture
     *  collection, then generate notes + flashcards + assignments. No server-side STT/ffmpeg —
     *  transcription happens in the browser, so this works with zero external credentials. */
    router.post('/process-transcript', async (req, res) => {
        try {
            const { classId, transcript, title } = req.body;
            if (!classId || !transcript || String(transcript).trim().length < 20) {
                res.status(400).json({ error: 'classId and a non-trivial transcript are required' });
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
                res.status(503).json({ error: 'Lecture processing unavailable', reason: 'no claude-code OAuth or ANTHROPIC_API_KEY' });
                return;
            }
            let className = 'this class', subject = '';
            try {
                const r = await ctx.pool.query('SELECT name, subject FROM lm_classes WHERE class_id = $1', [classId]);
                if (r.rows[0]) {
                    className = r.rows[0].name;
                    subject = r.rows[0].subject || '';
                }
            }
            catch { /* best-effort */ }
            const text = String(transcript).slice(0, 12000);
            // 1) Ground future tutoring/quizzes/flashcards on this lecture.
            let ingest = null;
            try {
                const { RagService } = require('@/features/rag');
                const rag = new RagService();
                const r = await rag.ingest([text], `lm-class-${classId}-lecture`, { classId, type: 'lecture', source: title || 'lecture' });
                ingest = { collection: r.collection, chunkCount: r.chunkCount };
            }
            catch (e) {
                logger.warn({ err: e, classId }, 'Lecture transcript ingest failed');
            }
            // 2) Generate notes + flashcards + assignments in one LLM pass.
            const sysPrompt = `You are a study assistant for ${className}${subject ? ` (${subject})` : ''}. From the lecture transcript, produce ADHD-friendly study materials. Respond with ONLY a JSON object, no prose: {"notes":"# markdown study notes with headings and bullets","flashcards":[{"front":"question or term","back":"answer"}],"assignments":[{"title":"...","due":"date if mentioned else empty"}],"slides":[{"title":"short punchy slide title","bullets":["2-4 short bullets, max ~10 words each"],"emoji":"one relevant emoji"}]}. Make 6-10 flashcards and 6-10 slides. The slides retell the lecture as a simple visual story a student can replay to re-live the class. Keep notes concise and skimmable.`;
            let raw = '';
            if (hasAnthropicKey) {
                const { AnthropicProvider } = require('@/features/llm-provider');
                const provider = new AnthropicProvider({ model: 'claude-haiku-4-5-20251001', maxTokens: 6000 });
                const result = await provider.sendRequest({ systemPrompt: sysPrompt, messages: [{ role: 'user', content: `LECTURE TRANSCRIPT:\n${text}` }] });
                const tb = result.content.find((b) => b.type === 'text');
                raw = tb?.text ?? '';
            }
            else {
                const { spawn } = require('child_process');
                raw = await new Promise((resolve, reject) => {
                    const child = spawn('claude', ['-p', `LECTURE TRANSCRIPT:\n${text}`, '--output-format', 'json', '--system-prompt', sysPrompt, '--model', 'claude-haiku-4-5-20251001', '--allowedTools', ''], { env: { ...process.env, ANTHROPIC_API_KEY: '' } });
                    let o = '', e = '';
                    child.stdout?.on('data', (d) => o += d.toString());
                    child.stderr?.on('data', (d) => e += d.toString());
                    child.on('error', reject);
                    child.on('close', (c) => { if (c !== 0) {
                        reject(new Error(`claude CLI exit ${c}: ${e.slice(0, 300)}`));
                        return;
                    } try {
                        const p = JSON.parse(o);
                        resolve(p.result || p.content || '');
                    }
                    catch {
                        resolve(o.trim());
                    } });
                    setTimeout(() => { try {
                        child.kill();
                    }
                    catch { /* noop */ } reject(new Error('claude CLI timed out after 90s')); }, 90_000);
                });
            }
            let obj = {};
            try {
                let t = raw.trim();
                const f = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
                if (f)
                    t = f[1].trim();
                const m = t.match(/\{[\s\S]*\}/);
                obj = JSON.parse(m ? m[0] : t);
            }
            catch {
                obj = {};
            }
            const notes = typeof obj.notes === 'string' ? obj.notes : '';
            const flashcards = Array.isArray(obj.flashcards) ? obj.flashcards.filter((c) => c && c.front && c.back).slice(0, 12) : [];
            const assignments = Array.isArray(obj.assignments) ? obj.assignments.slice(0, 10) : [];
            const slides = Array.isArray(obj.slides)
                ? obj.slides
                    .filter((s) => s && typeof s.title === 'string' && s.title.trim())
                    .map((s) => ({
                    title: String(s.title).slice(0, 120),
                    bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => String(b).slice(0, 200)).slice(0, 6) : [],
                    emoji: typeof s.emoji === 'string' ? s.emoji.slice(0, 8) : '',
                }))
                    .slice(0, 16)
                : [];
            // 3) Persist transcript/notes files, a flashcard set, and an lm_lectures row.
            const workspaceDir = path.resolve(process.cwd(), 'workspace-shared', 'education', classId, 'lectures');
            if (!fs.existsSync(workspaceDir))
                fs.mkdirSync(workspaceDir, { recursive: true });
            const stamp = Date.now();
            const transcriptPath = path.join(workspaceDir, `lecture-${stamp}.transcript.txt`);
            const notesPath = path.join(workspaceDir, `lecture-${stamp}.notes.md`);
            const slidesPath = path.join(workspaceDir, `lecture-${stamp}.slides.json`);
            fs.writeFileSync(transcriptPath, text);
            if (notes)
                fs.writeFileSync(notesPath, notes);
            if (slides.length > 0) {
                fs.writeFileSync(slidesPath, JSON.stringify({ title: title || `Lecture ${new Date(stamp).toLocaleDateString()}`, className, subject, slides }, null, 2));
            }
            let flashcardSetId = null;
            if (flashcards.length > 0) {
                flashcardSetId = (0, crypto_1.randomUUID)();
                const client = await ctx.pool.connect();
                try {
                    await client.query('BEGIN');
                    await client.query(`INSERT INTO lm_flashcard_sets (set_id, class_id, title, topic, source_type, source_reference, card_count) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [flashcardSetId, classId, `Lecture: ${title || new Date(stamp).toISOString().slice(0, 10)}`, subject || null, 'lecture', 'auto-generated from lecture transcript', flashcards.length]);
                    for (const c of flashcards) {
                        await client.query(`INSERT INTO lm_flashcards (set_id, front, back, card_type, difficulty, topic, hints) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [flashcardSetId, String(c.front).slice(0, 500), String(c.back).slice(0, 1000), 'concept', 2, subject || '', JSON.stringify([])]);
                    }
                    await client.query('COMMIT');
                }
                catch (e) {
                    await client.query('ROLLBACK');
                    throw e;
                }
                finally {
                    client.release();
                }
            }
            let lectureId = null;
            try {
                const lr = await ctx.pool.query(`INSERT INTO lm_lectures (class_id, transcript_path, notes_path, slides_path, flashcard_set_id, status) VALUES ($1,$2,$3,$4,$5,'complete') RETURNING lecture_id`, [classId, transcriptPath, notes ? notesPath : null, slides.length > 0 ? slidesPath : null, flashcardSetId]);
                lectureId = lr.rows[0]?.lecture_id ?? null;
            }
            catch (e) {
                logger.warn({ err: e, classId }, 'Lecture row insert failed');
            }
            // Auto-emit a real .pptx deliverable from the just-generated slides (the presentation
            // generator). Best-effort: a missing/failed Files store must never fail lecture processing —
            // the deck can still be re-rendered on demand via POST /lectures/:lectureId/pptx.
            let pptx = null;
            const deckTitle = title || `Lecture ${new Date(stamp).toLocaleDateString()}`;
            const sub = req.oidc?.user?.sub;
            if (slides.length > 0 && sub) {
                try {
                    pptx = await (0, education_pptx_1.renderAndSaveLectureDeck)(ctx, String(sub), deckTitle, slides);
                }
                catch (e) {
                    logger.warn({ err: e?.message, classId, lectureId }, 'Lecture .pptx auto-emit failed (deck still available on demand)');
                }
            }
            logger.info({ classId, lectureId, flashcards: flashcards.length, slides: slides.length, pptx: !!pptx, ingestedChunks: ingest?.chunkCount }, 'Processed lecture transcript into grounded study materials');
            res.status(201).json({ success: true, lectureId, grounded: !!ingest, ingest, transcript: text, notes, assignments, flashcards, slides, flashcardSetId, pptx });
        }
        catch (err) {
            logger.error({ err }, 'Transcript processing failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/education/lectures?classId=X — list lectures for a class */
    router.get('/lectures', async (req, res) => {
        try {
            const { classId: qClassId } = req.query;
            if (!qClassId) {
                res.status(400).json({ error: 'classId query parameter is required' });
                return;
            }
            const student = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertClassAccess)(ctx.pool, student, String(qClassId)); // 403 unless enrolled/teacher
            const result = await ctx.pool.query(`SELECT * FROM lm_lectures WHERE class_id = $1 ORDER BY lecture_date DESC`, [qClassId]);
            res.json({ lectures: result.rows });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to list lectures');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/education/lectures/recent?limit=N — newest lectures across all classes,
     *  with what each one has (slides/notes/audio/flashcards). Powers the dashboard's
     *  "Recent lectures" replay strip. MUST be registered before /lectures/:lectureId
     *  or Express captures 'recent' as a lectureId. */
    router.get('/lectures/recent', async (req, res) => {
        try {
            const limit = Math.min(parseInt(String(req.query.limit || '8'), 10) || 8, 25);
            // Scope to the student's accessible classes — never leak other classes' lectures.
            const student = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const accessible = await (0, education_access_1.listAccessibleClassIds)(ctx.pool, student);
            if (accessible.length === 0) {
                res.json({ lectures: [] });
                return;
            }
            const result = await ctx.pool.query(`SELECT l.lecture_id, l.class_id, l.created_at, l.lecture_date, l.flashcard_set_id,
                (l.slides_path IS NOT NULL) AS has_slides,
                (l.notes_path IS NOT NULL) AS has_notes,
                (l.audio_path IS NOT NULL) AS has_audio,
                c.name AS class_name, c.subject
         FROM lm_lectures l
         LEFT JOIN lm_classes c ON c.class_id = l.class_id
         WHERE l.status = 'complete' AND l.class_id = ANY($2)
         ORDER BY l.created_at DESC
         LIMIT $1`, [limit, accessible]);
            res.json({ lectures: result.rows });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to list recent lectures');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/education/lectures/:lectureId — check lecture processing status */
    router.get('/lectures/:lectureId', async (req, res) => {
        try {
            const result = await ctx.pool.query(`SELECT l.*, c.name as class_name, c.subject
         FROM lm_lectures l JOIN lm_classes c ON l.class_id = c.class_id
         WHERE l.lecture_id = $1`, [req.params.lectureId]);
            if (result.rows.length === 0) {
                res.status(404).json({ error: 'Lecture not found' });
                return;
            }
            const lecture = result.rows[0];
            // Read generated files if they exist
            const data = { ...lecture };
            if (lecture.transcript_path && fs.existsSync(lecture.transcript_path)) {
                data.transcript = fs.readFileSync(lecture.transcript_path, 'utf-8');
            }
            if (lecture.notes_path && fs.existsSync(lecture.notes_path)) {
                data.notes = fs.readFileSync(lecture.notes_path, 'utf-8');
            }
            res.json(data);
        }
        catch (err) {
            logger.error({ err }, 'Failed to get lecture');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/education/lectures/:lectureId/slides — the lecture's generated slide deck
     *  (written by /process-transcript). Powers the lightweight presentation player. */
    router.get('/lectures/:lectureId/slides', async (req, res) => {
        try {
            const result = await ctx.pool.query(`SELECT l.slides_path, l.lecture_date, l.class_id, c.name AS class_name
         FROM lm_lectures l LEFT JOIN lm_classes c ON l.class_id = c.class_id
         WHERE l.lecture_id = $1`, [req.params.lectureId]);
            const row = result.rows[0];
            if (!row) {
                res.status(404).json({ error: 'Lecture not found' });
                return;
            }
            if (!row.slides_path || !fs.existsSync(row.slides_path)) {
                res.status(404).json({ error: 'No slides were generated for this lecture' });
                return;
            }
            const deck = JSON.parse(fs.readFileSync(row.slides_path, 'utf-8'));
            res.json({ lectureId: req.params.lectureId, classId: row.class_id, className: row.class_name, lectureDate: row.lecture_date, ...deck });
        }
        catch (err) {
            logger.error({ err, lectureId: req.params.lectureId }, 'Failed to load lecture slides');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/education/lectures/:lectureId/pptx — render the lecture's deck to a real
     *  PowerPoint via the presentation generator and save it to the student's configured Files
     *  store (ADR-041/043). Returns the download URL. Re-renders from the persisted slides each
     *  call, so it also works for lectures processed before auto-emit existed. */
    router.post('/lectures/:lectureId/pptx', async (req, res) => {
        const sub = req.oidc?.user?.sub;
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const result = await ctx.pool.query(`SELECT l.slides_path, c.name AS class_name
         FROM lm_lectures l LEFT JOIN lm_classes c ON l.class_id = c.class_id
         WHERE l.lecture_id = $1`, [req.params.lectureId]);
            const row = result.rows[0];
            if (!row) {
                res.status(404).json({ error: 'Lecture not found' });
                return;
            }
            if (!row.slides_path || !fs.existsSync(row.slides_path)) {
                res.status(404).json({ error: 'No slides were generated for this lecture' });
                return;
            }
            const deck = JSON.parse(fs.readFileSync(row.slides_path, 'utf-8'));
            const title = deck.title || row.class_name || 'Lecture';
            const saved = await (0, education_pptx_1.renderAndSaveLectureDeck)(ctx, String(sub), title, deck.slides);
            res.json({ ok: true, ...saved });
        }
        catch (err) {
            logger.error({ err, lectureId: req.params.lectureId }, 'Lecture .pptx export failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /api/education/lectures/:lectureId/audio — attach the class recording to a
     *  processed lecture so a 30-minute session is never lost. The recorder uploads the
     *  assembled MediaRecorder blob after study materials generate; we persist it to the
     *  workspace and point lm_lectures.audio_path at it. */
    router.post('/lectures/:lectureId/audio', recordingUpload.single('audio'), async (req, res) => {
        try {
            const file = req.file;
            if (!file) {
                res.status(400).json({ error: 'audio file is required' });
                return;
            }
            const result = await ctx.pool.query('SELECT class_id FROM lm_lectures WHERE lecture_id = $1', [req.params.lectureId]);
            const row = result.rows[0];
            if (!row) {
                res.status(404).json({ error: 'Lecture not found' });
                return;
            }
            const ext = (file.mimetype.includes('ogg') ? 'ogg' : file.mimetype.includes('mp4') ? 'm4a' : file.mimetype.includes('wav') ? 'wav' : 'webm');
            const audioDir = path.resolve(process.cwd(), 'workspace-shared', 'education', row.class_id, 'lectures');
            if (!fs.existsSync(audioDir))
                fs.mkdirSync(audioDir, { recursive: true });
            const audioPath = path.join(audioDir, `lecture-${req.params.lectureId}.audio.${ext}`);
            fs.writeFileSync(audioPath, file.buffer);
            const durationSeconds = parseInt(String(req.body.durationSeconds || ''), 10);
            await ctx.pool.query('UPDATE lm_lectures SET audio_path = $1, duration_seconds = COALESCE($2, duration_seconds) WHERE lecture_id = $3', [audioPath, Number.isFinite(durationSeconds) ? durationSeconds : null, req.params.lectureId]);
            logger.info({ lectureId: req.params.lectureId, bytes: file.size, audioPath }, 'Lecture recording saved');
            res.status(201).json({ success: true, lectureId: req.params.lectureId, bytes: file.size });
        }
        catch (err) {
            logger.error({ err, lectureId: req.params.lectureId }, 'Failed to save lecture recording');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/education/lectures/:lectureId/audio — stream the saved class recording
     *  back for re-listening or download. */
    router.get('/lectures/:lectureId/audio', async (req, res) => {
        try {
            const result = await ctx.pool.query('SELECT audio_path FROM lm_lectures WHERE lecture_id = $1', [req.params.lectureId]);
            const row = result.rows[0];
            if (!row || !row.audio_path || !fs.existsSync(row.audio_path)) {
                res.status(404).json({ error: 'No recording saved for this lecture' });
                return;
            }
            res.sendFile(path.resolve(row.audio_path));
        }
        catch (err) {
            logger.error({ err, lectureId: req.params.lectureId }, 'Failed to stream lecture recording');
            res.status(500).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=education-lecture-routes.js.map