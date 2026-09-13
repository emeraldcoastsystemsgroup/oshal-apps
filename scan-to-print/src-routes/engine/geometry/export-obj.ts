/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Vendored from the ocean-lab geometry slice: Wavefront OBJ. OBJ
 *                     |                             | indices are 1-BASED — the +1 lives in exactly one expression
 *                     |                             | here. Logger import dropped — pure engine.
 */

import type { TriMesh } from './geometry-types';
import { formatFloat } from './format-number';
import { recomputeNormals } from './mesh-metrics';
import { sanitizeSolidName } from './export-stl';

/**
 * @description Serialise a mesh as Wavefront OBJ: one `v` per vertex, one `vn` per facet, one `f`
 * per facet. OBJ keeps the mesh INDEXED, which is why it is the right handover format to a CAD
 * tool that will keep editing the model.
 * @param mesh - Mesh to write.
 * @param name - Object name for the `o` line; sanitised to a single token. Default `oshal_part`.
 * @returns The complete file text, newline-terminated.
 * @throws RangeError when a facet references a missing vertex or a coordinate is not finite.
 */
export function toObj(mesh: TriMesh, name = 'oshal_part'): string {
  const object = sanitizeSolidName(name, 'oshal_part');
  const normals = recomputeNormals(mesh);
  const lines: string[] = [
    '# oshal scan-to-print OBJ export',
    `# vertices ${mesh.vertices.length} triangles ${mesh.triangles.length}`,
    `o ${object}`,
  ];
  for (const vertex of mesh.vertices) {
    lines.push(`v ${formatFloat(vertex.x)} ${formatFloat(vertex.y)} ${formatFloat(vertex.z)}`);
  }
  for (const normal of normals) {
    lines.push(`vn ${formatFloat(normal.x)} ${formatFloat(normal.y)} ${formatFloat(normal.z)}`);
  }
  mesh.triangles.forEach((triangle, index) => {
    const normalRef = index + 1;
    const corners = triangle.map((vertexIndex) => `${vertexIndex + 1}//${normalRef}`);
    lines.push(`f ${corners.join(' ')}`);
  });
  return `${lines.join('\n')}\n`;
}
