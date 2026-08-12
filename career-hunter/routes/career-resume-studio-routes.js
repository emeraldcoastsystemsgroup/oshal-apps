"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Added structured resume loading, bot-guided edits, persistence, and PDF rerendering.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Routed guide turns through the agentic Career bot execution contract.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Awaited PDF rerenders through the asynchronous engine boundary.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Returned shared admission failures for busy or duplicate rerenders.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Added complete packet and signal-path rollback under the retained user-store lease.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Split the route registrar into bounded load, guide, and save handlers.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Moved packet discovery, reads, writes, snapshots, and rollback off synchronous filesystem APIs.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | Added the MASTER document: id=master loads the durable profile through `resume base`, save whitelists back through `resume base-save` (changelog returned to the surface), and the guide bot is told it is editing the profile every tailored resume is generated from — with cover and title/org/span edits stripped for the master case.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCareerResumeStudio = registerCareerResumeStudio;
const fs_1 = require("fs");
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const agent_management_1 = require("@/features/agent-management");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
const career_engine_response_1 = require("./career-engine-response");
const career_engine_runner_1 = require("./career-engine-runner");
const career_file_transaction_1 = require("./career-file-transaction");
const career_user_store_1 = require("./career-user-store");
const logger = (0, logger_1.createChildLogger)({ module: 'career-resume-studio-routes' });
const CAREER_AGENT_ID = 'cb000000-0000-0000-0000-000000000001';
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
/** Sentinel document id the surface sends for the durable master profile (never a posting id). */
const MASTER_ID = 'master';
/** Route-side payload ceiling, slightly under the engine's 256 KiB guard. Defence in depth,
 *  not the first wall: the control plane's global JSON body limit (~100 KB unless
 *  OSHAL_JSON_BODY_LIMIT raises it) rejects most oversize bodies before this handler runs, so
 *  this guard is operative only on deployments that widen that limit — the engine-side refusal
 *  in bin/oshal-jobhunter.js remains the authoritative cap either way. */
const MASTER_DOC_MAX_BYTES = 256_000;
const RENDERED_PACKET_FILES = [
    'application.json',
    'Resume_ATS.html',
    'Resume_ATS.pdf',
    'Resume_Premium.html',
    'Resume_Premium.pdf',
    'Resume_1page.html',
    'Resume_1page.pdf',
    'CoverLetter.html',
    'CoverLetter.pdf',
];
async function hasApplicationPacket(appsDir, entryName) {
    try {
        await fs_1.promises.access(path.join(appsDir, entryName, 'application.json'));
        return true;
    }
    catch (err) {
        if (err.code !== 'ENOENT') {
            logger.error({ err, entryName }, 'resume packet accessibility check failed');
        }
        return false;
    }
}
async function packetDir(userSub, postingId) {
    const appsDir = path.join((0, career_user_store_1.userPaths)(userSub).userDir, 'applications');
    const suffix = `__${postingId}`;
    try {
        const entries = await fs_1.promises.readdir(appsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()
                && entry.name.endsWith(suffix)
                && await hasApplicationPacket(appsDir, entry.name)) {
                return path.join(appsDir, entry.name);
            }
        }
        return null;
    }
    catch (err) {
        logger.error({ err, userSub, postingId }, 'resume packet directory scan failed');
        return null;
    }
}
async function readDoc(dir) {
    const data = JSON.parse(await fs_1.promises.readFile(path.join(dir, 'application.json'), 'utf8'));
    const generated = (data.generated || {});
    return {
        resume: generated.resume || {},
        cover: generated.cover || {},
        meta: {
            postingId: data.posting_id,
            company: data.company,
            title: data.title,
            url: data.url,
            include_oshal: data.include_oshal,
        },
    };
}
async function writeDoc(dir, resume, cover) {
    const filePath = path.join(dir, 'application.json');
    const data = JSON.parse(await fs_1.promises.readFile(filePath, 'utf8'));
    const generated = (data.generated || {});
    data.generated = { ...generated, resume, cover };
    await (0, career_file_transaction_1.writeFileAtomicAsync)(filePath, JSON.stringify(data, null, 2));
}
function pointPacketPaths(userSub, postingId, dir) {
    const db = (0, career_user_store_1.openUserDb)(userSub, false);
    if (!db)
        return null;
    try {
        const previous = db.prepare('SELECT resume_path, cover_path FROM user_signals WHERE posting_id=?').get(postingId);
        if (!previous)
            return null;
        db.prepare('UPDATE user_signals SET resume_path=?, cover_path=? WHERE posting_id=?')
            .run(path.join(dir, 'Resume_ATS.pdf'), path.join(dir, 'CoverLetter.pdf'), postingId);
        return {
            resumePath: previous.resume_path ?? null,
            coverPath: previous.cover_path ?? null,
        };
    }
    finally {
        db.close();
    }
}
function restorePacketPaths(userSub, postingId, previous) {
    if (!previous)
        return;
    const db = (0, career_user_store_1.openUserDb)(userSub, false);
    if (!db)
        throw new Error('resume path rollback database unavailable');
    try {
        db.prepare('UPDATE user_signals SET resume_path=?, cover_path=? WHERE posting_id=?')
            .run(previous.resumePath, previous.coverPath, postingId);
    }
    finally {
        db.close();
    }
}
async function rollbackPacket(snapshots, userSub, postingId, previousPaths) {
    const failures = [];
    try {
        await (0, career_file_transaction_1.restoreFilesAsync)(snapshots);
    }
    catch (err) {
        logger.error({ err, postingId }, 'resume file rollback failed');
        failures.push(err);
    }
    try {
        restorePacketPaths(userSub, postingId, previousPaths);
    }
    catch (err) {
        logger.error({ err, postingId }, 'resume path rollback failed');
        failures.push(err);
    }
    if (failures.length)
        throw new AggregateError(failures, 'resume packet rollback failed');
}
async function saveAndRerenderPacket(ctx, userSub, postingId, dir, resume, cover, lease) {
    const paths = RENDERED_PACKET_FILES.map((name) => path.join(dir, name));
    const snapshots = await (0, career_file_transaction_1.snapshotFilesAsync)(paths);
    let previousPaths = null;
    let committed = false;
    try {
        await writeDoc(dir, resume, cover);
        previousPaths = pointPacketPaths(userSub, postingId, dir);
        const result = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, ['rerender'], {
            CH_JOB: String(postingId),
        }, { preclaimed: lease });
        committed = result.ok;
        return result;
    }
    finally {
        if (!committed)
            await rollbackPacket(snapshots, userSub, postingId, previousPaths);
    }
}
/** Frame the guide bot for either a job-tailored packet or the durable MASTER profile. */
function guidePromptIntro(meta) {
    if (meta.master === true) {
        return [
            'You are editing the candidate\'s MASTER resume in a live editor. This is NOT a job-tailored',
            'packet: it is the durable career profile every future tailored resume is generated from, and',
            'every change you make here updates that durable profile. Do NOT tailor to any specific job,',
            'company, or posting — keep every edit generally true of the whole career. Never change a',
            'role\'s title, org, or span (they anchor the durable profile); edit bullets and text fields.',
        ];
    }
    return [
        'You are editing the candidate\'s tailored RESUME + COVER LETTER for a specific job, in a live editor.',
        `Target role: ${String(meta.title || '')} at ${String(meta.company || '')}.`,
    ];
}
function guidePrompt(message, resume, cover, meta, history) {
    const master = meta.master === true;
    return [
        ...guidePromptIntro(meta),
        '',
        'HARD TRUTH RULES (never violate): edit ONLY the facts already present â€” NEVER invent or add an',
        'employer, title, date, metric, skill, certification, clearance, or claim. You may reorder, sharpen,',
        'reword, and re-emphasize. Real titles only (exactly as they appear in the profile),',
        'never inflated to CTO/VP/Chief unless the profile says so. Player-coach voice ("led the team',
        'that built", "led the effort"), never "I built X" as if solo. First person implied, no third-person pronoun or name.',
        'NEVER use em or en dashes. Keep bullets to 1-2 lines, strong past-tense lead verbs, outcome first.',
        '',
        'CURRENT RESUME (JSON):', JSON.stringify(resume).slice(0, 12000),
        ...(master ? [] : ['CURRENT COVER (JSON):', JSON.stringify(cover).slice(0, 4000)]),
        history ? `\nCONVERSATION SO FAR:\n${history}` : '',
        `\nUSER: ${message}`,
        '',
        'Reply with ONLY a JSON object (no prose, no code fences):',
        '{"reply":"<one short conversational sentence>","actions":[ ...zero or more edits... ]}',
        'Allowed actions (use the minimal set that satisfies the request):',
        '- {"op":"set_headline","text":"..."}',
        '- {"op":"set_summary","text":"3-4 sentence executive summary"}',
        '- {"op":"set_clearance","text":"exact clearance as already stated"}',
        '- {"op":"set_competencies","items":["8-12 short phrases"]}',
        '- {"op":"set_skills","items":["concise skills"]}',
        master
            ? '- {"op":"update_experience","index":1,"bullets":["rewritten bullets"]} (bullets ONLY — the master keeps titles, orgs, and spans fixed)'
            : '- {"op":"update_experience","index":1,"bullets":["rewritten bullets"]}',
        ...(master ? [] : ['- {"op":"set_cover_paragraphs","items":["exactly 3 tight paragraphs, under ~230 words total"]}']),
    ].join('\n');
}
function toStrings(value, count = 24) {
    if (!Array.isArray(value))
        return [];
    return value
        .slice(0, count)
        .map((item) => String(item ?? '').slice(0, 600))
        .filter(Boolean);
}
function experienceAction(raw, master) {
    if (Number(raw.index) < 1)
        return null;
    const action = {
        op: 'update_experience',
        index: Math.floor(Number(raw.index)),
    };
    // The master save matches roles by index+title, so title/org/span edits are stripped there —
    // they would only poison the payload into a refused save.
    if (raw.title && !master)
        action.title = String(raw.title).slice(0, 200);
    if (raw.org && !master)
        action.org = String(raw.org).slice(0, 200);
    if (raw.span && !master)
        action.span = String(raw.span).slice(0, 60);
    if (raw.bullets)
        action.bullets = toStrings(raw.bullets, 8);
    return action;
}
function cleanAction(raw, master) {
    const op = String(raw.op || '');
    const text = (max) => String(raw.text ?? '').slice(0, max);
    if (op === 'set_headline')
        return { op, text: text(400) };
    if (op === 'set_summary')
        return { op, text: text(1600) };
    if (op === 'set_clearance')
        return { op, text: text(200) };
    if (op === 'set_competencies')
        return { op, items: toStrings(raw.items) };
    if (op === 'set_skills')
        return { op, items: toStrings(raw.items) };
    if (op === 'set_cover_paragraphs')
        return master ? null : { op, items: toStrings(raw.items, 6) };
    if (op === 'update_experience')
        return experienceAction(raw, master);
    return null;
}
function cleanActions(raw, master) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .slice(0, 12)
        .map((action) => cleanAction(action, master))
        .filter((action) => action !== null);
}
function guideHistory(raw) {
    if (!Array.isArray(raw))
        return '';
    return raw.slice(-8).map((entry) => {
        const speaker = entry.role === 'bot' ? 'Editor' : 'You';
        return `${speaker}: ${String(entry.text || '').slice(0, 500)}`;
    }).join('\n');
}
function parseGuideResponse(response, master) {
    let reply = 'Updated.';
    let actions = [];
    const match = String(response || '').match(/\{[\s\S]*\}/);
    if (!match)
        return { reply, actions };
    try {
        const parsed = JSON.parse(match[0]);
        reply = String(parsed.reply || reply).slice(0, 1200);
        actions = cleanActions(parsed.actions, master);
    }
    catch (err) {
        logger.warn({ err }, 'resume guide bot JSON is unparseable');
    }
    return { reply, actions };
}
/** Read the engine child's JSON document out of its stdout tail, or null when it printed none. */
function parseEngineJson(out) {
    const start = out.indexOf('{');
    if (start < 0)
        return null;
    try {
        return JSON.parse(out.slice(start));
    }
    catch {
        return null;
    }
}
/** Load the MASTER document through the engine's straight, model-free profile mapping. */
async function getMasterDocument(ctx, userSub, res) {
    const result = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, ['resume', 'base']);
    if (result.limitReason) {
        (0, career_engine_response_1.rejectEngineStart)(res, { started: false, limitReason: result.limitReason }, 'master resume load');
        return;
    }
    const parsed = result.ok ? parseEngineJson(result.out) : null;
    if (!parsed) {
        logger.error({ err: result.err.slice(-300), userSub }, 'master resume load failed');
        res.status(500).json({ error: 'master resume load failed' });
        return;
    }
    res.json(parsed);
}
async function getResumeDocument(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    if (String(req.query.id || '') === MASTER_ID) {
        await getMasterDocument(ctx, userSub, res);
        return;
    }
    const postingId = Number(req.query.id);
    if (!Number.isFinite(postingId)) {
        res.status(400).json({ error: 'id required' });
        return;
    }
    const dir = await packetDir(userSub, postingId);
    if (!dir) {
        res.status(404).json({ error: 'no generated packet â€” generate one first' });
        return;
    }
    try {
        res.json(await readDoc(dir));
    }
    catch (err) {
        logger.error({ err, userSub, postingId }, 'resume document read failed');
        res.status(500).json({ error: 'read failed' });
    }
}
/** Resolve the document a guide turn edits: packet metadata from disk, or the master sentinel. */
async function guideDocument(userSub, body) {
    if (body.postingId === MASTER_ID) {
        if (!body.resume || typeof body.resume !== 'object') {
            return { status: 400, error: 'resume required for the master document' };
        }
        // The guide needs only document.meta for the master — the surface always sends the live
        // resume in the body, and there is no packet directory to read.
        return { document: { resume: {}, cover: {}, meta: { master: true } } };
    }
    const postingId = Number(body.postingId);
    if (!Number.isFinite(postingId))
        return { status: 400, error: 'postingId + message required' };
    const dir = await packetDir(userSub, postingId);
    if (!dir)
        return { status: 404, error: 'no generated packet' };
    return { document: await readDoc(dir) };
}
async function guideResume(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const body = req.body || {};
    const postingId = String(body.postingId ?? '').slice(0, 32);
    const message = String(body.message || '').trim();
    if (!message) {
        res.status(400).json({ error: 'postingId + message required' });
        return;
    }
    try {
        const loaded = await guideDocument(userSub, body);
        if ('status' in loaded) {
            res.status(loaded.status).json({ error: loaded.error });
            return;
        }
        const { document } = loaded;
        const master = document.meta.master === true;
        const resume = body.resume && typeof body.resume === 'object' ? body.resume : document.resume;
        const cover = body.cover && typeof body.cover === 'object' ? body.cover : document.cover;
        const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, CAREER_AGENT_ID, {
            text: guidePrompt(message, resume, cover, document.meta, guideHistory(body.history)),
            taskId: `resumeedit-${userSub}`,
            workspaceFolderId: `resumeedit-${userSub}`,
            agentId: CAREER_AGENT_ID,
            agenticMode: true,
            direct: false,
            userSub,
        });
        const parsed = parseGuideResponse(result.response, master);
        logger.info({ userSub, postingId, actions: parsed.actions.length }, 'resume guide turn');
        res.json(parsed);
    }
    catch (err) {
        logger.error({ err, userSub, postingId }, 'resume guide failed');
        res.status(500).json({ error: 'guide failed' });
    }
}
/** Persist the MASTER document through the engine's whitelist write-back, returning its changelog. */
async function saveMasterResume(ctx, userSub, body, res) {
    if (!body.resume || typeof body.resume !== 'object') {
        res.status(400).json({ error: 'resume required' });
        return;
    }
    const payload = JSON.stringify({ resume: body.resume });
    if (Buffer.byteLength(payload, 'utf8') > MASTER_DOC_MAX_BYTES) {
        res.status(413).json({ ok: false, error: 'master resume payload too large' });
        return;
    }
    try {
        const result = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, ['resume', 'base-save'], { CH_RESUME_DOC: payload });
        if (result.limitReason) {
            (0, career_engine_response_1.rejectEngineStart)(res, { started: false, limitReason: result.limitReason }, 'master resume save');
            return;
        }
        const parsed = parseEngineJson(result.out);
        if (!parsed || parsed.ok !== true) {
            const refusal = String(parsed?.error || '').slice(0, 400);
            logger.error({ userSub, refusal, err: result.err.slice(-300) }, 'master resume save failed');
            res.status(refusal ? 422 : 500).json({ ok: false, error: refusal || 'master resume save failed' });
            return;
        }
        const changelog = Array.isArray(parsed.changelog)
            ? parsed.changelog.slice(0, 50).map((line) => String(line).slice(0, 500)) : [];
        logger.info({ userSub, changed: parsed.changed === true, entries: changelog.length }, 'master resume saved');
        res.json({ ok: true, changed: parsed.changed === true, changelog });
    }
    catch (err) {
        logger.error({ err, userSub }, 'master resume save failed');
        res.status(500).json({ error: 'save failed' });
    }
}
async function saveResume(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const body = req.body || {};
    if (body.postingId === MASTER_ID) {
        await saveMasterResume(ctx, userSub, body, res);
        return;
    }
    const postingId = Number(body.postingId);
    if (!Number.isFinite(postingId) || !body.resume || !body.cover) {
        res.status(400).json({ error: 'postingId + resume + cover required' });
        return;
    }
    const dir = await packetDir(userSub, postingId);
    if (!dir) {
        res.status(404).json({ error: 'no generated packet' });
        return;
    }
    const lease = (0, career_engine_runner_1.tryAcquireRun)(userSub, 'user-store');
    if ((0, career_engine_response_1.rejectEngineClaim)(res, lease, 'resume rerender'))
        return;
    try {
        const result = await saveAndRerenderPacket(ctx, userSub, postingId, dir, body.resume, body.cover, lease);
        if (result.limitReason) {
            (0, career_engine_response_1.rejectEngineStart)(res, { started: false, limitReason: result.limitReason }, 'resume rerender');
            return;
        }
        if (!result.ok) {
            logger.error({ err: result.err, userSub, postingId }, 'resume rerender failed');
            res.status(500).json({ ok: false, error: result.err.slice(-400) });
            return;
        }
        res.json({ ok: true });
    }
    catch (err) {
        logger.error({ err, userSub, postingId }, 'resume save failed');
        res.status(500).json({ error: 'save failed' });
    }
    finally {
        (0, career_engine_runner_1.releaseRun)(lease);
    }
}
/**
 * @description Mounts structured resume load, bot guide, and transactional save routes. All three
 * accept `master` as the document id alongside numeric posting ids: the master case reads and
 * writes the durable career profile through the engine's `resume base`/`resume base-save` verbs.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used for bot execution and brokered engine dispatch.
 * @returns Nothing.
 */
function registerCareerResumeStudio(router, ctx) {
    router.get('/resume/doc', (req, res) => getResumeDocument(ctx, req, res));
    router.post('/resume/guide', (req, res) => guideResume(ctx, req, res));
    router.post('/resume/save', (req, res) => saveResume(ctx, req, res));
}
//# sourceMappingURL=career-resume-studio-routes.js.map