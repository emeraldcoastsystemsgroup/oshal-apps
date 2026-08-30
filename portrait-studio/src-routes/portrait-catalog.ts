/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-16 10:30:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Portrait Studio catalog: the professional headshot styles + character portrait themes, and the deterministic prompt builder the generate route feeds to the media-generation kernel skill.
 * 2026-07-16 12:40:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Composable layers: interchangeable BACKGROUNDS, CLOTHING, HEADWEAR, FINISH, FRAMING — presets are layer combos + a pose, every layer overridable. validateOverrides() fail-closes; only notes is free text.
 * 2026-07-17 20:45:00 | roger.murphy@emeraldcoastsystemsgroup.com   | The big catalog: layer data moved to portrait-layers.ts (100 backgrounds + 70 clothing + 30 headwear + 26 PROPS + 12 finishes + 4 framings) and presets to portrait-presets.ts (100 profiles), both grouped. This module keeps the logic: prompt composition (props now an overridable layer — a prop replaces the preset's pose), fail-closed override validation, and the client catalog shape. All prior exports preserved.
 * 2026-08-29 10:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Group mode: a third PortraitMode ('group') backed by GROUP_PRESETS; validateSubjects() fail-closes the face count (MIN..MAX_GROUP_SUBJECTS, refused outside group mode); the group prompt reads the client-built NUMBERED reference sheet — every one of the N faces exactly once, no duplicates, no extra people, no sheet labels carried over, two hands per person — with a prop override applied to EACH member while the preset's arrangement stays. clientCatalog() adds presets.group + groupLimits. Prompt assembly split into per-mode helpers (50-line rule).
 */

import { BACKGROUNDS, CLOTHING, HEADWEAR, PROPS, FINISHES, FRAMINGS } from './portrait-layers';
import type { CatalogItem } from './portrait-layers';
import { PROFESSIONAL_PRESETS, CHARACTER_PRESETS, GROUP_PRESETS } from './portrait-presets';
import type { PortraitPreset } from './portrait-presets';

export { BACKGROUNDS, CLOTHING, HEADWEAR, PROPS, FINISHES, FRAMINGS } from './portrait-layers';
export type { CatalogItem } from './portrait-layers';
export { PROFESSIONAL_PRESETS, CHARACTER_PRESETS, GROUP_PRESETS } from './portrait-presets';
export type { PortraitPreset } from './portrait-presets';

/** @description The three studio modes. 'group' takes a numbered reference sheet of several faces. */
export type PortraitMode = 'professional' | 'character' | 'group';
/** @description Every mode the generate route accepts (fail-closed: anything else is a 400). */
export const PORTRAIT_MODES: readonly PortraitMode[] = ['professional', 'character', 'group'];
/** @description A group is at least two faces — one face is a solo portrait, and the solo modes do it better. */
export const MIN_GROUP_SUBJECTS = 2;
/** @description Six faces keeps the reference sheet at three columns and keeps each face large enough for the engine to hold every identity. */
export const MAX_GROUP_SUBJECTS = 6;

/** @description Per-generation layer overrides from the studio UI. Empty/absent = preset default. */
export interface PortraitOptions {
  background?: string;
  attire?: string;
  headwear?: string;
  prop?: string;
  finish?: string;
  framing?: string;
  notes?: string;
  /** Group mode only: how many numbered face tiles the reference sheet carries (set by the route from the multipart field, never trusted from the JSON blob). */
  subjects?: number;
}

const byId = (list: readonly CatalogItem[]): Map<string, CatalogItem> => new Map(list.map((i) => [i.id, i]));
const LAYERS: Record<string, Map<string, CatalogItem>> = {
  background: byId(BACKGROUNDS),
  attire: byId(CLOTHING),
  headwear: byId(HEADWEAR),
  prop: byId(PROPS),
  finish: byId(FINISHES),
  framing: byId(FRAMINGS),
};

/**
 * @description Is this string one of the studio modes?
 * @param mode - candidate from the client
 * @returns True for professional | character | group.
 */
export function isPortraitMode(mode: string): mode is PortraitMode {
  return (PORTRAIT_MODES as readonly string[]).includes(mode);
}

function presetList(mode: string): readonly PortraitPreset[] {
  if (mode === 'professional') return PROFESSIONAL_PRESETS;
  if (mode === 'character') return CHARACTER_PRESETS;
  if (mode === 'group') return GROUP_PRESETS;
  return [];
}

/**
 * @description Find a preset by mode + id.
 * @param mode - 'professional' | 'character' | 'group'
 * @param presetId - candidate id from the client
 * @returns The preset, or null when unknown (unknown mode included).
 */
export function findStyle(mode: string, presetId: string): PortraitPreset | null {
  return presetList(mode).find((s) => s.id === presetId) ?? null;
}

/**
 * @description Fail-closed override validation: every provided layer id must exist in its
 * catalog. Only `notes` is free text (and it is sanitized separately).
 * @param options - the client's overrides
 * @returns An error message, or null when everything checks out.
 */
export function validateOverrides(options: PortraitOptions): string | null {
  for (const key of ['background', 'attire', 'headwear', 'prop', 'finish', 'framing'] as const) {
    const v = options[key];
    if (v !== undefined && v !== '' && !LAYERS[key].has(v)) return `unknown ${key}: ${v}`;
  }
  return null;
}

/**
 * @description Fail-closed face-count validation. Group mode needs an integer in
 * [MIN_GROUP_SUBJECTS, MAX_GROUP_SUBJECTS]; the solo modes must not carry a count at all —
 * a stray `subjects` there means the client and server disagree about what was uploaded.
 * @param mode - the studio mode
 * @param subjects - the candidate count (number, numeric string, or absent)
 * @returns An error message, or null when acceptable.
 */
export function validateSubjects(mode: string, subjects: unknown): string | null {
  if (mode !== 'group') {
    return subjects === undefined || subjects === null ? null : 'subjects is only valid in group mode';
  }
  const n = typeof subjects === 'number' ? subjects : Number(subjects);
  if (subjects === undefined || subjects === null || !Number.isInteger(n) || n < MIN_GROUP_SUBJECTS || n > MAX_GROUP_SUBJECTS) {
    return `group mode needs between ${MIN_GROUP_SUBJECTS} and ${MAX_GROUP_SUBJECTS} faces (got ${String(subjects)})`;
  }
  return null;
}

/** Replace control characters, collapse whitespace, cap length — free-text notes stay a one-line request. */
function sanitizeNotes(notes: string | undefined): string {
  if (!notes) return '';
  const clean = Array.from(notes)
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  return clean ? ` Additional request from the subject: ${clean}.` : '';
}

/** Resolve one layer: override id when given, else the preset's id; returns the prompt fragment. */
function layer(key: 'background' | 'attire' | 'headwear' | 'finish' | 'framing', preset: PortraitPreset, options: PortraitOptions): string {
  const id = (options[key] as string | undefined) || preset[key];
  return LAYERS[key].get(id)?.prompt ?? '';
}

/** The resolved fragments every mode's prompt is composed from. */
interface ResolvedParts {
  background: string;
  attire: string;
  /** ` and <headwear>` or '' — already joined for "wearing X and Y". */
  hat: string;
  finish: string;
  framing: string;
  framingId: string;
  /** The prop override's pose fragment, or '' when no prop was chosen. */
  propPrompt: string;
  /** The preset's own pose/arrangement line. */
  presetPose: string;
  notes: string;
}

function resolveParts(preset: PortraitPreset, options: PortraitOptions): ResolvedParts {
  const headwear = layer('headwear', preset, options);
  return {
    background: layer('background', preset, options),
    attire: layer('attire', preset, options),
    hat: headwear ? ` and ${headwear}` : '',
    finish: layer('finish', preset, options),
    framing: layer('framing', preset, options),
    framingId: options.framing || preset.framing,
    propPrompt: options.prop ? (LAYERS.prop.get(options.prop)?.prompt ?? '') : '',
    presetPose: preset.pose,
    notes: sanitizeNotes(options.notes),
  };
}

/** Solo modes: a prop override REPLACES the preset pose; both are skipped for headshot framing (hands out of frame). */
function soloPose(p: ResolvedParts): string {
  const poseLine = p.propPrompt || p.presetPose;
  return poseLine && p.framingId !== 'headshot' ? ` ${capitalize(poseLine)}.` : '';
}

function professionalPrompt(p: ResolvedParts): string {
  return (
    'Professional portrait of the same subject as the provided photo. ' +
    'Identity is paramount: preserve the exact face — same features, skin tone, hair, and expression character — ' +
    'so the result is unmistakably the same person on their best day. ' +
    `${capitalize(p.framing)}, wearing ${p.attire}${p.hat}, against ${p.background}.` +
    soloPose(p) +
    ` Rendered as ${p.finish}, with sharp focus on the eyes and soft flattering key light.` +
    p.notes +
    ' No text, no watermark, no logo, no extra people.'
  );
}

function characterPrompt(p: ResolvedParts): string {
  return (
    'Formal character portrait of the subject from the provided photo. ' +
    'Keep the face photorealistic and faithful to the photo — same fur or skin coloring, markings, eye color, and expression — ' +
    `while placing it on a human-type body wearing ${p.attire}${p.hat}, set against ${p.background}.` +
    soloPose(p) +
    ` ${capitalize(p.framing)}, with both hands deliberately visible in frame — exactly two hands, anatomically correct.` +
    ` Rendered as ${p.finish}.` +
    ' Dignified, family-friendly, gallery quality.' +
    p.notes +
    ' No text, no watermark, no extra people.'
  );
}

/**
 * Group mode. The anchor the engine receives is a contact sheet the browser built: N face crops
 * tiled left-to-right, top-to-bottom, each with a number badge. The prompt says so explicitly —
 * the engine must place ALL N, each once, and must not paint the badges into the scene. The
 * preset's `pose` is the group ARRANGEMENT and always stays; a prop override is applied to each
 * member on top of it (unlike solo modes, where a prop replaces the pose).
 */
function groupPrompt(p: ResolvedParts, n: number): string {
  const arrangement = p.presetPose ? ` The group is ${p.presetPose}.` : '';
  const prop = p.propPrompt ? ` Each of the ${n} is posed with ${p.propPrompt}.` : '';
  const hands = p.framingId !== 'headshot'
    ? ', with everyone\'s hands visible in frame — exactly two hands per person, anatomically correct'
    : '';
  return (
    `Group portrait of the ${n} people in the provided reference photo. ` +
    `The reference is a numbered contact sheet: ${n} face crops labeled 1 to ${n}, read left to right, top to bottom. ` +
    `Every one of the ${n} must appear in the scene exactly once — nobody missing, nobody duplicated, no extra people. ` +
    'Keep each face photorealistic and faithful to its tile — same features, skin or fur coloring, markings, hair, eye color and expression character — ' +
    `each placed on a full human-type body, all wearing ${p.attire}${p.hat}, set against ${p.background}.` +
    arrangement +
    prop +
    ` ${capitalize(p.framing)}${hands}.` +
    ` Rendered as ${p.finish}.` +
    ' Dignified, family-friendly, gallery quality.' +
    p.notes +
    ' No text, no watermark, and no numbers or labels carried over from the reference sheet.'
  );
}

/**
 * @description Compose the image-edit prompt from the preset + per-layer overrides. Deterministic —
 * identity preservation, exactly-two-hands, and no-text rules are encoded here once. In the solo
 * modes a `prop` override REPLACES the preset's pose (both describe what the hands are doing);
 * props/poses are skipped for headshot framing where hands are out of frame. In group mode the
 * preset's pose is the arrangement of the whole group and a prop is added to every member.
 *
 * @param mode - 'professional' (subject as themselves) | 'character' (face on a human-type body) | 'group' (N faces, one scene)
 * @param presetId - a preset id from this catalog
 * @param options - per-layer overrides + notes (+ `subjects` in group mode) from the studio UI
 * @returns The prompt string for the storyboard image provider.
 * @throws Error when the mode/preset pair is unknown, an override id is invalid, or the face count is out of range.
 */
export function buildPortraitPrompt(mode: string, presetId: string, options: PortraitOptions): string {
  const preset = findStyle(mode, presetId);
  if (!preset) throw new Error(`unknown ${mode} preset: ${presetId}`);
  const invalid = validateOverrides(options) || validateSubjects(mode, options.subjects);
  if (invalid) throw new Error(invalid);
  const parts = resolveParts(preset, options);
  if (mode === 'professional') return professionalPrompt(parts);
  if (mode === 'character') return characterPrompt(parts);
  return groupPrompt(parts, Number(options.subjects));
}

/** Uppercase the first character of a fragment so composed sentences read cleanly. */
function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * @description The catalog shape the studio UI renders: grouped preset cards per mode (solo profiles,
 * characters, and group scenes) + the six interchangeable layer lists for the fine-tune pickers
 * (grouped for optgroups) + the group face-count limits. Prompt fragments stay server-side — the
 * client never assembles prompts.
 * @returns Pickable cards, layer options and group limits.
 */
export function clientCatalog(): Record<string, unknown> {
  const stripPreset = (p: PortraitPreset): Record<string, string> => ({
    id: p.id, label: p.label, icon: p.icon, blurb: p.blurb, group: p.group,
    background: p.background, attire: p.attire, headwear: p.headwear, finish: p.finish, framing: p.framing,
  });
  const stripItem = (i: CatalogItem): Record<string, string> => ({ id: i.id, label: i.label, icon: i.icon, group: i.group });
  return {
    presets: {
      professional: PROFESSIONAL_PRESETS.map(stripPreset),
      character: CHARACTER_PRESETS.map(stripPreset),
      group: GROUP_PRESETS.map(stripPreset),
    },
    groupLimits: { min: MIN_GROUP_SUBJECTS, max: MAX_GROUP_SUBJECTS },
    backgrounds: BACKGROUNDS.map(stripItem),
    attire: CLOTHING.map(stripItem),
    headwear: HEADWEAR.map(stripItem),
    props: PROPS.map(stripItem),
    finishes: FINISHES.map(stripItem),
    framings: FRAMINGS.map(stripItem),
  };
}
