/**
 * Retired Google Calendar bridge.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Fail closed until OAuth credentials and external calendars are tenant-bound
 * ---------------------------------------------------------------------------
 *
 * @module education-google-calendar-routes
 */

import { Router, type Request, type Response } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { EducationAccessError, resolveAuthedStudent } from './education-access';

const logger = createChildLogger({ module: 'education-google-calendar-routes' });
const RETIRED_MESSAGE = 'Google Calendar sync is unavailable until OAuth credentials are bound to a school tenant.';

/** Authenticate before returning the stable retirement response. */
async function retiredCalendarBridge(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const caller = await resolveAuthedStudent(req, ctx.pool);
    logger.info({ tenantId: caller.tenantId, path: req.path }, 'Rejected access to retired shared calendar bridge');
    res.status(410).json({
      error: RETIRED_MESSAGE,
      code: 'TENANT_CALENDAR_CREDENTIALS_REQUIRED',
      connected: false,
      howToConnect: 'An operator must configure a separate OAuth profile for this school before sync can be enabled.',
    });
  } catch (err) {
    if (err instanceof EducationAccessError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    logger.error({ err }, 'Failed to reject retired calendar bridge request');
    res.status(500).json({ error: 'Calendar bridge status is unavailable' });
  }
}

/** Preserve endpoint compatibility without exposing the controller-wide OAuth profile. */
export function createRetiredGoogleCalendarRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get('/calendar/google/status', (req, res) => retiredCalendarBridge(ctx, req, res));
  router.post('/calendar/google/push', (req, res) => retiredCalendarBridge(ctx, req, res));
  router.get('/calendar/google/pull', (req, res) => retiredCalendarBridge(ctx, req, res));
  return router;
}
