-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Add owner-scoped guardian links, saved tutor threads and messages, per-set flashcard study preferences, named timelines, and school-level tutor history teacher-visibility flag.
-- -----------------------------------------------------------------------------

ALTER TABLE lm_tenants
  ADD COLUMN IF NOT EXISTS tutor_history_teacher_visible BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS lm_guardian_links (
  link_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID NOT NULL REFERENCES lm_students(student_id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES lm_tenants(tenant_id) ON DELETE CASCADE,
  learner_name     TEXT NOT NULL DEFAULT '',
  guardian_email   TEXT NOT NULL,
  cadence          VARCHAR(16) NOT NULL DEFAULT 'weekly' CHECK (cadence IN ('daily', 'weekly')),
  summary_snapshot JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, guardian_email)
);

CREATE INDEX IF NOT EXISTS idx_lm_guardian_links_student
  ON lm_guardian_links (student_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_lm_guardian_links_guardian
  ON lm_guardian_links (tenant_id, guardian_email);

CREATE TABLE IF NOT EXISTS lm_tutor_threads (
  thread_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID NOT NULL REFERENCES lm_students(student_id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES lm_tenants(tenant_id) ON DELETE CASCADE,
  class_id       UUID REFERENCES lm_classes(class_id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  first_question TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lm_tutor_threads_student_updated
  ON lm_tutor_threads (student_id, tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS lm_tutor_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  UUID NOT NULL REFERENCES lm_tutor_threads(thread_id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES lm_students(student_id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES lm_tenants(tenant_id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL CHECK (turn_index >= 0),
  role       VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  sources    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lm_tutor_messages_thread_turn
  ON lm_tutor_messages (thread_id, turn_index ASC);

CREATE TABLE IF NOT EXISTS lm_flashcard_study_prefs (
  student_id  UUID NOT NULL REFERENCES lm_students(student_id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES lm_tenants(tenant_id) ON DELETE CASCADE,
  set_id      UUID NOT NULL REFERENCES lm_flashcard_sets(set_id) ON DELETE CASCADE,
  shuffle     BOOLEAN NOT NULL DEFAULT FALSE,
  prompt_side VARCHAR(16) NOT NULL DEFAULT 'term' CHECK (prompt_side IN ('term', 'definition')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (student_id, set_id)
);

CREATE TABLE IF NOT EXISTS lm_timelines (
  timeline_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES lm_students(student_id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES lm_tenants(tenant_id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  events      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lm_timelines_student_updated
  ON lm_timelines (student_id, tenant_id, updated_at DESC);
