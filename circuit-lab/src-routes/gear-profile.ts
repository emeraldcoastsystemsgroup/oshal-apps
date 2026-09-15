/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the gear-to-CAD-Studio hand-off: a spur
 *                     |                             | gear's involute outline (teeth, module, pressure angle) as
 *                     |                             | a closed polygon in millimetres, and the exact body CAD
 *                     |                             | Studio's POST /models takes (a `sketch` base extruded by
 *                     |                             | the face width plus a `hole` for the bore). Pure geometry:
 *                     |                             | no I/O, no framework import; a cross-package spec
 *                     |                             | validates the body against CAD Studio's own contract.
 */

import type { CircuitPart } from './circuit-contract';

/** CAD Studio's sketch base takes at most this many points. */
export const CAD_SKETCH_MAX_POINTS = 2000;
/** Above this many teeth the outline would exceed the sketch limit at a usable resolution. */
export const MAX_TEETH_FOR_CAD = 120;

const inv = (a: number): number => Math.tan(a) - a;

/** @description What one gear needs to become a solid. */
export interface GearSpec { teeth: number; moduleMm: number; pressureAngleDeg: number; faceWidthMm: number; boreMm: number }

/**
 * @description The involute spur-gear outline as a closed polygon (counter-clockwise, centred on the axis).
 * Flanks are true involutes between the base circle (or the root circle, when that lies above the
 * base circle — gears above ~41 teeth) and the tip; below the base circle the flank runs radially
 * to the root circle; roots and tips are short arcs.
 * @param spec - Teeth, module and pressure angle (face width and bore are not used here).
 * @returns Points in mm as [x, y].
 */
export function involuteOutline(spec: GearSpec): Array<[number, number]> {
  const n = Math.round(spec.teeth), m = spec.moduleMm, alpha = (spec.pressureAngleDeg * Math.PI) / 180;
  const rp = (m * n) / 2, rb = rp * Math.cos(alpha), ra = rp + m, rf = Math.max(rp - 1.25 * m, rb * 0.9);
  const halfPitch = Math.PI / (2 * n) + inv(alpha);          // half tooth thickness angle at the base circle
  const halfTip = halfPitch - inv(Math.acos(rb / ra));       // at the tip
  const steps = n <= 40 ? 6 : n <= 80 ? 4 : 3;
  const pts: Array<[number, number]> = [];
  const at = (r: number, ang: number): [number, number] => [Number((r * Math.cos(ang)).toFixed(4)), Number((r * Math.sin(ang)).toFixed(4))];
  const rmin = Math.max(rb, rf);
  const flank = (r: number): number => halfPitch - inv(Math.acos(rb / r)); // half-thickness angle of the involute at radius r
  for (let k = 0; k < n; k += 1) {
    const c = (2 * Math.PI * k) / n;
    // leading flank: (a radial piece from the root up to the base circle when the root lies below it),
    // then the involute from rmin to the tip, in increasing angle order
    if (rf < rb) pts.push(at(rf, c - halfPitch));
    for (let i = 0; i <= steps; i += 1) {
      const r = rmin + ((ra - rmin) * i) / steps;
      pts.push(at(r, c - flank(r)));
    }
    // tip arc, then the trailing flank mirrored
    pts.push(at(ra, c + halfTip));
    for (let i = steps - 1; i >= 0; i -= 1) {
      const r = rmin + ((ra - rmin) * i) / steps;
      pts.push(at(r, c + flank(r)));
    }
    if (rf < rb) pts.push(at(rf, c + halfPitch));
    // root arc midpoint to the next tooth
    pts.push(at(rf, c + Math.PI / n));
  }
  return pts;
}

/** @description Read the gear's CAD numbers from a validated gear part. */
export function gearSpecOf(part: CircuitPart): GearSpec {
  const p = part.props;
  return { teeth: Number(p.teeth), moduleMm: Number(p.moduleMm), pressureAngleDeg: Number(p.pressureAngleDeg ?? 20), faceWidthMm: Number(p.faceWidthMm ?? 8), boreMm: Number(p.boreMm ?? 0) };
}

/**
 * @description The body for `POST /api/cad-studio/models`: a sketch base (the outline, XY plane,
 * extruded by the face width) plus a through-hole for the bore when one is set.
 * @param part - A validated `gear` part.
 * @param overrides - Optional face width / bore from the request.
 * @param source - Provenance recorded on the CAD model.
 * @returns The request body, or a refusal reason.
 */
export function cadStudioBody(part: CircuitPart, overrides: { faceWidthMm?: number; boreMm?: number }, source: Record<string, unknown>): { ok: true; body: Record<string, unknown>; outline: { pitchRadiusMm: number; tipRadiusMm: number; points: number } } | { ok: false; reason: string } {
  if (part.type !== 'gear') return { ok: false, reason: `${part.id} is a ${part.type}, not a gear` };
  const spec = { ...gearSpecOf(part), ...(overrides.faceWidthMm !== undefined ? { faceWidthMm: overrides.faceWidthMm } : {}), ...(overrides.boreMm !== undefined ? { boreMm: overrides.boreMm } : {}) };
  if (spec.teeth > MAX_TEETH_FOR_CAD) return { ok: false, reason: `${spec.teeth} teeth would need more than ${CAD_SKETCH_MAX_POINTS} outline points; at most ${MAX_TEETH_FOR_CAD} teeth can be handed to CAD Studio` };
  if (!(spec.faceWidthMm >= 1 && spec.faceWidthMm <= 200)) return { ok: false, reason: 'faceWidthMm must be between 1 and 200' };
  const rp = (spec.moduleMm * spec.teeth) / 2;
  if (!(spec.boreMm >= 0 && spec.boreMm < 2 * (rp - 1.25 * spec.moduleMm) - 2)) return { ok: false, reason: `boreMm must leave at least 1 mm of rim below the root circle (root diameter ${(2 * (rp - 1.25 * spec.moduleMm)).toFixed(1)} mm)` };
  const points = involuteOutline(spec);
  if (points.length > CAD_SKETCH_MAX_POINTS) return { ok: false, reason: `the outline needs ${points.length} points; CAD Studio takes ${CAD_SKETCH_MAX_POINTS}` };
  const features = spec.boreMm > 0 ? [{ type: 'hole', params: { axis: 'z', x: 0, y: 0, diameter: spec.boreMm }, label: 'bore' }] : [];
  const title = `${part.label || part.id} gear ${spec.teeth}t m${spec.moduleMm}`;
  return { ok: true, body: { title, base: { kind: 'sketch', plane: 'XY', points, height: spec.faceWidthMm }, features, source: { kind: 'circuit-lab', ...source, partId: part.id, teeth: spec.teeth, moduleMm: spec.moduleMm } }, outline: { pitchRadiusMm: rp, tipRadiusMm: rp + spec.moduleMm, points: points.length } };
}
