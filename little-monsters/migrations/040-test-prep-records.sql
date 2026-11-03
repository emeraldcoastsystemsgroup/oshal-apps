-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Shared versioned questions, private answer records and saved training.
-- Grading keys stay in the server curriculum, never in the broadly readable bank.
CREATE TABLE IF NOT EXISTS lm_prep_questions (
  catalog_version TEXT NOT NULL,
  question_id TEXT NOT NULL,
  skill TEXT NOT NULL,
  question JSONB NOT NULL,
  PRIMARY KEY (catalog_version, question_id)
);
CREATE TABLE IF NOT EXISTS lm_prep_answers (
  session_id UUID NOT NULL REFERENCES lm_prep_sessions(session_id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  student_id UUID NOT NULL REFERENCES lm_students(student_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES lm_tenants(tenant_id) ON DELETE CASCADE,
  catalog_version TEXT NOT NULL,
  exam TEXT NOT NULL,
  section TEXT NOT NULL,
  skill TEXT NOT NULL,
  block_index INTEGER NOT NULL,
  question_position INTEGER NOT NULL,
  choice INTEGER,
  active_ms BIGINT NOT NULL DEFAULT 0,
  target_ms INTEGER NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'unsure',
  flagged BOOLEAN NOT NULL DEFAULT FALSE,
  correct BOOLEAN,
  graded_at TIMESTAMPTZ,
  mistake_reason TEXT NOT NULL DEFAULT '',
  reflection TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, question_id)
);
CREATE INDEX IF NOT EXISTS lm_prep_answers_owner ON lm_prep_answers (student_id, tenant_id, exam, graded_at DESC);
CREATE TABLE IF NOT EXISTS lm_prep_training (
  training_id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES lm_students(student_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES lm_tenants(tenant_id) ON DELETE CASCADE,
  exam TEXT NOT NULL,
  title TEXT NOT NULL,
  content JSONB NOT NULL,
  progress JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lm_prep_training_owner ON lm_prep_training (student_id, tenant_id, created_at DESC);
