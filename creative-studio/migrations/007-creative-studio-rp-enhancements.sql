-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                  | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com | Creative Studio 1.5.0: owner-scoped storyboard comments (pinned to the brief or a scene, one reply level, resolve state), rendered storyboard builds (revision, aspect ratio, digest and length of the MP4 kept in package storage) and approval-gated social publication schedules. Every table is ENABLEd and FORCEd under the same exact-owner policy the source projects use.

CREATE TABLE IF NOT EXISTS story_source_comments (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  owner_key TEXT NOT NULL,
  owner_issuer TEXT NOT NULL CHECK(length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK(length(owner_sub) BETWEEN 1 AND 2048),
  scene_id UUID,
  parent_id UUID,
  author_label TEXT NOT NULL CHECK(length(author_label) BETWEEN 1 AND 120),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, owner_key),
  FOREIGN KEY(project_id, owner_key) REFERENCES story_source_projects(id, owner_key) ON DELETE CASCADE,
  FOREIGN KEY(parent_id, owner_key) REFERENCES story_source_comments(id, owner_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS story_source_comments_project_idx
  ON story_source_comments(owner_key, project_id, created_at, id);

CREATE TABLE IF NOT EXISTS story_source_builds (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  owner_key TEXT NOT NULL,
  owner_issuer TEXT NOT NULL CHECK(length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK(length(owner_sub) BETWEEN 1 AND 2048),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),
  aspect_ratio TEXT NOT NULL CHECK(aspect_ratio IN('16:9', '9:16', '1:1', '4:5')),
  width INTEGER NOT NULL CHECK(width BETWEEN 16 AND 4096),
  height INTEGER NOT NULL CHECK(height BETWEEN 16 AND 4096),
  duration_seconds INTEGER NOT NULL CHECK(duration_seconds BETWEEN 1 AND 600),
  scene_count INTEGER NOT NULL CHECK(scene_count BETWEEN 1 AND 32),
  branded BOOLEAN NOT NULL DEFAULT false,
  byte_length BIGINT NOT NULL CHECK(byte_length BETWEEN 1 AND 134217728),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, owner_key),
  FOREIGN KEY(project_id, owner_key) REFERENCES story_source_projects(id, owner_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS story_source_builds_project_idx
  ON story_source_builds(owner_key, project_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS story_source_schedules (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  build_id UUID NOT NULL,
  owner_key TEXT NOT NULL,
  owner_issuer TEXT NOT NULL CHECK(length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK(length(owner_sub) BETWEEN 1 AND 2048),
  channel TEXT NOT NULL CHECK(channel IN('youtube', 'instagram', 'tiktok', 'linkedin', 'x')),
  caption TEXT NOT NULL CHECK(length(caption) <= 1000),
  post_now BOOLEAN NOT NULL DEFAULT false,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK(status IN('scheduled', 'cancelled')),
  approved_by TEXT NOT NULL CHECK(length(approved_by) BETWEEN 1 AND 240),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, owner_key),
  FOREIGN KEY(project_id, owner_key) REFERENCES story_source_projects(id, owner_key) ON DELETE CASCADE,
  FOREIGN KEY(build_id, owner_key) REFERENCES story_source_builds(id, owner_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS story_source_schedules_owner_idx
  ON story_source_schedules(owner_key, scheduled_for, id);

ALTER TABLE story_source_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_source_comments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS story_source_owner ON story_source_comments;
CREATE POLICY story_source_owner ON story_source_comments
  USING(owner_key = current_setting('story_source.owner_key', true))
  WITH CHECK(owner_key = current_setting('story_source.owner_key', true));

ALTER TABLE story_source_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_source_builds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS story_source_owner ON story_source_builds;
CREATE POLICY story_source_owner ON story_source_builds
  USING(owner_key = current_setting('story_source.owner_key', true))
  WITH CHECK(owner_key = current_setting('story_source.owner_key', true));

ALTER TABLE story_source_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_source_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS story_source_owner ON story_source_schedules;
CREATE POLICY story_source_owner ON story_source_schedules
  USING(owner_key = current_setting('story_source.owner_key', true))
  WITH CHECK(owner_key = current_setting('story_source.owner_key', true));
