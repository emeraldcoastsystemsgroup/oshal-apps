"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — Wavefront OBJ. OBJ indices are 1-BASED, which
 *                     |                             | is the single most-repeated bug in every hand-rolled exporter:
 *                     |                             | a 0-based file loads without complaint, silently drops the last
 *                     |                             | facet and shifts every other one by a vertex, so the model
 *                     |                             | looks *almost* right. The +1 lives in exactly one expression
 *                     |                             | here, and the spec asserts the emitted range.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toObj = toObj;
const logger_1 = require("@/shared/logger");
const format_number_1 = require("./format-number");
const mesh_metrics_1 = require("./mesh-metrics");
const export_stl_1 = require("./export-stl");
const log = (0, logger_1.createChildLogger)({ module: 'shared/geometry/export-obj' });
/**
 * @description Serialise a mesh as Wavefront OBJ: one `v` per vertex, one `vn` per facet, one `f`
 * per facet. Unlike STL, OBJ keeps the mesh INDEXED — a shared vertex stays one vertex — which is
 * why it is the right handover format to a CAD or DCC tool that will keep editing the model, and
 * why an STL round-trip is not a substitute.
 * @param mesh - Mesh to write.
 * @param name - Object name for the `o` line; sanitised to a single token. Default `oshal_mesh`.
 * @returns The complete file text, newline-terminated.
 * @throws RangeError when a facet references a missing vertex or a coordinate is not finite.
 */
function toObj(mesh, name = 'oshal_mesh') {
    const object = (0, export_stl_1.sanitizeSolidName)(name, 'oshal_mesh');
    const normals = (0, mesh_metrics_1.recomputeNormals)(mesh);
    const lines = [
        '# oshal geometry OBJ export',
        `# vertices ${mesh.vertices.length} triangles ${mesh.triangles.length}`,
        `o ${object}`,
    ];
    for (const vertex of mesh.vertices) {
        lines.push(`v ${(0, format_number_1.formatFloat)(vertex.x)} ${(0, format_number_1.formatFloat)(vertex.y)} ${(0, format_number_1.formatFloat)(vertex.z)}`);
    }
    for (const normal of normals) {
        lines.push(`vn ${(0, format_number_1.formatFloat)(normal.x)} ${(0, format_number_1.formatFloat)(normal.y)} ${(0, format_number_1.formatFloat)(normal.z)}`);
    }
    mesh.triangles.forEach((triangle, index) => {
        const normalRef = index + 1;
        const corners = triangle.map((vertexIndex) => `${vertexIndex + 1}//${normalRef}`);
        lines.push(`f ${corners.join(' ')}`);
    });
    log.debug({ vertices: mesh.vertices.length, faces: mesh.triangles.length, object }, 'wrote OBJ');
    return `${lines.join('\n')}\n`;
}
