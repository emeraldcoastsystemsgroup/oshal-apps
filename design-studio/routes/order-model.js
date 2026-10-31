"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRESSABLE = exports.READ_TARGETS = exports.ORDER_ACTIONS = void 0;
exports.validateOrder = validateOrder;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D3 as built (0.4.0): the closed vocabulary of an engine order. The partner names an action and its input; nothing here carries a URL, so the page can only ever call the fixed engine routes it maps each action to, with the person's own session.
 */
const phase_model_1 = require("./phase-model");
/** @description What the partner may order. */
exports.ORDER_ACTIONS = ['open', 'read', 'cad-create', 'cad-edit', 'circuit-create', 'circuit-edit', 'press'];
/** @description The engine reads an order may name; each needs the id field beside it when one is listed. */
exports.READ_TARGETS = Object.freeze({
    'cad-contract': null, 'cad-models': null, 'cad-model': 'modelId',
    'circuit-contract': null, 'circuit-examples': null, 'circuit-drivers': null, 'circuit-designs': null, 'circuit-design': 'designId',
    'motor-catalog': null, 'physics-status': null, 'physics-reports': null, printers: null,
});
/** @description The poster buttons an order may press: every one measures or makes, none closes a phase, ticks the bench or sends to a printer. */
exports.PRESSABLE = Object.freeze(['Create the parts in CAD Studio', 'Build the plant', 'Run the baselines', 'Train the policy', 'Certify', 'Make the print set']);
const CAD_EDITS = ['add', 'update', 'remove'];
const CIRCUIT_EDITS = ['add_part', 'update_part', 'remove_part', 'connect', 'disconnect', 'run'];
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const NAME_CAP = 200;
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const refuse = (message, field) => { throw new phase_model_1.ModelError(message, 'bad_order', field); };
function idOf(v, field) { if (typeof v !== 'string' || !ID.test(v))
    refuse(`${field} is an id`, field); return v; }
function nameOf(v, field) { if (typeof v !== 'string' || !v.trim())
    refuse(`${field} is required`, field); return v.trim().slice(0, NAME_CAP); }
function readInput(i) {
    const what = String(i.what ?? '');
    if (!Object.prototype.hasOwnProperty.call(exports.READ_TARGETS, what))
        refuse(`what is one of ${Object.keys(exports.READ_TARGETS).join(', ')}`, 'input.what');
    const field = exports.READ_TARGETS[what];
    return field ? { what, [field]: idOf(i[field], `input.${field}`) } : { what };
}
function cadCreate(i) {
    if (!isObject(i.base))
        refuse('base is the part\'s base, as cad-contract states it', 'input.base');
    if (i.features !== undefined && !Array.isArray(i.features))
        refuse('features is a list', 'input.features');
    return { name: nameOf(i.name, 'input.name'), base: i.base, features: i.features ?? [] };
}
function cadEdit(i) {
    const op = String(i.op ?? '');
    if (!CAD_EDITS.includes(op))
        refuse(`op is one of ${CAD_EDITS.join(', ')}`, 'input.op');
    const out = { modelId: idOf(i.modelId, 'input.modelId'), op };
    if (op !== 'add')
        out.featureId = idOf(i.featureId, 'input.featureId');
    if (op !== 'remove') {
        if (!isObject(i.feature))
            refuse('feature is the feature, as cad-contract states it', 'input.feature');
        out.feature = i.feature;
    }
    return out;
}
function circuitCreate(i) {
    if (i.example !== undefined)
        return { example: idOf(i.example, 'input.example'), title: i.title === undefined ? undefined : nameOf(i.title, 'input.title') };
    if (!Array.isArray(i.parts) || !Array.isArray(i.wires))
        refuse('an example, or parts and wires as circuit-contract states them', 'input.parts');
    return { title: nameOf(i.title, 'input.title'), parts: i.parts, wires: i.wires };
}
function circuitEdit(i) {
    const op = String(i.op ?? '');
    if (!CIRCUIT_EDITS.includes(op))
        refuse(`op is one of ${CIRCUIT_EDITS.join(', ')}`, 'input.op');
    const out = { designId: idOf(i.designId, 'input.designId'), op };
    if (op === 'update_part' || op === 'remove_part')
        out.partId = idOf(i.partId, 'input.partId');
    if (op === 'disconnect')
        out.wireId = idOf(i.wireId, 'input.wireId');
    if (op === 'add_part' || op === 'update_part' || op === 'connect') {
        if (!isObject(i.body))
            refuse('body is the part or wire, as circuit-contract states it', 'input.body');
        out.body = i.body;
    }
    return out;
}
function pressInput(i) {
    const phase = String(i.phase ?? '');
    if (!phase_model_1.PHASE_KINDS.includes(phase))
        refuse(`phase is one of ${phase_model_1.PHASE_KINDS.join(', ')}`, 'input.phase');
    if (!exports.PRESSABLE.includes(String(i.button ?? '')))
        refuse(`button is one of ${exports.PRESSABLE.join(', ')}; closing a phase, the bench checklist and a printer stay the person's`, 'input.button');
    return { phase, button: i.button };
}
/**
 * @description Validate an order against the closed vocabulary.
 * @param body - The request body: {action, input}.
 * @returns The action and the input reduced to the fields the action reads.
 */
function validateOrder(body) {
    const b = isObject(body) ? body : {};
    const action = String(b.action ?? '');
    if (!exports.ORDER_ACTIONS.includes(action))
        refuse(`action is one of ${exports.ORDER_ACTIONS.join(', ')}`, 'action');
    const i = isObject(b.input) ? b.input : {};
    const input = { open: () => ({}), read: readInput, 'cad-create': cadCreate, 'cad-edit': cadEdit, 'circuit-create': circuitCreate, 'circuit-edit': circuitEdit, press: pressInput }[action](i);
    return { action, input };
}
//# sourceMappingURL=order-model.js.map