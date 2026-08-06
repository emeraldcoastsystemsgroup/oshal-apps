"use strict";
/**
 * Education Catalog Routes — Little Monsters "Class Bank"
 *
 * The class bank is the school-wide catalog of PUBLISHED classes (teachers
 * provide them; published = true). Any signed-in member can browse the bank and
 * self-enroll into a published class — it then appears on their dashboard and
 * ribbon (the ribbon is enrollment-scoped, so joining is what makes it show).
 *
 * Private classes (a student's own homeroom, published = false) never appear in
 * the bank and can't be self-enrolled into by others — only the owner is in them
 * until they explicitly share by email (see /classes/:id/students in
 * education-routes). This keeps "teacher-published, student self-selects" and
 * "my own private class" as two distinct, non-leaking surfaces.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1 | roger.murphy@agenticfederal.us   | Initial class bank: GET /catalog (published classes + per-caller enrolled flag), POST /classes/:id/enroll (self-enroll into a published class), POST /classes/:id/leave (self-unenroll; owner can't leave)
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Tenant-bound self-enroll and leave lookups so a class id from another school cannot create cross-tenant enrollment state; extracted handlers to keep each authorization decision independently reviewable
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Make enrollment and leave writes derive their target from the actor's current tenant and the class's current publication, status, and ownership state.
 * ---------------------------------------------------------------------------
 *
 * @module education-catalog-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationCatalogRoutes = createEducationCatalogRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const logger = (0, logger_1.createChildLogger)({ module: 'education-catalog-routes' });
/** Map an EducationAccessError to its HTTP status; returns true if handled. */
function sendAccessError(res, err) {
    if (err instanceof education_access_1.EducationAccessError) {
        res.status(err.status).json({ error: err.message });
        return true;
    }
    return false;
}
/** Load a class only through the actor's current tenant row. */
async function loadCatalogClass(ctx, actorId, classId) {
    const result = await ctx.pool.query(`SELECT c.published, c.status, c.teacher_student_id
       FROM lm_classes c
       JOIN lm_students a ON a.student_id = $1 AND a.tenant_id = c.tenant_id
      WHERE c.class_id = $2`, [actorId, classId]);
    return result.rows[0] || null;
}
/** Preserve the public enrollment errors before the final atomic write guard. */
function assertSelfEnrollmentOpen(row, actorId) {
    if (!row.published && row.teacher_student_id !== actorId) {
        throw new education_access_1.EducationAccessError("this class isn't open for self-enrollment", 403);
    }
    if (row.status !== 'active') {
        throw new education_access_1.EducationAccessError('this class is not currently active', 400);
    }
}
/** Serve the published class bank scoped to the caller's tenant. */
async function loadCatalog(ctx, req, res) {
    try {
        const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const result = await ctx.pool.query(`SELECT c.class_id, c.name, c.subject, c.grade_level, c.teacher_name,
         (SELECT COUNT(*) FROM lm_enrollments e WHERE e.class_id = c.class_id) AS student_count,
         EXISTS(SELECT 1 FROM lm_enrollments e WHERE e.class_id = c.class_id AND e.student_id = $1) AS enrolled
       FROM lm_classes c
       WHERE c.published = true AND c.status = 'active' AND c.tenant_id = $2
       ORDER BY c.subject, c.name`, [actor.studentId, actor.tenantId]);
        res.json({ classes: result.rows });
    }
    catch (err) {
        if (sendAccessError(res, err))
            return;
        logger.error({ err }, 'Failed to load class catalog');
        res.status(500).json({ error: err.message });
    }
}
/** Self-enroll the caller only when a same-tenant class is active and open. */
async function enrollInClass(ctx, req, res) {
    try {
        const classId = String(req.params.classId);
        const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const row = await loadCatalogClass(ctx, actor.studentId, classId);
        if (!row) {
            res.status(404).json({ error: 'class not found' });
            return;
        }
        assertSelfEnrollmentOpen(row, actor.studentId);
        const result = await ctx.pool.query(`WITH eligible AS MATERIALIZED (
         SELECT a.student_id, c.class_id
           FROM lm_students a
           JOIN lm_classes c ON c.class_id = $2 AND c.tenant_id = a.tenant_id
          WHERE a.student_id = $1 AND c.status = 'active'
            AND (c.published = true OR c.teacher_student_id = a.student_id)
       ), inserted AS (
         INSERT INTO lm_enrollments (student_id, class_id)
         SELECT student_id, class_id FROM eligible
         ON CONFLICT (student_id, class_id) DO NOTHING
         RETURNING 1
       )
       SELECT EXISTS (SELECT 1 FROM eligible) AS eligible,
              (EXISTS (SELECT 1 FROM inserted) OR EXISTS (
                SELECT 1 FROM lm_enrollments e JOIN eligible x
                  ON x.student_id = e.student_id AND x.class_id = e.class_id
              )) AS enrolled`, [actor.studentId, classId]);
        if (!result.rows[0]?.eligible || !result.rows[0]?.enrolled) {
            throw new education_access_1.EducationAccessError('class enrollment changed; reload and retry', 409);
        }
        logger.info({ classId, studentId: actor.studentId }, 'Student self-enrolled from class bank');
        res.status(201).json({ success: true, classId, enrolled: true });
    }
    catch (err) {
        if (sendAccessError(res, err))
            return;
        logger.error({ err, classId: req.params.classId }, 'Failed to self-enroll');
        res.status(500).json({ error: err.message });
    }
}
/** Remove only the caller's same-tenant enrollment while retaining private progress. */
async function leaveClass(ctx, req, res) {
    try {
        const classId = String(req.params.classId);
        const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const row = await loadCatalogClass(ctx, actor.studentId, classId);
        if (!row) {
            res.status(404).json({ error: 'class not found' });
            return;
        }
        if (row.teacher_student_id === actor.studentId) {
            res.status(400).json({ error: "you own this class — archive or delete it instead of leaving" });
            return;
        }
        // Leaving remains available after archival or unpublishing; those flags gate
        // entry, not a student's ability to remove their existing membership.
        const result = await ctx.pool.query(`WITH leavable AS MATERIALIZED (
         SELECT a.student_id, c.class_id
           FROM lm_students a
           JOIN lm_classes c ON c.class_id = $2 AND c.tenant_id = a.tenant_id
          WHERE a.student_id = $1 AND c.teacher_student_id IS DISTINCT FROM a.student_id
       ), removed AS (
         DELETE FROM lm_enrollments e USING leavable x
          WHERE e.student_id = x.student_id AND e.class_id = x.class_id
         RETURNING 1
       )
       SELECT EXISTS (SELECT 1 FROM leavable) AS leavable,
              EXISTS (SELECT 1 FROM removed) AS removed`, [actor.studentId, classId]);
        if (!result.rows[0]?.leavable) {
            throw new education_access_1.EducationAccessError('class ownership changed; reload and retry', 409);
        }
        logger.info({ classId, studentId: actor.studentId }, 'Student left class');
        res.json({ success: true, classId, enrolled: false });
    }
    catch (err) {
        if (sendAccessError(res, err))
            return;
        logger.error({ err, classId: req.params.classId }, 'Failed to leave class');
        res.status(500).json({ error: err.message });
    }
}
/**
 * @description Class-bank sub-router mounted inside createEducationRoutes.
 * @param ctx - shared app context containing the database pool
 * @returns an Express router with catalog and self-enrollment endpoints
 */
function createEducationCatalogRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/catalog', (req, res) => loadCatalog(ctx, req, res));
    router.post('/classes/:classId/enroll', (req, res) => enrollInClass(ctx, req, res));
    router.post('/classes/:classId/leave', (req, res) => leaveClass(ctx, req, res));
    return router;
}
//# sourceMappingURL=education-catalog-routes.js.map