-- 108-career-generated-queue-index.sql
--
-- Cover the owner-scoped Ready queue by its status and generated timestamp. The board's date
-- filter and the seven-day cleanup both constrain these columns; without the composite, the
-- PostgreSQL store must walk the caller's full application history for the old-row boundary.
-- The SQLite per-user schema creates the equivalent partial index in db.USER_SCHEMA.

CREATE INDEX IF NOT EXISTS idx_career_user_apps_generated
  ON career_user_applications(user_sub, generated_at DESC)
  WHERE status = 'generated' AND generated_at IS NOT NULL;
