"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3 — the explorer's PARTS MODEL, derived from the
 *                     |                             | record's design vector on every read (D1: the parts model is
 *                     |                             | derived, never authored). Printed rows: the float, the sub body,
 *                     |                             | the wings, the rudder and the spindle blades, each with its CAD
 *                     |                             | Studio program, material, print notes, an estimated mass and the
 *                     |                             | volume it displaces. Bought and fabricated rows: the report's
 *                     |                             | bill of materials re-scoped to the explorer, with the mass, price
 *                     |                             | and placement the report never published left NULL and named.
 *                     |                             | Every watertight part (ten printed, plus the tether) carries the
 *                     |                             | D8 portable object. `problems` lists what keeps the model from
 *                     |                             | being complete (D6 item 1), so parts-complete refuses by name.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAD_STUDIO_MAX_DIMENSION_MM = exports.EXPLORER_PARTS_ENGINE = void 0;
exports.explorerBoughtCatalog = explorerBoughtCatalog;
exports.radiusAt = radiusAt;
exports.buildExplorerParts = buildExplorerParts;
const wave_1 = require("../wave");
const explorer_bought_parts_json_1 = __importDefault(require("./explorer-bought-parts.json"));
const explorer_part_programs_1 = require("./explorer-part-programs");
const mass_properties_1 = require("./mass-properties");
const portable_object_1 = require("./portable-object");
const stage_1 = require("./stage");
/** The engine that derives the parts model; every part and portable object names it. */
exports.EXPLORER_PARTS_ENGINE = Object.freeze({ id: 'ocean-lab.explorer-parts', version: '1.0.0' });
/** CAD Studio's largest dimension, mm (LIMITS.maxDimensionMm in its contract; the engine suite holds the two equal). */
exports.CAD_STUDIO_MAX_DIMENSION_MM = 2000;
/** @description The committed catalog, exactly as shipped. @returns A deep copy, so no caller mutates the fixture. */
function explorerBoughtCatalog() {
    return JSON.parse(JSON.stringify(explorer_bought_parts_json_1.default));
}
/** Round, never to -0 (JSON cannot round-trip it). */
const round = (v, places) => Math.round(v * 10 ** places) / 10 ** places + 0;
const roundVec = (v) => [round(v[0], 3), round(v[1], 3), round(v[2], 3)];
/** @description The D8 mass-properties block from computed mass properties and their provenance. */
function massBlock(mp, massBasis, distribution) {
    return {
        mass: { valueKg: round(mp.massKg, 6), provenance: { source: 'estimate', basis: massBasis } },
        centreOfMass: { valueMm: roundVec(mp.centreOfMassMm), provenance: { source: 'computed', basis: `the program's own geometry, ${distribution}` } },
        inertia: { aboutCentreOfMassKgMm2: mp.inertiaAboutComKgMm2.map((row) => roundVec(row)), provenance: { source: 'computed', basis: `about the centre of mass in the part's frame, from the program's own geometry, ${distribution}; an estimate travels AS an estimate and a receiver must not re-derive it` } },
    };
}
/** @description A D8 portable object for one part. */
function portable(partId, name, fp, program, mass, frame, forceModelId) {
    const envelope = forceModelId ? (0, wave_1.envelopeFor)(forceModelId) : null;
    return {
        schema: portable_object_1.PORTABLE_OBJECT_SCHEMA,
        identity: {
            lab: 'ocean-lab', kind: 'wave-explorer', partId, name,
            engine: { id: exports.EXPLORER_PARTS_ENGINE.id, version: exports.EXPLORER_PARTS_ENGINE.version },
            designVectorFingerprint: fp,
            provenance: { source: 'computed', basis: `derived from the record's design vector by ${exports.EXPLORER_PARTS_ENGINE.id} ${exports.EXPLORER_PARTS_ENGINE.version}, with the report's drawn shapes (explorer-drawings.json)` },
        },
        geometry: { form: 'cad-program', units: 'mm', program },
        massProperties: mass,
        attachmentFrame: frame,
        forceModel: envelope ? { id: envelope.id, label: envelope.label, requires: [...envelope.requires], validIn: [...envelope.validIn], declared: envelope.declared } : null,
    };
}
/** @description An attachment frame in CAD Studio's convention. */
function frame(origin, axes, points) {
    return { convention: portable_object_1.CAD_STUDIO_WORLD_FRAME, origin, axes, points: points.map((p) => ({ ...p, positionMm: roundVec(p.positionMm) })) };
}
/**
 * @description The radius of a revolved outline at a height, by linear interpolation (0 outside it): where a wing's root meets the hull.
 * @param profile - [[r, z], ...] with z rising. @param z - The height. @returns The radius, mm.
 */
function radiusAt(profile, z) {
    for (let i = 0; i + 1 < profile.length; i += 1) {
        const [r0, z0] = profile[i];
        const [r1, z1] = profile[i + 1];
        if (z >= z0 && z <= z1)
            return z1 === z0 ? Math.max(r0, r1) : r0 + ((z - z0) / (z1 - z0)) * (r1 - r0);
    }
    return 0;
}
/** @description The sub's named points: every drawn wing hinge, the rudder stock and the spindle axis, in the sub body's frame (nose at Z = 0). */
function subPoints(v) {
    const d = explorer_part_programs_1.EXPLORER_DRAWINGS;
    const radius = (v.sub.diameterM * 1000) / 2;
    const assembly = v.sub.lengthM * 1000;
    const { rootRadiusMm } = (0, explorer_part_programs_1.wingStations)(v);
    const points = [];
    d.wing.rankStationFrac.forEach((frac, i) => {
        for (const [side, y] of [['port', 1], ['starboard', -1]]) {
            points.push({ name: `wing-${i + 1}-${side}`, positionMm: [0, y * rootRadiusMm, frac * assembly], axis: [0, y, 0], why: `the pitch axis of rank ${i + 1}'s ${side} wing where its root section sits (measured: report pages 2-3); the hinge axle runs along it` });
        }
    });
    points.push({ name: 'rudder-stock', positionMm: [d.rudder.rootOffsetFrac * radius, 0, d.rudder.stationFrac * assembly], axis: [1, 0, 0], why: "the rudder's quarter chord at its root (measured: report page 2); the actuator turns it about +X" });
    points.push({ name: 'spindle-axis', positionMm: [d.spindle.axisOffsetFrac * radius, 0, d.spindle.axisStationFrac * assembly], axis: [0, 0, 1], why: 'the current spindle\'s rotor axis, fore and aft behind the tail (measured: report pages 2-3); the report draws no hub or support' });
    return points;
}
/** @description The two hulls: the float and the sub body, printed as their skin. */
function hullParts(v, fp, rho) {
    const fab = explorer_part_programs_1.EXPLORER_DRAWINGS.fabrication;
    const basis = `thin-wall estimate: the outline's surface and its two end faces x the assumed ${fab.hullWallMm} mm wall x ${fab.material} at ${fab.densityGcm3} g/cm3, 0 % infill; CAD Studio's report weighs the SOLID program at its density, an upper bound`;
    const notes = `${fab.hulls}. One piece as programmed; the study does not say how a printer bed splits it.`;
    const hull = (id, name, g, carriedBy, f) => {
        const mp = (0, mass_properties_1.revolveShellMassProperties)(g.profile, fab.hullWallMm, rho);
        return {
            id, name, qty: 1, make: 'printed', material: fab.material, printNotes: notes, massEachKg: round(mp.massKg, 6), massProvenance: { source: 'estimate', basis }, carriedBy,
            displacedTotalMm3: (0, mass_properties_1.revolveVolumeMm3)(g.profile), displacedBasis: 'the volume the revolved outline encloses (exact frustums)', geometry: g,
            portableObject: portable(id, name, fp, g.program, massBlock(mp, basis, 'a closed thin shell of revolution'), f, null),
        };
    };
    const revolveAxes = (along) => ({ x: 'square to the axis (the hull is a body of revolution)', y: 'square to the axis and to x', z: along });
    const floatFrame = frame("the float's axis on its lower end face", revolveAxes("the float's axis, lower end to upper end"), [{ name: 'tether', positionMm: [0, 0, 0], axis: [0, 0, -1], why: "reconstructed: the tether leaves the float's lower end toward the sub; the report draws the float's outline only" }]);
    const subFrame = frame("the sub's nose, on its axis", { x: "up in the vehicle (the rudder's side)", y: 'to port', z: "the sub's axis, nose to tail (the vehicle's forward is -Z)" }, subPoints(v));
    return [hull('float', 'Float hull', (0, explorer_part_programs_1.floatProgram)(v), 'float', floatFrame), hull('sub-body', 'Sub body', (0, explorer_part_programs_1.subBodyProgram)(v), 'sub', subFrame)];
}
/** @description Foil axes: the chord along X, the thickness along Y, the span along Z. */
const FOIL_AXES = (span) => ({ x: 'the chord, leading edge to trailing edge', y: "the section's thickness", z: span });
/** @description A lofted foil part printed solid, with its stacking point named. */
function foilPart(fp, rho, spec) {
    const fab = explorer_part_programs_1.EXPLORER_DRAWINGS.fabrication;
    const mp = (0, mass_properties_1.loftMassProperties)(spec.g.sections, rho, spec.g.translate);
    const basis = `the loft's exact volume (5-point Gauss-Legendre over each ruled segment) x ${fab.material} at ${fab.densityGcm3} g/cm3, printed solid`;
    const f = frame(`the part's footprint centre on Z = 0; the stacking point is ${spec.point}`, FOIL_AXES(spec.span), [{ name: spec.point, positionMm: [spec.g.translate[0], spec.g.translate[1], 0], axis: [0, 0, 1], why: spec.why }]);
    return {
        id: spec.id, name: spec.name, qty: spec.qty, make: 'printed', material: fab.material, printNotes: `${fab.foils}; printed as programmed, span along Z, root on the bed.`,
        massEachKg: round(mp.massKg, 6), massProvenance: { source: 'estimate', basis }, carriedBy: 'sub', displacedTotalMm3: spec.displaced, displacedBasis: spec.displacedBasis, geometry: spec.g,
        portableObject: portable(spec.id, spec.name, fp, spec.g.program, massBlock(mp, basis, 'a solid ruled loft of uniform density'), f, spec.forceModel),
    };
}
/** @description What the wings displace: each wing's volume outside the hull at its rank (the root part sits inside the hull). */
function wingDisplacement(v, g) {
    const d = explorer_part_programs_1.EXPLORER_DRAWINGS.wing;
    const hull = (0, explorer_part_programs_1.subProfile)(v);
    const { rootRadiusMm } = (0, explorer_part_programs_1.wingStations)(v);
    const perRank = d.rankStationFrac.map((frac) => (0, mass_properties_1.loftVolumeAboveMm3)(g.sections, Math.max(0, radiusAt(hull, frac * v.sub.lengthM * 1000) - rootRadiusMm)));
    const mean = perRank.reduce((a, b) => a + b, 0) / perRank.length;
    return v.wings.count === d.ranks * d.perRank ? perRank.reduce((a, b) => a + b * d.perRank, 0) : mean * v.wings.count;
}
/** @description The three foils: the wings, the rudder and the spindle blades. */
function foilParts(v, fp, rho) {
    const wing = (0, explorer_part_programs_1.wingProgram)(v);
    const rudder = (0, explorer_part_programs_1.rudderProgram)();
    const blade = (0, explorer_part_programs_1.spindleBladeProgram)();
    const whole = (g) => (0, mass_properties_1.loftVolumeAboveMm3)(g.sections, -Infinity);
    return [
        foilPart(fp, rho, { id: 'wing', name: 'Wing', qty: v.wings.count, g: wing, displaced: wingDisplacement(v, wing), displacedBasis: "each wing's volume outside the hull radius at its rank", point: 'pitch-axis-root', why: 'the pitch axis at 25 % chord on the root section (published: report page 4); the hinge axle runs along +Z, the span', span: 'the span, root to tip', forceModel: 'wave-propulsion' }),
        foilPart(fp, rho, { id: 'rudder', name: 'Rudder', qty: 1, g: rudder, displaced: whole(rudder), displacedBasis: 'the whole rudder: its root stands clear of the hull (measured)', point: 'stock-root', why: "the rudder stock at the root section's quarter chord (measured: report page 2)", span: 'the span, root to tip', forceModel: null }),
        foilPart(fp, rho, { id: 'spindle-blade', name: 'Spindle blade', qty: explorer_part_programs_1.EXPLORER_DRAWINGS.spindle.blades, g: blade, displaced: whole(blade) * explorer_part_programs_1.EXPLORER_DRAWINGS.spindle.blades, displacedBasis: 'the whole blade, three of them: the rotor turns behind the tail', point: 'root-stack', why: 'the blade stacking axis at 25 % chord on the root section, 23.97 mm from the rotor axis (measured: report pages 2-3)', span: 'radial, root to tip', forceModel: null }),
    ];
}
/** @description The umbilical's placement geometry and portable object (a bought part with a body of its own). */
function tetherObject(v, fp, row) {
    const geometry = (0, explorer_part_programs_1.tetherProgram)(v);
    const d = v.tether.diameterM * 1000;
    const h = v.tether.lengthM * 1000;
    const massKg = row.massG === null ? null : row.massG / 1000;
    const cyl = (0, mass_properties_1.cylinderMassProperties)(d, h, massKg);
    const mass = {
        mass: massKg === null ? { valueKg: null, provenance: { source: 'unknown', basis: 'the umbilical is bought and the report publishes no mass' } } : { valueKg: massKg, provenance: { source: 'published', basis: row.source } },
        centreOfMass: { valueMm: roundVec(cyl.centreOfMassMm), provenance: { source: 'computed', basis: "the cylinder's centre, taking the umbilical as uniform along its length" } },
        inertia: cyl.inertiaAboutComKgMm2 ? { aboutCentreOfMassKgMm2: cyl.inertiaAboutComKgMm2.map(roundVec), provenance: { source: 'computed', basis: 'a uniform solid cylinder at the row\'s mass' } } : { aboutCentreOfMassKgMm2: null, provenance: { source: 'unknown', basis: 'an inertia tensor needs the mass nobody has published' } },
    };
    const f = frame("the tether's sub end, on its axis", { x: 'square to the tether', y: 'square to the tether and to x', z: 'along the tether, sub end to float end' }, [
        { name: 'sub-end', positionMm: [0, 0, 0], axis: [0, 0, -1], why: 'the end that joins the sub (published: a 2 m tether between the float and the sub)' },
        { name: 'float-end', positionMm: [0, 0, h], axis: [0, 0, 1], why: "the end that joins the float's tether point" },
    ]);
    return { geometry, displaced: cyl.volumeMm3, object: portable('tether', 'Tether (umbilical)', fp, geometry.program, mass, f, null) };
}
/** @description The bought and fabricated rows with quantities resolved; the umbilical gains its body. */
function boughtParts(v, fp, catalog) {
    return catalog.rows.map((row) => {
        const tether = row.id === 'umbilical' ? tetherObject(v, fp, row) : null;
        return {
            id: row.id, name: row.name, group: row.group, qty: row.qty === 'wings.count' ? v.wings.count : row.qty, make: row.make, spec: row.spec,
            carriedBy: row.carriedBy, carriedByBasis: row.carriedByBasis, derived: row.derived ?? null,
            massEachKg: row.massG === null ? null : row.massG / 1000, approxUsdEach: row.approxUsd, source: row.source,
            displacedTotalMm3: tether ? tether.displaced : null, geometry: tether ? tether.geometry : null, portableObject: tether ? tether.object : null,
        };
    });
}
/** @description What keeps the parts model from being complete (D6 item 1), each problem naming its rows. */
function completenessProblems(v, bought) {
    const problems = [];
    const ids = (rows) => rows.map((r) => r.id).join(', ');
    const noMass = bought.filter((b) => b.derived !== 'ballast' && b.massEachKg === null);
    if (noMass.length)
        problems.push(`${noMass.length} bought or fabricated row(s) carry no mass (${ids(noMass)}): the report publishes none`);
    const noPrice = bought.filter((b) => b.approxUsdEach === null);
    if (noPrice.length)
        problems.push(`${noPrice.length} bought or fabricated row(s) carry no approximate price (${ids(noPrice)}): the report says costs were deliberately omitted because any figure would be invented`);
    const unplaced = bought.filter((b) => b.carriedBy === null);
    if (unplaced.length)
        problems.push(`${unplaced.length} row(s) are placed on neither the float, the sub nor the tether (${ids(unplaced)}): the report does not say which body carries them`);
    const drawn = explorer_part_programs_1.EXPLORER_DRAWINGS.wing.ranks * explorer_part_programs_1.EXPLORER_DRAWINGS.wing.perRank;
    if (v.wings.count !== drawn)
        problems.push(`the drawings lay out ${drawn} wings on ${explorer_part_programs_1.EXPLORER_DRAWINGS.wing.ranks} ranks; wings.count ${v.wings.count} has no drawn rank layout, so its hinge points are not placed`);
    if (v.tether.lengthM * 1000 > exports.CAD_STUDIO_MAX_DIMENSION_MM)
        problems.push(`the tether's ${v.tether.lengthM * 1000} mm body is longer than CAD Studio's ${exports.CAD_STUDIO_MAX_DIMENSION_MM} mm limit, so its program cannot be built`);
    return problems;
}
/**
 * @description The explorer's parts model at a design vector (D1: derived, never authored; D6 item 1).
 * @param v - A valid explorer design vector.
 * @param catalog - The bought rows (the committed catalog by default; a test may pass complete rows).
 * @returns The parts model with its completeness problems.
 */
function buildExplorerParts(v, catalog = explorerBoughtCatalog()) {
    const fp = (0, stage_1.designVectorFingerprint)(v);
    const rho = explorer_part_programs_1.EXPLORER_DRAWINGS.fabrication.densityGcm3 * 1e-6;
    const printed = [...hullParts(v, fp, rho), ...foilParts(v, fp, rho)];
    const bought = boughtParts(v, fp, catalog);
    const watertightParts = printed.reduce((n, p) => n + p.qty, 0) + bought.filter((b) => b.portableObject).reduce((n, b) => n + b.qty, 0);
    return { engine: { ...exports.EXPLORER_PARTS_ENGINE }, vectorFingerprint: fp, printed, bought, watertightParts, fabrication: explorer_part_programs_1.EXPLORER_DRAWINGS.fabrication, problems: completenessProblems(v, bought) };
}
