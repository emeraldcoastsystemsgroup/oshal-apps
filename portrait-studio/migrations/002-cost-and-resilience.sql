-- =============================================================================
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                                     | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-07-17   | roger.murphy@emeraldcoastsystemsgroup.com  | Industrial hardening: vendor-reported spend recorded per portrait (cost_usd). Mirrors the bootstrap ALTER in ensureSchema; canonical ledger rows (chat_tasks + oshal_cost_events) are written by the route via the media-generation skill.
-- =============================================================================

ALTER TABLE ps_portraits ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12,6);
