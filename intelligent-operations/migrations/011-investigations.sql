-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Bind one immutable evidence reservation to one canonical investigation attempt without granting raw data or cluster authority.
CREATE TABLE IF NOT EXISTS operations_investigations (
 user_sub text NOT NULL,
 id text NOT NULL,
 created_at timestamptz NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
