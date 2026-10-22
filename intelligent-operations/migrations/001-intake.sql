-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Separate durable delivery identity, attempts and processing admission in the caller's native SQL scope.
CREATE TABLE IF NOT EXISTS operations_deliveries (
 user_sub text NOT NULL,
 id text NOT NULL,
 source_uri text NOT NULL,
 event_id text,
 payload_hash text NOT NULL,
 source_revision text NOT NULL,
 record jsonb NOT NULL,
 received_at timestamptz NOT NULL,
 PRIMARY KEY (user_sub,id)
);
CREATE TABLE IF NOT EXISTS operations_delivery_attempts (
 user_sub text NOT NULL,
 id text NOT NULL,
 delivery_id text NOT NULL,
 outcome text NOT NULL,
 record jsonb NOT NULL,
 received_at timestamptz NOT NULL,
 PRIMARY KEY (user_sub,id),
 FOREIGN KEY (user_sub,delivery_id) REFERENCES operations_deliveries(user_sub,id)
);
CREATE TABLE IF NOT EXISTS operations_processing (
 user_sub text NOT NULL,
 id text NOT NULL,
 delivery_id text NOT NULL,
 state text NOT NULL,
 revision integer NOT NULL,
 record jsonb NOT NULL,
 created_at timestamptz NOT NULL,
 PRIMARY KEY (user_sub,id),
 FOREIGN KEY (user_sub,delivery_id) REFERENCES operations_deliveries(user_sub,id)
);
CREATE INDEX IF NOT EXISTS operations_delivery_time ON operations_deliveries(user_sub,received_at);
CREATE INDEX IF NOT EXISTS operations_attempt_time ON operations_delivery_attempts(user_sub,received_at);
CREATE INDEX IF NOT EXISTS operations_pending ON operations_processing(user_sub,state);
