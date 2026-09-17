-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — per-player completed weeks, the sample the spread model shrinks toward.
--
-- WHY THIS TABLE EXISTS AT ALL. The win-probability objective trades projected points for variance,
-- and until now there was no variance to trade: every player's spread was a positional prior times
-- his projection, so two running backs projected at 13.2 and 13.1 were modelled at 7.26 and 7.21 and
-- the optimiser could not tell them apart. The first live run against a real league (2026-09-09,
-- 12 teams, posture underdog, 40.4% to win) therefore made ZERO variance swaps and returned exactly
-- the highest-projected lineup. Real weekly scores are the only thing that separates those two
-- players, and this is where they accumulate.
--
-- IT IS A SEPARATE TABLE RATHER THAN A COLUMN ON THE PROJECTION CACHE. `sports_fantasy_projections`
-- holds one row per week carrying the whole distilled player universe (~11,600 players). Reading a
-- fifteen-player roster's history out of that would mean loading every completed week's entire
-- payload on a request path. Here the read is a primary-key range over the roster's ids.
--
-- RAW STATS, NEVER POINTS — the same rule the rest of this package runs on. ESPN's `appliedTotal` is
-- unusable for the same reason: a fantasy point total does not exist until a league's scoring rules
-- are applied, and this table is shared by every league on the box. A week stored as points would
-- bake one league's rules into another league's history and look entirely normal doing it.
--
-- THE DATA COSTS NOTHING EXTRA TO COLLECT. Measured live 2026-09-16, one credential-free request for
-- `scoringPeriodId=3` returned 11,617 players AND 1,740 rows carrying week 1's actual stat lines
-- (1,348 of them non-empty) — the completed weeks ride along in the response the refresh already
-- makes. The same response also carried 69,653 rows from the PRIOR season, which is why `season` is
-- part of the key and the filter that populates this table is not optional.

CREATE TABLE IF NOT EXISTS sports_fantasy_player_weeks (
  season      INTEGER NOT NULL,
  week        INTEGER NOT NULL,
  player_id   INTEGER NOT NULL,
  stats       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, player_id)
);
