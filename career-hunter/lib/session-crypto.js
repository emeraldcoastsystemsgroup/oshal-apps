/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add fail-closed AES-256-GCM helpers for the packaged CLI: SESSION_SECRET is mandatory and a public fallback can never become an at-rest key.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Structurally recognize legacy AES-GCM envelopes, reject kernel v2 connector envelopes as a typed unsupported format, and never mistake ciphertext for plaintext.
 */

'use strict';
const crypto = require('crypto');

const SESSION_SECRET_REQUIRED = 'SESSION_SECRET_REQUIRED';
const SESSION_SECRET_INVALID_ENVELOPE = 'SESSION_SECRET_INVALID_ENVELOPE';
const SESSION_SECRET_UNSUPPORTED_ENVELOPE = 'SESSION_SECRET_UNSUPPORTED_ENVELOPE';

/** Build a typed crypto-boundary error without including any stored credential material. */
function sessionCryptoError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Derive the legacy-compatible AES key while refusing to decrypt without real key material.
 * Fallback-key credentials are intentionally not recovered here; the package README requires reconnect. */
function requiredSessionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !secret.trim()) {
    throw sessionCryptoError(
      SESSION_SECRET_REQUIRED,
      'SESSION_SECRET is required for package data encryption; refusing to derive an at-rest key from a public fallback.',
    );
  }
  return crypto.createHash('sha256').update(secret).digest();
}

/** True only for canonical base64 emitted by this package, optionally at an exact byte length. */
function isCanonicalBase64(value, expectedBytes) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value
    && (expectedBytes === undefined || decoded.length === expectedBytes);
}

/** Identify an unversioned legacy AES-256-GCM `iv:tag:ciphertext` envelope structurally. */
function isLegacySessionEncryptedValue(value) {
  const parts = String(value).split(':');
  return parts.length === 3
    && isCanonicalBase64(parts[0], 12)
    && isCanonicalBase64(parts[1], 16)
    && parts[2].length > 0
    && isCanonicalBase64(parts[2]);
}

/**
 * @description Identify encrypted connector values without attempting decryption. Legacy
 * `iv:tag:ciphertext` values are validated structurally; a `v2:` prefix is always classified as
 * encrypted so the package can reject the kernel-owned DEK format instead of forwarding it as a
 * provider token. Genuinely plaintext legacy values, including colon-containing values, remain
 * compatible.
 * @param {string} value Candidate stored value.
 * @returns {boolean} True for a valid legacy envelope or any kernel v2 envelope.
 */
function isSessionEncryptedValue(value) {
  const stored = String(value);
  return stored.startsWith('v2:') || isLegacySessionEncryptedValue(stored);
}

/**
 * @description Encrypt UTF-8 package data with AES-256-GCM under SHA-256(SESSION_SECRET).
 * Kept beside decrypt so the CLI's crypto seam has a real credential-free round-trip guard.
 * @param {string} plain Plaintext package value.
 * @returns {string} The legacy-compatible `iv:tag:ciphertext` base64 envelope.
 */
function encryptSessionValue(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', requiredSessionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

/**
 * @description Decrypt a package `iv:tag:ciphertext` envelope with the required session key.
 * @param {string} blob Stored encrypted envelope.
 * @returns {string} The authenticated UTF-8 plaintext.
 */
function decryptSessionValue(blob) {
  const stored = String(blob);
  if (stored.startsWith('v2:')) {
    throw sessionCryptoError(
      SESSION_SECRET_UNSUPPORTED_ENVELOPE,
      'Kernel v2 connector ciphertext must be resolved by the OSHAL token broker; refusing to use it as a provider credential.',
    );
  }
  if (!isLegacySessionEncryptedValue(stored)) {
    throw sessionCryptoError(SESSION_SECRET_INVALID_ENVELOPE, 'Invalid package encrypted-value envelope.');
  }
  const key = requiredSessionKey();
  const [iv, tag, encrypted] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = {
  decryptSessionValue,
  encryptSessionValue,
  isSessionEncryptedValue,
};
