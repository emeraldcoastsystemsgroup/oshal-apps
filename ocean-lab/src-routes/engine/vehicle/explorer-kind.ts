/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the kind this lab owns (a wave-driven explorer)
 *                     |                             | and its design vector. D1: anything a person may type is a
 *                     |                             | parameter (the wings, the stop angle, the tether, the float,
 *                     |                             | the sub's ballast, the site's sea-state table) and anything the
 *                     |                             | engine computes is derived (the float's draft, every wetted
 *                     |                             | area, the form factor, the table, the year). D4: the study's
 *                     |                             | "What is not true" section as eight LIMIT ROWS on the kind — a
 *                     |                             | kind that declares none is refused at load. D7: evaluation asks
 *                     |                             | the medium for what the model needs and refuses by name — in
 *                     |                             | air, medium_property_unavailable: freeSurface.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fix: two limit sentences had drifted from the study's
 *                     |                             | "What is not true" text although they are stored and shown as
 *                     |                             | its sentences. no-real-site-data carried the report's
 *                     |                             | occurrence-mix addendum inside the sentence; it now lives in
 *                     |                             | that row's retireWhen, where it names what a survey replaces.
 *                     |                             | no-self-intersection-check read "manifold; a" where the study
 *                     |                             | reads "manifold. A". All eight sentences now equal the study
 *                     |                             | bullets exactly, and engine-vehicle.test.js asserts equality.
 */

import type { NacaSpec } from '../rotor-design/model/rotor-types';
import {
  MediumRefusal, WAVE_ENGINE, evaluateSeaStates, gravityMagnitude, kinematicViscosityM2S, listEnvelopes,
  requireMediumProperties, requireWithinValidity, type Fluid, type Medium, type SeaState, type SeaStateEvaluation,
  type Site, type WaveVehicle,
} from '../wave';

/** @description One "What is not true" sentence as data: an id, the sentence, what would retire it, and whether it blocks `built` (D4). */
export interface LimitRow { id: string; sentence: string; retireWhen: string; blocking: boolean }

/** @description A kind this lab owns: what it requires, what it emits, what it must not claim. */
export interface VehicleKind {
  id: string;
  lab: 'ocean-lab';
  label: string;
  requiredFigures: readonly string[];
  fabricationOutputs: readonly string[];
  forceModels: readonly string[];
  limits: readonly LimitRow[];
}

/** @description The authored part of an explorer record (D1). Lengths in metres, angles in degrees, weight in newtons. */
export interface ExplorerVector {
  wings: { count: number; spanM: number; chordM: number; section: string; stopAngleDeg: number };
  tether: { lengthM: number; diameterM: number };
  float: { diameterM: number; heightM: number; displacementL: number };
  sub: { diameterM: number; lengthM: number; netWeightN: number };
  site: Site;
}

/** @description Stop angles below this are outside what the study modelled (its own limit row). */
export const MODELLED_STOP_FLOOR_DEG = 15;

/** @description Refuse a kind that declares no limits, no required figures, or a force model with no declared envelope (D4, D7).
 * @param kind - The kind. @returns The same kind. @throws Error naming the kind. */
export function assertKindDeclared(kind: VehicleKind): VehicleKind {
  if (!kind.limits.length) throw new Error(`ocean-lab: kind "${kind.id}" declares no limits — "what is not true" is a required field, not a courtesy (ADR-160 D4)`);
  if (!kind.requiredFigures.length) throw new Error(`ocean-lab: kind "${kind.id}" declares no required figures, so nothing could ever be sized`);
  const declared = new Set(listEnvelopes().map((e) => e.id));
  const undeclared = kind.forceModels.filter((m) => !declared.has(m));
  if (undeclared.length) throw new Error(`ocean-lab: kind "${kind.id}" names force models with no declared envelope: ${undeclared.join(', ')} (ADR-160 D7)`);
  return kind;
}

/** The explorer's kind. The eight limit rows are the design study's "What is not true" section, sentence by sentence. */
export const EXPLORER_KIND: VehicleKind = assertKindDeclared({
  id: 'wave-explorer',
  lab: 'ocean-lab',
  label: 'Wave explorer — a surface float and a tethered sub whose wings turn wave heave into thrust',
  requiredFigures: ['meanSpeedMs', 'meanKnots', 'underWayFraction', 'kmPerDay', 'kmPerYear'],
  fabricationOutputs: [],
  forceModels: ['wave-propulsion'],
  limits: [
    { id: 'nothing-built', sentence: 'Nothing was built. No hardware exists. No tank test, no sea trial, no physical validation of any kind.', retireWhen: 'a measured quantity from a physical explorer (a tank or sea speed, a weighed part) is recorded against its designed value', blocking: true },
    { id: 'no-real-site-data', sentence: 'No site data is real. Every tidal constituent set and soil profile is an illustrative parameter set, labelled as such in the code. No verdict here is site-specific.', retireWhen: "the site's sea-state heights, periods and occurrence mix (which the report also calls an illustrative parameter set, not a survey) are replaced by a surveyed record and its provenance names the survey", blocking: false },
    { id: 'drag-correlation-stack', sentence: 'Drag is a correlation stack, not a solved boundary layer. Section C_D should be read as roughly 1.2–1.5× conservative.', retireWhen: 'section drag at the explorer\'s Reynolds numbers is measured or solved with a boundary-layer method and the polar is re-pointed at it', blocking: false },
    { id: 'no-structural-analysis', sentence: 'No structural analysis. Nobody has checked whether a printed wing survives hinge loads at 2 knots in a 2 m sea. That may push the part out of print entirely.', retireWhen: 'a structural check of each wing and hinge under the rough-row loads and the annual cycle count is recorded against the current vector', blocking: true },
    { id: 'shallow-stops-unmodelled', sentence: 'Wave-glider stop angles below ~15° are unmodelled. The sweep says shallower is faster all the way down to 5°; real vehicles use 20–25°. Hinge loads, control authority and tether snatch are absent from the model.', retireWhen: 'hinge load, control authority and tether snatch are modelled and the sweep is re-run below 15 degrees', blocking: false },
    { id: 'no-self-intersection-check', sentence: 'The mesh validator does not check self-intersection. Topology is verified closed and manifold. A sufficiently twisted loft could pass every check and still be unprintable.', retireWhen: 'every part is validated for self-intersection by the kernel that exports it', blocking: true },
    { id: 'no-physics-parity', sentence: 'Two physics implementations exist with no parity test. The browser consoles mirror the server models; nothing asserts they agree on a single number.', retireWhen: 'a parity test asserts the browser consoles and the server models agree on shared numbers', blocking: false },
    { id: 'hand-built', sentence: 'This never ran in the swarm. No ticket, no bot-node, no manifest, no persona. It was built by hand with scripts. That is a process failure, not a modelling one.', retireWhen: 'every figure on the record is produced from its stored vector by the package, and the study\'s own figures are reproduced from the seed by the regression', blocking: false },
  ],
});

type Check = (ok: boolean, message: string) => void;

/** @description A finite number inside [lo, hi]. */
function within(value: unknown, lo: number, hi: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi;
}

/** @description Validate the wings, tether, float and sub. */
function checkHardware(v: ExplorerVector, check: Check): void {
  check(Number.isInteger(v.wings?.count) && within(v.wings.count, 1, 16), 'wings.count must be an integer in [1, 16]');
  check(within(v.wings?.spanM, 0.02, 1), 'wings.spanM must be in [0.02, 1] m');
  check(within(v.wings?.chordM, 0.01, 0.3), 'wings.chordM must be in [0.01, 0.3] m');
  check(typeof v.wings?.section === 'string' && /^NACA \d{4}$/.test(v.wings.section) && within(Number(v.wings.section.slice(-2)), 6, 24), 'wings.section must be a NACA 4-digit section 6-24 % thick, e.g. "NACA 0012"');
  check(within(v.wings?.stopAngleDeg, 5, 45), 'wings.stopAngleDeg must be in [5, 45] degrees');
  check(within(v.tether?.lengthM, 0.5, 20), 'tether.lengthM must be in [0.5, 20] m');
  check(within(v.tether?.diameterM, 0.001, 0.05), 'tether.diameterM must be in [0.001, 0.05] m');
  check(within(v.float?.diameterM, 0.05, 2) && within(v.float?.heightM, 0.05, 3), 'float.diameterM must be in [0.05, 2] m and float.heightM in [0.05, 3] m');
  const volumeL = Math.PI * (v.float?.diameterM / 2) ** 2 * v.float?.heightM * 1000;
  check(within(v.float?.displacementL, 0.1, volumeL), `float.displacementL must be positive and at most the float's own volume (${volumeL.toFixed(1)} L)`);
  check(within(v.sub?.diameterM, 0.02, 1) && within(v.sub?.lengthM, 0.05, 3), 'sub.diameterM must be in [0.02, 1] m and sub.lengthM in [0.05, 3] m');
  check(within(v.sub?.netWeightN, 0.1, 1000), 'sub.netWeightN (its weight in water) must be in [0.1, 1000] N');
}

/** @description Validate the site's sea-state table. */
function checkSite(site: Site, check: Check): void {
  const states = Array.isArray(site?.seaStates) ? site.seaStates : [];
  check(typeof site?.name === 'string' && site.name.length > 0 && site.name.length <= 120, 'site.name must be a non-empty string');
  check(within(site?.underWayMinSpeedMs, 0, 1), 'site.underWayMinSpeedMs must be in [0, 1] m/s');
  check(states.length >= 1 && states.length <= 10, 'site.seaStates must hold 1-10 rows');
  for (const s of states) {
    check(typeof s?.id === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(s.id) && typeof s.label === 'string' && s.label.length <= 60, `sea state ${JSON.stringify(s?.id)} needs a lowercase id and a label`);
    check(within(s?.heightM, 0.01, 15) && within(s?.periodS, 1, 30) && within(s?.occurrence, 0, 1), `sea state ${s?.id}: heightM in [0.01, 15] m, periodS in [1, 30] s, occurrence in [0, 1]`);
  }
  const total = states.reduce((sum, s) => sum + (Number(s?.occurrence) || 0), 0);
  check(Math.abs(total - 1) <= 1e-6, `site.seaStates occurrences must sum to 1 (they sum to ${total})`);
}

/** @description Every reason a posted vector is not an explorer design vector. @param vector - Anything. @returns The problems; empty when valid. */
export function validateExplorerVector(vector: unknown): string[] {
  const problems: string[] = [];
  const check: Check = (ok, message) => { if (!ok) problems.push(message); };
  if (!vector || typeof vector !== 'object' || Array.isArray(vector)) return ['the design vector must be an object'];
  const v = vector as ExplorerVector;
  checkHardware(v, check);
  checkSite(v.site, check);
  return problems;
}

/** @description A NACA 4-digit designation as the section polar reads it. @param section - e.g. "NACA 0012". @returns The spec. */
export function nacaSpec(section: string): NacaSpec {
  const digits = section.slice(-4);
  return { maxCamber: Number(digits[0]) / 100, camberPos: Number(digits[1]) / 10, thickness: Number(digits.slice(2)) / 100 };
}

/** @description The derived geometry, shown beside the table so a person can see what their vector implied. */
export interface ExplorerGeometry {
  floatDraftM: number;
  floatWettedM2: number;
  subWettedM2: number;
  tetherWettedM2: number;
  formFactor: number;
  wingAreaM2: number;
  wingAspectRatio: number;
}

/**
 * @description Derive what the model reads from what a person typed (D1). The float floats at the
 * draft its displacement fills; the float's, the sub's and the tether's wetted areas sum into the
 * report's one S_wet; its one friction line is taken at the sub's length (the longest body running
 * along the flow); and its one k_form is Hoerner's body-of-revolution form factor at the sub's
 * fineness, 1 + 1.5(D/L)^1.5 + 7(D/L)^3.
 * @param v - A valid explorer vector. @returns The model's vehicle and the derived geometry.
 */
export function deriveWaveVehicle(v: ExplorerVector): { vehicle: WaveVehicle; geometry: ExplorerGeometry } {
  const floatRadius = v.float.diameterM / 2;
  const floatDraftM = v.float.displacementL / 1000 / (Math.PI * floatRadius ** 2);
  const floatWettedM2 = Math.PI * v.float.diameterM * floatDraftM + Math.PI * floatRadius ** 2;
  const subWettedM2 = Math.PI * v.sub.diameterM * v.sub.lengthM + 2 * Math.PI * (v.sub.diameterM / 2) ** 2;
  const tetherWettedM2 = Math.PI * v.tether.diameterM * v.tether.lengthM;
  const fineness = v.sub.diameterM / v.sub.lengthM;
  const formFactor = 1 + 1.5 * fineness ** 1.5 + 7 * fineness ** 3;
  const vehicle: WaveVehicle = {
    wingCount: v.wings.count, wingSpanM: v.wings.spanM, wingChordM: v.wings.chordM, section: nacaSpec(v.wings.section),
    stopAngleRad: (v.wings.stopAngleDeg * Math.PI) / 180, floatDisplacementM3: v.float.displacementL / 1000,
    subNetWeightN: v.sub.netWeightN, formFactor,
    wetted: [
      { id: 'float', areaM2: floatWettedM2 },
      { id: 'sub', areaM2: subWettedM2 },
      { id: 'tether', areaM2: tetherWettedM2 },
    ],
    frictionLengthM: v.sub.lengthM,
  };
  const geometry = { floatDraftM, floatWettedM2, subWettedM2, tetherWettedM2, formFactor, wingAreaM2: v.wings.spanM * v.wings.chordM, wingAspectRatio: v.wings.spanM / v.wings.chordM };
  return { vehicle, geometry };
}

/** @description What this engine does not model, carried on every run so no number is read past it. */
export const NOT_MODELLED: readonly string[] = Object.freeze([
  'free-surface hydrodynamics of the float: waterplane stiffness, wave-making and slamming — the float is taken to follow the surface exactly',
  "the float's residuary (wave-making) resistance C_R(Fr): the report names the term and publishes no curve, so this engine carries none and drag is optimistic at high Froude number",
  'wave orbital motion at the sub\'s depth: the sub heaves against still water, as the report\'s w(t) = A*omega*cos(omega*t) takes it; the tether acts only through its wetted area',
  'cross-flow (pressure) drag on the tether; added mass and radiation damping; cavitation; hinge loads, control authority and tether snatch',
]);

/** @description An evaluation of an explorer vector in a medium: the figures the kind requires, the table, the geometry, and the model's own caveats. */
export interface ExplorerEvaluation {
  figures: { meanSpeedMs: number; meanKnots: number; underWayFraction: number; kmPerDay: number; kmPerYear: number };
  seaStates: SeaStateEvaluation['rows'];
  geometry: ExplorerGeometry;
  medium: { id: string; label: string; densityKgM3: number; dynamicViscosityPaS: number; freeSurface: Medium['freeSurface'] };
  withinModel: { ok: boolean; notes: string[] };
  notModelled: readonly string[];
  engine: { id: string; version: string };
}

/**
 * @description Evaluate an explorer vector in a medium. The medium is asked, never assumed: the
 * envelope first (vacuum is declined), then every property the model declared — so air is refused
 * as `medium_property_unavailable: freeSurface`, a refusal rather than a quiet zero — then the sub's
 * depth against the medium's band.
 * @param v - A valid explorer vector. @param medium - The medium to run it in.
 * @returns The evaluation. @throws MediumRefusal by name.
 */
export function evaluateExplorer(v: ExplorerVector, medium: Medium): ExplorerEvaluation {
  requireMediumProperties('wave-propulsion', medium);
  const surface = medium.freeSurface as NonNullable<Medium['freeSurface']>;
  requireWithinValidity(medium, surface.heightM);
  requireWithinValidity(medium, surface.heightM - v.tether.lengthM);
  const fluid: Fluid = { densityKgM3: medium.densityKgM3, kinematicViscosityM2S: kinematicViscosityM2S(medium), gravityMps2: gravityMagnitude(medium) };
  const { vehicle, geometry } = deriveWaveVehicle(v);
  const table = evaluateSeaStates(vehicle, fluid, { name: v.site.name, underWayMinSpeedMs: v.site.underWayMinSpeedMs, seaStates: v.site.seaStates as SeaState[] });
  const notes: string[] = [];
  if (v.wings.stopAngleDeg < MODELLED_STOP_FLOOR_DEG) notes.push(`stop angle ${v.wings.stopAngleDeg} deg is below the ~${MODELLED_STOP_FLOOR_DEG} deg the study modelled (limit shallow-stops-unmodelled): the table is computed, and it is outside the model`);
  return {
    figures: { meanSpeedMs: table.meanSpeedMs, meanKnots: table.meanKnots, underWayFraction: table.underWayFraction, kmPerDay: table.kmPerDay, kmPerYear: table.kmPerYear },
    seaStates: table.rows,
    geometry,
    medium: { id: medium.id, label: medium.label, densityKgM3: medium.densityKgM3, dynamicViscosityPaS: medium.dynamicViscosityPaS, freeSurface: medium.freeSurface },
    withinModel: { ok: notes.length === 0, notes },
    notModelled: NOT_MODELLED,
    engine: { id: WAVE_ENGINE.id, version: WAVE_ENGINE.version },
  };
}

export { MediumRefusal };
