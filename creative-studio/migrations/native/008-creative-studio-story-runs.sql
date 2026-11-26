-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                  | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com | Native per-person schema for Creative Studio 1.5.2 story production jobs; PostgreSQL additionally forces exact-owner RLS in migrations/008-creative-studio-story-runs.sql.

CREATE TABLE IF NOT EXISTS story_production_jobs (
  id UUID PRIMARY KEY,
  owner_key TEXT NOT NULL,
  owner_issuer TEXT NOT NULL CHECK(length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK(length(owner_sub) BETWEEN 1 AND 2048),
  project_id UUID,
  story_slug TEXT CHECK(story_slug IS NULL OR length(story_slug) BETWEEN 1 AND 120),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  script TEXT NOT NULL CHECK(length(script) BETWEEN 1 AND 4000),
  scene_count INTEGER NOT NULL CHECK(scene_count BETWEEN 1 AND 12),
  shape TEXT NOT NULL CHECK(shape IN('16:9', '9:16', '1:1')),
  status TEXT NOT NULL CHECK(status IN('queued', 'running', 'done', 'failed', 'awaiting_worker', 'draft_recorded')),
  worker_id TEXT CHECK(worker_id IS NULL OR length(worker_id) BETWEEN 1 AND 160),
  detail TEXT NOT NULL DEFAULT '' CHECK(length(detail) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, owner_key)
);
CREATE INDEX IF NOT EXISTS story_production_jobs_owner_idx
  ON story_production_jobs(owner_key, created_at DESC, id);
