-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Finance 1.8.0 (Lane FINH2, the design's slice 3): the person's answer to each payment that repeats in their own records, one private copy per person. The repeating payments themselves are worked out from finance_transactions each time; only the answer is kept. Plain table as in 004-day.sql: one text primary key and no other unique rule, no foreign key and no row security; read by book_id. answer is 'keep', 'bill' (tracked as a bill: bill_id names it) or 'cancel' (the person means to cancel it themselves; Finance cancels nothing); answered_on is the person's day (YYYY-MM-DD) and amount_cents the charge as it stood then. Idempotent.
CREATE TABLE IF NOT EXISTS finance_recurring_reviews (
  review_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  series_key TEXT NOT NULL,
  payee TEXT NOT NULL,
  answer TEXT NOT NULL,
  answered_on TEXT NOT NULL,
  amount_cents BIGINT,
  bill_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_recurring_reviews_book ON finance_recurring_reviews (user_sub, book_id);
