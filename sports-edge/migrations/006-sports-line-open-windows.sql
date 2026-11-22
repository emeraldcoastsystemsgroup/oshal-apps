-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com   | Item C (0.12.4): add per-row open-window and prior-poll-absent columns to sports_line_history, plus sports_line_poll_state to track absent-price polls per (event, book) and upcoming game kickoffs for adaptive open-window cadence.

ALTER TABLE sports_line_history
  ADD COLUMN IF NOT EXISTS in_open_window BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE sports_line_history
  ADD COLUMN IF NOT EXISTS prior_poll_absent BOOLEAN NOT NULL DEFAULT FALSE;

-- Per-(event_id, book) latest poll outcome. Records absent-price polls (had_price = FALSE) so that
-- when the first quote arrives inside the league's expected open window, captureQuote can prove
-- the immediately preceding poll of the same game and book had no price. Also holds upcoming game
-- kickoffs so the 15-minute scheduler stays on the slow cadence outside every open window with
-- zero ESPN requests.
CREATE TABLE IF NOT EXISTS sports_line_poll_state (
  event_id   TEXT NOT NULL,
  book       TEXT NOT NULL,
  league     TEXT NOT NULL,
  game_date  TIMESTAMPTZ,
  had_price  BOOLEAN NOT NULL DEFAULT FALSE,
  polled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, book)
);

CREATE INDEX IF NOT EXISTS idx_sports_line_poll_state_date
  ON sports_line_poll_state (league, game_date);
