-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Owner-scoped index of the rendered OSHAL report videos (one row per account per session). The bytes live in the package's lasting directory, written by the report studio engine; these rows are what the page lists and what the stream route checks before serving a file.
CREATE TABLE IF NOT EXISTS trading_report_videos (
  user_sub TEXT NOT NULL,
  session_date TEXT NOT NULL,
  file TEXT NOT NULL,
  account_label TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  bytes BIGINT,
  seconds REAL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_sub, session_date, file)
);
