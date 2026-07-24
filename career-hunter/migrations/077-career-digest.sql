-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE/TIME           | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-07-15 07:25:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Career daily-digest settings: per-user opt-out toggle (ON by default), last-sent cursor, and channel preference/phone for the batch notifier that emails/texts each user their NEW high-fit matches at most once a day. Mirrors the feed_settings per-user-defaults pattern (045).

CREATE TABLE IF NOT EXISTS career_digest_settings (
  user_sub              VARCHAR(255) PRIMARY KEY,
  digest_enabled        BOOLEAN NOT NULL DEFAULT TRUE,   -- opt-OUT model: notify unless the user turns it off
  last_digest_at        TIMESTAMPTZ,                     -- when we last actually sent (the "new since" cursor + once/day guard)
  notify_channel        VARCHAR(16),                     -- NULL = auto (email if Gmail-send connected, else text); or 'email' | 'text'
  notify_phone          TEXT,                            -- recipient E.164 for the text channel (the user's own cell; not stored anywhere else)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
