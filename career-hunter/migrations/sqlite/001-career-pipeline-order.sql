-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Persist exact preparation and application ordering on owner relationships; applied only by writable owner migrations.
CREATE INDEX IF NOT EXISTS idx_user_queue_order ON user_signals(
  MAX(COALESCE(julianday(promoted_at),0),COALESCE(julianday(generated_at),0)) DESC,
  posting_id DESC) WHERE status IN ('promoted','generated','deferred');
CREATE INDEX IF NOT EXISTS idx_user_tracked_order ON user_signals(applied_at DESC, posting_id ASC)
  WHERE status IN ('applied','interview','offer','rejected');
