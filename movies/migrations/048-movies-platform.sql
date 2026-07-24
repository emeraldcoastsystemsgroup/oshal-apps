-- =============================================================================
-- Migration 048: Movies & TV concierge platform tables
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                                  | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-06-20   | roger.murphy@emeraldcoastsystemsgroup.com | Per-viewer profile +
--              | watchlist + conversation/feedback memory for the Movies & TV concierge.
--              | Discovery hits the live TMDB API (operator key); only the viewer's
--              | watchlist, taste prefs + chat persist here. Idempotent — mirrors
--              | ensureMoviesSchema() in movies-routes.ts.
-- =============================================================================

CREATE TABLE IF NOT EXISTS movies_profile (
  user_sub VARCHAR(255) PRIMARY KEY,
  display_name TEXT,
  favorite_genres TEXT[] NOT NULL DEFAULT '{}',
  services TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  onboarded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movies_watchlist (
  row_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub VARCHAR(255) NOT NULL,
  item_key TEXT NOT NULL,
  media_type VARCHAR(8),
  tmdb_id INTEGER,
  title TEXT,
  year TEXT,
  poster_url TEXT,
  tmdb_url TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'want',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_movies_watchlist_user_item ON movies_watchlist (user_sub, item_key);

CREATE TABLE IF NOT EXISTS movies_conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub VARCHAR(255) NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movies_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES movies_conversations(conversation_id) ON DELETE CASCADE,
  user_sub VARCHAR(255) NOT NULL,
  role VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movies_feedback (
  feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub VARCHAR(255) NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_movies_feedback_user_note ON movies_feedback (user_sub, lower(note));
