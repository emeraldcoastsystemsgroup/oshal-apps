-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | 1.66.0: index the owner's jobs marked "details needed" (no AI fit, model attribution starting {"needsDetails":), so New matches lists them without scanning every signal row; applied only by writable owner migrations.
CREATE INDEX IF NOT EXISTS idx_user_needs_details ON user_signals(posting_id)
  WHERE ai_fit_score IS NULL AND ai_model GLOB '{"needsDetails":*';
