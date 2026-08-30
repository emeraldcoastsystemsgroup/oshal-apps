"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_GROUP_SUBJECTS = exports.MIN_GROUP_SUBJECTS = exports.PORTRAIT_MODES = exports.GROUP_PRESETS = exports.CHARACTER_PRESETS = exports.PROFESSIONAL_PRESETS = exports.FRAMINGS = exports.FINISHES = exports.PROPS = exports.HEADWEAR = exports.CLOTHING = exports.BACKGROUNDS = void 0;
exports.isPortraitMode = isPortraitMode;
exports.findStyle = findStyle;
exports.validateOverrides = validateOverrides;
exports.validateSubjects = validateSubjects;
exports.buildPortraitPrompt = buildPortraitPrompt;
exports.clientCatalog = clientCatalog;
const portrait_layers_1 = require("./portrait-layers");
const portrait_presets_1 = require("./portrait-presets");
var portrait_layers_2 = require("./portrait-layers");
Object.defineProperty(exports, "BACKGROUNDS", { enumerable: true, get: function () { return portrait_layers_2.BACKGROUNDS; } });
Object.defineProperty(exports, "CLOTHING", { enumerable: true, get: function () { return portrait_layers_2.CLOTHING; } });
Object.defineProperty(exports, "HEADWEAR", { enumerable: true, get: function () { return portrait_layers_2.HEADWEAR; } });
Object.defineProperty(exports, "PROPS", { enumerable: true, get: function () { return portrait_layers_2.PROPS; } });
Object.defineProperty(exports, "FINISHES", { enumerable: true, get: function () { return portrait_layers_2.FINISHES; } });
Object.defineProperty(exports, "FRAMINGS", { enumerable: true, get: function () { return portrait_layers_2.FRAMINGS; } });
var portrait_presets_2 = require("./portrait-presets");
Object.defineProperty(exports, "PROFESSIONAL_PRESETS", { enumerable: true, get: function () { return portrait_presets_2.PROFESSIONAL_PRESETS; } });
Object.defineProperty(exports, "CHARACTER_PRESETS", { enumerable: true, get: function () { return portrait_presets_2.CHARACTER_PRESETS; } });
Object.defineProperty(exports, "GROUP_PRESETS", { enumerable: true, get: function () { return portrait_presets_2.GROUP_PRESETS; } });
/** @description Every mode the generate route accepts (fail-closed: anything else is a 400). */
exports.PORTRAIT_MODES = ['professional', 'character', 'group'];
/** @description A group is at least two faces — one face is a solo portrait, and the solo modes do it better. */
exports.MIN_GROUP_SUBJECTS = 2;
/** @description Six faces keeps the reference sheet at three columns and keeps each face large enough for the engine to hold every identity. */
exports.MAX_GROUP_SUBJECTS = 6;
const byId = (list) => new Map(list.map((i) => [i.id, i]));
const LAYERS = {
    background: byId(portrait_layers_1.BACKGROUNDS),
    attire: byId(portrait_layers_1.CLOTHING),
    headwear: byId(portrait_layers_1.HEADWEAR),
    prop: byId(portrait_layers_1.PROPS),
    finish: byId(portrait_layers_1.FINISHES),
    framing: byId(portrait_layers_1.FRAMINGS),
};
/**
 * @description Is this string one of the studio modes?
 * @param mode - candidate from the client
 * @returns True for professional | character | group.
 */
function isPortraitMode(mode) {
    return exports.PORTRAIT_MODES.includes(mode);
}
function presetList(mode) {
    if (mode === 'professional')
        return portrait_presets_1.PROFESSIONAL_PRESETS;
    if (mode === 'character')
        return portrait_presets_1.CHARACTER_PRESETS;
    if (mode === 'group')
        return portrait_presets_1.GROUP_PRESETS;
    return [];
}
/**
 * @description Find a preset by mode + id.
 * @param mode - 'professional' | 'character' | 'group'
 * @param presetId - candidate id from the client
 * @returns The preset, or null when unknown (unknown mode included).
 */
function findStyle(mode, presetId) {
    return presetList(mode).find((s) => s.id === presetId) ?? null;
}
/**
 * @description Fail-closed override validation: every provided layer id must exist in its
 * catalog. Only `notes` is free text (and it is sanitized separately).
 * @param options - the client's overrides
 * @returns An error message, or null when everything checks out.
 */
function validateOverrides(options) {
    for (const key of ['background', 'attire', 'headwear', 'prop', 'finish', 'framing']) {
        const v = options[key];
        if (v !== undefined && v !== '' && !LAYERS[key].has(v))
            return `unknown ${key}: ${v}`;
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
function validateSubjects(mode, subjects) {
    if (mode !== 'group') {
        return subjects === undefined || subjects === null ? null : 'subjects is only valid in group mode';
    }
    const n = typeof subjects === 'number' ? subjects : Number(subjects);
    if (subjects === undefined || subjects === null || !Number.isInteger(n) || n < exports.MIN_GROUP_SUBJECTS || n > exports.MAX_GROUP_SUBJECTS) {
        return `group mode needs between ${exports.MIN_GROUP_SUBJECTS} and ${exports.MAX_GROUP_SUBJECTS} faces (got ${String(subjects)})`;
    }
    return null;
}
/** Replace control characters, collapse whitespace, cap length — free-text notes stay a one-line request. */
function sanitizeNotes(notes) {
    if (!notes)
        return '';
    const clean = Array.from(notes)
        .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
    return clean ? ` Additional request from the subject: ${clean}.` : '';
}
/** Resolve one layer: override id when given, else the preset's id; returns the prompt fragment. */
function layer(key, preset, options) {
    const id = options[key] || preset[key];
    return LAYERS[key].get(id)?.prompt ?? '';
}
function resolveParts(preset, options) {
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
function soloPose(p) {
    const poseLine = p.propPrompt || p.presetPose;
    return poseLine && p.framingId !== 'headshot' ? ` ${capitalize(poseLine)}.` : '';
}
function professionalPrompt(p) {
    return ('Professional portrait of the same subject as the provided photo. ' +
        'Identity is paramount: preserve the exact face — same features, skin tone, hair, and expression character — ' +
        'so the result is unmistakably the same person on their best day. ' +
        `${capitalize(p.framing)}, wearing ${p.attire}${p.hat}, against ${p.background}.` +
        soloPose(p) +
        ` Rendered as ${p.finish}, with sharp focus on the eyes and soft flattering key light.` +
        p.notes +
        ' No text, no watermark, no logo, no extra people.');
}
function characterPrompt(p) {
    return ('Formal character portrait of the subject from the provided photo. ' +
        'Keep the face photorealistic and faithful to the photo — same fur or skin coloring, markings, eye color, and expression — ' +
        `while placing it on a human-type body wearing ${p.attire}${p.hat}, set against ${p.background}.` +
        soloPose(p) +
        ` ${capitalize(p.framing)}, with both hands deliberately visible in frame — exactly two hands, anatomically correct.` +
        ` Rendered as ${p.finish}.` +
        ' Dignified, family-friendly, gallery quality.' +
        p.notes +
        ' No text, no watermark, no extra people.');
}
/**
 * Group mode. The anchor the engine receives is a contact sheet the browser built: N face crops
 * tiled left-to-right, top-to-bottom, each with a number badge. The prompt says so explicitly —
 * the engine must place ALL N, each once, and must not paint the badges into the scene. The
 * preset's `pose` is the group ARRANGEMENT and always stays; a prop override is applied to each
 * member on top of it (unlike solo modes, where a prop replaces the pose).
 */
function groupPrompt(p, n) {
    const arrangement = p.presetPose ? ` The group is ${p.presetPose}.` : '';
    const prop = p.propPrompt ? ` Each of the ${n} is posed with ${p.propPrompt}.` : '';
    const hands = p.framingId !== 'headshot'
        ? ', with everyone\'s hands visible in frame — exactly two hands per person, anatomically correct'
        : '';
    return (`Group portrait of the ${n} people in the provided reference photo. ` +
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
        ' No text, no watermark, and no numbers or labels carried over from the reference sheet.');
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
function buildPortraitPrompt(mode, presetId, options) {
    const preset = findStyle(mode, presetId);
    if (!preset)
        throw new Error(`unknown ${mode} preset: ${presetId}`);
    const invalid = validateOverrides(options) || validateSubjects(mode, options.subjects);
    if (invalid)
        throw new Error(invalid);
    const parts = resolveParts(preset, options);
    if (mode === 'professional')
        return professionalPrompt(parts);
    if (mode === 'character')
        return characterPrompt(parts);
    return groupPrompt(parts, Number(options.subjects));
}
/** Uppercase the first character of a fragment so composed sentences read cleanly. */
function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
/**
 * @description The catalog shape the studio UI renders: grouped preset cards per mode (solo profiles,
 * characters, and group scenes) + the six interchangeable layer lists for the fine-tune pickers
 * (grouped for optgroups) + the group face-count limits. Prompt fragments stay server-side — the
 * client never assembles prompts.
 * @returns Pickable cards, layer options and group limits.
 */
function clientCatalog() {
    const stripPreset = (p) => ({
        id: p.id, label: p.label, icon: p.icon, blurb: p.blurb, group: p.group,
        background: p.background, attire: p.attire, headwear: p.headwear, finish: p.finish, framing: p.framing,
    });
    const stripItem = (i) => ({ id: i.id, label: i.label, icon: i.icon, group: i.group });
    return {
        presets: {
            professional: portrait_presets_1.PROFESSIONAL_PRESETS.map(stripPreset),
            character: portrait_presets_1.CHARACTER_PRESETS.map(stripPreset),
            group: portrait_presets_1.GROUP_PRESETS.map(stripPreset),
        },
        groupLimits: { min: exports.MIN_GROUP_SUBJECTS, max: exports.MAX_GROUP_SUBJECTS },
        backgrounds: portrait_layers_1.BACKGROUNDS.map(stripItem),
        attire: portrait_layers_1.CLOTHING.map(stripItem),
        headwear: portrait_layers_1.HEADWEAR.map(stripItem),
        props: portrait_layers_1.PROPS.map(stripItem),
        finishes: portrait_layers_1.FINISHES.map(stripItem),
        framings: portrait_layers_1.FRAMINGS.map(stripItem),
    };
}
