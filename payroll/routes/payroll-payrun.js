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
 * 2                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 7: garnishment orders go through payroll-garnish. The shared room had been the 25 percent creditor limit, so a support order was held to 25 percent where 15 U.S.C. 1673(b)(2) allows 50 to 65; a levy and an agency order were held to the creditor limit too. Each order now meets its own cumulative federal ceiling (29 CFR 870.11), the levy takes take-home pay above the Publication 1494 exempt amount, and a check whose priority or allocation facts are missing carries refusals that stop approval.
 * 3                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 3: earning rows may carry the workday they were worked; a workweek that an earlier check also paid is computed over the whole workweek (its hours, its weighted regular rate, less premium already paid; 29 CFR 778.104), where the overtime used to be computed on this check's share alone; derived premium rows carry the workweek's first day so the next check can see them.
 *
 * @module payroll-payrun
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.unknownEarningsCodes = unknownEarningsCodes;
exports.unknownDeductionCodes = unknownDeductionCodes;
exports.deriveFlsaOvertime = deriveFlsaOvertime;
exports.workweekTotals = workweekTotals;
exports.computeCheck = computeCheck;
const payroll_codes_1 = require("./payroll-codes");
const payroll_engine_1 = require("./payroll-engine");
const payroll_garnish_1 = require("./payroll-garnish");
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
function deriveFlsaOvertime(rows, carried = {}, weekStarts = {}) {
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
        const t = workweekTotals(wkRows);
        workweekHours[wk] = t.hours;
        const prior = carried[wk];
        if (prior && prior.hours > 0) {
            const row = straddlingPremium(wk, t, prior, weekStarts[wk]);
            if (row) {
                premiumRows.push(row);
                warnings.push(`Week ${wk}: ${prior.hours + t.hours} hours worked in the workweek, ${prior.hours} of them paid on an earlier check — ${row.amountCents} of FLSA premium is owed on this check (29 CFR 778.104).`);
            }
            continue;
        }
        if (t.hours <= 0)
            continue;
        const regularRate = t.straightCents / t.hours;
        const overHours = Math.max(0, t.hours - 40);
        if (overHours > 0 && t.explicitOtHours === 0) {
            // Straight time was recorded past 40 with no overtime row — owe the premium.
            premiumRows.push({
                code: 'OTP', hours: 0, rateCents: 0,
                amountCents: cents(regularRate * 0.5 * overHours),
                workweek: wk, memo: `derived FLSA premium, week ${wk}`, workDate: weekStarts[wk],
            });
            warnings.push(`Week ${wk}: ${t.hours} hours worked with no overtime recorded — ${overHours} hours of FLSA premium were derived at the weighted regular rate.`);
        }
        else if (t.explicitOtHours > 0) {
            // Overtime was entered at a base rate; top up if nondiscretionary pay lifted
            // the regular rate above that base.
            const premiumOwed = cents(regularRate * 0.5 * t.explicitOtHours);
            const topUp = premiumOwed - t.premiumCents;
            if (topUp > 0) {
                premiumRows.push({
                    code: 'OTP', hours: 0, rateCents: 0, amountCents: topUp,
                    workweek: wk, memo: `regular-rate top-up on ${t.explicitOtHours} OT hours, week ${wk}`, workDate: weekStarts[wk],
                });
                warnings.push(`Week ${wk}: nondiscretionary pay raised the regular rate, so ${topUp} of additional overtime premium was added (29 CFR 778.117).`);
            }
        }
    }
    return { premiumRows, workweekHours, warnings };
}
/**
 * @description Hours worked, straight-time earnings, explicit overtime hours and
 * premium already paid, for rows of one workweek.
 *
 * An OT row pays straight time PLUS a premium. Only the straight-time portion
 * belongs in the regular-rate numerator; counting the premium there would
 * inflate the rate the premium is computed from.
 * @param rows - Earning rows of one workweek.
 * @returns The four totals.
 */
function workweekTotals(rows) {
    const out = { hours: 0, straightCents: 0, explicitOtHours: 0, premiumCents: 0 };
    for (const r of rows) {
        const def = (0, payroll_codes_1.earningsCode)(r.code);
        if (!def)
            continue;
        const g = rowGross(r, def);
        if (def.hoursWorked)
            out.hours += safe(r.hours);
        if (def.regularRate === 'included' || def.regularRate === 'included-no-hours')
            out.straightCents += g;
        if (def.regularRate === 'premium') {
            out.explicitOtHours += safe(r.hours);
            if (def.multiplier > 1)
                out.straightCents += cents(g / def.multiplier);
            out.premiumCents += def.multiplier > 1 ? g - cents(g / def.multiplier) : g;
        }
    }
    return out;
}
/**
 * The premium still owed for a workweek split across two checks. 29 CFR 778.104
 * makes the workweek the unit, so the regular rate and the hours over 40 are
 * taken over the whole workweek, and what earlier checks already paid as
 * premium is subtracted.
 */
function straddlingPremium(wk, t, prior, weekStart) {
    const hours = prior.hours + t.hours;
    if (hours <= 40)
        return null;
    const rate = (prior.straightCents + t.straightCents) / hours;
    const owed = cents(rate * 0.5 * (hours - 40)) - prior.premiumCents - t.premiumCents;
    if (owed <= 0)
        return null;
    return {
        code: 'OTP', hours: 0, rateCents: 0, amountCents: owed, workweek: wk, workDate: weekStart,
        memo: `derived FLSA premium, week ${wk}, counting ${prior.hours} hours paid on an earlier check`,
    };
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
            electionId: d.electionId, code: def.code, label: def.label, requestedCents: requestedAmount(d, grossCents),
            appliedCents: want, arrearsAddedCents: 0, reason,
        });
    }
    return { applied, total, warnings };
}
/**
 * Health insurance premiums: 31 CFR 285.11(c) takes them out of "disposable
 * pay" for a federal agency order, though not out of CCPA disposable earnings.
 * Medical, dental and vision coverage are read as health insurance; an FSA or
 * HSA contribution is not a premium.
 */
const HEALTH_PREMIUM_CODES = new Set(['MED125', 'DEN125', 'VIS125']);
/** A garnishment election as the allocator sees it. */
function garnishmentOrder(d, def) {
    return {
        electionId: d.electionId, code: def.code, label: def.label, amountCents: cents(safe(d.amountCents)) + cents(safe(d.arrearsCents)),
        orderPct: d.orderPct, supportCcpaPct: d.supportCcpaPct, servedOn: d.servedOn, enteredOn: d.enteredOn,
        priorityRank: d.priorityRank, levy: d.levy,
    };
}
/** Voluntary post-tax deductions in effect when the earliest levy was served. */
function voluntaryBeforeLevy(rows, grossCents) {
    const levyDates = rows.filter((x) => x.def.code === 'GARN_LEVY' && x.d.servedOn).map((x) => String(x.d.servedOn)).sort();
    if (!levyDates.length)
        return 0;
    return rows.filter((x) => x.def.garnishmentPriority === undefined && (!x.d.effectiveFrom || x.d.effectiveFrom < levyDates[0]))
        .reduce((a, x) => a + requestedAmount(x.d, grossCents), 0);
}
/**
 * Allocate the garnishment orders, then turn the result into applied rows.
 * A levy carries no arrears: what it did not take stays on its balance.
 */
function applyGarnishments(rows, applied, check) {
    const garn = rows.filter((x) => x.def.garnishmentPriority !== undefined);
    if (!garn.length)
        return { total: 0, warnings: [], refusals: [] };
    const result = (0, payroll_garnish_1.allocateGarnishments)(garn.map((x) => garnishmentOrder(x.d, x.def)), {
        payDate: check.payDate, periodsPerYear: check.periods, federalMinWageCents: payroll_tax_tables_1.FEDERAL_MIN_WAGE_CENTS,
        disposableCents: check.disposableEarningsCents, healthPremiumCents: check.healthCents, cashCents: check.cashCents,
        voluntaryPostTaxCents: voluntaryBeforeLevy(rows, check.grossCents),
    });
    const warnings = [...result.warnings, ...result.refusals.map((r) => `Garnishment not computed: ${r}`)];
    for (const a of result.applied) {
        const arrears = a.code === 'GARN_LEVY' ? 0 : a.shortfallCents;
        if (arrears > 0)
            warnings.push(`${a.label}: ${arrears} carried to arrears — ${a.reason}`);
        applied.push({ electionId: a.electionId, code: a.code, label: a.label, requestedCents: a.requestedCents, appliedCents: a.appliedCents,
            arrearsAddedCents: arrears, reason: a.reason || undefined });
    }
    return { total: result.totalCents, warnings, refusals: result.refusals };
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
    const derived = deriveFlsaOvertime(earnings, opts.carriedWorkweeks || {}, opts.weekStarts || {});
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
    const post = [...active]
        .map((d) => ({ d, def: (0, payroll_codes_1.deductionCode)(d.code) }))
        .filter((x) => x.def !== null)
        .filter((x) => !(x.def.reduces.fit || x.def.reduces.fica || x.def.reduces.futa || x.def.reduces.state || x.def.countsToward402g));
    // Garnishment orders first, each under its own federal ceiling (payroll-garnish).
    // Reimbursements are not earnings, so they never fund one.
    const health = pre.applied.filter((a) => HEALTH_PREMIUM_CODES.has(a.code)).reduce((a, x) => a + x.appliedCents, 0);
    const garn = applyGarnishments(post, postApplied, {
        grossCents, disposableEarningsCents, healthCents: health, periods,
        cashCents: Math.max(0, cashEarningsCents - pre.total - totalTax), payDate: String(opts.payDate || ''),
    });
    warnings.push(...garn.warnings);
    available -= garn.total;
    let postTotal = garn.total;
    const garnTotal = garn.total;
    for (const { d, def } of post.filter((x) => x.def.garnishmentPriority === undefined)) {
        const requested = requestedAmount(d, grossCents);
        let allowed = requested;
        let reason;
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
        postApplied.push({
            electionId: d.electionId, code: def.code, label: def.label, requestedCents: requested,
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
        garnishmentRefusals: garn.refusals,
        netCents,
        workweekHours: derived.workweekHours,
        qualifiedOvertimeCents,
        warnings,
    };
}
//# sourceMappingURL=payroll-payrun.js.map