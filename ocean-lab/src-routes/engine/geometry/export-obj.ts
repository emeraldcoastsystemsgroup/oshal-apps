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

import { createChildLogger } from '@/shared/logger';
import type { TriMesh } from './geometry-types';
import { formatFloat } from './format-number';
import { recomputeNormals } from './mesh-metrics';
import { sanitizeSolidName } from './export-stl';

const log = createChildLogger({ module: 'shared/geometry/export-obj' });

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
export function toObj(mesh: TriMesh, name = 'oshal_mesh'): string {
  const object = sanitizeSolidName(name, 'oshal_mesh');
  const normals = recomputeNormals(mesh);
  const lines: string[] = [
    '# oshal geometry OBJ export',
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
  log.debug({ vertices: mesh.vertices.length, faces: mesh.triangles.length, object }, 'wrote OBJ');
  return `${lines.join('\n')}\n`;
}
