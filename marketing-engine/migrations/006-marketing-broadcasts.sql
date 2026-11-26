/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.5 P1 broadcast
 *     pipeline and per-recipient delivery ledger: adds oshal_marketing_messages and
 *     oshal_marketing_deliveries with exact-owner ENABLE and FORCE ROW LEVEL SECURITY
 *     (oshal.current_sub, no operator bypass). Mirrored by the lazy-DDL chokepoint in
 *     src-routes/marketing-broadcast.ts.
 */

-- Owner-scoped broadcast drafts and send snapshots with per-message unsubscribe signing secret.
CREATE TABLE IF NOT EXISTS oshal_marketing_messages (
  message_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub      TEXT NOT NULL,
  campaign_id    UUID REFERENCES oshal_marketing_campaigns (campaign_id) ON DELETE SET NULL,
  list_id        UUID NOT NULL REFERENCES oshal_marketing_lists (list_id) ON DELETE CASCADE,
  template_id    TEXT NOT NULL CHECK (template_id IN ('announcement','newsletter','launch')),
  subject        TEXT NOT NULL,
  headline       TEXT NOT NULL DEFAULT '',
  intro          TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL,
  cta_label      TEXT NOT NULL DEFAULT '',
  cta_url        TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','partial','blocked')),
  signing_secret TEXT NOT NULL,
  stats          JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_messages_owner_updated
  ON oshal_marketing_messages (owner_sub, updated_at DESC);

-- Per-recipient gate decision and delivery audit ledger (one row per recipient decision).
CREATE TABLE IF NOT EXISTS oshal_marketing_deliveries (
  delivery_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub    TEXT NOT NULL,
  message_id   UUID NOT NULL REFERENCES oshal_marketing_messages (message_id) ON DELETE CASCADE,
  contact_id   UUID REFERENCES oshal_marketing_contacts (contact_id) ON DELETE SET NULL,
  email_hash   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN (
    'sent','dry_run','skipped_consent','skipped_unconfirmed',
    'skipped_suppressed','skipped_compliance','skipped_cap','skipped_confirm','error'
  )),
  gate_reason  TEXT NOT NULL DEFAULT '',
  provider_ref TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_deliveries_owner_message
  ON oshal_marketing_deliveries (owner_sub, message_id, created_at DESC);

-- Exact-owner FORCE-RLS on broadcast messages (no operator bypass).
ALTER TABLE oshal_marketing_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_messages FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_messages_exact_owner'
      AND polrelid = 'oshal_marketing_messages'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_messages_exact_owner ON oshal_marketing_messages
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

-- Exact-owner FORCE-RLS on broadcast deliveries (no operator bypass).
ALTER TABLE oshal_marketing_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_deliveries FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_deliveries_exact_owner'
      AND polrelid = 'oshal_marketing_deliveries'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_deliveries_exact_owner ON oshal_marketing_deliveries
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
