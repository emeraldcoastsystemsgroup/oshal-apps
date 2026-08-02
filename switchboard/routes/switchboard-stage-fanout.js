"use strict";
/**
 * Switchboard Stage fan-out model — the PURE broadcast logic (no framework imports).
 *
 * Stage is "compose once → send to N channels". This module owns the two decisions that
 * must be provably correct, kept free of Express/DB/framework imports so the store-CI
 * plain-node suite can require the COMPILED routes/switchboard-stage-fanout.js directly
 * (the kalshi-scan-config precedent — test the same bytes the framework mounts):
 *
 *   • normalizeBroadcast — validate one broadcast request into an ordered channel plan:
 *     platform allow-list, per-platform char limits, alias folding (twitter→x, so one
 *     broadcast can never double-post the same channel), duplicate rejection, channel cap.
 *   • runFanout — submit the plan one channel at a time through the CALLER-SUPPLIED
 *     publish function (the route passes Compose's publishTo — the single sanctioned
 *     publish path). Each channel is isolated: a rejection or thrown error on one channel
 *     records a failure for THAT channel and the fan-out continues; results keep plan order.
 *
 * What this module deliberately does NOT do: decide whether a send is allowed. The
 * explicit-write confirmation (no-post gate) and the workspace guard live in the route,
 * before runFanout is ever reached — nothing here can start a send on its own.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 18:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Initial pure fan-out model for the Stage pane: normalizeBroadcast (allow-list + limits + twitter→x alias folding + duplicate/cap rejection) and runFanout (per-channel isolation over an injected publish fn, ordered results + summary). Zero imports by design so the store-CI plain-node suite tests the compiled bytes.
 *
 * @module switchboard-stage-fanout
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_BROADCAST_CHANNELS = void 0;
exports.canonicalChannel = canonicalChannel;
exports.normalizeBroadcast = normalizeBroadcast;
exports.runFanout = runFanout;
/** Hard cap on channels per broadcast — a fan-out is a handful of networks, not a loop. */
exports.MAX_BROADCAST_CHANNELS = 6;
/**
 * @description Fold platform aliases onto one canonical channel key so a single broadcast
 * can never submit the same network twice under two names (publishTo treats 'x' and
 * 'twitter' as the same binding — this mirrors that exactly).
 * @param platform - A raw platform key (any case).
 * @returns The canonical lowercase channel key.
 */
function canonicalChannel(platform) {
    const p = String(platform || '').toLowerCase().trim();
    return p === 'twitter' ? 'x' : p;
}
/**
 * @description Validate one broadcast request body into an ordered channel plan. Fail-closed:
 * any invalid entry rejects the WHOLE broadcast (a partial plan silently dropping a channel
 * is how a user posts to three networks believing it was four).
 * @param body - The raw request body ({ posts: [{ platform, text }] }).
 * @param publishable - The platform keys with a real publish binding (Compose's PUBLISHABLE set).
 * @param limits - Per-platform character limits keyed by platform (Compose's PLATFORMS limits).
 * @returns The validated plan (posts in request order, canonical platforms), or { error }.
 */
function normalizeBroadcast(body, publishable, limits) {
    const allowed = publishable instanceof Set ? publishable : new Set(publishable);
    const raw = body?.posts;
    if (!Array.isArray(raw) || !raw.length)
        return { posts: [], error: 'posts array required (one entry per channel)' };
    if (raw.length > exports.MAX_BROADCAST_CHANNELS)
        return { posts: [], error: `too many channels (max ${exports.MAX_BROADCAST_CHANNELS})` };
    const posts = [];
    const seen = new Set();
    for (const entry of raw) {
        const platform = canonicalChannel(entry?.platform || '');
        const text = String(entry?.text || '').trim();
        if (!platform || !allowed.has(platform))
            return { posts: [], error: `unsupported platform: ${platform || '(missing)'}` };
        if (seen.has(platform))
            return { posts: [], error: `duplicate channel: ${platform} (one send per channel per broadcast)` };
        if (!text)
            return { posts: [], error: `empty text for ${platform}` };
        const limit = limits[platform];
        if (typeof limit === 'number' && text.length > limit)
            return { posts: [], error: `${platform} text is ${text.length} chars (max ${limit})` };
        seen.add(platform);
        posts.push({ platform, text });
    }
    return { posts };
}
/**
 * @description Submit a validated plan one channel at a time through the injected publish
 * function, isolating every channel: a publisher rejection ({ ok:false }) or a thrown error
 * on one channel records that channel as failed and the fan-out CONTINUES — one dead
 * connector never blocks the rest of the broadcast. Results keep plan order.
 * @param posts - The validated channel plan (normalizeBroadcast output).
 * @param publish - The sanctioned publisher: (platform, text) → the per-channel outcome.
 * @returns Ordered per-channel results plus the { total, sent, failed } summary.
 */
async function runFanout(posts, publish) {
    const results = [];
    for (const post of posts) {
        try {
            const r = await publish(post.platform, post.text);
            results.push({ ...r, platform: post.platform, ok: r?.ok === true });
        }
        catch (err) {
            results.push({ platform: post.platform, ok: false, error: err.message || 'publish threw' });
        }
    }
    const sent = results.filter((r) => r.ok).length;
    return { results, summary: { total: results.length, sent, failed: results.length - sent } };
}
//# sourceMappingURL=switchboard-stage-fanout.js.map