/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Add a confirmed, encrypted, owner-scoped Gmail reply outbox with request idempotency, atomic worker claims, and fail-closed ambiguous-delivery handling.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Make replay independent of source-row retention and verify every ciphertext field against the stored semantic digest before delivery.
 */

import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { sendGmail } from '@/app/routes/email-routes';
import { confirmationRequiredPayload, hasExplicitWriteConfirmation } from '@/shared/security/explicit-write-confirmation';
import { buildOwnerRlsPolicyStatements, runRuntimeSchemaBootstrap } from '@/shared/services/database';
import { runWithSystemIdentity } from '@/shared/services/database/request-identity';
import { decryptField, encryptField, isEncrypted } from '@/features/personal-data';
import {
  REPLY_PROVIDER, emailAddressOf, mapReplyStatus, replyRequestHash, replySubject,
  terminalFailure, validateReplyRequest, type ValidReplyRequest,
} from './switchboard-reply-outbox-model';

const logger = createChildLogger({ module: 'switchboard-reply-outbox-routes' });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAIM_STALE_MINUTES = 10;
const EXECUTOR_INTERVAL_MS = 5_000;

interface ReplySourceRow { from_addr: string; subject: string; category: string }
interface EncryptedReply {
  recipient: string;
  subject: string;
  body: string;
  sourceMessageId: string;
}
interface ClaimedReply extends Record<string, unknown> {
  reply_id: string;
  user_sub: string;
  provider: string;
  request_hash: string;
  source_message_id_ciphertext: string;
  recipient_ciphertext: string;
  subject_ciphertext: string;
  body_ciphertext: string;
  workspace_id: string | null;
  claim_token: string;
}

/** The signed-in user's OIDC subject, or null if unauthenticated. */
function callerSub(req: Request): string | null {
  const user = (req as { oidc?: { user?: { sub?: string } } }).oidc?.user;
  return user?.sub ? String(user.sub) : null;
}

/** Encrypt one required outbound field under the owner-derived vault key. */
function encryptRequired(ownerSub: string, value: string): string {
  const encrypted = encryptField(ownerSub, value);
  if (!encrypted || !isEncrypted(encrypted)) throw new Error('Reply encryption failed closed.');
  return encrypted;
}

/** Decrypt one required outbound field and refuse corrupt/wrong-key envelopes. */
function decryptRequired(ownerSub: string, stored: string): string {
  if (!isEncrypted(stored)) throw new Error('Reply ciphertext envelope is missing.');
  const plain = decryptField(ownerSub, stored);
  if (!plain || isEncrypted(plain)) throw new Error('Reply decryption failed closed.');
  return plain;
}

/**
 * @description Ensure the durable outbox and its unique owner/idempotency boundary. All reply
 * content is encrypted; owner FORCE RLS is also enforced by the checked-in migration.
 * @param pool - GUC-stamped PostgreSQL pool.
 * @returns Resolves after create/validate-only schema bootstrap.
 */
export async function ensureReplyOutboxSchema(pool: AppContext['pool']): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'switchboard reply outbox',
    statements: [
      `CREATE TABLE IF NOT EXISTS oshal_switchboard_reply_outbox (
        reply_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_sub TEXT NOT NULL,
        idempotency_key TEXT NOT NULL, request_hash CHAR(64) NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('google')),
        source_message_id_ciphertext TEXT NOT NULL, recipient_ciphertext TEXT NOT NULL,
        subject_ciphertext TEXT NOT NULL, body_ciphertext TEXT NOT NULL, workspace_id UUID,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','uncertain')),
        attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0), claim_token UUID,
        claimed_at TIMESTAMPTZ, provider_message_id TEXT, delivery_error TEXT,
        sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (user_sub, idempotency_key)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sb_reply_pending ON oshal_switchboard_reply_outbox (created_at, reply_id) WHERE status = 'pending'`,
      `CREATE INDEX IF NOT EXISTS idx_sb_reply_owner_time ON oshal_switchboard_reply_outbox (user_sub, created_at DESC)`,
      ...buildOwnerRlsPolicyStatements('oshal_switchboard_reply_outbox', 'user_sub'),
    ],
    requirements: [{
      table: 'oshal_switchboard_reply_outbox',
      columns: ['reply_id', 'user_sub', 'idempotency_key', 'request_hash', 'provider', 'body_ciphertext', 'status', 'claim_token'],
    }],
  });
}

/** Load one caller-owned, replyable Gmail source row. */
async function loadReplySource(pool: AppContext['pool'], sub: string, messageId: string): Promise<ReplySourceRow | null> {
  const result = await pool.query(
    `SELECT from_addr, subject, category FROM oshal_inbox_messages
      WHERE user_sub = $1 AND msg_id = $2 AND category NOT IN ('social','promotions') LIMIT 1`,
    [sub, messageId],
  );
  return (result.rows[0] as ReplySourceRow | undefined) || null;
}

/** Read an existing owner/key row before consulting the mutable source inbox. */
async function loadExistingReply(pool: AppContext['pool'], sub: string, key: string): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `SELECT reply_id,status,provider,attempt_count,provider_message_id,delivery_error,
            created_at,updated_at,sent_at,request_hash,workspace_id,source_message_id_ciphertext,
            recipient_ciphertext,subject_ciphertext,body_ciphertext
       FROM oshal_switchboard_reply_outbox WHERE user_sub=$1 AND idempotency_key=$2`,
    [sub, key],
  );
  return (result.rows[0] as Record<string, unknown> | undefined) || null;
}

/** Verify stored ciphertext against its digest, then compare an incoming idempotent replay. */
function matchesExistingReply(sub: string, request: ValidReplyRequest, row: Record<string, unknown>): boolean {
  const provider = String(row.provider);
  const recipient = decryptRequired(sub, String(row.recipient_ciphertext));
  const subject = decryptRequired(sub, String(row.subject_ciphertext));
  const sourceMessageId = decryptRequired(sub, String(row.source_message_id_ciphertext));
  const body = decryptRequired(sub, String(row.body_ciphertext));
  const workspaceId = row.workspace_id ? String(row.workspace_id).toLowerCase() : null;
  const storedHash = replyRequestHash({ ...request, provider, recipient, subject, sourceMessageId, body, workspaceId });
  if (storedHash !== String(row.request_hash)) throw new Error('Reply outbox integrity check failed.');
  return replyRequestHash({ ...request, provider, recipient, subject }) === storedHash;
}

/** Verify a scoped workspace belongs to the caller and contains their Google connection. */
async function workspaceAllowsReply(pool: AppContext['pool'], sub: string, workspaceId: string | null): Promise<boolean> {
  if (!workspaceId) return true;
  const result = await pool.query(
    `SELECT 1 FROM oshal_switchboard_workspace_accounts wa
       JOIN oshal_connections c ON c.connection_id = wa.connection_id AND c.user_sub = wa.user_sub
      WHERE wa.user_sub = $1 AND wa.workspace_id = $2 AND c.provider IN ('google','gmail') LIMIT 1`,
    [sub, workspaceId],
  );
  return Boolean(result.rowCount);
}

/** Encrypt the exact approved reply and server-resolved source identity. */
function encryptedReply(sub: string, request: ValidReplyRequest, recipient: string, subject: string): EncryptedReply {
  return {
    recipient: encryptRequired(sub, recipient),
    subject: encryptRequired(sub, subject),
    body: encryptRequired(sub, request.body),
    sourceMessageId: encryptRequired(sub, request.sourceMessageId),
  };
}

/** Insert once, or return the existing row for a same-key replay. */
async function insertReply(
  pool: AppContext['pool'], sub: string, request: ValidReplyRequest, requestHash: string, encrypted: EncryptedReply,
): Promise<{ row: Record<string, unknown>; inserted: boolean }> {
  const result = await pool.query(
    `INSERT INTO oshal_switchboard_reply_outbox
       (user_sub,idempotency_key,request_hash,provider,source_message_id_ciphertext,
        recipient_ciphertext,subject_ciphertext,body_ciphertext,workspace_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (user_sub,idempotency_key) DO NOTHING
     RETURNING reply_id,status,provider,attempt_count,provider_message_id,delivery_error,created_at,updated_at,sent_at,request_hash`,
    [sub, request.idempotencyKey, requestHash, REPLY_PROVIDER, encrypted.sourceMessageId,
      encrypted.recipient, encrypted.subject, encrypted.body, request.workspaceId],
  );
  if (result.rows[0]) return { row: result.rows[0] as Record<string, unknown>, inserted: true };
  const existing = await pool.query(
    `SELECT reply_id,status,provider,attempt_count,provider_message_id,delivery_error,
            created_at,updated_at,sent_at,request_hash
       FROM oshal_switchboard_reply_outbox WHERE user_sub=$1 AND idempotency_key=$2`,
    [sub, request.idempotencyKey],
  );
  if (!existing.rows[0]) throw new Error('Idempotency row was not visible after conflict.');
  return { row: existing.rows[0] as Record<string, unknown>, inserted: false };
}

/** Mark expired in-flight work uncertain before claiming; blind resend is never safe for email. */
async function quarantineStaleClaims(pool: AppContext['pool']): Promise<void> {
  await pool.query(
    `UPDATE oshal_switchboard_reply_outbox
        SET status='uncertain', claim_token=NULL, delivery_error='claim_expired_manual_review_required', updated_at=now()
      WHERE status='sending' AND claimed_at < now() - ($1 || ' minutes')::interval`,
    [String(CLAIM_STALE_MINUTES)],
  );
}

/** Atomically claim one pending row across any number of executor processes. */
async function claimNextReply(pool: AppContext['pool']): Promise<ClaimedReply | null> {
  const result = await pool.query(
    `WITH candidate AS (
       SELECT reply_id FROM oshal_switchboard_reply_outbox WHERE status='pending'
        ORDER BY created_at, reply_id FOR UPDATE SKIP LOCKED LIMIT 1
     ) UPDATE oshal_switchboard_reply_outbox o
          SET status='sending', claim_token=gen_random_uuid(), claimed_at=now(),
              attempt_count=attempt_count+1, updated_at=now()
         FROM candidate c WHERE o.reply_id=c.reply_id
     RETURNING o.reply_id,o.user_sub,o.provider,o.request_hash,o.workspace_id,
               o.source_message_id_ciphertext,o.recipient_ciphertext,o.subject_ciphertext,
               o.body_ciphertext,o.claim_token`,
  );
  return (result.rows[0] as ClaimedReply | undefined) || null;
}

/** Settle one claim only when its immutable claim token still owns the row. */
async function settleClaim(
  pool: AppContext['pool'], claim: ClaimedReply, state: 'sent' | 'failed' | 'uncertain', providerId: string | null, error: string | null,
): Promise<void> {
  const result = await pool.query(
    `UPDATE oshal_switchboard_reply_outbox
        SET status=$3, provider_message_id=$4, delivery_error=$5,
            sent_at=CASE WHEN $3='sent' THEN now() ELSE sent_at END, claim_token=NULL, updated_at=now()
      WHERE reply_id=$1 AND claim_token=$2 AND status='sending'`,
    [claim.reply_id, claim.claim_token, state, providerId, error],
  );
  if (result.rowCount !== 1) logger.error({ replyId: claim.reply_id }, 'Reply claim settlement lost ownership');
}

/** Deliver one already-claimed row through the kernel's single fenced Gmail sender. */
async function deliverClaim(ctx: AppContext, claim: ClaimedReply): Promise<void> {
  let providerAttempted = false;
  try {
    if (claim.provider !== REPLY_PROVIDER) throw new Error('Unsupported reply provider.');
    const sourceMessageId = decryptRequired(claim.user_sub, claim.source_message_id_ciphertext);
    const recipient = decryptRequired(claim.user_sub, claim.recipient_ciphertext);
    const subject = decryptRequired(claim.user_sub, claim.subject_ciphertext);
    const body = decryptRequired(claim.user_sub, claim.body_ciphertext);
    const integrityHash = replyRequestHash({
      idempotencyKey: '', sourceMessageId, body, workspaceId: claim.workspace_id ? String(claim.workspace_id).toLowerCase() : null,
      provider: claim.provider, recipient, subject,
    });
    if (integrityHash !== claim.request_hash) throw new Error('Reply outbox integrity check failed.');
    const token = await getValidAccessToken(ctx.pool, claim.user_sub, REPLY_PROVIDER);
    if (!token) throw new Error('Google send connection unavailable.');
    providerAttempted = true;
    const sent = await sendGmail(token, { to: recipient, subject, body });
    await settleClaim(ctx.pool, claim, 'sent', sent.id || null, null);
    logger.info({ replyId: claim.reply_id, provider: claim.provider }, 'Confirmed reply delivered');
  } catch (err) {
    const terminal = terminalFailure(providerAttempted);
    await settleClaim(ctx.pool, claim, terminal.status, null, terminal.error);
    logger.error({ err, replyId: claim.reply_id, state: terminal.status }, 'Confirmed reply delivery failed');
  }
}

/**
 * @description Run one bounded executor batch under trusted system identity. Atomic SKIP LOCKED
 * claims prevent concurrent delivery; ambiguous provider outcomes become terminal uncertain rows.
 * @param ctx - App context for the outbox, token broker, and kernel email sender.
 * @param limit - Maximum rows delivered in this tick.
 * @returns Number of rows claimed during the batch.
 */
export async function runReplyOutboxBatch(ctx: AppContext, limit = 10): Promise<number> {
  return runWithSystemIdentity(async () => {
    await quarantineStaleClaims(ctx.pool);
    let count = 0;
    while (count < Math.max(1, Math.min(limit, 25))) {
      const claim = await claimNextReply(ctx.pool);
      if (!claim) break;
      await deliverClaim(ctx, claim);
      count += 1;
    }
    return count;
  });
}

let executorStarted = false;

/** True unless an operator explicitly disables confirmed-reply delivery. */
function executorEnabled(): boolean {
  return !['0', 'false', 'no', 'off'].includes(String(process.env.SWITCHBOARD_REPLY_EXECUTOR || 'true').trim().toLowerCase());
}

/**
 * @description Start one unref'd reply-outbox loop. Every queued row already carries the caller's
 * explicit confirmation, so delivery is enabled by default and can be disabled for maintenance.
 * @param ctx - App context used by each bounded executor tick.
 * @returns Nothing; the process owns one shared interval.
 */
export function startReplyOutboxExecutor(ctx: AppContext): void {
  if (executorStarted || !executorEnabled()) return;
  executorStarted = true;
  const tick = (): void => { runReplyOutboxBatch(ctx).catch((err) => logger.error({ err }, 'Reply outbox tick failed')); };
  setTimeout(tick, 0);
  const timer = setInterval(tick, EXECUTOR_INTERVAL_MS);
  timer.unref?.();
}

/** Register the confirm-gated enqueue operation. */
function registerEnqueue(router: Router, ctx: AppContext): void {
  router.post('/outbox', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    if (!hasExplicitWriteConfirmation(req.body)) {
      res.status(428).json(confirmationRequiredPayload('no-send', 'Queueing this exact email reply'));
      return;
    }
    const checked = validateReplyRequest(req.body, req.get('Idempotency-Key'));
    if (!checked.value) { res.status(400).json({ error: 'invalid_reply', message: checked.error }); return; }
    try {
      const existing = await loadExistingReply(ctx.pool, sub, checked.value.idempotencyKey);
      if (existing) {
        if (!matchesExistingReply(sub, checked.value, existing)) {
          res.status(409).json({ error: 'idempotency_conflict', message: 'This Idempotency-Key already names a different reply.' });
          return;
        }
        res.status(200).json({ reply: mapReplyStatus(existing), deduplicated: true });
        return;
      }
      const source = await loadReplySource(ctx.pool, sub, checked.value.sourceMessageId);
      if (!source) { res.status(404).json({ error: 'reply_source_not_found' }); return; }
      const recipient = emailAddressOf(source.from_addr);
      if (!recipient) { res.status(409).json({ error: 'source_not_replyable' }); return; }
      if (!(await workspaceAllowsReply(ctx.pool, sub, checked.value.workspaceId))) {
        res.status(403).json({ error: 'workspace_mismatch' }); return;
      }
      const subject = replySubject(source.subject);
      const hash = replyRequestHash({ ...checked.value, provider: REPLY_PROVIDER, recipient, subject });
      const stored = await insertReply(ctx.pool, sub, checked.value, hash, encryptedReply(sub, checked.value, recipient, subject));
      if (String(stored.row.request_hash) !== hash) {
        res.status(409).json({ error: 'idempotency_conflict', message: 'This Idempotency-Key already names a different reply.' });
        return;
      }
      res.status(stored.inserted ? 202 : 200).json({ reply: mapReplyStatus(stored.row), deduplicated: !stored.inserted });
    } catch (err) {
      logger.error({ err }, 'Reply enqueue failed');
      const configuration = /SESSION_SECRET|encryption failed/i.test((err as Error).message);
      const integrity = /integrity check failed|ciphertext envelope/i.test((err as Error).message);
      res.status(configuration ? 503 : integrity ? 500 : 502).json({
        error: configuration ? 'reply_storage_unavailable' : integrity ? 'reply_storage_integrity_failed' : 'reply_enqueue_failed',
      });
    }
  });
}

/** Register owner-scoped list and single-status reads. */
function registerStatusReads(router: Router, ctx: AppContext): void {
  router.get('/outbox', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const result = await ctx.pool.query(
        `SELECT reply_id,status,provider,attempt_count,provider_message_id,delivery_error,created_at,updated_at,sent_at
           FROM oshal_switchboard_reply_outbox WHERE user_sub=$1 ORDER BY created_at DESC LIMIT 50`, [sub],
      );
      res.json({ replies: result.rows.map((row) => mapReplyStatus(row as Record<string, unknown>)) });
    } catch (err) { logger.error({ err }, 'Reply outbox list failed'); res.status(502).json({ error: 'reply_status_failed' }); }
  });
  router.get('/outbox/:id', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    if (!UUID_RE.test(String(req.params.id))) { res.status(404).json({ error: 'reply_not_found' }); return; }
    try {
      const result = await ctx.pool.query(
        `SELECT reply_id,status,provider,attempt_count,provider_message_id,delivery_error,created_at,updated_at,sent_at
           FROM oshal_switchboard_reply_outbox WHERE user_sub=$1 AND reply_id=$2`, [sub, req.params.id],
      );
      if (!result.rows[0]) { res.status(404).json({ error: 'reply_not_found' }); return; }
      res.json({ reply: mapReplyStatus(result.rows[0] as Record<string, unknown>) });
    } catch (err) { logger.error({ err }, 'Reply outbox read failed'); res.status(502).json({ error: 'reply_status_failed' }); }
  });
}

/**
 * @description Build the Switchboard reply-outbox router. Only caller-confirmed, caller-owned
 * ingested Gmail messages can enter it; arbitrary recipients and silent retries are impossible.
 * @param ctx - App context for database, token broker, and delivery.
 * @returns Router mounted under /api/switchboard/replies by the parent app route.
 */
export function createReplyOutboxRoutes(ctx: AppContext): Router {
  const router = Router();
  ensureReplyOutboxSchema(ctx.pool)
    .then(() => startReplyOutboxExecutor(ctx))
    .catch((err) => logger.error({ err }, 'Failed to ensure switchboard reply outbox schema'));
  registerEnqueue(router, ctx);
  registerStatusReads(router, ctx);
  return router;
}
