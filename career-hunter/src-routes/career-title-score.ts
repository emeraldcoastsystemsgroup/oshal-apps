/**
 * Career title-based scoring — the per-user "title pass" that AI-scores roles whose
 * TITLES match the user's own target list, regardless of keyword prefit.
 *
 * Why: the keyword prefilter (fit_score) is calibrated to the operator's resume, so a
 * second user's best roles (e.g. SAP titles for Enrique) can sit below --min-keyword 40
 * forever. The one-off fix was a manual score_batch(title_any=[...]) run; this module
 * productizes it: a per-user title_terms[] profile (career_score_settings, migration 082),
 * seeded from the user's parsed resume roles on first settings visit, editable on the
 * Career Settings surface, and run DAILY by the career-hunter cron — BOUNDED (--limit via
 * CH_LIMIT) and guarded by a persistent >20h cursor so an api recreate can never re-burn
 * hours of scoring spend.
 *
 * This module also owns the persistent cron-score cursor (last_cron_score_at) that bounds
 * the boot catch-up keyword score the same way (the 2026-07-15 incident: every recreate
 * re-ran `score --min-keyword 40` UNBOUNDED per user; killed manually 3x). NOTE: the
 * engine's `score --days N` is NOT a usable bound — its date gate is
 * `posted_date IS NOT NULL AND posted_date >= ...` and most ATS feeds omit posted_date,
 * so --days silently matches ~0 rows (documented at runUserScore). The real bounds are
 * the persistent cursor + `--limit`.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 17:28:14 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial title-pass module: per-user title profile (read/seed-from-resume/save), bounded score-titles engine invocation via runCliAwait behind the shared single-flight guard, persistent >20h cursors for both the title pass and the cron/boot-catch-up score, cron batch entry, and settings-surface routes (state/save/run-now). Mirrors career-digest.ts throughout.
 * 2026-07-17 02:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Fix resume seeding permanently blocked: markCronScore creates a cursor-only career_score_settings row before any settings visit, and getOrSeedTitleProfile's "seed only when NO row exists" test then never seeded — every user (including the operator) ran with no-title-profile forever. Seed now keys off empty terms + source!='user' (an explicit empty user save stays an opt-out), with the same guard in the upsert.
 *
 * @module career-title-score
 */
import { type Router, type Request, type Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { callerSub, userPaths, runCliAwait, tryAcquireRun, releaseRun } from './career-hunter-routes';

const logger = createChildLogger({ module: 'career-title-score' });

/** Persistent once/~day guard width (hours) — tolerant of cron-window drift, like the digest. */
const GUARD_HOURS = 20;
/** Hard cap on stored title terms (the SQL becomes one LIKE per term). */
const MAX_TERMS = 16;
/** Per-run posting cap for the daily title pass (env-tunable). */
const TITLE_PASS_LIMIT = Math.max(1, Number(process.env.CAREER_TITLE_PASS_LIMIT) || 150);

/** A user's stored title-scoring profile (career_score_settings row, or the empty default). */
export interface TitleProfile {
  titleTerms: string[];
  source: 'unset' | 'derived' | 'user';
  lastTitlePassAt: string | null;
  lastCronScoreAt: string | null;
}

/** Outcome of one user's title pass, for logs and the run-now route. */
export interface TitlePassResult {
  ran: boolean;
  scored?: number;
  skipped?: number;
  reason?: string;
}

/**
 * @description The persistent "no more than once a ~day" guard shared by the title pass
 * and the boot catch-up score — same semantics as the digest's dueForDigest: due when
 * never run, due again only after GUARD_HOURS, and fails OPEN on an unparseable
 * timestamp (a broken cursor must never permanently disable scoring).
 * @param lastIso ISO timestamp of the last run, or null when never run
 * @param nowMs clock override for tests
 * @returns true when a new run is allowed
 */
export function dueSince(lastIso: string | Date | null, nowMs: number = Date.now()): boolean {
  if (!lastIso) return true;
  const t = new Date(lastIso).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs - t > GUARD_HOURS * 3_600_000;
}

/**
 * @description Normalize a user-supplied title list (comma/newline separated string, or an
 * array) into clean LIKE terms: trimmed, control-chars stripped (newline is the CH_TITLES
 * wire separator, so it can never survive inside a term), de-duplicated case-insensitively,
 * each 3..60 chars (1-2 char terms like "ai" would LIKE-match half the corpus and defeat
 * the bounding), capped at MAX_TERMS.
 * @param input raw terms from the settings form or API body
 * @returns clean, de-duplicated term list (possibly empty)
 */
/** Drop ASCII control characters (codepoints < 32 and DEL) — newline is the CH_TITLES
 *  wire separator, so no control char may ever survive inside a term. */
function stripControlChars(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c !== 127) out += ch;
  }
  return out;
}

export function normalizeTitleTerms(input: unknown): string[] {
  const raw: string[] = Array.isArray(input)
    ? input.map((t) => String(t))
    : String(input ?? '').split(/[,\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const term = stripControlChars(r).replace(/\s+/g, ' ').trim();
    if (term.length < 3 || term.length > 60) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

/**
 * @description Derive default title terms from a user's parsed resume roles — the REAL
 * seed source (career_db.json roles[].title, written by the resume-upload ingest). Each
 * role title is split on separators, stripped of seniority prefixes and trailing level
 * suffixes (LIKE '%term%' already matches any seniority of the same role, so "Senior SAP
 * Basis Administrator" seeds the broader "SAP Basis Administrator"), then normalized.
 * Returns [] when nothing is derivable — never a hardcoded guess.
 * @param roles the parsed resume roles ({title} objects)
 * @returns derived title terms, broadest-useful form, de-duplicated
 */
export function deriveTitleTermsFromRoles(roles: Array<{ title?: unknown }>): string[] {
  const candidates: string[] = [];
  for (const role of roles || []) {
    const title = String(role?.title ?? '').trim();
    if (!title) continue;
    for (const segment of title.split(/[/|,;]|\s[-–—]\s/)) {
      let t = segment.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
      // Strip leading seniority/level words (repeatedly: "Sr. Staff Engineer" -> "Engineer").
      for (;;) {
        const stripped = t.replace(/^(senior|sr\.?|staff|principal|lead|junior|jr\.?|associate|interim)\s+/i, '');
        if (stripped === t) break;
        t = stripped;
      }
      // Strip trailing level markers ("Engineer II", "Architect 3").
      t = t.replace(/\s+(i{1,3}v?|iv|v|\d)$/i, '').trim();
      if (t) candidates.push(t);
    }
  }
  return normalizeTitleTerms(candidates).slice(0, 12);
}

/**
 * @description Read the user's career_db.json (per-user, written by resume ingest) and
 * derive default title terms from its roles. Missing/unreadable file = [] (clean skip).
 * @param userSub the per-user store owner
 * @returns derived terms, or [] when no resume profile exists yet
 */
export function deriveTitleTermsFromResume(userSub: string): string[] {
  try {
    const careerDb = path.join(userPaths(userSub).userDir, 'career_db.json');
    if (!fs.existsSync(careerDb)) return [];
    const d = JSON.parse(fs.readFileSync(careerDb, 'utf8')) as { roles?: Array<{ title?: unknown }> };
    return deriveTitleTermsFromRoles(Array.isArray(d.roles) ? d.roles : []);
  } catch (err) {
    logger.error({ err, userSub }, 'title profile: resume derivation failed');
    return [];
  }
}

/**
 * @description Build the engine invocation for a bounded title pass: the oshal-jobhunter
 * `score-titles` verb, terms newline-joined into CH_TITLES (commas can appear inside a
 * term; newlines cannot survive normalizeTitleTerms), run cap in CH_LIMIT. Pure — exists
 * so tests can pin the exact wire format the Python side parses.
 * @param terms normalized title terms (must be non-empty; the engine refuses an empty list
 * because score_batch with a falsy title_any would score EVERYTHING unbounded)
 * @param limit max postings this run may AI-score
 * @returns CLI args + extra env for runCliAwait
 */
export function buildTitlePassInvocation(terms: string[], limit: number): { args: string[]; env: Record<string, string> } {
  return {
    args: ['score-titles'],
    env: {
      CH_TITLES: terms.join('\n'),
      CH_LIMIT: String(Math.max(1, Math.floor(limit))),
    },
  };
}

/** Map a career_score_settings row (or absence) to a TitleProfile. */
function toProfile(row?: { title_terms?: string[]; title_terms_source?: string; last_title_pass_at?: Date | string | null; last_cron_score_at?: Date | string | null }): TitleProfile {
  if (!row) return { titleTerms: [], source: 'unset', lastTitlePassAt: null, lastCronScoreAt: null };
  return {
    titleTerms: Array.isArray(row.title_terms) ? row.title_terms : [],
    source: row.title_terms_source === 'derived' || row.title_terms_source === 'user' ? row.title_terms_source : 'unset',
    lastTitlePassAt: row.last_title_pass_at ? new Date(row.last_title_pass_at).toISOString() : null,
    lastCronScoreAt: row.last_cron_score_at ? new Date(row.last_cron_score_at).toISOString() : null,
  };
}

/**
 * @description Read the user's stored title profile. Null-safe: no row = empty profile.
 * The cron uses this (it never seeds — only a settings visit does, so a user who never
 * opened settings costs nothing).
 * @param pool Postgres pool
 * @param userSub the user
 * @returns the stored profile, or the empty default
 */
export async function readTitleProfile(pool: AppContext['pool'], userSub: string): Promise<TitleProfile> {
  const r = await pool.query(
    `SELECT title_terms, title_terms_source, last_title_pass_at, last_cron_score_at
       FROM career_score_settings WHERE user_sub=$1`, [userSub]);
  return toProfile(r.rows[0]);
}

/**
 * @description Read the profile, seeding it from the user's parsed resume on first visit:
 * when no row exists and the resume yields terms, they are persisted as source='derived'
 * so the user sees (and can edit) exactly what the cron will run. No resume = the empty
 * profile, unsaved, so a later resume upload can still seed.
 * @param pool Postgres pool
 * @param userSub the user
 * @returns the stored or freshly seeded profile
 */
export async function getOrSeedTitleProfile(pool: AppContext['pool'], userSub: string): Promise<TitleProfile> {
  const existing = await pool.query(
    `SELECT title_terms, title_terms_source, last_title_pass_at, last_cron_score_at
       FROM career_score_settings WHERE user_sub=$1`, [userSub]);
  const current = toProfile(existing.rows[0]);
  // Seed only when there are no terms AND the user never saved (source='user' with an empty
  // list is a deliberate opt-out). Checking terms — not row existence — matters: markCronScore
  // creates a cursor-only row long before any settings visit, and the old "no row" test let
  // that row permanently block resume-derived seeding (every user showed no-title-profile).
  if (current.titleTerms.length || current.source === 'user') return current;
  const derived = deriveTitleTermsFromResume(userSub);
  if (!derived.length) return current;
  await pool.query(
    `INSERT INTO career_score_settings (user_sub, title_terms, title_terms_source)
     VALUES ($1, $2, 'derived')
     ON CONFLICT (user_sub) DO UPDATE SET title_terms=$2, title_terms_source='derived', updated_at=NOW()
     WHERE career_score_settings.title_terms_source IS DISTINCT FROM 'user'`, [userSub, derived]);
  logger.info({ userSub, terms: derived.length }, 'title profile: seeded from resume roles');
  return { ...current, titleTerms: derived, source: 'derived' };
}

/**
 * @description Save the user's edited title terms (source='user'). An empty list is a
 * valid save — it clears the profile and turns the daily title pass off for this user.
 * @param pool Postgres pool
 * @param userSub the user
 * @param terms already-normalized terms
 */
export async function saveTitleProfile(pool: AppContext['pool'], userSub: string, terms: string[]): Promise<void> {
  await pool.query(
    `INSERT INTO career_score_settings (user_sub, title_terms, title_terms_source)
     VALUES ($1, $2, 'user')
     ON CONFLICT (user_sub) DO UPDATE SET title_terms=$2, title_terms_source='user', updated_at=NOW()`,
    [userSub, terms]);
}

/**
 * @description Whether the cron/boot-catch-up keyword score may run for this user — the
 * persistent >20h guard (last_cron_score_at) that makes api recreates cheap: the in-memory
 * lastRun map dies with the process, this cursor does not.
 * @param pool Postgres pool
 * @param userSub the user
 * @returns true when a cron score is allowed
 */
export async function dueForCronScore(pool: AppContext['pool'], userSub: string): Promise<boolean> {
  const r = await pool.query(`SELECT last_cron_score_at FROM career_score_settings WHERE user_sub=$1`, [userSub]);
  return dueSince(r.rows[0]?.last_cron_score_at ?? null);
}

/**
 * @description Advance the persistent cron-score cursor after a cron-driven score run
 * (window AND catch-up), so a recreate later the same day skips the user entirely.
 * @param pool Postgres pool
 * @param userSub the user
 */
export async function markCronScore(pool: AppContext['pool'], userSub: string): Promise<void> {
  await pool.query(
    `INSERT INTO career_score_settings (user_sub, last_cron_score_at) VALUES ($1, NOW())
     ON CONFLICT (user_sub) DO UPDATE SET last_cron_score_at=NOW(), updated_at=NOW()`, [userSub]);
}

/** Parse the engine's JSON verdict line ({"scored":N,"skipped":M,...}) from CLI output. */
function parseEngineVerdict(out: string): { scored?: number; skipped?: number } {
  try {
    const line = out.trim().split('\n').reverse().find((l) => l.trim().startsWith('{'));
    if (!line) return {};
    const v = JSON.parse(line) as { scored?: number; skipped?: number };
    return { scored: v.scored, skipped: v.skipped };
  } catch { return {}; }
}

/**
 * @description Run one user's bounded title pass end-to-end: stored-profile gate → >20h
 * persistent guard → the SHARED per-user single-flight guard (verb key 'score', so a
 * title pass can never write the same per-user SQLite concurrently with a manual or cron
 * keyword score — SQLite is single-writer) → runCliAwait (NEVER spawnSync; the event loop
 * stays free) → advance the cursor only on a REAL successful run.
 * @param ctx app context (pool)
 * @param userSub the user
 * @param opts force bypasses the >20h guard (the explicit run-now button)
 * @returns what happened, for logs/routes
 */
export async function runTitlePassForUser(
  ctx: AppContext, userSub: string, opts: { force?: boolean } = {},
): Promise<TitlePassResult> {
  const profile = await readTitleProfile(ctx.pool, userSub);
  if (!profile.titleTerms.length) return { ran: false, reason: 'no-title-profile' };
  if (!opts.force && !dueSince(profile.lastTitlePassAt)) return { ran: false, reason: 'already-ran-today' };
  const acquired = tryAcquireRun(userSub, 'score');
  if (acquired !== 'ok') {
    logger.info({ userSub, acquired }, 'title pass: skipped — score run in flight or box busy');
    return { ran: false, reason: acquired === 'inflight' ? 'score-in-flight' : 'busy' };
  }
  try {
    const inv = buildTitlePassInvocation(profile.titleTerms, TITLE_PASS_LIMIT);
    const r = await runCliAwait(userSub, inv.args, inv.env);
    if (!r.ok) {
      logger.error({ userSub, err: r.err.slice(-400) }, 'title pass: engine run failed');
      return { ran: false, reason: 'engine-failed' };
    }
    const verdict = parseEngineVerdict(r.out);
    await ctx.pool.query(
      `INSERT INTO career_score_settings (user_sub, last_title_pass_at) VALUES ($1, NOW())
       ON CONFLICT (user_sub) DO UPDATE SET last_title_pass_at=NOW(), updated_at=NOW()`, [userSub]);
    logger.info({ userSub, ...verdict, terms: profile.titleTerms.length, limit: TITLE_PASS_LIMIT }, 'title pass: done');
    return { ran: true, ...verdict };
  } catch (err) {
    logger.error({ err, userSub }, 'title pass: failed');
    return { ran: false, reason: 'error' };
  } finally {
    releaseRun(userSub, 'score');
  }
}

/**
 * @description Settings-surface routes on the career-hunter router (parent-mounted behind
 * requiresAuth, per-user scoped by OIDC sub like every sibling): read/seed the profile,
 * save edited terms, and an explicit bounded run-now.
 * @param router the career-hunter router
 * @param ctx app context
 */
export function registerCareerTitleScoreRoutes(router: Router, ctx: AppContext): void {
  const pool = ctx.pool;

  router.get('/title-profile/state', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    try {
      const p = await getOrSeedTitleProfile(pool, userSub);
      res.json({ ...p, dailyLimit: TITLE_PASS_LIMIT });
    } catch (err) {
      logger.error({ err, userSub }, 'title profile: state read failed');
      res.status(500).json({ error: 'read failed' });
    }
  });

  router.post('/settings/title-profile', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    try {
      const terms = normalizeTitleTerms(req.body?.terms);
      await saveTitleProfile(pool, userSub, terms);
      logger.info({ userSub, terms: terms.length }, 'title profile: saved');
      res.json({ ok: true, titleTerms: terms });
    } catch (err) {
      logger.error({ err, userSub }, 'title profile: save failed');
      res.status(500).json({ error: 'save failed' });
    }
  });

  router.post('/title-pass/run-now', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    try {
      const r = await runTitlePassForUser(ctx, userSub, { force: true });
      const status = r.ran ? 200
        : r.reason === 'no-title-profile' ? 400
          : r.reason === 'score-in-flight' ? 409
            : r.reason === 'busy' ? 429
              : 500;
      res.status(status).json(r);
    } catch (err) {
      logger.error({ err, userSub }, 'title pass: run-now failed');
      res.status(500).json({ ran: false, reason: 'error' });
    }
  });
}
