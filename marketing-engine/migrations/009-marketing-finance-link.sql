/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.8 P2 campaign-to-finance
 *     project link and channel allocations: adds idempotent finance_project_id UUID and
 *     channel_allocations JSONB columns onto oshal_marketing_campaigns (which already enforces
 *     owner FORCE ROW LEVEL SECURITY from 001-marketing-core.sql) plus a partial index for
 *     linked project lookups. Mirrored by the lazy-DDL chokepoint in src-routes/marketing-budget.ts.
 */

-- Idempotent campaign-to-finance-project link and per-channel integer-cent allocation map.
ALTER TABLE oshal_marketing_campaigns
  ADD COLUMN IF NOT EXISTS finance_project_id UUID;

ALTER TABLE oshal_marketing_campaigns
  ADD COLUMN IF NOT EXISTS channel_allocations JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_campaigns_finance_project
  ON oshal_marketing_campaigns (user_sub, finance_project_id)
  WHERE finance_project_id IS NOT NULL;
