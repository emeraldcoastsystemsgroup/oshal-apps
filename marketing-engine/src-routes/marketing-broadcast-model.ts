/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Pure one-click unsubscribe token signer,
 *     RFC 8058 header builder, broadcast draft normalizer, and deterministic broadcast send
 *     gate chain for marketing-engine 0.6.5 (zero DB, zero network, node:crypto only):
 *     per-recipient/per-list HMAC-SHA256 unsubscribe tokens with constant-time verification,
 *     strict RFC 8058 List-Unsubscribe + List-Unsubscribe-Post headers rejecting CRLF and
 *     non-http(s) URLs, and full P1 send gate planning (channel consent -> daily cap ->
 *     compliance & template lint -> explicit write confirmation -> per-recipient suppression,
 *     confirmed consent, and cap evaluation).
 *
 * @module marketing-broadcast-model
 */

import * as crypto from 'crypto';
import { SHA256_HEX_RE } from './marketing-audience-model';
import { isChannelEnabled, type ChannelAuthorizationRowLike } from './marketing-model';
import {
  MARKETING_TEMPLATE_IDS,
  complianceReadiness,
  lintMarketingEmail,
  normalizeComplianceSettings,
  renderMarketingTemplate,
  safeHttpUrl,
  type ComplianceLintError,
  type ComplianceSettings,
  type MarketingTemplateId,
} from './marketing-templates';

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADER_CONTROL_RE = /[\r\n\u0000-\u001f\u007f<>]/;

/** @description Allowed RFC 8058 one-click unsubscribe header names. */
export const RFC8058_HEADER_NAMES = ['List-Unsubscribe', 'List-Unsubscribe-Post'] as const;

/** @description Exact RFC 8058 List-Unsubscribe-Post value. */
export const RFC8058_ONE_CLICK_VALUE = 'List-Unsubscribe=One-Click' as const;

/** @description Valid broadcast message statuses. */
export const BROADCAST_STATUSES = ['draft', 'approved', 'sent', 'partial', 'blocked'] as const;

/** @description Valid per-recipient delivery statuses. */
export const DELIVERY_STATUSES = [
  'sent', 'dry_run', 'skipped_consent', 'skipped_unconfirmed',
  'skipped_suppressed', 'skipped_compliance', 'skipped_cap', 'skipped_confirm', 'error',
] as const;

export type DeliveryStatus = typeof DELIVERY_STATUSES[number];

/** @description RFC 8058 header pair returned for every eligible broadcast recipient. */
export interface Rfc8058Headers {
  'List-Unsubscribe': string;
  'List-Unsubscribe-Post': typeof RFC8058_ONE_CLICK_VALUE;
}

/** @description Signed claims embedded in a per-recipient, per-list unsubscribe token. */
export interface UnsubscribeTokenPayload {
  v: 1;
  ownerSub: string;
  contactId: string;
  emailHash: string;
  listId: string;
  messageId?: string;
}

/** @description Input for minting a signed unsubscribe token. */
export interface MintUnsubscribeTokenInput {
  ownerSub: string;
  contactId: string;
  emailHash: string;
  listId: string;
  messageId?: string;
}

/** @description Normalized broadcast draft input for POST /api/marketing/broadcasts. */
export interface NormalizedBroadcastDraft {
  campaignId: string | null;
  listId: string;
  templateId: MarketingTemplateId;
  subject: string;
  headline: string;
  intro: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}

/** @description Recipient snapshot evaluated by the broadcast send gate chain. */
export interface BroadcastRecipient {
  contactId: string;
  email: string;
  emailHash: string;
  displayName?: string;
  contactStatus?: string;
  emailConsentStatus?: string | null;
}

/** @description Broadcast message record passed into the pure gate planner. */
export interface BroadcastMessageSpec {
  messageId: string;
  listId: string;
  templateId: MarketingTemplateId;
  subject: string;
  headline?: string;
  intro?: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  signingSecret: string;
}

/** @description Per-recipient decision emitted by planBroadcastDeliveries. */
export interface BroadcastRecipientDecision {
  contactId: string;
  email: string;
  emailHash: string;
  status: 'eligible' | 'skipped_consent' | 'skipped_unconfirmed' | 'skipped_suppressed' | 'skipped_compliance' | 'skipped_cap' | 'skipped_confirm';
  gateReason: string;
  unsubscribeUrl?: string;
  unsubscribeToken?: string;
  headers?: Rfc8058Headers;
  subject?: string;
  html?: string;
  text?: string;
}

/** @description Aggregate counters across one broadcast evaluation or send run. */
export interface BroadcastStats {
  totalRecipients: number;
  eligible: number;
  sent: number;
  dryRun: number;
  skippedConsent: number;
  skippedUnconfirmed: number;
  skippedSuppressed: number;
  skippedCompliance: number;
  skippedCap: number;
  skippedConfirm: number;
  error: number;
}

/** @description Input to the deterministic broadcast gate planner. */
export interface PlanBroadcastInput {
  ownerSub: string;
  message: BroadcastMessageSpec;
  channelRow: ChannelAuthorizationRowLike | null | undefined;
  sentToday: number;
  compliance: Partial<ComplianceSettings> | null | undefined;
  recipients: BroadcastRecipient[];
  suppressedEmailHashes: Set<string>;
  dryRun: boolean;
  confirmed: boolean;
  includeUnsubscribePreviewTokens?: boolean;
}

/** @description Output of planBroadcastDeliveries. */
export interface BroadcastPlanResult {
  blocked: boolean;
  httpStatus: number;
  error?: 'skipped_consent' | 'skipped_cap' | 'skipped_compliance' | 'confirmation_required';
  reason?: string;
  reasons?: ComplianceLintError[];
  decisions: BroadcastRecipientDecision[];
  stats: BroadcastStats;
}

/** Create a coded validation error. */
function codedError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

/** Trim and bound a text field. */
function trimBound(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, max);
}

/**
 * @description Derive a domain-separated HMAC-SHA256 signing key for one-click unsubscribe tokens.
 * @param ownerSub - Owner OIDC subject.
 * @param signingSecret - Per-message random hex secret (>= 32 chars).
 * @returns 32-byte derived signing key.
 */
export function deriveUnsubscribeSigningKey(ownerSub: string, signingSecret: string): Buffer {
  const owner = String(ownerSub || '').trim();
  const secret = String(signingSecret || '').trim();
  if (!owner || secret.length < 32) {
    throw codedError('invalid_signing_key_inputs', 'Owner subject and >=32-char signing secret are required.');
  }
  return crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(`one-click-unsub-v1:${owner}`, 'utf8').digest();
}

/** Validate the structural fields of an unsubscribe token payload. */
function isValidUnsubscribePayload(raw: unknown): raw is UnsubscribeTokenPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const p = raw as Record<string, unknown>;
  const msgValid = p.messageId === undefined || (typeof p.messageId === 'string' && UUID_SHAPE_RE.test(p.messageId));
  return p.v === 1
    && typeof p.ownerSub === 'string' && p.ownerSub.trim().length > 0
    && typeof p.contactId === 'string' && UUID_SHAPE_RE.test(p.contactId)
    && typeof p.emailHash === 'string' && SHA256_HEX_RE.test(p.emailHash)
    && typeof p.listId === 'string' && UUID_SHAPE_RE.test(p.listId)
    && msgValid;
}

/**
 * @description Mint a URL-safe HMAC-SHA256 signed per-recipient, per-list unsubscribe token.
 * @param input - Recipient, list, owner, and optional message claims.
 * @param signingSecret - Per-message random hex signing secret.
 * @returns Base64url `<payload>.<sig>` token string.
 */
export function mintUnsubscribeToken(input: MintUnsubscribeTokenInput, signingSecret: string): string {
  const payload: UnsubscribeTokenPayload = {
    v: 1,
    ownerSub: String(input.ownerSub || '').trim(),
    contactId: String(input.contactId || '').trim(),
    emailHash: String(input.emailHash || '').trim().toLowerCase(),
    listId: String(input.listId || '').trim(),
    ...(input.messageId ? { messageId: String(input.messageId).trim() } : {}),
  };
  if (!isValidUnsubscribePayload(payload)) {
    throw codedError('invalid_unsubscribe_payload', 'Unsubscribe token payload has invalid claims.');
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const key = deriveUnsubscribeSigningKey(payload.ownerSub, signingSecret);
  const sigB64 = crypto.createHmac('sha256', key).update(payloadB64, 'utf8').digest('base64url');
  return `${payloadB64}.${sigB64}`;
}

/**
 * @description Parse an unsubscribe token payload without trusting its signature (used only to
 * locate the owner's message secret before constant-time verification).
 * @param token - Candidate token string.
 * @returns Validated payload shape or null when malformed.
 */
export function decodeUnsubscribeTokenUnverified(token: unknown): UnsubscribeTokenPayload | null {
  if (typeof token !== 'string' || token.length < 10 || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !BASE64URL_RE.test(parts[0]) || !BASE64URL_RE.test(parts[1])) return null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return isValidUnsubscribePayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @description Verify a signed unsubscribe token using constant-time HMAC-SHA256 comparison.
 * Fails closed with `unsubscribe_token_forged` on malformed, tampered, wrong-owner, or wrong-secret tokens.
 * @param token - Candidate token string.
 * @param signingSecret - Expected signing secret.
 * @param expectedOwnerSub - Optional owner_sub that must match payload.ownerSub.
 * @returns Verified payload or fail-closed error.
 */
export function verifyUnsubscribeToken(
  token: unknown,
  signingSecret: string,
  expectedOwnerSub?: string,
): { ok: true; payload: UnsubscribeTokenPayload } | { ok: false; error: 'unsubscribe_token_forged' } {
  const payload = decodeUnsubscribeTokenUnverified(token);
  if (!payload || typeof token !== 'string') return { ok: false, error: 'unsubscribe_token_forged' };
  if (expectedOwnerSub !== undefined && payload.ownerSub !== expectedOwnerSub) {
    return { ok: false, error: 'unsubscribe_token_forged' };
  }
  const [payloadB64, sigB64] = token.split('.');
  let key: Buffer;
  try {
    key = deriveUnsubscribeSigningKey(payload.ownerSub, signingSecret);
  } catch {
    return { ok: false, error: 'unsubscribe_token_forged' };
  }
  const expected = crypto.createHmac('sha256', key).update(payloadB64, 'utf8').digest();
  const actual = Buffer.from(sigB64, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return { ok: false, error: 'unsubscribe_token_forged' };
  }
  return { ok: true, payload };
}

/**
 * @description Build a per-recipient unsubscribe URL by appending `?token=` to the compliance base URL.
 * @param baseUrl - Owner's configured http(s) unsubscribe base URL.
 * @param token - Signed unsubscribe token.
 * @returns Absolute http(s) URL string, or null when invalid.
 */
export function buildUnsubscribeUrl(baseUrl: unknown, token: string): string | null {
  if (typeof baseUrl !== 'string' || HEADER_CONTROL_RE.test(baseUrl)) return null;
  const safe = safeHttpUrl(baseUrl);
  if (!safe || !token || HEADER_CONTROL_RE.test(token)) return null;
  const parsed = new URL(safe);
  parsed.searchParams.set('token', token);
  return parsed.toString();
}

/**
 * @description Build strictly the RFC 8058 one-click unsubscribe header pair.
 * Refuses non-http(s) URLs, angle brackets, and CR/LF header-injection characters.
 * @param unsubscribeUrl - Absolute http(s) per-recipient unsubscribe URL.
 * @returns Strictly `{ 'List-Unsubscribe', 'List-Unsubscribe-Post' }`.
 */
export function buildRfc8058Headers(unsubscribeUrl: unknown): Rfc8058Headers {
  if (typeof unsubscribeUrl !== 'string' || HEADER_CONTROL_RE.test(unsubscribeUrl)) {
    throw codedError('invalid_unsubscribe_url', 'Unsubscribe URL must be a clean http(s) URL without control characters.');
  }
  const safe = safeHttpUrl(unsubscribeUrl);
  if (!safe || HEADER_CONTROL_RE.test(safe)) {
    throw codedError('invalid_unsubscribe_url', 'Unsubscribe URL must start with https:// or http://.');
  }
  return {
    'List-Unsubscribe': `<${safe}>`,
    'List-Unsubscribe-Post': RFC8058_ONE_CLICK_VALUE,
  };
}

/**
 * @description Validate and normalize a POST /api/marketing/broadcasts draft creation payload.
 * @param raw - Untrusted request body.
 * @returns Normalized draft fields or coded validation error.
 */
export function normalizeBroadcastDraft(
  raw: unknown,
): { ok: true; draft: NormalizedBroadcastDraft } | { ok: false; error: string; message: string } {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const listId = trimBound(src.listId ?? src.list_id, 64);
  if (!UUID_SHAPE_RE.test(listId)) {
    return { ok: false, error: 'invalid_list_id', message: 'A valid target listId UUID is required.' };
  }
  const rawCampaign = trimBound(src.campaignId ?? src.campaign_id, 64);
  if (rawCampaign && !UUID_SHAPE_RE.test(rawCampaign)) {
    return { ok: false, error: 'invalid_campaign_id', message: 'campaignId must be a valid UUID when provided.' };
  }
  const templateRaw = trimBound(src.templateId ?? src.template_id, 32) || 'announcement';
  if (!(MARKETING_TEMPLATE_IDS as readonly string[]).includes(templateRaw)) {
    return { ok: false, error: 'invalid_template_id', message: 'templateId must be announcement, newsletter, or launch.' };
  }
  const subject = trimBound(src.subject, 240);
  if (!subject) return { ok: false, error: 'subject_required', message: 'Broadcast subject is required.' };
  const body = trimBound(src.body, 8000);
  if (!body) return { ok: false, error: 'body_required', message: 'Broadcast body is required.' };
  const rawCtaUrl = trimBound(src.ctaUrl ?? src.cta_url, 2000);
  const ctaUrl = rawCtaUrl ? safeHttpUrl(rawCtaUrl) : '';
  if (rawCtaUrl && !ctaUrl) {
    return { ok: false, error: 'invalid_cta_url', message: 'CTA URL must start with https:// or http://.' };
  }
  return {
    ok: true,
    draft: {
      campaignId: rawCampaign || null,
      listId,
      templateId: templateRaw as MarketingTemplateId,
      subject,
      headline: trimBound(src.headline, 240) || subject,
      intro: trimBound(src.intro, 1200),
      body,
      ctaLabel: trimBound(src.ctaLabel ?? src.cta_label, 120),
      ctaUrl: ctaUrl || '',
    },
  };
}

/**
 * @description Project an oshal_marketing_messages row for API output, strictly omitting signing_secret.
 * @param row - Database row from oshal_marketing_messages.
 * @returns Sanitized broadcast record without secrets.
 */
export function sanitizeBroadcastRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    message_id: row.message_id,
    campaign_id: row.campaign_id ?? null,
    list_id: row.list_id,
    template_id: row.template_id,
    subject: row.subject,
    headline: row.headline ?? '',
    intro: row.intro ?? '',
    body: row.body ?? '',
    cta_label: row.cta_label ?? '',
    cta_url: row.cta_url ?? '',
    status: row.status ?? 'draft',
    stats: row.stats && typeof row.stats === 'object' ? row.stats : {},
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/** Build an initialized zeroed stats record for a given recipient count. */
export function emptyBroadcastStats(totalRecipients: number): BroadcastStats {
  return {
    totalRecipients,
    eligible: 0,
    sent: 0,
    dryRun: 0,
    skippedConsent: 0,
    skippedUnconfirmed: 0,
    skippedSuppressed: 0,
    skippedCompliance: 0,
    skippedCap: 0,
    skippedConfirm: 0,
    error: 0,
  };
}

/** Build a broadcast-level blocked plan mapping every recipient to the same skip status. */
function buildBlockedPlan(
  recipients: BroadcastRecipient[],
  opts: {
    httpStatus: number;
    error: 'skipped_consent' | 'skipped_cap' | 'skipped_compliance' | 'confirmation_required';
    status: 'skipped_consent' | 'skipped_cap' | 'skipped_compliance' | 'skipped_confirm';
    reason: string;
    reasons?: ComplianceLintError[];
  },
): BroadcastPlanResult {
  const stats = emptyBroadcastStats(recipients.length);
  const decisions: BroadcastRecipientDecision[] = recipients.map((r) => ({
    contactId: r.contactId,
    email: r.email,
    emailHash: r.emailHash,
    status: opts.status,
    gateReason: opts.reason,
  }));
  if (opts.status === 'skipped_consent') stats.skippedConsent = recipients.length;
  else if (opts.status === 'skipped_cap') stats.skippedCap = recipients.length;
  else if (opts.status === 'skipped_compliance') stats.skippedCompliance = recipients.length;
  else if (opts.status === 'skipped_confirm') stats.skippedConfirm = recipients.length;
  return {
    blocked: true,
    httpStatus: opts.httpStatus,
    error: opts.error,
    reason: opts.reason,
    ...(opts.reasons ? { reasons: opts.reasons } : {}),
    decisions,
    stats,
  };
}

/** Evaluate Gate 1: owner email channel consent (`enabled === true`, not paused, `daily_cap >= 1`). */
function checkChannelConsentGate(input: PlanBroadcastInput): { blocked?: BroadcastPlanResult; dailyCap: number } {
  const row = input.channelRow;
  const paused = typeof row?.paused_reason === 'string' ? row.paused_reason.trim() : '';
  if (!isChannelEnabled(row) || paused !== '') {
    const reason = paused ? `channel_paused:${paused}` : 'email_channel_consent_off';
    return { blocked: buildBlockedPlan(input.recipients, { httpStatus: 403, error: 'skipped_consent', status: 'skipped_consent', reason }), dailyCap: 0 };
  }
  const dailyCap = Number(row?.daily_cap);
  if (!Number.isFinite(dailyCap) || dailyCap < 1) {
    return { blocked: buildBlockedPlan(input.recipients, { httpStatus: 403, error: 'skipped_cap', status: 'skipped_cap', reason: 'daily_cap_zero' }), dailyCap: 0 };
  }
  return { dailyCap };
}

/** Evaluate Gate 2: compliance settings, template lint, and RFC 8058 unsubscribe URL validity. */
function checkCompliancePreflightGate(input: PlanBroadcastInput): { blocked?: BroadcastPlanResult; settings: ComplianceSettings } {
  const fallbackNorm = normalizeComplianceSettings({}) as { ok: true; settings: ComplianceSettings };
  const norm = normalizeComplianceSettings(input.compliance ?? {});
  const settings = norm.ok ? norm.settings : fallbackNorm.settings;
  const ready = complianceReadiness(settings);
  const probeUrl = ready.unsubscribeReady ? buildUnsubscribeUrl(settings.unsubscribeBaseUrl, 'probe-token') : null;
  let lintErrors: ComplianceLintError[] = [];
  try {
    const rendered = renderMarketingTemplate({
      templateId: input.message.templateId,
      subject: input.message.subject,
      headline: input.message.headline,
      intro: input.message.intro,
      body: input.message.body,
      ctaLabel: input.message.ctaLabel,
      ctaUrl: input.message.ctaUrl,
      unsubscribeUrl: probeUrl || settings.unsubscribeBaseUrl,
    }, settings);
    lintErrors = rendered.compliance.errors;
    if (rendered.compliance.ok && probeUrl) buildRfc8058Headers(probeUrl);
  } catch (err) {
    const e = err as Error & { code?: string };
    lintErrors = [{ code: e.code || 'template_compliance_failed', message: e.message }];
  }
  if (!ready.readyForEmailSend || lintErrors.length > 0 || !probeUrl) {
    const reasons: ComplianceLintError[] = lintErrors.length > 0
      ? lintErrors
      : [{ code: 'compliance_incomplete', message: 'Configure sender identity, physical postal address, and unsubscribe URL in Compliance settings.' }];
    return {
      blocked: buildBlockedPlan(input.recipients, { httpStatus: 422, error: 'skipped_compliance', status: 'skipped_compliance', reason: reasons[0].code, reasons }),
      settings,
    };
  }
  return { settings };
}

/** Render an eligible recipient's multipart email with signed unsubscribe URL and RFC 8058 headers. */
function renderEligibleRecipientEmail(
  recipient: BroadcastRecipient,
  emailHash: string,
  input: PlanBroadcastInput,
  settings: ComplianceSettings,
): BroadcastRecipientDecision {
  const unsubToken = mintUnsubscribeToken({
    ownerSub: input.ownerSub, contactId: recipient.contactId, emailHash,
    listId: input.message.listId, messageId: input.message.messageId,
  }, input.message.signingSecret);
  const unsubUrl = buildUnsubscribeUrl(settings.unsubscribeBaseUrl, unsubToken);
  if (!unsubUrl) {
    return { contactId: recipient.contactId, email: recipient.email, emailHash, status: 'skipped_compliance', gateReason: 'invalid_unsubscribe_url' };
  }
  const headers = buildRfc8058Headers(unsubUrl);
  const rendered = renderMarketingTemplate({
    templateId: input.message.templateId, subject: input.message.subject, headline: input.message.headline,
    intro: input.message.intro, body: input.message.body, ctaLabel: input.message.ctaLabel,
    ctaUrl: input.message.ctaUrl, unsubscribeUrl: unsubUrl,
  }, settings);
  const lint = lintMarketingEmail({ html: rendered.html, text: rendered.text, compliance: settings, unsubscribeUrl: unsubUrl });
  if (!lint.ok) {
    return { contactId: recipient.contactId, email: recipient.email, emailHash, status: 'skipped_compliance', gateReason: lint.errors[0]?.code || 'template_compliance_failed' };
  }
  return {
    contactId: recipient.contactId, email: recipient.email, emailHash, status: 'eligible',
    gateReason: input.dryRun ? 'dry_run_eligible' : 'eligible', unsubscribeUrl: unsubUrl,
    ...(input.dryRun && input.includeUnsubscribePreviewTokens ? { unsubscribeToken: unsubToken } : {}),
    headers, subject: rendered.subject, html: rendered.html, text: rendered.text,
  };
}

/** Evaluate Gate 4 for one recipient: suppression -> confirmed consent -> daily cap -> per-recipient render. */
function evaluateSingleRecipient(
  recipient: BroadcastRecipient,
  input: PlanBroadcastInput,
  settings: ComplianceSettings,
  dailyCap: number,
  plannedEligible: number,
): BroadcastRecipientDecision {
  const emailHash = String(recipient.emailHash || '').trim().toLowerCase();
  if (input.suppressedEmailHashes.has(emailHash) || String(recipient.contactStatus || '') === 'suppressed') {
    return { contactId: recipient.contactId, email: recipient.email, emailHash, status: 'skipped_suppressed', gateReason: 'address_suppressed' };
  }
  if (String(recipient.emailConsentStatus || '') !== 'confirmed') {
    return { contactId: recipient.contactId, email: recipient.email, emailHash, status: 'skipped_unconfirmed', gateReason: 'recipient_consent_not_confirmed' };
  }
  const sentToday = Number.isFinite(input.sentToday) && input.sentToday >= 0 ? input.sentToday : dailyCap;
  if (sentToday + plannedEligible >= dailyCap) {
    return { contactId: recipient.contactId, email: recipient.email, emailHash, status: 'skipped_cap', gateReason: 'daily_cap_reached' };
  }
  return renderEligibleRecipientEmail(recipient, emailHash, input, settings);
}

/**
 * @description Deterministically evaluate the full P1 broadcast send gate chain:
 * 1. Owner email channel consent (`enabled === true` & `daily_cap >= 1`)
 * 2. Compliance settings & multipart template lint (sender identity, postal footer, unsubscribe URL, RFC 8058 headers)
 * 3. Explicit write confirmation (`confirm: true` required for live non-dry-run sends -> 428)
 * 4. Per-recipient gates (suppression -> confirmed email consent -> daily cap -> per-recipient signed unsubscribe URL & render)
 * Guarantees only confirmed, unsuppressed recipients within daily cap are ever eligible, and emits one decision per recipient.
 */
export function planBroadcastDeliveries(input: PlanBroadcastInput): BroadcastPlanResult {
  const channelGate = checkChannelConsentGate(input);
  if (channelGate.blocked) return channelGate.blocked;
  const compGate = checkCompliancePreflightGate(input);
  if (compGate.blocked) return compGate.blocked;
  if (!input.dryRun && !input.confirmed) {
    return buildBlockedPlan(input.recipients, {
      httpStatus: 428, error: 'confirmation_required', status: 'skipped_confirm', reason: 'confirmation_required',
    });
  }
  const stats = emptyBroadcastStats(input.recipients.length);
  const decisions: BroadcastRecipientDecision[] = [];
  for (const recipient of input.recipients) {
    const decision = evaluateSingleRecipient(recipient, input, compGate.settings, channelGate.dailyCap, stats.eligible);
    decisions.push(decision);
    if (decision.status === 'eligible') { stats.eligible += 1; if (input.dryRun) stats.dryRun += 1; }
    else if (decision.status === 'skipped_suppressed') stats.skippedSuppressed += 1;
    else if (decision.status === 'skipped_unconfirmed') stats.skippedUnconfirmed += 1;
    else if (decision.status === 'skipped_cap') stats.skippedCap += 1;
    else if (decision.status === 'skipped_compliance') stats.skippedCompliance += 1;
  }
  return { blocked: false, httpStatus: 200, decisions, stats };
}
