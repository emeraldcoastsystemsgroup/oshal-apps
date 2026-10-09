-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Per-dispatch callback grants for the GPU worker,
-- replacing the fleet service secret on /api/lora/ingest. One grant per dispatch, bound to one
-- owner, one character, one ticket and the callback kinds that job may send; it expires, can be
-- revoked, and stores only the key derived from the secret the worker holds. Every verified
-- request records its nonce once, so a captured request cannot be replayed.
-- -----------------------------------------------------------------------------
--
-- Both tables are under forced owner RLS. A grant is visible to its owner or an operator only, and
-- its WITH CHECK also requires the grant owner to be the character's owner, so neither a console
-- request nor the system-identity schedule can mint a grant for someone else's character. Deleting
-- a character, or a grant, removes its nonces.

CREATE TABLE IF NOT EXISTS oshal_lora_callback_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,
  owner_sub TEXT NOT NULL,
  ticket_id TEXT,
  dispatch_kind TEXT NOT NULL CHECK (dispatch_kind IN ('train', 'validate', 'improve', 'overnight', 'dataset-import')),
  callback_kinds TEXT[] NOT NULL CHECK (cardinality(callback_kinds) > 0),
  signing_key TEXT NOT NULL CHECK (signing_key ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_lora_callback_grants_character
  ON oshal_lora_callback_grants (character_id, expires_at);

ALTER TABLE oshal_lora_callback_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_lora_callback_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oshal_lora_callback_grants_owner_policy ON oshal_lora_callback_grants;
CREATE POLICY oshal_lora_callback_grants_owner_policy ON oshal_lora_callback_grants
  USING (current_setting('oshal.current_sub', true) = oshal_lora_callback_grants.owner_sub
         OR current_setting('oshal.is_operator', true) = 'on')
  WITH CHECK ((current_setting('oshal.current_sub', true) = oshal_lora_callback_grants.owner_sub
               OR current_setting('oshal.is_operator', true) = 'on')
              AND EXISTS (SELECT 1 FROM oshal_lora_characters c
                           WHERE c.id = oshal_lora_callback_grants.character_id
                             AND c.owner_sub = oshal_lora_callback_grants.owner_sub));

CREATE TABLE IF NOT EXISTS oshal_lora_callback_nonces (
  grant_id UUID NOT NULL REFERENCES oshal_lora_callback_grants(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{16,64}$'),
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (grant_id, nonce)
);

ALTER TABLE oshal_lora_callback_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_lora_callback_nonces FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oshal_lora_callback_nonces_owner_policy ON oshal_lora_callback_nonces;
CREATE POLICY oshal_lora_callback_nonces_owner_policy ON oshal_lora_callback_nonces
  USING (EXISTS (SELECT 1 FROM oshal_lora_callback_grants g
                  WHERE g.id = oshal_lora_callback_nonces.grant_id
                    AND (current_setting('oshal.current_sub', true) = g.owner_sub
                         OR current_setting('oshal.is_operator', true) = 'on')))
  WITH CHECK (EXISTS (SELECT 1 FROM oshal_lora_callback_grants g
                       WHERE g.id = oshal_lora_callback_nonces.grant_id
                         AND (current_setting('oshal.current_sub', true) = g.owner_sub
                              OR current_setting('oshal.is_operator', true) = 'on')));
