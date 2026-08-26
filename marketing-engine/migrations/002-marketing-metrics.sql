/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine metrics stores: the deterministic
 *     ingest event stream (Search Console / PostHog / GitHub traffic, meta.date keyed for idempotent
 *     day rewrites), the weekly scorecard snapshots (per-source status is honest — NO DATA is stored,
 *     never an invented number), and the outward-action run ledger (EVERY publish attempt writes a
 *     row: published | skipped_consent | skipped_cap | skipped_confirm | error). Owner FORCE-RLS on
 *     all three. Mirrored by the lazy-DDL chokepoint in src-routes/marketing-ops-routes.ts
 *     (runRuntimeSchemaBootstrap) — keep the two in step.
 */

-- Deterministic metrics events, one row per (owner, source, event, day-bucket or raw event).
CREATE TABLE IF NOT EXISTS oshal_marketing_events (
  event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub      TEXT NOT NULL,
  ts            TIMESTAMPTZ NOT NULL,
  source        TEXT NOT NULL,
  campaign_slug TEXT,
  medium        TEXT,
  event         TEXT NOT NULL,
  value         NUMERIC NOT NULL DEFAULT 0,
  meta          JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_events_owner_ts
  ON oshal_marketing_events (user_sub, ts DESC);
CREATE INDEX IF NOT EXISTS idx_oshal_marketing_events_owner_source_ts
  ON oshal_marketing_events (user_sub, source, ts DESC);

-- Weekly scorecard snapshots: rollup data plus per-source {status: ok|no_data}.
CREATE TABLE IF NOT EXISTS oshal_marketing_scorecard_weeks (
  user_sub    TEXT NOT NULL,
  week_start  DATE NOT NULL,
  data        JSONB NOT NULL,
  sources     JSONB NOT NULL DEFAULT '{}',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_sub, week_start)
);

-- Outward-action run ledger: a quiet night must be distinguishable from a broken publisher, so
-- skips are recorded alongside real publishes (outcome enum is enforced in route code).
CREATE TABLE IF NOT EXISTS oshal_marketing_run_ledger (
  run_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub TEXT NOT NULL,
  channel  TEXT NOT NULL,
  action   TEXT NOT NULL,
  outcome  TEXT NOT NULL,
  detail   JSONB NOT NULL DEFAULT '{}',
  ts       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_run_ledger_owner_channel_ts
  ON oshal_marketing_run_ledger (user_sub, channel, ts DESC);

-- Owner FORCE-RLS (owner_or_operator) on every table above.
ALTER TABLE oshal_marketing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_events FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_events_owner_or_operator'
      AND polrelid = 'oshal_marketing_events'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_events_owner_or_operator ON oshal_marketing_events
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

ALTER TABLE oshal_marketing_scorecard_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_scorecard_weeks FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_scorecard_weeks_owner_or_operator'
      AND polrelid = 'oshal_marketing_scorecard_weeks'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_scorecard_weeks_owner_or_operator ON oshal_marketing_scorecard_weeks
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

ALTER TABLE oshal_marketing_run_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_run_ledger FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_run_ledger_owner_or_operator'
      AND polrelid = 'oshal_marketing_run_ledger'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_run_ledger_owner_or_operator ON oshal_marketing_run_ledger
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
