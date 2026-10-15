/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-20 22:25:05 | roger.murphy@emeraldcoastsystemsgroup.com  | Initial D&D app schema: per-user campaigns, live encounter board state, characters, and the campaign story archive. Applied idempotently on install (ADR-085 P2 migration runner).
 * 2026-08-06 02:43:35 | maintainer@emeraldcoastsystemsgroup.com     | Replace the obsolete RLS follow-up note with the shipped migration-006 owner, member, and transaction-local join-capability boundary.
 * 2026-10-10 18:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Final table shape for the native kernel, which skips 005 and 006 (nativeMigrations in oshal-app.yaml): owner_sub on every table and member_subs on campaigns (routes write them explicitly), and dnd_archive's roll payload column, its CHECK and its idempotency index, moved here from 005's DO block. CREATE ... IF NOT EXISTS keeps an existing PostgreSQL install unchanged; 005 and 006 still apply there and find these by name.
 */

-- ISOLATION BASELINE: every row carries user_sub (NOT NULL) and every route
-- query filters on it. Migration 006 adds authoritative owner_sub backfills,
-- member-safe policies, and ENABLE + FORCE RLS keyed to the request identity
-- GUCs; join-by-code is limited to a validated transaction-local capability.
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One row per campaign a player owns.
CREATE TABLE IF NOT EXISTS dnd_campaigns (
    campaign_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_sub     text        NOT NULL,
    name         text        NOT NULL,
    adventure_id text        NOT NULL,
    status       text        NOT NULL DEFAULT 'active',   -- active | archived
    owner_sub    text,                                    -- the owner; 006 stamps it on PostgreSQL, routes write it
    member_subs  text[]      NOT NULL DEFAULT ARRAY[]::text[],
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
    owner_sub    text,
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
    owner_sub    text,
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
    payload     jsonb,                               -- versioned roll event (005 on PostgreSQL)
    owner_sub   text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_dnd_archive_roll_payload CHECK (
      payload IS NULL OR (
        jsonb_typeof(payload) = 'object'
        AND payload ? 'v'
        AND payload ? 'eventId'
        AND payload ? 'rolls'
        AND payload->>'v' = '1'
        AND length(payload->>'eventId') BETWEEN 1 AND 160
        AND jsonb_typeof(payload->'rolls') = 'array'
        AND jsonb_array_length(payload->'rolls') BETWEEN 1 AND 64
        AND octet_length(payload::text) <= 32768
      )
    )
);
CREATE INDEX IF NOT EXISTS idx_dnd_archive_campaign ON dnd_archive (campaign_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dnd_archive_roll_event
  ON dnd_archive (campaign_id, (payload->>'eventId'))
  WHERE payload IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dnd_archive_user ON dnd_archive (user_sub);
