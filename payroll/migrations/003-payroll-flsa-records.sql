-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Backlog item 3: what the 29 CFR 516.2(a) record needs that was not stored: the date each earning row was worked (hours per workday), the time of day the workweek begins (with the day already held), and each employee's occupation and the title that may stand for sex on the record ((a)(4): "the prefixes Mr., Mrs., Miss., or Ms.").

ALTER TABLE payroll_line_earnings
  ADD COLUMN IF NOT EXISTS work_date DATE;
ALTER TABLE payroll_company
  ADD COLUMN IF NOT EXISTS workweek_start_time TEXT NOT NULL DEFAULT '00:00';
ALTER TABLE payroll_employees
  ADD COLUMN IF NOT EXISTS occupation TEXT NOT NULL DEFAULT '';
ALTER TABLE payroll_employees
  ADD COLUMN IF NOT EXISTS name_prefix TEXT NOT NULL DEFAULT '';
