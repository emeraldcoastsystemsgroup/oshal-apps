-- Home reads rolling personal score cohorts and the latest three target matches.
-- Existing board indexes sort by fit, so large corpora otherwise exceed the Home deadline.
CREATE INDEX IF NOT EXISTS idx_career_scores_home_period
 ON career_user_job_scores(user_sub, scored_at DESC);
CREATE INDEX IF NOT EXISTS idx_career_scores_home_latest
 ON career_user_job_scores(user_sub, scored_at DESC, posting_id) WHERE target_role;
