"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D1, lane @ds-app: the process as data. The fixed phase
 *                     |                             | vocabulary (brief, design, mechanical, electrical, sensors,
 *                     |                             | controller, simulate, fabricate, build) in its one order, the
 *                     |                             | engines a phase may bind to, what each phase must produce and
 *                     |                             | what closes it (the phase brief the persona reads), the
 *                     |                             | proposal of a chain from a brief's requirement lines (the rules
 *                     |                             | are named per phase in the answer, so a person sees why a phase
 *                     |                             | is there), and the validation of a chain, a binding and a
 *                     |                             | closure. No number of any machine lives here.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D7, lane @ds-fab: the fabricate brief says what the print
 *                     |                             | set is now that this package makes it (every part exported once
 *                     |                             | through CAD Studio, a sheet from the parts' own fields, the BOM,
 *                     |                             | a sha256 manifest) and what closes the phase (a finished set at
 *                     |                             | the current design revision with no part unprintable).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelError = exports.PHASE_BRIEFS = exports.ENGINES = exports.PHASE_KINDS = void 0;
exports.proposePhases = proposePhases;
exports.orderPhases = orderPhases;
exports.validatePhases = validatePhases;
exports.validateBrief = validateBrief;
exports.validateArtifact = validateArtifact;
exports.validateClosure = validateClosure;
/** @description The phase vocabulary, in the one order a chain carries its subset. */
exports.PHASE_KINDS = ['brief', 'design', 'mechanical', 'electrical', 'sensors', 'controller', 'simulate', 'fabricate', 'build'];
/** @description The engines a phase may bind to: the package whose artifact it produces, or `reasoned` when no engine on the swarm solves it. */
exports.ENGINES = ['cad-studio', 'circuit-lab', 'embodied', 'scan-to-print', 'reasoned'];
const brief = (kind, title, produces, engines, defaultEngine, closes, stages, action) => Object.freeze({ kind, title, produces, engines, defaultEngine, closes, stages, action });
/** @description The phase briefs, one per kind: the ADR-203 table as data. */
exports.PHASE_BRIEFS = Object.freeze({
    brief: brief('brief', 'Brief', 'the product in words: what it is, what it must do (one requirement per line) and its targets (mass, size, cost, runtime)', ['reasoned'], 'reasoned', 'the person says the brief is right (Confirm the brief); a later edit of the brief re-opens it', ['drafted', 'agreed'], 'Confirm the brief'),
    design: brief('design', 'Design', 'the parts model: every printed part as a CAD Studio program, the bought rows, the mass budget, the joint loads', ['cad-studio', 'embodied', 'reasoned'], 'cad-studio', 'the budget closes, every load sits inside its rating, every printed part has a program (parts-complete)', ['concept', 'sized', 'parts-complete'], 'Open in CAD Studio'),
    mechanical: brief('mechanical', 'Mechanical spec', 'every actuator sized from its worst stance against the row it is built on', ['embodied', 'reasoned'], 'reasoned', 'every joint sits inside its continuous torque', ['unsized', 'over-torque', 'sized'], 'Open the design'),
    electrical: brief('electrical', 'Electrical and power spec', 'the bus, the pack, the regulators, solved as one transient on the circuit engine', ['circuit-lab', 'reasoned'], 'circuit-lab', 'the rails hold under stall and the runtime is stated by the solve', ['drafted', 'solved', 'holds'], 'Open in Circuit Lab'),
    sensors: brief('sensors', 'Sensors', 'each sense with where it is mounted, at what rate, and who reads it', ['embodied', 'reasoned'], 'reasoned', 'each sense has a mount, a rate and a reader', ['unspecified', 'specified'], 'Open the design'),
    controller: brief('controller', 'Controller', 'one program for the plant and the hardware, a node on the rail speaking the body contract', ['embodied', 'reasoned'], 'embodied', 'the node runs the contract on a body (a node of the kind is on the rail)', ['nothing-on-the-rail', 'engine-ready', 'on-the-rail'], 'Node status'),
    simulate: brief('simulate', 'Simulate and train', 'the plant, a deterministic baseline, a trained policy, and the certification gate', ['embodied', 'reasoned'], 'embodied', 'a certificate bound to the policy hash and the engine build', ['baseline', 'trained', 'certified'], 'Run the baselines'),
    fabricate: brief('fabricate', 'Fabricate', 'the print set: every printed part exported once through CAD Studio\'s kernel as a watertight STL, a print sheet from the parts\' own fields (count, material, orientation, layer height, supports, notes), the BOM from the bought rows, and a manifest with the sha256 of every file; a printer registered with the print service takes one file at a time', ['scan-to-print', 'cad-studio', 'embodied', 'reasoned'], 'scan-to-print', 'a finished print set exists for the current design revision, every file in it is watertight and no part is unprintable (the manifest says so); the closure records the manifest\'s sha256', ['unprintable', 'printable', 'fabricated'], 'Make the print set'),
    build: brief('build', 'Build and test', 'the physical assembly in order, bring-up on real actuators, the certified brain on the body', ['reasoned'], 'reasoned', 'only the bench closes it: a person ticks every step; no software closes this phase', ['not-started', 'in-progress', 'bench-complete'], 'Start the build'),
});
/** The rules a proposal reads the requirement lines with: a phase appears when one of its patterns matches a line. */
const RULES = Object.freeze({
    mechanical: /\b(servo|motor|joint|leg|legs|arm|wheel|gear|actuat|torque|lift|carr(?:y|ies)|load|hinge|spring|jump)/i,
    electrical: /\b(motor|servo|batter|pack|power|volt|pi|raspberry|arduino|led|circuit|electr|charg|solar|usb|regulator|sensor|lidar|camera|comput)/i,
    sensors: /\b(sensor|lidar|camera|eye|eyes|imu|see|sees|detect|measur|microphone|hear|touch|rang)/i,
    controller: /\b(control|software|program|brain|autonom|walk|drive|fly|flies|navigat|jump|flip|balanc|self|node)/i,
    simulate: /\b(walk|run|jump|fly|flies|drive|balanc|gait|flip|swim|legs|hover|train|polic)/i,
});
/** A thermal need has no engine on this shelf (ADR-203 Consequences); it is named in the proposal, not silently dropped. */
const THERMAL = /\b(heat|thermal|cool|cold|freez|refrigerat|temperature)/i;
/** @description The requirement lines that match a rule, as one `why` sentence. */
function matched(lines, rule) {
    return lines.filter((line) => rule.test(line));
}
/**
 * @description Propose the phase chain for a brief from its requirement lines: brief, design, fabricate and build are
 * every product's; mechanical, electrical, sensors, controller and simulate appear when a line asks for them, and each
 * says which lines did. A hanger ("holds a coat") gets four phases; a walking machine gets all nine.
 * @param b - The brief.
 * @returns The chain in vocabulary order with the engine per phase, and the needs no engine solves.
 */
function proposePhases(b) {
    const lines = (b.requirements || []).map((l) => String(l).trim()).filter(Boolean);
    const all = [b.what, ...lines].filter(Boolean);
    const phases = [];
    const add = (kind, why, engine) => { phases.push({ kind, engine: engine ?? exports.PHASE_BRIEFS[kind].defaultEngine, why }); };
    add('brief', 'every product starts as words');
    add('design', 'every product has parts');
    const hits = {};
    for (const kind of Object.keys(RULES))
        hits[kind] = matched(all, RULES[kind]);
    const moving = (hits.controller || []).length > 0 && (hits.simulate || []).length > 0;
    if (hits.mechanical?.length)
        add('mechanical', `moving parts or loads: ${hits.mechanical.join('; ')}`, 'reasoned');
    if (hits.electrical?.length)
        add('electrical', `powered: ${hits.electrical.join('; ')}`);
    if (hits.sensors?.length)
        add('sensors', `senses: ${hits.sensors.join('; ')}`, 'reasoned');
    if (hits.controller?.length)
        add('controller', `behaviour: ${hits.controller.join('; ')}`, 'embodied');
    if (moving)
        add('simulate', `it moves, so the plant decides: ${(hits.simulate || []).join('; ')}`, 'embodied');
    add('fabricate', 'every product is made');
    add('build', 'every product is assembled and tested on the bench');
    const unsolved = matched(lines, THERMAL).map((line) => `${line} - a thermal phase has no engine on this shelf (ADR-203); it stays a requirement the brief carries`);
    return { phases: orderPhases(phases), unsolved };
}
/**
 * @description The chain in vocabulary order, each kind at most once.
 * @param phases - Entries in any order.
 * @returns The same entries ordered by the vocabulary.
 */
function orderPhases(phases) {
    const seen = new Set();
    return exports.PHASE_KINDS.flatMap((kind) => {
        const entry = phases.find((p) => p.kind === kind);
        if (!entry || seen.has(kind))
            return [];
        seen.add(kind);
        return [entry];
    });
}
/** @description A refusal the routes answer with a status, a code and the field it names. */
class ModelError extends Error {
    code;
    field;
    status;
    constructor(message, code, field, status = 400) {
        super(message);
        this.code = code;
        this.field = field;
        this.status = status;
        this.name = 'ModelError';
    }
}
exports.ModelError = ModelError;
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const engineOf = (v) => typeof v === 'string' && exports.ENGINES.includes(v);
const kindOf = (v) => typeof v === 'string' && exports.PHASE_KINDS.includes(v);
const CAP = 2000;
/**
 * @description Validate a chain as a tool or the page sends it: an array of {kind, engine, ...} with every kind in the
 * vocabulary and every engine one the phase brief allows; it is returned in vocabulary order. Brief and build are never absent.
 * @param value - The body's `phases`.
 * @returns The validated chain.
 * @throws ModelError naming the field.
 */
function validatePhases(value) {
    if (!Array.isArray(value) || !value.length)
        throw new ModelError('phases must be a non-empty array of {kind, engine}', 'bad_phases', 'phases');
    const out = value.map((raw, i) => {
        if (!isRecord(raw) || !kindOf(raw.kind))
            throw new ModelError(`phases[${i}].kind must be one of ${exports.PHASE_KINDS.join(', ')}`, 'unknown_phase', `phases[${i}].kind`);
        const engine = raw.engine === undefined ? exports.PHASE_BRIEFS[raw.kind].defaultEngine : raw.engine;
        if (!engineOf(engine) || !exports.PHASE_BRIEFS[raw.kind].engines.includes(engine))
            throw new ModelError(`phases[${i}].engine must be one of ${exports.PHASE_BRIEFS[raw.kind].engines.join(', ')} for ${raw.kind}`, 'unknown_engine', `phases[${i}].engine`);
        const entry = { kind: raw.kind, engine };
        if (typeof raw.why === 'string' && raw.why.trim())
            entry.why = raw.why.trim().slice(0, CAP);
        if (raw.printerId !== undefined) {
            if (raw.kind !== 'fabricate' || typeof raw.printerId !== 'string')
                throw new ModelError('printerId is a string on the fabricate phase', 'bad_printer', `phases[${i}].printerId`);
            entry.printerId = raw.printerId.slice(0, 200);
        }
        return entry;
    });
    const ordered = orderPhases(out);
    if (ordered.length !== out.length)
        throw new ModelError('a phase kind appears twice', 'duplicate_phase', 'phases');
    if (!ordered.some((p) => p.kind === 'brief') || !ordered.some((p) => p.kind === 'build'))
        throw new ModelError('every chain starts with brief and ends with build', 'bad_phases', 'phases');
    return ordered;
}
/** The targets a brief may carry and how each is read. */
const TARGETS = [['massG', 'number'], ['sizeMm', 'string'], ['costUsd', 'number'], ['runtimeMin', 'number']];
/**
 * @description Validate a brief: `what` one line, `requirements` one per line (at most 60, each at most 300 characters), optional targets.
 * @param value - The body's `brief`.
 * @returns The validated brief.
 * @throws ModelError naming the field.
 */
function validateBrief(value) {
    if (!isRecord(value))
        throw new ModelError('brief must be an object {what, requirements, targets}', 'bad_brief', 'brief');
    const what = typeof value.what === 'string' ? value.what.trim().replace(/\s+/g, ' ').slice(0, 300) : '';
    if (!what)
        throw new ModelError('brief.what is one line saying what the product is', 'bad_brief', 'brief.what');
    const raw = Array.isArray(value.requirements) ? value.requirements : typeof value.requirements === 'string' ? value.requirements.split(/\r?\n/) : [];
    const requirements = raw.map((l) => String(l).trim().slice(0, 300)).filter(Boolean).slice(0, 60);
    const targets = {};
    const t = isRecord(value.targets) ? value.targets : {};
    for (const [key, type] of TARGETS) {
        const v = t[key];
        if (v === undefined || v === null || v === '')
            continue;
        if (type === 'number') {
            const n = Number(v);
            if (!Number.isFinite(n) || n <= 0)
                throw new ModelError(`brief.targets.${key} must be a positive number`, 'bad_brief', `brief.targets.${key}`);
            targets[key] = n;
        }
        else
            targets[key] = String(v).trim().slice(0, 120);
    }
    return { what, requirements, targets };
}
/**
 * @description Validate an artifact to bind: an engine from the vocabulary that the phase allows, a `kind` word, and at most 64 KB of reference.
 * @param kind - The phase being bound.
 * @param value - The body's `artifact`.
 * @returns The validated artifact.
 * @throws ModelError naming the field.
 */
function validateArtifact(kind, value) {
    if (!isRecord(value))
        throw new ModelError('artifact must be an object {engine, kind, ...reference}', 'bad_artifact', 'artifact');
    if (!engineOf(value.engine) || !exports.PHASE_BRIEFS[kind].engines.includes(value.engine))
        throw new ModelError(`artifact.engine must be one of ${exports.PHASE_BRIEFS[kind].engines.join(', ')} for ${kind}`, 'unknown_engine', 'artifact.engine');
    if (typeof value.kind !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(value.kind))
        throw new ModelError('artifact.kind is a short lowercase word naming the artifact kind (design-fit, certificate, circuit-design, cad-models, node, print-set, ...)', 'bad_artifact', 'artifact.kind');
    if (value.read !== undefined && !isRecord(value.read))
        throw new ModelError('artifact.read is the engine reply excerpt as an object', 'bad_artifact', 'artifact.read');
    const text = JSON.stringify(value);
    if (text.length > 64 * 1024)
        throw new ModelError('artifact is larger than 64 KB; bind a reference and the excerpt the contract needs, never a whole report', 'bad_artifact', 'artifact');
    return JSON.parse(text);
}
/**
 * @description Validate a closure (D2): refused as `missing_evidence` without BOTH an evidence line and the artifact revision it was
 * read from; the build phase also needs the checklist step it ticks (D8).
 * @param kind - The phase being closed.
 * @param body - The request body.
 * @returns The validated closure.
 * @throws ModelError `missing_evidence` (422) or naming the field.
 */
function validateClosure(kind, body) {
    const evidence = typeof body.evidence === 'string' ? body.evidence.trim().replace(/\s+/g, ' ').slice(0, CAP) : '';
    const revision = body.revision === undefined || body.revision === null ? '' : String(body.revision).trim().slice(0, 200);
    if (!evidence || !revision)
        throw new ModelError('a closure needs the engine\'s evidence line AND the artifact revision it was read from', 'missing_evidence', !evidence ? 'evidence' : 'revision', 422);
    const step = typeof body.step === 'string' && body.step.trim() ? body.step.trim().slice(0, 120) : null;
    if (kind === 'build' && !step)
        throw new ModelError('the build phase closes one checklist step at a time: name the step', 'missing_step', 'step', 422);
    const by = typeof body.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 80) : 'person';
    return { evidence, revision, step, by };
}
//# sourceMappingURL=phase-model.js.map