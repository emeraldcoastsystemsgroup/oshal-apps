-- =============================================================================
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                          | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-06-13   | roger.murphy@agenticfederal.us  | Class publishing: lm_classes.published flag powers the school-wide "class bank" (teacher-published classes any member can self-enroll into). Student-created classes default private (published=false).
-- =============================================================================

-- The published flag: true = listed in the school-wide class bank (browsable +
-- self-enrollable by any member); false = private to the owner + people they've
-- explicitly shared with. Mirrors the idempotent bootstrap ALTER in
-- ensureEducationSchema (education-routes.ts) so a fresh DB and an upgraded DB
-- converge.
ALTER TABLE lm_classes ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT false;

-- Partial index: the catalog query filters on published = true.
CREATE INDEX IF NOT EXISTS idx_lm_classes_published ON lm_classes (published) WHERE published = true;

-- NOTE: seeding which existing classes are published is a deliberate, per-tenant
-- data decision (a fresh deployment ships private-by-default), so it is NOT done
-- here. For the demo tenant, the pre-made teacher classes are published via a
-- one-off UPDATE during rollout.
