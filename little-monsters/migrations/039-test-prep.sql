-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Private SAT/ACT sessions and learner preferences.
CREATE TABLE IF NOT EXISTS lm_prep_sessions (
  session_id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES lm_students(student_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES lm_tenants(tenant_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  state JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lm_prep_sessions_owner ON lm_prep_sessions (student_id, tenant_id, created_at DESC);
CREATE TABLE IF NOT EXISTS lm_prep_profiles (
  student_id UUID NOT NULL REFERENCES lm_students(student_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES lm_tenants(tenant_id) ON DELETE CASCADE,
  profile JSONB NOT NULL,
  PRIMARY KEY (student_id, tenant_id)
);
