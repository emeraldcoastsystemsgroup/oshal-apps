-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep the operator's reviewed command runs and their coaching as bounded own-scope records.
CREATE TABLE IF NOT EXISTS operations_command_runs (
 user_sub text NOT NULL, id text NOT NULL, created_at timestamptz NOT NULL, record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
