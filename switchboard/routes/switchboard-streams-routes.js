"use strict";
/**
 * Switchboard Streams Routes — the CMS-grade publishing pane (ADR-113 pane-by-pane).
 *
 * Mounted under the Switchboard app router (/api/switchboard/streams, requiresAuth).
 * The operator's call (2026-08-09): publishing must work like the editorial CMS built for
 * the JMN client — one post entity, editorial states, per-channel variants, revisions,
 * a review queue — but with NO site to render: the publish targets already exist, so the
 * pane lands on compose's publishTo (the one sanctioned publisher, never forked).
 *
 * APP-OWNED model (ADR-085 packaged-app rule): three tables created with lazy DDL at the
 * factory chokepoint and owner-RLS (buildOwnerRlsPolicyStatements, oshal.current_sub GUC),
 * mirrored by migrations/002-switchboard-stream-posts.sql. Every query ALSO filters
 * user_sub explicitly (defense in depth). JMN lessons carried over: a single write path,
 * (source, source_ref) import dedup, states that are reversible, and revisions on every edit.
 *
 * Controller/bot split (ADR-036): NO LLM in this path. Variant drafting is the EXISTING
 * /compose/variants endpoint (comms bot), called by the surface; results are PATCHed in.
 * Nothing posts without confirm:true (428 otherwise) or the operator-armed executor
 * (SWITCHBOARD_PUBLISH_EXECUTOR — the same opt-in flag the calendar executor uses).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial Streams pane: posts/variants/revisions stores (lazy DDL + owner-RLS + import-dedup unique), list-with-counts + CRUD + revision snapshots on every edit, the 8-state transition endpoint, schedule (future-only), confirm-gated publish with a claim CAS (double-fire cannot double-post), per-channel results recorded on variants, honest 'skipped no_binding' for instagram/threads, idempotent imports from the LinkedIn assistant + Content Studio stores, and the opt-in due-post executor riding the same publish core as the route.
 *
 * @module switchboard-streams-routes
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
exports.ensureStreamSchema = ensureStreamSchema;
exports.publishPostCore = publishPostCore;
exports.startStreamExecutor = startStreamExecutor;
exports.createStreamsRoutes = createStreamsRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const request_identity_1 = require("@/shared/services/database/request-identity");
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const switchboard_compose_routes_1 = require("./switchboard-compose-routes");
const switchboard_streams_model_1 = require("./switchboard-streams-model");
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
const logger = (0, logger_1.createChildLogger)({ module: 'switchboard-streams-routes' });
/** Canonical UUID shape — guards :id params before they hit UUID columns. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
                logger.error({ err, file }, 'Failed to serve switchboard streams surface');
                res.status(404).send('Page not found');
            }
        });
    };
}
/**
 * @description Ensure the three app-owned Streams tables + owner-RLS at the lazy-DDL
 * chokepoint (mirrored by migrations/002-switchboard-stream-posts.sql). The partial
 * unique on (user_sub, source, source_ref) is the JMN import-dedup guarantee.
 * @param pool - Postgres pool.
 * @returns Resolves when the schema is ensured.
 */
async function ensureStreamSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'switchboard streams',
        statements: [
            `CREATE TABLE IF NOT EXISTS oshal_switchboard_stream_posts (
        post_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_sub TEXT NOT NULL,
        workspace_id UUID,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','in_review','approved','scheduled','published','rejected','failed','archived')),
        tags TEXT[] NOT NULL DEFAULT '{}',
        source TEXT NOT NULL DEFAULT 'manual',
        source_ref TEXT,
        judge_score INT,
        judge_rationale TEXT,
        note TEXT,
        scheduled_at TIMESTAMPTZ,
        published_at TIMESTAMPTZ,
        publish_error TEXT,
        publish_claimed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            `CREATE INDEX IF NOT EXISTS idx_sb_stream_user_state ON oshal_switchboard_stream_posts (user_sub, state, updated_at DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_sb_stream_due ON oshal_switchboard_stream_posts (state, scheduled_at)`,
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_sb_stream_import_dedup ON oshal_switchboard_stream_posts (user_sub, source, source_ref) WHERE source_ref IS NOT NULL`,
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_switchboard_stream_posts', 'user_sub'),
            `CREATE TABLE IF NOT EXISTS oshal_switchboard_stream_variants (
        post_id UUID NOT NULL,
        user_sub TEXT NOT NULL,
        platform TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        media_ref TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','failed','skipped')),
        external_ref TEXT,
        error TEXT,
        published_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (post_id, platform)
      )`,
            `CREATE INDEX IF NOT EXISTS idx_sb_stream_var_user ON oshal_switchboard_stream_variants (user_sub, platform)`,
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_switchboard_stream_variants', 'user_sub'),
            `CREATE TABLE IF NOT EXISTS oshal_switchboard_stream_revisions (
        revision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id UUID NOT NULL,
        user_sub TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        variants JSONB NOT NULL DEFAULT '[]'::jsonb,
        note TEXT,
        saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            `CREATE INDEX IF NOT EXISTS idx_sb_stream_rev_post ON oshal_switchboard_stream_revisions (user_sub, post_id, saved_at DESC)`,
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_switchboard_stream_revisions', 'user_sub'),
        ],
        requirements: [
            { table: 'oshal_switchboard_stream_posts', columns: ['post_id', 'user_sub', 'body', 'state', 'source'] },
            { table: 'oshal_switchboard_stream_variants', columns: ['post_id', 'user_sub', 'platform', 'body', 'status'] },
            { table: 'oshal_switchboard_stream_revisions', columns: ['revision_id', 'post_id', 'user_sub', 'variants'] },
        ],
    });
}
/** Map a post row (+ its variant rows and revision count) to the camelCase wire shape. */
function mapPost(r, variants, revisionCount) {
    return {
        postId: r.post_id,
        workspaceId: r.workspace_id ?? null,
        title: r.title ?? '',
        body: r.body,
        state: r.state,
        tags: Array.isArray(r.tags) ? r.tags : [],
        source: r.source ?? 'manual',
        judgeScore: r.judge_score ?? null,
        judgeRationale: r.judge_rationale ?? null,
        note: r.note ?? null,
        scheduledAt: r.scheduled_at ?? null,
        publishedAt: r.published_at ?? null,
        publishError: r.publish_error ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        variants: variants.map((v) => ({
            platform: v.platform,
            body: v.body,
            mediaRef: v.media_ref ?? null,
            status: v.status,
            externalRef: v.external_ref ?? null,
            error: v.error ?? null,
            publishedAt: v.published_at ?? null,
        })),
        revisionCount,
    };
}
/** Load one post + its variants for the caller (null when absent). */
async function loadPost(pool, sub, postId) {
    const post = (await pool.query('SELECT * FROM oshal_switchboard_stream_posts WHERE user_sub = $1 AND post_id = $2', [sub, postId])).rows[0];
    if (!post)
        return null;
    const variants = (await pool.query('SELECT * FROM oshal_switchboard_stream_variants WHERE user_sub = $1 AND post_id = $2 ORDER BY platform', [sub, postId])).rows;
    return { post, variants };
}
/** Count a post's revisions. */
async function revisionCountOf(pool, sub, postId) {
    const r = (await pool.query('SELECT COUNT(*)::int AS n FROM oshal_switchboard_stream_revisions WHERE user_sub = $1 AND post_id = $2', [sub, postId])).rows[0];
    return r?.n ?? 0;
}
/** Respond with the mapped current shape of one post. */
async function respondPost(pool, res, sub, postId, status = 200, extra = {}) {
    const loaded = await loadPost(pool, sub, postId);
    if (!loaded) {
        res.status(404).json({ error: 'post not found' });
        return;
    }
    res.status(status).json({ post: mapPost(loaded.post, loaded.variants, await revisionCountOf(pool, sub, postId)), ...extra });
}
/** Snapshot a post's PRIOR content into the revisions table (called before every edit). */
async function writeRevision(pool, sub, post, variants, note) {
    const varJson = JSON.stringify(variants.map((v) => ({ platform: v.platform, body: v.body, mediaRef: v.media_ref ?? null })));
    await pool.query(`INSERT INTO oshal_switchboard_stream_revisions (post_id, user_sub, title, body, variants, note)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`, [post.post_id, sub, post.title ?? '', post.body ?? '', varJson, note.slice(0, 200)]);
}
/** Upsert one variant's authored content (status resets to pending on edit). */
async function upsertVariant(pool, sub, postId, v) {
    await pool.query(`INSERT INTO oshal_switchboard_stream_variants (post_id, user_sub, platform, body, media_ref)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (post_id, platform)
     DO UPDATE SET body = EXCLUDED.body, media_ref = EXCLUDED.media_ref, status = 'pending', error = NULL, updated_at = now()`, [postId, sub, v.platform, v.body, v.mediaRef ?? null]);
}
/** True if the caller owns the given workspace (reuses the switchboard workspaces table). */
async function ownsWorkspace(pool, sub, workspaceId) {
    const r = await pool.query('SELECT 1 FROM oshal_switchboard_workspaces WHERE user_sub = $1 AND workspace_id = $2', [sub, workspaceId]);
    return !!r.rowCount;
}
/** Compose the filtered list SELECT for GET /posts. */
function buildListQuery(sub, q) {
    const conds = ['p.user_sub = $1'];
    const vals = [sub];
    let i = 2;
    const state = typeof q.state === 'string' ? q.state : '';
    const ws = typeof q.workspace === 'string' ? q.workspace : '';
    const platform = typeof q.platform === 'string' ? (0, switchboard_streams_model_1.canonicalPlatform)(q.platform) : '';
    const text = typeof q.q === 'string' ? q.q.trim() : '';
    if (state) {
        if (!switchboard_streams_model_1.STATES.includes(state))
            return { sql: '', vals, error: 'unknown state' };
        conds.push(`p.state = $${i++}`);
        vals.push(state);
    }
    if (ws) {
        if (!UUID_RE.test(ws))
            return { sql: '', vals, error: 'workspace must be a UUID' };
        conds.push(`p.workspace_id = $${i++}`);
        vals.push(ws);
    }
    if (platform) {
        conds.push(`EXISTS (SELECT 1 FROM oshal_switchboard_stream_variants v WHERE v.post_id = p.post_id AND v.user_sub = p.user_sub AND v.platform = $${i++})`);
        vals.push(platform);
    }
    if (text) {
        conds.push(`(p.title ILIKE $${i} OR p.body ILIKE $${i})`);
        vals.push(`%${text.slice(0, 100)}%`);
        i++;
    }
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const sql = `SELECT p.*, (SELECT COUNT(*)::int FROM oshal_switchboard_stream_revisions r WHERE r.post_id = p.post_id AND r.user_sub = p.user_sub) AS revision_count
     FROM oshal_switchboard_stream_posts p WHERE ${conds.join(' AND ')} ORDER BY p.updated_at DESC LIMIT ${limit}`;
    return { sql, vals };
}
/** GET /posts — filtered list + per-state counts (the state rail's data). */
function registerList(router, ctx) {
    router.get('/posts', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const built = buildListQuery(sub, req.query);
        if (built.error) {
            res.status(400).json({ error: built.error });
            return;
        }
        try {
            const rows = (await ctx.pool.query(built.sql, built.vals)).rows;
            const ids = rows.map((r) => r.post_id);
            const vars = ids.length
                ? (await ctx.pool.query('SELECT * FROM oshal_switchboard_stream_variants WHERE user_sub = $1 AND post_id = ANY($2::uuid[]) ORDER BY platform', [sub, ids])).rows
                : [];
            const byPost = new Map();
            for (const v of vars) {
                const a = byPost.get(v.post_id) || [];
                a.push(v);
                byPost.set(v.post_id, a);
            }
            const countRows = (await ctx.pool.query('SELECT state, COUNT(*)::int AS n FROM oshal_switchboard_stream_posts WHERE user_sub = $1 GROUP BY state', [sub])).rows;
            const counts = Object.fromEntries(switchboard_streams_model_1.STATES.map((s) => [s, 0]));
            for (const c of countRows)
                counts[c.state] = c.n;
            res.json({ posts: rows.map((r) => mapPost(r, byPost.get(r.post_id) || [], Number(r.revision_count) || 0)), counts });
        }
        catch (err) {
            logger.error({ err }, 'Streams list failed');
            res.status(502).json({ error: err.message });
        }
    });
}
/** POST /posts — create a draft; a variant row is seeded per requested platform. */
function registerCreate(router, ctx) {
    router.post('/posts', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const v = (0, switchboard_streams_model_1.validateNewPost)((req.body || {}));
        if (!(0, switchboard_streams_model_1.isValidNewPost)(v)) {
            res.status(400).json({ error: v.error });
            return;
        }
        if (v.workspaceId && !UUID_RE.test(v.workspaceId)) {
            res.status(400).json({ error: 'workspaceId must be a UUID' });
            return;
        }
        try {
            if (v.workspaceId && !(await ownsWorkspace(ctx.pool, sub, v.workspaceId))) {
                res.status(400).json({ error: 'workspace not found' });
                return;
            }
            const r = (await ctx.pool.query(`INSERT INTO oshal_switchboard_stream_posts (user_sub, workspace_id, title, body, tags) VALUES ($1, $2, $3, $4, $5) RETURNING post_id`, [sub, v.workspaceId, v.title, v.body, v.tags])).rows[0];
            for (const platform of v.platforms)
                await upsertVariant(ctx.pool, sub, r.post_id, { platform, body: v.body });
            await respondPost(ctx.pool, res, sub, r.post_id, 201);
        }
        catch (err) {
            logger.error({ err }, 'Streams create failed');
            res.status(502).json({ error: err.message });
        }
    });
}
/** GET /posts/:id — full detail + revision metadata list. */
function registerDetail(router, ctx) {
    router.get('/posts/:id', async (req, res) => {
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
            const loaded = await loadPost(ctx.pool, sub, id);
            if (!loaded) {
                res.status(404).json({ error: 'post not found' });
                return;
            }
            const revs = (await ctx.pool.query('SELECT revision_id, note, saved_at FROM oshal_switchboard_stream_revisions WHERE user_sub = $1 AND post_id = $2 ORDER BY saved_at DESC LIMIT 50', [sub, id])).rows;
            res.json({
                post: mapPost(loaded.post, loaded.variants, revs.length),
                revisions: revs.map((r) => ({ revisionId: r.revision_id, note: r.note, savedAt: r.saved_at })),
            });
        }
        catch (err) {
            logger.error({ err }, 'Streams detail failed');
            res.status(502).json({ error: err.message });
        }
    });
}
/** PATCH /posts/:id — edit content (draft/in_review only); prior content becomes a revision. */
function registerPatch(router, ctx) {
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
        const patch = (0, switchboard_streams_model_1.validatePatch)((req.body || {}));
        if (patch.error) {
            res.status(400).json({ error: patch.error });
            return;
        }
        try {
            const loaded = await loadPost(ctx.pool, sub, id);
            if (!loaded) {
                res.status(404).json({ error: 'post not found' });
                return;
            }
            if (!(0, switchboard_streams_model_1.canEdit)(String(loaded.post.state))) {
                res.status(409).json({ error: `cannot edit a ${loaded.post.state} post — reopen first`, state: loaded.post.state });
                return;
            }
            await writeRevision(ctx.pool, sub, loaded.post, loaded.variants, 'edit');
            const sets = [];
            const vals = [];
            let i = 1;
            if (patch.title !== undefined) {
                sets.push(`title = $${i++}`);
                vals.push(patch.title);
            }
            if (patch.body !== undefined) {
                sets.push(`body = $${i++}`);
                vals.push(patch.body);
            }
            if (patch.tags !== undefined) {
                sets.push(`tags = $${i++}`);
                vals.push(patch.tags);
            }
            if (sets.length) {
                vals.push(sub, id);
                await ctx.pool.query(`UPDATE oshal_switchboard_stream_posts SET ${sets.join(', ')}, updated_at = now() WHERE user_sub = $${i++} AND post_id = $${i}`, vals);
            }
            else {
                await ctx.pool.query('UPDATE oshal_switchboard_stream_posts SET updated_at = now() WHERE user_sub = $1 AND post_id = $2', [sub, id]);
            }
            // An empty-bodied variant is a REMOVAL (the surface sends cleared cards) — keeping an
            // empty row would fail-close every later publish on a channel the user meant to drop.
            for (const v of patch.variants || []) {
                if (v.body)
                    await upsertVariant(ctx.pool, sub, id, v);
                else
                    await ctx.pool.query('DELETE FROM oshal_switchboard_stream_variants WHERE user_sub = $1 AND post_id = $2 AND platform = $3', [sub, id, v.platform]);
            }
            await respondPost(ctx.pool, res, sub, id);
        }
        catch (err) {
            logger.error({ err }, 'Streams patch failed');
            res.status(502).json({ error: err.message });
        }
    });
}
/** POST /posts/:id/transition — the editorial state machine (CAS on the prior state). */
function registerTransition(router, ctx) {
    router.post('/posts/:id/transition', async (req, res) => {
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
        const body = (req.body || {});
        const action = String(body.action || '');
        try {
            const loaded = await loadPost(ctx.pool, sub, id);
            if (!loaded) {
                res.status(404).json({ error: 'post not found' });
                return;
            }
            const state = String(loaded.post.state);
            const t = (0, switchboard_streams_model_1.applyTransition)(state, action);
            if (t.error || !t.next) {
                res.status(409).json({ error: t.error, state, action });
                return;
            }
            const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
            const clearSchedule = t.next === 'draft' || action === 'unschedule';
            const r = await ctx.pool.query(`UPDATE oshal_switchboard_stream_posts
         SET state = $1, note = COALESCE($2, note), scheduled_at = CASE WHEN $3 THEN NULL ELSE scheduled_at END, updated_at = now()
         WHERE user_sub = $4 AND post_id = $5 AND state = $6`, [t.next, note, clearSchedule, sub, id, state]);
            if (!r.rowCount) {
                res.status(409).json({ error: 'state changed concurrently — reload', state });
                return;
            }
            await respondPost(ctx.pool, res, sub, id);
        }
        catch (err) {
            logger.error({ err }, 'Streams transition failed');
            res.status(502).json({ error: err.message });
        }
    });
}
/** POST /posts/:id/schedule — approved → scheduled at a future instant (CAS). */
function registerSchedule(router, ctx) {
    router.post('/posts/:id/schedule', async (req, res) => {
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
        const when = (0, switchboard_streams_model_1.validateScheduleAt)(req.body?.scheduledAt, Date.now());
        if (when.error || !when.iso) {
            res.status(400).json({ error: when.error });
            return;
        }
        try {
            const r = await ctx.pool.query(`UPDATE oshal_switchboard_stream_posts SET state = 'scheduled', scheduled_at = $1, updated_at = now()
         WHERE user_sub = $2 AND post_id = $3 AND state = 'approved'`, [when.iso, sub, id]);
            if (!r.rowCount) {
                res.status(409).json({ error: 'only an approved post can be scheduled' });
                return;
            }
            await respondPost(ctx.pool, res, sub, id);
        }
        catch (err) {
            logger.error({ err }, 'Streams schedule failed');
            res.status(502).json({ error: err.message });
        }
    });
}
/** Claim a post for publishing (CAS — a double-fire or concurrent executor tick cannot double-post). */
async function claimForPublish(pool, sub, postId) {
    const r = await pool.query(`UPDATE oshal_switchboard_stream_posts SET publish_claimed_at = now()
     WHERE user_sub = $1 AND post_id = $2 AND state IN ('approved', 'scheduled')
       AND (publish_claimed_at IS NULL OR publish_claimed_at < now() - interval '5 minutes')`, [sub, postId]);
    return !!r.rowCount;
}
/** Record per-channel outcomes on the variant rows. */
async function recordChannelOutcomes(pool, sub, postId, results, skipped) {
    for (const r of results) {
        await pool.query(`UPDATE oshal_switchboard_stream_variants
       SET status = $1, error = $2, external_ref = $3, published_at = CASE WHEN $1 = 'published' THEN now() ELSE published_at END, updated_at = now()
       WHERE user_sub = $4 AND post_id = $5 AND platform = $6`, [r.ok ? 'published' : 'failed', r.ok ? null : String(r.error || r.message || 'failed').slice(0, 500),
            r.ok ? JSON.stringify(r).slice(0, 500) : null, sub, postId, r.platform]);
    }
    for (const s of skipped) {
        await pool.query(`UPDATE oshal_switchboard_stream_variants SET status = 'skipped', error = $1, updated_at = now()
       WHERE user_sub = $2 AND post_id = $3 AND platform = $4`, [s.reason, sub, postId, s.platform]);
    }
}
/**
 * @description The ONE publish core (route + executor both land here): claim → fail-closed
 * plan → per-channel sends via compose's publishTo → outcomes recorded → final state CAS.
 * @param ctx - App context.
 * @param sub - The post owner (publishes on THEIR connector tokens).
 * @param postId - The post to publish.
 * @returns { code, body } for the caller to send (200 carries { post-shape fields, results }).
 */
async function publishPostCore(ctx, sub, postId) {
    const loaded = await loadPost(ctx.pool, sub, postId);
    if (!loaded)
        return { code: 404, body: { error: 'post not found' } };
    const state = String(loaded.post.state);
    if (state !== 'approved' && state !== 'scheduled')
        return { code: 409, body: { error: `cannot publish a ${state} post — approve it first`, state } };
    if (!(await claimForPublish(ctx.pool, sub, postId)))
        return { code: 409, body: { error: 'publish already in progress (or state changed)' } };
    const planned = (0, switchboard_streams_model_1.buildPublishPlan)(loaded.variants.map((v) => ({ platform: String(v.platform), body: String(v.body ?? ''), mediaRef: v.media_ref ?? null })));
    if (planned.error) {
        await ctx.pool.query('UPDATE oshal_switchboard_stream_posts SET publish_claimed_at = NULL WHERE user_sub = $1 AND post_id = $2', [sub, postId]);
        return { code: 400, body: { error: planned.error } };
    }
    const results = await (0, switchboard_streams_model_1.runPublishPlan)(planned.plan, (platform, text) => (0, switchboard_compose_routes_1.publishTo)(ctx, sub, platform, text));
    await recordChannelOutcomes(ctx.pool, sub, postId, results, planned.skipped);
    const summary = (0, switchboard_streams_model_1.summarizePublish)(results, planned.skipped);
    await ctx.pool.query(`UPDATE oshal_switchboard_stream_posts
     SET state = $1, published_at = CASE WHEN $1 = 'published' THEN now() ELSE published_at END,
         publish_error = $2, publish_claimed_at = NULL, updated_at = now()
     WHERE user_sub = $3 AND post_id = $4 AND state IN ('approved', 'scheduled')`, [summary.state, summary.error ?? null, sub, postId]);
    logger.info({ postId, state: summary.state, channels: results.length, skipped: planned.skipped.length }, 'Streams publish completed');
    return { code: 200, body: { results, skipped: planned.skipped, summary } };
}
/** POST /posts/:id/publish — confirm-gated (428 without confirm:true; mirrors compose). */
function registerPublish(router, ctx) {
    router.post('/posts/:id/publish', async (req, res) => {
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
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(req.body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-post', 'Publishing this post to your connected networks'));
            return;
        }
        try {
            const out = await publishPostCore(ctx, sub, id);
            if (out.code !== 200) {
                res.status(out.code).json(out.body);
                return;
            }
            await respondPost(ctx.pool, res, sub, id, 200, out.body);
        }
        catch (err) {
            logger.error({ err, postId: id }, 'Streams publish failed');
            res.status(502).json({ error: err.message });
        }
    });
}
/** GET /posts/:id/revisions/:revisionId — one full revision snapshot. */
function registerRevisionRead(router, ctx) {
    router.get('/posts/:id/revisions/:revisionId', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const id = String(req.params.id);
        const rev = String(req.params.revisionId);
        if (!UUID_RE.test(id) || !UUID_RE.test(rev)) {
            res.status(404).json({ error: 'revision not found' });
            return;
        }
        try {
            const r = (await ctx.pool.query('SELECT revision_id, title, body, variants, note, saved_at FROM oshal_switchboard_stream_revisions WHERE user_sub = $1 AND post_id = $2 AND revision_id = $3', [sub, id, rev])).rows[0];
            if (!r) {
                res.status(404).json({ error: 'revision not found' });
                return;
            }
            res.json({ revision: { revisionId: r.revision_id, title: r.title, body: r.body, variants: r.variants, note: r.note, savedAt: r.saved_at } });
        }
        catch (err) {
            logger.error({ err }, 'Streams revision read failed');
            res.status(502).json({ error: err.message });
        }
    });
}
/** Import one external draft row (idempotent via the (user_sub, source, source_ref) unique). */
async function importOne(pool, sub, source, sourceRef, fields) {
    const r = await pool.query(`INSERT INTO oshal_switchboard_stream_posts (user_sub, title, body, state, source, source_ref, judge_score, judge_rationale, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_sub, source, source_ref) WHERE source_ref IS NOT NULL DO NOTHING
     RETURNING post_id`, [sub, fields.title.slice(0, 140), fields.body, fields.state, source, sourceRef, fields.judgeScore ?? null, fields.judgeRationale ?? null, fields.note ?? null]);
    const postId = r.rows[0]?.post_id;
    if (!postId)
        return false;
    await upsertVariant(pool, sub, postId, { platform: 'linkedin', body: fields.body });
    return true;
}
/** Map a LinkedIn-assistant draft state onto the Streams machine (terminal rows are not imported). */
function mapAssistantState(s) {
    if (s === 'draft')
        return 'draft';
    if (s === 'pending-approval')
        return 'in_review';
    if (s === 'scheduled')
        return 'approved'; // their scheduler never fires; land as approved here
    return null;
}
/** POST /import {source} — pull the caller's drafts from the older stores into Streams. */
function registerImport(router, ctx) {
    router.post('/import', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const source = String(req.body?.source || '');
        try {
            let imported = 0;
            if (source === 'linkedin-assistant') {
                const rows = (await ctx.pool.query(`SELECT id, topic, body, score, rationale, state FROM social_content_drafts WHERE user_sub = $1 AND state IN ('draft', 'pending-approval', 'scheduled') ORDER BY updated_at DESC LIMIT 200`, [sub])).rows;
                for (const d of rows) {
                    const state = mapAssistantState(d.state);
                    if (!state || !d.body?.trim())
                        continue;
                    if (await importOne(ctx.pool, sub, 'linkedin-assistant', String(d.id), { title: d.topic || '', body: d.body, state, judgeScore: d.score, judgeRationale: d.rationale }))
                        imported++;
                }
            }
            else if (source === 'content-studio') {
                const rows = (await ctx.pool.query(`SELECT id, topic, take, draft FROM oshal_content_drafts WHERE user_sub = $1 AND draft IS NOT NULL AND draft <> '' ORDER BY created_at DESC LIMIT 200`, [sub])).rows;
                for (const d of rows) {
                    if (await importOne(ctx.pool, sub, 'content-studio', String(d.id), { title: d.topic || '', body: d.draft, state: 'draft', note: d.take }))
                        imported++;
                }
            }
            else {
                res.status(400).json({ error: "source must be 'linkedin-assistant' or 'content-studio'" });
                return;
            }
            res.json({ imported });
        }
        catch (err) {
            logger.error({ err, source }, 'Streams import failed');
            res.status(502).json({ error: err.message });
        }
    });
}
// ── Due-post executor ─────────────────────────────────────────────────────────
// Publishes DUE stream posts via the SAME publishPostCore the route uses. OFF by default —
// armed by the SAME operator opt-in flag as the calendar executor (SWITCHBOARD_PUBLISH_EXECUTOR),
// so one switch governs all outward scheduled publishing in this package.
let executorStarted = false;
/** Publish every stream post that is due now (trusted-operator background context). */
async function runDueStreamPosts(ctx) {
    await (0, request_identity_1.runWithSystemIdentity)(async () => {
        const due = (await ctx.pool.query(`SELECT post_id, user_sub FROM oshal_switchboard_stream_posts
       WHERE state = 'scheduled' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 10`)).rows;
        for (const p of due) {
            try {
                const out = await publishPostCore(ctx, p.user_sub, p.post_id);
                if (out.code !== 200)
                    logger.warn({ postId: p.post_id, code: out.code, body: out.body }, 'Due stream post did not publish');
            }
            catch (err) {
                logger.error({ err, postId: p.post_id }, 'Stream executor error');
            }
        }
    });
}
/**
 * @description Start the due-post executor loop (once per process). No-op unless the operator
 * armed SWITCHBOARD_PUBLISH_EXECUTOR=true — outward-acting automation is opt-in, default OFF.
 * @param ctx - App context.
 * @returns Nothing; schedules a recurring interval when armed.
 */
function startStreamExecutor(ctx) {
    if (executorStarted)
        return;
    if (!['1', 'true', 'yes'].includes((process.env.SWITCHBOARD_PUBLISH_EXECUTOR || '').trim().toLowerCase())) {
        logger.info('Streams due-post executor disabled (set SWITCHBOARD_PUBLISH_EXECUTOR=true to arm)');
        return;
    }
    executorStarted = true;
    const intervalMs = Math.max(30_000, Number(process.env.SWITCHBOARD_PUBLISH_INTERVAL_MS) || 60_000);
    logger.info({ intervalMs }, 'Streams due-post executor armed');
    setInterval(() => { runDueStreamPosts(ctx).catch((err) => logger.error({ err }, 'Streams executor tick failed')); }, intervalMs);
}
/**
 * @description Builds the Streams pane router: the CMS surface + posts/variants/revisions
 * CRUD, the editorial state machine, confirm-gated publish over compose's publishTo, and
 * the idempotent imports. All caller-scoped (owner-RLS + explicit user_sub); no LLM here.
 * @param ctx - App context (db pool, appPackageDir for the surface).
 * @returns Express router to mount at /streams under the Switchboard app router.
 */
function createStreamsRoutes(ctx) {
    const router = (0, express_1.Router)();
    const assetRoot = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.join(LOAD_TIME_PACKAGE_DIR, 'tools');
    ensureStreamSchema(ctx.pool).catch((err) => logger.error({ err }, 'Failed to ensure switchboard streams schema'));
    startStreamExecutor(ctx);
    router.get('/', servePage(assetRoot, 'switchboard-streams.html'));
    registerList(router, ctx);
    registerCreate(router, ctx);
    registerDetail(router, ctx);
    registerPatch(router, ctx);
    registerTransition(router, ctx);
    registerSchedule(router, ctx);
    registerPublish(router, ctx);
    registerRevisionRead(router, ctx);
    registerImport(router, ctx);
    return router;
}
