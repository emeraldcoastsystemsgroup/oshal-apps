"use strict";
/**
 * Bot video routes — the Video Studio (?app=video) API. Mirrors bot-presentation-routes:
 * the video-director bot drafts a storyboard (LLM, metered), the controller renders a real
 * .mp4 deterministically (Veo + ffmpeg via the video-generation slice) and saves it to the
 * caller's Files storage under the bot's own subfolder. Phase 1 = generate → store →
 * preview/download; publishing is Phase 3.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-22 12:25:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial Video Studio routes (storyboard / generate / list / ui) for the thin vertical slice (ADR-036 bot-owned app).
 * 2026-07-19 21:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into the video app package (ADR-085 Wave 3, "skill with a surface"). Standard (ctx) factory; the surface serves from ctx.appPackageDir/tools (load-time env fallback, D10). Shared core helpers import via @/ aliases: storage-target, inline-bot-execution, connectors-routes, and the series conductor (series-pipeline/orchestrator/dispatch/drive) + video-generation slice — all framework-resident per ADR-093. ensureVideosSchema now appends buildOwnerRlsPolicyStatements (owner-RLS on the packaged lazy DDL). The video-director + screenplay-writer inline nodes (BOTH swarm-bot-registry blocks) and migrations 066/067 stay framework-resident; this package ships migration COPIES for fresh installs.
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
exports.ensureVideosSchema = ensureVideosSchema;
exports.createBotVideoRoutes = createBotVideoRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const agent_management_1 = require("@/features/agent-management");
const video_generation_1 = require("@/features/video-generation");
const storage_target_1 = require("@/app/routes/storage-target");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const video_generation_2 = require("@/features/video-generation");
const series_dispatch_1 = require("@/app/series-dispatch");
const series_pipeline_1 = require("@/app/series-pipeline");
const series_orchestrator_1 = require("@/app/series-orchestrator");
const series_drive_1 = require("@/app/series-drive");
const logger = (0, logger_1.createChildLogger)({ module: 'video-routes' });
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/**
 * @description Resolve the Video Studio page from the package's tools/ dir
 * (ctx.appPackageDir, captured at factory time per D10), with the load-time env
 * fallback and a final __dirname fallback into this package's own tree.
 * @param appPackageDir - This package's directory from the per-package context.
 * @returns The first existing candidate path (or the last candidate for sendFile's 404 path).
 */
function videoHtml(appPackageDir) {
    const candidates = [
        appPackageDir ? path.join(appPackageDir, 'tools', 'video.html') : '',
        LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools', 'video.html') : '',
        path.resolve(__dirname, '../tools/video.html'),
    ].filter(Boolean);
    return candidates.find((p) => fs.existsSync(p)) ?? candidates[candidates.length - 1];
}
/** The Video Studio's own bot — drafts storyboards, owns the video store. */
const VIDEO_DIRECTOR_AGENT_ID = 'a0000000-0000-0000-0000-000000000048';
/** Bot-scoped store path for generated videos (ADR-043). */
const VIDEO_SUBFOLDER = `oshal/${VIDEO_DIRECTOR_AGENT_ID}`;
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
/** Signed-in caller's OIDC sub. */
function callerSub(req) {
    const u = req.oidc?.user;
    return u?.sub ? String(u.sub) : null;
}
/** Validate an optional per-save target override (the "Save to…" choice). */
function cleanOverride(t) {
    const o = (t || {});
    const provider = String(o.provider || '');
    if (!['dropbox', 'oshal-local', 'github'].includes(provider))
        return undefined;
    return { provider: provider, folder: o.folder ? String(o.folder) : undefined, repo: o.repo ? String(o.repo) : undefined };
}
/** Normalize the caller's shape controls into a safe `VideoShape` with defaults + clamps. */
function cleanShape(raw) {
    const o = (raw || {});
    const aspect = String(o.aspectRatio || '9:16');
    const aspectRatio = aspect === '16:9' || aspect === '1:1' ? aspect : '9:16';
    return {
        style: String(o.style || 'clean explainer').slice(0, 120),
        tone: String(o.tone || 'energetic').slice(0, 120),
        aspectRatio,
        targetSeconds: (0, video_generation_1.clampTargetSeconds)(Number(o.targetSeconds) || 20),
        captions: o.captions !== false,
        voice: o.voice && o.voice !== 'none' ? String(o.voice).slice(0, 80) : 'none',
        music: o.music && o.music !== 'none' ? String(o.music).slice(0, 80) : 'none',
    };
}
/** Build the director turn: idea + shape → strict storyboard JSON. */
function directorPrompt(idea, shape) {
    return [
        'Draft a short-form video storyboard.',
        `Idea: ${idea}`,
        `Shape: style="${shape.style}", tone="${shape.tone}", aspectRatio=${shape.aspectRatio},`,
        `targetSeconds=${shape.targetSeconds}, captions=${shape.captions}, voice=${shape.voice === 'none' ? 'none' : 'on'}.`,
        'Each scene must be 2–8s; split targetSeconds across enough scenes (max 12) to fill it.',
        'Respond with ONLY the JSON object: {"title":"...","scenes":[{"prompt":"...","durationSec":6,"narration":"...","caption":"..."}]}.',
        shape.voice === 'none' ? 'voice is none — every narration must be "".' : '',
        shape.captions ? '' : 'captions are off — every caption must be "".',
    ].filter(Boolean).join('\n');
}
/** Lightweight per-user record of each generated video (drives "My videos"). */
async function ensureVideosSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'video routes',
        statements: [
            `CREATE TABLE IF NOT EXISTS oshal_videos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_sub TEXT NOT NULL,
        title TEXT NOT NULL,
        file_name TEXT NOT NULL,
        provider TEXT,
        download_url TEXT,
        url TEXT,
        seconds INTEGER,
        scenes INTEGER,
        cost_usd NUMERIC(10,2),
        shape JSONB,
        storyboard JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
            'CREATE INDEX IF NOT EXISTS idx_videos_user ON oshal_videos(user_sub, created_at DESC)',
            // ADR-085 store contract: packaged lazy DDL applies tier-1 owner-RLS at its own chokepoint.
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_videos', 'user_sub'),
        ],
        requirements: [
            {
                table: 'oshal_videos',
                columns: ['id', 'user_sub', 'title', 'file_name', 'provider', 'download_url', 'url', 'seconds', 'scenes', 'cost_usd', 'shape', 'storyboard', 'created_at'],
            },
        ],
    });
}
/** Map a DB row to the surface's video shape. */
function toVideo(r, over) {
    return {
        title: r.title, fileName: r.file_name, provider: r.provider,
        downloadUrl: over?.downloadUrl ?? r.download_url, url: over?.url ?? r.url,
        seconds: r.seconds, scenes: r.scenes, costUsd: r.cost_usd,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    };
}
/** Record the estimated Veo generation cost under the director bot + owner sub. */
function recordVeoCost(ctx, sub, taskId, seconds, costUsd) {
    ctx.swarm?.costTrackingService?.recordCost({
        taskId, agentId: VIDEO_DIRECTOR_AGENT_ID, providerId: 'vertex-veo',
        modelId: process.env.VERTEX_VEO_MODEL || 'veo-3.1-generate-001',
        inputTokens: 0, outputTokens: 0, inputCost: 0, outputCost: costUsd, totalCost: costUsd,
        currency: 'USD', estimated: true, requestCount: seconds, ownerSub: sub,
    }).catch((err) => logger.warn({ err: err.message }, 'record Veo cost failed'));
}
/**
 * @description Creates the Video Studio routes (the packaged /api/video surface). The
 * director bot drafts storyboards; the render service produces the real .mp4. All
 * data/write routes require an authenticated caller (auth: oidc in the manifest — the
 * same requiresAuth posture core server.ts mounted, ADR-085 D2).
 * @param ctx - app context (pool, orchestrator, swarm cost tracking, appPackageDir for
 *              the bundled surface)
 * @returns Express Router for /api/video
 */
function createBotVideoRoutes(ctx) {
    const router = (0, express_1.Router)();
    const uiHtml = videoHtml(ctx.appPackageDir);
    void ensureVideosSchema(ctx.pool).catch((err) => logger.warn({ err: err?.message }, 'videos schema ensure failed'));
    /** GET /ui — the Video Studio surface (bundled in this package's tools/). */
    router.get('/ui', (_req, res) => {
        res.sendFile(uiHtml, (err) => {
            if (err) {
                logger.error({ err }, 'serve video UI failed');
                res.status(404).send('Page not found');
            }
        });
    });
    /** POST /storyboard — director drafts a scene plan from an idea + shape. */
    router.post('/storyboard', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const body = req.body;
        const idea = String(body.idea || '').trim();
        if (!idea) {
            res.status(400).json({ error: 'idea required' });
            return;
        }
        try {
            const shape = cleanShape(body.shape);
            const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, VIDEO_DIRECTOR_AGENT_ID, {
                text: directorPrompt(idea, shape), taskId: `video-sb-${sub}`, workspaceFolderId: `video-sb-${sub}`,
                agentId: VIDEO_DIRECTOR_AGENT_ID, agenticMode: true, direct: true, userSub: sub,
            });
            const m = String(result.response || '').match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(m ? m[0] : String(result.response));
            const storyboard = (0, video_generation_1.sanitizeStoryboard)(parsed, shape, idea);
            const seconds = (0, video_generation_1.storyboardSeconds)(storyboard);
            res.json({ storyboard, shape, seconds, estCostUsd: Number((seconds * (0, video_generation_1.veoCostPerSecond)()).toFixed(2)) });
        }
        catch (err) {
            logger.error({ err }, 'storyboard generation failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /generate — render the (possibly edited) storyboard into a real .mp4 and save it. */
    router.post('/generate', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const body = req.body;
        try {
            const shape = cleanShape(body.shape);
            const storyboard = (0, video_generation_1.sanitizeStoryboard)(body.storyboard, shape, 'Untitled video');
            const taskId = `video-${sub}-${storyboard.scenes.length}-${(0, video_generation_1.storyboardSeconds)(storyboard)}`;
            const rendered = await (0, video_generation_1.renderVideo)(storyboard, shape);
            const fileName = storyboard.title.replace(/[^\w.\- ]/g, '_').slice(0, 80) + '.mp4';
            const saved = await (0, storage_target_1.saveContent)(ctx, sub, 'files', fileName, rendered.mp4, cleanOverride(body.saveTo), VIDEO_SUBFOLDER);
            const savedName = (saved.location || '').split('/').pop() || fileName;
            recordVeoCost(ctx, sub, taskId, rendered.durationSec, rendered.estimatedCostUsd);
            ctx.pool.query(`INSERT INTO oshal_videos (user_sub, title, file_name, provider, download_url, url, seconds, scenes, cost_usd, shape, storyboard)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [sub, storyboard.title, savedName, saved.provider, saved.downloadUrl ?? null, saved.url ?? null,
                rendered.durationSec, storyboard.scenes.length, rendered.estimatedCostUsd, JSON.stringify(shape), JSON.stringify(storyboard)]).catch((err) => logger.warn({ err: err?.message }, 'record video failed'));
            logger.info({ sub, provider: saved.provider, seconds: rendered.durationSec, cost: rendered.estimatedCostUsd }, 'video generated + saved');
            res.json({ ok: true, provider: saved.provider, savedTo: saved.location, downloadUrl: saved.downloadUrl, url: saved.url, seconds: rendered.durationSec, estCostUsd: rendered.estimatedCostUsd });
        }
        catch (err) {
            logger.error({ err }, 'video generation failed');
            res.status(502).json({ error: err.message });
        }
    });
    /**
     * POST /series — describe a SERIES; the swarm writes it, you approve the scripts, the remote
     * Vids node renders it, post-production assembles it.
     *
     * This creates the `video-series` ticket and its `video_series` row and stops. It does NOT
     * render: the graph workflow's screenplay-writer stage writes the episodes, an approval gate
     * holds them for the operator, and only then does the render stage touch the node. Catching a
     * bad script before the render is the whole point of the gate — a bad script caught afterwards
     * costs real Veo credits.
     */
    router.post('/series', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const body = (req.body ?? {});
        const title = String(body.title ?? '').trim();
        const premise = String(body.premise ?? '').trim();
        const episodeCount = Number(body.episodeCount ?? 1);
        const scenesPerEpisode = Number(body.scenesPerEpisode ?? 4);
        const orientation = String(body.orientation ?? 'Landscape');
        const styleLock = String(body.styleLock ?? '').trim() || null;
        const characterImagePath = String(body.characterImagePath ?? '').trim() || null;
        const cast = Array.isArray(body.cast) ? body.cast : [];
        if (!title || !premise) {
            res.status(400).json({ error: 'title and premise are required' });
            return;
        }
        if (!Number.isInteger(episodeCount) || episodeCount < 1 || episodeCount > 20) {
            res.status(400).json({ error: 'episodeCount must be 1–20' });
            return;
        }
        if (!Number.isInteger(scenesPerEpisode) || scenesPerEpisode < 2 || scenesPerEpisode > 10) {
            res.status(400).json({ error: 'scenesPerEpisode must be 2–10 (four is the proven shape)' });
            return;
        }
        try {
            const ticket = await ctx.ticketService.createTicket({
                title: `Write & render "${title}" (${episodeCount} episode${episodeCount === 1 ? '' : 's'})`,
                ticketType: 'video-series',
                description: `Series: ${title}\n\nPremise: ${premise}\n\n`
                    + `Episodes: ${episodeCount}. Scenes per episode: ${scenesPerEpisode}. Orientation: ${orientation}.\n`
                    + (styleLock ? `Style lock: ${styleLock}\n` : '')
                    + (cast.length ? `Cast provided by the user: ${JSON.stringify(cast)}\n` : 'Cast: invent one that fits.\n')
                    + `\nWrite the episode packs, then stop. Rendering happens after the scripts are approved.`,
                status: 'backlog',
                priority: 'none',
                labels: ['video', 'series', 'screenplay'],
                workspaceId: null,
                assignedAgentId: series_dispatch_1.SCREENPLAY_WRITER_AGENT_ID,
                parentTicketId: null,
                externalProvider: null,
                externalId: null,
                externalUrl: null,
                ownerSub: sub,
                metadata: { app: 'video', kind: 'series', episodeCount, scenesPerEpisode, orientation },
            });
            const { rows } = await ctx.pool.query(`INSERT INTO video_series
           (user_sub, ticket_id, title, premise, style_lock, cast_bible, episode_count,
            scenes_per_episode, orientation, character_image_path, status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, 'scripting')
         RETURNING series_id`, [sub, ticket.ticketId, title, premise, styleLock, JSON.stringify(cast),
                episodeCount, scenesPerEpisode, orientation, characterImagePath]);
            const seriesId = String(rows[0].series_id);
            logger.info({ seriesId, ticketId: ticket.ticketId, episodeCount, sub }, 'video series created');
            // Kick the conductor once. From `scripting` it does exactly one free step — WRITE — then parks
            // at the approval gate. Nothing an image or a clip costs runs here. If the writer is slow or
            // unavailable the series simply stays `scripting` and can be advanced again; the response does
            // not wait on it.
            void (0, series_orchestrator_1.advanceVideoSeries)(ctx, seriesId).catch((err) => logger.warn({ err: err.message, seriesId }, 'initial advance failed (series stays scripting)'));
            res.json({
                ok: true,
                seriesId,
                ticketId: ticket.ticketId,
                status: 'scripting',
                message: `"${title}" is queued. The screenwriter is drafting ${episodeCount} episode${episodeCount === 1 ? '' : 's'}; `
                    + 'review and approve the scripts, then it storyboards and renders on its own.',
            });
        }
        catch (err) {
            logger.error({ err }, 'create video series failed');
            res.status(502).json({ error: err.message });
        }
    });
    /**
     * POST /series/:seriesId/approve — the one human gate. Approves the scripts and hands the series to
     * the conductor, which storyboards and renders it automatically. Everything before this is free;
     * approving it authorizes the image + render spend.
     */
    router.post('/series/:seriesId/approve', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const owns = await ctx.pool.query('SELECT 1 FROM video_series WHERE series_id=$1 AND user_sub=$2', [req.params.seriesId, sub]);
            if (!owns.rows.length) {
                res.status(404).json({ error: 'series not found' });
                return;
            }
            const a = await (0, series_orchestrator_1.approveSeries)(ctx.pool, String(req.params.seriesId));
            if (!a.ok) {
                res.status(409).json({ error: a.error });
                return;
            }
            // Advance as far as it will go now — storyboard the episodes, dispatch the first render. The
            // rest is driven by the reconciler as each render lands. Do not block the response on it.
            void (0, series_orchestrator_1.runVideoSeries)(ctx, String(req.params.seriesId))
                .catch((err) => logger.warn({ err: err.message }, 'post-approval run failed'));
            res.json({ ok: true, status: 'storyboarding', message: 'approved — storyboarding now, then rendering one episode at a time.' });
        }
        catch (err) {
            logger.error({ err }, 'approve series failed');
            res.status(502).json({ error: err.message });
        }
    });
    /**
     * POST /series/:seriesId/advance — nudge the conductor one step (diagnostics / manual driving).
     * Idempotent; safe to call any time.
     */
    router.post('/series/:seriesId/advance', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const owns = await ctx.pool.query('SELECT 1 FROM video_series WHERE series_id=$1 AND user_sub=$2', [req.params.seriesId, sub]);
            if (!owns.rows.length) {
                res.status(404).json({ error: 'series not found' });
                return;
            }
            const step = await (0, series_orchestrator_1.advanceVideoSeries)(ctx, String(req.params.seriesId));
            res.json(step);
        }
        catch (err) {
            logger.error({ err }, 'advance series failed');
            res.status(502).json({ error: err.message });
        }
    });
    /**
     * POST /series/:seriesId/write — run the WRITE stage: the screenplay-writer drafts the episodes,
     * the api validates its hard rules, and only a script that would render well is persisted.
     * Costs nothing but a chat call. A rejected script never reaches an image or a clip.
     */
    router.post('/series/:seriesId/write', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const owns = await ctx.pool.query('SELECT 1 FROM video_series WHERE series_id=$1 AND user_sub=$2', [req.params.seriesId, sub]);
            if (!owns.rows.length) {
                res.status(404).json({ error: 'series not found' });
                return;
            }
            const r = await (0, series_pipeline_1.writeSeries)(ctx, botClient, String(req.params.seriesId));
            if (!r.ok) {
                res.status(422).json({ ok: false, violations: r.violations, error: r.error });
                return;
            }
            res.json({ ok: true, episodes: r.episodes, status: 'awaiting_approval' });
        }
        catch (err) {
            logger.error({ err }, 'write stage failed');
            res.status(502).json({ error: err.message });
        }
    });
    /**
     * POST /series/:seriesId/episodes/:ordinal/storyboard — run the STORYBOARD stage for one episode:
     * a still per scene, cast held by an anchor frame, near-duplicate shots rejected. Billed to the
     * caller's own Google connector, never the swarm's.
     */
    router.post('/series/:seriesId/episodes/:ordinal/storyboard', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const { rows } = await ctx.pool.query(`SELECT e.episode_id FROM video_episodes e JOIN video_series s ON s.series_id=e.series_id
          WHERE s.series_id=$1 AND e.ordinal=$2 AND e.user_sub=$3`, [req.params.seriesId, Number(req.params.ordinal), sub]);
            if (!rows.length) {
                res.status(404).json({ error: 'episode not found' });
                return;
            }
            const episodeId = String(rows[0].episode_id);
            // Drive is a separate concern from image generation: the frames land in the caller's Drive
            // whichever provider drew them.
            const token = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'google');
            if (!token) {
                res.status(412).json({ error: 'connect your Google account first — the storyboard frames are stored in your Drive' });
                return;
            }
            // The image vendor is chosen by STORYBOARD_IMAGE_PROVIDER (default: codex, whose credential
            // comes from the swarm's own resolver — never an env var this feature invented).
            //
            // Vertex, when explicitly asked for, is credentialed from the caller's own **gcp connector**
            // through the token broker — the same brokered, per-user path every other bot uses. The swarm's
            // service-account key is a last resort behind the existing opt-in gate, so a "simple vid" can
            // never silently bill the swarm.
            let vertexToken;
            if ((process.env.STORYBOARD_IMAGE_PROVIDER || 'codex').toLowerCase() === 'vertex') {
                vertexToken = (await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'gcp')) ?? undefined;
                if (!vertexToken && process.env.VEO_ALLOW_SWARM_BILLING === 'true') {
                    vertexToken = await (0, video_generation_2.getVertexAccessToken)();
                    logger.warn({ sub }, 'storyboard: no gcp connector — falling back to the swarm service account (VEO_ALLOW_SWARM_BILLING)');
                }
                if (!vertexToken) {
                    res.status(412).json({ error: 'connect your GCP account (the gcp connector) to generate images with Vertex — it must grant the full cloud-platform scope, not cloud-platform.read-only' });
                    return;
                }
            }
            let r;
            try {
                r = await (0, series_pipeline_1.storyboardEpisode)(ctx.pool, episodeId, async (png, name) => (0, series_drive_1.uploadFrameToDrive)(png, name, token), { vertexToken });
            }
            catch (err) {
                const msg = err.message;
                // A misconfigured or unscoped provider is the caller's problem to fix, not a 502.
                if (/is not configured|insufficient authentication scopes|no OPENAI_API_KEY/i.test(msg)) {
                    res.status(412).json({ error: msg });
                    return;
                }
                throw err;
            }
            if (!r.ok) {
                res.status(422).json({ ok: false, duplicates: r.duplicates, error: r.error });
                return;
            }
            res.json({ ok: true, frames: r.frameIds?.length, status: 'storyboarded' });
        }
        catch (err) {
            logger.error({ err }, 'storyboard stage failed');
            res.status(502).json({ error: err.message });
        }
    });
    /**
     * POST /series/:seriesId/episodes/:ordinal/render — hand the storyboarded episode to the render
     * node. One episode at a time: the node drives a single browser.
     */
    router.post('/series/:seriesId/episodes/:ordinal/render', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const { rows } = await ctx.pool.query(`SELECT e.episode_id, e.series_id FROM video_episodes e
          WHERE e.series_id=$1 AND e.ordinal=$2 AND e.user_sub=$3`, [req.params.seriesId, Number(req.params.ordinal), sub]);
            if (!rows.length) {
                res.status(404).json({ error: 'episode not found' });
                return;
            }
            const episodeId = String(rows[0].episode_id);
            if (await (0, series_dispatch_1.isRenderInFlight)(ctx.pool, String(req.params.seriesId))) {
                res.status(409).json({ error: 'another episode of this series is already rendering — the node drives one browser' });
                return;
            }
            const token = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'google');
            if (!token) {
                res.status(412).json({ error: 'connect your Google account first' });
                return;
            }
            const r = await (0, series_dispatch_1.dispatchStoryboardedEpisode)(ctx.pool, episodeId, { driveToken: token });
            if (!r.ok) {
                res.status(503).json({ ok: false, error: r.error });
                return;
            }
            res.json({ ok: true, taskId: r.taskId, clientId: r.clientId, status: 'rendering' });
        }
        catch (err) {
            logger.error({ err }, 'render dispatch failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /series — the caller's series and each episode's render state. */
    router.get('/series', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const series = (await ctx.pool.query(`SELECT series_id, title, premise, episode_count, scenes_per_episode, status, ticket_id, created_at
           FROM video_series WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 50`, [sub])).rows;
            if (!series.length) {
                res.json({ series: [] });
                return;
            }
            const episodes = (await ctx.pool.query(`SELECT series_id, episode_id, ordinal, title, status, drive_url, assembled_path
           FROM video_episodes WHERE user_sub = $1 ORDER BY series_id, ordinal`, [sub])).rows;
            const bySeries = new Map();
            for (const e of episodes) {
                const k = String(e.series_id);
                if (!bySeries.has(k))
                    bySeries.set(k, []);
                bySeries.get(k).push(e);
            }
            res.json({ series: series.map((s) => ({ ...s, episodes: bySeries.get(String(s.series_id)) ?? [] })) });
        }
        catch (err) {
            logger.error({ err }, 'list video series failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /list — the caller's generated videos (store-authoritative, table for metadata). */
    router.get('/list', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const rows = (await ctx.pool.query(`SELECT title, file_name, provider, download_url, url, seconds, scenes, cost_usd, created_at
         FROM oshal_videos WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 100`, [sub])).rows;
            const byName = new Map(rows.map((r) => [String(r.file_name).toLowerCase(), r]));
            let scan = null;
            try {
                scan = await (0, storage_target_1.listFolder)(ctx, sub, 'files', VIDEO_SUBFOLDER);
            }
            catch (err) {
                logger.warn({ err: err.message }, 'video store scan failed — listing from table only');
            }
            if (!scan) {
                res.json({ videos: rows.slice(0, 50).map((r) => toVideo(r)) });
                return;
            }
            const present = scan.files.filter((f) => /\.mp4$/i.test(f.name)).map((f) => {
                const meta = byName.get(f.name.toLowerCase());
                return meta
                    ? toVideo(meta, { downloadUrl: f.downloadUrl, url: f.url })
                    : { title: f.name.replace(/\.mp4$/i, ''), fileName: f.name, provider: scan.provider, downloadUrl: f.downloadUrl, url: f.url, seconds: null, scenes: null, costUsd: null, createdAt: null };
            });
            const elsewhere = rows.filter((r) => r.provider && r.provider !== scan.provider).map((r) => toVideo(r));
            res.json({ videos: [...present, ...elsewhere].slice(0, 50) });
        }
        catch (err) {
            logger.error({ err }, 'list videos failed');
            res.status(502).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=video-routes.js.map