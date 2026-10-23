-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Provisioning requests: validated template parameters and the exact rendered manifests with digests, promoted through Git like a response plan.
CREATE TABLE IF NOT EXISTS operations_provisioning (
 user_sub text NOT NULL, id text NOT NULL, created_at timestamptz NOT NULL, record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
