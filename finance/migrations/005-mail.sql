-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Finance 1.8.0 (Lane FINH2): bills found in a person's own mail, one private copy per person. finance_mail_checks holds whether the person turned the mail check on and where the check stands (one row a person and set of records); finance_mail_finds holds each bill found in one message until the person answers it. Plain tables as in 004-day.sql: one text primary key and no other unique rule, no foreign key and no row security. Each table is read by the text column named beside it. No message body is kept: of a message only its id, sender, subject and date, and what the bill needs (who, the amount due, the due date). Dates and stamps are text (YYYY-MM-DD, ISO); amounts are whole cents. Idempotent.

-- Whether the mail check is on and where it stands. state is 'off' or 'on'; status is 'not-checked', 'connected', 'not-connected', 'no-permission', 'reconnect' or 'unavailable', with detail in words. window_after and window_before (seconds since 1970) bound the search being worked through; pending holds the message ids still to read from it, page_token the next page; seen the ids already read (the newest 1,500), so a message is read once. counts holds what the last pass did. Read by check_id.
CREATE TABLE IF NOT EXISTS finance_mail_checks (
  check_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  state TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  turned_on_at TEXT,
  last_checked_at TEXT,
  last_success_at TEXT,
  window_after BIGINT,
  window_before BIGINT,
  page_token TEXT NOT NULL DEFAULT '',
  pending JSONB,
  seen JSONB,
  counts JSONB,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A bill found in one message. state is 'proposed' (waiting for the person's answer), 'added' (it became a bill or brought one up to date: bill_id names it) or 'dismissed'. payee_key is the payee in the words bills are matched by. Read by book_id.
CREATE TABLE IF NOT EXISTS finance_mail_finds (
  find_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  mail_date TEXT NOT NULL,
  payee TEXT NOT NULL,
  payee_key TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  due_date TEXT NOT NULL,
  state TEXT NOT NULL,
  bill_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_mail_finds_book ON finance_mail_finds (user_sub, book_id);
