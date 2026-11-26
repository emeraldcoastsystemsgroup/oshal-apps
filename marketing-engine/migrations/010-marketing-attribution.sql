/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.9 P5 attribution and
 *     per-campaign engagement: adds oshal_marketing_conversions with exact-owner ENABLE and
 *     FORCE ROW LEVEL SECURITY (oshal.current_sub, no operator bypass) for first-touch
 *     sign-up, purchase, and activation conversion attribution, plus idempotent engagement
 *     timestamp columns (clicked_at, bounced_at, complained_at, unsubscribed_at) on
 *     oshal_marketing_deliveries. Mirrored by the lazy-DDL chokepoint in
 *     src-routes/marketing-attribution.ts.
 */

-- Owner-scoped first-touch conversion ledger (sign-ups, purchases, activations).
CREATE TABLE IF NOT EXISTS oshal_marketing_conversions (
  conversion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub     TEXT NOT NULL,
  contact_id    UUID REFERENCES oshal_marketing_contacts (contact_id) ON DELETE SET NULL,
  campaign_slug TEXT,
  medium        TEXT,
  source        TEXT,
  kind          TEXT NOT NULL CHECK (kind IN ('signup','purchase','activation')),
  amount_cents  BIGINT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  reference_id  TEXT,
  utm           JSONB NOT NULL DEFAULT '{}',
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_conversions_owner_campaign
  ON oshal_marketing_conversions (owner_sub, campaign_slug, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_conversions_owner_contact
  ON oshal_marketing_conversions (owner_sub, contact_id, occurred_at ASC);

-- Exact-owner FORCE-RLS on conversions (no operator bypass).
ALTER TABLE oshal_marketing_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_conversions FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_conversions_exact_owner'
      AND polrelid = 'oshal_marketing_conversions'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_conversions_exact_owner ON oshal_marketing_conversions
      AS PERMISSIVE FOR ALL
      USING (
        owner_sub = current_setting('oshal.current_sub', true)
        AND current_setting('oshal.current_sub', true) <> ''
      )
      WITH CHECK (
        owner_sub = current_setting('oshal.current_sub', true)
        AND current_setting('oshal.current_sub', true) <> ''
      );
  END IF;
END $$;

-- Idempotent per-delivery engagement event timestamps (opens deliberately omitted as unreliable).
ALTER TABLE oshal_marketing_deliveries ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;
ALTER TABLE oshal_marketing_deliveries ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ;
ALTER TABLE oshal_marketing_deliveries ADD COLUMN IF NOT EXISTS complained_at TIMESTAMPTZ;
ALTER TABLE oshal_marketing_deliveries ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;
