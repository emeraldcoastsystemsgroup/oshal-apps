-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Persist workflow-generated action plans, exact-artifact approvals and one-shot executions with their verification and ticket-update receipts; artifacts keep exact bytes and digests for download.
CREATE TABLE IF NOT EXISTS operations_action_plans (
 user_sub text NOT NULL, id text NOT NULL, created_at timestamptz NOT NULL, record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
CREATE TABLE IF NOT EXISTS operations_action_artifacts (
 user_sub text NOT NULL, plan_id text NOT NULL, name text NOT NULL, sha256 text NOT NULL, content bytea NOT NULL,
 PRIMARY KEY(user_sub,plan_id,name)
);
CREATE TABLE IF NOT EXISTS operations_action_approvals (
 user_sub text NOT NULL, id text NOT NULL, created_at timestamptz NOT NULL, record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
CREATE TABLE IF NOT EXISTS operations_action_executions (
 user_sub text NOT NULL, id text NOT NULL, created_at timestamptz NOT NULL, record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
