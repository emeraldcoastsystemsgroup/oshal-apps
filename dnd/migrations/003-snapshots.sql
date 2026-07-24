/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 00:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Save points / "time-warp": snapshots of the full campaign state on the timeline. The DM auto-captures at key beats (scene start, level-up, victory) and the player can save any moment; loading a snapshot rewinds the board + hero sheets to that point and plays forward. Per-user scoped like every dnd_* table.
 */

CREATE TABLE IF NOT EXISTS dnd_snapshots (
    snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid        NOT NULL REFERENCES dnd_campaigns (campaign_id) ON DELETE CASCADE,
    user_sub    text        NOT NULL,
    label       text        NOT NULL,
    state       jsonb       NOT NULL,                    -- the encounter board at that moment
    sheets      jsonb       NOT NULL DEFAULT '{}'::jsonb, -- hero sheets (xp / level / looted gear) at that moment
    auto        boolean     NOT NULL DEFAULT false,       -- captured by the DM (true) vs the player (false)
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dnd_snapshots_campaign ON dnd_snapshots (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dnd_snapshots_user ON dnd_snapshots (user_sub);
