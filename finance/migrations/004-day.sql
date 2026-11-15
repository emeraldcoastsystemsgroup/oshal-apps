-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | The records behind a person's money day, one private copy per person: bills found in their own transactions or typed by them (finance_bills), each due date of each bill with whether it was paid and whether the person was told (finance_bill_events), goals and every amount set aside for one (finance_goals, finance_goal_moves), the plan for a month (finance_budget_lines) and each closed month with its totals and every account's balance as it stood (finance_month_closes). Plain tables as in 003-ledger.sql: one text primary key and no other unique rule, no foreign key and no row security, so on the native kernel an insert is checked by one read of its key and an update or delete starts from the rows its first text equality selects. Each table is read by the text column named beside it (book_id, month). Dates and stamps are text (YYYY-MM-DD, ISO); amounts are whole cents, and an amount that is not known is NULL, never zero. No statement here moves money. Idempotent.

-- A bill: who is paid, the amount expected, how often and when it is next due. origin is 'found' (in the person's own transactions), 'typed', 'document' or 'sample'; source, source_label and posture say where the expected amount came from, as on a transaction. state is 'proposed' (found, waiting for the person's answer), 'confirmed', 'dismissed' or 'ended'. first_due is the first due date the bill has; no due date is kept before it. Read by book_id.
CREATE TABLE IF NOT EXISTS finance_bills (
  bill_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  payee TEXT NOT NULL,
  match_text TEXT NOT NULL DEFAULT '',
  amount_cents BIGINT,
  amount_as_of TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  cadence TEXT NOT NULL,
  due_day INTEGER,
  first_due TEXT,
  next_due TEXT,
  account_id TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL,
  source TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  posture TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  evidence JSONB,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_bills_book ON finance_bills (user_sub, book_id);

-- One due date of one bill. state is 'due', 'paid' or 'skipped'; paid_by says whether the payment was found in the records ('matched') or the person said so ('marked'), and paid_source, paid_source_label and paid_posture say where the paid amount came from, as on a transaction. told_due_at and told_overdue_at are set when the person was told, so each is said once. Read by month ('YYYY-MM' of the due date).
CREATE TABLE IF NOT EXISTS finance_bill_events (
  event_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  month TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount_cents BIGINT,
  amount_as_of TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  state TEXT NOT NULL,
  paid_on TEXT,
  paid_cents BIGINT,
  paid_txn_id TEXT NOT NULL DEFAULT '',
  paid_by TEXT NOT NULL DEFAULT '',
  paid_source TEXT NOT NULL DEFAULT '',
  paid_source_label TEXT NOT NULL DEFAULT '',
  paid_posture TEXT NOT NULL DEFAULT '',
  told_due_at TEXT,
  told_overdue_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_bill_events_month ON finance_bill_events (user_sub, month);

-- A goal: what it is for, the target and its date when the person gave them, and what they plan to set aside each month. kind is 'save-up', 'pay-down' or 'allowance'. Read by book_id.
CREATE TABLE IF NOT EXISTS finance_goals (
  goal_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_cents BIGINT,
  target_date TEXT,
  monthly_cents BIGINT,
  currency TEXT NOT NULL DEFAULT 'USD',
  account_id TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  posture TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_goals_book ON finance_goals (user_sub, book_id);

-- One amount set aside for a goal, or taken back out of it. amount_cents is never negative; direction is 'in' (set aside) or 'out' (taken back). It is bookkeeping: no money moves. income_txn_id names the income it answered, when it answered one. Read by book_id.
CREATE TABLE IF NOT EXISTS finance_goal_moves (
  move_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  month TEXT NOT NULL,
  move_date TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  direction TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  note TEXT NOT NULL DEFAULT '',
  income_txn_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  posture TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_goal_moves_book ON finance_goal_moves (user_sub, book_id);

-- A planned amount for one line of one month's plan. line is 'income', 'everything-else' or 'floor' (the lowest balance the person wants to keep), or a category in the person's own words. Read by month.
CREATE TABLE IF NOT EXISTS finance_budget_lines (
  line_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  month TEXT NOT NULL,
  line TEXT NOT NULL,
  planned_cents BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  set_on TEXT NOT NULL,
  source TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  posture TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_budget_lines_month ON finance_budget_lines (user_sub, month);

-- A closed month, or a finished year pack. kind is 'month' (period 'YYYY-MM') or 'year-pack' (period 'YYYY'); state is 'closed' or 'reopened'. summary keeps the totals, the net worth and every account's balance with its date and source as they stood at the close. Read by book_id.
CREATE TABLE IF NOT EXISTS finance_month_closes (
  close_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'month',
  period TEXT NOT NULL,
  state TEXT NOT NULL,
  in_cents BIGINT,
  out_cents BIGINT,
  net_worth_cents BIGINT,
  net_worth_as_of TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  summary JSONB,
  closed_at TEXT NOT NULL,
  reopened_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_month_closes_book ON finance_month_closes (user_sub, book_id);
