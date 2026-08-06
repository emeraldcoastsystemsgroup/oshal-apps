"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted draft enqueue, approval, denial, and completion routes with the existing automation and engine-lease contracts.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Make draft-ticket creation idempotent across replicas, count only inserted application rows, and fail stopped when ticket/application state cannot be synchronized.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Preserve the two-argument ticket transition contract when no metadata was supplied.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Make manual application assertions upgrade unverified history while preserving stronger worker or confirmation-backed provenance.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Persist the authenticated manual completion in the authoritative Apply V2 ledger before updating its Career projections.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueueForUser = enqueueForUser;
exports.registerCareerApplicationReadRoutes = registerCareerApplicationReadRoutes;
exports.registerCareerApplicationMutationRoutes = registerCareerApplicationMutationRoutes;
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const apply_run_ledger_1 = require("@/app/apply-run-ledger");
const career_automation_1 = require("./career-automation");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
const career_engine_response_1 = require("./career-engine-response");
const career_engine_runner_1 = require("./career-engine-runner");
const career_user_store_1 = require("./career-user-store");
const logger = (0, logger_1.createChildLogger)({ module: 'career-application-routes' });
const TENANT = (0, career_user_store_1.careerTenant)();
/** SQL rank for the four explicit application-evidence sources. */
function provenanceRankSql(value) {
    return `(CASE ${value} WHEN 'verified-submission' THEN 4 WHEN 'worker-reported' THEN 3 ` +
        `WHEN 'manual-mark' THEN 2 WHEN 'unverified' THEN 1 ELSE 0 END)`;
}
function loadEnqueueRows(userSub, limit) {
    const db = (0, career_user_store_1.openUserDb)(userSub);
    if (!db)
        return [];
    try {
        return db.prepare(`SELECT pc.id, pc.title, co.name AS company, us.ai_fit_score AS fit,
              pc.salary_max, pc.url
         FROM corpus.postings_corpus pc
         JOIN corpus.companies co ON co.id=pc.company_id
         JOIN user_signals us ON us.posting_id=pc.id
        WHERE pc.active=1 AND pc.target_role=1 AND us.ai_fit_score IS NOT NULL
          AND COALESCE(us.status,'new')='new'
        ORDER BY us.ai_fit_score DESC LIMIT ?`).all(Math.min(50, Math.max(1, limit)));
    }
    finally {
        db.close();
    }
}
async function applicationExists(ctx, userSub, postingId) {
    const result = await ctx.pool.query(`SELECT 1 FROM career_hunter_applications
      WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`, [TENANT, userSub, postingId]);
    return !!result.rowCount;
}
/** Build a bounded external key so concurrent replicas ask TicketService for the same ticket. */
function applicationTicketKey(userSub, postingId) {
    const owner = (0, crypto_1.createHash)('sha256').update(userSub, 'utf8').digest('hex');
    return `${TENANT}:${owner}:${postingId}`;
}
/** Create or reuse one deterministic ticket, then report whether this call inserted the join row. */
async function createApplication(ctx, userSub, row) {
    const ticket = await ctx.ticketService.createTicket({
        title: `Apply: ${row.title} — ${row.company}`,
        ticketType: 'career-application',
        description: `Draft a tailored resume + cover letter for posting ${row.id} (${row.title} at ${row.company}, AI fit ${row.fit}). Awaiting operator approval (standard or OSHAL variant).`,
        status: 'approval_required',
        priority: 'none',
        labels: [],
        workspaceId: null,
        assignedAgentId: null,
        parentTicketId: null,
        externalProvider: 'career-hunter',
        externalId: applicationTicketKey(userSub, row.id),
        externalUrl: null,
        metadata: {
            posting_id: row.id,
            company: row.company,
            title: row.title,
            tenant: TENANT,
            url: row.url,
        },
        ownerSub: userSub,
    });
    const inserted = await ctx.pool.query(`INSERT INTO career_hunter_applications
       (tenant_id, user_sub, ticket_id, posting_id, company, title, status)
     VALUES ($1,$2,$3,$4,$5,$6,'approval_required')
     ON CONFLICT (tenant_id, user_sub, posting_id) DO NOTHING
     RETURNING id`, [TENANT, userSub, ticket.ticketId, row.id, row.company, row.title]);
    return inserted.rowCount === 1;
}
/**
 * @description Creates approval-required tickets for a caller's best fresh scored roles.
 * Automated callers default-deny unless the caller explicitly enabled draft automation.
 * @param ctx - Kernel context used for settings, ticket, and application persistence.
 * @param userSub - Authenticated owner of the per-user signals store.
 * @param limit - Maximum candidate rows to inspect, clamped to the established upper bound.
 * @param opts - Trigger classification; only manual work bypasses the automation opt-in.
 * @returns Number of newly created application records.
 */
async function enqueueForUser(ctx, userSub, limit = 10, opts = {}) {
    if (opts.trigger !== 'manual') {
        const settings = await (0, career_automation_1.readAutomationSettingsSystem)(ctx, userSub);
        if (!settings.autoGenerate) {
            logger.info({ userSub }, 'auto-draft enqueue skipped: automation is disabled');
            return 0;
        }
    }
    let created = 0;
    for (const row of loadEnqueueRows(userSub, limit)) {
        if (await applicationExists(ctx, userSub, row.id))
            continue;
        if (await createApplication(ctx, userSub, row))
            created += 1;
    }
    return created;
}
async function ticketIdFor(ctx, userSub, postingId) {
    const result = await ctx.pool.query(`SELECT ticket_id FROM career_hunter_applications
      WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`, [TENANT, userSub, postingId]);
    return result.rows[0]?.ticket_id || null;
}
async function updateTicketStatus(ctx, ticketId, status, metadata) {
    if (!ticketId)
        throw new Error('career application ticket is missing');
    if (metadata)
        await ctx.ticketService.updateStatus(ticketId, status, metadata);
    else
        await ctx.ticketService.updateStatus(ticketId, status);
}
async function updateApplicationState(ctx, userSub, postingId, status, includeOshal, applicationSource) {
    let updated;
    if (applicationSource !== undefined) {
        const currentRank = provenanceRankSql('application_source');
        const incomingRank = provenanceRankSql('$5');
        updated = await ctx.pool.query(`UPDATE career_hunter_applications
          SET status=$4,
              application_source=CASE WHEN ${currentRank}>${incomingRank}
                THEN application_source ELSE $5 END,
              updated_at=NOW()
        WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`, [TENANT, userSub, postingId, status, applicationSource]);
    }
    else if (includeOshal === undefined) {
        updated = await ctx.pool.query(`UPDATE career_hunter_applications SET status=$4, updated_at=NOW()
        WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`, [TENANT, userSub, postingId, status]);
    }
    else {
        updated = await ctx.pool.query(`UPDATE career_hunter_applications SET status=$4, include_oshal=$5, updated_at=NOW()
        WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`, [TENANT, userSub, postingId, status, includeOshal]);
    }
    if (updated.rowCount !== 1)
        throw new Error('career application state row is missing');
}
async function finishDraft(ctx, userSub, postingId, ticketId, includeOshal, res) {
    await updateApplicationState(ctx, userSub, postingId, 'drafted');
    try {
        await updateTicketStatus(ctx, ticketId, 'customer_action');
    }
    catch (error) {
        await updateApplicationState(ctx, userSub, postingId, 'error');
        throw error;
    }
    res.json({ ok: true, oshal: includeOshal });
}
async function failDraft(ctx, userSub, postingId, ticketId, error, res) {
    await updateApplicationState(ctx, userSub, postingId, 'error');
    await updateTicketStatus(ctx, ticketId, 'escalated', {
        reason: 'career_application_draft_failed',
        source: 'career-hunter-routes',
        message: error.slice(-1000),
    });
    logger.error({ err: error, userSub, postingId }, 'career application draft failed');
    res.status(500).json({ ok: false, error: error.slice(-400) });
}
/** Return a bounded failure while ensuring an async route never reports a partial write as success. */
function sendApplicationError(res, error) {
    if (res.headersSent)
        return;
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, error: message.slice(-400) });
}
async function approveApplication(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const postingId = Number(req.params.postingId);
    if (!Number.isSafeInteger(postingId) || postingId <= 0) {
        res.status(400).json({ error: 'bad posting id' });
        return;
    }
    const includeOshal = req.body?.oshal === true || req.body?.oshal === 'true';
    const lease = (0, career_engine_runner_1.tryAcquireRun)(userSub, 'user-store');
    if ((0, career_engine_response_1.rejectEngineClaim)(res, lease, 'draft'))
        return;
    try {
        const ticketId = await ticketIdFor(ctx, userSub, postingId);
        await updateApplicationState(ctx, userSub, postingId, 'drafting', includeOshal);
        try {
            await updateTicketStatus(ctx, ticketId, 'in_process_build');
        }
        catch (error) {
            await updateApplicationState(ctx, userSub, postingId, 'error');
            throw error;
        }
        const args = ['draft', '--job', String(postingId)];
        if (includeOshal)
            args.push('--oshal');
        const result = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, args, {}, { preclaimed: lease });
        if (result.ok) {
            await finishDraft(ctx, userSub, postingId, ticketId, includeOshal, res);
        }
        else {
            await failDraft(ctx, userSub, postingId, ticketId, result.err, res);
        }
    }
    catch (error) {
        logger.error({ err: error, userSub, postingId }, 'career application approval failed');
        sendApplicationError(res, error);
    }
    finally {
        (0, career_engine_runner_1.releaseRun)(lease);
    }
}
function setSignalStatus(userSub, postingId, status) {
    const db = (0, career_user_store_1.openUserDb)(userSub, false);
    if (!db)
        throw new Error('career user store is unavailable');
    try {
        if (status === 'applied') {
            db.prepare(`INSERT INTO user_signals (posting_id,status,applied_at,application_source)
         VALUES (?, 'applied', datetime('now'), 'manual-mark')
         ON CONFLICT(posting_id) DO UPDATE SET status='applied',
           applied_at=COALESCE(user_signals.applied_at, datetime('now')),
           application_source=CASE
             WHEN user_signals.application_source IN ('verified-submission','worker-reported','manual-mark')
               THEN user_signals.application_source
             ELSE 'manual-mark' END`).run(postingId);
        }
        else {
            db.prepare(`INSERT INTO user_signals (posting_id,status) VALUES (?, 'dismissed')
         ON CONFLICT(posting_id) DO UPDATE SET status='dismissed'`).run(postingId);
        }
    }
    finally {
        db.close();
    }
}
async function markApplicationApplied(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const postingId = Number(req.params.postingId);
    if (!Number.isSafeInteger(postingId) || postingId <= 0) {
        res.status(400).json({ error: 'bad posting id' });
        return;
    }
    try {
        const ticketId = await ticketIdFor(ctx, userSub, postingId);
        if (!ticketId)
            throw new Error('career application ticket is missing');
        await (0, apply_run_ledger_1.recordManualApplyRun)(ctx.pool, {
            ownerSub: userSub,
            postingId,
            ticketId,
            sourceRoute: 'career-application-applied',
        });
        await updateTicketStatus(ctx, ticketId, 'complete');
        setSignalStatus(userSub, postingId, 'applied');
        await updateApplicationState(ctx, userSub, postingId, 'applied', undefined, 'manual-mark');
        res.json({ ok: true });
    }
    catch (error) {
        logger.error({ err: error, userSub, postingId }, 'career application completion failed');
        sendApplicationError(res, error);
    }
}
async function denyApplication(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const postingId = Number(req.params.postingId);
    if (!Number.isSafeInteger(postingId) || postingId <= 0) {
        res.status(400).json({ error: 'bad posting id' });
        return;
    }
    try {
        const ticketId = await ticketIdFor(ctx, userSub, postingId);
        await updateTicketStatus(ctx, ticketId, 'cancelled');
        setSignalStatus(userSub, postingId, 'dismissed');
        await updateApplicationState(ctx, userSub, postingId, 'denied');
        res.json({ ok: true });
    }
    catch (error) {
        logger.error({ err: error, userSub, postingId }, 'career application denial failed');
        sendApplicationError(res, error);
    }
}
async function listApplications(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const result = await ctx.pool.query(`SELECT posting_id, company, title, include_oshal, status, ticket_id,
            application_source, application_task_id, updated_at
       FROM career_hunter_applications WHERE tenant_id=$1 AND user_sub=$2
      ORDER BY updated_at DESC LIMIT 200`, [TENANT, userSub]);
    res.json({ applications: result.rows });
}
async function enqueueDrafts(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    try {
        const created = await enqueueForUser(ctx, userSub, Number(req.body?.limit) || 10, { trigger: 'manual' });
        res.json({ created });
    }
    catch (error) {
        logger.error({ err: error, userSub }, 'career application enqueue failed');
        sendApplicationError(res, error);
    }
}
/**
 * @description Registers the application queue read before board mutation route patterns.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used for tickets, application records, and engine commands.
 * @returns Nothing.
 */
function registerCareerApplicationReadRoutes(router, ctx) {
    router.get('/applications', (req, res) => listApplications(ctx, req, res));
}
/**
 * @description Registers manual enqueue, approval, completion, and denial mutations.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used for tickets, application records, and engine commands.
 * @returns Nothing.
 */
function registerCareerApplicationMutationRoutes(router, ctx) {
    router.post('/enqueue-drafts', (req, res) => enqueueDrafts(ctx, req, res));
    router.post('/applications/:postingId/approve', (req, res) => {
        return approveApplication(ctx, req, res);
    });
    router.post('/applications/:postingId/applied', (req, res) => {
        return markApplicationApplied(ctx, req, res);
    });
    router.post('/applications/:postingId/deny', (req, res) => denyApplication(ctx, req, res));
}
//# sourceMappingURL=career-application-routes.js.map