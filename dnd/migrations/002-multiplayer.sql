/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-20 23:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Multi-user shared table: join codes on campaigns, a players/claims table (which user plays which hero), and a revision counter on encounters so every device at the table can cheaply sync the same live board.
 */

-- Shareable 6-char join code per campaign (pgcrypto from 001).
ALTER TABLE dnd_campaigns ADD COLUMN IF NOT EXISTS join_code text;
UPDATE dnd_campaigns
   SET join_code = upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6))
 WHERE join_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dnd_join_code ON dnd_campaigns (join_code);

-- Board revision counter — bumped on every save; devices poll "anything past rev N?".
ALTER TABLE dnd_encounters ADD COLUMN IF NOT EXISTS rev bigint NOT NULL DEFAULT 0;

-- Who is at the table and which hero they claimed. The campaign OWNER is not
-- required to have a row (owner status comes from dnd_campaigns.user_sub and
-- grants control of every unclaimed hero — host powers).
CREATE TABLE IF NOT EXISTS dnd_players (
    player_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id    uuid        NOT NULL REFERENCES dnd_campaigns (campaign_id) ON DELETE CASCADE,
    user_sub       text        NOT NULL,
    display_name   text,
    character_slug text,                              -- NULL until they claim a hero
    joined_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_dnd_player UNIQUE (campaign_id, user_sub)
);
-- One hero, one player (partial unique index so unclaimed rows don't collide).
CREATE UNIQUE INDEX IF NOT EXISTS uq_dnd_claim
    ON dnd_players (campaign_id, character_slug) WHERE character_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dnd_players_user ON dnd_players (user_sub);
