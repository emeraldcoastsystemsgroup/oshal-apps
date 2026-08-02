"use strict";
/**
 * Kalshi background-scan CONFIG + alert selection — the pure half.
 *
 * Everything here is a total function over plain data: no Postgres, no Kalshi, no framework
 * imports. That is deliberate — this module carries the decisions that are easy to get quietly
 * wrong (which layer wins, what a bad value clamps to, which hands are "new enough to interrupt
 * someone over") and it is covered by `tests/kalshi-scan-config.test.js`, a dependency-free
 * `node --test` suite the store CI actually runs. The timer, the DB, and the notification
 * transports live in kalshi-scan-engine.ts, which is deliberately dumb by comparison.
 *
 * THE CONFIG LAYERS, weakest first (later wins, per key):
 *   1. KALSHI_SCAN_DEFAULTS — the values in this file.
 *   2. the manifest — `settings.schema.<key>.default` in oshal-app.yaml (the YAML is the config;
 *      the operator edits it, the package reads its OWN manifest at activation).
 *   3. the DEPLOYMENT settings row (kalshi_scan_settings, scope '__deployment__') — the cadence
 *      knobs, editable by an operator from the app's Settings tab.
 *   4. the USER settings row (scope = the caller's sub) — the alert knobs, per person.
 * Deployment keys are ignored on a user layer and vice-versa (SCOPE_OF): one user cannot change
 * how often the deployment scans, and a deployment default cannot silently mute one person's
 * alerts by writing their key.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-30 03:20:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial — the always-on scan's config resolution (manifest→deployment→user layering with per-key scope enforcement + clamping), snapshot freshness math, and the alert gate (strength/edge floor, first-seen dedup, top-N, per-day budget) + its message formatting.
 *
 * @module kalshi-scan-config
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCOPE_OF = exports.KALSHI_SCAN_DEFAULTS = exports.STRENGTH_ORDER = void 0;
exports.keysForScope = keysForScope;
exports.manifestConfigDefaults = manifestConfigDefaults;
exports.resolveScanConfig = resolveScanConfig;
exports.clampScanConfig = clampScanConfig;
exports.scopedPatch = scopedPatch;
exports.scanFreshness = scanFreshness;
exports.selectAlertHands = selectAlertHands;
exports.formatAlert = formatAlert;
/** Strongest → weakest. A minimum of 'playable' therefore admits monster + strong + playable. */
exports.STRENGTH_ORDER = { monster: 0, strong: 1, playable: 2, fold: 3 };
/** Layer 1: the in-code defaults. Hourly, alerts on, outward off. */
exports.KALSHI_SCAN_DEFAULTS = {
    scanEnabled: true,
    scanIntervalMinutes: 60,
    scanOnActivate: true,
    scanMaxMarketsPaged: 60_000,
    scanMaxMarketsKept: 1500,
    staleAfterMinutes: 180,
    notifyJarvis: true,
    notifyOutward: false,
    alertMinEdgeCents: 3,
    alertMinStrength: 'playable',
    alertTopN: 5,
    alertMaxPerDay: 6,
};
/** Which layer owns each key. Deployment = one scan serves everyone; user = their own alerts. */
exports.SCOPE_OF = {
    scanEnabled: 'deployment',
    scanIntervalMinutes: 'deployment',
    scanOnActivate: 'deployment',
    scanMaxMarketsPaged: 'deployment',
    scanMaxMarketsKept: 'deployment',
    staleAfterMinutes: 'deployment',
    notifyJarvis: 'user',
    notifyOutward: 'user',
    alertMinEdgeCents: 'user',
    alertMinStrength: 'user',
    alertTopN: 'user',
    alertMaxPerDay: 'user',
};
/** Editable keys by scope — the settings route's allow-list (unknown keys are dropped, never stored). */
function keysForScope(scope) {
    return Object.keys(exports.SCOPE_OF).filter((k) => exports.SCOPE_OF[k] === scope);
}
/** Inclusive numeric bounds per key. A value outside them is CLAMPED, never rejected: a bad
 *  settings row must degrade the cadence, not stop an always-on scan from running at all. */
const BOUNDS = {
    scanIntervalMinutes: { min: 5, max: 1440 },
    scanMaxMarketsPaged: { min: 1000, max: 200_000 },
    scanMaxMarketsKept: { min: 50, max: 5000 },
    staleAfterMinutes: { min: 5, max: 10_080 },
    alertMinEdgeCents: { min: 0, max: 50 },
    alertTopN: { min: 1, max: 25 },
    alertMaxPerDay: { min: 0, max: 48 },
};
function asBool(v, fallback) {
    if (typeof v === 'boolean')
        return v;
    if (typeof v === 'number')
        return v !== 0;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(s))
            return true;
        if (['0', 'false', 'no', 'off'].includes(s))
            return false;
    }
    return fallback;
}
function asNum(v, fallback, bounds) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    const base = Number.isFinite(n) ? n : fallback;
    if (!bounds)
        return base;
    return Math.min(bounds.max, Math.max(bounds.min, base));
}
/**
 * @description Read layer 2 out of a parsed `oshal-app.yaml`: the `settings.schema.<key>.default`
 * values. Anything the manifest does not declare simply isn't in the returned patch, so the
 * in-code default survives. Shape-tolerant by design — a hand-edited manifest with a typo must
 * lose ONE key, not the whole config.
 * @param manifest - The parsed manifest object (or anything, including null).
 * @returns A partial config patch of the keys the manifest actually declares a default for.
 */
function manifestConfigDefaults(manifest) {
    const schema = manifest?.settings?.schema;
    if (!schema || typeof schema !== 'object')
        return {};
    const patch = {};
    for (const key of Object.keys(exports.SCOPE_OF)) {
        const entry = schema[key];
        if (entry && typeof entry === 'object' && 'default' in entry)
            patch[key] = entry.default;
    }
    return patch;
}
/**
 * @description Merge the config layers weakest-first and clamp the result. Each patch may only
 * contribute keys its own scope owns (`scopeOf`); pass 'any' for the manifest/env layer, which
 * legitimately declares both halves.
 * @param layers - Ordered patches: `{ patch, scope }`, later wins per key.
 * @returns A fully-populated, clamped config — never throws, never partially filled.
 */
function resolveScanConfig(layers) {
    const merged = { ...exports.KALSHI_SCAN_DEFAULTS };
    for (const layer of layers) {
        if (!layer || !layer.patch || typeof layer.patch !== 'object')
            continue;
        const patch = layer.patch;
        for (const key of Object.keys(exports.SCOPE_OF)) {
            if (!(key in patch) || patch[key] === null || patch[key] === undefined)
                continue;
            if (layer.scope !== 'any' && exports.SCOPE_OF[key] !== layer.scope)
                continue;
            merged[key] = patch[key];
        }
    }
    return clampScanConfig(merged);
}
/**
 * @description Coerce + clamp a raw config-ish object into a valid KalshiScanConfig.
 * @param raw - Any object of candidate values.
 * @returns The validated config, every field present and in range.
 */
function clampScanConfig(raw) {
    const d = exports.KALSHI_SCAN_DEFAULTS;
    const strengthRaw = String(raw.alertMinStrength ?? d.alertMinStrength).toLowerCase();
    const alertMinStrength = (['monster', 'strong', 'playable'].includes(strengthRaw)
        ? strengthRaw
        : d.alertMinStrength);
    return {
        scanEnabled: asBool(raw.scanEnabled, d.scanEnabled),
        scanIntervalMinutes: Math.round(asNum(raw.scanIntervalMinutes, d.scanIntervalMinutes, BOUNDS.scanIntervalMinutes)),
        scanOnActivate: asBool(raw.scanOnActivate, d.scanOnActivate),
        scanMaxMarketsPaged: Math.round(asNum(raw.scanMaxMarketsPaged, d.scanMaxMarketsPaged, BOUNDS.scanMaxMarketsPaged)),
        scanMaxMarketsKept: Math.round(asNum(raw.scanMaxMarketsKept, d.scanMaxMarketsKept, BOUNDS.scanMaxMarketsKept)),
        staleAfterMinutes: Math.round(asNum(raw.staleAfterMinutes, d.staleAfterMinutes, BOUNDS.staleAfterMinutes)),
        notifyJarvis: asBool(raw.notifyJarvis, d.notifyJarvis),
        notifyOutward: asBool(raw.notifyOutward, d.notifyOutward),
        alertMinEdgeCents: asNum(raw.alertMinEdgeCents, d.alertMinEdgeCents, BOUNDS.alertMinEdgeCents),
        alertMinStrength,
        alertTopN: Math.round(asNum(raw.alertTopN, d.alertTopN, BOUNDS.alertTopN)),
        alertMaxPerDay: Math.round(asNum(raw.alertMaxPerDay, d.alertMaxPerDay, BOUNDS.alertMaxPerDay)),
    };
}
/** Keep only the keys a scope owns, coerced through the same clamp — what the settings route persists. */
function scopedPatch(raw, scope) {
    if (!raw || typeof raw !== 'object')
        return {};
    const incoming = raw;
    const clamped = clampScanConfig({ ...exports.KALSHI_SCAN_DEFAULTS, ...incoming });
    const out = {};
    for (const key of keysForScope(scope)) {
        if (key in incoming)
            out[key] = clamped[key];
    }
    return out;
}
/**
 * @description Freshness of a snapshot for the surface's header: age, whether it is past the
 * staleness horizon, and the next scheduled run. A MISSING snapshot is stale by definition (the
 * first scan hasn't landed yet) — the surface says so instead of implying empty means "no edge".
 * @param snapshotAtIso - When the served snapshot was produced (null = none yet).
 * @param cfg - The resolved config (interval + staleness horizon).
 * @param nowMs - Current epoch ms (injected so the suite is deterministic).
 * @returns Age in seconds, the stale flag, and the next run time.
 */
function scanFreshness(snapshotAtIso, cfg, nowMs) {
    const at = snapshotAtIso ? new Date(snapshotAtIso).getTime() : NaN;
    if (!Number.isFinite(at))
        return { ageSeconds: null, stale: true, nextRunAt: null };
    const ageSeconds = Math.max(0, Math.round((nowMs - at) / 1000));
    return {
        ageSeconds,
        stale: ageSeconds > cfg.staleAfterMinutes * 60,
        nextRunAt: new Date(at + cfg.scanIntervalMinutes * 60_000).toISOString(),
    };
}
/**
 * @description The alert gate: which of this cycle's hands are worth interrupting a person over.
 * A hand qualifies when it clears the strength floor AND the net-edge floor AND has not been
 * alerted before (first-seen dedup by ticker — an hourly scan re-finds the same hand every hour,
 * and re-announcing it is how an always-on feature trains its owner to ignore it). Survivors are
 * ordered strongest-edge-first and capped at `alertTopN`; the rolling per-day budget is checked
 * BEFORE selection so a burst of hands can't consume tomorrow's attention today.
 * FAIL CLOSED, for real: a NULL `alreadyAlerted` (the ledger could not be read) or a NULL
 * `alertsToday` (the budget could not be counted) suppresses this user's alerts outright. Without
 * the dedup set there is no way to tell a new hand from one announced an hour ago, and guessing
 * means re-announcing everything. The first version's "fail closed" was a sentinel string in the
 * set, which nothing ever matched — it failed open (self-review, 2026-07-30).
 *
 * @param hands - This cycle's ranked hands.
 * @param cfg - The user's resolved config.
 * @param alreadyAlerted - Tickers this user has already been alerted about, or null if unreadable.
 * @param alertsToday - Announcements already sent to this user in the rolling day, or null if unreadable.
 * @returns The hands to alert on, or an empty list with the suppression reason.
 */
function selectAlertHands(hands, cfg, alreadyAlerted, alertsToday) {
    if (!cfg.notifyJarvis && !cfg.notifyOutward)
        return { hands: [], suppressed: 'notify-off' };
    if (alreadyAlerted === null || alreadyAlerted === undefined)
        return { hands: [], suppressed: 'ledger-unavailable' };
    if (alertsToday === null || alertsToday === undefined)
        return { hands: [], suppressed: 'budget-unavailable' };
    if (alertsToday >= cfg.alertMaxPerDay)
        return { hands: [], suppressed: 'daily-budget' };
    const seen = new Set();
    for (const t of alreadyAlerted)
        seen.add(String(t));
    const floor = exports.STRENGTH_ORDER[cfg.alertMinStrength];
    const qualified = (hands || [])
        .filter((h) => h && typeof h.ticker === 'string' && h.ticker !== '')
        .filter((h) => (exports.STRENGTH_ORDER[h.strength] ?? exports.STRENGTH_ORDER.fold) <= floor)
        .filter((h) => Math.round((h.edgeNet ?? 0) * 1000) / 10 >= cfg.alertMinEdgeCents)
        .filter((h) => !seen.has(h.ticker))
        .sort((a, b) => (b.edgeNet ?? 0) - (a.edgeNet ?? 0))
        .slice(0, cfg.alertTopN);
    return qualified.length ? { hands: qualified, suppressed: null } : { hands: [], suppressed: 'no-new-hands' };
}
/**
 * @description Render the alert. The body states the posture explicitly — a hand is a candidate
 * the engine has not earned the right to size (stake is forced to 0% until a strategy out-scores
 * the market), so the message must never read as "place this bet".
 * @param hands - The selected hands.
 * @param meta - Scan context: when it ran and how many markets were evaluable.
 * @returns Subject / body / shortText.
 */
function formatAlert(hands, meta) {
    const cents = (d) => `${((d ?? 0) * 100).toFixed(1)}¢`;
    const pct = (p) => `${((p ?? 0) * 100).toFixed(1)}%`;
    const n = hands.length;
    const subject = n === 1
        ? `Kalshi: 1 new playable hand (${hands[0].title || hands[0].ticker})`
        : `Kalshi: ${n} new playable hands`;
    const lines = hands.map((h) => [
        `- [${h.strength}] ${String(h.side || '').toUpperCase()} ${h.title || h.ticker}`,
        `  ${h.ticker} · ask ${cents(h.price)} · true P ${pct(h.trueProb)} · net edge +${cents(h.edgeNet)}`,
        `  suggested stake ${pct(h.stakeFraction)}${(h.riskFlags || []).length ? ` · flags: ${(h.riskFlags || []).join(', ')}` : ''}`,
    ].join('\n'));
    const body = [
        `The background scan found ${n} new hand${n === 1 ? '' : 's'} clearing your alert floor`,
        meta.evaluable ? ` (${meta.evaluable} evaluable market${meta.evaluable === 1 ? '' : 's'} this cycle).` : '.',
        '\n\n',
        lines.join('\n'),
        '\n\n',
        meta.mayStake === false
            ? 'Posture: these are CANDIDATES. Every hand is recorded as a prediction and graded at settlement, and the suggested stake stays 0% until the strategy out-scores the market on settled predictions. Nothing has been ordered.'
            : 'Every hand is recorded as a prediction and graded at settlement. Nothing has been ordered — orders are confirm-gated on the Kalshi surface.',
        '\n\nOpen the Kalshi app (?app=kalshi) to see the full table.',
    ].join('');
    const top = hands[0];
    const shortText = n === 1
        ? `Kalshi: ${String(top.side || '').toUpperCase()} ${top.title || top.ticker} — net edge +${cents(top.edgeNet)} (candidate, 0% stake until proven)`
        : `Kalshi: ${n} new hands, best +${cents(top.edgeNet)} (${top.title || top.ticker}). Candidates only.`;
    return { subject, body, shortText };
}
//# sourceMappingURL=kalshi-scan-config.js.map