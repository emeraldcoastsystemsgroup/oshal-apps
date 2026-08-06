"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add fail-closed AES-256-GCM helpers for package-owned data: SESSION_SECRET is mandatory and a public fallback can never become an at-rest key.
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
exports.isSessionEncryptedValue = isSessionEncryptedValue;
exports.isSessionSecretRequiredError = isSessionSecretRequiredError;
exports.encryptSessionValue = encryptSessionValue;
exports.decryptSessionValue = decryptSessionValue;
const crypto = __importStar(require("crypto"));
const SESSION_SECRET_REQUIRED = 'SESSION_SECRET_REQUIRED';
/** Derive the legacy-compatible AES key while refusing to encrypt or decrypt without real key material.
 * Fallback-key exports are intentionally not recovered here; the package README requires re-upload. */
function requiredSessionKey() {
    const secret = process.env.SESSION_SECRET;
    if (!secret || !secret.trim()) {
        const err = new Error('SESSION_SECRET is required for package data encryption; refusing to derive an at-rest key from a public fallback.');
        err.code = SESSION_SECRET_REQUIRED;
        throw err;
    }
    return crypto.createHash('sha256').update(secret).digest();
}
/**
 * @description Identify the package's legacy `iv:tag:ciphertext` envelope without attempting
 * decryption. This lets callers preserve genuinely plaintext legacy values without swallowing a
 * missing-key failure for encrypted values.
 * @param value - Candidate stored value.
 * @returns True only when the value has the three-part encrypted-envelope shape.
 */
function isSessionEncryptedValue(value) {
    return String(value).split(':').length === 3;
}
/**
 * @description Identify the typed configuration error emitted when SESSION_SECRET is absent.
 * Callers that tolerate corrupt optional cache data must still rethrow this error.
 * @param err - Unknown caught value.
 * @returns True when the error represents missing session key material.
 */
function isSessionSecretRequiredError(err) {
    return !!err && typeof err === 'object'
        && err.code === SESSION_SECRET_REQUIRED;
}
/**
 * @description Encrypt UTF-8 package data with AES-256-GCM under SHA-256(SESSION_SECRET).
 * @param plain - Plaintext package value.
 * @returns The legacy-compatible `iv:tag:ciphertext` base64 envelope.
 */
function encryptSessionValue(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', requiredSessionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}
/**
 * @description Decrypt a package `iv:tag:ciphertext` envelope with the required session key.
 * @param blob - Stored encrypted envelope.
 * @returns The authenticated UTF-8 plaintext.
 */
function decryptSessionValue(blob) {
    const key = requiredSessionKey();
    if (!isSessionEncryptedValue(blob))
        throw new Error('Invalid package encrypted-value envelope.');
    const [iv, tag, encrypted] = String(blob).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}
//# sourceMappingURL=session-crypto.js.map