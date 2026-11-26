/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.3 P1 double opt-in
 *     sign-up routes under /api/marketing/audience/*: owner-scoped sign-up form CRUD, embeddable
 *     static-site snippet endpoint, double opt-in submission pipeline (sliding-window per-IP &
 *     per-form rate limits, silent honeypot short-circuit, suppression immunity, UTM capture,
 *     pending consent evidence, HMAC-SHA256 signed single-use confirmation token, generic
 *     acknowledgement-only response), and atomic single-use confirmation endpoint flipping
 *     pending -> confirmed. Mirrors migration 005-marketing-double-optin.sql at the lazy-DDL
 *     chokepoint.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.6: auto-enroll confirmed
 *     double opt-in contacts into any active owner sequence whose trigger_form_slug matches the
 *     confirmed sign-up form slug (ON CONFLICT DO NOTHING), returning enrolledSequenceIds.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.9 (P5): automatically
 *     capture a first-touch `signup` conversion row in oshal_marketing_conversions whenever a
 *     sign-up form submission or confirmation carries UTM campaign attribution.
 *
 * @module marketing-optin
 */

import * as crypto from 'crypto';
import type { Request, Response, Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { runRuntimeSchemaBootstrap, buildOwnerRlsPolicyStatements } from '@/shared/services/database';
import {
  FORM_SLUG_RE, SlidingWindowRateLimiter, buildConfirmationUrl, buildEmbedSnippet,
  buildGenericAckResponse, decodeConfirmationTokenUnverified, mintConfirmationToken,
  normalizeSignupForm, normalizeSignupFormPatch, parseSignupSubmission, sanitizeSignupFormRow,
  verifyConfirmationToken,
} from './marketing-optin-model';
import { authed, logger, rows, safeRows, type QueryablePool } from './marketing-support';
import { recordSignupFirstTouchConversion } from './marketing-attribution';

/** Lazy-DDL mirror of migrations/005-marketing-double-optin.sql. */
const OPTIN_TABLE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS oshal_marketing_signup_forms (
    form_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    consent_text TEXT NOT NULL,
    list_id UUID REFERENCES oshal_marketing_lists (list_id) ON DELETE SET NULL,
    honeypot_field TEXT NOT NULL DEFAULT 'company_website',
    signing_secret TEXT NOT NULL,
    rate_limit_per_ip_hour INT NOT NULL DEFAULT 10 CHECK (rate_limit_per_ip_hour BETWEEN 1 AND 1000),
    rate_limit_per_form_hour INT NOT NULL DEFAULT 200 CHECK (rate_limit_per_form_hour BETWEEN 1 AND 10000),
    token_ttl_minutes INT NOT NULL DEFAULT 1440 CHECK (token_ttl_minutes BETWEEN 5 AND 10080),
    confirmation_base_url TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_sub, slug)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_signup_forms_owner_updated
    ON oshal_marketing_signup_forms (owner_sub, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS oshal_marketing_optin_tokens (
    token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    form_id UUID NOT NULL REFERENCES oshal_marketing_signup_forms (form_id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES oshal_marketing_contacts (contact_id) ON DELETE CASCADE,
    consent_id UUID NOT NULL REFERENCES oshal_marketing_consents (consent_id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_sub, token_hash)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_optin_tokens_owner_form
    ON oshal_marketing_optin_tokens (owner_sub, form_id, created_at DESC)`,
];

const OPTIN_RLS_TABLES = [
  'oshal_marketing_signup_forms',
  'oshal_marketing_optin_tokens',
];

/** Default process-local bounded sliding-window limiter (injectable via ctx for deterministic tests). */
const sharedRateLimiter = new SlidingWindowRateLimiter();

/** Optional test hooks accepted on ctx without altering production AppContext contract. */
interface OptInRuntimeHooks {
  optInRateLimiter?: SlidingWindowRateLimiter;
  nowMs?: () => number;
}

/** Resolve the active sliding-window rate limiter from ctx or shared default. */
function getRateLimiter(ctx: AppContext): SlidingWindowRateLimiter {
  return (ctx as AppContext & OptInRuntimeHooks).optInRateLimiter ?? sharedRateLimiter;
}

/** Resolve current epoch milliseconds (clock-injectable for tests). */
function currentNowMs(ctx: AppContext): number {
  const fn = (ctx as AppContext & OptInRuntimeHooks).nowMs;
  return typeof fn === 'function' ? fn() : Date.now();
}

/**
 * @description Ensure the 005-marketing-double-optin tables + exact-owner FORCE RLS at the lazy-DDL chokepoint.
 * @param pool - Framework pool.
 */
export async function ensureOptInSchema(pool: AppContext['pool']): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'marketing-optin',
    statements: [
      ...OPTIN_TABLE_DDL,
      ...OPTIN_RLS_TABLES.flatMap((table) => buildOwnerRlsPolicyStatements(table, 'owner_sub')),
    ],
    requirements: [
      { table: 'oshal_marketing_signup_forms', columns: ['form_id', 'owner_sub', 'slug', 'signing_secret', 'honeypot_field'] },
      { table: 'oshal_marketing_optin_tokens', columns: ['token_id', 'owner_sub', 'form_id', 'token_hash', 'expires_at', 'consumed_at'] },
    ],
  });
}

/** Run work inside a DB transaction when the pool supports connect(), or directly on query-only pools. */
async function withOptionalTransaction<T>(
  pool: QueryablePool,
  work: (q: QueryablePool) => Promise<T>,
): Promise<T> {
  const connectable = pool as QueryablePool & {
    connect?: () => Promise<QueryablePool & { release: () => void }>;
  };
  if (typeof connectable.connect !== 'function') return work(pool);
  const client = await connectable.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* rollback best-effort */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Verify an optional list_id exists under the caller's owner_sub scope. */
async function listExistsForOwner(pool: QueryablePool, sub: string, listId: string | null): Promise<boolean> {
  if (!listId) return true;
  const found = await rows(pool, 'SELECT list_id FROM oshal_marketing_lists WHERE list_id = $1 AND owner_sub = $2', [listId, sub]);
  return found.length > 0;
}

/** Resolve normalized client IP string for rate limiting and consent evidence. */
function clientIp(req: Request): string {
  const fwd = typeof req.headers?.['x-forwarded-for'] === 'string'
    ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
    : '';
  return (fwd || req.ip || 'unknown').slice(0, 128);
}

/**
 * @description GET /audience/signup-forms — list caller's sign-up forms (omitting signing_secret) with pending/confirmed counts.
 */
export async function listSignupForms(ctx: AppContext, sub: string, _req: Request, res: Response): Promise<void> {
  const formRows = await rows(
    ctx.pool,
    `SELECT f.form_id, f.owner_sub, f.slug, f.name, f.consent_text, f.list_id, f.honeypot_field,
            f.rate_limit_per_ip_hour, f.rate_limit_per_form_hour, f.token_ttl_minutes,
            f.confirmation_base_url, f.enabled, f.created_at, f.updated_at,
            COALESCE(t.pending_count, 0)::int AS pending_count,
            COALESCE(t.confirmed_count, 0)::int AS confirmed_count
       FROM oshal_marketing_signup_forms f
       LEFT JOIN (
         SELECT tok.form_id,
                COUNT(*) FILTER (WHERE c.status = 'pending')::int AS pending_count,
                COUNT(*) FILTER (WHERE c.status = 'confirmed')::int AS confirmed_count
           FROM oshal_marketing_optin_tokens tok
           JOIN oshal_marketing_consents c
             ON c.consent_id = tok.consent_id AND c.owner_sub = tok.owner_sub
          WHERE tok.owner_sub = $1
          GROUP BY tok.form_id
       ) t ON t.form_id = f.form_id
      WHERE f.owner_sub = $1
      ORDER BY f.updated_at DESC LIMIT 200`,
    [sub],
  );
  res.json({ forms: formRows.map(sanitizeSignupFormRow) });
}

/**
 * @description POST /audience/signup-forms — create an owner-scoped double opt-in sign-up form.
 */
export async function createSignupForm(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const checked = normalizeSignupForm(req.body ?? {});
  if (!checked.ok) { res.status(400).json({ error: checked.error, message: checked.message }); return; }
  const f = checked.form;
  if (!(await listExistsForOwner(ctx.pool, sub, f.listId))) {
    res.status(404).json({ error: 'list_not_found', listId: f.listId });
    return;
  }
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    const inserted = (await rows(
      ctx.pool,
      `INSERT INTO oshal_marketing_signup_forms
         (owner_sub, slug, name, consent_text, list_id, honeypot_field, signing_secret,
          rate_limit_per_ip_hour, rate_limit_per_form_hour, token_ttl_minutes,
          confirmation_base_url, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        sub, f.slug, f.name, f.consentText, f.listId, f.honeypotField, secret,
        f.rateLimitPerIpPerHour, f.rateLimitPerFormPerHour, f.tokenTtlMinutes,
        f.confirmationBaseUrl, f.enabled,
      ],
    ))[0];
    const form = sanitizeSignupFormRow(inserted);
    const snippet = buildEmbedSnippet(inserted);
    res.status(201).json({ form, snippet });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'form_slug_exists', slug: f.slug });
      return;
    }
    throw err;
  }
}

/** Build parameterized SET clauses for PATCH /audience/signup-forms/:slug. */
function buildPatchUpdate(patch: Record<string, unknown>): { sets: string[]; values: unknown[] } {
  const colMap: Array<[string, string]> = [
    ['name', 'name'],
    ['consentText', 'consent_text'],
    ['listId', 'list_id'],
    ['honeypotField', 'honeypot_field'],
    ['rateLimitPerIpPerHour', 'rate_limit_per_ip_hour'],
    ['rateLimitPerFormPerHour', 'rate_limit_per_form_hour'],
    ['tokenTtlMinutes', 'token_ttl_minutes'],
    ['confirmationBaseUrl', 'confirmation_base_url'],
    ['enabled', 'enabled'],
  ];
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of colMap) {
    if (key in patch) {
      values.push(patch[key]);
      sets.push(`${col} = $${values.length}`);
    }
  }
  sets.push('updated_at = now()');
  return { sets, values };
}

/**
 * @description PATCH /audience/signup-forms/:slug — update settings on an owner-scoped sign-up form.
 */
export async function patchSignupForm(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  if (!FORM_SLUG_RE.test(slug)) { res.status(404).json({ error: 'form_not_found' }); return; }
  const checked = normalizeSignupFormPatch(req.body ?? {});
  if (!checked.ok) { res.status(400).json({ error: checked.error, message: checked.message }); return; }
  if ('listId' in checked.patch && !(await listExistsForOwner(ctx.pool, sub, checked.patch.listId ?? null))) {
    res.status(404).json({ error: 'list_not_found', listId: checked.patch.listId });
    return;
  }
  const { sets, values } = buildPatchUpdate(checked.patch as Record<string, unknown>);
  values.push(sub, slug);
  const updated = (await rows(
    ctx.pool,
    `UPDATE oshal_marketing_signup_forms SET ${sets.join(', ')}
      WHERE owner_sub = $${values.length - 1} AND slug = $${values.length}
      RETURNING *`,
    values,
  ))[0];
  if (!updated) { res.status(404).json({ error: 'form_not_found' }); return; }
  res.json({ form: sanitizeSignupFormRow(updated) });
}

/**
 * @description DELETE /audience/signup-forms/:slug — delete an owner-scoped sign-up form.
 */
export async function deleteSignupForm(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  if (!FORM_SLUG_RE.test(slug)) { res.status(404).json({ error: 'form_not_found' }); return; }
  const r = await ctx.pool.query(
    'DELETE FROM oshal_marketing_signup_forms WHERE owner_sub = $1 AND slug = $2',
    [sub, slug],
  );
  if (!r.rowCount) { res.status(404).json({ error: 'form_not_found' }); return; }
  res.json({ deleted: true, slug });
}

/**
 * @description GET /audience/signup-forms/:slug/snippet — return self-contained embeddable HTML/JS snippet (read-only).
 */
export async function getSignupFormSnippet(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  if (!FORM_SLUG_RE.test(slug)) { res.status(404).json({ error: 'form_not_found' }); return; }
  const form = (await rows(
    ctx.pool,
    `SELECT form_id, slug, name, consent_text, honeypot_field, confirmation_base_url
       FROM oshal_marketing_signup_forms
      WHERE owner_sub = $1 AND slug = $2`,
    [sub, slug],
  ))[0];
  if (!form) { res.status(404).json({ error: 'form_not_found' }); return; }
  const endpointBase = typeof req.query?.endpointBaseUrl === 'string' ? req.query.endpointBaseUrl : undefined;
  res.json(buildEmbedSnippet(form, endpointBase));
}

/** Check whether an email hash or contact is suppressed under the caller's scope. */
async function isAddressOrContactSuppressed(
  q: QueryablePool,
  sub: string,
  emailHash: string,
  contactId?: string,
): Promise<boolean> {
  const supps = await rows(
    q,
    "SELECT suppression_id FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND channel = 'email' AND address_hash = $2",
    [sub, emailHash],
  );
  if (supps.length > 0) return true;
  const contact = contactId
    ? (await rows(q, 'SELECT contact_id, status FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2', [contactId, sub]))[0]
    : (await rows(q, 'SELECT contact_id, status FROM oshal_marketing_contacts WHERE owner_sub = $1 AND email_hash = $2', [sub, emailHash]))[0];
  if (contactId && !contact) return true;
  return Boolean(contact && String(contact.status) === 'suppressed');
}

/** Upsert an active contact and attach the form's optional owned list membership. */
async function upsertSignupContactAndList(
  q: QueryablePool,
  sub: string,
  form: Record<string, unknown>,
  input: { email: string; emailHash: string; displayName: string },
): Promise<string> {
  const contact = (await rows(
    q,
    `INSERT INTO oshal_marketing_contacts (owner_sub, email, email_hash, display_name, status)
     VALUES ($1,$2,$3,$4,'active')
     ON CONFLICT (owner_sub, email_hash) DO UPDATE SET
       email = EXCLUDED.email,
       display_name = CASE WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name ELSE oshal_marketing_contacts.display_name END,
       updated_at = now()
     RETURNING *`,
    [sub, input.email, input.emailHash, input.displayName],
  ))[0];
  const contactId = String(contact.contact_id);
  if (form.list_id) {
    const ownedList = await rows(q, 'SELECT list_id FROM oshal_marketing_lists WHERE list_id = $1 AND owner_sub = $2', [String(form.list_id), sub]);
    if (ownedList.length > 0) {
      await q.query(
        'INSERT INTO oshal_marketing_list_members (owner_sub, list_id, contact_id) VALUES ($1,$2,$3) ON CONFLICT (list_id, contact_id) DO NOTHING',
        [sub, String(form.list_id), contactId],
      );
    }
  }
  return contactId;
}

/** Persist contact upsert, optional list membership, pending consent evidence, and hashed confirmation token. */
async function persistDoubleOptInSubmission(
  q: QueryablePool,
  sub: string,
  form: Record<string, unknown>,
  input: { email: string; emailHash: string; displayName: string; utm: Record<string, string>; ip: string; userAgent: string | null; nowMs: number },
): Promise<{ suppressed: boolean; preview?: { confirmationUrl: string; token: string; expiresAt: string; contactId: string; consentId: string } }> {
  if (await isAddressOrContactSuppressed(q, sub, input.emailHash)) return { suppressed: true };
  const contactId = await upsertSignupContactAndList(q, sub, form, input);
  const tokenId = crypto.randomUUID();
  const consentId = crypto.randomUUID();
  const expiresAtMs = input.nowMs + Number(form.token_ttl_minutes || 1440) * 60_000;
  const minted = mintConfirmationToken({
    tokenId, ownerSub: sub, formSlug: String(form.slug),
    contactId, consentId, emailHash: input.emailHash, expiresAtMs,
  }, String(form.signing_secret));
  const evidence = {
    formText: String(form.consent_text || ''),
    recordedAt: new Date(input.nowMs).toISOString(),
    ip: input.ip,
    userAgent: input.userAgent,
    utm: input.utm,
    tokenHash: minted.tokenHash,
    formSlug: String(form.slug),
    doubleOptIn: true,
  };
  await q.query(
    `INSERT INTO oshal_marketing_consents (consent_id, owner_sub, contact_id, channel, purpose, status, evidence)
     VALUES ($1,$2,$3,'email','marketing','pending',$4::jsonb)`,
    [consentId, sub, contactId, JSON.stringify(evidence)],
  );
  await q.query(
    `INSERT INTO oshal_marketing_optin_tokens (token_id, owner_sub, form_id, contact_id, consent_id, token_hash, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [tokenId, sub, String(form.form_id), contactId, consentId, minted.tokenHash, minted.expiresAt],
  );
  const confirmationUrl = buildConfirmationUrl(String(form.confirmation_base_url || ''), minted.token);
  return { suppressed: false, preview: { confirmationUrl, token: minted.token, expiresAt: minted.expiresAt, contactId, consentId } };
}

/**
 * @description POST /audience/signup-forms/:slug/submit — run rate-limit, honeypot, suppression,
 * pending consent capture, and single-use confirmation token minting; returns acknowledgement-only response.
 */
export async function submitSignupForm(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  if (!FORM_SLUG_RE.test(slug)) { res.status(404).json({ error: 'form_not_found' }); return; }
  const form = (await rows(
    ctx.pool,
    'SELECT * FROM oshal_marketing_signup_forms WHERE owner_sub = $1 AND slug = $2',
    [sub, slug],
  ))[0];
  if (!form) { res.status(404).json({ error: 'form_not_found' }); return; }
  if (!form.enabled) { res.status(403).json({ error: 'form_disabled' }); return; }

  const nowMs = currentNowMs(ctx);
  const ip = clientIp(req);
  const limit = getRateLimiter(ctx).checkAndConsume({
    ipKey: ip,
    formKey: `${sub}:${slug}`,
    ipLimit: Number(form.rate_limit_per_ip_hour || 10),
    formLimit: Number(form.rate_limit_per_form_hour || 200),
    nowMs,
  });
  if (!limit.allowed) {
    res.status(429).json({ error: limit.code, retryAfterSec: limit.retryAfterSec });
    return;
  }

  const parsed = parseSignupSubmission(req.body ?? {}, form);
  if (parsed.honeypotTriggered) {
    res.status(200).json(buildGenericAckResponse());
    return;
  }
  if (!parsed.ok || !parsed.email || !parsed.emailHash) {
    res.status(400).json({ error: parsed.error || 'invalid_email' });
    return;
  }

  const ua = typeof req.headers?.['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 512) : null;
  const saved = await withOptionalTransaction(ctx.pool, (q) => persistDoubleOptInSubmission(q, sub, form, {
    email: parsed.email!,
    emailHash: parsed.emailHash!,
    displayName: parsed.displayName,
    utm: parsed.utm,
    ip,
    userAgent: ua,
    nowMs,
  }));

  if (!saved.suppressed && saved.preview) {
    await recordSignupFirstTouchConversion(ctx.pool, sub, {
      contactId: saved.preview.contactId,
      utm: parsed.utm,
      referenceId: `signup-form:${slug}:${saved.preview.consentId}`,
      occurredAtIso: new Date(nowMs).toISOString(),
    });
  }

  const ack = buildGenericAckResponse();
  if (!saved.suppressed && parsed.returnPreviewLink && saved.preview) {
    res.status(200).json({ ...ack, preview: saved.preview });
    return;
  }
  res.status(200).json(ack);
}

/** Execute atomic single-use token consumption and pending -> confirmed consent transition. */
async function consumeAndConfirmTokenTx(
  q: QueryablePool,
  sub: string,
  payload: { tokenId: string; contactId: string; consentId: string; emailHash: string },
  tokenHash: string,
  nowIso: string,
): Promise<{ ok: true; confirmedAt: string } | { ok: false; status: number; error: string }> {
  const existing = (await rows(
    q,
    'SELECT token_id, consumed_at FROM oshal_marketing_optin_tokens WHERE token_id = $1 AND owner_sub = $2 AND token_hash = $3',
    [payload.tokenId, sub, tokenHash],
  ))[0];
  if (!existing) return { ok: false, status: 400, error: 'token_forged' };
  if (existing.consumed_at) return { ok: false, status: 409, error: 'token_already_used' };
  if (await isAddressOrContactSuppressed(q, sub, payload.emailHash, payload.contactId)) {
    return { ok: false, status: 409, error: 'contact_suppressed' };
  }
  const consumed = await rows(
    q,
    `UPDATE oshal_marketing_optin_tokens
        SET consumed_at = now()
      WHERE token_id = $1 AND owner_sub = $2 AND token_hash = $3
        AND consumed_at IS NULL AND expires_at > $4::timestamptz
      RETURNING token_id`,
    [payload.tokenId, sub, tokenHash, nowIso],
  );
  if (!consumed.length) {
    const recheck = (await rows(q, 'SELECT consumed_at FROM oshal_marketing_optin_tokens WHERE token_id = $1 AND owner_sub = $2', [payload.tokenId, sub]))[0];
    return recheck?.consumed_at ? { ok: false, status: 409, error: 'token_already_used' } : { ok: false, status: 410, error: 'token_expired' };
  }
  const patchEvidence = JSON.stringify({ confirmedAt: nowIso, confirmedVia: 'double_opt_in' });
  await q.query(
    `UPDATE oshal_marketing_consents
        SET status = 'confirmed', evidence = COALESCE(evidence, '{}'::jsonb) || $4::jsonb, updated_at = now()
      WHERE consent_id = $1 AND owner_sub = $2 AND contact_id = $3 AND status = 'pending'`,
    [payload.consentId, sub, payload.contactId, patchEvidence],
  );
  return { ok: true, confirmedAt: nowIso };
}

/** Auto-enroll a freshly confirmed contact into any active welcome sequence matching trigger_form_slug. */
async function enrollMatchingWelcomeSequences(
  pool: QueryablePool,
  sub: string,
  formSlug: string,
  contactId: string,
): Promise<string[]> {
  const matching = await safeRows(
    pool,
    `SELECT sequence_id
       FROM oshal_marketing_sequences
      WHERE owner_sub = $1 AND trigger_form_slug = $2 AND status = 'active'
      ORDER BY created_at ASC`,
    [sub, formSlug],
  );
  const enrolledSequenceIds: string[] = [];
  for (const seq of matching) {
    const seqId = String(seq.sequence_id || '');
    if (!seqId) continue;
    const inserted = await safeRows(
      pool,
      `INSERT INTO oshal_marketing_enrollments
         (owner_sub, sequence_id, contact_id, current_step_order, status, next_run_at, history)
       VALUES ($1,$2,$3,0,'active',now(),'[]'::jsonb)
       ON CONFLICT (sequence_id, contact_id) DO NOTHING
       RETURNING sequence_id`,
      [sub, seqId, contactId],
    );
    if (inserted.length > 0) enrolledSequenceIds.push(seqId);
  }
  return enrolledSequenceIds;
}

/** Ensure a confirmed double opt-in contact with UTM evidence has a first-touch signup conversion row. */
async function ensureConfirmedSignupConversion(
  pool: QueryablePool,
  sub: string,
  formSlug: string,
  contactId: string,
  consentId: string,
  confirmedAt: string,
): Promise<void> {
  const consentRows = await safeRows(
    pool,
    'SELECT evidence FROM oshal_marketing_consents WHERE consent_id = $1 AND owner_sub = $2 LIMIT 1',
    [consentId, sub],
  );
  const ev = (consentRows[0]?.evidence && typeof consentRows[0].evidence === 'object'
    ? consentRows[0].evidence : {}) as Record<string, unknown>;
  const utm = (ev.utm && typeof ev.utm === 'object' ? ev.utm : {}) as Record<string, string>;
  if (Object.keys(utm).length > 0) {
    await recordSignupFirstTouchConversion(pool, sub, {
      contactId,
      utm,
      referenceId: `signup-form:${formSlug}:${consentId}`,
      occurredAtIso: confirmedAt,
    });
  }
}

/**
 * @description POST /audience/opt-in/confirm — verify HMAC-SHA256 signature, expiry, single-use
 * consumption, and suppression state, then flip pending consent -> confirmed and auto-enroll
 * into any active welcome sequences matching the sign-up form slug.
 */
export async function confirmOptIn(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawToken = typeof body.token === 'string'
    ? body.token.trim()
    : typeof req.query?.token === 'string' ? req.query.token.trim() : '';
  const decoded = decodeConfirmationTokenUnverified(rawToken);
  if (!decoded || decoded.ownerSub !== sub) {
    res.status(400).json({ error: 'token_forged' });
    return;
  }
  const form = (await rows(
    ctx.pool,
    'SELECT form_id, signing_secret FROM oshal_marketing_signup_forms WHERE owner_sub = $1 AND slug = $2',
    [sub, decoded.formSlug],
  ))[0];
  if (!form) { res.status(400).json({ error: 'token_forged' }); return; }

  const nowMs = currentNowMs(ctx);
  const verified = verifyConfirmationToken(rawToken, String(form.signing_secret), nowMs);
  if (!verified.ok) {
    res.status(verified.error === 'token_expired' ? 410 : 400).json({ error: verified.error });
    return;
  }
  const nowIso = new Date(nowMs).toISOString();
  const outcome = await withOptionalTransaction(ctx.pool, (q) => consumeAndConfirmTokenTx(
    q, sub, verified.payload, verified.tokenHash, nowIso,
  ));
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  await ensureConfirmedSignupConversion(
    ctx.pool, sub, decoded.formSlug, verified.payload.contactId, verified.payload.consentId, outcome.confirmedAt,
  );
  const enrolledSequenceIds = await enrollMatchingWelcomeSequences(
    ctx.pool, sub, decoded.formSlug, verified.payload.contactId,
  );
  res.status(200).json({
    ok: true,
    confirmed: true,
    contactId: verified.payload.contactId,
    consentId: verified.payload.consentId,
    status: 'confirmed',
    confirmedAt: outcome.confirmedAt,
    enrolledSequenceIds,
  });
}

/**
 * @description Register P1 double opt-in sign-up form and confirmation routes under /api/marketing/audience/*.
 * @param router - The marketing Express router.
 * @param ctx - Framework app context.
 */
export function registerOptInRoutes(router: Router, ctx: AppContext): void {
  ensureOptInSchema(ctx.pool).catch((err) => logger.error({ err }, 'Failed to ensure marketing-engine double opt-in schema'));
  router.get('/audience/signup-forms', authed(ctx, listSignupForms));
  router.post('/audience/signup-forms', authed(ctx, createSignupForm));
  router.patch('/audience/signup-forms/:slug', authed(ctx, patchSignupForm));
  router.delete('/audience/signup-forms/:slug', authed(ctx, deleteSignupForm));
  router.get('/audience/signup-forms/:slug/snippet', authed(ctx, getSignupFormSnippet));
  router.post('/audience/signup-forms/:slug/submit', authed(ctx, submitSignupForm));
  router.post('/audience/opt-in/confirm', authed(ctx, confirmOptIn));
}
