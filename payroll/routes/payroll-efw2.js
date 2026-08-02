"use strict";
/**
 * SSA EFW2 — the electronic W-2 submission file.
 *
 * A W-2 an employer can hand to an employee is not a W-2 filed with the Social
 * Security Administration. This builds the machine-readable file that is, in
 * the fixed-position EFW2 format: 512-byte records, RA (submitter) → RE
 * (employer) → RW (one per employee) → RT (totals) → RF (final).
 *
 * THE LAYOUT IS VERSIONED BY TAX YEAR, AND UNVERIFIED YEARS ARE REFUSED.
 * SSA republishes Publication 42-007 annually. The TY2025 edition was retrieved
 * in full and its fields machine-verified to tile positions 1–512 with no gap
 * or overlap. TY2026 could NOT be retrieved — ssa.gov returns HTTP 403 to
 * automated fetches — and it is known to differ: TY2026 introduces Box 12 codes
 * TT (qualified overtime compensation) and TP (cash tips), which this engine
 * already computes and which have no field anywhere in the TY2025 layout.
 *
 * Guessing where those two amounts belong would produce a file the SSA rejects
 * wholesale, or worse, one it accepts with two money fields silently dropped.
 * So `buildEfw2` refuses a tax year whose layout has not been read, and names
 * the document required to unblock it. Adding TY2026 is one table plus a
 * citation — the same shape the state withholding tables use.
 *
 * THE ORDERING TRAP. The RT total fields are NOT in the same order as the RW
 * money fields they sum: RW runs …Q, C, V, Y, AA, BB, DD, FF while RT runs …Q,
 * DD, C, sick-pay, V, Y, AA, BB, FF. A loop that walks RW fields and writes RT
 * totals in sequence swaps DD and C and mis-aligns everything after them. Both
 * tables here are keyed by NAME and the totals are summed by key, so the order
 * cannot drift; a guard asserts the two key sets match.
 *
 * SOURCE: SSA Publication No. 42-007, "Specifications for Filing Forms W-2
 * Electronically (EFW2)", Tax Year 2025 — retrieved in full (118pp).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-02 03:20:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — RA/RE/RW/RT/RF assembly at 512 fixed positions with implied-decimal money fields, the tax-year-versioned layout that refuses an unread year by naming the document, RT totals summed BY KEY so the RW/RT ordering divergence cannot mis-align them, and a reader that pulls the totals back out of the finished file the way the NACHA guards read control records.
 *
 * @module payroll-efw2
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EFW2_FIELD_MAPS = exports.EFW2_VERIFIED_TAX_YEARS = exports.EFW2_RECORD_LEN = void 0;
exports.efw2UnavailableReason = efw2UnavailableReason;
exports.buildEfw2 = buildEfw2;
exports.readEfw2Totals = readEfw2Totals;
/** Every EFW2 record is exactly this long. */
exports.EFW2_RECORD_LEN = 512;
/**
 * Tax years whose Publication 42-007 record layout has been retrieved and
 * verified field-by-field. A year absent from this list is REFUSED rather than
 * approximated from a neighbouring year.
 */
exports.EFW2_VERIFIED_TAX_YEARS = Object.freeze([2025]);
/** Why a given year is not available, in words an operator can act on. */
function efw2UnavailableReason(taxYear) {
    const base = `The EFW2 record layout for tax year ${taxYear} has not been verified against SSA `
        + `Publication 42-007 for that year, so no file will be generated. `;
    if (taxYear === 2026) {
        return `${base}Tax year 2026 specifically ADDS Box 12 codes TT (qualified overtime `
            + 'compensation) and TP (cash tips), which this payroll engine already computes and which '
            + 'have no field in the 2025 layout. Placing them at guessed positions would produce a file '
            + 'the SSA rejects, or accepts with those amounts silently dropped. Download '
            + 'https://www.ssa.gov/employer/efw/26efw2.pdf and add its layout.';
    }
    return `${base}Retrieve SSA Publication 42-007 for tax year ${taxYear} and add its layout. `
        + `Verified years: ${exports.EFW2_VERIFIED_TAX_YEARS.join(', ')}.`;
}
/**
 * RW money fields, 11 characters each, implied two decimals.
 * VERIFIED: Pub 42-007 TY2025 §5.
 */
const RW_MONEY = Object.freeze({
    wages: [188, 198],
    fit: [199, 209],
    ssWages: [210, 220],
    ssTax: [221, 231],
    medicareWages: [232, 242],
    medicareTax: [243, 253],
    ssTips: [254, 264],
    dependentCare: [276, 286],
    d401k: [287, 297],
    e403b: [298, 308],
    f408k: [309, 319],
    g457b: [320, 330],
    h501c18d: [331, 341],
    nq457: [353, 363],
    wHsa: [364, 374],
    nqNot457: [375, 385],
    qCombatPay: [386, 396],
    cGroupTermLife: [408, 418],
    vStockOptions: [419, 429],
    y409a: [430, 440],
    aaRoth401k: [441, 451],
    bbRoth403b: [452, 462],
    ddHealthCoverage: [463, 473],
    ffQsehra: [474, 484],
});
/**
 * RT total fields, 15 characters each — every one the sum of the SAME-KEYED RW
 * field across the RW records since the last RE.
 *
 * Note ddHealthCoverage precedes cGroupTermLife here and follows it in RW. That
 * inversion is real and is why these are keyed rather than ordered.
 * VERIFIED: Pub 42-007 TY2025 §8.
 */
const RT_TOTALS = Object.freeze({
    wages: [10, 24],
    fit: [25, 39],
    ssWages: [40, 54],
    ssTax: [55, 69],
    medicareWages: [70, 84],
    medicareTax: [85, 99],
    ssTips: [100, 114],
    dependentCare: [130, 144],
    d401k: [145, 159],
    e403b: [160, 174],
    f408k: [175, 189],
    g457b: [190, 204],
    h501c18d: [205, 219],
    nq457: [235, 249],
    wHsa: [250, 264],
    nqNot457: [265, 279],
    qCombatPay: [280, 294],
    ddHealthCoverage: [295, 309],
    cGroupTermLife: [310, 324],
    vStockOptions: [340, 354],
    y409a: [355, 369],
    aaRoth401k: [370, 384],
    bbRoth403b: [385, 399],
    ffQsehra: [400, 414],
});
/** The count of RW records since the last RE — not a money field. */
const RT_RECORD_COUNT = [3, 9];
/** The count of RW records on the ENTIRE file, across every RE. */
const RF_RECORD_COUNT = [8, 16];
/** Exposed so a guard can assert the two maps stay in step. */
exports.EFW2_FIELD_MAPS = Object.freeze({ RW_MONEY, RT_TOTALS, RT_RECORD_COUNT, RF_RECORD_COUNT });
/* ── record assembly ─────────────────────────────────────────────────────── */
/**
 * A 512-byte record built by writing into a blank canvas.
 *
 * Starting from spaces matters: the specification distinguishes "Blank" fields,
 * which "must be blank, not zeros", from money fields that are zero-filled. A
 * builder that concatenates in order has to remember every reserved range; one
 * that writes at positions leaves them blank by construction.
 */
class Record512 {
    buf = new Array(exports.EFW2_RECORD_LEN).fill(' ');
    constructor(identifier) {
        this.text([1, 2], identifier);
    }
    /** Left justify, blank fill, truncate — the alpha/numeric field rule. */
    text(span, value) {
        const width = span[1] - span[0] + 1;
        const s = String(value ?? '').replace(/[^\x20-\x7E]/g, ' ').slice(0, width).padEnd(width, ' ');
        for (let i = 0; i < width; i += 1)
            this.buf[span[0] - 1 + i] = s[i];
        return this;
    }
    /** Upper-case alpha — required for every field except the two e-mail fields. */
    upper(span, value) {
        return this.text(span, String(value ?? '').toUpperCase());
    }
    /** Right justify, zero fill. Money is passed in CENTS: the decimal is implied. */
    numeric(span, value) {
        const width = span[1] - span[0] + 1;
        const digits = String(value ?? '').replace(/\D/g, '').slice(-width).padStart(width, '0');
        for (let i = 0; i < width; i += 1)
            this.buf[span[0] - 1 + i] = digits[i];
        return this;
    }
    toString() {
        return this.buf.join('');
    }
}
/* ── the builder ─────────────────────────────────────────────────────────── */
/** An SSN may not begin 666 or 9; where none is available the field is zeros. */
function efw2Ssn(ssn) {
    const d = String(ssn ?? '').replace(/\D/g, '');
    if (d.length !== 9)
        return { value: '000000000', problem: 'no valid SSN on file — filed as zeros' };
    if (d.startsWith('666') || d.startsWith('9')) {
        return { value: '000000000', problem: `SSN beginning ${d.slice(0, 3)} is not valid for the SSA` };
    }
    return { value: d };
}
/**
 * @description Build an EFW2 submission file for one employer.
 *
 * @param taxYear - The tax year being filed. Refused unless its layout is verified.
 * @param submitter - Who is transmitting, and whom SSA contacts on failure.
 * @param employer - The employer whose EIN the wages were paid under.
 * @param employees - One entry per W-2.
 * @returns The file, its RT totals, and any problems. `valid` is false when
 *   anything would cause SSA to reject it — the content is still returned so an
 *   operator can see what was wrong.
 */
function buildEfw2(taxYear, submitter, employer, employees) {
    const problems = [];
    if (!exports.EFW2_VERIFIED_TAX_YEARS.includes(taxYear)) {
        return {
            content: '',
            taxYear,
            recordCount: 0,
            employeeCount: 0,
            totals: {},
            valid: false,
            problems: [efw2UnavailableReason(taxYear)],
            caveat: 'No file was generated.',
        };
    }
    if (String(submitter.userId || '').length !== 8) {
        problems.push('The BSO User ID must be exactly 8 characters — it identifies who attests to this file.');
    }
    if (!String(submitter.contactEmail || '').trim()) {
        problems.push('The submitter contact e-mail must not be blank; SSA rejects a file without one.');
    }
    for (const [label, ein] of [['submitter', submitter.ein], ['employer', employer.ein]]) {
        if (String(ein || '').replace(/\D/g, '').length !== 9)
            problems.push(`The ${label} EIN must be 9 digits.`);
    }
    if (String(employer.ein || '').replace(/\D/g, '').startsWith('00')) {
        problems.push('An employer EIN may not begin with 00.');
    }
    if (!employees.length)
        problems.push('No employees — there is nothing to file.');
    const lines = [];
    /* ── RA  submitter ─────────────────────────────────────────────────────── */
    lines.push(new Record512('RA')
        .numeric([3, 11], submitter.ein)
        .upper([12, 19], submitter.userId)
        .text([29, 29], '0') // not a resubmission
        .text([36, 37], '98') // in-house program
        .upper([38, 94], submitter.name)
        .upper([117, 138], submitter.deliveryAddress)
        .upper([139, 160], submitter.city)
        .upper([161, 162], submitter.stateCode)
        .numeric([163, 167], submitter.zip)
        .upper([217, 273], submitter.name)
        .upper([296, 317], submitter.deliveryAddress)
        .upper([318, 339], submitter.city)
        .upper([340, 341], submitter.stateCode)
        .numeric([342, 346], submitter.zip)
        .upper([396, 422], submitter.contactName)
        .text([423, 437], String(submitter.contactPhone || '').replace(/\D/g, ''))
        .text([446, 485], submitter.contactEmail) // case preserved — one of two such fields
        .upper([500, 500], submitter.preparerCode || 'L')
        .toString());
    /* ── RE  employer ──────────────────────────────────────────────────────── */
    lines.push(new Record512('RE')
        .numeric([3, 6], taxYear)
        .numeric([8, 16], employer.ein)
        .text([26, 26], employer.terminating ? '1' : '0')
        .upper([40, 96], employer.name)
        .upper([119, 140], employer.deliveryAddress)
        .upper([141, 162], employer.city)
        .upper([163, 164], employer.stateCode)
        .numeric([165, 169], employer.zip)
        .upper([174, 174], employer.kindOfEmployer || 'N')
        .upper([219, 219], employer.employmentCode || 'R')
        // Position 220 (Tax Jurisdiction Code) stays BLANK: blank means a plain
        // W-2. Any of P/V/G/S/N would move wages and withholding into the RO
        // record, and amounts in the wrong record are not forwarded to the IRS.
        .text([221, 221], '0')
        .upper([222, 248], employer.contactName)
        .text([249, 263], String(employer.contactPhone || '').replace(/\D/g, ''))
        .text([279, 318], employer.contactEmail)
        .toString());
    /* ── RW  one per employee ──────────────────────────────────────────────── */
    const totals = Object.fromEntries(Object.keys(RT_TOTALS).map((k) => [k, 0]));
    for (const e of employees) {
        const { value: ssn, problem } = efw2Ssn(e.ssn);
        if (problem)
            problems.push(`${e.lastName}, ${e.firstName}: ${problem}.`);
        const rw = new Record512('RW')
            .numeric([3, 11], ssn)
            .upper([12, 26], e.firstName)
            .upper([27, 41], e.middleName || '')
            .upper([42, 61], e.lastName)
            .upper([62, 65], e.suffix || '')
            .upper([88, 109], e.deliveryAddress || '')
            .upper([110, 131], e.city || '')
            .upper([132, 133], e.stateCode || '')
            .numeric([134, 138], e.zip || '')
            .text([486, 486], e.statutoryEmployee ? '1' : '0')
            .text([488, 488], e.retirementPlan ? '1' : '0')
            .text([489, 489], e.thirdPartySickPay ? '1' : '0');
        // Written by KEY, and totalled by the same key — the RW and RT orders
        // differ, so anything positional here would mis-align the totals.
        for (const [key, span] of Object.entries(RW_MONEY)) {
            const cents = Math.max(0, Math.trunc(Number(e.amounts[key]) || 0));
            rw.numeric(span, cents);
            if (key in totals)
                totals[key] += cents;
        }
        lines.push(rw.toString());
    }
    /* ── RT  totals for this employer ──────────────────────────────────────── */
    const rt = new Record512('RT').numeric(RT_RECORD_COUNT, employees.length);
    for (const [key, span] of Object.entries(RT_TOTALS))
        rt.numeric(span, totals[key]);
    lines.push(rt.toString());
    /* ── RF  final ─────────────────────────────────────────────────────────── */
    lines.push(new Record512('RF').numeric(RF_RECORD_COUNT, employees.length).toString());
    lines.forEach((l, i) => {
        if (l.length !== exports.EFW2_RECORD_LEN) {
            problems.push(`Record ${i + 1} is ${l.length} characters, must be exactly ${exports.EFW2_RECORD_LEN}.`);
        }
    });
    // Medicare wages must equal or exceed Social Security wages plus tips.
    if (totals.medicareWages < totals.ssWages + totals.ssTips) {
        problems.push('Total Medicare wages are less than Social Security wages plus tips, which SSA rejects. '
            + 'Check for an employee whose wages crossed the Social Security wage base.');
    }
    return {
        content: `${lines.join('\r\n')}\r\n`,
        taxYear,
        recordCount: lines.length,
        employeeCount: employees.length,
        totals,
        valid: problems.length === 0,
        problems,
        caveat: 'This file has NOT been submitted. Upload it to SSA Business Services Online, and run it '
            + 'through AccuWage Online first — AccuWage checks format, not whether the names and Social '
            + 'Security numbers match SSA records.',
    };
}
/**
 * @description Read the totals back OUT of a finished EFW2 file.
 *
 * Deliberately parses the RT record rather than trusting the builder's own
 * arithmetic, the same way the NACHA guards read the batch and file control
 * records. A builder that is wrong in the same direction twice proves nothing.
 * @param content - The file content.
 * @returns The record counts and every RT money total, keyed as RT_TOTALS is.
 */
function readEfw2Totals(content) {
    const lines = String(content || '').split(/\r\n|\r|\n/).filter((l) => l.length > 0);
    const rt = lines.find((l) => l.startsWith('RT')) || '';
    const rf = lines.find((l) => l.startsWith('RF')) || '';
    const read = (line, span) => Number(line.slice(span[0] - 1, span[1]) || 0);
    return {
        employeeCountRt: read(rt, RT_RECORD_COUNT),
        employeeCountRf: read(rf, RF_RECORD_COUNT),
        rwRecords: lines.filter((l) => l.startsWith('RW')).length,
        totals: Object.fromEntries(Object.entries(RT_TOTALS).map(([key, span]) => [key, read(rt, span)])),
    };
}
//# sourceMappingURL=payroll-efw2.js.map