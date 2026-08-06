/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Add the pure validation, identity, request-hash, and wire-shape model for Switchboard's confirmed idempotent reply outbox.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Canonicalize workspace UUIDs before hashing so database normalization cannot break an exact replay.
 */

import * as crypto from 'crypto';

/** Maximum exact reply body retained by the durable outbox. */
export const MAX_REPLY_BODY = 20_000;

/** Supported first-slice delivery provider. The source store is Gmail-fed. */
export const REPLY_PROVIDER = 'google';

/** Durable delivery states exposed by the status endpoint. */
export type ReplyStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain';

/** A validated request that is safe to bind into an owner-scoped source lookup. */
export interface ValidReplyRequest {
  idempotencyKey: string;
  sourceMessageId: string;
  body: string;
  workspaceId: string | null;
}

/** Validation result used by the HTTP route without throwing on caller input. */
export interface ReplyValidationResult {
  value?: ValidReplyRequest;
  error?: string;
}

/** Stable cleartext inputs hashed before an outbox insert. */
export interface ReplyFingerprintInput extends ValidReplyRequest {
  provider: string;
  recipient: string;
  subject: string;
}

/** Database fields safe to expose to the owning caller. Content stays encrypted. */
export interface ReplyStatusView {
  replyId: string;
  status: ReplyStatus;
  provider: string;
  attemptCount: number;
  providerMessageId: string | null;
  deliveryError: string | null;
  createdAt: unknown;
  updatedAt: unknown;
  sentAt: unknown;
}

/** Canonical UUID shape for workspace and outbox identifiers. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** An idempotency key is opaque printable data with no whitespace or header controls. */
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{16,128}$/;

/** Gmail provider ids are URL-safe opaque tokens, never SQL or URL fragments. */
const MESSAGE_ID_RE = /^[A-Za-z0-9_-]{1,512}$/;

/** Basic mailbox syntax used only after the value comes from the caller-owned inbox row. */
const EMAIL_RE = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;

/**
 * @description Validate the explicit reply payload and mandatory idempotency key while preserving
 * the exact body bytes that the caller reviewed. Trimming is used only to reject empty content.
 * @param body - Untrusted request body.
 * @param idempotencyKey - Value of the Idempotency-Key request header.
 * @returns A normalized request or one fail-closed validation message.
 */
export function validateReplyRequest(body: unknown, idempotencyKey: unknown): ReplyValidationResult {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
  if (!IDEMPOTENCY_RE.test(key)) return { error: 'Idempotency-Key must be 16-128 URL-safe characters.' };
  const sourceMessageId = typeof input.sourceMessageId === 'string' ? input.sourceMessageId.trim() : '';
  if (!MESSAGE_ID_RE.test(sourceMessageId)) return { error: 'sourceMessageId is required and must be a provider message id.' };
  if (typeof input.body !== 'string' || !input.body.trim()) return { error: 'body is required.' };
  if (input.body.length > MAX_REPLY_BODY) return { error: `body exceeds ${MAX_REPLY_BODY} characters.` };
  const workspaceId = input.workspaceId == null || input.workspaceId === '' ? null : String(input.workspaceId).toLowerCase();
  if (workspaceId && !UUID_RE.test(workspaceId)) return { error: 'workspaceId must be a UUID.' };
  return { value: { idempotencyKey: key, sourceMessageId, body: input.body, workspaceId } };
}

/**
 * @description Extract one mailbox from an RFC-style From header. The inbox row is authoritative;
 * caller-supplied recipients are deliberately unsupported by the reply boundary.
 * @param from - Provider From header stored for the owning user.
 * @returns A lowercase mailbox, or null when the source cannot safely be replied to.
 */
export function emailAddressOf(from: unknown): string | null {
  if (typeof from !== 'string' || /[\r\n]/.test(from)) return null;
  const bracketed = from.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/);
  const candidate = (bracketed?.[1] || from.trim()).toLowerCase();
  return EMAIL_RE.test(candidate) ? candidate : null;
}

/**
 * @description Form a reply subject without stacking repeated Re prefixes.
 * @param sourceSubject - Subject from the caller-owned source message.
 * @returns A bounded subject suitable for the kernel's fenced MIME builder.
 */
export function replySubject(sourceSubject: unknown): string {
  const clean = String(sourceSubject || '(no subject)').replace(/[\r\n]+/g, ' ').trim() || '(no subject)';
  return (/^re\s*:/i.test(clean) ? clean : `Re: ${clean}`).slice(0, 998);
}

/**
 * @description Hash the full semantic send request so reuse of one idempotency key with different
 * content is detected without retaining any searchable plaintext reply data.
 * @param input - Server-resolved provider, recipient, subject, source, and exact approved body.
 * @returns Lowercase SHA-256 request digest.
 */
export function replyRequestHash(input: ReplyFingerprintInput): string {
  const canonical = JSON.stringify({
    provider: input.provider,
    recipient: input.recipient,
    subject: input.subject,
    sourceMessageId: input.sourceMessageId,
    body: input.body,
    workspaceId: input.workspaceId,
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * @description Identify a valid durable status before returning database data to a caller.
 * @param status - Untrusted database value.
 * @returns True only for a state in the outbox state machine.
 */
export function isReplyStatus(status: unknown): status is ReplyStatus {
  return ['pending', 'sending', 'sent', 'failed', 'uncertain'].includes(String(status));
}

/**
 * @description Map one owner-scoped database row to a content-free status response.
 * @param row - Outbox row returned by PostgreSQL.
 * @returns Public status fields; encrypted recipient, subject, body, and source id are omitted.
 */
export function mapReplyStatus(row: Record<string, unknown>): ReplyStatusView {
  if (!isReplyStatus(row.status)) throw new Error('Invalid reply outbox status.');
  return {
    replyId: String(row.reply_id),
    status: row.status,
    provider: String(row.provider),
    attemptCount: Number(row.attempt_count || 0),
    providerMessageId: row.provider_message_id ? String(row.provider_message_id) : null,
    deliveryError: row.delivery_error ? String(row.delivery_error) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at ?? null,
  };
}

/**
 * @description Choose a terminal failure state after an executor error. Once a provider call began,
 * the result is uncertain and MUST NOT be retried automatically because the provider has no stable
 * idempotency key. Pre-provider failures are known failures and equally require a new confirmation.
 * @param providerAttempted - Whether execution crossed into the external sender.
 * @returns Terminal state and a non-sensitive operator-facing error code.
 */
export function terminalFailure(providerAttempted: boolean): { status: 'failed' | 'uncertain'; error: string } {
  return providerAttempted
    ? { status: 'uncertain', error: 'provider_result_unknown_manual_review_required' }
    : { status: 'failed', error: 'delivery_not_attempted' };
}
