-- =============================================================================
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Track one exact RAG collection per material so approval and deletion are reversible
-- =============================================================================

-- A shared class collection cannot remove one revoked document without deleting
-- unrelated approved content. The route layer now ingests each material into a
-- distinct collection and uses this pointer for authorized lookup and deletion.
ALTER TABLE lm_materials
  ADD COLUMN IF NOT EXISTS rag_collection VARCHAR(63);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_materials_rag_collection
  ON lm_materials (rag_collection)
  WHERE rag_collection IS NOT NULL;
