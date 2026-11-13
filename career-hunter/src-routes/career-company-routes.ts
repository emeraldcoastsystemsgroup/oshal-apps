/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted administrator-only shared-company inspection and career-board refresh routes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Content-negotiate the admin denial. The Companies ribbon entry points an iframe at the /companies-admin SURFACE route, but the gate answered every caller with res.status(403).json(...) — so with CAREER_HUNTER_ADMIN_SUBS unset in the deployment the operator saw a raw JSON body wrapped in the browser's built-in JSON viewer ("Pretty print" checkbox) instead of a page. Browser navigations now get a themed 403 HTML page naming the env var an operator sets; fetch/XHR callers keep the JSON 403, and the status is unchanged because this is a real authorization boundary. Also logs the EMPTY-allowlist case distinctly from "caller is not an admin" — an unset env var was previously indistinguishable from a normal denial and took a live container inspection to diagnose.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Denial log records req.path, not req.originalUrl — the query string on a DENIED request is unbounded caller-controlled input (seturl carries a whole URL) and was being written into the WARN line.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The admin list carries each company's source_lists so the portal table shows which rows arrived through a user's own target list (`user:<sub>` provenance) rather than the seeds.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | The administrator-only page speaks to the person: it told them an operator adds their subject to CAREER_HUNTER_ADMIN_SUBS 'and recreating the API container', a Docker-era step that does not exist on the native runtime. It now says to ask the person who runs the installation; the operator log line names the empty allow-list without the container step. Guard: tests/career-company-admin-copy.test.mjs.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Project retained source attempts and content-delta counts through the existing administrator list; older snapshots explicitly have no recorded health.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | The same administrator list carries the latest nightly source review, so the report needs no new route or permission.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Resolve is honest on the native kernel, where request sandboxes mount the corpus read-only: the list says sources cannot be changed here and the route refuses before starting an engine that would die with 'attempt to write a readonly database'.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Resolve works on the native kernel. Where a request cannot write the corpus the route saves the change for the next pull and answers 202; the list says how changes work here and what became of each one. A board named by the source review can be accepted without a link.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Add, Remove and Put back on the Companies page: three administrator routes save the change for the next nightly pull, refusing a name already listed, an unusable link, an unlisted employer and a change that is already true.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Source maintenance on the Companies page: the list carries the newest maintenance report, the decisions waiting for a person and the open repair briefs; POST /companies-admin/keep saves "keep trying" for the next nightly pull, refusing an employer with no decision waiting; POST /companies-admin/maintenance-report answers the daily briefing job.
 * 12 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 4, 11, 12, 13 and 14: one name for each page and for each role. The page a refused person meets says job source administrator, the label the role template now carries (was Career Hunter administrator). Words only.
 * 13 | maintainer@emeraldcoastsystemsgroup.com | Prepare original-owner native human decision tickets, reconcile exact confirmed outcomes and refuse generic source-change bypasses.
 */

/**
 * Administrator routes for the shared Career Hunter company corpus.
 * @module career-company-routes
 */
import { type Request, type RequestHandler, type Response, type Router } from 'express';
import { createChildLogger } from '@/shared/logger';
import { isOperator } from '@/shared/middleware/authz';
import type { AppContext } from '@/app/composition/app-context';
import { callerSub, openCorpusDb, userPaths } from './career-user-store';
import { runCareerCliAwait } from './career-engine-dispatch';
import { rejectEngineStart } from './career-engine-response';
import { createCareerToolFileHandler } from './career-surface-routes';
const { sourceHealthByCompany, latestSourceReview, sourceMaintenance, maintenanceBriefing, decisionWaiting, KEEP_TRYING_DAYS } = require('../lib/career-source-health');
const { saveChange, sourceChanges, validTarget, addTarget, NEW_EMPLOYER, REMOVE, RESTORE, KEEP_TRYING, decisionChangeState } = require('../lib/career-source-requests');

const decisions = require('../lib/career-source-decisions');

const logger = createChildLogger({ module: 'career-company-routes' });
const CAREER_ADMIN_SUBS = new Set(
  (process.env.CAREER_HUNTER_ADMIN_SUBS || '')
    .split(',')
    .map((sub) => sub.trim())
    .filter(Boolean),
);

/**
 * @description Checks the fail-closed Career Hunter administrator allow-list.
 * @param sub - Authenticated OIDC subject or trusted service subject.
 * @returns True only when the subject is explicitly configured as an administrator.
 */
export function isCareerAdmin(sub: string | null): boolean {
  return !!sub && CAREER_ADMIN_SUBS.has(sub);
}

/**
 * Denial page for a BROWSER navigation to the admin-only Companies surface. The cockpit loads that
 * route in an iframe, so a JSON body renders as the browser's raw JSON viewer rather than a page.
 * Self-contained and inline on purpose: this is an error page, not a surface. It joins the
 * canonical theme rail (`surface-themes.css` + `surface-theme.js`) and derives every colour from
 * framework tokens, so it follows the cockpit theme instead of flashing dark inside a light one —
 * CSS custom properties do not cross the iframe document boundary, hence the surface must set its
 * own `data-theme` (defaulted here to `midnight` for the no-JS case). It names only the env var an
 * operator sets; it never echoes a configured subject or any other deployment value.
 */
const ADMIN_DENIED_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="midnight">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Companies &mdash; administrator only</title>
<link rel="stylesheet" href="/shared/ui/css/surface-themes.css" />
<script src="/shared/ui/js/surface-theme.js"></script>
<style>
  :root { --bg: var(--bg-primary); --panel: var(--bg-card); --text: var(--text-primary);
          --muted: var(--text-muted); --line: var(--border-color); --accent: var(--accent-primary); }
  html, body { height: 100%; margin: 0; }
  body { display: flex; align-items: center; justify-content: center; padding: 24px;
         font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
         background: var(--bg); color: var(--text); }
  .card { max-width: 32rem; padding: 22px 26px; border: 1px solid var(--line);
          border-radius: 10px; background: var(--panel); }
  h1 { margin: 0 0 10px; font-size: 1.1rem; font-weight: 600; color: var(--text); }
  p { margin: 0 0 10px; line-height: 1.55; color: var(--muted); }
  p.last { margin-bottom: 0; }
  code { padding: 2px 6px; border-radius: 4px; border: 1px solid var(--line);
         background: var(--bg-tertiary); color: var(--accent); font-size: 0.92em; }
</style>
</head>
<body>
<main class="card">
  <h1>Companies is administrator only</h1>
  <p>The shared company list is open only to job source administrators, and this account is
     not one of them on this installation.</p>
  <p class="last">To get access, ask the person who runs this installation to make your account a
     job source administrator.</p>
</main>
</body>
</html>
`;

/**
 * @description Records an administrator denial so an unset allow-list is observable in the logs.
 * "No administrators are configured on this deployment" and "this caller is not an administrator"
 * are the same 403 to the caller but completely different operator actions, and an empty allow-list
 * previously required inspecting the running container to detect. Logs the configured administrator
 * COUNT only — never a subject, configured or otherwise.
 * @param req - Denied request, used for the requested path.
 * @param authenticated - Whether the request carried an authenticated subject at all.
 * @returns Nothing.
 */
function logAdminDenial(req: Request, authenticated: boolean): void {
  // req.path, not originalUrl: on a denial the query string is unbounded caller-controlled
  // input (seturl carries a full URL) and does not belong in an authorization-failure log line.
  const detail = { path: req.path, authenticated, adminsConfigured: CAREER_ADMIN_SUBS.size };
  if (CAREER_ADMIN_SUBS.size === 0) {
    logger.warn(
      detail,
      'career admin route denied: NO administrators are configured for this application '
      + '(CAREER_HUNTER_ADMIN_SUBS is empty in its environment)',
    );
    return;
  }
  logger.warn(detail, 'career admin route denied: caller is not a configured administrator');
}

const requireCareerAdmin: RequestHandler = (req, res, next) => {
  const sub = callerSub(req);
  if (isOperator(req) || isCareerAdmin(sub)) { next(); return; }
  logAdminDenial(req, !!sub);
  // 403 either way — this is a real authorization boundary, only the representation is negotiated.
  // Never cached: once an operator configures the allow-list, a reload must re-evaluate the gate.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.status(403);
  // Accept order matters: fetch()'s default `*/*` resolves to the FIRST entry ('json'), so the data
  // routes keep their JSON body and only a genuine document navigation (the cockpit's Companies
  // iframe, or an address-bar hit) gets the page. One negotiated gate covers every route this file
  // guards, including any surface route added behind it later.
  if (req.accepts(['json', 'html']) === 'html') {
    res.type('html').send(ADMIN_DENIED_HTML);
    return;
  }
  res.json({ error: 'admin only' });
};

/** The native kernel binds the shared corpus read-only into every request; only its nightly pull writes it. */
function canChangeSources(): boolean {
  return process.env.OSHAL_EGRESS !== 'kernel';
}

function listCompanies(req: Request, res: Response): void {
  const userSub = callerSub(req);
  const db = userSub && openCorpusDb();
  if (!db) { res.json({ companies: [] }); return; }
  try {
    const companies = db.prepare(
      `SELECT c.id, c.name, c.ats_type, c.ats_token, c.careers_url, c.discover_status, c.source_lists,
              (SELECT COUNT(*) FROM corpus.postings_corpus p WHERE p.company_id=c.id AND p.active=1) AS active_jobs
         FROM corpus.companies c
        ORDER BY active_jobs DESC, c.name`,
    ).all() as Array<{ id: number; [key: string]: unknown }>;
    const health = sourceHealthByCompany(db);
    const maintenance = sourceMaintenance(db), owned = ownedDecisionSnapshot(userPaths(userSub).userDir, userSub, maintenance?.actions || []);
    res.json({ companies: companies.map((company) => ({ ...company,
      pull_health: health.states.get(company.id) ?? { status: 'unavailable', reason: 'not_recorded_yet' },
    })), sourceHealth: { available: health.available, reason: health.reason }, sourceReview: latestSourceReview(db),
      sourceMaintenance: maintenance, sourceDecisions: owned.items, sourceDecisionError: owned.error,
      sourceChangeMode: canChangeSources() ? 'now' : 'next-pull', sourceChanges: sourceChanges(db, userPaths(userSub).userDir) });
  } catch (err) {
    logger.error({ err, userSub }, 'company list failed');
    res.status(500).json({ error: 'read failed' });
  } finally { db.close(); }
}

/** The change waits in the caller's store; the kernel hands it on only if this admission holds the permission. */
function queueSourceChange(req: Request, res: Response, userSub: string): void {
  const companyId = parseInt(String(req.query.companyId ?? ''), 10);
  const target = validTarget(req.query.board ?? req.query.url);
  if (!companyId || companyId < 1 || !target) {
    res.status(400).json({ ok: false, error: 'A company and a job board link are required.' });
    return;
  }
  if (!corpusListsCompany(companyId)) {
    res.status(404).json({ ok: false, error: 'That company is no longer listed.' });
    return;
  }
  const request = saveChange(userPaths(userSub).userDir, companyId, target);
  res.status(202).json({ ok: true, queued: true, request: { ...request, state: 'waiting', detail: {} },
    message: 'Saved. The next nightly pull applies this and reads its jobs.' });
}

/** Whether the published corpus lists this company. */
function corpusListsCompany(companyId: number): boolean {
  const db = openCorpusDb();
  if (!db) return false;
  try { return !!db.prepare('SELECT 1 FROM corpus.companies WHERE id=?').get(companyId); }
  finally { db.close(); }
}

type ListedEmployer = { id: number; name: string; discover_status: string | null };
type EmployerPlan = { status?: number; error?: string; companyId?: number; target?: string; message?: string };

/** The employer the published corpus lists under this id, or null. */
function corpusCompany(companyId: number): ListedEmployer | null {
  const db = openCorpusDb();
  if (!db) return null;
  try { return (db.prepare('SELECT id, name, discover_status FROM corpus.companies WHERE id=?').get(companyId) as ListedEmployer) ?? null; }
  finally { db.close(); }
}

/** An employer already listed under this name, letter case aside. The pull also matches suffixes such as "Inc.". */
function corpusEmployerNamed(name: string): ListedEmployer | null {
  const db = openCorpusDb();
  if (!db) return null;
  try { return (db.prepare('SELECT id, name, discover_status FROM corpus.companies WHERE lower(name)=lower(?)').get(name) as ListedEmployer) ?? null; }
  finally { db.close(); }
}

/** What to queue for Add: the target under the placeholder id, or an answer that refuses it. */
function addRequest(req: Request): EmployerPlan {
  const added = addTarget(req.query.name, req.query.url);
  if (!added) return { status: 400, error: 'An employer name (2 to 120 characters) and its careers page or job board link (http or https) are required.' };
  const listed = corpusEmployerNamed(added.name);
  if (listed && listed.discover_status !== 'removed') return { status: 409, error: `${listed.name} is already listed.`, companyId: listed.id };
  return { companyId: NEW_EMPLOYER, target: added.target, message: `Saved. The next nightly pull adds ${added.name} and reads its jobs.` };
}

/** Whether source maintenance has a decision waiting for a person on this employer. */
function corpusDecisionWaiting(companyId: number): boolean {
  const db = openCorpusDb();
  if (!db) return false;
  try { return decisionWaiting(db, companyId); }
  finally { db.close(); }
}

/** What to queue for Keep trying, or an answer that refuses it: the employer must be listed and have a decision waiting. */
function keepRequest(companyId: number, listed: ListedEmployer): EmployerPlan {
  if (listed.discover_status === 'removed') return { status: 409, error: `${listed.name} is removed.` };
  if (!corpusDecisionWaiting(companyId)) return { status: 409, error: `${listed.name} has no decision waiting.` };
  return { status: 409, error: 'Answer this source’s native decision ticket in Needs you.' };
}

/** What to queue for Remove, Put back or Keep trying on a listed employer, or an answer that refuses it. */
function employerRequest(req: Request, kind: 'remove' | 'restore' | 'keep'): EmployerPlan {
  const companyId = parseInt(String(req.query.companyId ?? ''), 10);
  if (!companyId || companyId < 1) return { status: 400, error: 'A company is required.' };
  const listed = corpusCompany(companyId);
  if (!listed) return { status: 404, error: 'That company is no longer listed.' };
  if (kind === 'keep') return keepRequest(companyId, listed);
  const removed = listed.discover_status === 'removed';
  if (kind === 'remove' && corpusDecisionWaiting(companyId)) return { status: 409, error: 'Answer this source’s native decision ticket in Needs you.' };
  if (kind === 'remove' && removed) return { status: 409, error: `${listed.name} is already removed.` };
  if (kind === 'restore' && !removed) return { status: 409, error: `${listed.name} is not removed.` };
  return kind === 'remove'
    ? { companyId, target: REMOVE, message: `Saved. The next nightly pull closes the jobs of ${listed.name} and stops reading it.` }
    : { companyId, target: RESTORE, message: `Saved. The next nightly pull lists ${listed.name} again and reads its jobs.` };
}

/**
 * @description Add, Remove, Put back or Keep trying an employer. The change waits in the caller's store for the next nightly
 * pull, which is the only writer of the shared corpus; the kernel hands it on only for an admission holding `career.administer`.
 * @param kind - 'add', 'remove', 'restore' or 'keep'.
 * @returns The route handler.
 */
function employerChange(kind: 'add' | 'remove' | 'restore' | 'keep'): RequestHandler {
  return (req, res) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (canChangeSources()) {
      res.status(409).json({ ok: false, error: `${kind === 'keep' ? 'Keeping a source' : 'Adding and removing employers'} is applied by the nightly pull, which this installation does not run.` });
      return;
    }
    const plan = kind === 'add' ? addRequest(req) : employerRequest(req, kind);
    if (plan.status) {
      logger.info({ kind, status: plan.status }, 'employer change refused');
      res.status(plan.status).json({ ok: false, error: plan.error, companyId: plan.companyId });
      return;
    }
    const request = saveChange(userPaths(userSub).userDir, plan.companyId, plan.target);
    logger.info({ kind, companyId: plan.companyId, changeId: request.id }, 'employer change saved for the next pull');
    res.status(202).json({ ok: true, queued: true, request: { ...request, state: 'waiting', detail: {} }, message: plan.message });
  };
}

/**
 * @description Answers the daily briefing job: what last night's source maintenance left for a person, as the short
 * items the kernel's schedule report takes. Nothing to tell is an empty list, which publishes no briefing.
 * @param req - The scheduled call, admitted as an administrator.
 * @param res - Answers `{ report: [...] }`.
 * @returns Nothing.
 */
function ownedDecisionSnapshot(dir: string, owner: string, actions: unknown[]): {items: unknown[]; error?: string} {
  try { return {items: decisions.snapshot(dir, owner, actions)}; }
  catch (err) {
    logger.error({err}, 'source decision journal unavailable');
    return {items:[], error:'Your source decision records could not be read. No decision is assumed.'};
  }
}

function freshDecision(reference: {id: number; companyId: number; openedAt: string}): any {
  const db = openCorpusDb();
  if (!db) throw new Error('The current source decisions could not be read.');
  try {
    const row = db.prepare(`SELECT a.id, a.company_id AS companyId, c.name AS company, a.opened_at AS openedAt, a.evidence
      FROM corpus.source_actions a JOIN corpus.companies c ON c.id=a.company_id
      WHERE a.id=? AND a.company_id=? AND a.opened_at=? AND a.kind='archive' AND a.state='open'
      AND COALESCE(c.discover_status,'') NOT IN ('removed','manual')`).get(reference.id, reference.companyId, reference.openedAt) as any;
    if (!row || recoveredDecision(db,row.companyId,row.openedAt)) return null;
    try { row.evidence = JSON.parse(row.evidence || '{}'); }
    catch (err) { logger.error({err}, 'source decision evidence unreadable'); row.evidence = {}; }
    return row;
  } finally { db.close(); }
}

function recoveredDecision(db: any, companyId: number, openedAt: string): boolean {
  if (!db.prepare("SELECT 1 FROM corpus.sqlite_master WHERE type='table' AND name='source_pull_state'").get()) return false;
  const row = db.prepare('SELECT last_success_at FROM corpus.source_pull_state WHERE company_id=?').get(companyId) as any;
  const aware = (value: unknown): {seconds: number; fraction: string} | null => {
    const parts = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
    if (!parts) return null;
    const seconds = Date.parse(parts[1] + parts[3]);
    return Number.isFinite(seconds) ? {seconds,fraction:(parts[2] || '').padEnd(9,'0')} : null;
  };
  const success = aware(row?.last_success_at), original = aware(openedAt);
  return !!success && !!original && (success.seconds > original.seconds
    || success.seconds === original.seconds && success.fraction > original.fraction);
}

function decisionOptions(ctx: AppContext, ownerSub: string): any {
  return {userDir:userPaths(ownerSub).userDir, ownerSub, tickets:ctx.ticketService, currentAction:freshDecision,
    changeState:(id: string) => {
      const db = openCorpusDb();
      if (!db) throw new Error('The source change result could not be read.');
      try { return decisionChangeState(db,id); } finally { db.close(); }
    }};
}

async function maintenanceReport(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req), db = userSub && openCorpusDb();
  if (!db || !userSub) { res.json({report:[]}); return; }
  try {
    const report = maintenanceBriefing(db), state = sourceMaintenance(db);
    const items = [];
    for (const action of state?.actions || []) items.push(await decisions.sync(decisionOptions(ctx,userSub),action));
    logger.info({items:report.length, decisions:items.length}, 'source maintenance briefing answered');
    res.json({report, decisions:items});
  } catch (err) {
    logger.error({err}, 'source maintenance briefing failed');
    res.status(500).json({error:'Source maintenance could not be checked. No source change is assumed.'});
  } finally { db.close(); }
}

async function syncDecision(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const owner = callerSub(req), body = req.body;
  if (!owner) { res.status(401).json({error:'unauthorized'}); return; }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['actionId','companyId','openedAt','ticketId'].includes(key))
    || !Number.isSafeInteger(body.actionId) || body.actionId < 1 || !Number.isSafeInteger(body.companyId) || body.companyId < 1
    || typeof body.openedAt !== 'string' || body.openedAt.length > 80 || !Number.isFinite(Date.parse(body.openedAt))
    || body.ticketId != null && typeof body.ticketId !== 'string') {
    res.status(400).json({ok:false,error:'Select the exact current source decision.'}); return;
  }
  try {
    const reference = {id:body.actionId,companyId:body.companyId,openedAt:body.openedAt}, action = freshDecision(reference) || (body.ticketId ? reference : null);
    if (!action) { res.status(409).json({ok:false,error:'This source decision changed. Refresh Source health.'}); return; }
    const decision = await decisions.sync(decisionOptions(ctx,owner),action,body.ticketId ?? null);
    const queued = decision.state === 'queued_next_pull', applied = decision.state === 'applied';
    const ready = ['awaiting_approval','queued_next_pull','applied'].includes(decision.state);
    res.status(queued ? 202 : 200).json({ok:ready,queued,applied,decision,
      error:ready ? undefined : decision.error || 'The decision needs attention. No source change was queued.'});
  } catch (err) {
    logger.error({err}, 'source decision sync refused');
    res.status(409).json({ok:false,error:'The original source decision could not be verified. No change was queued.'});
  }
}

async function setCompanyUrl(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (!canChangeSources()) {
    queueSourceChange(req, res, userSub);
    return;
  }
  const companyId = parseInt(String(req.query.companyId ?? ''), 10);
  const url = String(req.query.url ?? '').trim();
  if (!companyId || !url) { res.status(400).json({ error: 'companyId and url required' }); return; }
  const result = await runCareerCliAwait(
    ctx.pool, userSub, ['seturl', '--company-id', String(companyId), '--url', url],
  );
  if (result.limitReason) {
    rejectEngineStart(res, { started: false, limitReason: result.limitReason }, 'company refresh');
    return;
  }
  let parsed: unknown = null;
  try { parsed = JSON.parse((result.out || '').trim().split('\n').pop() || '{}'); }
  catch (err) { logger.warn({ err, companyId }, 'company refresh returned non-JSON output'); }
  res.json({
    ok: result.ok,
    result: parsed,
    error: result.ok ? undefined : (result.err || '').slice(-300),
  });
}

/**
 * @description Registers the administrator-only shared-company routes.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used to run the brokered company refresh command.
 * @returns Nothing.
 */
export function registerCareerCompanyRoutes(router: Router, ctx: AppContext): void {
  router.get(
    '/companies-admin', requireCareerAdmin,
    createCareerToolFileHandler('career-companies.html'),
  );
  router.get('/companies-admin/list', requireCareerAdmin, listCompanies);
  router.post('/companies-admin/seturl', requireCareerAdmin, (req, res) => {
    void setCompanyUrl(ctx, req, res);
  });
  router.post('/companies-admin/add', requireCareerAdmin, employerChange('add'));
  router.post('/companies-admin/remove', requireCareerAdmin, employerChange('remove'));
  router.post('/companies-admin/restore', requireCareerAdmin, employerChange('restore'));
  router.post('/companies-admin/keep', requireCareerAdmin, employerChange('keep'));
  router.post('/companies-admin/maintenance-report', requireCareerAdmin, (req,res) => { void maintenanceReport(ctx,req,res); });
  router.post('/companies-admin/decision-sync', requireCareerAdmin, (req,res) => { void syncDecision(ctx,req,res); });
}
