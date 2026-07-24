/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-20 22:25:05 | roger.murphy@emeraldcoastsystemsgroup.com  | Initial D&D app schema: per-user campaigns, live encounter board state, characters, and the campaign story archive. Applied idempotently on install (ADR-085 P2 migration runner).
 */

-- ISOLATION: every row carries user_sub (NOT NULL) and every route query filters
-- on it (app-layer scoping — the same model little-monsters uses via external_id).
-- RLS hardening (per-request GUC policies) is a tracked follow-up in README.md.
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One row per campaign a player owns.
CREATE TABLE IF NOT EXISTS dnd_campaigns (
    campaign_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_sub     text        NOT NULL,
    name         text        NOT NULL,
    adventure_id text        NOT NULL,
    status       text        NOT NULL DEFAULT 'active',   -- active | archived
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dnd_campaigns_user ON dnd_campaigns (user_sub, status);

-- The live board: one encounter per campaign (P1). `state` holds the full
-- serialized tabletop — tokens with positions/HP, initiative order, whose turn,
-- the round counter, and the current mode (exploration | combat).
CREATE TABLE IF NOT EXISTS dnd_encounters (
    encounter_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id  uuid        NOT NULL REFERENCES dnd_campaigns (campaign_id) ON DELETE CASCADE,
    user_sub     text        NOT NULL,
    adventure_id text        NOT NULL,
    state        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    round        integer     NOT NULL DEFAULT 0,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_dnd_encounter_campaign UNIQUE (campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_dnd_encounters_user ON dnd_encounters (user_sub);

-- Persisted characters. P1 seeds the bundled pre-gen party into this table on
-- first play so HP, XP, and level survive between sessions and can level up.
CREATE TABLE IF NOT EXISTS dnd_characters (
    character_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_sub     text        NOT NULL,
    campaign_id  uuid        REFERENCES dnd_campaigns (campaign_id) ON DELETE CASCADE,
    slug         text        NOT NULL,           -- 'bram', 'della', or an imported id
    name         text        NOT NULL,
    sheet        jsonb       NOT NULL,           -- full stat block (from party.json or an import)
    xp           integer     NOT NULL DEFAULT 0,
    level        integer     NOT NULL DEFAULT 1,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_dnd_character_slug UNIQUE (campaign_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_dnd_characters_user ON dnd_characters (user_sub);

-- The story archive — the campaign's memory. Every meaningful beat is appended
-- here so the party can look back on their legend and the DM can recall it.
CREATE TABLE IF NOT EXISTS dnd_archive (
    entry_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_sub    text        NOT NULL,
    campaign_id uuid        NOT NULL REFERENCES dnd_campaigns (campaign_id) ON DELETE CASCADE,
    seq         bigint      NOT NULL,
    kind        text        NOT NULL,            -- narration | combat | milestone | table-talk | level-up
    content     text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dnd_archive_campaign ON dnd_archive (campaign_id, seq);
CREATE INDEX IF NOT EXISTS idx_dnd_archive_user ON dnd_archive (user_sub);
