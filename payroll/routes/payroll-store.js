"use strict";
/**
 * Payroll store — schema, row mapping, and every database read/write.
 *
 * Split out of payroll-routes.ts in v1.1 (the routes file was approaching the
 * 1000-line cap and mixing HTTP with persistence). Routes handle HTTP; this
 * module owns the tables.
 *
 * ISOLATION: one OIDC sub = one company. EVERY query in this file carries a
 * user_sub predicate, and all four tables get tier-1 owner RLS applied at the
 * lazy-DDL chokepoint so a fresh database enforces isolation the moment the
 * tables exist.
 *
 * SQL SAFETY: the two places that build a column list (employee upsert, company
 * update) draw their identifiers from FROZEN allowlists declared in this module —
 * never from request keys. Values always travel as bound parameters.
 *
 * IMMUTABLE LEDGER: a paid run is never mutated. A mistake is corrected by a
 * VOID run — a linked, negated copy that flows naturally through the YTD sums,
 * the liability report, and the W-2 preview.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 10:15:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — carved the schema/queries out of payroll-routes.ts and added v1.1 storage: prior-YTD onboarding columns (mid-year switch from another payroll system), birth_date for the 402(g) catch-up tier, hire/termination dates, explicit k401/health/roth/supplemental-FIT line columns (W-2 box 12 + honest stubs), per-line proration and bonus method, engine warnings persisted per line, and run kind/corrects_run_id/approved_by/approved_at for void runs and an approval audit trail.
 *
 * @module payroll-store
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LINE_COLUMNS = exports.VOID_NEGATED_COLUMNS = exports.NegativeNetError = exports.ensurePayrollSchema = exports.RUN_PAID = exports.RUN_DRAFT = exports.KIND_VOID = exports.KIND_REGULAR = exports.KIND_FINAL = exports.KIND_OFFCYCLE = exports.EDITABLE_KINDS = void 0;
exports.money = money;
exports.num = num;
exports.fmtUtc = fmtUtc;
exports.isoDateOrNull = isoDateOrNull;
exports.isoDate = isoDate;
exports.normalizeDates = normalizeDates;
exports.scrubSecrets = scrubSecrets;
exports.normalizeRows = normalizeRows;
exports.addDays = addDays;
exports.getCompany = getCompany;
exports.updateCompany = updateCompany;
exports.employeeCols = employeeCols;
exports.insertEmployee = insertEmployee;
exports.updateEmployee = updateEmployee;
exports.ageAtYearEnd = ageAtYearEnd;
exports.rowToComp = rowToComp;
exports.ytdBefore = ytdBefore;
exports.approveRun = approveRun;
exports.recomputeLine = recomputeLine;
exports.createVoidRun = createVoidRun;
const crypto = __importStar(require("crypto"));
const payroll_schema_1 = require("./payroll-schema");
Object.defineProperty(exports, "EDITABLE_KINDS", { enumerable: true, get: function () { return payroll_schema_1.EDITABLE_KINDS; } });
Object.defineProperty(exports, "KIND_OFFCYCLE", { enumerable: true, get: function () { return payroll_schema_1.KIND_OFFCYCLE; } });
Object.defineProperty(exports, "KIND_FINAL", { enumerable: true, get: function () { return payroll_schema_1.KIND_FINAL; } });
Object.defineProperty(exports, "KIND_REGULAR", { enumerable: true, get: function () { return payroll_schema_1.KIND_REGULAR; } });
Object.defineProperty(exports, "KIND_VOID", { enumerable: true, get: function () { return payroll_schema_1.KIND_VOID; } });
Object.defineProperty(exports, "RUN_DRAFT", { enumerable: true, get: function () { return payroll_schema_1.RUN_DRAFT; } });
Object.defineProperty(exports, "RUN_PAID", { enumerable: true, get: function () { return payroll_schema_1.RUN_PAID; } });
Object.defineProperty(exports, "ensurePayrollSchema", { enumerable: true, get: function () { return payroll_schema_1.ensurePayrollSchema; } });
const payroll_engine_1 = require("./payroll-engine");
const payroll_tax_tables_1 = require("./payroll-tax-tables");
/** Thrown when approval is refused because a line cannot be paid. */
class NegativeNetError extends Error {
    employees;
    constructor(employees) {
        super('negative_net_pay');
        this.employees = employees;
        this.name = 'NegativeNetError';
    }
}
exports.NegativeNetError = NegativeNetError;
/** Filing statuses accepted from input. */
const FILING_STATUSES = ['single', 'married', 'hoh'];
/**
 * Every signed money column a void run negates. EXPORTED so the guard asserts
 * against this list rather than a hand-typed copy — adding a money column to the
 * schema without adding it here now fails the test instead of silently
 * under-reversing a correction.
 */
exports.VOID_NEGATED_COLUMNS = Object.freeze([
    'bonus_cents', 'tips_cents', 'reimbursement_cents', 'gross_cents', 'qualified_ot_cents',
    'fit_taxable_cents', 'fica_taxable_cents', 'ss_taxable_cents', 'fit_cents', 'supplemental_fit_cents',
    'supplemental_taxable_cents', 'ss_cents', 'medicare_cents', 'addl_medicare_cents', 'state_cents',
    'k401_cents', 'deferral_cents', 'health_cents', 'roth_cents', 'pretax_cents', 'posttax_cents',
    'net_cents', 'er_ss_cents', 'er_medicare_cents', 'futa_cents', 'suta_cents', 'garnishment_cents',
    'disposable_cents',
]);
/**
 * Employee columns writable through the API. FROZEN — the upsert builds its
 * column list from these literals only, never from request keys.
 */
const EMPLOYEE_COLUMNS = Object.freeze([
    'first_name', 'last_name', 'email', 'comp_type', 'annual_salary_cents', 'hourly_rate_cents',
    'default_hours', 'filing_status', 'w4_step2', 'w4_dependents_credit_cents', 'w4_other_income_cents',
    'w4_deductions_cents', 'w4_extra_withholding_cents', 'k401_pct', 'roth_pct', 'health_per_period_cents',
    'other_posttax_cents', 'garnishment_cents', 'state_code', 'state_rate_pct', 'birth_date',
    'hire_date', 'termination_date', 'w4_exempt', 'tipped_occupation_code', 'state_allowances',
    'prior_ytd_year', 'prior_ytd_taxable_wages_cents', 'prior_ytd_ss_taxable_cents', 'prior_ytd_deferral_cents',
    'prior_ytd_supplemental_cents', 'prior_ytd_gross_cents', 'prior_ytd_fit_cents', 'prior_ytd_ss_cents',
    'prior_ytd_medicare_cents', 'prior_ytd_state_cents', 'status',
]);
/** Company columns writable through the API. FROZEN — same rule. */
const COMPANY_COLUMNS = Object.freeze([
    'company_name', 'pay_frequency', 'state_code', 'suta_rate_pct', 'suta_wage_base_cents', 'shift_pay_date',
    'futa_credit_reduction_pct', 'ach_odfi_routing', 'ach_odfi_name', 'ach_company_id',
    'ach_entry_description',
]);
/** Non-negative integer cents from arbitrary input. */
function money(v, fallback = 0) {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}
/** Non-negative finite number (rates, hours) from arbitrary input. */
function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}
/** YYYY-MM-DD from a Date's LOCAL components. */
function fmtLocal(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** YYYY-MM-DD from a Date's UTC components (for dates built with Date.UTC). */
function fmtUtc(d) {
    return d.toISOString().slice(0, 10);
}
/**
 * @description YYYY-MM-DD from a Date or date-like string; null when unparseable.
 *
 * A calendar date must NEVER round-trip through `toISOString()`. node-postgres
 * parses a DATE column into a JS Date at LOCAL midnight, so converting to UTC
 * shifts it a day earlier for every timezone east of Greenwich — which would
 * silently move a pay date into the previous quarter or tax year, and write the
 * shifted value back on the next save. Strings pass through untouched; Dates are
 * formatted from their local components, which is what pg handed us.
 * @param v - A Date, a YYYY-MM-DD string, or anything else.
 * @returns The calendar date, or null.
 */
function isoDateOrNull(v) {
    if (v === null || v === undefined || v === '')
        return null;
    if (v instanceof Date)
        return Number.isNaN(v.getTime()) ? null : fmtLocal(v);
    const s = String(v).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m)
        return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : fmtLocal(d);
}
/** YYYY-MM-DD, falling back to today (local) when unparseable. */
function isoDate(v) {
    return isoDateOrNull(v) || fmtLocal(new Date());
}
/** DATE columns that must reach the client as plain YYYY-MM-DD strings. */
const DATE_COLUMNS = ['period_start', 'period_end', 'pay_date', 'birth_date', 'hire_date', 'termination_date'];
/**
 * @description Rewrite every DATE column on a row to a YYYY-MM-DD string before
 * it is serialized.
 *
 * Without this, `res.json()` turns pg's local-midnight Date into a UTC ISO
 * string, so a browser east of Greenwich renders (and posts back) the previous
 * day — a pay date silently sliding into the prior quarter. Dates leave this
 * module as strings, never as Dates.
 * @param row - A database row, or null.
 * @returns The same row with its date columns stringified.
 */
function normalizeDates(row) {
    if (!row)
        return row;
    for (const col of DATE_COLUMNS) {
        if (col in row && row[col] != null)
            row[col] = isoDateOrNull(row[col]);
    }
    return scrubSecrets(row);
}
/** Encrypted columns that must never leave the server, even as ciphertext. */
const SECRET_COLUMNS = [
    ['ssn_encrypted', 'ssn_last4'],
    ['ein_encrypted', 'ein_last4'],
    ['routing_encrypted', 'routing_last4'],
    ['account_encrypted', 'account_last4'],
];
/**
 * @description Strip encrypted identifiers from a row and replace them with a
 * boolean "on file" flag plus the last four.
 *
 * Applied at the same chokepoint as date normalization, deliberately: every
 * route already passes its rows through here, so a new endpoint that returns
 * `SELECT *` is covered the day it is written rather than the day someone
 * remembers. Ciphertext is not a safe thing to hand out — it is still the
 * value, wrapped.
 * @param row - A database row, or null.
 * @returns The row with secrets removed and masks added.
 */
function scrubSecrets(row) {
    if (!row)
        return row;
    const r = row;
    for (const [enc, last] of SECRET_COLUMNS) {
        if (enc in r) {
            r[`${enc.replace('_encrypted', '')}_on_file`] = !!r[enc];
            delete r[enc];
        }
        if (last in r && r[last])
            r[`${last.replace('_last4', '')}_masked`] = `••••${String(r[last])}`;
    }
    return row;
}
/** normalizeDates over a result set. */
function normalizeRows(rows) {
    return rows.map((r) => normalizeDates(r));
}
/** Add whole days to a YYYY-MM-DD date string. */
function addDays(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
/** Fetch (auto-creating) the caller's company settings row. */
async function getCompany(pool, sub) {
    const found = await pool.query('SELECT * FROM payroll_company WHERE user_sub = $1', [sub]);
    if (found.rows[0])
        return found.rows[0];
    const created = await pool.query('INSERT INTO payroll_company (user_sub) VALUES ($1) ON CONFLICT (user_sub) DO UPDATE SET updated_at = now() RETURNING *', [sub]);
    return created.rows[0];
}
/** Update the caller's company row from an allowlisted column map. */
async function updateCompany(pool, sub, cols) {
    const keys = COMPANY_COLUMNS.filter((k) => k in cols);
    if (!keys.length)
        return getCompany(pool, sub);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const r = await pool.query(`UPDATE payroll_company SET ${sets}, updated_at = now() WHERE user_sub = $1 RETURNING *`, [sub, ...keys.map((k) => cols[k])]);
    return r.rows[0];
}
/**
 * @description Normalize an employee create/update body to allowlisted column
 * values.
 *
 * `partial` is the difference between a create and an edit, and it is
 * load-bearing: with `partial: true` a key is emitted ONLY when the caller
 * actually sent that field, so a PUT carrying a subset cannot blank the rest.
 * Without it, an edit form that omits (say) the termination date would write
 * NULL over it — silently reactivating a terminated employee and erasing any
 * prior-YTD figures on the next save.
 * @param b - The request body.
 * @param partial - True for an update; false/absent for a create (full defaults).
 * @returns Column → value map limited to what the caller supplied.
 */
function employeeCols(b, partial = false) {
    const all = employeeColsFull(b);
    if (!partial)
        return all;
    const sent = {};
    for (const [col, field] of Object.entries(EMPLOYEE_FIELD_OF_COLUMN)) {
        if (field in b)
            sent[col] = all[col];
    }
    return sent;
}
/** Column → the request field that supplies it. Drives partial updates. */
const EMPLOYEE_FIELD_OF_COLUMN = {
    first_name: 'firstName', last_name: 'lastName', email: 'email', comp_type: 'compType',
    annual_salary_cents: 'annualSalaryCents', hourly_rate_cents: 'hourlyRateCents',
    default_hours: 'defaultHours', filing_status: 'filingStatus', w4_step2: 'w4Step2',
    w4_dependents_credit_cents: 'w4DependentsCreditCents', w4_other_income_cents: 'w4OtherIncomeCents',
    w4_deductions_cents: 'w4DeductionsCents', w4_extra_withholding_cents: 'w4ExtraWithholdingCents',
    k401_pct: 'k401Pct', roth_pct: 'rothPct', health_per_period_cents: 'healthPerPeriodCents',
    other_posttax_cents: 'otherPostTaxCents', garnishment_cents: 'garnishmentCents',
    state_code: 'stateCode', state_rate_pct: 'stateRatePct', state_allowances: 'stateAllowances',
    w4_exempt: 'w4Exempt', tipped_occupation_code: 'tippedOccupationCode',
    birth_date: 'birthDate', hire_date: 'hireDate', termination_date: 'terminationDate',
    prior_ytd_year: 'priorYtdYear', prior_ytd_taxable_wages_cents: 'priorYtdTaxableWagesCents',
    prior_ytd_ss_taxable_cents: 'priorYtdSsTaxableCents', prior_ytd_deferral_cents: 'priorYtdDeferralCents',
    prior_ytd_supplemental_cents: 'priorYtdSupplementalCents', prior_ytd_gross_cents: 'priorYtdGrossCents',
    prior_ytd_fit_cents: 'priorYtdFitCents', prior_ytd_ss_cents: 'priorYtdSsCents',
    prior_ytd_medicare_cents: 'priorYtdMedicareCents', prior_ytd_state_cents: 'priorYtdStateCents',
    status: 'status',
};
/** Full column map with create-time defaults for everything absent. */
function employeeColsFull(b) {
    return {
        first_name: String(b.firstName || '').trim().slice(0, 80),
        last_name: String(b.lastName || '').trim().slice(0, 80),
        email: b.email ? String(b.email).trim().slice(0, 200) : null,
        comp_type: b.compType === 'salary' ? 'salary' : 'hourly',
        annual_salary_cents: money(b.annualSalaryCents),
        hourly_rate_cents: money(b.hourlyRateCents),
        default_hours: num(b.defaultHours, 80),
        filing_status: FILING_STATUSES.includes(b.filingStatus) ? b.filingStatus : 'single',
        w4_step2: b.w4Step2 === true,
        w4_dependents_credit_cents: money(b.w4DependentsCreditCents),
        w4_other_income_cents: money(b.w4OtherIncomeCents),
        w4_deductions_cents: money(b.w4DeductionsCents),
        w4_extra_withholding_cents: money(b.w4ExtraWithholdingCents),
        k401_pct: Math.min(100, num(b.k401Pct)),
        roth_pct: Math.min(100, num(b.rothPct)),
        health_per_period_cents: money(b.healthPerPeriodCents),
        other_posttax_cents: money(b.otherPostTaxCents),
        garnishment_cents: money(b.garnishmentCents),
        state_code: String(b.stateCode || '').trim().toUpperCase().slice(0, 2),
        state_rate_pct: Math.min(100, num(b.stateRatePct)),
        state_allowances: Math.trunc(Math.min(99, num(b.stateAllowances))),
        w4_exempt: b.w4Exempt === true,
        tipped_occupation_code: String(b.tippedOccupationCode || '').trim().toUpperCase().slice(0, 8),
        birth_date: isoDateOrNull(b.birthDate),
        hire_date: isoDateOrNull(b.hireDate),
        termination_date: isoDateOrNull(b.terminationDate),
        prior_ytd_year: b.priorYtdYear ? Math.trunc(num(b.priorYtdYear)) : null,
        prior_ytd_taxable_wages_cents: money(b.priorYtdTaxableWagesCents),
        prior_ytd_ss_taxable_cents: money(b.priorYtdSsTaxableCents),
        prior_ytd_deferral_cents: money(b.priorYtdDeferralCents),
        prior_ytd_supplemental_cents: money(b.priorYtdSupplementalCents),
        prior_ytd_gross_cents: money(b.priorYtdGrossCents),
        prior_ytd_fit_cents: money(b.priorYtdFitCents),
        prior_ytd_ss_cents: money(b.priorYtdSsCents),
        prior_ytd_medicare_cents: money(b.priorYtdMedicareCents),
        prior_ytd_state_cents: money(b.priorYtdStateCents),
        status: b.status === 'terminated' ? 'terminated' : 'active',
    };
}
/** Insert an employee from an allowlisted column map. */
async function insertEmployee(pool, sub, cols) {
    const keys = EMPLOYEE_COLUMNS.filter((k) => k in cols);
    const placeholders = keys.map((_, i) => `$${i + 3}`).join(', ');
    const r = await pool.query(`INSERT INTO payroll_employees (employee_id, user_sub, ${keys.join(', ')})
     VALUES ($1, $2, ${placeholders}) RETURNING *`, [crypto.randomUUID(), sub, ...keys.map((k) => cols[k])]);
    return r.rows[0];
}
/** Update an employee from an allowlisted column map (owner-scoped). */
async function updateEmployee(pool, sub, id, cols) {
    const keys = EMPLOYEE_COLUMNS.filter((k) => k in cols);
    if (!keys.length)
        return null;
    const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const r = await pool.query(`UPDATE payroll_employees SET ${sets}, updated_at = now()
      WHERE employee_id = $1 AND user_sub = $2 RETURNING *`, [id, sub, ...keys.map((k) => cols[k])]);
    return r.rows[0] || null;
}
/** Age at the end of the given tax year, or null when no birth date is on file. */
function ageAtYearEnd(birthDate, year) {
    const iso = isoDateOrNull(birthDate);
    if (!iso)
        return null;
    return year - Number(iso.slice(0, 4));
}
/** Map a payroll_employees row to the engine's CompProfile. */
function rowToComp(e, year) {
    return {
        compType: e.comp_type === 'salary' ? 'salary' : 'hourly',
        annualSalaryCents: money(e.annual_salary_cents),
        hourlyRateCents: money(e.hourly_rate_cents),
        k401Pct: num(e.k401_pct),
        rothPct: num(e.roth_pct),
        healthPerPeriodCents: money(e.health_per_period_cents),
        otherPostTaxCents: money(e.other_posttax_cents),
        garnishmentCents: money(e.garnishment_cents),
        age: ageAtYearEnd(e.birth_date, year),
        state: {
            code: String(e.state_code || ''),
            manualRatePct: num(e.state_rate_pct),
            allowances: num(e.state_allowances),
        },
        w4: {
            filingStatus: FILING_STATUSES.includes(e.filing_status) ? e.filing_status : 'single',
            step2: e.w4_step2 === true,
            dependentsCreditCents: money(e.w4_dependents_credit_cents),
            otherIncomeCents: money(e.w4_other_income_cents),
            deductionsCents: money(e.w4_deductions_cents),
            extraWithholdingCents: money(e.w4_extra_withholding_cents),
            exempt: e.w4_exempt === true,
        },
    };
}
/**
 * @description Year-to-date accumulators for one employee before a given pay
 * date: PAID runs from this system (void runs contribute negatives naturally)
 * plus the prior-YTD figures entered when the company switched payroll systems
 * mid-year. Wage bases are per-EMPLOYER, so prior YTD counts only when it is
 * tagged to the same tax year.
 * @param pool - Postgres pool.
 * @param sub - Owning OIDC sub.
 * @param emp - The employee row (carries the prior-YTD columns).
 * @param payDate - The run's pay date (YYYY-MM-DD).
 * @param excludeRunId - Run being computed, excluded from its own YTD.
 * @returns Engine YTD accumulators.
 */
async function ytdBefore(pool, sub, emp, payDate, excludeRunId) {
    const year = Number(payDate.slice(0, 4));
    const r = await pool.query(`SELECT COALESCE(SUM(l.fica_taxable_cents),0) AS wages,
            COALESCE(SUM(l.deferral_cents),0)     AS deferral,
            COALESCE(SUM(l.bonus_cents),0)        AS supplemental
       FROM payroll_run_lines l
       JOIN payroll_runs r ON r.run_id = l.run_id AND r.user_sub = l.user_sub
      WHERE l.user_sub = $1 AND l.employee_id = $2 AND r.status = '${payroll_schema_1.RUN_PAID}'
        AND r.run_id <> $3 AND r.pay_date <= $4 AND date_part('year', r.pay_date) = $5`, [sub, String(emp.employee_id), excludeRunId, payDate, year]);
    const priorApplies = Number(emp.prior_ytd_year || 0) === year;
    const prior = (col) => (priorApplies ? money(emp[col]) : 0);
    return {
        taxableWagesCents: Number(r.rows[0]?.wages || 0) + prior('prior_ytd_taxable_wages_cents'),
        deferralCents: Number(r.rows[0]?.deferral || 0) + prior('prior_ytd_deferral_cents'),
        supplementalWagesCents: Number(r.rows[0]?.supplemental || 0) + prior('prior_ytd_supplemental_cents'),
    };
}
/**
 * Column list for a run-line upsert, in the order the values are bound.
 *
 * EXPORTED so a guard can assert that every field `inputsFromLine` reads back is
 * actually persisted here. `bonus_is_discretionary` was read but never stored,
 * so approval recomputed it as false and silently added an FLSA overtime premium
 * to a bonus the operator had marked discretionary.
 */
exports.LINE_COLUMNS = Object.freeze([
    'hours', 'ot_hours', 'bonus_cents', 'tips_cents', 'reimbursement_cents', 'prorate_pct', 'bonus_method',
    'ot_flsa_qualified', 'bonus_is_discretionary', 'gross_cents', 'qualified_ot_cents', 'fit_taxable_cents', 'fica_taxable_cents',
    'ss_taxable_cents', 'fit_cents', 'supplemental_fit_cents', 'supplemental_taxable_cents', 'ss_cents', 'medicare_cents',
    'addl_medicare_cents', 'state_cents', 'k401_cents', 'deferral_cents', 'health_cents', 'roth_cents',
    'pretax_cents', 'posttax_cents', 'net_cents', 'er_ss_cents', 'er_medicare_cents', 'futa_cents',
    'suta_cents', 'garnishment_cents', 'disposable_cents', 'computed', 'warnings',
]);
/** Values for a run line, aligned to LINE_COLUMNS. */
function lineValues(inputs, c) {
    return [
        num(inputs.hours), num(inputs.otHours), money(inputs.bonusCents), money(inputs.tipsCents),
        money(inputs.reimbursementCents), num(inputs.proratePct, 100),
        inputs.bonusMethod === 'flat' ? 'flat' : 'aggregate', inputs.otIsFlsaQualified !== false,
        inputs.bonusIsDiscretionary === true,
        c.grossCents, c.qualifiedOvertimeCents, c.fitTaxableCents, c.ficaTaxableCents,
        c.ssTaxableCents, c.fitCents, c.supplementalFitCents, c.supplementalTaxableCents, c.ssCents, c.medicareCents,
        c.addlMedicareCents, c.stateCents, c.k401Cents, c.k401Cents + c.rothCents, c.healthCents, c.rothCents,
        c.healthCents + c.k401Cents, c.rothCents + c.otherPostTaxCents + c.garnishmentCents, c.netCents,
        c.employer.ssCents, c.employer.medicareCents, c.employer.futaCents, c.employer.sutaCents,
        c.garnishmentCents, c.disposableEarningsCents,
        JSON.stringify(c), JSON.stringify(c.warnings),
    ];
}
/** Reconstruct the engine inputs that produced a stored line. */
function inputsFromLine(l) {
    return {
        hours: num(l.hours),
        otHours: num(l.ot_hours),
        bonusCents: money(l.bonus_cents),
        tipsCents: money(l.tips_cents),
        reimbursementCents: money(l.reimbursement_cents),
        proratePct: num(l.prorate_pct, 100),
        bonusMethod: l.bonus_method === 'flat' ? 'flat' : 'aggregate',
        otIsFlsaQualified: l.ot_flsa_qualified !== false,
        bonusIsDiscretionary: l.bonus_is_discretionary === true,
    };
}
/**
 * @description Approve a draft run: recompute every line against the year-to-date
 * as of THIS moment, then flip it to paid — all in one transaction.
 *
 * The recompute is the point. `ytdBefore` counts only PAID runs, so two drafts
 * prepared before either is approved would each see the same year-to-date and
 * each consume the Social Security wage base, the FUTA/SUTA bases and the 402(g)
 * room a second time. Recomputing at approval makes the numbers reflect the order
 * money is actually committed. `FOR UPDATE` closes the approve/edit race in the
 * same stroke.
 * @param pool - Postgres pool.
 * @param sub - Owning OIDC sub.
 * @param runId - The draft run.
 * @param approvedBy - Caller recorded on the audit trail.
 * @param acceptNegativeNet - Explicit override for an unpayable check.
 * @returns The paid run row, or null when nothing matched a draft.
 */
async function approveRun(pool, sub, runId, approvedBy, acceptNegativeNet) {
    return withTransaction(pool, async (q) => {
        const run = (await q.query(`SELECT * FROM payroll_runs WHERE run_id = $1 AND user_sub = $2 AND status = '${payroll_schema_1.RUN_DRAFT}' FOR UPDATE`, [runId, sub])).rows[0];
        if (!run)
            return null;
        const lines = (await q.query('SELECT * FROM payroll_run_lines WHERE run_id = $1 AND user_sub = $2', [runId, sub])).rows;
        for (const line of lines) {
            const emp = (await q.query('SELECT * FROM payroll_employees WHERE employee_id = $1 AND user_sub = $2', [line.employee_id, sub])).rows[0];
            if (emp)
                await recomputeLineOn(q, sub, run, emp, inputsFromLine(line));
        }
        if (!acceptNegativeNet) {
            const bad = (await q.query(`SELECT l.employee_id, e.first_name, e.last_name, l.net_cents
           FROM payroll_run_lines l
           JOIN payroll_employees e ON e.employee_id = l.employee_id AND e.user_sub = l.user_sub
          WHERE l.run_id = $1 AND l.user_sub = $2 AND l.net_cents < 0`, [runId, sub])).rows;
            if (bad.length)
                throw new NegativeNetError(bad);
        }
        const paid = await q.query(`UPDATE payroll_runs SET status = '${payroll_schema_1.RUN_PAID}', approved_by = $3, approved_at = now(), updated_at = now()
        WHERE run_id = $1 AND user_sub = $2 AND status = '${payroll_schema_1.RUN_DRAFT}' RETURNING *`, [runId, sub, approvedBy]);
        return paid.rows[0] || null;
    });
}
/** Compute + upsert one run line against a pool; returns the stored breakdown. */
async function recomputeLine(pool, sub, run, emp, inputs) {
    return recomputeLineOn(pool, sub, run, emp, inputs);
}
/** Compute + upsert one run line against any queryable (pool or txn client). */
async function recomputeLineOn(pool, sub, run, emp, inputs) {
    const company = await getCompany(pool, sub);
    const periods = payroll_tax_tables_1.PAY_PERIODS[String(run.pay_frequency)] || 26;
    const payDate = isoDate(run.pay_date);
    const year = Number(payDate.slice(0, 4));
    // FAIL CLOSED on a tax-year mismatch. The tables are for ONE year; a pay date
    // in another year would compute silently against the wrong brackets, standard
    // deduction and wage base — and ytdBefore's year reset makes it quiet.
    if (year !== payroll_tax_tables_1.TAX_YEAR) {
        throw new Error(`Pay date ${payDate} is in tax year ${year}, but the loaded tax tables are for ${payroll_tax_tables_1.TAX_YEAR}. ` +
            'Update payroll-tax-tables.ts against that year\'s IRS/SSA publications before running this payroll.');
    }
    const ytd = await ytdBefore(pool, sub, emp, payDate, String(run.run_id));
    const stateCode = String(emp.state_code || company.state_code || '');
    const check = (0, payroll_engine_1.computePaycheck)(rowToComp(emp, year), inputs, periods, ytd, {
        sutaRatePct: num(company.suta_rate_pct, payroll_tax_tables_1.DEFAULT_SUTA_RATE_PCT),
        sutaWageBaseCents: money(company.suta_wage_base_cents, payroll_tax_tables_1.DEFAULT_SUTA_WAGE_BASE_CENTS),
        futaCreditReductionPct: num(company.futa_credit_reduction_pct),
        minimumWageCents: (0, payroll_tax_tables_1.minimumWageCents)(stateCode, payDate),
    });
    const cols = exports.LINE_COLUMNS.join(', ');
    const placeholders = exports.LINE_COLUMNS.map((_, i) => `$${i + 4}`).join(', ');
    const updates = exports.LINE_COLUMNS.map((k) => `${k} = EXCLUDED.${k}`).join(', ');
    // The draft predicate lives on the WRITE, not on a stale read: an edit that
    // races an approval must not mutate a run that has already been paid.
    await pool.query(`INSERT INTO payroll_run_lines (run_id, employee_id, user_sub, ${cols}, updated_at)
     SELECT $1, $2, $3, ${placeholders}, now()
      WHERE EXISTS (SELECT 1 FROM payroll_runs r
                     WHERE r.run_id = $1 AND r.user_sub = $3
                       AND (r.status = '${payroll_schema_1.RUN_DRAFT}' OR r.kind = '${payroll_schema_1.KIND_VOID}'))
     ON CONFLICT (run_id, employee_id) DO UPDATE SET ${updates}, updated_at = now()`, [run.run_id, emp.employee_id, sub, ...lineValues(inputs, check)]);
    return check;
}
/**
 * @description Create a VOID run: a linked, negated copy of a paid run. Every
 * signed amount flips, so YTD sums, the liability report, and the W-2 preview
 * all self-correct without any paid row being mutated.
 * @param pool - Postgres pool.
 * @param sub - Owning OIDC sub.
 * @param original - The paid run row being corrected.
 * @param payDate - Pay date to stamp on the void (defaults to the original's).
 * @param approvedBy - Caller recorded on the audit trail.
 * @param note - Operator's reason.
 * @returns The created void run row.
 */
async function createVoidRun(pool, sub, original, payDate, approvedBy, note) {
    return withTransaction(pool, (q) => insertVoid(q, sub, original, payDate, approvedBy, note));
}
/**
 * @description Run `fn` inside a transaction when the pool can check out a
 * client, so a void can never land as a run row with no lines. Falls back to
 * sequential queries for the minimal pools used in tests.
 * @param pool - Postgres pool.
 * @param fn - Work to run against the transactional client.
 * @returns Whatever fn returns.
 */
async function withTransaction(pool, fn) {
    const connect = pool.connect;
    if (typeof connect !== 'function')
        return fn(pool);
    const client = await connect.call(pool);
    try {
        await client.query('BEGIN');
        const out = await fn(client);
        await client.query('COMMIT');
        return out;
    }
    catch (err) {
        try {
            await client.query('ROLLBACK');
        }
        catch { /* the original error is the one that matters */ }
        throw err;
    }
    finally {
        if (typeof client.release === 'function')
            client.release();
    }
}
/** Insert the void run and its negated lines. Must run inside one transaction. */
async function insertVoid(q, sub, original, payDate, approvedBy, note) {
    const runId = crypto.randomUUID();
    const inserted = await q.query(`INSERT INTO payroll_runs (run_id, user_sub, period_start, period_end, pay_date, pay_frequency,
        status, kind, corrects_run_id, approved_by, approved_at, note)
     VALUES ($1,$2,$3,$4,$5,$6,'${payroll_schema_1.RUN_PAID}','${payroll_schema_1.KIND_VOID}',$7,$8,now(),$9) RETURNING *`, [runId, sub, original.period_start, original.period_end, payDate, original.pay_frequency,
        original.run_id, approvedBy, note || null]);
    // Negate every signed amount from the original's lines in one statement — the
    // void can never drift from what it reverses.
    const signed = exports.VOID_NEGATED_COLUMNS;
    await q.query(`INSERT INTO payroll_run_lines (run_id, employee_id, user_sub, hours, ot_hours, prorate_pct, bonus_method,
        ${signed.join(', ')}, updated_at)
     SELECT $1, employee_id, user_sub, -hours, -ot_hours, prorate_pct, bonus_method,
        ${signed.map((c) => `-${c}`).join(', ')}, now()
       FROM payroll_run_lines WHERE run_id = $2 AND user_sub = $3`, [runId, original.run_id, sub]);
    return inserted.rows[0];
}
//# sourceMappingURL=payroll-store.js.map