"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Added caller-owned LinkedIn profile plan CRUD, drafting, assets, approval, and dispatch.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Added the profile-photo slot and package-decoupled Portrait Studio selection flow.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Awaited the asynchronous desktop profile dispatch before interpreting its result.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Split the route registrar into bounded plan, asset, and workflow handlers.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Serialize asset writes with approval, atomically roll back rejected files, and contain every served asset beneath the caller store.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Delegate the approved-to-dispatched CAS, exact generation/task/client capability binding, remote asset staging, and enqueue rollback to the kernel dispatch boundary.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Retry removal of generation-scoped staged assets whenever an operator abandons or resets a resolved plan.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCareerProfileStudio = registerCareerProfileStudio;
/**
 * Career Profile Studio â€” LinkedIn profile customization over the browser-control rail.
 *
 * LinkedIn exposes no profile-edit API. The caller builds and approves a private plan here,
 * then explicitly dispatches it to the desktop operator that controls the real signed-in browser.
 * @module career-profile-studio-routes
 */
const express_1 = __importDefault(require("express"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const agent_management_1 = require("@/features/agent-management");
const profile_studio_1 = require("@/features/profile-studio");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const profile_studio_dispatch_1 = require("@/app/profile-studio-dispatch");
const career_user_store_1 = require("./career-user-store");
const career_engine_response_1 = require("./career-engine-response");
const career_engine_runner_1 = require("./career-engine-runner");
const career_file_transaction_1 = require("./career-file-transaction");
const career_resume_preview_1 = require("./career-resume-preview");
const logger = (0, logger_1.createChildLogger)({ module: 'career-profile-studio-routes' });
const CAREER_AGENT_ID = 'cb000000-0000-0000-0000-000000000001';
const TOOL_DIR = path.resolve(__dirname, '..', 'tools');
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
const LIMITS = { headline: 220, about: 2600, skills: 15, skillLen: 80, customUrl: 100 };
const IMAGE_TYPES = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
};
const IMAGE_BODY = express_1.default.raw({ type: Object.keys(IMAGE_TYPES), limit: '8mb' });
const PDF_BODY = express_1.default.raw({ type: 'application/pdf', limit: '12mb' });
function assetPath(userSub, fileName) {
    return path.join((0, career_user_store_1.userPaths)(userSub).userDir, 'profile-studio', fileName);
}
/** Acquire the cross-process lane shared by profile asset writes and draft approval. */
function acquireProfilePlanLease(userSub, res) {
    const lease = (0, career_engine_runner_1.tryAcquireStorageRun)(userSub, 'profile-plan');
    return (0, career_engine_response_1.rejectEngineClaim)(res, lease, 'profile plan update') ? null : lease;
}
/** Persist one draft asset atomically, restoring exact prior bytes if the database rejects it. */
async function commitDraftAsset(store, userSub, field, filePath, bytes) {
    const plan = await store.getPlan(userSub);
    if (plan && plan.state !== 'draft')
        return false;
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const snapshots = await (0, career_file_transaction_1.snapshotFilesAsync)([filePath]);
    try {
        await (0, career_file_transaction_1.writeFileAtomicAsync)(filePath, bytes);
        if (await store.setAsset(userSub, field, filePath))
            return true;
    }
    catch (error) {
        try {
            await (0, career_file_transaction_1.restoreFilesAsync)(snapshots);
        }
        catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'profile asset rollback failed');
        }
        throw error;
    }
    await (0, career_file_transaction_1.restoreFilesAsync)(snapshots);
    return false;
}
function cleanDraft(body) {
    const output = {};
    if (typeof body.headline === 'string') {
        output.headline = body.headline.trim().slice(0, LIMITS.headline);
    }
    if (typeof body.about === 'string')
        output.about = body.about.trim().slice(0, LIMITS.about);
    if (Array.isArray(body.skills)) {
        output.skills = body.skills
            .slice(0, LIMITS.skills)
            .map((skill) => String(skill).trim().slice(0, LIMITS.skillLen))
            .filter(Boolean);
    }
    if (typeof body.customUrl === 'string') {
        output.customUrl = body.customUrl
            .trim()
            .replace(/[^a-zA-Z0-9-]/g, '')
            .slice(0, LIMITS.customUrl);
    }
    return output;
}
function draftPrompt(plan, message) {
    return [
        'You are drafting the operator\'s LinkedIn PROFILE copy (headline + about + skills) to read like',
        'a polished professional site. Call your career_database tool first and ground EVERY claim in that',
        'real data â€” never invent or inflate an employer, title, metric, skill, or clearance. Real titles',
        'only. Player-coach voice, first person implied, no "I built X" as if solo. NEVER use em or en dashes.',
        '',
        plan ? `CURRENT PLAN (improve on it): ${JSON.stringify({ headline: plan.headline, about: plan.about, skills: plan.skills }).slice(0, 6000)}` : '',
        message ? `OPERATOR DIRECTION: ${message.slice(0, 1000)}` : '',
        '',
        'Reply with ONLY a JSON object (no prose, no code fences):',
        `{"reply":"<one short conversational sentence>","headline":"<= ${LIMITS.headline} chars, specific and outcome-led>",`,
        `"about":"<= ${LIMITS.about} chars, 3-5 short paragraphs: who you are, what you have led/built with real outcomes, what you want next>",`,
        `"skills":["<= ${LIMITS.skills} concise skills, strongest first"]}`,
    ].filter(Boolean).join('\n');
}
function serveSurface(_req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(TOOL_DIR, 'career-profile-studio.html'), (err) => {
        if (err) {
            logger.error({ err }, 'profile studio serve failed');
            res.status(404).send('Not found');
        }
    });
}
async function loadPlan(store, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    try {
        res.json({ plan: await store.getPlan(userSub) });
    }
    catch (err) {
        logger.error({ err, userSub }, 'profile plan load failed');
        res.status(500).json({ error: 'load failed' });
    }
}
async function savePlan(store, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    try {
        const plan = await store.saveDraft(userSub, cleanDraft(req.body || {}));
        res.json({ plan, frozen: plan.state !== 'draft' });
    }
    catch (err) {
        logger.error({ err, userSub }, 'profile plan save failed');
        res.status(500).json({ error: 'save failed' });
    }
}
function parseDraftResponse(response) {
    let reply = 'Drafted.';
    let fields = {};
    const match = String(response || '').match(/\{[\s\S]*\}/);
    if (!match)
        return { reply, fields };
    try {
        const parsed = JSON.parse(match[0]);
        reply = String(parsed.reply || reply).slice(0, 1200);
        fields = cleanDraft(parsed);
    }
    catch (err) {
        logger.warn({ err }, 'profile draft bot JSON is unparseable');
    }
    return { reply, fields };
}
async function draftProfile(ctx, store, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    try {
        const plan = await store.getPlan(userSub);
        const message = String(req.body?.message || '').trim();
        const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, CAREER_AGENT_ID, {
            text: draftPrompt(plan, message),
            taskId: `liprofile-${userSub}`,
            workspaceFolderId: `liprofile-${userSub}`,
            agentId: CAREER_AGENT_ID,
            agenticMode: true,
            direct: false,
            userSub,
        });
        const parsed = parseDraftResponse(result.response);
        logger.info({ userSub, fields: Object.keys(parsed.fields) }, 'profile draft turn');
        res.json({ reply: parsed.reply, ...parsed.fields });
    }
    catch (err) {
        logger.error({ err, userSub }, 'profile draft failed');
        res.status(500).json({ error: 'draft failed' });
    }
}
function imageExtension(req) {
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim();
    return IMAGE_TYPES[contentType] || null;
}
async function uploadImage(store, field, baseName, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const extension = imageExtension(req);
    if (!extension || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'send the image as the request body (png/jpeg/webp)' });
        return;
    }
    const lease = acquireProfilePlanLease(userSub, res);
    if (!lease)
        return;
    try {
        const filePath = assetPath(userSub, `${baseName}${extension}`);
        if (!(await commitDraftAsset(store, userSub, field, filePath, req.body))) {
            res.status(409).json({ error: 'plan is not editable â€” reset to draft first' });
            return;
        }
        res.json({ ok: true, plan: await store.getPlan(userSub) });
    }
    catch (err) {
        logger.error({ err, userSub, field }, 'profile image upload failed');
        res.status(500).json({ error: 'upload failed' });
    }
    finally {
        (0, career_engine_runner_1.releaseRun)(lease);
    }
}
async function serveImage(store, property, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).end();
        return;
    }
    const plan = await store.getPlan(userSub).catch((err) => {
        logger.error({ err, userSub, property }, 'profile image plan load failed');
        return null;
    });
    const filePath = plan?.[property];
    let containedPath = null;
    try {
        if (filePath)
            containedPath = (0, career_resume_preview_1.resolveContainedRegularFile)(filePath, (0, career_user_store_1.userPaths)(userSub).userDir);
    }
    catch (err) {
        logger.warn({ err, userSub, property }, 'profile image containment failed');
    }
    if (!containedPath) {
        res.status(404).end();
        return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(containedPath, (err) => { if (err)
        res.status(404).end(); });
}
async function uploadResume(store, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'send the PDF as the request body' });
        return;
    }
    const lease = acquireProfilePlanLease(userSub, res);
    if (!lease)
        return;
    try {
        const filePath = assetPath(userSub, 'Featured_Resume.pdf');
        if (!(await commitDraftAsset(store, userSub, 'resume_path', filePath, req.body))) {
            res.status(409).json({ error: 'plan is not editable â€” reset to draft first' });
            return;
        }
        res.json({ ok: true, plan: await store.getPlan(userSub) });
    }
    catch (err) {
        logger.error({ err, userSub }, 'profile resume upload failed');
        res.status(500).json({ error: 'upload failed' });
    }
    finally {
        (0, career_engine_runner_1.releaseRun)(lease);
    }
}
function hasActionablePlan(plan) {
    return !!plan && !!(plan.headline || plan.about || plan.skills.length || plan.customUrl
        || plan.backgroundImagePath || plan.photoPath || plan.resumePath);
}
async function approvePlan(store, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const lease = acquireProfilePlanLease(userSub, res);
    if (!lease)
        return;
    try {
        const plan = await store.getPlan(userSub);
        if (!hasActionablePlan(plan)) {
            res.status(400).json({ error: 'nothing to apply â€” add at least one change first' });
            return;
        }
        if (!(await store.casState(userSub, 'draft', 'approved'))) {
            res.status(409).json({ error: 'plan is not in draft' });
            return;
        }
        res.json({ plan: await store.getPlan(userSub) });
    }
    catch (err) {
        logger.error({ err, userSub }, 'profile approve failed');
        res.status(500).json({ error: 'approve failed' });
    }
    finally {
        (0, career_engine_runner_1.releaseRun)(lease);
    }
}
async function dispatchPlan(store, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    try {
        const plan = await store.getPlan(userSub);
        if (!plan || plan.state !== 'approved') {
            res.status(409).json({ error: 'plan is not approved' });
            return;
        }
        const r = await (0, profile_studio_dispatch_1.dispatchProfileUpdate)({
            plan,
            store,
            assetRoot: (0, career_user_store_1.userPaths)(userSub).userDir,
        });
        if (!r.ok) {
            const status = r.error === 'plan is no longer approved' ? 409 : 503;
            res.status(status).json({
                error: r.error || 'dispatch failed',
                plan: await store.getPlan(userSub),
            });
            return;
        }
        logger.info({ userSub, taskId: r.taskId, clientId: r.clientId }, 'profile dispatched');
        res.json({ ok: true, plan: await store.getPlan(userSub) });
    }
    catch (err) {
        logger.error({ err, userSub }, 'profile dispatch failed');
        res.status(500).json({ error: 'dispatch failed' });
    }
}
async function resetPlan(store, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    try {
        const plan = await store.getPlan(userSub);
        if (!plan) {
            res.status(404).json({ error: 'no plan yet' });
            return;
        }
        if (!(await store.casState(userSub, plan.state, 'draft'))) {
            res.status(409).json({ error: 'a dispatched plan must resolve (or be abandoned) first' });
            return;
        }
        if (plan.dispatchTaskId)
            await (0, profile_studio_dispatch_1.cleanupProfileDispatchWorkspace)(plan.dispatchTaskId);
        res.json({ plan: await store.getPlan(userSub) });
    }
    catch (err) {
        logger.error({ err, userSub }, 'profile reset failed');
        res.status(500).json({ error: 'reset failed' });
    }
}
async function abandonPlan(store, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    try {
        const plan = await store.getPlan(userSub);
        if (!plan || plan.state !== 'dispatched') {
            res.status(409).json({ error: 'plan is not dispatched' });
            return;
        }
        const moved = await store.casState(userSub, 'dispatched', 'failed', {
            resultNote: 'abandoned by operator',
        });
        if (!moved) {
            res.status(409).json({ error: 'plan is not dispatched' });
            return;
        }
        if (plan.dispatchTaskId)
            await (0, profile_studio_dispatch_1.cleanupProfileDispatchWorkspace)(plan.dispatchTaskId);
        res.json({ plan: await store.getPlan(userSub) });
    }
    catch (err) {
        logger.error({ err, userSub }, 'profile abandon failed');
        res.status(500).json({ error: 'abandon failed' });
    }
}
function registerPlanRoutes(router, ctx, store) {
    router.get('/profile-studio', serveSurface);
    router.get('/profile-studio/plan', (req, res) => loadPlan(store, req, res));
    router.post('/profile-studio/plan', (req, res) => savePlan(store, req, res));
    router.post('/profile-studio/draft', (req, res) => draftProfile(ctx, store, req, res));
}
function registerAssetRoutes(router, store) {
    router.put('/profile-studio/background', IMAGE_BODY, (req, res) => {
        return uploadImage(store, 'background_image_path', 'background', req, res);
    });
    router.put('/profile-studio/photo', IMAGE_BODY, (req, res) => {
        return uploadImage(store, 'photo_path', 'photo', req, res);
    });
    router.get('/profile-studio/photo', (req, res) => serveImage(store, 'photoPath', req, res));
    router.put('/profile-studio/resume', PDF_BODY, (req, res) => uploadResume(store, req, res));
    router.get('/profile-studio/background', (req, res) => {
        return serveImage(store, 'backgroundImagePath', req, res);
    });
}
function registerWorkflowRoutes(router, ctx, store) {
    router.post('/profile-studio/approve', (req, res) => approvePlan(store, req, res));
    router.post('/profile-studio/dispatch', (req, res) => dispatchPlan(store, req, res));
    router.post('/profile-studio/reset', (req, res) => resetPlan(store, req, res));
    router.post('/profile-studio/abandon', (req, res) => abandonPlan(store, req, res));
}
/**
 * @description Mounts Profile Studio surface, plan, asset, approval, and dispatch routes.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used for plan persistence, bot drafting, and desktop dispatch.
 * @returns Nothing.
 */
function registerCareerProfileStudio(router, ctx) {
    const store = new profile_studio_1.ProfilePlanStore(ctx.pool);
    registerPlanRoutes(router, ctx, store);
    registerAssetRoutes(router, store);
    registerWorkflowRoutes(router, ctx, store);
}
//# sourceMappingURL=career-profile-studio-routes.js.map