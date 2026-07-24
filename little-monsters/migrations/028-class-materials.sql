-- =============================================================================
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                          | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-06-13   | roger.murphy@agenticfederal.us  | Class materials: any-filetype documents (textbooks, handouts, photos of assignments) attached to a class and uploadable by any enrolled member. Mirrors the bootstrap CREATE in ensureEducationSchema.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lm_materials (
  material_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      UUID NOT NULL,
  uploaded_by   UUID,                                   -- lm_students.student_id of the uploader
  original_name TEXT,
  stored_path   TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    BIGINT DEFAULT 0,
  kind          VARCHAR(20) NOT NULL DEFAULT 'document', -- textbook|syllabus|handout|assignment|image|document
  title         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lm_materials_class ON lm_materials (class_id, created_at DESC);
