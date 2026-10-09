/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3 — the explorer's watertight parts as CAD Studio
 *                     |                             | PROGRAMS: a base plus an ordered feature list in CAD Studio's
 *                     |                             | contract (cad-studio/src-routes/feature-contract.ts), in its
 *                     |                             | frame (millimetres, Z up). The same pattern as embodied's
 *                     |                             | airframe (B16), second machine, different lab. The two hulls
 *                     |                             | are the report's drawn outlines REVOLVED; the wings, the rudder
 *                     |                             | and the spindle blades are NACA sections LOFTED from root to tip
 *                     |                             | on their stacking axis, then translated so the footprint is
 *                     |                             | centred on X = Y = 0 and the part rests on Z = 0; the tether is
 *                     |                             | a cylinder. Every dimension the design vector names comes from
 *                     |                             | the vector, every other from explorer-drawings.json. The real
 *                     |                             | kernel (OCCT, in CAD Studio) turns a program into STEP and STL;
 *                     |                             | this module never triangulates anything.
 */

import { nacaSection } from '../rotor-design';
import drawingsFile from './explorer-drawings.json';
import { nacaSpec, type ExplorerVector } from './explorer-kind';
import type { LoftSection, Vec3 } from './mass-properties';

/** @description A base in CAD Studio's contract: the solid a feature list starts from. */
export type CadBaseProgram =
  | { kind: 'box'; sizeX: number; sizeY: number; sizeZ: number }
  | { kind: 'cylinder'; diameter: number; height: number };

/** @description One feature in CAD Studio's contract: `type` and `params` are what its validator checks. */
export interface CadFeatureProgram {
  id: string;
  type: 'revolve' | 'loft' | 'translate';
  params: Record<string, unknown>;
  label?: string;
}

/** @description A whole part for CAD Studio: `POST /api/cad-studio/models` takes exactly this plus a title. */
export interface CadProgram { base: CadBaseProgram; features: CadFeatureProgram[] }

/** @description A program together with the geometry the mass properties are integrated from. */
export interface PartGeometry {
  program: CadProgram;
  /** A revolved part's outer outline, [r, z] mm with z rising; null for a loft or a cylinder. */
  profile: number[][] | null;
  /** A lofted part's sections BEFORE the final translation; null otherwise. */
  sections: LoftSection[] | null;
  /** The translation the program applies last (zero when it applies none). */
  translate: Vec3;
}

/** @description The committed drawing measurements (explorer-drawings.json), typed. */
export const EXPLORER_DRAWINGS = drawingsFile;

/** Stations per surface of every NACA section: 44 gives the 86-point outline the report lifts from its mesh. */
export const SECTION_STATIONS = 44;
/** The side of the square core a loft is unioned onto: small enough to sit inside every section on the stacking axis. */
const LOFT_CORE_MM = 0.9;

/** Round to a micrometre, never -0 (JSON writes -0 as 0, so a program must not hold one it cannot round-trip). */
const round3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;

/**
 * @description A NACA section scaled to a chord, with its stacking point (a fraction of chord along the chord
 * line) at the origin, turned by an angle about that point.
 * @param section - e.g. "NACA 0012". @param chordMm - The chord. @param stackFrac - Where on the chord the origin sits.
 * @param angleDeg - Rotation about the stacking point, degrees. @returns [[x, y], ...] mm, 86 points.
 */
export function foilSection(section: string, chordMm: number, stackFrac: number, angleDeg = 0): number[][] {
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a); const sin = Math.sin(a);
  return nacaSection(nacaSpec(section), SECTION_STATIONS).points.map((p) => {
    const x = (p.x - stackFrac) * chordMm; const y = p.y * chordMm;
    return [round3(x * cos - y * sin), round3(x * sin + y * cos)];
  });
}

/** @description The translation that centres a set of loft sections' footprint on X = Y = 0 and rests it on Z = 0. */
function seatFor(sections: readonly LoftSection[]): Vec3 {
  const xs = sections.flatMap((s) => s.points.map((p) => p[0]));
  const ys = sections.flatMap((s) => s.points.map((p) => p[1]));
  const zMin = Math.min(...sections.map((s) => s.offset));
  return [round3(-(Math.min(...xs) + Math.max(...xs)) / 2), round3(-(Math.min(...ys) + Math.max(...ys)) / 2), round3(-zMin)];
}

/**
 * @description A lofted foil as a program: a thin square core on the stacking axis (inside every section), the
 * loft through the sections unioned onto it, then the seat translation into CAD Studio's frame.
 * @param sections - Rising offsets from 0. @param label - What the loft is. @returns The part geometry.
 */
function loftedFoil(sections: LoftSection[], label: string): PartGeometry {
  const span = sections[sections.length - 1].offset;
  const translate = seatFor(sections);
  return {
    program: {
      base: { kind: 'box', sizeX: LOFT_CORE_MM, sizeY: LOFT_CORE_MM, sizeZ: span },
      features: [
        { id: 'foil', type: 'loft', params: { plane: 'XY', ruled: true, mode: 'add', sections: sections.map((s) => ({ points: s.points, offset: s.offset })) }, label },
        { id: 'seat', type: 'translate', params: { dx: translate[0], dy: translate[1], dz: translate[2] }, label: "centre the footprint on X = Y = 0 and rest the part on Z = 0 (CAD Studio's frame)" },
      ],
    },
    profile: null, sections, translate,
  };
}

/**
 * @description A revolved hull as a program: a thin core cylinder on the axis, the outline revolved about Z
 * unioned onto it. The outline is closed through the axis at both ends.
 * @param profile - [[r, z], ...] z rising from 0. @param label - What the hull is. @returns The part geometry.
 */
function revolvedHull(profile: number[][], label: string): PartGeometry {
  const height = profile[profile.length - 1][1];
  const smallest = Math.min(...profile.map((p) => p[0]));
  const points = [[0, 0], ...profile, [0, round3(height)]];
  return {
    program: {
      base: { kind: 'cylinder', diameter: round3(smallest), height: round3(height) },
      features: [{ id: 'hull', type: 'revolve', params: { plane: 'XZ', axis: 'z', degrees: 360, mode: 'add', points }, label }],
    },
    profile, sections: null, translate: [0, 0, 0],
  };
}

/** @description The float's outer outline, [r, z] mm, scaled from the drawing by the vector's float diameter and height. @param v - The vector. @returns The outline. */
export function floatProfile(v: ExplorerVector): number[][] {
  const { zFrac, rFrac } = EXPLORER_DRAWINGS.float.profile;
  const radius = (v.float.diameterM * 1000) / 2; const height = v.float.heightM * 1000;
  return zFrac.map((z, i) => [round3(rFrac[i] * radius), round3(z * height)]);
}

/** @description The sub body's outer outline, [r, z] mm from the nose, scaled by the vector's sub diameter and length. @param v - The vector. @returns The outline. */
export function subProfile(v: ExplorerVector): number[][] {
  const { xFrac, rFrac } = EXPLORER_DRAWINGS.sub.profile;
  const radius = (v.sub.diameterM * 1000) / 2; const length = v.sub.lengthM * 1000 * EXPLORER_DRAWINGS.sub.bodyLengthFrac;
  return xFrac.map((x, i) => [round3(rFrac[i] * radius), round3(x * length)]);
}

/** @description The float: its drawn outline revolved. @param v - The vector. @returns The part geometry. */
export function floatProgram(v: ExplorerVector): PartGeometry {
  return revolvedHull(floatProfile(v), 'float hull: the report\'s float side elevation, revolved about its axis');
}

/** @description The sub body: its drawn outline revolved, nose at Z = 0. @param v - The vector. @returns The part geometry. */
export function subBodyProgram(v: ExplorerVector): PartGeometry {
  return revolvedHull(subProfile(v), 'sub body: the report\'s side elevation outline, revolved about its axis (nose at Z = 0)');
}

/** @description Where a wing's root section sits and how long the part is: root and tip radius from the sub axis, mm. @param v - The vector. @returns The stations. */
export function wingStations(v: ExplorerVector): { rootRadiusMm: number; tipRadiusMm: number; lengthMm: number } {
  const subRadius = (v.sub.diameterM * 1000) / 2;
  const rootRadiusMm = EXPLORER_DRAWINGS.wing.rootRadiusFrac * subRadius;
  const tipRadiusMm = subRadius + v.wings.spanM * 1000;
  return { rootRadiusMm, tipRadiusMm, lengthMm: round3(tipRadiusMm - rootRadiusMm) };
}

/** @description One wing: the vector's section at the vector's root chord, lofted to the drawn taper, stacked on the pitch axis. @param v - The vector. @returns The part geometry. */
export function wingProgram(v: ExplorerVector): PartGeometry {
  const root = v.wings.chordM * 1000;
  const { lengthMm } = wingStations(v);
  const stack = EXPLORER_DRAWINGS.wing.stackingChordFrac;
  return loftedFoil([
    { points: foilSection(v.wings.section, root, stack), offset: 0 },
    { points: foilSection(v.wings.section, root * EXPLORER_DRAWINGS.wing.taperRatio, stack), offset: lengthMm },
  ], `wing: ${v.wings.section}, root chord ${round3(root)} mm tapering to the drawn ${round3(root * EXPLORER_DRAWINGS.wing.taperRatio)} mm over ${lengthMm} mm, pitch axis at 25 % chord`);
}

/** @description The rudder: NACA 0012 lofted from its drawn root to its drawn tip, stacked on the quarter chord. @returns The part geometry. */
export function rudderProgram(): PartGeometry {
  const r = EXPLORER_DRAWINGS.rudder;
  return loftedFoil([
    { points: foilSection(r.section, r.rootChordMm, r.stackingChordFrac), offset: 0 },
    { points: foilSection(r.section, r.tipChordMm, r.stackingChordFrac), offset: r.heightMm },
  ], `rudder: ${r.section}, ${r.rootChordMm} mm root to ${r.tipChordMm} mm tip over ${r.heightMm} mm, stock on the quarter chord`);
}

/** @description One spindle blade: five stations from root to tip, chord and angle to the rotor plane varying linearly (the drawing's ends). @returns The part geometry. */
export function spindleBladeProgram(): PartGeometry {
  const s = EXPLORER_DRAWINGS.spindle;
  const sections: LoftSection[] = [];
  for (let i = 0; i < s.stations; i += 1) {
    const t = i / (s.stations - 1);
    const chord = s.rootChordMm + t * (s.tipChordMm - s.rootChordMm);
    const angle = s.rootAngleDeg + t * (s.tipAngleDeg - s.rootAngleDeg);
    sections.push({ points: foilSection(s.section, chord, s.stackingChordFrac, angle), offset: round3(t * (s.tipRadiusMm - s.rootRadiusMm)) });
  }
  return loftedFoil(sections, `spindle blade: ${s.section}, ${s.rootChordMm} mm at ${s.rootAngleDeg} deg to ${s.tipChordMm} mm at ${s.tipAngleDeg} deg from the rotor plane, root ${s.rootRadiusMm} mm to tip ${s.tipRadiusMm} mm`);
}

/** @description The tether as a body for placement: a cylinder of the vector's length and diameter. @param v - The vector. @returns The part geometry. */
export function tetherProgram(v: ExplorerVector): PartGeometry {
  return {
    program: { base: { kind: 'cylinder', diameter: round3(v.tether.diameterM * 1000), height: round3(v.tether.lengthM * 1000) }, features: [] },
    profile: null, sections: null, translate: [0, 0, 0],
  };
}
