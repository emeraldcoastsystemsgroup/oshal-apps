"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D5, lane @ds-app: the first project. `spider-18` is the
 *                     |                             | spider ADR-202 built, as a brief in the person's words and a
 *                     |                             | nine-phase chain bound BY NAME to the artifacts the engines hold
 *                     |                             | (embodied's spider-18 fit, Circuit Lab's hexapod-power example,
 *                     |                             | the hexapod node, the certified gait and its certificate, the
 *                     |                             | print set scripts/hexapod-prints.mjs writes). Names only: not
 *                     |                             | one of the design's numbers is copied here; the page and the
 *                     |                             | tools read every stage from the engines through the person's
 *                     |                             | session, and the body contract is built from those reads.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D9, lane @ds-plant: the second example, `lift-1`, the
 *                     |                             | first machine through the plant generated from a design: three
 *                     |                             | CAD Studio part programs (a base plate, a column, a carriage;
 *                     |                             | boxes with holes) the page creates with the person's session,
 *                     |                             | a mechanism (the carriage slides on the column, driven by
 *                     |                             | embodied's servo row through a stated rack ratio), a 2 kg
 *                     |                             | payload, and the brief's line "lifts 2 kg to 300 mm in 5 s".
 *                     |                             | The masses come from the kernel's reports and the drive's
 *                     |                             | numbers from the row when the plant is built, never from here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIFT_1_EXAMPLE = exports.LIFT_1_MECHANISM = exports.SPIDER_18_EXAMPLE = void 0;
exports.listExamples = listExamples;
exports.findExample = findExample;
/** The spider's fit in embodied, its power example in Circuit Lab, and the certified gait's files (embodied/docs/training/2026-10-30-spider-18-certified). */
const FIT = 'spider-18';
const POWER_EXAMPLE = 'hexapod-power';
const POLICY = 'hexapod-walk-ppo-shape-seed1.zip';
const CERTIFICATE = 'hexapod-walk-ppo-shape-seed1.certificate.json';
const REPORT = 'hexapod-walk-shape-seed1.json';
/** The spider's chain: all nine phases, the engine each binds to and why. */
const SPIDER_PHASES = [
    { kind: 'brief', engine: 'reasoned', why: 'the spider in words, from ADR-203' },
    { kind: 'design', engine: 'embodied', why: 'embodied designs the hexapod fit spider-18: the parts model, the mass budget, the joint loads' },
    { kind: 'mechanical', engine: 'embodied', why: 'the design sizes every servo from its worst stance' },
    { kind: 'electrical', engine: 'circuit-lab', why: 'the bus, the pack and the rails are solved on the circuit engine (the hexapod-power example)' },
    { kind: 'sensors', engine: 'embodied', why: 'the LiDAR, the IMU and the joint feedback are rows and parts of the design' },
    { kind: 'controller', engine: 'embodied', why: 'the hexapod node runs in the engine container and on the Pi' },
    { kind: 'simulate', engine: 'embodied', why: 'the MuJoCo plant, the baselines, the trained gait and the certification gate' },
    { kind: 'fabricate', engine: 'embodied', why: 'the print set: thirteen STL files through CAD Studio\'s engine, a print sheet, the BOM and a manifest' },
    { kind: 'build', engine: 'reasoned', why: 'the bench' },
];
/** The spider's bindings by name: the engines' artifact references, never a number. */
const SPIDER_BINDINGS = {
    design: { engine: 'embodied', kind: 'design-fit', machine: 'hexapod', fit: FIT },
    mechanical: { engine: 'embodied', kind: 'design-joints', machine: 'hexapod', fit: FIT },
    electrical: { engine: 'circuit-lab', kind: 'example', example: POWER_EXAMPLE },
    sensors: { engine: 'embodied', kind: 'design-senses', machine: 'hexapod', fit: FIT, senses: ['lidar', 'imu', 'joints'] },
    controller: { engine: 'embodied', kind: 'node', nodeKind: 'hexapod' },
    simulate: { engine: 'embodied', kind: 'gait', fit: FIT, jump: 'legs-hop', reportPrefix: 'hexapod-', report: REPORT, policy: POLICY, certificate: CERTIFICATE },
    fabricate: { engine: 'embodied', kind: 'print-set', fit: FIT, producer: 'scripts/hexapod-prints.mjs', manifest: 'manifest.json' },
    build: { engine: 'reasoned', kind: 'checklist' },
};
/** @description The spider-18 example (ADR-203 D5). */
exports.SPIDER_18_EXAMPLE = Object.freeze({
    id: FIT,
    name: 'spider-18',
    brief: {
        what: 'a six-legged walking robot that carries a Raspberry Pi, sees with one LiDAR, jumps, and walks on the other side of its legs when it lands upside down',
        requirements: ['holds a Raspberry Pi', 'has heat', 'one LiDAR eye', 'six legs', 'jumps', 'flips its legs when upside down'],
        // The mass target is the design's (GET /api/embodied/build/hexapod massBudget.targetG); the brief carries no copy of it.
        targets: {},
    },
    phases: SPIDER_PHASES,
    bindings: SPIDER_BINDINGS,
    note: 'Bound by name to what ADR-202 built. Every stage is read from the engines when the page opens; on a swarm without embodied or Circuit Lab those posters say the engine is absent.',
});
/** The lift's three printed parts as CAD Studio programs (mm): boxes with holes. The part ids are what the mechanism names. */
const LIFT_PARTS = [
    { id: 'base', name: 'Base plate', qty: 1, material: 'PETG', program: { base: { kind: 'box', sizeX: 200, sizeY: 200, sizeZ: 10 }, features: [85, -85].flatMap((x) => [85, -85].map((y) => ({ id: `foot-${x > 0 ? 'p' : 'n'}${y > 0 ? 'p' : 'n'}`, type: 'hole', params: { diameter: 5, axis: 'z', x, y }, label: 'a foot screw' }))) } },
    { id: 'column', name: 'Column', qty: 1, material: 'PETG', program: { base: { kind: 'box', sizeX: 40, sizeY: 40, sizeZ: 400 }, features: [{ id: 'cap-pin', type: 'hole', params: { diameter: 6, axis: 'y', x: 0, z: 390 }, label: 'the end-stop pin' }] } },
    { id: 'carriage', name: 'Carriage', qty: 1, material: 'PETG', program: { base: { kind: 'box', sizeX: 80, sizeY: 60, sizeZ: 40 }, features: [{ id: 'bore', type: 'box-cut', params: { size: [42, 42, 42], center: [0, 0, 20] }, label: 'rides the column' }, { id: 'set-screw', type: 'hole', params: { diameter: 5, axis: 'x', y: 25, z: 20 }, label: 'the rack clamp' }] } },
];
/** The servo row embodied publishes (GET /api/embodied/build/catalog) and the drive the design states: a 25 mm pinion on a rack, 40 rad of motor per metre of carriage. */
const LIFT_MOTOR_ROW = 'sts3215-12v';
const LIFT_RACK_RAD_PER_M = 40;
/** @description The lift's mechanism: the base is ground, the column is fixed on it, the carriage slides up the column driven by the servo row through the rack, the 2 kg payload rides the carriage. The task is read from the brief's line when the project is created. */
exports.LIFT_1_MECHANISM = Object.freeze({
    parts: LIFT_PARTS.map((p) => ({ id: p.id, name: p.name, modelId: null })),
    base: 'base',
    joints: [
        { id: 'column-mount', parent: 'base', child: 'column', type: 'fixed', axis: [0, 0, 1], rangeRad: null, rangeM: null, originMm: [0, 0, 10], drivenBy: null, gearRatio: null },
        { id: 'carriage-slide', parent: 'column', child: 'carriage', type: 'slide', axis: [0, 0, 1], rangeRad: null, rangeM: [0, 0.35], originMm: [0, 0, 0], drivenBy: LIFT_MOTOR_ROW, gearRatio: LIFT_RACK_RAD_PER_M },
    ],
    motors: [{ rowId: LIFT_MOTOR_ROW, source: 'embodied' }],
    payload: { massKg: 2, attachedTo: 'carriage', atMm: null },
    task: null,
});
/** The lift's chain: no sensors (nothing senses but the plant's own joint, IMU and payload readings) and no node of its own. */
const LIFT_PHASES = [
    { kind: 'brief', engine: 'reasoned', why: 'the lift in words' },
    { kind: 'design', engine: 'cad-studio', why: 'three printed parts as CAD Studio programs: the base plate, the column, the carriage' },
    { kind: 'mechanical', engine: 'reasoned', why: 'the drive is sized by the plant: the gate holds the servo row to its continuous rating' },
    { kind: 'electrical', engine: 'reasoned', why: 'one servo on its bus; no circuit is drafted for the lift yet' },
    { kind: 'simulate', engine: 'embodied', why: 'the plant built from the mechanism, the PD baseline, a trained reach policy and the gate' },
    { kind: 'fabricate', engine: 'scan-to-print', why: 'the three parts exported once through CAD Studio' },
    { kind: 'build', engine: 'reasoned', why: 'the bench' },
];
/** The lift's bindings by name: the three programs on Design, the generated plant on Simulate. */
const LIFT_BINDINGS = {
    design: { engine: 'cad-studio', kind: 'cad-programs', parts: LIFT_PARTS },
    simulate: { engine: 'embodied', kind: 'plant' },
};
/** @description The lift-1 example (ADR-203 D9): the first machine through the plant generated from a design. */
exports.LIFT_1_EXAMPLE = Object.freeze({
    id: 'lift-1',
    name: 'lift-1',
    brief: {
        what: 'a lifting machine: a motor-driven carriage on a column raises a load from a flat base',
        requirements: ['lifts 2 kg to 300 mm in 5 s', 'one motor drives the carriage up a column', 'stands on a flat base plate'],
        targets: {},
    },
    phases: LIFT_PHASES,
    bindings: LIFT_BINDINGS,
    mechanism: exports.LIFT_1_MECHANISM,
    note: 'The parts are created in CAD Studio with your session from the Design poster (Create the parts in CAD Studio); the plant is built from the mechanism, the kernel\'s reports and embodied\'s servo row from the Simulate poster (Build the plant).',
});
const EXAMPLES = Object.freeze([exports.SPIDER_18_EXAMPLE, exports.LIFT_1_EXAMPLE]);
/**
 * @description The examples a project can start from, for the capabilities answer and the tools.
 * @returns id, name and the brief's first line of each.
 */
function listExamples() {
    return EXAMPLES.map((e) => ({ id: e.id, name: e.name, what: e.brief.what, phases: e.phases.map((p) => p.kind) }));
}
/**
 * @description One example by id, or null.
 * @param id - The example id from a body.
 * @returns The example or null.
 */
function findExample(id) {
    return typeof id === 'string' ? EXAMPLES.find((e) => e.id === id) ?? null : null;
}
//# sourceMappingURL=examples.js.map