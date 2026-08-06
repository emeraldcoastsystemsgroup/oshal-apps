"use strict";
/**
 * Tenant-bound class metadata routes retained by the calendar package surface.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Extracted class metadata routes and added final tenant/owner predicates
 * ---------------------------------------------------------------------------
 *
 * @module education-class-info-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationClassInfoRoutes = createEducationClassInfoRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const tool_routes_1 = require("@/app/routes/tool-routes");
const education_access_1 = require("./education-access");
const education_calendar_support_1 = require("./education-calendar-support");
const logger = (0, logger_1.createChildLogger)({ module: 'education-class-info-routes' });
/** Build only metadata keys the caller actually supplied, preserving the rest. */
function editableMetadata(input) {
    const metadata = {};
    for (const key of ['website', 'schedule', 'room']) {
        if (Object.prototype.hasOwnProperty.call(input, key))
            metadata[key] = String(input[key] ?? '');
    }
    return metadata;
}
/** Keep the dynamic ribbon registration aligned with the persisted status. */
async function syncClassTool(ctx, classId, status) {
    if (!status)
        return;
    const stableId = classId.substring(0, 8);
    const iconName = `lm-class-${stableId}`;
    if (status === 'archived') {
        (0, tool_routes_1.deregisterDynamicToolUI)(iconName);
        return;
    }
    const result = await ctx.pool.query('SELECT name FROM lm_classes WHERE class_id = $1', [classId]);
    if (!result.rows[0])
        return;
    (0, tool_routes_1.registerDynamicToolUI)(iconName, result.rows[0].name, 'codicon codicon-book', `/api/education/class?classId=${classId}`, `class-tutor-${stableId}`);
}
/** Apply an owner/tenant-bound class update and reject a stale authorization. */
async function updateClassRecord(ctx, caller, classId, input, status, published) {
    const result = await ctx.pool.query(`UPDATE lm_classes SET
       name = COALESCE($2, name), subject = COALESCE($3, subject),
       teacher_name = COALESCE($4, teacher_name), grade_level = COALESCE($5, grade_level),
       description = COALESCE($6, description), metadata = COALESCE(metadata, '{}'::jsonb) || $7::jsonb,
       status = COALESCE($8, status), published = COALESCE($9, published), updated_at = NOW()
     WHERE class_id = $1 AND tenant_id = $10
       AND ($11 = 'admin' OR teacher_student_id = $12)`, [classId, input.name, input.subject, input.teacherName, input.gradeLevel, input.description,
        JSON.stringify(editableMetadata(input)), status, published, caller.tenantId, caller.role, caller.studentId]);
    if (!result.rowCount)
        throw new Error('Class authorization changed before the update completed');
}
/** Update one class only while the caller remains its teacher or tenant admin. */
async function patchClassInfo(ctx, req, res) {
    try {
        const classId = String(req.params.classId);
        (0, education_calendar_support_1.requirePattern)(classId, education_calendar_support_1.UUID_PATTERN, 'classId');
        const caller = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        await (0, education_access_1.assertTeacherOfClass)(ctx.pool, caller, classId);
        const input = req.body ?? {};
        const status = input.status === 'active' || input.status === 'archived' ? input.status : null;
        const published = typeof input.published === 'boolean' ? input.published : null;
        if (published === true)
            (0, education_access_1.assertTeacher)(caller);
        await updateClassRecord(ctx, caller, classId, input, status, published);
        await syncClassTool(ctx, classId, status);
        logger.info({ classId, studentId: caller.studentId, status, published }, 'Class metadata updated');
        res.json({ success: true, status: status || undefined });
    }
    catch (err) {
        if ((0, education_calendar_support_1.sendCalendarAccessError)(res, err))
            return;
        logger.error({ err, classId: req.params.classId }, 'Failed to update class');
        res.status(500).json({ error: 'Failed to update class' });
    }
}
/** Register the class metadata compatibility routes. */
function createEducationClassInfoRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.patch('/classes/:classId', (req, res) => patchClassInfo(ctx, req, res));
    return router;
}
//# sourceMappingURL=education-class-info-routes.js.map