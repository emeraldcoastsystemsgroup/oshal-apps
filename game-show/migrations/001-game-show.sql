-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE/TIME           | AUTHOR                                     | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-07-21 20:16:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Game Show schema: rooms with join codes, podium seats, the live game state (jsonb + monotonic rev for cheap multi-device polling), an event log, and per-seat presence frames.
--
-- Every row carries user_sub and is filtered on it in every query. The live board
-- is ONE gameshow_state row per room whose `rev` counter is bumped on every save;
-- every device (TV, phone, clicker, host desk) polls "anything past rev N?".

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- A room is one live game session. The OWNER (user_sub) is the host who opened it.
CREATE TABLE IF NOT EXISTS gameshow_rooms (
    room_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_sub    text        NOT NULL,                          -- host / owner
    show_id     text        NOT NULL DEFAULT 'family-feud',    -- which lib/shows module is loaded
    name        text,
    join_code   text        NOT NULL,                          -- shareable 6-char code
    status      text        NOT NULL DEFAULT 'lobby',          -- lobby | live | ended
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gameshow_join_code ON gameshow_rooms (join_code);
CREATE INDEX IF NOT EXISTS idx_gameshow_rooms_user ON gameshow_rooms (user_sub);

-- The live board — exactly one row per room. `state` is the show-agnostic envelope
-- (phase, buzzer, shot/cutaway, interview, scores) plus the show-specific `board`.
-- `rev` is bumped on every write; devices poll it to converge on the same state.
CREATE TABLE IF NOT EXISTS gameshow_state (
    room_id     uuid PRIMARY KEY REFERENCES gameshow_rooms (room_id) ON DELETE CASCADE,
    user_sub    text        NOT NULL,
    state       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    rev         bigint      NOT NULL DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Who is at the table and at which podium. A seat is per (room, user_sub); a single
-- person may attach several DEVICES to one seat (a TV to watch + a phone as clicker)
-- simply by being signed in on each — no pairing needed. presence_kind is the
-- swappable "video-frame module" the player chose for their podium.
CREATE TABLE IF NOT EXISTS gameshow_seats (
    seat_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id        uuid        NOT NULL REFERENCES gameshow_rooms (room_id) ON DELETE CASCADE,
    user_sub       text        NOT NULL,
    display_name   text,
    team           text,                                       -- 'A' | 'B' | NULL (free-for-all)
    podium_index   int,                                        -- stable slot within the team/stage
    role           text        NOT NULL DEFAULT 'player',      -- player | host | audience
    presence_kind  text        NOT NULL DEFAULT 'avatar',      -- camera | avatar | off
    avatar_id      text,                                       -- chosen avatar when presence_kind='avatar'
    presence_rev   bigint      NOT NULL DEFAULT 0,             -- bumped when a new camera frame is posted
    score          int         NOT NULL DEFAULT 0,             -- persisted end-of-game snapshot (state.jsonb is authoritative in play)
    joined_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_gameshow_seat UNIQUE (room_id, user_sub)
);
CREATE INDEX IF NOT EXISTS idx_gameshow_seats_user ON gameshow_seats (user_sub);
CREATE INDEX IF NOT EXISTS idx_gameshow_seats_room ON gameshow_seats (room_id);

-- Chronological event log — host lines, reveals, strikes, steals, interviews — used
-- by the broadcast surface for the transcript/caption tail and by the host recap.
CREATE TABLE IF NOT EXISTS gameshow_events (
    event_id    bigserial PRIMARY KEY,
    room_id     uuid        NOT NULL REFERENCES gameshow_rooms (room_id) ON DELETE CASCADE,
    user_sub    text        NOT NULL,
    seq         int         NOT NULL,                          -- per-room monotonic sequence
    kind        text        NOT NULL,                          -- host | reveal | strike | steal | interview | milestone
    content     text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gameshow_events_room_seq ON gameshow_events (room_id, seq);

-- Latest camera still per podium. Presence changes constantly and must NOT bump the
-- shared room rev (that would force every device to re-pull full game state); instead
-- gameshow_seats.presence_rev is bumped here and sync reports it, so each device
-- re-fetches only the seat frames that actually changed.
CREATE TABLE IF NOT EXISTS gameshow_presence (
    seat_id     uuid PRIMARY KEY REFERENCES gameshow_seats (seat_id) ON DELETE CASCADE,
    room_id     uuid        NOT NULL REFERENCES gameshow_rooms (room_id) ON DELETE CASCADE,
    mime        text        NOT NULL DEFAULT 'image/jpeg',
    frame       bytea,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gameshow_presence_room ON gameshow_presence (room_id);
