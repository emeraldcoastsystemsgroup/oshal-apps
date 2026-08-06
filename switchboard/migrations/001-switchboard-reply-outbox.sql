/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Add the encrypted, owner-RLS reply outbox with request-key uniqueness and atomic executor claim indexes.
 */

-- The HTTP boundary resolves recipient and subject from the caller-owned inbox row. Every field
-- that can reveal message content or an address is encrypted under the owner's vault-derived key
-- before it enters this table. request_hash is a one-way conflict detector for idempotency replay.
CREATE TABLE IF NOT EXISTS oshal_switchboard_reply_outbox (
  reply_id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub                     TEXT NOT NULL,
  idempotency_key              TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 128),
  request_hash                 CHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  provider                     TEXT NOT NULL CHECK (provider IN ('google')),
  source_message_id_ciphertext TEXT NOT NULL,
  recipient_ciphertext         TEXT NOT NULL,
  subject_ciphertext           TEXT NOT NULL,
  body_ciphertext              TEXT NOT NULL,
  workspace_id                 UUID,
  status                       TEXT NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','sending','sent','failed','uncertain')),
  attempt_count                INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_token                  UUID,
  claimed_at                   TIMESTAMPTZ,
  provider_message_id          TEXT,
  delivery_error               TEXT,
  sent_at                      TIMESTAMPTZ,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sb_reply_owner_idempotency UNIQUE (user_sub, idempotency_key),
  CONSTRAINT ck_sb_reply_claim_shape CHECK (
    (status = 'sending' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL)
    OR (status <> 'sending' AND claim_token IS NULL)
  ),
  CONSTRAINT ck_sb_reply_sent_shape CHECK (
    (status = 'sent' AND sent_at IS NOT NULL AND delivery_error IS NULL)
    OR status <> 'sent'
  )
);

-- SKIP LOCKED claims use this partial order; owner status reads use the second index.
CREATE INDEX IF NOT EXISTS idx_sb_reply_pending
  ON oshal_switchboard_reply_outbox (created_at, reply_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_sb_reply_owner_time
  ON oshal_switchboard_reply_outbox (user_sub, created_at DESC);

ALTER TABLE oshal_switchboard_reply_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_switchboard_reply_outbox FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_switchboard_reply_outbox_owner_or_operator'
      AND polrelid = 'oshal_switchboard_reply_outbox'::regclass
  ) THEN
    CREATE POLICY oshal_switchboard_reply_outbox_owner_or_operator ON oshal_switchboard_reply_outbox
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
