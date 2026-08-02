"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 18:22:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: the pumpkin prop domain types — a PumpkinPreset is the full, serializable "look + motion + voice" config the projector canvas renders and the control surface edits. One preset = everything a jack-o'-lantern look needs.
 * 2026-07-24 07:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Saved-responses playlist types (PumpkinSavedResponse + PumpkinResponseSource): every spoken line persists per user for one-tap replay from the remote — no fresh LLM generation needed live on the porch.
 * 2026-08-01 22:15:00 | roger.murphy@emeraldcoastsystemsgroup.com   | PumpkinSettings carries roomLabel. The control surface has always SENT it on Launch and the route dropped it on the floor, so the short-form projector URL the runbook tells you to type could never restore the room — the projector came up in 'main' while the cockpit and the phone pushed into 'front-porch'.
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=pumpkin-engine-types.js.map