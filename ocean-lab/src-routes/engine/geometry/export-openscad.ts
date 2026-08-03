/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — OpenSCAD export. Two things are load-bearing.
 *                     |                             | (1) The parameter block: the file opens with named assignments
 *                     |                             | for the DESIGN inputs so an engineer can read and edit them in
 *                     |                             | CAD. SCAD does not re-derive the loft from them — the
 *                     |                             | polyhedron below is the baked result — and the header says so,
 *                     |                             | because a parameter that silently does nothing is worse than
 *                     |                             | no parameter. (2) Face winding is REVERSED on the way out:
 *                     |                             | OpenSCAD's polyhedron wants each face clockwise seen from
 *                     |                             | OUTSIDE, the opposite of this slice's (and STL's) convention.
 *                     |                             | Emit our winding verbatim and the solid renders inside out and
 *                     |                             | CGAL calls it a non-2-manifold.
 */

import { createChildLogger } from '@/shared/logger';
import type { OpenScadOptions, TriMesh } from './geometry-types';
import { formatFloat } from './format-number';
import { resolveTriangle } from './vector-math';

const log = createChildLogger({ module: 'shared/geometry/export-openscad' });

/** @description Strings shaped like this are emitted as SCAD vectors, not quoted as strings. */
const NUMERIC_VECTOR = /^\[[\s\d.,+\-eE[\]]*\]$/;

/**
 * @description Coerce an arbitrary key into a legal SCAD identifier so the parameter block always
 * parses. A key that needs coercion still appears — just spelled legally.
 * @param key - Requested parameter name.
 * @param ordinal - Position, used when the key sanitises away entirely.
 * @returns A legal SCAD identifier.
 */
export function toScadIdentifier(key: string, ordinal: number): string {
  const cleaned = key.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (cleaned.length === 0) return `param_${ordinal}`;
  return /^[0-9]/.test(cleaned) ? `p_${cleaned}` : cleaned;
}

/**
 * @description Render a parameter value. Numbers go out bare; a string that is already a numeric
 * vector literal (`[0.12, 0.10]` — how a chord or twist schedule arrives) goes out bare so it
 * stays a usable SCAD vector; anything else is quoted and escaped as a string.
 * @param value - Parameter value.
 * @returns SCAD source for the value.
 * @throws RangeError when a numeric value is not finite.
 */
export function formatScadValue(value: number | string): string {
  if (typeof value === 'number') return formatFloat(value);
  if (NUMERIC_VECTOR.test(value.trim())) return value.trim();
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/**
 * @description Build the legible named-parameter block that opens the file.
 * @param parameters - Design inputs, in insertion order.
 * @returns Source lines, one assignment per parameter.
 * @throws RangeError when a numeric value is not finite.
 */
function parameterLines(parameters: Record<string, number | string>): string[] {
  return Object.entries(parameters).map(
    ([key, value], index) => `${toScadIdentifier(key, index)} = ${formatScadValue(value)};`,
  );
}

/**
 * @description Serialise a mesh as an OpenSCAD module: an editable parameter block followed by a
 * `polyhedron()` carrying the baked geometry, and a call that instantiates it.
 * @param mesh - Mesh to write.
 * @param options - Module name, design parameters and convexity. See {@link OpenScadOptions}.
 * @returns The complete `.scad` source, newline-terminated.
 * @throws RangeError when a facet references a missing vertex or a value is not finite.
 */
export function toOpenScad(mesh: TriMesh, options: OpenScadOptions = {}): string {
  const name = toScadIdentifier(options.name ?? 'oshal_mesh', 0);
  const parameters = options.parameters ?? {};
  const points = mesh.vertices.map(
    (v) => `      [${formatFloat(v.x)}, ${formatFloat(v.y)}, ${formatFloat(v.z)}]`,
  );
  const faces = mesh.triangles.map((triangle, index) => {
    resolveTriangle(mesh, triangle, index);
    return `      [${triangle[0]}, ${triangle[2]}, ${triangle[1]}]`;
  });
  const lines = [
    '// oshal geometry - OpenSCAD export',
    '// The parameters below are the design inputs this solid was built from.',
    '// They are here to stay readable and editable in CAD; the polyhedron() is the',
    '// baked loft, so changing a parameter documents intent rather than re-lofting.',
    '',
    ...parameterLines(parameters),
    '',
    `module ${name}() {`,
    '  polyhedron(',
    '    points = [',
    ...(points.length > 0 ? [points.join(',\n')] : []),
    '    ],',
    '    faces = [',
    ...(faces.length > 0 ? [faces.join(',\n')] : []),
    '    ],',
    `    convexity = ${Math.max(1, Math.trunc(options.convexity ?? 10))}`,
    '  );',
    '}',
    '',
    `${name}();`,
  ];
  log.debug({ name, points: points.length, faces: faces.length }, 'wrote OpenSCAD module');
  return `${lines.join('\n')}\n`;
}
