/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Pure P1 audience store domain helpers (zero
 *     I/O, node:crypto only): email normalization and SHA-256 hashing, tag normalization,
 *     structured sign-up consent evidence normalization (formText, recordedAt, ip, userAgent,
 *     utm, tokenHash), deterministic contact segmentation (list, tag, consentState, channel,
 *     purpose, suppressed, search query), and canonical consent-export packaging.
 *
 * @module marketing-audience-model
 */

import * as crypto from 'crypto';

/** @description Supported audience consent and suppression channels. */
export const AUDIENCE_CHANNELS = ['email', 'sms'] as const;

/** @description Valid recipient consent lifecycle states. */
export const CONSENT_STATES = ['pending', 'confirmed', 'revoked'] as const;

/** @description Valid consent filter values including contacts with no consent rows. */
export const CONSENT_FILTER_STATES = ['pending', 'confirmed', 'revoked', 'none'] as const;

/** @description Valid contact statuses. */
export const CONTACT_STATUSES = ['active', 'unsubscribed', 'bounced', 'suppressed'] as const;

/** @description Lowercase 64-character SHA-256 hex digest shape. */
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** @description Conservative email shape matching marketing-support. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @description Structured sign-up evidence captured on a recipient consent row. */
export interface ConsentEvidence {
  formText: string;
  recordedAt: string;
  ip: string | null;
  userAgent: string | null;
  utm: Record<string, string>;
  tokenHash: string | null;
}

/** @description Audience contact hydrated with consents, list memberships, and suppressions. */
export interface HydratedContact {
  contact_id: string;
  owner_sub?: string;
  email: string;
  email_hash: string;
  display_name: string;
  tags: string[];
  status: string;
  metadata: Record<string, unknown>;
  created_at: unknown;
  updated_at: unknown;
  consents: Array<Record<string, unknown>>;
  lists: Array<Record<string, unknown>>;
  suppressions: Array<Record<string, unknown>>;
  suppressed: boolean;
}

/** @description Parsed query filters for audience contact segmentation. */
export interface AudienceSegmentFilters {
  list?: string;
  tag?: string;
  consentState?: 'pending' | 'confirmed' | 'revoked' | 'none';
  channel?: 'email' | 'sms';
  purpose?: string;
  suppressed?: boolean;
  q?: string;
  limit: number;
}

/** @description Canonical consent export payload returned before or during contact deletion. */
export interface ConsentExportBundle {
  exportedAt: string;
  contact: Record<string, unknown>;
  consents: Array<Record<string, unknown>>;
  lists: Array<Record<string, unknown>>;
  suppressions: Array<Record<string, unknown>>;
}

/**
 * @description Normalize an email address by trimming and lowercasing; returns null when invalid.
 * @param raw - Untrusted email candidate.
 * @returns Normalized lowercase email, or null when invalid.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase();
  if (!clean || clean.length > 320 || !EMAIL_RE.test(clean)) return null;
  return clean;
}

/**
 * @description Compute the canonical lowercase SHA-256 hex hash of a trimmed, lowercased address.
 * @param raw - Address string (email or phone identifier).
 * @returns 64-character lowercase hex digest.
 */
export function hashAddress(raw: string): string {
  const normalized = String(raw || '').trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * @description Normalize a tag list into unique lowercase bounded strings.
 * @param raw - Candidate tag array or comma-delimited string.
 * @returns Deduplicated array of at most 50 tags.
 */
export function normalizeTags(raw: unknown): string[] {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of items) {
    if (typeof entry !== 'string') continue;
    const tag = entry.trim().toLowerCase().slice(0, 64);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * @description Normalize a UTM parameter map into bounded string key/value pairs.
 * @param raw - Candidate UTM object.
 * @returns Clean map of UTM keys to bounded strings.
 */
export function normalizeUtm(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim().toLowerCase().slice(0, 64);
    if (!key || typeof v !== 'string') continue;
    const val = v.trim().slice(0, 256);
    if (val) out[key] = val;
    if (Object.keys(out).length >= 12) break;
  }
  return out;
}

/**
 * @description Normalize sign-up consent evidence JSON, preserving formText, recordedAt, ip,
 * userAgent, utm, and tokenHash.
 * @param raw - Caller-provided evidence object.
 * @param fallback - Request-derived defaults for ip, userAgent, and recordedAt.
 * @returns Normalized ConsentEvidence record.
 */
export function normalizeConsentEvidence(
  raw: unknown,
  fallback?: { ip?: string; userAgent?: string; recordedAt?: string },
): ConsentEvidence {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const text = (v: unknown, max: number): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null;
  const recordedCandidate = text(src.recordedAt ?? src.time, 64) ?? fallback?.recordedAt ?? new Date().toISOString();
  const recordedAt = Number.isFinite(Date.parse(recordedCandidate))
    ? new Date(Date.parse(recordedCandidate)).toISOString()
    : new Date().toISOString();
  const rawTokenHash = text(src.tokenHash ?? src.token_hash, 128);
  return {
    formText: text(src.formText ?? src.form_text, 4000) ?? '',
    recordedAt,
    ip: text(src.ip, 128) ?? text(fallback?.ip, 128),
    userAgent: text(src.userAgent ?? src.user_agent, 512) ?? text(fallback?.userAgent, 512),
    utm: normalizeUtm(src.utm),
    tokenHash: rawTokenHash ? rawTokenHash.toLowerCase() : null,
  };
}

/**
 * @description Parse and validate GET /audience/contacts segmentation query parameters.
 * @param query - Express query object.
 * @returns Validated AudienceSegmentFilters or a structured error code.
 */
export function parseAudienceFilters(
  query: Record<string, unknown>,
): { filters?: AudienceSegmentFilters; error?: string } {
  const str = (k: string): string | undefined => {
    const v = query[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  const consentState = str('consentState') ?? str('consent_state');
  if (consentState && !(CONSENT_FILTER_STATES as readonly string[]).includes(consentState)) {
    return { error: 'invalid_consent_state' };
  }
  const channel = str('channel');
  if (channel && !(AUDIENCE_CHANNELS as readonly string[]).includes(channel)) {
    return { error: 'invalid_channel' };
  }
  const suppressedRaw = str('suppressed');
  let suppressed: boolean | undefined;
  if (suppressedRaw !== undefined) {
    if (suppressedRaw === 'true') suppressed = true;
    else if (suppressedRaw === 'false') suppressed = false;
    else return { error: 'invalid_suppressed_filter' };
  }
  const limitRaw = query.limit !== undefined ? Number(query.limit) : 200;
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 500 ? limitRaw : 200;
  return {
    filters: {
      list: str('list'),
      tag: str('tag')?.toLowerCase(),
      consentState: consentState as AudienceSegmentFilters['consentState'],
      channel: channel as AudienceSegmentFilters['channel'],
      purpose: str('purpose')?.toLowerCase(),
      suppressed,
      q: str('q')?.toLowerCase(),
      limit,
    },
  };
}

/** Check whether a contact matches list, tag, suppression, and search criteria. */
function matchesProfileFilters(contact: HydratedContact, filters: AudienceSegmentFilters): boolean {
  if (filters.list) {
    const target = filters.list.toLowerCase();
    const inList = contact.lists.some(
      (l) => String(l.list_id || '').toLowerCase() === target || String(l.slug || '').toLowerCase() === target,
    );
    if (!inList) return false;
  }
  if (filters.tag && !contact.tags.map((t) => t.toLowerCase()).includes(filters.tag)) return false;
  if (filters.suppressed !== undefined && contact.suppressed !== filters.suppressed) return false;
  if (filters.q) {
    const hay = `${contact.email} ${contact.display_name} ${contact.tags.join(' ')}`.toLowerCase();
    if (!hay.includes(filters.q)) return false;
  }
  return true;
}

/** Check whether a contact's consent history matches channel, purpose, and latest consentState. */
function matchesConsentFilters(contact: HydratedContact, filters: AudienceSegmentFilters): boolean {
  if (!filters.consentState && !filters.channel && !filters.purpose) return true;
  const relevant = contact.consents.filter((c) => {
    if (filters.channel && String(c.channel || '') !== filters.channel) return false;
    if (filters.purpose && String(c.purpose || '').toLowerCase() !== filters.purpose) return false;
    return true;
  });
  if (filters.consentState === 'none') return relevant.length === 0;
  if (relevant.length === 0) return false;
  if (!filters.consentState) return true;
  const latest = relevant[0];
  return String(latest?.status || '') === filters.consentState;
}

/**
 * @description Test whether one hydrated contact matches all active segmentation filters.
 * @param contact - Contact with attached consents, lists, and suppressions.
 * @param filters - Validated segmentation filters.
 * @returns True when the contact belongs to the segment.
 */
export function matchesSegment(contact: HydratedContact, filters: AudienceSegmentFilters): boolean {
  return matchesProfileFilters(contact, filters) && matchesConsentFilters(contact, filters);
}

/**
 * @description Filter and bound a list of hydrated contacts by segmentation filters.
 * @param contacts - Owner-scoped hydrated contacts.
 * @param filters - Validated segmentation filters.
 * @returns Matching contacts up to filters.limit.
 */
export function segmentContacts(contacts: HydratedContact[], filters: AudienceSegmentFilters): HydratedContact[] {
  return contacts.filter((c) => matchesSegment(c, filters)).slice(0, filters.limit);
}

/**
 * @description Build the canonical consent-evidence export bundle for a single contact.
 * @param contact - Contact row.
 * @param consents - Consent rows for the contact.
 * @param lists - List membership rows joined with list metadata.
 * @param suppressions - Suppression rows matching the contact's email_hash.
 * @param exportedAt - Optional ISO timestamp override.
 * @returns Structured export bundle preserving all recorded sign-up evidence.
 */
export function buildConsentExport(
  contact: Record<string, unknown>,
  consents: Array<Record<string, unknown>>,
  lists: Array<Record<string, unknown>>,
  suppressions: Array<Record<string, unknown>>,
  exportedAt = new Date().toISOString(),
): ConsentExportBundle {
  return {
    exportedAt,
    contact: {
      contact_id: contact.contact_id,
      email: contact.email,
      email_hash: contact.email_hash,
      display_name: contact.display_name ?? '',
      tags: Array.isArray(contact.tags) ? contact.tags : [],
      status: contact.status ?? 'active',
      metadata: contact.metadata && typeof contact.metadata === 'object' ? contact.metadata : {},
      created_at: contact.created_at ?? null,
      updated_at: contact.updated_at ?? null,
    },
    consents: consents.map((c) => ({
      consent_id: c.consent_id,
      channel: c.channel,
      purpose: c.purpose,
      status: c.status,
      evidence: c.evidence && typeof c.evidence === 'object' ? c.evidence : {},
      created_at: c.created_at ?? null,
      updated_at: c.updated_at ?? null,
    })),
    lists: lists.map((l) => ({
      list_id: l.list_id,
      slug: l.slug ?? null,
      name: l.name ?? null,
      added_at: l.added_at ?? null,
    })),
    suppressions: suppressions.map((s) => ({
      suppression_id: s.suppression_id,
      channel: s.channel,
      address_hash: s.address_hash,
      reason: s.reason,
      source: s.source ?? 'manual',
      created_at: s.created_at ?? null,
    })),
  };
}
