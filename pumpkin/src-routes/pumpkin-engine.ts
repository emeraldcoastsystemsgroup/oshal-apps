/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 18:38:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: public barrel for the pumpkin prop feature slice (types, built-in presets + normalizer, per-user preset store, reply parser). Consumed by src/app/routes/pumpkin-routes.ts.
 * 2026-07-24 07:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Export the saved-responses store (PumpkinResponseService + normalizer) for the one-tap replay playlist.
 * 2026-08-01 12:00:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Export the swarm-control surface of the room registry: resolveSpeakTargets (headless room resolution that refuses rather than guesses), the now-exported roomSlug (three surfaces derive that pairing key independently, so exactly one definition may exist), the TTL/idle constants the route and its guards assert against, and the PumpkinRoomListener transport type whose `false` return is what makes dead-listener pruning possible.
 * 2026-08-01 22:10:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Export the device-link builder (buildPumpkinLinks / resolvePublicOrigin / pumpkinQrTargetUrl / readQrTarget) behind the new GET /links + GET /qr routes — the two endpoints the README documented and the control surface has been calling since Design C, but which no router ever registered.
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
  PumpkinResponseSource,
  PumpkinSavedResponse,
} from './pumpkin-engine-types';

export { BUILTIN_PRESETS, BUILTIN_PRESET_NAMES, builtinPreset, normalizePreset } from './pumpkin-engine-presets';
export { PumpkinPresetService } from './pumpkin-engine-preset-service';
export {
  PumpkinResponseService,
  normalizeSavedResponse,
  responseDedupeKey,
  MAX_SAVED_SAY,
  MAX_UNPINNED_RESPONSES,
} from './pumpkin-engine-response-store';
export { parsePumpkinReply } from './pumpkin-engine-reply';
export {
  PumpkinRoomRegistry,
  pumpkinRooms,
  resolveSpeakTargets,
  roomSlug,
  ROOM_TTL_MS,
  ROOM_MAX_IDLE_MS,
} from './pumpkin-engine-room-registry';
export type {
  PumpkinEvent,
  PumpkinRoomInfo,
  PumpkinRoomListener,
  SpeakTargetResolution,
} from './pumpkin-engine-room-registry';
export {
  buildPumpkinLinks,
  pumpkinQrTargetUrl,
  readQrTarget,
  resolvePublicOrigin,
} from './pumpkin-engine-links';
export type { PumpkinLinks, PumpkinLinkRequest, PumpkinQrTarget } from './pumpkin-engine-links';
