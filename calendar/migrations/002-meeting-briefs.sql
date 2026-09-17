-- Per-meeting briefs assembled in the background from material the caller already recorded.
-- One row per (owner, calendar event). `brief` holds the assembled document INCLUDING the exact
-- delivery text, so the surface renders the same bytes that were delivered and the two cannot
-- drift. No attendee identities are stored: the preparation snapshot does not carry any.
--
-- `brief` HOLDS NO AMBIENT TEXT, and that is a requirement of this table rather than an accident
-- of the current assembler. Nothing here is reached by an ambient control: not the owner's
-- transcript_retention_days prune, not deleteDay or clearTranscriptData, not the privacy route's
-- ambient erasure, and not the per-speaker consent decline that purges derived material. A
-- transcript excerpt or daily-review summary copied into this column would therefore outlive every
-- one of them, including a consent a heard person withdrew. Briefs cite ambient rows by id; the
-- words stay in ambient_transcript_segments and ambient_daily_reviews, where those controls apply.
CREATE TABLE IF NOT EXISTS calendar_meeting_briefs (
 user_sub text NOT NULL,
 event_id text NOT NULL,
 series_key text NOT NULL,
 title text NOT NULL,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz,
 brief jsonb NOT NULL DEFAULT '{}'::jsonb,
 built_at timestamptz NOT NULL,
 PRIMARY KEY (user_sub, event_id)
);
CREATE INDEX IF NOT EXISTS calendar_meeting_briefs_owner_start
 ON calendar_meeting_briefs (user_sub, starts_at DESC);
CREATE INDEX IF NOT EXISTS calendar_meeting_briefs_owner_series
 ON calendar_meeting_briefs (user_sub, series_key, starts_at DESC);
ALTER TABLE calendar_meeting_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_meeting_briefs FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='calendar_meeting_briefs' AND policyname='calendar_meeting_briefs_owner') THEN
 CREATE POLICY calendar_meeting_briefs_owner ON calendar_meeting_briefs
 USING(user_sub=nullif(current_setting('oshal.current_sub',true),'') OR current_setting('oshal.is_operator',true)='true')
 WITH CHECK(user_sub=nullif(current_setting('oshal.current_sub',true),'') OR current_setting('oshal.is_operator',true)='true');
 END IF;
END $$;
