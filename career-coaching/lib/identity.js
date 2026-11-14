/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | First Career Coaching identity rules (0.1.0). The caller is the kernel's verified principal on the request and the authorization port's current actor, and the two must name the same person (native id, issuer, subject, tenant); a header, query, body field, email or name never selects anyone. Only an active person takes part: a bot, a service and the installation root are refused. A coach code is twelve characters from an alphabet without look-alike letters, generated with the platform's cryptographic random source and kept by others only as a hash: it lets a seeker choose a recipient and grants the coach nothing.
 */
'use strict';
const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,255}$/;

/**
 * @description A bounded identity string from the kernel's principal, or null.
 * @param {unknown} value - Field of the verified principal.
 * @returns {string|null} The string, or null when it is not a usable identifier.
 */
function exact(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

/**
 * @description Words the kernel resolved for a person (display name or verified email), bounded for display only.
 * @param {unknown} value - req.user field.
 * @param {number} max - Longest kept length.
 * @returns {string|null} Display text or null.
 */
function shown(value, max) {
  if (typeof value !== 'string') return null;
  const words = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return words ? [...words].slice(0, max).join('') : null;
}

/**
 * @description The admitted caller, taken only from the kernel: the request's verified principal and the
 * authorization port's current actor must agree on native id, issuer, subject and tenant. Anything else answers null.
 * @param {object} ctx - Package context from the kernel bridge.
 * @param {object} req - The request the kernel admitted.
 * @returns {object|null} Frozen caller, or null when no active person is verified.
 */
function verifiedCaller(ctx, req) {
  const principal = req && req.principal;
  const actor = ctx && ctx.authorization && typeof ctx.authorization.currentActor === 'function'
    ? ctx.authorization.currentActor() : null;
  if (!principal || typeof principal !== 'object' || !actor) return null;
  const caller = {personId: exact(String(principal.id ?? '')), issuer: exact(principal.issuer),
    subject: exact(principal.subject), tenant: exact(String(principal.tenant ?? ''))};
  if (Object.values(caller).some((value) => value === null) || !ID.test(caller.personId)) return null;
  if (principal.kind !== 'person' || (principal.state !== undefined && principal.state !== 'active')) return null;
  if (actor.isActive !== true || actor.principalId !== caller.personId || actor.sub !== caller.subject
    || actor.issuer !== caller.issuer || !Array.isArray(actor.tenantIds) || !actor.tenantIds.includes(caller.tenant)) return null;
  const user = req.user && typeof req.user === 'object' ? req.user : {};
  return Object.freeze({...caller, name: shown(user.name, 80), email: user.email_verified === true ? shown(user.email, 120) : null});
}

/**
 * @description A new coach code, e.g. K7QM-4XPD-9TRA, drawn without modulo bias.
 * @returns {string} Grouped code.
 */
function newCode() {
  const chars = Array.from({length: CODE_LENGTH}, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return chars.match(/.{4}/g).join('-');
}

/**
 * @description The code a seeker typed, without spaces or dashes and in capitals, or null when it cannot be a code.
 * @param {unknown} input - Untrusted code.
 * @returns {string|null} Twelve code characters, or null.
 */
function normalizeCode(input) {
  if (typeof input !== 'string' || input.length > 40) return null;
  const chars = input.toUpperCase().replace(/[\s-]/g, '');
  return chars.length === CODE_LENGTH && [...chars].every((char) => ALPHABET.includes(char)) ? chars : null;
}

/**
 * @description The only form of a code other people's rows hold.
 * @param {string} normalized - Output of normalizeCode().
 * @returns {string} Lowercase hex SHA-256.
 */
function codeHash(normalized) {
  return crypto.createHash('sha256').update('career-coaching-code:v1:' + normalized).digest('hex');
}

module.exports = {ALPHABET, CODE_LENGTH, verifiedCaller, newCode, normalizeCode, codeHash};
