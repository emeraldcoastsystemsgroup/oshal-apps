/**
 * Career Hunter Routes — OSHAL app API
 *
 * Surfaces (iframe): /board (wrapped per-user engine dashboard), /approvals (the
 * human-in-the-loop application queue), /settings (Anthropic connect + Firecrawl key + cron).
 * Per-user data is isolated by OIDC sub: a shared jobs corpus + a per-user SQLite signals DB.
 * Approvals drive `career-application` tickets (approval_required -> approved -> in_process_build
 * -> customer_action / cancelled) and run the engine CLI to draft the tailored resume + cover.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                          | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-16 18:10:00 | roger.murphy@agenticfederal.us | Initial Career-Hunter routes: board proxy, approvals + settings surfaces, enqueue/approve/approve-oshal/deny with ticket sync, per-user Anthropic/Firecrawl key storage (encrypted oshal_connections).
 * 2026-06-17 08:40:00 | roger.murphy@agenticfederal.us | Fix Express 5 boot crash: board wildcard route '/board/*' -> '/board/*boardPath' (path-to-regexp v8 requires a named wildcard). Was an uncaught exception that exited the process on mount.
 * 2026-07-06 14:42:00 | roger.murphy@emeraldcoastsystemsgroup.com | Serve the phone-first mobile surface at GET /mobile (career-mobile.html): swipe deck (approve/deny), packet review card, and the auto-apply status board. Rides existing endpoints (applications/jobs/resume/enqueue-drafts/approve/deny + apply-operator submit/inflight); no new data routes.
 * 2026-07-12 01:57:00 | roger.murphy@emeraldcoastsystemsgroup.com | Fix user-reported resume-link 404s (dev-bot RCA c36c5dfb): GET /resume/:id now serves as an alias for GET /resume?id=&kind= — circulated links (digest emails/bot text) use the path shape, which matched no route. Registered last so /resume/doc|state|upload keep precedence; serving logic shared via serveResumeFile().
 * 2026-07-15 01:38:00 | roger.murphy@emeraldcoastsystemsgroup.com | Fix front-end wedge: POST /run/:verb ran the engine via spawnSync, blocking the entire Node event loop for the whole multi-minute LLM run — a single third-party /run/{match,score} froze the whole front end for ~76 min (health check dead, all loopback timed out). Now spawns async and awaits exit (event loop stays free to serve /health + everyone else), guarded by per-user+verb single-flight (409) and a global ceiling (CAREER_HUNTER_MAX_RUNS, default 3 → 429) so runs can't stack and pin the box.
 * 2026-07-15 17:28:14 | roger.murphy@emeraldcoastsystemsgroup.com | Title-pass productization support: single-flight guard extracted to exported tryAcquireRun/releaseRun (career-title-score's cron pass shares the same per-user 'score' key, so a title pass and a keyword score can never write the same per-user SQLite concurrently); runUserScore accepts an optional --limit bound (the boot catch-up's spend cap — --days is a documented no-op on null posted_date); register the title-profile settings/run routes.
 * 2026-07-17 02:05:00 | roger.murphy@emeraldcoastsystemsgroup.com | Admin refresh trigger (operator: run the whole jobs pipeline from the cockpit, no dev-tool round-trips): POST /run/refresh fires the SAME evening scrape+index chain the 18:00 cron runs, detached, single-flighted in the cron module; GET /run/refresh reports {running, corpusFreshAt}. Auth = career admin via OIDC session OR a trusted in-container service call (X-Service-Secret + X-Oshal-User-Sub, still admin-checked) — the career_refresh bot tool's path. listStoreUsers now excludes underscore-prefixed dirs (backup dirs parked in the tenant dir had become phantom cron users).
 * 2026-07-21 21:40:00 | roger.murphy@emeraldcoastsystemsgroup.com | Fix operator-reported board misbehavior: dismissed jobs came back on every reload. Dismiss persists user_signals.status='dismissed' and the surface animates the card away without reloading (ac34b79), but GET /jobs only filtered on status when the caller named one — so the default feed still returned dismissed rows, and they re-rendered with no Dismiss button (the surface hides it at that status), leaving un-clearable cards. 70 were sitting in the live default view. buildJobFilters now excludes dismissed unless an explicit status is requested (the "Dismissed" tab sends status=dismissed and still lists them), and is hoisted to module scope + exported so the rule is directly testable.
 * 2026-07-21 22:05:00 | roger.murphy@emeraldcoastsystemsgroup.com | Fix carve regression surfaced by the same board report: the engine CLI const was hardcoded to cwd()/scripts/oshal-jobhunter.js, but the carve (core 7194f417) deleted that file from the framework — the package ships its own at bin/. Every engine spawn died with MODULE_NOT_FOUND, so the board's Match/Score buttons did nothing and the nightly title pass logged titlePass:{ran:false,reason:'engine-failed'} for every user. Resolution is now override → packaged bin (sibling of compiled routes/) → legacy core path, via exported resolveEngineCli().
 * 2026-07-24 02:40:00 | roger.murphy@emeraldcoastsystemsgroup.com | Explicit opt-in automation gate (operator directive 2026-07-24: drafts were auto-generated + queued for jobs the operator never picked). enqueueForUser now takes a trigger and DEFAULT-DENIES automated callers unless the user's career_automation_settings row (migration 091) explicitly opts in to auto_generate — absent row = OFF. The human /enqueue-drafts click passes trigger:'manual' and keeps working. Settings routes registered via registerCareerAutomationRoutes (career-automation module).
 *
 * @module career-hunter-routes
 */
import { Router, type Request, type Response, type RequestHandler } from 'express';
import path from 'path';
import fs from 'fs';
import { spawnSync, spawn, type ChildProcess } from 'child_process';
import Database from 'better-sqlite3';
import multer from 'multer';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { getTrustedServiceUserSub } from '@/shared/middleware/authz';
import { encryptToken, decryptToken } from '@/app/routes/connector-token-crypto';
import { registerCareerResumeStudio } from './career-resume-studio-routes';
import { registerCareerProfileStudio } from './career-profile-studio-routes';
import { registerCareerDigestRoutes } from './career-digest';
import { registerCareerAutomationRoutes, readAutomationSettingsSystem } from './career-automation';
import { registerCareerArtifacts } from './career-artifacts';
import { registerCareerJobGuide } from './career-job-guide';
import { registerCareerTitleScoreRoutes } from './career-title-score';
import { fetchBoardPage } from './career-board-feed';
import { buildPreviewHtml, resolvePreviewPath } from './career-resume-preview';

const logger = createChildLogger({ module: 'career-hunter-routes' });
const TOOL_DIR = path.resolve(__dirname, '..', 'tools'); // ADR-085: surfaces ship in this package's tools/ (compiled file lives in <pkg>/routes/)
/**
 * @description Resolves the jobhunter engine CLI. ADR-085: the CLI ships in THIS package
 *   (`bin/`), a sibling of the compiled `routes/` — the carve deleted core's
 *   `scripts/oshal-jobhunter.js`, so the old hardcoded `cwd()/scripts` path dangled and every
 *   engine spawn died with "Cannot find module '/app/scripts/oshal-jobhunter.js'" (the board's
 *   Match/Score buttons and the nightly title pass, silently, for every user).
 *   Order: explicit override → packaged bin → legacy core path (pre-carve checkouts).
 * @returns Absolute path to the engine CLI entrypoint.
 */
export function resolveEngineCli(): string {
  if (process.env.JOBHUNTER_CLI) return process.env.JOBHUNTER_CLI;
  const packaged = path.resolve(__dirname, '..', 'bin', 'oshal-jobhunter.js');
  const legacy = path.resolve(process.cwd(), 'scripts', 'oshal-jobhunter.js');
  return [packaged, legacy].find((p) => fs.existsSync(p)) || packaged;
}
const CLI = resolveEngineCli();
const STORE_ROOT = process.env.JOBHUNTER_STORE_ROOT || path.resolve(process.cwd(), 'apps', 'career-hunter', 'data');
const TENANT = 'default'; // single-tenant now; reserved everywhere a user is scoped.

// callerSub extracted to the kernel (@/app/routes/caller-sub) at the ADR-085 carve —
// apply-operator + notify routes (core) share it. Re-exported for this package's siblings.
export { callerSub } from '@/app/routes/caller-sub';
import { callerSub } from '@/app/routes/caller-sub';

export function userPaths(userSub: string) {
  const tenantDir = path.join(STORE_ROOT, TENANT);
  const userDir = path.join(tenantDir, userSub);
  return {
    userDir,
    corpusDb: path.join(tenantDir, 'corpus.db'),
    userDb: path.join(userDir, `user-${userSub}.db`),
  };
}

/** Open the user's signals DB with the shared corpus ATTACHed. Null if not seeded yet.
 *  The two pragmas matter on this store: corpus.db is ~2GB and SQLite's default 2MB page cache
 *  re-reads the same b-tree interior pages on every request. A 64MB cache plus a 256MB mmap
 *  window keeps the hot index pages resident for the cost of ~2ms at open (measured), which is
 *  why the handle is still opened per request rather than pooled — pooling would buy the same 2ms
 *  and add a stale-inode failure mode after the nightly corpus rebuild. */
export function openUserDb(userSub: string, readonly = true): any {
  const { corpusDb, userDb } = userPaths(userSub);
  if (!fs.existsSync(corpusDb) || !fs.existsSync(userDb)) return null;
  const db = new Database(userDb, { readonly });
  db.exec(`ATTACH DATABASE '${corpusDb.replace(/'/g, "''")}' AS corpus`);
  try {
    db.pragma('cache_size=-65536');
    db.pragma('mmap_size=268435456');
  } catch (err) { logger.warn({ err }, 'career db pragma tuning skipped'); }
  return db;
}

/** Career-hunter admin allow-list. Company-URL remediation writes to the SHARED corpus
 *  (every user's board), so it is gated to admins — config-driven, mirroring the platform's
 *  operator model rather than a new RLS-governed table. FAIL-CLOSED: empty by default, so a
 *  fresh deployment has NO career admin until CAREER_HUNTER_ADMIN_SUBS (comma-separated) is set. */
const CAREER_ADMIN_SUBS = new Set(
  (process.env.CAREER_HUNTER_ADMIN_SUBS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
);
export function isCareerAdmin(sub: string | null): boolean {
  return !!sub && CAREER_ADMIN_SUBS.has(sub);
}
/** Gate a route to career-hunter admins (403 otherwise). */
const requireCareerAdmin: RequestHandler = (req, res, next) => {
  if (!isCareerAdmin(callerSub(req))) { res.status(403).json({ error: 'admin only' }); return; }
  next();
};

function serveFile(fileName: string): RequestHandler {
  return (_req: Request, res: Response) => {
    // Always revalidate so rebuilt board/settings HTML isn't served stale by browser/CF cache.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(TOOL_DIR, fileName), (err: unknown) => {
      if (err) { logger.error({ err, fileName }, 'serve failed'); res.status(404).send('Not found'); }
    });
  };
}

function cliEnv(userSub: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, OSHAL_USER_SUB: userSub, OSHAL_TENANT: TENANT, JOBHUNTER_STORE_ROOT: STORE_ROOT, ...extra };
}
/** Spawn the per-user engine CLI synchronously (scoped to the signed-in user). extraEnv
 *  passes CH_KEY/CH_RESP/CH_STATUS etc. without shell quoting. */
export function runCli(userSub: string, args: string[], extraEnv: Record<string, string> = {}): { ok: boolean; out: string; err: string } {
  const r = spawnSync('node', [CLI, ...args], { env: cliEnv(userSub, extraEnv), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').slice(-200000), err: (r.stderr || '').slice(-4000) };
}
/** Fire-and-forget the engine CLI (for LLM-bearing verbs that must not block the controller). */
export function runCliAsync(userSub: string, args: string[], extraEnv: Record<string, string> = {}): void {
  const proc = spawn('node', [CLI, ...args], { env: cliEnv(userSub, extraEnv), stdio: 'ignore', detached: false });
  proc.on('exit', (code) => logger.info({ verb: args.slice(0, 2), code }, 'career CLI (async) finished'));
}
/** Run the engine CLI and RESOLVE with its result on exit — same shape as runCli, but WITHOUT
 *  blocking the event loop, so /health and every other request stay served during a long,
 *  LLM-bearing run. Callers that need the output (the /run/:verb "Run now" + board onboarding)
 *  must use this, never spawnSync: a single synchronous score/match froze the whole front end
 *  for the entire multi-minute run (Enrique-triggered outage, 2026-07-15). */
export function runCliAwait(userSub: string, args: string[], extraEnv: Record<string, string> = {}): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI, ...args], { env: cliEnv(userSub, extraEnv), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    proc.stdout?.on('data', (d) => { out += String(d); if (out.length > 400000) out = out.slice(-200000); });
    proc.stderr?.on('data', (d) => { err += String(d); if (err.length > 8000) err = err.slice(-4000); });
    proc.on('exit', (code) => resolve({ ok: code === 0, out: out.slice(-200000), err: err.slice(-4000) }));
    proc.on('error', (e) => resolve({ ok: false, out, err: String((e as Error)?.message || e) }));
  });
}

// ── /run/:verb concurrency guard ─────────────────────────────────────────────
// A manual pull/score/match spawns the engine + a per-posting codex fan-out. Bound it so a
// double-click, the board onboarding, and many users can't stack heavy runs and pin the box:
// single-flight per user+verb, plus a small global ceiling (env CAREER_HUNTER_MAX_RUNS, default 3).
const runsInFlight = new Set<string>();
const MAX_CONCURRENT_RUNS = Math.max(1, Number(process.env.CAREER_HUNTER_MAX_RUNS) || 3);

/**
 * @description Try to claim the per-user+verb run slot. Shared by POST /run/:verb and the
 * cron title pass (career-title-score) so ALL engine runs honor the same single-flight +
 * global-ceiling rules — the per-user SQLite is single-writer, and unbounded stacked runs
 * are what wedged the box on 2026-07-15. Callers MUST releaseRun() in a finally.
 * @param userSub the run's user scope
 * @param verb the engine verb key (title passes share 'score' — same DB writer)
 * @returns 'ok' when claimed; 'inflight' when this user+verb is already running; 'busy'
 * when the global ceiling is reached
 */
export function tryAcquireRun(userSub: string, verb: string): 'ok' | 'inflight' | 'busy' {
  const key = `${userSub}:${verb}`;
  if (runsInFlight.has(key)) return 'inflight';
  if (runsInFlight.size >= MAX_CONCURRENT_RUNS) return 'busy';
  runsInFlight.add(key);
  return 'ok';
}

/**
 * @description Release a run slot claimed by tryAcquireRun. Safe to call for a key that
 * was never claimed (Set.delete is idempotent).
 * @param userSub the run's user scope
 * @param verb the engine verb key used at acquire time
 * @returns nothing
 */
export function releaseRun(userSub: string, verb: string): void {
  runsInFlight.delete(`${userSub}:${verb}`);
}

// ── Per-user dashboard (board) lazy process manager ──────────────────────────
const boards = new Map<string, { port: number; proc: ChildProcess }>();
let nextPort = 5100;
function ensureBoard(userSub: string): number {
  const existing = boards.get(userSub);
  if (existing && !existing.proc.killed) return existing.port;
  const port = nextPort++;
  const proc = spawn('node', [CLI, 'board', '--port', String(port)], {
    env: { ...process.env, OSHAL_USER_SUB: userSub, OSHAL_TENANT: TENANT, JOBHUNTER_STORE_ROOT: STORE_ROOT },
    detached: false, stdio: 'ignore',
  });
  proc.on('exit', () => { if (boards.get(userSub)?.proc === proc) boards.delete(userSub); });
  boards.set(userSub, { port, proc });
  return port;
}

/** Create approval_required application tickets for a user's top-N fresh scored roles.
 *  Shared by the /enqueue-drafts route and the cron. Returns how many were created.
 *  AUTOMATION IS EXPLICIT OPT-IN (operator directive 2026-07-24): any caller that is not a
 *  direct human action (trigger 'manual') is gated server-side on the user's auto_generate
 *  opt-in — absent row = OFF, so the cron generates NOTHING for a user who never opted in. */
export async function enqueueForUser(
  ctx: AppContext, userSub: string, limit = 10,
  opts: { trigger?: 'manual' | 'cron' } = {},
): Promise<number> {
  if (opts.trigger !== 'manual') {
    const auto = await readAutomationSettingsSystem(ctx, userSub);
    if (!auto.autoGenerate) {
      logger.info({ userSub }, 'auto-draft enqueue skipped: user has not opted in to automation');
      return 0;
    }
  }
  const pool = ctx.pool;
  const db = openUserDb(userSub);
  if (!db) return 0;
  let rows: Array<{ id: number; title: string; company: string; fit: number; salary_max: number | null; url: string }>;
  try {
    rows = db.prepare(
      `SELECT pc.id, pc.title, co.name AS company, us.ai_fit_score AS fit, pc.salary_max, pc.url
         FROM corpus.postings_corpus pc
         JOIN corpus.companies co ON co.id = pc.company_id
         JOIN user_signals us ON us.posting_id = pc.id
        WHERE pc.active=1 AND pc.target_role=1 AND us.ai_fit_score IS NOT NULL
          AND COALESCE(us.status,'new')='new'
        ORDER BY us.ai_fit_score DESC LIMIT ?`).all(Math.min(50, Math.max(1, limit))) as typeof rows;
  } finally { db.close(); }
  let created = 0;
  for (const r of rows) {
    const exists = (await pool.query(
      `SELECT 1 FROM career_hunter_applications WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`,
      [TENANT, userSub, r.id])).rowCount;
    if (exists) continue;
    const ticket = await ctx.ticketService.createTicket({
      title: `Apply: ${r.title} — ${r.company}`,
      ticketType: 'career-application',
      description: `Draft a tailored resume + cover letter for posting ${r.id} (${r.title} at ${r.company}, AI fit ${r.fit}). Awaiting operator approval (standard or OSHAL variant).`,
      status: 'approval_required',
      priority: 'none',
      labels: [],
      workspaceId: null,
      assignedAgentId: null,
      parentTicketId: null,
      externalProvider: null,
      externalId: null,
      externalUrl: null,
      metadata: { posting_id: r.id, company: r.company, title: r.title, tenant: TENANT, url: r.url },
      ownerSub: userSub,
    });
    await pool.query(
      `INSERT INTO career_hunter_applications (tenant_id, user_sub, ticket_id, posting_id, company, title, status)
       VALUES ($1,$2,$3,$4,$5,$6,'approval_required')
       ON CONFLICT (tenant_id, user_sub, posting_id) DO NOTHING`,
      [TENANT, userSub, ticket.ticketId, r.id, r.company, r.title]);
    created++;
  }
  return created;
}

/** List the user_subs that have a per-user store (for cron fan-out). Underscore-prefixed
 *  dirs are excluded: backup/parking dirs inside the tenant dir (`_backup_premerge`) are NOT
 *  users, and every dir here becomes a cron fan-out target (score/digest) — the phantom-user
 *  hazard the cutover runbook warns about. */
export function listStoreUsers(): string[] {
  const tenantDir = path.join(STORE_ROOT, TENANT);
  try {
    return fs.readdirSync(tenantDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name);
  } catch { return []; }
}

/** Run the shared corpus pull (scrape + keyword index) once for all users.
 *  NON-BLOCKING: spawns the engine and resolves on exit, so the API event loop
 *  stays responsive during the multi-hour scrape. (spawnSync froze the whole
 *  server nightly; a mid-scrape restart also lost the run — the incident that
 *  motivated moving off spawnSync here.) */
export function runSharedPull(anyUserSub: string): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI, 'pull'], {
      env: { ...process.env, OSHAL_USER_SUB: anyUserSub, OSHAL_TENANT: TENANT, JOBHUNTER_STORE_ROOT: STORE_ROOT },
      stdio: 'ignore',
    });
    proc.on('exit', (code) => resolve({ ok: code === 0 }));
    proc.on('error', () => resolve({ ok: false }));
  });
}

/** Keyword-index (match.rescore_recent) the shared corpus into ONE user's signals — the
 *  per-user half of the nightly index. runSharedPull's `pull` verb already does this for the
 *  scrape-invoking user; the evening chain runs THIS for every OTHER store so newly-scraped
 *  rows get a fit_score in each user's board (and thus become eligible for AI scoring). No LLM. */
export function runUserMatch(userSub: string): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI, 'match'], {
      env: { ...process.env, OSHAL_USER_SUB: userSub, OSHAL_TENANT: TENANT, JOBHUNTER_STORE_ROOT: STORE_ROOT, CH_MATCH_DAYS: '14' },
      stdio: 'ignore',
    });
    proc.on('exit', (code) => resolve({ ok: code === 0 }));
    proc.on('error', () => resolve({ ok: false }));
  });
}

/** Run per-user AI scoring. `opts.firstSeenDays` adds `--first-seen-days N` — the reliable
 *  NEW-jobs gate (first_seen_at is stamped on every row at scrape/import; posted_date is not, so
 *  `--days` silently no-ops). The operator's model is ONE index per candidate against NEW jobs,
 *  so the nightly run bounds itself to jobs new to the corpus rather than re-draining history.
 *  `opts.limit` adds `--limit N` (the boot catch-up's per-run spend cap). Scoring is idempotent
 *  (only `ai_fit_score IS NULL` roles cost anything). */
export function runUserScore(userSub: string, opts: { limit?: number; firstSeenDays?: number } = {}): Promise<{ ok: boolean }> {
  const args = ['score', '--min-keyword', '40'];
  if (opts.firstSeenDays && Number.isFinite(opts.firstSeenDays)) args.push('--first-seen-days', String(Math.max(1, Math.floor(opts.firstSeenDays))));
  if (opts.limit && Number.isFinite(opts.limit)) args.push('--limit', String(Math.max(1, Math.floor(opts.limit))));
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI, ...args], {
      env: { ...process.env, OSHAL_USER_SUB: userSub, OSHAL_TENANT: TENANT, JOBHUNTER_STORE_ROOT: STORE_ROOT },
      stdio: 'ignore',
    });
    proc.on('exit', (code) => resolve({ ok: code === 0 }));
    proc.on('error', () => resolve({ ok: false }));
  });
}

/**
 * The board feed's filter composition and query plan live in `./career-board-feed`. Re-exported
 * here because that is where the dismissed-exclusion rule has always been imported from, and the
 * rule itself is load-bearing: dismissed jobs are excluded unless the caller asks for a specific
 * status. The board's Dismiss button persists `user_signals.status='dismissed'` and animates the
 * card away WITHOUT reloading, so a feed that still returned dismissed rows looked correct until
 * the next refresh — then every dismissed job reappeared, and rendered with no Dismiss button (the
 * surface hides it at that status), leaving un-clearable cards. The "Dismissed" pipeline tab sends
 * `status=dismissed`, which takes the explicit branch and still lists them.
 */
export { buildJobFilters } from './career-board-feed';

export function createCareerHunterRoutes(ctx: AppContext): Router {
  const router = Router();
  const pool = ctx.pool;
  // Start the gated daily cron (no-op unless CAREER_HUNTER_CRON=1).
  try {
    // Lazy require to avoid a circular import at module-eval time.
    (require('./career-hunter-cron') as typeof import('./career-hunter-cron')).startCareerHunterCron(ctx);
  } catch (err) { logger.warn({ err }, 'career-hunter cron not started'); }

  // ── Surfaces (iframe HTML) + static assets ────────────────────────────────
  router.get('/board-native', serveFile('career-board.html')); // native board (reads /jobs); /board stays the legacy Flask proxy ("Classic dashboard")
  router.get('/recruiters-ui', serveFile('career-recruiters.html')); // native recruiters tracker surface
  router.get('/strengthen-ui', serveFile('career-strengthen.html')); // native resume-strengthen surface
  router.get('/insights-ui', serveFile('career-insights.html')); // native analytics/insights surface
  router.get('/approvals', serveFile('career-approvals.html'));
  router.get('/settings', serveFile('career-settings.html'));
  router.get('/resume-studio', serveFile('career-resume-studio.html')); // hover-bot live resume editor
  router.get('/mobile', serveFile('career-mobile.html')); // phone-first swipe deck + review + auto-apply status board
  // Submissions — the print-queue view of the desktop worker: reachability, the ticket lanes, and the
  // narrated screenshot story per run. Read-only over the core /api/apply-operator engine endpoints.
  router.get('/submissions', serveFile('career-submissions.html'));
  router.get('/static/:file', (req, res) => {
    const file = path.basename(req.params.file);
    if (!/\.(css|js|png|svg)$/.test(file)) { res.status(404).end(); return; }
    res.sendFile(path.join(TOOL_DIR, file), (err: unknown) => { if (err) res.status(404).end(); });
  });

  // Resume Studio data + bot loop (GET /resume/doc, POST /resume/guide, POST /resume/save).
  // Kept in its own module so this file stays under the 800-line decomposition threshold.
  registerCareerResumeStudio(router, ctx);

  // Profile Studio — LinkedIn profile plan + desktop browser-control dispatch (own module).
  registerCareerProfileStudio(router, ctx);

  // Daily digest settings + preview + send-now (module: career-digest; cron calls its batch).
  registerCareerDigestRoutes(router, ctx);

  // Automation opt-in state + save (module: career-automation; DEFAULT OFF — the cron's
  // generate/enqueue steps and the bulk submit rail gate on these flags server-side).
  registerCareerAutomationRoutes(router, ctx);

  // Upload MORE than a resume (work samples, emails, LinkedIn export, status reports) -> absorb
  // into the profile; and "talk to the job" (per-posting conversational agent that does the work).
  registerCareerArtifacts(router, ctx);
  registerCareerJobGuide(router, ctx);

  // Per-user title-based scoring pass: profile state/save + bounded run-now
  // (module: career-title-score; the cron runs its daily bounded batch).
  registerCareerTitleScoreRoutes(router, ctx);

  // ── Board: proxy to the user's lazily-started dashboard ───────────────────
  const proxyBoard: RequestHandler = async (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).send('Sign in first.'); return; }
    if (!openUserDb(userSub)) {
      res.set('Content-Type', 'text/html').send(
        '<body style="font:14px system-ui;padding:24px;color:#33414f">Your job board is empty. ' +
        'Run a <b>pull</b> from Career Settings, or wait for the nightly refresh.</body>');
      return;
    }
    const port = ensureBoard(userSub);
    const sub = req.path.replace(/^\/board/, '') || '/';
    const target = `http://127.0.0.1:${port}${sub}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
    try {
      // Give a freshly-spawned dashboard a moment to bind.
      let upstream: globalThis.Response | null = null;
      for (let i = 0; i < 20; i++) {
        try { upstream = await fetch(target); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
      }
      if (!upstream) { res.status(502).send('Board starting, retry in a moment.'); return; }
      res.status(upstream.status);
      const ct = upstream.headers.get('content-type'); if (ct) res.set('Content-Type', ct);
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      logger.error({ err }, 'board proxy failed');
      res.status(502).send('Board unavailable.');
    }
  };
  router.get('/board', proxyBoard);
  router.get('/board/*boardPath', proxyBoard);

  // ── Companies admin — ADMIN ONLY. View every company + its detected board, and paste a
  //    real careers/jobs URL to re-detect the ATS + scrape (writes to the SHARED corpus). ──
  router.get('/companies-admin', requireCareerAdmin, serveFile('career-companies.html'));
  router.get('/companies-admin/list', requireCareerAdmin, (req, res) => {
    const sub = callerSub(req);
    const db = sub && openUserDb(sub);
    if (!db) { res.json({ companies: [] }); return; }
    try {
      const companies = db.prepare(
        `SELECT c.id, c.name, c.ats_type, c.ats_token, c.careers_url, c.discover_status,
                (SELECT COUNT(*) FROM corpus.postings_corpus p WHERE p.company_id=c.id AND p.active=1) AS active_jobs
           FROM corpus.companies c
          ORDER BY active_jobs DESC, c.name`).all();
      res.json({ companies });
    } finally { db.close(); }
  });
  // POST via query params (companyId, url) so no body-parser dependency. Synchronous scrape
  // of ONE company — fine for a manual admin action; returns the engine's JSON verdict.
  router.post('/companies-admin/seturl', requireCareerAdmin, (req, res) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const companyId = parseInt(String(req.query.companyId ?? ''), 10);
    const url = String(req.query.url ?? '').trim();
    if (!companyId || !url) { res.status(400).json({ error: 'companyId and url required' }); return; }
    const r = runCli(sub, ['seturl', '--company-id', String(companyId), '--url', url]);
    let result: unknown = null;
    try { result = JSON.parse((r.out || '').trim().split('\n').pop() || '{}'); } catch { /* keep raw */ }
    res.json({ ok: r.ok, result, error: r.ok ? undefined : (r.err || '').slice(-300) });
  });

  // ── Applications queue (JSON for the approvals surface) ────────────────────
  router.get('/applications', async (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const rows = (await pool.query(
      `SELECT posting_id, company, title, include_oshal, status, ticket_id, updated_at
         FROM career_hunter_applications WHERE tenant_id=$1 AND user_sub=$2
        ORDER BY updated_at DESC LIMIT 200`, [TENANT, userSub])).rows;
    res.json({ applications: rows });
  });

  // ── Native board data — the user's ranked feed over the shared corpus.
  //    Filters: q/min_score/company/remote/state/type/days/min_pay/status/source/lane.
  //    Sort: ai/prob/highwin/keyword/salary/company/posted/recent/generated/applied.
  //    Planning (candidate pool, filter push-down, tail-fill) lives in ./career-board-feed —
  //    see that module for why this is not one flat join. Response carries `pooled`/`poolSize`
  //    so the surface can say what a corpus-keyed sort was ranked within.
  router.get('/jobs', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const db = openUserDb(userSub);
    if (!db) { res.json({ jobs: [], empty: true }); return; }
    const started = Date.now();
    try {
      const result = fetchBoardPage(db, req.query as Record<string, unknown>);
      logger.info({
        userSub, sort: req.query.sort || 'ai', per: result.per, page: result.page,
        rows: result.jobs.length, poolSize: result.poolSize, ms: Date.now() - started,
      }, 'career board feed served');
      res.json(result);
    } catch (err) {
      logger.error({ err, ms: Date.now() - started }, 'career jobs read failed');
      res.status(500).json({ error: 'read failed' });
    } finally { try { db.close(); } catch { /* */ } }
  });

  // ── Board summary: counts by status (the surface header / pipeline tabs) ───
  router.get('/jobs/stats', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const db = openUserDb(userSub);
    if (!db) { res.json({ byStatus: [], total: 0, empty: true }); return; }
    try {
      // Grouping on the bare column (not COALESCE(NULLIF(...))) is what lets this ride
      // idx_user_status as a covering scan instead of evaluating an expression per row over
      // ~1.3M signals; the empty/NULL bucket is folded in JS. Totalling the groups also drops
      // the separate COUNT(*), so the whole endpoint is one index pass (402ms -> 180ms measured).
      const raw = db.prepare(
        'SELECT status, COUNT(*) AS n FROM user_signals GROUP BY status'
      ).all() as { status: string | null; n: number }[];
      const buckets = new Map<string, number>();
      let total = 0;
      for (const row of raw) {
        const key = row.status || '(scored)';
        buckets.set(key, (buckets.get(key) || 0) + row.n);
        total += row.n;
      }
      const byStatus = [...buckets].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n);
      res.json({ byStatus, total });
    } catch (err) {
      logger.error({ err }, 'career jobs stats failed');
      res.status(500).json({ error: 'stats failed' });
    } finally { try { db.close(); } catch { /* */ } }
  });

  // ── Analytics: the insights + funnel + distributions (Phase 5) ────────────
  //    Consolidates the engine's insights/report/ready/progress/map metrics. Salary
  //    is sanity-capped at $1M so a few mis-parsed source rows don't skew averages.
  router.get('/analytics', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const db = openUserDb(userSub);
    if (!db) { res.json({ empty: true }); return; }
    try {
      const LANE = 'FROM corpus.postings_corpus p LEFT JOIN user_signals s ON s.posting_id=p.id WHERE p.active=1 AND COALESCE(p.target_role,0)=1';
      const SCORE = 'COALESCE(s.ai_fit_score,s.fit_score,0)';
      const PAY = 'CASE WHEN p.salary_max>0 AND p.salary_max<=1000000 THEN p.salary_max END';
      const headline = db.prepare(
        `SELECT COUNT(*) AS inlane,
                SUM(CASE WHEN ${SCORE}>=70 THEN 1 ELSE 0 END) AS fit70,
                SUM(CASE WHEN ${SCORE}>=80 THEN 1 ELSE 0 END) AS fit80,
                SUM(CASE WHEN p.posted_date>=date('now','-7 days') THEN 1 ELSE 0 END) AS fresh7d,
                CAST(AVG(CASE WHEN ${SCORE}>=70 THEN ${PAY} END) AS INT) AS avg_pay_fit70,
                COUNT(DISTINCT p.company_id) AS companies ${LANE}`
      ).get();
      const funnel = db.prepare(
        `SELECT
           (SELECT COUNT(*) ${LANE}) AS sourced,
           (SELECT COUNT(*) ${LANE} AND ${SCORE}>=70) AS qualified,
           (SELECT COUNT(*) FROM user_signals WHERE status='generated') AS generated,
           (SELECT COUNT(*) FROM user_signals WHERE status='applied') AS applied,
           (SELECT COUNT(*) FROM user_signals WHERE status='interview') AS interview,
           (SELECT COUNT(*) FROM user_signals WHERE status='offer') AS offer,
           (SELECT COUNT(*) FROM user_signals WHERE status='promoted') AS promoted`
      ).get();
      const topCompanies = db.prepare(
        `SELECT c.name AS company, COUNT(*) AS roles, CAST(AVG(${SCORE}) AS INT) AS avg_fit, MAX(COALESCE(c.referral,0)) AS referral
         FROM corpus.postings_corpus p JOIN corpus.companies c ON c.id=p.company_id LEFT JOIN user_signals s ON s.posting_id=p.id
         WHERE p.active=1 AND COALESCE(p.target_role,0)=1 GROUP BY c.id ORDER BY roles DESC, avg_fit DESC LIMIT 12`
      ).all();
      const states = db.prepare(
        `SELECT COALESCE(NULLIF(p.state,''),'(remote/—)') AS state, COUNT(*) AS n ${LANE} GROUP BY 1 ORDER BY n DESC LIMIT 12`
      ).all();
      const salaryBands = db.prepare(
        `SELECT CASE WHEN ${PAY} IS NULL THEN 'n/a' WHEN ${PAY}<150000 THEN '<150k' WHEN ${PAY}<200000 THEN '150-200k'
                     WHEN ${PAY}<250000 THEN '200-250k' WHEN ${PAY}<350000 THEN '250-350k' ELSE '350k+' END AS band, COUNT(*) AS n
         ${LANE} AND ${SCORE}>=70 GROUP BY band ORDER BY n DESC`
      ).all();
      res.json({ headline, funnel, topCompanies, states, salaryBands });
    } catch (err) {
      logger.error({ err }, 'analytics failed');
      res.status(500).json({ error: 'analytics failed' });
    } finally { try { db.close(); } catch { /* */ } }
  });

  // ── Serve a generated resume/cover PDF from the per-user volume (scoped) ───
  // Shared by GET /resume?id=&kind= and the GET /resume/:id alias below.
  const serveResumeFile = (req: Request, res: Response, postingId: number) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const kind = req.query.kind === 'cover' ? 'cover_path' : 'resume_path';
    if (!Number.isFinite(postingId)) { res.status(400).json({ error: 'id required' }); return; }
    const db = openUserDb(userSub);
    if (!db) { res.status(404).json({ error: 'no data' }); return; }
    let filePath: string | null = null;
    try {
      const row = db.prepare(`SELECT ${kind} AS p FROM user_signals WHERE posting_id=?`).get(postingId) as { p?: string } | undefined;
      filePath = row?.p || null;
    } finally { try { db.close(); } catch { /* */ } }
    // Confine to the user's own applications dir — never serve outside it.
    const { userDir } = userPaths(userSub);
    const safeRoot = path.resolve(userDir);
    if (!filePath || !path.resolve(filePath).startsWith(safeRoot) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'not found' }); return;
    }
    // `as=html` serves the generated HTML the PDF was printed from, for in-surface preview: no
    // mobile browser renders a PDF in an iframe, so the PDF path can only ever produce an empty
    // frame there. 404 when the sibling is absent — falling back to the PDF would silently
    // restore the invisible preview. See ./career-resume-preview.
    if (req.query.as === 'html') {
      const htmlPath = resolvePreviewPath(filePath, userDir);
      if (!htmlPath) { res.status(404).json({ error: 'no html preview' }); return; }
      try {
        res.type('html').send(buildPreviewHtml(htmlPath));
      } catch (err) {
        logger.error({ err }, 'resume html preview failed');
        res.status(404).json({ error: 'no html preview' });
      }
      return;
    }
    res.sendFile(filePath, (err: unknown) => { if (err) { logger.error({ err }, 'resume serve failed'); res.status(404).end(); } });
  };
  router.get('/resume', (req, res) => serveResumeFile(req, res, Number(req.query.id)));

  // ── Update a job's pipeline status (mark applied / dismiss / promote) ──────
  const ALLOWED_STATUS = new Set(['new', 'applied', 'dismissed', 'promoted', 'generated', 'interview', 'offer', 'deferred']);
  router.post('/jobs/:id/status', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const postingId = Number(req.params.id);
    const status = String(req.body?.status || '');
    if (!Number.isFinite(postingId) || !ALLOWED_STATUS.has(status)) { res.status(400).json({ error: 'bad request' }); return; }
    const db = openUserDb(userSub, false);
    if (!db) { res.status(404).json({ error: 'no data' }); return; }
    try {
      const appliedAt = status === 'applied' ? "COALESCE(applied_at, datetime('now'))" : 'applied_at';
      const info = db.prepare(
        `UPDATE user_signals SET status=@status, applied_at=${appliedAt} WHERE posting_id=@id`
      ).run({ status, id: postingId });
      res.json({ ok: info.changes > 0, status });
    } catch (err) {
      logger.error({ err }, 'status update failed');
      res.status(500).json({ error: 'update failed' });
    } finally { try { db.close(); } catch { /* */ } }
  });

  // ── Job detail (full posting + company + fit rationale + matched/gaps) ─────
  router.get('/jobs/:id', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const postingId = Number(req.params.id);
    if (!Number.isFinite(postingId)) { res.status(400).json({ error: 'bad id' }); return; }
    const db = openUserDb(userSub);
    if (!db) { res.status(404).json({ error: 'no data' }); return; }
    try {
      const row = db.prepare(
        `SELECT p.*, c.name AS company, c.industry, c.homepage, c.careers_url, COALESCE(c.referral,0) AS referral,
                s.fit_score, s.ai_fit_score, s.ai_fit_rationale, s.ai_fit_matched, s.ai_fit_gaps, s.status,
                s.applied_at, s.promoted_at, s.generated_at, s.notes,
                CASE WHEN s.resume_path IS NOT NULL AND s.resume_path<>'' THEN 1 ELSE 0 END AS has_resume,
                CASE WHEN s.cover_path  IS NOT NULL AND s.cover_path<>''  THEN 1 ELSE 0 END AS has_cover
           FROM corpus.postings_corpus p
           JOIN corpus.companies c ON c.id = p.company_id
           LEFT JOIN user_signals s ON s.posting_id = p.id
          WHERE p.id = ?`
      ).get(postingId) as Record<string, unknown> | undefined;
      if (!row) { res.status(404).json({ error: 'not found' }); return; }
      const jl = (v: unknown): unknown[] => { try { return v ? JSON.parse(String(v)) : []; } catch { return []; } };
      row.matched = jl(row.ai_fit_matched); row.gaps = jl(row.ai_fit_gaps);
      res.json({ job: row });
    } catch (err) {
      logger.error({ err }, 'job detail failed');
      res.status(500).json({ error: 'read failed' });
    } finally { try { db.close(); } catch { /* */ } }
  });

  // ── Generate a tailored resume + cover for a job (async — never blocks the
  //    controller on the LLM call). Optional OSHAL/open-source surfacing. ──────
  router.post('/jobs/:id/generate', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const postingId = Number(req.params.id);
    if (!Number.isFinite(postingId)) { res.status(400).json({ error: 'bad id' }); return; }
    const oshal = req.body?.oshal === true || req.body?.oshal === 'true';
    const guidance = String(req.body?.guidance || '').trim();
    // `tailor`: guidance (e.g. "make this cover about my early career") enriches the durable
    // profile first, then generate_for tailors to the posting. Async — never blocks on the LLM.
    runCliAsync(userSub, ['tailor'], { CH_JOB: String(postingId), CH_OSHAL: oshal ? '1' : '', CH_GUIDANCE: guidance });
    res.status(202).json({ ok: true, status: 'generating' });
  });

  // ── Set a company referral level (0-3) — boosts P(land) for all its roles ──
  router.post('/company/:id/referral', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const companyId = Number(req.params.id);
    const level = Math.max(0, Math.min(3, Number(req.body?.level) || 0));
    if (!Number.isFinite(companyId)) { res.status(400).json({ error: 'bad id' }); return; }
    const db = openUserDb(userSub, false);
    if (!db) { res.status(404).json({ error: 'no data' }); return; }
    try {
      const info = db.prepare('UPDATE corpus.companies SET referral=? WHERE id=?').run(level, companyId);
      res.json({ ok: info.changes > 0, level });
    } catch (err) {
      logger.error({ err }, 'referral set failed');
      res.status(500).json({ error: 'update failed' });
    } finally { try { db.close(); } catch { /* */ } }
  });

  // ── Recruiters tracker (per-user recruiter_firms) — Phase 3 ────────────────
  router.get('/recruiters', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const db = openUserDb(userSub);
    if (!db) { res.json({ recruiters: [], buckets: [], byStatus: [], empty: true }); return; }
    try {
      const where: string[] = []; const args: unknown[] = [];
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      const bucket = typeof req.query.bucket === 'string' ? req.query.bucket.trim() : '';
      if (status) { where.push('status = ?'); args.push(status); }
      if (bucket) { where.push('bucket = ?'); args.push(bucket); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const recruiters = db.prepare(`SELECT * FROM recruiter_firms ${whereSql} ORDER BY sort_order, firm`).all(...args);
      const buckets = (db.prepare("SELECT DISTINCT bucket FROM recruiter_firms WHERE bucket IS NOT NULL AND bucket<>'' ORDER BY bucket").all() as { bucket: string }[]).map((r) => r.bucket);
      const byStatus = db.prepare("SELECT COALESCE(NULLIF(status,''),'(none)') AS status, COUNT(*) AS n FROM recruiter_firms GROUP BY COALESCE(NULLIF(status,''),'(none)') ORDER BY n DESC").all();
      res.json({ recruiters, buckets, byStatus });
    } catch (err) { logger.error({ err }, 'recruiters list failed'); res.status(500).json({ error: 'read failed' }); }
    finally { try { db.close(); } catch { /* */ } }
  });
  router.post('/recruiters', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const firm = String(req.body?.firm || '').trim();
    if (!firm) { res.status(400).json({ error: 'firm required' }); return; }
    const db = openUserDb(userSub, false);
    if (!db) { res.status(404).json({ error: 'no data' }); return; }
    try {
      const info = db.prepare(
        `INSERT INTO recruiter_firms (firm, bucket, website, contact_name, contact_link, status, sort_order, updated_at)
         VALUES (?,?,?,?,?,?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM recruiter_firms), datetime('now'))`
      ).run(firm, String(req.body?.bucket || 'Other').trim(), String(req.body?.website || '').trim(),
        String(req.body?.contact_name || '').trim(), String(req.body?.contact_link || '').trim(),
        String(req.body?.status || 'To contact').trim());
      res.status(201).json({ ok: true, id: info.lastInsertRowid });
    } catch (err) { logger.error({ err }, 'recruiter add failed'); res.status(500).json({ error: 'add failed' }); }
    finally { try { db.close(); } catch { /* */ } }
  });
  const RECRUITER_FIELDS = new Set(['firm', 'bucket', 'website', 'contact_name', 'contact_role', 'contact_link', 'channel', 'status', 'date_contacted', 'followup_date', 'next_action', 'notes']);
  router.post('/recruiters/:id', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'bad id' }); return; }
    const updates = Object.entries(req.body || {}).filter(([k]) => RECRUITER_FIELDS.has(k));
    if (!updates.length) { res.status(400).json({ error: 'no valid fields' }); return; }
    const db = openUserDb(userSub, false);
    if (!db) { res.status(404).json({ error: 'no data' }); return; }
    try {
      const setSql = updates.map(([k]) => `${k}=?`).join(', ') + ", updated_at=datetime('now')";
      const info = db.prepare(`UPDATE recruiter_firms SET ${setSql} WHERE id=?`)
        .run(...updates.map(([, v]) => (v == null ? null : String(v))), id);
      res.json({ ok: info.changes > 0 });
    } catch (err) { logger.error({ err }, 'recruiter update failed'); res.status(500).json({ error: 'update failed' }); }
    finally { try { db.close(); } catch { /* */ } }
  });
  router.delete('/recruiters/:id', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'bad id' }); return; }
    const db = openUserDb(userSub, false);
    if (!db) { res.status(404).json({ error: 'no data' }); return; }
    try { const info = db.prepare('DELETE FROM recruiter_firms WHERE id=?').run(id); res.json({ ok: info.changes > 0 }); }
    catch (err) { logger.error({ err }, 'recruiter delete failed'); res.status(500).json({ error: 'delete failed' }); }
    finally { try { db.close(); } catch { /* */ } }
  });

  // ── Strengthen: resume gap-themes + answer-to-augment-profile (Phase 4) ────
  //    The "talk and it strengthens your resume" flow. list/scan read+cluster gaps;
  //    answer saves the example AND enriches the durable profile (LLM, async).
  router.get('/strengthen', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const r = runCli(userSub, ['strengthen', 'list']);
    if (!r.ok) { logger.error({ err: r.err }, 'strengthen list failed'); res.status(500).json({ error: 'list failed' }); return; }
    try {
      const start = r.out.indexOf('{');
      res.json(start >= 0 ? JSON.parse(r.out.slice(start)) : { themes: [], total: 0 });
    } catch (err) { logger.error({ err, tail: r.out.slice(-300) }, 'strengthen parse failed'); res.status(500).json({ error: 'parse failed' }); }
  });
  router.post('/strengthen/scan', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    runCliAsync(userSub, ['strengthen', 'scan']);
    res.status(202).json({ ok: true, status: 'scanning' });
  });
  router.post('/strengthen/answer', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const key = String(req.body?.key || '').trim();
    const response = String(req.body?.response || '').trim();
    if (!key || !response) { res.status(400).json({ error: 'key + response required' }); return; }
    runCliAsync(userSub, ['strengthen', 'answer'], { CH_KEY: key, CH_RESP: response });
    res.status(202).json({ ok: true, status: 'augmenting' });
  });
  router.post('/strengthen/:key/status', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const key = String(req.params.key || '').trim();
    const status = String(req.body?.status || '').trim();
    if (!key || !['open', 'skipped', 'answered'].includes(status)) { res.status(400).json({ error: 'bad request' }); return; }
    const r = runCli(userSub, ['strengthen', 'status'], { CH_KEY: key, CH_STATUS: status });
    res.json({ ok: r.ok });
  });

  // ── Enqueue draft-application tickets for the top-N fresh scored roles ─────
  router.post('/enqueue-drafts', async (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const created = await enqueueForUser(ctx, userSub, Number(req.body?.limit) || 10, { trigger: 'manual' });
    res.json({ created });
  });

  // ── Approve (optionally with OSHAL) -> run the draft, advance the ticket ───
  router.post('/applications/:postingId/approve', async (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const postingId = Number(req.params.postingId);
    const oshal = req.body?.oshal === true || req.body?.oshal === 'true';
    const appRow = (await pool.query(
      `SELECT ticket_id FROM career_hunter_applications WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`,
      [TENANT, userSub, postingId])).rows[0];
    const ticketId: string | undefined = appRow?.ticket_id;
    if (ticketId) { try { await ctx.ticketService.updateStatus(ticketId, 'in_process_build'); } catch { /* */ } }
    await pool.query(
      `UPDATE career_hunter_applications SET status='drafting', include_oshal=$4, updated_at=NOW()
        WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`, [TENANT, userSub, postingId, oshal]);
    const args = ['draft', '--job', String(postingId)]; if (oshal) args.push('--oshal');
    const r = runCli(userSub, args);
    if (r.ok) {
      if (ticketId) { try { await ctx.ticketService.updateStatus(ticketId, 'customer_action'); } catch { /* */ } }
      await pool.query(
        `UPDATE career_hunter_applications SET status='drafted', updated_at=NOW()
          WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`, [TENANT, userSub, postingId]);
      res.json({ ok: true, oshal });
    } else {
      if (ticketId) {
        try {
          await ctx.ticketService.updateStatus(ticketId, 'escalated', {
            reason: 'career_application_draft_failed',
            source: 'career-hunter-routes',
            message: r.err.slice(-1000),
          });
        } catch { /* */ }
      }
      await pool.query(
        `UPDATE career_hunter_applications SET status='error', updated_at=NOW()
          WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`, [TENANT, userSub, postingId]);
      logger.error({ err: r.err }, 'draft failed');
      res.status(500).json({ ok: false, error: r.err.slice(-400) });
    }
  });

  // ── Mark applied (customer_action -> complete) ────────────────────────────
  router.post('/applications/:postingId/applied', async (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const postingId = Number(req.params.postingId);
    const appRow = (await pool.query(
      `SELECT ticket_id FROM career_hunter_applications WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`,
      [TENANT, userSub, postingId])).rows[0];
    if (appRow?.ticket_id) { try { await ctx.ticketService.updateStatus(appRow.ticket_id, 'complete'); } catch { /* */ } }
    const db = openUserDb(userSub, false);
    if (db) { try { db.prepare(`INSERT INTO user_signals (posting_id,status,applied_at) VALUES (?, 'applied', datetime('now')) ON CONFLICT(posting_id) DO UPDATE SET status='applied', applied_at=datetime('now')`).run(postingId); } finally { db.close(); } }
    await pool.query(`UPDATE career_hunter_applications SET status='applied', updated_at=NOW() WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`, [TENANT, userSub, postingId]);
    res.json({ ok: true });
  });

  // ── Deny -> cancel the ticket + dismiss the posting for this user ──────────
  router.post('/applications/:postingId/deny', async (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const postingId = Number(req.params.postingId);
    const appRow = (await pool.query(
      `SELECT ticket_id FROM career_hunter_applications WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`,
      [TENANT, userSub, postingId])).rows[0];
    if (appRow?.ticket_id) { try { await ctx.ticketService.updateStatus(appRow.ticket_id, 'cancelled'); } catch { /* */ } }
    const db = openUserDb(userSub, false);
    if (db) { try { db.prepare(`INSERT INTO user_signals (posting_id,status) VALUES (?, 'dismissed') ON CONFLICT(posting_id) DO UPDATE SET status='dismissed'`).run(postingId); } finally { db.close(); } }
    await pool.query(`UPDATE career_hunter_applications SET status='denied', updated_at=NOW() WHERE tenant_id=$1 AND user_sub=$2 AND posting_id=$3`, [TENANT, userSub, postingId]);
    res.json({ ok: true });
  });

  // ── Settings: connection state + per-user key storage ─────────────────────
  router.get('/settings/state', async (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const conns = (await pool.query(
      `SELECT provider FROM oshal_connections WHERE user_sub=$1 AND provider IN ('anthropic','firecrawl')`, [userSub])).rows;
    const hasHostClaude = fs.existsSync(path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', '.credentials.json'));
    res.json({
      anthropicConnected: conns.some((c) => c.provider === 'anthropic') || hasHostClaude,
      firecrawlSet: conns.some((c) => c.provider === 'firecrawl'),
    });
  });

  async function saveKey(req: Request, res: Response, provider: 'anthropic' | 'firecrawl') {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const key = String(req.body?.key || '').trim();
    if (!key) { res.status(400).json({ error: 'key required' }); return; }
    const enc = await encryptToken(pool, userSub, key);
    await pool.query(
      `INSERT INTO oshal_connections (user_sub, provider, access_token, status)
       VALUES ($1,$2,$3,'connected')
       ON CONFLICT (user_sub, provider) DO UPDATE SET access_token=EXCLUDED.access_token, status='connected', updated_at=NOW()`,
      [userSub, provider, enc]);
    res.json({ ok: true });
  }
  router.post('/settings/anthropic', (req, res) => { void saveKey(req, res, 'anthropic'); });
  router.post('/settings/firecrawl', (req, res) => { void saveKey(req, res, 'firecrawl'); });
  router.delete('/settings/key/:provider', async (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const provider = req.params.provider === 'anthropic' ? 'anthropic' : 'firecrawl';
    await pool.query(`DELETE FROM oshal_connections WHERE user_sub=$1 AND provider=$2`, [userSub, provider]);
    res.json({ ok: true });
  });

  // ── Admin refresh: the FULL nightly chain (shared scrape → index every user → AI score →
  //    title pass → enqueue), fired detached and single-flighted in the cron module. This is
  //    what lets the operator (or the career agent via its career_refresh tool) update + index
  //    the jobs DB from the cockpit instead of a dev-tool session. Auth: career admin via the
  //    OIDC session, OR a trusted in-container service call (X-Service-Secret + X-Oshal-User-Sub)
  //    — the service path is STILL admin-checked, the secret only substitutes for the session.
  const refreshCallerSub = (req: Request): string | null => callerSub(req) ?? getTrustedServiceUserSub(req);
  router.post('/run/refresh', (req, res) => {
    const sub = refreshCallerSub(req);
    if (!sub) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (!isCareerAdmin(sub)) { res.status(403).json({ error: 'admin only' }); return; }
    // Lazy require mirrors the cron bootstrap above (avoids a circular import at module eval).
    const cron = require('./career-hunter-cron') as typeof import('./career-hunter-cron');
    if (cron.isEveningChainRunning()) { res.status(409).json({ ok: false, err: 'refresh already running' }); return; }
    const users = listStoreUsers();
    if (!users.length) { res.status(500).json({ ok: false, err: 'no user stores' }); return; }
    // manualRefresh: an explicit operator/admin action refreshes the DATA (scrape + keyword
    // index) even with zero automation opt-ins; draft generation stays per-user gated.
    void cron.runEveningScrapeIndex(ctx, users, { manualRefresh: true });
    logger.info({ sub, users: users.length }, 'career refresh: full scrape+index chain started');
    res.json({ ok: true, started: true, users: users.length, note: 'scrape+index runs detached; poll GET /run/refresh' });
  });
  router.get('/run/refresh', (req, res) => {
    const sub = refreshCallerSub(req);
    if (!sub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const cron = require('./career-hunter-cron') as typeof import('./career-hunter-cron');
    let corpusFreshAt: string | null = null;
    const db = openUserDb(sub) || openUserDb(listStoreUsers()[0] || '');
    if (db) {
      try { corpusFreshAt = (db.prepare('SELECT MAX(last_seen_at) AS m FROM corpus.postings_corpus').get() as { m?: string })?.m ?? null; }
      catch { /* freshness stays null */ }
      finally { db.close(); }
    }
    res.json({ running: cron.isEveningChainRunning(), corpusFreshAt });
  });

  // ── Run a pull/score/match now (from settings + the board onboarding). NON-BLOCKING:
  //    spawns the engine async and awaits its exit, so /health and every other request stay
  //    served during the multi-minute run. Guarded single-flight per user+verb (409) plus a
  //    global ceiling (429) so runs can't stack and wedge the controller. (Was spawnSync — a
  //    single /run/match blocked the whole event loop for ~76 min and took the front end down.)
  router.post('/run/:verb', async (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const verb = req.params.verb;
    if (!['pull', 'score', 'match'].includes(verb)) { res.status(400).json({ error: 'verb' }); return; }
    const acquired = tryAcquireRun(userSub, verb);
    if (acquired === 'inflight') { res.status(409).json({ ok: false, err: `${verb} already running` }); return; }
    if (acquired === 'busy') { res.status(429).json({ ok: false, err: 'busy — too many runs in progress, try again shortly' }); return; }
    // No `--days` filter here either: the engine's date gate excludes the many ATS rows with a
    // null posted_date, so `--days 10` made this "Score now" button a silent no-op. See runUserScore.
    const args = verb === 'score' ? ['score', '--min-keyword', '40']
      : verb === 'match' ? ['match']
        : ['pull'];
    try {
      const r = await runCliAwait(userSub, args);
      res.json({ ok: r.ok, out: r.out.slice(-1500), err: r.ok ? undefined : r.err.slice(-400) });
    } catch (err) {
      logger.error({ err, verb }, 'career run failed');
      res.status(500).json({ ok: false, err: 'run failed' });
    } finally {
      releaseRun(userSub, verb);
    }
  });

  // ── Resume upload + index (the "Get Started" onboarding) ────────────────────
  // multer keeps the file in memory; we write it under the per-user dir and kick off
  // the `ingest` CLI, which parses the PDF/DOCX and builds THIS user's career_db.json
  // (the profile score/tailor read). Per-user isolated — never touches another profile.
  const resumeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

  router.post('/resume/upload', resumeUpload.single('resume'), (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const file = (req as unknown as { file?: { buffer: Buffer; originalname?: string } }).file;
    if (!file) { res.status(400).json({ error: 'no file' }); return; }
    const ext = (path.extname(file.originalname || '').toLowerCase()) || '.pdf';
    if (!['.pdf', '.docx', '.txt', '.md'].includes(ext)) {
      res.status(400).json({ error: 'Upload a PDF, DOCX, TXT, or MD resume.' }); return;
    }
    const { userDir } = userPaths(userSub);
    try {
      const upDir = path.join(userDir, 'uploads');
      fs.mkdirSync(upDir, { recursive: true });
      const dest = path.join(upDir, 'resume' + ext);
      fs.writeFileSync(dest, file.buffer);
      fs.writeFileSync(path.join(userDir, '.indexing'), String(Date.now()));
      runCliAsync(userSub, ['ingest'], { CH_RESUME: dest });
      res.json({ started: true });
    } catch (e) {
      logger.error({ err: e }, 'resume upload failed');
      res.status(500).json({ error: 'upload failed' });
    }
  });

  // Onboarding state: has the user indexed a resume yet, or is indexing in flight?
  router.get('/resume/state', (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const { userDir } = userPaths(userSub);
    const careerDb = path.join(userDir, 'career_db.json');
    let hasResume = false; let roles = 0; let name = '';
    try {
      if (fs.existsSync(careerDb)) {
        const d = JSON.parse(fs.readFileSync(careerDb, 'utf8'));
        roles = Array.isArray(d.roles) ? d.roles.length : 0;
        name = (d && d.profile && d.profile.name) || '';
        hasResume = roles > 0 || !!(d && d.profile && d.profile.experience_summary);
      }
    } catch { /* unreadable => treat as no resume */ }
    let indexing = false;
    try {
      const marker = path.join(userDir, '.indexing');
      if (fs.existsSync(marker)) {
        if (hasResume) { fs.rmSync(marker, { force: true }); }
        else { indexing = (Date.now() - Number(fs.readFileSync(marker, 'utf8') || 0)) < 5 * 60 * 1000; }
      }
    } catch { /* */ }
    // How many jobs this user has AI-scored — drives the "build my board" onboarding step
    // (a new user has a resume but 0 scored jobs until match + score run).
    let scored = 0;
    try {
      const db = openUserDb(userSub);
      if (db) {
        try {
          const row = db.prepare("SELECT COUNT(*) AS n FROM user_signals WHERE ai_fit_score IS NOT NULL").get() as { n?: number };
          scored = row?.n || 0;
        } finally { try { db.close(); } catch { /* */ } }
      }
    } catch { /* */ }
    res.json({ hasResume, indexing, roles, name, scored });
  });

  // Alias for links circulated in the path shape (/resume/<postingId>[?kind=cover]) — digest
  // emails and bot-written text used this form and 404'd (dev-bot RCA, ticket c36c5dfb).
  // Registered LAST so the static /resume/doc|guide|save|upload|state routes above always win.
  router.get('/resume/:id', (req, res) => serveResumeFile(req, res, Number(req.params.id)));

  return router;
}
