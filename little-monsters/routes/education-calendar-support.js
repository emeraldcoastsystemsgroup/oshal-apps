"use strict";
/**
 * Shared calendar helpers.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Centralized validation and access-error responses for split calendar routes
 * ---------------------------------------------------------------------------
 *
 * @module education-calendar-support
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MONTH_PATTERN = exports.ISO_DATE_PATTERN = exports.UUID_PATTERN = void 0;
exports.formatDueUrgency = formatDueUrgency;
exports.sendCalendarAccessError = sendCalendarAccessError;
exports.requirePattern = requirePattern;
const education_access_1 = require("./education-access");
exports.UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
exports.ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
exports.MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Return a stable, child-friendly urgency label for a due date. */
function formatDueUrgency(dueDate) {
    const due = new Date(dueDate);
    const now = new Date();
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);
    if (diffDays < 0)
        return 'Overdue';
    if (diffDays === 0)
        return 'Due Today';
    if (diffDays === 1)
        return 'Due Tomorrow';
    if (diffDays <= 7)
        return `Due in ${diffDays} days`;
    return `Due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
/** Map the education access exception to its deliberately public HTTP response. */
function sendCalendarAccessError(res, err) {
    if (!(err instanceof education_access_1.EducationAccessError))
        return false;
    res.status(err.status).json({ error: err.message });
    return true;
}
/** Throw a caller-safe 400 without exposing PostgreSQL parser details. */
function requirePattern(value, pattern, field) {
    if (!pattern.test(value))
        throw new education_access_1.EducationAccessError(`${field} is invalid`, 400);
}
//# sourceMappingURL=education-calendar-support.js.map