/**
 * Education calendar composition root.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | roger.murphy@emeraldcoastsystemsgroup.com   | Added calendar events and notifications
 * 2   | roger.murphy@agenticfederal.us              | Added Google Calendar synchronization
 * 3   | roger.murphy@agenticfederal.us              | Added class metadata editing and archival
 * 4   | roger.murphy@agenticfederal.us              | Added class publishing controls
 * 5   | roger.murphy@emeraldcoastsystemsgroup.com   | Bound calendar reads and writes to the signed-in principal
 * 6   | maintainer@emeraldcoastsystemsgroup.com     | Split security domains and removed globally shared calendar credentials
 * ---------------------------------------------------------------------------
 *
 * @module education-calendar-routes
 */

import { Router } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { createCalendarEventRoutes } from './education-calendar-event-routes';
import { createEducationNotificationRoutes } from './education-notification-routes';
import { createEducationClassInfoRoutes } from './education-class-info-routes';
import { createRetiredGoogleCalendarRoutes } from './education-google-calendar-routes';

const logger = createChildLogger({ module: 'education-calendar-routes' });

/** Compose the independently testable calendar security domains. */
export function createEducationCalendarRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(createCalendarEventRoutes(ctx));
  router.use(createEducationNotificationRoutes(ctx));
  router.use(createEducationClassInfoRoutes(ctx));
  router.use(createRetiredGoogleCalendarRoutes(ctx));
  logger.info('Education calendar and notification routes registered');
  return router;
}
