"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCareerJobGuide = registerCareerJobGuide;
const logger_1 = require("@/shared/logger");
const agent_management_1 = require("@/features/agent-management");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const career_hunter_routes_1 = require("./career-hunter-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'career-job-guide' });
const CAREER_AGENT_ID = 'cb000000-0000-0000-0000-000000000001';
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
const ALLOWED_SET_STATUS = new Set(['applied', 'dismissed', 'promoted', 'deferred', 'generated']);
/** Load one posting + this user's fit signals for grounding. Read-only. */
function loadJob(userSub, postingId) {
    const db = (0, career_hunter_routes_1.openUserDb)(userSub);
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
/** The prompt contract: ground on the posting, ask for a conversational reply + optional actions. */
function guidePrompt(job, message, history) {
    const list = (raw) => { try {
        return JSON.parse(raw || '[]').join('; ');
    }
    catch {
        return '';
    } };
    return [
        'You are the candidate\'s career agent helping with ONE specific job. Be concrete and honest.',
        '', 'JOB:',
        `Title: ${job.title}`, `Company: ${job.company}`, `Location: ${job.location || 'n/a'}`,
        job.ai_fit_score != null ? `AI fit: ${job.ai_fit_score}/100` : '',
        job.ai_fit_rationale ? `Why: ${job.ai_fit_rationale}` : '',
        `Matched strengths: ${list(job.ai_fit_matched)}`, `Gaps: ${list(job.ai_fit_gaps)}`,
        `Current pipeline status: ${job.status || 'new'}`,
        job.description ? `Description (excerpt): ${String(job.description).slice(0, 2500)}` : '',
        '', history ? `CONVERSATION SO FAR:\n${history}\n` : '',
        `CANDIDATE MESSAGE: ${message}`,
        '',
        'Reply conversationally, then choose actions ONLY when the message clearly calls for them. Return STRICT JSON only:',
        '{',
        '  "reply": "your conversational answer (2-5 sentences)",',
        '  "actions": [',
        '     {"op":"augment_profile","facts":"TRUE facts the candidate stated about their experience, to save to their profile"},',
        '     {"op":"generate","guidance":"optional tailoring note","oshal":false},',
        '     {"op":"set_status","status":"applied|dismissed|promoted|deferred"}',
        '  ]',
        '}',
        'Only include augment_profile with facts the candidate ACTUALLY stated (never invent). Omit actions entirely if none apply.',
    ].filter((l) => l !== '').join('\n');
}
/** Apply one whitelisted action; returns a short human label of what happened (or null to skip). */
function applyAction(userSub, postingId, a) {
    const op = String(a.op || '');
    if (op === 'augment_profile') {
        const facts = String(a.facts || '').trim();
        if (facts.length < 8)
            return null;
        (0, career_hunter_routes_1.runCliAsync)(userSub, ['augment'], { CH_FACTS: facts.slice(0, 4000) });
        return 'saved new facts to your profile';
    }
    if (op === 'generate') {
        const guidance = String(a.guidance || '').trim();
        const oshal = a.oshal === true ? '1' : '';
        (0, career_hunter_routes_1.runCliAsync)(userSub, ['tailor'], { CH_JOB: String(postingId), CH_GUIDANCE: guidance, CH_OSHAL: oshal });
        return 'generating a tailored résumé + cover';
    }
    if (op === 'set_status') {
        const status = String(a.status || '');
        if (!ALLOWED_SET_STATUS.has(status))
            return null;
        const db = (0, career_hunter_routes_1.openUserDb)(userSub, false);
        if (!db)
            return null;
        try {
            const appliedAt = status === 'applied' ? "COALESCE(applied_at, datetime('now'))" : 'applied_at';
            db.prepare(`UPDATE user_signals SET status=?, applied_at=${appliedAt} WHERE posting_id=?`).run(status, postingId);
            return `marked this job "${status}"`;
        }
        catch (err) {
            logger.error({ err, postingId, status }, 'job-guide: set_status failed');
            return null;
        }
        finally {
            db.close();
        }
    }
    return null;
}
/** Register POST /jobs/:id/guide on the (auth-gated) career-hunter router. */
function registerCareerJobGuide(router, ctx) {
    router.post('/jobs/:id/guide', async (req, res) => {
        const userSub = (0, career_hunter_routes_1.callerSub)(req);
        if (!userSub) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        const postingId = Number(req.params.id);
        const message = String(req.body?.message || '').trim();
        if (!Number.isFinite(postingId) || !message) {
            res.status(400).json({ error: 'postingId + message required' });
            return;
        }
        const job = loadJob(userSub, postingId);
        if (!job) {
            res.status(404).json({ error: 'job not found' });
            return;
        }
        const history = Array.isArray(req.body?.history)
            ? req.body.history.slice(-8).map((h) => `${h.role === 'bot' ? 'Advisor' : 'You'}: ${String(h.text || '').slice(0, 400)}`).join('\n')
            : '';
        try {
            const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, CAREER_AGENT_ID, {
                text: guidePrompt(job, message, history),
                taskId: `jobguide-${userSub}`, workspaceFolderId: `jobguide-${userSub}`,
                agentId: CAREER_AGENT_ID, agenticMode: true, direct: false, userSub,
            });
            let reply = 'Okay.';
            const applied = [];
            const m = String(result.response || '').match(/\{[\s\S]*\}/);
            if (m) {
                try {
                    const parsed = JSON.parse(m[0]);
                    reply = String(parsed.reply || reply).slice(0, 1500);
                    for (const a of (parsed.actions || []).slice(0, 4)) {
                        const label = applyAction(userSub, postingId, a);
                        if (label)
                            applied.push(label);
                    }
                }
                catch (err) {
                    logger.warn({ err: err.message }, 'job-guide: bot JSON unparseable');
                }
            }
            logger.info({ userSub, postingId, applied: applied.length }, 'job-guide turn');
            res.json({ reply, applied });
        }
        catch (err) {
            logger.error({ err, postingId }, 'job-guide failed');
            res.status(500).json({ error: 'guide failed' });
        }
    });
}
//# sourceMappingURL=career-job-guide.js.map