"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — starter rigs built from catalog rows: the
 *                     |                             | Adafruit-style two-axis eye gimbal, a six-servo face (eyes,
 *                     |                             | lids, neck) in the Phil / Zappo-II shape, and a skull that adds
 *                     |                             | a jaw on standard servos — each with the pose vocabulary
 *                     |                             | (NEUTRAL, LOOK_*, EYES_*, JAW_*) and the scenarios (BLINK,
 *                     |                             | GLANCE, SCAN, IDLE_01, SURPRISED, TALK, SCARE) a prop starts
 *                     |                             | with. Every template is validated through the same contract
 *                     |                             | the routes enforce, so a template that drifts fails the load.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTemplates = buildTemplates;
exports.findTemplate = findTemplate;
const catalog_1 = require("./catalog");
const rig_contract_1 = require("./rig-contract");
const scenario_1 = require("./scenario");
function channel(rows, spec) {
    const row = rows.get(spec.model);
    if (!row)
        throw new Error(`template needs catalog row ${spec.model}`);
    return { id: spec.id, channel: spec.channel, model: spec.model, centerUs: Math.round((row.pulseMinUs + row.pulseMaxUs) / 2), usPerDeg: (0, catalog_1.usPerDegOf)(row), reversed: spec.reversed ?? false, neutralDeg: spec.neutralDeg ?? 0, minDeg: spec.minDeg, maxDeg: spec.maxDeg, minUs: row.pulseMinUs, maxUs: row.pulseMaxUs, maxDegPerS: (0, catalog_1.maxDegPerSOf)(row) };
}
const move = (pose, ms, ease = 'in-out') => ({ kind: 'move', pose, ms, ease });
const hold = (ms) => ({ kind: 'hold', ms });
const EYES = [{ id: 'eye-pan', channel: 0, model: 'sg90', minDeg: -30, maxDeg: 30 }, { id: 'eye-tilt', channel: 1, model: 'sg90', minDeg: -25, maxDeg: 25 }];
const LIDS = [{ id: 'lid-upper', channel: 2, model: 'mg90s', minDeg: -10, maxDeg: 60 }, { id: 'lid-lower', channel: 3, model: 'mg90s', minDeg: -5, maxDeg: 40 }];
const NECK = (model) => [{ id: 'neck-yaw', channel: 4, model, minDeg: -45, maxDeg: 45 }, { id: 'neck-pitch', channel: 5, model, minDeg: -25, maxDeg: 25 }];
const JAW = { id: 'jaw', channel: 6, model: 'mg996r', minDeg: 0, maxDeg: 35 };
const EYE_POSES = { NEUTRAL: { 'eyes.pan': 0, 'eyes.tilt': 0 }, LOOK_LEFT: { 'eyes.pan': -25 }, LOOK_RIGHT: { 'eyes.pan': 25 }, LOOK_UP: { 'eyes.tilt': 20 }, LOOK_DOWN: { 'eyes.tilt': -20 } };
const LID_POSES = { EYES_OPEN: { 'lids.upper': 0, 'lids.lower': 0 }, EYES_CLOSED: { 'lids.upper': 60, 'lids.lower': 40 }, EYES_WIDE: { 'lids.upper': -10, 'lids.lower': -5 } };
const EYE_SCENARIOS = {
    GLANCE_LEFT: { description: 'A quick look to the left and back', steps: [move('LOOK_LEFT', 250, 'out'), hold(600), move('NEUTRAL', 400)] },
    SCAN: { description: 'Sweep left, right, back to centre', steps: [move('LOOK_LEFT', 500), hold(400), move('LOOK_RIGHT', 900), hold(400), move('NEUTRAL', 500)] },
    IDLE_01: { description: 'Slow wandering gaze', steps: [{ kind: 'repeat', times: 2, steps: [move('LOOK_LEFT', 700, 'out'), hold(900), move('LOOK_RIGHT', 900), hold(700), move('LOOK_UP', 500), hold(400), move('NEUTRAL', 600)] }] },
};
const FACE_SCENARIOS = {
    BLINK: { description: 'Close and open the lids — commanded linear, since a servo at full speed moves linearly (60° in 130 ms on a metal-gear micro servo)', steps: [move('EYES_CLOSED', 130, 'linear'), hold(40), move('EYES_OPEN', 150, 'linear')] },
    SURPRISED: { description: 'Wide eyes, head back, then relax', steps: [{ kind: 'together', steps: [move('EYES_WIDE', 100, 'out'), { kind: 'move', axes: { 'neck.pitch': 15 }, ms: 250, ease: 'out' }] }, hold(800), { kind: 'together', steps: [move('EYES_OPEN', 400), { kind: 'move', axes: { 'neck.pitch': 0 }, ms: 500, ease: 'in-out' }] }] },
    IDLE_02: { description: 'Wandering gaze with blinks and a head turn', steps: [move('LOOK_LEFT', 700, 'out'), { kind: 'run', scenario: 'BLINK' }, hold(600), { kind: 'together', steps: [move('LOOK_RIGHT', 600), { kind: 'move', axes: { 'neck.yaw': 20 }, ms: 900, ease: 'in-out' }] }, hold(700), { kind: 'run', scenario: 'BLINK' }, move('NEUTRAL', 800)] },
};
const SKULL_SCENARIOS = {
    TALK: { description: 'Jaw chatter for about a second (half-open swings a 55 g servo can follow)', steps: [{ kind: 'repeat', times: 5, steps: [move('JAW_HALF', 130), move('JAW_CLOSED', 130)] }] },
    SCARE: { description: 'Wide eyes, jaw drops, head lunges, then resets', steps: [{ kind: 'together', steps: [move('EYES_WIDE', 100, 'out'), move('JAW_OPEN', 240), { kind: 'move', axes: { 'neck.pitch': -10 }, ms: 220, ease: 'out' }] }, hold(1200), { kind: 'together', steps: [move('EYES_OPEN', 500), move('JAW_CLOSED', 400), { kind: 'move', axes: { 'neck.pitch': 0 }, ms: 600, ease: 'in-out' }] }] },
};
/**
 * @description Build every template from the catalog, validated.
 * @param rows - Servo rows by id.
 * @returns The templates.
 */
function buildTemplates(rows) {
    const make = (id, title, description, specs, mechanisms, supply, poses, scenarios) => {
        const rig = (0, rig_contract_1.validateRig)({ channels: specs.map((s) => channel(rows, s)), mechanisms, supply, controller: { board: 'pca9685', transport: 'web-serial', baud: 115200 } });
        const validPoses = (0, scenario_1.validatePoses)(poses, rig);
        return { id, title, description, rig, poses: validPoses, scenarios: (0, scenario_1.validateScenarios)(scenarios, rig, validPoses) };
    };
    const eyes = { id: 'eyes', kind: 'eye-gimbal', axes: { pan: 'eye-pan', tilt: 'eye-tilt' } };
    const lids = { id: 'lids', kind: 'eyelids', axes: { upper: 'lid-upper', lower: 'lid-lower' } };
    const neck = { id: 'neck', kind: 'neck', axes: { yaw: 'neck-yaw', pitch: 'neck-pitch' } };
    const jaw = { id: 'jaw', kind: 'jaw', axes: { open: 'jaw' } };
    return [
        make('two-axis-eyes', 'Two-axis eyes', 'The Adafruit-style eye gimbal: one servo pans, one tilts. Start here; add linkages only if the character needs them.', EYES, [eyes], { volts: 5, amps: 2, source: 'bench' }, EYE_POSES, EYE_SCENARIOS),
        make('six-servo-face', 'Six-servo face', 'Eyes on a gimbal, upper and lower lids, a two-axis neck — the Phil / Zappo-II shape on a PCA9685 with its own 5 V rail.', [...EYES, ...LIDS, ...NECK('mg90s')], [eyes, lids, neck], { volts: 5, amps: 3, source: 'bench' }, { ...EYE_POSES, ...LID_POSES, NEUTRAL: { ...EYE_POSES.NEUTRAL, ...LID_POSES.EYES_OPEN, 'neck.yaw': 0, 'neck.pitch': 0 } }, { ...EYE_SCENARIOS, ...FACE_SCENARIOS }),
        make('skull', 'Talking skull', 'The six-servo face plus a jaw, with the neck and jaw on standard 55 g servos; TALK and SCARE included.', [...EYES, ...LIDS, ...NECK('mg996r'), JAW], [eyes, lids, neck, jaw], { volts: 6, amps: 5, source: 'bench' }, { ...EYE_POSES, ...LID_POSES, JAW_OPEN: { 'jaw.open': 30 }, JAW_HALF: { 'jaw.open': 15 }, JAW_CLOSED: { 'jaw.open': 0 }, NEUTRAL: { ...EYE_POSES.NEUTRAL, ...LID_POSES.EYES_OPEN, 'neck.yaw': 0, 'neck.pitch': 0, 'jaw.open': 0 } }, { ...EYE_SCENARIOS, ...FACE_SCENARIOS, ...SKULL_SCENARIOS }),
    ];
}
/** @description Find a template by id. */
function findTemplate(templates, id) {
    return typeof id === 'string' ? templates.find((t) => t.id === id) ?? null : null;
}
