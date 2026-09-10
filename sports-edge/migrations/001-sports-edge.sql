-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — followed teams, the cached season ratings and game previews, the per-user settings overrides, and the pre-registered prediction ledger that grades on closing-line value.
--
-- Applied idempotently at activation (APP_PACKAGE_MIGRATIONS, tracked per (app, file) in
-- app_package_migrations). sports-store.ts ALSO creates these on first use, because that flag is a
-- flag — the app must work on a deployment where migrations are off.

-- The teams a person follows. This is the whole premise of the app: the unit of work is a game
-- preview for a team you chose, not a sweep of every game on the board. UNIQUE (user_sub, league,
-- team) makes "follow" idempotent, so a double-click cannot create a duplicate row.
CREATE TABLE IF NOT EXISTS sports_followed_teams (
  id           BIGSERIAL PRIMARY KEY,
  user_sub     TEXT NOT NULL,
  league       TEXT NOT NULL,
  team         TEXT NOT NULL,          -- abbreviation, e.g. 'SEA'
  team_id      TEXT NOT NULL,          -- ESPN id; every other endpoint keys on this
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sports_followed_teams_unique UNIQUE (user_sub, league, team)
);

CREATE INDEX IF NOT EXISTS idx_sports_followed_user ON sports_followed_teams (user_sub);

-- Season ratings, cached. Rebuilding these walks every team's schedule — around thirty requests
-- per league — so it is a slow background job, never a request-path computation. One row per
-- (league, season); the payload carries the Elo, power and unit-rating tables together because
-- they are always read together and are always derived from the same tape.
CREATE TABLE IF NOT EXISTS sports_ratings_cache (
  league       TEXT NOT NULL,
  season       INTEGER NOT NULL,
  payload      JSONB NOT NULL,
  games        INTEGER NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  build_ms     INTEGER,
  PRIMARY KEY (league, season)
);

-- A built game preview. Keyed by ESPN event id so a game followed by three people is built once.
-- Stored rather than recomputed because a preview costs several external reads and the surface
-- must open instantly — the same lesson the Kalshi scan learned the expensive way.
CREATE TABLE IF NOT EXISTS sports_previews (
  event_id     TEXT PRIMARY KEY,
  league       TEXT NOT NULL,
  game_date    TIMESTAMPTZ,
  home_team    TEXT NOT NULL,
  away_team    TEXT NOT NULL,
  payload      JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sports_previews_date ON sports_previews (game_date);

-- Config overrides on top of the manifest's settings.schema defaults.
--   scope_key = '__deployment__' → refresh cadence (operator-only; one refresh serves everyone)
--   scope_key = <user_sub>       → that person's horizon and alert knobs
-- A real OIDC sub can never collide with the sentinel: subs do not start with '__'.
CREATE TABLE IF NOT EXISTS sports_settings (
  scope_key  TEXT PRIMARY KEY,
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- THE LEDGER. Every call this package makes is written here BEFORE kickoff and graded after the
-- final whistle. It is the only thing that can ever justify staking money, and it is deliberately
-- shaped like kalshi_predictions so the same scorecard discipline applies.
--
-- Three columns carry the honesty of the whole package:
--   price_at_pick   — what was actually available when we called it. Without it there is no CLV.
--   closing_price   — what the same side closed at. The market's own verdict on our pick.
--   market_brier    — the market's Brier on this same game. Our Brier alone means nothing; the
--                     only bar that matters is whether we beat the price we would have paid.
--
-- `strategy` separates the voting ensemble from the shadow strategies (market-blend, market-only,
-- espn-predictor) that are recorded on every game and never staked. A shadow that beats the
-- ensemble is evidence the ensemble adds nothing, and that has to be visible from day one.
CREATE TABLE IF NOT EXISTS sports_predictions (
  id              BIGSERIAL PRIMARY KEY,
  strategy        TEXT NOT NULL,
  league          TEXT NOT NULL,
  event_id        TEXT NOT NULL,
  game_date       TIMESTAMPTZ,
  home_team       TEXT NOT NULL,
  away_team       TEXT NOT NULL,
  market          TEXT NOT NULL,          -- 'moneyline' | 'spread'
  side            TEXT NOT NULL,          -- 'home' | 'away'
  selection       TEXT NOT NULL,          -- e.g. 'SEA -3.5'
  model_prob      NUMERIC(6,5) NOT NULL,
  market_prob     NUMERIC(6,5) NOT NULL,
  edge            NUMERIC(7,5) NOT NULL,
  price_at_pick   INTEGER,                -- American odds available at pick time
  spread_at_pick  NUMERIC(5,1),           -- home-side spread at pick time
  stake_fraction  NUMERIC(6,5) NOT NULL DEFAULT 0,
  projected_margin NUMERIC(6,2),
  rationale       JSONB,                  -- every model's contribution, so a bad call is diagnosable
  user_sub        TEXT,                   -- null for deployment-level strategy rows
  settled         BOOLEAN NOT NULL DEFAULT FALSE,
  home_score      INTEGER,
  away_score      INTEGER,
  won             BOOLEAN,
  brier           NUMERIC(8,6),
  market_brier    NUMERIC(8,6),
  closing_price   INTEGER,
  closing_spread  NUMERIC(5,1),
  clv             NUMERIC(8,6),           -- probability points we beat the close by
  pnl_units       NUMERIC(8,4),           -- profit per 1 unit staked, at price_at_pick
  graded_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One call per strategy per market per side per game. Re-running the poller must update a row,
  -- never append a second opinion on the same bet — a ledger that double-counts cannot be graded.
  CONSTRAINT sports_predictions_unique UNIQUE (strategy, event_id, market, side)
);

CREATE INDEX IF NOT EXISTS idx_sports_predictions_open ON sports_predictions (settled, game_date);
CREATE INDEX IF NOT EXISTS idx_sports_predictions_strategy ON sports_predictions (strategy, settled);
CREATE INDEX IF NOT EXISTS idx_sports_predictions_event ON sports_predictions (event_id);
