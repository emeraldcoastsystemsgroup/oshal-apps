-- =============================================================================
-- Migration 002: Switchboard Streams — the CMS-grade publishing store
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                    | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com   | Checked-in equivalent of the
--     | streams lazy-DDL chokepoint (switchboard-streams-routes.ts ensureStreamSchema):
--     | one post entity with the 8-state editorial machine, per-channel variants
--     | with per-channel publish outcomes, and a revision snapshot per edit.
--     | (user_sub, source, source_ref) unique = idempotent import dedup (the JMN
--     | lesson). publish_claimed_at is the publish CAS — a double-fire or a
--     | concurrent executor tick cannot double-post. Owner FORCE RLS on all three
--     | tables is appended by the runtime bootstrap (oshal.current_sub GUC).
-- =============================================================================

CREATE TABLE IF NOT EXISTS oshal_switchboard_stream_posts (
  post_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub TEXT NOT NULL,
  workspace_id UUID,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','in_review','approved','scheduled','published','rejected','failed','archived')),
  tags TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  judge_score INT,
  judge_rationale TEXT,
  note TEXT,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  publish_error TEXT,
  publish_claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sb_stream_user_state ON oshal_switchboard_stream_posts (user_sub, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sb_stream_due ON oshal_switchboard_stream_posts (state, scheduled_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sb_stream_import_dedup ON oshal_switchboard_stream_posts (user_sub, source, source_ref) WHERE source_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS oshal_switchboard_stream_variants (
  post_id UUID NOT NULL,
  user_sub TEXT NOT NULL,
  platform TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  media_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','failed','skipped')),
  external_ref TEXT,
  error TEXT,
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_sb_stream_var_user ON oshal_switchboard_stream_variants (user_sub, platform);

CREATE TABLE IF NOT EXISTS oshal_switchboard_stream_revisions (
  revision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL,
  user_sub TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  variants JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sb_stream_rev_post ON oshal_switchboard_stream_revisions (user_sub, post_id, saved_at DESC);
