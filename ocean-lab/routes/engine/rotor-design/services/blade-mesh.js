"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the aerodynamic blade turned into a printable
 *                     |                             | solid. All of the mesh topology lives in @/shared/geometry; this
 *                     |                             | file's entire job is the DOMAIN mapping — chord becomes scale,
 *                     |                             | twist becomes in-plane rotation, the quarter-chord becomes the
 *                     |                             | pivot, and radius becomes the span coordinate. Keeping it that
 *                     |                             | thin is deliberate: the watertightness argument is made once,
 *                     |                             | in the shared slice, and a rotor cannot weaken it by having
 *                     |                             | opinions about vertex order.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PITCH_AXIS_CHORD_FRACTION = void 0;
exports.bladeToMesh = bladeToMesh;
const logger_1 = require("@/shared/logger");
const geometry_1 = require("../../geometry");
const naca_section_1 = require("./naca-section");
const log = (0, logger_1.createChildLogger)({ module: 'features/rotor-design/blade-mesh' });
/**
 * @description Chordwise position of the pitch axis, as a fraction of chord. The quarter-chord is
 * where a thin section's aerodynamic centre sits, so twisting about it keeps the twist schedule
 * and the aerodynamic model describing the same blade.
 */
exports.PITCH_AXIS_CHORD_FRACTION = 0.25;
/**
 * @description Loft a blade into a watertight triangle mesh, ready to export and print.
 *
 * One section is placed per design station: scaled by that station's chord, rotated by minus its
 * total blade angle (twist plus collective pitch — negative because a nose-up blade angle rotates
 * the leading edge towards the oncoming flow, which is clockwise in the section's own plane), and
 * translated out along +Z to its radius. Root and tip are capped, so the result is a closed solid
 * rather than an open shell.
 *
 * The result is only watertight if the caller does not defeat it: every section is built with the
 * same station count so the lofted strip has matching rings, and the NACA trailing edge closes
 * exactly (see {@link nacaSection}). Check the result with `validateMesh` before exporting —
 * that check is cheap and a failed print is not.
 * @param blade - The blade. See {@link BladeSpec}. Needs at least two stations.
 * @param sectionPoints - Chordwise stations per surface for every section. Default
 * {@link DEFAULT_SECTION_STATIONS}; each section becomes `2 · sectionPoints − 2` outline points.
 * @returns The lofted blade as an indexed triangle mesh, in metres.
 * @throws RangeError when the blade has fewer than two stations, or a station has a non-positive
 * chord (both would produce a degenerate loft).
 */
function bladeToMesh(blade, sectionPoints = naca_section_1.DEFAULT_SECTION_STATIONS) {
    if (blade.stations.length < 2) {
        throw new RangeError(`A blade mesh needs at least 2 stations, received ${blade.stations.length}`);
    }
    const sorted = [...blade.stations].sort((a, b) => a.radiusFrac - b.radiusFrac);
    const placed = sorted.map((station) => {
        if (!(station.chordM > 0)) {
            throw new RangeError(`Station at radiusFrac ${station.radiusFrac} has a non-positive chord`);
        }
        const angleRad = ((station.twistDeg + blade.pitchDeg) * Math.PI) / 180;
        return (0, geometry_1.placeSection)((0, naca_section_1.nacaSection)(station.section, sectionPoints), {
            origin: { x: 0, y: 0, z: station.radiusFrac * blade.tipRadiusM },
            scale: station.chordM,
            rotationRad: -angleRad,
            pivot: { x: exports.PITCH_AXIS_CHORD_FRACTION, y: 0 },
            uAxis: { x: 1, y: 0, z: 0 },
            vAxis: { x: 0, y: 1, z: 0 },
        });
    });
    const mesh = (0, geometry_1.loftSections)(placed);
    log.debug({ stations: placed.length, sectionPoints, vertices: mesh.vertices.length, triangles: mesh.triangles.length }, 'lofted a rotor blade into a printable mesh');
    return mesh;
}
