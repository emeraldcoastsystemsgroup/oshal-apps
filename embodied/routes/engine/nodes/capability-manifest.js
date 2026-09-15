"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the ADR-151 D1 capability manifest every
 *                     |                             | peripheral node enrols with (kind, model, safety class, what
 *                     |                             | it senses, what it acts, its envelope) and its fail-closed
 *                     |                             | validator: an unknown kind, an act outside the kind's closed
 *                     |                             | vocabulary, a safety class below the kind's floor, a kinetic
 *                     |                             | node without an e-stop, or a non-finite envelope number is
 *                     |                             | refused, never coerced. Also the rule for which acts need a
 *                     |                             | human confirm (ADR-151 D5).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-156 D6 fold-in: `prop` — an animatronic rig of calibrated
 *                     |                             | servos — becomes a first-class kind here, so one vocabulary
 *                     |                             | describes it instead of two. It senses its channels, its
 *                     |                             | controller's hello and its supply; it acts poses, scenarios,
 *                     |                             | look-at, jog, arm, disarm and e-stop; its floor is class 1
 *                     |                             | (a micro-servo eye mechanism is low-energy) and a rig whose
 *                     |                             | servos are strong enough to hurt declares class 2, where the
 *                     |                             | existing kinetic rule already demands an e-stop. `disarm`
 *                     |                             | joins the confirm-exempt set for the same reason `land` and
 *                     |                             | `abort` are in it: it is the act that REMOVES authority, and
 *                     |                             | an act that removes authority must never wait for a dialog.
 *                     |                             | The vocabulary only — whether a prop also enrols as a NODE on
 *                     |                             | the rail stays gated on the ADR-149 decision B20 records.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIRM_EXEMPT_ACTS = exports.KIND_VOCABULARY = void 0;
exports.validateManifest = validateManifest;
exports.actRequiresConfirm = actRequiresConfirm;
/** @description Per-kind closed vocabularies and the lowest safety class the kind may claim. */
exports.KIND_VOCABULARY = {
    drone: { senses: ['pose', 'battery', 'camera'], acts: ['takeoff', 'goto', 'hover', 'land', 'observe', 'abort'], minSafetyClass: 2 },
    camera: { senses: ['frame', 'state'], acts: ['capture', 'record', 'stop'], minSafetyClass: 0 },
    'mobile-manipulator': {
        senses: ['pose', 'joint-state', 'lift', 'gripper', 'wrench', 'tip-budget'],
        acts: ['drive-to', 'jog', 'stop', 'lift', 'move-to-pose', 'move-joints', 'grasp', 'release', 'abort', 'e-stop'],
        minSafetyClass: 2,
    },
    manipulator: { senses: ['joint-state', 'gripper', 'wrench'], acts: ['move-to-pose', 'move-joints', 'grasp', 'release', 'abort', 'e-stop'], minSafetyClass: 2 },
    'mobile-base': { senses: ['pose', 'lift', 'tip-budget'], acts: ['drive-to', 'jog', 'stop', 'lift', 'e-stop'], minSafetyClass: 2 },
    printer: { senses: ['state', 'progress'], acts: ['upload', 'start', 'cancel'], minSafetyClass: 1 },
    light: { senses: ['state'], acts: ['on', 'off', 'dim'], minSafetyClass: 1 },
    // ADR-156 D6. A prop speaks its rig, not its servos: `pose` and `scenario` are the named
    // behaviours, `look-at` a bearing, `jog` a single axis nudge. `arm`/`disarm` are the authority
    // rail, and the floor is 1 rather than 2 because an eye gimbal on micro servos cannot hurt
    // anyone — a rig with real torque declares 2 and the kinetic rule then demands its e-stop.
    prop: { senses: ['channel-state', 'controller-hello', 'supply'], acts: ['pose', 'scenario', 'look-at', 'jog', 'arm', 'disarm', 'e-stop'], minSafetyClass: 1 },
};
/** @description Acts that stop or shelter and therefore never wait for a confirm. */
exports.CONFIRM_EXEMPT_ACTS = new Set(['e-stop', 'abort', 'stop', 'land', 'hover', 'observe', 'capture', 'disarm']);
const NODE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** @description Collect the issues with a candidate's string-list field. */
function listIssues(field, value, allowed) {
    if (!Array.isArray(value))
        return [`${field} must be a list`];
    const issues = [];
    for (const v of value) {
        if (typeof v !== 'string')
            issues.push(`${field} entries must be strings`);
        else if (!allowed.includes(v))
            issues.push(`${field} entry "${v}" is outside the kind's vocabulary`);
    }
    if (new Set(value).size !== value.length)
        issues.push(`${field} repeats an entry`);
    return issues;
}
/**
 * @description Validate a candidate manifest. Fail-closed: any issue refuses the whole manifest.
 * @param input - Untrusted input.
 * @returns The typed manifest, or every issue found.
 */
function validateManifest(input) {
    const issues = [];
    if (!input || typeof input !== 'object')
        return { ok: false, issues: ['manifest must be an object'] };
    const m = input;
    if (typeof m.nodeId !== 'string' || !NODE_ID.test(m.nodeId))
        issues.push('nodeId must be a short lowercase identifier');
    const kind = typeof m.kind === 'string' && m.kind in exports.KIND_VOCABULARY ? m.kind : null;
    if (!kind)
        issues.push(`kind "${String(m.kind)}" is unknown`);
    if (typeof m.model !== 'string' || !m.model.trim())
        issues.push('model is required');
    const sc = m.safetyClass;
    if (!(sc === 0 || sc === 1 || sc === 2 || sc === 3))
        issues.push('safetyClass must be 0, 1, 2 or 3');
    if (kind) {
        const vocab = exports.KIND_VOCABULARY[kind];
        if (typeof sc === 'number' && sc < vocab.minSafetyClass)
            issues.push(`kind ${kind} is at least safety class ${vocab.minSafetyClass}`);
        issues.push(...listIssues('senses', m.senses, vocab.senses), ...listIssues('acts', m.acts, vocab.acts));
        if (typeof sc === 'number' && sc >= 2 && Array.isArray(m.acts) && !m.acts.includes('e-stop') && !m.acts.includes('abort')) {
            issues.push('a kinetic node must declare e-stop or abort');
        }
    }
    if (!m.envelope || typeof m.envelope !== 'object' || Array.isArray(m.envelope))
        issues.push('envelope must be an object of numbers');
    else
        for (const [k, v] of Object.entries(m.envelope))
            if (typeof v !== 'number' || !Number.isFinite(v))
                issues.push(`envelope.${k} must be a finite number`);
    if (issues.length)
        return { ok: false, issues };
    return {
        ok: true,
        manifest: { nodeId: m.nodeId, kind: kind, model: m.model.trim(), safetyClass: sc, senses: [...m.senses], acts: [...m.acts], envelope: { ...m.envelope } },
    };
}
/**
 * @description Does an act on this node need a human confirm before execution? Class 2 and 3
 * acts do, except the ones that stop or shelter; class 0 and 1 acts do not.
 * @param manifest - The node's manifest.
 * @param act - The act.
 * @returns True when a confirm is required.
 */
function actRequiresConfirm(manifest, act) {
    if (manifest.safetyClass < 2)
        return false;
    return !exports.CONFIRM_EXEMPT_ACTS.has(act);
}
//# sourceMappingURL=capability-manifest.js.map