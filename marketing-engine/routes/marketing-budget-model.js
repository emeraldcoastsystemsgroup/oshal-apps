"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.8 P2 pure budget and
 *     channel-allocation model (zero I/O, integer cents throughout): parses and validates
 *     channel_allocation ledger proposals (JSON allocations map, fromChannel/toChannel/deltaCents
 *     transfer, single channel object, or "channel:cents" pairs), applies proposals cleanly onto
 *     channel allocation maps with exact integer-cent totals, builds POST /api/finance/projects
 *     hand-off payloads from campaigns, derives reallocation inputs from recorded channel spend
 *     and conversions, and computes integer-cent finance project rollups.
 *
 * @module marketing-budget-model
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeChannelKey = normalizeChannelKey;
exports.usdToCents = usdToCents;
exports.centsToUsd = centsToUsd;
exports.normalizeChannelAllocations = normalizeChannelAllocations;
exports.parseChannelAllocationProposal = parseChannelAllocationProposal;
exports.applyChannelAllocationMap = applyChannelAllocationMap;
exports.channelDisplayName = channelDisplayName;
exports.buildBudgetProjectPayload = buildBudgetProjectPayload;
exports.buildChannelPerformanceInputs = buildChannelPerformanceInputs;
exports.summarizeLinkedFinanceRows = summarizeLinkedFinanceRows;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const UINT_STRING_RE = /^\d+$/;
const MAX_CHANNELS = 24;
const CHANNEL_LABELS = {
    email: 'Email',
    linkedin: 'LinkedIn',
    mastodon: 'Mastodon',
    bluesky: 'Bluesky',
    general: 'General',
};
/** Parse a strict non-negative safe integer cent amount (rejects floats, negatives, NaN). */
function parseNonNegativeCents(raw) {
    if (typeof raw === 'number') {
        return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
    }
    if (typeof raw === 'string' && UINT_STRING_RE.test(raw.trim())) {
        const n = Number(raw.trim());
        return Number.isSafeInteger(n) && n >= 0 ? n : null;
    }
    return null;
}
/** Validate and normalize a channel key into lowercase slug form. */
function normalizeChannelKey(raw) {
    if (typeof raw !== 'string')
        return null;
    const key = raw.trim().toLowerCase();
    return CHANNEL_KEY_RE.test(key) ? key : null;
}
/** Convert a non-negative USD number/string to integer cents, or null when invalid. */
function usdToCents(raw) {
    if (raw === undefined || raw === null || raw === '')
        return 0;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n) || n < 0)
        return null;
    const cents = Math.round(n * 100);
    return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}
/** Convert integer cents to a clean 2-decimal USD number for campaign storage. */
function centsToUsd(cents) {
    if (!Number.isSafeInteger(cents) || cents < 0) {
        throw new Error('Expected non-negative safe integer cents.');
    }
    return Number((cents / 100).toFixed(2));
}
/** Normalize a stored JSONB channel_allocations record into clean integer-cent entries. */
function normalizeChannelAllocations(raw) {
    const out = {};
    let obj = raw;
    if (typeof raw === 'string') {
        try {
            obj = JSON.parse(raw);
        }
        catch {
            return out;
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj))
        return out;
    for (const [k, v] of Object.entries(obj)) {
        const channel = normalizeChannelKey(k);
        const cents = parseNonNegativeCents(v);
        if (channel && cents !== null)
            out[channel] = cents;
    }
    return out;
}
/** Parse a map of { channel: nonNegativeIntegerCents }. */
function parseAllocationRecord(obj, rationale) {
    const entries = Object.entries(obj);
    if (entries.length === 0 || entries.length > MAX_CHANNELS) {
        return {
            ok: false,
            error: 'invalid_channel_allocation',
            message: `allocations must contain between 1 and ${MAX_CHANNELS} channel entries.`,
        };
    }
    const allocations = {};
    for (const [rawKey, rawVal] of entries) {
        const key = normalizeChannelKey(rawKey);
        if (!key) {
            return { ok: false, error: 'invalid_channel_allocation', message: `Invalid channel name: ${rawKey}` };
        }
        const cents = parseNonNegativeCents(rawVal);
        if (cents === null) {
            return {
                ok: false,
                error: 'invalid_channel_allocation',
                message: `Allocation for ${key} must be a non-negative integer cent amount.`,
            };
        }
        allocations[key] = cents;
    }
    return { ok: true, value: { kind: 'map', allocations, ...(rationale ? { rationale } : {}) } };
}
/** Parse a structured JSON object proposal (allocations map, transfer, single channel, or plain map). */
function parseAllocationObject(obj) {
    const rationale = typeof obj.rationale === 'string' && obj.rationale.trim()
        ? obj.rationale.trim().slice(0, 500)
        : undefined;
    const nestedMap = obj.allocations ?? obj.channelAllocations;
    if (nestedMap !== undefined) {
        if (!nestedMap || typeof nestedMap !== 'object' || Array.isArray(nestedMap)) {
            return { ok: false, error: 'invalid_channel_allocation', message: 'allocations must be a JSON object.' };
        }
        return parseAllocationRecord(nestedMap, rationale);
    }
    if ('fromChannel' in obj || 'toChannel' in obj || 'deltaCents' in obj) {
        const fromChannel = normalizeChannelKey(obj.fromChannel);
        const toChannel = normalizeChannelKey(obj.toChannel);
        const deltaCents = parseNonNegativeCents(obj.deltaCents);
        if (!fromChannel || !toChannel || fromChannel === toChannel || deltaCents === null || deltaCents <= 0) {
            return {
                ok: false,
                error: 'invalid_channel_allocation',
                message: 'Transfer requires distinct fromChannel, toChannel, and positive integer deltaCents.',
            };
        }
        return { ok: true, value: { kind: 'transfer', fromChannel, toChannel, deltaCents, ...(rationale ? { rationale } : {}) } };
    }
    if ('channel' in obj) {
        const ch = normalizeChannelKey(obj.channel);
        const cents = parseNonNegativeCents(obj.cents ?? obj.budgetCents ?? obj.allocationCents);
        if (!ch || cents === null) {
            return { ok: false, error: 'invalid_channel_allocation', message: 'Single-channel proposal requires valid channel and non-negative integer cents.' };
        }
        return { ok: true, value: { kind: 'map', allocations: { [ch]: cents }, ...(rationale ? { rationale } : {}) } };
    }
    return parseAllocationRecord(obj, rationale);
}
/** Parse "channel:cents" or comma-separated "email:40000,linkedin:60000" text format. */
function parseColonAllocationString(raw) {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0 || parts.length > MAX_CHANNELS) {
        return { ok: false, error: 'invalid_channel_allocation', message: 'Provide at least one channel:cents allocation.' };
    }
    const allocations = {};
    for (const part of parts) {
        const idx = part.indexOf(':');
        if (idx <= 0 || idx !== part.lastIndexOf(':')) {
            return { ok: false, error: 'invalid_channel_allocation', message: `Malformed allocation pair: ${part}` };
        }
        const ch = normalizeChannelKey(part.slice(0, idx));
        const cents = parseNonNegativeCents(part.slice(idx + 1).trim());
        if (!ch || cents === null) {
            return { ok: false, error: 'invalid_channel_allocation', message: `Invalid channel or cent value in: ${part}` };
        }
        allocations[ch] = cents;
    }
    return { ok: true, value: { kind: 'map', allocations } };
}
/**
 * @description Parse and validate a `channel_allocation` budget-ledger proposal from JSON object,
 * JSON string (`{ allocations }`, `{ fromChannel, toChannel, deltaCents }`, `{ channel, cents }`),
 * or `"channel:cents"` text. Strictly rejects floats, negatives, and malformed payloads.
 */
function parseChannelAllocationProposal(newValue) {
    if (newValue && typeof newValue === 'object' && !Array.isArray(newValue)) {
        return parseAllocationObject(newValue);
    }
    if (typeof newValue !== 'string' || newValue.trim() === '') {
        return { ok: false, error: 'invalid_channel_allocation', message: 'channel_allocation value is required.' };
    }
    const trimmed = newValue.trim();
    if (trimmed.startsWith('{')) {
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        }
        catch {
            return { ok: false, error: 'invalid_channel_allocation', message: 'channel_allocation JSON could not be parsed.' };
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { ok: false, error: 'invalid_channel_allocation', message: 'channel_allocation JSON must be an object.' };
        }
        return parseAllocationObject(parsed);
    }
    return parseColonAllocationString(trimmed);
}
/** Sum integer-cent map values with safe-integer overflow protection. */
function sumAllocationsCents(map) {
    let total = 0;
    for (const cents of Object.values(map)) {
        total += cents;
        if (!Number.isSafeInteger(total))
            throw new Error('Total allocation cents exceeded safe integer bounds.');
    }
    return total;
}
/**
 * @description Apply a validated channel_allocation proposal deterministically onto a campaign's
 * current channel allocation map using integer-cent arithmetic (zero floats).
 */
function applyChannelAllocationMap(currentAllocations, proposal) {
    const parsed = (proposal && typeof proposal === 'object' && ('kind' in proposal)
        && (proposal.kind === 'map'
            || proposal.kind === 'transfer'))
        ? { ok: true, value: proposal }
        : parseChannelAllocationProposal(proposal);
    if (!parsed.ok)
        return parsed;
    const next = normalizeChannelAllocations(currentAllocations);
    const changed = new Set();
    const p = parsed.value;
    if (p.kind === 'transfer') {
        const donorCurrent = next[p.fromChannel] ?? 0;
        if (donorCurrent < p.deltaCents) {
            return {
                ok: false,
                error: 'insufficient_channel_allocation',
                message: `Cannot shift ${p.deltaCents} cents from ${p.fromChannel} (current allocation ${donorCurrent} cents).`,
            };
        }
        const recipientNext = (next[p.toChannel] ?? 0) + p.deltaCents;
        if (!Number.isSafeInteger(recipientNext)) {
            return { ok: false, error: 'invalid_channel_allocation', message: 'Resulting channel allocation exceeds integer bounds.' };
        }
        next[p.fromChannel] = donorCurrent - p.deltaCents;
        next[p.toChannel] = recipientNext;
        changed.add(p.fromChannel);
        changed.add(p.toChannel);
    }
    else {
        for (const [ch, cents] of Object.entries(p.allocations)) {
            next[ch] = cents;
            changed.add(ch);
        }
    }
    const totalBudgetCents = sumAllocationsCents(next);
    return {
        ok: true,
        value: {
            allocations: next,
            totalBudgetCents,
            budgetMonthlyUsd: centsToUsd(totalBudgetCents),
            changedChannels: [...changed].sort(),
        },
    };
}
/** Display label for a channel key when seeding finance project lines. */
function channelDisplayName(channel) {
    return CHANNEL_LABELS[channel] || (channel.charAt(0).toUpperCase() + channel.slice(1));
}
/** Split an integer cent total across channels evenly, placing any remainder on the first channel. */
function splitCentsAcrossChannels(totalCents, channels) {
    const base = Math.floor(totalCents / channels.length);
    const rem = totalCents - base * channels.length;
    return channels.map((ch, idx) => ({
        name: `${channelDisplayName(ch)} budget`,
        channel: ch,
        budgetCents: base + (idx === 0 ? rem : 0),
        committedCents: 0,
        notes: '',
    }));
}
/**
 * @description Build the exact POST /api/finance/projects payload for a campaign, using integer
 * cents throughout and seeding initial allocation lines from channel_allocations or channels.
 */
function buildBudgetProjectPayload(campaign) {
    const campaignId = typeof campaign?.campaign_id === 'string' ? campaign.campaign_id.trim() : '';
    if (!UUID_RE.test(campaignId)) {
        return { ok: false, error: 'invalid_campaign_id', message: 'Campaign must have a valid campaign_id UUID.' };
    }
    const rawName = typeof campaign.name === 'string' ? campaign.name.trim() : '';
    if (!rawName) {
        return { ok: false, error: 'invalid_campaign_name', message: 'Campaign must have a non-empty name.' };
    }
    const slug = typeof campaign.slug === 'string' && campaign.slug.trim() ? campaign.slug.trim() : campaignId;
    const allocations = normalizeChannelAllocations(campaign.channel_allocations);
    const allocEntries = Object.entries(allocations).sort(([a], [b]) => a.localeCompare(b));
    const usdCents = usdToCents(campaign.budget_monthly_usd) ?? 0;
    let lines = [];
    let budgetCents = usdCents;
    if (allocEntries.length > 0) {
        lines = allocEntries.map(([ch, cents]) => ({
            name: `${channelDisplayName(ch)} budget`,
            channel: ch,
            budgetCents: cents,
            committedCents: 0,
            notes: '',
        }));
        const allocSum = sumAllocationsCents(allocations);
        budgetCents = allocSum > 0 ? allocSum : usdCents;
    }
    else {
        const rawChannels = Array.isArray(campaign.channels) ? campaign.channels : [];
        const validChannels = [...new Set(rawChannels.map(normalizeChannelKey).filter((c) => Boolean(c)))];
        if (validChannels.length > 0) {
            lines = splitCentsAcrossChannels(usdCents, validChannels);
        }
        else if (usdCents > 0) {
            lines = [{ name: 'Campaign budget', channel: 'general', budgetCents: usdCents, committedCents: 0, notes: '' }];
        }
    }
    return {
        ok: true,
        value: {
            name: rawName.slice(0, 120),
            currency: 'USD',
            budgetCents,
            externalRef: `marketing:campaign:${campaignId}`,
            notes: `Campaign budget linked from Marketing Engine (${slug}).`,
            lines,
        },
    };
}
/**
 * @description Build ChannelPerformance inputs for reallocationProposals() from a campaign's
 * current channel allocations plus recorded channel spend (cents) and conversion counts.
 */
function buildChannelPerformanceInputs(opts) {
    const allocations = normalizeChannelAllocations(opts.campaign.channel_allocations);
    const rawChannels = Array.isArray(opts.campaign.channels) ? opts.campaign.channels : [];
    const validChannels = [...new Set(rawChannels.map(normalizeChannelKey).filter((c) => Boolean(c)))];
    const usdCents = usdToCents(opts.campaign.budget_monthly_usd) ?? 0;
    if (Object.keys(allocations).length === 0 && validChannels.length > 0 && usdCents > 0) {
        for (const line of splitCentsAcrossChannels(usdCents, validChannels)) {
            allocations[line.channel] = line.budgetCents;
        }
    }
    const names = new Set([
        ...Object.keys(allocations),
        ...Object.keys(opts.spendCentsByChannel),
        ...Object.keys(opts.conversionsByChannel),
    ]);
    const out = [];
    for (const ch of [...names].sort()) {
        const key = normalizeChannelKey(ch);
        if (!key)
            continue;
        const spendCents = parseNonNegativeCents(opts.spendCentsByChannel[ch] ?? 0) ?? 0;
        const conv = Number(opts.conversionsByChannel[ch] ?? 0);
        const allocCents = allocations[key] ?? spendCents;
        out.push({
            channel: key,
            spendUsd: centsToUsd(spendCents),
            conversions: Number.isFinite(conv) && conv >= 0 ? conv : 0,
            allocationUsd: centsToUsd(allocCents),
        });
    }
    return out;
}
/** Summarize an owner-scoped finance project row set using exact integer-cent arithmetic. */
function summarizeLinkedFinanceRows(projectRow, lineRows, actualRows) {
    const bySource = { manual: 0, plaid: 0, ads: 0, sms: 0, email: 0, invoice: 0 };
    const lineActuals = new Map();
    for (const l of lineRows)
        lineActuals.set(String(l.line_id), { actualCents: 0, actualCount: 0 });
    let totalActualCents = 0;
    for (const a of actualRows) {
        const amt = parseNonNegativeCents(a.amount_cents) ?? 0;
        totalActualCents += amt;
        const src = String(a.source || 'manual');
        if (src in bySource)
            bySource[src] += amt;
        const bucket = a.line_id ? lineActuals.get(String(a.line_id)) : undefined;
        if (bucket) {
            bucket.actualCents += amt;
            bucket.actualCount += 1;
        }
    }
    let allocatedCents = 0;
    let totalCommittedCents = 0;
    const lines = lineRows.map((l) => {
        const budgetCents = parseNonNegativeCents(l.budget_cents) ?? 0;
        const committedCents = parseNonNegativeCents(l.committed_cents) ?? 0;
        const bucket = lineActuals.get(String(l.line_id)) || { actualCents: 0, actualCount: 0 };
        allocatedCents += budgetCents;
        totalCommittedCents += committedCents;
        return {
            lineId: String(l.line_id),
            name: String(l.name || ''),
            channel: String(l.channel || 'general'),
            budgetCents,
            committedCents,
            actualCents: bucket.actualCents,
            varianceCents: budgetCents - bucket.actualCents,
            remainingAfterCommittedCents: budgetCents - committedCents - bucket.actualCents,
            overBudget: bucket.actualCents > budgetCents,
            actualCount: bucket.actualCount,
        };
    });
    const projectBudgetCents = parseNonNegativeCents(projectRow.budget_cents) ?? 0;
    const totalBudgetCents = allocatedCents > 0 ? allocatedCents : projectBudgetCents;
    return {
        project: {
            projectId: String(projectRow.project_id),
            slug: String(projectRow.slug || ''),
            name: String(projectRow.name || ''),
            currency: String(projectRow.currency || 'USD'),
            status: String(projectRow.status || 'active'),
            budgetCents: projectBudgetCents,
            externalRef: projectRow.external_ref ? String(projectRow.external_ref) : null,
        },
        projectBudgetCents,
        allocatedCents,
        totalBudgetCents,
        totalCommittedCents,
        totalActualCents,
        totalVarianceCents: totalBudgetCents - totalActualCents,
        remainingAfterCommittedCents: totalBudgetCents - totalCommittedCents - totalActualCents,
        overBudget: totalActualCents > totalBudgetCents,
        lineCount: lines.length,
        actualCount: actualRows.length,
        bySource,
        lines,
    };
}
