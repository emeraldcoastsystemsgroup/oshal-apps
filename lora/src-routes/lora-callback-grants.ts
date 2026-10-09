/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Replace the static fleet service secret on the GPU worker's callbacks with package-owned per-dispatch grants. Every dispatch mints one grant bound to one owner, one character, one ticket and the callback kinds that job may send; it expires on the job's own clock, can be revoked, and every request is signed with a fresh nonce over its method, path, timestamp and body hash, so a captured request cannot be replayed and a stolen grant cannot reach another owner's or character's rows.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify worker callbacks as the kernel's signed-package-callbacks verifier instead of route middleware. Under ADR-149 enforce the application-authorization layer refused every worker request with authorization_identity_required before this package's grant check could run, because a machine caller has no browser or PAT identity. The grant now records its owner's exact issuer (migration 106), the verifier returns that stored (subject, issuer) pair for the kernel to refresh and authorize, and the handler reads the grant the verifier admitted rather than verifying a second time, which would also have spent the nonce twice. A grant with no recorded issuer (minted by 1.6.0) is refused.
 */

/**
 * LoRA worker callback grants.
 *
 * The GPU worker reports results to the public `/api/lora/ingest` mount. Until 1.6.0 that mount
 * trusted the fleet-wide `SWARM_SERVICE_SECRET` plus an owner assertion: one static value, valid
 * forever, for every owner and every character on the box. A grant narrows that to one job.
 *
 * The contract is shared with the box scripts in the framework repo
 * (`scripts/comfyui-edge/lora_callback.py`) and with the PowerShell dataset command built in
 * `lora-train-dispatch.ts`, so it is written down once here:
 *  - The worker receives `<grant id>.<secret>` in the `OSHAL_LORA_CALLBACK_GRANT` environment
 *    variable, set by a PowerShell assignment at the head of its shell task. It is never a box
 *    script argument, so it does not appear in a Python process listing. The shell-task envelope
 *    does carry it, which is the exposure the core completion-callback capability also accepts; the
 *    grant is short-lived and scoped, which is the point.
 *  - Signing key = SHA-256 of `oshal-lora-callback-grant-v1:` + secret. The controller stores only
 *    that derived key, never the secret. Whoever can read the key from the database can already
 *    write the rows a callback writes, so keeping it there does not widen what a leak exposes.
 *  - Each request sends `x-lora-callback-grant`, `x-lora-callback-owner` (base64url owner sub),
 *    `x-lora-callback-timestamp` (Unix seconds), `x-lora-callback-nonce` (16-64 URL-safe chars) and
 *    `x-lora-callback-signature` = hex HMAC-SHA256(key, METHOD|path?query|timestamp|nonce|hex
 *    SHA-256(body)). The path is the request target exactly as sent, including the query string.
 *  - JSON callbacks use `application/vnd.oshal.lora-callback+json`, a type the controller's global
 *    JSON parser leaves alone, so the route hashes the exact bytes that were signed.
 *  - Every worker request is a POST: the kernel's signed-callback rail admits nothing else. The
 *    staged dataset image is downloaded with an empty signed POST.
 *
 * Verification is the package half of the kernel's `signed-package-callbacks` contract
 * (`createLoraCallbackVerifier` in lora-ingest-routes.ts). It runs under the asserted owner's
 * non-operator identity, so forced RLS hides every other owner's grant: presenting another owner's
 * grant is indistinguishable from an unknown one. On success it returns only the grant's stored
 * owner subject and issuer; the kernel then refreshes that principal, requires the catalog permission
 * bound to the route, and runs the handler as that owner.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { createChildLogger } from '@/shared/logger';
import { runWithRequestIdentity } from '@/shared/services/database/request-identity';
import type { AppContext } from '@/app/composition/app-context';
import { dispatchBoxCommand, type DispatchResult } from './lora-train-dispatch';
import { isValidIssuer, verifiedIssuer } from './lora-authorization';

const logger = createChildLogger({ module: 'lora-callback-grants' });

/** Environment variable the worker reads its grant from. */
export const CALLBACK_GRANT_ENV = 'OSHAL_LORA_CALLBACK_GRANT';
/** Media type of a signed JSON callback; the global JSON parser does not consume it. */
export const CALLBACK_CONTENT_TYPE = 'application/vnd.oshal.lora-callback+json';
/** Largest signed JSON callback body the ingest route reads. */
export const MAX_CALLBACK_BODY_BYTES = 256 * 1024;
/** Request headers of the callback contract. */
export const CALLBACK_HEADERS = {
  grant: 'x-lora-callback-grant',
  owner: 'x-lora-callback-owner',
  timestamp: 'x-lora-callback-timestamp',
  nonce: 'x-lora-callback-nonce',
  signature: 'x-lora-callback-signature',
} as const;

const KEY_DOMAIN = 'oshal-lora-callback-grant-v1:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;
const MAX_OWNER_BYTES = 512;
const MAX_GRANT_HOURS = 96;

/** Clamp an integer environment setting into a closed range, falling back when unset or invalid. */
function boundedSetting(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(String(raw ?? ''), 10);
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Hours a one-shot job's grant lives, covering queue wait while the worker is offline (LORA_CALLBACK_GRANT_TTL_HOURS). */
export const CALLBACK_GRANT_TTL_HOURS = boundedSetting(process.env.LORA_CALLBACK_GRANT_TTL_HOURS, 12, 1, 72);
/** Allowed distance between the worker's timestamp and the controller clock (LORA_CALLBACK_SKEW_SECONDS). */
export const CALLBACK_SKEW_SECONDS = boundedSetting(process.env.LORA_CALLBACK_SKEW_SECONDS, 300, 30, 900);

/** What a box job was dispatched to do; it decides which callbacks its grant may send. */
export type DispatchKind = 'train' | 'validate' | 'improve' | 'overnight' | 'dataset-import';
/** One callback a worker may send to the ingest mount. */
export type CallbackKind = 'training' | 'score' | 'cell-image' | 'review' | 'dataset' | 'dataset-download';

const KINDS_BY_DISPATCH: Record<DispatchKind, readonly CallbackKind[]> = {
  train: ['training'],
  validate: ['score', 'cell-image'],
  improve: ['training'],
  overnight: ['training', 'score', 'cell-image', 'review'],
  'dataset-import': ['dataset-download', 'dataset'],
};

/** The binding one dispatch is minted with. */
export interface GrantScope {
  characterId: string;
  ownerSub: string;
  /** The owner's verified issuer. Omitted by a console dispatch, which takes it from the kernel's actor. */
  ownerIssuer?: string;
  ticketId: string;
  dispatchKind: DispatchKind;
  /** Lifetime; defaults to CALLBACK_GRANT_TTL_HOURS and is capped at MAX_GRANT_HOURS. */
  ttlHours?: number;
}

/** A freshly minted grant; `token` is the only copy of the secret and goes to the worker once. */
export interface CallbackGrant { grantId: string; token: string }

/** A grant whose request signature, lifetime and nonce all verified. */
export interface VerifiedGrant {
  id: string;
  characterId: string;
  ownerSub: string;
  ownerIssuer: string;
  ticketId: string | null;
  callbackKinds: string[];
}

/** Parsed callback headers, before any database work. */
interface CallbackHeaders { grantId: string; ownerSub: string; timestamp: number; nonce: string; signature: string }

/** The verifier's verdict; the refusal reason is logged, the kernel answers every refusal alike. */
export type CallbackVerification = { ok: true; grant: VerifiedGrant } | { ok: false; error: string };

/** Grants the verifier admitted, keyed by the request object itself so no header can forge one. */
const admitted = new WeakMap<Request, VerifiedGrant>();

/**
 * @description Derive a grant's HMAC key from its secret. The box derives the same key, so the
 * secret itself never needs to be stored.
 * @param secret - The URL-safe secret half of the worker token.
 * @returns The 32-byte key.
 */
export function callbackSigningKey(secret: string): Buffer {
  return createHash('sha256').update(KEY_DOMAIN + secret, 'utf8').digest();
}

/**
 * @description The exact string a callback signature covers.
 * @param method - HTTP method.
 * @param target - Request path including any query string, exactly as sent.
 * @param timestamp - Unix seconds the worker signed at.
 * @param nonce - The request's single-use nonce.
 * @param body - The exact request body bytes (empty for a GET).
 * @returns `METHOD|target|timestamp|nonce|sha256(body)`.
 */
export function canonicalCallback(method: string, target: string, timestamp: number, nonce: string, body: Buffer): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return `${method.toUpperCase()}|${target}|${timestamp}|${nonce}|${bodyHash}`;
}

/**
 * @description Idempotent DDL for the grant and nonce tables, identical in shape to migration 105
 * so the lazy runtime bootstrap and the install migration cannot drift apart.
 * @returns Statements in dependency order.
 */
export function callbackGrantSchemaStatements(): string[] {
  const viewer = `(current_setting('oshal.current_sub', true) = %OWNER% OR current_setting('oshal.is_operator', true) = 'on')`;
  const grantOwner = viewer.replace('%OWNER%', 'oshal_lora_callback_grants.owner_sub');
  const nonceOwner = `EXISTS (SELECT 1 FROM oshal_lora_callback_grants g WHERE g.id = oshal_lora_callback_nonces.grant_id AND ${viewer.replace('%OWNER%', 'g.owner_sub')})`;
  return [
    `CREATE TABLE IF NOT EXISTS oshal_lora_callback_grants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,
        owner_sub TEXT NOT NULL, ticket_id TEXT,
        dispatch_kind TEXT NOT NULL CHECK (dispatch_kind IN ('train', 'validate', 'improve', 'overnight', 'dataset-import')),
        callback_kinds TEXT[] NOT NULL CHECK (cardinality(callback_kinds) > 0),
        signing_key TEXT NOT NULL CHECK (signing_key ~ '^[0-9a-f]{64}$'),
        expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK (expires_at > created_at))`,
    'CREATE INDEX IF NOT EXISTS idx_lora_callback_grants_character ON oshal_lora_callback_grants(character_id, expires_at)',
    'ALTER TABLE oshal_lora_callback_grants ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE oshal_lora_callback_grants FORCE ROW LEVEL SECURITY',
    'DROP POLICY IF EXISTS oshal_lora_callback_grants_owner_policy ON oshal_lora_callback_grants',
    `CREATE POLICY oshal_lora_callback_grants_owner_policy ON oshal_lora_callback_grants USING (${grantOwner})
       WITH CHECK (${grantOwner} AND EXISTS (SELECT 1 FROM oshal_lora_characters c
         WHERE c.id = oshal_lora_callback_grants.character_id AND c.owner_sub = oshal_lora_callback_grants.owner_sub))`,
    `CREATE TABLE IF NOT EXISTS oshal_lora_callback_nonces (
        grant_id UUID NOT NULL REFERENCES oshal_lora_callback_grants(id) ON DELETE CASCADE,
        nonce TEXT NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{16,64}$'),
        seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (grant_id, nonce))`,
    'ALTER TABLE oshal_lora_callback_nonces ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE oshal_lora_callback_nonces FORCE ROW LEVEL SECURITY',
    'DROP POLICY IF EXISTS oshal_lora_callback_nonces_owner_policy ON oshal_lora_callback_nonces',
    `CREATE POLICY oshal_lora_callback_nonces_owner_policy ON oshal_lora_callback_nonces USING (${nonceOwner}) WITH CHECK (${nonceOwner})`,
  ];
}

/**
 * @description Idempotent DDL identical in shape to migration 106: the issuer half of each owner
 * identity a worker callback can run as. A grant records its owner's issuer; a character records the
 * issuer of the owner who enabled autonomous mode, which is the identity the nightly schedule mints
 * that character's grants for. Both stay nullable for rows written before 1.7.0, and a grant without
 * one is refused rather than guessed.
 * @returns Statements to run after the grant tables exist.
 */
export function callbackIdentitySchemaStatements(): string[] {
  return [
    `ALTER TABLE oshal_lora_callback_grants ADD COLUMN IF NOT EXISTS owner_issuer TEXT
       CHECK (owner_issuer IS NULL OR length(owner_issuer) BETWEEN 1 AND 2048)`,
    `ALTER TABLE oshal_lora_characters ADD COLUMN IF NOT EXISTS autonomous_issuer TEXT
       CHECK (autonomous_issuer IS NULL OR length(autonomous_issuer) BETWEEN 1 AND 2048)`,
  ];
}

/** Runtime-bootstrap requirement rows for both grant tables. */
export const CALLBACK_GRANT_REQUIREMENTS = [
  { table: 'oshal_lora_callback_grants', columns: ['id', 'character_id', 'owner_sub', 'owner_issuer', 'ticket_id', 'dispatch_kind', 'callback_kinds', 'signing_key', 'expires_at', 'revoked_at', 'created_at'] },
  { table: 'oshal_lora_callback_nonces', columns: ['grant_id', 'nonce', 'seen_at'] },
];

/** Grant lifetime in whole seconds, bounded to (0, MAX_GRANT_HOURS]. */
function grantSeconds(ttlHours: number | undefined): number {
  const hours = Number.isFinite(ttlHours) && Number(ttlHours) > 0 ? Number(ttlHours) : CALLBACK_GRANT_TTL_HOURS;
  return Math.round(Math.min(hours, MAX_GRANT_HOURS) * 3600);
}

/**
 * @description Mint one grant for one dispatch, storing only its derived signing key. Expired
 * grants of the same character older than a day are removed first, together with their nonces.
 * Runs under whatever identity the caller established: the owner for a console action, the system
 * identity for the nightly schedule. The policy's WITH CHECK still requires the grant owner to be
 * the character's owner either way.
 * @param pool - Request-identity-aware pool.
 * @param scope - Owner, owner issuer, character, ticket, dispatch kind and lifetime.
 * @returns The grant id and the one-time worker token.
 */
export async function mintCallbackGrant(pool: AppContext['pool'], scope: GrantScope & { ownerIssuer: string }): Promise<CallbackGrant> {
  if (!isValidIssuer(scope.ownerIssuer)) throw new Error('LoRA callback grant requires the owner issuer');
  const secret = randomBytes(32).toString('base64url');
  await pool.query(
    `DELETE FROM oshal_lora_callback_grants WHERE character_id = $1 AND expires_at < NOW() - INTERVAL '1 day'`,
    [scope.characterId],
  );
  const row = (await pool.query(
    `INSERT INTO oshal_lora_callback_grants
       (character_id, owner_sub, owner_issuer, ticket_id, dispatch_kind, callback_kinds, signing_key, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7, NOW() + make_interval(secs => $8))
     RETURNING id`,
    [scope.characterId, scope.ownerSub, scope.ownerIssuer, scope.ticketId, scope.dispatchKind,
      [...KINDS_BY_DISPATCH[scope.dispatchKind]], callbackSigningKey(secret).toString('hex'), grantSeconds(scope.ttlHours)],
  )).rows[0] as { id?: string } | undefined;
  if (!row?.id) throw new Error('LoRA callback grant was not recorded');
  return { grantId: String(row.id), token: `${row.id}.${secret}` };
}

/**
 * @description Revoke a grant so no further callback verifies under it.
 * @param pool - Request-identity-aware pool (the grant owner's, or the system identity).
 * @param grantId - The grant to revoke.
 * @returns Nothing.
 */
export async function revokeCallbackGrant(pool: AppContext['pool'], grantId: string): Promise<void> {
  await pool.query('UPDATE oshal_lora_callback_grants SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL', [grantId]);
}

/**
 * @description Prefix a box command with the PowerShell environment assignment that hands the
 * worker its grant. The token is validated to its closed alphabet, so it cannot close the quote.
 * @param command - The box command.
 * @param grant - The grant minted for this dispatch.
 * @returns The command the worker runs.
 */
export function withCallbackGrant(command: string, grant: CallbackGrant): string {
  if (!TOKEN_RE.test(grant.token)) throw new Error('LoRA callback grant token is malformed');
  return `$env:${CALLBACK_GRANT_ENV}='${grant.token}'; ${command}`;
}

/**
 * @description Mint a grant, hand it to the worker inside the command, and enqueue the command.
 * A refused dispatch revokes the grant at once: no worker will ever use it. The owner's issuer is
 * the scope's (the nightly schedule passes the one recorded when autonomous mode was enabled) or,
 * for a console action, the kernel's verified actor for that same owner. Without one nothing is
 * minted or sent, because the kernel could never admit the worker's callbacks.
 * @param ctx - Package app context.
 * @param scope - The grant binding for this dispatch.
 * @param command - The box command, without the grant assignment.
 * @returns The dispatch outcome plus the grant id (empty when nothing was minted).
 */
export async function dispatchWithCallbackGrant(
  ctx: AppContext, scope: GrantScope, command: string,
): Promise<DispatchResult & { grantId: string }> {
  const ownerIssuer = scope.ownerIssuer ?? verifiedIssuer(ctx, scope.ownerSub);
  if (!ownerIssuer) {
    logger.warn({ dispatchKind: scope.dispatchKind, ticketId: scope.ticketId }, 'lora dispatch refused: owner issuer unavailable');
    return { ok: false, error: 'The owner identity could not be verified, so no worker task was sent.', grantId: '' };
  }
  const grant = await mintCallbackGrant(ctx.pool, { ...scope, ownerIssuer });
  const dispatched = await dispatchBoxCommand(withCallbackGrant(command, grant), scope.ticketId);
  if (!dispatched.ok) await revokeCallbackGrant(ctx.pool, grant.grantId);
  return { ...dispatched, grantId: grant.grantId };
}

/** Decode a canonical base64url owner sub, refusing anything that does not round-trip exactly. */
function decodeOwner(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 700 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length === 0 || bytes.length > MAX_OWNER_BYTES || bytes.toString('base64url') !== value) return null;
  const sub = bytes.toString('utf8');
  return Buffer.from(sub, 'utf8').equals(bytes) && !sub.includes('\0') ? sub : null;
}

/** Parse the five contract headers; null when any is missing or malformed. */
function parseCallbackHeaders(req: Request): CallbackHeaders | null {
  const header = (name: string): string => { const v = req.headers[name]; return typeof v === 'string' ? v : ''; };
  const grantId = header(CALLBACK_HEADERS.grant);
  const ownerSub = decodeOwner(header(CALLBACK_HEADERS.owner));
  const timestampText = header(CALLBACK_HEADERS.timestamp);
  const nonce = header(CALLBACK_HEADERS.nonce);
  const signature = header(CALLBACK_HEADERS.signature);
  if (!UUID_RE.test(grantId) || !ownerSub || !/^\d{1,12}$/.test(timestampText) || !NONCE_RE.test(nonce)
      || !/^[0-9a-f]{64}$/.test(signature)) return null;
  return { grantId: grantId.toLowerCase(), ownerSub, timestamp: Number(timestampText), nonce, signature };
}

/** The request's exact body bytes: raw routes leave a Buffer; anything else signs as empty. */
function bodyBytes(req: Request): Buffer {
  return Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
}

/**
 * @description Verify one callback under the already-established owner identity: signature first,
 * so an unsigned probe learns nothing about a grant's state; then lifetime, revocation and the
 * recorded issuer; then the nonce, recorded once, so a verified request can never be accepted twice.
 * @param pool - Request-identity-aware pool, running as the asserted owner.
 * @param req - The callback request (method and original target are signed).
 * @param headers - Parsed contract headers.
 * @param nowSeconds - Controller clock in Unix seconds.
 * @returns The verified grant, or the refusal reason.
 */
async function verifyCallback(pool: AppContext['pool'], req: Request, headers: CallbackHeaders, nowSeconds: number): Promise<CallbackVerification> {
  if (Math.abs(nowSeconds - headers.timestamp) > CALLBACK_SKEW_SECONDS) return { ok: false, error: 'callback_timestamp_stale' };
  const row = (await pool.query(
    `SELECT id, character_id, owner_sub, owner_issuer, ticket_id, callback_kinds, signing_key,
            expires_at <= NOW() AS expired, revoked_at IS NOT NULL AS revoked
       FROM oshal_lora_callback_grants WHERE id = $1 AND owner_sub = $2`,
    [headers.grantId, headers.ownerSub],
  )).rows[0] as { id: string; character_id: string; owner_sub: string; owner_issuer: string | null; ticket_id: string | null;
    callback_kinds: string[]; signing_key: string; expired: boolean; revoked: boolean } | undefined;
  if (!row) return { ok: false, error: 'callback_grant_invalid' };
  const canonical = canonicalCallback(req.method, req.originalUrl || req.url, headers.timestamp, headers.nonce, bodyBytes(req));
  const expected = createHmac('sha256', Buffer.from(row.signing_key, 'hex')).update(canonical, 'utf8').digest();
  if (!timingSafeEqual(expected, Buffer.from(headers.signature, 'hex'))) return { ok: false, error: 'callback_signature_invalid' };
  if (row.revoked) return { ok: false, error: 'callback_grant_revoked' };
  if (row.expired) return { ok: false, error: 'callback_grant_expired' };
  if (!isValidIssuer(row.owner_issuer)) return { ok: false, error: 'callback_grant_issuer_missing' };
  const fresh = await pool.query(
    'INSERT INTO oshal_lora_callback_nonces (grant_id, nonce) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING grant_id',
    [row.id, headers.nonce],
  );
  if (fresh.rowCount !== 1) return { ok: false, error: 'callback_replayed' };
  return { ok: true, grant: { id: String(row.id), characterId: String(row.character_id), ownerSub: row.owner_sub,
    ownerIssuer: row.owner_issuer, ticketId: row.ticket_id, callbackKinds: [...row.callback_kinds] } };
}

/**
 * @description Verify one worker request whose body the caller has already read (the signature
 * covers the exact body bytes). The grant lookup, signature check and nonce write run as the owner
 * the request asserts, never an operator, so another owner's grant is simply not found. An admitted
 * grant is remembered for this request object only; nothing a client sends can attach one.
 * @param ctx - Package app context.
 * @param req - The worker request.
 * @returns The admitted grant, or the refusal reason.
 */
export async function checkCallbackRequest(ctx: AppContext, req: Request): Promise<CallbackVerification> {
  const headers = parseCallbackHeaders(req);
  if (!headers) {
    logger.warn({ path: req.path }, 'lora callback refused: grant headers missing or malformed');
    return { ok: false, error: 'callback_grant_required' };
  }
  const result = await runWithRequestIdentity({ sub: headers.ownerSub, isOperator: false },
    () => verifyCallback(ctx.pool, req, headers, Math.floor(Date.now() / 1000)));
  if (result.ok) admitted.set(req, result.grant);
  else logger.warn({ grantId: headers.grantId, error: result.error, path: req.path }, 'lora callback refused');
  return result;
}

/**
 * @description Handler guard for every worker route: the request must carry a grant the verifier
 * admitted. The kernel runs the verifier before any package code, so in production this only fails
 * if a route were ever reached without it, and then it fails closed.
 * @param req - The worker request.
 * @param res - The response, answered 401 when no grant was admitted.
 * @param next - Continues to the handler.
 * @returns Nothing.
 */
export const requireAdmittedGrant: RequestHandler = (req, res, next) => {
  if (admitted.has(req)) { next(); return; }
  logger.warn({ path: req.path }, 'lora worker route reached without an admitted callback grant');
  res.status(401).json({ error: 'callback_grant_required' });
};

/**
 * @description The grant the verifier admitted for this request.
 * @param req - A worker request.
 * @returns The admitted grant, or null when none was.
 */
export function callbackGrantOf(req: Request): VerifiedGrant | null {
  return admitted.get(req) ?? null;
}

/**
 * @description Whether a verified grant covers this callback kind for this character.
 * @param grant - The verified grant.
 * @param kind - The callback kind being sent.
 * @param characterId - The character the callback resolved to under the grant owner.
 * @returns A refusal reason, or null when the grant covers it.
 */
export function grantRefusal(grant: VerifiedGrant, kind: CallbackKind, characterId: string | null): string | null {
  if (!grant.callbackKinds.includes(kind)) return 'callback_kind_not_granted';
  if (characterId !== null && characterId !== grant.characterId) return 'callback_character_not_granted';
  return null;
}
