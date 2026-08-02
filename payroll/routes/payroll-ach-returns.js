"use strict";
/**
 * ACH returns and Notifications of Change — reading the file the bank hands back.
 *
 * WHY THIS EXISTS. Generating an ACH file is optimistic: it says who SHOULD be
 * paid. Two to five banking days later the RDFI may hand back a return (R01
 * insufficient funds, R02 account closed, R03 no account) or a correction
 * (NOC/COR — "this account number is wrong, here is the right one"). Before
 * this module a payment row was written `pending` and nothing ever moved it, so
 * a failed deposit was INDISTINGUISHABLE from a successful one. An employee
 * simply did not get paid and the system said everything was fine.
 *
 * WE ONLY EVER PARSE. oshal never originates a return, a dishonour or a
 * reversal — those are RDFI/ODFI actions. That asymmetry is deliberate and it
 * is also the safe direction: a misread field surfaces as garbage we can detect
 * and refuse, not as a malformed file someone's bank executes.
 *
 * PROVENANCE, stated plainly because it is weaker than the rest of this app.
 * The Nacha Operating Rules are paywalled and were NOT read. Every position
 * range below is reconstructed from sources that independently agree:
 *   - The Payments Institute / NEACH deck (Nacha Direct Member education),
 *     which reproduces the Nacha record tables including addenda 98 and 99.
 *   - moov-io/ach `addenda99.go` and `addenda98.go` — a working open-source
 *     parser whose character offsets were compared field-for-field.
 *   - A real bank-produced return file (NJ Judiciary Exhibit K).
 *   - Commerce Bank and Optim ACH Solutions 2026 return/NOC code guides.
 * Where a claim has ONE witness it is marked in the code. Published worked
 * examples from those decks are deliberately NOT used as fixtures — the
 * transcriptions are 92–93 characters, not 94, so a test built on them would
 * assert a record a conforming parser rejects.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-02 01:45:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — parse a return/NOC file into typed events, the R-code catalogue with Nacha timeframes and the stop-initiating rule (which deliberately excludes R01), and NOC corrected-data decoding for every live change code including the C03-vs-C07 geometry collision that silently mangles an account number by three bytes.
 *
 * @module payroll-ach-returns
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REINITIATION_WINDOW_DAYS = exports.MAX_REINITIATIONS = exports.RETURN_CODES = void 0;
exports.mustStopFutureEntries = mustStopFutureEntries;
exports.parseAchReturnFile = parseAchReturnFile;
exports.outcomeFor = outcomeFor;
const R = (code, title, timeframe, category, stopFutureEntries, reinitiable, action) => ({ code, title, timeframe, category, stopFutureEntries, reinitiable, action });
const TWO_DAYS = '2 banking days';
const SIXTY_DAYS = '60 calendar days';
const NEXT_FILE = 'next file delivery time following processing';
const FIX_ACCOUNT = 'Get corrected bank details from the employee, update their account, and pay them again.';
const PAY_ANOTHER_WAY = 'This account cannot be used again. Pay by check or a new account.';
/**
 * Return reason codes.
 *
 * The `stopFutureEntries` column is the one with legal weight: for the
 * two-banking-day family the rule is "with the exception of R01, you must stop
 * initiating the Entries", and the 60-calendar-day family is stop-always.
 */
exports.RETURN_CODES = Object.freeze(Object.fromEntries([
    R('R01', 'Insufficient Funds', TWO_DAYS, 'funding', false, true, 'The employer account was short. Fund it and reinitiate — at most twice after the return.'),
    R('R02', 'Account Closed', TWO_DAYS, 'account-data', true, false, PAY_ANOTHER_WAY),
    R('R03', 'No Account / Unable to Locate Account', TWO_DAYS, 'account-data', true, false, FIX_ACCOUNT),
    R('R04', 'Invalid Account Number Structure', TWO_DAYS, 'account-data', true, false, FIX_ACCOUNT),
    R('R05', 'Unauthorized Debit to Consumer Account Using Corporate SEC Code', SIXTY_DAYS, 'authorization', true, false, 'Not expected on payroll credits — check the entry was originated as PPD.'),
    R('R06', "Returned per ODFI's Request", 'determined by the ODFI and RDFI', 'other', false, false, 'Your own bank asked for this back. Ask them why.'),
    R('R07', 'Authorization Revoked by Customer', SIXTY_DAYS, 'authorization', true, false, PAY_ANOTHER_WAY),
    R('R08', 'Payment Stopped', TWO_DAYS, 'authorization', true, false, 'The receiver stopped it. Do not re-send; resolve with the employee first.'),
    R('R09', 'Uncollected Funds', TWO_DAYS, 'funding', false, true, 'Funds were on deposit but uncollected. Reinitiate — at most twice after the return.'),
    R('R10', 'Customer Advises Originator Not Known and/or Not Authorized', SIXTY_DAYS, 'authorization', true, false, PAY_ANOTHER_WAY),
    R('R11', 'Customer Advises Entry Not in Accordance with the Terms of the Authorization', SIXTY_DAYS, 'authorization', true, false, 'Resolve the dispute, then originate a corrected entry.'),
    R('R12', 'Account Sold to Another DFI', TWO_DAYS, 'account-data', true, false, "Get the new institution's routing and account number from the employee."),
    R('R13', 'Invalid ACH Routing Number', NEXT_FILE, 'account-data', true, false, FIX_ACCOUNT),
    R('R14', 'Representative Payee Deceased or Unable to Continue in that Capacity', TWO_DAYS, 'deceased', true, false, 'Stop payments to this account and handle as a deceased-employee final payment.'),
    R('R15', 'Beneficiary or Account Holder Deceased', TWO_DAYS, 'deceased', true, false, 'Stop payments to this account and handle as a deceased-employee final payment.'),
    R('R16', 'Account Frozen / Entry Returned per OFAC Instruction', TWO_DAYS, 'other', true, false, 'Legal or sanctions action on the account. Do not re-send; seek advice.'),
    R('R17', 'File Record Edit Criteria / Entry Initiated Under Questionable Circumstances', TWO_DAYS, 'format', true, false, 'The RDFI could not process the entry, or flagged it. Check the addenda information for QUESTIONABLE.'),
    R('R18', 'Improper Effective Entry Date', NEXT_FILE, 'format', false, true, 'The effective entry date fell outside the permitted window. Re-send with a valid date.'),
    R('R19', 'Amount Field Error', NEXT_FILE, 'format', false, true, 'Correct the amount and re-send.'),
    R('R20', 'Non-Transaction Account', TWO_DAYS, 'account-data', true, false, 'The account cannot receive ACH entries (e.g. a savings-only or escrow account).'),
    R('R21', 'Invalid Company Identification', TWO_DAYS, 'format', false, true, 'Your ACH company identification does not match what the bank has on file. Fix it in settings.'),
    R('R22', 'Invalid Individual ID Number', TWO_DAYS, 'format', false, true, 'Correct the individual identification number.'),
    R('R23', 'Credit Entry Refused by Receiver', 'by opening of business on the 2nd banking day after the refusal notice', 'authorization', false, false, 'The employee refused the credit. Ask them why before re-sending.'),
    R('R24', 'Duplicate Entry', TWO_DAYS, 'format', false, false, 'The bank saw this entry twice. Confirm you did not upload the same file twice.'),
    R('R25', 'Addenda Error', NEXT_FILE, 'format', false, true, 'Correct the addenda record and re-send.'),
    R('R26', 'Mandatory Field Error', NEXT_FILE, 'format', false, true, 'A required field was blank or invalid. Re-send.'),
    R('R27', 'Trace Number Error', NEXT_FILE, 'format', false, true, 'Trace numbers must be unique and ascending.'),
    R('R28', 'Routing Number Check Digit Error', NEXT_FILE, 'account-data', true, false, FIX_ACCOUNT),
    R('R29', 'Corporate Customer Advises Not Authorized', TWO_DAYS, 'authorization', true, false, PAY_ANOTHER_WAY),
    R('R30', 'RDFI Not Participant in Check Truncation Program', NEXT_FILE, 'other', false, false, 'Not applicable to payroll credits.'),
    R('R31', 'Permissible Return Entry (CCD and CTX only)', 'determined by the ODFI and RDFI', 'other', false, false, 'Agreed between the banks. Confirm with your bank.'),
    R('R32', 'RDFI Non-Settlement', NEXT_FILE, 'other', false, true, "The receiving bank did not settle. Your bank will re-present."),
    R('R33', 'Return of XCK Entry', SIXTY_DAYS, 'other', false, false, 'Not applicable to payroll credits.'),
    R('R34', 'Limited Participation DFI', NEXT_FILE, 'other', true, false, 'The receiving bank has limited ACH participation.'),
    R('R35', 'Return of Improper Debit Entry', NEXT_FILE, 'format', false, false, 'A debit was sent where only credits are permitted. Payroll batches must be credits only.'),
    R('R36', 'Return of Improper Credit Entry', NEXT_FILE, 'format', false, false, 'A credit was sent where only debits are permitted.'),
    R('R37', 'Source Document Presented for Payment', SIXTY_DAYS, 'other', true, false, 'Not applicable to payroll credits.'),
    R('R38', 'Stop Payment on Source Document', SIXTY_DAYS, 'other', false, false, 'Not applicable to payroll credits.'),
    R('R39', 'Improper Source Document', TWO_DAYS, 'other', false, false, 'Not applicable to payroll credits.'),
].map((c) => [c.code, c])));
/** Codes on which the Originator must stop sending to that account. */
function mustStopFutureEntries(code) {
    return exports.RETURN_CODES[String(code).toUpperCase()]?.stopFutureEntries === true;
}
/**
 * Reinitiation limit: an entry returned R01/R09 may be re-presented at most
 * TWICE after the return (three presentments in total), within 180 days of the
 * original settlement, in a batch whose company entry description is RETRY PYMT.
 */
exports.MAX_REINITIATIONS = 2;
exports.REINITIATION_WINDOW_DAYS = 180;
/**
 * The corrected-data geometry per change code, as offsets WITHIN the 29-byte
 * corrected-data field (1-indexed, inclusive).
 *
 * The collision worth knowing about: C01, C02, C03 and C07 all write into this
 * same field with different geometry. C03 puts the routing number at 1–9 then
 * leaves 10–12 BLANK before the account at 13–29, while C07 packs the account
 * contiguously at 10–26. A parser that reads "routing then account" without
 * branching mangles every C03 account number by three bytes — silently, into
 * something that looks like a plausible account number.
 */
const CHANGE_CODES = Object.freeze({
    C01: { title: 'Incorrect DFI Account Number', account: [1, 17], autoApplicable: true, note: '' },
    C02: { title: 'Incorrect Routing Number', routing: [1, 9], autoApplicable: true, note: '' },
    C03: {
        title: 'Incorrect Routing Number and Incorrect DFI Account Number',
        routing: [1, 9], account: [13, 29], autoApplicable: true,
        note: 'Positions 10-12 are deliberately blank — the account starts at 13, not 10.',
    },
    C04: {
        title: 'Incorrect Individual Name / Receiving Company Name (RETIRED)',
        autoApplicable: false,
        note: 'C04 has not been available for use since 20 March 2015. Treat its arrival as a bank '
            + 'error and confirm with them rather than applying a name change.',
    },
    C05: { title: 'Incorrect Transaction Code', tranCode: [1, 2], autoApplicable: true, note: '' },
    C06: {
        title: 'Incorrect DFI Account Number and Incorrect Transaction Code',
        account: [1, 17], tranCode: [21, 22], autoApplicable: true,
        note: 'Positions 18-20 are blank. This geometry has a single witness in the retrieved sources — '
            + 'check the decoded values before applying.',
    },
    C07: {
        title: 'Incorrect Routing Number, Incorrect DFI Account Number and Incorrect Transaction Code',
        routing: [1, 9], account: [10, 26], tranCode: [27, 28], autoApplicable: true,
        note: 'Packed contiguously — unlike C03, there is no blank gap.',
    },
    C08: {
        title: 'Incorrect Receiving DFI Identification (IAT only)',
        autoApplicable: false,
        note: 'C08 carries 34 characters of corrected data, which does not fit the 29-byte field of a '
            + 'domestic COR. oshal originates only domestic PPD payroll, so this should never arrive; '
            + 'it is surfaced rather than decoded.',
    },
    C09: { title: 'Incorrect Individual Identification Number', individualId: [1, 22], autoApplicable: false,
        note: 'Identification only — no banking detail changes, so nothing is auto-applied.' },
    C13: {
        title: 'Addenda Format Error', autoApplicable: false,
        note: 'The entry posted; the addenda record accompanying it was misformatted. Nothing to change '
            + 'on the employee — fix the file we send.',
    },
    C14: {
        title: 'Incorrect SEC Code for Outbound International Payment', autoApplicable: false,
        note: 'Future entries to this receiver must be originated as IAT with OFAC information. oshal '
            + 'originates domestic PPD only, so this employee cannot be paid by ACH here. Single-sourced '
            + 'in the retrieved material.',
    },
});
/** Trim a fixed-width slice; NACHA pads alphanumerics with blanks. */
function field(record, from, to) {
    return record.slice(from - 1, to).trim();
}
/** Decode the 29-byte corrected-data field according to the change code. */
function decodeCorrection(changeCode, corrected) {
    const spec = CHANGE_CODES[changeCode];
    if (!spec)
        return null;
    const at = (range) => (range ? corrected.slice(range[0] - 1, range[1]).trim() : undefined);
    return {
        changeCode,
        title: spec.title,
        routingNumber: at(spec.routing) || undefined,
        accountNumber: at(spec.account) || undefined,
        transactionCode: at(spec.tranCode) || undefined,
        individualId: at(spec.individualId) || undefined,
        autoApplicable: spec.autoApplicable,
        note: spec.note,
    };
}
const RECORD_LEN = 94;
/**
 * @description Parse a NACHA return / notification-of-change file.
 *
 * The file is an ordinary NACHA file; what makes it a return file is the
 * addenda. Each `7` record whose addenda type code is 99 is a return, and 98 is
 * a notification of change. The `6` entry-detail record immediately preceding
 * it carries the amount and account, so the two are read as a pair.
 *
 * Tolerant on purpose: an unrecognised record type, a short line or an unknown
 * reason code is reported rather than thrown, because the alternative is an
 * operator who cannot see that four of their people were not paid.
 * @param content - The raw file.
 * @returns Every event found, with structural problems listed separately.
 */
function parseAchReturnFile(content) {
    const problems = [];
    const lines = String(content || '')
        .split(/\r\n|\r|\n/)
        .filter((l) => l.trim().length > 0 && !/^9{94}$/.test(l));
    if (!lines.length)
        problems.push('The file is empty.');
    const events = [];
    let lastDetail = null;
    lines.forEach((raw, i) => {
        const line = raw.padEnd(RECORD_LEN, ' ');
        if (raw.length !== RECORD_LEN && raw.trim().length > 0) {
            problems.push(`Record ${i + 1} is ${raw.length} characters; NACHA records are exactly ${RECORD_LEN}.`);
        }
        const type = line.slice(0, 1);
        if (type === '6') {
            lastDetail = line;
            return;
        }
        if (type !== '7')
            return;
        const addendaType = line.slice(1, 3);
        if (addendaType !== '99' && addendaType !== '98')
            return;
        const kind = addendaType === '99' ? 'return' : 'noc';
        const eventProblems = [];
        if (!lastDetail) {
            eventProblems.push('No entry-detail record precedes this addenda, so the amount and account are unknown.');
        }
        const detail = lastDetail || ''.padEnd(RECORD_LEN, ' ');
        const code = field(line, 4, 6).toUpperCase();
        const event = {
            kind,
            code,
            originalTrace: field(line, 7, 21),
            originalDfi: field(line, 28, 35),
            returnTrace: field(line, 80, 94),
            amountCents: Number(detail.slice(29, 39).replace(/\D/g, '') || 0),
            routingNumber: detail.slice(3, 12).trim(),
            accountNumber: field(detail, 13, 29),
            individualId: field(detail, 40, 54),
            individualName: field(detail, 55, 76),
            dateOfDeath: kind === 'return' ? field(line, 22, 27) : '',
            addendaInformation: kind === 'return' ? field(line, 36, 79) : '',
            problems: eventProblems,
        };
        if (kind === 'return') {
            event.reason = exports.RETURN_CODES[code];
            if (!event.reason) {
                eventProblems.push(`Unrecognised return reason code ${code}. Ask your bank what it means before acting.`);
            }
        }
        else {
            const correction = decodeCorrection(code, line.slice(35, 64));
            if (correction)
                event.correction = correction;
            else
                eventProblems.push(`Unrecognised change code ${code}. Do not apply it blind.`);
        }
        events.push(event);
        lastDetail = null;
    });
    const returns = events.filter((e) => e.kind === 'return');
    return {
        events,
        returnCount: returns.length,
        nocCount: events.length - returns.length,
        totalReturnedCents: returns.reduce((a, e) => a + e.amountCents, 0),
        problems,
        valid: problems.length === 0 && events.length > 0,
    };
}
/**
 * @description Translate a parsed event into what it does to a payment row.
 *
 * A RETURN means the employee did not get the money — the payment goes to
 * `returned` and the run must surface them as unpaid. An NOC is the opposite:
 * the payment SUCCEEDED, and the bank is telling us to fix the details before
 * next time. Treating an NOC as a failure is a common and expensive mistake.
 * @param event - A parsed return or NOC.
 * @returns The status transition and its consequences.
 */
function outcomeFor(event) {
    if (event.kind === 'noc') {
        return {
            status: 'corrected',
            unpaid: false,
            stopFutureEntries: false,
            reinitiable: false,
            summary: `${event.code} — ${event.correction?.title || 'notification of change'}. `
                + 'This payment SUCCEEDED; correct the details before the next run.',
        };
    }
    const reason = event.reason;
    return {
        status: 'returned',
        unpaid: true,
        stopFutureEntries: reason ? reason.stopFutureEntries : true,
        reinitiable: reason ? reason.reinitiable : false,
        summary: `${event.code} — ${reason?.title || 'unrecognised return reason'}. `
            + (reason?.action || 'Ask your bank what this code means before paying again.'),
    };
}
//# sourceMappingURL=payroll-ach-returns.js.map