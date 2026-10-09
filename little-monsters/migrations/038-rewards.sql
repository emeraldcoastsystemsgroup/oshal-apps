-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | lm_rewards as an install migration (the rewards routes created it at mount time until 1.4.2); idempotent, same shape
CREATE TABLE IF NOT EXISTS lm_rewards (
  student_id uuid PRIMARY KEY,
  boxes integer NOT NULL DEFAULT 0,
  inventory jsonb NOT NULL DEFAULT '[]'::jsonb,
  equipped jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
