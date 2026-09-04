-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-135 P1 schema. print_intake is the record of every printed document that reached the swarm and what was decided about it. Two columns carry weight beyond bookkeeping: `fanout` is the ONLY record of where a document's copies were written, because core RAG has no per-document delete - without it a fan-out is permanent by accident rather than retractable later; and `approved_destinations` is stored separately from `recommendation` so a later audit can see where the machine's proposal and the human's decision diverged. print_intake_rule holds the admin association rules (ADR-135 D16): a rule PRE-TICKS a destination, it never approves, and `auto_approve` is a deliberate per-rule opt-in that the swarm-wide destination can never be given.

-- ── Intake: one row per printed document ────────────────────────────────────
CREATE TABLE IF NOT EXISTS print_intake (
  intake_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub             TEXT        NOT NULL,
  content_sha256        TEXT        NOT NULL,          -- idempotency + the rag doc_id (print:<sha>)
  title                 TEXT        NOT NULL,
  text_chars            INTEGER     NOT NULL DEFAULT 0,
  text_body             TEXT,                          -- extracted text; the binary stays on the edge
  sidecar               JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- raw, as received - UNTRUSTED LAN input, kept for audit
  recommendation        JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- what was proposed, with reasons
  approved_destinations JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- what the human actually ticked
  fanout                JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- {destination, collection, ragDocId, writtenAt} per copy
  state                 TEXT        NOT NULL DEFAULT 'awaiting_approval',
  failure_reason        TEXT,
  applied_rule_id       UUID,                          -- set when an auto-approve rule decided this
  ticket_id             TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at            TIMESTAMPTZ,
  decided_by            TEXT,
  CONSTRAINT print_intake_state_valid CHECK (
    state IN ('awaiting_approval', 'ingested', 'partially_ingested', 'rejected', 'failed')
  )
);

-- One document per owner: a reprint of identical content is the same intake, not a second copy.
CREATE UNIQUE INDEX IF NOT EXISTS uq_print_intake_owner_content
  ON print_intake (owner_sub, content_sha256);
CREATE INDEX IF NOT EXISTS idx_print_intake_owner_state
  ON print_intake (owner_sub, state, created_at DESC);

-- ── Association rules (ADR-135 D16) ─────────────────────────────────────────
-- An admin maps a source to a suggested user and default destinations. A rule
-- pre-ticks; it does not approve. auto_approve is opt-in per rule and is refused
-- for the swarm-wide destination by the route layer, which is world-readable.
CREATE TABLE IF NOT EXISTS print_intake_rule (
  rule_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub          TEXT        NOT NULL,             -- the admin who owns the rule
  label              TEXT        NOT NULL,
  match_client_ip    TEXT,                             -- exact match; NULL = any
  match_computer     TEXT,                             -- originating computer name; NULL = any
  match_printer      TEXT,                             -- receiving printer/queue; NULL = any
  suggested_user_sub TEXT,                             -- a HINT for ownership, never authority
  destinations       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  auto_approve       BOOLEAN     NOT NULL DEFAULT false,
  enabled            BOOLEAN     NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_print_intake_rule_owner ON print_intake_rule (owner_sub, enabled);

-- ── Owner RLS (the store-package convention) ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['print_intake', 'print_intake_rule'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy WHERE polname = t || '_owner_or_operator' AND polrelid = t::regclass
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS PERMISSIVE FOR ALL
           USING (owner_sub = current_setting(''oshal.current_sub'', true)
                  OR current_setting(''oshal.is_operator'', true) = ''on'')
           WITH CHECK (owner_sub = current_setting(''oshal.current_sub'', true)
                  OR current_setting(''oshal.is_operator'', true) = ''on'')',
        t || '_owner_or_operator', t);
    END IF;
  END LOOP;
END $$;
