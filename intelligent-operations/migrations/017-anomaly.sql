-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Persist the anomaly service's configuration, per-source compound cursors and bounded per-resource/metric baselines as explicit records.
CREATE TABLE IF NOT EXISTS operations_anomaly_state (
 user_sub text NOT NULL, id text NOT NULL, record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
