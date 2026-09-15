"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The relay chain as a formation: a spec (transport, corridor,
 *                     |                             | margins, spacing factor, fleet, the tip's data rate, speeds,
 *                     |                             | endurance, timers, the gap policy) validated field by field;
 *                     |                             | a plan that sizes the hop from the link budget, counts the
 *                     |                             | relays and spares, places the slots on the corridor, checks
 *                     |                             | the shared-channel throughput and reports why a plan is
 *                     |                             | infeasible; the ELASTIC rule that gives k connected relays
 *                     |                             | their targets (evenly spread to the tip, or to a gap's
 *                     |                             | midpoint); the tip's allowed reach for k relays under each
 *                     |                             | gap policy; and the move guard that never lets a commanded
 *                     |                             | move break a link that is currently good.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The endurance warning states the real limit: the relays a
 *                     |                             | chain needs in ROTATION (`sustainFleet` — each slot consumes a
 *                     |                             | drone cycle of endurance + turnaround per stretch on station,
 *                     |                             | summed over the slots). Below it, relays leave on battery
 *                     |                             | before a spare can take over — what the simulation's forced
 *                     |                             | returns show. The old text ("before its swap must be
 *                     |                             | airborne") described something the number did not measure.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Postures, a control plane and a courier. A relay may PERCH at
 *                     |                             | its slot (motors off; flight controller, companion and radio
 *                     |                             | awake at a fraction of hover draw): its time on station is
 *                     |                             | the flight budget left at the slot divided by that fraction,
 *                     |                             | the rotation shrinks to about one relay per slot, and the
 *                     |                             | plan states the antenna height every perch needs (60 % of
 *                     |                             | the first Fresnel zone at the hop) or the exponent to plan
 *                     |                             | on instead. An optional CONTROL CHANNEL — any catalog radio
 *                     |                             | but the chain's — carries heartbeats and the RTL word direct
 *                     |                             | from the base: the plan states its direct reach and the air
 *                     |                             | time the heartbeat cadence costs (duty, and first-try
 *                     |                             | delivery when nobody schedules the heartbeats). A COURIER
 *                     |                             | lands at the tip to carry bulk data home: load time, trip
 *                     |                             | time, bytes per hour and the equivalent rate, against the
 *                     |                             | chain's own. The rotation cycle is written in its general
 *                     |                             | form (flight out and home + station + reserve + turnaround),
 *                     |                             | which for hover is exactly what it was.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | GROUND NODES (backlog B7): a relay that never flew — an ESP32
 *                     |                             | on a battery with a short mast, placed by hand or dropped
 *                     |                             | along the corridor — is a slot the chain keeps for days at
 *                     |                             | no cost to the fleet. A spec takes `groundNodes` as arc
 *                     |                             | lengths; they cut the corridor into segments and the MOBILE
 *                     |                             | relays are spread over what is left, each segment taking the
 *                     |                             | relays that keep the worst hop shortest. The plan counts and
 *                     |                             | rotates only the mobile relays (a ground node has no battery
 *                     |                             | to swap), and the elastic rule generalises to a distribution
 *                     |                             | AROUND the fixed anchors — which, with no ground node, gives
 *                     |                             | back the even spread it always did, position for position.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | TREES (backlog B5): a spec with `branches` is a trunk to a
 *                     |                             | fork and two to four branches to their work points. The
 *                     |                             | trunk is sized to put a relay AT the fork (the junction every
 *                     |                             | branch hangs off), each branch is sized on its own from
 *                     |                             | there, and every tip's frames cross the trunk: the shared
 *                     |                             | channel is divided by the sum of every tip's hops. The plan
 *                     |                             | carries a `tree` block (the fork, each branch's hops and
 *                     |                             | tip); slots on a branch name it. Ground nodes, an
 *                     |                             | out-of-band control channel and a courier stay chain-only
 *                     |                             | and are refused on a tree naming the field. A spec without
 *                     |                             | branches plans exactly as before, byte for byte.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | LATTICES (backlog B9): a spec with `area` (a polygon) is tiled
 *                     |                             | with slots on a square grid at the design hop, joined to the
 *                     |                             | base by feeder slots where the grid does not reach it (engine
 *                     |                             | /lattice). Every slot is a relay, the rotation is counted over
 *                     |                             | all of them at their lattice distance, and the shared channel
 *                     |                             | is divided by the deepest route plus the tip's own hop. The
 *                     |                             | plan carries a `lattice` block and each slot its grid `cell`.
 *                     |                             | A path, branches, ground nodes, a control channel and a
 *                     |                             | courier are refused beside an area naming the field.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PATH = exports.SPEC_LIMITS = exports.GROUND_NODE_LIMITS = exports.HEARTBEAT_BYTES = exports.POSTURES = void 0;
exports.validateSpec = validateSpec;
exports.planChain = planChain;
exports.stationTimeS = stationTimeS;
exports.rotationFleet = rotationFleet;
exports.allowedTipS = allowedTipS;
exports.spread = spread;
exports.elasticTargetsAround = elasticTargetsAround;
exports.spreadAround = spreadAround;
exports.elasticTargets = elasticTargets;
exports.guardMove = guardMove;
exports.hopMarginDb = hopMarginDb;
exports.controlChannelIds = controlChannelIds;
const lattice_1 = require("./lattice");
const path_1 = require("./path");
const spec_error_1 = require("./spec-error");
const transports_1 = require("./transports");
/** @description The postures a relay may hold a slot in. */
exports.POSTURES = ['hover', 'perch'];
/** @description A packed heartbeat on a control channel (id, position, battery, the link it hears), bytes. */
exports.HEARTBEAT_BYTES = 64;
/** @description Speed of light, m/s (the Fresnel clearance needs the wavelength). */
const C = 299_792_458;
/** @description What the validator enforces on ground-node placements. */
exports.GROUND_NODE_LIMITS = {
    /** One chain cannot be pinned by more static slots than a radio has peers to spare. */
    maxCount: 16,
    /** Two ground nodes closer than this are one node: the segment between them carries nothing. */
    minSeparationM: 1,
};
/** @description The ranges the validator enforces (also published by /capabilities). */
exports.SPEC_LIMITS = {
    requiredMarginDb: { min: 0, max: 30, default: 10 },
    degradedMarginDb: { min: 0, max: 30, default: 5 },
    spacingFactor: { min: 0.2, max: 1, default: 0.6 },
    fleetSize: { min: 0, max: 64, default: 6 },
    tipDataKbps: { min: 0, max: 100_000, default: 20 },
    pathLossExponent: { min: 1.8, max: 4, default: transports_1.DEFAULT_PATH_LOSS_EXPONENT },
    cruiseMps: { min: 0.5, max: 30, default: 6 },
    recoverMps: { min: 0.2, max: 30, default: 3 },
    enduranceS: { min: 60, max: 7200, default: 480 },
    reserveS: { min: 0, max: 3600, default: 90 },
    staleS: { min: 1, max: 120, default: 6 },
    detectS: { min: 1, max: 120, default: 4 },
    rtlAfterS: { min: 5, max: 3600, default: 60 },
    turnaroundS: { min: 0, max: 7200, default: 240 },
    altitudeM: { min: 2, max: 120 },
    /** 0.03: a flight controller, a companion and a radio awake against a mini drone's hover draw. */
    perchDrawFraction: { min: 0.005, max: 0.5, default: 0.03 },
    /** 2 s: the core drone node's own heartbeat cadence. */
    heartbeatS: { min: 0.5, max: 60, default: 2 },
    courierMB: { min: 0, max: 100_000, default: 0 },
};
/** @description The default corridor when none is given: a straight line 1 km east. */
exports.DEFAULT_PATH = [{ x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }];
function readAltitudes(raw) {
    const a = raw && typeof raw === 'object' ? raw : {};
    const { min, max } = exports.SPEC_LIMITS.altitudeM;
    const relayM = (0, spec_error_1.numberIn)(a.relayM, 'altitudes.relayM', min, max, 40);
    const tipM = (0, spec_error_1.numberIn)(a.tipM, 'altitudes.tipM', min, max, 30);
    const returnM = (0, spec_error_1.numberIn)(a.returnM, 'altitudes.returnM', min, max, 50);
    if (Math.abs(relayM - returnM) < 10)
        throw new spec_error_1.SpecError('altitudes.returnM', 'the return band must sit at least 10 m from the relay band (fleet separation rule)');
    return { relayM, tipM, returnM };
}
/** Ground nodes are slot positions: arc lengths strictly inside the corridor, sorted, none on top of another. */
function readGroundNodes(raw, corridorM) {
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw))
        throw new spec_error_1.SpecError('groundNodes', 'groundNodes must be a list of arc lengths along the corridor, in metres');
    if (raw.length > exports.GROUND_NODE_LIMITS.maxCount)
        throw new spec_error_1.SpecError('groundNodes', `at most ${exports.GROUND_NODE_LIMITS.maxCount} ground nodes`);
    const sorted = raw
        .map((v, i) => {
        if (v === undefined || v === null)
            throw new spec_error_1.SpecError(`groundNodes[${i}]`, `groundNodes[${i}] must be a number`);
        const s = (0, spec_error_1.numberIn)(v, `groundNodes[${i}]`, 0, corridorM, 0);
        if (s <= 0 || s >= corridorM)
            throw new spec_error_1.SpecError(`groundNodes[${i}]`, `a ground node sits strictly inside the corridor (0 < s < ${round1(corridorM)} m): the base and the work point are not relay slots`);
        return s;
    })
        .sort((a, b) => a - b);
    sorted.forEach((s, i) => {
        if (i > 0 && s - sorted[i - 1] < exports.GROUND_NODE_LIMITS.minSeparationM)
            throw new spec_error_1.SpecError(`groundNodes[${i}]`, `two ground nodes ${round1(s - sorted[i - 1])} m apart are one node: keep them at least ${exports.GROUND_NODE_LIMITS.minSeparationM} m apart`);
    });
    return sorted;
}
function readPosture(raw) {
    const posture = raw ?? 'hover';
    if (posture !== 'hover' && posture !== 'perch')
        throw new spec_error_1.SpecError('posture', 'posture must be hover or perch');
    return posture;
}
/** The two optional radios beside the chain's: the control channel (must differ from the chain's) and the courier's. */
function readRadios(m, transport) {
    const controlRaw = m.controlChannel ?? 'in-band';
    const control = controlRaw === 'in-band' ? null : (0, transports_1.findTransport)(controlRaw);
    if (controlRaw !== 'in-band' && !control)
        throw new spec_error_1.SpecError('controlChannel', `controlChannel "${String(controlRaw)}" is neither in-band nor a catalog transport`);
    if (control && control.id === transport.id)
        throw new spec_error_1.SpecError('controlChannel', 'the control channel must be a different radio from the chain\'s: its point is to survive the chain');
    const courier = m.courierTransport === undefined ? transport : (0, transports_1.findTransport)(m.courierTransport);
    if (!courier)
        throw new spec_error_1.SpecError('courierTransport', `courierTransport "${String(m.courierTransport)}" is not in the catalog`);
    return { controlChannel: control ? control.id : 'in-band', courierTransport: courier.id };
}
/**
 * @description Validate a chain spec from untrusted input; every field is checked and named.
 * @param input - Candidate spec.
 * @returns The typed spec.
 */
function validateSpec(input) {
    const m = input && typeof input === 'object' ? input : {};
    const title = String(m.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Relay chain';
    const transport = (0, transports_1.findTransport)(m.transport ?? 'esp-now');
    if (!transport)
        throw new spec_error_1.SpecError('transport', `transport "${String(m.transport)}" is not in the catalog`);
    const L = exports.SPEC_LIMITS;
    const gapPolicy = m.gapPolicy ?? 'retreat';
    if (gapPolicy !== 'retreat' && gapPolicy !== 'hold-degraded')
        throw new spec_error_1.SpecError('gapPolicy', 'gapPolicy must be retreat or hold-degraded');
    const requiredMarginDb = (0, spec_error_1.numberIn)(m.requiredMarginDb, 'requiredMarginDb', L.requiredMarginDb.min, L.requiredMarginDb.max, L.requiredMarginDb.default);
    const degradedMarginDb = (0, spec_error_1.numberIn)(m.degradedMarginDb, 'degradedMarginDb', L.degradedMarginDb.min, L.degradedMarginDb.max, Math.min(L.degradedMarginDb.default, requiredMarginDb));
    if (degradedMarginDb > requiredMarginDb)
        throw new spec_error_1.SpecError('degradedMarginDb', 'degradedMarginDb cannot exceed requiredMarginDb');
    const spec = {
        title,
        transport: transport.id,
        path: m.path === undefined ? exports.DEFAULT_PATH.map((p) => ({ ...p })) : (0, path_1.validatePath)(m.path),
        requiredMarginDb,
        degradedMarginDb,
        spacingFactor: (0, spec_error_1.numberIn)(m.spacingFactor, 'spacingFactor', L.spacingFactor.min, L.spacingFactor.max, L.spacingFactor.default),
        fleetSize: Math.round((0, spec_error_1.numberIn)(m.fleetSize, 'fleetSize', L.fleetSize.min, L.fleetSize.max, L.fleetSize.default)),
        tipDataKbps: (0, spec_error_1.numberIn)(m.tipDataKbps, 'tipDataKbps', L.tipDataKbps.min, L.tipDataKbps.max, L.tipDataKbps.default),
        pathLossExponent: (0, spec_error_1.numberIn)(m.pathLossExponent, 'pathLossExponent', L.pathLossExponent.min, L.pathLossExponent.max, L.pathLossExponent.default),
        cruiseMps: (0, spec_error_1.numberIn)(m.cruiseMps, 'cruiseMps', L.cruiseMps.min, L.cruiseMps.max, L.cruiseMps.default),
        recoverMps: (0, spec_error_1.numberIn)(m.recoverMps, 'recoverMps', L.recoverMps.min, L.recoverMps.max, L.recoverMps.default),
        enduranceS: (0, spec_error_1.numberIn)(m.enduranceS, 'enduranceS', L.enduranceS.min, L.enduranceS.max, L.enduranceS.default),
        reserveS: (0, spec_error_1.numberIn)(m.reserveS, 'reserveS', L.reserveS.min, L.reserveS.max, L.reserveS.default),
        staleS: (0, spec_error_1.numberIn)(m.staleS, 'staleS', L.staleS.min, L.staleS.max, L.staleS.default),
        detectS: (0, spec_error_1.numberIn)(m.detectS, 'detectS', L.detectS.min, L.detectS.max, L.detectS.default),
        rtlAfterS: (0, spec_error_1.numberIn)(m.rtlAfterS, 'rtlAfterS', L.rtlAfterS.min, L.rtlAfterS.max, L.rtlAfterS.default),
        turnaroundS: (0, spec_error_1.numberIn)(m.turnaroundS, 'turnaroundS', L.turnaroundS.min, L.turnaroundS.max, L.turnaroundS.default),
        gapPolicy,
        altitudes: readAltitudes(m.altitudes),
        posture: readPosture(m.posture),
        perchDrawFraction: (0, spec_error_1.numberIn)(m.perchDrawFraction, 'perchDrawFraction', L.perchDrawFraction.min, L.perchDrawFraction.max, L.perchDrawFraction.default),
        heartbeatS: (0, spec_error_1.numberIn)(m.heartbeatS, 'heartbeatS', L.heartbeatS.min, L.heartbeatS.max, L.heartbeatS.default),
        courierMB: (0, spec_error_1.numberIn)(m.courierMB, 'courierMB', L.courierMB.min, L.courierMB.max, L.courierMB.default),
        ...readRadios(m, transport),
        groundNodes: [],
    };
    spec.groundNodes = readGroundNodes(m.groundNodes, (0, path_1.pathLength)(spec.path));
    const branches = (0, path_1.validateBranches)(m.branches, spec.path);
    if (branches.length)
        spec.branches = treeOnly(spec, branches);
    if (m.area !== undefined && m.area !== null)
        spec.area = latticeOnly(spec, m, (0, lattice_1.validateArea)(m.area));
    if (spec.reserveS >= spec.enduranceS)
        throw new spec_error_1.SpecError('reserveS', 'reserveS must be less than enduranceS');
    if (spec.detectS >= spec.rtlAfterS)
        throw new spec_error_1.SpecError('rtlAfterS', 'rtlAfterS must be longer than detectS');
    return spec;
}
/**
 * The features a tree does not carry yet, refused naming their field: a ground node pins a slot of a
 * single corridor, the control plane and the courier are sized for one tip.
 */
function treeOnly(spec, branches) {
    if (spec.groundNodes.length)
        throw new spec_error_1.SpecError('groundNodes', 'ground nodes pin slots on a single corridor; size a tree without them');
    if (spec.controlChannel !== 'in-band')
        throw new spec_error_1.SpecError('controlChannel', 'a tree runs its heartbeats in band: the control plane is sized for a single chain');
    if (spec.courierMB > 0)
        throw new spec_error_1.SpecError('courierMB', 'a courier serves one tip; a tree has one per branch');
    return branches;
}
/** A lattice is its own shape: a corridor, branches and the chain-only features are refused beside an area. */
function latticeOnly(spec, m, area) {
    if (m.path !== undefined)
        throw new spec_error_1.SpecError('path', 'give an area or a path, not both: the lattice joins itself to the base');
    if (spec.branches)
        throw new spec_error_1.SpecError('branches', 'give an area or branches, not both');
    if (spec.groundNodes.length)
        throw new spec_error_1.SpecError('groundNodes', 'ground nodes pin slots on a single corridor; tile an area without them');
    if (spec.controlChannel !== 'in-band')
        throw new spec_error_1.SpecError('controlChannel', 'a lattice runs its heartbeats in band: the control plane is sized for a single chain');
    if (spec.courierMB > 0)
        throw new spec_error_1.SpecError('courierMB', 'a courier is sized on a corridor to the tip; an area has none');
    (0, lattice_1.latticeGeometry)(area, spec.spacingFactor * (0, transports_1.rangeAtMarginM)((0, transports_1.findTransport)(spec.transport), spec.requiredMarginDb, spec.pathLossExponent));
    return area;
}
/**
 * The corridor's arc lengths in chain order: the base, every ground node, the work point. A
 * ground node pins a slot, so the stretch between two anchors is sized on its own.
 */
function anchorsOf(spec, pathLengthM) {
    return [0, ...spec.groundNodes.filter((s) => s > 0 && s < pathLengthM), pathLengthM];
}
/** Hop from the budget, relays from the corridor; mobile slots fill the stretches the ground nodes leave. */
function geometry(spec) {
    if (spec.branches && spec.branches.length)
        return treeGeometry(spec, spec.branches);
    if (spec.area)
        return latticePlanGeometry(spec, spec.area);
    const transport = (0, transports_1.findTransport)(spec.transport);
    const n = spec.pathLossExponent;
    const designRangeM = (0, transports_1.rangeAtMarginM)(transport, spec.requiredMarginDb, n);
    const hopM = spec.spacingFactor * designRangeM;
    const pathLengthM = (0, path_1.pathLength)(spec.path);
    const anchors = anchorsOf(spec, pathLengthM);
    const slots = [];
    let hops = 0;
    let actualHop = 0;
    for (let a = 1; a < anchors.length; a += 1) {
        const from = anchors[a - 1];
        const span = anchors[a] - from;
        const segHops = Math.max(1, Math.ceil(span / hopM));
        const segHop = span / segHops;
        for (let i = 1; i < segHops; i += 1)
            slots.push(relaySlot(spec, slots.length + 1, from + segHop * i));
        if (a < anchors.length - 1)
            slots.push({ ...relaySlot(spec, slots.length + 1, anchors[a]), ground: true });
        hops += segHops;
        actualHop = Math.max(actualHop, segHop);
    }
    const mobileSlots = slots.filter((s) => !s.ground);
    const tip = { index: hops, s: pathLengthM, pt: withAltitude((0, path_1.pointAt)(spec.path, pathLengthM), spec.altitudes.tipM) };
    return { transport, hardRangeM: (0, transports_1.rangeAtMarginM)(transport, 0, n), designRangeM, degradedRangeM: (0, transports_1.rangeAtMarginM)(transport, spec.degradedMarginDb, n), pathLengthM, hops, relaysNeeded: mobileSlots.length, sparesAvailable: spec.fleetSize - mobileSlots.length, actualHop, slots, mobileSlots, tip, hopFrames: hops, longestLaneHops: hops };
}
/**
 * A tree: the trunk sized so its last relay sits AT the fork (the junction every branch hangs off),
 * each branch sized on its own from the fork to its work point. Every tip's frames cross the trunk,
 * so the shared channel carries the sum of every tip's hops.
 */
function treeGeometry(spec, branches) {
    const transport = (0, transports_1.findTransport)(spec.transport);
    const n = spec.pathLossExponent;
    const designRangeM = (0, transports_1.rangeAtMarginM)(transport, spec.requiredMarginDb, n);
    const hopM = spec.spacingFactor * designRangeM;
    const forkS = (0, path_1.pathLength)(spec.path);
    const trunkHops = Math.max(1, Math.ceil(forkS / hopM));
    const slots = [];
    for (let j = 1; j <= trunkHops; j += 1)
        slots.push(relaySlot(spec, slots.length + 1, (forkS * j) / trunkHops));
    let actualHop = forkS / trunkHops;
    const tree = { forkS: round1(forkS), trunkHops, branches: [] };
    let farthestTipS = 0;
    branches.forEach((pts, b) => {
        const lane = [...spec.path, ...pts];
        const lengthM = (0, path_1.pathLength)(lane) - forkS;
        const hops = Math.max(1, Math.ceil(lengthM / hopM));
        for (let j = 1; j < hops; j += 1)
            slots.push({ ...laneSlot(lane, spec.altitudes.relayM, slots.length + 1, forkS + (lengthM * j) / hops), branch: b + 1 });
        actualHop = Math.max(actualHop, lengthM / hops);
        const tipS = forkS + lengthM;
        farthestTipS = Math.max(farthestTipS, tipS);
        tree.branches.push({ index: b + 1, lengthM: round1(lengthM), hops, relays: hops - 1, tipS: round1(tipS), tip: { ...laneSlot(lane, spec.altitudes.tipM, trunkHops + hops, tipS), branch: b + 1 } });
    });
    const laneHops = tree.branches.map((br) => trunkHops + br.hops);
    return {
        transport, hardRangeM: (0, transports_1.rangeAtMarginM)(transport, 0, n), designRangeM, degradedRangeM: (0, transports_1.rangeAtMarginM)(transport, spec.degradedMarginDb, n), pathLengthM: farthestTipS,
        hops: trunkHops + tree.branches.reduce((sum, br) => sum + br.hops, 0), relaysNeeded: slots.length, sparesAvailable: spec.fleetSize - slots.length, actualHop, slots, mobileSlots: slots,
        tip: tree.branches[0].tip, hopFrames: laneHops.reduce((a, b) => a + b, 0), longestLaneHops: Math.max(...laneHops), tree,
    };
}
/**
 * A lattice: every slot of the grid that covers the area (and its feeders) is a relay, at its lattice
 * distance from the base for the rotation; the tip's route is at most the deepest slot plus its own hop.
 */
function latticePlanGeometry(spec, area) {
    const transport = (0, transports_1.findTransport)(spec.transport);
    const n = spec.pathLossExponent;
    const designRangeM = (0, transports_1.rangeAtMarginM)(transport, spec.requiredMarginDb, n);
    const hopM = spec.spacingFactor * designRangeM;
    const geo = (0, lattice_1.latticeGeometry)(area, hopM);
    const slots = geo.nodes.map((node) => ({ index: node.index, s: node.depth * hopM, pt: withAltitude({ x: node.x, y: node.y, z: 0 }, spec.altitudes.relayM), cell: { i: node.i, j: node.j, depth: node.depth, parent: node.parent, ...(node.feeder ? { feeder: true } : {}) } }));
    const hops = geo.maxDepth + 1;
    const start = geo.survey[0];
    const lattice = { spacingM: round1(hopM), coverM: round1(geo.coverM), areaM2: Math.round(geo.areaM2), slots: slots.length, feederSlots: geo.nodes.filter((node) => node.feeder).length, maxDepth: geo.maxDepth, survey: geo.survey.map((p) => ({ x: round1(p.x), y: round1(p.y), z: 0 })), surveyM: Math.round(geo.surveyM) };
    return {
        transport, hardRangeM: (0, transports_1.rangeAtMarginM)(transport, 0, n), designRangeM, degradedRangeM: (0, transports_1.rangeAtMarginM)(transport, spec.degradedMarginDb, n), pathLengthM: geo.maxDepth * hopM,
        hops, relaysNeeded: slots.length, sparesAvailable: spec.fleetSize - slots.length, actualHop: hopM, slots, mobileSlots: slots,
        tip: { index: hops, s: Math.hypot(start.x, start.y), pt: withAltitude(start, spec.altitudes.tipM) }, hopFrames: hops, longestLaneHops: hops, lattice,
    };
}
function relaySlot(spec, index, s) {
    return { index, s, pt: withAltitude((0, path_1.pointAt)(spec.path, s), spec.altitudes.relayM) };
}
function laneSlot(lane, altitudeM, index, s) {
    return { index, s, pt: withAltitude((0, path_1.pointAt)(lane, s), altitudeM) };
}
/** The farthest slot's arc length (a chain's slots are sorted; a tree's are grouped by branch). */
function farthestS(slots) {
    return slots.reduce((m, slot) => Math.max(m, slot.s), 0);
}
function transportWarnings(g, warnings) {
    const { transport, relaysNeeded, actualHop, hardRangeM } = g;
    if (transport.multiHop === 'awkward' && relaysNeeded > 1)
        warnings.push(`${transport.name} relays need a concurrent client + owner role per node; read the catalog note before choosing it for a chain`);
    if (transport.topology === 'p2p' && transport.maxPeers === 1 && relaysNeeded > 0)
        warnings.push('point-to-point radio: each relay carries two radios or time-shares one');
    if (g.lattice && 2 * actualHop > hardRangeM)
        warnings.push(`a relay lost where the lattice has no second route (a feeder slot, a corner) opens a ${Math.round(2 * actualHop)} m gap beyond the ${Math.round(hardRangeM)} m modelled edge: what lies beyond disconnects until it walks in`);
    if (!g.lattice && 2 * actualHop > hardRangeM)
        warnings.push(`one lost relay opens a ${Math.round(2 * actualHop)} m gap beyond the ${Math.round(hardRangeM)} m modelled edge: the outer segment disconnects until it shifts in`);
}
function enduranceNotes(spec, g, onStationS, sustainFleet, reasons, warnings) {
    if (g.relaysNeeded === 0)
        return;
    const farS = farthestS(g.mobileSlots);
    if (onStationS <= 0) {
        reasons.push(`the farthest relay (${Math.round(farS)} m out) cannot fly out, hold and fly home with a ${spec.reserveS} s reserve on ${spec.enduranceS} s of endurance`);
        return;
    }
    const holds = spec.posture === 'perch' ? 'perches at' : 'holds';
    if (spec.fleetSize < sustainFleet)
        warnings.push(`holding every slot continuously needs about ${sustainFleet} relays in rotation (each flies out, ${holds} its slot ${Math.round(onStationS)} s at the far end, flies home and turns round in ${spec.turnaroundS} s); with ${spec.fleetSize}, expect relays to leave on battery before a spare can take over and hops to stretch — run a long scenario to see how often`);
}
/** The antenna height a perch needs: 60 % of the first Fresnel radius at mid-hop, 0.5·√(λ·d). */
function perchClearance(spec, g, warnings) {
    if (spec.posture !== 'perch')
        return 0;
    const lambda = C / (g.transport.freqMhz * 1e6);
    const heightM = 0.3 * Math.sqrt(lambda * g.actualHop);
    if (spec.pathLossExponent < 2.8)
        warnings.push(`perched relays sit near the ground: lift the antenna at least ${round1(heightM)} m at every perch (60 % of the first Fresnel zone at a ${Math.round(g.actualHop)} m hop), or plan on pathLossExponent 3 — Espressif's ground-level test fits an exponent near 3, where this radio's design range is ${Math.round((0, transports_1.rangeAtMarginM)(g.transport, spec.requiredMarginDb, 3))} m`);
    return round1(heightM);
}
function planControl(spec, g, warnings) {
    if (spec.controlChannel === 'in-band')
        return null;
    const t = (0, transports_1.findTransport)(spec.controlChannel);
    const directRangeM = (0, transports_1.rangeAtMarginM)(t, spec.requiredMarginDb, spec.pathLossExponent);
    const reachesTipDirect = directRangeM >= g.pathLengthM;
    const nodesOnAir = g.relaysNeeded + 1;
    const frameS = Math.max(t.latencyMs / 1000, (exports.HEARTBEAT_BYTES * 8) / (t.throughputKbps * 1000));
    const offered = (nodesOnAir * frameS) / spec.heartbeatS;
    const dutyPct = 100 * offered;
    if (!reachesTipDirect)
        warnings.push(`the ${t.name} control channel keeps ${spec.requiredMarginDb} dB only to ${Math.round(directRangeM)} m from the base and the tip is ${Math.round(g.pathLengthM)} m out: beyond that the heartbeats and the RTL word ride the chain again`);
    if (dutyPct > 50)
        warnings.push(`${nodesOnAir} nodes heartbeating every ${spec.heartbeatS} s on ${t.name} occupy ${round1(dutyPct)} % of the control channel (${Math.round(frameS * 1000)} ms a frame): lengthen heartbeatS to leave air for commands`);
    return { transport: t.id, directRangeM: Math.round(directRangeM), reachesTipDirect, nodesOnAir, frameS: round3(frameS), dutyPct: round1(dutyPct), alohaDeliveryPct: round1(100 * Math.exp(-2 * offered)), ok: reachesTipDirect && dutyPct <= 50 };
}
function planCourier(spec, g, endToEndKbps, warnings) {
    if (spec.courierMB <= 0)
        return null;
    const t = (0, transports_1.findTransport)(spec.courierTransport);
    const loadS = (spec.courierMB * 8000) / t.throughputKbps;
    const flightS = (2 * g.pathLengthM) / spec.cruiseMps;
    const tripS = flightS + loadS + spec.turnaroundS;
    const feasible = flightS + loadS * spec.perchDrawFraction + spec.reserveS <= spec.enduranceS;
    const equivalentKbps = (spec.courierMB * 8000) / tripS;
    if (!feasible)
        warnings.push(`a courier cannot fly ${Math.round(g.pathLengthM)} m out, load ${spec.courierMB} MB landed (${Math.round(loadS)} s over ${t.name}) and fly home on ${spec.enduranceS} s with a ${spec.reserveS} s reserve`);
    else if (equivalentKbps <= endToEndKbps)
        warnings.push(`the courier's ${round1(equivalentKbps)} kbps is no more than the chain's own ${round1(endToEndKbps)} kbps: load it over a faster radio or carry more per trip`);
    return { transport: t.id, payloadMB: spec.courierMB, loadS: Math.round(loadS), tripS: Math.round(tripS), mbPerHour: round1((spec.courierMB * 3600) / tripS), equivalentKbps: round1(equivalentKbps), feasible };
}
/**
 * @description Size the chain: hop from the budget, relays from the corridor, slots evenly spaced;
 * then the endurance, the posture's price, the control plane and the courier.
 * @param spec - A validated spec.
 * @returns The plan (infeasible plans still carry every number, plus the reasons).
 */
function planChain(spec) {
    const g = geometry(spec);
    const { transport, relaysNeeded, hops, actualHop } = g;
    const endToEndKbps = transport.throughputKbps / g.hopFrames;
    const reasons = [];
    const warnings = [];
    if (g.sparesAvailable < 0)
        reasons.push(`the ${g.lattice ? 'lattice' : 'corridor'} needs ${relaysNeeded} relays at a ${Math.round(spec.spacingFactor * g.designRangeM)} m hop and the fleet has ${spec.fleetSize}`);
    if (relaysNeeded > 0 && g.sparesAvailable === 0)
        warnings.push('no spare: the first relay lost cannot be replaced and the tip retreats one hop');
    const throughputOk = spec.tipDataKbps <= endToEndKbps;
    if (!throughputOk)
        reasons.push(throughputReason(spec, g, endToEndKbps));
    transportWarnings(g, warnings);
    const onStationS = stationTimeS(spec, relaysNeeded > 0 ? farthestS(g.mobileSlots) : 0);
    const sustainFleet = relaysNeeded > 0 && onStationS > 0 ? rotationFleet(spec, g.mobileSlots) : relaysNeeded;
    enduranceNotes(spec, g, onStationS, sustainFleet, reasons, warnings);
    const perchAntennaHeightM = perchClearance(spec, g, warnings);
    const control = planControl(spec, g, warnings);
    const courier = planCourier(spec, g, endToEndKbps, warnings);
    return {
        transport, pathLengthM: round1(g.pathLengthM), hardRangeM: Math.round(g.hardRangeM), designRangeM: Math.round(g.designRangeM), degradedRangeM: Math.round(g.degradedRangeM),
        hopM: round1(actualHop), hops, relaysNeeded, sparesAvailable: g.sparesAvailable, slots: g.slots, tip: g.tip, perHopMarginDb: round1((0, transports_1.marginDb)(transport, actualHop, spec.pathLossExponent)),
        endToEndKbps: round1(endToEndKbps), endToEndLatencyMs: g.longestLaneHops * transport.latencyMs, throughputOk, onStationS: Math.round(onStationS), sustainFleet, perchAntennaHeightM, control, courier,
        mobileSlots: g.mobileSlots, groundNodes: g.slots.filter((s) => s.ground).map((s) => s.s),
        feasible: reasons.length === 0, reasons, warnings,
        ...(g.tree ? { tree: g.tree } : {}),
        ...(g.lattice ? { lattice: g.lattice } : {}),
    };
}
/** Why the shared channel cannot carry the tip — or, on a tree, every tip at once across the trunk. */
function throughputReason(spec, g, endToEndKbps) {
    const t = g.transport;
    if (!g.tree)
        return `the tip needs ${spec.tipDataKbps} kbps and ${g.hops} hops on a shared ${t.throughputKbps} kbps channel leave ${round1(endToEndKbps)} kbps`;
    return `each of the ${g.tree.branches.length} tips needs ${spec.tipDataKbps} kbps and every tip's frames cross the trunk: ${g.hopFrames} hops' worth of frames on a shared ${t.throughputKbps} kbps channel leave ${round1(endToEndKbps)} kbps a tip`;
}
/**
 * @description Seconds a relay can hold a slot `s` metres out. Hover: endurance less the flight out
 * and home along the corridor and the reserve. Perch: that flight budget stretched by the perched
 * draw fraction (the motors are off; the flight controller, companion and radio stay awake).
 * @param spec - The spec.
 * @param s - The slot's arc length.
 * @returns Seconds on station (may be negative: the slot is out of reach on one battery).
 */
function stationTimeS(spec, s) {
    const flightBudgetS = spec.enduranceS - (2 * s) / spec.cruiseMps - spec.reserveS;
    return spec.posture === 'perch' ? flightBudgetS / spec.perchDrawFraction : flightBudgetS;
}
/**
 * @description Relays needed to hold every slot continuously. A slot's cycle is the flight out and
 * home, the stretch on station, the reserve landed with and the ground turnaround; the slot needs
 * `cycle / stationTime` drones in rotation, and the chain needs the sum, rounded up. Under hover the
 * cycle is exactly `endurance + turnaround`.
 * @param spec - The spec.
 * @param slots - The relay slots.
 * @returns The fleet that sustains the chain without a forced return.
 */
function rotationFleet(spec, slots) {
    const need = slots.reduce((n, slot) => {
        const station = stationTimeS(spec, slot.s);
        const cycleS = (2 * slot.s) / spec.cruiseMps + station + spec.reserveS + spec.turnaroundS;
        return n + cycleS / station;
    }, 0);
    return Math.ceil(need - 1e-9);
}
/**
 * @description The tip's allowed reach with `k` relays under the spec's gap policy.
 * @param spec - The spec.
 * @param plan - The plan.
 * @param k - Connected relays.
 * @returns Arc length the tip may hold, metres.
 */
function allowedTipS(spec, plan, k) {
    const allowedHop = spec.gapPolicy === 'hold-degraded' ? Math.max(plan.hopM, plan.degradedRangeM) : plan.hopM;
    return Math.min(plan.pathLengthM, (k + 1) * allowedHop);
}
/**
 * @description Spread `k` relays evenly from the base to `endS`, the last relay AT `endS`.
 * @param endS - Where the outermost relay should be.
 * @param k - Relay count.
 * @returns Targets in inner → outer order.
 */
function spread(endS, k) {
    const out = [];
    for (let i = 1; i <= k; i += 1)
        out.push((endS * i) / k);
    return out;
}
/**
 * Give `k` mobile relays to the stretches between fixed anchors so that the WORST hop is as short
 * as it can be: hand each relay in turn to whichever stretch currently has the longest hop. With
 * one stretch this is the even spread — which is why a chain with no ground node is unchanged.
 */
function distributeInside(endS, k, anchors) {
    const bounds = [0, ...anchors.filter((s) => s > 0 && s < endS).sort((a, b) => a - b), endS];
    const spans = bounds.slice(1).map((b, i) => b - bounds[i]);
    const take = spans.map(() => 0);
    for (let given = 0; given < k; given += 1) {
        let worst = 0;
        for (let i = 1; i < spans.length; i += 1)
            if (spans[i] / (take[i] + 1) > spans[worst] / (take[worst] + 1))
                worst = i;
        take[worst] += 1;
    }
    const out = [];
    spans.forEach((span, i) => { for (let j = 1; j <= take[i]; j += 1)
        out.push(bounds[i] + (span * j) / (take[i] + 1)); });
    return out;
}
/**
 * @description Elastic targets for `k` connected mobile relays when the tip is reachable at `tipS`,
 * with the ground nodes (which cannot move) holding their own slots. Why a distribution and not an
 * even spread: a static slot in the middle splits the corridor, and the mobile relays are worth
 * most where the remaining hops are longest.
 * @param tipS - The tip's target.
 * @param k - Mobile relay count.
 * @param groundS - Arc lengths of the relays that never fly (empty for the classic chain).
 * @returns Targets in inner → outer order.
 */
function elasticTargetsAround(tipS, k, groundS = []) {
    return distributeInside(tipS, k, groundS);
}
/**
 * @description Spread `k` relays to `endS` (the outermost AT `endS`, as the meet-in-the-middle rule
 * wants) around the ground nodes that pin slots behind it.
 * @param endS - Where the outermost relay should be.
 * @param k - Mobile relay count.
 * @param groundS - Arc lengths of the relays that never fly.
 * @returns Targets in inner → outer order.
 */
function spreadAround(endS, k, groundS = []) {
    if (k <= 0)
        return [];
    return [...distributeInside(endS, k - 1, groundS), endS];
}
/**
 * @description Elastic targets for `k` connected relays when the tip is reachable at `tipS`.
 * @param tipS - The tip's target.
 * @param k - Relay count.
 * @returns Targets, evenly between base and tip.
 */
function elasticTargets(tipS, k) {
    return spread((tipS * k) / (k + 1), k);
}
/**
 * @description Clamp a commanded move so no link that is good now is broken by it.
 * @param toS - Wanted position.
 * @param innerS - The inward neighbour (or the base at 0).
 * @param outerS - The outward neighbour, or null.
 * @param hardRangeM - The modelled link edge.
 * @returns The allowed position.
 */
function guardMove(toS, innerS, outerS, hardRangeM) {
    let s = Math.min(toS, innerS + hardRangeM);
    if (outerS !== null)
        s = Math.max(s, outerS - hardRangeM);
    return Math.max(0, s);
}
/**
 * @description Margin of a hop of `distanceM` under this plan's transport and exponent.
 * @param spec - The spec.
 * @param plan - The plan.
 * @param distanceM - Hop length.
 * @returns Margin, dB.
 */
function hopMarginDb(spec, plan, distanceM) {
    return round1((0, transports_1.marginDb)(plan.transport, distanceM, spec.pathLossExponent));
}
/**
 * @description The control-channel choices a designer has: in band, or any catalog radio.
 * @returns Ids in catalog order, `in-band` first.
 */
function controlChannelIds() {
    return ['in-band', ...transports_1.TRANSPORTS.map((t) => t.id)];
}
function withAltitude(p, z) {
    return { x: round1(p.x), y: round1(p.y), z: round1(p.z + z) };
}
function round1(v) {
    return Math.round(v * 10) / 10;
}
function round3(v) {
    return Math.round(v * 1000) / 1000;
}
//# sourceMappingURL=chain.js.map