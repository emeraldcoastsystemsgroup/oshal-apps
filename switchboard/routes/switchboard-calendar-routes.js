"use strict";
/**
 * Switchboard Calendar Routes — the Content Calendar (scheduling / approval pipeline).
 *
 * Mounted under the Switchboard app router (/api/switchboard/calendar, requiresAuth).
 * This is the scheduling desk: the caller drafts, schedules, and moves posts through an
 * approval pipeline (draft → needs_approval → scheduled → published) on a week grid.
 *
 * APP-OWNED model (ADR-085 packaged-app rule): oshal_switchboard_scheduled_posts, created
 * with lazy DDL at the factory chokepoint and owner-RLS (buildOwnerRlsPolicyStatements,
 * keyed on the oshal.current_sub GUC) — same discipline as the sibling workspace tables in
 * switchboard-routes.ts. Every query ALSO filters user_sub explicitly (defense in depth).
 *
 * Controller/bot split (ADR-036): this slice is cheap data-access ONLY — pure CRUD over the
 * caller's own rows. It calls NO LLM (drafting reasoning stays on the comms bot in the sibling
 * composer). The scheduled-time EXECUTOR also ships in this module (see startScheduledPostExecutor):
 * armed only by SWITCHBOARD_PUBLISH_EXECUTOR=true, it publishes due posts via the same path Compose uses.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 03:10:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial calendar module: the Content Calendar model (oshal_switchboard_scheduled_posts, lazy DDL + owner-RLS) + week-grid surface + scheduled-post CRUD (GET /calendar, GET/POST /calendar/posts, PATCH/DELETE /calendar/posts/:id). Workspace-scoped reads. No LLM in the path; the scheduled-time publish executor is deferred (not faked).
 * 2026-07-31 12:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Comment-only truth sweep: the scheduled-post executor SHIPPED in this module (the "calendar scheduled-post executor (closes the deferral)" commit) but this header and the package README still said it was NOT part of the slice. Header + README corrected to the as-built state; no code change.
 *
 * @module switchboard-calendar-routes
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
exports.ensureScheduledPostsSchema = ensureScheduledPostsSchema;
exports.startScheduledPostExecutor = startScheduledPostExecutor;
exports.createCalendarRoutes = createCalendarRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
// Background executors MUST run under runWithSystemIdentity so their queries stamp trusted-operator
// and stay visible past the strict-deny GUC on the owner-RLS scheduled_posts table (guc-pool).
const request_identity_1 = require("@/shared/services/database/request-identity");
// Reuse the SAME sanctioned publish path Compose exposes — never fork the publisher.
const switchboard_compose_routes_1 = require("./switchboard-compose-routes");
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
const logger = (0, logger_1.createChildLogger)({ module: 'switchboard-calendar-routes' });
/** Publishable platforms a scheduled post can target (aligns with the app's connector allow-list). */
const PLATFORMS = new Set(['linkedin', 'twitter', 'x', 'facebook', 'instagram', 'slack']);
/** The approval-pipeline states a post can be in (mirrors the CHECK constraint). 'failed' is
 *  executor-only (a publish attempt that errored) — users never set it, but PATCH must allow it. */
const STATUSES = new Set(['draft', 'scheduled', 'needs_approval', 'published', 'failed']);
/** Canonical UUID shape — guards :id params and workspace filters before they hit the UUID column. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Max stored post body length (guards against unbounded rows; UI drafts are far shorter). */
const MAX_BODY = 8000;
/** The signed-in user's OIDC subject, or null if unauthenticated. */
function callerSub(req) {
    const u = req.oidc?.user;
    return u?.sub ? String(u.sub) : null;
}
/** Serve a static HTML surface from the package tools directory. */
function servePage(dir, file) {
    return (_req, res) => {
        res.sendFile(path.join(dir, file), (err) => {
            if (err) {
                logger.error({ err, file }, 'Failed to serve switchboard calendar surface');
                res.status(404).send('Page not found');
            }
        });
    };
}
/** Coerce an arbitrary value to an ISO-8601 timestamp string, or null if not a valid date. */
function toIsoOrNull(v) {
    if (typeof v !== 'string' || !v.trim())
        return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** Map a DB row to the camelCase wire shape the surface consumes. */
function mapPost(r) {
    return {
        postId: r.post_id,
        workspaceId: r.workspace_id ?? null,
        platform: r.platform,
        body: r.body,
        mediaRef: r.media_ref ?? null,
        scheduledAt: r.scheduled_at,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}
/** True if the caller owns the given workspace (used to gate a post's workspace tag). */
async function ownsWorkspace(pool, sub, workspaceId) {
    const r = await pool.query('SELECT 1 FROM oshal_switchboard_workspaces WHERE user_sub = $1 AND workspace_id = $2', [sub, workspaceId]);
    return !!r.rowCount;
}
/**
 * @description Ensure the app-owned scheduled-posts table + owner-RLS at the lazy-DDL chokepoint
 * (buildOwnerRlsPolicyStatements, keyed on oshal.current_sub) per the ADR-085 packaged-app rule —
 * the same discipline as ensureWorkspaceSchema in switchboard-routes.ts.
 * @param pool - Postgres pool.
 * @returns Resolves when the schema is ensured (or validated in validate-only mode).
 */
async function ensureScheduledPostsSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'switchboard content calendar',
        statements: [
            `CREATE TABLE IF NOT EXISTS oshal_switchboard_scheduled_posts (
        post_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_sub TEXT NOT NULL,
        workspace_id UUID,
        platform TEXT NOT NULL,
        body TEXT NOT NULL,
        media_ref TEXT,
        scheduled_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'needs_approval', 'published')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            `CREATE INDEX IF NOT EXISTS idx_sb_sched_user_time ON oshal_switchboard_scheduled_posts (user_sub, scheduled_at)`,
            // Executor support (idempotent): a 'failed' state + attempt/outcome tracking, and a due-scan index.
            `ALTER TABLE oshal_switchboard_scheduled_posts ADD COLUMN IF NOT EXISTS publish_error TEXT`,
            `ALTER TABLE oshal_switchboard_scheduled_posts ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`,
            `ALTER TABLE oshal_switchboard_scheduled_posts ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0`,
            `ALTER TABLE oshal_switchboard_scheduled_posts DROP CONSTRAINT IF EXISTS oshal_switchboard_scheduled_posts_status_check`,
            `ALTER TABLE oshal_switchboard_scheduled_posts ADD CONSTRAINT oshal_switchboard_scheduled_posts_status_check CHECK (status IN ('draft', 'scheduled', 'needs_approval', 'published', 'failed'))`,
            `CREATE INDEX IF NOT EXISTS idx_sb_sched_due ON oshal_switchboard_scheduled_posts (status, scheduled_at)`,
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_switchboard_scheduled_posts', 'user_sub'),
        ],
        requirements: [
            { table: 'oshal_switchboard_scheduled_posts', columns: ['post_id', 'user_sub', 'platform', 'body', 'scheduled_at', 'status'] },
        ],
    });
}
/** Validate + normalize a POST /posts body into an insertable shape (or carry an error). */
function validateNewPost(b) {
    const platform = String(b.platform ?? '').toLowerCase().trim();
    const body = String(b.body ?? '').trim();
    const scheduledAt = toIsoOrNull(b.scheduledAt);
    const status = typeof b.status === 'string' && STATUSES.has(b.status) ? b.status : 'draft';
    const mediaRef = typeof b.mediaRef === 'string' && b.mediaRef.trim() ? b.mediaRef.trim() : null;
    const workspaceId = typeof b.workspaceId === 'string' && b.workspaceId ? b.workspaceId : null;
    const base = { platform, body, scheduledAt: scheduledAt || '', status, mediaRef, workspaceId };
    if (!PLATFORMS.has(platform))
        return { ...base, error: `platform must be one of ${[...PLATFORMS].join(', ')}` };
    if (!body || body.length > MAX_BODY)
        return { ...base, error: `body must be 1–${MAX_BODY} chars` };
    if (!scheduledAt)
        return { ...base, error: 'scheduledAt (ISO timestamp) required' };
    if (workspaceId && !UUID_RE.test(workspaceId))
        return { ...base, error: 'workspaceId must be a UUID' };
    return base;
}
/** Build the dynamic SET list for PATCH /posts/:id, validating each supplied field. */
function buildPostPatch(b) {
    const sets = [];
    const vals = [];
    let i = 1;
    let wsCheck;
    const push = (col, v) => { sets.push(`${col} = $${i++}`); vals.push(v); };
    if (typeof b.platform === 'string') {
        const p = b.platform.toLowerCase().trim();
        if (!PLATFORMS.has(p))
            return { sets, vals, error: 'invalid platform' };
        push('platform', p);
    }
    if (typeof b.body === 'string') {
        const t = b.body.trim();
        if (!t || t.length > MAX_BODY)
            return { sets, vals, error: `body must be 1–${MAX_BODY} chars` };
        push('body', t);
    }
    if (b.scheduledAt !== undefined) {
        const iso = toIsoOrNull(b.scheduledAt);
        if (!iso)
            return { sets, vals, error: 'scheduledAt invalid' };
        push('scheduled_at', iso);
    }
    if (typeof b.status === 'string') {
        if (!STATUSES.has(b.status))
            return { sets, vals, error: 'invalid status' };
        push('status', b.status);
    }
    if (b.mediaRef !== undefined)
        push('media_ref', typeof b.mediaRef === 'string' && b.mediaRef.trim() ? b.mediaRef.trim() : null);
    if (b.workspaceId !== undefined) {
        const w = b.workspaceId === null ? null : (typeof b.workspaceId === 'string' ? b.workspaceId : '');
        if (w !== null && !UUID_RE.test(w))
            return { sets, vals, error: 'workspaceId must be a UUID' };
        wsCheck = w;
        push('workspace_id', w);
    }
    return { sets, vals, wsCheck };
}
/** Compose the range/workspace SELECT for GET /posts from the query string. */
function buildRangeQuery(sub, q) {
    const conds = ['user_sub = $1'];
    const vals = [sub];
    let i = 2;
    const from = toIsoOrNull(q.from);
    const to = toIsoOrNull(q.to);
    const ws = typeof q.workspace === 'string' ? q.workspace : '';
    if (ws && !UUID_RE.test(ws))
        return { sql: '', vals, error: 'workspace must be a UUID' };
    if (from) {
        conds.push(`scheduled_at >= $${i++}`);
        vals.push(from);
    }
    if (to) {
        conds.push(`scheduled_at <= $${i++}`);
        vals.push(to);
    }
    if (ws) {
        conds.push(`workspace_id = $${i++}`);
        vals.push(ws);
    }
    const sql = `SELECT post_id, workspace_id, platform, body, media_ref, scheduled_at, status, created_at, updated_at
     FROM oshal_switchboard_scheduled_posts WHERE ${conds.join(' AND ')} ORDER BY scheduled_at LIMIT 500`;
    return { sql, vals };
}
/** GET /posts — the caller's scheduled posts in an optional [from,to] range + optional workspace. */
function registerList(router, ctx) {
    router.get('/posts', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const built = buildRangeQuery(sub, req.query);
        if (built.error) {
            res.status(400).json({ error: built.error });
            return;
        }
        try {
            const rows = (await ctx.pool.query(built.sql, built.vals)).rows;
            res.json({ posts: rows.map(mapPost) });
        }
        catch (err) {
            logger.error({ err }, 'Calendar posts list failed');
            res.status(502).json({ error: err.message });
        }
    });
}
/** POST /posts — create a scheduled post (workspace tag ownership-validated). */
function registerCreate(router, ctx) {
    router.post('/posts', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const v = validateNewPost((req.body || {}));
        if (v.error) {
            res.status(400).json({ error: v.error });
            return;
        }
        try {
            if (v.workspaceId && !(await ownsWorkspace(ctx.pool, sub, v.workspaceId))) {
                res.status(400).json({ error: 'workspace not found' });
                return;
            }
            const r = (await ctx.pool.query(`INSERT INTO oshal_switchboard_scheduled_posts (user_sub, workspace_id, platform, body, media_ref, scheduled_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING post_id, workspace_id, platform, body, media_ref, scheduled_at, status, created_at, updated_at`, [sub, v.workspaceId, v.platform, v.body, v.mediaRef, v.scheduledAt, v.status])).rows[0];
            res.status(201).json({ post: mapPost(r) });
        }
        catch (err) {
            logger.error({ err }, 'Calendar post create failed');
            res.status(502).json({ error: err.message });
        }
    });
}
/** PATCH /posts/:id — reschedule / restatus / edit a post the caller owns. */
function registerUpdate(router, ctx) {
    router.patch('/posts/:id', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const id = String(req.params.id);
        if (!UUID_RE.test(id)) {
            res.status(404).json({ error: 'post not found' });
            return;
        }
        const build = buildPostPatch((req.body || {}));
        if (build.error) {
            res.status(400).json({ error: build.error });
            return;
        }
        if (!build.sets.length) {
            res.status(400).json({ error: 'nothing to update' });
            return;
        }
        try {
            if (build.wsCheck && !(await ownsWorkspace(ctx.pool, sub, build.wsCheck))) {
                res.status(400).json({ error: 'workspace not found' });
                return;
            }
            const p = build.vals.length;
            const vals = [...build.vals, sub, id];
            const r = await ctx.pool.query(`UPDATE oshal_switchboard_scheduled_posts SET ${build.sets.join(', ')}, updated_at = now() WHERE user_sub = $${p + 1} AND post_id = $${p + 2}`, vals);
            if (!r.rowCount) {
                res.status(404).json({ error: 'post not found' });
                return;
            }
            res.json({ ok: true });
        }
        catch (err) {
            logger.error({ err }, 'Calendar post update failed');
            res.status(502).json({ error: err.message });
        }
    });
}
/** DELETE /posts/:id — remove a post the caller owns. */
function registerDelete(router, ctx) {
    router.delete('/posts/:id', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const id = String(req.params.id);
        if (!UUID_RE.test(id)) {
            res.status(404).json({ error: 'post not found' });
            return;
        }
        try {
            const r = await ctx.pool.query('DELETE FROM oshal_switchboard_scheduled_posts WHERE user_sub = $1 AND post_id = $2', [sub, id]);
            res.json({ ok: true, removed: r.rowCount || 0 });
        }
        catch (err) {
            logger.error({ err }, 'Calendar post delete failed');
            res.status(502).json({ error: err.message });
        }
    });
}
// ── Scheduled-post executor (ADR-113) ─────────────────────────────────────────
// Publishes DUE posts (status='scheduled', scheduled_at<=now) via the SAME path Compose uses.
// OFF by default (SWITCHBOARD_PUBLISH_EXECUTOR) — pushing to live social accounts is outward-facing,
// so an operator must arm it explicitly; until then scheduled posts simply wait (publishable by hand
// from Compose). Runs under runWithSystemIdentity so it can see + update the owner-RLS table across
// all users. A failed attempt lands as status='failed' (won't re-fire) with the error recorded.
/** True when the operator has armed automatic scheduled publishing. */
function executorEnabled() {
    return ['1', 'true', 'yes'].includes((process.env.SWITCHBOARD_PUBLISH_EXECUTOR || '').trim().toLowerCase());
}
let executorStarted = false;
/** Publish every post that is due now (trusted-operator background context). */
async function runDuePosts(ctx) {
    await (0, request_identity_1.runWithSystemIdentity)(async () => {
        const due = (await ctx.pool.query(`SELECT post_id, user_sub, platform, body FROM oshal_switchboard_scheduled_posts
       WHERE status = 'scheduled' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 25`)).rows;
        for (const p of due) {
            try {
                const r = (await (0, switchboard_compose_routes_1.publishTo)(ctx, p.user_sub, p.platform, p.body));
                if (r.ok) {
                    await ctx.pool.query("UPDATE oshal_switchboard_scheduled_posts SET status='published', published_at=now(), attempts=attempts+1, updated_at=now() WHERE post_id=$1", [p.post_id]);
                    logger.info({ postId: p.post_id, platform: p.platform }, 'Scheduled post published');
                }
                else {
                    await ctx.pool.query("UPDATE oshal_switchboard_scheduled_posts SET status='failed', publish_error=$2, attempts=attempts+1, updated_at=now() WHERE post_id=$1", [p.post_id, String(r.error || r.message || 'publish failed').slice(0, 500)]);
                    logger.warn({ postId: p.post_id, platform: p.platform, error: r.error }, 'Scheduled post publish failed');
                }
            }
            catch (err) {
                await ctx.pool.query("UPDATE oshal_switchboard_scheduled_posts SET status='failed', publish_error=$2, attempts=attempts+1, updated_at=now() WHERE post_id=$1", [p.post_id, err.message.slice(0, 500)]).catch(() => undefined);
                logger.error({ err, postId: p.post_id }, 'Scheduled post executor error');
            }
        }
    });
}
/**
 * @description Start the scheduled-post executor loop (once per process). No-op unless armed via
 * SWITCHBOARD_PUBLISH_EXECUTOR=true — publishing to live accounts is an explicit operator opt-in.
 * @param ctx - App context (pool + connector tokens for publishing).
 * @returns Nothing; schedules a recurring interval when armed.
 */
function startScheduledPostExecutor(ctx) {
    if (executorStarted)
        return;
    if (!executorEnabled()) {
        logger.info('Scheduled-post executor disabled (set SWITCHBOARD_PUBLISH_EXECUTOR=true to arm)');
        return;
    }
    executorStarted = true;
    const intervalMs = Math.max(30_000, Number(process.env.SWITCHBOARD_PUBLISH_INTERVAL_MS) || 60_000);
    logger.info({ intervalMs }, 'Scheduled-post executor armed');
    setInterval(() => { runDuePosts(ctx).catch((err) => logger.error({ err }, 'Scheduled-post executor tick failed')); }, intervalMs);
}
/**
 * @description Builds the Switchboard Content Calendar router. Serves the week-grid surface and
 * the scheduled-post CRUD over the signed-in user's own rows. Cheap data-access only — no LLM in
 * this path (ADR-036); the scheduled-time publish executor is armed separately (opt-in flag).
 * @param ctx - App context (db pool for the app-owned store, appPackageDir for the surface).
 * @returns Express router to mount at /calendar under the Switchboard app router (auth-gated by the parent).
 */
function createCalendarRoutes(ctx) {
    const router = (0, express_1.Router)();
    const assetRoot = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.join(LOAD_TIME_PACKAGE_DIR, 'tools');
    ensureScheduledPostsSchema(ctx.pool).catch((err) => logger.error({ err }, 'Failed to ensure switchboard scheduled_posts schema'));
    startScheduledPostExecutor(ctx);
    // Surface: the week-grid Content Calendar.
    router.get('/', servePage(assetRoot, 'switchboard-calendar.html'));
    // Data: the scheduled-post CRUD (all caller-scoped, owner-RLS + explicit user_sub filter).
    registerList(router, ctx);
    registerCreate(router, ctx);
    registerUpdate(router, ctx);
    registerDelete(router, ctx);
    return router;
}
//# sourceMappingURL=switchboard-calendar-routes.js.map