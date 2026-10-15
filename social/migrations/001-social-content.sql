-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | The Workspace's own per-person content store (focus terms, the email-scan opt-in, dismissed articles, saved drafts) for routes/social-content-routes.js.

CREATE TABLE IF NOT EXISTS social_content_focus (
  user_sub TEXT PRIMARY KEY,
  focus TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS social_content_settings (
  user_sub TEXT PRIMARY KEY,
  email_social_scan BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS social_content_articles (
  user_sub TEXT NOT NULL,
  url TEXT NOT NULL,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  dismissed_at TIMESTAMPTZ,
  PRIMARY KEY (user_sub, url)
);

CREATE TABLE IF NOT EXISTS social_content_drafts (
  draft_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub TEXT NOT NULL,
  topic TEXT,
  take TEXT,
  draft TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_content_drafts_owner ON social_content_drafts (user_sub, created_at DESC);
