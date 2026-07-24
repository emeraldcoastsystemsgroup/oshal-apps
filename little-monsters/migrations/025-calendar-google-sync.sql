-- -----------------------------------------------------------------------------
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE/TIME           | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-06-12 20:44:00 | roger.murphy@agenticfederal.us   | Google Calendar two-way sync: track each local event's Google event id + last sync time so push is idempotent (no duplicate events on re-push) and un-sync can delete the remote copy
-- -----------------------------------------------------------------------------

ALTER TABLE lm_calendar_events ADD COLUMN IF NOT EXISTS google_event_id VARCHAR(255);
ALTER TABLE lm_calendar_events ADD COLUMN IF NOT EXISTS google_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_lm_calendar_google_event
  ON lm_calendar_events (google_event_id)
  WHERE google_event_id IS NOT NULL;
