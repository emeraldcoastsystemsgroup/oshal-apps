-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | The zone an added event was entered in (routes/own-events.js): an IANA name such as America/Chicago, or the '+HH:MM' offset its start carried, null for an all-day event or a row saved before this column. The routes show each event's start in this zone instead of the raw UTC instant (sweep 9). One plain statement, so the native kernel and PostgreSQL apply the same file.

ALTER TABLE calendar_own_events ADD COLUMN IF NOT EXISTS time_zone text;
