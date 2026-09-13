-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Initial schema. A JOB is one object being reconstructed: its title, which lane fed it (photos, video frames, a point cloud), the ruler measurements that set the scale, the last reconstruction REPORT (the same JSON the drawing's title block and notes are rendered from — one text, three readers), and a failure reason when the pipeline refused. IMAGES are the photos and the view each is assigned to; the silhouette statistics are stored so the UI can show why an outline was weak without re-running anything. PRINTERS hold the person's printer hosts with the API key ONLY as owner-key ciphertext (personal-data vault) — the plaintext never lands in a row. SUBMISSIONS record every upload attempt, successful or not, with what the host answered, so "did it print" is a row rather than a memory. Every table carries the store's owner RLS.

CREATE TABLE IF NOT EXISTS scan_print_job (
  job_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub         TEXT        NOT NULL,
  title             TEXT        NOT NULL,
  source_kind       TEXT        NOT NULL DEFAULT 'photos',          -- photos | video | pointcloud
  state             TEXT        NOT NULL DEFAULT 'capturing',       -- capturing | reconstructed | failed
  known_dimensions  JSONB       NOT NULL DEFAULT '[]'::jsonb,       -- [{axis:'x'|'y'|'z', mm}]
  settings          JSONB       NOT NULL DEFAULT '{}'::jsonb,       -- resolution, smoothIterations
  report            JSONB,                                          -- last ReconstructionReport
  failure_reason    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scan_print_job_state_valid CHECK (state IN ('capturing', 'reconstructed', 'failed')),
  CONSTRAINT scan_print_job_source_valid CHECK (source_kind IN ('photos', 'video', 'pointcloud'))
);

CREATE INDEX IF NOT EXISTS idx_scan_print_job_owner ON scan_print_job (owner_sub, updated_at DESC);

CREATE TABLE IF NOT EXISTS scan_print_image (
  image_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID        NOT NULL REFERENCES scan_print_job (job_id) ON DELETE CASCADE,
  owner_sub    TEXT        NOT NULL,
  file_name    TEXT        NOT NULL,
  view         TEXT,                                                -- front|back|left|right|top|bottom, NULL = unassigned
  width        INTEGER     NOT NULL,
  height       INTEGER     NOT NULL,
  silhouette   JSONB       NOT NULL DEFAULT '{}'::jsonb,            -- threshold, background, stats, warnings
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scan_print_image_view_valid CHECK (view IS NULL OR view IN ('front', 'back', 'left', 'right', 'top', 'bottom'))
);

CREATE INDEX IF NOT EXISTS idx_scan_print_image_job ON scan_print_image (owner_sub, job_id, created_at);
-- One image per view per job: the carver takes exactly one silhouette per canonical view.
CREATE UNIQUE INDEX IF NOT EXISTS uq_scan_print_image_job_view ON scan_print_image (job_id, view) WHERE view IS NOT NULL;

CREATE TABLE IF NOT EXISTS scan_print_printer (
  printer_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub           TEXT        NOT NULL,
  label               TEXT        NOT NULL,
  kind                TEXT        NOT NULL,                          -- octoprint | moonraker | prusalink
  base_url            TEXT        NOT NULL,
  api_key_ciphertext  TEXT        NOT NULL,                          -- personal-data vault envelope, never plaintext
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scan_print_printer_kind_valid CHECK (kind IN ('octoprint', 'moonraker', 'prusalink'))
);

CREATE INDEX IF NOT EXISTS idx_scan_print_printer_owner ON scan_print_printer (owner_sub, created_at);

CREATE TABLE IF NOT EXISTS scan_print_submission (
  submission_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID        NOT NULL REFERENCES scan_print_job (job_id) ON DELETE CASCADE,
  printer_id       UUID        NOT NULL REFERENCES scan_print_printer (printer_id) ON DELETE CASCADE,
  owner_sub        TEXT        NOT NULL,
  file_name        TEXT        NOT NULL,
  file_kind        TEXT        NOT NULL,                             -- stl | gcode
  started          BOOLEAN     NOT NULL DEFAULT false,
  state            TEXT        NOT NULL,                             -- uploaded | printing | failed
  failure_reason   TEXT,
  remote_response  JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scan_print_submission_state_valid CHECK (state IN ('uploaded', 'printing', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_scan_print_submission_job ON scan_print_submission (owner_sub, job_id, created_at DESC);

-- ── Owner RLS (the store-package convention) ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['scan_print_job', 'scan_print_image', 'scan_print_printer', 'scan_print_submission'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy WHERE polname = t || '_owner_or_operator' AND polrelid = t::regclass
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS PERMISSIVE FOR ALL
           USING (owner_sub = current_setting(''oshal.current_sub'', true)
                  OR current_setting(''oshal.is_operator'', true) = ''on'')
           WITH CHECK (owner_sub = current_setting(''oshal.current_sub'', true)
                  OR current_setting(''oshal.is_operator'', true) = ''on'')',
        t || '_owner_or_operator', t);
    END IF;
  END LOOP;
END $$;
