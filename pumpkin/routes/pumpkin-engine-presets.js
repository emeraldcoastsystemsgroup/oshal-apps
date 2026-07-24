"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-15 18:26:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial: the shipped built-in pumpkin looks + a normalizer that clamps any user-supplied preset into a safe, fully-populated PumpkinPreset. 'inflatable' (black bg, glowing features) is the project-into-a-balloon default; 'screen' is the deep-orange flat-display look.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILTIN_PRESETS = exports.BUILTIN_PRESET_NAMES = void 0;
exports.normalizePreset = normalizePreset;
exports.builtinPreset = builtinPreset;
/** Built-in preset names are reserved — a user "save" of one of these clones to a new slug. */
exports.BUILTIN_PRESET_NAMES = ['inflatable', 'screen', 'classic', 'friendly', 'evil'];
/**
 * The shipped looks. Every field is populated so the canvas never has to guess a default.
 * `inflatable` is the projector default: a pure-black frame so only the carved features throw
 * light (the orange comes from the inflatable's own fabric). `screen` is the deep-orange look
 * for a flat display where the background must supply the pumpkin body.
 */
exports.BUILTIN_PRESETS = {
    inflatable: {
        name: 'inflatable',
        label: 'Inflatable (projector)',
        builtin: true,
        colors: { background: '#000000', bodyGlow: 'rgba(255,96,0,0.12)', feature: '#ffb020', featureHot: '#fff3c0', ambient: 'rgba(0,0,0,0.9)' },
        face: { eyeShape: 'triangle', mouthShape: 'jagged', toothCount: 4, eyeSpacing: 0.58, eyeSize: 0.5, mouthWidth: 0.72, browAngle: -0.15 },
        motion: { idleBob: 10, bobSpeed: 0.28, sway: 1.6, blinkPerMin: 9, gaze: 0.35, mouthReactivity: 1.1, flicker: 0.35 },
        glow: { blur: 44, intensity: 1.25 },
        voice: { voiceId: 'Charon', rate: 0.95 },
        defaultMode: 'mimic',
    },
    screen: {
        name: 'screen',
        label: 'Deep Orange (screen)',
        builtin: true,
        colors: { background: '#4a1600', bodyGlow: 'rgba(255,120,0,0.20)', feature: '#ffcf3f', featureHot: '#fffbe0', ambient: 'rgba(30,8,0,0.85)' },
        face: { eyeShape: 'triangle', mouthShape: 'snaggle', toothCount: 5, eyeSpacing: 0.56, eyeSize: 0.52, mouthWidth: 0.74, browAngle: -0.1 },
        motion: { idleBob: 9, bobSpeed: 0.3, sway: 1.8, blinkPerMin: 10, gaze: 0.4, mouthReactivity: 1.0, flicker: 0.28 },
        glow: { blur: 34, intensity: 1.05 },
        voice: { voiceId: 'Charon', rate: 1.0 },
        defaultMode: 'mimic',
    },
    classic: {
        name: 'classic',
        label: 'Classic Jack-o’-Lantern',
        builtin: true,
        colors: { background: '#3a1200', bodyGlow: 'rgba(255,110,0,0.18)', feature: '#ff9e2c', featureHot: '#ffe08a', ambient: 'rgba(20,7,0,0.85)' },
        face: { eyeShape: 'triangle', mouthShape: 'snaggle', toothCount: 6, eyeSpacing: 0.55, eyeSize: 0.48, mouthWidth: 0.7, browAngle: 0 },
        motion: { idleBob: 8, bobSpeed: 0.26, sway: 1.4, blinkPerMin: 8, gaze: 0.3, mouthReactivity: 1.0, flicker: 0.4 },
        glow: { blur: 30, intensity: 1.0 },
        voice: { voiceId: 'Orus', rate: 1.0 },
        defaultMode: 'mimic',
    },
    friendly: {
        name: 'friendly',
        label: 'Friendly Pumpkin',
        builtin: true,
        colors: { background: '#4a1a00', bodyGlow: 'rgba(255,140,20,0.22)', feature: '#ffd257', featureHot: '#fff7d6', ambient: 'rgba(28,10,0,0.8)' },
        face: { eyeShape: 'round', mouthShape: 'grin', toothCount: 2, eyeSpacing: 0.5, eyeSize: 0.6, mouthWidth: 0.8, browAngle: 0.25 },
        motion: { idleBob: 12, bobSpeed: 0.36, sway: 2.4, blinkPerMin: 14, gaze: 0.5, mouthReactivity: 1.2, flicker: 0.2 },
        glow: { blur: 32, intensity: 1.1 },
        voice: { voiceId: 'Aoede', rate: 1.05 },
        defaultMode: 'autonomous',
    },
    evil: {
        name: 'evil',
        label: 'Wicked (angry)',
        builtin: true,
        colors: { background: '#160300', bodyGlow: 'rgba(255,50,0,0.16)', feature: '#ff7a18', featureHot: '#ffcf9a', ambient: 'rgba(20,0,0,0.92)' },
        face: { eyeShape: 'angry', mouthShape: 'jagged', toothCount: 7, eyeSpacing: 0.6, eyeSize: 0.5, mouthWidth: 0.82, browAngle: -0.7 },
        motion: { idleBob: 6, bobSpeed: 0.22, sway: 1.0, blinkPerMin: 5, gaze: 0.25, mouthReactivity: 1.3, flicker: 0.55 },
        glow: { blur: 40, intensity: 1.4 },
        voice: { voiceId: 'Fenrir', rate: 0.9 },
        defaultMode: 'autonomous',
    },
};
/** Clamp a number into [min,max], falling back to `dflt` for non-finite input. */
function clamp(v, min, max, dflt) {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt;
    return Math.min(max, Math.max(min, n));
}
/** Accept a string within an allowlist, else the fallback. */
function oneOf(v, allowed, dflt) {
    return typeof v === 'string' && allowed.includes(v) ? v : dflt;
}
/** A CSS color is accepted if it's a short-ish string; anything else falls back. Purely a guard against payload abuse — the canvas ultimately validates. */
function color(v, dflt) {
    return typeof v === 'string' && v.length > 0 && v.length <= 32 ? v : dflt;
}
/**
 * @description Coerce an arbitrary (client-supplied) object into a safe, fully-populated
 * PumpkinPreset. Every scalar is clamped to its valid range and every enum is allowlisted, so a
 * saved custom look can never carry unbounded blur, an injected color payload, or a missing field
 * that would crash the renderer. Missing fields inherit from the `screen` built-in.
 * @param raw - The untrusted candidate preset (from PUT /api/pumpkin/presets/:name).
 * @param name - The slug to stamp onto the normalized preset.
 * @returns A valid PumpkinPreset safe to persist and render.
 */
function normalizePreset(raw, name) {
    const r = (raw ?? {});
    const base = exports.BUILTIN_PRESETS.screen;
    const c = r.colors ?? {};
    const f = r.face ?? {};
    const m = r.motion ?? {};
    const g = r.glow ?? {};
    const v = r.voice ?? {};
    return {
        name,
        label: typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 60) : name,
        builtin: false,
        colors: {
            background: color(c.background, base.colors.background),
            bodyGlow: color(c.bodyGlow, base.colors.bodyGlow),
            feature: color(c.feature, base.colors.feature),
            featureHot: color(c.featureHot, base.colors.featureHot),
            ambient: color(c.ambient, base.colors.ambient),
        },
        face: {
            eyeShape: oneOf(f.eyeShape, ['triangle', 'round', 'angry', 'square', 'diamond'], base.face.eyeShape),
            mouthShape: oneOf(f.mouthShape, ['jagged', 'grin', 'oval', 'snaggle'], base.face.mouthShape),
            toothCount: Math.round(clamp(f.toothCount, 0, 12, base.face.toothCount)),
            eyeSpacing: clamp(f.eyeSpacing, 0, 1, base.face.eyeSpacing),
            eyeSize: clamp(f.eyeSize, 0, 1, base.face.eyeSize),
            mouthWidth: clamp(f.mouthWidth, 0, 1, base.face.mouthWidth),
            browAngle: clamp(f.browAngle, -1, 1, base.face.browAngle),
        },
        motion: {
            idleBob: clamp(m.idleBob, 0, 40, base.motion.idleBob),
            bobSpeed: clamp(m.bobSpeed, 0, 2, base.motion.bobSpeed),
            sway: clamp(m.sway, 0, 8, base.motion.sway),
            blinkPerMin: clamp(m.blinkPerMin, 0, 40, base.motion.blinkPerMin),
            gaze: clamp(m.gaze, 0, 1, base.motion.gaze),
            mouthReactivity: clamp(m.mouthReactivity, 0, 2, base.motion.mouthReactivity),
            flicker: clamp(m.flicker, 0, 1, base.motion.flicker),
        },
        glow: {
            blur: clamp(g.blur, 0, 80, base.glow.blur),
            intensity: clamp(g.intensity, 0, 2, base.glow.intensity),
        },
        voice: {
            voiceId: color(v.voiceId, base.voice.voiceId),
            rate: clamp(v.rate, 0.5, 2, base.voice.rate),
        },
        defaultMode: oneOf(r.defaultMode, ['mimic', 'autonomous'], base.defaultMode),
    };
}
/** Resolve a built-in preset by name (a defensive deep-ish copy), or null if not a built-in. */
function builtinPreset(name) {
    const p = exports.BUILTIN_PRESETS[name];
    return p ? JSON.parse(JSON.stringify(p)) : null;
}
//# sourceMappingURL=pumpkin-engine-presets.js.map