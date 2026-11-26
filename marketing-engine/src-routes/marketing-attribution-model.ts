/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Pure P5 attribution, first-touch conversion,
 *     and per-campaign messaging engagement rollup model for marketing-engine 0.6.9 (zero DB,
 *     zero network): extractEventAttribution (URL query + payload UTM extraction),
 *     extractFirstTouchFromConsents, normalizeConversionInput (strict integer cents and
 *     immutable first-touch preservation), parseDeliveryEventInput, and buildAttributionFunnel
 *     (attributed traffic by campaign/medium/source, first-touch conversions/revenue, and
 *     per-campaign delivered/clicked/unsubscribed/bounced/complained counts with explicit
 *     NO DATA when a campaign has zero recorded broadcasts or traffic; opens omitted as
 *     unreliable).
 *
 * @module marketing-attribution-model
 */

import { normalizeEmail } from './marketing-audience-model';

/** @description Allowed conversion event kinds. */
export const CONVERSION_KINDS = ['signup', 'purchase', 'activation'] as const;
export type ConversionKind = (typeof CONVERSION_KINDS)[number];

/** @description Allowed delivery engagement event kinds (opens deliberately excluded). */
export const DELIVERY_EVENT_KINDS = ['clicked', 'bounced', 'complained', 'unsubscribed'] as const;
export type DeliveryEventKind = (typeof DELIVERY_EVENT_KINDS)[number];

/** @description Plain explanation for why email open rates are omitted. */
export const OPENS_OMITTED_NOTE = 'Opens are omitted as unreliable';

const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AMOUNT_CENTS = 100_000_000_000;
const UTM_CANONICAL_KEYS = [
  ['utm_source', 'source'],
  ['utm_medium', 'medium'],
  ['utm_campaign', 'campaign'],
  ['utm_term', 'term'],
  ['utm_content', 'content'],
] as const;

/** @description Extracted campaign/medium/source attribution tuple. */
export interface EventAttribution {
  campaignSlug: string | null;
  medium: string | null;
  source: string | null;
}

/** @description Immutable first-touch attribution snapshot derived from prior sign-up evidence. */
export interface FirstTouchAttribution extends EventAttribution {
  utm: Record<string, string>;
}

/** @description Validated conversion input ready for persistence. */
export interface NormalizedConversionInput {
  kind: ConversionKind;
  contactId: string | null;
  email: string | null;
  campaignSlug: string | null;
  medium: string | null;
  source: string | null;
  amountCents: number;
  referenceId: string | null;
  utm: Record<string, string>;
  occurredAt: string;
  firstTouchApplied: boolean;
}

/** @description Validated delivery engagement event payload. */
export interface ParsedDeliveryEvent {
  event: DeliveryEventKind;
  occurredAt: string;
  reason: string;
}

/** @description Per-campaign traffic rollup (NO DATA when zero rows match). */
export interface CampaignTrafficRollup {
  status: 'ok' | 'NO DATA';
  visits: number;
  impressions: number;
  events: number;
  byMedium: Record<string, number>;
  bySource: Record<string, number>;
}

/** @description Per-campaign first-touch conversion rollup. */
export interface CampaignConversionRollup {
  status: 'ok' | 'NO DATA';
  total: number;
  signups: number;
  purchases: number;
  activations: number;
  revenueCents: number;
}

/** @description Per-campaign messaging engagement rollup (NO DATA when zero deliveries sent). */
export interface CampaignEngagementRollup {
  status: 'ok' | 'NO DATA';
  delivered: number;
  clicked: number;
  unsubscribed: number;
  bounced: number;
  complained: number;
  opensNote: string;
}

/** @description One campaign row on the attribution funnel scorecard. */
export interface AttributionFunnelCampaignRow {
  campaignId: string | null;
  campaignSlug: string;
  campaignName: string;
  campaignStatus: string | null;
  traffic: CampaignTrafficRollup;
  conversions: CampaignConversionRollup;
  engagement: CampaignEngagementRollup;
}

/** @description Complete attribution funnel and per-campaign engagement scorecard payload. */
export interface AttributionFunnelResult {
  opensNote: string;
  totals: {
    attributedVisits: number;
    unattributedVisits: number;
    signups: number;
    purchases: number;
    activations: number;
    revenueCents: number;
    delivered: number;
    clicked: number;
    unsubscribed: number;
    bounced: number;
    complained: number;
  };
  campaigns: AttributionFunnelCampaignRow[];
  unattributed: {
    traffic: CampaignTrafficRollup;
    conversions: CampaignConversionRollup;
    engagement: CampaignEngagementRollup;
  };
}

/** @description Sanitize a campaign slug (lowercased, bounded 80 chars, or null). */
export function sanitizeCampaignSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 80);
  return cleaned || null;
}

/** @description Sanitize an attribution medium or source token (lowercased, bounded 64 chars, or null). */
export function sanitizeMedium(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 64);
  return cleaned || null;
}

/** @description Extract utm_* parameters from an absolute http(s) URL or relative query string. */
export function extractUtmFromUrl(rawUrl: unknown): Record<string, string> {
  if (typeof rawUrl !== 'string') return {};
  const trimmed = rawUrl.trim();
  if (!trimmed || !trimmed.includes('?')) return {};
  let parsed: URL;
  try {
    parsed = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(trimmed.startsWith('/') ? trimmed : `/${trimmed}`, 'https://example.invalid');
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [canon] of UTM_CANONICAL_KEYS) {
    const val = parsed.searchParams.get(canon);
    if (val && val.trim()) out[canon] = val.trim().slice(0, 128);
  }
  return out;
}

/** @description Normalize a UTM map into canonical utm_* string keys. */
export function normalizeUtmMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const [canon, shortKey] of UTM_CANONICAL_KEYS) {
    const val = src[canon] ?? src[shortKey];
    if (typeof val === 'string' && val.trim()) {
      out[canon] = val.trim().slice(0, 128);
    }
  }
  return out;
}

/** Collect candidate URL strings from an ingest event object and its meta/keys fields. */
function candidateUrlsFromEvent(src: Record<string, unknown>, meta: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.includes('?')) urls.push(v);
  };
  for (const k of ['url', 'page', 'pageUrl', 'landingUrl', 'referrer', 'utmUrl', 'utm_url']) {
    push(src[k]);
    push(meta[k]);
  }
  for (const list of [src.keys, meta.keys]) {
    if (Array.isArray(list)) {
      for (const item of list) push(item);
    }
  }
  return urls;
}

/**
 * @description Extract sanitized campaignSlug, medium, and source from an incoming ingest
 * event payload (direct fields, nested utm/meta objects, or URL query parameters).
 * Preserves null for any unattributed field.
 */
export function extractEventAttribution(rawEvent: unknown): EventAttribution {
  if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
    return { campaignSlug: null, medium: null, source: null };
  }
  const src = rawEvent as Record<string, unknown>;
  const meta = (src.meta && typeof src.meta === 'object' && !Array.isArray(src.meta)
    ? src.meta : {}) as Record<string, unknown>;
  const utm = {
    ...normalizeUtmMap(meta.utm),
    ...normalizeUtmMap(src.utm),
  };
  const urlUtm: Record<string, string> = {};
  for (const u of candidateUrlsFromEvent(src, meta)) {
    Object.assign(urlUtm, extractUtmFromUrl(u));
  }
  const campaignSlug = sanitizeCampaignSlug(
    src.campaignSlug ?? src.campaign_slug ?? src.utm_campaign ?? src.utmCampaign ?? src.campaign
      ?? meta.campaignSlug ?? meta.campaign_slug ?? meta.utm_campaign ?? meta.campaign
      ?? utm.utm_campaign ?? urlUtm.utm_campaign,
  );
  const medium = sanitizeMedium(
    src.medium ?? src.utm_medium ?? src.utmMedium
      ?? meta.medium ?? meta.utm_medium
      ?? utm.utm_medium ?? urlUtm.utm_medium,
  );
  const source = sanitizeMedium(
    src.utm_source ?? src.utmSource ?? meta.utm_source ?? utm.utm_source ?? urlUtm.utm_source,
  );
  return { campaignSlug, medium, source };
}

/**
 * @description Extract immutable first-touch attribution from chronologically ordered consent rows.
 */
export function extractFirstTouchFromConsents(
  consentRows: Array<Record<string, unknown>>,
): FirstTouchAttribution {
  for (const row of Array.isArray(consentRows) ? consentRows : []) {
    const ev = (row?.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)
      ? row.evidence : {}) as Record<string, unknown>;
    const utm = normalizeUtmMap(ev.utm ?? ev);
    const campaignSlug = sanitizeCampaignSlug(utm.utm_campaign ?? ev.campaignSlug ?? ev.campaign_slug);
    const medium = sanitizeMedium(utm.utm_medium ?? ev.medium);
    const source = sanitizeMedium(utm.utm_source ?? ev.source);
    if (campaignSlug || medium || source) {
      return { campaignSlug, medium, source, utm };
    }
  }
  return { campaignSlug: null, medium: null, source: null, utm: {} };
}

/** Validate optional amountCents integer field (defaults to 0). */
function parseAmountCents(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return 0;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_AMOUNT_CENTS) return null;
  return n;
}

/** Validate optional ISO-8601 occurredAt timestamp (defaults to nowIso). */
function parseIsoTimestamp(raw: unknown, nowIso: string): string | null {
  if (raw === undefined || raw === null || raw === '') return nowIso;
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Validate optional contactId, email, amountCents, and occurredAt fields on conversion input. */
function parseConversionCoreFields(
  src: Record<string, unknown>,
  nowIso: string,
): { ok: true; contactId: string | null; email: string | null; amountCents: number; occurredAt: string }
  | { ok: false; error: string; message: string } {
  const rawContactId = src.contactId ?? src.contact_id;
  let contactId: string | null = null;
  if (rawContactId !== undefined && rawContactId !== null && rawContactId !== '') {
    if (typeof rawContactId !== 'string' || !UUID_SHAPE_RE.test(rawContactId.trim())) {
      return { ok: false, error: 'invalid_contact_id', message: 'contactId must be a valid UUID.' };
    }
    contactId = rawContactId.trim();
  }
  let email: string | null = null;
  if (src.email !== undefined && src.email !== null && src.email !== '') {
    email = normalizeEmail(src.email);
    if (!email) return { ok: false, error: 'invalid_email', message: 'email must be a valid address.' };
  }
  const amountCents = parseAmountCents(src.amountCents ?? src.amount_cents);
  if (amountCents === null) {
    return { ok: false, error: 'invalid_amount_cents', message: 'amountCents must be a non-negative integer.' };
  }
  const occurredAt = parseIsoTimestamp(src.occurredAt ?? src.occurred_at, nowIso);
  if (!occurredAt) {
    return { ok: false, error: 'invalid_occurred_at', message: 'occurredAt must be a valid ISO-8601 timestamp.' };
  }
  return { ok: true, contactId, email, amountCents, occurredAt };
}

/** Merge explicit conversion attribution with immutable first-touch consent UTM fallback. */
function mergeFirstTouchAttribution(
  src: Record<string, unknown>,
  firstTouch?: Partial<FirstTouchAttribution> | null,
): {
  campaignSlug: string | null;
  medium: string | null;
  source: string | null;
  utm: Record<string, string>;
  firstTouchApplied: boolean;
} {
  const explicitUtm = { ...normalizeUtmMap(src), ...normalizeUtmMap(src.utm) };
  const explicitCampaign = sanitizeCampaignSlug(src.campaignSlug ?? src.campaign_slug ?? explicitUtm.utm_campaign);
  const explicitMedium = sanitizeMedium(src.medium ?? explicitUtm.utm_medium);
  const explicitSource = sanitizeMedium(src.source ?? explicitUtm.utm_source);
  const ftCampaign = sanitizeCampaignSlug(firstTouch?.campaignSlug);
  const ftMedium = sanitizeMedium(firstTouch?.medium);
  const ftSource = sanitizeMedium(firstTouch?.source);
  const firstTouchApplied = !explicitCampaign && Boolean(ftCampaign);
  const utm = { ...normalizeUtmMap(firstTouch?.utm), ...explicitUtm };
  const campaignSlug = explicitCampaign ?? ftCampaign;
  const medium = explicitMedium ?? ftMedium;
  const source = explicitSource ?? ftSource;
  if (campaignSlug && !utm.utm_campaign) utm.utm_campaign = campaignSlug;
  if (medium && !utm.utm_medium) utm.utm_medium = medium;
  if (source && !utm.utm_source) utm.utm_source = source;
  return { campaignSlug, medium, source, utm, firstTouchApplied };
}

/**
 * @description Validate and normalize a conversion event, resolving first-touch attribution
 * from prior sign-up consent UTM evidence whenever not explicitly supplied.
 */
export function normalizeConversionInput(
  raw: unknown,
  firstTouch?: Partial<FirstTouchAttribution> | null,
  nowIso: string = new Date().toISOString(),
): { ok: true; conversion: NormalizedConversionInput } | { ok: false; error: string; message: string } {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const kindRaw = typeof src.kind === 'string' ? src.kind.trim().toLowerCase() : '';
  if (!(CONVERSION_KINDS as readonly string[]).includes(kindRaw)) {
    return { ok: false, error: 'invalid_conversion_kind', message: 'kind must be signup, purchase, or activation.' };
  }
  const core = parseConversionCoreFields(src, nowIso);
  if (!core.ok) return core;
  const attr = mergeFirstTouchAttribution(src, firstTouch);
  const rawRef = src.referenceId ?? src.reference_id;
  const referenceId = typeof rawRef === 'string' && rawRef.trim() ? rawRef.trim().slice(0, 160) : null;
  return {
    ok: true,
    conversion: {
      kind: kindRaw as ConversionKind,
      contactId: core.contactId,
      email: core.email,
      campaignSlug: attr.campaignSlug,
      medium: attr.medium,
      source: attr.source,
      amountCents: core.amountCents,
      referenceId,
      utm: attr.utm,
      occurredAt: core.occurredAt,
      firstTouchApplied: attr.firstTouchApplied,
    },
  };
}

/**
 * @description Validate a delivery engagement event payload (clicked, bounced, complained, unsubscribed).
 */
export function parseDeliveryEventInput(
  raw: unknown,
  nowIso: string = new Date().toISOString(),
): { ok: true; parsed: ParsedDeliveryEvent } | { ok: false; error: string; message: string } {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const eventRaw = typeof (src.event ?? src.type) === 'string'
    ? String(src.event ?? src.type).trim().toLowerCase() : '';
  if (!(DELIVERY_EVENT_KINDS as readonly string[]).includes(eventRaw)) {
    return {
      ok: false,
      error: 'invalid_delivery_event',
      message: 'event must be clicked, bounced, complained, or unsubscribed.',
    };
  }
  const occurredAt = parseIsoTimestamp(src.occurredAt ?? src.occurred_at, nowIso);
  if (!occurredAt) {
    return { ok: false, error: 'invalid_occurred_at', message: 'occurredAt must be a valid ISO-8601 timestamp.' };
  }
  const reason = typeof src.reason === 'string' ? src.reason.trim().slice(0, 200) : '';
  return { ok: true, parsed: { event: eventRaw as DeliveryEventKind, occurredAt, reason } };
}

/** Create an empty traffic bucket (honest NO DATA until a real row is folded in). */
function emptyTraffic(): CampaignTrafficRollup {
  return { status: 'NO DATA', visits: 0, impressions: 0, events: 0, byMedium: {}, bySource: {} };
}

/** Create an empty conversion bucket (honest NO DATA until a real row is folded in). */
function emptyConversions(): CampaignConversionRollup {
  return { status: 'NO DATA', total: 0, signups: 0, purchases: 0, activations: 0, revenueCents: 0 };
}

/** Create an empty engagement bucket (honest NO DATA until a real delivery is recorded). */
function emptyEngagement(): CampaignEngagementRollup {
  return {
    status: 'NO DATA',
    delivered: 0,
    clicked: 0,
    unsubscribed: 0,
    bounced: 0,
    complained: 0,
    opensNote: OPENS_OMITTED_NOTE,
  };
}

/** Fold one metrics event row into a traffic rollup bucket. */
function foldTrafficRow(bucket: CampaignTrafficRollup, ev: Record<string, unknown>): number {
  const eventName = String(ev.event || '').toLowerCase();
  const rawVal = Number(ev.value ?? 0);
  const val = Number.isFinite(rawVal) && rawVal >= 0 ? Math.round(rawVal * 100) / 100 : 0;
  bucket.status = 'ok';
  bucket.events += 1;
  if (eventName === 'impressions') {
    bucket.impressions = Math.round((bucket.impressions + val) * 100) / 100;
    return 0;
  }
  bucket.visits = Math.round((bucket.visits + val) * 100) / 100;
  const medium = sanitizeMedium(ev.medium) ?? 'unattributed';
  const source = sanitizeMedium(ev.source) ?? 'unknown';
  bucket.byMedium[medium] = Math.round(((bucket.byMedium[medium] ?? 0) + val) * 100) / 100;
  bucket.bySource[source] = Math.round(((bucket.bySource[source] ?? 0) + val) * 100) / 100;
  return val;
}

/** Fold one conversion row into a conversion rollup bucket. */
function foldConversionRow(bucket: CampaignConversionRollup, row: Record<string, unknown>): void {
  const kind = String(row.kind || '').toLowerCase();
  const cents = Math.max(0, Math.round(Number(row.amount_cents ?? row.amountCents ?? 0) || 0));
  bucket.status = 'ok';
  bucket.total += 1;
  if (kind === 'signup') bucket.signups += 1;
  else if (kind === 'purchase') bucket.purchases += 1;
  else if (kind === 'activation') bucket.activations += 1;
  bucket.revenueCents += cents;
}

/** Fold one delivery ledger row into a messaging engagement rollup bucket. */
function foldDeliveryRow(bucket: CampaignEngagementRollup, row: Record<string, unknown>): void {
  const status = String(row.status || '').toLowerCase();
  const hasEvent = Boolean(row.clicked_at || row.bounced_at || row.complained_at || row.unsubscribed_at);
  if (status !== 'sent' && !hasEvent) return;
  bucket.status = 'ok';
  if (status === 'sent') bucket.delivered += 1;
  if (row.clicked_at) bucket.clicked += 1;
  if (row.unsubscribed_at) bucket.unsubscribed += 1;
  if (row.bounced_at) bucket.bounced += 1;
  if (row.complained_at) bucket.complained += 1;
}

/** Ensure a campaign entry exists in the funnel map for a sanitized slug. */
function ensureCampaignBucket(
  bySlug: Map<string, AttributionFunnelCampaignRow>,
  slug: string,
): AttributionFunnelCampaignRow {
  let row = bySlug.get(slug);
  if (!row) {
    row = {
      campaignId: null,
      campaignSlug: slug,
      campaignName: slug,
      campaignStatus: null,
      traffic: emptyTraffic(),
      conversions: emptyConversions(),
      engagement: emptyEngagement(),
    };
    bySlug.set(slug, row);
  }
  return row;
}

/** Seed per-campaign buckets and campaign_id -> slug lookup map. */
function seedCampaignBuckets(
  campaigns: Array<Record<string, unknown>>,
): { bySlug: Map<string, AttributionFunnelCampaignRow>; slugByCampaignId: Map<string, string> } {
  const bySlug = new Map<string, AttributionFunnelCampaignRow>();
  const slugByCampaignId = new Map<string, string>();
  for (const camp of campaigns) {
    const slug = sanitizeCampaignSlug(camp?.slug);
    if (!slug) continue;
    const cid = camp?.campaign_id ? String(camp.campaign_id) : null;
    if (cid) slugByCampaignId.set(cid, slug);
    bySlug.set(slug, {
      campaignId: cid,
      campaignSlug: slug,
      campaignName: typeof camp?.name === 'string' && camp.name.trim() ? camp.name.trim() : slug,
      campaignStatus: typeof camp?.status === 'string' ? camp.status : null,
      traffic: emptyTraffic(),
      conversions: emptyConversions(),
      engagement: emptyEngagement(),
    });
  }
  return { bySlug, slugByCampaignId };
}

/** Aggregate funnel totals across all campaigns plus the unattributed bucket. */
function sumFunnelTotals(
  campaigns: AttributionFunnelCampaignRow[],
  unattributed: { conversions: CampaignConversionRollup; engagement: CampaignEngagementRollup },
  attributedVisits: number,
  unattributedVisits: number,
): AttributionFunnelResult['totals'] {
  const totals = {
    attributedVisits,
    unattributedVisits,
    signups: unattributed.conversions.signups,
    purchases: unattributed.conversions.purchases,
    activations: unattributed.conversions.activations,
    revenueCents: unattributed.conversions.revenueCents,
    delivered: unattributed.engagement.delivered,
    clicked: unattributed.engagement.clicked,
    unsubscribed: unattributed.engagement.unsubscribed,
    bounced: unattributed.engagement.bounced,
    complained: unattributed.engagement.complained,
  };
  for (const c of campaigns) {
    totals.signups += c.conversions.signups;
    totals.purchases += c.conversions.purchases;
    totals.activations += c.conversions.activations;
    totals.revenueCents += c.conversions.revenueCents;
    totals.delivered += c.engagement.delivered;
    totals.clicked += c.engagement.clicked;
    totals.unsubscribed += c.engagement.unsubscribed;
    totals.bounced += c.engagement.bounced;
    totals.complained += c.engagement.complained;
  }
  return totals;
}

/**
 * @description Compute per-campaign attribution funnel (traffic by campaign/medium/source,
 * first-touch conversions & revenue, and email/SMS messaging engagement from the delivery
 * ledger) plus unattributed bucket. Campaigns with zero recorded broadcasts or traffic carry
 * explicit `status: 'NO DATA'`; opens are deliberately omitted as unreliable.
 */
export function buildAttributionFunnel(input: {
  campaigns?: Array<Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
  conversions?: Array<Record<string, unknown>>;
  deliveries?: Array<Record<string, unknown>>;
}): AttributionFunnelResult {
  const { bySlug, slugByCampaignId } = seedCampaignBuckets(Array.isArray(input?.campaigns) ? input.campaigns : []);
  const unattributed = {
    traffic: emptyTraffic(),
    conversions: emptyConversions(),
    engagement: emptyEngagement(),
  };
  let attributedVisits = 0;
  let unattributedVisits = 0;
  for (const ev of Array.isArray(input?.events) ? input.events : []) {
    const slug = sanitizeCampaignSlug(ev?.campaign_slug ?? ev?.campaignSlug);
    if (slug) {
      attributedVisits = Math.round((attributedVisits + foldTrafficRow(ensureCampaignBucket(bySlug, slug).traffic, ev)) * 100) / 100;
    } else {
      unattributedVisits = Math.round((unattributedVisits + foldTrafficRow(unattributed.traffic, ev)) * 100) / 100;
    }
  }
  for (const conv of Array.isArray(input?.conversions) ? input.conversions : []) {
    const slug = sanitizeCampaignSlug(conv?.campaign_slug ?? conv?.campaignSlug);
    foldConversionRow(slug ? ensureCampaignBucket(bySlug, slug).conversions : unattributed.conversions, conv);
  }
  for (const del of Array.isArray(input?.deliveries) ? input.deliveries : []) {
    const cid = del?.campaign_id ? String(del.campaign_id) : '';
    const slug = sanitizeCampaignSlug(del?.campaign_slug ?? del?.campaignSlug) ?? (cid ? slugByCampaignId.get(cid) ?? null : null);
    foldDeliveryRow(slug ? ensureCampaignBucket(bySlug, slug).engagement : unattributed.engagement, del);
  }
  const campaigns = [...bySlug.values()].sort((a, b) => a.campaignSlug.localeCompare(b.campaignSlug));
  const totals = sumFunnelTotals(campaigns, unattributed, attributedVisits, unattributedVisits);
  return { opensNote: OPENS_OMITTED_NOTE, totals, campaigns, unattributed };
}
