/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.6 P3 sequences with
 *     per-recipient state and strict per-sequence standing authorization: adds
 *     oshal_marketing_sequences, oshal_marketing_sequence_steps, and
 *     oshal_marketing_enrollments with exact-owner ENABLE and FORCE ROW LEVEL SECURITY
 *     (oshal.current_sub, no operator bypass). Mirrored by the lazy-DDL chokepoint in
 *     src-routes/marketing-sequences.ts.
 */

-- Owner-scoped email sequences with strict per-sequence standing authorization (default OFF).
CREATE TABLE IF NOT EXISTS oshal_marketing_sequences (
  sequence_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub              TEXT NOT NULL,
  slug                   TEXT NOT NULL,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  trigger_form_slug      TEXT,
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  standing_authorization BOOLEAN NOT NULL DEFAULT FALSE,
  daily_cap              INT NOT NULL DEFAULT 0 CHECK (daily_cap BETWEEN 0 AND 5000),
  signing_secret         TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_sub, slug)
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_sequences_owner_updated
  ON oshal_marketing_sequences (owner_sub, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_sequences_owner_trigger
  ON oshal_marketing_sequences (owner_sub, trigger_form_slug)
  WHERE trigger_form_slug IS NOT NULL;

-- Ordered steps belonging to a sequence (each rendered through a built-in compliant template).
CREATE TABLE IF NOT EXISTS oshal_marketing_sequence_steps (
  step_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub    TEXT NOT NULL,
  sequence_id  UUID NOT NULL REFERENCES oshal_marketing_sequences (sequence_id) ON DELETE CASCADE,
  step_order   INT NOT NULL CHECK (step_order BETWEEN 1 AND 50),
  delay_hours  INT NOT NULL DEFAULT 0 CHECK (delay_hours BETWEEN 0 AND 8760),
  template_id  TEXT NOT NULL CHECK (template_id IN ('announcement','newsletter','launch')),
  subject      TEXT NOT NULL,
  headline     TEXT NOT NULL DEFAULT '',
  intro        TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL,
  cta_label    TEXT NOT NULL DEFAULT '',
  cta_url      TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_sequence_steps_owner_seq
  ON oshal_marketing_sequence_steps (owner_sub, sequence_id, step_order ASC);

-- Per-recipient sequence enrollment state machine and step history ledger.
CREATE TABLE IF NOT EXISTS oshal_marketing_enrollments (
  enrollment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub          TEXT NOT NULL,
  sequence_id        UUID NOT NULL REFERENCES oshal_marketing_sequences (sequence_id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES oshal_marketing_contacts (contact_id) ON DELETE CASCADE,
  current_step_order INT NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active','completed','stopped_unsubscribed','stopped_unconsented','paused'
  )),
  next_run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_step_at       TIMESTAMPTZ,
  history            JSONB NOT NULL DEFAULT '[]',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_enrollments_owner_due
  ON oshal_marketing_enrollments (owner_sub, sequence_id, status, next_run_at ASC);

-- Exact-owner FORCE-RLS on sequences (no operator bypass).
ALTER TABLE oshal_marketing_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_sequences FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_sequences_exact_owner'
      AND polrelid = 'oshal_marketing_sequences'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_sequences_exact_owner ON oshal_marketing_sequences
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

-- Exact-owner FORCE-RLS on sequence steps (no operator bypass).
ALTER TABLE oshal_marketing_sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_sequence_steps FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_sequence_steps_exact_owner'
      AND polrelid = 'oshal_marketing_sequence_steps'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_sequence_steps_exact_owner ON oshal_marketing_sequence_steps
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

-- Exact-owner FORCE-RLS on sequence enrollments (no operator bypass).
ALTER TABLE oshal_marketing_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_enrollments FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_enrollments_exact_owner'
      AND polrelid = 'oshal_marketing_enrollments'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_enrollments_exact_owner ON oshal_marketing_enrollments
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
