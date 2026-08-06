"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRetiredGoogleCalendarRoutes = createRetiredGoogleCalendarRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const logger = (0, logger_1.createChildLogger)({ module: 'education-google-calendar-routes' });
const RETIRED_MESSAGE = 'Google Calendar sync is unavailable until OAuth credentials are bound to a school tenant.';
/** Authenticate before returning the stable retirement response. */
async function retiredCalendarBridge(ctx, req, res) {
    try {
        const caller = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        logger.info({ tenantId: caller.tenantId, path: req.path }, 'Rejected access to retired shared calendar bridge');
        res.status(410).json({
            error: RETIRED_MESSAGE,
            code: 'TENANT_CALENDAR_CREDENTIALS_REQUIRED',
            connected: false,
            howToConnect: 'An operator must configure a separate OAuth profile for this school before sync can be enabled.',
        });
    }
    catch (err) {
        if (err instanceof education_access_1.EducationAccessError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        logger.error({ err }, 'Failed to reject retired calendar bridge request');
        res.status(500).json({ error: 'Calendar bridge status is unavailable' });
    }
}
/** Preserve endpoint compatibility without exposing the controller-wide OAuth profile. */
function createRetiredGoogleCalendarRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/calendar/google/status', (req, res) => retiredCalendarBridge(ctx, req, res));
    router.post('/calendar/google/push', (req, res) => retiredCalendarBridge(ctx, req, res));
    router.get('/calendar/google/pull', (req, res) => retiredCalendarBridge(ctx, req, res));
    return router;
}
//# sourceMappingURL=education-google-calendar-routes.js.map