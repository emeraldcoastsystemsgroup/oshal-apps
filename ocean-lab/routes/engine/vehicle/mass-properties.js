"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3 (D8 item 3) — mass properties computed from a part
 *                     |                             | PROGRAM's own geometry, so an object carries its mass, centre of
 *                     |                             | mass and inertia tensor about that centre in its own frame. Two
 *                     |                             | exact shapes: a ruled loft between closed polygons (the wings,
 *                     |                             | the rudder, the spindle blades), integrated slice by slice with
 *                     |                             | 5-point Gauss-Legendre per segment (exact: every integrand is a
 *                     |                             | polynomial of degree 6 or less in the segment parameter, because
 *                     |                             | a ruled loft's cross-section is the vertex-wise interpolation of
 *                     |                             | its two sections); and a closed thin shell of revolution (the
 *                     |                             | float and the sub body, printed as their skin), integrated band
 *                     |                             | by band. The enclosed volume of a revolved polyline is summed as
 *                     |                             | exact frustums. Nothing here reads a runtime from another package.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.polygonMoments = polygonMoments;
exports.loftMassProperties = loftMassProperties;
exports.loftVolumeAboveMm3 = loftVolumeAboveMm3;
exports.revolveVolumeMm3 = revolveVolumeMm3;
exports.revolveShellMassProperties = revolveShellMassProperties;
exports.cylinderMassProperties = cylinderMassProperties;
/** Gauss-Legendre nodes and weights on [0, 1], five points: exact for polynomials of degree 9 or less. */
const GAUSS = (() => {
    const nodes = [[0, 0.5688888888888889], [0.5384693101056831, 0.4786286704993665], [0.906179845938664, 0.2369268850561891]];
    const out = [];
    for (const [x, w] of nodes) {
        out.push([(1 + x) / 2, w / 2]);
        if (x !== 0)
            out.push([(1 - x) / 2, w / 2]);
    }
    return out;
})();
/**
 * @description Area moments of a simple closed polygon by the shoelace sums, made orientation-free
 * (a clockwise polygon is negated), so a section may be listed either way round.
 * @param points - [[x, y], ...], not repeating the first point.
 * @returns The moments about the origin.
 */
function polygonMoments(points) {
    let a = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < points.length; i += 1) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % points.length];
        const cross = x0 * y1 - x1 * y0;
        a += cross;
        sx += (x0 + x1) * cross;
        sy += (y0 + y1) * cross;
        sxx += (x0 * x0 + x0 * x1 + x1 * x1) * cross;
        syy += (y0 * y0 + y0 * y1 + y1 * y1) * cross;
        sxy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * cross;
    }
    const sign = a < 0 ? -1 : 1;
    return { a: (sign * a) / 2, sx: (sign * sx) / 6, sy: (sign * sy) / 6, sxx: (sign * sxx) / 12, syy: (sign * syy) / 12, sxy: (sign * sxy) / 24 };
}
const ZERO = { v: 0, x: 0, y: 0, z: 0, xx: 0, yy: 0, zz: 0, xy: 0, xz: 0, yz: 0 };
/** @description The polygon a ruled loft passes through at parameter t between two sections with the same point count. */
function interpolate(p, q, t) {
    return p.map((pt, i) => [pt[0] + t * (q[i][0] - pt[0]), pt[1] + t * (q[i][1] - pt[1])]);
}
/** @description Check a loft is integrable here: two or more sections, rising offsets, the same point count in every section. */
function assertLoft(sections) {
    if (sections.length < 2)
        throw new RangeError('a loft needs two or more sections');
    const n = sections[0].points.length;
    sections.forEach((s, i) => {
        if (s.points.length !== n)
            throw new RangeError(`loft section ${i} has ${s.points.length} points; section 0 has ${n} (a ruled loft pairs them vertex by vertex)`);
        if (i > 0 && !(s.offset > sections[i - 1].offset))
            throw new RangeError(`loft section ${i} offset ${s.offset} does not rise above ${sections[i - 1].offset}`);
    });
}
/**
 * @description Volume integrals of a ruled loft between z = zFrom and its last section.
 * @param sections - The loft's sections, rising offsets, equal point counts.
 * @param zFrom - Integrate only above this z (the part of a wing outside the hull); -Infinity for the whole loft.
 * @returns The integrals.
 */
function loftIntegrals(sections, zFrom = -Infinity) {
    assertLoft(sections);
    const acc = { ...ZERO };
    for (let i = 0; i + 1 < sections.length; i += 1) {
        const z0 = sections[i].offset;
        const z1 = sections[i + 1].offset;
        const lo = Math.max(z0, zFrom);
        if (lo >= z1)
            continue;
        const length = z1 - lo;
        for (const [u, w] of GAUSS) {
            const z = lo + u * length;
            const m = polygonMoments(interpolate(sections[i].points, sections[i + 1].points, (z - z0) / (z1 - z0)));
            const dz = w * length;
            acc.v += m.a * dz;
            acc.x += m.sx * dz;
            acc.y += m.sy * dz;
            acc.z += z * m.a * dz;
            acc.xx += m.sxx * dz;
            acc.yy += m.syy * dz;
            acc.zz += z * z * m.a * dz;
            acc.xy += m.sxy * dz;
            acc.xz += z * m.sx * dz;
            acc.yz += z * m.sy * dz;
        }
    }
    return acc;
}
/**
 * @description Mass properties from volume integrals at a density, moved by a translation (the part's final placement).
 * @param g - The integrals about the origin. @param densityKgMm3 - kg per mm^3. @param translate - The move applied after the integrals' frame.
 * @returns The mass properties in the moved frame.
 */
function fromIntegrals(g, densityKgMm3, translate) {
    const m = g.v * densityKgMm3;
    const c = [g.x / g.v, g.y / g.v, g.z / g.v];
    const ixx = densityKgMm3 * (g.yy + g.zz) - m * (c[1] ** 2 + c[2] ** 2);
    const iyy = densityKgMm3 * (g.xx + g.zz) - m * (c[0] ** 2 + c[2] ** 2);
    const izz = densityKgMm3 * (g.xx + g.yy) - m * (c[0] ** 2 + c[1] ** 2);
    const ixy = -densityKgMm3 * g.xy + m * c[0] * c[1];
    const ixz = -densityKgMm3 * g.xz + m * c[0] * c[2];
    const iyz = -densityKgMm3 * g.yz + m * c[1] * c[2];
    return {
        massKg: m, volumeMm3: g.v,
        centreOfMassMm: [c[0] + translate[0], c[1] + translate[1], c[2] + translate[2]],
        inertiaAboutComKgMm2: [[ixx, ixy, ixz], [ixy, iyy, iyz], [ixz, iyz, izz]],
    };
}
/**
 * @description Mass properties of a SOLID ruled loft at a density (a foil printed at 100 % infill).
 * @param sections - The loft's sections as its program lists them. @param densityKgMm3 - kg per mm^3.
 * @param translate - The translation the program applies after the loft (so the centre of mass is in the part's final frame).
 * @returns The mass properties.
 */
function loftMassProperties(sections, densityKgMm3, translate = [0, 0, 0]) {
    return fromIntegrals(loftIntegrals(sections), densityKgMm3, translate);
}
/**
 * @description The volume of a ruled loft above a z plane: what a wing displaces outside the hull its root sits in.
 * @param sections - The loft's sections. @param zFrom - The plane. @returns mm^3.
 */
function loftVolumeAboveMm3(sections, zFrom) {
    return loftIntegrals(sections, zFrom).v;
}
/** @description Check a revolve profile: [r, z] from one end to the other, r >= 0, z rising. */
function assertProfile(profile) {
    if (profile.length < 2)
        throw new RangeError('a revolved profile needs two or more [r, z] points');
    profile.forEach(([r, z], i) => {
        if (!(r >= 0) || !Number.isFinite(z))
            throw new RangeError(`profile point ${i} must have r >= 0 and a finite z`);
        if (i > 0 && !(z >= profile[i - 1][1]))
            throw new RangeError(`profile point ${i} does not rise in z`);
    });
}
/**
 * @description The volume a revolved outline encloses: the outline [r, z] from one end to the other, closed by
 * the two flat end faces and the axis. Exact for a polyline (a sum of frustums).
 * @param profile - [[r, z], ...] with z rising. @returns mm^3.
 */
function revolveVolumeMm3(profile) {
    assertProfile(profile);
    let v = 0;
    for (let i = 0; i + 1 < profile.length; i += 1) {
        const [r0, z0] = profile[i];
        const [r1, z1] = profile[i + 1];
        v += (Math.PI * (z1 - z0) * (r0 * r0 + r0 * r1 + r1 * r1)) / 3;
    }
    return v;
}
/** @description The closed surface of a revolved outline as bands: the bottom disc, the outline, the top disc. */
function shellBands(profile) {
    const first = profile[0];
    const last = profile[profile.length - 1];
    const bands = [[[0, first[1]], [first[0], first[1]]]];
    for (let i = 0; i + 1 < profile.length; i += 1)
        bands.push([[...profile[i]], [...profile[i + 1]]]);
    bands.push([[last[0], last[1]], [0, last[1]]]);
    return bands;
}
/**
 * @description Mass properties of a closed THIN SHELL of revolution (a hull printed as its skin at 0 % infill):
 * dm = rho * wall * dA over the outline and its two end discs, a ring of radius r at height z contributing
 * r^2 to Izz and r^2/2 + z^2 to Ixx and Iyy. A thin-wall estimate: its error is of the order of wall / radius.
 * @param profile - [[r, z], ...] the outer outline, z rising. @param wallMm - The wall. @param densityKgMm3 - kg per mm^3.
 * @returns The mass properties; `volumeMm3` is the WALL's volume, not the enclosed volume.
 */
function revolveShellMassProperties(profile, wallMm, densityKgMm3) {
    assertProfile(profile);
    let area = 0;
    let zArea = 0;
    let rrArea = 0;
    let zzArea = 0;
    for (const [[r0, z0], [r1, z1]] of shellBands(profile)) {
        const slant = Math.hypot(r1 - r0, z1 - z0);
        for (const [u, w] of GAUSS) {
            const r = r0 + u * (r1 - r0);
            const z = z0 + u * (z1 - z0);
            const dA = 2 * Math.PI * r * slant * w;
            area += dA;
            zArea += z * dA;
            rrArea += r * r * dA;
            zzArea += z * z * dA;
        }
    }
    const m = area * wallMm * densityKgMm3;
    const zc = zArea / area;
    const perArea = wallMm * densityKgMm3;
    const izz = perArea * rrArea;
    const ixx = perArea * (rrArea / 2 + zzArea) - m * zc * zc;
    return { massKg: m, volumeMm3: area * wallMm, centreOfMassMm: [0, 0, zc], inertiaAboutComKgMm2: [[ixx, 0, 0], [0, ixx, 0], [0, 0, izz]] };
}
/**
 * @description The centre and inertia of a solid cylinder standing on Z = 0, centred on the Z axis.
 * @param diameterMm - Diameter. @param heightMm - Height. @param massKg - Its mass, or null when unknown (the inertia is then unknown too).
 * @returns Volume and centre always; the inertia only with a mass.
 */
function cylinderMassProperties(diameterMm, heightMm, massKg) {
    const r = diameterMm / 2;
    const volumeMm3 = Math.PI * r * r * heightMm;
    if (massKg === null)
        return { volumeMm3, centreOfMassMm: [0, 0, heightMm / 2], inertiaAboutComKgMm2: null };
    const across = (massKg * (3 * r * r + heightMm * heightMm)) / 12;
    return { volumeMm3, centreOfMassMm: [0, 0, heightMm / 2], inertiaAboutComKgMm2: [[across, 0, 0], [0, across, 0], [0, 0, (massKg * r * r) / 2]] };
}
