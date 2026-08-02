"use strict";
/**
 * State income-tax withholding — pluggable per state, honest about coverage.
 *
 * THE DESIGN RULE: a state we ship a WRONG table for is worse than a state we
 * openly do not support. So there are exactly four outcomes, and the caller can
 * always tell which one it got — and is WARNED when it is the weak one:
 *
 *   kind 'none'     — no wage income tax. Withholding is a KNOWN zero.
 *   kind 'flat'     — a verified statutory rate (with its deduction/allowances).
 *   kind 'brackets' — a verified progressive schedule.
 *   (no rule)       — no verified table. We fall back to the flat rate the
 *                     operator entered AND emit a warning. If that rate is zero
 *                     the warning is louder still, because silently withholding
 *                     nothing for a state that taxes wages is the single most
 *                     dangerous thing this module could do.
 *
 * Adding a state = one verified entry in STATE_RULES with its citation. A state
 * we researched and deliberately did NOT ship goes in KNOWN_UNSUPPORTED with the
 * reason, so the decision is not silently re-litigated.
 *
 * SCOPE, stated plainly: this models the ordinary state WITHHOLDING computation
 * for a resident employee. It does NOT model local/city taxes (Indiana counties,
 * Ohio municipalities, PA Act 32 EIT/LST, NYC/Yonkers, Maryland county piggyback,
 * Michigan cities), state disability/paid-leave contributions (CA SDI, NY DBL/PFL,
 * NJ TDI/FLI, WA PFML/Cares, MA/CT/OR/CO PFML), reciprocity between states,
 * multi-state allocation, or state supplemental rates. Those are declared
 * unsupported rather than approximated.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 09:45:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — the three-outcome state model and the no-wage-income-tax set.
 * 2026-08-01 12:45:00 | maintainer@emeraldcoastsystemsgroup.com | Hardened + populated. FIXES: (1) an unsupported state whose manual rate was left at the 0 default withheld ZERO silently — the exact failure this module's header forbids; it now returns warnings the engine surfaces. (2) standardDeduction/allowances were honored only on the brackets path, so a flat state that HAS a deduction (KY) would have over-withheld every check — the flat path now annualizes too. (3) W4LikeProfile gained step2 for states whose deduction depends on whether the spouse works (MO). (4) Added whole-dollar rounding for states that require it (MO). DATA: verified PA / IL / KY flat rules and the MO progressive schedule, each with its retrieved primary-source citation, plus KNOWN_UNSUPPORTED entries recording why IN and NC are deliberately absent.
 *
 * @module payroll-state-tax
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.stateSupport = stateSupport;
exports.stateWithholding = stateWithholding;
exports.supportedStates = supportedStates;
exports.unsupportedStates = unsupportedStates;
const payroll_tax_tables_1 = require("./payroll-tax-tables");
/**
 * States with NO tax on wage income. Withholding is a known zero.
 *
 * New Hampshire and Washington are here for WAGES specifically: NH's interest
 * and dividends tax is repealed and never reached wages; Washington taxes only
 * certain long-term capital gains, which does not reach payroll.
 */
const NO_WAGE_INCOME_TAX = ['AK', 'FL', 'NH', 'NV', 'SD', 'TN', 'TX', 'WA', 'WY'];
/**
 * Verified per-state rules. ONLY add an entry backed by a retrieved primary
 * source, and put that citation in `source`. An unverified state must stay
 * absent so it reports unsupported instead of quietly withholding a wrong amount.
 */
const STATE_RULES = {
    ...Object.fromEntries(NO_WAGE_INCOME_TAX.map((code) => [code, {
            kind: 'none',
            note: 'No state tax on wage income.',
            source: 'State statute — no wage income tax.',
        }])),
    /* ── PENNSYLVANIA — flat, and genuinely bare: no deduction, no exemption. ── */
    PA: {
        kind: 'flat',
        ratePct: 3.07,
        note: 'Flat 3.07% of compensation; Pennsylvania provides no standard deduction and no personal exemption.',
        source: 'PA Dept. of Revenue, Personal Income Tax (retrieved 2026-08-01): "levied at the rate of 3.07 percent"; "does not provide for a standard deduction or personal exemption."',
    },
    /* ── ILLINOIS — flat 4.95%, each IL-W-4 allowance shelters $2,925. ───────── */
    IL: {
        kind: 'flat',
        ratePct: 4.95,
        allowanceValueCents: 292_500,
        note: 'Flat 4.95%. Each IL-W-4 allowance shelters $2,925 of annual wages.',
        source: 'IL DOR tax rates ("4.95 percent of net income") + Informational Bulletin FY 2026-15: "The personal exemption amount for tax year 2026 will increase to $2,925."',
    },
    /* ── KENTUCKY — flat 3.5% after a status-independent $3,360 deduction. ──── */
    KY: {
        kind: 'flat',
        ratePct: 3.5,
        standardDeductionCents: { single: 336_000, married: 336_000, hoh: 336_000 },
        note: 'Flat 3.5% after a $3,360 annual standard deduction (identical for every filing status).',
        // The DOR's own formula PDF prints the STALE 2025 figure ($3,270) in its header while its worked
        // examples use $3,360 ($39,240 − $3,360 = $35,880). $3,360 matches the DOR news release and the
        // form's arithmetic, so $3,360 is what ships.
        source: 'KY DOR 2026 Withholding Tax Formula 42A003(TCF)(10-2025): "2026 Kentucky Tax Rate 3.5% of taxable income"; KY DOR release: "the standard deduction for 2026 is $3,360, an increase of $90."',
    },
    /* ── MISSOURI — progressive, deduction tracks the federal amounts. ──────── */
    MO: {
        kind: 'brackets',
        brackets: [
            { upToCents: 134_800, rate: 0.000 }, // to $1,348
            { upToCents: 269_600, rate: 0.020 }, // to $2,696
            { upToCents: 404_400, rate: 0.025 }, // to $4,044
            { upToCents: 539_200, rate: 0.030 }, // to $5,392
            { upToCents: 674_000, rate: 0.035 }, // to $6,740
            { upToCents: 808_800, rate: 0.040 }, // to $8,088
            { upToCents: 943_600, rate: 0.045 }, // to $9,436
            { upToCents: Infinity, rate: 0.047 },
        ],
        // Missouri's deductions equal the federal ones — reference the federal
        // constant so a federal update carries instead of drifting.
        standardDeductionCents: payroll_tax_tables_1.STANDARD_DEDUCTION_CENTS,
        marriedSpouseWorksDeductionCents: payroll_tax_tables_1.STANDARD_DEDUCTION_CENTS.single,
        roundToDollar: true,
        note: 'Eight graduated brackets, 0%–4.70%, after a standard deduction tracking the federal amounts. Withholding rounds to the nearest whole dollar.',
        source: 'MO DOR 2026 Missouri Withholding Tax Formula (retrieved + text-extracted 2026-08-01): annual table "$0.00 to $1,348.00 … 9,436.01 and over" at "0.00% 2.00% 2.50% 3.00% 3.50% 4.00% 4.50% 4.70%"; deductions "Single: $16,100 / Married and Spouse Works: $16,100 / Married and Spouse Does Not Work: $32,200 / Head of Household: $24,150".',
    },
};
/** Researched states deliberately NOT shipped, so the decision is on the record. */
const KNOWN_UNSUPPORTED = [
    {
        code: 'IN',
        reason: 'The state rate is a verified flat 2.95%, but Indiana also levies a MANDATORY county income tax (0.5%–2.95% by county of residence) plus WH-4 exemption constants. A state-only entry would under-withhold every Indiana employee, so the county table has to come first.',
        source: 'IN DOR Departmental Notice #1 (R46/01-26): "For 2026, the state adjusted gross income tax rate for individuals is 2.95%," with a worked example showing state AND county tax withheld.',
    },
    {
        code: 'NC',
        reason: 'North Carolina sets its wage-WITHHOLDING rate deliberately higher than the individual income tax rate. The 2026 statutory rate (3.99%) is verified, but the withholding rate could not be confirmed from the NC-30 primary source — shipping the tax rate would be a guess in the under-withholding direction.',
        source: 'NCDOR Tax Rate Schedules (statutory rate verified); NC-30 withholding rate NOT confirmed.',
    },
];
/** Round to whole cents, half-up. */
function cents(v) {
    return Math.round(v);
}
/** Non-negative finite coercion. */
function safe(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}
/** Progressive tax over annual taxable income against a state schedule. */
function stateBracketTax(annualCents, brackets) {
    if (!(annualCents > 0))
        return 0;
    let tax = 0;
    let prevTop = 0;
    for (const b of brackets) {
        const slice = Math.min(annualCents, b.upToCents) - prevTop;
        if (slice > 0)
            tax += slice * b.rate;
        if (annualCents <= b.upToCents)
            break;
        prevTop = b.upToCents;
    }
    return tax;
}
/** The annual deduction + allowance shelter for a filer under a rule. */
function shelterCents(rule, profile, w4) {
    let deduction = 0;
    if (rule.standardDeductionCents) {
        const spouseWorks = w4.filingStatus === 'married' && w4.step2 === true;
        deduction = spouseWorks && rule.marriedSpouseWorksDeductionCents !== undefined
            ? rule.marriedSpouseWorksDeductionCents
            : safe(rule.standardDeductionCents[w4.filingStatus]);
    }
    return deduction + safe(rule.allowanceValueCents) * safe(profile?.allowances);
}
/**
 * @description Report whether a state's withholding comes from a verified table,
 * and how — so a surface tells the operator the truth instead of implying
 * coverage that does not exist.
 * @param code - Two-letter state code (case-insensitive).
 * @returns supported flag, rule kind, and a human-readable note.
 */
function stateSupport(code) {
    const key = String(code || '').toUpperCase();
    const rule = STATE_RULES[key];
    if (rule)
        return { supported: true, kind: rule.kind, note: rule.note };
    const known = KNOWN_UNSUPPORTED.find((u) => u.code === key);
    return {
        supported: false,
        kind: 'manual',
        note: known
            ? `Not supported by design: ${known.reason}`
            : 'No verified withholding table for this state — the flat rate entered on the employee is used. Verify it against the state’s withholding publication.',
    };
}
/**
 * @description State income-tax withholding for one pay period, plus whether the
 * result came from a verified table.
 * @param profile - The employee's state code, fallback rate, and allowances.
 * @param taxablePeriodCents - This period's state-taxable wages.
 * @param w4 - Filing status + step2 (states use it for spouse-works deductions).
 * @param periodsPerYear - Pay periods per year.
 * @returns Withholding in cents, a supported flag, and any warnings to surface.
 */
function stateWithholding(profile, taxablePeriodCents, w4, periodsPerYear) {
    const taxable = safe(taxablePeriodCents);
    const periods = safe(periodsPerYear, 26) || 26;
    const code = String(profile?.code || '').toUpperCase();
    const rule = STATE_RULES[code];
    if (!rule) {
        const rate = Math.min(100, safe(profile?.manualRatePct));
        const warnings = [];
        if (!code) {
            warnings.push('No work state is set on this employee — no state income tax was withheld.');
        }
        else if (rate === 0) {
            warnings.push(`State ${code} has no verified withholding table AND no manual rate was entered — ZERO state income tax was withheld. If ${code} taxes wages, this check is wrong.`);
        }
        else {
            warnings.push(`State ${code} has no verified withholding table; the operator-entered rate of ${rate}% was used. Verify it against the state’s withholding publication.`);
        }
        return { cents: cents((taxable * rate) / 100), supported: false, warnings };
    }
    if (rule.kind === 'none')
        return { cents: 0, supported: true, warnings: [] };
    const annual = Math.max(0, taxable * periods - shelterCents(rule, profile, w4));
    const annualTax = rule.kind === 'flat'
        ? annual * (safe(rule.ratePct) / 100)
        : stateBracketTax(annual, rule.brackets || []);
    const perPeriod = annualTax / periods;
    return {
        cents: rule.roundToDollar ? cents(perPeriod / 100) * 100 : cents(perPeriod),
        supported: true,
        warnings: [],
    };
}
/** The states this build computes without an operator-supplied rate. */
function supportedStates() {
    return Object.keys(STATE_RULES).sort();
}
/** States researched and deliberately not shipped, with reasons. */
function unsupportedStates() {
    return KNOWN_UNSUPPORTED.slice();
}
//# sourceMappingURL=payroll-state-tax.js.map