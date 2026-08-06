"use strict";
/**
 * Assignment routes for Little Monsters.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Extracted assignment reads and teacher-authorized writes from the route aggregator
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Rebind assignment reads and writes to the actor's current tenant, role, enrollment, and class ownership in their final SQL statements
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Replace wildcard assignment reads with the reviewed client response fields
 * ---------------------------------------------------------------------------
 *
 * @module education-assignment-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationAssignmentRoutes = createEducationAssignmentRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const logger = (0, logger_1.createChildLogger)({ module: 'education-assignment-routes' });
function sendAccessError(res, err) {
    if (!(err instanceof education_access_1.EducationAccessError))
        return false;
    res.status(err.status).json({ error: err.message });
    return true;
}
function errorMessage(err) {
    return err instanceof Error ? err.message : 'Unexpected assignment error';
}
async function listAssignments(ctx, req, res) {
    try {
        const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const params = [actor.studentId];
        let sql = `SELECT a.assignment_id, a.class_id, a.title, a.description,
        a.assignment_type, a.due_date, a.source_lecture_date, a.resources,
        a.status, a.created_at, c.name as class_name
      FROM lm_assignments a
      JOIN lm_classes c ON a.class_id = c.class_id
      JOIN lm_students viewer ON viewer.student_id = $1 AND viewer.tenant_id = c.tenant_id
      WHERE (viewer.role = 'admin'
        OR (viewer.role = 'teacher' AND c.teacher_student_id = viewer.student_id)
        OR EXISTS (
        SELECT 1 FROM lm_enrollments membership
         WHERE membership.class_id = c.class_id
           AND membership.student_id = viewer.student_id
           AND membership.tenant_id = c.tenant_id
      ))`;
        if (req.query.classId) {
            const classId = String(req.query.classId);
            await (0, education_access_1.assertClassAccess)(ctx.pool, actor, classId);
            params.push(classId);
            sql += ` AND a.class_id = $${params.length}`;
        }
        if (req.query.status) {
            params.push(req.query.status);
            sql += ` AND a.status = $${params.length}`;
        }
        const result = await ctx.pool.query(`${sql} ORDER BY a.due_date ASC NULLS LAST`, params);
        res.json({ assignments: result.rows });
    }
    catch (err) {
        if (sendAccessError(res, err))
            return;
        logger.error({ err }, 'Failed to list assignments');
        res.status(500).json({ error: errorMessage(err) });
    }
}
async function createAssignment(ctx, req, res) {
    try {
        const { classId, title, description, assignmentType, dueDate, resources } = req.body;
        if (!classId || !title) {
            res.status(400).json({ error: 'classId and title are required' });
            return;
        }
        const teacher = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        await (0, education_access_1.assertTeacherOfClass)(ctx.pool, teacher, String(classId));
        const result = await ctx.pool.query(`INSERT INTO lm_assignments
         (class_id, title, description, assignment_type, due_date, resources)
       SELECT c.class_id, $2, $3, $4, $5, $6
         FROM lm_classes c
         JOIN lm_students a ON a.student_id = $7 AND a.tenant_id = c.tenant_id
        WHERE c.class_id = $1
          AND (a.role = 'admin' OR (a.role = 'teacher' AND c.teacher_student_id = a.student_id))
       RETURNING assignment_id`, [classId, title, description || '', assignmentType || 'homework', dueDate || null,
            JSON.stringify(resources || []), teacher.studentId]);
        if (result.rows.length === 0) {
            throw new education_access_1.EducationAccessError('You do not teach this class', 403);
        }
        res.status(201).json({ assignmentId: result.rows[0].assignment_id });
    }
    catch (err) {
        if (sendAccessError(res, err))
            return;
        logger.error({ err }, 'Failed to create assignment');
        res.status(500).json({ error: errorMessage(err) });
    }
}
/** Create assignment routes scoped to the authenticated user's accessible classes. */
function createEducationAssignmentRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/assignments', (req, res) => listAssignments(ctx, req, res));
    router.post('/assignments', (req, res) => createAssignment(ctx, req, res));
    return router;
}
//# sourceMappingURL=education-assignment-routes.js.map