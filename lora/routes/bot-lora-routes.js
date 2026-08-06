"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Await durable GPU task enqueue before returning task identity or reporting box availability.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Make character/model/score access owner-bound at both route and FORCE-RLS layers, narrow box callbacks to a separate exact owner identity, and give each caller an isolated starter character.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Keep system seed creation in install migrations only so lazy runtime schema validation cannot attempt a cross-owner insert after FORCE RLS is active.
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
exports.LORA_DIRECTOR_AGENT_ID = void 0;
exports.ensureLoraSchema = ensureLoraSchema;
exports.createBotLoraRoutes = createBotLoraRoutes;
exports.createLoraIngestRoutes = createLoraIngestRoutes;
/**
 * Bot LoRA routes — the LoRA Studio (?app=lora) API. The lora-director bot reasons over the
 * pipeline; the heavy work runs off the api: dataset generation + validation over the GPU box's
 * ComfyUI HTTP API (free), and kohya training on the box ONLY via a queue-manager ticket + the
 * worker node's gated shell.exec (ADR-070 privilege rule). The controller stores the authoritative
 * version + score metadata (oshal_lora_*); the box keeps the .safetensors / datasets / samples.
 *
 * Phases on disk: P0/P1 here = the data spine (characters, versions, scorecards, the box→controller
 * /ingest callback, the studio surface). Box-dependent training dispatch (/train, /validate,
 * /improve) is wired in P3 (lora-train-dispatch) and returns `box_required` until then.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-24 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial LoRA Studio routes — P0 skeleton + P1 scorecard ingest/read (data spine, box-independent).
 * 2026-07-17 19:05:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-085 carve-out into the lora store package. Studio factory is the standard (ctx) shape — the surface serves from this package's tools/ (ctx.appPackageDir, portrait-studio pattern). The ingest router's internal paths move to '/' because the package mounts it at /api/lora/ingest (the loader-sanctioned split-mountPath shape for mixed auth: ingest = auth public + self-guard, studio = auth oidc) — the external URL the box calls is unchanged. scorecard + lora-train-dispatch are vendored package siblings (relative imports); shared core helpers stay @/ aliases (resolved by the loader at runtime).
 */
const express_1 = require("express");
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const authz_1 = require("@/shared/middleware/authz");
const trusted_service_user_identity_1 = require("@/shared/middleware/trusted-service-user-identity");
const scorecard_1 = require("./scorecard");
const lora_train_dispatch_1 = require("./lora-train-dispatch");
const logger = (0, logger_1.createChildLogger)({ module: 'bot-lora-routes' });
/** Package install dir — set by the loader on the context; env fallback for tool-style callers. */
let packageDir = process.env.OSHAL_APP_PACKAGE_DIR || '';
/** The LoRA Studio's own bot — reasons over training/validation, owns the cost line. */
const LORA_DIRECTOR_AGENT_ID = 'a0000000-0000-0000-0000-000000000049';
exports.LORA_DIRECTOR_AGENT_ID = LORA_DIRECTOR_AGENT_ID;
/** Signed-in caller's OIDC sub. */
function callerSub(req) {
    // Independently authenticated browser/PAT identity wins over compatibility machine headers.
    // A service assertion is accepted only behind the configured secret and is narrowed to a
    // non-operator DB identity before the ingest handler runs.
    return (0, authz_1.getCaller)(req).sub ?? (0, authz_1.getTrustedServiceUserSub)(req);
}
/** LoRA Studio schema: characters + their trained versions + each version's validation score. */
async function ensureLoraSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'lora routes',
        statements: [
            `CREATE TABLE IF NOT EXISTS oshal_lora_characters (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subject TEXT NOT NULL,
        display_name TEXT NOT NULL,
        trigger_word TEXT NOT NULL,
        hero_image TEXT,
        base_model TEXT NOT NULL DEFAULT 'v1-5-pruned-emaonly-fp16.safetensors',
        ident_prompt TEXT,
        autonomous BOOLEAN NOT NULL DEFAULT FALSE,
        max_hours NUMERIC(5,2) NOT NULL DEFAULT 9,
        plateau_epsilon NUMERIC(6,4) NOT NULL DEFAULT 0.0050,
        active_version INTEGER,
        owner_sub TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (owner_sub, subject)
      )`,
            `CREATE TABLE IF NOT EXISTS oshal_lora_models (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        lora_path TEXT,
        base_model TEXT,
        dataset_count INTEGER,
        network_dim INTEGER,
        epochs INTEGER,
        steps INTEGER,
        final_loss NUMERIC(10,5),
        duration_sec INTEGER,
        parent_version INTEGER,
        ticket_id TEXT,
        metrics JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (character_id, version)
      )`,
            'CREATE INDEX IF NOT EXISTS idx_lora_models_char ON oshal_lora_models(character_id, version DESC)',
            `CREATE TABLE IF NOT EXISTS oshal_lora_scores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        overall NUMERIC(6,4),
        identity_mean NUMERIC(6,4),
        quality_mean NUMERIC(6,4),
        min_cell NUMERIC(6,4),
        cells JSONB,
        weak_cells JSONB,
        gallery_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (character_id, version)
      )`,
            'ALTER TABLE oshal_lora_characters ADD COLUMN IF NOT EXISTS owner_sub TEXT',
            "UPDATE oshal_lora_characters SET owner_sub = 'system:legacy:lora' WHERE owner_sub IS NULL OR btrim(owner_sub) = ''",
            'ALTER TABLE oshal_lora_characters ALTER COLUMN owner_sub SET NOT NULL',
            'ALTER TABLE oshal_lora_characters DROP CONSTRAINT IF EXISTS oshal_lora_characters_subject_key',
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_lora_characters_owner_subject ON oshal_lora_characters(owner_sub, subject)',
            // The package migration owns the optional system seed. Runtime bootstrap can run after FORCE
            // RLS is already active and must never try to insert a row outside the current user's scope.
            // ensureOwnerStarterCharacter below creates the only starter row an ordinary request needs.
            'ALTER TABLE oshal_lora_characters ENABLE ROW LEVEL SECURITY',
            'ALTER TABLE oshal_lora_characters FORCE ROW LEVEL SECURITY',
            'DROP POLICY IF EXISTS oshal_lora_characters_owner_policy ON oshal_lora_characters',
            `CREATE POLICY oshal_lora_characters_owner_policy ON oshal_lora_characters
         USING (owner_sub = current_setting('oshal.current_sub', true)
                OR current_setting('oshal.is_operator', true) = 'on')
         WITH CHECK (owner_sub = current_setting('oshal.current_sub', true)
                     OR current_setting('oshal.is_operator', true) = 'on')`,
            'ALTER TABLE oshal_lora_models ENABLE ROW LEVEL SECURITY',
            'ALTER TABLE oshal_lora_models FORCE ROW LEVEL SECURITY',
            'DROP POLICY IF EXISTS oshal_lora_models_owner_policy ON oshal_lora_models',
            `CREATE POLICY oshal_lora_models_owner_policy ON oshal_lora_models
         USING (EXISTS (SELECT 1 FROM oshal_lora_characters c
                         WHERE c.id = oshal_lora_models.character_id
                           AND (c.owner_sub = current_setting('oshal.current_sub', true)
                                OR current_setting('oshal.is_operator', true) = 'on')))
         WITH CHECK (EXISTS (SELECT 1 FROM oshal_lora_characters c
                             WHERE c.id = oshal_lora_models.character_id
                               AND (c.owner_sub = current_setting('oshal.current_sub', true)
                                    OR current_setting('oshal.is_operator', true) = 'on')))`,
            'ALTER TABLE oshal_lora_scores ENABLE ROW LEVEL SECURITY',
            'ALTER TABLE oshal_lora_scores FORCE ROW LEVEL SECURITY',
            'DROP POLICY IF EXISTS oshal_lora_scores_owner_policy ON oshal_lora_scores',
            `CREATE POLICY oshal_lora_scores_owner_policy ON oshal_lora_scores
         USING (EXISTS (SELECT 1 FROM oshal_lora_characters c
                         WHERE c.id = oshal_lora_scores.character_id
                           AND (c.owner_sub = current_setting('oshal.current_sub', true)
                                OR current_setting('oshal.is_operator', true) = 'on')))
         WITH CHECK (EXISTS (SELECT 1 FROM oshal_lora_characters c
                             WHERE c.id = oshal_lora_scores.character_id
                               AND (c.owner_sub = current_setting('oshal.current_sub', true)
                                    OR current_setting('oshal.is_operator', true) = 'on')))`,
        ],
        requirements: [
            { table: 'oshal_lora_characters', columns: ['id', 'subject', 'display_name', 'trigger_word', 'hero_image', 'base_model', 'ident_prompt', 'autonomous', 'max_hours', 'plateau_epsilon', 'active_version', 'owner_sub', 'created_at'] },
            { table: 'oshal_lora_models', columns: ['id', 'character_id', 'version', 'status', 'lora_path', 'base_model', 'dataset_count', 'network_dim', 'epochs', 'steps', 'final_loss', 'duration_sec', 'parent_version', 'ticket_id', 'metrics', 'created_at'] },
            { table: 'oshal_lora_scores', columns: ['id', 'character_id', 'version', 'overall', 'identity_mean', 'quality_mean', 'min_cell', 'cells', 'weak_cells', 'gallery_url', 'created_at'] },
        ],
    });
}
/** Resolve a character row id from its subject slug. */
async function characterId(ctx, subject, ownerSub) {
    const r = (await ctx.pool.query('SELECT id FROM oshal_lora_characters WHERE subject = $1 AND owner_sub = $2', [subject, ownerSub])).rows[0];
    return r?.id ?? null;
}
/** Give each authenticated caller an independent copy of the starter character configuration. */
async function ensureOwnerStarterCharacter(ctx, ownerSub) {
    await ctx.pool.query(`INSERT INTO oshal_lora_characters
       (subject, display_name, trigger_word, hero_image, base_model, ident_prompt, owner_sub)
     VALUES ('oshbrainrot', 'Cyclops (oshbrainrot)', 'oshbrainrot', 'hero_brainrot_00002_.png',
       'v1-5-pruned-emaonly-fp16.safetensors',
       'a one-eyed leathery orange-red screaming cyclops creature, big single eye, wide toothy mouth, stubby clawed legs, long thin arms, glossy 3d render, italian brainrot meme style',
       $1)
     ON CONFLICT (owner_sub, subject) DO NOTHING`, [ownerSub]);
}
/**
 * @description Creates the gated LoRA Studio routes (mounted behind requiresAuth). Read/data routes
 * for characters, versions, and scorecards; the box-dependent action routes return `box_required`
 * until the training dispatch lands (P3).
 * @param ctx - app context (pool, swarm cost tracking + appPackageDir)
 */
function createBotLoraRoutes(ctx) {
    if (ctx.appPackageDir)
        packageDir = ctx.appPackageDir;
    const surfaceDir = packageDir ? path.join(packageDir, 'tools') : path.resolve(process.cwd(), 'tools');
    const router = (0, express_1.Router)();
    void ensureLoraSchema(ctx.pool).catch((err) => logger.warn({ err: err?.message }, 'lora schema ensure failed'));
    /** GET /ui — the LoRA Studio surface (served from this package's tools/). */
    router.get('/ui', (_req, res) => {
        res.sendFile(path.join(surfaceDir, 'lora.html'), (err) => {
            if (err) {
                logger.error({ err }, 'serve lora UI failed');
                res.status(404).send('Page not found');
            }
        });
    });
    /** GET /characters — every character with its latest version + latest overall score. */
    router.get('/characters', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await ensureOwnerStarterCharacter(ctx, sub);
            const rows = (await ctx.pool.query(`SELECT c.subject, c.display_name, c.trigger_word, c.hero_image, c.base_model, c.ident_prompt,
                c.autonomous, c.max_hours, c.plateau_epsilon, c.active_version, c.created_at,
                (SELECT max(version) FROM oshal_lora_models m WHERE m.character_id = c.id) AS latest_version,
                (SELECT count(*) FROM oshal_lora_models m WHERE m.character_id = c.id) AS version_count,
                (SELECT s.overall FROM oshal_lora_scores s WHERE s.character_id = c.id ORDER BY s.version DESC LIMIT 1) AS latest_score
         FROM oshal_lora_characters c
         WHERE c.owner_sub = $1
         ORDER BY c.created_at ASC`, [sub])).rows;
            res.json({ characters: rows });
        }
        catch (err) {
            logger.error({ err }, 'list characters failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /models?subject= — the version timeline (each version joined with its score). */
    router.get('/models', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const subject = String(req.query.subject || '').trim();
        if (!subject) {
            res.status(400).json({ error: 'subject required' });
            return;
        }
        try {
            const id = await characterId(ctx, subject, sub);
            if (!id) {
                res.status(404).json({ error: 'character not found' });
                return;
            }
            const rows = (await ctx.pool.query(`SELECT m.version, m.status, m.lora_path, m.base_model, m.dataset_count, m.network_dim, m.epochs,
                m.steps, m.final_loss, m.duration_sec, m.parent_version, m.ticket_id, m.created_at,
                s.overall, s.identity_mean, s.quality_mean, s.min_cell, s.weak_cells, s.gallery_url
         FROM oshal_lora_models m
         LEFT JOIN oshal_lora_scores s ON s.character_id = m.character_id AND s.version = m.version
         WHERE m.character_id = $1 ORDER BY m.version DESC`, [id])).rows;
            res.json({ subject, models: rows });
        }
        catch (err) {
            logger.error({ err }, 'list models failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /scorecard?subject=&version= — the per-cell scores for one version (drives the gallery). */
    router.get('/scorecard', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const subject = String(req.query.subject || '').trim();
        const version = Number(req.query.version);
        if (!subject || !Number.isInteger(version)) {
            res.status(400).json({ error: 'subject + version required' });
            return;
        }
        try {
            const id = await characterId(ctx, subject, sub);
            if (!id) {
                res.status(404).json({ error: 'character not found' });
                return;
            }
            const row = (await ctx.pool.query(`SELECT version, overall, identity_mean, quality_mean, min_cell, cells, weak_cells, gallery_url, created_at
         FROM oshal_lora_scores WHERE character_id = $1 AND version = $2`, [id, version])).rows[0];
            if (!row) {
                res.status(404).json({ error: 'no scorecard for that version' });
                return;
            }
            res.json({ subject, scorecard: row });
        }
        catch (err) {
            logger.error({ err }, 'get scorecard failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /characters/:subject/autonomous — toggle the opt-in improve-overnight mode (controller-only). */
    router.post('/characters/:subject/autonomous', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const subject = String(req.params.subject || '').trim();
        const body = req.body;
        try {
            const r = await ctx.pool.query(`UPDATE oshal_lora_characters
         SET autonomous = COALESCE($2, autonomous),
             max_hours = COALESCE($3, max_hours),
             plateau_epsilon = COALESCE($4, plateau_epsilon)
         WHERE subject = $1 AND owner_sub = $5
         RETURNING autonomous, max_hours, plateau_epsilon`, [subject, typeof body.enabled === 'boolean' ? body.enabled : null,
                Number.isFinite(body.maxHours) ? body.maxHours : null,
                Number.isFinite(body.plateauEpsilon) ? body.plateauEpsilon : null, sub]);
            if (!r.rowCount) {
                res.status(404).json({ error: 'character not found' });
                return;
            }
            res.json({ ok: true, ...r.rows[0] });
        }
        catch (err) {
            logger.error({ err }, 'set autonomous failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /characters/:subject/active — keep-best: set the active version (the human decision). */
    router.post('/characters/:subject/active', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const subject = String(req.params.subject || '').trim();
        const version = Number(req.body.version);
        if (!Number.isInteger(version)) {
            res.status(400).json({ error: 'version required' });
            return;
        }
        try {
            const id = await characterId(ctx, subject, sub);
            if (!id) {
                res.status(404).json({ error: 'character not found' });
                return;
            }
            const exists = (await ctx.pool.query('SELECT 1 FROM oshal_lora_models WHERE character_id = $1 AND version = $2', [id, version])).rowCount;
            if (!exists) {
                res.status(404).json({ error: 'no such version' });
                return;
            }
            await ctx.pool.query('UPDATE oshal_lora_characters SET active_version = $2 WHERE id = $1 AND owner_sub = $3', [id, version, sub]);
            res.json({ ok: true, subject, activeVersion: version });
        }
        catch (err) {
            logger.error({ err }, 'set active version failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /train — authorize + dispatch a new LoRA version to the GPU box (ticket-gated shell.exec). */
    router.post('/train', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const subject = String(req.body.subject || '').trim();
        try {
            const char = (await ctx.pool.query('SELECT id FROM oshal_lora_characters WHERE subject = $1 AND owner_sub = $2', [subject, sub])).rows[0];
            if (!char) {
                res.status(404).json({ error: 'character not found' });
                return;
            }
            const version = Number((await ctx.pool.query('SELECT COALESCE(max(version), 0) + 1 AS v FROM oshal_lora_models WHERE character_id = $1', [char.id])).rows[0].v);
            const ticket = await ctx.ticketService.createTicket({
                title: `Train ${subject} LoRA v${version}`,
                ticketType: 'lora-train',
                description: `Train character LoRA "${subject}" version ${version} on the GPU edge box (kohya).`,
                status: 'approved',
                priority: 'none',
                labels: ['lora', 'train', subject],
                workspaceId: null,
                assignedAgentId: LORA_DIRECTOR_AGENT_ID,
                parentTicketId: null,
                externalProvider: null,
                externalId: null,
                externalUrl: null,
                ownerSub: sub,
                metadata: { app: 'lora', character: subject, version, action: 'train' },
            });
            await ctx.pool.query(`INSERT INTO oshal_lora_models (character_id, version, status, base_model, ticket_id)
         VALUES ($1, $2, 'training', (SELECT base_model FROM oshal_lora_characters WHERE id = $1), $3)
         ON CONFLICT (character_id, version) DO UPDATE SET status = 'training', ticket_id = EXCLUDED.ticket_id`, [char.id, version, ticket.ticketId]);
            const d = await (0, lora_train_dispatch_1.dispatchBoxCommand)((0, lora_train_dispatch_1.buildTrainCommand)(subject, version, null, sub), ticket.ticketId);
            if (!d.ok) {
                await ctx.pool.query(`UPDATE oshal_lora_models SET status = 'failed' WHERE character_id = $1 AND version = $2`, [char.id, version]);
                res.status(503).json({ ok: false, status: 'box_required', version, ticketId: ticket.ticketId, message: d.error });
                return;
            }
            res.json({ ok: true, version, ticketId: ticket.ticketId, clientId: d.clientId, taskId: d.taskId,
                message: `Training v${version} dispatched to the GPU box — results appear here when it finishes.` });
        }
        catch (err) {
            logger.error({ err }, 'train dispatch failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /validate — re-score the latest trained version on the fixed matrix (ticket-gated). */
    router.post('/validate', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const subject = String(req.body.subject || '').trim();
        const asked = Number(req.body.version);
        try {
            const char = (await ctx.pool.query('SELECT id FROM oshal_lora_characters WHERE subject = $1 AND owner_sub = $2', [subject, sub])).rows[0];
            if (!char) {
                res.status(404).json({ error: 'character not found' });
                return;
            }
            const version = Number.isInteger(asked) ? asked : Number((await ctx.pool.query(`SELECT max(version) AS v FROM oshal_lora_models WHERE character_id = $1 AND status IN ('trained', 'scored')`, [char.id])).rows[0]?.v);
            if (!Number.isInteger(version)) {
                res.status(400).json({ error: 'no trained version to validate yet' });
                return;
            }
            const ticket = await ctx.ticketService.createTicket({
                title: `Validate ${subject} LoRA v${version}`,
                ticketType: 'lora-train',
                description: `Validate character LoRA "${subject}" v${version} on the fixed held-out matrix (ComfyUI).`,
                status: 'approved',
                priority: 'none',
                labels: ['lora', 'validate', subject],
                workspaceId: null,
                assignedAgentId: LORA_DIRECTOR_AGENT_ID,
                parentTicketId: null,
                externalProvider: null,
                externalId: null,
                externalUrl: null,
                ownerSub: sub,
                metadata: { app: 'lora', character: subject, version, action: 'validate' },
            });
            const d = await (0, lora_train_dispatch_1.dispatchBoxCommand)((0, lora_train_dispatch_1.buildValidateCommand)(subject, version, sub), ticket.ticketId);
            if (!d.ok) {
                res.status(503).json({ ok: false, status: 'box_required', version, ticketId: ticket.ticketId, message: d.error });
                return;
            }
            res.json({ ok: true, version, ticketId: ticket.ticketId, clientId: d.clientId, taskId: d.taskId,
                message: `Validation of v${version} dispatched — the scorecard appears here when it finishes.` });
        }
        catch (err) {
            logger.error({ err }, 'validate dispatch failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /improve — regenerate the latest scored version's weak cells, then retrain v+1 (ticket-gated). */
    router.post('/improve', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const subject = String(req.body.subject || '').trim();
        try {
            const char = (await ctx.pool.query('SELECT id FROM oshal_lora_characters WHERE subject = $1 AND owner_sub = $2', [subject, sub])).rows[0];
            if (!char) {
                res.status(404).json({ error: 'character not found' });
                return;
            }
            // The most-recently scored version is the parent we improve from.
            const parentRow = (await ctx.pool.query(`SELECT s.version, s.weak_cells FROM oshal_lora_scores s WHERE s.character_id = $1 ORDER BY s.version DESC LIMIT 1`, [char.id])).rows[0];
            if (!parentRow) {
                res.status(400).json({ error: 'no scored version to improve from — train + validate first' });
                return;
            }
            const parentVersion = Number(parentRow.version);
            const weakValues = Array.isArray(parentRow.weak_cells)
                ? parentRow.weak_cells.map((w) => String(w?.value || '')).filter(Boolean)
                : [];
            const version = Number((await ctx.pool.query('SELECT COALESCE(max(version), 0) + 1 AS v FROM oshal_lora_models WHERE character_id = $1', [char.id])).rows[0].v);
            const ticket = await ctx.ticketService.createTicket({
                title: `Improve ${subject} LoRA v${parentVersion} → v${version}`,
                ticketType: 'lora-train',
                description: `Targeted regenerate weak cells [${weakValues.join(', ') || 'none'}] then retrain "${subject}" v${version} from v${parentVersion}.`,
                status: 'approved',
                priority: 'none',
                labels: ['lora', 'improve', subject],
                workspaceId: null,
                assignedAgentId: LORA_DIRECTOR_AGENT_ID,
                parentTicketId: null,
                externalProvider: null,
                externalId: null,
                externalUrl: null,
                ownerSub: sub,
                metadata: { app: 'lora', character: subject, version, parentVersion, action: 'improve', weakValues },
            });
            await ctx.pool.query(`INSERT INTO oshal_lora_models (character_id, version, status, base_model, parent_version, ticket_id)
         VALUES ($1, $2, 'training', (SELECT base_model FROM oshal_lora_characters WHERE id = $1), $3, $4)
         ON CONFLICT (character_id, version) DO UPDATE SET status = 'training', parent_version = EXCLUDED.parent_version, ticket_id = EXCLUDED.ticket_id`, [char.id, version, parentVersion, ticket.ticketId]);
            const d = await (0, lora_train_dispatch_1.dispatchBoxCommand)((0, lora_train_dispatch_1.buildImproveCommand)(subject, version, parentVersion, weakValues, sub), ticket.ticketId);
            if (!d.ok) {
                await ctx.pool.query(`UPDATE oshal_lora_models SET status = 'failed' WHERE character_id = $1 AND version = $2`, [char.id, version]);
                res.status(503).json({ ok: false, status: 'box_required', version, ticketId: ticket.ticketId, message: d.error });
                return;
            }
            res.json({ ok: true, version, parentVersion, weakValues, ticketId: ticket.ticketId, clientId: d.clientId, taskId: d.taskId,
                message: `Improving v${parentVersion} → v${version} (targeting ${weakValues.length} weak cells), then retraining. Results appear here when done.` });
        }
        catch (err) {
            logger.error({ err }, 'improve dispatch failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /improve-overnight — opt-in autonomous loop: improve→validate until plateau, parks a review. */
    router.post('/improve-overnight', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const subject = String(req.body.subject || '').trim();
        try {
            const char = (await ctx.pool.query(`SELECT id, autonomous, max_hours, plateau_epsilon
           FROM oshal_lora_characters
          WHERE subject = $1 AND owner_sub = $2`, [subject, sub])).rows[0];
            if (!char) {
                res.status(404).json({ error: 'character not found' });
                return;
            }
            if (!char.autonomous) {
                res.status(400).json({ error: 'enable Improve overnight for this character first' });
                return;
            }
            const startVersion = Number((await ctx.pool.query(`SELECT max(version) AS v FROM oshal_lora_models WHERE character_id = $1 AND status IN ('trained', 'scored')`, [char.id])).rows[0]?.v);
            if (!Number.isInteger(startVersion)) {
                res.status(400).json({ error: 'train + validate a first version before running overnight' });
                return;
            }
            const ticket = await ctx.ticketService.createTicket({
                title: `Overnight improve ${subject} (from v${startVersion})`,
                ticketType: 'lora-train',
                description: `Autonomous improve loop for "${subject}" from v${startVersion} up to ${char.max_hours}h, plateau ${char.plateau_epsilon}. Parks a review at the end.`,
                status: 'approved',
                priority: 'none',
                labels: ['lora', 'overnight', subject],
                workspaceId: null,
                assignedAgentId: LORA_DIRECTOR_AGENT_ID,
                parentTicketId: null,
                externalProvider: null,
                externalId: null,
                externalUrl: null,
                ownerSub: sub,
                metadata: { app: 'lora', character: subject, action: 'improve-overnight', startVersion },
            });
            const d = await (0, lora_train_dispatch_1.dispatchBoxCommand)((0, lora_train_dispatch_1.buildOvernightCommand)(subject, startVersion, Number(char.max_hours) || 9, Number(char.plateau_epsilon) || 0.005, sub), ticket.ticketId);
            if (!d.ok) {
                res.status(503).json({ ok: false, status: 'box_required', ticketId: ticket.ticketId, message: d.error });
                return;
            }
            res.json({ ok: true, startVersion, ticketId: ticket.ticketId, clientId: d.clientId, taskId: d.taskId,
                message: `Overnight improve started from v${startVersion}. It runs until it plateaus or ${char.max_hours}h, then parks a morning review.` });
        }
        catch (err) {
            logger.error({ err }, 'overnight dispatch failed');
            res.status(502).json({ error: err.message });
        }
    });
    return router;
}
/**
 * @description Creates the PUBLIC LoRA ingest mount. GET is a health-only probe. POST accepts a
 * GPU-box callback only when the shared service secret and a separately encoded exact owner are
 * both valid, then narrows database work to that non-operator owner. The package manifest mounts
 * this at /api/lora/ingest using the loader-sanctioned split-mountPath shape, so the internal paths
 * here are '/': the external URL the box calls stays /api/lora/ingest, unchanged from core.
 * @param ctx - app context (pool)
 */
function createLoraIngestRoutes(ctx) {
    const router = (0, express_1.Router)();
    /**
     * GET / — public health-only reachability probe. The write endpoint is intentionally OUTSIDE the
     * OIDC wall but independently requires a service secret and exact owner. This responder makes
     * mount reachability verifiable: a probe gets a clear 200 here instead of falling through to the
     * downstream `/api` catch-all, whose `requiresAuth` would otherwise answer with an OIDC `loginPath`
     * 401 and make the public route look gated. The real write path is POST / below.
     */
    router.get('/', (_req, res) => {
        res.json({ ok: true, route: 'lora-ingest', method: 'POST', auth: 'service-secret+owner' });
    });
    /** POST / — box reports a training result (kind:'training') or a scorecard (kind:'score'). */
    router.post('/', trusted_service_user_identity_1.requireTrustedServiceUserIdentity, async (req, res) => {
        if (!(0, authz_1.hasValidServiceSecret)(req)) {
            res.status(401).json({ error: 'service_secret_required' });
            return;
        }
        const sub = callerSub(req);
        if (!sub) {
            res.status(403).json({ error: 'trusted_service_user_sub_required' });
            return;
        }
        const b = (req.body || {});
        const subject = String(b.character || b.subject || '').trim();
        const version = Number(b.version);
        const kind = String(b.kind || '').trim();
        try {
            const id = await characterId(ctx, subject, sub);
            if (!subject || !id) {
                res.status(404).json({ error: 'character not found' });
                return;
            }
            // Autonomous overnight loop finished — park a human "morning review" gate (never auto-promote).
            if (kind === 'review') {
                const bestVersion = Number(b.best_version);
                const summary = String(b.summary || 'Overnight improve finished.');
                const ticket = await ctx.ticketService.createTicket({
                    title: `Review ${subject} overnight result — best v${Number.isInteger(bestVersion) ? bestVersion : '?'}`,
                    ticketType: 'lora-train',
                    description: `${summary} Open the LoRA Studio to compare versions and keep-best.`,
                    status: 'approval_required',
                    priority: 'none',
                    labels: ['lora', 'review', subject],
                    workspaceId: null,
                    assignedAgentId: LORA_DIRECTOR_AGENT_ID,
                    parentTicketId: null,
                    externalProvider: null,
                    externalId: null,
                    externalUrl: null,
                    ownerSub: sub,
                    metadata: { app: 'lora', character: subject, action: 'review', bestVersion, overall: Number(b.overall) || null },
                });
                logger.info({ subject, bestVersion }, 'lora overnight review ticket parked');
                res.json({ ok: true, kind, subject, ticketId: ticket.ticketId });
                return;
            }
            if (!Number.isInteger(version) || !['training', 'score'].includes(kind)) {
                res.status(400).json({ error: 'character, integer version, and kind (training|score|review) required' });
                return;
            }
            if (kind === 'training') {
                const status = ['queued', 'training', 'trained', 'scored', 'failed'].includes(String(b.status)) ? String(b.status) : 'trained';
                await ctx.pool.query(`INSERT INTO oshal_lora_models
             (character_id, version, status, lora_path, base_model, dataset_count, network_dim, epochs, steps, final_loss, duration_sec, parent_version, ticket_id, metrics)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (character_id, version) DO UPDATE SET
             status = EXCLUDED.status,
             lora_path = COALESCE(EXCLUDED.lora_path, oshal_lora_models.lora_path),
             base_model = COALESCE(EXCLUDED.base_model, oshal_lora_models.base_model),
             dataset_count = COALESCE(EXCLUDED.dataset_count, oshal_lora_models.dataset_count),
             network_dim = COALESCE(EXCLUDED.network_dim, oshal_lora_models.network_dim),
             epochs = COALESCE(EXCLUDED.epochs, oshal_lora_models.epochs),
             steps = COALESCE(EXCLUDED.steps, oshal_lora_models.steps),
             final_loss = COALESCE(EXCLUDED.final_loss, oshal_lora_models.final_loss),
             duration_sec = COALESCE(EXCLUDED.duration_sec, oshal_lora_models.duration_sec),
             parent_version = COALESCE(EXCLUDED.parent_version, oshal_lora_models.parent_version),
             ticket_id = COALESCE(EXCLUDED.ticket_id, oshal_lora_models.ticket_id),
             metrics = COALESCE(EXCLUDED.metrics, oshal_lora_models.metrics)`, [id, version, status, str(b.lora_path), str(b.base_model), int(b.dataset_count), int(b.network_dim),
                    int(b.epochs), int(b.steps), num(b.final_loss), int(b.duration_sec), int(b.parent_version),
                    str(b.ticket_id), b.metrics != null ? JSON.stringify(b.metrics) : null]);
                logger.info({ subject, version, status }, 'lora training ingest');
                res.json({ ok: true, kind, subject, version, status });
                return;
            }
            // kind === 'score' — recompute the rollup/weak-cells from cells if the box didn't send them.
            const cells = Array.isArray(b.cells) ? b.cells : [];
            const summary = cells.length ? (0, scorecard_1.summarizeScore)(cells) : null;
            const overall = num(b.overall) ?? summary?.overall ?? null;
            const identityMean = num(b.identity_mean) ?? summary?.identityMean ?? null;
            const qualityMean = num(b.quality_mean) ?? summary?.qualityMean ?? null;
            const minCell = num(b.min_cell) ?? summary?.minCell ?? null;
            const weakCells = Array.isArray(b.weak_cells) ? b.weak_cells : cells.length ? (0, scorecard_1.computeWeakCells)(cells) : [];
            await ctx.pool.query(`INSERT INTO oshal_lora_scores
           (character_id, version, overall, identity_mean, quality_mean, min_cell, cells, weak_cells, gallery_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (character_id, version) DO UPDATE SET
           overall = EXCLUDED.overall, identity_mean = EXCLUDED.identity_mean,
           quality_mean = EXCLUDED.quality_mean, min_cell = EXCLUDED.min_cell,
           cells = EXCLUDED.cells, weak_cells = EXCLUDED.weak_cells,
           gallery_url = COALESCE(EXCLUDED.gallery_url, oshal_lora_scores.gallery_url)`, [id, version, overall, identityMean, qualityMean, minCell,
                JSON.stringify(cells), JSON.stringify(weakCells), str(b.gallery_url)]);
            await ctx.pool.query(`UPDATE oshal_lora_models SET status = 'scored' WHERE character_id = $1 AND version = $2 AND status <> 'failed'`, [id, version]);
            logger.info({ subject, version, overall }, 'lora score ingest');
            res.json({ ok: true, kind, subject, version, overall });
        }
        catch (err) {
            logger.error({ err }, 'lora ingest failed');
            res.status(502).json({ error: err.message });
        }
    });
    return router;
}
/** Coerce a JSON field to a trimmed string or null. */
function str(v) {
    const s = v == null ? '' : String(v).trim();
    return s ? s : null;
}
/** Coerce to a finite integer or null. */
function int(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
}
/** Coerce to a finite number or null. */
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
//# sourceMappingURL=bot-lora-routes.js.map