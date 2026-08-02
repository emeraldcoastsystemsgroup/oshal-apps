"use strict";
/**
 * Payroll schema — every table, in one place.
 *
 * Split out of payroll-store.ts when the v2 entities landed: the DDL was half
 * that file and growing, and the queries are easier to read without it.
 *
 * THE V2 SHAPE. v1 had four tables and put a paycheck in scalar columns. That
 * could not express PTO, a second job at a second rate, two garnishments with
 * different priorities, or an imputed amount that is taxed but never paid — so
 * the model is now rows:
 *
 *   payroll_company          one per OIDC sub, now carrying legal identity (EIN,
 *                            address) so a W-2 can stop being a preview
 *   payroll_employees        the worker, now with SSN, address, classification
 *   payroll_bank_accounts    direct-deposit destinations (encrypted, split-ordered)
 *   payroll_deduction_elections  what a worker has elected, effective-dated
 *   payroll_runs             the pay run, now typed (regular/offcycle/final/void)
 *   payroll_run_lines        one check
 *   payroll_line_earnings    EARNING ROWS per check, workweek-tagged
 *   payroll_line_deductions  DEDUCTION ROWS per check, with what went to arrears
 *   payroll_payments         how the money was actually sent, for reconciliation
 *   payroll_audit            before/after for every master-data change
 *
 * EVERY table is user_sub-scoped with tier-1 owner RLS applied here, at the
 * lazy-DDL chokepoint, so a fresh database enforces isolation the moment the
 * tables exist rather than waiting for a migration to be re-run.
 *
 * ADDITIVE ONLY: every v2 column arrives as ALTER ... ADD COLUMN IF NOT EXISTS,
 * so an existing v1 install upgrades in place without a migration step and
 * without losing a row.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 17:45:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — carved the DDL out of payroll-store.ts and added the v2 entities: employer + employee legal identity (encrypted EIN/SSN with last-4 for display), worker classification and org placement, direct-deposit accounts, effective-dated deduction elections, per-check earning and deduction ROWS, payment records, and an append-only change audit log.
 * 2026-08-02 04:30:00 | maintainer@emeraldcoastsystemsgroup.com | v2.2 settlement: payroll_ach_events (imported returns and notifications of change) and payroll_filings (which artifact was produced when, and for what period). Payments gain the bank's answer — return code, reason, date, NOC change code — plus an index on ach_trace, because the trace is the ONLY handle a return gives back and matching one is a lookup on it. A unique index on the return trace stops the same return file, imported twice, counting anyone as unpaid twice. Company gains the check-number sequence and the EFW2 submitter identity (BSO User ID, contact, kind of employer, employment code).
 *
 * @module payroll-schema
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EDITABLE_KINDS = exports.KIND_VOID = exports.KIND_FINAL = exports.KIND_OFFCYCLE = exports.KIND_REGULAR = exports.RUN_PAID = exports.RUN_DRAFT = void 0;
exports.ensurePayrollSchema = ensurePayrollSchema;
const database_1 = require("@/shared/services/database");
const payroll_tax_tables_1 = require("./payroll-tax-tables");
/** Run lifecycle statuses. */
exports.RUN_DRAFT = 'draft';
exports.RUN_PAID = 'paid';
/**
 * Run kinds.
 *   regular   on the pay calendar, auto-lines every eligible employee
 *   offcycle  an extra or corrected check; created EMPTY, employees added by hand
 *   final     a termination check; one employee, usually with a leave payout
 *   void      the exact negation of a paid run
 */
exports.KIND_REGULAR = 'regular';
exports.KIND_OFFCYCLE = 'offcycle';
exports.KIND_FINAL = 'final';
exports.KIND_VOID = 'void';
/** Kinds that behave as a normal editable draft. */
exports.EDITABLE_KINDS = [exports.KIND_REGULAR, exports.KIND_OFFCYCLE, exports.KIND_FINAL];
/** Create/upgrade every payroll table (idempotent), with RLS at the chokepoint. */
async function ensurePayrollSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'payroll schema',
        statements: [
            /* ── company ─────────────────────────────────────────────────────── */
            `CREATE TABLE IF NOT EXISTS payroll_company (
        user_sub TEXT PRIMARY KEY,
        company_name TEXT NOT NULL DEFAULT 'My Company',
        pay_frequency TEXT NOT NULL DEFAULT 'biweekly',
        state_code TEXT NOT NULL DEFAULT 'FL',
        suta_rate_pct NUMERIC NOT NULL DEFAULT ${payroll_tax_tables_1.DEFAULT_SUTA_RATE_PCT},
        suta_wage_base_cents BIGINT NOT NULL DEFAULT ${payroll_tax_tables_1.DEFAULT_SUTA_WAGE_BASE_CENTS},
        shift_pay_date BOOLEAN NOT NULL DEFAULT true,
        futa_credit_reduction_pct NUMERIC NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            'ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS shift_pay_date BOOLEAN NOT NULL DEFAULT true',
            'ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS futa_credit_reduction_pct NUMERIC NOT NULL DEFAULT 0',
            // Legal identity — without these a W-2 cannot be issued, only previewed.
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS legal_name TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS trade_name TEXT NOT NULL DEFAULT ''",
            'ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS ein_encrypted TEXT',
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS ein_last4 TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS address_line1 TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS address_line2 TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS postal_code TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS state_account_number TEXT NOT NULL DEFAULT ''",
            // Monthly vs semiweekly decides WHEN a deposit is due — see the deposits report.
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS depositor_status TEXT NOT NULL DEFAULT 'monthly'",
            // FLSA requires a FIXED recurring 168-hour workweek; 0 = Sunday.
            'ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS workweek_start_day INTEGER NOT NULL DEFAULT 0',
            // ACH origination — the employer's OWN bank receives the generated file.
            // oshal never moves money; these only shape the file the bank ingests.
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS ach_odfi_routing TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS ach_odfi_name TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS ach_company_id TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS ach_entry_description TEXT NOT NULL DEFAULT 'PAYROLL'",
            // v2.2 — settlement. The check sequence lives here so allocation is a
            // single UPDATE on one row: two operators printing at the same moment
            // serialise rather than being handed the same number.
            'ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS check_next_number INTEGER NOT NULL DEFAULT 1001',
            // The ACH trace sequence continues across files. Restarting it at 1 per
            // file makes two runs mint identical traces, and since the trace is the
            // only handle a return gives back, a return could then be matched to a
            // different pay run's payment.
            'ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS ach_next_trace INTEGER NOT NULL DEFAULT 1',
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS bank_name TEXT NOT NULL DEFAULT ''",
            // EFW2 submitter identity. The BSO User ID names the person attesting to
            // the file's accuracy; SSA rejects a submission without a contact e-mail.
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS bso_user_id TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS contact_name TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS contact_phone TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS contact_email TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS kind_of_employer TEXT NOT NULL DEFAULT 'N'",
            "ALTER TABLE payroll_company ADD COLUMN IF NOT EXISTS employment_code TEXT NOT NULL DEFAULT 'R'",
            /* ── employees ───────────────────────────────────────────────────── */
            `CREATE TABLE IF NOT EXISTS payroll_employees (
        employee_id TEXT PRIMARY KEY,
        user_sub TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT,
        comp_type TEXT NOT NULL DEFAULT 'hourly',
        annual_salary_cents BIGINT NOT NULL DEFAULT 0,
        hourly_rate_cents BIGINT NOT NULL DEFAULT 0,
        default_hours NUMERIC NOT NULL DEFAULT 80,
        filing_status TEXT NOT NULL DEFAULT 'single',
        w4_step2 BOOLEAN NOT NULL DEFAULT false,
        w4_dependents_credit_cents BIGINT NOT NULL DEFAULT 0,
        w4_other_income_cents BIGINT NOT NULL DEFAULT 0,
        w4_deductions_cents BIGINT NOT NULL DEFAULT 0,
        w4_extra_withholding_cents BIGINT NOT NULL DEFAULT 0,
        k401_pct NUMERIC NOT NULL DEFAULT 0,
        roth_pct NUMERIC NOT NULL DEFAULT 0,
        health_per_period_cents BIGINT NOT NULL DEFAULT 0,
        other_posttax_cents BIGINT NOT NULL DEFAULT 0,
        state_rate_pct NUMERIC NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            'CREATE INDEX IF NOT EXISTS payroll_employees_user ON payroll_employees (user_sub)',
            "ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS state_code TEXT NOT NULL DEFAULT ''",
            'ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS state_allowances INTEGER NOT NULL DEFAULT 0',
            'ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS garnishment_cents BIGINT NOT NULL DEFAULT 0',
            'ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS birth_date DATE',
            'ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS w4_exempt BOOLEAN NOT NULL DEFAULT false',
            "ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS tipped_occupation_code TEXT NOT NULL DEFAULT ''",
            'ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS hire_date DATE',
            'ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS termination_date DATE',
            'ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS prior_ytd_year INTEGER',
            ...['taxable_wages', 'ss_taxable', 'deferral', 'supplemental', 'gross', 'fit', 'ss', 'medicare', 'state'].map((c) => `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS prior_ytd_${c}_cents BIGINT NOT NULL DEFAULT 0`),
            // Identity + classification + org placement (v2).
            'ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS ssn_encrypted TEXT',
            "ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS ssn_last4 TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS address_line1 TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS address_line2 TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS postal_code TEXT NOT NULL DEFAULT ''",
            // W-2 employee vs 1099 contractor — different forms, different taxes.
            "ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS worker_type TEXT NOT NULL DEFAULT 'w2'",
            // FLSA exempt workers earn no overtime; non-exempt do. Getting this wrong is a wage claim.
            'ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS flsa_exempt BOOLEAN NOT NULL DEFAULT false',
            "ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS cost_center TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS work_location TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS pay_method TEXT NOT NULL DEFAULT 'check'",
            'ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS pto_balance_hours NUMERIC NOT NULL DEFAULT 0',
            'ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS sick_balance_hours NUMERIC NOT NULL DEFAULT 0',
            /* ── direct-deposit accounts ─────────────────────────────────────── */
            `CREATE TABLE IF NOT EXISTS payroll_bank_accounts (
        account_id TEXT PRIMARY KEY,
        user_sub TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        nickname TEXT NOT NULL DEFAULT '',
        routing_encrypted TEXT,
        routing_last4 TEXT NOT NULL DEFAULT '',
        account_encrypted TEXT,
        account_last4 TEXT NOT NULL DEFAULT '',
        account_type TEXT NOT NULL DEFAULT 'checking',
        -- Splits apply in split_order; a null amount/percent means "the remainder".
        split_order INTEGER NOT NULL DEFAULT 1,
        split_amount_cents BIGINT,
        split_percent NUMERIC,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            'CREATE INDEX IF NOT EXISTS payroll_bank_accounts_emp ON payroll_bank_accounts (user_sub, employee_id)',
            /* ── deduction elections ─────────────────────────────────────────── */
            `CREATE TABLE IF NOT EXISTS payroll_deduction_elections (
        election_id TEXT PRIMARY KEY,
        user_sub TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        code TEXT NOT NULL,
        amount_cents BIGINT NOT NULL DEFAULT 0,
        percent_of_gross NUMERIC,
        annual_limit_cents BIGINT,
        lifetime_limit_cents BIGINT,
        ytd_cents BIGINT NOT NULL DEFAULT 0,
        lifetime_cents BIGINT NOT NULL DEFAULT 0,
        arrears_cents BIGINT NOT NULL DEFAULT 0,
        support_ccpa_pct NUMERIC,
        payee TEXT NOT NULL DEFAULT '',
        case_number TEXT NOT NULL DEFAULT '',
        effective_from DATE,
        effective_to DATE,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            'CREATE INDEX IF NOT EXISTS payroll_elections_emp ON payroll_deduction_elections (user_sub, employee_id)',
            /* ── runs ────────────────────────────────────────────────────────── */
            `CREATE TABLE IF NOT EXISTS payroll_runs (
        run_id TEXT PRIMARY KEY,
        user_sub TEXT NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        pay_date DATE NOT NULL,
        pay_frequency TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            'CREATE INDEX IF NOT EXISTS payroll_runs_user ON payroll_runs (user_sub, pay_date)',
            `ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT '${exports.KIND_REGULAR}'`,
            'ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS corrects_run_id TEXT',
            'ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS approved_by TEXT',
            'ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ',
            'ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS note TEXT',
            'ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS suppress_voluntary BOOLEAN NOT NULL DEFAULT false',
            'DROP INDEX IF EXISTS payroll_runs_one_void',
            "CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_one_void_per_run ON payroll_runs (user_sub, corrects_run_id) WHERE kind = 'void'",
            // One REGULAR run per period per company. Off-cycle runs are deliberately
            // exempt — the whole point of an off-cycle is a second check in a period.
            "CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_one_regular_period ON payroll_runs (user_sub, period_start, period_end) WHERE kind = 'regular'",
            /* ── run lines ───────────────────────────────────────────────────── */
            `CREATE TABLE IF NOT EXISTS payroll_run_lines (
        run_id TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        user_sub TEXT NOT NULL,
        hours NUMERIC NOT NULL DEFAULT 0,
        ot_hours NUMERIC NOT NULL DEFAULT 0,
        bonus_cents BIGINT NOT NULL DEFAULT 0,
        reimbursement_cents BIGINT NOT NULL DEFAULT 0,
        gross_cents BIGINT NOT NULL DEFAULT 0,
        fit_taxable_cents BIGINT NOT NULL DEFAULT 0,
        fica_taxable_cents BIGINT NOT NULL DEFAULT 0,
        ss_taxable_cents BIGINT NOT NULL DEFAULT 0,
        fit_cents BIGINT NOT NULL DEFAULT 0,
        ss_cents BIGINT NOT NULL DEFAULT 0,
        medicare_cents BIGINT NOT NULL DEFAULT 0,
        addl_medicare_cents BIGINT NOT NULL DEFAULT 0,
        state_cents BIGINT NOT NULL DEFAULT 0,
        pretax_cents BIGINT NOT NULL DEFAULT 0,
        posttax_cents BIGINT NOT NULL DEFAULT 0,
        net_cents BIGINT NOT NULL DEFAULT 0,
        er_ss_cents BIGINT NOT NULL DEFAULT 0,
        er_medicare_cents BIGINT NOT NULL DEFAULT 0,
        futa_cents BIGINT NOT NULL DEFAULT 0,
        suta_cents BIGINT NOT NULL DEFAULT 0,
        computed JSONB,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (run_id, employee_id)
      )`,
            'CREATE INDEX IF NOT EXISTS payroll_run_lines_user ON payroll_run_lines (user_sub, employee_id)',
            ...['k401', 'health', 'roth', 'supplemental_fit', 'deferral', 'tips', 'qualified_ot',
                'garnishment', 'disposable', 'supplemental_taxable', 'imputed', 'cash_earnings', 'nontaxable_paid'].map((c) => `ALTER TABLE payroll_run_lines ADD COLUMN IF NOT EXISTS ${c}_cents BIGINT NOT NULL DEFAULT 0`),
            'ALTER TABLE payroll_run_lines ADD COLUMN IF NOT EXISTS prorate_pct NUMERIC NOT NULL DEFAULT 100',
            "ALTER TABLE payroll_run_lines ADD COLUMN IF NOT EXISTS bonus_method TEXT NOT NULL DEFAULT 'aggregate'",
            'ALTER TABLE payroll_run_lines ADD COLUMN IF NOT EXISTS ot_flsa_qualified BOOLEAN NOT NULL DEFAULT true',
            // Persisted because approveRun RECOMPUTES from the stored line: without the
            // column the flag read back as false and a bonus the operator marked
            // discretionary silently gained an FLSA overtime premium at approval.
            'ALTER TABLE payroll_run_lines ADD COLUMN IF NOT EXISTS bonus_is_discretionary BOOLEAN NOT NULL DEFAULT false',
            'ALTER TABLE payroll_run_lines ADD COLUMN IF NOT EXISTS warnings JSONB',
            'ALTER TABLE payroll_run_lines ADD COLUMN IF NOT EXISTS workweek_hours JSONB',
            // v2: the line is assembled from earnings rows rather than scalar inputs.
            'ALTER TABLE payroll_run_lines ADD COLUMN IF NOT EXISTS uses_earning_rows BOOLEAN NOT NULL DEFAULT false',
            /* ── per-check earning rows ──────────────────────────────────────── */
            `CREATE TABLE IF NOT EXISTS payroll_line_earnings (
        earning_id TEXT PRIMARY KEY,
        user_sub TEXT NOT NULL,
        run_id TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        code TEXT NOT NULL,
        hours NUMERIC NOT NULL DEFAULT 0,
        rate_cents BIGINT NOT NULL DEFAULT 0,
        amount_cents BIGINT NOT NULL DEFAULT 0,
        workweek INTEGER NOT NULL DEFAULT 1,
        gross_cents BIGINT NOT NULL DEFAULT 0,
        derived BOOLEAN NOT NULL DEFAULT false,
        memo TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            'CREATE INDEX IF NOT EXISTS payroll_line_earnings_line ON payroll_line_earnings (user_sub, run_id, employee_id)',
            /* ── per-check deduction rows ────────────────────────────────────── */
            `CREATE TABLE IF NOT EXISTS payroll_line_deductions (
        deduction_id TEXT PRIMARY KEY,
        user_sub TEXT NOT NULL,
        run_id TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        code TEXT NOT NULL,
        requested_cents BIGINT NOT NULL DEFAULT 0,
        applied_cents BIGINT NOT NULL DEFAULT 0,
        arrears_added_cents BIGINT NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            'CREATE INDEX IF NOT EXISTS payroll_line_deductions_line ON payroll_line_deductions (user_sub, run_id, employee_id)',
            /* ── payment records ─────────────────────────────────────────────── */
            `CREATE TABLE IF NOT EXISTS payroll_payments (
        payment_id TEXT PRIMARY KEY,
        user_sub TEXT NOT NULL,
        run_id TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'check',
        amount_cents BIGINT NOT NULL DEFAULT 0,
        check_number TEXT NOT NULL DEFAULT '',
        bank_account_id TEXT,
        ach_trace TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        issued_on DATE,
        cleared_on DATE,
        note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            'CREATE INDEX IF NOT EXISTS payroll_payments_run ON payroll_payments (user_sub, run_id)',
            // A check number, once used, may not be reused — that is what makes a
            // register reconcile against a bank statement.
            "CREATE UNIQUE INDEX IF NOT EXISTS payroll_payments_check_no ON payroll_payments (user_sub, check_number) WHERE check_number <> ''",
            // v2.2 — what the bank said back. Without these a payment sat at
            // 'pending' forever and a returned deposit was indistinguishable from a
            // successful one.
            "ALTER TABLE payroll_payments ADD COLUMN IF NOT EXISTS return_code TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE payroll_payments ADD COLUMN IF NOT EXISTS return_reason TEXT NOT NULL DEFAULT ''",
            'ALTER TABLE payroll_payments ADD COLUMN IF NOT EXISTS returned_on DATE',
            "ALTER TABLE payroll_payments ADD COLUMN IF NOT EXISTS noc_change_code TEXT NOT NULL DEFAULT ''",
            // The trace is the ONLY handle a return gives us back, so it is indexed:
            // matching an imported return is a lookup on this column.
            "CREATE INDEX IF NOT EXISTS payroll_payments_trace ON payroll_payments (user_sub, ach_trace) WHERE ach_trace <> ''",
            /* ── imported ACH returns and notifications of change ─────────────── */
            `CREATE TABLE IF NOT EXISTS payroll_ach_events (
        event_id TEXT PRIMARY KEY,
        user_sub TEXT NOT NULL,
        kind TEXT NOT NULL,
        code TEXT NOT NULL,
        original_trace TEXT NOT NULL DEFAULT '',
        return_trace TEXT NOT NULL DEFAULT '',
        amount_cents BIGINT NOT NULL DEFAULT 0,
        individual_name TEXT NOT NULL DEFAULT '',
        payment_id TEXT,
        employee_id TEXT,
        -- Whether an NOC's correction has been written to the bank account.
        applied BOOLEAN NOT NULL DEFAULT false,
        detail JSONB,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            'CREATE INDEX IF NOT EXISTS payroll_ach_events_user ON payroll_ach_events (user_sub, imported_at DESC)',
            // The same return arriving twice must not double-count anyone as unpaid.
            "CREATE UNIQUE INDEX IF NOT EXISTS payroll_ach_events_trace ON payroll_ach_events (user_sub, return_trace) WHERE return_trace <> ''",
            /* ── artifacts produced, for traceability ─────────────────────────── */
            `CREATE TABLE IF NOT EXISTS payroll_filings (
        filing_id TEXT PRIMARY KEY,
        user_sub TEXT NOT NULL,
        kind TEXT NOT NULL,
        period TEXT NOT NULL,
        totals JSONB,
        note TEXT NOT NULL DEFAULT '',
        produced_by TEXT NOT NULL DEFAULT '',
        produced_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            'CREATE INDEX IF NOT EXISTS payroll_filings_user ON payroll_filings (user_sub, kind, produced_at DESC)',
            /* ── change audit log ────────────────────────────────────────────── */
            `CREATE TABLE IF NOT EXISTS payroll_audit (
        audit_id BIGSERIAL PRIMARY KEY,
        user_sub TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        before_json JSONB,
        after_json JSONB,
        at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            'CREATE INDEX IF NOT EXISTS payroll_audit_entity ON payroll_audit (user_sub, entity, entity_id, at DESC)',
            ...(0, database_1.buildOwnerRlsPolicyStatements)('payroll_company', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('payroll_employees', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('payroll_bank_accounts', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('payroll_deduction_elections', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('payroll_runs', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('payroll_run_lines', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('payroll_line_earnings', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('payroll_line_deductions', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('payroll_payments', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('payroll_audit', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('payroll_ach_events', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('payroll_filings', 'user_sub'),
        ],
        requirements: [
            // Listed so a validate-only bootstrap policy fails LOUD on a half-upgraded
            // install instead of quietly running payroll against a missing column.
            { table: 'payroll_company', columns: ['user_sub', 'pay_frequency', 'legal_name', 'ein_encrypted', 'depositor_status', 'workweek_start_day', 'ach_odfi_routing', 'ach_company_id'] },
            { table: 'payroll_employees', columns: ['employee_id', 'user_sub', 'ssn_encrypted', 'ssn_last4', 'worker_type', 'flsa_exempt', 'department', 'pay_method'] },
            { table: 'payroll_bank_accounts', columns: ['account_id', 'user_sub', 'employee_id', 'routing_encrypted', 'split_order'] },
            { table: 'payroll_deduction_elections', columns: ['election_id', 'user_sub', 'employee_id', 'code', 'arrears_cents'] },
            { table: 'payroll_runs', columns: ['run_id', 'user_sub', 'kind', 'corrects_run_id', 'approved_by', 'suppress_voluntary'] },
            { table: 'payroll_run_lines', columns: ['run_id', 'employee_id', 'user_sub', 'net_cents', 'uses_earning_rows', 'workweek_hours', 'bonus_is_discretionary'] },
            { table: 'payroll_line_earnings', columns: ['earning_id', 'user_sub', 'run_id', 'employee_id', 'code', 'workweek'] },
            { table: 'payroll_line_deductions', columns: ['deduction_id', 'user_sub', 'run_id', 'employee_id', 'code', 'arrears_added_cents'] },
            { table: 'payroll_payments', columns: ['payment_id', 'user_sub', 'run_id', 'employee_id', 'method', 'status', 'ach_trace', 'return_code', 'returned_on'] },
            { table: 'payroll_audit', columns: ['user_sub', 'entity', 'entity_id', 'action', 'actor', 'before_json', 'after_json'] },
            { table: 'payroll_ach_events', columns: ['event_id', 'user_sub', 'kind', 'code', 'original_trace', 'payment_id', 'applied'] },
            { table: 'payroll_filings', columns: ['filing_id', 'user_sub', 'kind', 'period', 'totals', 'produced_by'] },
        ],
    });
}
//# sourceMappingURL=payroll-schema.js.map