/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.7 P3 launch plans and
 *     unified marketing calendar: adds oshal_marketing_launch_plans (dated milestones,
 *     launch-coordinator asset checklist, and grounded numbers-only retro facts/markdown)
 *     with exact-owner ENABLE and FORCE ROW LEVEL SECURITY (oshal.current_sub, no operator
 *     bypass), plus idempotent scheduled_for column on oshal_marketing_content so scheduled
 *     engine content appears on the unified calendar. Mirrored by the lazy-DDL chokepoint
 *     in src-routes/marketing-launch.ts.
 */

-- Owner-scoped campaign launch plans with dated milestones, asset checklist, and grounded retro.
CREATE TABLE IF NOT EXISTS oshal_marketing_launch_plans (
  plan_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub          TEXT NOT NULL,
  campaign_id        UUID NOT NULL REFERENCES oshal_marketing_campaigns (campaign_id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  launch_date        DATE NOT NULL,
  status             TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','ready','launched','retro_complete')),
  milestones         JSONB NOT NULL DEFAULT '[]',
  checklist          JSONB NOT NULL DEFAULT '[]',
  retro_markdown     TEXT,
  retro_facts        JSONB,
  retro_generated_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_sub, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_launch_plans_owner_date
  ON oshal_marketing_launch_plans (owner_sub, launch_date DESC);

-- Exact-owner FORCE-RLS on launch plans (no operator bypass).
ALTER TABLE oshal_marketing_launch_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_launch_plans FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_launch_plans_exact_owner'
      AND polrelid = 'oshal_marketing_launch_plans'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_launch_plans_exact_owner ON oshal_marketing_launch_plans
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

-- Idempotent scheduled_for timestamp on existing content items for unified calendar display.
ALTER TABLE oshal_marketing_content ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
