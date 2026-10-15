-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Declare the per-person Kid Lens activity store so the native kernel provisions it in a writer's scope (a GET's lazy CREATE TABLE is refused under read admission). The columns are exactly the routes' ensureYoutubeKidsSchema declaration, which then verifies against it; on PostgreSQL the routes' owner policy still applies at that chokepoint.

CREATE TABLE IF NOT EXISTS oshal_youtube_activity (
        user_sub TEXT PRIMARY KEY,
        aggregate JSONB,
        raw_blob TEXT,
        total_watched INT,
        brief TEXT,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        brief_at TIMESTAMPTZ
      );
