"use strict";
/**
 * Principal-scoped notification and reminder routes.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Added tenant-safe targeting and transactional, idempotent reminder delivery
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Minimize notification reads to the authenticated caller's rendered response fields
 * ---------------------------------------------------------------------------
 *
 * @module education-notification-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationNotificationRoutes = createEducationNotificationRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const education_calendar_support_1 = require("./education-calendar-support");
const logger = (0, logger_1.createChildLogger)({ module: 'education-notification-routes' });
const CHANNELS = new Set(['in-app', 'email', 'sms']);
/** List notifications belonging to the authenticated principal only. */
async function listNotifications(ctx, req, res) {
    try {
        const caller = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const readFilter = req.query.all === 'true' ? '' : 'AND NOT read';
        const result = await ctx.pool.query(`SELECT notification_id, title, body, channel, read, sent_at
         FROM lm_notifications WHERE student_id = $1 ${readFilter}
       ORDER BY sent_at DESC LIMIT 50`, [caller.studentId]);
        res.json({
            notifications: result.rows,
            unreadCount: result.rows.filter(notification => !notification.read).length,
        });
    }
    catch (err) {
        if ((0, education_calendar_support_1.sendCalendarAccessError)(res, err))
            return;
        logger.error({ err }, 'Failed to list notifications');
        res.status(500).json({ error: 'Failed to list notifications' });
    }
}
/** Send only to self or to a student the caller is entitled to view. */
async function sendNotification(ctx, req, res) {
    try {
        const caller = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const studentId = String(req.body?.studentId ?? '');
        const title = String(req.body?.title ?? '').trim();
        const body = String(req.body?.body ?? '').trim();
        const channel = String(req.body?.channel || 'in-app');
        (0, education_calendar_support_1.requirePattern)(studentId, education_calendar_support_1.UUID_PATTERN, 'studentId');
        if (!title || title.length > 500 || !body || body.length > 10_000) {
            res.status(400).json({ error: 'title and body must be non-empty and within their size limits' });
            return;
        }
        if (!CHANNELS.has(channel)) {
            res.status(400).json({ error: 'channel must be in-app, email, or sms' });
            return;
        }
        const result = await ctx.pool.query(`INSERT INTO lm_notifications (student_id, title, body, channel)
       SELECT s.student_id, $2, $3, $4 FROM lm_students s
        WHERE s.student_id = $1 AND (
          s.student_id = $5
          OR ($6::boolean AND s.tenant_id = $7)
          OR ($8::boolean AND s.tenant_id = $7 AND EXISTS (
            SELECT 1 FROM lm_enrollments e JOIN lm_classes c ON c.class_id = e.class_id
             WHERE e.student_id = s.student_id AND c.teacher_student_id = $5
               AND c.tenant_id = $7 AND c.status = 'active'
          ))
        ) RETURNING notification_id`, [studentId, title, body, channel, caller.studentId,
            caller.role === 'admin', caller.tenantId, caller.role === 'teacher']);
        if (!result.rows[0])
            throw new education_access_1.EducationAccessError('Student not found', 404);
        logger.info({ notificationId: result.rows[0].notification_id, studentId, channel }, 'Notification created');
        res.status(201).json({ notificationId: result.rows[0].notification_id, channel });
    }
    catch (err) {
        if ((0, education_calendar_support_1.sendCalendarAccessError)(res, err))
            return;
        logger.error({ err }, 'Failed to send notification');
        res.status(500).json({ error: 'Failed to send notification' });
    }
}
/** Lock a bounded caller-visible batch so concurrent requests cannot duplicate it. */
async function lockDueReminders(client, caller) {
    const result = await client.query(`SELECT e.event_id, e.class_id, e.student_id, e.title, e.description,
            e.event_date, e.event_type, c.name AS class_name
       FROM lm_calendar_events e
       LEFT JOIN lm_classes c ON c.class_id = e.class_id
      WHERE e.remind_at <= NOW() AND NOT e.reminder_sent
        AND (e.student_id = $1 OR (
          e.student_id IS NULL AND c.tenant_id = $2 AND (
            $3::boolean OR ($4::boolean AND c.teacher_student_id = $1)
            OR EXISTS (SELECT 1 FROM lm_enrollments ae
              WHERE ae.student_id = $1 AND ae.class_id = c.class_id)
          )
        ))
      ORDER BY e.remind_at
      FOR UPDATE OF e SKIP LOCKED
      LIMIT 50`, [caller.studentId, caller.tenantId,
        caller.role === 'admin', caller.role === 'teacher']);
    return result.rows;
}
/** Insert exactly the intended recipients for one locked reminder event. */
async function deliverReminder(client, event) {
    const urgency = (0, education_calendar_support_1.formatDueUrgency)(event.event_date);
    const title = `${event.class_name || 'Reminder'} - ${event.title}`;
    const body = `${urgency}\n${event.description || ''}\n\nReminder for ${event.event_date}`;
    const metadata = JSON.stringify({ eventId: event.event_id, eventType: event.event_type, urgency });
    if (event.student_id) {
        const result = await client.query(`INSERT INTO lm_notifications (student_id, title, body, channel, metadata)
       VALUES ($1, $2, $3, 'in-app', $4)`, [event.student_id, title, body, metadata]);
        return result.rowCount ?? 0;
    }
    const result = await client.query(`INSERT INTO lm_notifications (student_id, title, body, channel, metadata)
     SELECT e.student_id, $2, $3, 'in-app', $4
       FROM lm_enrollments e WHERE e.class_id = $1`, [event.class_id, title, body, metadata]);
    return result.rowCount ?? 0;
}
/** Deliver a visible batch in one transaction; rollback preserves retryability. */
async function deliverReminderBatch(ctx, caller) {
    const client = await ctx.pool.connect();
    try {
        await client.query('BEGIN');
        const events = await lockDueReminders(client, caller);
        let notificationsSent = 0;
        for (const event of events) {
            notificationsSent += await deliverReminder(client, event);
            await client.query('UPDATE lm_calendar_events SET reminder_sent = true WHERE event_id = $1', [event.event_id]);
        }
        await client.query('COMMIT');
        return { processed: events.length, notificationsSent };
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
/** Process only the caller's personal reminders and accessible shared class rows. */
async function processReminders(ctx, req, res) {
    try {
        const caller = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const output = await deliverReminderBatch(ctx, caller);
        logger.info({ ...output, studentId: caller.studentId }, 'Scoped reminder check complete');
        res.json(output);
    }
    catch (err) {
        if ((0, education_calendar_support_1.sendCalendarAccessError)(res, err))
            return;
        logger.error({ err }, 'Scoped reminder check failed');
        res.status(500).json({ error: 'Reminder check failed' });
    }
}
/** Mark one notification read only when it belongs to the caller. */
async function markNotificationRead(ctx, req, res) {
    try {
        const caller = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const notificationId = String(req.params.id);
        (0, education_calendar_support_1.requirePattern)(notificationId, education_calendar_support_1.UUID_PATTERN, 'notificationId');
        const result = await ctx.pool.query('UPDATE lm_notifications SET read = true WHERE notification_id = $1 AND student_id = $2', [notificationId, caller.studentId]);
        if (!result.rowCount) {
            res.status(404).json({ error: 'Notification not found' });
            return;
        }
        res.json({ success: true });
    }
    catch (err) {
        if ((0, education_calendar_support_1.sendCalendarAccessError)(res, err))
            return;
        logger.error({ err }, 'Failed to mark notification read');
        res.status(500).json({ error: 'Failed to mark notification read' });
    }
}
/** Register notification routes with no client-supplied visibility scope. */
function createEducationNotificationRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/notifications', (req, res) => listNotifications(ctx, req, res));
    router.post('/notify', (req, res) => sendNotification(ctx, req, res));
    router.post('/check-reminders', (req, res) => processReminders(ctx, req, res));
    router.patch('/notifications/:id/read', (req, res) => markNotificationRead(ctx, req, res));
    return router;
}
//# sourceMappingURL=education-notification-routes.js.map