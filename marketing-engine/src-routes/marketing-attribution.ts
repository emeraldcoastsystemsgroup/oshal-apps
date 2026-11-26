/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.9 P5 attribution and
 *     per-campaign engagement routes under /api/marketing (oidc):
 *     GET /attribution/funnel (read-only per-campaign visits, first-touch sign-ups/purchases/
 *     activations/revenue, and delivery engagement counts with explicit NO DATA where nothing
 *     was sent), POST /attribution/conversions (records first-touch conversion resolving prior
 *     sign-up consent UTM evidence when not explicitly supplied), and
 *     POST /deliveries/:deliveryId/event (records clicked/bounced/complained/unsubscribed on
 *     an owned delivery row and suppresses/revokes automatically on bounce, complaint, or
 *     unsubscribe). Mirrors migrations/010-marketing-attribution.sql at the lazy-DDL chokepoint.
 *
 * @module marketing-attribution
 */

import type { Request, Response, Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { runRuntimeSchemaBootstrap, buildOwnerRlsPolicyStatements } from '@/shared/services/database';
import { hashAddress } from './marketing-audience-model';
import {
  buildAttributionFunnel,
  extractFirstTouchFromConsents,
  normalizeConversionInput,
  parseDeliveryEventInput,
  sanitizeCampaignSlug,
  type DeliveryEventKind,
  type FirstTouchAttribution,
} from './marketing-attribution-model';
import { UUID_RE, authed, logger, rows, safeRows, type QueryablePool } from './marketing-support';

/** Lazy-DDL mirror of migrations/010-marketing-attribution.sql. */
const ATTRIBUTION_TABLE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS oshal_marketing_conversions (
    conversion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    contact_id UUID REFERENCES oshal_marketing_contacts (contact_id) ON DELETE SET NULL,
    campaign_slug TEXT,
    medium TEXT,
    source TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('signup','purchase','activation')),
    amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    reference_id TEXT,
    utm JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_conversions_owner_campaign
    ON oshal_marketing_conversions (owner_sub, campaign_slug, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_conversions_owner_contact
    ON oshal_marketing_conversions (owner_sub, contact_id, occurred_at ASC)`,
  'ALTER TABLE oshal_marketing_deliveries ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ',
  'ALTER TABLE oshal_marketing_deliveries ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ',
  'ALTER TABLE oshal_marketing_deliveries ADD COLUMN IF NOT EXISTS complained_at TIMESTAMPTZ',
  'ALTER TABLE oshal_marketing_deliveries ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ',
];

const DELIVERY_EVENT_COLUMN: Record<DeliveryEventKind, string> = {
  clicked: 'clicked_at',
  bounced: 'bounced_at',
  complained: 'complained_at',
  unsubscribed: 'unsubscribed_at',
};

/**
 * @description Ensure the 010-marketing-attribution schema + exact-owner FORCE RLS at lazy DDL.
 */
export async function ensureAttributionSchema(pool: AppContext['pool']): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'marketing-attribution',
    statements: [
      ...ATTRIBUTION_TABLE_DDL,
      ...buildOwnerRlsPolicyStatements('oshal_marketing_conversions', 'owner_sub'),
    ],
    requirements: [
      {
        table: 'oshal_marketing_conversions',
        columns: ['conversion_id', 'owner_sub', 'contact_id', 'campaign_slug', 'medium', 'kind', 'amount_cents'],
      },
      {
        table: 'oshal_marketing_deliveries',
        columns: ['clicked_at', 'bounced_at', 'complained_at', 'unsubscribed_at'],
      },
    ],
  });
}

/** Resolve first-touch attribution from a contact's earliest consent UTM evidence or prior conversion. */
async function loadContactFirstTouch(
  pool: QueryablePool,
  sub: string,
  contactId: string,
): Promise<FirstTouchAttribution> {
  const consentRows = await safeRows(
    pool,
    `SELECT evidence, created_at
       FROM oshal_marketing_consents
      WHERE owner_sub = $1 AND contact_id = $2
      ORDER BY created_at ASC
      LIMIT 50`,
    [sub, contactId],
  );
  const fromConsents = extractFirstTouchFromConsents(consentRows);
  if (fromConsents.campaignSlug) return fromConsents;

  const priorRows = await safeRows(
    pool,
    `SELECT campaign_slug, medium, source, utm
       FROM oshal_marketing_conversions
      WHERE owner_sub = $1 AND contact_id = $2 AND campaign_slug IS NOT NULL
      ORDER BY occurred_at ASC, created_at ASC
      LIMIT 1`,
    [sub, contactId],
  );
  const prior = priorRows[0];
  if (prior && prior.campaign_slug) {
    return {
      campaignSlug: sanitizeCampaignSlug(prior.campaign_slug),
      medium: typeof prior.medium === 'string' ? prior.medium : null,
      source: typeof prior.source === 'string' ? prior.source : null,
      utm: (prior.utm && typeof prior.utm === 'object' ? prior.utm : {}) as Record<string, string>,
    };
  }
  return fromConsents;
}

/**
 * @description Record an automatic first-touch sign-up conversion row when a sign-up carries UTM
 * attribution (non-fatal best-effort if the conversions table is absent in isolated mocks).
 */
export async function recordSignupFirstTouchConversion(
  pool: QueryablePool,
  sub: string,
  input: {
    contactId: string;
    utm: Record<string, string>;
    referenceId?: string | null;
    occurredAtIso?: string;
  },
): Promise<Record<string, unknown> | null> {
  const normalized = normalizeConversionInput(
    {
      kind: 'signup',
      contactId: input.contactId,
      amountCents: 0,
      utm: input.utm,
      referenceId: input.referenceId ?? null,
      occurredAt: input.occurredAtIso,
    },
    null,
    input.occurredAtIso,
  );
  if (!normalized.ok || !normalized.conversion.campaignSlug) return null;
  const c = normalized.conversion;
  try {
    const existing = await rows(
      pool,
      `SELECT conversion_id FROM oshal_marketing_conversions
        WHERE owner_sub = $1 AND contact_id = $2 AND kind = 'signup'
        LIMIT 1`,
      [sub, input.contactId],
    );
    if (existing.length > 0) return null;
    const inserted = await rows(
      pool,
      `INSERT INTO oshal_marketing_conversions
         (owner_sub, contact_id, campaign_slug, medium, source, kind, amount_cents, reference_id, utm, occurred_at)
       VALUES ($1,$2,$3,$4,$5,'signup',0,$6,$7::jsonb,$8::timestamptz)
       RETURNING *`,
      [sub, c.contactId, c.campaignSlug, c.medium, c.source, c.referenceId, JSON.stringify(c.utm), c.occurredAt],
    );
    return inserted[0] ?? null;
  } catch (err) {
    logger.warn({ err }, 'signup first-touch conversion capture skipped');
    return null;
  }
}

/**
 * @description GET /attribution/funnel — read-only per-campaign attribution funnel and
 * email/SMS engagement scorecard.
 */
export async function getAttributionFunnel(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const filterCampaign = typeof req.query?.campaign === 'string' && req.query.campaign.trim()
    ? sanitizeCampaignSlug(req.query.campaign)
    : null;
  const [campaigns, events, conversions, deliveries] = await Promise.all([
    safeRows(
      ctx.pool,
      'SELECT campaign_id, slug, name, status FROM oshal_marketing_campaigns WHERE user_sub = $1 ORDER BY updated_at DESC LIMIT 200',
      [sub],
    ),
    safeRows(
      ctx.pool,
      'SELECT source, campaign_slug, medium, event, value FROM oshal_marketing_events WHERE user_sub = $1 ORDER BY ts DESC LIMIT 20000',
      [sub],
    ),
    safeRows(
      ctx.pool,
      `SELECT conversion_id, contact_id, campaign_slug, medium, source, kind, amount_cents, reference_id, utm, occurred_at
         FROM oshal_marketing_conversions
        WHERE owner_sub = $1
        ORDER BY occurred_at DESC
        LIMIT 10000`,
      [sub],
    ),
    safeRows(
      ctx.pool,
      `SELECT d.delivery_id, d.status, d.clicked_at, d.bounced_at, d.complained_at, d.unsubscribed_at,
              m.campaign_id, c.slug AS campaign_slug
         FROM oshal_marketing_deliveries d
         JOIN oshal_marketing_messages m
           ON m.message_id = d.message_id AND m.owner_sub = d.owner_sub
         LEFT JOIN oshal_marketing_campaigns c
           ON c.campaign_id = m.campaign_id AND c.user_sub = m.owner_sub
        WHERE d.owner_sub = $1
        ORDER BY d.created_at DESC
        LIMIT 20000`,
      [sub],
    ),
  ]);
  const funnel = buildAttributionFunnel({ campaigns, events, conversions, deliveries });
  if (filterCampaign) {
    funnel.campaigns = funnel.campaigns.filter((c) => c.campaignSlug === filterCampaign);
  }
  res.json(funnel);
}

/** Resolve an optional owner-scoped contactId from explicit contactId or email lookup. */
async function resolveOwnedContactId(
  pool: QueryablePool,
  sub: string,
  contactId: string | null,
  email: string | null,
): Promise<{ ok: true; contactId: string | null } | { ok: false }> {
  if (contactId) {
    const owned = await rows(
      pool,
      'SELECT contact_id FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2',
      [contactId, sub],
    );
    return owned.length > 0 ? { ok: true, contactId } : { ok: false };
  }
  if (email) {
    const found = await safeRows(
      pool,
      'SELECT contact_id FROM oshal_marketing_contacts WHERE owner_sub = $1 AND email_hash = $2 LIMIT 1',
      [sub, hashAddress(email)],
    );
    return { ok: true, contactId: found[0]?.contact_id ? String(found[0].contact_id) : null };
  }
  return { ok: true, contactId: null };
}

/**
 * @description POST /attribution/conversions — record a sign-up, purchase, or activation
 * conversion, resolving immutable first-touch campaign attribution from prior sign-up consent
 * UTM evidence whenever not explicitly overridden.
 */
export async function recordConversion(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const precheck = normalizeConversionInput(req.body ?? {});
  if (!precheck.ok) { res.status(400).json({ error: precheck.error, message: precheck.message }); return; }

  const contactRes = await resolveOwnedContactId(ctx.pool, sub, precheck.conversion.contactId, precheck.conversion.email);
  if (!contactRes.ok) { res.status(404).json({ error: 'contact_not_found' }); return; }

  const firstTouch = contactRes.contactId
    ? await loadContactFirstTouch(ctx.pool, sub, contactRes.contactId)
    : null;
  const finalCheck = normalizeConversionInput(
    { ...(req.body ?? {}), contactId: contactRes.contactId ?? undefined },
    firstTouch,
  );
  if (!finalCheck.ok) { res.status(400).json({ error: finalCheck.error, message: finalCheck.message }); return; }
  const c = finalCheck.conversion;

  const inserted = (await rows(
    ctx.pool,
    `INSERT INTO oshal_marketing_conversions
       (owner_sub, contact_id, campaign_slug, medium, source, kind, amount_cents, reference_id, utm, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz)
     RETURNING *`,
    [
      sub, c.contactId, c.campaignSlug, c.medium, c.source,
      c.kind, c.amountCents, c.referenceId, JSON.stringify(c.utm), c.occurredAt,
    ],
  ))[0];
  res.status(201).json({ conversion: inserted, firstTouchApplied: c.firstTouchApplied });
}

/** Record suppression + revoke consents when a delivery reports bounce, complaint, or unsubscribe. */
async function suppressFromDeliveryEvent(
  pool: QueryablePool,
  sub: string,
  delivery: Record<string, unknown>,
  event: 'bounced' | 'complained' | 'unsubscribed',
  occurredAt: string,
  reason: string,
): Promise<Record<string, unknown> | null> {
  const emailHash = String(delivery.email_hash || '').toLowerCase();
  const contactId = delivery.contact_id ? String(delivery.contact_id) : null;
  if (!emailHash) return null;
  const suppReason = reason || (event === 'bounced' ? 'bounce' : event === 'complained' ? 'complaint' : 'unsubscribe');
  const suppression = (await rows(
    pool,
    `INSERT INTO oshal_marketing_suppressions (owner_sub, channel, address_hash, reason, source)
     VALUES ($1,'email',$2,$3,'delivery_event')
     ON CONFLICT (owner_sub, channel, address_hash)
     DO UPDATE SET reason = EXCLUDED.reason, source = EXCLUDED.source
     RETURNING *`,
    [sub, emailHash, suppReason],
  ))[0] ?? null;

  const patch = JSON.stringify({ revokedAt: occurredAt, revokedVia: `delivery_${event}`, deliveryId: delivery.delivery_id });
  if (contactId) {
    await pool.query(
      `UPDATE oshal_marketing_consents
          SET status = 'revoked', evidence = COALESCE(evidence, '{}'::jsonb) || $3::jsonb, updated_at = now()
        WHERE owner_sub = $1 AND contact_id = $2 AND channel = 'email' AND status <> 'revoked'`,
      [sub, contactId, patch],
    );
  }
  const nextStatus = event === 'unsubscribed' ? 'unsubscribed' : 'suppressed';
  await pool.query(
    `UPDATE oshal_marketing_contacts
        SET status = $1, updated_at = now()
      WHERE owner_sub = $2 AND (email_hash = $3 OR ($4::uuid IS NOT NULL AND contact_id = $4::uuid))`,
    [nextStatus, sub, emailHash, contactId],
  );
  return suppression;
}

/**
 * @description POST /deliveries/:deliveryId/event — record a delivery engagement event
 * (clicked, bounced, complained, unsubscribed) on an owner-scoped delivery row. Bounced,
 * complained, and unsubscribed events automatically record a suppression and revoke email
 * consent for that recipient. Foreign owners receive 404.
 */
export async function recordDeliveryEvent(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const deliveryId = String(req.params.deliveryId || '');
  if (!UUID_RE.test(deliveryId)) { res.status(404).json({ error: 'delivery_not_found' }); return; }
  const checked = parseDeliveryEventInput(req.body ?? {});
  if (!checked.ok) { res.status(400).json({ error: checked.error, message: checked.message }); return; }

  const existing = (await rows(
    ctx.pool,
    `SELECT delivery_id, message_id, contact_id, email_hash, status,
            clicked_at, bounced_at, complained_at, unsubscribed_at
       FROM oshal_marketing_deliveries
      WHERE delivery_id = $1 AND owner_sub = $2`,
    [deliveryId, sub],
  ))[0];
  if (!existing) { res.status(404).json({ error: 'delivery_not_found' }); return; }

  const col = DELIVERY_EVENT_COLUMN[checked.parsed.event];
  const updated = (await rows(
    ctx.pool,
    `UPDATE oshal_marketing_deliveries
        SET ${col} = COALESCE(${col}, $3::timestamptz)
      WHERE delivery_id = $1 AND owner_sub = $2
      RETURNING delivery_id, message_id, contact_id, email_hash, status, gate_reason,
                provider_ref, clicked_at, bounced_at, complained_at, unsubscribed_at, created_at`,
    [deliveryId, sub, checked.parsed.occurredAt],
  ))[0];

  let suppression: Record<string, unknown> | null = null;
  if (checked.parsed.event !== 'clicked') {
    suppression = await suppressFromDeliveryEvent(
      ctx.pool, sub, existing, checked.parsed.event, checked.parsed.occurredAt, checked.parsed.reason,
    );
  }
  res.json({
    ok: true,
    event: checked.parsed.event,
    delivery: updated ?? existing,
    suppressed: Boolean(suppression),
    suppression,
  });
}

/**
 * @description Register P5 attribution funnel, first-touch conversion, and delivery engagement
 * routes under /api/marketing.
 */
export function registerAttributionRoutes(router: Router, ctx: AppContext): void {
  ensureAttributionSchema(ctx.pool).catch((err) => logger.error({ err }, 'Failed to ensure marketing-engine attribution schema'));
  router.get('/attribution/funnel', authed(ctx, getAttributionFunnel));
  router.post('/attribution/conversions', authed(ctx, recordConversion));
  router.post('/deliveries/:deliveryId/event', authed(ctx, recordDeliveryEvent));
}
