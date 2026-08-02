"use strict";
/**
 * Pay-run assembler — turns EARNINGS ROWS and DEDUCTION ROWS into a paycheck.
 *
 * This is the layer v1 did not have. payroll-engine.ts stays the verified tax
 * CORE (Pub 15-T withholding, FICA, the CCPA ceiling) and is unchanged; this
 * module builds the taxable bases that feed it out of a real earnings model, and
 * applies deductions in the order the law requires.
 *
 * THE FOUR THINGS THAT MAKE IT A SYSTEM RATHER THAN A CALCULATOR:
 *
 * 1. FLSA overtime is computed PER WORKWEEK and never averaged across weeks
 *    (29 CFR 778.104). Earnings rows carry a workweek index; 30h + 50h across a
 *    biweekly period yields 10 overtime hours, not zero.
 * 2. The regular rate is WEIGHTED, and nondiscretionary pay enters it
 *    (29 CFR 778.115 / 778.117). Two rates in one week, or a production bonus,
 *    both change what an overtime hour is worth.
 * 3. Each tax base is reduced independently. Section 125 reduces FIT, FICA, FUTA
 *    and state; a 401(k) deferral reduces income tax only. One "pretax" flag
 *    cannot express that.
 * 4. Deductions are applied against LIMITED net in a defined order, garnishments
 *    share one CCPA ceiling in statutory priority, and what does not fit goes to
 *    ARREARS instead of silently vanishing or driving the check negative.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 15:45:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — earnings rows with per-workweek FLSA overtime derivation and the weighted regular rate; independent per-base pre-tax reduction; ordered deduction application with 402(g) sharing, garnishment priority under one CCPA ceiling, and arrears; imputed-income and reported-tips handling (taxed, not paid).
 *
 * @module payroll-payrun
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.unknownEarningsCodes = unknownEarningsCodes;
exports.unknownDeductionCodes = unknownDeductionCodes;
exports.deriveFlsaOvertime = deriveFlsaOvertime;
exports.computeCheck = computeCheck;
const payroll_codes_1 = require("./payroll-codes");
const payroll_engine_1 = require("./payroll-engine");
const payroll_tax_tables_1 = require("./payroll-tax-tables");
/** Round half-up to whole cents. */
function cents(v) {
    return Math.round(v);
}
/** Non-negative finite coercion. */
function safe(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}
/** Gross for one earnings row before any overtime derivation. */
function rowGross(row, def) {
    return def.entry === 'hourly'
        ? cents(safe(row.rateCents) * safe(row.hours) * def.multiplier)
        : cents(safe(row.amountCents));
}
/**
 * @description Reject unknown codes loudly rather than silently dropping pay.
 * @param rows - Earnings rows as supplied.
 * @returns The unknown codes found, empty when all are valid.
 */
function unknownEarningsCodes(rows) {
    return [...new Set(rows.map((r) => String(r.code || '').toUpperCase()))].filter((c) => !payroll_codes_1.EARNINGS_CODES[c]);
}
/** Reject unknown deduction codes the same way. */
function unknownDeductionCodes(rows) {
    return [...new Set(rows.map((r) => String(r.code || '').toUpperCase()))].filter((c) => !payroll_codes_1.DEDUCTION_CODES[c]);
}
/**
 * @description Derive FLSA overtime PER WORKWEEK from straight-time rows.
 *
 * For each workweek: sum hours that count as hours worked. Anything over 40 is
 * overtime, and the premium is half the WEIGHTED regular rate for that week —
 * straight-time earnings plus nondiscretionary pay, divided by hours worked
 * (29 CFR 778.115). Hours are never averaged across weeks, which is the whole
 * point: 30 + 50 over a biweekly period owes 10 hours of premium even though the
 * period total is 80.
 *
 * Rows already coded OT/DT are treated as explicitly entered and left alone; the
 * derivation then only tops up the premium owed on nondiscretionary pay.
 * @param rows - Earnings rows for the period.
 * @returns Derived premium rows to append, the hours-worked map, and warnings.
 */
function deriveFlsaOvertime(rows) {
    const warnings = [];
    const weeks = new Map();
    for (const r of rows) {
        const wk = Math.max(1, Math.trunc(safe(r.workweek, 1)) || 1);
        if (!weeks.has(wk))
            weeks.set(wk, []);
        weeks.get(wk).push(r);
    }
    const premiumRows = [];
    const workweekHours = {};
    for (const [wk, wkRows] of [...weeks.entries()].sort((a, b) => a[0] - b[0])) {
        let hoursWorked = 0;
        let straightEarnings = 0;
        let explicitOtHours = 0;
        for (const r of wkRows) {
            const def = (0, payroll_codes_1.earningsCode)(r.code);
            if (!def)
                continue;
            const g = rowGross(r, def);
            if (def.hoursWorked)
                hoursWorked += safe(r.hours);
            if (def.regularRate === 'included' || def.regularRate === 'included-no-hours')
                straightEarnings += g;
            if (def.regularRate === 'premium') {
                explicitOtHours += safe(r.hours);
                // An OT row pays straight time PLUS a premium. Only the straight-time
                // portion belongs in the regular-rate numerator; counting the premium
                // there would inflate the rate the premium is computed from.
                if (def.multiplier > 1)
                    straightEarnings += cents(g / def.multiplier);
            }
        }
        workweekHours[wk] = hoursWorked;
        if (hoursWorked <= 0)
            continue;
        const regularRate = straightEarnings / hoursWorked;
        const overHours = Math.max(0, hoursWorked - 40);
        if (overHours > 0 && explicitOtHours === 0) {
            // Straight time was recorded past 40 with no overtime row — owe the premium.
            premiumRows.push({
                code: 'OTP', hours: 0, rateCents: 0,
                amountCents: cents(regularRate * 0.5 * overHours),
                workweek: wk, memo: `derived FLSA premium, week ${wk}`,
            });
            warnings.push(`Week ${wk}: ${hoursWorked} hours worked with no overtime recorded — ${overHours} hours of FLSA premium were derived at the weighted regular rate.`);
        }
        else if (explicitOtHours > 0) {
            // Overtime was entered at a base rate; top up if nondiscretionary pay lifted
            // the regular rate above that base.
            const premiumAlreadyPaid = wkRows.reduce((a, r) => {
                const d = (0, payroll_codes_1.earningsCode)(r.code);
                if (!d || d.regularRate !== 'premium')
                    return a;
                const g = rowGross(r, d);
                return a + (d.multiplier > 1 ? g - cents(g / d.multiplier) : g);
            }, 0);
            const premiumOwed = cents(regularRate * 0.5 * explicitOtHours);
            const topUp = premiumOwed - premiumAlreadyPaid;
            {
                if (topUp > 0) {
                    premiumRows.push({
                        code: 'OTP', hours: 0, rateCents: 0, amountCents: topUp,
                        workweek: wk, memo: `regular-rate top-up on ${explicitOtHours} OT hours, week ${wk}`,
                    });
                    warnings.push(`Week ${wk}: nondiscretionary pay raised the regular rate, so ${topUp} of additional overtime premium was added (29 CFR 778.117).`);
                }
            }
        }
    }
    return { premiumRows, workweekHours, warnings };
}
/** Split gross across tax bases according to each code's taxability. */
function buildBases(all) {
    const b = { fitCents: 0, ficaCents: 0, futaCents: 0, stateCents: 0, supplementalCents: 0 };
    for (const r of all) {
        if (r.def.tax.fit)
            b.fitCents += r.grossCents;
        if (r.def.tax.fica)
            b.ficaCents += r.grossCents;
        if (r.def.tax.futa)
            b.futaCents += r.grossCents;
        if (r.def.tax.state)
            b.stateCents += r.grossCents;
    }
    return b;
}
/** Resolve a deduction row's requested amount for this period. */
function requestedAmount(d, grossCents) {
    const base = d.percentOfGross !== undefined
        ? cents((grossCents * Math.min(100, safe(d.percentOfGross))) / 100)
        : cents(safe(d.amountCents));
    const withArrears = base + cents(safe(d.arrearsCents));
    if (d.annualLimitCents === undefined)
        return withArrears;
    const room = Math.max(0, safe(d.annualLimitCents) - safe(d.ytdCents));
    return Math.min(withArrears, room);
}
/** Apply the pre-tax deductions, reducing each base independently. */
function applyPreTax(deds, grossCents, bases, age, ytdDeferral) {
    const applied = [];
    const warnings = [];
    let total = 0;
    let deferralRoom = Math.max(0, (0, payroll_tax_tables_1.deferralLimitCents)(age) - safe(ytdDeferral));
    for (const d of deds) {
        const def = (0, payroll_codes_1.deductionCode)(d.code);
        if (!def)
            continue;
        const reducesSomething = def.reduces.fit || def.reduces.fica || def.reduces.futa || def.reduces.state;
        if (!reducesSomething && !def.countsToward402g)
            continue; // post-tax handled later
        let want = requestedAmount(d, grossCents);
        let reason;
        // 402(g) is ONE ceiling shared by pre-tax and Roth deferrals.
        if (def.countsToward402g) {
            if (want > deferralRoom) {
                reason = `Capped by the IRC 402(g) combined elective-deferral limit.`;
                warnings.push(`${def.label} reduced to ${deferralRoom} — 402(g) is a COMBINED pre-tax and Roth ceiling.`);
                want = deferralRoom;
            }
            deferralRoom -= want;
        }
        // Never let pre-tax exceed the pay it comes out of.
        const room = Math.max(0, grossCents - total);
        if (want > room) {
            want = room;
            reason = 'Limited by available pay.';
        }
        if (def.reduces.fit)
            bases.fitCents = Math.max(0, bases.fitCents - want);
        if (def.reduces.fica)
            bases.ficaCents = Math.max(0, bases.ficaCents - want);
        if (def.reduces.futa)
            bases.futaCents = Math.max(0, bases.futaCents - want);
        if (def.reduces.state)
            bases.stateCents = Math.max(0, bases.stateCents - want);
        total += want;
        applied.push({
            code: def.code, label: def.label, requestedCents: requestedAmount(d, grossCents),
            appliedCents: want, arrearsAddedCents: 0, reason,
        });
    }
    return { applied, total, warnings };
}
/** The CCPA ceiling for one garnishment code against disposable earnings. */
function garnishmentCeiling(def, d, disposable, periods) {
    if (def.code === 'GARN_SUPPORT') {
        const pctAllowed = Math.min(65, safe(d.supportCcpaPct, 50)) / 100;
        return disposable * pctAllowed;
    }
    if (def.code === 'GARN_STUDENT')
        return disposable * 0.15;
    return (0, payroll_engine_1.ccpaCapCents)(disposable, periods);
}
/**
 * @description Assemble a paycheck from earnings and deduction rows.
 * @param earnings - Earnings rows for the period (workweek-tagged).
 * @param deductions - Resolved deduction elections for the period.
 * @param w4 - The employee's W-4 profile.
 * @param opts - Periods per year, age, state profile, YTD, employer settings.
 * @returns The assembled check with every component and any warnings.
 */
function computeCheck(earnings, deductions, w4, opts) {
    const warnings = [];
    const periods = safe(opts.periodsPerYear, 26) || 26;
    const bad = unknownEarningsCodes(earnings);
    if (bad.length)
        warnings.push(`Unknown earnings code(s) ignored: ${bad.join(', ')}.`);
    const badD = unknownDeductionCodes(deductions);
    if (badD.length)
        warnings.push(`Unknown deduction code(s) ignored: ${badD.join(', ')}.`);
    // ── Earnings, with FLSA overtime derived per workweek ─────────────────────
    const derived = deriveFlsaOvertime(earnings);
    warnings.push(...derived.warnings);
    const allRows = [...earnings, ...derived.premiumRows];
    const priced = allRows
        .map((r) => { const def = (0, payroll_codes_1.earningsCode)(r.code); return def ? { ...r, def, grossCents: rowGross(r, def) } : null; })
        .filter((x) => x !== null);
    const grossCents = priced.filter((r) => r.def.tax.fit || r.def.tax.fica).reduce((a, r) => a + r.grossCents, 0);
    const nontaxablePaidCents = priced.filter((r) => !r.def.tax.fit && !r.def.tax.fica && r.def.paid)
        .reduce((a, r) => a + r.grossCents, 0);
    const imputedCents = priced.filter((r) => !r.def.paid && r.def.code !== 'TIPS_CASH')
        .reduce((a, r) => a + r.grossCents, 0);
    const reportedTipsCents = priced.filter((r) => r.def.code === 'TIPS_CASH').reduce((a, r) => a + r.grossCents, 0);
    const cashEarningsCents = priced.filter((r) => r.def.paid && (r.def.tax.fit || r.def.tax.fica))
        .reduce((a, r) => a + r.grossCents, 0);
    // Qualified overtime for W-2 box 12 TT is the PREMIUM portion only.
    const qualifiedOvertimeCents = priced
        .filter((r) => r.def.qualifiedPremiumShare !== undefined)
        .reduce((a, r) => a + cents(r.grossCents * r.def.qualifiedPremiumShare), 0);
    const bases = buildBases(priced);
    const supplementalCents = priced.filter((r) => ['BONUS_ND', 'BONUS_D', 'SEV', 'COMM', 'RETRO'].includes(r.def.code))
        .reduce((a, r) => a + r.grossCents, 0);
    bases.supplementalCents = supplementalCents;
    // ── Pre-tax ───────────────────────────────────────────────────────────────
    const active = opts.suppressVoluntaryDeductions
        ? deductions.filter((d) => (0, payroll_codes_1.deductionCode)(d.code)?.statutory)
        : deductions;
    const pre = applyPreTax(active, grossCents, bases, opts.age, opts.ytd.deferralCents);
    warnings.push(...pre.warnings);
    // ── Taxes (the verified core) ─────────────────────────────────────────────
    const taxes = (0, payroll_engine_1.computeTaxes)(bases, w4, periods, opts.ytd, opts.state, opts.employerTax);
    warnings.push(...taxes.warnings);
    const totalTax = taxes.fitCents + taxes.ssCents + taxes.medicareCents + taxes.addlMedicareCents + taxes.stateCents;
    // Disposable earnings for the CCPA test = gross less LEGALLY REQUIRED
    // deductions (taxes) only. Voluntary elections never reduce it.
    const disposableEarningsCents = Math.max(0, grossCents - totalTax);
    // ── Post-tax, against what is actually left to pay ────────────────────────
    // Cash available: what we can actually hand over. Imputed income and reported
    // cash tips are taxable but not payable, so they cannot fund a deduction.
    let available = cashEarningsCents + nontaxablePaidCents - pre.total - totalTax;
    const postApplied = [];
    let postTotal = 0;
    let garnTotal = 0;
    let garnishmentRoom = (0, payroll_engine_1.ccpaCapCents)(disposableEarningsCents, periods);
    const ordered = [...active]
        .map((d) => ({ d, def: (0, payroll_codes_1.deductionCode)(d.code) }))
        .filter((x) => x.def !== null)
        .filter((x) => !(x.def.reduces.fit || x.def.reduces.fica || x.def.reduces.futa || x.def.reduces.state || x.def.countsToward402g))
        .sort((a, b) => (a.def.garnishmentPriority ?? 99) - (b.def.garnishmentPriority ?? 99));
    for (const { d, def } of ordered) {
        const requested = requestedAmount(d, grossCents);
        let allowed = requested;
        let reason;
        if (def.garnishmentPriority !== undefined) {
            const ceiling = Math.min(garnishmentCeiling(def, d, disposableEarningsCents, periods), garnishmentRoom);
            if (allowed > ceiling) {
                allowed = Math.max(0, cents(ceiling));
                reason = 'Reduced by the CCPA disposable-earnings ceiling, applied in statutory priority.';
            }
            garnishmentRoom = Math.max(0, garnishmentRoom - allowed);
        }
        if (allowed > available) {
            allowed = Math.max(0, available);
            reason = 'Insufficient net pay this period.';
        }
        const shortfall = requested - allowed;
        const arrearsAdded = shortfall > 0 && def.allowArrears ? shortfall : 0;
        if (shortfall > 0 && !def.allowArrears) {
            warnings.push(`${def.label}: ${shortfall} could not be taken and is NOT carried to arrears for this deduction type.`);
        }
        if (arrearsAdded > 0) {
            warnings.push(`${def.label}: ${arrearsAdded} carried to arrears — ${reason || 'limited this period'}`);
        }
        available -= allowed;
        postTotal += allowed;
        if (def.garnishmentPriority !== undefined)
            garnTotal += allowed;
        postApplied.push({
            code: def.code, label: def.label, requestedCents: requested,
            appliedCents: allowed, arrearsAddedCents: arrearsAdded, reason,
        });
    }
    const netCents = cashEarningsCents + nontaxablePaidCents - pre.total - totalTax - postTotal;
    if (netCents < 0) {
        warnings.push(`Net pay is negative (${netCents}) — withholding exceeds the cash portion of this check. With imputed income or reported tips, the uncollected tax must be handled outside this run.`);
    }
    return {
        earnings: priced.map(({ def, ...row }) => ({ ...row, label: def.label })),
        grossCents,
        cashEarningsCents,
        imputedCents,
        reportedTipsCents,
        nontaxablePaidCents,
        bases,
        taxes,
        deductions: [...pre.applied, ...postApplied],
        preTaxCents: pre.total,
        postTaxCents: postTotal,
        garnishmentCents: garnTotal,
        disposableEarningsCents,
        netCents,
        workweekHours: derived.workweekHours,
        qualifiedOvertimeCents,
        warnings,
    };
}
//# sourceMappingURL=payroll-payrun.js.map