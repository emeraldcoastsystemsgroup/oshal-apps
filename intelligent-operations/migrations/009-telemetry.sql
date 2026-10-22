-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Separate three rolling raw telemetry banks from immutable preprocessed evidence packets.
CREATE TABLE IF NOT EXISTS operations_streams (user_sub text NOT NULL,id text NOT NULL,record jsonb NOT NULL,PRIMARY KEY(user_sub,id));
CREATE TABLE IF NOT EXISTS operations_telemetry_0 (user_sub text NOT NULL,id text NOT NULL,source_id text NOT NULL,received_at timestamptz NOT NULL,observed_at timestamptz NOT NULL,record jsonb NOT NULL,PRIMARY KEY(user_sub,id));
CREATE TABLE IF NOT EXISTS operations_telemetry_1 (user_sub text NOT NULL,id text NOT NULL,source_id text NOT NULL,received_at timestamptz NOT NULL,observed_at timestamptz NOT NULL,record jsonb NOT NULL,PRIMARY KEY(user_sub,id));
CREATE TABLE IF NOT EXISTS operations_telemetry_2 (user_sub text NOT NULL,id text NOT NULL,source_id text NOT NULL,received_at timestamptz NOT NULL,observed_at timestamptz NOT NULL,record jsonb NOT NULL,PRIMARY KEY(user_sub,id));
CREATE INDEX IF NOT EXISTS operations_telemetry_window_0 ON operations_telemetry_0(user_sub,source_id,observed_at);
CREATE INDEX IF NOT EXISTS operations_telemetry_window_1 ON operations_telemetry_1(user_sub,source_id,observed_at);
CREATE INDEX IF NOT EXISTS operations_telemetry_window_2 ON operations_telemetry_2(user_sub,source_id,observed_at);
CREATE TABLE IF NOT EXISTS operations_telemetry_packets (user_sub text NOT NULL,id text NOT NULL,record jsonb NOT NULL,PRIMARY KEY(user_sub,id));
