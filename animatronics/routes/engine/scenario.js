"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the behaviour contract (the Glicksman shape):
 *                     |                             | a POSE names axis angles (LOOK_LEFT, EYES_CLOSED); a SCENE is
 *                     |                             | one move to a pose or to inline angles over a duration with an
 *                     |                             | easing; a SCENARIO is a timed script of steps — move, hold,
 *                     |                             | together (children run concurrently), run (another scenario),
 *                     |                             | repeat. Validation is fail-closed against the rig: unknown
 *                     |                             | axes, angles outside a channel's software limits, unknown
 *                     |                             | poses or scenarios, cycles, the depth and step caps are all
 *                     |                             | refused naming the step. Angles are mechanism degrees; the
 *                     |                             | compiler, not this file, turns them into pulses.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BEHAVIOUR_ID = exports.EASINGS = void 0;
exports.ease = ease;
exports.validatePose = validatePose;
exports.validatePoses = validatePoses;
exports.validateScenario = validateScenario;
exports.validateScenarios = validateScenarios;
exports.assertAcyclic = assertAcyclic;
exports.describeBehaviourContract = describeBehaviourContract;
const rig_contract_1 = require("./rig-contract");
/** @description Easing curves a move may use. */
exports.EASINGS = Object.freeze(['linear', 'in', 'out', 'in-out', 'snap']);
/** @description Pose ids are upper-case words: LOOK_LEFT, BLINK, IDLE_03. */
exports.BEHAVIOUR_ID = /^[A-Z][A-Z0-9_]{0,39}$/;
/**
 * @description Apply an easing to a normalised time.
 * @param ease - The curve.
 * @param u - 0…1.
 * @returns 0…1.
 */
function ease(ease, u) {
    const t = Math.min(1, Math.max(0, u));
    switch (ease) {
        case 'linear': return t;
        case 'in': return t * t * t;
        case 'out': return 1 - (1 - t) ** 3;
        case 'in-out': return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        case 'snap': return t > 0 ? 1 : 0;
        default: return t;
    }
}
function behaviourId(value, field) {
    if (typeof value !== 'string' || !exports.BEHAVIOUR_ID.test(value))
        throw new rig_contract_1.ContractError(`${field} must be an upper-case name like LOOK_LEFT`, field);
    return value;
}
/**
 * @description Validate a pose against the rig: every axis exists and every angle is within limits.
 * @param input - Untrusted pose.
 * @param rig - The rig.
 * @param field - Field prefix for refusals.
 * @returns The typed pose.
 */
function validatePose(input, rig, field = 'pose') {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new rig_contract_1.ContractError(`${field} must map axis keys to degrees`, field);
    const axes = (0, rig_contract_1.axisMap)(rig);
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        const ch = axes.get(key);
        if (!ch)
            throw new rig_contract_1.ContractError(`${field}.${key} is not an axis of this rig (${[...axes.keys()].join(', ') || 'none'})`, `${field}.${key}`);
        out[key] = (0, rig_contract_1.requireWithinLimits)(ch, Number(value), `${field}.${key}`);
    }
    if (!Object.keys(out).length)
        throw new rig_contract_1.ContractError(`${field} names no axes`, field);
    return out;
}
/** @description Validate the whole pose library. */
function validatePoses(input, rig) {
    if (input === undefined)
        return {};
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new rig_contract_1.ContractError('poses must be an object', 'poses');
    const entries = Object.entries(input);
    if (entries.length > rig_contract_1.LIMITS.poses)
        throw new rig_contract_1.ContractError(`poses is capped at ${rig_contract_1.LIMITS.poses}`, 'poses');
    const out = {};
    for (const [name, pose] of entries)
        out[behaviourId(name, `poses.${name}`)] = validatePose(pose, rig, `poses.${name}`);
    return out;
}
function ms(value, field) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > rig_contract_1.LIMITS.durationMs)
        throw new rig_contract_1.ContractError(`${field} must be 0…${rig_contract_1.LIMITS.durationMs} ms`, field);
    return Math.round(n);
}
function validateStep(input, rig, lib, field, depth, count) {
    if (depth > rig_contract_1.LIMITS.depth)
        throw new rig_contract_1.ContractError(`${field} nests deeper than ${rig_contract_1.LIMITS.depth}`, field);
    if ((count.n += 1) > rig_contract_1.LIMITS.steps)
        throw new rig_contract_1.ContractError(`a scenario is capped at ${rig_contract_1.LIMITS.steps} steps`, field);
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new rig_contract_1.ContractError(`${field} must be a step object`, field);
    const s = input;
    switch (s.kind) {
        case 'move': {
            for (const k of Object.keys(s))
                if (!['kind', 'pose', 'axes', 'ms', 'ease'].includes(k))
                    throw new rig_contract_1.ContractError(`${field}.${k} is not a move property`, `${field}.${k}`);
            const step = { kind: 'move', ms: ms(s.ms, `${field}.ms`), ease: s.ease === undefined ? 'in-out' : (exports.EASINGS.includes(s.ease) ? s.ease : (() => { throw new rig_contract_1.ContractError(`${field}.ease must be one of ${exports.EASINGS.join(', ')}`, `${field}.ease`); })()) };
            if (s.pose !== undefined) {
                const p = behaviourId(s.pose, `${field}.pose`);
                if (!lib.poses[p])
                    throw new rig_contract_1.ContractError(`${field}.pose ${p} is not in the pose library`, `${field}.pose`);
                step.pose = p;
            }
            if (s.axes !== undefined)
                step.axes = validatePose(s.axes, rig, `${field}.axes`);
            if (!step.pose && !step.axes)
                throw new rig_contract_1.ContractError(`${field} must name a pose or give axes`, field);
            return step;
        }
        case 'hold': return { kind: 'hold', ms: ms(s.ms, `${field}.ms`) };
        case 'run': {
            const name = behaviourId(s.scenario, `${field}.scenario`);
            if (!lib.scenarios[name])
                throw new rig_contract_1.ContractError(`${field}.scenario ${name} is not in the library`, `${field}.scenario`);
            return { kind: 'run', scenario: name };
        }
        case 'together':
        case 'repeat': {
            if (!Array.isArray(s.steps) || !s.steps.length)
                throw new rig_contract_1.ContractError(`${field}.steps must be a non-empty list`, `${field}.steps`);
            const steps = s.steps.map((c, i) => validateStep(c, rig, lib, `${field}.steps[${i}]`, depth + 1, count));
            if (s.kind === 'together')
                return { kind: 'together', steps };
            const times = Number(s.times);
            if (!Number.isInteger(times) || times < 1 || times > rig_contract_1.LIMITS.repeat)
                throw new rig_contract_1.ContractError(`${field}.times must be 1…${rig_contract_1.LIMITS.repeat}`, `${field}.times`);
            return { kind: 'repeat', times, steps };
        }
        default: throw new rig_contract_1.ContractError(`${field}.kind must be move, hold, together, run or repeat`, `${field}.kind`);
    }
}
/**
 * @description Validate one scenario's steps against the rig and the library it may reference.
 * @param input - Untrusted scenario ({steps, description}).
 * @param rig - The rig.
 * @param lib - Poses and the OTHER scenarios (a scenario may run any that exists).
 * @param field - Field prefix.
 * @returns The typed scenario.
 */
function validateScenario(input, rig, lib, field = 'scenario') {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new rig_contract_1.ContractError(`${field} must be an object with steps`, field);
    const s = input;
    for (const k of Object.keys(s))
        if (!['steps', 'description'].includes(k))
            throw new rig_contract_1.ContractError(`${field}.${k} is not a scenario property`, `${field}.${k}`);
    if (!Array.isArray(s.steps) || !s.steps.length)
        throw new rig_contract_1.ContractError(`${field}.steps must be a non-empty list`, `${field}.steps`);
    const count = { n: 0 };
    const out = { steps: s.steps.map((c, i) => validateStep(c, rig, lib, `${field}.steps[${i}]`, 1, count)) };
    if (s.description !== undefined)
        out.description = String(s.description).slice(0, 400);
    return out;
}
/** @description Validate the scenario library (each may reference the others) and refuse cycles. */
function validateScenarios(input, rig, poses) {
    if (input === undefined)
        return {};
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new rig_contract_1.ContractError('scenarios must be an object', 'scenarios');
    const raw = input;
    const names = Object.keys(raw);
    if (names.length > rig_contract_1.LIMITS.scenarios)
        throw new rig_contract_1.ContractError(`scenarios is capped at ${rig_contract_1.LIMITS.scenarios}`, 'scenarios');
    const placeholder = Object.fromEntries(names.map((n) => [behaviourId(n, `scenarios.${n}`), { steps: [] }]));
    const out = {};
    for (const name of names)
        out[name] = validateScenario(raw[name], rig, { poses, scenarios: placeholder }, `scenarios.${name}`);
    for (const name of names)
        assertAcyclic(name, out, [], `scenarios.${name}`);
    return out;
}
function referenced(steps) {
    const out = [];
    for (const s of steps) {
        if (s.kind === 'run')
            out.push(s.scenario);
        else if (s.kind === 'together' || s.kind === 'repeat')
            out.push(...referenced(s.steps));
    }
    return out;
}
/** @description Refuse a scenario that (transitively) runs itself. */
function assertAcyclic(name, lib, trail, field) {
    if (trail.includes(name))
        throw new rig_contract_1.ContractError(`${field} runs itself: ${[...trail, name].join(' → ')}`, field);
    const s = lib[name];
    if (!s)
        return;
    for (const r of referenced(s.steps))
        assertAcyclic(r, lib, [...trail, name], field);
}
/** @description The behaviour contract as published. */
function describeBehaviourContract() {
    return {
        poseId: exports.BEHAVIOUR_ID.source,
        easings: exports.EASINGS,
        steps: {
            move: '{kind:"move", pose?:POSE_ID, axes?:{axisKey:deg}, ms, ease?} — axes override the pose',
            hold: '{kind:"hold", ms}',
            together: '{kind:"together", steps:[…]} — children start at once; lasts as long as the longest',
            run: '{kind:"run", scenario:SCENARIO_ID}',
            repeat: '{kind:"repeat", times, steps:[…]}',
        },
        caps: { steps: rig_contract_1.LIMITS.steps, depth: rig_contract_1.LIMITS.depth, repeat: rig_contract_1.LIMITS.repeat, durationMs: rig_contract_1.LIMITS.durationMs },
    };
}
