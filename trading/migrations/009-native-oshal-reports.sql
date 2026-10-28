-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Private owner-scoped native report snapshots and presenter preferences. Reports read trading evidence; they never submit orders or publish externally.
CREATE TABLE IF NOT EXISTS trading_oshal_reports (user_sub TEXT NOT NULL, report_id TEXT NOT NULL, session_date TEXT NOT NULL, payload TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (user_sub, report_id));
CREATE TABLE IF NOT EXISTS trading_report_preferences (user_sub TEXT NOT NULL PRIMARY KEY, presenter_name TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
