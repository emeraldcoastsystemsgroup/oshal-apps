-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Reserve one Git promotion per response plan, path and destination before provider writes; keep operator-reported provider results.
CREATE TABLE IF NOT EXISTS operations_git_promotions (
 user_sub text NOT NULL, id text NOT NULL, created_at timestamptz NOT NULL, record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
