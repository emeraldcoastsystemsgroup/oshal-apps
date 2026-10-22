-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Persist immutable source-scoped topology generations and exact correlation evidence.
CREATE TABLE IF NOT EXISTS operations_topology_scans (
 user_sub text NOT NULL,
 id text NOT NULL,
 source_uri text NOT NULL,
 collection_id text NOT NULL,
 observed_at timestamptz NOT NULL,
 payload_hash text NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id),
 UNIQUE(user_sub,source_uri,collection_id,observed_at)
);
CREATE INDEX IF NOT EXISTS operations_topology_time ON operations_topology_scans(user_sub,observed_at);
CREATE TABLE IF NOT EXISTS operations_topology_decisions (
 user_sub text NOT NULL,
 id text NOT NULL,
 created_at timestamptz NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
