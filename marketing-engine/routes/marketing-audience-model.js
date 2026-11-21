"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Pure P1 audience store domain helpers (zero
 *     I/O, node:crypto only): email normalization and SHA-256 hashing, tag normalization,
 *     structured sign-up consent evidence normalization (formText, recordedAt, ip, userAgent,
 *     utm, tokenHash), deterministic contact segmentation (list, tag, consentState, channel,
 *     purpose, suppressed, search query), and canonical consent-export packaging.
 *
 * @module marketing-audience-model
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
exports.SHA256_HEX_RE = exports.CONTACT_STATUSES = exports.CONSENT_FILTER_STATES = exports.CONSENT_STATES = exports.AUDIENCE_CHANNELS = void 0;
exports.normalizeEmail = normalizeEmail;
exports.hashAddress = hashAddress;
exports.normalizeTags = normalizeTags;
exports.normalizeUtm = normalizeUtm;
exports.normalizeConsentEvidence = normalizeConsentEvidence;
exports.parseAudienceFilters = parseAudienceFilters;
exports.matchesSegment = matchesSegment;
exports.segmentContacts = segmentContacts;
exports.buildConsentExport = buildConsentExport;
const crypto = __importStar(require("crypto"));
/** @description Supported audience consent and suppression channels. */
exports.AUDIENCE_CHANNELS = ['email', 'sms'];
/** @description Valid recipient consent lifecycle states. */
exports.CONSENT_STATES = ['pending', 'confirmed', 'revoked'];
/** @description Valid consent filter values including contacts with no consent rows. */
exports.CONSENT_FILTER_STATES = ['pending', 'confirmed', 'revoked', 'none'];
/** @description Valid contact statuses. */
exports.CONTACT_STATUSES = ['active', 'unsubscribed', 'bounced', 'suppressed'];
/** @description Lowercase 64-character SHA-256 hex digest shape. */
exports.SHA256_HEX_RE = /^[0-9a-f]{64}$/;
/** @description Conservative email shape matching marketing-support. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * @description Normalize an email address by trimming and lowercasing; returns null when invalid.
 * @param raw - Untrusted email candidate.
 * @returns Normalized lowercase email, or null when invalid.
 */
function normalizeEmail(raw) {
    if (typeof raw !== 'string')
        return null;
    const clean = raw.trim().toLowerCase();
    if (!clean || clean.length > 320 || !EMAIL_RE.test(clean))
        return null;
    return clean;
}
/**
 * @description Compute the canonical lowercase SHA-256 hex hash of a trimmed, lowercased address.
 * @param raw - Address string (email or phone identifier).
 * @returns 64-character lowercase hex digest.
 */
function hashAddress(raw) {
    const normalized = String(raw || '').trim().toLowerCase();
    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}
/**
 * @description Normalize a tag list into unique lowercase bounded strings.
 * @param raw - Candidate tag array or comma-delimited string.
 * @returns Deduplicated array of at most 50 tags.
 */
function normalizeTags(raw) {
    const items = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
            ? raw.split(',')
            : [];
    const seen = new Set();
    const out = [];
    for (const entry of items) {
        if (typeof entry !== 'string')
            continue;
        const tag = entry.trim().toLowerCase().slice(0, 64);
        if (!tag || seen.has(tag))
            continue;
        seen.add(tag);
        out.push(tag);
        if (out.length >= 50)
            break;
    }
    return out;
}
/**
 * @description Normalize a UTM parameter map into bounded string key/value pairs.
 * @param raw - Candidate UTM object.
 * @returns Clean map of UTM keys to bounded strings.
 */
function normalizeUtm(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        const key = k.trim().toLowerCase().slice(0, 64);
        if (!key || typeof v !== 'string')
            continue;
        const val = v.trim().slice(0, 256);
        if (val)
            out[key] = val;
        if (Object.keys(out).length >= 12)
            break;
    }
    return out;
}
/**
 * @description Normalize sign-up consent evidence JSON, preserving formText, recordedAt, ip,
 * userAgent, utm, and tokenHash.
 * @param raw - Caller-provided evidence object.
 * @param fallback - Request-derived defaults for ip, userAgent, and recordedAt.
 * @returns Normalized ConsentEvidence record.
 */
function normalizeConsentEvidence(raw, fallback) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw
        : {};
    const text = (v, max) => typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null;
    const recordedCandidate = text(src.recordedAt ?? src.time, 64) ?? fallback?.recordedAt ?? new Date().toISOString();
    const recordedAt = Number.isFinite(Date.parse(recordedCandidate))
        ? new Date(Date.parse(recordedCandidate)).toISOString()
        : new Date().toISOString();
    const rawTokenHash = text(src.tokenHash ?? src.token_hash, 128);
    return {
        formText: text(src.formText ?? src.form_text, 4000) ?? '',
        recordedAt,
        ip: text(src.ip, 128) ?? text(fallback?.ip, 128),
        userAgent: text(src.userAgent ?? src.user_agent, 512) ?? text(fallback?.userAgent, 512),
        utm: normalizeUtm(src.utm),
        tokenHash: rawTokenHash ? rawTokenHash.toLowerCase() : null,
    };
}
/**
 * @description Parse and validate GET /audience/contacts segmentation query parameters.
 * @param query - Express query object.
 * @returns Validated AudienceSegmentFilters or a structured error code.
 */
function parseAudienceFilters(query) {
    const str = (k) => {
        const v = query[k];
        return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
    };
    const consentState = str('consentState') ?? str('consent_state');
    if (consentState && !exports.CONSENT_FILTER_STATES.includes(consentState)) {
        return { error: 'invalid_consent_state' };
    }
    const channel = str('channel');
    if (channel && !exports.AUDIENCE_CHANNELS.includes(channel)) {
        return { error: 'invalid_channel' };
    }
    const suppressedRaw = str('suppressed');
    let suppressed;
    if (suppressedRaw !== undefined) {
        if (suppressedRaw === 'true')
            suppressed = true;
        else if (suppressedRaw === 'false')
            suppressed = false;
        else
            return { error: 'invalid_suppressed_filter' };
    }
    const limitRaw = query.limit !== undefined ? Number(query.limit) : 200;
    const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 500 ? limitRaw : 200;
    return {
        filters: {
            list: str('list'),
            tag: str('tag')?.toLowerCase(),
            consentState: consentState,
            channel: channel,
            purpose: str('purpose')?.toLowerCase(),
            suppressed,
            q: str('q')?.toLowerCase(),
            limit,
        },
    };
}
/** Check whether a contact matches list, tag, suppression, and search criteria. */
function matchesProfileFilters(contact, filters) {
    if (filters.list) {
        const target = filters.list.toLowerCase();
        const inList = contact.lists.some((l) => String(l.list_id || '').toLowerCase() === target || String(l.slug || '').toLowerCase() === target);
        if (!inList)
            return false;
    }
    if (filters.tag && !contact.tags.map((t) => t.toLowerCase()).includes(filters.tag))
        return false;
    if (filters.suppressed !== undefined && contact.suppressed !== filters.suppressed)
        return false;
    if (filters.q) {
        const hay = `${contact.email} ${contact.display_name} ${contact.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(filters.q))
            return false;
    }
    return true;
}
/** Check whether a contact's consent history matches channel, purpose, and latest consentState. */
function matchesConsentFilters(contact, filters) {
    if (!filters.consentState && !filters.channel && !filters.purpose)
        return true;
    const relevant = contact.consents.filter((c) => {
        if (filters.channel && String(c.channel || '') !== filters.channel)
            return false;
        if (filters.purpose && String(c.purpose || '').toLowerCase() !== filters.purpose)
            return false;
        return true;
    });
    if (filters.consentState === 'none')
        return relevant.length === 0;
    if (relevant.length === 0)
        return false;
    if (!filters.consentState)
        return true;
    const latest = relevant[0];
    return String(latest?.status || '') === filters.consentState;
}
/**
 * @description Test whether one hydrated contact matches all active segmentation filters.
 * @param contact - Contact with attached consents, lists, and suppressions.
 * @param filters - Validated segmentation filters.
 * @returns True when the contact belongs to the segment.
 */
function matchesSegment(contact, filters) {
    return matchesProfileFilters(contact, filters) && matchesConsentFilters(contact, filters);
}
/**
 * @description Filter and bound a list of hydrated contacts by segmentation filters.
 * @param contacts - Owner-scoped hydrated contacts.
 * @param filters - Validated segmentation filters.
 * @returns Matching contacts up to filters.limit.
 */
function segmentContacts(contacts, filters) {
    return contacts.filter((c) => matchesSegment(c, filters)).slice(0, filters.limit);
}
/**
 * @description Build the canonical consent-evidence export bundle for a single contact.
 * @param contact - Contact row.
 * @param consents - Consent rows for the contact.
 * @param lists - List membership rows joined with list metadata.
 * @param suppressions - Suppression rows matching the contact's email_hash.
 * @param exportedAt - Optional ISO timestamp override.
 * @returns Structured export bundle preserving all recorded sign-up evidence.
 */
function buildConsentExport(contact, consents, lists, suppressions, exportedAt = new Date().toISOString()) {
    return {
        exportedAt,
        contact: {
            contact_id: contact.contact_id,
            email: contact.email,
            email_hash: contact.email_hash,
            display_name: contact.display_name ?? '',
            tags: Array.isArray(contact.tags) ? contact.tags : [],
            status: contact.status ?? 'active',
            metadata: contact.metadata && typeof contact.metadata === 'object' ? contact.metadata : {},
            created_at: contact.created_at ?? null,
            updated_at: contact.updated_at ?? null,
        },
        consents: consents.map((c) => ({
            consent_id: c.consent_id,
            channel: c.channel,
            purpose: c.purpose,
            status: c.status,
            evidence: c.evidence && typeof c.evidence === 'object' ? c.evidence : {},
            created_at: c.created_at ?? null,
            updated_at: c.updated_at ?? null,
        })),
        lists: lists.map((l) => ({
            list_id: l.list_id,
            slug: l.slug ?? null,
            name: l.name ?? null,
            added_at: l.added_at ?? null,
        })),
        suppressions: suppressions.map((s) => ({
            suppression_id: s.suppression_id,
            channel: s.channel,
            address_hash: s.address_hash,
            reason: s.reason,
            source: s.source ?? 'manual',
            created_at: s.created_at ?? null,
        })),
    };
}
