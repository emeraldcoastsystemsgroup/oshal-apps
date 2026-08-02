-- =============================================================================
-- Migration 104: Pumpkin settings remember the ROOM LABEL
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                                    | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-08-01   | roger.murphy@emeraldcoastsystemsgroup.com | The night-of runbook's
--              | central instruction is the SHORT projector URL — {origin}/pumpkin/
--              | with nothing after the slash, because that is the only form worth
--              | typing on a projector device's on-screen keyboard. It promised the
--              | projector reads roomLabel/mode/activePreset back from saved
--              | settings, but pumpkin_settings had no room column at all: the
--              | control surface sent roomLabel on Launch, PUT /settings dropped it,
--              | and the projector never asked. Following the runbook literally put
--              | the projector in room 'main' while the cockpit and the phone pushed
--              | into 'front-porch' — a silent prop at 7pm, caused by documentation.
--              | Idempotent, and additive only: ADD COLUMN IF NOT EXISTS with a
--              | default, so an existing row keeps working before anyone re-launches.
--              | Mirrors PumpkinPresetService.ensureSchema(), which applies the same
--              | ALTER lazily (CREATE TABLE IF NOT EXISTS is a no-op on a deployment
--              | that already has the old three-column shape, so the CREATE alone
--              | would never have added this).
-- =============================================================================

ALTER TABLE pumpkin_settings
  ADD COLUMN IF NOT EXISTS room_label VARCHAR(40) NOT NULL DEFAULT 'Main';
