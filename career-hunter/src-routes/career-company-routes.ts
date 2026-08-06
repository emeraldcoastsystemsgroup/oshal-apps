/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted administrator-only shared-company inspection and career-board refresh routes.
 */

/**
 * Administrator routes for the shared Career Hunter company corpus.
 * @module career-company-routes
 */
import { type Request, type RequestHandler, type Response, type Router } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { callerSub, openUserDb } from './career-user-store';
import { runCareerCliAwait } from './career-engine-dispatch';
import { rejectEngineStart } from './career-engine-response';
import { createCareerToolFileHandler } from './career-surface-routes';

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

const requireCareerAdmin: RequestHandler = (req, res, next) => {
  if (!isCareerAdmin(callerSub(req))) { res.status(403).json({ error: 'admin only' }); return; }
  next();
};

function listCompanies(req: Request, res: Response): void {
  const userSub = callerSub(req);
  const db = userSub && openUserDb(userSub);
  if (!db) { res.json({ companies: [] }); return; }
  try {
    const companies = db.prepare(
      `SELECT c.id, c.name, c.ats_type, c.ats_token, c.careers_url, c.discover_status,
              (SELECT COUNT(*) FROM corpus.postings_corpus p WHERE p.company_id=c.id AND p.active=1) AS active_jobs
         FROM corpus.companies c
        ORDER BY active_jobs DESC, c.name`,
    ).all();
    res.json({ companies });
  } catch (err) {
    logger.error({ err, userSub }, 'company list failed');
    res.status(500).json({ error: 'read failed' });
  } finally { db.close(); }
}

async function setCompanyUrl(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
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
}
