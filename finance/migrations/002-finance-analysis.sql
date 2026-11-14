-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | 1.6.5: the caller's latest analysis request, one row a person. Request analysis records it as working with the exact snapshot it reads; the kernel's hand-over closes it as done or as failed with the words the page shows. The routes create the same table lazily (ensureFinanceSchema), as they do the three stores of 001.
CREATE TABLE IF NOT EXISTS oshal_finance_analysis (
  user_sub TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  state TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  failure TEXT
);
