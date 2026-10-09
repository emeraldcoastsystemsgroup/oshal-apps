"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Await durable GPU task enqueue before returning task identity or reporting box availability.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Make character/model/score access owner-bound at both route and FORCE-RLS layers, narrow box callbacks to a separate exact owner identity, and give each caller an isolated starter character.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Keep system seed creation in install migrations only so lazy runtime schema validation cannot attempt a cross-owner insert after FORCE RLS is active.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Host each scorecard cell's validation thumbnail in owner-scoped controller storage, tell the scorecard read which cells have one, serve them only to the owner, and lose access when a run expires or is deleted. The box previously reported a bare ComfyUI filename per cell, which no browser can fetch, so no scorecard cell could display an image at all.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Classify late thumbnail callbacks to a deleted model as a missing run; the database foreign key enforces the race boundary.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Carry character identity into dispatch and add owner-scoped creation while preserving gallery lifetime boundaries.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Resolve immutable worker callbacks under the exact owner and validate persisted model filenames without changing public character names.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Delegate bounded character creation to an owner-serialized transaction and stop reporting a stored configuration as ready for GPU training.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Move the ADR-139 dataset destination (receipt/staging schema, GET /dataset, POST /dataset/import, the worker download route and the dataset callback) into lora-dataset-ingest.ts. Import now redeems the handle as the signed-in caller and stages the checked bytes, replacing the service-rail metadata lookup core refuses; this file keeps only the wiring.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Replace the fleet service secret on worker callbacks with per-dispatch callback grants: every train, validate, improve and overnight dispatch mints a grant bound to its owner, character, ticket and callback kinds (lora-callback-grants.ts), and the grant tables join the lazy schema. The callback mount moves to lora-ingest-routes.ts (this file had reached 801 code lines). The scheduled overnight dedupe now reads the character's NEWEST overnight ticket: the ticket service's active-by-metadata lookup returns the OLDEST non-cancelled ticket, so once one night had completed, a repeated tick while that character's next loop was still running found the completed ticket and dispatched a second concurrent loop.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Register the ADR-149 resource adapter the new authorization catalog names, and give every callback grant its owner's verified issuer, which the kernel's signed-package-callbacks rail needs to refresh and authorize the owner a worker callback runs as. Console dispatches take the issuer from the kernel's actor; enabling autonomous mode records the enabling owner's issuer (migration 106) so the nightly schedule can mint that character's grants, and a character enabled before 1.7.0 is skipped as not ready until its owner re-enables it.
 * 12 | maintainer@emeraldcoastsystemsgroup.com | GET /characters is a pure read. It inserted the caller's starter character first, and the native host admits a GET read-only and refuses any SQL write, so the studio's first read answered 502 'SQL mutation requires original writer admission' for every account and listed nothing. The starter is now provisioned only by POST /characters/starter (lora.configure), which the studio offers when an account has no characters; it stays idempotent and owner-bound, and answers the same list GET /characters does.
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
exports.runLoraOvernightSchedule = runLoraOvernightSchedule;
exports.createLoraScheduleRoutes = createLoraScheduleRoutes;
exports.createBotLoraRoutes = createBotLoraRoutes;
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
const lora_train_dispatch_1 = require("./lora-train-dispatch");
const lora_dataset_ingest_1 = require("./lora-dataset-ingest");
const lora_cell_images_1 = require("./lora-cell-images");
const lora_callback_grants_1 = require("./lora-callback-grants");
const lora_authorization_1 = require("./lora-authorization");
const lora_character_create_1 = require("./lora-character-create");
const request_identity_1 = require("@/shared/services/database/request-identity");
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
            // The box scripts hold no character constants, so the character's whole identity lives here.
            'ALTER TABLE oshal_lora_characters ADD COLUMN IF NOT EXISTS negative_prompt TEXT',
            'ALTER TABLE oshal_lora_characters ADD COLUMN IF NOT EXISTS identity_structure TEXT',
            'ALTER TABLE oshal_lora_characters ADD COLUMN IF NOT EXISTS identity_violation TEXT',
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
            ...(0, lora_cell_images_1.cellImageSchemaStatements)(),
            ...(0, lora_dataset_ingest_1.datasetSchemaStatements)(),
            ...(0, lora_callback_grants_1.callbackGrantSchemaStatements)(),
            ...(0, lora_callback_grants_1.callbackIdentitySchemaStatements)(),
        ],
        requirements: [
            { table: 'oshal_lora_characters', columns: ['id', 'subject', 'display_name', 'trigger_word', 'hero_image', 'base_model', 'ident_prompt', 'negative_prompt', 'identity_structure', 'identity_violation', 'autonomous', 'autonomous_issuer', 'max_hours', 'plateau_epsilon', 'active_version', 'owner_sub', 'created_at'] },
            { table: 'oshal_lora_models', columns: ['id', 'character_id', 'version', 'status', 'lora_path', 'base_model', 'dataset_count', 'network_dim', 'epochs', 'steps', 'final_loss', 'duration_sec', 'parent_version', 'ticket_id', 'metrics', 'created_at'] },
            { table: 'oshal_lora_scores', columns: ['id', 'character_id', 'version', 'overall', 'identity_mean', 'quality_mean', 'min_cell', 'cells', 'weak_cells', 'gallery_url', 'created_at'] },
            lora_cell_images_1.CELL_IMAGE_REQUIREMENT,
            ...lora_dataset_ingest_1.DATASET_REQUIREMENTS,
            ...lora_callback_grants_1.CALLBACK_GRANT_REQUIREMENTS,
        ],
    });
}
/** Every column a box command is built from — the box scripts have no character constants left. */
const CHARACTER_IDENTITY_COLUMNS = 'id, subject, trigger_word, hero_image, ident_prompt, negative_prompt, identity_structure, identity_violation, base_model';
/**
 * @description Load one owner's character with the whole identity the box needs. Every dispatch
 * route goes through this, so a box command can never be built from a partial row.
 * @param ctx - App context.
 * @param subject - The character subject.
 * @param ownerSub - The authenticated caller.
 * @returns The row id plus its box configuration, or null when the caller owns no such character.
 */
async function loadCharacter(ctx, subject, ownerSub) {
    const row = (await ctx.pool.query(`SELECT ${CHARACTER_IDENTITY_COLUMNS}, autonomous, max_hours, plateau_epsilon
       FROM oshal_lora_characters WHERE subject = $1 AND owner_sub = $2`, [subject, ownerSub])).rows[0];
    if (!row)
        return null;
    return { id: row.id, config: (0, lora_train_dispatch_1.characterConfigFromRow)(row), row: row };
}
/** Resolve a character row id from its subject slug. */
async function characterId(ctx, subject, ownerSub) {
    const r = (await ctx.pool.query('SELECT id FROM oshal_lora_characters WHERE subject = $1 AND owner_sub = $2', [subject, ownerSub])).rows[0];
    return r?.id ?? null;
}
/** Select only an existing trained model belonging to the already owner-resolved character. */
async function existingModelName(ctx, config, version) {
    const result = await ctx.pool.query(`SELECT lora_path FROM oshal_lora_models WHERE character_id = $1 AND version = $2
       AND status IN ('trained', 'scored')`, [config.id, version]);
    if (!result.rows.length)
        return null;
    const stored = result.rows[0].lora_path;
    // Old imported versions may have no path. Keep their historical basename; new worker results
    // record the immutable basename in lora_path. Never expose the worker directory to the browser.
    return stored ? String(stored).replace(/\\/g, '/').split('/').pop() : `${config.subject}_v${version}.safetensors`;
}
/**
 * The owner a loop's callback grant is minted for. A console run is the verified caller, whose issuer
 * the grant takes from the kernel's actor. A scheduled run has no caller, so it uses the issuer
 * recorded when the owner enabled autonomous mode; without one the character is not ready.
 */
function overnightOwner(settings, source) {
    const ownerSub = String(settings.owner_sub || '').trim();
    if (!ownerSub)
        return { state: 'failed', detail: 'character owner is missing' };
    if (source === 'console')
        return { ownerSub };
    if (!(0, lora_authorization_1.isValidIssuer)(settings.autonomous_issuer))
        return { state: 'not-ready', detail: 'autonomous mode must be re-enabled by its owner' };
    return { ownerSub, ownerIssuer: settings.autonomous_issuer };
}
/** Start one owner-bound overnight loop from the same durable inputs as the manual console action. */
async function startOvernightLoop(ctx, char, source, scheduledAtIso, dedupeActive) {
    const subject = char.config.subject;
    const settings = char.row;
    if (!settings.autonomous)
        return { state: 'disabled', subject, detail: 'autonomous mode is not enabled' };
    const maxHours = Number(settings.max_hours) || 9;
    const plateau = Number(settings.plateau_epsilon) || 0.005;
    if (dedupeActive) {
        // NEWEST, not "active": the active lookup returns the oldest non-cancelled ticket, which is a
        // completed earlier night once one exists, so a still-running loop would never be found.
        const active = await ctx.ticketService.findLatestTicketByMetadataKey('loraOvernightCharacterId', char.id);
        if (active && !['complete', 'cancelled'].includes(active.status)) {
            const ageHours = Math.max(0, (Date.now() - new Date(active.createdAt).getTime()) / 3_600_000);
            if (ageHours < maxHours + 2)
                return { state: 'already-running', subject, detail: `active ticket ${active.ticketId}` };
        }
    }
    const startVersion = Number((await ctx.pool.query(`SELECT max(version) AS v FROM oshal_lora_models WHERE character_id = $1 AND status IN ('trained', 'scored')`, [char.id])).rows[0]?.v);
    if (!Number.isInteger(startVersion))
        return { state: 'not-ready', subject, detail: 'no trained/scored starting model' };
    const modelName = await existingModelName(ctx, char.config, startVersion);
    if (!modelName)
        return { state: 'not-ready', subject, detail: `starting model v${startVersion} has no usable artifact` };
    const owner = overnightOwner(settings, source);
    if ('state' in owner)
        return { ...owner, subject };
    const { ownerSub, ownerIssuer } = owner;
    const ticket = await ctx.ticketService.createTicket({
        title: `Overnight improve ${subject} (from v${startVersion})`,
        ticketType: 'lora-train',
        description: `${source === 'nightly-schedule' ? 'Scheduled' : 'Console'} autonomous improve loop for "${subject}" from v${startVersion} up to ${maxHours}h, plateau ${plateau}. Parks a review at the end.`,
        status: 'approved', priority: 'none', labels: ['lora', 'overnight', subject], workspaceId: null,
        assignedAgentId: LORA_DIRECTOR_AGENT_ID, parentTicketId: null, externalProvider: null,
        externalId: null, externalUrl: null, ownerSub,
        metadata: {
            app: 'lora', character: subject, characterId: char.id, action: 'improve-overnight',
            loraOvernightCharacterId: char.id, source, scheduledAt: scheduledAtIso, startVersion,
        },
    });
    const command = (0, lora_train_dispatch_1.buildOvernightCommand)(char.config, startVersion, maxHours, plateau, ownerSub, modelName, ticket.ticketId);
    // The grant outlives the loop's own budget by the one-shot queue grace, then expires on its own.
    const dispatched = await (0, lora_callback_grants_1.dispatchWithCallbackGrant)(ctx, { characterId: char.id, ownerSub, ownerIssuer, ticketId: ticket.ticketId,
        dispatchKind: 'overnight', ttlHours: maxHours + lora_callback_grants_1.CALLBACK_GRANT_TTL_HOURS }, command);
    if (!dispatched.ok) {
        try {
            await ctx.ticketService.updateStatus(ticket.ticketId, 'cancelled');
        }
        catch { /* preserve the dispatch failure response */ }
        return { state: 'failed', subject, detail: dispatched.error || 'GPU edge worker rejected the task' };
    }
    return { state: 'started', subject, ticketId: ticket.ticketId, taskId: dispatched.taskId };
}
/** Deterministic framework schedule handler for owner-enabled autonomous characters. */
async function runLoraOvernightSchedule(ctx, input) {
    const results = await (0, request_identity_1.runWithSystemIdentity)(async () => {
        const rows = (await ctx.pool.query(`SELECT ${CHARACTER_IDENTITY_COLUMNS}, autonomous, autonomous_issuer, max_hours, plateau_epsilon, owner_sub
         FROM oshal_lora_characters
        WHERE autonomous IS TRUE AND owner_sub IS NOT NULL
        ORDER BY owner_sub, subject`)).rows;
        const settled = [];
        for (const row of rows) {
            settled.push(await startOvernightLoop(ctx, {
                id: row.id, config: (0, lora_train_dispatch_1.characterConfigFromRow)(row), row: row,
            }, 'nightly-schedule', input.scheduledAtIso, true));
        }
        return settled;
    });
    const started = results.filter((r) => r.state === 'started').length;
    const skipped = results.length - started;
    logger.info({ scheduleId: input.scheduleId, started, skipped }, 'lora autonomous overnight schedule completed');
    return { summary: `LoRA overnight schedule: ${started} started, ${skipped} skipped or not ready.` };
}
/** Service-authenticated mount owned by the manifest declaration; work is invoked by the named export. */
function createLoraScheduleRoutes(_ctx) {
    const router = (0, express_1.Router)();
    router.post('/', (_req, res) => res.status(404).json({ error: 'scheduler_only' }));
    return router;
}
/**
 * @description Give the caller their own copy of the starter character configuration. Idempotent and
 * owner-bound (ON CONFLICT on owner and subject). Called only from POST /characters/starter: a write
 * the caller asked for, never a side effect of reading the list.
 * @param ctx - The app context whose pool runs as the caller.
 * @param ownerSub - The authenticated owner who receives the copy.
 */
async function ensureOwnerStarterCharacter(ctx, ownerSub) {
    await ctx.pool.query(`INSERT INTO oshal_lora_characters
       (subject, display_name, trigger_word, hero_image, base_model, ident_prompt,
        negative_prompt, identity_structure, identity_violation, owner_sub)
     VALUES ('oshbrainrot', 'Cyclops (oshbrainrot)', 'oshbrainrot', 'hero_brainrot_00002_.png',
       'v1-5-pruned-emaonly-fp16.safetensors',
       'a one-eyed leathery orange-red screaming cyclops creature, big single eye, wide toothy mouth, stubby clawed legs, long thin arms, glossy 3d render, italian brainrot meme style',
       'blurry, low quality, deformed, extra eyes, two eyes, text, watermark, multiple characters, jpeg artifacts, lowres',
       'a one-eyed cyclops creature with a single big eye',
       'a creature with two eyes',
       $1)
     ON CONFLICT (owner_sub, subject) DO NOTHING`, [ownerSub]);
}
/**
 * @description The caller's characters, oldest first, each with its latest version, version count
 * and latest overall score. Read only.
 * @param ctx - The app context whose pool runs as the caller.
 * @param ownerSub - The authenticated owner.
 * @returns The character rows GET /characters and POST /characters/starter answer with.
 */
async function listOwnerCharacters(ctx, ownerSub) {
    return (await ctx.pool.query(`SELECT c.subject, c.display_name, c.trigger_word, c.hero_image, c.base_model, c.ident_prompt,
            'lora-' || replace(c.id::text, '-', '') AS storage_key,
            c.negative_prompt, c.identity_structure, c.identity_violation,
            c.autonomous, c.max_hours, c.plateau_epsilon, c.active_version, c.created_at,
            (SELECT max(version) FROM oshal_lora_models m WHERE m.character_id = c.id) AS latest_version,
            (SELECT count(*) FROM oshal_lora_models m WHERE m.character_id = c.id) AS version_count,
            (SELECT s.overall FROM oshal_lora_scores s WHERE s.character_id = c.id ORDER BY s.version DESC LIMIT 1) AS latest_score
     FROM oshal_lora_characters c
     WHERE c.owner_sub = $1
     ORDER BY c.created_at ASC`, [ownerSub])).rows;
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
    (0, lora_authorization_1.registerLoraAuthorization)(ctx);
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
    /**
     * GET /characters — every one of the caller's characters with its latest version + latest overall
     * score. A pure read: the native host admits a GET read-only, so this never creates the starter
     * character (POST /characters/starter does, on request).
     */
    router.get('/characters', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            res.json({ characters: await listOwnerCharacters(ctx, sub) });
        }
        catch (err) {
            logger.error({ err }, 'list characters failed');
            res.status(502).json({ error: err.message });
        }
    });
    /**
     * POST /characters/starter — give the caller their own copy of the starter character, then answer
     * the list exactly as GET /characters does. The studio offers it when an account has no characters;
     * repeating it changes nothing. Requires lora.configure, like every other character write.
     */
    router.post('/characters/starter', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await ensureOwnerStarterCharacter(ctx, sub);
            res.json({ characters: await listOwnerCharacters(ctx, sub) });
        }
        catch (err) {
            logger.error({ err }, 'add starter character failed');
            res.status(502).json({ error: 'starter_character_failed', message: 'The starter character could not be saved. Refresh the list before retrying.' });
        }
    });
    /**
     * POST /characters — create one of the caller's own characters. The box scripts take their whole
     * identity from this row, so a character is a row, never a source edit. A new character may not
     * reuse another character's hero image or identity sentence: those two ARE the identity, and a
     * reused one trains and scores the new character as the old one.
     */
    router.post('/characters', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const outcome = await (0, lora_character_create_1.createLoraCharacter)(ctx, sub, req.body);
            res.status(outcome.status).json(outcome.body);
        }
        catch (err) {
            logger.error({ err }, 'create character failed');
            res.status(502).json({ error: 'character_creation_failed', message: 'Character could not be saved. Refresh the list before retrying.' });
        }
    });
    // ADR-139 dataset destination: GET /dataset and POST /dataset/import (lora-dataset-ingest.ts).
    router.use((0, lora_dataset_ingest_1.createLoraDatasetRoutes)(ctx, { callerSub, loadCharacter, directorAgentId: LORA_DIRECTOR_AGENT_ID }));
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
            // Which cells the studio may render, decided HERE from live storage rather than from a string
            // the GPU box put in the cell. The box reports a filename on its own disk; that is not a URL,
            // and trusting one would also hand a callback the ability to choose an image source.
            const hostedCells = await (0, lora_cell_images_1.hostedCellIndexes)(ctx.pool, id, version);
            res.json({ subject, scorecard: row, hostedCells });
        }
        catch (err) {
            logger.error({ err }, 'get scorecard failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /cell-image?subject=&version=&cell= — one hosted validation thumbnail, owner only. */
    router.get('/cell-image', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const subject = String(req.query.subject || '').trim();
        const version = Number(req.query.version);
        const cellIndex = (0, lora_cell_images_1.parseCellIndex)(req.query.cell);
        if (!subject || !Number.isInteger(version) || cellIndex === null) {
            res.status(400).json({ error: 'subject + version + cell required' });
            return;
        }
        try {
            // The owner predicate is the same one every other read uses: a character another user owns
            // never resolves here, so its thumbnails are unreachable before any image query runs.
            const id = await characterId(ctx, subject, sub);
            if (!id) {
                res.status(404).json({ error: 'character not found' });
                return;
            }
            const image = await (0, lora_cell_images_1.readCellImage)(ctx.pool, id, version, cellIndex);
            if (!image) {
                res.status(404).json({ error: 'no image for that cell' });
                return;
            }
            res.setHeader('Content-Type', image.contentType);
            res.setHeader('Content-Length', String(image.bytes.length));
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
            res.setHeader('Content-Disposition', 'inline');
            res.setHeader('Cache-Control', 'private, no-store');
            res.end(image.bytes);
        }
        catch (err) {
            logger.error({ err }, 'get cell image failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** DELETE /models/:subject/:version — delete one run: its thumbnails, its score, its model row. */
    router.delete('/models/:subject/:version', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const subject = String(req.params.subject || '').trim();
        const version = Number(req.params.version);
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
            // Thumbnails go first: if the run row disappeared but its bytes stayed, a deleted run would
            // still be readable, which is exactly the access this route exists to end.
            const removedImages = await (0, lora_cell_images_1.deleteRunCellImages)(ctx.pool, id, version);
            await ctx.pool.query('DELETE FROM oshal_lora_scores WHERE character_id = $1 AND version = $2', [id, version]);
            const removed = await ctx.pool.query('DELETE FROM oshal_lora_models WHERE character_id = $1 AND version = $2', [id, version]);
            await ctx.pool.query('UPDATE oshal_lora_characters SET active_version = NULL WHERE id = $1 AND owner_sub = $2 AND active_version = $3', [id, sub, version]);
            logger.info({ subject, version, removedImages }, 'lora run deleted');
            res.json({ ok: true, subject, version, removedImages, removedVersions: Number(removed.rowCount ?? 0) });
        }
        catch (err) {
            logger.error({ err }, 'delete run failed');
            res.status(502).json({ error: err.message });
        }
    });
    /**
     * POST /characters/:subject/autonomous — toggle the opt-in improve-overnight mode (controller-only).
     * Enabling records the owner's verified issuer: the nightly schedule mints this character's worker
     * callback grants for exactly that identity. Disabling clears it.
     */
    router.post('/characters/:subject/autonomous', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const subject = String(req.params.subject || '').trim();
        const body = req.body;
        const enabled = typeof body.enabled === 'boolean' ? body.enabled : null;
        const issuer = enabled === true ? (0, lora_authorization_1.verifiedIssuer)(ctx, sub) : null;
        if (enabled === true && !issuer) {
            res.status(401).json({ error: 'verified_owner_required' });
            return;
        }
        try {
            const r = await ctx.pool.query(`UPDATE oshal_lora_characters
         SET autonomous = COALESCE($2, autonomous),
             autonomous_issuer = CASE WHEN $2::boolean IS NULL THEN autonomous_issuer ELSE $6 END,
             max_hours = COALESCE($3, max_hours),
             plateau_epsilon = COALESCE($4, plateau_epsilon)
         WHERE subject = $1 AND owner_sub = $5
         RETURNING autonomous, max_hours, plateau_epsilon`, [subject, enabled, Number.isFinite(body.maxHours) ? body.maxHours : null,
                Number.isFinite(body.plateauEpsilon) ? body.plateauEpsilon : null, sub, issuer]);
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
            const char = await loadCharacter(ctx, subject, sub);
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
            const d = await (0, lora_callback_grants_1.dispatchWithCallbackGrant)(ctx, { characterId: char.id, ownerSub: sub, ticketId: ticket.ticketId,
                dispatchKind: 'train' }, (0, lora_train_dispatch_1.buildTrainCommand)(char.config, version, null, sub));
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
            const char = await loadCharacter(ctx, subject, sub);
            if (!char) {
                res.status(404).json({ error: 'character not found' });
                return;
            }
            const version = Number.isInteger(asked) ? asked : Number((await ctx.pool.query(`SELECT max(version) AS v FROM oshal_lora_models WHERE character_id = $1 AND status IN ('trained', 'scored')`, [char.id])).rows[0]?.v);
            if (!Number.isInteger(version)) {
                res.status(400).json({ error: 'no trained version to validate yet' });
                return;
            }
            const modelName = await existingModelName(ctx, char.config, version);
            if (!modelName) {
                res.status(404).json({ error: 'trained model not found' });
                return;
            }
            const command = (0, lora_train_dispatch_1.buildValidateCommand)(char.config, version, sub, modelName);
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
            const d = await (0, lora_callback_grants_1.dispatchWithCallbackGrant)(ctx, { characterId: char.id, ownerSub: sub, ticketId: ticket.ticketId,
                dispatchKind: 'validate' }, command);
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
            const char = await loadCharacter(ctx, subject, sub);
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
            const d = await (0, lora_callback_grants_1.dispatchWithCallbackGrant)(ctx, { characterId: char.id, ownerSub: sub, ticketId: ticket.ticketId,
                dispatchKind: 'improve' }, (0, lora_train_dispatch_1.buildImproveCommand)(char.config, version, parentVersion, weakValues, sub));
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
            const char = await loadCharacter(ctx, subject, sub);
            if (!char) {
                res.status(404).json({ error: 'character not found' });
                return;
            }
            const result = await startOvernightLoop(ctx, {
                ...char,
                row: { ...char.row, owner_sub: sub },
            }, 'console', new Date().toISOString(), false);
            if (result.state === 'disabled') {
                res.status(400).json({ error: 'enable Improve overnight for this character first' });
                return;
            }
            if (result.state === 'not-ready') {
                res.status(400).json({ error: 'train + validate a first version before running overnight' });
                return;
            }
            if (result.state === 'failed') {
                res.status(503).json({ ok: false, status: 'box_required', message: result.detail });
                return;
            }
            if (result.state !== 'started') {
                res.status(409).json({ error: 'overnight loop already running' });
                return;
            }
            const settings = char.row;
            res.json({ ok: true, ticketId: result.ticketId, taskId: result.taskId,
                message: `Overnight improve started. It runs until it plateaus or ${Number(settings.max_hours) || 9}h, then parks a morning review.` });
        }
        catch (err) {
            logger.error({ err }, 'overnight dispatch failed');
            res.status(502).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=bot-lora-routes.js.map