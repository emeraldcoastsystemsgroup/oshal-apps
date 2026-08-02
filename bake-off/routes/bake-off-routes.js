"use strict";
/**
 * AI Bake-Off — the HTTP surface: lane roster, job CRUD, out-of-band runs, and the report.
 *
 * AUTH POSTURE. The manifest mounts this router with `requiresAuth: true`, and every handler ALSO
 * resolves `callerSub(req)` and refuses without one. Both, deliberately: the mount is the wall,
 * the per-handler check is what makes each read owner-scoped, and every store query is
 * parameterised on that sub (with owner-or-operator RLS underneath as the backstop). Nothing here
 * is anonymously callable, because everything here either exposes the caller's prompts and
 * outputs or spends their money on an LLM.
 *
 * Long work never runs on the request path (the kalshi lesson — a 23-second scan on a GET). A
 * bake-off is N model calls plus N grades, so `POST /jobs/:id/run` answers 202 with a run id and
 * the surface polls the report.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation — GET / (surface), GET /lanes (caller-scoped roster), job CRUD, POST /jobs/:id/run (202, single-flighted), GET /jobs/:id/report (the deterministic cost/quality table + recommendation), GET /jobs/:id/runs, GET /runs/:runId/output/:agentId, and POST /jobs/:id/verdict (explicit opt-in narrative on this app's analyst bot — never automatic, because it spends).
 *
 * @module bake-off-routes
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
exports.createBakeOffRoutes = createBakeOffRoutes;
const express_1 = require("express");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const agent_management_1 = require("@/features/agent-management");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const caller_sub_1 = require("@/app/routes/caller-sub");
const bake_off_scoring_1 = require("./bake-off-scoring");
const bake_off_engine_1 = require("./bake-off-engine");
const bake_off_store_1 = require("./bake-off-store");
const log = (0, logger_1.createChildLogger)({ module: 'bake-off-routes' });
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (ADR-085 D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/**
 * @description Resolve the bundled surface directory, captured at FACTORY time.
 *
 * Never read the env var inside a handler: it points at whichever package mounted last, so with
 * two apps installed the wrong surface is served (BUILDING-EXTENSIONS.md §"Bundled assets").
 *
 * @param appPackageDir - This package's directory from the per-package context.
 * @returns The first candidate directory that actually holds bake-off.html.
 */
function surfaceDir(appPackageDir) {
    const candidates = [
        appPackageDir ? path.join(appPackageDir, 'tools') : '',
        LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools') : '',
        path.resolve(__dirname, '../tools'),
    ].filter(Boolean);
    return candidates.find((d) => fs.existsSync(path.join(d, 'bake-off.html'))) || candidates[candidates.length - 1];
}
/** Resolve the caller or answer 401. Returns null when it has already replied. */
function requireSub(req, res) {
    const sub = (0, caller_sub_1.callerSub)(req);
    if (!sub) {
        res.status(401).json({ error: 'authentication required' });
        return null;
    }
    return sub;
}
/** Wrap a handler so every throw is logged at ERROR and answered as a 500, never swallowed. */
function guarded(name, fn) {
    return async (req, res) => {
        try {
            await fn(req, res);
        }
        catch (err) {
            log.error({ err, stack: err?.stack, route: name, url: req.originalUrl }, 'bake-off route failed');
            if (!res.headersSent)
                res.status(500).json({ error: err?.message || 'internal error' });
        }
    };
}
/** GET /lanes — the harness × provider lanes this caller may race. */
function handleLanes() {
    return guarded('GET /lanes', async (req, res) => {
        const sub = requireSub(req, res);
        if (!sub)
            return;
        const lanes = (0, bake_off_engine_1.discoverLanes)(req);
        res.json({ lanes, maxLanes: bake_off_scoring_1.BAKE_OFF_DEFAULTS.maxLanes, limits: bake_off_scoring_1.BAKE_OFF_LIMITS, defaults: bake_off_scoring_1.BAKE_OFF_DEFAULTS });
    });
}
/** GET /jobs + POST /jobs — the caller's own jobs. */
function handleJobs(pool) {
    return {
        list: guarded('GET /jobs', async (req, res) => {
            const sub = requireSub(req, res);
            if (!sub)
                return;
            res.json({ jobs: await (0, bake_off_store_1.listJobs)(pool, sub) });
        }),
        create: guarded('POST /jobs', async (req, res) => {
            const sub = requireSub(req, res);
            if (!sub)
                return;
            const parsed = (0, bake_off_scoring_1.validateJobSpec)(req.body);
            if (!parsed.ok) {
                res.status(400).json({ error: parsed.error });
                return;
            }
            res.status(201).json({ job: await (0, bake_off_store_1.insertJob)(pool, sub, parsed.spec) });
        }),
        remove: guarded('DELETE /jobs/:id', async (req, res) => {
            const sub = requireSub(req, res);
            if (!sub)
                return;
            const removed = await (0, bake_off_store_1.deleteJob)(pool, sub, String(req.params.id));
            if (!removed) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ ok: true });
        }),
    };
}
/** POST /jobs/:id/run — start an out-of-band race; 202 with the run id. */
function handleRun(ctx, pool) {
    return guarded('POST /jobs/:id/run', async (req, res) => {
        const sub = requireSub(req, res);
        if (!sub)
            return;
        const job = await (0, bake_off_store_1.getJob)(pool, sub, String(req.params.id));
        if (!job) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        const open = (0, bake_off_engine_1.inFlightRun)(job.id);
        if (open) {
            res.status(202).json({ runId: open, alreadyRunning: true });
            return;
        }
        const lanes = (0, bake_off_engine_1.selectLanes)((0, bake_off_engine_1.discoverLanes)(req), job.laneAgentIds);
        if (lanes.length < 2) {
            res.status(409).json({
                error: `a bake-off needs at least two lanes; ${lanes.length} available to you. Install or start a bot on a second harness/provider pairing, then try again.`,
                lanes,
            });
            return;
        }
        const runId = await (0, bake_off_engine_1.runBakeOff)(ctx, sub, job, lanes);
        res.status(202).json({ runId, lanes: lanes.length });
    });
}
/** GET /jobs/:id/report — the deterministic table + recommendation for one run. */
function handleReport(pool) {
    return guarded('GET /jobs/:id/report', async (req, res) => {
        const sub = requireSub(req, res);
        if (!sub)
            return;
        const job = await (0, bake_off_store_1.getJob)(pool, sub, String(req.params.id));
        if (!job) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        const run = await (0, bake_off_store_1.getRun)(pool, sub, job.id, req.query.runId ? String(req.query.runId) : null);
        if (!run) {
            res.json({ job, run: null, report: null });
            return;
        }
        const rows = await (0, bake_off_store_1.listResults)(pool, sub, run.id, false);
        res.json({
            job, run,
            report: (0, bake_off_scoring_1.buildReport)(rows, { qualityBar: job.qualityBar, monthlyVolume: job.monthlyVolume }),
            // Per-lane run tracing is the framework's, not this app's — deep-link rather than re-derive.
            traceHint: '/api/trace/',
        });
    });
}
/** GET /jobs/:id/runs and GET /runs/:runId/output/:agentId — history and one lane's raw output. */
function handleHistory(pool) {
    return {
        runs: guarded('GET /jobs/:id/runs', async (req, res) => {
            const sub = requireSub(req, res);
            if (!sub)
                return;
            const job = await (0, bake_off_store_1.getJob)(pool, sub, String(req.params.id));
            if (!job) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({ runs: await (0, bake_off_store_1.listRuns)(pool, sub, job.id) });
        }),
        output: guarded('GET /runs/:runId/output/:agentId', async (req, res) => {
            const sub = requireSub(req, res);
            if (!sub)
                return;
            // Owner-scoped read: a run the caller does not own yields no rows, so a foreign runId is
            // indistinguishable from a missing one (no existence leak).
            const rows = await (0, bake_off_store_1.listResults)(pool, sub, String(req.params.runId), true);
            const row = rows.find((r) => r.laneAgentId === String(req.params.agentId));
            if (!row) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json({
                lane: { bot: row.laneBot, harness: row.laneHarness, provider: row.laneProvider, model: row.observedModel },
                ok: row.ok, output: row.output, error: row.error,
                judge: { score: row.judgeScore, mode: row.judgeMode, rationale: row.judgeRationale, dimensions: row.dimensions },
                cost: { usd: row.costUsd, totalTokens: row.totalTokens, durationMs: row.durationMs },
                taskId: row.taskId,
            });
        }),
    };
}
/** The verdict prompt — the analyst reads the SAME computed table the human sees. */
function verdictPrompt(job, report) {
    return [
        `Bake-off verdict for the job "${job.name}".`,
        `Quality bar: ${job.qualityBar}/100. Assumed volume: ${job.monthlyVolume} runs/month.`,
        'The table below is already computed and is authoritative — do not recompute it, do not pick a',
        'different winner, and do not soften a `blocked` reason. Write 4-8 sentences for the person who',
        'pays the bill: what to switch to, what it saves, and which caveat would most change the answer.',
        'If `blocked` is set, explain what has to change before a recommendation is possible.',
        '',
        JSON.stringify(report),
    ].join('\n');
}
/** POST /jobs/:id/verdict — the analyst narrates the report. Explicit, because it spends. */
function handleVerdict(ctx, pool) {
    return guarded('POST /jobs/:id/verdict', async (req, res) => {
        const sub = requireSub(req, res);
        if (!sub)
            return;
        const job = await (0, bake_off_store_1.getJob)(pool, sub, String(req.params.id));
        if (!job) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        const run = await (0, bake_off_store_1.getRun)(pool, sub, job.id, req.body?.runId ? String(req.body.runId) : null);
        if (!run) {
            res.status(409).json({ error: 'no run to narrate — start a run first' });
            return;
        }
        const rows = await (0, bake_off_store_1.listResults)(pool, sub, run.id, false);
        const report = (0, bake_off_scoring_1.buildReport)(rows, { qualityBar: job.qualityBar, monthlyVolume: job.monthlyVolume });
        try {
            const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, bake_off_engine_1.BAKE_OFF_ANALYST_AGENT_ID, {
                text: verdictPrompt(job, report), taskId: `bakeoff-verdict-${run.id}`,
                workspaceFolderId: 'bake-off', agentId: bake_off_engine_1.BAKE_OFF_ANALYST_AGENT_ID,
                userSub: sub, direct: true, agenticMode: false,
            });
            res.json({ verdict: String(result.response ?? ''), costUsd: result.cost ?? 0, model: result.model ?? null });
        }
        catch (err) {
            // A missing narrator must not hide the evidence: the table stands on its own.
            log.error({ err, stack: err?.stack, sub, jobId: job.id }, 'Bake-off verdict narration failed');
            res.status(503).json({
                error: 'the bake-off analyst is unavailable — the table and recommendation above stand on their own',
                detail: err?.message || String(err),
            });
        }
    });
}
/**
 * @description Build the /api/bake-off router.
 *
 * Mounted by the app loader at activation per the manifest (`requiresAuth: true`,
 * `requiresContext: true`). The schema is ensured once here at factory time rather than per
 * request, and a failure is logged loudly — the routes still mount so the surface can report the
 * problem instead of 404ing.
 *
 * @param ctx - The framework app context (pool, orchestrator, appPackageDir).
 * @returns The Express router for this package.
 */
function createBakeOffRoutes(ctx) {
    const router = (0, express_1.Router)();
    const pool = ctx.pool;
    const dir = surfaceDir(ctx.appPackageDir);
    (0, bake_off_store_1.ensureBakeOffSchema)(pool).catch((err) => log.error({ err, stack: err?.stack }, 'bake-off schema bootstrap failed — the surface will report empty state'));
    const jobs = handleJobs(pool);
    const history = handleHistory(pool);
    router.get(['/', '/app'], (_req, res) => res.sendFile(path.join(dir, 'bake-off.html')));
    router.get('/lanes', handleLanes());
    router.get('/jobs', jobs.list);
    router.post('/jobs', jobs.create);
    router.delete('/jobs/:id', jobs.remove);
    router.post('/jobs/:id/run', handleRun(ctx, pool));
    router.get('/jobs/:id/report', handleReport(pool));
    router.get('/jobs/:id/runs', history.runs);
    router.get('/runs/:runId/output/:agentId', history.output);
    router.post('/jobs/:id/verdict', handleVerdict(ctx, pool));
    log.info({ surfaceDir: dir }, 'bake-off routes mounted');
    return router;
}
//# sourceMappingURL=bake-off-routes.js.map