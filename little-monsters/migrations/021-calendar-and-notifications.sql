/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-07 12:00:00 | roger.murphy@agenticfederal.us   | Documentation backfill: added file-header change log block
 */

-- =============================================================================
-- Migration 021: Calendar Events and Notifications
-- Date: 2026-04-20
-- Author: roger.murphy@emeraldcoastsystemsgroup.com
-- Description: Calendar events auto-created from assignments with reminder
--              scheduling. Notifications table for in-app, email, SMS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lm_calendar_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID REFERENCES lm_classes(class_id) ON DELETE CASCADE,
  student_id UUID REFERENCES lm_students(student_id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT DEFAULT '',
  event_type VARCHAR(30) NOT NULL DEFAULT 'assignment'
    CHECK (event_type IN ('assignment', 'quiz', 'test', 'lecture', 'study-session', 'reminder', 'custom')),
  event_date DATE NOT NULL,
  event_time TIME,
  source_assignment_id UUID REFERENCES lm_assignments(assignment_id) ON DELETE SET NULL,
  remind_at TIMESTAMPTZ,
  reminder_sent BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lm_cal_events_date ON lm_calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_lm_cal_events_class ON lm_calendar_events(class_id);
CREATE INDEX IF NOT EXISTS idx_lm_cal_events_remind ON lm_calendar_events(remind_at) WHERE NOT reminder_sent;

CREATE TABLE IF NOT EXISTS lm_notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES lm_students(student_id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  body TEXT NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'in-app'
    CHECK (channel IN ('in-app', 'email', 'sms')),
  read BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_lm_notifications_student ON lm_notifications(student_id, read);
