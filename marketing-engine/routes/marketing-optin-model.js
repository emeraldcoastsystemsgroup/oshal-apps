"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Pure double opt-in sign-up domain model for
 *     marketing-engine 0.6.3 (zero DB, zero network, node:crypto only): form normalization and
 *     patch validation, deterministic bounded sliding-window per-IP and per-form rate limiter,
 *     HMAC-SHA256 signed single-use expirable confirmation token minting and constant-time
 *     verification, honeypot detection and UTM capture, generic acknowledgement responses, and
 *     self-contained static-site HTML/JS embed snippet builder.
 *
 * @module marketing-optin-model
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
exports.SlidingWindowRateLimiter = exports.DEFAULT_TOKEN_TTL_MINUTES = exports.DEFAULT_RATE_LIMIT_FORM_HOUR = exports.DEFAULT_RATE_LIMIT_IP_HOUR = exports.DEFAULT_HONEYPOT_FIELD = exports.GENERIC_ACK_MESSAGE = exports.OPTIN_UTM_KEYS = exports.HONEYPOT_FIELD_RE = exports.FORM_SLUG_RE = void 0;
exports.normalizeSignupForm = normalizeSignupForm;
exports.normalizeSignupFormPatch = normalizeSignupFormPatch;
exports.sanitizeSignupFormRow = sanitizeSignupFormRow;
exports.deriveSigningKey = deriveSigningKey;
exports.hashConfirmationToken = hashConfirmationToken;
exports.mintConfirmationToken = mintConfirmationToken;
exports.decodeConfirmationTokenUnverified = decodeConfirmationTokenUnverified;
exports.verifyConfirmationToken = verifyConfirmationToken;
exports.extractSubmissionUtm = extractSubmissionUtm;
exports.parseSignupSubmission = parseSignupSubmission;
exports.buildGenericAckResponse = buildGenericAckResponse;
exports.buildConfirmationUrl = buildConfirmationUrl;
exports.buildEmbedSnippet = buildEmbedSnippet;
const crypto = __importStar(require("crypto"));
const marketing_audience_model_1 = require("./marketing-audience-model");
const marketing_templates_1 = require("./marketing-templates");
/** @description Valid sign-up form slug pattern (2..63 lowercase alphanumeric + hyphens). */
exports.FORM_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
/** @description Valid honeypot field name pattern. */
exports.HONEYPOT_FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_-]{1,40}$/;
/** @description Base64url token segment pattern. */
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
/** @description Canonical UUID shape for form list ids and token ids. */
const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** @description Reserved submission field names that a honeypot field may not collide with. */
const RESERVED_FIELDS = new Set([
    'email', 'displayname', 'display_name', 'name', 'consent', 'utm',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'returnpreviewlink', 'includetesttoken', 'token',
]);
/** @description Sanitized UTM parameter keys captured on sign-up submission. */
exports.OPTIN_UTM_KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
];
/** @description Generic acknowledgement returned on every accepted submission (never leaks account state). */
exports.GENERIC_ACK_MESSAGE = 'Thank you. If eligible, check your inbox to confirm your subscription.';
/** @description Default sign-up form parameters. */
exports.DEFAULT_HONEYPOT_FIELD = 'company_website';
exports.DEFAULT_RATE_LIMIT_IP_HOUR = 10;
exports.DEFAULT_RATE_LIMIT_FORM_HOUR = 200;
exports.DEFAULT_TOKEN_TTL_MINUTES = 1440;
/** Trim a string input and bound its length. */
function trimBound(raw, max) {
    if (typeof raw !== 'string')
        return '';
    return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, max);
}
/** Parse a bounded integer within [min, max], returning fallback when omitted or null when invalid. */
function parseBoundedInt(raw, min, max, fallback) {
    if (raw === undefined || raw === null || raw === '')
        return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max)
        return null;
    return n;
}
/** Validate an optional list UUID (empty/null -> null). */
function parseOptionalListId(raw) {
    if (raw === undefined || raw === null || raw === '')
        return { ok: true, value: null };
    if (typeof raw !== 'string')
        return { ok: false };
    const s = raw.trim();
    if (!s)
        return { ok: true, value: null };
    return UUID_SHAPE_RE.test(s) ? { ok: true, value: s } : { ok: false };
}
/** Validate a honeypot field identifier and ensure it does not collide with reserved fields. */
function parseHoneypotField(raw) {
    if (raw === undefined || raw === null || raw === '')
        return exports.DEFAULT_HONEYPOT_FIELD;
    if (typeof raw !== 'string')
        return null;
    const s = raw.trim();
    if (!exports.HONEYPOT_FIELD_RE.test(s) || RESERVED_FIELDS.has(s.toLowerCase()))
        return null;
    return s;
}
/** Validate optional http(s) confirmation base URL (empty -> ''). */
function parseConfirmationBaseUrl(raw) {
    if (raw === undefined || raw === null || raw === '')
        return { ok: true, value: '' };
    if (typeof raw !== 'string')
        return { ok: false };
    const trimmed = raw.trim();
    if (!trimmed)
        return { ok: true, value: '' };
    const safe = (0, marketing_templates_1.safeHttpUrl)(trimmed);
    return safe ? { ok: true, value: safe } : { ok: false };
}
/** Validate numeric rate limits, token TTL, and confirmation URL shared by create and patch. */
function validateFormLimitsAndUrls(src) {
    const ipCap = parseBoundedInt(src.rateLimitPerIpPerHour ?? src.rate_limit_per_ip_hour, 1, 1000, exports.DEFAULT_RATE_LIMIT_IP_HOUR);
    if (ipCap === null)
        return { ok: false, error: 'invalid_rate_limit_ip', message: 'Per-IP hourly limit must be an integer between 1 and 1000.' };
    const formCap = parseBoundedInt(src.rateLimitPerFormPerHour ?? src.rate_limit_per_form_hour, 1, 10000, exports.DEFAULT_RATE_LIMIT_FORM_HOUR);
    if (formCap === null)
        return { ok: false, error: 'invalid_rate_limit_form', message: 'Per-form hourly limit must be an integer between 1 and 10000.' };
    const ttl = parseBoundedInt(src.tokenTtlMinutes ?? src.token_ttl_minutes, 5, 10080, exports.DEFAULT_TOKEN_TTL_MINUTES);
    if (ttl === null)
        return { ok: false, error: 'invalid_token_ttl', message: 'Token TTL must be an integer between 5 and 10080 minutes.' };
    const urlCheck = parseConfirmationBaseUrl(src.confirmationBaseUrl ?? src.confirmation_base_url);
    if (!urlCheck.ok)
        return { ok: false, error: 'invalid_confirmation_base_url', message: 'Confirmation base URL must start with https:// or http://.' };
    return { ok: true, rateLimitPerIpPerHour: ipCap, rateLimitPerFormPerHour: formCap, tokenTtlMinutes: ttl, confirmationBaseUrl: urlCheck.value };
}
/**
 * @description Validate and normalize a new double opt-in sign-up form payload.
 * @param raw - Untrusted form creation payload.
 * @returns NormalizedSignupForm or a coded validation error.
 */
function normalizeSignupForm(raw) {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
    const name = trimBound(src.name, 120);
    if (!name)
        return { ok: false, error: 'invalid_form_name', message: 'Form name is required (1–120 characters).' };
    const slugCandidate = src.slug !== undefined
        ? trimBound(src.slug, 64).toLowerCase()
        : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
    if (!exports.FORM_SLUG_RE.test(slugCandidate)) {
        return { ok: false, error: 'invalid_form_slug', message: 'Form slug must be 2–63 lowercase letters, digits, or hyphens.' };
    }
    const consentText = trimBound(src.consentText ?? src.consent_text, 4000);
    if (!consentText)
        return { ok: false, error: 'consent_text_required', message: 'Explicit consent disclosure text is required.' };
    const listCheck = parseOptionalListId(src.listId ?? src.list_id);
    if (!listCheck.ok)
        return { ok: false, error: 'invalid_list_id', message: 'Target list ID must be a valid UUID.' };
    const honeypotField = parseHoneypotField(src.honeypotField ?? src.honeypot_field);
    if (!honeypotField)
        return { ok: false, error: 'invalid_honeypot_field', message: 'Honeypot field must be a valid non-reserved identifier.' };
    const limits = validateFormLimitsAndUrls(src);
    if (!limits.ok)
        return limits;
    if (src.enabled !== undefined && typeof src.enabled !== 'boolean') {
        return { ok: false, error: 'invalid_enabled_flag', message: 'Enabled flag must be a boolean.' };
    }
    return {
        ok: true,
        form: {
            slug: slugCandidate,
            name,
            consentText,
            listId: listCheck.value,
            honeypotField,
            rateLimitPerIpPerHour: limits.rateLimitPerIpPerHour,
            rateLimitPerFormPerHour: limits.rateLimitPerFormPerHour,
            tokenTtlMinutes: limits.tokenTtlMinutes,
            confirmationBaseUrl: limits.confirmationBaseUrl,
            enabled: src.enabled === undefined ? true : src.enabled,
        },
    };
}
/** Validate optional limit/url/boolean fields for PATCH /audience/signup-forms/:slug. */
function applyPatchLimits(src, patch) {
    if ('rateLimitPerIpPerHour' in src || 'rate_limit_per_ip_hour' in src) {
        const v = parseBoundedInt(src.rateLimitPerIpPerHour ?? src.rate_limit_per_ip_hour, 1, 1000, -1);
        if (v === null || v < 1)
            return { ok: false, error: 'invalid_rate_limit_ip', message: 'Per-IP hourly limit must be 1–1000.' };
        patch.rateLimitPerIpPerHour = v;
    }
    if ('rateLimitPerFormPerHour' in src || 'rate_limit_per_form_hour' in src) {
        const v = parseBoundedInt(src.rateLimitPerFormPerHour ?? src.rate_limit_per_form_hour, 1, 10000, -1);
        if (v === null || v < 1)
            return { ok: false, error: 'invalid_rate_limit_form', message: 'Per-form hourly limit must be 1–10000.' };
        patch.rateLimitPerFormPerHour = v;
    }
    if ('tokenTtlMinutes' in src || 'token_ttl_minutes' in src) {
        const v = parseBoundedInt(src.tokenTtlMinutes ?? src.token_ttl_minutes, 5, 10080, -1);
        if (v === null || v < 5)
            return { ok: false, error: 'invalid_token_ttl', message: 'Token TTL must be 5–10080 minutes.' };
        patch.tokenTtlMinutes = v;
    }
    if ('confirmationBaseUrl' in src || 'confirmation_base_url' in src) {
        const u = parseConfirmationBaseUrl(src.confirmationBaseUrl ?? src.confirmation_base_url);
        if (!u.ok)
            return { ok: false, error: 'invalid_confirmation_base_url', message: 'Confirmation base URL must start with https:// or http://.' };
        patch.confirmationBaseUrl = u.value;
    }
    if ('enabled' in src) {
        if (typeof src.enabled !== 'boolean')
            return { ok: false, error: 'invalid_enabled_flag', message: 'Enabled flag must be a boolean.' };
        patch.enabled = src.enabled;
    }
    return { ok: true };
}
/**
 * @description Validate partial updates to an existing sign-up form.
 * @param raw - Untrusted patch payload.
 * @returns Normalized patch fields or a coded validation error.
 */
function normalizeSignupFormPatch(raw) {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
    const patch = {};
    if ('name' in src) {
        const name = trimBound(src.name, 120);
        if (!name)
            return { ok: false, error: 'invalid_form_name', message: 'Form name is required (1–120 characters).' };
        patch.name = name;
    }
    if ('consentText' in src || 'consent_text' in src) {
        const text = trimBound(src.consentText ?? src.consent_text, 4000);
        if (!text)
            return { ok: false, error: 'consent_text_required', message: 'Explicit consent disclosure text is required.' };
        patch.consentText = text;
    }
    if ('listId' in src || 'list_id' in src) {
        const listCheck = parseOptionalListId(src.listId ?? src.list_id);
        if (!listCheck.ok)
            return { ok: false, error: 'invalid_list_id', message: 'Target list ID must be a valid UUID.' };
        patch.listId = listCheck.value;
    }
    if ('honeypotField' in src || 'honeypot_field' in src) {
        const hp = parseHoneypotField(src.honeypotField ?? src.honeypot_field);
        if (!hp)
            return { ok: false, error: 'invalid_honeypot_field', message: 'Honeypot field must be a valid non-reserved identifier.' };
        patch.honeypotField = hp;
    }
    const lim = applyPatchLimits(src, patch);
    if (!lim.ok)
        return lim;
    if (Object.keys(patch).length === 0)
        return { ok: false, error: 'no_fields_to_update', message: 'Provide at least one updatable field.' };
    return { ok: true, patch };
}
/**
 * @description Project a sign-up form database row for API responses, strictly omitting signing_secret.
 * @param row - Database row from oshal_marketing_signup_forms.
 * @returns Sanitized form object without secrets.
 */
function sanitizeSignupFormRow(row) {
    return {
        form_id: row.form_id,
        slug: row.slug,
        name: row.name,
        consent_text: row.consent_text,
        consentText: row.consent_text,
        list_id: row.list_id ?? null,
        listId: row.list_id ?? null,
        honeypot_field: row.honeypot_field ?? exports.DEFAULT_HONEYPOT_FIELD,
        honeypotField: row.honeypot_field ?? exports.DEFAULT_HONEYPOT_FIELD,
        rate_limit_per_ip_hour: Number(row.rate_limit_per_ip_hour ?? exports.DEFAULT_RATE_LIMIT_IP_HOUR),
        rateLimitPerIpPerHour: Number(row.rate_limit_per_ip_hour ?? exports.DEFAULT_RATE_LIMIT_IP_HOUR),
        rate_limit_per_form_hour: Number(row.rate_limit_per_form_hour ?? exports.DEFAULT_RATE_LIMIT_FORM_HOUR),
        rateLimitPerFormPerHour: Number(row.rate_limit_per_form_hour ?? exports.DEFAULT_RATE_LIMIT_FORM_HOUR),
        token_ttl_minutes: Number(row.token_ttl_minutes ?? exports.DEFAULT_TOKEN_TTL_MINUTES),
        tokenTtlMinutes: Number(row.token_ttl_minutes ?? exports.DEFAULT_TOKEN_TTL_MINUTES),
        confirmation_base_url: row.confirmation_base_url ?? '',
        confirmationBaseUrl: row.confirmation_base_url ?? '',
        enabled: Boolean(row.enabled),
        pending_count: Number(row.pending_count ?? 0),
        confirmed_count: Number(row.confirmed_count ?? 0),
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
    };
}
/**
 * @description Deterministic, bounded sliding-window rate limiter enforcing both per-IP and
 * per-form hourly caps with an injectable clock.
 */
class SlidingWindowRateLimiter {
    windowMs;
    maxEntries;
    ipBuckets = new Map();
    formBuckets = new Map();
    constructor(opts = {}) {
        this.windowMs = Math.max(1000, Number(opts.windowMs ?? 3600_000));
        this.maxEntries = Math.max(64, Number(opts.maxEntries ?? 10_000));
    }
    /** Prune timestamps outside the sliding window for one bucket map. */
    readWindow(map, key, nowMs) {
        const cutoff = nowMs - this.windowMs;
        const hits = map.get(key);
        if (!hits || hits.length === 0)
            return [];
        const active = hits.filter((ts) => ts > cutoff);
        if (active.length === 0)
            map.delete(key);
        else if (active.length !== hits.length)
            map.set(key, active);
        return active;
    }
    /** Record a hit while keeping bucket maps bounded so memory never grows unboundedly. */
    recordHit(map, key, active, nowMs) {
        active.push(nowMs);
        map.delete(key);
        map.set(key, active);
        while (map.size > this.maxEntries) {
            const oldest = map.keys().next().value;
            if (oldest === undefined)
                break;
            map.delete(oldest);
        }
    }
    /** Check both per-IP and per-form limits and consume one slot if both allow. */
    checkAndConsume(params) {
        const nowMs = params.nowMs ?? Date.now();
        const ipBucketKey = `${params.formKey}\0${params.ipKey}`;
        const ipHits = this.readWindow(this.ipBuckets, ipBucketKey, nowMs);
        if (ipHits.length >= params.ipLimit) {
            const retryAfterSec = Math.max(1, Math.ceil((ipHits[0] + this.windowMs - nowMs) / 1000));
            return { allowed: false, code: 'rate_limit_ip_exceeded', retryAfterSec };
        }
        const formHits = this.readWindow(this.formBuckets, params.formKey, nowMs);
        if (formHits.length >= params.formLimit) {
            const retryAfterSec = Math.max(1, Math.ceil((formHits[0] + this.windowMs - nowMs) / 1000));
            return { allowed: false, code: 'rate_limit_form_exceeded', retryAfterSec };
        }
        this.recordHit(this.ipBuckets, ipBucketKey, ipHits, nowMs);
        this.recordHit(this.formBuckets, params.formKey, formHits, nowMs);
        return {
            allowed: true,
            ipRemaining: Math.max(0, params.ipLimit - ipHits.length),
            formRemaining: Math.max(0, params.formLimit - formHits.length),
        };
    }
    /** Clear all tracked buckets (for isolated test suites). */
    reset() {
        this.ipBuckets.clear();
        this.formBuckets.clear();
    }
}
exports.SlidingWindowRateLimiter = SlidingWindowRateLimiter;
/**
 * @description Derive a domain-separated HMAC-SHA256 signing key scoped to one owner and form secret.
 * @param ownerSub - Owner OIDC subject.
 * @param formSecretHex - Per-form random hex secret.
 * @returns 32-byte derived signing key.
 */
function deriveSigningKey(ownerSub, formSecretHex) {
    const owner = String(ownerSub || '').trim();
    const secret = String(formSecretHex || '').trim();
    if (!owner || secret.length < 32) {
        throw new Error('invalid_signing_key_inputs');
    }
    return crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(`double-optin-v1:${owner}`, 'utf8').digest();
}
/**
 * @description Compute the canonical lowercase SHA-256 hex digest of a raw confirmation token.
 * @param token - Raw confirmation token string.
 * @returns 64-character lowercase hex digest.
 */
function hashConfirmationToken(token) {
    return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}
/**
 * @description Mint a signed, single-use, expirable confirmation token and its SHA-256 hash.
 * @param input - Token claims (tokenId, ownerSub, formSlug, contactId, consentId, emailHash, expiresAtMs).
 * @param formSecretHex - Per-form random hex secret.
 * @returns Raw token (never stored in DB), its SHA-256 tokenHash, and ISO expiry timestamp.
 */
function mintConfirmationToken(input, formSecretHex) {
    const payload = { v: 1, ...input };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const key = deriveSigningKey(payload.ownerSub, formSecretHex);
    const sigB64 = crypto.createHmac('sha256', key).update(payloadB64, 'utf8').digest('base64url');
    const token = `${payloadB64}.${sigB64}`;
    return {
        token,
        tokenHash: hashConfirmationToken(token),
        expiresAt: new Date(payload.expiresAtMs).toISOString(),
    };
}
/** Validate the structural shape of a decoded confirmation token payload. */
function isValidTokenPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return false;
    const p = raw;
    return p.v === 1
        && typeof p.tokenId === 'string' && UUID_SHAPE_RE.test(p.tokenId)
        && typeof p.ownerSub === 'string' && p.ownerSub.trim().length > 0
        && typeof p.formSlug === 'string' && exports.FORM_SLUG_RE.test(p.formSlug)
        && typeof p.contactId === 'string' && UUID_SHAPE_RE.test(p.contactId)
        && typeof p.consentId === 'string' && UUID_SHAPE_RE.test(p.consentId)
        && typeof p.emailHash === 'string' && /^[0-9a-f]{64}$/.test(p.emailHash)
        && typeof p.expiresAtMs === 'number' && Number.isFinite(p.expiresAtMs);
}
/**
 * @description Parse a confirmation token's payload without trusting its signature (used only to
 * locate the owner's form secret before constant-time verification).
 * @param token - Candidate token string.
 * @returns Validated payload shape or null when malformed.
 */
function decodeConfirmationTokenUnverified(token) {
    if (typeof token !== 'string' || token.length < 10 || token.length > 2048)
        return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !BASE64URL_RE.test(parts[0]) || !BASE64URL_RE.test(parts[1]))
        return null;
    try {
        const parsed = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        return isValidTokenPayload(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
/**
 * @description Verify a confirmation token's HMAC-SHA256 signature (constant-time) and expiry.
 * @param token - Candidate token string.
 * @param formSecretHex - Per-form random hex secret.
 * @param nowMs - Current epoch milliseconds (injectable for tests).
 * @returns Verified payload and tokenHash, or fail-closed token_forged / token_expired.
 */
function verifyConfirmationToken(token, formSecretHex, nowMs = Date.now()) {
    const payload = decodeConfirmationTokenUnverified(token);
    if (!payload || typeof token !== 'string')
        return { ok: false, error: 'token_forged' };
    const [payloadB64, sigB64] = token.split('.');
    let key;
    try {
        key = deriveSigningKey(payload.ownerSub, formSecretHex);
    }
    catch {
        return { ok: false, error: 'token_forged' };
    }
    const expected = crypto.createHmac('sha256', key).update(payloadB64, 'utf8').digest();
    const actual = Buffer.from(sigB64, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
        return { ok: false, error: 'token_forged' };
    }
    if (nowMs >= payload.expiresAtMs) {
        return { ok: false, error: 'token_expired', payload };
    }
    return { ok: true, payload, tokenHash: hashConfirmationToken(token) };
}
/** Extract sanitized UTM parameters (bounded 120 chars each) from top-level fields or nested utm object. */
function extractSubmissionUtm(body) {
    const nested = body.utm && typeof body.utm === 'object' && !Array.isArray(body.utm)
        ? body.utm
        : {};
    const out = {};
    for (const key of exports.OPTIN_UTM_KEYS) {
        const shortKey = key.slice(4);
        const candidate = body[key] ?? nested[key] ?? nested[shortKey];
        const clean = trimBound(candidate, 120);
        if (clean)
            out[key] = clean;
    }
    return out;
}
/**
 * @description Parse a sign-up submission: inspect honeypot first, validate email, and extract UTM fields.
 * @param rawBody - Untrusted HTTP request body.
 * @param form - Form configuration carrying honeypotField.
 * @returns Parsed submission status (honeypotTriggered short-circuits all DB writes).
 */
function parseSignupSubmission(rawBody, form) {
    const body = (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
        ? rawBody : {});
    const hpField = String(form.honeypotField ?? form.honeypot_field ?? exports.DEFAULT_HONEYPOT_FIELD);
    const hpRaw = body[hpField];
    const honeypotTriggered = typeof hpRaw === 'string'
        ? hpRaw.trim().length > 0
        : hpRaw !== undefined && hpRaw !== null && hpRaw !== false && hpRaw !== '';
    if (honeypotTriggered) {
        return { ok: true, honeypotTriggered: true, displayName: '', utm: {}, returnPreviewLink: false };
    }
    const email = (0, marketing_audience_model_1.normalizeEmail)(body.email);
    if (!email) {
        return { ok: false, error: 'invalid_email', honeypotTriggered: false, displayName: '', utm: {}, returnPreviewLink: false };
    }
    const displayName = trimBound(body.displayName ?? body.display_name ?? body.name, 200);
    const utm = extractSubmissionUtm(body);
    const returnPreviewLink = body.returnPreviewLink === true || body.includeTestToken === true;
    return {
        ok: true,
        honeypotTriggered: false,
        email,
        emailHash: (0, marketing_audience_model_1.hashAddress)(email),
        displayName,
        utm,
        returnPreviewLink,
    };
}
/**
 * @description Build the generic acknowledgement-only submission response (never leaks contact or suppression state).
 * @returns Generic acknowledgement payload.
 */
function buildGenericAckResponse() {
    return { ok: true, accepted: true, message: exports.GENERIC_ACK_MESSAGE };
}
/**
 * @description Build the confirmation URL from the form's confirmationBaseUrl or default API confirm path.
 * @param confirmationBaseUrl - Optional http(s) base URL configured on the form.
 * @param token - Signed single-use confirmation token.
 * @returns Confirmation URL with token query parameter.
 */
function buildConfirmationUrl(confirmationBaseUrl, token) {
    const safe = (0, marketing_templates_1.safeHttpUrl)(confirmationBaseUrl);
    if (safe) {
        const parsed = new URL(safe);
        parsed.searchParams.set('token', token);
        return parsed.toString();
    }
    return `/api/marketing/audience/opt-in/confirm?token=${encodeURIComponent(token)}`;
}
/** Normalize the endpoint base URL used in embeddable static-site snippets. */
function normalizeEndpointBase(raw) {
    const trimmed = String(raw || '').trim().replace(/\/+$/, '');
    if (!trimmed)
        return '/api/marketing';
    if (trimmed.startsWith('/'))
        return trimmed;
    const safe = (0, marketing_templates_1.safeHttpUrl)(trimmed);
    return safe ? safe.replace(/\/+$/, '') : '/api/marketing';
}
/**
 * @description Generate a self-contained static-site HTML + vanilla JS embed snippet for a sign-up form.
 * Includes the hidden honeypot field, explicit consent disclosure, UTM query capture, and an
 * acknowledgement-only status banner with zero external dependencies and full HTML escaping.
 * @param form - Sign-up form configuration.
 * @param endpointBaseUrl - Optional base URL for the marketing API (defaults to /api/marketing).
 * @returns Snippet metadata and self-contained HTML string.
 */
function buildEmbedSnippet(form, endpointBaseUrl) {
    const base = normalizeEndpointBase(endpointBaseUrl);
    const slugEnc = encodeURIComponent(form.slug);
    const submitEndpoint = `${base}/audience/signup-forms/${slugEnc}/submit`;
    const confirmationEndpoint = (0, marketing_templates_1.safeHttpUrl)(form.confirmationBaseUrl ?? form.confirmation_base_url) || `${base}/audience/opt-in/confirm`;
    const hpName = String(form.honeypotField ?? form.honeypot_field ?? exports.DEFAULT_HONEYPOT_FIELD);
    const consentText = String(form.consentText ?? form.consent_text ?? '');
    const formId = `open-swarm-optin-${form.slug.replace(/[^a-z0-9-]/gi, '')}`;
    const html = [
        `<form id="${(0, marketing_templates_1.escapeHtml)(formId)}" class="open-swarm-optin" action="${(0, marketing_templates_1.escapeHtml)(submitEndpoint)}" method="post" novalidate>`,
        `  <h3>${(0, marketing_templates_1.escapeHtml)(form.name)}</h3>`,
        `  <p><label>Email <input type="email" name="email" required autocomplete="email" /></label></p>`,
        `  <p><label>Name (optional) <input type="text" name="displayName" autocomplete="name" /></label></p>`,
        `  <div style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;" aria-hidden="true">`,
        `    <label>Leave blank <input type="text" name="${(0, marketing_templates_1.escapeHtml)(hpName)}" tabindex="-1" autocomplete="off" /></label>`,
        `  </div>`,
        `  <p><label><input type="checkbox" name="consentAccepted" required /> ${(0, marketing_templates_1.escapeHtml)(consentText)}</label></p>`,
        `  <button type="submit">Subscribe</button>`,
        `  <p data-optin-status role="status" aria-live="polite"></p>`,
        `</form>`,
        `<script>`,
        `(function(){`,
        `  var f=document.getElementById(${JSON.stringify(formId)}); if(!f) return;`,
        `  var st=f.querySelector('[data-optin-status]');`,
        `  var qs=new URLSearchParams(window.location.search);`,
        `  var utmKeys=['utm_source','utm_medium','utm_campaign','utm_term','utm_content'];`,
        `  f.addEventListener('submit',function(ev){`,
        `    ev.preventDefault();`,
        `    if(!f.elements.consentAccepted.checked){ st.textContent='Please confirm consent before subscribing.'; return; }`,
        `    var body={ email:f.elements.email.value.trim(), displayName:f.elements.displayName.value.trim() };`,
        `    body[${JSON.stringify(hpName)}]=f.elements[${JSON.stringify(hpName)}].value;`,
        `    utmKeys.forEach(function(k){ var v=qs.get(k); if(v) body[k]=v.slice(0,120); });`,
        `    fetch(${JSON.stringify(submitEndpoint)},{ method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'}, body:JSON.stringify(body) })`,
        `      .then(function(r){ return r.json().catch(function(){ return {}; }); })`,
        `      .then(function(j){ st.textContent=j.message||${JSON.stringify(exports.GENERIC_ACK_MESSAGE)}; f.reset(); })`,
        `      .catch(function(){ st.textContent='Unable to submit right now. Please try again.'; });`,
        `  });`,
        `})();`,
        `</script>`,
    ].join('\n');
    return { slug: form.slug, submitEndpoint, confirmationEndpoint, html };
}
