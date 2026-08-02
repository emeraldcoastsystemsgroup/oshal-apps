-- =============================================================================
-- Migration 094: Pumpkin saved responses — the one-tap replay playlist
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                                    | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-07-24   | roger.murphy@emeraldcoastsystemsgroup.com | Per-user SAVED spoken
--              | lines for the pumpkin prop (operator request: "save his responses"
--              | + "easy to click response play list"). Every line the pumpkin
--              | speaks auto-saves here (deduped by lowercased text; unpinned rows
--              | capped by recency in the service; pinned rows are keepers). The
--              | remote/control surfaces replay a row via POST /api/pumpkin/rooms/
--              | replay — instant, no LLM regeneration. Idempotent — mirrors
--              | PumpkinResponseService.ensureSchema() (which also appends the
--              | canonical owner-or-operator RLS policy at the lazy-DDL chokepoint).
-- =============================================================================

CREATE TABLE IF NOT EXISTS pumpkin_responses (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub       VARCHAR(255) NOT NULL,
  say            TEXT         NOT NULL,
  expression     VARCHAR(16)  NOT NULL DEFAULT 'neutral',
  intensity      REAL         NOT NULL DEFAULT 0.6,
  source         VARCHAR(16)  NOT NULL DEFAULT 'manual',
  pinned         BOOLEAN      NOT NULL DEFAULT FALSE,
  play_count     INTEGER      NOT NULL DEFAULT 0,
  last_played_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One row per distinct lowercased line per user — a re-say refreshes recency instead
-- of duplicating the playlist entry.
CREATE UNIQUE INDEX IF NOT EXISTS pumpkin_responses_dedupe
  ON pumpkin_responses (user_sub, md5(lower(say)));

-- Owner-or-operator RLS (same shape as docs/governance/rls-policies-enforce.sql;
-- also applied by the service's ensureSchema so a fresh dev DB is never policy-less).
ALTER TABLE pumpkin_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE pumpkin_responses FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'pumpkin_responses_owner_or_operator' AND polrelid = 'pumpkin_responses'::regclass
  ) THEN
    CREATE POLICY pumpkin_responses_owner_or_operator ON pumpkin_responses
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
