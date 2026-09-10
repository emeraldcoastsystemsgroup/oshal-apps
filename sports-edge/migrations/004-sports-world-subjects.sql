-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com   | The pull ledger for this package's World Intelligence subjects. Records only WHEN a subject was last pulled and what it returned; the items themselves live in world_items, which is the point — this table exists so a re-pull cool-down survives a restart, not to keep a second copy of the archive.

CREATE TABLE IF NOT EXISTS sports_world_pulls (
  entity        TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  last_pulled   TIMESTAMPTZ NOT NULL DEFAULT now(),
  pulls         INTEGER NOT NULL DEFAULT 1,
  last_fetched  INTEGER NOT NULL DEFAULT 0,
  last_new      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sports_world_pulls_kind ON sports_world_pulls (kind, last_pulled DESC);
