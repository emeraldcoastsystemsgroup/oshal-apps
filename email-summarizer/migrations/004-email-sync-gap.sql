-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                     | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com    | Where a catch-up on new mail stopped (routes/mail-store.js syncGmail): the stored stretch above a gap in the copy, from gap_low_at up to gap_top_at, null when the copy has no gap. The next pass reads only the mail above the stretch and the gap below it instead of re-reading the stretch (Roger's copy stalled on 2026-11-03 after four days with the job stopped). Plain statements, so the native kernel and PostgreSQL apply the same file.

ALTER TABLE oshal_email_sync ADD COLUMN IF NOT EXISTS gap_top_at TIMESTAMPTZ;
ALTER TABLE oshal_email_sync ADD COLUMN IF NOT EXISTS gap_low_at TIMESTAMPTZ;
