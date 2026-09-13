/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Vendored from the ocean-lab geometry slice (store packages are
 *                     |                             | self-contained — BUILDING-EXTENSIONS §3). Only the vocabulary a
 *                     |                             | voxel mesher and the STL/OBJ exporters need is kept: Vec3, the
 *                     |                             | indexed triangle mesh, bounds and the validation verdict. The
 *                     |                             | loft/section types stayed behind — this package never lofts.
 */

/**
 * @description A point or direction in 3-space. An object rather than a tuple: the exporters read
 * `.x/.y/.z` in tight loops and a named field turns a silent axis swap into a compile error.
 */
export interface Vec3 {
  /** Cartesian X. */
  x: number;
  /** Cartesian Y. */
  y: number;
  /** Cartesian Z. */
  z: number;
}

/**
 * @description A point in a 2-D plane — an outline vertex on a drawing sheet or a pixel-space
 * contour point. Which one is stated by the producer.
 */
export interface Point2D {
  /** In-plane X. */
  x: number;
  /** In-plane Y. */
  y: number;
}

/**
 * @description One triangle as three indices into {@link TriMesh.vertices}. Indices rather than
 * copied vertices is what makes watertightness decidable: two facets share an edge when they name
 * the same two vertex indices, with no floating-point comparison involved.
 */
export type Triangle = [number, number, number];

/**
 * @description An indexed triangle mesh — the single currency every exporter consumes. Winding is
 * counter-clockwise seen from OUTSIDE the solid (right-hand rule), which STL and OBJ both assume.
 */
export interface TriMesh {
  /** Unique vertex positions. A vertex duplicated here splits the surface and breaks printing. */
  vertices: Vec3[];
  /** Facets, as index triples into {@link TriMesh.vertices}. */
  triangles: Triangle[];
}

/**
 * @description The printability verdict for a mesh. Every field is a measurement, not an opinion,
 * so a caller can log the numbers when a slicer complains instead of re-deriving them.
 */
export interface MeshValidation {
  /** True when every edge is shared by exactly two facets — the printability precondition. */
  watertight: boolean;
  /** Count of edges NOT shared by exactly two facets (boundary plus non-manifold). */
  openEdges: number;
  /** Count of zero-area facets. Slicers either drop these or produce garbage normals. */
  degenerate: number;
  /** V − E + F over referenced vertices. 2 for a closed genus-0 solid; 2·n for n such shells. */
  eulerCharacteristic: number;
  /** True when every shared edge is traversed in opposite directions by its two facets. */
  consistentWinding: boolean;
  /** Edges used by exactly one facet — a hole. */
  boundaryEdges: number;
  /** Edges used by three or more facets — a self-intersection or a welded-through seam. */
  nonManifoldEdges: number;
  /** Indices of the zero-area facets, for pointing a human at the offending region. */
  degenerateTriangles: number[];
  /** True when the mesh is closed AND its signed volume is positive (normals point out). */
  outwardFacing: boolean;
  /**
   * Watertight, consistently wound, outward-facing, no degenerates, χ = 2. Every one of those is a
   * TOPOLOGICAL or per-facet property, so this does not certify that the surface embeds without
   * intersecting itself.
   */
  valid: boolean;
}

/** @description Tolerances for {@link validateMesh}. */
export interface MeshValidationOptions {
  /**
   * Facet area at or below which a facet counts as degenerate. Default scales with the mesh
   * bounding box, so a millimetre-scale part and a metre-scale part get the same verdict.
   */
  areaEpsilon?: number;
}

/** @description Axis-aligned bounding box plus the two derived quantities every caller wants. */
export interface MeshBounds {
  /** Component-wise minimum. */
  min: Vec3;
  /** Component-wise maximum. */
  max: Vec3;
  /** max − min. The print-bed check. */
  size: Vec3;
  /** Box centre. */
  center: Vec3;
}
