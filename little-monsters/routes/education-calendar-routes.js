"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationCalendarRoutes = createEducationCalendarRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_calendar_event_routes_1 = require("./education-calendar-event-routes");
const education_notification_routes_1 = require("./education-notification-routes");
const education_class_info_routes_1 = require("./education-class-info-routes");
const education_google_calendar_routes_1 = require("./education-google-calendar-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'education-calendar-routes' });
/** Compose the independently testable calendar security domains. */
function createEducationCalendarRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.use((0, education_calendar_event_routes_1.createCalendarEventRoutes)(ctx));
    router.use((0, education_notification_routes_1.createEducationNotificationRoutes)(ctx));
    router.use((0, education_class_info_routes_1.createEducationClassInfoRoutes)(ctx));
    router.use((0, education_google_calendar_routes_1.createRetiredGoogleCalendarRoutes)(ctx));
    logger.info('Education calendar and notification routes registered');
    return router;
}
//# sourceMappingURL=education-calendar-routes.js.map