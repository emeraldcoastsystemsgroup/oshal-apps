-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Persist eligibility and fenced processing leases in the existing delivery queue.
ALTER TABLE operations_processing ADD COLUMN IF NOT EXISTS ready_at timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z';
CREATE INDEX IF NOT EXISTS operations_processing_ready ON operations_processing(user_sub,state,ready_at);
CREATE TABLE IF NOT EXISTS operations_processing_config (
 user_sub text NOT NULL,
 id text NOT NULL,
 revision integer NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
