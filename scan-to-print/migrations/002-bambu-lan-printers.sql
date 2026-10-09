-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Bambu Lab printers reached on the LAN, the print service, and the owner's standing permission to start prints without a click (operator-approved 2026-10-06). A `bambu-lan` printer keeps its LAN ACCESS CODE in the existing api_key_ciphertext column (same owner-key vault envelope, never plaintext) and its host in base_url as `bambu://<host>`. DEVICE_SERIAL and DEVICE_MODEL are read from the printer's own TLS certificate at registration (CN = serial, the issuing device CA names the model code); DEVICE_CERT_SHA256 pins the printer's certificate (the same one on its MQTT and FTPS ports): every later session refuses, before sending the access code, a device that does not present it — the serial alone is public on the LAN. SLICE_PROFILE is what the slicer engine needs for this printer (model code, nozzle, filament, plate). AUTO_START is the owner's per-printer opt-in that lets a job sent by an agent tool start on its own; it defaults to false, so adding a printer never grants it, and an agent can never start a print on a printer whose owner left it off. SUBMISSIONS can now come from the print service with a posted model instead of a scan job, so job_id becomes optional with SOURCE_NAME naming the file (one of the two is always present) and REQUESTED_BY recording whether a person clicked Print or a service caller (an agent or app) sent it. Re-runnable: every change is guarded.

ALTER TABLE scan_print_printer ADD COLUMN IF NOT EXISTS device_serial TEXT;
ALTER TABLE scan_print_printer ADD COLUMN IF NOT EXISTS device_model  TEXT;
ALTER TABLE scan_print_printer ADD COLUMN IF NOT EXISTS device_cert_sha256 TEXT;
ALTER TABLE scan_print_printer ADD COLUMN IF NOT EXISTS slice_profile JSONB   NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE scan_print_printer ADD COLUMN IF NOT EXISTS auto_start    BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE scan_print_printer DROP CONSTRAINT IF EXISTS scan_print_printer_kind_valid;
ALTER TABLE scan_print_printer ADD CONSTRAINT scan_print_printer_kind_valid
  CHECK (kind IN ('octoprint', 'moonraker', 'prusalink', 'bambu-lan'));

ALTER TABLE scan_print_printer DROP CONSTRAINT IF EXISTS scan_print_printer_bambu_identity;
ALTER TABLE scan_print_printer ADD CONSTRAINT scan_print_printer_bambu_identity
  CHECK (kind <> 'bambu-lan' OR (device_serial IS NOT NULL AND device_cert_sha256 IS NOT NULL AND base_url LIKE 'bambu://%'));

ALTER TABLE scan_print_submission ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE scan_print_submission ADD COLUMN IF NOT EXISTS source_name  TEXT;
ALTER TABLE scan_print_submission ADD COLUMN IF NOT EXISTS requested_by TEXT NOT NULL DEFAULT 'person';

ALTER TABLE scan_print_submission DROP CONSTRAINT IF EXISTS scan_print_submission_source_present;
ALTER TABLE scan_print_submission ADD CONSTRAINT scan_print_submission_source_present
  CHECK (job_id IS NOT NULL OR source_name IS NOT NULL);

ALTER TABLE scan_print_submission DROP CONSTRAINT IF EXISTS scan_print_submission_requester_valid;
ALTER TABLE scan_print_submission ADD CONSTRAINT scan_print_submission_requester_valid
  CHECK (requested_by IN ('person', 'service'));

CREATE INDEX IF NOT EXISTS idx_scan_print_submission_recent ON scan_print_submission (owner_sub, created_at DESC);
