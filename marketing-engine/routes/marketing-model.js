"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Pure marketing-engine domain logic (zero imports,
 *     zero I/O, so node:test drives the compiled module without a framework): strict opt-in channel
 *     consent gates (absent row = OFF; only true/'t'/'true' opts in), the publish decision
 *     (consent -> pause -> daily cap, fail-closed, mirroring series-pump autoApprovalDecision),
 *     UTM builder, campaign-import sanitizer (import NEVER arms consent/budget/stage — the
 *     series-pump import rule), trailing-CPA budget reallocation proposals (<=20% envelope shift,
 *     channel floors), weekly scorecard rollup with honest per-source NO DATA marking, the ISO
 *     week-start helper, and the ICE score.
 *
 * @module marketing-model
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXPECTED_SCORECARD_SOURCES = void 0;
exports.explicitTrue = explicitTrue;
exports.isChannelEnabled = isChannelEnabled;
exports.publishDecision = publishDecision;
exports.buildUtmUrl = buildUtmUrl;
exports.sanitizeCampaignImport = sanitizeCampaignImport;
exports.reallocationProposals = reallocationProposals;
exports.scorecardRollup = scorecardRollup;
exports.weekStartOf = weekStartOf;
exports.iceScore = iceScore;
/**
 * @description Strict boolean opt-in test. ONLY `true` / `'t'` / `'true'` opt in (pg boolean and
 * raw-text driver shapes). `1`, `'yes'`, `'on'`, `'TRUE'`, `' true'` and every other value DENY —
 * the operator-directive consent contract (automation opt-in, default OFF).
 * @param v - Any candidate value from a settings row.
 * @returns True only for the three explicit opt-in shapes.
 */
function explicitTrue(v) {
    return v === true || v === 't' || v === 'true';
}
/**
 * @description Is this channel consent row an explicit opt-in? Absent/null/malformed rows are OFF;
 * only a strict explicit true on `enabled` opts in. The consent decision reads THIS row only —
 * no fallback to any other setting, ever.
 * @param row - The caller's channel authorization row, or null/undefined when absent.
 * @returns True only when the row exists and `enabled` is strictly true/'t'/'true'.
 */
function isChannelEnabled(row) {
    return !!row && typeof row === 'object' && explicitTrue(row.enabled);
}
/**
 * @description The single place the "may this channel publish right now?" question is answered,
 * mirroring series-pump autoApprovalDecision semantics: consent first, then pause, then the daily
 * cap re-checked at decision time (a concurrent publish may have taken the day's last slot after
 * the caller counted). Fail-closed throughout: absent/garbage rows deny, a cap of 0 means never,
 * and an unknown run count denies rather than guesses.
 * @param row - The caller's channel authorization row (absent/undefined = no consent).
 * @param todayCount - Ledger count of runs already recorded for this channel today.
 * @returns The decision with a ledger-outcome reason token and a human-readable detail.
 */
function publishDecision(row, todayCount) {
    if (!isChannelEnabled(row)) {
        return { allowed: false, reason: 'skipped_consent', detail: 'channel is not enabled — no explicit opt-in row' };
    }
    const pausedReason = typeof row.paused_reason === 'string' ? row.paused_reason.trim() : '';
    if (pausedReason !== '') {
        return { allowed: false, reason: 'skipped_consent', detail: `channel is paused: ${pausedReason}` };
    }
    const cap = Number(row.daily_cap);
    if (!Number.isFinite(cap) || cap <= 0) {
        return { allowed: false, reason: 'skipped_cap', detail: 'daily cap is 0 — publishing is never authorized on this channel' };
    }
    const count = Number(todayCount);
    if (!Number.isFinite(count) || count < 0) {
        return { allowed: false, reason: 'skipped_cap', detail: "today's run count is unknown — failing closed" };
    }
    if (count >= cap) {
        return { allowed: false, reason: 'skipped_cap', detail: `daily cap of ${cap} is used up (${count} recorded today)` };
    }
    return { allowed: true, reason: 'authorized', detail: `authorized (${count} of ${cap} today)` };
}
/**
 * @description Build a UTM-tagged link from an absolute http(s) URL. Existing query parameters are
 * preserved (same-named utm_* keys are replaced, not duplicated), every key/value is percent-encoded
 * (%20 form, never '+'), and the fragment survives. Anything that is not an absolute http(s) URL is
 * rejected with a throw — never silently passed through.
 * @param input - The base url plus utm source/medium/campaign and optional content.
 * @returns The tagged absolute URL string.
 */
function buildUtmUrl(input) {
    if (!input || typeof input !== 'object')
        throw new Error('buildUtmUrl requires an input object');
    for (const key of ['url', 'source', 'medium', 'campaign']) {
        if (typeof input[key] !== 'string' || input[key].trim() === '') {
            throw new Error(`buildUtmUrl requires a non-empty ${key}`);
        }
    }
    let parsed;
    try {
        parsed = new URL(input.url);
    }
    catch {
        throw new Error('buildUtmUrl requires an absolute http(s) url');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('buildUtmUrl requires an absolute http(s) url');
    }
    const utm = [
        ['utm_source', input.source.trim()],
        ['utm_medium', input.medium.trim()],
        ['utm_campaign', input.campaign.trim()],
    ];
    if (typeof input.content === 'string' && input.content.trim() !== '') {
        utm.push(['utm_content', input.content.trim()]);
    }
    const utmKeys = new Set(utm.map(([k]) => k));
    const pairs = [];
    parsed.searchParams.forEach((value, key) => {
        if (!utmKeys.has(key))
            pairs.push([key, value]);
    });
    pairs.push(...utm);
    const query = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    return `${parsed.origin}${parsed.pathname}?${query}${parsed.hash}`;
}
/**
 * @description Whitelist-sanitize an imported campaign object. Import NEVER arms spend or consent
 * (the series-pump import rule): enabled / standing_authorization / daily_cap / budget_monthly_usd /
 * target_cpa_usd / stage / status and every other non-whitelisted field are dropped by construction
 * — only content fields (product, name, slug, motion, icp, messageMap, channels) survive, each
 * shape-checked. Malformed input yields an empty object rather than a throw.
 * @param obj - The untrusted imported campaign payload.
 * @returns A new object carrying only the whitelisted, shape-valid content fields.
 */
function sanitizeCampaignImport(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object' || Array.isArray(obj))
        return out;
    const src = obj;
    const str = (v) => typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
    const objOf = (v) => v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : undefined;
    const product = str(src.product);
    if (product)
        out.product = product;
    const name = str(src.name);
    if (name)
        out.name = name;
    const rawSlug = str(src.slug);
    if (rawSlug) {
        const slug = rawSlug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        if (slug !== '')
            out.slug = slug;
    }
    const motion = str(src.motion);
    if (motion === 'adoption' || motion === 'revenue')
        out.motion = motion;
    const icp = objOf(src.icp);
    if (icp)
        out.icp = icp;
    const messageMap = objOf(src.messageMap ?? src.message_map);
    if (messageMap)
        out.messageMap = messageMap;
    if (Array.isArray(src.channels)) {
        const channels = [...new Set(src.channels.filter((c) => typeof c === 'string' && c.trim() !== '').map((c) => c.trim()))];
        if (channels.length)
            out.channels = channels;
    }
    return out;
}
/**
 * @description Propose ONE conservative budget move per run: from the worst trailing-CPA channel to
 * the best, never more than maxShiftPct (default 20%) of the donor's envelope, never taking the
 * donor below floorUsd, and always conserving the total. Channels with zero spend have no data and
 * are never touched; fewer than two ranked channels — or no CPA separation — proposes nothing.
 * These are proposal rows for the human-decided budget ledger; nothing here changes an allocation.
 * @param input - Per-channel trailing performance plus the shift/floor bounds.
 * @returns Zero or two proposal rows (the donor decrease and the recipient increase).
 */
function reallocationProposals(input) {
    const channels = Array.isArray(input?.channels) ? input.channels.filter(isValidPerformance) : [];
    const pct = clampPct(input?.maxShiftPct);
    const floor = typeof input?.floorUsd === 'number' && Number.isFinite(input.floorUsd) && input.floorUsd > 0
        ? input.floorUsd : 0;
    const ranked = channels
        .filter((c) => c.spendUsd > 0)
        .map((c) => ({ ...c, cpa: c.conversions > 0 ? c.spendUsd / c.conversions : Number.POSITIVE_INFINITY }))
        .sort((a, b) => (a.cpa === b.cpa ? a.channel.localeCompare(b.channel) : a.cpa < b.cpa ? -1 : 1));
    if (ranked.length < 2)
        return [];
    const recipient = ranked[0];
    const donor = ranked[ranked.length - 1];
    if (!(donor.cpa > recipient.cpa))
        return [];
    const shift = round2(Math.min((donor.allocationUsd * pct) / 100, donor.allocationUsd - floor));
    if (!(shift > 0))
        return [];
    const donorCpaText = donor.conversions > 0 ? `$${round2(donor.cpa)}` : 'no conversions on spend';
    const recipientCpaText = `$${round2(recipient.cpa)}`;
    return [
        {
            channel: donor.channel, field: 'channel_allocation',
            oldValue: round2(donor.allocationUsd), newValue: round2(donor.allocationUsd - shift),
            trailingCpaUsd: donor.conversions > 0 ? round2(donor.cpa) : null,
            rationale: `worst trailing CPA (${donorCpaText}) — move $${shift} (<= ${pct}% of envelope, floor $${floor}) to ${recipient.channel}`,
        },
        {
            channel: recipient.channel, field: 'channel_allocation',
            oldValue: round2(recipient.allocationUsd), newValue: round2(recipient.allocationUsd + shift),
            trailingCpaUsd: round2(recipient.cpa),
            rationale: `best trailing CPA (${recipientCpaText}) — receive $${shift} from ${donor.channel}`,
        },
    ];
}
/** True when a ChannelPerformance entry is well-formed (finite non-negative numbers, named channel). */
function isValidPerformance(c) {
    return !!c && typeof c === 'object'
        && typeof c.channel === 'string' && c.channel.trim() !== ''
        && Number.isFinite(c.spendUsd) && c.spendUsd >= 0
        && Number.isFinite(c.conversions) && c.conversions >= 0
        && Number.isFinite(c.allocationUsd) && c.allocationUsd >= 0;
}
/** Clamp a shift percentage to (0, 100]; anything else falls back to the 20% default. */
function clampPct(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100 ? v : 20;
}
/** Round to cents to keep proposal math free of float noise. */
function round2(v) {
    return Math.round(v * 100) / 100;
}
/**
 * @description The sources the deterministic daily ingest is expected to fill (ADR-132). A week
 * with no events from one of these is marked no_data on the scorecard — an honest gap, never a 0
 * invented for a source that was not read.
 */
exports.EXPECTED_SCORECARD_SOURCES = ['gsc', 'posthog', 'github'];
/**
 * @description Roll one ISO week of marketing events into scorecard data: totals plus counts and
 * summed values by source, by event within source, by medium, and by campaign slug. Every expected
 * ingest source absent from the week is marked {status:'no_data'} — the honest gap the surfaces
 * must render as NO DATA, never as a number. Unexpected sources present in the week are marked ok.
 * @param events - Event rows (any wider window; only rows inside the week are counted).
 * @param weekStartIso - Any ISO date inside the target week; normalized to that week's Monday.
 * @returns The rollup: `data` (jsonb payload) and `sources` (per-source status).
 */
function scorecardRollup(events, weekStartIso) {
    const weekStart = weekStartOf(weekStartIso);
    const startMs = Date.parse(`${weekStart}T00:00:00.000Z`);
    const endMs = startMs + 7 * 86_400_000;
    const data = {
        weekStart, totals: { events: 0, value: 0 }, bySource: {}, byMedium: {}, byCampaign: {},
    };
    for (const ev of Array.isArray(events) ? events : []) {
        if (!ev || typeof ev.source !== 'string' || ev.source === '' || typeof ev.event !== 'string')
            continue;
        const ts = ev.ts instanceof Date ? ev.ts.getTime() : Date.parse(String(ev.ts));
        if (!Number.isFinite(ts) || ts < startMs || ts >= endMs)
            continue;
        const raw = Number(ev.value ?? 0);
        const value = Number.isFinite(raw) ? raw : 0;
        addTo(data.totals, value);
        const source = (data.bySource[ev.source] ??= { events: 0, value: 0, byEvent: {} });
        addTo(source, value);
        addTo((source.byEvent[ev.event] ??= { events: 0, value: 0 }), value);
        if (typeof ev.medium === 'string' && ev.medium !== '') {
            addTo((data.byMedium[ev.medium] ??= { events: 0, value: 0 }), value);
        }
        if (typeof ev.campaign_slug === 'string' && ev.campaign_slug !== '') {
            addTo((data.byCampaign[ev.campaign_slug] ??= { events: 0, value: 0 }), value);
        }
    }
    const sources = {};
    for (const s of exports.EXPECTED_SCORECARD_SOURCES)
        sources[s] = { status: data.bySource[s] ? 'ok' : 'no_data' };
    for (const s of Object.keys(data.bySource))
        sources[s] ??= { status: 'ok' };
    return { data, sources };
}
/** Count an event's value into a bucket. */
function addTo(bucket, value) {
    bucket.events += 1;
    bucket.value = round2(bucket.value + value);
}
/**
 * @description The Monday (ISO week start, UTC) of the week containing the given date.
 * @param dateIso - An ISO date ('YYYY-MM-DD' or full timestamp); invalid input throws.
 * @returns That week's Monday as 'YYYY-MM-DD'.
 */
function weekStartOf(dateIso) {
    const ms = Date.parse(typeof dateIso === 'string' ? dateIso : '');
    if (!Number.isFinite(ms))
        throw new Error('weekStartOf requires a valid ISO date');
    const d = new Date(ms);
    const shift = (d.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - shift))
        .toISOString().slice(0, 10);
}
/**
 * @description The ICE score of an experiment: impact x confidence x ease, each an integer 1..10
 * (the oshal_marketing_experiments CHECK range). Out-of-range input throws rather than mis-ranking.
 * @param impact - Expected impact, integer 1..10.
 * @param confidence - Confidence the hypothesis holds, integer 1..10.
 * @param ease - Ease of running the experiment, integer 1..10.
 * @returns The product, 1..1000; higher runs first.
 */
function iceScore(impact, confidence, ease) {
    const parts = [['impact', impact], ['confidence', confidence], ['ease', ease]];
    for (const [label, v] of parts) {
        if (!Number.isInteger(v) || v < 1 || v > 10) {
            throw new RangeError(`ICE ${label} must be an integer between 1 and 10`);
        }
    }
    return impact * confidence * ease;
}
//# sourceMappingURL=marketing-model.js.map