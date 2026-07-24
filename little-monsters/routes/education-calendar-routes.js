"use strict";
/**
 * Education Calendar & Notification Routes
 *
 * Calendar events, reminders, notifications, and class info for Little Monsters.
 * Calendar events auto-create from assignments. Reminders fire as in-app
 * notifications with "Due Tomorrow" / "Due Today" countdowns.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * DATE           | AUTHOR                    | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 2026-04-20     | roger.murphy@emeraldcoastsystemsgroup.com    | Initial creation
 * 2026-06-12 20:50:00 | roger.murphy@agenticfederal.us   | Google Calendar two-way sync: /calendar/google/status (connection probe), /calendar/google/push (push local events → Google, idempotent via google_event_id), /calendar/google/pull (read upcoming Google events). Reuses the google-bot OAuth token via the injected GoogleCalendarService.
 * 2026-06-13 09:30:00 | roger.murphy@agenticfederal.us   | PATCH /classes/:id is owner-gated (assertTeacherOfClass) and editable: name/teacher/subject/grade/room/schedule/website/description plus status (active|archived). Archiving deregisters the class ribbon icon; reactivating re-registers it.
 * 2026-06-13 14:10:00 | roger.murphy@agenticfederal.us   | PATCH /classes/:id also toggles published (class bank). Setting published=true is teacher-gated (assertTeacher); a student-owner can edit/share but not publish to the school.
 * 2026-06-17 21:05:00 | roger.murphy@emeraldcoastsystemsgroup.com    | SECURITY: close cross-student/cross-class leak — every calendar/notification handler now resolves identity from the SSO session (never a client-supplied studentId) and gates class access via assertClassAccess; notifications scope to the caller; teacher-only writes gated by assertTeacherOfClass/assertTeacher.
 * ---------------------------------------------------------------------------
 *
 * @module education-calendar-routes
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationCalendarRoutes = createEducationCalendarRoutes;
const express_1 = require("express");
const node_fs_1 = __importDefault(require("node:fs"));
const logger_1 = require("@/shared/logger");
const google_calendar_service_1 = require("./google-calendar-service");
const voice_providers_1 = require("@/features/voice-providers");
const education_access_1 = require("./education-access");
const tool_routes_1 = require("@/app/routes/tool-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'education-calendar' });
/** Map an EducationAccessError to its HTTP status; returns true if handled. */
function sendAccessError(res, err) {
    if (err instanceof education_access_1.EducationAccessError) {
        res.status(err.status).json({ error: err.message });
        return true;
    }
    return false;
}
/** The student's school events shouldn't be buried — give them a 30-min popup. */
const DEFAULT_REMINDER_MINUTES = 30;
/**
 * Format a due date into a human-readable urgency string.
 * "Due Today", "Due Tomorrow", "Due in 3 days", "Due Apr 25"
 */
function formatDueUrgency(dueDate) {
    const due = new Date(dueDate);
    const now = new Date();
    // Zero out time for day comparison
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((dueDay.getTime() - today.getTime()) / (86400000));
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
/**
 * @description Builds and returns the Express router for the education calendar and
 * notification feature, wiring up endpoints for calendar events, auto-creating
 * calendar events/reminders from assignments, in-app/email/sms notifications,
 * cron-driven reminder processing, and class metadata. Routes share the database
 * pool and logger supplied via the application context.
 * @param ctx - The application context providing the database pool and shared services.
 * @returns A configured Express Router with all education calendar and notification routes mounted.
 */
function createEducationCalendarRoutes(ctx) {
    const router = (0, express_1.Router)();
    // ═══════════════════════════════════════════════════════════════════════════
    // CALENDAR EVENTS
    // ═══════════════════════════════════════════════════════════════════════════
    /** GET /api/education/calendar?classId=X&month=YYYY-MM — list calendar events.
     *  Scoped to the caller: their own personal events (or class-shared ones) for
     *  classes they can access. studentId is taken from the session, never the query. */
    router.get('/calendar', async (req, res) => {
        try {
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const { classId, month } = req.query;
            let sql = `SELECT e.*, c.name as class_name, c.subject
                 FROM lm_calendar_events e
                 LEFT JOIN lm_classes c ON e.class_id = c.class_id
                 WHERE 1=1`;
            const params = [];
            // Only the caller's personal events (student_id = me) or shared ones (NULL).
            params.push(me.studentId);
            sql += ` AND (e.student_id = $${params.length} OR e.student_id IS NULL)`;
            if (classId) {
                // A specific class — must be enrolled / teach it.
                await (0, education_access_1.assertClassAccess)(ctx.pool, me, String(classId));
                params.push(classId);
                sql += ` AND e.class_id = $${params.length}`;
            }
            else {
                // No class filter — limit shared/class events to classes the caller can
                // access; personal events (class_id NULL) are always the caller's own.
                const accessible = await (0, education_access_1.listAccessibleClassIds)(ctx.pool, me);
                params.push(accessible);
                sql += ` AND (e.class_id = ANY($${params.length}::uuid[]) OR e.class_id IS NULL)`;
            }
            if (month) {
                // month format: YYYY-MM
                params.push(`${month}-01`);
                params.push(`${month}-01`);
                sql += ` AND e.event_date >= $${params.length - 1}::date AND e.event_date < ($${params.length}::date + interval '1 month')`;
            }
            sql += ' ORDER BY e.event_date ASC, e.event_time ASC NULLS LAST';
            const result = await ctx.pool.query(sql, params);
            // Add urgency labels
            const events = result.rows.map((e) => ({
                ...e,
                urgency: formatDueUrgency(e.event_date),
            }));
            res.json({ events });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to list calendar events');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/education/calendar — create a PERSONAL calendar event for the caller.
     *  student_id is forced to the session identity; class-wide events are created via
     *  /assignments-with-events (teacher-gated), not here. */
    router.post('/calendar', async (req, res) => {
        try {
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const { classId, title, description, eventType, eventDate, eventTime, remindAt, metadata } = req.body;
            if (!title || !eventDate) {
                res.status(400).json({ error: 'title and eventDate are required' });
                return;
            }
            // Attaching the event to a class requires access to that class.
            if (classId)
                await (0, education_access_1.assertClassAccess)(ctx.pool, me, String(classId));
            const result = await ctx.pool.query(`INSERT INTO lm_calendar_events
         (class_id, student_id, title, description, event_type, event_date, event_time, remind_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING event_id`, [classId || null, me.studentId, title, description || '', eventType || 'custom',
                eventDate, eventTime || null, remindAt || null, JSON.stringify(metadata || {})]);
            logger.info({ eventId: result.rows[0].event_id, title, eventDate, studentId: me.studentId }, 'Calendar event created');
            res.status(201).json({ eventId: result.rows[0].event_id });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to create calendar event');
            res.status(500).json({ error: err.message });
        }
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // AUTO-CREATE CALENDAR EVENTS FROM ASSIGNMENTS
    // ═══════════════════════════════════════════════════════════════════════════
    /** POST /api/education/assignments-with-events — create assignment + calendar event + reminder */
    router.post('/assignments-with-events', async (req, res) => {
        try {
            const { classId, title, description, assignmentType, dueDate, resources } = req.body;
            if (!classId || !title) {
                res.status(400).json({ error: 'classId and title are required' });
                return;
            }
            // Creating an assignment + class-wide event is a teacher action for THIS class.
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertTeacherOfClass)(ctx.pool, me, String(classId));
            const client = await ctx.pool.connect();
            try {
                await client.query('BEGIN');
                // 1. Create the assignment
                const assignResult = await client.query(`INSERT INTO lm_assignments (class_id, title, description, assignment_type, due_date, resources)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING assignment_id`, [classId, title, description || '', assignmentType || 'homework', dueDate || null, JSON.stringify(resources || [])]);
                const assignmentId = assignResult.rows[0].assignment_id;
                // 2. Get class name for the event title
                const classResult = await client.query('SELECT name FROM lm_classes WHERE class_id = $1', [classId]);
                const className = classResult.rows[0]?.name || 'Class';
                // 3. Create calendar event if there's a due date
                let eventId = null;
                if (dueDate) {
                    const eventTitle = `${className}: ${title}`;
                    const urgency = formatDueUrgency(dueDate);
                    // Remind 1 day before at 5pm
                    const remindDate = new Date(dueDate);
                    remindDate.setDate(remindDate.getDate() - 1);
                    remindDate.setHours(17, 0, 0, 0);
                    const eventResult = await client.query(`INSERT INTO lm_calendar_events
             (class_id, title, description, event_type, event_date, event_time, source_assignment_id, remind_at, metadata)
             VALUES ($1, $2, $3, $4, $5, '17:00', $6, $7, $8)
             RETURNING event_id`, [classId, eventTitle, `${description || ''}\n\n${urgency}`,
                        assignmentType === 'test' || assignmentType === 'quiz-prep' ? assignmentType : 'assignment',
                        dueDate, assignmentId, remindDate.toISOString(),
                        JSON.stringify({ assignmentType, resources: resources || [], urgency })]);
                    eventId = eventResult.rows[0].event_id;
                }
                await client.query('COMMIT');
                logger.info({ assignmentId, eventId, classId, title, dueDate }, 'Assignment + calendar event created');
                res.status(201).json({ assignmentId, eventId, dueDate, urgency: dueDate ? formatDueUrgency(dueDate) : null });
            }
            catch (txErr) {
                await client.query('ROLLBACK');
                throw txErr;
            }
            finally {
                client.release();
            }
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to create assignment with events');
            res.status(500).json({ error: err.message });
        }
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════════════════════
    /** GET /api/education/notifications — the caller's own notifications. The owner is
     *  the session identity; a client-supplied studentId is ignored. */
    router.get('/notifications', async (req, res) => {
        try {
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const { all } = req.query;
            const readFilter = all === 'true' ? '' : 'AND NOT n.read';
            const result = await ctx.pool.query(`SELECT * FROM lm_notifications n WHERE n.student_id = $1 ${readFilter}
         ORDER BY n.sent_at DESC LIMIT 50`, [me.studentId]);
            res.json({ notifications: result.rows, unreadCount: result.rows.filter((n) => !n.read).length });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to list notifications');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/education/notify — send a notification. A caller may notify themselves;
     *  notifying another student requires teacher/admin role (assertTeacher). */
    router.post('/notify', async (req, res) => {
        try {
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const { studentId, title, body, channel } = req.body;
            if (!studentId || !title || !body) {
                res.status(400).json({ error: 'studentId, title, and body are required' });
                return;
            }
            // Only teachers/admins may notify someone other than themselves.
            if (String(studentId) !== me.studentId)
                (0, education_access_1.assertTeacher)(me);
            const notifChannel = channel || 'in-app';
            // Create in-app notification
            const result = await ctx.pool.query(`INSERT INTO lm_notifications (student_id, title, body, channel)
         VALUES ($1, $2, $3, $4) RETURNING notification_id`, [studentId, title, body, notifChannel]);
            // For email/sms, log the intent (actual send requires external service)
            if (notifChannel === 'email') {
                logger.info({ studentId, title, channel: 'email' }, 'Email notification queued (requires email service integration)');
            }
            else if (notifChannel === 'sms') {
                logger.info({ studentId, title, channel: 'sms' }, 'SMS notification queued (requires SMS service integration)');
            }
            logger.info({ notificationId: result.rows[0].notification_id, studentId, channel: notifChannel }, 'Notification sent');
            res.status(201).json({ notificationId: result.rows[0].notification_id, channel: notifChannel });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to send notification');
            res.status(500).json({ error: err.message });
        }
    });
    /** PATCH /api/education/notifications/:id/read — mark the caller's OWN notification
     *  as read. The student_id guard prevents marking another student's notifications. */
    router.patch('/notifications/:id/read', async (req, res) => {
        try {
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const r = await ctx.pool.query('UPDATE lm_notifications SET read = true WHERE notification_id = $1 AND student_id = $2', [req.params.id, me.studentId]);
            if (r.rowCount === 0) {
                res.status(404).json({ error: 'Notification not found' });
                return;
            }
            res.json({ success: true });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            res.status(500).json({ error: err.message });
        }
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // REMINDER CHECK (called by cron/scheduler — fires due reminders)
    // ═══════════════════════════════════════════════════════════════════════════
    /** POST /api/education/check-reminders — process pending reminders */
    router.post('/check-reminders', async (req, res) => {
        try {
            // Find events with remind_at <= now that haven't been sent
            const dueReminders = await ctx.pool.query(`SELECT e.*, c.name as class_name
         FROM lm_calendar_events e
         LEFT JOIN lm_classes c ON e.class_id = c.class_id
         WHERE e.remind_at <= NOW() AND NOT e.reminder_sent
         ORDER BY e.remind_at ASC LIMIT 50`);
            let sent = 0;
            for (const event of dueReminders.rows) {
                const urgency = formatDueUrgency(event.event_date);
                const reminderTitle = `${event.class_name || 'Class'} — ${event.title}`;
                const reminderBody = `${urgency}\n${event.description || ''}\n\nReminder for ${event.event_date}`;
                // Find all enrolled students for this class
                const students = await ctx.pool.query('SELECT student_id FROM lm_enrollments WHERE class_id = $1', [event.class_id]);
                for (const student of students.rows) {
                    await ctx.pool.query(`INSERT INTO lm_notifications (student_id, title, body, channel, metadata)
             VALUES ($1, $2, $3, 'in-app', $4)`, [student.student_id, reminderTitle, reminderBody,
                        JSON.stringify({ eventId: event.event_id, eventType: event.event_type, urgency })]);
                    sent++;
                }
                // Mark reminder as sent
                await ctx.pool.query('UPDATE lm_calendar_events SET reminder_sent = true WHERE event_id = $1', [event.event_id]);
            }
            logger.info({ processed: dueReminders.rows.length, notificationsSent: sent }, 'Reminder check complete');
            res.json({ processed: dueReminders.rows.length, notificationsSent: sent });
        }
        catch (err) {
            logger.error({ err }, 'Reminder check failed');
            res.status(500).json({ error: err.message });
        }
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // CLASS INFO (metadata, links, teacher contact)
    // ═══════════════════════════════════════════════════════════════════════════
    /** GET /api/education/classes/:classId/info — full class info with metadata.
     *  Requires the caller to be enrolled in (or teach) the class. */
    router.get('/classes/:classId/info', async (req, res) => {
        try {
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertClassAccess)(ctx.pool, me, String(req.params.classId));
            const result = await ctx.pool.query(`SELECT c.*,
          (SELECT COUNT(*) FROM lm_enrollments e WHERE e.class_id = c.class_id) as student_count,
          (SELECT COUNT(*) FROM lm_lectures l WHERE l.class_id = c.class_id) as lecture_count,
          (SELECT COUNT(*) FROM lm_assignments a WHERE a.class_id = c.class_id AND a.status = 'active') as active_assignments,
          (SELECT COALESCE(SUM(card_count), 0) FROM lm_flashcard_sets fs WHERE fs.class_id = c.class_id) as total_flashcards
         FROM lm_classes c WHERE c.class_id = $1`, [req.params.classId]);
            if (result.rows.length === 0) {
                res.status(404).json({ error: 'Class not found' });
                return;
            }
            const cls = result.rows[0];
            // Get upcoming events for this class
            const events = await ctx.pool.query(`SELECT * FROM lm_calendar_events WHERE class_id = $1 AND event_date >= CURRENT_DATE
         ORDER BY event_date ASC LIMIT 10`, [req.params.classId]);
            res.json({
                ...cls,
                upcomingEvents: events.rows.map((e) => ({ ...e, urgency: formatDueUrgency(e.event_date) })),
            });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to get class info');
            res.status(500).json({ error: err.message });
        }
    });
    /** PATCH /api/education/classes/:classId — edit class settings and/or archive it.
     *  Owner-only (teacher of the class). `status` ('active'|'archived') hides/shows the
     *  class WITHOUT deleting any history; the ribbon icon is (de)registered to match. */
    router.patch('/classes/:classId', async (req, res) => {
        try {
            const classId = String(req.params.classId);
            const editor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertTeacherOfClass)(ctx.pool, editor, classId); // 403 unless owner/admin
            const { name, subject, teacherName, gradeLevel, description, website, schedule, room, status, published } = req.body;
            const metadata = { website: website || '', schedule: schedule || '', room: room || '' };
            const nextStatus = status === 'active' || status === 'archived' ? status : null;
            const nextPublished = typeof published === 'boolean' ? published : null;
            // Publishing to the school-wide class bank is a teacher action; a
            // student-owner can edit/share their class but keeps it private.
            if (nextPublished === true)
                (0, education_access_1.assertTeacher)(editor);
            await ctx.pool.query(`UPDATE lm_classes SET
          name = COALESCE($2, name),
          subject = COALESCE($3, subject),
          teacher_name = COALESCE($4, teacher_name),
          grade_level = COALESCE($5, grade_level),
          description = COALESCE($6, description),
          metadata = $7,
          status = COALESCE($8, status),
          published = COALESCE($9, published),
          updated_at = NOW()
         WHERE class_id = $1`, [classId, name, subject, teacherName, gradeLevel, description, JSON.stringify(metadata), nextStatus, nextPublished]);
            // Keep the ribbon icon in sync: archived → hidden, active → visible.
            const iconName = `lm-class-${classId.substring(0, 8)}`;
            if (nextStatus === 'archived') {
                (0, tool_routes_1.deregisterDynamicToolUI)(iconName);
            }
            else if (nextStatus === 'active') {
                const r = await ctx.pool.query('SELECT name FROM lm_classes WHERE class_id = $1', [classId]);
                if (r.rows[0])
                    (0, tool_routes_1.registerDynamicToolUI)(iconName, r.rows[0].name, 'codicon codicon-book', `/api/education/class?classId=${classId}`, `class-tutor-${classId.substring(0, 8)}`);
            }
            res.json({ success: true, status: nextStatus || undefined });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to update class');
            res.status(500).json({ error: err.message });
        }
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // GOOGLE CALENDAR SYNC
    // Reuses the google-bot OAuth profile (same credentials the voice STT uses).
    // The token provider is injected so the google-calendar feature stays
    // decoupled from voice-providers; the app layer wires the two together here.
    // ═══════════════════════════════════════════════════════════════════════════
    const calendar = new google_calendar_service_1.GoogleCalendarService(async () => (await (0, voice_providers_1.getGoogleAccessToken)()).accessToken);
    /** GET /api/education/calendar/google/status — is a Google account connected? */
    router.get('/calendar/google/status', async (_req, res) => {
        try {
            const probe = (0, voice_providers_1.probeGoogleOAuth)();
            let accountEmail = null;
            if (probe.ready) {
                try {
                    const profile = JSON.parse(node_fs_1.default.readFileSync((0, voice_providers_1.resolveOAuthProfilePath)(), 'utf8'));
                    accountEmail = profile.accountEmail || null;
                }
                catch { /* email is best-effort */ }
            }
            res.json({
                connected: probe.ready,
                accountEmail,
                reason: probe.reason,
                howToConnect: probe.ready ? undefined : 'Run `node scripts/google-workspace-cli.js auth login` and mount ~/.oshal-google-workspace into the api container',
            });
        }
        catch (err) {
            logger.error({ err }, 'Failed to probe Google Calendar connection');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /api/education/calendar/google/push — push local events (optionally
     *  filtered by classId / studentId / fromDate) to Google Calendar. Idempotent:
     *  events that already carry a google_event_id are skipped. */
    router.post('/calendar/google/push', async (req, res) => {
        try {
            // Pushing to the shared operator Google account is a staff action.
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            const { classId, studentId, fromDate } = req.body || {};
            if (classId)
                await (0, education_access_1.assertTeacherOfClass)(ctx.pool, me, String(classId));
            else
                (0, education_access_1.assertTeacher)(me);
            const params = [];
            let sql = `SELECT e.*, c.name AS class_name FROM lm_calendar_events e
                 LEFT JOIN lm_classes c ON e.class_id = c.class_id
                 WHERE e.google_event_id IS NULL`;
            if (classId) {
                params.push(classId);
                sql += ` AND e.class_id = $${params.length}`;
            }
            if (studentId) {
                params.push(studentId);
                sql += ` AND (e.student_id = $${params.length} OR e.student_id IS NULL)`;
            }
            params.push(fromDate || new Date().toISOString().slice(0, 10));
            sql += ` AND e.event_date >= $${params.length}::date ORDER BY e.event_date ASC LIMIT 100`;
            const { rows } = await ctx.pool.query(sql, params);
            if (rows.length === 0) {
                res.json({ pushed: 0, skipped: 0, events: [], note: 'Nothing new to push — all events already synced.' });
                return;
            }
            let pushed = 0;
            const failures = [];
            for (const ev of rows) {
                try {
                    const created = await calendar.createEvent({
                        summary: ev.class_name ? `${ev.title} (${ev.class_name})` : ev.title,
                        description: ev.description || '',
                        date: new Date(ev.event_date).toISOString().slice(0, 10),
                        time: ev.event_time || null,
                        reminderMinutes: DEFAULT_REMINDER_MINUTES,
                    });
                    await ctx.pool.query('UPDATE lm_calendar_events SET google_event_id = $1, google_synced_at = NOW() WHERE event_id = $2', [created.id, ev.event_id]);
                    pushed += 1;
                }
                catch (err) {
                    failures.push({ eventId: ev.event_id, error: err.message });
                    // A token/connection failure dooms the whole batch — stop early.
                    if (/not connected|401|invalid_grant/i.test(err.message))
                        break;
                }
            }
            logger.info({ pushed, candidates: rows.length, failures: failures.length }, 'Pushed local events to Google Calendar');
            res.status(failures.length && !pushed ? 502 : 200).json({ pushed, candidates: rows.length, failures });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Google Calendar push failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/education/calendar/google/pull?days=N — read upcoming events from
     *  the connected Google Calendar (read-through for display; does not write). */
    router.get('/calendar/google/pull', async (req, res) => {
        try {
            // Reading the shared operator Google calendar is a staff action.
            const me = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            (0, education_access_1.assertTeacher)(me);
            const days = Math.min(parseInt(String(req.query.days || '30'), 10) || 30, 90);
            const timeMax = new Date(Date.now() + days * 86400000).toISOString();
            const events = await calendar.listUpcoming({ timeMax });
            res.json({ events, count: events.length });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            const notConnected = /not connected/i.test(err.message);
            logger.error({ err }, 'Google Calendar pull failed');
            res.status(notConnected ? 503 : 500).json({ error: err.message, connected: !notConnected });
        }
    });
    logger.info('Education calendar + notification routes registered');
    return router;
}
//# sourceMappingURL=education-calendar-routes.js.map