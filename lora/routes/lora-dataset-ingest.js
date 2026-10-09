"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Move the ADR-139 dataset destination out of bot-lora-routes.ts and redeem the Send-to handle as the signed-in caller. The previous import asked core for handle metadata over the service rail (secret + encoded sub), which core's exact-principal artifact check refuses, and the GPU worker fetched the handle content over the same refused rail after the 15-minute handle had usually expired. The controller now fetches the bytes through core's own handle routes with the caller's original cookie or PAT, checks size and magic bytes, stages them in an owner-RLS expiring table, and the worker downloads them from a LoRA-owned exact-owner service route.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The worker download needs the import's own callback grant instead of the fleet service secret: the grant's owner, character and dataset-download kind must match the staged image. Each import dispatch mints that grant with the staging lifetime, and the dataset callback reports whether it settled a receipt so the ingest route can revoke the grant afterwards.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Serve the staged image at POST /dataset-download/:imageId (an empty signed POST) instead of GET /dataset/:imageId. The kernel's signed-package-callbacks rail admits POST only, and the ADR-149 catalog cannot bind a path that overlaps the studio's POST /dataset/import. The live GET was refused authorization_identity_required before the grant check ever ran.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DATASET_REQUIREMENTS = exports.DATASET_STAGING_TTL_HOURS = void 0;
exports.sniffDatasetImageType = sniffDatasetImageType;
exports.datasetFilename = datasetFilename;
exports.datasetCaption = datasetCaption;
exports.datasetSchemaStatements = datasetSchemaStatements;
exports.redeemArtifactAsCaller = redeemArtifactAsCaller;
exports.expireDatasetStaging = expireDatasetStaging;
exports.createLoraDatasetRoutes = createLoraDatasetRoutes;
exports.createLoraDatasetWorkerRoutes = createLoraDatasetWorkerRoutes;
exports.recordDatasetCallback = recordDatasetCallback;
/**
 * LoRA dataset destination (ADR-139 "Send to… → Add to LoRA dataset").
 *
 * Three properties are load-bearing and each is enforced here:
 *  - redeemed as the caller: the handle is read through core's `/api/artifacts/handles/:ref` and
 *    `/content` routes with the caller's own cookie or PAT, never the fleet service secret. Core's
 *    authenticated relay (kernel skill `authenticated-artifacts`) then rechecks the exact principal,
 *    the source application's current permission and its registration generation. A package
 *    cannot call that relay in-process: the route mounter gives package factories a context with
 *    `applicationAuthorization` removed, and the relay refuses any principal-bound handle without it.
 *  - bounded: at most MAX_DATASET_IMAGE_BYTES, and a PNG/JPEG/WebP by its magic bytes before any
 *    database write. The declared handle type is only a pre-filter.
 *  - perishable and owner-scoped: staged bytes live in `oshal_lora_dataset_staging` under the same
 *    forced owner RLS as the receipt, expire on their own clock, are served only to the worker
 *    holding that import's callback grant while the receipt is queued, and are deleted by the
 *    worker's ready/failed callback.
 */
const express_1 = require("express");
const node_crypto_1 = require("node:crypto");
const logger_1 = require("@/shared/logger");
const lora_callback_grants_1 = require("./lora-callback-grants");
const lora_train_dispatch_1 = require("./lora-train-dispatch");
const logger = (0, logger_1.createChildLogger)({ module: 'lora-dataset-ingest' });
const DECLARED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_RE = /^art_[A-Za-z0-9_-]{8,64}$/;
const PAT_RE = /^Bearer\s+oshal_pat_[a-f0-9]{48}$/;
/** Clamp an integer environment setting into a closed range, falling back when unset or invalid. */
function boundedSetting(raw, fallback, min, max) {
    const value = Number.parseInt(String(raw ?? ''), 10);
    return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
/** Hours a staged image waits for the GPU worker before it expires (LORA_DATASET_STAGING_TTL_HOURS). */
exports.DATASET_STAGING_TTL_HOURS = boundedSetting(process.env.LORA_DATASET_STAGING_TTL_HOURS, 24, 1, 168);
/** Deadline for each caller-credentialed handle read (LORA_DATASET_RELAY_TIMEOUT_MS). */
const RELAY_TIMEOUT_MS = boundedSetting(process.env.LORA_DATASET_RELAY_TIMEOUT_MS, 30_000, 1_000, 120_000);
/**
 * @description Identify a dataset image by its leading bytes. A declared type is a claim; the magic
 * bytes are the artifact, so only they decide what the worker is allowed to write.
 * @param bytes - Candidate image body.
 * @returns The image type, or null when it is not a PNG, JPEG or WebP.
 */
function sniffDatasetImageType(bytes) {
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';
    if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP')
        return 'image/webp';
    return null;
}
/**
 * @description Derive the curated basename from the handle's display name, with the extension the
 * sniffed bytes support, so a mislabelled source cannot land under the wrong image suffix.
 * @param name - Handle display name (untrusted).
 * @param type - Type decided by the magic bytes.
 * @returns A safe basename, or null when none can be derived.
 */
function datasetFilename(name, type) {
    const base = String(name || '').trim().replace(/\\/g, '/').split('/').pop() || '';
    const stem = base.replace(/\.(png|jpe?g|webp)$/i, '') || 'portrait';
    const candidate = `${stem}.${EXTENSIONS[type]}`;
    return (0, lora_train_dispatch_1.isSafeDatasetFilename)(candidate) ? candidate : null;
}
/**
 * @description Bound the caption written beside the image.
 * @param value - Caller-supplied caption.
 * @param fallback - The character's trigger word when the caller left it blank.
 * @returns The caption, or null when it is empty, contains NUL or exceeds 2048 UTF-8 bytes.
 */
function datasetCaption(value, fallback) {
    const supplied = typeof value === 'string' ? value.trim() : '';
    const caption = supplied || String(fallback || '').trim();
    if (!caption || caption.includes('\0') || Buffer.byteLength(caption, 'utf8') > 2048)
        return null;
    return caption;
}
/** The policy both dataset tables carry: visible to the character's owner or an operator only. */
function ownerPolicy(table, predicate) {
    const owner = `(c.owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on')`;
    const clause = `EXISTS (${predicate} AND ${owner})`;
    return `CREATE POLICY ${table}_owner_policy ON ${table} USING (${clause}) WITH CHECK (${clause})`;
}
/**
 * @description Idempotent DDL for the receipt and staging tables, identical in shape to migrations
 * 103 and 104 so the lazy runtime bootstrap and the install migrations cannot drift apart.
 * @returns Statements in dependency order.
 */
function datasetSchemaStatements() {
    return [
        `CREATE TABLE IF NOT EXISTS oshal_lora_dataset_images (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,
        filename TEXT NOT NULL, source_name TEXT, caption TEXT NOT NULL, byte_size INTEGER,
        status TEXT NOT NULL DEFAULT 'queued', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ingested_at TIMESTAMPTZ, UNIQUE (character_id, filename))`,
        'CREATE INDEX IF NOT EXISTS idx_lora_dataset_images_character ON oshal_lora_dataset_images(character_id, created_at DESC)',
        'ALTER TABLE oshal_lora_dataset_images ENABLE ROW LEVEL SECURITY',
        'ALTER TABLE oshal_lora_dataset_images FORCE ROW LEVEL SECURITY',
        'DROP POLICY IF EXISTS oshal_lora_dataset_images_owner_policy ON oshal_lora_dataset_images',
        ownerPolicy('oshal_lora_dataset_images', 'SELECT 1 FROM oshal_lora_characters c WHERE c.id = oshal_lora_dataset_images.character_id'),
        `CREATE TABLE IF NOT EXISTS oshal_lora_dataset_staging (
        image_id UUID PRIMARY KEY REFERENCES oshal_lora_dataset_images(id) ON DELETE CASCADE,
        content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
        byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= ${lora_train_dispatch_1.MAX_DATASET_IMAGE_BYTES}),
        sha256 TEXT NOT NULL, image BYTEA NOT NULL CHECK (octet_length(image) = byte_size),
        expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
        'CREATE INDEX IF NOT EXISTS idx_lora_dataset_staging_expiry ON oshal_lora_dataset_staging(expires_at)',
        'ALTER TABLE oshal_lora_dataset_staging ENABLE ROW LEVEL SECURITY',
        'ALTER TABLE oshal_lora_dataset_staging FORCE ROW LEVEL SECURITY',
        'DROP POLICY IF EXISTS oshal_lora_dataset_staging_owner_policy ON oshal_lora_dataset_staging',
        ownerPolicy('oshal_lora_dataset_staging', `SELECT 1 FROM oshal_lora_dataset_images d
      JOIN oshal_lora_characters c ON c.id = d.character_id WHERE d.id = oshal_lora_dataset_staging.image_id`),
    ];
}
/** Runtime-bootstrap requirement rows for both dataset tables. */
exports.DATASET_REQUIREMENTS = [
    { table: 'oshal_lora_dataset_images', columns: ['id', 'character_id', 'filename', 'source_name', 'caption', 'byte_size', 'status', 'created_at', 'ingested_at'] },
    { table: 'oshal_lora_dataset_staging', columns: ['image_id', 'content_type', 'byte_size', 'sha256', 'image', 'expires_at', 'created_at'] },
];
/** The caller's own credentials, exactly as core's authenticated relay forwards them. */
function callerCredentialHeaders(req) {
    const headers = {};
    if (req.headers.cookie)
        headers.cookie = req.headers.cookie;
    if (PAT_RE.test(req.headers.authorization ?? ''))
        headers.authorization = req.headers.authorization;
    if (!headers.cookie && !headers.authorization)
        return null;
    if (req.headers.host)
        headers.host = req.headers.host;
    return headers;
}
/** Read at most maxBytes of a response body; null when it is larger. */
async function boundedBody(response, maxBytes) {
    if (Number(response.headers.get('content-length') || 0) > maxBytes)
        return null;
    const reader = response.body?.getReader();
    if (!reader)
        return Buffer.alloc(0);
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done)
                break;
            size += next.value.byteLength;
            if (size > maxBytes)
                return null;
            chunks.push(Buffer.from(next.value));
        }
        return Buffer.concat(chunks);
    }
    finally {
        await reader.cancel().catch((err) => logger.error({ err }, 'dataset relay body cancel failed'));
    }
}
/** Map a core handle-route status onto the answer this destination gives. */
function relayRefusal(status) {
    if (status === 404)
        return { ok: false, status: 404, error: 'artifact handle not found or expired' };
    if (status === 413)
        return { ok: false, status: 413, error: 'image exceeds the 10 MiB dataset limit' };
    return { ok: false, status: 502, error: 'artifact source unavailable' };
}
/** Fetch the handle's metadata and bounded bytes through core's routes as the caller. */
async function fetchAsCaller(base, ref, headers, signal) {
    const url = `${base}/api/artifacts/handles/${encodeURIComponent(ref)}`;
    const meta = await fetch(url, { headers, redirect: 'error', signal });
    if (!meta.ok)
        return relayRefusal(meta.status);
    const info = await meta.json();
    const declared = String(info.type || '').split(';', 1)[0].trim().toLowerCase();
    if (!DECLARED_IMAGE_TYPES.has(declared))
        return { ok: false, status: 415, error: 'artifact must be a PNG, JPEG, or WebP image' };
    const content = await fetch(`${url}/content`, { headers, redirect: 'error', signal });
    if (!content.ok)
        return relayRefusal(content.status);
    const bytes = await boundedBody(content, lora_train_dispatch_1.MAX_DATASET_IMAGE_BYTES);
    if (!bytes)
        return relayRefusal(413);
    const type = bytes.length ? sniffDatasetImageType(bytes) : null;
    if (!type)
        return { ok: false, status: 415, error: 'artifact bytes are not a PNG, JPEG, or WebP image' };
    return { ok: true, name: String(info.name || 'portrait'), type, bytes };
}
/**
 * @description Redeem an ADR-139 handle as the signed-in caller through core's handle routes on
 * this same server. Only the caller's cookie or oshal PAT is forwarded; the fleet secret is never
 * sent, so a service-rail-only request cannot redeem anything. Redirects are refused, the read is
 * bounded to the dataset limit, and a disconnected browser aborts the relay.
 * @param req - The authenticated import request.
 * @param ref - The handle reference from the Send-to action.
 * @returns The image and its sniffed type, or a refusal status and reason.
 */
async function redeemArtifactAsCaller(req, ref) {
    if (!REF_RE.test(ref))
        return { ok: false, status: 400, error: 'a valid artifact ref is required' };
    const headers = callerCredentialHeaders(req);
    if (!headers)
        return { ok: false, status: 403, error: 'artifact redemption requires the signed-in caller' };
    const port = req.socket.localPort;
    if (!port)
        return { ok: false, status: 503, error: 'artifact relay unavailable' };
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, RELAY_TIMEOUT_MS);
    req.once('aborted', abort);
    try {
        return await fetchAsCaller(`http://127.0.0.1:${port}`, ref, headers, controller.signal);
    }
    catch (err) {
        logger.error({ err, ref }, 'dataset artifact redemption failed');
        return { ok: false, status: 502, error: 'artifact source unavailable' };
    }
    finally {
        clearTimeout(timer);
        req.off('aborted', abort);
    }
}
/**
 * @description Fail queued receipts whose staged bytes expired (or never existed, as with 1.4.x
 * receipts whose worker fetch could not succeed) and delete the expired bytes.
 * @param pool - Request-identity-aware pool.
 * @param characterId - Character resolved under its owner's predicate.
 * @returns Nothing.
 */
async function expireDatasetStaging(pool, characterId) {
    await pool.query(`DELETE FROM oshal_lora_dataset_staging s USING oshal_lora_dataset_images d
      WHERE s.image_id = d.id AND d.character_id = $1 AND s.expires_at <= NOW()`, [characterId]);
    await pool.query(`UPDATE oshal_lora_dataset_images d SET status = 'failed'
      WHERE d.character_id = $1 AND d.status = 'queued'
        AND NOT EXISTS (SELECT 1 FROM oshal_lora_dataset_staging s WHERE s.image_id = d.id)`, [characterId]);
}
/** Upsert the receipt and its staged bytes atomically; returns the receipt id. */
async function stageDatasetImage(ctx, characterId, filename, caption, image) {
    const client = await ctx.pool.connect();
    let destroy = false;
    try {
        await client.query('BEGIN');
        const receipt = await client.query(`INSERT INTO oshal_lora_dataset_images (character_id, filename, source_name, caption, byte_size, status)
       VALUES ($1, $2, $3, $4, $5, 'queued')
       ON CONFLICT (character_id, filename) DO UPDATE SET source_name = EXCLUDED.source_name,
         caption = EXCLUDED.caption, byte_size = EXCLUDED.byte_size, status = 'queued', ingested_at = NULL, created_at = NOW()
       RETURNING id`, [characterId, filename, image.name.slice(0, 512), caption, image.bytes.length]);
        const imageId = String(receipt.rows[0].id);
        await client.query(`INSERT INTO oshal_lora_dataset_staging (image_id, content_type, byte_size, sha256, image, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' hours')::INTERVAL)
       ON CONFLICT (image_id) DO UPDATE SET content_type = EXCLUDED.content_type, byte_size = EXCLUDED.byte_size,
         sha256 = EXCLUDED.sha256, image = EXCLUDED.image, expires_at = EXCLUDED.expires_at, created_at = NOW()`, [imageId, image.type, image.bytes.length, (0, node_crypto_1.createHash)('sha256').update(image.bytes).digest('hex'), image.bytes, String(exports.DATASET_STAGING_TTL_HOURS)]);
        await client.query('COMMIT');
        return imageId;
    }
    catch (err) {
        logger.error({ err }, 'dataset staging transaction failed');
        try {
            await client.query('ROLLBACK');
        }
        catch (rollbackErr) {
            destroy = true;
            logger.error({ err: rollbackErr }, 'dataset staging rollback failed; discarding connection');
        }
        throw err;
    }
    finally {
        client.release(destroy);
    }
}
/** Mark one receipt failed and drop its staged bytes (no worker will ever fetch them). */
async function failDatasetImage(pool, imageId) {
    await pool.query(`UPDATE oshal_lora_dataset_images SET status = 'failed' WHERE id = $1`, [imageId]);
    await pool.query('DELETE FROM oshal_lora_dataset_staging WHERE image_id = $1', [imageId]);
}
/** Validate the import body before any character or artifact work. */
function parseImportBody(body) {
    const input = (body && typeof body === 'object' ? body : {});
    const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
    if (!subject)
        return { error: 'character subject required' };
    const ref = typeof input.ref === 'string' ? input.ref.trim() : '';
    if (!REF_RE.test(ref))
        return { error: 'a valid artifact ref is required' };
    return { ref, subject, caption: input.caption };
}
/** Queue the worker write for one staged receipt; a refused dispatch fails the receipt. */
async function queueWorkerWrite(ctx, deps, character, receipt, sub) {
    const subject = character.config.subject;
    const ticket = await ctx.ticketService.createTicket({
        title: `Import ${receipt.filename} into ${subject} LoRA dataset`, ticketType: 'lora-train',
        description: `Write one owner-approved staged image into the curated dataset for "${subject}".`,
        status: 'approved', priority: 'none', labels: ['lora', 'dataset', subject], workspaceId: null,
        assignedAgentId: deps.directorAgentId, parentTicketId: null, externalProvider: null, externalId: null,
        externalUrl: null, ownerSub: sub,
        metadata: { app: 'lora', character: subject, action: 'dataset-import', filename: receipt.filename, datasetImageId: receipt.imageId },
    });
    const command = (0, lora_train_dispatch_1.buildDatasetImportCommand)(character.config, receipt.imageId, receipt.filename, receipt.caption, sub);
    // The grant lives exactly as long as the staged bytes it exists to fetch.
    const dispatch = await (0, lora_callback_grants_1.dispatchWithCallbackGrant)(ctx, { characterId: character.id, ownerSub: sub, ticketId: ticket.ticketId,
        dispatchKind: 'dataset-import', ttlHours: exports.DATASET_STAGING_TTL_HOURS }, command);
    if (dispatch.ok)
        return { ok: true, ticketId: ticket.ticketId, clientId: dispatch.clientId, taskId: dispatch.taskId };
    await failDatasetImage(ctx.pool, receipt.imageId);
    return { ok: false, ticketId: ticket.ticketId, error: dispatch.error };
}
/** POST /dataset/import — redeem, check, stage, then queue the worker write. */
async function importDatasetImage(ctx, deps, req, res) {
    const sub = deps.callerSub(req);
    if (!sub) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
    }
    const input = parseImportBody(req.body);
    if ('error' in input) {
        res.status(400).json({ error: input.error });
        return;
    }
    const character = await deps.loadCharacter(ctx, input.subject, sub);
    if (!character) {
        res.status(404).json({ error: 'character not found' });
        return;
    }
    const caption = datasetCaption(input.caption, character.config.triggerWord || input.subject);
    if (!caption) {
        res.status(400).json({ error: 'caption must be non-empty and at most 2048 UTF-8 bytes' });
        return;
    }
    const image = await redeemArtifactAsCaller(req, input.ref);
    if (!image.ok) {
        res.status(image.status).json({ error: image.error });
        return;
    }
    const filename = datasetFilename(image.name, image.type);
    if (!filename) {
        res.status(400).json({ error: 'artifact filename is not a safe dataset basename' });
        return;
    }
    await expireDatasetStaging(ctx.pool, character.id);
    const imageId = await stageDatasetImage(ctx, character.id, filename, caption, image);
    const queued = await queueWorkerWrite(ctx, deps, character, { imageId, filename, caption }, sub);
    logger.info({ subject: input.subject, filename, bytes: image.bytes.length, queued: queued.ok }, 'lora dataset image staged');
    if (!queued.ok) {
        res.status(503).json({ ok: false, status: 'box_required', ticketId: queued.ticketId, message: queued.error });
        return;
    }
    res.status(202).json({ ok: true, subject: input.subject, filename, byteSize: image.bytes.length, ticketId: queued.ticketId,
        clientId: queued.clientId, taskId: queued.taskId, message: `Dataset image ${filename} queued for ${input.subject}.` });
}
/** GET /dataset?subject= — the owner's receipts, after expiring stale staged bytes. */
async function listDatasetImages(ctx, deps, req, res) {
    const sub = deps.callerSub(req);
    if (!sub) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
    }
    const subject = String(req.query.subject || '').trim();
    const character = await deps.loadCharacter(ctx, subject, sub);
    if (!character) {
        res.status(404).json({ error: 'character not found' });
        return;
    }
    await expireDatasetStaging(ctx.pool, character.id);
    const rows = (await ctx.pool.query(`SELECT filename, source_name, caption, byte_size, status, created_at, ingested_at
       FROM oshal_lora_dataset_images WHERE character_id = $1 ORDER BY created_at DESC LIMIT 200`, [character.id])).rows;
    res.set('Cache-Control', 'private, no-store').json({ subject, storageKey: `lora-${character.id.replace(/-/g, '')}`, images: rows });
}
/**
 * @description The studio's dataset routes (mounted inside the `auth: oidc` /api/lora router).
 * @param ctx - Package app context.
 * @param deps - Owner resolution and character loading from the studio router.
 * @returns Router with GET /dataset and POST /dataset/import.
 */
function createLoraDatasetRoutes(ctx, deps) {
    const router = (0, express_1.Router)();
    router.get('/dataset', async (req, res) => {
        try {
            await listDatasetImages(ctx, deps, req, res);
        }
        catch (err) {
            logger.error({ err }, 'dataset listing failed');
            res.status(502).json({ error: 'dataset receipts unavailable' });
        }
    });
    router.post('/dataset/import', async (req, res) => {
        try {
            await importDatasetImage(ctx, deps, req, res);
        }
        catch (err) {
            logger.error({ err }, 'dataset import failed');
            res.status(502).json({ error: 'dataset import failed' });
        }
    });
    return router;
}
/** Read one staged image for its exact owner while its receipt is still queued and unexpired. */
async function readStagedImage(pool, imageId, ownerSub) {
    const row = (await pool.query(`SELECT d.character_id, s.content_type, s.image FROM oshal_lora_dataset_staging s
       JOIN oshal_lora_dataset_images d ON d.id = s.image_id
       JOIN oshal_lora_characters c ON c.id = d.character_id
      WHERE s.image_id = $1 AND c.owner_sub = $2 AND d.status = 'queued' AND s.expires_at > NOW()`, [imageId, ownerSub])).rows[0];
    return row ? { characterId: String(row.character_id), contentType: row.content_type, bytes: Buffer.from(row.image) } : null;
}
/**
 * @description The worker's download route on the /api/lora/ingest callback mount. It serves only
 * the grant owner's queued, unexpired staged image, and only when the grant was minted for that
 * image's character with the dataset-download kind, so neither a browser, the fleet secret, nor
 * another owner's or character's worker task can read it. The request is an empty signed POST
 * because the kernel's signed-callback rail admits nothing else.
 * @param ctx - Package app context.
 * @param granted - The ingest mount's requireAdmittedGrant guard.
 * @returns Router with POST /dataset-download/:imageId.
 */
function createLoraDatasetWorkerRoutes(ctx, granted) {
    const router = (0, express_1.Router)();
    router.post('/dataset-download/:imageId', granted, async (req, res) => {
        const grant = (0, lora_callback_grants_1.callbackGrantOf)(req);
        const kindRefusal = grant ? (0, lora_callback_grants_1.grantRefusal)(grant, 'dataset-download', null) : 'callback_grant_required';
        if (!grant || kindRefusal) {
            res.status(grant ? 403 : 401).json({ error: kindRefusal });
            return;
        }
        const imageId = String(req.params.imageId || '');
        if (!UUID_RE.test(imageId)) {
            res.status(400).json({ error: 'dataset image id required' });
            return;
        }
        try {
            const staged = await readStagedImage(ctx.pool, imageId, grant.ownerSub);
            if (!staged) {
                res.status(404).json({ error: 'staged dataset image not found or expired' });
                return;
            }
            const characterRefusal = (0, lora_callback_grants_1.grantRefusal)(grant, 'dataset-download', staged.characterId);
            if (characterRefusal) {
                res.status(403).json({ error: characterRefusal });
                return;
            }
            res.setHeader('Content-Type', staged.contentType);
            res.setHeader('Content-Length', String(staged.bytes.length));
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Cache-Control', 'private, no-store');
            res.end(staged.bytes);
        }
        catch (err) {
            logger.error({ err }, 'staged dataset image read failed');
            res.status(502).json({ error: 'staged dataset image unavailable' });
        }
    });
    return router;
}
/**
 * @description Apply the worker's grant-signed `kind: 'dataset'` callback to the exact owner's receipt and
 * delete its staged bytes. The callback names only a basename, never a path.
 * @param ctx - Package app context.
 * @param res - Response to answer.
 * @param character - Character the callback resolved under its exact owner.
 * @param body - Untrusted callback body.
 * @returns True when a receipt was settled; the response is written either way.
 */
async function recordDatasetCallback(ctx, res, character, body) {
    const filename = String(body.filename || '').trim();
    const status = String(body.status || 'ready');
    const bytes = body.byte_size == null ? null : Number(body.byte_size);
    if (!(0, lora_train_dispatch_1.isSafeDatasetFilename)(filename) || !['ready', 'failed'].includes(status)
        || (bytes !== null && (!Number.isInteger(bytes) || bytes < 1 || bytes > lora_train_dispatch_1.MAX_DATASET_IMAGE_BYTES))) {
        res.status(400).json({ error: 'dataset callback requires a safe filename, status (ready|failed), and bounded byte_size' });
        return false;
    }
    const updated = await ctx.pool.query(`UPDATE oshal_lora_dataset_images
        SET status = $3, byte_size = COALESCE($4, byte_size), ingested_at = CASE WHEN $3 = 'ready' THEN NOW() ELSE NULL END
      WHERE character_id = $1 AND filename = $2 RETURNING id`, [character.id, filename, status, bytes]);
    if (updated.rowCount !== 1) {
        res.status(404).json({ error: 'dataset image not found' });
        return false;
    }
    await ctx.pool.query('DELETE FROM oshal_lora_dataset_staging WHERE image_id = $1', [updated.rows[0].id]);
    logger.info({ subject: character.subject, filename, status, bytes }, 'lora dataset ingest');
    res.json({ ok: true, kind: 'dataset', subject: character.subject, filename, status, bytes });
    return true;
}
//# sourceMappingURL=lora-dataset-ingest.js.map