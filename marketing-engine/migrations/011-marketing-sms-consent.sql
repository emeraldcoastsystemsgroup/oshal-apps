/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.10 P4 SMS consent &
 *     quiet hours: adds idempotent E.164 phone and explicit/inferred timezone columns
 *     (phone_e164, phone_hash, timezone, timezone_inferred) onto oshal_marketing_contacts
 *     with a partial index on (owner_sub, phone_hash), and creates oshal_marketing_sms_queue
 *     with exact-owner ENABLE + FORCE ROW LEVEL SECURITY (oshal.current_sub, no operator
 *     bypass). Mirrored by the lazy-DDL chokepoint in src-routes/marketing-sms.ts.
 */

-- Idempotent SMS phone and recipient timezone columns on existing contacts table.
ALTER TABLE oshal_marketing_contacts ADD COLUMN IF NOT EXISTS phone_e164 TEXT;
ALTER TABLE oshal_marketing_contacts ADD COLUMN IF NOT EXISTS phone_hash TEXT;
ALTER TABLE oshal_marketing_contacts ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE oshal_marketing_contacts ADD COLUMN IF NOT EXISTS timezone_inferred BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_contacts_owner_phone_hash
  ON oshal_marketing_contacts (owner_sub, phone_hash)
  WHERE phone_hash IS NOT NULL;

-- Owner-scoped SMS send queue & gate decision audit ledger (quiet-hours holds, ready, refusals).
CREATE TABLE IF NOT EXISTS oshal_marketing_sms_queue (
  sms_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub          TEXT NOT NULL,
  contact_id         UUID NOT NULL REFERENCES oshal_marketing_contacts (contact_id) ON DELETE CASCADE,
  phone_hash         TEXT NOT NULL,
  body               TEXT NOT NULL,
  recipient_timezone TEXT NOT NULL,
  timezone_inferred  BOOLEAN NOT NULL DEFAULT FALSE,
  status             TEXT NOT NULL CHECK (status IN ('held_quiet_hours','ready','refused_consent','refused_suppressed','sent','cancelled')),
  gate_reason        TEXT NOT NULL DEFAULT '',
  scheduled_for      TIMESTAMPTZ NOT NULL,
  release_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_sms_queue_owner_created
  ON oshal_marketing_sms_queue (owner_sub, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_sms_queue_owner_contact_status
  ON oshal_marketing_sms_queue (owner_sub, contact_id, status);

-- Exact-owner FORCE-RLS on SMS queue (no operator bypass).
ALTER TABLE oshal_marketing_sms_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_sms_queue FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_sms_queue_exact_owner'
      AND polrelid = 'oshal_marketing_sms_queue'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_sms_queue_exact_owner ON oshal_marketing_sms_queue
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
