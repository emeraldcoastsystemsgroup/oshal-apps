"use strict";
/**
 * Kid Lens Routes — the YouTube-Takeout "what is my kid into" app (ADR-036/037/038).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial — POST /upload-takeout (parse+aggregate+store, raw export encrypted), GET /status, GET /brief, GET / + /upload surfaces. Reason-only bot runs inline on the api container.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Tier-1 RLS at the lazy-DDL chokepoint (A1.2 follow-up): ensureYoutubeKidsSchema appends buildOwnerRlsPolicyStatements.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | ADR-085 carve-out: moved into the youtube-kids store package.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | SECURITY: replace the public SESSION_SECRET fallback with package-local fail-closed encryption.
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | Register the package's owner-scoped watch-history ingest function with the generic manifest Takeout spine.
 * 6   | maintainer@emeraldcoastsystemsgroup.com     | ADR-139 wave 2 — POST /import-artifact {ref}: the "Send to…" destination.
 * 7   | maintainer@emeraldcoastsystemsgroup.com     | GET /status answers {hasData:false} and GET /brief answers {brief:null, hasData:false} when the caller has no activity store yet.
 * 8   | maintainer@emeraldcoastsystemsgroup.com     | Seal raw exports through `@/features/personal-data` encryptField (awaited).
 * 9   | maintainer@emeraldcoastsystemsgroup.com     | Split GET /brief (read-only) from POST /brief (runs analyzer and writes brief under writer admission).
 * 10  | maintainer@emeraldcoastsystemsgroup.com     | RP-KL-01: household child profiles (up to 8 per signed-in parent), per-child watch history uploads and briefs, read-only legacy fallback under GET admission, and owner-scoped child CRUD routes.
 * -----------------------------------------------------------------------------
 *
 * @module youtube-kids-routes
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
exports.isActivityStoreAbsent = isActivityStoreAbsent;
exports.ensureYoutubeKidsSchema = ensureYoutubeKidsSchema;
exports.ingestWatchHistory = ingestWatchHistory;
exports.ingestTakeoutWatchHistory = ingestTakeoutWatchHistory;
exports.createYoutubeKidsRoutes = createYoutubeKidsRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const artifact_exchange_1 = require("@/shared/artifact-exchange");
const agent_management_1 = require("@/features/agent-management");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const youtube_takeout_1 = require("./youtube-takeout");
const personal_data_1 = require("@/features/personal-data");
const youtube_children_store_1 = require("./youtube-children-store");
const logger = (0, logger_1.createChildLogger)({ module: 'youtube-kids-routes' });
let packageDir = process.env.OSHAL_APP_PACKAGE_DIR || '';
const KID_LENS_AGENT_ID = 'a0000000-0000-0000-0000-000000000043';
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
const MAX_UPLOAD = 64 * 1024 * 1024;
const NO_DATA = { error: 'no_data', message: 'Upload your Takeout watch-history.json first.' };
const NO_BRIEF_NO_DATA = { brief: null, hasData: false, analyzed: false, message: NO_DATA.message };
const NO_BRIEF_NOT_ANALYZED = { brief: null, hasData: true, analyzed: false, message: 'The watch history has not been analyzed yet.' };
/** Signed-in caller's OIDC sub (strictly from authenticated OIDC session). */
function callerSub(req) {
    const oidc = req.oidc;
    if (typeof oidc?.isAuthenticated === 'function' && oidc.isAuthenticated() !== true)
        return null;
    return oidc?.user?.sub ? String(oidc.user.sub) : null;
}
/** Serve a static surface file from the package's tools dir. */
function servePage(surfaceDir, file) {
    return (_req, res) => {
        res.sendFile(path.join(surfaceDir, file), (err) => {
            if (err) {
                logger.error({ err, file }, 'serve failed');
                res.status(404).send('Not found');
            }
        });
    };
}
/** Whether a store error means this caller has no activity/children table yet. */
function isActivityStoreAbsent(err) {
    return (0, youtube_children_store_1.isStoreAbsentError)(err);
}
/** Create the per-user activity and child-profile stores if absent on writer paths. */
async function ensureYoutubeKidsSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'youtube kids routes',
        statements: [
            `CREATE TABLE IF NOT EXISTS oshal_youtube_activity (
        user_sub TEXT PRIMARY KEY,
        aggregate JSONB,
        raw_blob TEXT,
        total_watched INT,
        brief TEXT,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        brief_at TIMESTAMPTZ
      )`,
            `CREATE TABLE IF NOT EXISTS oshal_youtube_children (
        user_sub TEXT NOT NULL,
        child_id TEXT NOT NULL,
        name TEXT NOT NULL,
        aggregate JSONB,
        raw_blob TEXT,
        total_watched INT,
        brief TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        uploaded_at TIMESTAMPTZ,
        brief_at TIMESTAMPTZ,
        PRIMARY KEY (user_sub, child_id)
      )`,
            `CREATE INDEX IF NOT EXISTS idx_oshal_youtube_children_owner ON oshal_youtube_children (user_sub, created_at ASC)`,
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_youtube_activity', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_youtube_children', 'user_sub'),
        ],
        requirements: [
            {
                table: 'oshal_youtube_activity',
                columns: ['user_sub', 'aggregate', 'raw_blob', 'total_watched', 'brief', 'uploaded_at', 'brief_at'],
            },
            {
                table: 'oshal_youtube_children',
                columns: ['user_sub', 'child_id', 'name', 'aggregate', 'raw_blob', 'total_watched', 'brief', 'created_at', 'uploaded_at', 'brief_at'],
            },
        ],
    });
}
/** Parse watch-history.json, store aggregate + sealed raw export under the chosen child, and clear stale brief. */
async function ingestWatchHistory(pool, sub, rawJson, requestedChildId) {
    const agg = (0, youtube_takeout_1.parseTakeoutWatchHistory)(rawJson);
    if (agg.totalWatched === 0) {
        const err = new Error('No watch entries found in the upload.');
        err.code = 'no_watch_entries';
        throw err;
    }
    await ensureYoutubeKidsSchema(pool);
    const sealed = await (0, personal_data_1.encryptField)(sub, rawJson);
    const target = await (0, youtube_children_store_1.resolveUploadChild)(pool, sub, requestedChildId);
    await pool.query(`INSERT INTO oshal_youtube_children (user_sub, child_id, name, aggregate, raw_blob, total_watched, brief, uploaded_at, brief_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, now(), NULL)
     ON CONFLICT (user_sub, child_id) DO UPDATE SET
       aggregate = EXCLUDED.aggregate, raw_blob = EXCLUDED.raw_blob,
       total_watched = EXCLUDED.total_watched, brief = NULL, uploaded_at = now(), brief_at = NULL`, [sub, target.childId, target.name, JSON.stringify(agg), sealed, agg.totalWatched]);
    logger.info({ sub, childId: target.childId, totalWatched: agg.totalWatched }, 'kid-lens watch history ingested');
    return {
        childId: target.childId,
        childName: target.name,
        totalWatched: agg.totalWatched,
        distinctChannels: agg.distinctChannels,
        dateRange: agg.dateRange,
        topChannels: agg.topChannels.slice(0, 8),
    };
}
/** Package contribution invoked by the generic `/api/takeout` spine. */
async function ingestTakeoutWatchHistory(ctx, input) {
    if (!input.userSub.trim()) {
        const error = new Error('Authenticated Takeout owner is required');
        error.code = 'not_authenticated';
        throw error;
    }
    const result = await ingestWatchHistory(ctx.pool, input.userSub, input.content);
    return {
        summary: `Stored ${result.totalWatched} watch entries across ${result.distinctChannels} channels.`,
    };
}
/** Build the self-contained analyzer prompt for a child's aggregate. */
function buildBriefPrompt(agg, childName) {
    const subject = childName && childName !== 'Child 1' ? `${childName}'s` : 'their child\'s';
    return [
        `You are Kid Lens. A parent has handed you an aggregate of ${subject} YouTube watch`,
        'history (top channels with watch counts + sample video titles, a per-month trend, and a',
        'recent-titles sample). Produce a warm, practical, parent-facing brief. Ground EVERY claim',
        'in the data below — never invent channels or interests. Use Markdown with these sections:',
        '',
        '## Top interests',
        'Ranked clusters (e.g. gaming → which games, a specific creator, music → which artists, a',
        'hobby), each one line in plain English a parent will understand.',
        '## What these channels are',
        'For the less-obvious channels: one line each — who they are and why a kid likes them.',
        '## Rising vs fading',
        'From the monthly trend: what is hot right now vs what has cooled off.',
        '## Gift ideas',
        'Concrete, specific gift ideas tied to the actual interests/channels above.',
        '## Talk to your kid',
        'A few ready-to-use conversation openers ("ask them about ...") referencing real channels.',
        '## Worth a glance',
        'Optional, brief, non-judgmental: anything a parent might want to be aware of re: age-fit.',
        '',
        'Be concise — short sentences and tight bullets. No preamble, no sign-off.',
        '',
        'WATCH-HISTORY AGGREGATE (JSON):',
        JSON.stringify(agg),
    ].join('\n');
}
/** Run the Kid Lens bot over the aggregate. */
async function runAnalyzer(ctx, sub, agg, childName) {
    const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, KID_LENS_AGENT_ID, {
        text: buildBriefPrompt(agg, childName), taskId: `kidlens-${sub}`, workspaceFolderId: `kidlens-${sub}`,
        agentId: KID_LENS_AGENT_ID, agenticMode: true, direct: true, userSub: sub,
    });
    return String(result.response || '').trim();
}
/** Read status row for a specific child or default child without mutating state. */
async function handleGetStatus(ctx, req, res) {
    const sub = callerSub(req);
    if (!sub) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
    }
    const parsedId = (0, youtube_children_store_1.parseChildIdInput)(req.query?.childId);
    if (parsedId.provided && 'invalid' in parsedId) {
        res.status(400).json({ error: 'invalid_child_id', message: 'Invalid child profile ID.' });
        return;
    }
    try {
        const childRows = await queryChildrenRowsSafe(ctx.pool, sub);
        if (childRows && childRows.length > 0 && typeof childRows[0].child_id === 'string' && childRows[0].child_id) {
            const target = parsedId.provided
                ? childRows.find((r) => r.child_id === parsedId.childId)
                : (childRows.find((r) => r.aggregate != null || r.total_watched != null) ?? childRows[0]);
            if (!target) {
                res.json({ hasData: false, childNotFound: true });
                return;
            }
            const summary = (0, youtube_children_store_1.rowToChildSummary)(target);
            if (!summary.hasData) {
                res.json(parsedId.provided ? { hasData: false, childId: summary.childId, childName: summary.name } : { hasData: false });
                return;
            }
            res.json({ hasData: true, childId: summary.childId, childName: summary.name, totalWatched: summary.totalWatched, dateRange: summary.dateRange, hasBrief: summary.hasBrief, uploadedAt: summary.uploadedAt, briefAt: summary.briefAt });
            return;
        }
        const row = (childRows && childRows[0]) || (await ctx.pool.query(`SELECT total_watched, aggregate->'dateRange' AS date_range, (brief IS NOT NULL) AS has_brief, uploaded_at, brief_at FROM oshal_youtube_activity WHERE user_sub = $1`, [sub])).rows[0];
        if (!row) {
            res.json({ hasData: false });
            return;
        }
        res.json({ hasData: true, totalWatched: row.total_watched, dateRange: row.date_range, hasBrief: row.has_brief, uploadedAt: row.uploaded_at, briefAt: row.brief_at });
    }
    catch (err) {
        if (isActivityStoreAbsent(err)) {
            res.json({ hasData: false });
            return;
        }
        logger.error({ err }, 'kid-lens status failed');
        res.status(500).json({ error: err.message });
    }
}
/** Query oshal_youtube_children safely under read admission, returning null if table absent. */
async function queryChildrenRowsSafe(pool, sub) {
    try {
        const r = await pool.query(`SELECT child_id, name, aggregate, aggregate->'dateRange' AS date_range, total_watched, (aggregate IS NOT NULL) AS has_data, (brief IS NOT NULL) AS has_brief, brief, uploaded_at, brief_at
         FROM oshal_youtube_children WHERE user_sub = $1 ORDER BY created_at ASC, child_id ASC`, [sub]);
        return r.rows;
    }
    catch (err) {
        if (isActivityStoreAbsent(err))
            return null;
        throw err;
    }
}
/** Read stored brief for a specific child or default child without running analyzer or mutating. */
async function handleGetBrief(ctx, req, res) {
    const sub = callerSub(req);
    if (!sub) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
    }
    const parsedId = (0, youtube_children_store_1.parseChildIdInput)(req.query?.childId);
    if (parsedId.provided && 'invalid' in parsedId) {
        res.status(400).json({ error: 'invalid_child_id', message: 'Invalid child profile ID.' });
        return;
    }
    try {
        const childRows = await queryChildrenRowsSafe(ctx.pool, sub);
        if (childRows && childRows.length > 0 && typeof childRows[0].child_id === 'string' && childRows[0].child_id) {
            const row = parsedId.provided
                ? childRows.find((r) => r.child_id === parsedId.childId)
                : (childRows.find((r) => r.aggregate != null || r.has_data) ?? childRows[0]);
            if (!row) {
                res.json({ ...NO_BRIEF_NO_DATA, childNotFound: true, message: 'No child profile with that ID.' });
                return;
            }
            const hasData = Boolean(row.has_data ?? (row.aggregate != null));
            if (!hasData) {
                res.json({ ...NO_BRIEF_NO_DATA, childId: row.child_id, childName: row.name });
                return;
            }
            if (!row.brief) {
                res.json({ ...NO_BRIEF_NOT_ANALYZED, childId: row.child_id, childName: row.name });
                return;
            }
            res.json({ brief: row.brief, briefAt: row.brief_at, childId: row.child_id, childName: row.name, hasData: true, analyzed: true, cached: true });
            return;
        }
        const row = (childRows && childRows[0]) || (await ctx.pool.query('SELECT (aggregate IS NOT NULL) AS has_data, brief, brief_at FROM oshal_youtube_activity WHERE user_sub = $1', [sub])).rows[0];
        if (!row || !row.has_data) {
            res.json(NO_BRIEF_NO_DATA);
            return;
        }
        if (!row.brief) {
            res.json(NO_BRIEF_NOT_ANALYZED);
            return;
        }
        res.json({ brief: row.brief, briefAt: row.brief_at, hasData: true, analyzed: true, cached: true });
    }
    catch (err) {
        if (isActivityStoreAbsent(err)) {
            res.json(NO_BRIEF_NO_DATA);
            return;
        }
        logger.error({ err }, 'kid-lens brief read failed');
        res.status(500).json({ error: 'brief_unavailable', message: err.message });
    }
}
/** Run the analyzer for a child's stored aggregate and persist the resulting brief. */
async function handlePostBrief(ctx, req, res) {
    const sub = callerSub(req);
    if (!sub) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
    }
    const rawId = req.body?.childId ?? req.query?.childId;
    const parsedId = (0, youtube_children_store_1.parseChildIdInput)(rawId);
    if (parsedId.provided && 'invalid' in parsedId) {
        res.status(400).json({ error: 'invalid_child_id', message: 'Invalid child profile ID.' });
        return;
    }
    try {
        const childRows = await queryChildrenRowsSafe(ctx.pool, sub);
        if (childRows && childRows.length > 0 && typeof childRows[0].child_id === 'string' && childRows[0].child_id) {
            const target = parsedId.provided
                ? childRows.find((r) => r.child_id === parsedId.childId)
                : (childRows.find((r) => r.aggregate != null) ?? childRows[0]);
            if (!target) {
                res.status(404).json({ error: 'child_not_found', message: 'No child profile with that ID.' });
                return;
            }
            const agg = (0, youtube_children_store_1.parseStoredAggregate)(target.aggregate);
            if (!agg) {
                res.status(404).json(NO_DATA);
                return;
            }
            const brief = await runAnalyzer(ctx, sub, agg, String(target.name || ''));
            if (!brief) {
                res.status(502).json({ error: 'empty_brief', message: 'The analyzer returned nothing — try again.' });
                return;
            }
            await ctx.pool.query('UPDATE oshal_youtube_children SET brief = $3, brief_at = now() WHERE user_sub = $1 AND child_id = $2', [sub, target.child_id, brief]);
            res.json({ brief, cached: false, childId: target.child_id, childName: target.name });
            return;
        }
        if (parsedId.provided && parsedId.childId !== 'default') {
            res.status(404).json({ error: 'child_not_found', message: 'No child profile with that ID.' });
            return;
        }
        const row = (childRows && childRows[0]) || (await ctx.pool.query('SELECT aggregate FROM oshal_youtube_activity WHERE user_sub = $1', [sub])).rows[0];
        const agg = row ? (0, youtube_children_store_1.parseStoredAggregate)(row.aggregate) : null;
        if (!agg) {
            res.status(404).json(NO_DATA);
            return;
        }
        const brief = await runAnalyzer(ctx, sub, agg);
        if (!brief) {
            res.status(502).json({ error: 'empty_brief', message: 'The analyzer returned nothing — try again.' });
            return;
        }
        await ctx.pool.query('UPDATE oshal_youtube_activity SET brief = $2, brief_at = now() WHERE user_sub = $1', [sub, brief]);
        res.json({ brief, cached: false });
    }
    catch (err) {
        if (isActivityStoreAbsent(err)) {
            res.status(404).json(NO_DATA);
            return;
        }
        logger.error({ err }, 'kid-lens brief failed');
        res.status(502).json({ error: err.message });
    }
}
/** Add a new child profile by first name (capped at MAX_CHILDREN = 8 per parent). */
async function handleCreateChild(ctx, req, res) {
    const sub = callerSub(req);
    if (!sub) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
    }
    const v = (0, youtube_children_store_1.validateChildName)(req.body?.name);
    if (!v.ok) {
        res.status(400).json({ error: 'invalid_child_name', message: v.message });
        return;
    }
    try {
        await ensureYoutubeKidsSchema(ctx.pool);
        const existing = await (0, youtube_children_store_1.ensureMigratedChildrenForWrite)(ctx.pool, sub);
        if (existing.length >= youtube_children_store_1.MAX_CHILDREN) {
            res.status(409).json({ error: 'child_limit_reached', message: `You can add up to ${youtube_children_store_1.MAX_CHILDREN} child profiles per account.` });
            return;
        }
        if (existing.some((c) => c.name.toLowerCase() === v.name.toLowerCase())) {
            res.status(409).json({ error: 'duplicate_child_name', message: `A profile named ${v.name} already exists.` });
            return;
        }
        const childId = (0, youtube_children_store_1.allocateChildId)(v.name, new Set(existing.map((c) => c.child_id)));
        await ctx.pool.query(`INSERT INTO oshal_youtube_children (user_sub, child_id, name) VALUES ($1, $2, $3)`, [sub, childId, v.name]);
        const children = await (0, youtube_children_store_1.listChildrenReadOnly)(ctx.pool, sub);
        const created = children.find((c) => c.childId === childId) ?? {
            childId, name: v.name, hasData: false, totalWatched: 0, hasBrief: false, uploadedAt: null, briefAt: null, dateRange: null,
        };
        res.status(201).json({ ok: true, child: created, children, maxChildren: youtube_children_store_1.MAX_CHILDREN });
    }
    catch (err) {
        logger.error({ err }, 'kid-lens create child failed');
        res.status(500).json({ error: err.message });
    }
}
/** Rename an existing child profile owned by the signed-in parent. */
async function handleRenameChild(ctx, req, res) {
    const sub = callerSub(req);
    if (!sub) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
    }
    const rawId = req.params?.childId ?? req.body?.childId;
    const parsedId = (0, youtube_children_store_1.parseChildIdInput)(rawId);
    if (!parsedId.provided || 'invalid' in parsedId) {
        res.status(400).json({ error: 'invalid_child_id', message: 'Provide a valid child profile ID.' });
        return;
    }
    const v = (0, youtube_children_store_1.validateChildName)(req.body?.name);
    if (!v.ok) {
        res.status(400).json({ error: 'invalid_child_name', message: v.message });
        return;
    }
    try {
        await ensureYoutubeKidsSchema(ctx.pool);
        const existing = await (0, youtube_children_store_1.ensureMigratedChildrenForWrite)(ctx.pool, sub);
        const targetId = parsedId.childId === 'default' ? 'child-1' : parsedId.childId;
        const target = existing.find((c) => c.child_id === targetId);
        if (!target) {
            res.status(404).json({ error: 'child_not_found', message: 'No child profile with that ID.' });
            return;
        }
        if (existing.some((c) => c.child_id !== targetId && c.name.toLowerCase() === v.name.toLowerCase())) {
            res.status(409).json({ error: 'duplicate_child_name', message: `A profile named ${v.name} already exists.` });
            return;
        }
        await ctx.pool.query(`UPDATE oshal_youtube_children SET name = $3 WHERE user_sub = $1 AND child_id = $2`, [sub, targetId, v.name]);
        const children = await (0, youtube_children_store_1.listChildrenReadOnly)(ctx.pool, sub);
        res.json({ ok: true, child: children.find((c) => c.childId === targetId) ?? null, children, maxChildren: youtube_children_store_1.MAX_CHILDREN });
    }
    catch (err) {
        logger.error({ err }, 'kid-lens rename child failed');
        res.status(500).json({ error: err.message });
    }
}
/** Delete an existing child profile and all of its stored watch history and brief. */
async function handleDeleteChild(ctx, req, res) {
    const sub = callerSub(req);
    if (!sub) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
    }
    const rawId = req.params?.childId ?? req.body?.childId;
    const parsedId = (0, youtube_children_store_1.parseChildIdInput)(rawId);
    if (!parsedId.provided || 'invalid' in parsedId) {
        res.status(400).json({ error: 'invalid_child_id', message: 'Provide a valid child profile ID.' });
        return;
    }
    try {
        await ensureYoutubeKidsSchema(ctx.pool);
        const existing = await (0, youtube_children_store_1.ensureMigratedChildrenForWrite)(ctx.pool, sub);
        const targetId = parsedId.childId === 'default' ? 'child-1' : parsedId.childId;
        if (!existing.some((c) => c.child_id === targetId)) {
            res.status(404).json({ error: 'child_not_found', message: 'No child profile with that ID.' });
            return;
        }
        await ctx.pool.query(`DELETE FROM oshal_youtube_children WHERE user_sub = $1 AND child_id = $2`, [sub, targetId]);
        const children = await (0, youtube_children_store_1.listChildrenReadOnly)(ctx.pool, sub);
        res.json({ ok: true, deletedChildId: targetId, children, maxChildren: youtube_children_store_1.MAX_CHILDREN });
    }
    catch (err) {
        logger.error({ err }, 'kid-lens delete child failed');
        res.status(500).json({ error: err.message });
    }
}
/** Upload raw watch-history.json body under the selected or default child profile. */
async function handleUploadTakeout(ctx, req, res) {
    const sub = callerSub(req);
    if (!sub) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
    }
    const parsedId = (0, youtube_children_store_1.parseChildIdInput)(req.query?.childId);
    if (parsedId.provided && 'invalid' in parsedId) {
        res.status(400).json({ error: 'invalid_child_id', message: 'Invalid child profile ID.' });
        return;
    }
    const body = req.body;
    if (!body || !body.length) {
        res.status(400).json({ error: 'empty body' });
        return;
    }
    try {
        const result = await ingestWatchHistory(ctx.pool, sub, body.toString('utf8'), parsedId.provided ? parsedId.childId : undefined);
        res.json({ ok: true, ...result });
    }
    catch (err) {
        const code = err.code;
        if (code === 'no_watch_entries') {
            res.status(422).json({ error: 'no_watch_entries', message: 'No watch entries found. Upload the watch-history.json from your YouTube Takeout (choose the JSON format).' });
            return;
        }
        if (code === 'child_not_found') {
            res.status(404).json({ error: 'child_not_found', message: 'No child profile with that ID.' });
            return;
        }
        logger.error({ err }, 'kid-lens upload failed');
        res.status(500).json({ error: err.message });
    }
}
/** Redeem an owner-bound artifact relay ref and ingest it under the selected or default child profile. */
async function handleImportArtifact(ctx, req, res) {
    const sub = callerSub(req);
    if (!sub) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
    }
    const bodyObj = req.body ?? {};
    const parsedId = (0, youtube_children_store_1.parseChildIdInput)(bodyObj.childId ?? req.query?.childId);
    if (parsedId.provided && 'invalid' in parsedId) {
        res.status(400).json({ error: 'invalid_child_id', message: 'Invalid child profile ID.' });
        return;
    }
    const ref = String(bodyObj.ref ?? '');
    const redeemed = await (0, artifact_exchange_1.redeemArtifactViaRelay)({ port: req.socket.localPort, callerSub: sub, ref, maxBytes: MAX_UPLOAD });
    if (!redeemed.ok) {
        res.status(redeemed.status).json({ error: redeemed.error });
        return;
    }
    try {
        const result = await ingestWatchHistory(ctx.pool, sub, redeemed.buffer.toString('utf8'), parsedId.provided ? parsedId.childId : undefined);
        res.json({ ok: true, ...result, message: `Watch history ingested from ${redeemed.name} — open Kid Lens for the brief.` });
    }
    catch (err) {
        const code = err.code;
        if (code === 'no_watch_entries') {
            res.status(422).json({ error: 'no_watch_entries', message: 'That file has no watch entries — send the watch-history.json from a YouTube Takeout (JSON format).' });
            return;
        }
        if (code === 'child_not_found') {
            res.status(404).json({ error: 'child_not_found', message: 'No child profile with that ID.' });
            return;
        }
        logger.error({ err }, 'kid-lens artifact import failed');
        res.status(500).json({ error: err.message });
    }
}
/** Build the Kid Lens router mounted at /api/youtube-kids. */
function createYoutubeKidsRoutes(ctx) {
    if (ctx.appPackageDir)
        packageDir = ctx.appPackageDir;
    const surfaceDir = packageDir ? path.join(packageDir, 'tools') : path.resolve(process.cwd(), 'tools');
    const router = (0, express_1.Router)();
    router.get('/', servePage(surfaceDir, 'youtube-kids-dashboard.html'));
    router.get('/upload', servePage(surfaceDir, 'youtube-kids-dashboard.html'));
    router.get('/children', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            res.json({ children: await (0, youtube_children_store_1.listChildrenReadOnly)(ctx.pool, sub), maxChildren: youtube_children_store_1.MAX_CHILDREN });
        }
        catch (err) {
            logger.error({ err }, 'kid-lens list children failed');
            res.status(500).json({ error: err.message });
        }
    });
    router.post('/children', (req, res) => handleCreateChild(ctx, req, res));
    router.post('/children/rename', (req, res) => handleRenameChild(ctx, req, res));
    router.post('/children/delete', (req, res) => handleDeleteChild(ctx, req, res));
    if (typeof router.patch === 'function')
        router.patch('/children/:childId', (req, res) => handleRenameChild(ctx, req, res));
    if (typeof router.delete === 'function')
        router.delete('/children/:childId', (req, res) => handleDeleteChild(ctx, req, res));
    router.get('/status', (req, res) => handleGetStatus(ctx, req, res));
    router.get('/brief', (req, res) => handleGetBrief(ctx, req, res));
    router.post('/brief', (req, res) => handlePostBrief(ctx, req, res));
    router.post('/upload-takeout', (0, express_1.raw)({ type: '*/*', limit: MAX_UPLOAD }), (req, res) => handleUploadTakeout(ctx, req, res));
    router.post('/import-artifact', (req, res) => handleImportArtifact(ctx, req, res));
    return router;
}
//# sourceMappingURL=youtube-kids-routes.js.map