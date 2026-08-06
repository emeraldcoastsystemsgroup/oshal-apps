"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCareerJobGuide = registerCareerJobGuide;
const logger_1 = require("@/shared/logger");
const agent_management_1 = require("@/features/agent-management");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const career_user_store_1 = require("./career-user-store");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
const career_engine_response_1 = require("./career-engine-response");
const career_engine_runner_1 = require("./career-engine-runner");
const logger = (0, logger_1.createChildLogger)({ module: 'career-job-guide' });
const CAREER_AGENT_ID = 'cb000000-0000-0000-0000-000000000001';
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
const ALLOWED_SET_STATUS = new Set(['applied', 'dismissed', 'promoted', 'deferred', 'generated']);
/** Load one posting and the caller's fit signals for prompt grounding. */
function loadJob(userSub, postingId) {
    const db = (0, career_user_store_1.openUserDb)(userSub);
    if (!db)
        return null;
    try {
        return db.prepare(`
      SELECT p.title, co.name AS company, p.location, p.description,
             s.ai_fit_score, s.ai_fit_rationale, s.ai_fit_matched, s.ai_fit_gaps, s.status
        FROM corpus.postings_corpus p
        JOIN corpus.companies co ON co.id = p.company_id
        LEFT JOIN user_signals s ON s.posting_id = p.id
       WHERE p.id = ?`).get(postingId) || null;
    }
    catch (err) {
        logger.error({ err, postingId }, 'job-guide: load failed');
        return null;
    }
    finally {
        db.close();
    }
}
/** Parse a stored JSON list without letting one malformed signal break the prompt. */
function signalList(raw) {
    try {
        return JSON.parse(raw || '[]').join('; ');
    }
    catch (err) {
        logger.warn({ err }, 'job-guide: malformed fit signal ignored');
        return '';
    }
}
/** Build the strict reply-and-action contract sent to the Career agent. */
function guidePrompt(job, message, history) {
    return [
        'You are the candidate\'s career agent helping with ONE specific job. Be concrete and honest.',
        '', 'JOB:', `Title: ${job.title}`, `Company: ${job.company}`,
        `Location: ${job.location || 'n/a'}`,
        job.ai_fit_score != null ? `AI fit: ${job.ai_fit_score}/100` : '',
        job.ai_fit_rationale ? `Why: ${job.ai_fit_rationale}` : '',
        `Matched strengths: ${signalList(job.ai_fit_matched)}`,
        `Gaps: ${signalList(job.ai_fit_gaps)}`,
        `Current pipeline status: ${job.status || 'new'}`,
        job.description ? `Description (excerpt): ${String(job.description).slice(0, 2500)}` : '',
        history ? `CONVERSATION SO FAR:\n${history}\n` : '',
        `CANDIDATE MESSAGE: ${message}`,
        'Return strict JSON: {"reply":"2-5 sentences","actions":[{"op":"augment_profile","facts":"true candidate facts"},{"op":"generate","guidance":"optional","oshal":false},{"op":"set_status","status":"applied|dismissed|promoted|deferred"}]}.',
        'Include augment_profile only for facts the candidate actually stated. Omit actions when none apply.',
    ].filter(Boolean).join('\n');
}
/** Normalize untrusted bot actions to the bounded payload understood by the CLI. */
function planGuideActions(actions) {
    const plan = { actions: [] };
    for (const action of actions.slice(0, 4)) {
        const op = String(action.op || '');
        const facts = String(action.facts || '').trim();
        if (op === 'augment_profile' && facts.length >= 8) {
            plan.actions.push({ op, facts: facts.slice(0, 4000) });
        }
        else if (op === 'generate') {
            plan.actions.push({
                op, guidance: String(action.guidance || '').trim().slice(0, 4000), oshal: action.oshal === true,
            });
        }
        else if (op === 'set_status' && ALLOWED_SET_STATUS.has(String(action.status || ''))) {
            plan.actions.push({ op, status: String(action.status) });
        }
    }
    return plan;
}
/** Accept an explicit confirmation only when every supplied row survives strict normalization. */
function confirmedGuidePlan(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 4)
        return null;
    if (value.some((action) => !action || typeof action !== 'object' || Array.isArray(action)))
        return null;
    const plan = planGuideActions(value);
    return plan.actions.length === value.length ? plan : null;
}
/** Human-facing success label for one normalized action. */
function completedActionLabel(action) {
    if (action.op === 'augment_profile')
        return 'saved new facts to your profile';
    if (action.op === 'generate')
        return 'generated a tailored resume and cover letter';
    return `marked this job "${action.status}"`;
}
/** Human-facing in-progress label used when dependency failure skips an action. */
function skippedActionLabel(action) {
    if (action.op === 'augment_profile')
        return 'saving new facts to your profile';
    if (action.op === 'generate')
        return 'generating a tailored resume and cover letter';
    return `marking this job "${action.status}"`;
}
/** Require each child result row to correspond to the action at the same sequence position. */
function rowMatchesAction(row, action) {
    if (row.op !== action.op)
        return false;
    return action.op !== 'set_status' || row.status === action.status;
}
/** Return the same bounded failure once for each action whose result cannot be trusted. */
function failedGuideOutcome(actions, message) {
    return { applied: [], failed: actions.map(() => message) };
}
/** Parse the marked ordered result emitted by the CLI while ignoring engine diagnostic lines. */
function parseGuideOutcomes(output, actions) {
    const marker = output.match(/GUIDE_ACTIONS_RESULT=(\[[^\r\n]*\])/);
    if (!marker)
        return failedGuideOutcome(actions, 'career action result was unavailable');
    try {
        const rows = JSON.parse(marker[1]);
        if (!Array.isArray(rows) || rows.length !== actions.length) {
            return failedGuideOutcome(actions, 'career action result was invalid');
        }
        const outcome = { applied: [], failed: [] };
        actions.forEach((action, index) => {
            const row = rows[index];
            if (!row || !rowMatchesAction(row, action)) {
                outcome.failed.push('career action result was invalid');
            }
            else if (row.ok === true) {
                outcome.applied.push(completedActionLabel(action));
            }
            else if (row.skipped === true) {
                outcome.failed.push(`${skippedActionLabel(action)} skipped because an earlier action failed`);
            }
            else {
                outcome.failed.push(`${completedActionLabel(action)} failed`);
            }
        });
        return outcome;
    }
    catch (err) {
        logger.error({ err }, 'job-guide: ordered action result was invalid');
        return failedGuideOutcome(actions, 'career action result was invalid');
    }
}
/** Execute the complete normalized sequence in one child and return its reservation exactly once. */
async function applyGuidePlan(ctx, userSub, postingId, plan, lease) {
    try {
        const result = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, ['guide-actions'], {
            CH_JOB: String(postingId), CH_GUIDE_ACTIONS: JSON.stringify(plan.actions),
        }, { preclaimed: lease });
        if (result.ok)
            return parseGuideOutcomes(result.out, plan.actions);
        logger.error({ postingId, err: result.err }, 'job-guide: ordered actions failed');
        return failedGuideOutcome(plan.actions, 'career engine action failed');
    }
    finally {
        (0, career_engine_runner_1.releaseRun)(lease);
    }
}
/** Extract the bot's bounded reply and normalized action plan. */
function parseGuideResponse(result) {
    const match = String(result.response || '').match(/\{[\s\S]*\}/);
    if (!match)
        return { reply: 'Okay.', plan: { actions: [] } };
    try {
        const parsed = JSON.parse(match[0]);
        return {
            reply: String(parsed.reply || 'Okay.').slice(0, 1500),
            plan: planGuideActions(Array.isArray(parsed.actions) ? parsed.actions : []),
        };
    }
    catch (err) {
        logger.warn({ err: err.message }, 'job-guide: bot JSON unparseable');
        return { reply: 'Okay.', plan: { actions: [] } };
    }
}
/** Execute one explicitly confirmed action plan and return only observed child outcomes. */
async function confirmGuidePlan(ctx, userSub, postingId, plan, res) {
    const lease = (0, career_engine_runner_1.tryAcquireRun)(userSub, 'user-store');
    if ((0, career_engine_response_1.rejectEngineClaim)(res, lease, 'job guide actions'))
        return;
    const outcome = await applyGuidePlan(ctx, userSub, postingId, plan, lease);
    logger.info({ userSub, postingId, applied: outcome.applied.length, failed: outcome.failed.length }, 'job-guide turn');
    res.json({ reply: 'Confirmed actions completed.', proposedActions: [], ...outcome });
}
/** Run a non-mutating model turn and return its normalized actions as proposals only. */
async function proposeGuidePlan(ctx, userSub, job, req, res) {
    const message = String(req.body?.message || '').trim().slice(0, 4000);
    if (!message) {
        res.status(400).json({ error: 'message required' });
        return;
    }
    const history = Array.isArray(req.body?.history)
        ? req.body.history.slice(-8).map((h) => `${h.role === 'bot' ? 'Advisor' : 'You'}: ${String(h.text || '').slice(0, 400)}`).join('\n') : '';
    const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, CAREER_AGENT_ID, {
        text: guidePrompt(job, message, history), taskId: `jobguide-${userSub}`,
        workspaceFolderId: `jobguide-${userSub}`, agentId: CAREER_AGENT_ID,
        agenticMode: true, direct: false, userSub,
    });
    const { reply, plan } = parseGuideResponse(result);
    res.json({ reply, proposedActions: plan.actions, applied: [], failed: [] });
}
/** Execute one authenticated proposal or separate user-confirmation turn. */
async function handleGuideTurn(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const postingId = Number(req.params.id);
    if (!Number.isFinite(postingId)) {
        res.status(400).json({ error: 'postingId required' });
        return;
    }
    const job = loadJob(userSub, postingId);
    if (!job) {
        res.status(404).json({ error: 'job not found' });
        return;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'confirmedActions')) {
        const plan = confirmedGuidePlan(req.body?.confirmedActions);
        if (!plan) {
            res.status(400).json({ error: 'confirmedActions are invalid' });
            return;
        }
        await confirmGuidePlan(ctx, userSub, postingId, plan, res);
        return;
    }
    await proposeGuidePlan(ctx, userSub, job, req, res);
}
/**
 * @description Register the one-job conversational route on the authenticated Career router.
 * @param router parent package router
 * @param ctx kernel services used for bot execution and credential brokerage
 * @returns nothing
 */
function registerCareerJobGuide(router, ctx) {
    router.post('/jobs/:id/guide', async (req, res) => {
        try {
            await handleGuideTurn(ctx, req, res);
        }
        catch (err) {
            logger.error({ err, postingId: req.params.id }, 'job-guide failed');
            if (!res.headersSent)
                res.status(500).json({ error: 'guide failed' });
        }
    });
}
//# sourceMappingURL=career-job-guide.js.map