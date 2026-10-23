"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBookChapter = readBookChapter;
exports.createEducationBookRoutes = createEducationBookRoutes;
/**
 * Little Monsters class books: the books a student can read and one chapter of a book.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | GET /my-books lists the books (class materials) the caller may read across their classes, with each book's class; GET /materials/:materialId/chapters/:chapter answers one chapter's heading and text (education-book-chapters), or not found with the chapters the book does have. Reading follows the material file rule: the uploader always, anyone else only an approved share in a class they belong to. readBookChapter is also the source of chapter flashcards and quizzes, so Jarvis can answer "flashcards and a lesson summary from chapter 2 of my math book" and ask which book when there are two.
 * -----------------------------------------------------------------------------
 *
 * @module education-book-routes
 */
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const education_material_storage_1 = require("./education-material-storage");
const education_book_chapters_1 = require("./education-book-chapters");
const logger = (0, logger_1.createChildLogger)({ module: 'education-book-routes' });
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
/** Extracted book texts kept in memory, so a request for flashcards after a chapter does not parse the book twice. */
const TEXT_CACHE_ENTRIES = 4;
const textCache = new Map();
/** A book's display title: its title, else its file name. */
function bookTitle(row) {
    return String(row.title || row.original_name || 'Untitled book');
}
/** Load one material the caller may read: the uploader always, anyone else an approved share in a class they belong to. */
async function loadReadableBook(pool, caller, materialId) {
    if (!UUID_PATTERN.test(materialId))
        throw new education_access_1.EducationAccessError('materialId must be a UUID', 400);
    const result = await pool.query(`SELECT m.material_id, m.class_id, m.uploaded_by, m.original_name, m.stored_path, m.mime_type,
            m.size_bytes, m.title, m.share_status, c.name AS class_name
       FROM lm_materials m JOIN lm_classes c ON c.class_id = m.class_id
      WHERE m.material_id = $1 AND c.tenant_id = $2`, [materialId, caller.tenantId]);
    const row = result.rows[0];
    if (!row)
        throw new education_access_1.EducationAccessError('Material not found', 404);
    if (row.uploaded_by !== caller.studentId) {
        if (row.share_status !== 'approved')
            throw new education_access_1.EducationAccessError('This material is private', 403);
        await (0, education_access_1.assertClassAccess)(pool, caller, row.class_id);
    }
    return row;
}
/** A book's extracted text, cached by material and size. */
async function bookText(row, pool) {
    const key = `${row.material_id}:${row.size_bytes}`;
    const cached = textCache.get(key);
    if (cached !== undefined)
        return cached;
    const text = await (0, education_material_storage_1.extractStoredMaterialText)(row, pool);
    textCache.set(key, text);
    while (textCache.size > TEXT_CACHE_ENTRIES)
        textCache.delete(textCache.keys().next().value);
    return text;
}
/**
 * @description Chapter `chapter` of a book the caller may read.
 * @param {AppContext} ctx The package context (its pool).
 * @param {AuthedStudent} caller The authenticated student, teacher or admin.
 * @param {string} materialId The book's material id.
 * @param {number} chapter The chapter number.
 * @returns {Promise<BookChapter>} The chapter, or not found with the book's chapter headings.
 */
async function readBookChapter(ctx, caller, materialId, chapter) {
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > 99)
        throw new education_access_1.EducationAccessError('chapter must be a number from 1 to 99', 400);
    const row = await loadReadableBook(ctx.pool, caller, materialId);
    const slice = (0, education_book_chapters_1.findChapter)(await bookText(row, ctx.pool), chapter);
    return { ...slice, materialId: row.material_id, title: bookTitle(row), classId: row.class_id, className: row.class_name };
}
/** Send an expected access error; false when the error is unexpected. */
function sendAccessError(res, err) {
    if (!(err instanceof education_access_1.EducationAccessError))
        return false;
    res.status(err.status).json({ error: err.message });
    return true;
}
/** GET /my-books: every book the caller may read in their classes, grouped by class. */
async function listMyBooks(ctx, req, res) {
    try {
        const caller = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool, { readOnly: true });
        const result = await ctx.pool.query(`SELECT m.material_id, m.title, m.original_name, m.kind, m.class_id, c.name AS class_name, c.subject,
              (m.uploaded_by = $1) AS mine
         FROM lm_materials m JOIN lm_classes c ON c.class_id = m.class_id
        WHERE c.tenant_id = $2 AND c.status = 'active'
          AND (m.uploaded_by = $1 OR (m.share_status = 'approved'
            AND ($3::boolean OR ($4::boolean AND c.teacher_student_id = $1)
              OR EXISTS (SELECT 1 FROM lm_enrollments e WHERE e.student_id = $1 AND e.class_id = c.class_id))))
        ORDER BY c.name, m.created_at DESC
        LIMIT 100`, [caller.studentId, caller.tenantId, caller.role === 'admin', caller.role === 'teacher']);
        const books = result.rows.map((row) => ({
            materialId: row.material_id, title: bookTitle(row), kind: row.kind, classId: row.class_id,
            className: row.class_name, subject: row.subject, mine: Boolean(row.mine),
        }));
        logger.info({ studentId: caller.studentId, count: books.length }, 'Listed class books');
        res.json({ books });
    }
    catch (err) {
        if (sendAccessError(res, err))
            return;
        logger.error({ err }, 'Failed to list class books');
        res.status(500).json({ error: 'Failed to list books' });
    }
}
/** GET /materials/:materialId/chapters/:chapter: one chapter's heading and text. */
async function readChapter(ctx, req, res) {
    try {
        const caller = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool, { readOnly: true });
        const chapter = await readBookChapter(ctx, caller, String(req.params.materialId), Number(req.params.chapter));
        logger.info({ materialId: chapter.materialId, chapter: chapter.number, found: chapter.found }, 'Read book chapter');
        res.json(chapter);
    }
    catch (err) {
        if (sendAccessError(res, err))
            return;
        logger.error({ err, materialId: req.params.materialId }, 'Failed to read book chapter');
        res.status(500).json({ error: 'Failed to read the chapter' });
    }
}
/**
 * @description Book routes: the caller's books and one chapter of a book.
 * @param {AppContext} ctx The package context.
 * @returns {Router} The router.
 */
function createEducationBookRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/my-books', (req, res) => listMyBooks(ctx, req, res));
    router.get('/materials/:materialId/chapters/:chapter', (req, res) => readChapter(ctx, req, res));
    return router;
}
