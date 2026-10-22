-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep immutable own external links and reserve canonical phase/revision attempts before manual shared-connector dispatch.
CREATE TABLE IF NOT EXISTS operations_ticket_links (
 user_sub text NOT NULL, id text NOT NULL, created_at timestamptz NOT NULL, record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
CREATE TABLE IF NOT EXISTS operations_sync_attempts (
 user_sub text NOT NULL, id text NOT NULL, created_at timestamptz NOT NULL, record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
CREATE TABLE IF NOT EXISTS operations_sync_owners (
 user_sub text NOT NULL, id text NOT NULL, record jsonb NOT NULL, PRIMARY KEY(user_sub,id)
);
