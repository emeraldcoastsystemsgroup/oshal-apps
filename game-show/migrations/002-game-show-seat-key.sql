-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE/TIME           | AUTHOR                                     | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-10-11 00:00:00 | maintainer@emeraldcoastsystemsgroup.com    | AI and house podiums get their own identity column. They used to write a synthetic subject (npc:<skill>:<uuid>, house:<uuid>) into user_sub, which the native kernel refuses: an owner field may only hold the admitted caller. Such a podium now has user_sub NULL and its identity in seat_key; a person's seat keeps its subject and a NULL seat_key. uq_gameshow_seat (room_id, user_sub) stays: NULLs are distinct under it on PostgreSQL and on the native kernel, which cannot drop a UNIQUE constraint.

ALTER TABLE gameshow_seats ADD COLUMN IF NOT EXISTS seat_key text;
ALTER TABLE gameshow_seats ALTER COLUMN user_sub DROP NOT NULL;
