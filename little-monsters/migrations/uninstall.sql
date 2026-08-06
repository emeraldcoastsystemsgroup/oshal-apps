-- ═══════════════════════════════════════════════════════════════════════════
-- little-monsters — UNINSTALL (schema teardown)
-- ADR-085 §5: uninstall keeps schema by default; running this file is the
-- explicit opt-in that drops the app's data. BACK UP FIRST:
--   pg_dump -U oshal_app -d oshal $(psql ... "SELECT string_agg('-t '||tablename,' ')
--     FROM pg_tables WHERE tablename LIKE 'lm\_%'") > lm-backup.sql
--
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Include migration-037 audit data and trigger functions in the explicit teardown.
-- ═══════════════════════════════════════════════════════════════════════════

-- The app's own tables (created by 019/021/024/026/027/028/029).
DROP TABLE IF EXISTS lm_authorization_audit CASCADE;
DROP TABLE IF EXISTS lm_flashcard_progress CASCADE;
DROP TABLE IF EXISTS lm_flashcards CASCADE;
DROP TABLE IF EXISTS lm_flashcard_sets CASCADE;
DROP TABLE IF EXISTS lm_quiz_results CASCADE;
DROP TABLE IF EXISTS lm_assignments CASCADE;
DROP TABLE IF EXISTS lm_lectures CASCADE;
DROP TABLE IF EXISTS lm_materials CASCADE;
DROP TABLE IF EXISTS lm_calendar_events CASCADE;
DROP TABLE IF EXISTS lm_notifications CASCADE;
DROP TABLE IF EXISTS lm_rewards CASCADE;
DROP TABLE IF EXISTS lm_xp_events CASCADE;
DROP TABLE IF EXISTS lm_enrollments CASCADE;
DROP TABLE IF EXISTS lm_students CASCADE;
DROP TABLE IF EXISTS lm_classes CASCADE;
DROP TABLE IF EXISTS lm_tenants CASCADE;

DROP FUNCTION IF EXISTS lm_authorization_audit_stamp() CASCADE;
DROP FUNCTION IF EXISTS lm_authorization_audit_reject_mutation() CASCADE;

-- The app's bots (seeded by 020) + tool authorizations.
DELETE FROM agent_tools WHERE agent_id::text LIKE 'ed000000%';
DELETE FROM agents WHERE agent_id::text LIKE 'ed000000%';

-- The installed-app registry row.
DELETE FROM swarm_applications WHERE name = 'little-monsters';
