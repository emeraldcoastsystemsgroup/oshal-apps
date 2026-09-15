-- CHANGE LOG
-- SEQ | AUTHOR | DESCRIPTION
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve legacy rows without guessing their identity issuer; add owner-qualified metadata.
ALTER TABLE ps_portraits ADD COLUMN IF NOT EXISTS owner_issuer TEXT;
ALTER TABLE ps_portraits ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_ps_portraits_principal ON ps_portraits (owner_issuer, user_sub, created_at DESC);
-- NULL owner_issuer is intentionally inaccessible to the protected package. An operator must
-- review an exact historical identity mapping before any separate migration can assign it.
