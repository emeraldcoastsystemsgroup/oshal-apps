-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Initial schema. A PROJECT is one Godot game/scene project or one Blender model (scene.blend), owned by one person. Its files live on disk as one gzip blob per REVISION; a revision is one change (a file written or deleted, an upload, an MCP tool call that changed something, a restore, a model import) recorded with what changed and the engine build that made it, so "undo" is restoring an earlier revision's files as a new revision. The last preview render and the last headless run are kept on the project. Every table carries the store's owner RLS.

CREATE TABLE IF NOT EXISTS scene_project (
  project_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub    TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  kind         TEXT        NOT NULL,                       -- godot | blender
  template     TEXT,
  revision     INTEGER     NOT NULL DEFAULT 0,             -- current revision (0 = no files yet)
  file_count   INTEGER     NOT NULL DEFAULT 0,
  total_bytes  BIGINT      NOT NULL DEFAULT 0,
  preview      JSONB,                                      -- {revision, info, at} of the last preview render
  last_run     JSONB,                                      -- {revision, seconds, output, errors, at} of the last headless run
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scene_project_kind_valid CHECK (kind IN ('godot', 'blender')),
  CONSTRAINT scene_project_revision_valid CHECK (revision >= 0)
);

CREATE INDEX IF NOT EXISTS idx_scene_project_owner ON scene_project (owner_sub, updated_at DESC);

CREATE TABLE IF NOT EXISTS scene_revision (
  project_id   UUID        NOT NULL REFERENCES scene_project (project_id) ON DELETE CASCADE,
  revision     INTEGER     NOT NULL,
  owner_sub    TEXT        NOT NULL,
  action       TEXT        NOT NULL,                       -- create | write-file | delete-file | upload | godot:<tool> | blender:<tool> | restore | import-model
  detail       JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- {path?, tool?, delta: {added, modified, deleted}, restoredFrom?, from?}
  file_count   INTEGER     NOT NULL,
  total_bytes  BIGINT      NOT NULL,
  blob         TEXT        NOT NULL,                       -- the revision's file-map blob on disk
  engine_build TEXT,                                       -- bridge build hash that produced it (null for api-only edits)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_scene_revision_owner ON scene_revision (owner_sub, project_id, revision DESC);

-- ── Owner RLS (the store-package convention) ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['scene_project', 'scene_revision'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy WHERE polname = t || '_owner_or_operator' AND polrelid = t::regclass
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS PERMISSIVE FOR ALL
           USING (owner_sub = current_setting(''oshal.current_sub'', true)
                  OR current_setting(''oshal.is_operator'', true) = ''on'')
           WITH CHECK (owner_sub = current_setting(''oshal.current_sub'', true)
                  OR current_setting(''oshal.is_operator'', true) = ''on'')',
        t || '_owner_or_operator', t);
    END IF;
  END LOOP;
END $$;
