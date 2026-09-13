"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Vendored from the ocean-lab geometry slice: Wavefront OBJ. OBJ
 *                     |                             | indices are 1-BASED — the +1 lives in exactly one expression
 *                     |                             | here. Logger import dropped — pure engine.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toObj = toObj;
const format_number_1 = require("./format-number");
const mesh_metrics_1 = require("./mesh-metrics");
const export_stl_1 = require("./export-stl");
/**
 * @description Serialise a mesh as Wavefront OBJ: one `v` per vertex, one `vn` per facet, one `f`
 * per facet. OBJ keeps the mesh INDEXED, which is why it is the right handover format to a CAD
 * tool that will keep editing the model.
 * @param mesh - Mesh to write.
 * @param name - Object name for the `o` line; sanitised to a single token. Default `oshal_part`.
 * @returns The complete file text, newline-terminated.
 * @throws RangeError when a facet references a missing vertex or a coordinate is not finite.
 */
function toObj(mesh, name = 'oshal_part') {
    const object = (0, export_stl_1.sanitizeSolidName)(name, 'oshal_part');
    const normals = (0, mesh_metrics_1.recomputeNormals)(mesh);
    const lines = [
        '# oshal scan-to-print OBJ export',
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
    return `${lines.join('\n')}\n`;
}
//# sourceMappingURL=export-obj.js.map