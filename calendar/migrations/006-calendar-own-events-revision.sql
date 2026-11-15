-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | The revision of an event a person added in OSHAL (routes/own-events.js, 1.4.0): a fresh value on every add and change, null for a row saved before this column. A change is written only while the row still holds the revision its card was read with, so a change made elsewhere meanwhile is refused, never overwritten (Roger, 2026-11-14: "can't cancel or modify existing meeting"). One plain statement, so the native kernel and PostgreSQL apply the same file.

ALTER TABLE calendar_own_events ADD COLUMN IF NOT EXISTS revision text;
