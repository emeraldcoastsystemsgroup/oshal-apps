"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-16 10:45:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Portrait Studio routes (ADR-085 package): studio surface + style catalog + generate (multipart crop upload → storyboard image provider edit, async with gallery polling) + per-user gallery/serve/delete. All rows and files are caller-sub-scoped; the image engine is the media-generation kernel skill (vendor-abstracted, fail-closed).
 * 2026-07-17 11:30:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Industrial hardening: stuck-row sweep (boot + throttled lazy — an api restart mid-generation can no longer strand a spinner), retry-with-backoff on transient vendor errors + hard per-attempt timeout, process-wide generation semaphore + per-user in-flight cap (burst control), vendor-reported cost captured on the row (cost_usd) AND in the canonical ledger via recordStoryboardImageCost (chat_tasks + oshal_cost_events, attributed to portrait-artist + the caller), /provider now runs the provider's REAL healthCheck (key validity + credit) instead of key-presence.
 * 2026-08-12 09:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Serve the camera-source decision module at GET /capture.js from the package tools dir, so the surface's live-camera Step 1 runs the SAME file the package test suite requires — no inline copy that can drift from the tested fallback logic.
 * 2026-08-22 00:30:00 | maintainer@emeraldcoastsystemsgroup.com     | Thread the caller's sub into resolveStoryboardImageProvider (generation + /provider probe). The ADR-130 codex-cli provider — the demo-mode default that renders on the swarm's own codex harness — authorizes per caller via the SEC-05 demo carve, so a resolve without userSub reads unavailable and fails closed. Other providers ignore the field. (1.4.1)
 * 2026-08-29 10:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Group mode (1.5.0): mode=group is accepted alongside professional/character; the face count arrives as a multipart `subjects` field, validated fail-closed by the catalog (2..6, refused outside group mode) and stored in options.subjects for the prompt and the gallery (list now returns `subjects`). The uploaded photo in group mode is the browser-built numbered reference sheet — still ONE anchor, so the provider contract and every guard around it are unchanged.
 * 2026-08-31 12:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Passport export + email (1.6.0): GET /portraits/:id/export?size=300|600 square-crops the portrait with sharp (attention strategy — the crop follows the face) and downloads it as a passport-size PNG; POST /portraits/:id/email sends the portrait (original or a passport crop) as an attachment over the caller's OWN mailbox — sendGmail, else the Graph sibling, else 409 — behind the standard confirm:true 428 gate (the ADR-108 "email it" shape presentations proved). Sizes and recipient validate fail-closed in portrait-ops.
 * 2026-08-31 16:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Orientation formats (1.7.0): export/email `size` now resolves against the closed EXPORT_FORMATS catalog — 300/600 passport squares (unchanged contract) plus `portrait` (1200×1800) and `landscape` (1800×1200) 4×6-print crops, same attention-strategy cover-crop. No route shape changed; group mode's multi-photo sourcing is browser-side only (the numbered sheet remains the one anchor).
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
exports.createPortraitStudioRoutes = createPortraitStudioRoutes;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const crypto = __importStar(require("node:crypto"));
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const sharp_1 = __importDefault(require("sharp"));
const logger_1 = require("@/shared/logger");
const authz_1 = require("@/shared/middleware/authz");
const video_generation_1 = require("@/features/video-generation");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const email_routes_1 = require("@/app/routes/email-routes");
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const portrait_catalog_1 = require("./portrait-catalog");
const portrait_ops_1 = require("./portrait-ops");
const logger = (0, logger_1.createChildLogger)({ module: 'portrait-studio-routes' });
/** D10 discipline: package dir captured at load time, re-affirmed from ctx.appPackageDir at factory time. */
let packageDir = process.env.OSHAL_APP_PACKAGE_DIR || '';
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const DAILY_CAP = Math.max(1, parseInt(process.env.PORTRAIT_STUDIO_DAILY_CAP || '25', 10) || 25);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The accountable bot (manifest agentId) image spend is recorded under. */
const PORTRAIT_ARTIST_AGENT_ID = 'b0100000-0000-0000-0000-000000000001';
/** Hard per-attempt vendor deadline — a hung vendor call must not hold a slot forever. */
const VENDOR_TIMEOUT_MS = Math.max(10_000, parseInt(process.env.PORTRAIT_STUDIO_VENDOR_TIMEOUT_MS || '120000', 10) || 120_000);
/** A user may have at most this many portraits queued/generating at once. */
const MAX_ACTIVE_PER_USER = Math.max(1, parseInt(process.env.PORTRAIT_STUDIO_MAX_ACTIVE_PER_USER || '2', 10) || 2);
/** Rows stuck in queued/generating longer than this are swept to failed. */
const STUCK_ROW_MINUTES = 10;
/** Process-wide bound on concurrent vendor calls, shared across users. */
const generationSlots = new portrait_ops_1.Semaphore(Math.max(1, parseInt(process.env.PORTRAIT_STUDIO_MAX_CONCURRENT || '4', 10) || 4));
/**
 * @description Signed-in caller's OIDC sub, or the trusted sub from an internal
 * service-secret call — same precedence as trading/eats/rides/spotify.
 * @param req - The incoming Express request.
 * @returns The acting user's sub, or null when unauthenticated.
 */
function callerSub(req) {
    const trusted = (0, authz_1.getTrustedServiceUserSub)(req);
    if (trusted)
        return trusted;
    const injected = req.oshalCallerSub;
    if (injected)
        return String(injected);
    const u = req.oidc?.user;
    const sub = u?.sub || u?.oid;
    return sub ? String(sub) : null;
}
/**
 * @description Per-user image directory under the shared workspace. The sub is
 * hashed so filesystem names never carry identity-provider identifiers.
 * @param sub - The caller's user sub.
 * @returns Absolute directory path (created if missing).
 */
function userDir(sub) {
    const root = process.env.CLINE_WORKSPACE_ROOT || path.resolve(process.cwd(), 'workspace-shared');
    const dir = path.join(root, 'portrait-studio', crypto.createHash('sha256').update(sub).digest('hex').slice(0, 16));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
/**
 * @description Bootstrap the app's schema when the package-migration runner is
 * off — mirrors migrations/001-portrait-studio.sql (same belt-and-suspenders
 * pattern as little-monsters' ensureEducationSchema).
 * @param ctx - The app context (pool).
 */
async function ensureSchema(ctx) {
    await ctx.pool.query(`
    CREATE TABLE IF NOT EXISTS ps_portraits (
      portrait_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub      TEXT NOT NULL,
      mode          VARCHAR(20) NOT NULL DEFAULT 'professional',
      style         TEXT NOT NULL,
      options       JSONB NOT NULL DEFAULT '{}'::jsonb,
      prompt        TEXT,
      status        VARCHAR(16) NOT NULL DEFAULT 'queued',
      source_path   TEXT,
      original_path TEXT,
      output_path   TEXT,
      model         TEXT,
      error         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ps_portraits_user ON ps_portraits (user_sub, created_at DESC);
    ALTER TABLE ps_portraits ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12,6);
  `);
}
/** Throttle for the lazy sweep — one UPDATE a minute is plenty. */
let lastSweepMs = 0;
/**
 * @description Sweep rows stranded in queued/generating (api restart mid-generation, or a
 * vendor hang that outlived every retry) to failed, so gallery spinners always resolve.
 * @param ctx - App context.
 * @param force - Bypass the once-a-minute throttle (used at boot).
 * @returns Number of rows swept.
 */
async function sweepStuckRows(ctx, force = false) {
    const now = Date.now();
    if (!force && now - lastSweepMs < 60_000)
        return 0;
    lastSweepMs = now;
    try {
        const r = await ctx.pool.query(`UPDATE ps_portraits SET status = 'failed',
         error = 'generation was interrupted (server restart or vendor hang) — please try again',
         updated_at = NOW()
       WHERE status IN ('queued','generating') AND updated_at < NOW() - INTERVAL '${STUCK_ROW_MINUTES} minutes'`);
        if (r.rowCount)
            logger.warn({ swept: r.rowCount }, 'swept stuck portrait rows to failed');
        return r.rowCount ?? 0;
    }
    catch (err) {
        logger.error({ err }, 'stuck-row sweep failed');
        return 0;
    }
}
/**
 * @description Mark a portrait row failed with a caller-readable reason.
 * @param ctx - App context. @param id - Portrait id. @param message - Failure reason.
 */
async function failRow(ctx, id, message) {
    try {
        await ctx.pool.query(`UPDATE ps_portraits SET status = 'failed', error = $2, updated_at = NOW() WHERE portrait_id = $1`, [id, message.slice(0, 500)]);
    }
    catch (err) {
        logger.error({ err, portraitId: id }, 'failed to record portrait failure');
    }
}
/**
 * @description Run one generation, industrially: a process-wide semaphore bounds vendor
 * concurrency; each attempt gets a hard deadline; transient vendor errors retry with
 * exponential backoff (permanent ones fail fast — retrying a refusal just triples the bill);
 * vendor-reported spend lands on the row AND in the canonical ledger (chat_tasks +
 * oshal_cost_events) attributed to the portrait-artist bot and the owning user.
 * @param ctx - App context. @param id - Portrait row id. @param sub - Owner sub.
 * @param prompt - The built prompt. @param source - The cropped photo bytes.
 */
async function runGeneration(ctx, id, sub, prompt, source) {
    const started = Date.now();
    await generationSlots.acquire();
    try {
        await ctx.pool.query(`UPDATE ps_portraits SET status = 'generating', updated_at = NOW() WHERE portrait_id = $1`, [id]);
        // The caller's sub rides to the provider: the ADR-130 codex-cli rail authorizes per caller
        // (SEC-05 demo carve at the bot node); the vendor-API providers ignore it.
        const provider = await (0, video_generation_1.resolveStoryboardImageProvider)({ userSub: sub });
        const attempt = () => (0, portrait_ops_1.withTimeout)(provider.generateWithMeta
            ? provider.generateWithMeta(prompt, source)
            : provider.generate(prompt, source).then((image) => ({ image, costUsd: null, model: `${provider.id}-default` })), VENDOR_TIMEOUT_MS, 'image generation');
        const result = await (0, portrait_ops_1.withRetries)(attempt, portrait_ops_1.isTransientVendorError);
        const outPath = path.join(userDir(sub), `${id}.png`);
        fs.writeFileSync(outPath, result.image);
        await ctx.pool.query(`UPDATE ps_portraits SET status = 'done', output_path = $2, model = $3, cost_usd = $4, updated_at = NOW() WHERE portrait_id = $1`, [id, outPath, `${provider.id}:${result.model}`, result.costUsd]);
        if (typeof result.costUsd === 'number' && result.costUsd > 0) {
            await (0, video_generation_1.recordStoryboardImageCost)(ctx.pool, {
                taskId: `portrait-${id}`,
                agentId: PORTRAIT_ARTIST_AGENT_ID,
                ownerSub: sub,
                providerId: `image-provider:${provider.id}`,
                model: result.model,
                costUsd: result.costUsd,
            });
        }
        logger.info({ portraitId: id, provider: provider.id, model: result.model, costUsd: result.costUsd, durationMs: Date.now() - started, bytes: result.image.length }, 'portrait generated');
    }
    catch (err) {
        logger.error({ err, portraitId: id, durationMs: Date.now() - started }, 'portrait generation failed');
        await failRow(ctx, id, err instanceof Error ? err.message : String(err));
    }
    finally {
        generationSlots.release();
    }
}
/**
 * @description Ownership-checked row fetch.
 * @param ctx - App context. @param id - Portrait id. @param sub - Caller sub.
 * @returns The row, or null when absent / not the caller's.
 */
async function ownedRow(ctx, id, sub) {
    if (!UUID_RE.test(id))
        return null;
    const r = await ctx.pool.query(`SELECT * FROM ps_portraits WHERE portrait_id = $1 AND user_sub = $2`, [id, sub]);
    return r.rows[0] ?? null;
}
/**
 * @description Send a stored image file, ownership already verified by the caller.
 * @param res - Express response. @param filePath - Absolute path from the row.
 * @param download - Send as attachment when true.
 */
function sendImage(res, filePath, download) {
    if (!filePath || !fs.existsSync(filePath)) {
        res.status(404).json({ error: 'image file not found' });
        return;
    }
    if (download)
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
}
/**
 * @description Cover-crop of a stored portrait at an exact export geometry. sharp's
 * `attention` position biases the crop toward the busiest region of the image — on these
 * portraits, the face — so a 4:5 headshot becomes a face-centered passport square or a
 * face-centered landscape band without any face-detection dependency.
 * @param filePath - Absolute path of the generated portrait PNG.
 * @param width - Validated output width (px). @param height - Validated output height (px).
 * @returns The resized PNG bytes.
 */
async function formatCrop(filePath, width, height) {
    return (0, sharp_1.default)(filePath).resize(width, height, { fit: 'cover', position: 'attention' }).png().toBuffer();
}
/** The caller-facing list of accepted `size` values, for 400 messages. */
const FORMAT_KEYS = Object.keys(portrait_ops_1.EXPORT_FORMATS).join(', ');
/**
 * @description Deliver one message over whichever mailbox the caller actually connected —
 * Gmail first, else Microsoft Graph (microsoft/outlook connection ids). The ADR-108
 * "email it" resolution order presentations proved; the token never leaves this function.
 * @param ctx - App context (pool for the connector-token lookup).
 * @param sub - The caller's sub (whose connections are consulted).
 * @param mail - The message + attachment to send.
 * @returns The vendor used (+ Gmail's message id), or null when no mailbox is connected.
 */
async function sendOverCallersMailbox(ctx, sub, mail) {
    const gtok = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'google');
    if (gtok) {
        const sent = await (0, email_routes_1.sendGmail)(gtok, mail);
        return { via: 'gmail', id: sent.id };
    }
    const mtok = (await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'microsoft')) || (await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'outlook'));
    if (mtok) {
        await (0, email_routes_1.sendOutlookMail)(mtok, mail);
        return { via: 'outlook' };
    }
    return null;
}
/**
 * @description Create the Portrait Studio routes. Mounted at /api/portrait-studio
 * by the swarm-app loader (manifest auth: oidc — the mounter guards every call).
 * @param ctx - The swarm app context (pool + appPackageDir).
 * @returns Configured Express router.
 */
function createPortraitStudioRoutes(ctx) {
    if (ctx.appPackageDir)
        packageDir = ctx.appPackageDir;
    const surfaceDir = packageDir ? path.join(packageDir, 'tools') : path.resolve(process.cwd(), 'tools');
    const router = (0, express_1.Router)();
    const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
    void ensureSchema(ctx)
        .then(() => sweepStuckRows(ctx, true))
        .catch((err) => logger.error({ err }, 'portrait-studio schema bootstrap failed'));
    /** GET /app — the studio surface (iframe target of the ribbon tile). */
    router.get('/app', (_req, res) => {
        res.sendFile(path.join(surfaceDir, 'portrait-studio.html'), (err) => {
            if (err) {
                logger.error({ err }, 'failed to serve portrait studio surface');
                res.status(404).send('Portrait Studio surface not found');
            }
        });
    });
    /** GET /capture.js — the surface's camera-source decision module. Served from the package
     *  (not inlined) so the SAME file the browser runs is the one `node tests/run.js` requires:
     *  a fallback branch cannot pass in the test and differ in the page. */
    router.get('/capture.js', (_req, res) => {
        res.type('application/javascript');
        res.sendFile(path.join(surfaceDir, 'portrait-capture.js'), (err) => {
            if (err) {
                logger.error({ err }, 'failed to serve portrait capture module');
                res.status(404).send('// portrait capture module not found');
            }
        });
    });
    /** GET /catalog — style/theme cards for the picker. */
    router.get('/catalog', (_req, res) => {
        res.json((0, portrait_catalog_1.clientCatalog)());
    });
    /** GET /provider — is the image engine ACTUALLY working? Runs the provider's real
     *  credential probe when it has one (key validity + credit), because key-presence lies.
     *  Resolved with the CALLER's sub: the codex-cli rail is per-caller (demo carve), so the
     *  banner must answer for the user who is looking at it. */
    router.get('/provider', async (req, res) => {
        try {
            const provider = await (0, video_generation_1.resolveStoryboardImageProvider)({ userSub: callerSub(req) || undefined });
            if (provider.healthCheck) {
                const health = await provider.healthCheck();
                res.json({ configured: health.ok, provider: provider.id, costClass: provider.costClass, detail: health.detail, ...(health.ok ? {} : { hint: health.detail }) });
                return;
            }
            res.json({ configured: true, provider: provider.id, costClass: provider.costClass, detail: 'credential present (this provider has no live probe)' });
        }
        catch (err) {
            res.json({ configured: false, hint: err instanceof Error ? err.message : String(err) });
        }
    });
    /** POST /portraits — cropped photo (multipart 'photo'; in group mode the browser-built numbered reference sheet) + mode/style/options (+ 'subjects' in group mode) → queue a generation. */
    router.post('/portraits', upload.single('photo'), async (req, res) => {
        const started = Date.now();
        try {
            const sub = callerSub(req);
            if (!sub) {
                res.status(401).json({ error: 'sign in to generate portraits' });
                return;
            }
            const file = req.file;
            if (!file || !file.buffer?.length) {
                res.status(400).json({ error: 'photo is required (multipart field "photo")' });
                return;
            }
            if (!/^image\//.test(file.mimetype || '')) {
                res.status(400).json({ error: 'photo must be an image' });
                return;
            }
            const mode = String(req.body?.mode || 'professional');
            const style = String(req.body?.style || '');
            if (!(0, portrait_catalog_1.isPortraitMode)(mode)) {
                res.status(400).json({ error: `unknown mode: ${mode}` });
                return;
            }
            if (!(0, portrait_catalog_1.findStyle)(mode, style)) {
                res.status(400).json({ error: `unknown ${mode} style: ${style}` });
                return;
            }
            let options = {};
            try {
                options = JSON.parse(String(req.body?.options || '{}'));
            }
            catch { /* tolerate — defaults apply */ }
            const badOverride = (0, portrait_catalog_1.validateOverrides)(options);
            if (badOverride) {
                res.status(400).json({ error: badOverride });
                return;
            }
            // Group mode: the face count rides as its own multipart field and is the ONLY source of
            // truth — a `subjects` inside the JSON options blob is discarded, never trusted.
            const subjectsRaw = req.body?.subjects;
            const badSubjects = (0, portrait_catalog_1.validateSubjects)(mode, subjectsRaw === undefined || subjectsRaw === '' ? undefined : subjectsRaw);
            if (badSubjects) {
                res.status(400).json({ error: badSubjects });
                return;
            }
            delete options.subjects;
            if (mode === 'group')
                options.subjects = Number(subjectsRaw);
            const capRow = await ctx.pool.query(`SELECT COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE status IN ('queued','generating'))::int AS active
         FROM ps_portraits WHERE user_sub = $1 AND created_at > NOW() - INTERVAL '24 hours'`, [sub]);
            if ((capRow.rows[0]?.n ?? 0) >= DAILY_CAP) {
                res.status(429).json({ error: `daily cap reached (${DAILY_CAP} portraits/24h) — try again tomorrow` });
                return;
            }
            if ((capRow.rows[0]?.active ?? 0) >= MAX_ACTIVE_PER_USER) {
                res.status(429).json({ error: `you already have ${capRow.rows[0].active} portrait(s) generating — wait for them to finish` });
                return;
            }
            const prompt = (0, portrait_catalog_1.buildPortraitPrompt)(mode, style, options);
            const inserted = await ctx.pool.query(`INSERT INTO ps_portraits (user_sub, mode, style, options, prompt, status)
         VALUES ($1, $2, $3, $4::jsonb, $5, 'queued') RETURNING portrait_id`, [sub, mode, style, JSON.stringify(options), prompt]);
            const id = String(inserted.rows[0].portrait_id);
            const sourcePath = path.join(userDir(sub), `${id}-source.png`);
            fs.writeFileSync(sourcePath, file.buffer);
            await ctx.pool.query(`UPDATE ps_portraits SET source_path = $2, updated_at = NOW() WHERE portrait_id = $1`, [id, sourcePath]);
            void runGeneration(ctx, id, sub, prompt, file.buffer);
            logger.info({ portraitId: id, mode, style, subjects: options.subjects ?? 1, bytes: file.buffer.length, durationMs: Date.now() - started }, 'portrait queued');
            res.status(202).json({ portraitId: id, status: 'queued' });
        }
        catch (err) {
            logger.error({ err, durationMs: Date.now() - started }, 'portrait create failed');
            res.status(500).json({ error: err instanceof Error ? err.message : 'portrait create failed' });
        }
    });
    /** GET /portraits — the caller's gallery, newest first (lazy stuck-row sweep first). */
    router.get('/portraits', async (req, res) => {
        try {
            const sub = callerSub(req);
            if (!sub) {
                res.status(401).json({ error: 'sign in to see your portraits' });
                return;
            }
            await sweepStuckRows(ctx);
            const r = await ctx.pool.query(`SELECT portrait_id, mode, style, status, error, model, cost_usd, created_at, updated_at,
                (options->>'subjects')::int AS subjects
         FROM ps_portraits WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 60`, [sub]);
            res.json({ portraits: r.rows });
        }
        catch (err) {
            logger.error({ err }, 'portrait list failed');
            res.status(500).json({ error: 'portrait list failed' });
        }
    });
    /** GET /portraits/:id/image — the generated portrait (owner only). */
    router.get('/portraits/:id/image', async (req, res) => {
        try {
            const sub = callerSub(req);
            if (!sub) {
                res.status(401).json({ error: 'unauthenticated' });
                return;
            }
            const row = await ownedRow(ctx, req.params.id, sub);
            if (!row || row.status !== 'done') {
                res.status(404).json({ error: 'portrait not found' });
                return;
            }
            sendImage(res, String(row.output_path || ''), req.query.download !== undefined);
        }
        catch (err) {
            logger.error({ err, portraitId: req.params.id }, 'portrait image serve failed');
            res.status(500).json({ error: 'portrait image serve failed' });
        }
    });
    /** GET /portraits/:id/export?size=300|600|portrait|landscape — formatted PNG download
     *  (owner only). The format set is closed (portrait-ops EXPORT_FORMATS) — passport squares
     *  and 4×6-print orientations, not a free-form resizer. */
    router.get('/portraits/:id/export', async (req, res) => {
        try {
            const sub = callerSub(req);
            if (!sub) {
                res.status(401).json({ error: 'unauthenticated' });
                return;
            }
            const fmt = (0, portrait_ops_1.exportFormat)(req.query.size);
            if (!fmt) {
                res.status(400).json({ error: `size must be one of: ${FORMAT_KEYS}` });
                return;
            }
            const row = await ownedRow(ctx, req.params.id, sub);
            if (!row || row.status !== 'done') {
                res.status(404).json({ error: 'portrait not found' });
                return;
            }
            const filePath = String(row.output_path || '');
            if (!filePath || !fs.existsSync(filePath)) {
                res.status(404).json({ error: 'image file not found' });
                return;
            }
            const image = await formatCrop(filePath, fmt.width, fmt.height);
            res.setHeader('Content-Disposition', `attachment; filename="portrait-${String(row.portrait_id).slice(0, 8)}-${fmt.width}x${fmt.height}.png"`);
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'private, max-age=3600');
            res.end(image);
        }
        catch (err) {
            logger.error({ err, portraitId: req.params.id }, 'portrait export failed');
            res.status(500).json({ error: 'portrait export failed' });
        }
    });
    /** POST /portraits/:id/email — send the portrait (original, or a passport crop when `size`
     *  is given) as an attachment over the caller's OWN connected mailbox: Gmail when Google is
     *  connected, else Microsoft Graph, else 409. Approval-gated — generating a portrait is not
     *  consent to broadcast it, so the server requires `confirm: true` (428 otherwise) and there
     *  is no batch path: one explicit user action per send. Body: { confirm, to, size?, subject?, note? }. */
    router.post('/portraits/:id/email', async (req, res) => {
        try {
            const sub = callerSub(req);
            if (!sub) {
                res.status(401).json({ error: 'unauthenticated' });
                return;
            }
            if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(req.body)) {
                res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('portrait-email', 'Emailing a portrait'));
                return;
            }
            const body = (req.body ?? {});
            const to = typeof body.to === 'string' ? body.to.trim() : '';
            if (!(0, portrait_ops_1.isValidEmailAddress)(to)) {
                res.status(400).json({ error: 'a valid "to" address is required' });
                return;
            }
            const wantsResize = body.size !== undefined && body.size !== null && body.size !== '';
            const fmt = wantsResize ? (0, portrait_ops_1.exportFormat)(body.size) : null;
            if (wantsResize && !fmt) {
                res.status(400).json({ error: `size must be one of: ${FORMAT_KEYS} — or omitted to send the original` });
                return;
            }
            const row = await ownedRow(ctx, req.params.id, sub);
            if (!row || row.status !== 'done') {
                res.status(404).json({ error: 'portrait not found' });
                return;
            }
            const filePath = String(row.output_path || '');
            if (!filePath || !fs.existsSync(filePath)) {
                res.status(404).json({ error: 'image file not found' });
                return;
            }
            const image = fmt ? await formatCrop(filePath, fmt.width, fmt.height) : fs.readFileSync(filePath);
            const fileName = fmt ? `portrait-${fmt.width}x${fmt.height}.png` : 'portrait.png';
            const note = typeof body.note === 'string' ? body.note.slice(0, 2000).trim() : '';
            const mail = {
                to,
                subject: (typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim().slice(0, 300) : 'Your portrait from oshal Portrait Studio'),
                body: (note ? `${note}\n\n` : '') + `${fmt ? `The ${fmt.label} portrait` : 'The portrait'} is attached.\n\nGenerated with oshal Portrait Studio.`,
                attachment: { filename: fileName, contentBase64: image.toString('base64'), mimeType: 'image/png' },
            };
            const sent = await sendOverCallersMailbox(ctx, sub, mail);
            if (!sent) {
                res.status(409).json({ error: 'no_mail_connection', message: 'Connect Google (Gmail) or Microsoft 365 in Utilities to send email.' });
                return;
            }
            logger.info({ portraitId: req.params.id, via: sent.via, id: sent.id, size: fmt?.key ?? null, bytes: image.length }, 'portrait emailed');
            res.json({ ok: true, via: sent.via, id: sent.id, to, size: fmt?.key ?? null });
        }
        catch (err) {
            logger.error({ err, portraitId: req.params.id }, 'portrait email failed');
            res.status(502).json({ error: err instanceof Error ? err.message : 'portrait email failed' });
        }
    });
    /** GET /portraits/:id/source — the cropped input photo (owner only). */
    router.get('/portraits/:id/source', async (req, res) => {
        try {
            const sub = callerSub(req);
            if (!sub) {
                res.status(401).json({ error: 'unauthenticated' });
                return;
            }
            const row = await ownedRow(ctx, req.params.id, sub);
            if (!row) {
                res.status(404).json({ error: 'portrait not found' });
                return;
            }
            sendImage(res, String(row.source_path || ''), false);
        }
        catch (err) {
            logger.error({ err, portraitId: req.params.id }, 'portrait source serve failed');
            res.status(500).json({ error: 'portrait source serve failed' });
        }
    });
    /** DELETE /portraits/:id — remove the row + its files (owner only). */
    router.delete('/portraits/:id', async (req, res) => {
        try {
            const sub = callerSub(req);
            if (!sub) {
                res.status(401).json({ error: 'unauthenticated' });
                return;
            }
            const row = await ownedRow(ctx, req.params.id, sub);
            if (!row) {
                res.status(404).json({ error: 'portrait not found' });
                return;
            }
            await ctx.pool.query(`DELETE FROM ps_portraits WHERE portrait_id = $1 AND user_sub = $2`, [req.params.id, sub]);
            for (const p of [row.source_path, row.original_path, row.output_path]) {
                if (p) {
                    try {
                        fs.rmSync(String(p), { force: true });
                    }
                    catch (err) {
                        logger.error({ err, path: p }, 'portrait file cleanup failed');
                    }
                }
            }
            res.json({ ok: true });
        }
        catch (err) {
            logger.error({ err, portraitId: req.params.id }, 'portrait delete failed');
            res.status(500).json({ error: 'portrait delete failed' });
        }
    });
    return router;
}
