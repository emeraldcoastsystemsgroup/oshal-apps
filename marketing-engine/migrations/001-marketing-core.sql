/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine core stores: campaigns, per-channel
 *     consent authorizations (ABSENT ROW = FALSE — publishing is opt-in only, default OFF), content
 *     items, the experiment registry, and the budget decision ledger. Every table is owner FORCE-RLS
 *     (owner_or_operator policy). This file is the checked-in equivalent of the lazy-DDL chokepoint
 *     in src-routes/marketing-routes.ts (runRuntimeSchemaBootstrap) — keep the two mirrored.
 */

-- Campaigns: one row per product campaign, owner-scoped, slug unique per owner.
CREATE TABLE IF NOT EXISTS oshal_marketing_campaigns (
  campaign_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub           TEXT NOT NULL,
  product            TEXT NOT NULL,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL,
  motion             TEXT NOT NULL DEFAULT 'adoption' CHECK (motion IN ('adoption','revenue')),
  stage              INT NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 3),
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  icp                JSONB NOT NULL DEFAULT '{}',
  message_map        JSONB NOT NULL DEFAULT '{}',
  channels           JSONB NOT NULL DEFAULT '[]',
  budget_monthly_usd NUMERIC NOT NULL DEFAULT 0,
  target_cpa_usd     NUMERIC,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_sub, slug)
);

-- Per-channel consent. ABSENT ROW = FALSE: no row means no consent, no publishing, no spend.
-- Only an explicit opt-in row (enabled TRUE) permits a confirmed human publish; daily_cap 0 means
-- publishing is never authorized on that channel. Campaign/content import NEVER writes this table.
CREATE TABLE IF NOT EXISTS oshal_marketing_channel_authorizations (
  user_sub               TEXT NOT NULL,
  channel                TEXT NOT NULL CHECK (channel IN ('linkedin','mastodon','bluesky','email')),
  enabled                BOOLEAN NOT NULL DEFAULT FALSE,
  standing_authorization BOOLEAN NOT NULL DEFAULT FALSE,
  daily_cap              INT NOT NULL DEFAULT 0,
  paused_reason          TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_sub, channel)
);

-- Content items: drafts and their publish outcome, owner-scoped.
CREATE TABLE IF NOT EXISTS oshal_marketing_content (
  item_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub      TEXT NOT NULL,
  campaign_id   UUID REFERENCES oshal_marketing_campaigns (campaign_id) ON DELETE SET NULL,
  channel       TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','published','rejected')),
  utm_url       TEXT,
  published_ref TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Experiment registry: ICE-scored hypotheses with a bounded test window.
CREATE TABLE IF NOT EXISTS oshal_marketing_experiments (
  experiment_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub       TEXT NOT NULL,
  campaign_id    UUID,
  hypothesis     TEXT NOT NULL,
  variable       TEXT NOT NULL,
  ice_impact     INT NOT NULL CHECK (ice_impact BETWEEN 1 AND 10),
  ice_confidence INT NOT NULL CHECK (ice_confidence BETWEEN 1 AND 10),
  ice_ease       INT NOT NULL CHECK (ice_ease BETWEEN 1 AND 10),
  status         TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','running','extended','killed','scaled')),
  window_start   DATE,
  window_end     DATE,
  verdict        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Budget decision ledger: every proposed budget/stage change and the human decision on it.
CREATE TABLE IF NOT EXISTS oshal_marketing_budget_ledger (
  entry_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub    TEXT NOT NULL,
  campaign_id UUID,
  channel     TEXT,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','applied')),
  proposed_by TEXT NOT NULL DEFAULT 'bot',
  decided_by  TEXT,
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Owner FORCE-RLS (owner_or_operator) on every table above.
ALTER TABLE oshal_marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_campaigns FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_campaigns_owner_or_operator'
      AND polrelid = 'oshal_marketing_campaigns'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_campaigns_owner_or_operator ON oshal_marketing_campaigns
      AS PERMISSIVE FOR ALL
      USING (
        user_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on'
      )
      WITH CHECK (
        user_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on'
      );
  END IF;
END $$;

ALTER TABLE oshal_marketing_channel_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_channel_authorizations FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_channel_authorizations_owner_or_operator'
      AND polrelid = 'oshal_marketing_channel_authorizations'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_channel_authorizations_owner_or_operator ON oshal_marketing_channel_authorizations
      AS PERMISSIVE FOR ALL
      USING (
        user_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on'
      )
      WITH CHECK (
        user_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on'
      );
  END IF;
END $$;

ALTER TABLE oshal_marketing_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_content FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_content_owner_or_operator'
      AND polrelid = 'oshal_marketing_content'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_content_owner_or_operator ON oshal_marketing_content
      AS PERMISSIVE FOR ALL
      USING (
        user_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on'
      )
      WITH CHECK (
        user_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on'
      );
  END IF;
END $$;

ALTER TABLE oshal_marketing_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_experiments FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_experiments_owner_or_operator'
      AND polrelid = 'oshal_marketing_experiments'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_experiments_owner_or_operator ON oshal_marketing_experiments
      AS PERMISSIVE FOR ALL
      USING (
        user_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on'
      )
      WITH CHECK (
        user_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on'
      );
  END IF;
END $$;

ALTER TABLE oshal_marketing_budget_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_budget_ledger FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_budget_ledger_owner_or_operator'
      AND polrelid = 'oshal_marketing_budget_ledger'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_budget_ledger_owner_or_operator ON oshal_marketing_budget_ledger
      AS PERMISSIVE FOR ALL
      USING (
        user_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on'
      )
      WITH CHECK (
        user_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on'
      );
  END IF;
END $$;
