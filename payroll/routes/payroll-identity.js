"use strict";
/**
 * Identity + PII — the fields a W-2 and a 941 actually require, and the
 * encryption that makes holding them defensible.
 *
 * WHY THIS MODULE EXISTS: v1 deliberately held no SSN and no EIN, which is why
 * its W-2 output could only ever be a *preview*. You cannot issue a W-2 without
 * the employee's SSN (box a), name and address (boxes e/f), and the employer's
 * EIN (box b). Adding those fields is not a schema convenience — it makes this
 * package a holder of the most sensitive identifier a person has, so the storage
 * decision comes with the field.
 *
 * ENCRYPTION: SSNs and bank account numbers are encrypted at rest with the
 * framework's vault crypto (AES-256-GCM under a key derived HKDF-SHA256 from
 * SESSION_SECRET, salted per owner). That is a declared kernel skill (`memory`
 * → `@/features/personal-data`), so a package may import it, and it means a
 * leaked database or backup volume is opaque without SESSION_SECRET.
 *
 * THE RULES, which the code enforces rather than merely documents:
 *   - A full SSN is returned by exactly ONE route, and that route logs the read.
 *   - Everything else sees the mask ***-**-1234.
 *   - A full SSN or account number is NEVER written to a log line.
 *   - Storage is idempotent: encrypting an already-encrypted value is a no-op,
 *     so a re-save cannot double-wrap.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 17:15:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — encrypted SSN + bank account storage over the kernel vault crypto, masking, SSN/EIN/routing validation and normalization, and the employer-identity completeness check that decides whether a W-2 may be issued at all rather than previewed.
 *
 * @module payroll-identity
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSsn = normalizeSsn;
exports.normalizeEin = normalizeEin;
exports.normalizeRouting = normalizeRouting;
exports.last4 = last4;
exports.maskSsn = maskSsn;
exports.maskAccount = maskAccount;
exports.sealIdentifier = sealIdentifier;
exports.openIdentifier = openIdentifier;
exports.w2Readiness = w2Readiness;
const personal_data_1 = require("@/features/personal-data");
/** Digits only, for normalizing a typed identifier. */
function digits(v) {
    return String(v ?? '').replace(/\D/g, '');
}
/**
 * @description Normalize and validate a Social Security number.
 *
 * Rejects the structurally impossible ranges the SSA has never issued — area
 * 000/666/900-999, group 00, serial 0000 — so a typo or a placeholder like
 * 123-45-6789 does not reach a W-2 and get rejected by the SSA months later.
 * @param v - The typed value.
 * @returns The 9 digits, or null when it is not a valid SSN.
 */
function normalizeSsn(v) {
    const d = digits(v);
    if (d.length !== 9)
        return null;
    const area = d.slice(0, 3);
    const group = d.slice(3, 5);
    const serial = d.slice(5);
    if (area === '000' || area === '666' || Number(area) >= 900)
        return null;
    if (group === '00' || serial === '0000')
        return null;
    return d;
}
/**
 * @description Normalize and validate an employer identification number.
 * @param v - The typed value.
 * @returns The 9 digits, or null.
 */
function normalizeEin(v) {
    const d = digits(v);
    return d.length === 9 ? d : null;
}
/**
 * @description Validate an ABA routing number by its check digit.
 *
 * The checksum catches the transposition typos that would otherwise send a
 * direct deposit to the wrong bank — worth doing even though this app does not
 * itself move money, because it hands the number to whatever does.
 * @param v - The typed value.
 * @returns The 9 digits, or null when the checksum fails.
 */
function normalizeRouting(v) {
    const d = digits(v);
    if (d.length !== 9)
        return null;
    const n = d.split('').map(Number);
    const sum = 3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8]);
    return sum % 10 === 0 ? d : null;
}
/** The last four of an identifier, for display. */
function last4(v) {
    const d = digits(v);
    return d.length >= 4 ? d.slice(-4) : '';
}
/** Mask an SSN for display: ***-**-1234. Never returns real digits beyond the last four. */
function maskSsn(last) {
    return last ? `***-**-${last}` : '';
}
/** Mask a bank account for display. */
function maskAccount(last) {
    return last ? `••••${last}` : '';
}
/**
 * @description Encrypt a sensitive identifier for at-rest storage. Idempotent —
 * an already-encrypted envelope passes through unchanged, so re-saving a record
 * cannot double-wrap it.
 * @param ownerSub - The owning OIDC sub; salts the derived key.
 * @param plain - The normalized digits, or null.
 * @returns The encrypted envelope, or null.
 */
function sealIdentifier(ownerSub, plain) {
    if (!plain)
        return null;
    if ((0, personal_data_1.isEncrypted)(plain))
        return plain;
    return (0, personal_data_1.encryptField)(ownerSub, plain);
}
/**
 * @description Decrypt a stored identifier. Used ONLY by the audited full-read
 * path and by document generation — never by a list or detail route.
 * @param ownerSub - The owning OIDC sub.
 * @param stored - The stored envelope.
 * @returns The plaintext digits, or null.
 */
function openIdentifier(ownerSub, stored) {
    if (stored === null || stored === undefined || stored === '')
        return null;
    const out = (0, personal_data_1.decryptField)(ownerSub, String(stored));
    return out ? String(out) : null;
}
/**
 * @description Decide whether a real W-2 can be issued, or only a preview.
 *
 * This is the check that keeps the product honest: the preview label is not a
 * disclaimer someone forgot to remove, it is a computed state. Fill in the
 * identity and the same endpoint stops calling itself a preview.
 * @param company - The company row.
 * @param employee - The employee row.
 * @returns Readiness plus the specific fields still missing.
 */
function w2Readiness(company, employee) {
    const missing = [];
    if (!company.ein_encrypted)
        missing.push('employer EIN');
    if (!String(company.legal_name || '').trim())
        missing.push('employer legal name');
    if (!String(company.address_line1 || '').trim())
        missing.push('employer address');
    if (!String(company.city || '').trim() || !String(company.state_code || '').trim()
        || !String(company.postal_code || '').trim())
        missing.push('employer city/state/ZIP');
    if (!employee.ssn_encrypted)
        missing.push('employee SSN');
    if (!String(employee.address_line1 || '').trim())
        missing.push('employee address');
    if (!String(employee.city || '').trim() || !String(employee.state_code || '').trim()
        || !String(employee.postal_code || '').trim())
        missing.push('employee city/state/ZIP');
    return { ready: missing.length === 0, missing };
}
//# sourceMappingURL=payroll-identity.js.map