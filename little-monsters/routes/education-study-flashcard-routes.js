"use strict";
/**
 * Education Study Flashcard Routes — Little Monsters Platform API
 *
 * HTTP adapters for permission-bound flashcard CRUD. The store owns the final
 * SQL authorization so guessed identifiers never escape the caller's scope.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Add owner/class-scoped flashcard CRUD route adapters.
 * ---------------------------------------------------------------------------
 *
 * @module education-study-flashcard-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationStudyFlashcardRoutes = createEducationStudyFlashcardRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const education_study_errors_1 = require("./education-study-errors");
const education_study_store_1 = require("./education-study-store");
const logger = (0, logger_1.createChildLogger)({ module: 'education-study-flashcard-routes' });
function fail(res, error, operation) {
    if ((0, education_study_errors_1.sendStudyError)(res, error))
        return;
    logger.error({ err: error, operation }, 'Study flashcard operation failed');
    res.status(500).json({ error: `Could not ${operation}` });
}
async function listSets(req, res, ctx) {
    try {
        const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const classId = req.query.classId ? String(req.query.classId) : undefined;
        if (classId)
            await (0, education_access_1.assertClassAccess)(ctx.pool, actor, classId);
        const sets = await (0, education_study_store_1.listReadableSets)(ctx.pool, actor, classId);
        res.json({ sets });
    }
    catch (error) {
        fail(res, error, 'load flashcard sets');
    }
}
async function listCards(req, res, ctx) {
    try {
        const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const cards = await (0, education_study_store_1.listReadableCards)(ctx.pool, actor, req.params.setId);
        res.json({ cards });
    }
    catch (error) {
        fail(res, error, 'load the cards');
    }
}
async function editCard(req, res, ctx) {
    try {
        const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        await (0, education_study_store_1.updateStudyCard)(ctx.pool, actor, req.params.cardId, req.body?.front, req.body?.back);
        res.json({ ok: true });
    }
    catch (error) {
        fail(res, error, 'edit the card');
    }
}
async function removeCard(req, res, ctx) {
    try {
        const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        await (0, education_study_store_1.deleteStudyCard)(ctx.pool, actor, req.params.cardId);
        res.json({ ok: true });
    }
    catch (error) {
        fail(res, error, 'delete the card');
    }
}
async function addCard(req, res, ctx) {
    try {
        const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const cardId = await (0, education_study_store_1.addStudyCard)(ctx.pool, actor, req.params.setId, req.body || {});
        res.status(201).json({ ok: true, cardId });
    }
    catch (error) {
        fail(res, error, 'add the card');
    }
}
async function removeSet(req, res, ctx) {
    try {
        const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        await (0, education_study_store_1.deleteStudySet)(ctx.pool, actor, req.params.setId);
        res.json({ ok: true });
    }
    catch (error) {
        fail(res, error, 'delete the set');
    }
}
async function createSet(req, res, ctx) {
    try {
        const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const created = await (0, education_study_store_1.createStudySet)(ctx.pool, actor, {
            classId: req.body?.classId,
            title: req.body?.title,
            topic: req.body?.topic,
            sourceType: req.body?.sourceType,
            sourceReference: req.body?.sourceReference,
            cards: req.body?.cards,
        });
        logger.info(created, 'Flashcard set created');
        res.status(201).json(created);
    }
    catch (error) {
        fail(res, error, 'create the flashcard set');
    }
}
/** Register flashcard set/card CRUD endpoints. */
function createEducationStudyFlashcardRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/flashcards/sets', (req, res) => listSets(req, res, ctx));
    router.get('/flashcards/sets/:setId/cards', (req, res) => listCards(req, res, ctx));
    router.patch('/flashcards/cards/:cardId', (req, res) => editCard(req, res, ctx));
    router.delete('/flashcards/cards/:cardId', (req, res) => removeCard(req, res, ctx));
    router.post('/flashcards/sets/:setId/cards', (req, res) => addCard(req, res, ctx));
    router.delete('/flashcards/sets/:setId', (req, res) => removeSet(req, res, ctx));
    router.post('/flashcards/sets', (req, res) => createSet(req, res, ctx));
    return router;
}
//# sourceMappingURL=education-study-flashcard-routes.js.map