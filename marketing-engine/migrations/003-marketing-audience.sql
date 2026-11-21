/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine P1 audience store: contacts,
 *     recipient consents (channel, purpose, status, full sign-up evidence JSON), lists, list
 *     members, and normalized-hash suppressions. Every table carries owner_sub with ENABLE and
 *     FORCE ROW LEVEL SECURITY and an exact-owner policy on oshal.current_sub (no operator
 *     bypass). Mirrored by the lazy-DDL chokepoint in src-routes/marketing-audience.ts.
 */

-- Contacts: owner-scoped audience records keyed uniquely per owner by normalized email SHA-256 hash.
CREATE TABLE IF NOT EXISTS oshal_marketing_contacts (
  contact_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub    TEXT NOT NULL,
  email        TEXT NOT NULL,
  email_hash   TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  tags         JSONB NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','unsubscribed','bounced','suppressed')),
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_sub, email_hash)
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_contacts_owner_updated
  ON oshal_marketing_contacts (owner_sub, updated_at DESC);

-- Recipient consent records: channel, purpose, status, and sign-up evidence JSON
-- (formText, recordedAt, ip, userAgent, utm, tokenHash). Cascades on contact delete.
CREATE TABLE IF NOT EXISTS oshal_marketing_consents (
  consent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub  TEXT NOT NULL,
  contact_id UUID NOT NULL REFERENCES oshal_marketing_contacts (contact_id) ON DELETE CASCADE,
  channel    TEXT NOT NULL CHECK (channel IN ('email','sms')),
  purpose    TEXT NOT NULL DEFAULT 'marketing',
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','revoked')),
  evidence   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_consents_owner_contact
  ON oshal_marketing_consents (owner_sub, contact_id, created_at DESC);

-- Audience lists: owner-scoped named segments with per-owner unique slug.
CREATE TABLE IF NOT EXISTS oshal_marketing_lists (
  list_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub   TEXT NOT NULL,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_sub, slug)
);

-- List memberships: many-to-many between lists and contacts, cascading on delete of either.
CREATE TABLE IF NOT EXISTS oshal_marketing_list_members (
  owner_sub  TEXT NOT NULL,
  list_id    UUID NOT NULL REFERENCES oshal_marketing_lists (list_id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES oshal_marketing_contacts (contact_id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_oshal_marketing_list_members_owner_contact
  ON oshal_marketing_list_members (owner_sub, contact_id);

-- Suppressions: normalized lowercase trimmed address SHA-256 hash + reason per (owner, channel).
CREATE TABLE IF NOT EXISTS oshal_marketing_suppressions (
  suppression_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub      TEXT NOT NULL,
  channel        TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms')),
  address_hash   TEXT NOT NULL,
  reason         TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'manual',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_sub, channel, address_hash)
);

-- Exact-owner FORCE-RLS on every audience table (no operator bypass).
ALTER TABLE oshal_marketing_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_contacts FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_contacts_exact_owner'
      AND polrelid = 'oshal_marketing_contacts'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_contacts_exact_owner ON oshal_marketing_contacts
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

ALTER TABLE oshal_marketing_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_consents FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_consents_exact_owner'
      AND polrelid = 'oshal_marketing_consents'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_consents_exact_owner ON oshal_marketing_consents
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

ALTER TABLE oshal_marketing_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_lists FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_lists_exact_owner'
      AND polrelid = 'oshal_marketing_lists'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_lists_exact_owner ON oshal_marketing_lists
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

ALTER TABLE oshal_marketing_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_list_members FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_list_members_exact_owner'
      AND polrelid = 'oshal_marketing_list_members'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_list_members_exact_owner ON oshal_marketing_list_members
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

ALTER TABLE oshal_marketing_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_marketing_suppressions FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'oshal_marketing_suppressions_exact_owner'
      AND polrelid = 'oshal_marketing_suppressions'::regclass
  ) THEN
    CREATE POLICY oshal_marketing_suppressions_exact_owner ON oshal_marketing_suppressions
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
