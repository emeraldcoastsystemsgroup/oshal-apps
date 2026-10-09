"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Test Lab application seam (1.27.0). An automated live acceptance that drives the real approve -> draft path (POST /applications/:postingId/approve runs the engine's `draft --job` on the Career worker rail) needs an application it owns and can remove, and until now nothing could remove one: POST /enqueue-drafts creates durable tickets and rows over the caller's best postings and no route deletes them. POST /test-lab/applications plants ONE application, marked with the acceptance run's tag, on one untouched posting of the caller (active, no application, no ticket, unworked, no packet), through the same ticket and row writes the queue uses. The shared jobs corpus is never written: the posting is a real one the caller's board already shows. DELETE /test-lab/applications/:postingId/:tag removes exactly that marked application (its row, then its ticket through TicketService.deleteTicket) and nothing unmarked: a ticket without the tag, or another user's, answers 404; a draft still running or an applied application answers 409. The packet a draft leaves is removed by the existing DELETE /jobs/:id/packet.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCareerTestLabApplicationRoutes = registerCareerTestLabApplicationRoutes;
const logger_1 = require("@/shared/logger");
const career_application_routes_1 = require("./career-application-routes");
const career_user_store_1 = require("./career-user-store");
const logger = (0, logger_1.createChildLogger)({ module: 'career-test-lab-applications' });
const TENANT = (0, career_user_store_1.careerTenant)();
/** An acceptance run's tag: the grammar the story seam (career-stories-routes.ts) accepts. */
const TEST_LAB_TAG = /^[a-z0-9][a-z0-9-]{5,63}$/;
/** The status an untouched posting holds (the user_signals column default). */
const UNWORKED = 'new';
/**
 * Application states the seam never removes: while `drafting` the approve handler still writes
 * the row and the packet after us; an `applied` row is the application record (its manual mark
 * sits in the Apply V2 ledger).
 */
const HELD_STATES = new Set(['drafting', 'applied']);
/** Parse and validate the posting id and tag; null when either is malformed. */
function parseMark(postingRaw, tagRaw) {
    const postingId = Number(postingRaw);
    const tag = String(tagRaw ?? '');
    if (!Number.isSafeInteger(postingId) || postingId <= 0 || !TEST_LAB_TAG.test(tag))
        return null;
    return { postingId, tag };
}
/** Read the caller's view of one active posting: its corpus facts and the caller's own signal. */
function readPlantTarget(userSub, postingId) {
    const db = (0, career_user_store_1.openUserDb)(userSub);
    if (!db)
        return { missing: 'store' };
    try {
        const row = db.prepare(`SELECT pc.id, pc.title, co.name AS company, us.ai_fit_score AS fit, pc.salary_max, pc.url,
              COALESCE(us.status, '${UNWORKED}') AS status,
              (us.resume_path IS NOT NULL OR us.cover_path IS NOT NULL OR us.generated_at IS NOT NULL) AS worked
         FROM corpus.postings_corpus pc
         JOIN corpus.companies co ON co.id=pc.company_id
         LEFT JOIN user_signals us ON us.posting_id=pc.id
        WHERE pc.id=? AND pc.active=1`).get(postingId);
        return row ? { found: row } : { missing: 'posting' };
    }
    finally {
        db.close();
    }
}
/** The caller's application row for one posting, if any. */
async function applicationRow(ctx, userSub, postingId) {
    const result = await ctx.pool.query(`SELECT ticket_id, status FROM career_hunter_applications
      WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`, [TENANT, userSub, postingId]);
    return result.rows[0] || null;
}
/** Why a posting cannot carry a planted application, or null when it can. */
async function plantRefusal(ctx, userSub, postingId, read) {
    if ('missing' in read) {
        return read.missing === 'store'
            ? { status: 409, error: 'the caller has no Career store yet' }
            : { status: 404, error: 'no active posting with this id' };
    }
    if (read.found.status !== UNWORKED || Number(read.found.worked)) {
        return { status: 409, error: 'the posting has been worked; the seam borrows only an untouched posting' };
    }
    if (await applicationRow(ctx, userSub, postingId)) {
        return { status: 409, error: 'the posting already has an application' };
    }
    const key = (0, career_application_routes_1.applicationTicketKey)(userSub, postingId);
    if (await ctx.ticketService.getTicketByExternalId(career_application_routes_1.APPLICATION_TICKET_PROVIDER, key)) {
        return { status: 409, error: 'the posting already has an application ticket' };
    }
    return null;
}
/**
 * @description POST /test-lab/applications {postingId, tag}: plant one marked application on an
 * untouched posting of the caller, awaiting approval exactly as a queued one does.
 * @param ctx - Kernel context for the ticket and application writes.
 * @param req - Express request (the caller, the posting id and the tag in the body).
 * @param res - Express response.
 * @returns Nothing; answers 201 with the planted posting and tag.
 */
async function plantMarkedApplication(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const mark = parseMark(req.body?.postingId, req.body?.tag);
    if (!mark) {
        res.status(400).json({ error: 'postingId must be a positive integer and tag 6-64 lowercase letters, digits or hyphens' });
        return;
    }
    try {
        const read = readPlantTarget(userSub, mark.postingId);
        const refusal = await plantRefusal(ctx, userSub, mark.postingId, read);
        if (refusal || !('found' in read)) {
            res.status(refusal?.status || 404).json({ error: refusal?.error || 'no active posting with this id' });
            return;
        }
        const { id, title, company, fit, salary_max: salaryMax, url } = read.found;
        const posting = { id, title, company, fit, salary_max: salaryMax, url };
        if (!await (0, career_application_routes_1.createApplication)(ctx, userSub, posting, mark.tag)) {
            res.status(409).json({ error: 'an application for this posting appeared concurrently' });
            return;
        }
        logger.info({ userSub, postingId: mark.postingId, tag: mark.tag }, 'career Test Lab application planted');
        res.status(201).json({ ok: true, postingId: mark.postingId, tag: mark.tag, status: 'approval_required' });
    }
    catch (error) {
        logger.error({ err: error, userSub, postingId: mark.postingId }, 'career Test Lab application plant failed');
        res.status(500).json({ error: 'the marked application could not be planted' });
    }
}
/** The caller's ticket for one posting when it carries exactly this tag; null otherwise. */
async function markedTicket(ctx, userSub, postingId, tag, ticketId) {
    const ticket = ticketId
        ? await ctx.ticketService.getTicket(ticketId)
        : await ctx.ticketService.getTicketByExternalId(career_application_routes_1.APPLICATION_TICKET_PROVIDER, (0, career_application_routes_1.applicationTicketKey)(userSub, postingId));
    if (!ticket || ticket.ownerSub !== userSub)
        return null;
    const metadata = (ticket.metadata || {});
    return metadata.test_lab_tag === tag ? { ticketId: ticket.ticketId } : null;
}
/**
 * @description DELETE /test-lab/applications/:postingId/:tag: remove the caller's application for
 * one posting only when its ticket carries this tag. The row goes first, then the ticket; a retry
 * after a failed ticket delete finds the ticket by its deterministic key and finishes the job.
 * @param ctx - Kernel context for the ticket and application writes.
 * @param req - Express request (the caller, the posting id and the tag in the path).
 * @param res - Express response.
 * @returns Nothing; answers 200 with what was removed.
 */
async function removeMarkedApplication(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const mark = parseMark(req.params?.postingId, req.params?.tag);
    if (!mark) {
        res.status(400).json({ error: 'postingId must be a positive integer and tag 6-64 lowercase letters, digits or hyphens' });
        return;
    }
    try {
        const row = await applicationRow(ctx, userSub, mark.postingId);
        const ticket = await markedTicket(ctx, userSub, mark.postingId, mark.tag, row?.ticket_id || null);
        if (!ticket) {
            res.status(404).json({ error: 'no application of the caller carries this Test Lab mark' });
            return;
        }
        if (row && HELD_STATES.has(row.status)) {
            res.status(409).json({ error: `the application is ${row.status}; it is not removed from here`, status: row.status });
            return;
        }
        const deleted = row ? await ctx.pool.query(`DELETE FROM career_hunter_applications
        WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3 AND ticket_id=$4`, [TENANT, userSub, mark.postingId, ticket.ticketId]) : { rowCount: 0 };
        if (row && deleted.rowCount !== 1) {
            res.status(409).json({ error: 'the application changed while it was being removed' });
            return;
        }
        await ctx.ticketService.deleteTicket(ticket.ticketId);
        logger.info({ userSub, postingId: mark.postingId, tag: mark.tag }, 'career Test Lab application removed');
        res.json({ ok: true, postingId: mark.postingId, removed: { application: Boolean(row), ticket: true } });
    }
    catch (error) {
        logger.error({ err: error, userSub, postingId: mark.postingId }, 'career Test Lab application removal failed');
        res.status(500).json({ error: 'the marked application could not be removed' });
    }
}
/**
 * @description Registers the owner-only Test Lab application seam on the package router.
 * @param router - Authenticated Career Hunter router (mounted at /api/career-hunter).
 * @param ctx - Kernel context for the ticket and application writes.
 * @returns Nothing.
 */
function registerCareerTestLabApplicationRoutes(router, ctx) {
    router.post('/test-lab/applications', (req, res) => { void plantMarkedApplication(ctx, req, res); });
    router.delete('/test-lab/applications/:postingId/:tag', (req, res) => { void removeMarkedApplication(ctx, req, res); });
}
//# sourceMappingURL=career-test-lab-applications.js.map