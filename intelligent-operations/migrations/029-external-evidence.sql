-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | One sealed optional enrichment outcome per evidence reservation, separate from the immutable retained packet.
CREATE TABLE IF NOT EXISTS operations_external_evidence (
 user_sub text NOT NULL, id text NOT NULL, created_at timestamptz NOT NULL, record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
