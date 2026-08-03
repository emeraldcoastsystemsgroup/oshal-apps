/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the NACA 4-digit section in closed form. Two
 *                     |                             | choices are load-bearing and neither is cosmetic. The last
 *                     |                             | thickness coefficient is −0.1036, not the more commonly quoted
 *                     |                             | −0.1015: −0.1036 makes the polynomial sum to exactly zero at
 *                     |                             | x = 1, so the trailing edge CLOSES. The −0.1015 form leaves a
 *                     |                             | ~0.2 %c gap, which lofts into a slot down the trailing edge of
 *                     |                             | the blade, which is a non-manifold mesh, which does not slice.
 *                     |                             | And the chordwise stations are COSINE-spaced: uniform spacing
 *                     |                             | puts the same panel length at the leading edge as at mid-chord,
 *                     |                             | which under-resolves the suction peak (corrupting the panel
 *                     |                             | solution) and flattens the printed nose radius.
 */

import { createChildLogger } from '@/shared/logger';
import type { Point2D, Section2D } from '../../geometry';
import type { NacaSpec } from '../model/rotor-types';

const log = createChildLogger({ module: 'features/rotor-design/naca-section' });

/**
 * @description Thickness-law coefficients. The last term is −0.1036 (closed trailing edge), NOT
 * the −0.1015 of the original open-TE report — see the change log for why that is a printability
 * requirement rather than a preference.
 */
const THICKNESS_COEFFICIENTS = [0.2969, -0.126, -0.3516, 0.2843, -0.1036] as const;

/** @description Default chordwise stations per surface. 80 resolves the leading edge under cosine spacing. */
export const DEFAULT_SECTION_STATIONS = 80;

/**
 * @description Half-thickness of a NACA 4-digit section at a chordwise position.
 * @param x - Chordwise position, 0..1 (fraction of chord).
 * @param thickness - Maximum thickness as a fraction of chord.
 * @returns Half-thickness `yt` as a fraction of chord. Exactly 0 at x = 0 and x = 1.
 * @throws RangeError when x lies outside [0, 1] or thickness is negative.
 */
export function nacaThickness(x: number, thickness: number): number {
  if (!(x >= 0 && x <= 1)) throw new RangeError(`NACA thickness needs 0 <= x <= 1, received ${x}`);
  if (!(thickness >= 0)) throw new RangeError(`NACA thickness fraction must be >= 0, received ${thickness}`);
  const [c0, c1, c2, c3, c4] = THICKNESS_COEFFICIENTS;
  const series = c0 * Math.sqrt(x) + c1 * x + c2 * x * x + c3 * x ** 3 + c4 * x ** 4;
  return 5 * thickness * series;
}

/**
 * @description Mean camber line ordinate and slope at a chordwise position.
 *
 * A section with `maxCamber === 0` degrades to a symmetric section REGARDLESS of `camberPos`,
 * including `camberPos === 0`. That guard matters: "NACA 0012" carries a second digit of 0, so the
 * naive `m / p²` divides by zero on the most common section anyone will ask for.
 * @param x - Chordwise position, 0..1.
 * @param maxCamber - Maximum camber as a fraction of chord.
 * @param camberPos - Chordwise position of maximum camber, fraction of chord.
 * @returns `{ yc, slope }` — camber ordinate and `dyc/dx`, both as fractions of chord.
 * @throws RangeError when a genuinely cambered section names a camber position outside (0, 1).
 */
export function nacaCamber(
  x: number,
  maxCamber: number,
  camberPos: number,
): { yc: number; slope: number } {
  if (maxCamber === 0) return { yc: 0, slope: 0 };
  if (!(camberPos > 0 && camberPos < 1)) {
    throw new RangeError(`A cambered NACA section needs 0 < camberPos < 1, received ${camberPos}`);
  }
  if (x < camberPos) {
    const k = maxCamber / (camberPos * camberPos);
    return { yc: k * (2 * camberPos * x - x * x), slope: 2 * k * (camberPos - x) };
  }
  const k = maxCamber / ((1 - camberPos) * (1 - camberPos));
  return { yc: k * (1 - 2 * camberPos + 2 * camberPos * x - x * x), slope: 2 * k * (camberPos - x) };
}

/**
 * @description Cosine-spaced chordwise stations on [0, 1]: `x_i = ½(1 − cos(πi/(n−1)))`.
 * Clustered at both ends, which is what the leading edge needs and the trailing edge tolerates.
 * @param count - Number of stations, at least 3.
 * @returns Ascending stations, exactly 0 at the first and exactly 1 at the last.
 * @throws RangeError when fewer than 3 stations are requested.
 */
export function cosineStations(count: number): number[] {
  if (!Number.isInteger(count) || count < 3) {
    throw new RangeError(`Cosine spacing needs at least 3 integer stations, received ${count}`);
  }
  const stations: number[] = [];
  for (let i = 0; i < count; i += 1) stations.push(0.5 * (1 - Math.cos((Math.PI * i) / (count - 1))));
  stations[0] = 0;
  stations[count - 1] = 1;
  return stations;
}

/**
 * @description Number of outline points {@link nacaSection} returns for a given station count.
 * Exposed so a caller sizing a mesh (or a guard asserting a byte count) does not have to
 * re-derive the "two surfaces, leading and trailing edges shared once" arithmetic.
 * @param stationsPerSurface - Chordwise stations per surface.
 * @returns `2 · stationsPerSurface − 2`.
 */
export function sectionRingLength(stationsPerSurface: number): number {
  return 2 * stationsPerSurface - 2;
}

/**
 * @description Build the closed outline of a NACA 4-digit section, chord normalised to 1.
 *
 * Points run trailing edge → upper surface → leading edge → lower surface, stopping one station
 * short of the trailing edge on the way back. The closing point is deliberately NOT repeated: a
 * repeated point is a zero-length edge, a zero-length edge lofts into a zero-area facet, and a
 * zero-area facet is exactly what a slicer refuses. The leading edge is likewise shared rather
 * than duplicated. Traversal is counter-clockwise in the (x, y) plane.
 * @param spec - The section, as fractions. See {@link NacaSpec}.
 * @param stationsPerSurface - Chordwise stations per surface. Default {@link DEFAULT_SECTION_STATIONS}.
 * @returns A closed 2-D profile of `2 · stationsPerSurface − 2` points.
 * @throws RangeError for a non-positive thickness, or a cambered section with an invalid camber
 * position (both propagate from {@link nacaThickness} / {@link nacaCamber}).
 */
export function nacaSection(spec: NacaSpec, stationsPerSurface = DEFAULT_SECTION_STATIONS): Section2D {
  const stations = cosineStations(stationsPerSurface);
  const upper: Point2D[] = [];
  const lower: Point2D[] = [];
  for (const x of stations) {
    const yt = nacaThickness(x, spec.thickness);
    const { yc, slope } = nacaCamber(x, spec.maxCamber, spec.camberPos);
    const theta = Math.atan(slope);
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    upper.push({ x: x - yt * sin, y: yc + yt * cos });
    lower.push({ x: x + yt * sin, y: yc - yt * cos });
  }
  const points = upper.slice(1).reverse().concat(upper[0], lower.slice(1, lower.length - 1));
  log.debug({ spec, stationsPerSurface, points: points.length }, 'built NACA 4-digit section outline');
  return { points };
}
