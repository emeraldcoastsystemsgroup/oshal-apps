/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Move the GPU worker's callback mount out of bot-lora-routes.ts (which had reached 801 code lines) and authenticate it with per-dispatch callback grants instead of the fleet service secret. Each callback must be signed under a live grant, and the grant decides the owner, the character, the callback kinds and, for the overnight review, the exact dispatch ticket. The review revokes its grant, and so does a dataset import's final callback, so neither can be replayed with a fresh nonce afterwards.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Put this mount on the kernel's signed-package-callbacks rail. Under ADR-149 enforce the application-authorization layer refused every worker request (authorization_identity_required) before the grant check ran, so no GPU result or dataset download could reach LoRA. createLoraCallbackVerifier is the manifest's callbackVerifier: it reads the exact body the route will use, verifies the grant, and returns the grant owner's stored subject and issuer, which the kernel refreshes and authorizes against the catalog before this router runs as that owner. The health-only GET / is gone (the rail admits POST only), and the handlers read the grant the verifier admitted.
 */

/**
 * The LoRA worker mount (`/api/lora/ingest`, `auth: public` + `callbackVerifier` in the manifest).
 * The box calls it; no browser session reaches it. The kernel's signed-package-callbacks rail admits
 * POST only, runs `createLoraCallbackVerifier` first, then refreshes the grant owner's principal,
 * requires the catalog permission bound to the route and runs this router as that owner under forced
 * RLS. Every route also checks `requireAdmittedGrant`, so none can run without a verified grant.
 */

import { Router, raw, type Request, type RequestHandler, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import type { PackageCallbackVerifier } from '@/shared/package-callbacks';
import { summarizeScore, computeWeakCells, type ScoreCell } from './scorecard';
import { LORA_DIRECTOR_AGENT_ID } from './lora-train-dispatch';
import { createLoraDatasetWorkerRoutes, recordDatasetCallback } from './lora-dataset-ingest';
import {
  MAX_CELL_IMAGE_BYTES,
  checkCellImage,
  parseCellIndex,
  purgeExpiredCellImages,
  storeCellImage,
} from './lora-cell-images';
import {
  CALLBACK_CONTENT_TYPE,
  MAX_CALLBACK_BODY_BYTES,
  callbackGrantOf,
  checkCallbackRequest,
  grantRefusal,
  requireAdmittedGrant,
  revokeCallbackGrant,
  type CallbackKind,
  type CallbackVerification,
  type VerifiedGrant,
} from './lora-callback-grants';

const logger = createChildLogger({ module: 'lora-ingest-routes' });

/** The manifest's mountPath for this router; the verifier runs before the mount prefix is stripped. */
export const LORA_INGEST_MOUNT = '/api/lora/ingest';
const DATASET_DOWNLOAD_RE = /^\/dataset-download\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The body reader for one worker route, or null for a path the mount does not serve. The signature
 * covers these exact bytes, so the verifier reads them; the downstream route then sees the request
 * as already consumed. The dataset download must carry no body at all.
 */
function workerBodyReader(relative: string): RequestHandler | null {
  if (relative === '/') return raw({ type: CALLBACK_CONTENT_TYPE, limit: MAX_CALLBACK_BODY_BYTES });
  if (relative === '/cell-image') return raw({ type: ['image/png', 'image/jpeg'], limit: MAX_CELL_IMAGE_BYTES });
  if (DATASET_DOWNLOAD_RE.test(relative)) return raw({ type: () => true, limit: 0 });
  return null;
}

/** Read the request body with one parser, resolving false when the parser refuses it. */
function readBody(reader: RequestHandler, req: Request): Promise<boolean> {
  return new Promise((resolve) => {
    reader(req, {} as Response, (err?: unknown) => {
      if (err) logger.warn({ err, path: req.path }, 'lora worker request body refused');
      resolve(!err);
    });
  });
}

/**
 * @description Verify one worker request: only the three worker routes, the exact signed body, and
 * the per-dispatch grant (signature, lifetime, revocation, recorded issuer, single-use nonce).
 * @param ctx - Package app context.
 * @param req - The request, before the mount prefix is stripped.
 * @returns The admitted grant, or the refusal reason (logged; the kernel answers every refusal alike).
 */
export async function verifyWorkerRequest(ctx: AppContext, req: Request): Promise<CallbackVerification> {
  const full = String(req.originalUrl || req.url).split('?', 1)[0];
  const reader = full === LORA_INGEST_MOUNT || full.startsWith(`${LORA_INGEST_MOUNT}/`)
    ? workerBodyReader(full.slice(LORA_INGEST_MOUNT.length) || '/') : null;
  if (!reader) { logger.warn({ path: full }, 'lora worker request refused: unknown route'); return { ok: false, error: 'callback_route_unknown' }; }
  if (!(await readBody(reader, req))) return { ok: false, error: 'callback_body_refused' };
  return checkCallbackRequest(ctx, req);
}

/**
 * @description The manifest's `callbackVerifier` for this mount (kernel skill
 * `signed-package-callbacks`). It returns only the verified grant's stored owner subject and issuer,
 * never anything the request asserts, so the kernel refreshes that owner and checks the catalog
 * permission bound to the route before the handler runs as that owner. Any refusal returns null.
 * @param ctx - Package app context.
 * @returns The request verifier the route mounter calls.
 */
export function createLoraCallbackVerifier(ctx: AppContext): PackageCallbackVerifier {
  return async (req: Request) => {
    const verdict = await verifyWorkerRequest(ctx, req);
    return verdict.ok ? { sub: verdict.grant.ownerSub, issuer: verdict.grant.ownerIssuer } : null;
  };
}

type CallbackCharacter = { id: string; subject: string };

/** Resolve new worker keys or legacy public names, refusing an ambiguous match within one owner. */
async function callbackCharacter(ctx: AppContext, key: string, ownerSub: string): Promise<CallbackCharacter | null> {
  if (!key) return null;
  const result = await ctx.pool.query(
    `SELECT id, subject FROM oshal_lora_characters WHERE owner_sub = $2
       AND (subject = $1 OR 'lora-' || replace(id::text, '-', '') = $1) LIMIT 2`,
    [key, ownerSub],
  );
  return result.rows.length === 1 ? result.rows[0] : null;
}

/** Coerce a JSON field to a trimmed string or null. */
function str(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim();
  return s ? s : null;
}
/** Coerce to a finite integer or null. */
function int(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
/** Coerce to a finite number or null. */
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Parse the signed JSON body; null when it is not one JSON object. */
function callbackBody(req: Request): Record<string, unknown> | null {
  if (!Buffer.isBuffer(req.body)) return null;
  try {
    const parsed = JSON.parse(req.body.toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch (err) {
    logger.error({ err }, 'lora callback body is not JSON');
    return null;
  }
}

/**
 * Resolve the callback's character under the grant owner and check the grant covers this kind for
 * that character. Answers the refusal itself and returns null when the callback may not proceed.
 */
async function scopedCharacter(
  ctx: AppContext, res: Response, grant: VerifiedGrant, kind: CallbackKind, key: string,
): Promise<CallbackCharacter | null> {
  const kindRefusal = grantRefusal(grant, kind, null);
  if (kindRefusal) { res.status(403).json({ error: kindRefusal }); return null; }
  const character = await callbackCharacter(ctx, key, grant.ownerSub);
  if (!character) { res.status(404).json({ error: 'character not found' }); return null; }
  const characterRefusal = grantRefusal(grant, kind, character.id);
  if (characterRefusal) { res.status(403).json({ error: characterRefusal }); return null; }
  return character;
}

/** POST /cell-image — store one bounded thumbnail for the grant's own character. */
async function ingestCellImage(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const grant = callbackGrantOf(req)!;
  const subject = String(req.query.character || req.query.subject || '').trim();
  const version = Number(req.query.version);
  const cellIndex = parseCellIndex(req.query.cell);
  if (!subject || !Number.isInteger(version) || cellIndex === null) {
    res.status(400).json({ error: 'character, integer version and cell required' });
    return;
  }
  const bytes = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.alloc(0);
  const checked = checkCellImage(bytes);
  if (!checked.ok) { res.status(400).json({ error: checked.error }); return; }
  const character = await scopedCharacter(ctx, res, grant, 'cell-image', subject);
  if (!character) return;
  const stored = await storeCellImage(ctx.pool, character.id, version, cellIndex, checked.contentType, bytes, str(req.query.filename));
  if (!stored) { res.status(404).json({ error: 'live model scorecard cell not found' }); return; }
  await purgeExpiredCellImages(ctx.pool, character.id);
  logger.info({ subject, version, cellIndex, bytes: bytes.length }, 'lora cell image ingest');
  res.json({ ok: true, subject, version, cell: cellIndex, bytes: bytes.length });
}

/**
 * The overnight loop's final callback: park an approval_required morning review, revoke the grant,
 * then close the dispatch ticket. The review must name the grant's own ticket, so a loop can never
 * complete another character's or another owner's dispatch.
 */
async function parkReview(
  ctx: AppContext, res: Response, grant: VerifiedGrant, character: CallbackCharacter, b: Record<string, unknown>,
): Promise<void> {
  const dispatchTicketId = String(b.ticket_id || '').trim();
  if (!grant.ticketId || dispatchTicketId !== grant.ticketId) { res.status(403).json({ error: 'callback_ticket_not_granted' }); return; }
  const bestVersion = Number(b.best_version);
  const summary = String(b.summary || 'Overnight improve finished.');
  const ticket = await ctx.ticketService.createTicket({
    title: `Review ${character.subject} overnight result — best v${Number.isInteger(bestVersion) ? bestVersion : '?'}`,
    ticketType: 'lora-train', description: `${summary} Open the LoRA Studio to compare versions and keep-best.`,
    status: 'approval_required', priority: 'none', labels: ['lora', 'review', character.subject], workspaceId: null,
    assignedAgentId: LORA_DIRECTOR_AGENT_ID, parentTicketId: null, externalProvider: null, externalId: null,
    externalUrl: null, ownerSub: grant.ownerSub,
    metadata: { app: 'lora', character: character.subject, characterId: character.id, action: 'review', bestVersion,
      overall: Number(b.overall) || null, dispatchTicketId },
  });
  await revokeCallbackGrant(ctx.pool, grant.id);
  const dispatchTicket = await ctx.ticketService.getTicket(dispatchTicketId);
  if (dispatchTicket?.ownerSub === grant.ownerSub
      && String((dispatchTicket.metadata as Record<string, unknown> | undefined)?.loraOvernightCharacterId || '') === character.id) {
    try { await ctx.ticketService.updateStatus(dispatchTicketId, 'complete'); } catch (error) {
      logger.error({ err: error, dispatchTicketId }, 'lora overnight dispatch ticket close failed');
    }
  }
  logger.info({ subject: character.subject, bestVersion }, 'lora overnight review ticket parked');
  res.json({ ok: true, kind: 'review', subject: character.subject, ticketId: ticket.ticketId });
}

/** kind 'training' — upsert one model version row. */
async function recordTraining(ctx: AppContext, res: Response, id: string, subject: string, version: number, b: Record<string, unknown>): Promise<void> {
  const status = ['queued', 'training', 'trained', 'scored', 'failed'].includes(String(b.status)) ? String(b.status) : 'trained';
  await ctx.pool.query(
    `INSERT INTO oshal_lora_models
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
       metrics = COALESCE(EXCLUDED.metrics, oshal_lora_models.metrics)`,
    [id, version, status, str(b.lora_path), str(b.base_model), int(b.dataset_count), int(b.network_dim),
      int(b.epochs), int(b.steps), num(b.final_loss), int(b.duration_sec), int(b.parent_version),
      str(b.ticket_id), b.metrics != null ? JSON.stringify(b.metrics) : null],
  );
  logger.info({ subject, version, status }, 'lora training ingest');
  res.json({ ok: true, kind: 'training', subject, version, status });
}

/** kind 'score' — store the scorecard, recomputing the rollup from cells when the box sent none. */
async function recordScore(ctx: AppContext, res: Response, id: string, subject: string, version: number, b: Record<string, unknown>): Promise<void> {
  const cells = Array.isArray(b.cells) ? (b.cells as ScoreCell[]) : [];
  const summary = cells.length ? summarizeScore(cells) : null;
  const overall = num(b.overall) ?? summary?.overall ?? null;
  const identityMean = num(b.identity_mean) ?? summary?.identityMean ?? null;
  const qualityMean = num(b.quality_mean) ?? summary?.qualityMean ?? null;
  const minCell = num(b.min_cell) ?? summary?.minCell ?? null;
  const weakCells = Array.isArray(b.weak_cells) ? b.weak_cells : cells.length ? computeWeakCells(cells) : [];
  await ctx.pool.query(
    `INSERT INTO oshal_lora_scores
       (character_id, version, overall, identity_mean, quality_mean, min_cell, cells, weak_cells, gallery_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (character_id, version) DO UPDATE SET
       overall = EXCLUDED.overall, identity_mean = EXCLUDED.identity_mean,
       quality_mean = EXCLUDED.quality_mean, min_cell = EXCLUDED.min_cell,
       cells = EXCLUDED.cells, weak_cells = EXCLUDED.weak_cells,
       gallery_url = COALESCE(EXCLUDED.gallery_url, oshal_lora_scores.gallery_url)`,
    [id, version, overall, identityMean, qualityMean, minCell, JSON.stringify(cells), JSON.stringify(weakCells), str(b.gallery_url)],
  );
  await ctx.pool.query(
    `UPDATE oshal_lora_models SET status = 'scored' WHERE character_id = $1 AND version = $2 AND status <> 'failed'`,
    [id, version],
  );
  logger.info({ subject, version, overall }, 'lora score ingest');
  res.json({ ok: true, kind: 'score', subject, version, overall });
}

/** POST / — route one signed JSON callback by kind, inside the grant's scope. */
async function ingestCallback(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const grant = callbackGrantOf(req)!;
  const b = callbackBody(req);
  if (!b) { res.status(415).json({ error: `a ${CALLBACK_CONTENT_TYPE} object body is required` }); return; }
  const kind = String(b.kind || '').trim();
  if (!['training', 'score', 'review', 'dataset'].includes(kind)) {
    res.status(400).json({ error: 'character and kind (training|score|review|dataset) required' });
    return;
  }
  const character = await scopedCharacter(ctx, res, grant, kind as CallbackKind, String(b.character || b.subject || '').trim());
  if (!character) return;
  if (kind === 'review') { await parkReview(ctx, res, grant, character, b); return; }
  if (kind === 'dataset') {
    // The import's last word: its grant has nothing left to report once the receipt is settled.
    if (await recordDatasetCallback(ctx, res, character, b)) await revokeCallbackGrant(ctx.pool, grant.id);
    return;
  }
  const version = Number(b.version);
  if (!Number.isInteger(version)) { res.status(400).json({ error: 'integer version required' }); return; }
  if (kind === 'training') await recordTraining(ctx, res, character.id, character.subject, version, b);
  else await recordScore(ctx, res, character.id, character.subject, version, b);
}

/**
 * @description Creates the LoRA worker mount. Every route requires the per-dispatch callback grant
 * the verifier admitted (never the fleet service secret) and runs as that grant's owner. The manifest
 * mounts this at /api/lora/ingest in the loader-sanctioned split-mountPath shape, so the URL the box
 * scripts post to is unchanged; only the dataset download moved, to POST /dataset-download/:imageId.
 * @param ctx - app context (pool, ticket service)
 * @returns Router for /api/lora/ingest.
 */
export function createLoraIngestRoutes(ctx: AppContext): Router {
  const router = Router();

  /** POST /dataset-download/:imageId — the worker downloads one staged image under its import grant. */
  router.use(createLoraDatasetWorkerRoutes(ctx, requireAdmittedGrant));

  /**
   * POST /cell-image?character=&version=&cell=&filename= — one bounded validation thumbnail as raw
   * image bytes (one small request per cell keeps a failed upload from losing the scorecard). The
   * verifier already read the body, because its hash is part of the signature.
   */
  router.post('/cell-image', requireAdmittedGrant,
    (req: Request, res: Response) => {
      ingestCellImage(ctx, req, res).catch((err) => {
        logger.error({ err }, 'lora cell image ingest failed');
        if (res.headersSent) return;
        if ((err as { code?: string })?.code === '23503') { res.status(404).json({ error: 'model run not found' }); return; }
        res.status(502).json({ error: 'cell image ingest failed' });
      });
    });

  /** POST / — a signed training result, scorecard, dataset receipt or overnight review. */
  router.post('/', requireAdmittedGrant,
    (req: Request, res: Response) => {
      ingestCallback(ctx, req, res).catch((err) => {
        logger.error({ err }, 'lora ingest failed');
        if (!res.headersSent) res.status(502).json({ error: 'lora ingest failed' });
      });
    });

  return router;
}
