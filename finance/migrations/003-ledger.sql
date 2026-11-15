-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Finance's own records, one private copy per person: the sets of records (finance_books), accounts with a balance, its date and where the figure came from (finance_accounts), every transaction (finance_transactions), each statement import with its preview, counts and undo state (finance_imports), "description contains X means category Y" (finance_rules) and the documents Finance has read (finance_documents). Until now Finance kept 25 recent transactions inside one saved snapshot that every sync replaced. Plain tables as in 001: one text primary key and no other unique rule, no foreign key and no row security, so on the native kernel an insert is checked by one read of its key and an update or delete starts from the rows its first text equality selects. Each table is read by the text column named beside it (book_id, month, import_id). An account number is never stored, only its last four digits. Idempotent.

-- A set of records: 'home', or the one business. Read by book_key.
CREATE TABLE IF NOT EXISTS finance_books (
  book_key TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  closed_through TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_books_user ON finance_books (user_sub);

-- An account. balance_cents is NULL until a balance is known (unknown is not zero); for a card or a loan it is the amount owed. Read by book_id.
CREATE TABLE IF NOT EXISTS finance_accounts (
  account_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  subtype TEXT NOT NULL DEFAULT '',
  last4 TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  balance_cents BIGINT,
  balance_as_of TEXT,
  source TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  posture TEXT NOT NULL DEFAULT '',
  link_id TEXT NOT NULL DEFAULT '',
  import_map JSONB,
  state TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_accounts_book ON finance_accounts (user_sub, book_id);

-- One transaction. amount_cents is never negative; direction is 'in' or 'out'. txn_id is a hash: the bank's own id when the file has one, else account, date, amount, description and position. Read by month ('YYYY-MM'); an import's rows by import_id.
CREATE TABLE IF NOT EXISTS finance_transactions (
  txn_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  month TEXT NOT NULL,
  txn_date TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  direction TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT NOT NULL DEFAULT '',
  merchant TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  category_source TEXT NOT NULL DEFAULT '',
  review TEXT NOT NULL DEFAULT 'new',
  flags TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL DEFAULT '',
  posture TEXT NOT NULL DEFAULT '',
  import_id TEXT NOT NULL DEFAULT '',
  matched_bill_id TEXT NOT NULL DEFAULT '',
  matched_invoice_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_transactions_month ON finance_transactions (user_sub, month);
CREATE INDEX IF NOT EXISTS finance_transactions_import ON finance_transactions (user_sub, import_id);

-- One import: the file's name and fingerprint (the file itself is not kept), what it would add, what it added, and its state. pending holds the read rows between the preview and the last apply call, then is cleared. Read by book_id.
CREATE TABLE IF NOT EXISTS finance_imports (
  import_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT '',
  new_account JSONB,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL DEFAULT '',
  period_start TEXT,
  period_end TEXT,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_new INTEGER NOT NULL DEFAULT 0,
  rows_duplicate INTEGER NOT NULL DEFAULT 0,
  rows_unreadable INTEGER NOT NULL DEFAULT 0,
  rows_added INTEGER NOT NULL DEFAULT 0,
  closing_balance_cents BIGINT,
  closing_balance_as_of TEXT,
  column_map JSONB,
  pending JSONB,
  state TEXT NOT NULL,
  doc_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  applied_at TEXT,
  undone_at TEXT
);
CREATE INDEX IF NOT EXISTS finance_imports_book ON finance_imports (user_sub, book_id);

-- "Description contains X means category Y". Read by book_id.
CREATE TABLE IF NOT EXISTS finance_rules (
  rule_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  match_text TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_rules_book ON finance_rules (user_sub, book_id);

-- A document Finance read: what kind, its title and fingerprint, and what it produced. A statement's text is not kept. Read by book_id.
CREATE TABLE IF NOT EXISTS finance_documents (
  doc_id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  book_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  produced JSONB,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_documents_book ON finance_documents (user_sub, book_id);
