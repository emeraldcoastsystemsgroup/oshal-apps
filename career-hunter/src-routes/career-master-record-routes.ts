/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The master record (1.51.0): GET /master-record-ui serves the Master record page; GET /master-record answers the caller's whole record for that page, and GET /master-record?page=N one page of at most 12 KB for the concierge tool career_master_record. Both read only the caller's own store, found without creating one: no write, no engine run, no model, so the route spends nothing and changes nothing.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 4, 11, 12, 13 and 14: one name for each page and for each role. The two refusals speak of the person's data, as the page Download my data does (was the master record). Words only.
 */

/**
 * Master record routes: everything Career keeps for the signed-in person, read-only.
 * @module career-master-record-routes
 */
import { type Request, type Response, type Router } from 'express';
import { createChildLogger } from '@/shared/logger';
import { createCareerToolFileHandler } from './career-surface-routes';
import { callerSub, findUserPaths } from './career-user-store';

interface MasterRecord { counts: Record<string, number>; revision: string }
const masterRecord = require('../lib/career-master-record') as {
  readMasterRecord: (paths: { userDir: string; userDb: string } | null) => MasterRecord;
  pageOf: (record: MasterRecord, page: number) => Record<string, unknown> | null;
};

const logger = createChildLogger({ module: 'career-master-record-routes' });

/** The requested concierge page: absent is the whole record; anything but a whole number from 1 is refused. */
function requestedPage(value: unknown): number | null | 'invalid' {
  if (value === undefined) return null;
  const page = typeof value === 'string' && /^[1-9]\d{0,4}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(page) ? page : 'invalid';
}

/**
 * @description GET /master-record: the caller's whole master record (the page), or with ?page=N one
 * concierge page of at most 12 KB. Refuses an anonymous caller before reading anything.
 * @param req - The request; its caller is the only person whose store is read.
 * @param res - The response.
 * @returns Nothing; the answer is written to `res`.
 */
export function serveMasterRecord(req: Request, res: Response): void {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const page = requestedPage(req.query.page);
  if (page === 'invalid') { res.status(400).json({ error: 'Choose a page number from 1.' }); return; }
  const started = Date.now();
  logger.info({ userSub, page }, 'master record read started');
  try {
    const whole = masterRecord.readMasterRecord(findUserPaths(userSub));
    const answer = page === null ? whole : masterRecord.pageOf(whole, page);
    if (!answer) {
      res.status(404).json({ error: `Your data has no page ${page}.`, pages: masterRecord.pageOf(whole, 1)?.pages ?? 1 });
      return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(answer);
    logger.info({ userSub, page, ms: Date.now() - started, roles: whole.counts.roles }, 'master record read finished');
  } catch (err) {
    const status = (err as { status?: number }).status === 503 ? 503 : 500;
    logger.error({ err, userSub, page, ms: Date.now() - started }, 'master record read failed');
    res.status(status).json({ error: status === 503 ? (err as Error).message : 'Your data could not be read.' });
  }
}

/**
 * @description Registers the Master record page and its read-only data route.
 * @param router - The Career router mounted at /api/career-hunter.
 * @returns Nothing.
 */
export function registerCareerMasterRecordRoutes(router: Router): void {
  router.get('/master-record-ui', createCareerToolFileHandler('career-master-record.html'));
  router.get('/master-record', serveMasterRecord);
}
