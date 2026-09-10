-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — change-only line capture, the one table in this package that cannot be backfilled.
--
-- THIS TABLE IS THE REASON THE POLLER SHIPPED BEFORE THE MODELS. There is no historical odds
-- endpoint anywhere in this data rail: ESPN serves the line as it is right now and nothing else.
-- An opening line can therefore only ever be obtained by having been watching when it posted, and
-- every day the poller does not run is a slate of openers that can never be recovered or bought.
--
-- CHANGE-ONLY, NOT SAMPLE-PER-POLL. Writing every observation would store 24 identical rows a day
-- per game per book. A row is written only when the quote actually DIFFERS from the one standing,
-- and re-observing the same number extends `last_seen` and bumps `observations`. That keeps the
-- complete movement history at a fraction of the rows AND makes "the line moved" a real row rather
-- than something a reader has to infer by diffing adjacent samples.
--
-- NOTE WHAT IS *NOT* CALLED AN OPENING LINE. The earliest row for a game is the first quote WE saw,
-- which equals the book's opener only if we were already polling when it posted — something this
-- package cannot know. So there is no `opening_line` column asserting it. `sports-line-history.ts`
-- reports an opener CONFIDENCE from how long before kickoff the first row landed, and a caller
-- judges it. A late first observation mislabelled as an opener would quietly corrupt every
-- closing-line-value number computed on top of it.

CREATE TABLE IF NOT EXISTS sports_line_history (
  id            BIGSERIAL PRIMARY KEY,
  league        TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  game_date     TIMESTAMPTZ,
  home_team     TEXT NOT NULL,
  away_team     TEXT NOT NULL,
  book          TEXT NOT NULL,

  -- The quote. All nullable: a book that has not posted a market yet must read as ABSENT, never as
  -- a price of zero — a fabricated 0 would look like a wildly mispriced game to every model.
  home_spread        NUMERIC(5,1),
  home_spread_odds   INTEGER,
  away_spread_odds   INTEGER,
  home_moneyline     INTEGER,
  away_moneyline     INTEGER,
  total              NUMERIC(5,1),

  first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  observations  INTEGER NOT NULL DEFAULT 1
);

-- The poller's hot path: "what is the line standing for this game and book right now", answered by
-- the newest row. Also the read path for a movement series.
CREATE INDEX IF NOT EXISTS idx_sports_line_event_book ON sports_line_history (event_id, book, first_seen DESC);
-- Sweeping the slate by kickoff, for grading and for the pre-kickoff capture pass.
CREATE INDEX IF NOT EXISTS idx_sports_line_game_date ON sports_line_history (league, game_date);
