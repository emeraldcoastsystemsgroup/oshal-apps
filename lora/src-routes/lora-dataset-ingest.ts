/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Move the ADR-139 dataset destination out of bot-lora-routes.ts and redeem the Send-to handle as the signed-in caller. The previous import asked core for handle metadata over the service rail (secret + encoded sub), which core's exact-principal artifact check refuses, and the GPU worker fetched the handle content over the same refused rail after the 15-minute handle had usually expired. The controller now fetches the bytes through core's own handle routes with the caller's original cookie or PAT, checks size and magic bytes, stages them in an owner-RLS expiring table, and the worker downloads them from a LoRA-owned exact-owner service route.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The worker download needs the import's own callback grant instead of the fleet service secret: the grant's owner, character and dataset-download kind must match the staged image. Each import dispatch mints that grant with the staging lifetime, and the dataset callback reports whether it settled a receipt so the ingest route can revoke the grant afterwards.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Serve the staged image at POST /dataset-download/:imageId (an empty signed POST) instead of GET /dataset/:imageId. The kernel's signed-package-callbacks rail admits POST only, and the ADR-149 catalog cannot bind a path that overlaps the studio's POST /dataset/import. The live GET was refused authorization_identity_required before the grant check ever ran.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | GET /dataset only reads. It used to expire stale staged bytes first (a DELETE and an UPDATE), and the native kernel admits a GET as a reader and refuses any SQL mutation under it, so selecting a character answered 502 "dataset receipts unavailable". The listing now reports a queued receipt whose staged bytes are gone or past their expiry as failed, which is what the expiry would have written, and the writer paths (the import and the worker callbacks) still expire and delete.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | RP-LORA-01: add multi-photo device upload (POST /dataset/upload) and owner-scoped staged preview reads (GET /dataset/:imageId/preview), plus real receipt ids on authorized GET /dataset reads. Uploaded cropped PNG/JPEG/WebP photos are magic-byte sniffed, size-bounded, auto-deduplicated by basename, staged under forced owner RLS, and dispatched when a GPU worker is online or held staged until one connects.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Stage dataset bytes via decode($5, 'hex') and decode PostgreSQL Buffer or native \x-prefixed hex bytea values on preview and worker reads, paired with the portable length(encode(image, 'hex')) = byte_size * 2 CHECK evolution.
 */

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

import {bindDatasetImport,checkDatasetImport} from './lora-dataset-import-state';
import {createCaptionEditorRoutes,decorateCaptionImages,assertEditorCharacterOwner,editorAccess} from './lora-caption-editor';
import { json, Router, type Request, type RequestHandler, type Response } from 'express';
import { createHash } from 'node:crypto';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { callbackGrantOf, dispatchWithCallbackGrant, grantRefusal, type VerifiedGrant } from './lora-callback-grants';
import {
  buildDatasetImportCommand,
  hasEdgeWorker,
  isSafeDatasetFilename,
  MAX_DATASET_IMAGE_BYTES,
  type LoraCharacterConfig,
} from './lora-train-dispatch';

const logger = createChildLogger({ module: 'lora-dataset-ingest' });

/** Image types a curated dataset may hold, identified by magic bytes. */
export type DatasetImageType = 'image/png' | 'image/jpeg' | 'image/webp';

const DECLARED_IMAGE_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/webp']);
const EXTENSIONS: Record<DatasetImageType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_RE = /^art_[A-Za-z0-9_-]{8,64}$/;
const PAT_RE = /^Bearer\s+oshal_pat_[a-f0-9]{48}$/;

/** Clamp an integer environment setting into a closed range, falling back when unset or invalid. */
function boundedSetting(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(String(raw ?? ''), 10);
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Hours a staged image waits for the GPU worker before it expires (LORA_DATASET_STAGING_TTL_HOURS). */
export const DATASET_STAGING_TTL_HOURS = boundedSetting(process.env.LORA_DATASET_STAGING_TTL_HOURS, 24, 1, 168);
/** Deadline for each caller-credentialed handle read (LORA_DATASET_RELAY_TIMEOUT_MS). */
const RELAY_TIMEOUT_MS = boundedSetting(process.env.LORA_DATASET_RELAY_TIMEOUT_MS, 30_000, 1_000, 120_000);

/** One owner-resolved character as the studio routes load it. */
export interface DatasetCharacter { id: string; config: LoraCharacterConfig }

/** Collaborators owned by the studio router, injected so this module never imports it back. */
export interface DatasetRouteDeps {
  /** The request's authenticated owner (browser/PAT first, trusted service identity second). */
  callerSub: (req: Request) => string | null;
  /** Load one of the owner's characters, or null when the owner has no such character. */
  loadCharacter: (ctx: AppContext, subject: string, ownerSub: string) => Promise<DatasetCharacter | null>;
  /** The LoRA director bot that owns the import ticket. */
  directorAgentId: string;
}

/** A redeemed image, or the status and reason the route answers with. */
export type RedeemOutcome =
  | { ok: true; name: string; type: DatasetImageType; bytes: Buffer }
  | { ok: false; status: number; error: string };

/**
 * @description Identify a dataset image by its leading bytes. A declared type is a claim; the magic
 * bytes are the artifact, so only they decide what the worker is allowed to write.
 * @param bytes - Candidate image body.
 * @returns The image type, or null when it is not a PNG, JPEG or WebP.
 */
export function sniffDatasetImageType(bytes: Buffer): DatasetImageType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * @description Derive the curated basename from the handle's display name, with the extension the
 * sniffed bytes support, so a mislabelled source cannot land under the wrong image suffix.
 * @param name - Handle display name (untrusted).
 * @param type - Type decided by the magic bytes.
 * @returns A safe basename, or null when none can be derived.
 */
export function datasetFilename(name: string, type: DatasetImageType): string | null {
  const base = String(name || '').trim().replace(/\\/g, '/').split('/').pop() || '';
  const stem = base.replace(/\.(png|jpe?g|webp)$/i, '') || 'portrait';
  const candidate = `${stem}.${EXTENSIONS[type]}`;
  return isSafeDatasetFilename(candidate) ? candidate : null;
}

/** Maximum number of cropped reference photos accepted in one upload call. */
export const MAX_UPLOAD_PHOTOS = 24;
const DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;
const BASE64_RE = /^[A-Za-z0-9+/=\s]+$/;

/** Derive a safe, collision-free basename for a device photo upload and reserve its stem. */
export function datasetUploadFilename(name: string, type: DatasetImageType, reservedStems?: Set<string>): string | null {
  const base = String(name || '').trim().replace(/\\/g, '/').split('/').pop() || '';
  const rawStem = base.replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  const rootStem = (rawStem || 'photo').slice(0, 48).replace(/[.-]+$/g, '') || 'photo';
  let chosen = rootStem;
  if (reservedStems) {
    let suffix = 2;
    while (reservedStems.has(chosen.toLowerCase())) {
      chosen = `${rootStem}-${suffix}`;
      suffix += 1;
    }
    reservedStems.add(chosen.toLowerCase());
  }
  const candidate = `${chosen}.${EXTENSIONS[type]}`;
  return isSafeDatasetFilename(candidate) ? candidate : null;
}

/** Decode and magic-byte validate one base64-encoded photo from a device upload. */
export function decodeUploadedPhoto(input: unknown): RedeemOutcome {
  const raw = (input && typeof input === 'object' ? input : {}) as { name?: unknown; dataBase64?: unknown };
  if (typeof raw.dataBase64 !== 'string' || !raw.dataBase64.trim()) {
    return { ok: false, status: 400, error: 'photo image bytes are required' };
  }
  const clean = raw.dataBase64.trim().replace(DATA_URL_RE, '').replace(/\s+/g, '');
  if (!clean || !BASE64_RE.test(clean)) return { ok: false, status: 400, error: 'photo dataBase64 is not valid base64' };
  if (Math.floor((clean.length * 3) / 4) > MAX_DATASET_IMAGE_BYTES + 4) {
    return { ok: false, status: 413, error: 'image exceeds the 10 MiB dataset limit' };
  }
  const bytes = Buffer.from(clean, 'base64');
  if (bytes.length < 1) return { ok: false, status: 400, error: 'photo image bytes are empty' };
  if (bytes.length > MAX_DATASET_IMAGE_BYTES) return { ok: false, status: 413, error: 'image exceeds the 10 MiB dataset limit' };
  const type = sniffDatasetImageType(bytes);
  if (!type) return { ok: false, status: 415, error: 'photo bytes must be a PNG, JPEG, or WebP image' };
  return { ok: true, name: String(raw.name || 'photo'), type, bytes };
}

/**
 * @description Bound the caption written beside the image.
 * @param value - Caller-supplied caption.
 * @param fallback - The character's trigger word when the caller left it blank.
 * @returns The caption, or null when it is empty, contains NUL or exceeds 2048 UTF-8 bytes.
 */
export function datasetCaption(value: unknown, fallback: string): string | null {
  const supplied = typeof value === 'string' ? value.trim() : '';
  const caption = supplied || String(fallback || '').trim();
  if (!caption || caption.includes('\0') || Buffer.byteLength(caption, 'utf8') > 2048) return null;
  return caption;
}

/** The policy both dataset tables carry: visible to the character's owner or an operator only. */
function ownerPolicy(table: string, predicate: string): string {
  const owner = `(c.owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on')`;
  const clause = `EXISTS (${predicate} AND ${owner})`;
  return `CREATE POLICY ${table}_owner_policy ON ${table} USING (${clause}) WITH CHECK (${clause})`;
}

/**
 * @description Idempotent DDL for the receipt and staging tables, identical in shape to migrations
 * 103 and 104 so the lazy runtime bootstrap and the install migrations cannot drift apart.
 * @returns Statements in dependency order.
 */
export function datasetSchemaStatements(): string[] {
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
        byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= ${MAX_DATASET_IMAGE_BYTES}),
        sha256 TEXT NOT NULL, image BYTEA NOT NULL CHECK (octet_length(image) = byte_size),
        expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    'CREATE INDEX IF NOT EXISTS idx_lora_dataset_staging_expiry ON oshal_lora_dataset_staging(expires_at)',
    'ALTER TABLE oshal_lora_dataset_staging ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE oshal_lora_dataset_staging FORCE ROW LEVEL SECURITY',
    'DROP POLICY IF EXISTS oshal_lora_dataset_staging_owner_policy ON oshal_lora_dataset_staging',
    ownerPolicy('oshal_lora_dataset_staging', `SELECT 1 FROM oshal_lora_dataset_images d
      JOIN oshal_lora_characters c ON c.id = d.character_id WHERE d.id = oshal_lora_dataset_staging.image_id`),
    'ALTER TABLE oshal_lora_dataset_staging DROP CONSTRAINT IF EXISTS oshal_lora_dataset_staging_check',
    `ALTER TABLE oshal_lora_dataset_staging ADD CONSTRAINT oshal_lora_dataset_staging_check CHECK (length(encode(image, 'hex')) = byte_size * 2)`,
  ];
}

/** Runtime-bootstrap requirement rows for both dataset tables. */
export const DATASET_REQUIREMENTS = [
  { table: 'oshal_lora_dataset_images', columns: ['id', 'character_id', 'filename', 'source_name', 'caption', 'byte_size', 'status', 'created_at', 'ingested_at'] },
  { table: 'oshal_lora_dataset_staging', columns: ['image_id', 'content_type', 'byte_size', 'sha256', 'image', 'expires_at', 'created_at'] },
];

/** The caller's own credentials, exactly as core's authenticated relay forwards them. */
function callerCredentialHeaders(req: Request): Record<string, string> | null {
  const headers: Record<string, string> = {};
  if (req.headers.cookie) headers.cookie = req.headers.cookie;
  if (PAT_RE.test(req.headers.authorization ?? '')) headers.authorization = req.headers.authorization!;
  if (!headers.cookie && !headers.authorization) return null;
  if (req.headers.host) headers.host = req.headers.host;
  return headers;
}

/** Read at most maxBytes of a response body; null when it is larger. */
async function boundedBody(response: globalThis.Response, maxBytes: number): Promise<Buffer | null> {
  if (Number(response.headers.get('content-length') || 0) > maxBytes) return null;
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) return null;
      chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch((err: unknown) => logger.error({ err }, 'dataset relay body cancel failed'));
  }
}

/** Map a core handle-route status onto the answer this destination gives. */
function relayRefusal(status: number): RedeemOutcome {
  if (status === 404) return { ok: false, status: 404, error: 'artifact handle not found or expired' };
  if (status === 413) return { ok: false, status: 413, error: 'image exceeds the 10 MiB dataset limit' };
  return { ok: false, status: 502, error: 'artifact source unavailable' };
}

/** Fetch the handle's metadata and bounded bytes through core's routes as the caller. */
async function fetchAsCaller(base: string, ref: string, headers: Record<string, string>, signal: AbortSignal): Promise<RedeemOutcome> {
  const url = `${base}/api/artifacts/handles/${encodeURIComponent(ref)}`;
  const meta = await fetch(url, { headers, redirect: 'error', signal });
  if (!meta.ok) return relayRefusal(meta.status);
  const info = await meta.json() as { name?: unknown; type?: unknown };
  const declared = String(info.type || '').split(';', 1)[0].trim().toLowerCase();
  if (!DECLARED_IMAGE_TYPES.has(declared)) return { ok: false, status: 415, error: 'artifact must be a PNG, JPEG, or WebP image' };
  const content = await fetch(`${url}/content`, { headers, redirect: 'error', signal });
  if (!content.ok) return relayRefusal(content.status);
  const bytes = await boundedBody(content, MAX_DATASET_IMAGE_BYTES);
  if (!bytes) return relayRefusal(413);
  const type = bytes.length ? sniffDatasetImageType(bytes) : null;
  if (!type) return { ok: false, status: 415, error: 'artifact bytes are not a PNG, JPEG, or WebP image' };
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
export async function redeemArtifactAsCaller(req: Request, ref: string): Promise<RedeemOutcome> {
  if (!REF_RE.test(ref)) return { ok: false, status: 400, error: 'a valid artifact ref is required' };
  const headers = callerCredentialHeaders(req);
  if (!headers) return { ok: false, status: 403, error: 'artifact redemption requires the signed-in caller' };
  const port = req.socket.localPort;
  if (!port) return { ok: false, status: 503, error: 'artifact relay unavailable' };
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, RELAY_TIMEOUT_MS);
  req.once('aborted', abort);
  try {
    return await fetchAsCaller(`http://127.0.0.1:${port}`, ref, headers, controller.signal);
  } catch (err) {
    logger.error({ err, ref }, 'dataset artifact redemption failed');
    return { ok: false, status: 502, error: 'artifact source unavailable' };
  } finally {
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
export async function expireDatasetStaging(pool: AppContext['pool'], characterId: string): Promise<void> {
  await pool.query(
    `DELETE FROM oshal_lora_dataset_staging s USING oshal_lora_dataset_images d
      WHERE s.image_id = d.id AND d.character_id = $1 AND s.expires_at <= NOW()`, [characterId]);
  await pool.query(
    `UPDATE oshal_lora_dataset_images d SET status = 'failed'
      WHERE d.character_id = $1 AND d.status = 'queued'
        AND NOT EXISTS (SELECT 1 FROM oshal_lora_dataset_staging s WHERE s.image_id = d.id)`, [characterId]);
}

/** Upsert the receipt and its staged bytes atomically; returns the receipt id. */
async function stageDatasetImage(
  ctx: AppContext, characterId: string, filename: string, caption: string, image: Extract<RedeemOutcome, { ok: true }>,
): Promise<string> {
  const stageActor=await editorAccess(ctx,'lora.configure');await assertEditorCharacterOwner(ctx,characterId,stageActor);
  const client = await ctx.pool.connect();
  let destroy = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM oshal_lora_characters WHERE id=$1 FOR UPDATE',[characterId]);
    const existing=(await client.query('SELECT id,filename,status FROM oshal_lora_dataset_images WHERE character_id=$1',[characterId])).rows;
    const stem=filename.replace(/\.[^.]+$/,'.txt').toLowerCase();
    if(existing.some((row:any)=>String(row.filename).replace(/\.[^.]+$/,'.txt').toLowerCase()===stem&&(row.filename!==filename||row.status!=='failed')))throw Object.assign(new Error('That dataset basename is already queued or saved. Edit its caption instead of overwriting the original image.'),{status:409});
    const receipt = await client.query(
      `INSERT INTO oshal_lora_dataset_images (character_id, filename, source_name, caption, byte_size, status)
       VALUES ($1, $2, $3, $4, $5, 'queued')
       ON CONFLICT (character_id, filename) DO UPDATE SET source_name = EXCLUDED.source_name,
         caption = EXCLUDED.caption, byte_size = EXCLUDED.byte_size, status = 'queued', ingested_at = NULL, created_at = NOW()
       RETURNING id`, [characterId, filename, image.name.slice(0, 512), caption, image.bytes.length]);
    const imageId = String(receipt.rows[0].id);
    await client.query(
      `INSERT INTO oshal_lora_dataset_staging (image_id, content_type, byte_size, sha256, image, expires_at)
       VALUES ($1, $2, $3, $4, decode($5, 'hex'), NOW() + ($6 || ' hours')::INTERVAL)
       ON CONFLICT (image_id) DO UPDATE SET content_type = EXCLUDED.content_type, byte_size = EXCLUDED.byte_size,
         sha256 = EXCLUDED.sha256, image = EXCLUDED.image, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
      [imageId, image.type, image.bytes.length, createHash('sha256').update(image.bytes).digest('hex'), image.bytes.toString('hex'), String(DATASET_STAGING_TTL_HOURS)]);
    await editorAccess(ctx,'lora.configure',stageActor);
    await client.query('COMMIT');
    return imageId;
  } catch (err) {
    logger.error({ err }, 'dataset staging transaction failed');
    try { await client.query('ROLLBACK'); } catch (rollbackErr) {
      destroy = true;
      logger.error({ err: rollbackErr }, 'dataset staging rollback failed; discarding connection');
    }
    throw err;
  } finally { client.release(destroy); }
}

/** Mark one receipt failed and drop its staged bytes (no worker will ever fetch them). */
async function failDatasetImage(pool: AppContext['pool'], imageId: string): Promise<void> {
  await pool.query(`UPDATE oshal_lora_dataset_images SET status = 'failed' WHERE id = $1`, [imageId]);
  await pool.query('DELETE FROM oshal_lora_dataset_staging WHERE image_id = $1', [imageId]);
}

/** Validate the import body before any character or artifact work. */
function parseImportBody(body: unknown): { ref: string; subject: string; caption: unknown } | { error: string } {
  const input = (body && typeof body === 'object' ? body : {}) as { ref?: unknown; subject?: unknown; caption?: unknown };
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  if (!subject) return { error: 'character subject required' };
  const ref = typeof input.ref === 'string' ? input.ref.trim() : '';
  if (!REF_RE.test(ref)) return { error: 'a valid artifact ref is required' };
  return { ref, subject, caption: input.caption };
}

/** Queue the worker write for one staged receipt; a refused dispatch fails the receipt. */
async function queueWorkerWrite(
  ctx: AppContext, deps: DatasetRouteDeps, character: DatasetCharacter, receipt: { imageId: string; filename: string; caption: string }, sub: string,
): Promise<{ ok: true; ticketId: string; clientId?: string; taskId?: string } | { ok: false; ticketId: string; error?: string }> {
  const subject = character.config.subject;
  const ticket = await ctx.ticketService.createTicket({
    title: `Import ${receipt.filename} into ${subject} LoRA dataset`, ticketType: 'lora-train',
    description: `Write one owner-approved staged image into the curated dataset for "${subject}".`,
    status: 'approved', priority: 'none', labels: ['lora', 'dataset', subject], workspaceId: null,
    assignedAgentId: deps.directorAgentId, parentTicketId: null, externalProvider: null, externalId: null,
    externalUrl: null, ownerSub: sub,
    metadata: { app: 'lora', character: subject, action: 'dataset-import', filename: receipt.filename, datasetImageId: receipt.imageId },
  });
  const importRevision=await bindDatasetImport(ctx,character.id,receipt.imageId,ticket.ticketId);
  const command = buildDatasetImportCommand(character.config, receipt.imageId, receipt.filename, receipt.caption, sub, importRevision);
  // The grant lives exactly as long as the staged bytes it exists to fetch.
  const dispatch = await dispatchWithCallbackGrant(ctx, { characterId: character.id, ownerSub: sub, ticketId: ticket.ticketId,
    dispatchKind: 'dataset-import', ttlHours: DATASET_STAGING_TTL_HOURS }, command);
  if (dispatch.ok) return { ok: true, ticketId: ticket.ticketId, clientId: dispatch.clientId, taskId: dispatch.taskId };
  await failDatasetImage(ctx.pool, receipt.imageId);
  return { ok: false, ticketId: ticket.ticketId, error: dispatch.error };
}

/** POST /dataset/import — redeem, check, stage, then queue the worker write. */
async function importDatasetImage(ctx: AppContext, deps: DatasetRouteDeps, req: Request, res: Response): Promise<void> {
  const sub = deps.callerSub(req);
  if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
  const input = parseImportBody(req.body);
  if ('error' in input) { res.status(400).json({ error: input.error }); return; }
  const character = await deps.loadCharacter(ctx, input.subject, sub);
  if (!character) { res.status(404).json({ error: 'character not found' }); return; }
  await assertEditorCharacterOwner(ctx,character.id);
  const caption = datasetCaption(input.caption, character.config.triggerWord || input.subject);
  if (!caption) { res.status(400).json({ error: 'caption must be non-empty and at most 2048 UTF-8 bytes' }); return; }
  const image = await redeemArtifactAsCaller(req, input.ref);
  if (!image.ok) { res.status(image.status).json({ error: image.error }); return; }
  const filename = datasetFilename(image.name, image.type);
  if (!filename) { res.status(400).json({ error: 'artifact filename is not a safe dataset basename' }); return; }
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

interface PreparedUploadItem {
  filename: string;
  caption: string;
  image: Extract<RedeemOutcome, { ok: true }>;
}

/** Validate and prepare every photo in an upload batch before staging any SQL rows. */
function prepareUploadBatch(
  rawPhotos: unknown[], fallbackCaption: string, reservedStems: Set<string>,
): { ok: true; items: PreparedUploadItem[] } | { ok: false; status: number; error: string } {
  const items: PreparedUploadItem[] = [];
  for (const raw of rawPhotos) {
    const decoded = decodeUploadedPhoto(raw);
    if (!decoded.ok) return decoded;
    const rawCaption = raw && typeof raw === 'object' ? (raw as { caption?: unknown }).caption : undefined;
    const caption = datasetCaption(rawCaption, fallbackCaption);
    if (!caption) return { ok: false, status: 400, error: 'caption must be non-empty and at most 2048 UTF-8 bytes' };
    const filename = datasetUploadFilename(decoded.name, decoded.type, reservedStems);
    if (!filename) return { ok: false, status: 400, error: 'photo filename is not a safe dataset basename' };
    items.push({ filename, caption, image: decoded });
  }
  return { ok: true, items };
}

async function stageUploadedBatch(
  ctx: AppContext,
  deps: LoraDatasetDeps,
  character: LoadedCharacter,
  items: PreparedUploadItem[],
  sub: string,
  workerOnline: boolean,
): Promise<Array<Record<string, unknown>>> {
  const uploaded: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const imageId = await stageDatasetImage(ctx, character.id, item.filename, item.caption, item.image);
    if (workerOnline) {
      const queued = await queueWorkerWrite(ctx, deps, character, { imageId, filename: item.filename, caption: item.caption }, sub);
      uploaded.push({ id: imageId, filename: item.filename, caption: item.caption, byteSize: item.image.bytes.length,
        status: queued.ok ? 'queued' : 'failed', workerSync: queued.ok ? 'dispatched' : 'failed', ticketId: queued.ticketId });
    } else {
      uploaded.push({ id: imageId, filename: item.filename, caption: item.caption, byteSize: item.image.bytes.length,
        status: 'queued', workerSync: 'staged' });
    }
  }
  return uploaded;
}

/** POST /dataset/upload — stage one or more cropped device photos with captions into the character's curated dataset. */
async function uploadDatasetPhotos(ctx: AppContext, deps: DatasetRouteDeps, req: Request, res: Response): Promise<void> {
  const sub = deps.callerSub(req);
  if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { subject?: unknown; photos?: unknown; dataBase64?: unknown };
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (!subject) { res.status(400).json({ error: 'character subject required' }); return; }
  const rawPhotos = Array.isArray(body.photos) ? body.photos : body.dataBase64 !== undefined ? [body] : [];
  if (rawPhotos.length < 1 || rawPhotos.length > MAX_UPLOAD_PHOTOS) {
    res.status(400).json({ error: `provide between 1 and ${MAX_UPLOAD_PHOTOS} photos` });
    return;
  }
  const character = await deps.loadCharacter(ctx, subject, sub);
  if (!character) { res.status(404).json({ error: 'character not found' }); return; }
  const actor = await editorAccess(ctx, 'lora.configure');
  await assertEditorCharacterOwner(ctx, character.id, actor);
  const existing = (await ctx.pool.query('SELECT filename, status FROM oshal_lora_dataset_images WHERE character_id = $1', [character.id])).rows;
  const reserved = new Set<string>(existing.filter((r: { status?: unknown }) => r.status !== 'failed')
    .map((r: { filename?: unknown }) => String(r.filename || '').replace(/\.[^.]+$/, '').toLowerCase()));
  const prepared = prepareUploadBatch(rawPhotos, character.config.triggerWord || subject, reserved);
  if (!prepared.ok) { res.status(prepared.status).json({ error: prepared.error }); return; }
  await expireDatasetStaging(ctx.pool, character.id);
  const workerOnline = hasEdgeWorker();
  const uploaded = await stageUploadedBatch(ctx, deps, character, prepared.items, sub, workerOnline);
  logger.info({ subject, count: uploaded.length, workerOnline }, 'lora dataset photos uploaded');
  res.status(workerOnline ? 202 : 201).json({
    ok: true, subject, count: uploaded.length, uploaded,
    message: `${uploaded.length} photo${uploaded.length === 1 ? '' : 's'} saved to ${subject}'s dataset.`,
  });
}

/** Decode a staged BYTEA column returned either as a PostgreSQL Buffer or native `\x<hex>` text. */
export function decodeStagedImageBytes(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (typeof raw === 'string') {
    return raw.startsWith('\\x') ? Buffer.from(raw.slice(2), 'hex') : Buffer.from(raw, 'hex');
  }
  if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'Buffer' && Array.isArray((raw as { data?: unknown }).data)) {
    return Buffer.from((raw as { data: number[] }).data);
  }
  throw new Error('staged dataset image bytes are unreadable');
}

/** GET /dataset/:imageId/preview?subject= — serve an owner's unexpired staged dataset photo for studio thumbnails. */
async function readDatasetPreview(ctx: AppContext, deps: DatasetRouteDeps, req: Request, res: Response): Promise<void> {
  const sub = deps.callerSub(req);
  if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
  const imageId = String(req.params.imageId || '');
  const subject = String(req.query.subject || '').trim();
  if (!UUID_RE.test(imageId) || !subject) { res.status(400).json({ error: 'subject and dataset image id required' }); return; }
  const character = await deps.loadCharacter(ctx, subject, sub);
  if (!character) { res.status(404).json({ error: 'character not found' }); return; }
  const row = (await ctx.pool.query(
    `SELECT s.content_type, s.image FROM oshal_lora_dataset_staging s
       JOIN oshal_lora_dataset_images d ON d.id = s.image_id
      WHERE s.image_id = $1 AND d.character_id = $2 AND s.expires_at > NOW()`,
    [imageId, character.id],
  )).rows[0] as { content_type: string; image: unknown } | undefined;
  if (!row) { res.status(404).json({ error: 'dataset preview not available' }); return; }
  const bytes = decodeStagedImageBytes(row.image);
  res.setHeader('Content-Type', row.content_type);
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(bytes);
}

/**
 * @description Report a queued receipt as failed once its staged bytes are gone or expired: no worker
 * can fetch them any more, which is exactly what expireDatasetStaging records on the next write. A
 * read cannot record it (a GET is admitted read-only), so the listing derives it instead.
 * @param rows - The character's receipts, each with its id.
 * @param live - Receipt ids whose staged bytes are still present and unexpired.
 * @returns The receipts without their ids, with the effective status.
 */
export function effectiveDatasetReceipts(rows: Array<Record<string, unknown>>, live: Set<string>): Array<Record<string, unknown>> {
  return rows.map(({ id, ...row }) => (row.status === 'queued' && !live.has(String(id)) ? { ...row, status: 'failed' } : row));
}

/** GET /dataset?subject= — the owner's receipts. A pure read: it never expires or deletes anything. */
async function listDatasetImages(ctx: AppContext, deps: DatasetRouteDeps, req: Request, res: Response): Promise<void> {
  const sub = deps.callerSub(req);
  if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
  const subject = String(req.query.subject || '').trim();
  const character = await deps.loadCharacter(ctx, subject, sub);
  if (!character) { res.status(404).json({ error: 'character not found' }); return; }
  const rows = (await ctx.pool.query(
    `SELECT id, filename, source_name, caption, byte_size, status, created_at, ingested_at
       FROM oshal_lora_dataset_images WHERE character_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [character.id],
  )).rows;
  const live = (await ctx.pool.query(
    `SELECT s.image_id FROM oshal_lora_dataset_staging s JOIN oshal_lora_dataset_images d ON d.id = s.image_id
      WHERE d.character_id = $1 AND s.expires_at > NOW()`, [character.id],
  )).rows.map((row: { image_id: unknown }) => String(row.image_id));
  const liveSet = new Set(live);
  const images = ctx.authorization
    ? await decorateCaptionImages(ctx, character.id, rows.map((row: Record<string, unknown>) => ({
        ...row,
        status: row.status === 'queued' && !liveSet.has(String(row.id)) ? 'failed' : row.status,
        has_preview: liveSet.has(String(row.id)),
      })))
    : effectiveDatasetReceipts(rows, liveSet);
  res.set('Cache-Control', 'private, no-store').json({ subject, storageKey: `lora-${character.id.replace(/-/g, '')}`, images });
}

/**
 * @description The studio's dataset routes (mounted inside the `auth: oidc` /api/lora router).
 * @param ctx - Package app context.
 * @param deps - Owner resolution and character loading from the studio router.
 * @returns Router with GET /dataset, GET /dataset/:imageId/preview, POST /dataset/import and POST /dataset/upload.
 */
export function createLoraDatasetRoutes(ctx: AppContext, deps: DatasetRouteDeps): Router {
  const router = Router();router.use(createCaptionEditorRoutes(ctx,deps));
  router.get('/dataset/:imageId/preview', async (req: Request, res: Response) => {
    try { await readDatasetPreview(ctx, deps, req, res); } catch (err) {
      logger.error({ err }, 'dataset preview read failed');
      res.status(502).json({ error: 'dataset preview unavailable' });
    }
  });
  router.get('/dataset', async (req: Request, res: Response) => {
    try { await listDatasetImages(ctx, deps, req, res); } catch (err) {
      logger.error({ err }, 'dataset listing failed');
      res.status(502).json({ error: 'dataset receipts unavailable' });
    }
  });
  router.post('/dataset/import', async (req: Request, res: Response) => {
    try { await importDatasetImage(ctx, deps, req, res); } catch (err) {
      logger.error({ err }, 'dataset import failed');
      res.status((err as {status?:number}).status===409?409:502).json({ error: (err as {status?:number}).status===409?(err as Error).message:'dataset import failed' });
    }
  });
  router.post('/dataset/upload', json({ limit: '16mb' }), async (req: Request, res: Response) => {
    try { await uploadDatasetPhotos(ctx, deps, req, res); } catch (err) {
      const code = (err as { status?: number }).status;
      if (code && code >= 400 && code < 500) { res.status(code).json({ error: (err as Error).message }); return; }
      logger.error({ err }, 'dataset upload failed');
      res.status(502).json({ error: 'dataset upload failed' });
    }
  });
  return router;
}

/** Read one staged image for its exact owner while its receipt is still queued and unexpired. */
async function readStagedImage(
  pool: AppContext['pool'], imageId: string, ownerSub: string,ticketId:string,
): Promise<{ characterId: string; contentType: string; bytes: Buffer } | null> {
  const row = (await pool.query(
    `SELECT d.character_id, s.content_type, s.image FROM oshal_lora_dataset_staging s
       JOIN oshal_lora_dataset_images d ON d.id = s.image_id
       JOIN oshal_lora_characters c ON c.id = d.character_id
       JOIN oshal_lora_dataset_imports i ON i.image_id=d.id
      WHERE i.ticket_id=$3 AND s.image_id = $1 AND c.owner_sub = $2 AND d.status = 'queued' AND s.expires_at > NOW()`,
    [imageId, ownerSub,ticketId],
  )).rows[0] as { character_id: string; content_type: string; image: unknown } | undefined;
  return row ? { characterId: String(row.character_id), contentType: row.content_type, bytes: decodeStagedImageBytes(row.image) } : null;
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
export function createLoraDatasetWorkerRoutes(ctx: AppContext, granted: RequestHandler): Router {
  const router = Router();
  router.post('/dataset-download/:imageId', granted, async (req: Request, res: Response) => {
    const grant = callbackGrantOf(req);
    const kindRefusal = grant ? grantRefusal(grant, 'dataset-download', null) : 'callback_grant_required';
    if (!grant || kindRefusal) { res.status(grant ? 403 : 401).json({ error: kindRefusal }); return; }
    const imageId = String(req.params.imageId || '');
    if (!UUID_RE.test(imageId)) { res.status(400).json({ error: 'dataset image id required' }); return; }
    try {
      const staged = await readStagedImage(ctx.pool, imageId, grant.ownerSub,grant.ticketId||'');
      if (!staged) { res.status(404).json({ error: 'staged dataset image not found or expired' }); return; }
      const characterRefusal = grantRefusal(grant, 'dataset-download', staged.characterId);
      if (characterRefusal) { res.status(403).json({ error: characterRefusal }); return; }
      res.setHeader('Content-Type', staged.contentType);
      res.setHeader('Content-Length', String(staged.bytes.length));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.end(staged.bytes);
    } catch (err) {
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
export async function recordDatasetCallback(
  ctx: AppContext, res: Response, character: { id: string; subject: string }, body: Record<string, unknown>,grant?:VerifiedGrant,
): Promise<boolean> {
  const imageId=String(body.image_id||''),importRevision=Number(body.import_revision);
  if(!grant?.ticketId||!UUID_RE.test(imageId)||!Number.isSafeInteger(importRevision)||importRevision<1){res.status(400).json({error:'An exact import image and revision are required'});return false;}
  let source;try{source=await checkDatasetImport(ctx,character.id,imageId,importRevision,grant.ticketId,body.status==='check');}catch(error){res.status((error as {status?:number}).status||403).json({error:'The import job is stale or its current authority was revoked.'});return false;}
  if(source.filename!==String(body.filename||'')||!isSafeDatasetFilename(String(body.filename||''))){res.status(409).json({error:'The import filename does not match its bound source'});return false;}
  if(body.status==='check'){res.json({ok:true,kind:'dataset',status:'check',import_revision:importRevision});return false;}
  const filename = String(body.filename || '').trim();
  const status = String(body.status || 'ready');
  const bytes = body.byte_size == null ? null : Number(body.byte_size);
  if (!isSafeDatasetFilename(filename) || !['ready', 'failed'].includes(status)
      || (bytes !== null && (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_DATASET_IMAGE_BYTES))) {
    res.status(400).json({ error: 'dataset callback requires a safe filename, status (ready|failed), and bounded byte_size' });
    return false;
  }
  if(source.filename!==filename||(status==='ready'&&body.caption_sha256!==createHash('sha256').update(source.caption,'utf8').digest('hex'))){res.status(409).json({error:'The import caption bytes do not match their saved source'});return false;}
  const updated = await ctx.pool.query(
    `UPDATE oshal_lora_dataset_images
        SET status = $3, byte_size = COALESCE($4, byte_size), ingested_at = CASE WHEN $3 = 'ready' THEN NOW() ELSE NULL END
      WHERE character_id = $1 AND filename = $2 AND id=$5 AND status='queued' AND EXISTS(SELECT 1 FROM oshal_lora_dataset_imports i WHERE i.image_id=oshal_lora_dataset_images.id AND i.ticket_id=$6 AND i.import_revision=$7) RETURNING id`,
    [character.id, filename, status, bytes,imageId,grant.ticketId,importRevision],
  );
  if (updated.rowCount !== 1) { res.status(404).json({ error: 'dataset image not found' }); return false; }
  await ctx.pool.query('DELETE FROM oshal_lora_dataset_staging WHERE image_id = $1', [updated.rows[0].id]);
  logger.info({ subject: character.subject, filename, status, bytes }, 'lora dataset ingest');
  res.json({ ok: true, kind: 'dataset', subject: character.subject, filename, status, bytes });
  return true;
}
