/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 18:22:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: the pumpkin prop domain types — a PumpkinPreset is the full, serializable "look + motion + voice" config the projector canvas renders and the control surface edits. One preset = everything a jack-o'-lantern look needs.
 * 2026-07-24 07:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Saved-responses playlist types (PumpkinSavedResponse + PumpkinResponseSource): every spoken line persists per user for one-tap replay from the remote — no fresh LLM generation needed live on the porch.
 * 2026-08-01 22:15:00 | roger.murphy@emeraldcoastsystemsgroup.com   | PumpkinSettings carries roomLabel. The control surface has always SENT it on Launch and the route dropped it on the floor, so the short-form projector URL the runbook tells you to type could never restore the room — the projector came up in 'main' while the cockpit and the phone pushed into 'front-porch'.
 */

/** The two run modes of the prop. `mimic` = say back what the operator feeds via mic (no LLM); `autonomous` = converse in character via pumpkin-bot. */
export type PumpkinMode = 'mimic' | 'autonomous';

/** How the eyes are cut. Drives the procedural canvas shape. */
export type EyeShape = 'triangle' | 'round' | 'angry' | 'square' | 'diamond';

/** How the mouth is cut. */
export type MouthShape = 'jagged' | 'grin' | 'oval' | 'snaggle';

/** Face expressions the bot (or a mimic cue) can request; the canvas eases toward them. */
export type PumpkinExpression =
  | 'neutral'
  | 'happy'
  | 'mischief'
  | 'spooky'
  | 'angry'
  | 'laugh'
  | 'surprised';

/** The color palette of a look. All strings are CSS colors. */
export interface PumpkinColors {
  /** Full-frame background. Black for projecting INTO an inflatable; deep orange for a flat screen. */
  background: string;
  /** Soft inner glow of the pumpkin body behind the features (set transparent for a pure-black bg). */
  bodyGlow: string;
  /** Base color of the lit eyes + mouth (the classic bright pumpkin yellow). */
  feature: string;
  /** Hottest core of the features where the "candle" burns brightest (near-white). */
  featureHot: string;
  /** Ambient vignette / edge tint that frames the face. */
  ambient: string;
}

/** The carved geometry + baseline pose of the face. Scalars are normalized 0..1 unless noted. */
export interface PumpkinFace {
  eyeShape: EyeShape;
  mouthShape: MouthShape;
  /** Number of teeth carved into the mouth (0 = smooth). */
  toothCount: number;
  /** Horizontal gap between the eyes (0 = close, 1 = wide). */
  eyeSpacing: number;
  /** Eye size (0 = beady, 1 = huge). */
  eyeSize: number;
  /** Mouth width (0 = small, 1 = ear-to-ear). */
  mouthWidth: number;
  /** Resting brow angle, -1 (angry/down) .. 1 (surprised/up). */
  browAngle: number;
}

/** The living motion of the look — idle life plus how strongly speech drives the mouth. */
export interface PumpkinMotion {
  /** Vertical idle bob amplitude in px at 1080p. */
  idleBob: number;
  /** Idle bob frequency in Hz. */
  bobSpeed: number;
  /** Max idle sway in degrees. */
  sway: number;
  /** Blinks per minute. */
  blinkPerMin: number;
  /** How much the eyes dart around, 0 (fixed stare) .. 1 (shifty). */
  gaze: number;
  /** Gain from speech amplitude to mouth-open, 0..2 (1 = natural). */
  mouthReactivity: number;
  /** Candle-flicker on the glow, 0 (steady) .. 1 (guttering). */
  flicker: number;
}

/** The glow/bloom around the lit features. */
export interface PumpkinGlow {
  /** Bloom radius in px. */
  blur: number;
  /** Brightness multiplier of the bloom, 0..2. */
  intensity: number;
}

/** The voice the prop speaks with (a TTS provider voice + delivery). */
export interface PumpkinVoice {
  /** Gemini TTS prebuilt voice id (e.g. 'Charon' deep, 'Fenrir' gravelly, 'Aoede' bright). */
  voiceId: string;
  /** Speaking rate 0.5 (slow/ominous) .. 2 (fast). */
  rate: number;
}

/** A complete, serializable pumpkin "look". Built-ins live in code; saved copies persist per user. */
export interface PumpkinPreset {
  /** URL-safe slug, unique per user (built-in names are reserved). */
  name: string;
  /** Human label for the control surface. */
  label: string;
  /** True for the shipped, code-defined presets (read-only; a save clones to a new name). */
  builtin?: boolean;
  colors: PumpkinColors;
  face: PumpkinFace;
  motion: PumpkinMotion;
  glow: PumpkinGlow;
  voice: PumpkinVoice;
  /** Which mode the prop starts in for this look. */
  defaultMode: PumpkinMode;
}

/** A user's last-used selection, restored by the control surface + projector. */
export interface PumpkinSettings {
  activePreset: string;
  mode: PumpkinMode;
  /**
   * The room LABEL (not the slug) the operator last launched with. This is the field that makes the
   * short-form projector URL — `{origin}/pumpkin/` with nothing after the slash — land in the right
   * room, which is the only URL worth typing on a projector device's on-screen keyboard.
   */
  roomLabel: string;
}

/** Where a saved response came from: an operator-fed mimic line, an autonomous bot reply, or a manual save. */
export type PumpkinResponseSource = 'mimic' | 'autonomous' | 'manual';

/** A remembered spoken line — one playlist entry, replayable with one tap (no LLM round trip). */
export interface PumpkinSavedResponse {
  /** Row id (UUID). */
  id: string;
  /** The line to speak aloud. */
  say: string;
  /** Face expression to ease toward while speaking. */
  expression: PumpkinExpression;
  /** Delivery size 0..1. */
  intensity: number;
  /** Provenance of the line. */
  source: PumpkinResponseSource;
  /** Pinned lines survive the recency cap (the operator's keepers). */
  pinned: boolean;
  /** How many times the line has been replayed from the playlist. */
  playCount: number;
  /** Last replay time (ISO), or null if never replayed. */
  lastPlayedAt: string | null;
  /** First-saved time (ISO). */
  createdAt: string | null;
  /** Last save/refresh time (ISO) — the playlist recency key. */
  updatedAt: string | null;
}

/** The in-character reply envelope pumpkin-bot returns in autonomous mode. */
export interface PumpkinReply {
  /** The line to speak aloud. */
  say: string;
  /** Face expression to ease toward while speaking. */
  expression: PumpkinExpression;
  /** Delivery size 0..1 (scales animation + mouth travel). */
  intensity: number;
}
