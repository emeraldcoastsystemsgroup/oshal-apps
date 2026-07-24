-- =============================================================================
-- Migration 046: Spotify concierge platform tables
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                                  | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-06-20   | roger.murphy@emeraldcoastsystemsgroup.com | Per-listener profile +
--              | conversation/feedback memory for the Spotify concierge. Discovery +
--              | playlist-building hit the live Spotify Web API with the user's brokered
--              | token (no catalog cached); only taste prefs + chat persist here.
--              | Idempotent — mirrors ensureSpotifySchema() in spotify-routes.ts.
-- =============================================================================

CREATE TABLE IF NOT EXISTS spotify_profile (
  user_sub VARCHAR(255) PRIMARY KEY,
  display_name TEXT,
  favorite_genres TEXT[] NOT NULL DEFAULT '{}',
  favorite_artists TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  onboarded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS spotify_conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub VARCHAR(255) NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS spotify_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES spotify_conversations(conversation_id) ON DELETE CASCADE,
  user_sub VARCHAR(255) NOT NULL,
  role VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS spotify_feedback (
  feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub VARCHAR(255) NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spotify_feedback_user_note ON spotify_feedback (user_sub, lower(note));
