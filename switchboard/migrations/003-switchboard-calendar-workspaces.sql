-- =============================================================================
-- Migration 003: Switchboard content calendar and workspaces
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                    | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com   | Checked-in final shape of the
--     | calendar's lazy-DDL chokepoint (switchboard-calendar-routes.ts
--     | ensureScheduledPostsSchema): the CREATE TABLE plus the executor columns
--     | (publish_error, published_at, attempts) and the five-state status check
--     | the runtime bootstrap adds through ALTERs. That bootstrap runs only when
--     | the router is built, before the native kernel admits any SQL, so on the
--     | native kernel the table was never declared and POST /calendar/posts
--     | answered "SQL inserts require a declared primary key". Declared here,
--     | the table and its post_id key are provisioned with the package; the
--     | runtime bootstrap's statements stay idempotent against this shape on
--     | PostgreSQL. Owner FORCE RLS is appended by the runtime bootstrap
--     | (oshal.current_sub GUC), as in 001 and 002. The workspace tables
--     | (switchboard-routes.ts ensureWorkspaceSchema) had the same build-time-only
--     | declaration; a calendar post tagged with a workspace reads them, and
--     | POST /workspaces inserts into them, so they are declared here too.
-- =============================================================================

CREATE TABLE IF NOT EXISTS oshal_switchboard_scheduled_posts (
  post_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub TEXT NOT NULL,
  workspace_id UUID,
  platform TEXT NOT NULL,
  body TEXT NOT NULL,
  media_ref TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  publish_error TEXT,
  published_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  CONSTRAINT oshal_switchboard_scheduled_posts_status_check CHECK (status IN ('draft', 'scheduled', 'needs_approval', 'published', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_sb_sched_user_time ON oshal_switchboard_scheduled_posts (user_sub, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_sb_sched_due ON oshal_switchboard_scheduled_posts (status, scheduled_at);

CREATE TABLE IF NOT EXISTS oshal_switchboard_workspaces (
  workspace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'brass',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oshal_switchboard_workspace_accounts (
  workspace_id UUID NOT NULL,
  user_sub TEXT NOT NULL,
  connection_id UUID NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, connection_id)
);
CREATE INDEX IF NOT EXISTS idx_sb_wsa_user ON oshal_switchboard_workspace_accounts (user_sub, workspace_id);
