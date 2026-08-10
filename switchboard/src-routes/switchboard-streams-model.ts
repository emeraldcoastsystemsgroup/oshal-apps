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

/** Every editorial state a Streams post can be in. */
export const STATES = ['draft', 'in_review', 'approved', 'scheduled', 'published', 'rejected', 'failed', 'archived'] as const;

/** One editorial state. */
export type StreamState = (typeof STATES)[number];

/** The transition table: action → which states it is legal from, and where it lands.
 *  Schedule/publish are their own endpoints (they carry payloads + side effects), not actions. */
export const TRANSITIONS: Record<string, { from: StreamState[]; to: StreamState }> = {
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
export const VARIANT_PLATFORMS = ['x', 'linkedin', 'facebook', 'instagram', 'threads'] as const;

/** Platforms with a REAL publish binding (compose's publishTo). instagram/threads are
 *  storable-but-copy-paste — publish records them 'skipped', never a fake success. */
export const PUBLISHABLE_PLATFORMS = ['x', 'linkedin', 'facebook'] as const;

/** Per-platform character limits (publish-time gate; the UI meters against these too). */
export const LIMITS: Record<string, number> = { x: 280, linkedin: 3000, facebook: 63206, instagram: 2200, threads: 500 };

/** Bounds for the master content. */
export const MAX_TITLE = 140;
export const MAX_BODY = 20000;
export const MAX_TAGS = 12;
const MAX_TAG_LEN = 40;

/** One stored per-channel variant (the publish-relevant subset). */
export interface StreamVariant { platform: string; body: string; mediaRef?: string | null }

/** One planned send. */
export interface PlanEntry { platform: string; body: string }

/** One per-channel publish outcome (spread over the publisher's own fields). */
export interface PublishResult { platform: string; ok: boolean; [k: string]: unknown }

/** Fold a platform name onto its canonical key (twitter → x; case-insensitive). */
export function canonicalPlatform(p: unknown): string {
  const v = String(p ?? '').toLowerCase().trim();
  return v === 'twitter' ? 'x' : v;
}

/**
 * @description Apply an editorial action to a state via the transition table.
 * @param state - The post's current state.
 * @param action - The requested action (see TRANSITIONS).
 * @returns { next } on a legal transition, { error } otherwise — never both.
 */
export function applyTransition(state: string, action: string): { next?: StreamState; error?: string } {
  if (!(STATES as readonly string[]).includes(state)) return { error: `unknown state: ${state}` };
  const t = TRANSITIONS[action];
  if (!t) return { error: `unknown action: ${action}` };
  if (!t.from.includes(state as StreamState)) return { error: `cannot ${action} from ${state}` };
  return { next: t.to };
}

/** True when content edits are allowed — drafting and review only; anything later must reopen. */
export function canEdit(state: string): boolean {
  return state === 'draft' || state === 'in_review';
}

/** Normalize a tags payload; null = invalid. */
function normalizeTags(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const tags = raw.map((t) => String(t ?? '').trim()).filter(Boolean);
  if (tags.length > MAX_TAGS || tags.some((t) => t.length > MAX_TAG_LEN)) return null;
  return [...new Set(tags)];
}

/** Canonicalize + dedupe a platform list; returns null if any entry is unknown (fail-closed). */
function normalizePlatforms(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const p of raw) {
    const c = canonicalPlatform(p);
    if (!(VARIANT_PLATFORMS as readonly string[]).includes(c)) return null;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** A validated new-post payload; the error variant carries NOTHING else — a rejected
 *  payload must never offer a usable partial platform list (fail-closed, no silent drops). */
export type NewStreamPost =
  | { title: string; body: string; platforms: string[]; workspaceId: string | null; tags: string[]; error?: undefined }
  | { error: string };

/**
 * @description Validate + normalize a create payload. Fail-closed: an unknown platform or an
 * out-of-bounds field rejects the WHOLE payload rather than silently dropping a part of it,
 * and the rejection carries ONLY the error.
 * @param b - The raw request body.
 * @returns The normalized payload, or `{ error }` alone.
 */
export function validateNewPost(b: Record<string, unknown>): NewStreamPost {
  const title = String(b.title ?? '').trim();
  const body = String(b.body ?? '').trim();
  const workspaceId = typeof b.workspaceId === 'string' && b.workspaceId ? b.workspaceId : null;
  const platforms = normalizePlatforms(b.platforms);
  const tags = normalizeTags(b.tags);
  if (!body) return { error: 'body required' };
  if (body.length > MAX_BODY) return { error: `body must be ≤${MAX_BODY} chars` };
  if (title.length > MAX_TITLE) return { error: `title must be ≤${MAX_TITLE} chars` };
  if (platforms === null) return { error: `platforms must be among ${VARIANT_PLATFORMS.join(', ')}` };
  if (tags === null) return { error: `tags: ≤${MAX_TAGS} entries of ≤${MAX_TAG_LEN} chars` };
  return { title, body, platforms, workspaceId, tags };
}

/** Type guard: narrows a validateNewPost result to its valid variant. */
export function isValidNewPost(v: NewStreamPost): v is Extract<NewStreamPost, { title: string }> {
  return v.error === undefined;
}

/** A validated patch: only the supplied fields, variants canonicalized + deduped. */
export interface StreamPatch {
  title?: string;
  body?: string;
  tags?: string[];
  variants?: StreamVariant[];
  error?: string;
}

/**
 * @description Validate + normalize an edit payload (PATCH). Empty patches and unknown
 * variant platforms reject; x/twitter fold onto one variant.
 * @param b - The raw request body.
 * @returns The normalized patch, or `{ error }`.
 */
export function validatePatch(b: Record<string, unknown>): StreamPatch {
  const out: StreamPatch = {};
  if (b.title !== undefined) {
    const t = String(b.title ?? '').trim();
    if (t.length > MAX_TITLE) return { error: `title must be ≤${MAX_TITLE} chars` };
    out.title = t;
  }
  if (b.body !== undefined) {
    const t = String(b.body ?? '').trim();
    if (!t || t.length > MAX_BODY) return { error: `body must be 1–${MAX_BODY} chars` };
    out.body = t;
  }
  if (b.tags !== undefined) {
    const tags = normalizeTags(b.tags);
    if (tags === null) return { error: `tags: ≤${MAX_TAGS} entries of ≤${MAX_TAG_LEN} chars` };
    out.tags = tags;
  }
  if (b.variants !== undefined) {
    if (!Array.isArray(b.variants)) return { error: 'variants must be an array' };
    const seen = new Set<string>();
    const variants: StreamVariant[] = [];
    for (const raw of b.variants as Array<Record<string, unknown>>) {
      const platform = canonicalPlatform(raw?.platform);
      if (!(VARIANT_PLATFORMS as readonly string[]).includes(platform)) return { error: `unknown variant platform: ${platform || '(empty)'}` };
      if (seen.has(platform)) continue; // x/twitter fold — first occurrence wins
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
export function validateScheduleAt(value: unknown, nowMs: number): { iso?: string; error?: string } {
  if (typeof value !== 'string' || !value.trim()) return { error: 'scheduledAt (ISO timestamp) required' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { error: 'scheduledAt is not a valid timestamp' };
  if (d.getTime() <= nowMs) return { error: 'scheduledAt must be in the future' };
  return { iso: d.toISOString() };
}

/** The fail-closed publish plan: what will send, what is honestly skipped — or one error and NOTHING sends. */
export interface PublishPlan {
  plan: PlanEntry[];
  skipped: Array<{ platform: string; reason: string }>;
  error?: string;
}

/**
 * @description Build the publish plan from stored variants. FAIL-CLOSED like Stage: any
 * publishable variant that is empty or over its platform limit rejects the WHOLE publish —
 * a partial "we sent some of it" surprise is worse than a clean 400. Platforms without a
 * real binding (instagram/threads) are recorded as skipped('no_binding'), never faked.
 * @param variants - The post's stored variants.
 * @returns The plan + skips, or `{ error }` with an empty plan.
 */
export function buildPublishPlan(variants: StreamVariant[]): PublishPlan {
  const plan: PlanEntry[] = [];
  const skipped: Array<{ platform: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const v of variants || []) {
    const platform = canonicalPlatform(v?.platform);
    if (seen.has(platform)) continue;
    seen.add(platform);
    if (!(VARIANT_PLATFORMS as readonly string[]).includes(platform)) {
      return { plan: [], skipped: [], error: `unknown platform: ${platform || '(empty)'}` };
    }
    if (!(PUBLISHABLE_PLATFORMS as readonly string[]).includes(platform)) {
      skipped.push({ platform, reason: 'no_binding' });
      continue;
    }
    const body = String(v?.body ?? '').trim();
    if (!body) return { plan: [], skipped: [], error: `${platform} variant is empty` };
    const limit = LIMITS[platform];
    if (body.length > limit) return { plan: [], skipped: [], error: `${platform} variant is ${body.length} chars (max ${limit})` };
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
export async function runPublishPlan(
  plan: PlanEntry[],
  publishFn: (platform: string, body: string) => Promise<Record<string, unknown>>,
): Promise<PublishResult[]> {
  const results: PublishResult[] = [];
  for (const entry of plan) {
    try {
      const r = await publishFn(entry.platform, entry.body);
      results.push({ ...(r as object), platform: entry.platform, ok: (r as { ok?: unknown })?.ok === true });
    } catch (err) {
      results.push({ platform: entry.platform, ok: false, error: (err as Error).message });
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
export function summarizePublish(
  results: PublishResult[],
  skipped: Array<{ platform: string; reason: string }>,
): { anyOk: boolean; allOk: boolean; state: 'published' | 'failed'; error?: string } {
  const anyOk = results.some((r) => r.ok);
  const allOk = results.length > 0 && results.every((r) => r.ok);
  if (anyOk) return { anyOk, allOk, state: 'published' };
  const failures = results.map((r) => `${r.platform}: ${String(r.error || r.message || 'failed')}`);
  const error = results.length === 0
    ? (skipped.length ? 'no publishable channels (all skipped)' : 'no channels to publish')
    : failures.join('; ').slice(0, 500);
  return { anyOk: false, allOk: false, state: 'failed', error };
}
