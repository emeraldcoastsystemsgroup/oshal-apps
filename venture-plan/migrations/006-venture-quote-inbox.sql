-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Add owner-scoped venture_quote_inbox table for deterministic saved-quote document extraction and operator-reviewed promotion, with forced two-arm owner-or-operator RLS.

CREATE TABLE IF NOT EXISTS venture_quote_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub VARCHAR(255) NOT NULL,
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type VARCHAR(120) NOT NULL DEFAULT 'text/plain',
  byte_size INTEGER NOT NULL DEFAULT 0,
  sha256 CHAR(64) NOT NULL,
  raw_excerpt TEXT NOT NULL DEFAULT '',
  extracted_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  promoted_quote_id UUID REFERENCES venture_quotes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT venture_quote_inbox_status_ck
    CHECK (status IN ('pending', 'promoted', 'dismissed')),
  CONSTRAINT venture_quote_inbox_byte_size_ck
    CHECK (byte_size >= 0 AND byte_size <= 2097152),
  CONSTRAINT venture_quote_inbox_sha256_ck
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT venture_quote_inbox_promoted_ck
    CHECK (
      (status = 'promoted' AND promoted_quote_id IS NOT NULL)
      OR (status <> 'promoted' AND promoted_quote_id IS NULL)
    ));

CREATE INDEX IF NOT EXISTS venture_quote_inbox_venture_idx
  ON venture_quote_inbox(venture_id, created_at DESC);

ALTER TABLE venture_quote_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_quote_inbox FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polname = 'venture_quote_inbox_owner_or_operator'
       AND polrelid = 'venture_quote_inbox'::regclass
  ) THEN
    CREATE POLICY venture_quote_inbox_owner_or_operator
      ON venture_quote_inbox AS PERMISSIVE FOR ALL
      USING (owner_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on')
      WITH CHECK (owner_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on');
  END IF;
END $$;
