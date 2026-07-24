"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-16 10:30:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Portrait Studio catalog: the professional headshot styles + character portrait themes, and the deterministic prompt builder the generate route feeds to the media-generation kernel skill.
 * 2026-07-16 12:40:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Composable layers: interchangeable BACKGROUNDS, CLOTHING, HEADWEAR, FINISH, FRAMING — presets are layer combos + a pose, every layer overridable. validateOverrides() fail-closes; only notes is free text.
 * 2026-07-17 20:45:00 | roger.murphy@emeraldcoastsystemsgroup.com   | The big catalog: layer data moved to portrait-layers.ts (100 backgrounds + 70 clothing + 30 headwear + 26 PROPS + 12 finishes + 4 framings) and presets to portrait-presets.ts (100 profiles), both grouped. This module keeps the logic: prompt composition (props now an overridable layer — a prop replaces the preset's pose), fail-closed override validation, and the client catalog shape. All prior exports preserved.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHARACTER_PRESETS = exports.PROFESSIONAL_PRESETS = exports.FRAMINGS = exports.FINISHES = exports.PROPS = exports.HEADWEAR = exports.CLOTHING = exports.BACKGROUNDS = void 0;
exports.findStyle = findStyle;
exports.validateOverrides = validateOverrides;
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
 * @description Find a preset by mode + id.
 * @param mode - 'professional' | 'character'
 * @param presetId - candidate id from the client
 * @returns The preset, or null when unknown.
 */
function findStyle(mode, presetId) {
    const list = mode === 'professional' ? portrait_presets_1.PROFESSIONAL_PRESETS : portrait_presets_1.CHARACTER_PRESETS;
    return list.find((s) => s.id === presetId) ?? null;
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
/**
 * @description Compose the image-edit prompt from the preset + per-layer overrides. Deterministic —
 * identity preservation, exactly-two-hands, and no-text rules are encoded here once. A `prop`
 * override REPLACES the preset's pose (both describe what the hands are doing); props/poses are
 * skipped for headshot framing where hands are out of frame.
 *
 * @param mode - 'professional' (subject as themselves) | 'character' (face on a human-type body)
 * @param presetId - a preset id from this catalog
 * @param options - per-layer overrides + notes from the studio UI
 * @returns The prompt string for the storyboard image provider.
 * @throws Error when the mode/preset pair is unknown or an override id is invalid.
 */
function buildPortraitPrompt(mode, presetId, options) {
    const preset = findStyle(mode, presetId);
    if (!preset)
        throw new Error(`unknown ${mode} preset: ${presetId}`);
    const invalid = validateOverrides(options);
    if (invalid)
        throw new Error(invalid);
    const background = layer('background', preset, options);
    const attire = layer('attire', preset, options);
    const headwear = layer('headwear', preset, options);
    const finish = layer('finish', preset, options);
    const framing = layer('framing', preset, options);
    const hat = headwear ? ` and ${headwear}` : '';
    const framingId = options.framing || preset.framing;
    const propPrompt = options.prop ? (LAYERS.prop.get(options.prop)?.prompt ?? '') : '';
    const poseLine = propPrompt || preset.pose;
    const pose = poseLine && framingId !== 'headshot' ? ` ${capitalize(poseLine)}.` : '';
    if (mode === 'professional') {
        return ('Professional portrait of the same subject as the provided photo. ' +
            'Identity is paramount: preserve the exact face — same features, skin tone, hair, and expression character — ' +
            'so the result is unmistakably the same person on their best day. ' +
            `${capitalize(framing)}, wearing ${attire}${hat}, against ${background}.` +
            pose +
            ` Rendered as ${finish}, with sharp focus on the eyes and soft flattering key light.` +
            sanitizeNotes(options.notes) +
            ' No text, no watermark, no logo, no extra people.');
    }
    return ('Formal character portrait of the subject from the provided photo. ' +
        'Keep the face photorealistic and faithful to the photo — same fur or skin coloring, markings, eye color, and expression — ' +
        `while placing it on a human-type body wearing ${attire}${hat}, set against ${background}.` +
        pose +
        ` ${capitalize(framing)}, with both hands deliberately visible in frame — exactly two hands, anatomically correct.` +
        ` Rendered as ${finish}.` +
        ' Dignified, family-friendly, gallery quality.' +
        sanitizeNotes(options.notes) +
        ' No text, no watermark, no extra people.');
}
/** Uppercase the first character of a fragment so composed sentences read cleanly. */
function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
/**
 * @description The catalog shape the studio UI renders: grouped preset cards per mode + the six
 * interchangeable layer lists for the fine-tune pickers (grouped for optgroups). Prompt fragments
 * stay server-side — the client never assembles prompts.
 * @returns Pickable cards and layer options.
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
        },
        backgrounds: portrait_layers_1.BACKGROUNDS.map(stripItem),
        attire: portrait_layers_1.CLOTHING.map(stripItem),
        headwear: portrait_layers_1.HEADWEAR.map(stripItem),
        props: portrait_layers_1.PROPS.map(stripItem),
        finishes: portrait_layers_1.FINISHES.map(stripItem),
        framings: portrait_layers_1.FRAMINGS.map(stripItem),
    };
}
//# sourceMappingURL=portrait-catalog.js.map