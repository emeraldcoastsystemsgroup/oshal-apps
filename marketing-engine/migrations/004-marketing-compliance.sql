/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.2 P1 compliance settings
 *     and HTML/plain-text email template columns: adds oshal_marketing_compliance_settings with
 *     exact-owner ENABLE + FORCE ROW LEVEL SECURITY (oshal.current_sub, no operator bypass) and
 *     idempotently extends oshal_marketing_content with template_id, html_body, and text_body.
 *     Mirrored by the lazy-DDL chokepoint in src-routes/marketing-compliance.ts.
 */

-- Owner-scoped sender identity, physical postal address, unsubscribe base URL, and SMS quiet hours.
CREATE TABLE IF NOT EXISTS oshal_marketing_compliance_settings (
  owner_sub            TEXT PRIMARY KEY,
  sender_name          TEXT NOT NULL DEFAULT '',
  sender_email         TEXT NOT NULL DEFAULT '',
  reply_to_email       TEXT NOT NULL DEFAULT '',
  postal_address       TEXT NOT NULL DEFAULT '',
  unsubscribe_base_url TEXT NOT NULL DEFAULT '',
  sms_quiet_start_hour INT NOT NULL DEFAULT 21 CHECK (sms_quiet_start_hour BETWEEN 0 AND 23),
  sms_quiet_end_hour   INT NOT NULL DEFAULT 8 CHECK (sms_quiet_end_hour BETWEEN 0 AND 23),
  sms_default_timezone TEXT NOT NULL DEFAULT 'America/New_York',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exact-owner FORCE-RLS on compliance settings (no operator bypass).
ALTER TABLE oshal_marketing_compliance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_compliance_settings FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_compliance_settings_exact_owner'
      AND polrelid = 'oshal_marketing_compliance_settings'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_compliance_settings_exact_owner ON oshal_marketing_compliance_settings
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

-- Idempotent email template & multipart columns on existing content items table.
ALTER TABLE oshal_marketing_content ADD COLUMN IF NOT EXISTS template_id TEXT;
ALTER TABLE oshal_marketing_content ADD COLUMN IF NOT EXISTS html_body TEXT;
ALTER TABLE oshal_marketing_content ADD COLUMN IF NOT EXISTS text_body TEXT;
