"use strict";
/**
 * Education Materials Routes — Little Monsters
 *
 * Uploading and listing class documents. Materials are PRIVATE to the student
 * who uploaded them ("save to my own space"): any enrolled member can attach a
 * textbook they got after the class started, a handout, or a phone photo of an
 * assignment — but only THEY can list or open it. Sharing a document with the
 * whole class is a teacher-only action and is intentionally not built yet
 * (kids set up their own classes solo first); see the follow-up note below.
 *
 * Grounding is private too: extracted text (PDF parse + OCR for photos) is
 * ingested into the student's own per-class collection
 * (privateMaterialsCollection), so the tutor grounds in a student's materials
 * without ever leaking them to classmates.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 2026-06-13 16:00:00 | roger.murphy@agenticfederal.us   | Initial materials API: POST /materials (+ /upload-material alias) any-filetype enrolled-gated upload with PDF/text RAG ingest; GET /classes/:id/materials (list); GET /materials/:id/file (stream). Moved here from education-routes to clear the 1000-line cap.
 * 2026-06-13 17:30:00 | roger.murphy@agenticfederal.us   | Isolation + OCR: materials are now PRIVATE to the uploader (list + view scoped to uploaded_by); text (PDF parse + tesseract OCR for images) ingests into the student's private per-class collection, not the shared class one. Dropped the class-shared ingest ticket. Teacher-share/approval flow deferred.
 * ---------------------------------------------------------------------------
 *
 * @module education-materials-routes
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
exports.createEducationMaterialsRoutes = createEducationMaterialsRoutes;
const express_1 = require("express");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const logger = (0, logger_1.createChildLogger)({ module: 'education-materials-routes' });
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/** Map an EducationAccessError to its HTTP status; returns true if handled. */
function sendAccessError(res, err) {
    if (err instanceof education_access_1.EducationAccessError) {
        res.status(err.status).json({ error: err.message });
        return true;
    }
    return false;
}
/**
 * @description Materials sub-router mounted inside createEducationRoutes.
 * @param ctx - shared app context (db pool)
 * @returns an Express router with the materials upload/list/view endpoints
 */
function createEducationMaterialsRoutes(ctx) {
    const router = (0, express_1.Router)();
    const multer = require('multer');
    // Any file type, up to 50MB — textbooks, handouts, photos of assignments.
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
    /** Shared handler for POST /materials and the legacy POST /upload-material. */
    const handleUpload = async (req, res) => {
        try {
            const classId = String(req.body?.classId || '');
            const file = req.file;
            if (!classId || !file) {
                res.status(400).json({ error: 'classId and file are required' });
                return;
            }
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertClassAccess)(ctx.pool, me, classId); // must be enrolled to attach to a class
            const kind = normalizeKind(req.body?.kind || req.body?.type, file.mimetype);
            const title = String(req.body?.title || file.originalname || kind);
            // Sharing intent: a teacher of the class shares directly (approved); a
            // student (or non-owning teacher) who asks to share creates a pending
            // request; otherwise the material stays private to the uploader.
            const wantShare = req.body?.share === true || String(req.body?.share || '') === 'true';
            const shareStatus = wantShare ? (await isTeacherOfClass(ctx.pool, me, classId) ? 'approved' : 'requested') : 'private';
            // Save under the student's OWN folder inside the class — private storage.
            const dir = path.resolve(process.cwd(), 'workspace-shared', 'education', classId, 'materials', me.studentId);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            const safeName = `${Date.now()}-${(file.originalname || kind).replace(/[^\w.\-]+/g, '_')}`;
            const storedPath = path.join(dir, safeName);
            fs.writeFileSync(storedPath, file.buffer);
            const inserted = (await ctx.pool.query(`INSERT INTO lm_materials (class_id, uploaded_by, original_name, stored_path, mime_type, size_bytes, kind, title, shared, share_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING material_id, original_name, mime_type, size_bytes, kind, title, shared, share_status, created_at`, [classId, me.studentId, file.originalname || safeName, storedPath, file.mimetype || 'application/octet-stream', file.size || 0, kind, title, shareStatus === 'approved', shareStatus])).rows[0];
            logger.info({ classId, materialId: inserted.material_id, kind, shareStatus, by: me.studentId }, 'Material uploaded');
            // Extract text once (PDF parse / OCR for images / plain text); ground the
            // uploader's PRIVATE collection always, and the SHARED class collection if
            // a teacher shared it directly (approved).
            const text = await extractText(file).catch(() => '');
            const ingest = text ? await ingestInto(text, (0, education_access_1.privateMaterialsCollection)(classId, me.studentId), { classId, studentId: me.studentId, source: file.originalname }) : null;
            if (text && shareStatus === 'approved') {
                await ingestInto(text, (0, education_access_1.sharedMaterialsCollection)(classId), { classId, source: file.originalname });
            }
            res.status(201).json({ success: true, material: inserted, ingest, grounded: !!ingest, shareStatus });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Material upload failed');
            res.status(500).json({ error: err.message });
        }
    };
    router.post('/materials', upload.single('file'), handleUpload);
    router.post('/upload-material', upload.single('file'), handleUpload); // legacy alias
    /** GET /api/education/classes/:classId/materials — the caller's OWN materials
     *  for the class (private). Other students' uploads are never listed here. */
    router.get('/classes/:classId/materials', async (req, res) => {
        try {
            const classId = String(req.params.classId);
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertClassAccess)(ctx.pool, me, classId);
            const rows = (await ctx.pool.query(`SELECT material_id, original_name, mime_type, size_bytes, kind, title, shared, share_status, created_at
         FROM lm_materials WHERE class_id = $1 AND uploaded_by = $2 ORDER BY created_at DESC`, [classId, me.studentId])).rows;
            res.json({ materials: rows });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to list materials');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/education/classes/:classId/shared-materials — materials shared with
     *  the whole class (approved). Visible to every enrolled member. */
    router.get('/classes/:classId/shared-materials', async (req, res) => {
        try {
            const classId = String(req.params.classId);
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertClassAccess)(ctx.pool, me, classId);
            const rows = (await ctx.pool.query(`SELECT m.material_id, m.original_name, m.mime_type, m.size_bytes, m.kind, m.title, m.created_at,
                s.name AS shared_by_name
         FROM lm_materials m LEFT JOIN lm_students s ON s.student_id = m.uploaded_by
         WHERE m.class_id = $1 AND m.share_status = 'approved' ORDER BY m.created_at DESC`, [classId])).rows;
            res.json({ materials: rows });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to list shared materials');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/education/classes/:classId/share-requests — pending share requests
     *  for the teacher of this class to approve or deny. Teacher-of-class only. */
    router.get('/classes/:classId/share-requests', async (req, res) => {
        try {
            const classId = String(req.params.classId);
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertTeacherOfClass)(ctx.pool, me, classId);
            const rows = (await ctx.pool.query(`SELECT m.material_id, m.original_name, m.kind, m.title, m.created_at, s.name AS requested_by_name
         FROM lm_materials m LEFT JOIN lm_students s ON s.student_id = m.uploaded_by
         WHERE m.class_id = $1 AND m.share_status = 'requested' ORDER BY m.created_at`, [classId])).rows;
            res.json({ requests: rows });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to list share requests');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/education/materials/:materialId/share-request — the uploader asks a
     *  teacher to share their private material with the class. */
    router.post('/materials/:materialId/share-request', async (req, res) => {
        try {
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const row = await loadMaterial(ctx.pool, String(req.params.materialId));
            if (!row) {
                res.status(404).json({ error: 'material not found' });
                return;
            }
            if (row.uploaded_by !== me.studentId) {
                throw new education_access_1.EducationAccessError('only the uploader can request to share this', 403);
            }
            // A teacher-owner sharing their own material is auto-approved.
            const teacher = await isTeacherOfClass(ctx.pool, me, row.class_id);
            const next = teacher ? 'approved' : 'requested';
            await ctx.pool.query('UPDATE lm_materials SET share_status = $2, shared = $3 WHERE material_id = $1', [row.material_id, next, teacher]);
            if (teacher)
                await reingestShared(ctx.pool, row);
            res.json({ success: true, share_status: next });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Share request failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/education/materials/:materialId/approve — teacher approves a share. */
    router.post('/materials/:materialId/approve', (req, res) => decideShare(ctx, req, res, true));
    /** POST /api/education/materials/:materialId/deny — teacher denies a share. */
    router.post('/materials/:materialId/deny', (req, res) => decideShare(ctx, req, res, false));
    /** GET /api/education/materials/:materialId/file — stream a material. The uploader
     *  can always open it; an approved-shared material opens for any enrolled member. */
    router.get('/materials/:materialId/file', async (req, res) => {
        try {
            const materialId = String(req.params.materialId);
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const row = (await ctx.pool.query('SELECT class_id, uploaded_by, original_name, stored_path, mime_type, share_status FROM lm_materials WHERE material_id = $1', [materialId])).rows[0];
            if (!row) {
                res.status(404).json({ error: 'material not found' });
                return;
            }
            const isOwner = row.uploaded_by === me.studentId;
            if (!isOwner) {
                if (row.share_status !== 'approved') {
                    throw new education_access_1.EducationAccessError('this document is private to the person who uploaded it', 403);
                }
                await (0, education_access_1.assertClassAccess)(ctx.pool, me, row.class_id); // shared → any enrolled member
            }
            if (!fs.existsSync(row.stored_path)) {
                res.status(404).json({ error: 'file is no longer available' });
                return;
            }
            res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
            res.setHeader('Content-Disposition', `inline; filename="${(row.original_name || 'material').replace(/"/g, '')}"`);
            fs.createReadStream(row.stored_path).pipe(res);
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to stream material');
            res.status(500).json({ error: err.message });
        }
    });
    /** DELETE /api/education/materials/:materialId — the uploader removes their
     *  material (file + row). Best-effort; shared copies stop being served too. */
    router.delete('/materials/:materialId', async (req, res) => {
        try {
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const row = await loadMaterial(ctx.pool, String(req.params.materialId));
            if (!row) {
                res.status(404).json({ error: 'material not found' });
                return;
            }
            const isOwner = row.uploaded_by === me.studentId;
            const teacher = await isTeacherOfClass(ctx.pool, me, row.class_id);
            if (!isOwner && !teacher) {
                throw new education_access_1.EducationAccessError('only the uploader or the class teacher can delete this', 403);
            }
            try {
                if (row.stored_path && fs.existsSync(row.stored_path))
                    fs.unlinkSync(row.stored_path);
            }
            catch { /* ignore */ }
            await ctx.pool.query('DELETE FROM lm_materials WHERE material_id = $1', [row.material_id]);
            logger.info({ materialId: row.material_id, by: me.studentId }, 'Material deleted');
            res.json({ success: true });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to delete material');
            res.status(500).json({ error: err.message });
        }
    });
    return router;
}
/** Classify an upload into a material kind from an explicit hint or its mimetype. */
function normalizeKind(hint, mimetype) {
    const h = String(hint || '').toLowerCase();
    if (h === 'textbook' || h === 'syllabus' || h === 'handout' || h === 'assignment')
        return h;
    if (typeof mimetype === 'string' && mimetype.startsWith('image/'))
        return 'image';
    return 'document';
}
/** Extract text from an upload: PDF parse, tesseract OCR for images, raw for text. */
async function extractText(file) {
    const mt = String(file.mimetype || '');
    if (mt === 'application/pdf')
        return parsePdf(file.buffer);
    if (mt.startsWith('image/'))
        return ocrImage(file.buffer);
    if (mt.startsWith('text/') || mt === 'application/json')
        return file.buffer.toString('utf8').slice(0, 500000);
    return '';
}
/** PDF text extraction: embedded text first, OCR fallback for scanned PDFs. */
async function parsePdf(buffer) {
    let text = '';
    try {
        const pdfParse = require('pdf-parse');
        text = String((await pdfParse(buffer)).text || '').trim();
    }
    catch (err) {
        logger.warn({ err }, 'PDF parse failed');
    }
    if (text)
        return text;
    // No embedded text → likely a scan/photo PDF: render pages to images and OCR.
    return ocrPdf(buffer);
}
/** OCR a scanned PDF by rendering its first pages to PNG (poppler pdftoppm) and
 *  running tesseract on each. Bounded to 10 pages to keep uploads responsive. */
async function ocrPdf(buffer) {
    const base = path.join(os.tmpdir(), `lm-pdf-${Date.now()}-${process.pid}`);
    const pdfPath = `${base}.pdf`;
    try {
        fs.writeFileSync(pdfPath, buffer);
        await execFileAsync('pdftoppm', ['-png', '-r', '150', '-l', '10', pdfPath, base]);
        const dir = path.dirname(base);
        const prefix = path.basename(base);
        const pages = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.png')).sort();
        let out = '';
        for (const p of pages) {
            const full = path.join(dir, p);
            try {
                const { stdout } = await execFileAsync('tesseract', [full, 'stdout', '-l', 'eng'], { maxBuffer: 10 * 1024 * 1024 });
                out += `${String(stdout || '')}\n`;
            }
            catch { /* skip a page that won't OCR */ }
            try {
                fs.unlinkSync(full);
            }
            catch { /* ignore */ }
        }
        return out.trim();
    }
    catch (err) {
        logger.warn({ err }, 'Scanned-PDF OCR failed — PDF stored but not grounded');
        return '';
    }
    finally {
        try {
            fs.unlinkSync(pdfPath);
        }
        catch { /* ignore */ }
    }
}
/** OCR an image with the bundled tesseract binary (no LLM, runs in the controller). */
async function ocrImage(buffer) {
    const tmp = path.join(os.tmpdir(), `lm-ocr-${Date.now()}-${process.pid}`);
    try {
        fs.writeFileSync(tmp, buffer);
        const { stdout } = await execFileAsync('tesseract', [tmp, 'stdout', '-l', 'eng'], { maxBuffer: 10 * 1024 * 1024 });
        return String(stdout || '').trim();
    }
    catch (err) {
        logger.warn({ err }, 'OCR failed (tesseract) — image stored but not text-grounded');
        return '';
    }
    finally {
        try {
            fs.unlinkSync(tmp);
        }
        catch { /* ignore */ }
    }
}
/** Ingest already-extracted text into a named RAG collection (private or shared). */
async function ingestInto(text, collection, meta) {
    if (!text)
        return null;
    try {
        const { RagService } = require('@/features/rag');
        const r = await new RagService().ingest([text], collection, meta);
        logger.info({ collection: r.collection, chunkCount: r.chunkCount }, 'Ingested material text into RAG collection');
        return { collection: r.collection, chunkCount: r.chunkCount };
    }
    catch (err) {
        logger.warn({ err, collection }, 'Ingest failed — material stored but not grounded');
        return null;
    }
}
/** Non-throwing check: is the caller the teacher of (or an admin over) this class? */
async function isTeacherOfClass(pool, student, classId) {
    try {
        await (0, education_access_1.assertTeacherOfClass)(pool, student, classId);
        return true;
    }
    catch {
        return false;
    }
}
/** Load a material row by id (or null). */
async function loadMaterial(pool, materialId) {
    return (await pool.query('SELECT * FROM lm_materials WHERE material_id = $1', [String(materialId)])).rows[0] || null;
}
/** Re-extract a stored material's text and ingest it into the class SHARED
 *  collection — called when a material becomes approved-shared. */
async function reingestShared(pool, row) {
    try {
        if (!row.stored_path || !fs.existsSync(row.stored_path))
            return;
        const fileLike = { mimetype: row.mime_type, buffer: fs.readFileSync(row.stored_path), originalname: row.original_name };
        const text = await extractText(fileLike).catch(() => '');
        if (text)
            await ingestInto(text, (0, education_access_1.sharedMaterialsCollection)(row.class_id), { classId: row.class_id, source: row.original_name, shared: true });
    }
    catch (err) {
        logger.warn({ err, materialId: row.material_id }, 'Shared re-ingest failed (material still shared, just not grounded)');
    }
}
/** Approve or deny a pending share — teacher-of-class only. */
async function decideShare(ctx, req, res, approve) {
    try {
        const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const row = await loadMaterial(ctx.pool, String(req.params.materialId));
        if (!row) {
            res.status(404).json({ error: 'material not found' });
            return;
        }
        await (0, education_access_1.assertTeacherOfClass)(ctx.pool, me, row.class_id);
        const status = approve ? 'approved' : 'denied';
        await ctx.pool.query('UPDATE lm_materials SET share_status = $2, shared = $3 WHERE material_id = $1', [row.material_id, status, approve]);
        if (approve)
            await reingestShared(ctx.pool, row);
        logger.info({ materialId: row.material_id, status, by: me.studentId }, 'Share decision');
        res.json({ success: true, share_status: status });
    }
    catch (err) {
        if (err instanceof education_access_1.EducationAccessError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        logger.error({ err }, 'Share decision failed');
        res.status(500).json({ error: err.message });
    }
}
//# sourceMappingURL=education-materials-routes.js.map