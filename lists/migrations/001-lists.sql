-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Lists 1.0.0: a person's named lists and the items on them. Plain tables with one text primary key each. On the native kernel every package table is a private copy per person; every statement of routes/lists-store.mjs also names the caller (user_sub), so a row is never read or changed for anyone but its own person. No ON CONFLICT, no join and no ORDER BY anywhere: the package sorts.

-- One row per list. name_key is the name as people say it (lower case, without "my" or a trailing "list"), which is
-- how a list is found and what keeps two lists from sharing a name. open_count and done_count are kept beside the
-- list on every change to its items, so the list of lists is one small read.
CREATE TABLE IF NOT EXISTS lists_lists (
  id          TEXT PRIMARY KEY,
  user_sub    TEXT NOT NULL,
  name        TEXT NOT NULL,
  name_key    TEXT NOT NULL,
  position    INTEGER NOT NULL,
  open_count  INTEGER NOT NULL DEFAULT 0,
  done_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS lists_lists_owner ON lists_lists (user_sub);

-- One row per item. position orders the open items (places are 65536 apart, so moving one item changes one row);
-- done items are shown after them, the one finished last first (done_at). due_on is a day, 'YYYY-MM-DD'.
CREATE TABLE IF NOT EXISTS lists_items (
  id          TEXT PRIMARY KEY,
  user_sub    TEXT NOT NULL,
  list_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  note        TEXT,
  quantity    INTEGER,
  due_on      TEXT,
  position    INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  done_at     TEXT
);

CREATE INDEX IF NOT EXISTS lists_items_owner_list ON lists_items (user_sub, list_id);
