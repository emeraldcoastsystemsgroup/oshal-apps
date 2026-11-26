-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                  | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com | Creative Studio 1.5.2: owner-scoped story production jobs table with forced exact-owner RLS for library and custom story runs.

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

ALTER TABLE story_production_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_production_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS story_source_owner ON story_production_jobs;
CREATE POLICY story_source_owner ON story_production_jobs
  USING(owner_key = current_setting('story_source.owner_key', true))
  WITH CHECK(owner_key = current_setting('story_source.owner_key', true));
