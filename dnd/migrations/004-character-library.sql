/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Index reusable private character rows and retain exact story cursors for safe campaign rewinds.
 */

-- Character-library entries intentionally reuse dnd_characters with no campaign.
-- There is no slug uniqueness constraint here: two imported sheets may derive
-- the same display slug and remain independently addressable by character_id.
CREATE INDEX IF NOT EXISTS idx_dnd_characters_library
    ON dnd_characters (user_sub, updated_at DESC)
    WHERE campaign_id IS NULL;

-- New save points remember the exact story beat they belong to. Legacy rows
-- remain NULL and are restored with an explicit warning instead of guessing
-- how much story history should be discarded.
ALTER TABLE dnd_snapshots ADD COLUMN IF NOT EXISTS archive_seq bigint;
