"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-160 D9 slice S1 — the operator's own acceptance case. The autonomous explorer's hull as ONE SOLID, built from the published 300 mm envelope and the published all-up mass of the design study, dropped into a chosen medium (D7). In air it falls at g, because gravity is the only body force this scene carries. In seawater the rigid-body plant declines BY NAME — it emits no density and no viscosity, has no added mass and no cavitation, and nothing here models a free surface — and the flotation question refuses by name too, because a plausible-looking float would disprove the contract this slice exists to prove. Not the eleven-part parts model, which does not exist: one solid, from numbers that are published.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HULL_FLOTATION = exports.EXPLORER_HULL_PROVENANCE = exports.EXPLORER_HULL = void 0;
exports.explorerHullInertia = explorerHullInertia;
exports.hullFlotation = hullFlotation;
exports.explorerHullMjcf = explorerHullMjcf;
exports.dropExplorerHull = dropExplorerHull;
exports.defaultPlantMedium = defaultPlantMedium;
const medium_1 = require("../medium/medium");
const mjcf_1 = require("./mjcf");
/** The explorer hull as one solid. 300 mm envelope, 24.7 kg. */
exports.EXPLORER_HULL = {
    id: 'explorer-hull',
    label: 'Autonomous explorer — hull as one solid',
    envelopeM: 0.3,
    bodyDiameterM: 0.28,
    wingSpanDeployedM: 0.296,
    tetherM: 2,
    floatDisplacementL: 24.1,
    allUpMassKg: 24.7,
};
/** Where each published number came from, and which one is a reading rather than a quotation. */
exports.EXPLORER_HULL_PROVENANCE = Object.freeze({
    source: 'docs/research/autonomous-explorer-design-study.md (2026-08-02), "The explorer" — a 300 mm envelope vehicle, modelled completely. Simulation only: nothing was built, wetted or tested.',
    envelopeM: 'The study\'s headline envelope, 300 mm. It bounds the two dimensions the study tabulates — the 280 mm body diameter and the 296 mm deployed wing span. The 2.0 m tether is not inside it and is not part of this solid.',
    bodyDiameterM: 'Published: body diameter 280 mm.',
    wingSpanDeployedM: 'Published: wing span deployed 296 mm.',
    tetherM: 'Published: tether 2.0 m.',
    floatDisplacementL: 'Published: float displacement 24.1 L.',
    allUpMassKg: 'READ, not quoted. The study publishes one mass for the vehicle — "24.1 L -> 24.7 kg buoyancy" — and no separate dry-mass breakdown. 24.7 kg is the mass the float is sized to support, so it is the all-up mass at flotation; ADR-160 D7 puts it plainly: "Displacement in water and mass in air are the same numbers read two ways". The arithmetic closes on the shared seawater row: 0.0241 m^3 * 1025 kg/m^3 = 24.7025 kg.',
    shape: 'A uniform box of the published envelope. The study\'s eleven-part parts model is NOT used and is explicitly out of this slice (ADR-160 S1/S3), so mass is distributed uniformly and the inertia below is that of a uniform box — an estimate, and it travels as one.',
});
/** @description Mass and principal inertias of the hull taken as a uniform solid box of the published envelope, about its own centre. An ESTIMATE, and it says so: the parts model that would place mass properly is slice S3.
 * @returns Mass (kg) and the three principal inertias (kg*m^2). */
function explorerHullInertia() {
    const a = exports.EXPLORER_HULL.envelopeM;
    const m = exports.EXPLORER_HULL.allUpMassKg;
    const i = (m * (a * a + a * a)) / 12;
    return { massKg: m, ixx: i, iyy: i, izz: i, halfM: a / 2 };
}
/** Flotation as a force model: it needs an interface to work against, and no medium in this package carries one. */
exports.HULL_FLOTATION = {
    id: 'hull-flotation',
    label: 'Does the hull float?',
    requires: ['freeSurface', 'densityKgM3'],
    validIn: ['vacuum', 'air', 'seawater'],
    envelopeWhy: 'Flotation is a legitimate question to ask of any medium; what it needs is a free surface, and the answer to whether a medium has one is a property refusal, not an envelope refusal.',
};
/** @description Ask whether the hull floats. Every medium in this package refuses BY NAME, because none carries a free surface — and a plausible-looking float would have disproved the contract this slice exists to prove (ADR-160 D9).
 * @param m - the medium. @returns never, today.
 * @throws MediumRefused `medium_property_unavailable: freeSurface`. */
function hullFlotation(m) {
    (0, medium_1.requireModelValidIn)(exports.HULL_FLOTATION, m);
    (0, medium_1.requireProperty)(m, 'freeSurface');
    /* istanbul ignore next — unreachable until some medium in this package carries a free surface. */
    throw new medium_1.MediumRefused({
        code: 'medium_property_unavailable',
        refusal: 'medium_property_unavailable: freeSurface',
        mediumId: m.id,
        property: 'freeSurface',
        because: 'the medium answered a free surface but no waterplane model exists here to use it',
    });
}
const DEFAULT_DROP_M = 2;
/** @description The analytic free fall the plant is expected to reproduce. Gravity is the only body force the emitted scene carries, so the hull's underside follows h - g t^2 / 2 exactly until it touches.
 * @param m - the medium. @param dropHeightM - underside height at release. @param samples - trace points.
 * @returns The fall, with the basis it rests on stated. */
function predictFall(m, dropHeightM, samples) {
    const g = m.gravityMps2;
    const mag = Math.hypot(g[0], g[1], g[2]);
    const fallTimeS = mag > 0 ? Math.sqrt((2 * dropHeightM) / mag) : Infinity;
    const trace = [];
    for (let i = 0; i <= samples; i += 1) {
        const tS = (fallTimeS * i) / samples;
        trace.push({ tS: Number(tS.toFixed(4)), heightM: Number(Math.max(0, dropHeightM - (mag * tS * tS) / 2).toFixed(4)) });
    }
    return {
        gravityMps2: g,
        gMagnitudeMps2: mag,
        dropHeightM,
        fallTimeS,
        impactSpeedMs: mag * fallTimeS,
        trace,
        basis: `Analytic: the scene the plant loads carries this medium's gravity and NOTHING else — no <option> density, no viscosity, no buoyancy, no added mass — so the only body force on the hull is m*g and the fall is h - |g|t^2/2 until contact. |g| = ${mag} m/s^2 comes from the ${m.label} row, and the plant reads the same vector back out of the model it is handed.`,
    };
}
/** @description The explorer hull as one solid in a chosen medium, as MuJoCo XML: a floor, the hull as one free body with the published mass and a uniform-box inertia, and an `<option>` whose gravity is the MEDIUM'S — not a module constant.
 * @param m - the medium the scene runs in. @param opts - drop height and trace resolution.
 * @returns The MJCF.
 * @throws MediumRefused `model_not_valid_in_medium: rigid-body-plant, <medium>` when the plant's author has not declared the medium, or `medium_outside_validity` when the release height is outside the band the medium answers over. */
function explorerHullMjcf(m, opts = {}) {
    const dropHeightM = opts.dropHeightM ?? DEFAULT_DROP_M;
    (0, medium_1.requireModelValidIn)(mjcf_1.RIGID_BODY_PLANT, m);
    (0, medium_1.requireProperty)(m, 'gravityMps2');
    (0, medium_1.requireWithinValidity)(m, dropHeightM);
    const inertia = explorerHullInertia();
    const half = inertia.halfM;
    const nu = m.densityKgM3 > 0 ? `${(0, medium_1.kinematicViscosityM2S)(m)} m^2/s` : 'undefined (zero density)';
    return `<mujoco model="explorer-hull-${m.id}">
  <!-- ADR-160 S1. The autonomous explorer's hull as ONE SOLID: the published ${exports.EXPLORER_HULL.envelopeM * 1000} mm envelope and the
       published ${exports.EXPLORER_HULL.allUpMassKg} kg all-up mass, uniform box inertia. Simulation only; nothing was built or wetted.
       MEDIUM: ${m.id} — ${m.label}. rho = ${m.densityKgM3} kg/m^3, mu = ${m.dynamicViscosityPaS} Pa*s, nu = ${nu}.
       The plant takes ONLY the gravity vector from the medium. No density and no viscosity are emitted here, so
       MuJoCo's own fluid model does not run: this scene makes no fluid claim of any kind (ADR-160 D7). -->
  <compiler angle="radian" autolimits="true"/>
  <option timestep="${mjcf_1.MJCF_TIMESTEP_S}" gravity="${(0, mjcf_1.mjcfVec3)(m.gravityMps2)}" integrator="implicitfast"/>
  <default>
    <default class="scene"><geom contype="1" conaffinity="1" friction="0.8 0.005 0.0001" rgba="0.6 0.6 0.65 1"/></default>
    <default class="hull"><geom contype="1" conaffinity="1" friction="0.6 0.005 0.0001" rgba="0.35 0.6 0.9 1"/></default>
  </default>
  <worldbody>
    <geom name="floor" class="scene" type="plane" pos="0 0 0" size="5 5 0.1"/>
    <body name="explorer-hull" pos="0 0 ${(0, mjcf_1.mjcfNumber)(dropHeightM + half)}" quat="1 0 0 0">
      <freejoint name="explorer-hull-free"/>
      <inertial pos="0 0 0" mass="${(0, mjcf_1.mjcfNumber)(inertia.massKg)}" diaginertia="${(0, mjcf_1.mjcfNumber)(inertia.ixx)} ${(0, mjcf_1.mjcfNumber)(inertia.iyy)} ${(0, mjcf_1.mjcfNumber)(inertia.izz)}"/>
      <geom name="explorer-hull-solid" class="hull" type="box" pos="0 0 0" size="${(0, mjcf_1.mjcfNumber)(half)} ${(0, mjcf_1.mjcfNumber)(half)} ${(0, mjcf_1.mjcfNumber)(half)}"/>
    </body>
  </worldbody>
  <sensor>
    <framepos name="hull-pos" objtype="body" objname="explorer-hull"/>
    <framelinvel name="hull-vel" objtype="body" objname="explorer-hull"/>
  </sensor>
</mujoco>
`;
}
/** @description Drop the explorer hull in a chosen medium. In air it falls at g. In seawater this refuses by name rather than pretending to float.
 * @param m - the medium. @param opts - drop height and trace resolution.
 * @returns The drop: the medium that answered, the solid, the analytic fall and the MJCF the plant loads.
 * @throws MediumRefused — `model_not_valid_in_medium: rigid-body-plant, seawater` for a liquid, `medium_outside_validity` outside the medium's band. */
function dropExplorerHull(m, opts = {}) {
    const dropHeightM = opts.dropHeightM ?? DEFAULT_DROP_M;
    const mjcf = explorerHullMjcf(m, opts);
    let flotation;
    try {
        hullFlotation(m);
        /* istanbul ignore next */ flotation = { answered: true };
    }
    catch (error) {
        if (!(error instanceof medium_1.MediumRefused))
            throw error;
        flotation = error.toJSON();
    }
    return {
        medium: { id: m.id, label: m.label, gravityMps2: m.gravityMps2, densityKgM3: m.densityKgM3, resolution: m.resolution },
        hull: { ...exports.EXPLORER_HULL, inertia: explorerHullInertia() },
        fall: predictFall(m, dropHeightM, Math.max(2, Math.min(50, opts.samples ?? 8))),
        mjcf,
        flotation,
        notModelled: [
            'free-surface hydrodynamics — no engine in this package has a free surface',
            'added mass and radiation damping',
            'cavitation',
            'aerodynamics: lift and drag polars stay in each lab\'s own models, never in this plant',
            'the eleven-part parts model and its displacement budget (ADR-160 S3)',
        ],
    };
}
/** @description The medium the drone plant has always run in, now said out loud: vacuum with Earth-surface gravity. @returns The vacuum medium. */
function defaultPlantMedium() {
    return (0, medium_1.mediumById)('vacuum');
}
//# sourceMappingURL=hull-mjcf.js.map