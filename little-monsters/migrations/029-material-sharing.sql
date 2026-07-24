-- =============================================================================
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                          | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-06-13   | roger.murphy@agenticfederal.us  | Material sharing: a teacher can share a material with the class; a student can request a share a teacher approves. Mirrors the bootstrap ALTERs in ensureEducationSchema.
-- =============================================================================

-- shared      : true once a material is approved-shared with the class.
-- share_status: private (default) | requested | approved | denied.
ALTER TABLE lm_materials ADD COLUMN IF NOT EXISTS shared BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE lm_materials ADD COLUMN IF NOT EXISTS share_status VARCHAR(20) NOT NULL DEFAULT 'private';
CREATE INDEX IF NOT EXISTS idx_lm_materials_shared ON lm_materials (class_id, share_status);
