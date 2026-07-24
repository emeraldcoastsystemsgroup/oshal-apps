/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 21:58:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Add bounded versioned roll-event payloads to campaign history with per-campaign retry idempotency.
 */

ALTER TABLE dnd_archive
  ADD COLUMN IF NOT EXISTS payload jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_dnd_archive_roll_payload'
       AND conrelid = 'dnd_archive'::regclass
  ) THEN
    ALTER TABLE dnd_archive ADD CONSTRAINT ck_dnd_archive_roll_payload CHECK (
      payload IS NULL OR (
        jsonb_typeof(payload) = 'object'
        AND payload ? 'v'
        AND payload ? 'eventId'
        AND payload ? 'rolls'
        AND payload->>'v' = '1'
        AND length(payload->>'eventId') BETWEEN 1 AND 160
        AND jsonb_typeof(payload->'rolls') = 'array'
        AND jsonb_array_length(payload->'rolls') BETWEEN 1 AND 64
        AND octet_length(payload::text) <= 32768
      )
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dnd_archive_roll_event
  ON dnd_archive (campaign_id, (payload->>'eventId'))
  WHERE payload IS NOT NULL;
