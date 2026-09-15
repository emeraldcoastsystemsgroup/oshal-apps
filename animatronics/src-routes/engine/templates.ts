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

import { maxDegPerSOf, usPerDegOf, type ServoRow } from './catalog';
import { validateRig, type RigSpec, type ServoChannel } from './rig-contract';
import { validatePoses, validateScenarios, type Pose, type Scenario } from './scenario';

/** @description A starter rig with its library. */
export interface RigTemplate { id: string; title: string; description: string; rig: RigSpec; poses: Record<string, Pose>; scenarios: Record<string, Scenario> }

type ChannelSpec = { id: string; channel: number; model: string; minDeg: number; maxDeg: number; neutralDeg?: number; reversed?: boolean };

function channel(rows: Map<string, ServoRow>, spec: ChannelSpec): ServoChannel {
  const row = rows.get(spec.model);
  if (!row) throw new Error(`template needs catalog row ${spec.model}`);
  return { id: spec.id, channel: spec.channel, model: spec.model, centerUs: Math.round((row.pulseMinUs + row.pulseMaxUs) / 2), usPerDeg: usPerDegOf(row), reversed: spec.reversed ?? false, neutralDeg: spec.neutralDeg ?? 0, minDeg: spec.minDeg, maxDeg: spec.maxDeg, minUs: row.pulseMinUs, maxUs: row.pulseMaxUs, maxDegPerS: maxDegPerSOf(row) };
}

const move = (pose: string, ms: number, ease: 'linear' | 'in' | 'out' | 'in-out' = 'in-out') => ({ kind: 'move' as const, pose, ms, ease });
const hold = (ms: number) => ({ kind: 'hold' as const, ms });

const EYES: ChannelSpec[] = [{ id: 'eye-pan', channel: 0, model: 'sg90', minDeg: -30, maxDeg: 30 }, { id: 'eye-tilt', channel: 1, model: 'sg90', minDeg: -25, maxDeg: 25 }];
const LIDS: ChannelSpec[] = [{ id: 'lid-upper', channel: 2, model: 'mg90s', minDeg: -10, maxDeg: 60 }, { id: 'lid-lower', channel: 3, model: 'mg90s', minDeg: -5, maxDeg: 40 }];
const NECK = (model: string): ChannelSpec[] => [{ id: 'neck-yaw', channel: 4, model, minDeg: -45, maxDeg: 45 }, { id: 'neck-pitch', channel: 5, model, minDeg: -25, maxDeg: 25 }];
const JAW: ChannelSpec = { id: 'jaw', channel: 6, model: 'mg996r', minDeg: 0, maxDeg: 35 };

const EYE_POSES = { NEUTRAL: { 'eyes.pan': 0, 'eyes.tilt': 0 }, LOOK_LEFT: { 'eyes.pan': -25 }, LOOK_RIGHT: { 'eyes.pan': 25 }, LOOK_UP: { 'eyes.tilt': 20 }, LOOK_DOWN: { 'eyes.tilt': -20 } };
const LID_POSES = { EYES_OPEN: { 'lids.upper': 0, 'lids.lower': 0 }, EYES_CLOSED: { 'lids.upper': 60, 'lids.lower': 40 }, EYES_WIDE: { 'lids.upper': -10, 'lids.lower': -5 } };
const EYE_SCENARIOS = {
  GLANCE_LEFT: { description: 'A quick look to the left and back', steps: [move('LOOK_LEFT', 250, 'out'), hold(600), move('NEUTRAL', 400)] },
  SCAN: { description: 'Sweep left, right, back to centre', steps: [move('LOOK_LEFT', 500), hold(400), move('LOOK_RIGHT', 900), hold(400), move('NEUTRAL', 500)] },
  IDLE_01: { description: 'Slow wandering gaze', steps: [{ kind: 'repeat' as const, times: 2, steps: [move('LOOK_LEFT', 700, 'out'), hold(900), move('LOOK_RIGHT', 900), hold(700), move('LOOK_UP', 500), hold(400), move('NEUTRAL', 600)] }] },
};
const FACE_SCENARIOS = {
  BLINK: { description: 'Close and open the lids — commanded linear, since a servo at full speed moves linearly (60° in 130 ms on a metal-gear micro servo)', steps: [move('EYES_CLOSED', 130, 'linear'), hold(40), move('EYES_OPEN', 150, 'linear')] },
  SURPRISED: { description: 'Wide eyes, head back, then relax', steps: [{ kind: 'together' as const, steps: [move('EYES_WIDE', 100, 'out'), { kind: 'move' as const, axes: { 'neck.pitch': 15 }, ms: 250, ease: 'out' as const }] }, hold(800), { kind: 'together' as const, steps: [move('EYES_OPEN', 400), { kind: 'move' as const, axes: { 'neck.pitch': 0 }, ms: 500, ease: 'in-out' as const }] }] },
  IDLE_02: { description: 'Wandering gaze with blinks and a head turn', steps: [move('LOOK_LEFT', 700, 'out'), { kind: 'run' as const, scenario: 'BLINK' }, hold(600), { kind: 'together' as const, steps: [move('LOOK_RIGHT', 600), { kind: 'move' as const, axes: { 'neck.yaw': 20 }, ms: 900, ease: 'in-out' as const }] }, hold(700), { kind: 'run' as const, scenario: 'BLINK' }, move('NEUTRAL', 800)] },
};
const SKULL_SCENARIOS = {
  TALK: { description: 'Jaw chatter for about a second (half-open swings a 55 g servo can follow)', steps: [{ kind: 'repeat' as const, times: 5, steps: [move('JAW_HALF', 130), move('JAW_CLOSED', 130)] }] },
  SCARE: { description: 'Wide eyes, jaw drops, head lunges, then resets', steps: [{ kind: 'together' as const, steps: [move('EYES_WIDE', 100, 'out'), move('JAW_OPEN', 240), { kind: 'move' as const, axes: { 'neck.pitch': -10 }, ms: 220, ease: 'out' as const }] }, hold(1200), { kind: 'together' as const, steps: [move('EYES_OPEN', 500), move('JAW_CLOSED', 400), { kind: 'move' as const, axes: { 'neck.pitch': 0 }, ms: 600, ease: 'in-out' as const }] }] },
};

/**
 * @description Build every template from the catalog, validated.
 * @param rows - Servo rows by id.
 * @returns The templates.
 */
export function buildTemplates(rows: Map<string, ServoRow>): RigTemplate[] {
  const make = (id: string, title: string, description: string, specs: ChannelSpec[], mechanisms: RigSpec['mechanisms'], supply: RigSpec['supply'], poses: Record<string, Pose>, scenarios: Record<string, unknown>): RigTemplate => {
    const rig = validateRig({ channels: specs.map((s) => channel(rows, s)), mechanisms, supply, controller: { board: 'pca9685', transport: 'web-serial', baud: 115200 } });
    const validPoses = validatePoses(poses, rig);
    return { id, title, description, rig, poses: validPoses, scenarios: validateScenarios(scenarios, rig, validPoses) };
  };
  const eyes = { id: 'eyes', kind: 'eye-gimbal', axes: { pan: 'eye-pan', tilt: 'eye-tilt' } };
  const lids = { id: 'lids', kind: 'eyelids', axes: { upper: 'lid-upper', lower: 'lid-lower' } };
  const neck = { id: 'neck', kind: 'neck', axes: { yaw: 'neck-yaw', pitch: 'neck-pitch' } };
  const jaw = { id: 'jaw', kind: 'jaw', axes: { open: 'jaw' } };
  return [
    make('two-axis-eyes', 'Two-axis eyes', 'The Adafruit-style eye gimbal: one servo pans, one tilts. Start here; add linkages only if the character needs them.', EYES, [eyes], { volts: 5, amps: 2, source: 'bench' }, EYE_POSES, EYE_SCENARIOS),
    make('six-servo-face', 'Six-servo face', 'Eyes on a gimbal, upper and lower lids, a two-axis neck — the Phil / Zappo-II shape on a PCA9685 with its own 5 V rail.', [...EYES, ...LIDS, ...NECK('mg90s')], [eyes, lids, neck], { volts: 5, amps: 3, source: 'bench' }, { ...EYE_POSES, ...LID_POSES, NEUTRAL: { ...EYE_POSES.NEUTRAL, ...LID_POSES.EYES_OPEN, 'neck.yaw': 0, 'neck.pitch': 0 } }, { ...EYE_SCENARIOS, ...FACE_SCENARIOS }),
    make('skull', 'Talking skull', 'The six-servo face plus a jaw, with the neck and jaw on standard 55 g servos; TALK and SCARE included.', [...EYES, ...LIDS, ...NECK('mg996r'), JAW], [eyes, lids, neck, jaw], { volts: 6, amps: 5, source: 'bench' },
      { ...EYE_POSES, ...LID_POSES, JAW_OPEN: { 'jaw.open': 30 }, JAW_HALF: { 'jaw.open': 15 }, JAW_CLOSED: { 'jaw.open': 0 }, NEUTRAL: { ...EYE_POSES.NEUTRAL, ...LID_POSES.EYES_OPEN, 'neck.yaw': 0, 'neck.pitch': 0, 'jaw.open': 0 } }, { ...EYE_SCENARIOS, ...FACE_SCENARIOS, ...SKULL_SCENARIOS }),
  ];
}

/** @description Find a template by id. */
export function findTemplate(templates: RigTemplate[], id: unknown): RigTemplate | null {
  return typeof id === 'string' ? templates.find((t) => t.id === id) ?? null : null;
}
