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

/** Hand strength as the evaluator reports it (kernel HandStrength, mirrored so this module has no imports). */
export type ScanHandStrength = 'monster' | 'strong' | 'playable' | 'fold';

/** Strongest → weakest. A minimum of 'playable' therefore admits monster + strong + playable. */
export const STRENGTH_ORDER: Record<ScanHandStrength, number> = { monster: 0, strong: 1, playable: 2, fold: 3 };

/** The subset of a BetHand this module needs (mirrored, not imported — keeps the suite dependency-free). */
export interface ScanHandLike {
  ticker: string;
  eventTicker?: string;
  title?: string;
  side?: string;
  category?: string;
  /** Dollars per contract (0..1) — the surface renders it as cents. */
  price?: number;
  trueProb?: number;
  /** Net edge per contract in DOLLARS; the alert floor is expressed in cents. */
  edgeNet?: number;
  stakeFraction?: number;
  strength: ScanHandStrength;
  riskFlags?: string[];
  closeTime?: string | null;
}

/** The resolved, clamped configuration one scan cycle runs under. */
export interface KalshiScanConfig {
  /** Master switch for the background poller (the app being INSTALLED is the other gate). */
  scanEnabled: boolean;
  /** Cadence. The operator's ask was hourly; 0 would be "never", so the floor is 5 minutes. */
  scanIntervalMinutes: number;
  /** Run one scan shortly after activation so the first surface open is already warm. */
  scanOnActivate: boolean;
  /** Feed-walk bound: markets PAGED per scan (Kalshi pages 1000 at a time, public tier ~3 rps). */
  scanMaxMarketsPaged: number;
  /** Feed-walk bound: evaluable markets RETAINED per scan. */
  scanMaxMarketsKept: number;
  /** A snapshot older than this is labelled stale on the surface (it is still served — instantly). */
  staleAfterMinutes: number;
  /** In-app: post new hands to the user's Jarvis feed (Jarvis then knows and can be asked). */
  notifyJarvis: boolean;
  /** Outward (email/SMS/Telegram via the preference center). Default OFF — opt-in, per directive. */
  notifyOutward: boolean;
  /** Alert floor on net edge, in CENTS per contract. */
  alertMinEdgeCents: number;
  /** Alert floor on hand strength. */
  alertMinStrength: Exclude<ScanHandStrength, 'fold'>;
  /** Hands named in one alert. */
  alertTopN: number;
  /** Alert budget per user per rolling day — an always-on scan must never become a firehose. */
  alertMaxPerDay: number;
}

/** Layer 1: the in-code defaults. Hourly, alerts on, outward off. */
export const KALSHI_SCAN_DEFAULTS: KalshiScanConfig = {
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
export const SCOPE_OF: Record<keyof KalshiScanConfig, 'deployment' | 'user'> = {
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
export function keysForScope(scope: 'deployment' | 'user'): Array<keyof KalshiScanConfig> {
  return (Object.keys(SCOPE_OF) as Array<keyof KalshiScanConfig>).filter((k) => SCOPE_OF[k] === scope);
}

/** Inclusive numeric bounds per key. A value outside them is CLAMPED, never rejected: a bad
 *  settings row must degrade the cadence, not stop an always-on scan from running at all. */
const BOUNDS: Partial<Record<keyof KalshiScanConfig, { min: number; max: number }>> = {
  scanIntervalMinutes: { min: 5, max: 1440 },
  scanMaxMarketsPaged: { min: 1000, max: 200_000 },
  scanMaxMarketsKept: { min: 50, max: 5000 },
  staleAfterMinutes: { min: 5, max: 10_080 },
  alertMinEdgeCents: { min: 0, max: 50 },
  alertTopN: { min: 1, max: 25 },
  alertMaxPerDay: { min: 0, max: 48 },
};

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'off'].includes(s)) return false;
  }
  return fallback;
}

function asNum(v: unknown, fallback: number, bounds?: { min: number; max: number }): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  const base = Number.isFinite(n) ? n : fallback;
  if (!bounds) return base;
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
export function manifestConfigDefaults(manifest: unknown): Partial<KalshiScanConfig> {
  const schema = (manifest as { settings?: { schema?: Record<string, unknown> } } | null)?.settings?.schema;
  if (!schema || typeof schema !== 'object') return {};
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(SCOPE_OF)) {
    const entry = schema[key] as { default?: unknown } | undefined;
    if (entry && typeof entry === 'object' && 'default' in entry) patch[key] = entry.default;
  }
  return patch as Partial<KalshiScanConfig>;
}

/**
 * @description Merge the config layers weakest-first and clamp the result. Each patch may only
 * contribute keys its own scope owns (`scopeOf`); pass 'any' for the manifest/env layer, which
 * legitimately declares both halves.
 * @param layers - Ordered patches: `{ patch, scope }`, later wins per key.
 * @returns A fully-populated, clamped config — never throws, never partially filled.
 */
export function resolveScanConfig(
  layers: Array<{ patch: unknown; scope: 'deployment' | 'user' | 'any' } | null | undefined>,
): KalshiScanConfig {
  const merged: Record<string, unknown> = { ...KALSHI_SCAN_DEFAULTS };
  for (const layer of layers) {
    if (!layer || !layer.patch || typeof layer.patch !== 'object') continue;
    const patch = layer.patch as Record<string, unknown>;
    for (const key of Object.keys(SCOPE_OF) as Array<keyof KalshiScanConfig>) {
      if (!(key in patch) || patch[key] === null || patch[key] === undefined) continue;
      if (layer.scope !== 'any' && SCOPE_OF[key] !== layer.scope) continue;
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
export function clampScanConfig(raw: Record<string, unknown>): KalshiScanConfig {
  const d = KALSHI_SCAN_DEFAULTS;
  const strengthRaw = String(raw.alertMinStrength ?? d.alertMinStrength).toLowerCase();
  const alertMinStrength = (['monster', 'strong', 'playable'].includes(strengthRaw)
    ? strengthRaw
    : d.alertMinStrength) as KalshiScanConfig['alertMinStrength'];
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
export function scopedPatch(raw: unknown, scope: 'deployment' | 'user'): Partial<KalshiScanConfig> {
  if (!raw || typeof raw !== 'object') return {};
  const incoming = raw as Record<string, unknown>;
  const clamped = clampScanConfig({ ...KALSHI_SCAN_DEFAULTS, ...incoming }) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keysForScope(scope)) {
    if (key in incoming) out[key] = clamped[key];
  }
  return out as Partial<KalshiScanConfig>;
}

/** How fresh the served snapshot is, and when the poller comes back. */
export interface ScanFreshness {
  ageSeconds: number | null;
  stale: boolean;
  nextRunAt: string | null;
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
export function scanFreshness(snapshotAtIso: string | null, cfg: KalshiScanConfig, nowMs: number): ScanFreshness {
  const at = snapshotAtIso ? new Date(snapshotAtIso).getTime() : NaN;
  if (!Number.isFinite(at)) return { ageSeconds: null, stale: true, nextRunAt: null };
  const ageSeconds = Math.max(0, Math.round((nowMs - at) / 1000));
  return {
    ageSeconds,
    stale: ageSeconds > cfg.staleAfterMinutes * 60,
    nextRunAt: new Date(at + cfg.scanIntervalMinutes * 60_000).toISOString(),
  };
}

/** What the alert gate decided, including WHY nothing was sent (logged, and shown on the surface). */
export interface AlertDecision {
  hands: ScanHandLike[];
  suppressed: 'notify-off' | 'daily-budget' | 'no-new-hands' | 'ledger-unavailable' | 'budget-unavailable' | null;
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
export function selectAlertHands(
  hands: ScanHandLike[],
  cfg: KalshiScanConfig,
  alreadyAlerted: Iterable<string> | null | undefined,
  alertsToday: number | null | undefined,
): AlertDecision {
  if (!cfg.notifyJarvis && !cfg.notifyOutward) return { hands: [], suppressed: 'notify-off' };
  if (alreadyAlerted === null || alreadyAlerted === undefined) return { hands: [], suppressed: 'ledger-unavailable' };
  if (alertsToday === null || alertsToday === undefined) return { hands: [], suppressed: 'budget-unavailable' };
  if (alertsToday >= cfg.alertMaxPerDay) return { hands: [], suppressed: 'daily-budget' };
  const seen = new Set<string>();
  for (const t of alreadyAlerted) seen.add(String(t));
  const floor = STRENGTH_ORDER[cfg.alertMinStrength];
  const qualified = (hands || [])
    .filter((h) => h && typeof h.ticker === 'string' && h.ticker !== '')
    .filter((h) => (STRENGTH_ORDER[h.strength] ?? STRENGTH_ORDER.fold) <= floor)
    .filter((h) => Math.round((h.edgeNet ?? 0) * 1000) / 10 >= cfg.alertMinEdgeCents)
    .filter((h) => !seen.has(h.ticker))
    .sort((a, b) => (b.edgeNet ?? 0) - (a.edgeNet ?? 0))
    .slice(0, cfg.alertTopN);
  return qualified.length ? { hands: qualified, suppressed: null } : { hands: [], suppressed: 'no-new-hands' };
}

/** The alert as the three channels want it: a title, a body, and an SMS-sized line. */
export interface AlertMessage {
  subject: string;
  body: string;
  shortText: string;
}

/**
 * @description Render the alert. The body states the posture explicitly — a hand is a candidate
 * the engine has not earned the right to size (stake is forced to 0% until a strategy out-scores
 * the market), so the message must never read as "place this bet".
 * @param hands - The selected hands.
 * @param meta - Scan context: when it ran and how many markets were evaluable.
 * @returns Subject / body / shortText.
 */
export function formatAlert(
  hands: ScanHandLike[],
  meta: { generatedAt?: string | null; evaluable?: number; mayStake?: boolean },
): AlertMessage {
  const cents = (d: number | undefined): string => `${((d ?? 0) * 100).toFixed(1)}¢`;
  const pct = (p: number | undefined): string => `${((p ?? 0) * 100).toFixed(1)}%`;
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
