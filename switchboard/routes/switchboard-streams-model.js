"use strict";
/**
 * Switchboard Streams Model — the pure CMS core for the Streams pane.
 *
 * The operator's call (2026-08-09): social publishing must be CMS-grade — one post
 * entity moving through editorial states with per-channel variants, revisions, a
 * review queue, and publish through the EXISTING confirm-gated bindings. This module
 * is the deterministic heart of that pane: the state machine, the validators, and
 * the fail-closed publish planner/runner. It is deliberately DEPENDENCY-FREE (no
 * framework imports, no DB, no HTTP) so the store-CI `node --test` suite exercises
 * the exact compiled bytes the running framework requires — the same discipline as
 * switchboard-stage-fanout.
 *
 * The routes module (switchboard-streams-routes.ts) owns all I/O: Postgres rows,
 * revisions, and the actual sends via compose's publishTo (never a forked publisher).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial Streams CMS core: 8-state editorial machine (draft/in_review/approved/scheduled/published/rejected/failed/archived) with an explicit action table; edit gating (draft+in_review only); platform canon (twitter→x) and per-platform limits; fail-closed new-post/patch/schedule validators; buildPublishPlan (any empty/over-limit publishable variant rejects the WHOLE publish; instagram/threads are honest 'skipped no_binding', never fake success); runPublishPlan (exactly one send per channel, independent failures); summarizePublish (≥1 ok = published, all-fail or skipped-only = failed).
 *
 * @module switchboard-streams-model
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TAGS = exports.MAX_BODY = exports.MAX_TITLE = exports.LIMITS = exports.PUBLISHABLE_PLATFORMS = exports.VARIANT_PLATFORMS = exports.TRANSITIONS = exports.STATES = void 0;
exports.canonicalPlatform = canonicalPlatform;
exports.applyTransition = applyTransition;
exports.canEdit = canEdit;
exports.validateNewPost = validateNewPost;
exports.isValidNewPost = isValidNewPost;
exports.validatePatch = validatePatch;
exports.validateScheduleAt = validateScheduleAt;
exports.buildPublishPlan = buildPublishPlan;
exports.runPublishPlan = runPublishPlan;
exports.summarizePublish = summarizePublish;
/** Every editorial state a Streams post can be in. */
exports.STATES = ['draft', 'in_review', 'approved', 'scheduled', 'published', 'rejected', 'failed', 'archived'];
/** The transition table: action → which states it is legal from, and where it lands.
 *  Schedule/publish are their own endpoints (they carry payloads + side effects), not actions. */
exports.TRANSITIONS = {
    submit: { from: ['draft'], to: 'in_review' },
    approve: { from: ['in_review'], to: 'approved' },
    request_changes: { from: ['in_review'], to: 'draft' },
    reject: { from: ['in_review'], to: 'rejected' },
    reopen: { from: ['approved', 'rejected', 'failed'], to: 'draft' },
    unschedule: { from: ['scheduled'], to: 'approved' },
    retry: { from: ['failed'], to: 'approved' },
    archive: { from: ['draft', 'published', 'rejected', 'failed'], to: 'archived' },
};
/** Platforms a variant may be stored for (the authoring surface). */
exports.VARIANT_PLATFORMS = ['x', 'linkedin', 'facebook', 'instagram', 'threads'];
/** Platforms with a REAL publish binding (compose's publishTo). instagram/threads are
 *  storable-but-copy-paste — publish records them 'skipped', never a fake success. */
exports.PUBLISHABLE_PLATFORMS = ['x', 'linkedin', 'facebook'];
/** Per-platform character limits (publish-time gate; the UI meters against these too). */
exports.LIMITS = { x: 280, linkedin: 3000, facebook: 63206, instagram: 2200, threads: 500 };
/** Bounds for the master content. */
exports.MAX_TITLE = 140;
exports.MAX_BODY = 20000;
exports.MAX_TAGS = 12;
const MAX_TAG_LEN = 40;
/** Fold a platform name onto its canonical key (twitter → x; case-insensitive). */
function canonicalPlatform(p) {
    const v = String(p ?? '').toLowerCase().trim();
    return v === 'twitter' ? 'x' : v;
}
/**
 * @description Apply an editorial action to a state via the transition table.
 * @param state - The post's current state.
 * @param action - The requested action (see TRANSITIONS).
 * @returns { next } on a legal transition, { error } otherwise — never both.
 */
function applyTransition(state, action) {
    if (!exports.STATES.includes(state))
        return { error: `unknown state: ${state}` };
    const t = exports.TRANSITIONS[action];
    if (!t)
        return { error: `unknown action: ${action}` };
    if (!t.from.includes(state))
        return { error: `cannot ${action} from ${state}` };
    return { next: t.to };
}
/** True when content edits are allowed — drafting and review only; anything later must reopen. */
function canEdit(state) {
    return state === 'draft' || state === 'in_review';
}
/** Normalize a tags payload; null = invalid. */
function normalizeTags(raw) {
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw))
        return null;
    const tags = raw.map((t) => String(t ?? '').trim()).filter(Boolean);
    if (tags.length > exports.MAX_TAGS || tags.some((t) => t.length > MAX_TAG_LEN))
        return null;
    return [...new Set(tags)];
}
/** Canonicalize + dedupe a platform list; returns null if any entry is unknown (fail-closed). */
function normalizePlatforms(raw) {
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw))
        return null;
    const out = [];
    for (const p of raw) {
        const c = canonicalPlatform(p);
        if (!exports.VARIANT_PLATFORMS.includes(c))
            return null;
        if (!out.includes(c))
            out.push(c);
    }
    return out;
}
/**
 * @description Validate + normalize a create payload. Fail-closed: an unknown platform or an
 * out-of-bounds field rejects the WHOLE payload rather than silently dropping a part of it,
 * and the rejection carries ONLY the error.
 * @param b - The raw request body.
 * @returns The normalized payload, or `{ error }` alone.
 */
function validateNewPost(b) {
    const title = String(b.title ?? '').trim();
    const body = String(b.body ?? '').trim();
    const workspaceId = typeof b.workspaceId === 'string' && b.workspaceId ? b.workspaceId : null;
    const platforms = normalizePlatforms(b.platforms);
    const tags = normalizeTags(b.tags);
    if (!body)
        return { error: 'body required' };
    if (body.length > exports.MAX_BODY)
        return { error: `body must be ≤${exports.MAX_BODY} chars` };
    if (title.length > exports.MAX_TITLE)
        return { error: `title must be ≤${exports.MAX_TITLE} chars` };
    if (platforms === null)
        return { error: `platforms must be among ${exports.VARIANT_PLATFORMS.join(', ')}` };
    if (tags === null)
        return { error: `tags: ≤${exports.MAX_TAGS} entries of ≤${MAX_TAG_LEN} chars` };
    return { title, body, platforms, workspaceId, tags };
}
/** Type guard: narrows a validateNewPost result to its valid variant. */
function isValidNewPost(v) {
    return v.error === undefined;
}
/**
 * @description Validate + normalize an edit payload (PATCH). Empty patches and unknown
 * variant platforms reject; x/twitter fold onto one variant.
 * @param b - The raw request body.
 * @returns The normalized patch, or `{ error }`.
 */
function validatePatch(b) {
    const out = {};
    if (b.title !== undefined) {
        const t = String(b.title ?? '').trim();
        if (t.length > exports.MAX_TITLE)
            return { error: `title must be ≤${exports.MAX_TITLE} chars` };
        out.title = t;
    }
    if (b.body !== undefined) {
        const t = String(b.body ?? '').trim();
        if (!t || t.length > exports.MAX_BODY)
            return { error: `body must be 1–${exports.MAX_BODY} chars` };
        out.body = t;
    }
    if (b.tags !== undefined) {
        const tags = normalizeTags(b.tags);
        if (tags === null)
            return { error: `tags: ≤${exports.MAX_TAGS} entries of ≤${MAX_TAG_LEN} chars` };
        out.tags = tags;
    }
    if (b.variants !== undefined) {
        if (!Array.isArray(b.variants))
            return { error: 'variants must be an array' };
        const seen = new Set();
        const variants = [];
        for (const raw of b.variants) {
            const platform = canonicalPlatform(raw?.platform);
            if (!exports.VARIANT_PLATFORMS.includes(platform))
                return { error: `unknown variant platform: ${platform || '(empty)'}` };
            if (seen.has(platform))
                continue; // x/twitter fold — first occurrence wins
            seen.add(platform);
            const body = String(raw?.body ?? '').trim();
            const mediaRef = typeof raw?.mediaRef === 'string' && raw.mediaRef.trim() ? raw.mediaRef.trim() : null;
            variants.push({ platform, body, mediaRef });
        }
        out.variants = variants;
    }
    if (out.title === undefined && out.body === undefined && out.tags === undefined && out.variants === undefined) {
        return { error: 'nothing to update' };
    }
    return out;
}
/**
 * @description Validate a schedule timestamp: a parseable ISO instant strictly in the future.
 * @param value - The raw scheduledAt value.
 * @param nowMs - The current clock (injected for testability).
 * @returns { iso } or { error }.
 */
function validateScheduleAt(value, nowMs) {
    if (typeof value !== 'string' || !value.trim())
        return { error: 'scheduledAt (ISO timestamp) required' };
    const d = new Date(value);
    if (Number.isNaN(d.getTime()))
        return { error: 'scheduledAt is not a valid timestamp' };
    if (d.getTime() <= nowMs)
        return { error: 'scheduledAt must be in the future' };
    return { iso: d.toISOString() };
}
/**
 * @description Build the publish plan from stored variants. FAIL-CLOSED like Stage: any
 * publishable variant that is empty or over its platform limit rejects the WHOLE publish —
 * a partial "we sent some of it" surprise is worse than a clean 400. Platforms without a
 * real binding (instagram/threads) are recorded as skipped('no_binding'), never faked.
 * @param variants - The post's stored variants.
 * @returns The plan + skips, or `{ error }` with an empty plan.
 */
function buildPublishPlan(variants) {
    const plan = [];
    const skipped = [];
    const seen = new Set();
    for (const v of variants || []) {
        const platform = canonicalPlatform(v?.platform);
        if (seen.has(platform))
            continue;
        seen.add(platform);
        if (!exports.VARIANT_PLATFORMS.includes(platform)) {
            return { plan: [], skipped: [], error: `unknown platform: ${platform || '(empty)'}` };
        }
        if (!exports.PUBLISHABLE_PLATFORMS.includes(platform)) {
            skipped.push({ platform, reason: 'no_binding' });
            continue;
        }
        const body = String(v?.body ?? '').trim();
        if (!body)
            return { plan: [], skipped: [], error: `${platform} variant is empty` };
        const limit = exports.LIMITS[platform];
        if (body.length > limit)
            return { plan: [], skipped: [], error: `${platform} variant is ${body.length} chars (max ${limit})` };
        plan.push({ platform, body });
    }
    return { plan, skipped };
}
/**
 * @description Run the plan: exactly one publish call per channel, in plan order, each
 * channel INDEPENDENT — a rejection or thrown error on one never blocks the rest.
 * @param plan - The validated plan entries.
 * @param publishFn - (platform, body) → the publisher's result ({ ok, ... }).
 * @returns One result per plan entry, in order.
 */
async function runPublishPlan(plan, publishFn) {
    const results = [];
    for (const entry of plan) {
        try {
            const r = await publishFn(entry.platform, entry.body);
            results.push({ ...r, platform: entry.platform, ok: r?.ok === true });
        }
        catch (err) {
            results.push({ platform: entry.platform, ok: false, error: err.message });
        }
    }
    return results;
}
/**
 * @description Fold per-channel outcomes into the post's landing state. ≥1 real success is
 * a publish (partial failures are carried per-channel); all-fail — or nothing publishable
 * at all (skipped-only) — is 'failed' with an honest error.
 * @param results - The runPublishPlan outcomes.
 * @param skipped - The plan's honest skips.
 * @returns { anyOk, allOk, state, error? }.
 */
function summarizePublish(results, skipped) {
    const anyOk = results.some((r) => r.ok);
    const allOk = results.length > 0 && results.every((r) => r.ok);
    if (anyOk)
        return { anyOk, allOk, state: 'published' };
    const failures = results.map((r) => `${r.platform}: ${String(r.error || r.message || 'failed')}`);
    const error = results.length === 0
        ? (skipped.length ? 'no publishable channels (all skipped)' : 'no channels to publish')
        : failures.join('; ').slice(0, 500);
    return { anyOk: false, allOk: false, state: 'failed', error };
}
