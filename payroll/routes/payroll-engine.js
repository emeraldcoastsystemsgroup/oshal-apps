"use strict";
/**
 * Payroll engine — deterministic paycheck computation. NO LLM anywhere in this
 * path: tax math is arithmetic over the versioned tables in
 * payroll-tax-tables.ts, nothing else.
 *
 * Method: IRS Pub 15-T percentage method for automated payroll systems
 * (Worksheet 1A), FICA with YTD wage-base and additional-Medicare tracking,
 * Section-125 vs elective-deferral pre-tax classes handled distinctly (health
 * reduces FICA wages, deferrals do not), and FUTA/SUTA employer accruals against
 * their own wage bases.
 *
 * The Worksheet 1A equivalence is exact, not approximate, in BOTH W-4 modes —
 * see the line-1g note in payroll-tax-tables.ts and the numeric proofs in
 * tests/payroll-engine.test.mjs.
 *
 * All money is integer CENTS in and out. Every component rounds half-up once;
 * the caller never re-rounds.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 22:40:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — computePaycheck: gross (salary/hourly+OT/bonus), pre-tax split (125 vs deferral), FIT percentage method w/ Step 2 + dependents credit + extra withholding, SS wage-base cap via YTD, additional Medicare over $200k, flat-rate state, employer FICA match + FUTA/SUTA accrual, net with reimbursements.
 * 2026-08-01 13:30:00 | maintainer@emeraldcoastsystemsgroup.com | Adversarial-audit fixes, each a real defect: reported cash TIPS were added to net, so the employer paid the employee tips they already held (now withheld-on but not paid again, exposed as tipsCreditedCents); IRC 402(g) is a COMBINED pre-tax + Roth ceiling, so a 50/50 election was buying two limits; garnishment had no CCPA Title III cap and could exceed the legally protected wage; a nondiscretionary bonus never entered the FLSA regular rate, under-paying the overtime premium; the flat-method supplemental base was never returned, so W-2 box 1 lost every flat-taxed bonus; and the CCPA cap returned fractional cents. Added: an effective-dated minimum-wage floor check (Florida steps to $15.00 on 2026-09-30), and a warning when a multi-week period records >40 hours/week with no overtime — FLSA overtime is per workweek and may never be averaged.
 * 2026-08-01 10:45:00 | maintainer@emeraldcoastsystemsgroup.com | OBBBA / TY2026 compliance: cash tips as a taxable earnings component and the FLSA half-time PREMIUM isolated as qualifiedOvertimeCents — both are W-2 accumulators (box 12 TP / TT) that become MANDATORY for tax year 2026 when Notice 2025-62's transition relief ends. The dollar math is deliberately unchanged: OBBBA's tip/overtime deductions are claimed by the employee on Schedule 1-A and are NOT withholding exclusions, so tips and overtime stay fully taxable here. Also: the 2026 W-4 exemption checkbox (stops FIT, never FICA) and a configurable FUTA credit-reduction add-on (0.6% assumes the full state credit, which credit-reduction states do not get).
 * 2026-08-01 09:30:00 | maintainer@emeraldcoastsystemsgroup.com | v1.1: IRC 402(g) deferral cap against YTD deferrals; supplemental-wage flat-rate method (22% / mandatory 37% over $1M) with proportional pre-tax allocation; salary proration for mid-period hires/terminations; pluggable state withholding (none/flat/brackets) via payroll-state-tax; hardened input coercion (NaN/Infinity/negative can no longer reach the math); ssTaxableCents surfaced for W-2 box 3; warnings[] so the caller can surface a capped deferral or an underwater net instead of silently shipping it. YtdBefore consolidated to one taxable-wages accumulator (FUTA/SUTA/FICA share the same base here) plus YTD deferrals.
 *
 * @module payroll-engine
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bracketTaxCents = bracketTaxCents;
exports.federalWithholdingCents = federalWithholdingCents;
exports.supplementalWithholdingCents = supplementalWithholdingCents;
exports.ccpaCapCents = ccpaCapCents;
exports.computeTaxes = computeTaxes;
exports.computePaycheck = computePaycheck;
const payroll_tax_tables_1 = require("./payroll-tax-tables");
const payroll_state_tax_1 = require("./payroll-state-tax");
/** Round to whole cents, half-up. */
function cents(v) {
    return Math.round(v);
}
/**
 * @description Coerce arbitrary input to a safe non-negative finite number.
 * NaN / Infinity / negatives / garbage all collapse to the fallback, so no
 * malformed request can reach the tax math.
 * @param v - Any value.
 * @param fallback - Value to use when v is unusable.
 * @returns A finite number >= 0.
 */
function safe(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}
/** Clamp a percentage to 0–100. */
function pct(v) {
    return Math.min(100, safe(v));
}
/**
 * @description Progressive tax over annual taxable income. `scale` shrinks the
 * bracket thresholds (Step 2 higher-withholding uses 0.5).
 * @param taxableCents - Annual taxable income in cents (may be <= 0 → 0 tax).
 * @param brackets - Marginal brackets, last one open-ended (Infinity).
 * @param scale - Threshold multiplier (1 = standard, 0.5 = Step 2).
 * @returns Annual tax in cents.
 */
function bracketTaxCents(taxableCents, brackets, scale) {
    if (!(taxableCents > 0))
        return 0;
    let tax = 0;
    let prevTop = 0;
    for (const b of brackets) {
        const top = b.upToCents === Infinity ? Infinity : b.upToCents * scale;
        const slice = Math.min(taxableCents, top) - prevTop;
        if (slice > 0)
            tax += slice * b.rate;
        if (taxableCents <= top)
            break;
        prevTop = top;
    }
    return cents(tax);
}
/**
 * @description Federal income-tax withholding for one period — Pub 15-T
 * percentage method for automated systems (Worksheet 1A) over the annualized wage.
 * @param fitTaxablePeriodCents - This period's FIT-taxable wages.
 * @param w4 - The employee's W-4 profile.
 * @param periodsPerYear - Pay periods per year.
 * @returns Withholding for the period in cents (>= 0).
 */
function federalWithholdingCents(fitTaxablePeriodCents, w4, periodsPerYear) {
    const periods = safe(periodsPerYear, 26) || 26;
    const scale = w4.step2 ? 0.5 : 1;
    const stdDeduction = cents(payroll_tax_tables_1.STANDARD_DEDUCTION_CENTS[w4.filingStatus] * scale);
    const annualized = safe(fitTaxablePeriodCents) * periods + safe(w4.otherIncomeCents) - safe(w4.deductionsCents) - stdDeduction;
    const tentative = bracketTaxCents(annualized, payroll_tax_tables_1.FEDERAL_BRACKETS[w4.filingStatus], scale);
    const afterCredits = Math.max(0, tentative - safe(w4.dependentsCreditCents));
    return cents(afterCredits / periods) + cents(safe(w4.extraWithholdingCents));
}
/**
 * @description Withholding on supplemental wages paid under the flat-rate method:
 * 22% up to the annual threshold, a mandatory 37% on the excess above $1,000,000.
 * @param supplementalCents - Supplemental wages this period.
 * @param ytdSupplementalCents - Supplemental wages already paid this year.
 * @returns Federal withholding on the supplemental portion, in cents.
 */
function supplementalWithholdingCents(supplementalCents, ytdSupplementalCents) {
    const amount = safe(supplementalCents);
    if (amount <= 0)
        return 0;
    const ytd = safe(ytdSupplementalCents);
    const roomAtFlat = Math.max(0, payroll_tax_tables_1.SUPPLEMENTAL_MANDATORY_THRESHOLD_CENTS - ytd);
    const atFlat = Math.min(amount, roomAtFlat);
    const atMandatory = amount - atFlat;
    return cents(atFlat * payroll_tax_tables_1.SUPPLEMENTAL_FLAT_RATE) + cents(atMandatory * payroll_tax_tables_1.SUPPLEMENTAL_MANDATORY_RATE);
}
/** Gross pay components for the period, including the qualified-OT premium. */
function computeGross(comp, inputs, periodsPerYear) {
    let regularCents = 0;
    let overtimeCents = 0;
    let qualifiedOvertimeCents = 0;
    if (comp.compType === 'salary') {
        const full = safe(comp.annualSalaryCents) / (safe(periodsPerYear, 26) || 26);
        regularCents = cents((full * pct(inputs.proratePct === undefined ? 100 : inputs.proratePct)) / 100);
    }
    else {
        const rate = safe(comp.hourlyRateCents);
        const otHours = safe(inputs.otHours);
        regularCents = cents(rate * safe(inputs.hours));
        overtimeCents = cents(rate * payroll_tax_tables_1.OT_MULTIPLIER * otHours);
        // Qualified overtime is the PREMIUM only — the excess over the regular rate,
        // i.e. 0.5x for time-and-a-half — never the whole 1.5x payment.
        qualifiedOvertimeCents = inputs.otIsFlsaQualified === false ? 0 : cents(rate * (payroll_tax_tables_1.OT_MULTIPLIER - 1) * otHours);
    }
    const bonusCents = cents(safe(inputs.bonusCents));
    const tipsCents = cents(safe(inputs.tipsCents));
    // FLSA 29 CFR 778.117: a NONDISCRETIONARY bonus enters the regular rate, so the
    // overtime already paid at the base rate is short by half the bonus's hourly
    // equivalent, for every overtime hour worked.
    let bonusOtPremiumCents = 0;
    const otHours = safe(inputs.otHours);
    const totalHours = safe(inputs.hours) + otHours;
    if (comp.compType === 'hourly' && bonusCents > 0 && otHours > 0 && totalHours > 0
        && inputs.bonusIsDiscretionary !== true) {
        bonusOtPremiumCents = cents((bonusCents / totalHours) * (payroll_tax_tables_1.OT_MULTIPLIER - 1) * otHours);
    }
    return {
        regularCents,
        overtimeCents: overtimeCents + bonusOtPremiumCents,
        bonusOtPremiumCents,
        qualifiedOvertimeCents: qualifiedOvertimeCents + bonusOtPremiumCents,
        bonusCents,
        tipsCents,
        grossCents: regularCents + overtimeCents + bonusOtPremiumCents + bonusCents + tipsCents,
    };
}
/**
 * @description Flag the classic overtime-entry mistake. FLSA overtime is computed
 * per WORKWEEK and may never be averaged across weeks (29 CFR 778.104), but this
 * engine takes one hours figure per PAY PERIOD — so a period spanning several
 * weeks relies on the operator having split it. Hours beyond 40 per week in the
 * period with no overtime recorded is the signature of that mistake.
 * @param comp - Employee profile (hourly only).
 * @param inputs - This period's hours.
 * @param periodsPerYear - Pay periods per year, used to size the period in weeks.
 * @returns Zero or one warning.
 */
function overtimeSanityWarnings(comp, inputs, periodsPerYear) {
    if (comp.compType !== 'hourly')
        return [];
    const weeks = Math.max(1, Math.floor(52 / (safe(periodsPerYear, 26) || 26)));
    const straightCeiling = 40 * weeks;
    if (safe(inputs.hours) > straightCeiling && safe(inputs.otHours) === 0) {
        return [`${safe(inputs.hours)} hours recorded across a ${weeks}-week period with NO overtime. Overtime is computed per workweek and cannot be averaged across weeks — if any single week exceeded 40 hours, those hours belong in the overtime column.`];
    }
    return [];
}
/**
 * @description Warn when the effective hourly rate falls below the minimum wage
 * in force on the pay date. Never blocks — the operator may have a valid
 * exemption — but it must never pass silently.
 * @param comp - Employee profile.
 * @param inputs - This period's hours.
 * @param regularCents - Straight-time earnings computed for the period.
 * @param minimumWageCents - The applicable floor, resolved by the caller.
 * @returns Zero or one warning.
 */
function minimumWageWarnings(comp, inputs, regularCents, minimumWageCents) {
    const floor = safe(minimumWageCents);
    const hours = safe(inputs.hours);
    if (comp.compType !== 'hourly' || floor <= 0 || hours <= 0)
        return [];
    const effective = regularCents / hours;
    if (effective + 0.5 < floor) {
        return [`Effective hourly rate is ${Math.round(effective)} cents, below the ${floor}-cent minimum wage in force on this pay date.`];
    }
    return [];
}
/**
 * @description The CCPA Title III ceiling on ordinary-creditor garnishment: the
 * LESSER of 25% of disposable earnings, or the amount by which disposable
 * earnings exceed 30x the federal minimum hourly wage for the period.
 * Disposable earnings are gross less LEGALLY REQUIRED deductions only — taxes.
 * Voluntary deductions (401(k), Section 125, Roth) do NOT reduce it.
 * @param disposableCents - Disposable earnings for the period.
 * @param periodsPerYear - Pay periods per year, to size the 30x floor.
 * @returns The maximum ordinary-creditor garnishment in cents.
 */
function ccpaCapCents(disposableCents, periodsPerYear) {
    const disposable = Math.max(0, safe(disposableCents));
    const periods = safe(periodsPerYear, 26) || 26;
    const weeks = 52 / periods;
    const floor = payroll_tax_tables_1.FEDERAL_MIN_WAGE_CENTS * 30 * weeks;
    return Math.max(0, Math.min(disposable * 0.25, disposable - floor));
}
/**
 * @description The ONE tax implementation. Both the scalar `computePaycheck`
 * path and the earnings-row `computeCheck` path call this, so the two can never
 * drift into computing a paycheck two different ways.
 * @param bases - Taxable wage bases, already reduced by pre-tax deductions.
 * @param w4 - The employee's W-4 profile.
 * @param periodsPerYear - Pay periods per year.
 * @param ytd - Year-to-date accumulators from this employer.
 * @param state - The employee's state profile.
 * @param employerTax - Company SUTA / FUTA-credit-reduction settings.
 * @param useFlatSupplemental - Withhold the supplemental portion at the flat rate.
 * @returns Every computed tax plus any warnings the caller must surface.
 */
function computeTaxes(bases, w4, periodsPerYear, ytd, state, employerTax, useFlatSupplemental = false) {
    const warnings = [];
    const periods = safe(periodsPerYear, 26) || 26;
    const fitBase = Math.max(0, safe(bases.fitCents));
    const ficaBase = Math.max(0, safe(bases.ficaCents));
    const futaBase = Math.max(0, safe(bases.futaCents));
    const supplemental = useFlatSupplemental ? Math.max(0, safe(bases.supplementalCents)) : 0;
    const regularBase = Math.max(0, fitBase - supplemental);
    // An exempt W-4 stops FEDERAL INCOME TAX only — FICA is statutory.
    const exempt = w4.exempt === true;
    const fitRegular = exempt ? 0 : federalWithholdingCents(regularBase, w4, periods);
    const supplementalFitCents = exempt ? 0 : supplementalWithholdingCents(supplemental, ytd.supplementalWagesCents);
    if (exempt)
        warnings.push('W-4 claims exemption from federal income tax withholding — no FIT withheld. Exemption expires each February.');
    const ytdWages = Math.max(0, safe(ytd.taxableWagesCents));
    const ssTaxableCents = Math.min(ficaBase, Math.max(0, payroll_tax_tables_1.SS_WAGE_BASE_CENTS - ytdWages));
    const ssCents = cents(ssTaxableCents * payroll_tax_tables_1.SS_RATE);
    const medicareCents = cents(ficaBase * payroll_tax_tables_1.MEDICARE_RATE);
    const overBefore = Math.max(0, ytdWages - payroll_tax_tables_1.ADDL_MEDICARE_THRESHOLD_CENTS);
    const overAfter = Math.max(0, ytdWages + ficaBase - payroll_tax_tables_1.ADDL_MEDICARE_THRESHOLD_CENTS);
    const addlMedicareCents = cents((overAfter - overBefore) * payroll_tax_tables_1.ADDL_MEDICARE_RATE);
    const st = (0, payroll_state_tax_1.stateWithholding)(state, Math.max(0, safe(bases.stateCents)), w4, periods);
    warnings.push(...st.warnings);
    const erSsCents = cents(ssTaxableCents * payroll_tax_tables_1.SS_RATE);
    const erMedicareCents = cents(ficaBase * payroll_tax_tables_1.MEDICARE_RATE);
    const futaRate = payroll_tax_tables_1.FUTA_RATE + pct(employerTax.futaCreditReductionPct) / 100;
    const futaCents = cents(Math.min(futaBase, Math.max(0, payroll_tax_tables_1.FUTA_WAGE_BASE_CENTS - ytdWages)) * futaRate);
    const sutaBase = cents(safe(employerTax.sutaWageBaseCents));
    const sutaCents = cents(Math.min(futaBase, Math.max(0, sutaBase - ytdWages)) * (pct(employerTax.sutaRatePct) / 100));
    return {
        fitCents: fitRegular + supplementalFitCents,
        supplementalFitCents,
        ssCents,
        ssTaxableCents,
        medicareCents,
        addlMedicareCents,
        stateCents: st.cents,
        stateSupported: st.supported,
        employer: {
            ssCents: erSsCents, medicareCents: erMedicareCents, futaCents, sutaCents,
            totalCents: erSsCents + erMedicareCents + futaCents + sutaCents,
        },
        warnings,
    };
}
/**
 * @description Computes one full paycheck: gross through net plus employer
 * accruals, honoring YTD wage-base caps and the 402(g) deferral ceiling.
 * @param comp - Employee compensation + election profile.
 * @param inputs - This period's hours/bonus/reimbursement/proration.
 * @param periodsPerYear - Pay periods per year (from company frequency).
 * @param ytd - YTD accumulators from this employer, before this check.
 * @param employerTax - Company SUTA settings.
 * @returns The complete component breakdown, integer cents throughout.
 */
function computePaycheck(comp, inputs, periodsPerYear, ytd, employerTax) {
    const warnings = [];
    const periods = safe(periodsPerYear, 26) || 26;
    // ── Gross ────────────────────────────────────────────────────────────────
    const { regularCents, overtimeCents, bonusOtPremiumCents, qualifiedOvertimeCents, bonusCents, tipsCents, grossCents } = computeGross(comp, inputs, periods);
    if (bonusOtPremiumCents > 0) {
        warnings.push(`Bonus treated as NONDISCRETIONARY: ${bonusOtPremiumCents} of extra overtime premium was added to satisfy the FLSA regular-rate rule. Mark the bonus discretionary if that is wrong.`);
    }
    warnings.push(...overtimeSanityWarnings(comp, inputs, periods));
    warnings.push(...minimumWageWarnings(comp, inputs, regularCents, employerTax.minimumWageCents));
    // ── Pre-tax ──────────────────────────────────────────────────────────────
    const requestedHealth = cents(safe(comp.healthPerPeriodCents));
    const healthCents = Math.min(grossCents, requestedHealth);
    if (requestedHealth > healthCents) {
        warnings.push(`Health premium ${requestedHealth} exceeded gross pay; only ${healthCents} was deducted.`);
    }
    // IRC 402(g) applies to pre-tax AND designated Roth elective deferrals
    // COMBINED — a 50/50 split does not buy two limits. Pre-tax draws first, then
    // Roth takes whatever room is left.
    const requestedDeferral = cents((grossCents * pct(comp.k401Pct)) / 100);
    const requestedRoth = cents((grossCents * pct(comp.rothPct)) / 100);
    const deferralRoom = Math.max(0, (0, payroll_tax_tables_1.deferralLimitCents)(comp.age) - safe(ytd.deferralCents));
    const payAvailable = Math.max(0, grossCents - healthCents);
    const k401Cents = Math.min(requestedDeferral, deferralRoom, payAvailable);
    const rothCents = Math.min(requestedRoth, deferralRoom - k401Cents, payAvailable - k401Cents);
    if (requestedDeferral > k401Cents) {
        warnings.push(`Pre-tax 401(k) deferral capped at ${k401Cents} (IRC 402(g) annual limit or available pay).`);
    }
    if (requestedRoth > rothCents) {
        warnings.push(`Roth deferral capped at ${rothCents} — IRC 402(g) is a COMBINED limit across pre-tax and Roth.`);
    }
    const ficaTaxableCents = Math.max(0, grossCents - healthCents);
    const preTaxTotal = healthCents + k401Cents;
    // ── Federal income tax ───────────────────────────────────────────────────
    // Under the flat method the bonus leaves the percentage-method base and is
    // withheld at its own rate; pre-tax dollars are allocated proportionally so
    // neither base is credited twice.
    const useFlat = inputs.bonusMethod === 'flat' && bonusCents > 0;
    const regularGross = regularCents + overtimeCents + tipsCents;
    const regularShare = grossCents > 0 ? regularGross / grossCents : 1;
    const fitTaxableCents = useFlat
        ? Math.max(0, regularGross - cents(preTaxTotal * regularShare))
        : Math.max(0, grossCents - preTaxTotal);
    const supplementalBase = useFlat ? Math.max(0, bonusCents - cents(preTaxTotal * (1 - regularShare))) : 0;
    // Delegate every tax to the shared implementation so this path and the
    // earnings-row path can never compute a paycheck two different ways.
    const t = computeTaxes({
        fitCents: fitTaxableCents + supplementalBase,
        ficaCents: ficaTaxableCents,
        futaCents: ficaTaxableCents,
        stateCents: fitTaxableCents + supplementalBase,
        supplementalCents: supplementalBase,
    }, comp.w4, periods, ytd, comp.state, employerTax, useFlat);
    warnings.push(...t.warnings);
    const fitCents = t.fitCents;
    const supplementalFitCents = t.supplementalFitCents;
    const ssTaxableCents = t.ssTaxableCents;
    const ssCents = t.ssCents;
    const medicareCents = t.medicareCents;
    const addlMedicareCents = t.addlMedicareCents;
    const stateCents = t.stateCents;
    // ── Post-tax ─────────────────────────────────────────────────────────────
    const otherPostTaxCents = cents(safe(comp.otherPostTaxCents));
    const reimbursementCents = cents(safe(inputs.reimbursementCents));
    // Disposable earnings for the CCPA test = gross less LEGALLY REQUIRED
    // deductions (taxes) only. Voluntary elections never reduce it.
    const disposableEarningsCents = Math.max(0, grossCents - fitCents - ssCents - medicareCents - addlMedicareCents - stateCents);
    const requestedGarnishment = cents(safe(comp.garnishmentCents));
    // Rounded: the CCPA ceiling is a percentage, and money leaving this engine is
    // always whole cents.
    const garnishmentCents = cents(Math.min(requestedGarnishment, ccpaCapCents(disposableEarningsCents, periods)));
    if (requestedGarnishment > garnishmentCents) {
        warnings.push(`Garnishment reduced from ${requestedGarnishment} to ${garnishmentCents} by the CCPA Title III limit (the lesser of 25% of disposable earnings or the excess over 30x the federal minimum wage).`);
    }
    // Reported cash tips are taxable wages the employee ALREADY holds — the
    // employer withholds on them but must not hand them over a second time.
    const tipsCreditedCents = tipsCents;
    const netCents = grossCents - tipsCreditedCents - healthCents - k401Cents - fitCents - ssCents - medicareCents -
        addlMedicareCents - stateCents - rothCents - otherPostTaxCents - garnishmentCents + reimbursementCents;
    if (netCents < 0) {
        warnings.push(`Net pay is negative (${netCents}) — withholding and deductions exceed the cash portion of this check. With reported tips this usually means taxes could not be collected from cash wages; the uncollected amount must be handled outside this run.`);
    }
    // ── Employer side ────────────────────────────────────────────────────────
    // Also from the shared implementation — a second copy here is exactly how the
    // two paths would drift.
    const erSsCents = t.employer.ssCents;
    const erMedicareCents = t.employer.medicareCents;
    const futaCents = t.employer.futaCents;
    const sutaCents = t.employer.sutaCents;
    return {
        grossCents,
        regularCents,
        overtimeCents,
        qualifiedOvertimeCents,
        bonusCents,
        tipsCents,
        healthCents,
        k401Cents,
        fitTaxableCents,
        supplementalTaxableCents: supplementalBase,
        ficaTaxableCents,
        ssTaxableCents,
        fitCents,
        supplementalFitCents,
        ssCents,
        medicareCents,
        addlMedicareCents,
        stateCents,
        rothCents,
        otherPostTaxCents,
        garnishmentCents,
        disposableEarningsCents,
        tipsCreditedCents,
        reimbursementCents,
        netCents,
        employer: {
            ssCents: erSsCents,
            medicareCents: erMedicareCents,
            futaCents,
            sutaCents,
            totalCents: erSsCents + erMedicareCents + futaCents + sutaCents,
        },
        warnings,
    };
}
//# sourceMappingURL=payroll-engine.js.map