/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.3 P1 double opt-in
 *     sign-up forms and single-use confirmation tokens: adds oshal_marketing_signup_forms and
 *     oshal_marketing_optin_tokens with exact-owner ENABLE and FORCE ROW LEVEL SECURITY
 *     (oshal.current_sub, no operator bypass). Mirrored by the lazy-DDL chokepoint in
 *     src-routes/marketing-optin.ts.
 */

-- Owner-scoped double opt-in sign-up forms with per-form signing secret, honeypot, and rate caps.
CREATE TABLE IF NOT EXISTS oshal_marketing_signup_forms (
  form_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub                TEXT NOT NULL,
  slug                     TEXT NOT NULL,
  name                     TEXT NOT NULL,
  consent_text             TEXT NOT NULL,
  list_id                  UUID REFERENCES oshal_marketing_lists (list_id) ON DELETE SET NULL,
  honeypot_field           TEXT NOT NULL DEFAULT 'company_website',
  signing_secret           TEXT NOT NULL,
  rate_limit_per_ip_hour   INT NOT NULL DEFAULT 10 CHECK (rate_limit_per_ip_hour BETWEEN 1 AND 1000),
  rate_limit_per_form_hour INT NOT NULL DEFAULT 200 CHECK (rate_limit_per_form_hour BETWEEN 1 AND 10000),
  token_ttl_minutes        INT NOT NULL DEFAULT 1440 CHECK (token_ttl_minutes BETWEEN 5 AND 10080),
  confirmation_base_url    TEXT NOT NULL DEFAULT '',
  enabled                  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_sub, slug)
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_signup_forms_owner_updated
  ON oshal_marketing_signup_forms (owner_sub, updated_at DESC);

-- Single-use hashed confirmation tokens backing pending -> confirmed double opt-in transitions.
CREATE TABLE IF NOT EXISTS oshal_marketing_optin_tokens (
  token_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub   TEXT NOT NULL,
  form_id     UUID NOT NULL REFERENCES oshal_marketing_signup_forms (form_id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES oshal_marketing_contacts (contact_id) ON DELETE CASCADE,
  consent_id  UUID NOT NULL REFERENCES oshal_marketing_consents (consent_id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_sub, token_hash)
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_optin_tokens_owner_form
  ON oshal_marketing_optin_tokens (owner_sub, form_id, created_at DESC);

-- Exact-owner FORCE-RLS on signup forms (no operator bypass).
ALTER TABLE oshal_marketing_signup_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_signup_forms FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_signup_forms_exact_owner'
      AND polrelid = 'oshal_marketing_signup_forms'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_signup_forms_exact_owner ON oshal_marketing_signup_forms
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

-- Exact-owner FORCE-RLS on opt-in confirmation tokens (no operator bypass).
ALTER TABLE oshal_marketing_optin_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_optin_tokens FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_optin_tokens_exact_owner'
      AND polrelid = 'oshal_marketing_optin_tokens'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_optin_tokens_exact_owner ON oshal_marketing_optin_tokens
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
