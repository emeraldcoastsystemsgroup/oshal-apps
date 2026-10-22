-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Durable rule generations, decisions, suppression and pre-evidence reservations.
CREATE TABLE IF NOT EXISTS operations_policies (
 user_sub text NOT NULL,
 id text NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(user_sub,
 id)
);
CREATE TABLE IF NOT EXISTS operations_policy_bindings (
 user_sub text NOT NULL,
 id text NOT NULL,
 revision integer NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(user_sub,
 id)
);
CREATE TABLE IF NOT EXISTS operations_filter_decisions (
 user_sub text NOT NULL,
 id text NOT NULL,
 delivery_id text NOT NULL,
 record jsonb NOT NULL,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(user_sub,
 id)
);
CREATE TABLE IF NOT EXISTS operations_processing_attempts (
 user_sub text NOT NULL,
 id text NOT NULL,
 record jsonb NOT NULL,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(user_sub,
 id)
);
CREATE TABLE IF NOT EXISTS operations_symptoms (
 user_sub text NOT NULL,
 id text NOT NULL,
 record jsonb NOT NULL,
 PRIMARY KEY(user_sub,
 id)
);
CREATE TABLE IF NOT EXISTS operations_evidence_work (
 user_sub text NOT NULL,
 id text NOT NULL,
 state text NOT NULL,
 record jsonb NOT NULL,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(user_sub,
 id)
);
CREATE TABLE IF NOT EXISTS operations_symptom_occurrences (
 user_sub text NOT NULL, id text NOT NULL, record jsonb NOT NULL, PRIMARY KEY(user_sub,id)
);
