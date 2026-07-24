-- -----------------------------------------------------------------------------
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE/TIME           | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-06-12 18:10:00 | roger.murphy@agenticfederal.us   | Lecture slide decks: lm_lectures.slides_path stores the generated slides JSON written by POST /api/education/process-transcript
-- -----------------------------------------------------------------------------

ALTER TABLE lm_lectures ADD COLUMN IF NOT EXISTS slides_path VARCHAR(500);
