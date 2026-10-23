-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Swarm-to-swarm delegations: one outbound reservation per response plan and peer account, and one canonical investigation per received delegation, with operator-reported delivery receipts.
CREATE TABLE IF NOT EXISTS operations_delegations (
 user_sub text NOT NULL, id text NOT NULL, created_at timestamptz NOT NULL, record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
