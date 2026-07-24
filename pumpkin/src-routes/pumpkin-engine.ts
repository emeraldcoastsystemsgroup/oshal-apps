/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 18:38:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: public barrel for the pumpkin prop feature slice (types, built-in presets + normalizer, per-user preset store, reply parser). Consumed by src/app/routes/pumpkin-routes.ts.
 */

export type {
  PumpkinMode,
  PumpkinExpression,
  EyeShape,
  MouthShape,
  PumpkinColors,
  PumpkinFace,
  PumpkinMotion,
  PumpkinGlow,
  PumpkinVoice,
  PumpkinPreset,
  PumpkinSettings,
  PumpkinReply,
} from './pumpkin-engine-types';

export { BUILTIN_PRESETS, BUILTIN_PRESET_NAMES, builtinPreset, normalizePreset } from './pumpkin-engine-presets';
export { PumpkinPresetService } from './pumpkin-engine-preset-service';
export { parsePumpkinReply } from './pumpkin-engine-reply';
export { PumpkinRoomRegistry, pumpkinRooms } from './pumpkin-engine-room-registry';
export type { PumpkinEvent, PumpkinRoomInfo } from './pumpkin-engine-room-registry';
