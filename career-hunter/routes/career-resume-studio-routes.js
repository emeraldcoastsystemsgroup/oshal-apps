"use strict";
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
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const logger_1 = require("@/shared/logger");
const agent_management_1 = require("@/features/agent-management");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const career_hunter_routes_1 = require("./career-hunter-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'career-resume-studio-routes' });
/** The career-hunter agent (the app's ONE bot) edits the resume — cost lands under its agentId. */
const CAREER_AGENT_ID = 'cb000000-0000-0000-0000-000000000001';
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
/** Resolve a posting's packet directory by its `<...>__<postingId>` name, confined to the
 *  user's store. user_signals.resume_path holds stale pre-migration Windows paths for
 *  imported packets, so we scan the per-user applications dir rather than trust that path. */
function packetDir(userSub, postingId) {
    const appsDir = path.join((0, career_hunter_routes_1.userPaths)(userSub).userDir, 'applications');
    const suffix = `__${postingId}`;
    try {
        const match = fs.readdirSync(appsDir, { withFileTypes: true }).find((d) => d.isDirectory() && d.name.endsWith(suffix) && fs.existsSync(path.join(appsDir, d.name, 'application.json')));
        return match ? path.join(appsDir, match.name) : null;
    }
    catch {
        return null;
    }
}
/** Read the structured resume + cover the surface edits. */
function readDoc(dir) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'application.json'), 'utf8'));
    const gen = (data.generated || {});
    return {
        resume: gen.resume || {},
        cover: gen.cover || {},
        meta: { postingId: data.posting_id, company: data.company, title: data.title, url: data.url, include_oshal: data.include_oshal },
    };
}
/** Persist edited resume/cover back into application.json.generated (preserving the rest). */
function writeDoc(dir, resume, cover) {
    const p = path.join(dir, 'application.json');
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const gen = (data.generated || {});
    data.generated = { ...gen, resume, cover };
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}
/** Build the bot prompt: current document + the user's turn + a strict output contract. */
function guidePrompt(message, resume, cover, meta, history) {
    return [
        'You are editing the candidate\'s tailored RESUME + COVER LETTER for a specific job, in a live editor.',
        `Target role: ${String(meta.title || '')} at ${String(meta.company || '')}.`,
        '',
        'HARD TRUTH RULES (never violate): edit ONLY the facts already present — NEVER invent or add an',
        'employer, title, date, metric, skill, certification, clearance, or claim. You may reorder, sharpen,',
        'reword, and re-emphasize. Real titles only (exactly as they appear in the profile),',
        'never inflated to CTO/VP/Chief unless the profile says so. Player-coach voice ("led the team',
        'that built", "led the effort"), never "I built X" as if solo. First person implied, no third-person pronoun or name.',
        'NEVER use em or en dashes. Keep bullets to 1-2 lines, strong past-tense lead verbs, outcome first.',
        '',
        'CURRENT RESUME (JSON):', JSON.stringify(resume).slice(0, 12000),
        'CURRENT COVER (JSON):', JSON.stringify(cover).slice(0, 4000),
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
        '- {"op":"update_experience","index":1,"bullets":["rewritten bullets"]}   // 1-based; may also set title/org/span',
        '- {"op":"set_cover_paragraphs","items":["exactly 3 tight paragraphs, under ~230 words total"]}',
    ].join('\n');
}
/** Whitelist + normalize the bot's proposed actions — never trust raw model output. */
function cleanActions(raw) {
    if (!Array.isArray(raw))
        return [];
    const str = (v, max = 4000) => String(v ?? '').slice(0, max);
    const strs = (v, n = 24) => (Array.isArray(v) ? v.slice(0, n).map((x) => str(x, 600)).filter(Boolean) : []);
    const out = [];
    for (const a of raw.slice(0, 12)) {
        const o = a;
        const op = String(o.op || '');
        if (op === 'set_headline')
            out.push({ op, text: str(o.text, 400) });
        else if (op === 'set_summary')
            out.push({ op, text: str(o.text, 1600) });
        else if (op === 'set_clearance')
            out.push({ op, text: str(o.text, 200) });
        else if (op === 'set_competencies')
            out.push({ op, items: strs(o.items) });
        else if (op === 'set_skills')
            out.push({ op, items: strs(o.items) });
        else if (op === 'set_cover_paragraphs')
            out.push({ op, items: strs(o.items, 6) });
        else if (op === 'update_experience' && Number(o.index) >= 1) {
            const e = { op, index: Math.floor(Number(o.index)) };
            if (o.title)
                e.title = str(o.title, 200);
            if (o.org)
                e.org = str(o.org, 200);
            if (o.span)
                e.span = str(o.span, 60);
            if (o.bullets)
                e.bullets = strs(o.bullets, 8);
            out.push(e);
        }
    }
    return out;
}
/**
 * @description Mount the Resume Studio routes on the career-hunter router.
 * GET /resume/doc?id= (load), POST /resume/guide (bot edits), POST /resume/save (+ rerender).
 * @param router - the career-hunter app router
 * @param ctx - app context (for the bot client / cost capture)
 */
function registerCareerResumeStudio(router, ctx) {
    // Load the structured resume + cover for a generated packet (the live-preview source).
    router.get('/resume/doc', (req, res) => {
        const userSub = (0, career_hunter_routes_1.callerSub)(req);
        if (!userSub) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        const postingId = Number(req.query.id);
        if (!Number.isFinite(postingId)) {
            res.status(400).json({ error: 'id required' });
            return;
        }
        const dir = packetDir(userSub, postingId);
        if (!dir) {
            res.status(404).json({ error: 'no generated packet — generate one first' });
            return;
        }
        try {
            res.json(readDoc(dir));
        }
        catch (err) {
            logger.error({ err, postingId }, 'resume doc read failed');
            res.status(500).json({ error: 'read failed' });
        }
    });
    // One conversational edit turn: the bot returns { reply, actions } the surface applies.
    router.post('/resume/guide', async (req, res) => {
        const userSub = (0, career_hunter_routes_1.callerSub)(req);
        if (!userSub) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        const body = req.body || {};
        const postingId = Number(body.postingId);
        const message = String(body.message || '').trim();
        if (!Number.isFinite(postingId) || !message) {
            res.status(400).json({ error: 'postingId + message required' });
            return;
        }
        const dir = packetDir(userSub, postingId);
        if (!dir) {
            res.status(404).json({ error: 'no generated packet' });
            return;
        }
        try {
            // Prefer the client's in-progress edits (so multi-turn builds on the live preview), else disk.
            const doc = readDoc(dir);
            const resume = (body.resume && typeof body.resume === 'object') ? body.resume : doc.resume;
            const cover = (body.cover && typeof body.cover === 'object') ? body.cover : doc.cover;
            const history = Array.isArray(body.history)
                ? body.history.slice(-8).map((h) => `${h.role === 'bot' ? 'Editor' : 'You'}: ${String(h.text || '').slice(0, 500)}`).join('\n')
                : '';
            // agenticMode:true (NOT direct/plain-LLM): the career agent runs a CLI harness
            // (openai-codex), which has no plain-LLM path — agenticMode:false raises
            // "activeLlm.generateResponse is not a function" and the guide silently no-ops.
            // The persona keeps this agentic turn light and returns the {reply,actions} JSON.
            const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, CAREER_AGENT_ID, {
                text: guidePrompt(message, resume, cover, doc.meta, history),
                taskId: `resumeedit-${userSub}`, workspaceFolderId: `resumeedit-${userSub}`,
                agentId: CAREER_AGENT_ID, agenticMode: true, direct: false, userSub,
            });
            let reply = 'Updated.';
            let actions = [];
            const m = String(result.response || '').match(/\{[\s\S]*\}/);
            if (m) {
                try {
                    const parsed = JSON.parse(m[0]);
                    reply = String(parsed.reply || reply).slice(0, 1200);
                    actions = cleanActions(parsed.actions);
                }
                catch (err) {
                    logger.warn({ err: err.message }, 'resume guide: bot JSON unparseable');
                }
            }
            logger.info({ userSub, postingId, actions: actions.length }, 'resume guide turn');
            res.json({ reply, actions });
        }
        catch (err) {
            logger.error({ err, postingId }, 'resume guide failed');
            res.status(500).json({ error: 'guide failed' });
        }
    });
    // Persist the edited resume/cover and re-render the PDFs (no LLM — generate.rerender_packet).
    router.post('/resume/save', (req, res) => {
        const userSub = (0, career_hunter_routes_1.callerSub)(req);
        if (!userSub) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        const body = req.body || {};
        const postingId = Number(body.postingId);
        if (!Number.isFinite(postingId) || !body.resume || !body.cover) {
            res.status(400).json({ error: 'postingId + resume + cover required' });
            return;
        }
        const dir = packetDir(userSub, postingId);
        if (!dir) {
            res.status(404).json({ error: 'no generated packet' });
            return;
        }
        try {
            writeDoc(dir, body.resume, body.cover);
            // Self-heal the board + PDF-serve paths BEFORE rerender: imported rows hold stale
            // pre-migration Windows paths, and the engine's rerender_packet derives the packet
            // dir from resume_path — so point it at the container packet first.
            try {
                const sdb = (0, career_hunter_routes_1.openUserDb)(userSub, false);
                if (sdb) {
                    try {
                        sdb.prepare('UPDATE user_signals SET resume_path=?, cover_path=? WHERE posting_id=?')
                            .run(path.join(dir, 'Resume_ATS.pdf'), path.join(dir, 'CoverLetter.pdf'), postingId);
                    }
                    finally {
                        sdb.close();
                    }
                }
            }
            catch (e) {
                logger.warn({ err: e }, 'resume save: path self-heal skipped');
            }
            const r = (0, career_hunter_routes_1.runCli)(userSub, ['rerender'], { CH_JOB: String(postingId) });
            if (!r.ok) {
                logger.error({ err: r.err }, 'rerender failed');
                res.status(500).json({ ok: false, error: r.err.slice(-400) });
                return;
            }
            res.json({ ok: true });
        }
        catch (err) {
            logger.error({ err, postingId }, 'resume save failed');
            res.status(500).json({ error: 'save failed' });
        }
    });
}
//# sourceMappingURL=career-resume-studio-routes.js.map