-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Backlog item 7: the facts a garnishment order's priority and ceiling depend on (served and entered dates, the person-stated order of priority, the percentage an order directs, and a federal levy's Statement of Exemptions and Filing Status), and the election each check's deduction row came from, so an order's balance moves by order rather than by code.

ALTER TABLE payroll_deduction_elections
  ADD COLUMN IF NOT EXISTS served_on DATE;
ALTER TABLE payroll_deduction_elections
  ADD COLUMN IF NOT EXISTS entered_on DATE;
ALTER TABLE payroll_deduction_elections
  ADD COLUMN IF NOT EXISTS priority_rank INTEGER;
ALTER TABLE payroll_deduction_elections
  ADD COLUMN IF NOT EXISTS order_pct NUMERIC;
ALTER TABLE payroll_deduction_elections
  ADD COLUMN IF NOT EXISTS levy_filing_status TEXT NOT NULL DEFAULT '';
ALTER TABLE payroll_deduction_elections
  ADD COLUMN IF NOT EXISTS levy_dependents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_deduction_elections
  ADD COLUMN IF NOT EXISTS levy_additional_std INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_deduction_elections
  ADD COLUMN IF NOT EXISTS levy_statement_on DATE;
ALTER TABLE payroll_line_deductions
  ADD COLUMN IF NOT EXISTS election_id TEXT NOT NULL DEFAULT '';
