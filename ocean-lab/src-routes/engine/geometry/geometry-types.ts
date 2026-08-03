/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the domain-free geometry vocabulary. It lives
 *                     |                             | in shared/ rather than in a rotor feature because a hull, a
 *                     |                             | probe body and a rotor blade are the SAME lofted-solid problem;
 *                     |                             | putting the mesh vocabulary in one slice is what stops a second
 *                     |                             | domain from reaching sideways into the first one. Nothing here
 *                     |                             | knows what a chord or a twist is — the caller places sections,
 *                     |                             | this slice only knows points, triangles and topology.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Cap options no longer say "fan" — the loft ear-clips them now —
 *                     |                             | and {@link MeshValidation.valid} says what it does NOT cover:
 *                     |                             | every check behind it is topological, so it cannot see two
 *                     |                             | facets overlapping in space.
 */

/**
 * @description A point or direction in 3-space. Deliberately an object rather than a tuple: the
 * exporters read `.x/.y/.z` in tight loops and a named field is the difference between a silent
 * axis swap and a compile error when a caller builds one by hand.
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
 * @description A point in a section's own 2-D plane, before {@link placeSection} maps it into
 * 3-space. Section profiles are authored in 2-D (that is how aerofoil tables, hull stations and
 * extrusion outlines are all published), so the 2-D form is a first-class type, not a Vec3 with
 * a wasted field.
 */
export interface Point2D {
  /** In-plane X — conventionally along the chord for an aerofoil-shaped section. */
  x: number;
  /** In-plane Y — conventionally the thickness direction. */
  y: number;
}

/**
 * @description One triangle as three indices into {@link TriMesh.vertices}. Indices rather than
 * copied vertices is what makes watertightness *decidable*: two facets share an edge when they
 * name the same two vertex indices, and no floating-point comparison is involved.
 */
export type Triangle = [number, number, number];

/**
 * @description An indexed triangle mesh — the single currency every exporter in this slice
 * consumes. Winding is counter-clockwise seen from OUTSIDE the solid (right-hand rule), which is
 * what STL, OBJ and OpenSCAD all assume; {@link loftSections} enforces it.
 */
export interface TriMesh {
  /** Unique vertex positions. A vertex duplicated here splits the surface and breaks printing. */
  vertices: Vec3[];
  /** Facets, as index triples into {@link TriMesh.vertices}. */
  triangles: Triangle[];
}

/**
 * @description A closed 2-D profile — the cross-section that gets lofted. The ring is implicitly
 * closed: do NOT repeat the first point at the end. A repeated closing point produces a
 * zero-length edge, and a zero-length edge produces zero-area facets that slicers reject.
 */
export interface Section2D {
  /** Ordered outline points. Order defines the ring; orientation may be either handedness. */
  points: Point2D[];
}

/**
 * @description Where a 2-D section lands in 3-space. This is the whole of "scaled by chord,
 * rotated by twist, translated onto the pitch axis" expressed without naming a domain: `scale` is
 * the chord, `rotationRad` is the twist, `pivot` is the pitch axis in section coordinates, and
 * `origin` is the point on the pitch-axis line.
 */
export interface SectionPlacement {
  /** Where the section's {@link SectionPlacement.pivot} lands in 3-space. */
  origin: Vec3;
  /** Uniform in-plane scale applied about the pivot. Default 1. */
  scale?: number;
  /** In-plane rotation about the pivot, radians, positive counter-clockwise. Default 0. */
  rotationRad?: number;
  /** The in-section point held fixed by scale and rotation. Default the section origin. */
  pivot?: Point2D;
  /** 3-D direction the section's +X maps onto. Default +X. Need not be unit length. */
  uAxis?: Vec3;
  /** 3-D direction the section's +Y maps onto. Default +Y. Need not be unit length. */
  vAxis?: Vec3;
}

/**
 * @description Knobs for {@link loftSections}. The defaults build a CLOSED solid, because an
 * unclosed loft is only ever useful as an intermediate and shipping one by accident is the
 * failure this slice exists to prevent.
 */
export interface LoftOptions {
  /**
   * Join each section's last point back to its first. Default true. False leaves a seam and the
   * result is a sheet, not a solid — {@link validateMesh} will say so.
   */
  closeRing?: boolean;
  /** Triangulate the first section into a closing face. Default: follows `closeRing`. */
  capStart?: boolean;
  /** Triangulate the last section into a closing face. Default: follows `closeRing`. */
  capEnd?: boolean;
  /**
   * Distance under which a section's trailing point counts as a repeat of its first and is
   * dropped. Default 1e-9. Tolerating the repeat is friendlier than rejecting it: half the
   * profile tables in the wild publish the closing point.
   */
  weldEpsilon?: number;
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
  /** V − E + F over referenced vertices. 2 for a closed genus-0 solid. */
  eulerCharacteristic: number;
  /** True when every shared edge is traversed in opposite directions by its two facets. */
  consistentWinding: boolean;
  /** Edges used by exactly one facet — a hole. */
  boundaryEdges: number;
  /** Edges used by three or more facets — a self-intersection or a welded-through seam. */
  nonManifoldEdges: number;
  /** Indices of the zero-area facets, for pointing a human at the offending section. */
  degenerateTriangles: number[];
  /** True when the mesh is closed AND its signed volume is positive (normals point out). */
  outwardFacing: boolean;
  /**
   * Watertight, consistently wound, outward-facing, no degenerates, χ = 2. Every one of those is a
   * TOPOLOGICAL or per-facet property, so this does not certify that the surface embeds without
   * intersecting itself — a patch of overlapping, locally inverted facets satisfies all five.
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

/** @description One named profile for {@link toDxfR12}. */
export interface DxfSection {
  /** Becomes the DXF layer name (sanitised to the R12 character set). */
  name: string;
  /** Outline points, emitted verbatim — no welding, no reordering. */
  points: ReadonlyArray<Point2D>;
  /** Z placed on every vertex of this profile. Default 0. */
  elevation?: number;
  /** Emit the closed-polyline flag. Default true. */
  closed?: boolean;
}

/** @description Options for {@link toOpenScad}. */
export interface OpenScadOptions {
  /** Module name and the identifier the file instantiates. Default `oshal_mesh`. */
  name?: string;
  /**
   * The design inputs, emitted as a legible named-assignment block at the top of the file. The
   * point of the SCAD export is that these stay editable in CAD — the polyhedron below them is
   * the baked result, not a re-derivation.
   */
  parameters?: Record<string, number | string>;
  /** OpenSCAD `convexity` hint for preview rendering. Default 10. */
  convexity?: number;
}
