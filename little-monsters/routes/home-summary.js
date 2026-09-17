"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeSummaryRoutes = createHomeSummaryRoutes;
/** Read-only, issuer-bound class preparation. No other learner's private progress. */
const express_1 = require("express");
const education_access_1 = require("./education-access");
function createHomeSummaryRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool, { readOnly: true });
            const now = new Date();
            const access = `SELECT c.class_id FROM lm_classes c WHERE c.tenant_id=$2 AND
    ($3='admin' OR c.teacher_student_id=$1 OR EXISTS(SELECT 1 FROM lm_enrollments e
      WHERE e.class_id=c.class_id AND e.student_id=$1 AND e.tenant_id=$2))`;
            const queries = [
                `SELECT count(*)::text AS classes FROM (${access}) accessible`,
                `SELECT count(*) FILTER(WHERE a.due_date >= $4::timestamptz::date AND a.due_date < $4::timestamptz::date+5)::text AS due,
       count(*) FILTER(WHERE a.due_date<$4::timestamptz::date)::text AS overdue
       FROM lm_assignments a WHERE a.class_id IN (${access}) AND a.status IN ('active','overdue') AND a.created_at<=$4`,
                `SELECT a.title,a.due_date,c.name AS class_name FROM lm_assignments a JOIN lm_classes c ON c.class_id=a.class_id
       WHERE a.class_id IN (${access}) AND a.status IN ('active','overdue') AND a.created_at<=$4
       ORDER BY a.due_date NULLS LAST,a.assignment_id LIMIT 3`
            ];
            const result = await Promise.allSettled(queries.map((text, i) => ctx.pool.query({ text, values: i ? [actor.studentId, actor.tenantId, actor.role, now] : [actor.studentId, actor.tenantId, actor.role], query_timeout: 1800 })));
            const rows = (i) => result[i].status === 'fulfilled' ? result[i].value.rows : [];
            const metrics = [[0, 'classes', 'classes', 'Accessible classes'], [1, 'due', 'due-5d', 'Classwork due / 5d'], [1, 'overdue', 'overdue', 'Overdue classwork']].map(([i, k, id, label]) => ({ id, label, value: result[Number(i)].status === 'fulfilled' ? String(rows(Number(i))[0]?.[k] ?? '0') : 'Unavailable' }));
            const items = rows(2).map(r => { const title = String(r.title).slice(0, 120), detail = String(r.class_name).slice(0, 140) + ' / due ' + (r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : 'unscheduled'); return { text: title, detail, fix: 'little-monsters-review', actions: [{ integration: 'prepare-study-plan', context: { title, notes: detail + '. Prepare a study plan for this class assignment. This shared classwork state does not establish whether any individual learner has completed it. Do not include another learner’s grades or identity.' } }] }; });
            const failed = result.filter(r => r.status === 'rejected').length;
            items.push({ text: failed ? 'Some school sources cannot be checked.' : 'Classwork is shared; individual completion and private grades are not inferred.', tone: failed ? 'warn' : 'neutral', fix: 'little-monsters-review' });
            res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, partial: failed > 0, asOf: now.toISOString() });
        }
        catch (error) {
            // A valid framework PAT has no school issuer. This is an app setup/access
            // boundary, not an expired framework login; a 401 would redirect all of Home.
            const schoolIdentityMissing = error instanceof education_access_1.EducationAccessError && error.message === 'Authenticated OIDC identity is missing issuer or subject';
            res.status(schoolIdentityMissing ? 403 : error instanceof education_access_1.EducationAccessError ? error.status : 503).json({ error: schoolIdentityMissing ? 'Open Little Monsters with your school identity to complete setup' : error instanceof education_access_1.EducationAccessError ? error.message : 'School evidence unavailable' });
        }
    });
    return router;
}
//# sourceMappingURL=home-summary.js.map