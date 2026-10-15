-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE/TIME           | AUTHOR                                     | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-10-11 00:00:00 | maintainer@emeraldcoastsystemsgroup.com    | AI and house podiums get their own table. A podium no person sits at cannot live in gameshow_seats on the native kernel: an owner field may hold only the admitted caller (a NULL user_sub is filled with the caller), and uq_gameshow_seat (room_id, user_sub) already holds the host's own seat; the native kernel cannot drop a UNIQUE constraint. A podium row belongs to the host who added it (user_sub) and is identified by seat_key (npc:<skill>:<uuid> or house:<uuid>). Migration 002's seat_key column on gameshow_seats is left in place (it is applied and its digest recorded) and stays NULL for a person's seat.

CREATE TABLE IF NOT EXISTS gameshow_podiums (
    seat_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id        uuid        NOT NULL REFERENCES gameshow_rooms (room_id) ON DELETE CASCADE,
    user_sub       text        NOT NULL,                       -- the host who added the podium
    seat_key       text        NOT NULL,                       -- npc:<skill>:<uuid> | house:<uuid>
    display_name   text,
    team           text,                                       -- 'A' | 'B' | NULL (free-for-all)
    podium_index   int,
    role           text        NOT NULL DEFAULT 'player',
    presence_kind  text        NOT NULL DEFAULT 'avatar',      -- camera | avatar | off
    avatar_id      text,
    presence_rev   bigint      NOT NULL DEFAULT 0,
    score          int         NOT NULL DEFAULT 0,             -- end-of-game snapshot, as gameshow_seats.score
    joined_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_gameshow_podium_key UNIQUE (room_id, seat_key)
);
CREATE INDEX IF NOT EXISTS idx_gameshow_podiums_room ON gameshow_podiums (room_id);
