-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | The breadboard view: a design may carry a BOARD — where each electrical part sits on a full-size breadboard (placements) and the jumper wires between holes — beside the schematic. The schematic's parts and wires stay the truth the solver reads; the routes keep the board's jumpers in step with every wire change and derive wires from the board when the person edits there. Idempotent (re-applied on every load).

ALTER TABLE circuit_design ADD COLUMN IF NOT EXISTS board JSONB;   -- {placements: {partId: {col, row}}, jumpers: [{id, from, to}], stale?} or NULL
