/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — guards for @/shared/geometry. The load-bearing ones are
 *                     |                             | the topology proofs: a lofted solid is watertight by an edge
 *                     |                             | census computed HERE (not by asking the validator, which would
 *                     |                             | only prove the validator agrees with itself), the validator goes
 *                     |                             | RED on a deliberately opened mesh with the exact boundary-edge
 *                     |                             | count, and the lofted volume CONVERGES on the analytic cylinder
 *                     |                             | rather than merely landing near it once. The exporter guards
 *                     |                             | pin the three format facts that are silent when wrong: the STL
 *                     |                             | binary byte length, the count word in its header, and OBJ's
 *                     |                             | 1-based face indices.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Four checks were asserted only in their PASSING direction, which
 *                     |                             | means each could be deleted from the validator with every test
 *                     |                             | here still green — mutation-verified, 62/62 passed with the
 *                     |                             | winding check hard-wired true, with the signed-volume half of
 *                     |                             | `outwardFacing` dropped, and with non-manifold counting
 *                     |                             | disabled. Each now has a fixture built to make exactly ONE of
 *                     |                             | them go red: a single reversed facet (winding, counts
 *                     |                             | untouched), a wholly flipped solid (outward-facing, while
 *                     |                             | watertight and consistently wound both still hold), and a
 *                     |                             | duplicated facet (non-manifold). The DXF guard likewise stopped
 *                     |                             | being three `toContain` substring probes — it now PARSES
 *                     |                             | code/value pairs, so a coordinate emitted under the wrong group
 *                     |                             | code no longer passes by being findable somewhere in the file.
 *                     |                             | Added with them: the cap triangulation must lie inside a
 *                     |                             | CONCAVE ring, the area floor must be unit-free, and the text
 *                     |                             | exporters must not weld two distinct vertices into one.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SIGNIFICANT_DIGITS,
  flipWinding,
  formatFloat,
  loftSections,
  meshBounds,
  meshSurfaceArea,
  meshVolume,
  placeSection,
  recomputeNormals,
  ringNormal,
  stlBinaryByteLength,
  toDxfR12,
  toObj,
  toOpenScad,
  toStlAscii,
  toStlBinary,
  triangulateRing,
  validateMesh,
  vecLength,
} from '../src-routes/engine/geometry';
import type { Point2D, TriMesh, Triangle, Vec3 } from '../src-routes/engine/geometry';

/** A regular polygon ring in the z = `z` plane, wound counter-clockwise seen from +Z. */
function circleRing(radius: number, segments: number, z: number): Vec3[] {
  return Array.from({ length: segments }, (_, i) => {
    const angle = (2 * Math.PI * i) / segments;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z };
  });
}

/** A capped prism approximating a cylinder: `sectionCount` rings of `segments` points. */
function cylinder(radius: number, height: number, segments: number, sectionCount = 2): TriMesh {
  const rings = Array.from({ length: sectionCount }, (_, s) =>
    circleRing(radius, segments, (height * s) / (sectionCount - 1)),
  );
  return loftSections(rings);
}

/** Independent edge census — the test must not learn topology from the code under test. */
function edgeCensus(mesh: TriMesh): Map<string, number> {
  const census = new Map<string, number>();
  for (const [a, b, c] of mesh.triangles) {
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      census.set(key, (census.get(key) ?? 0) + 1);
    }
  }
  return census;
}

describe('loftSections — watertightness', () => {
  it('proof 1: a capped loft of identical rings closes — every edge used exactly twice, chi = 2', () => {
    const mesh = cylinder(1, 2, 12, 4);

    const census = edgeCensus(mesh);
    const uses = [...census.values()];
    expect(uses.every((count) => count === 2)).toBe(true);
    expect(uses.filter((count) => count !== 2)).toHaveLength(0);

    // V - E + F, computed in the test from the mesh itself.
    const referenced = new Set(mesh.triangles.flat());
    expect(referenced.size - census.size + mesh.triangles.length).toBe(2);

    const verdict = validateMesh(mesh);
    expect(verdict.watertight).toBe(true);
    expect(verdict.openEdges).toBe(0);
    expect(verdict.degenerate).toBe(0);
    expect(verdict.eulerCharacteristic).toBe(2);
    expect(verdict.consistentWinding).toBe(true);
    expect(verdict.outwardFacing).toBe(true);
    expect(verdict.valid).toBe(true);
  });

  it('proof 1b: the closed solid has the vertex and facet counts the loft is supposed to build', () => {
    const segments = 12;
    const sections = 4;
    const mesh = cylinder(1, 2, segments, sections);
    // Exactly one vertex per ring point: the caps are ear-clipped triangulations of the rings
    // themselves, so nothing is appended to the vertex array.
    expect(mesh.vertices).toHaveLength(segments * sections);
    // Two facets per quad, plus (n - 2) per capped ring — the triangle count of any triangulation
    // of an n-gon, which is what makes the closed form the export ceiling uses exact.
    expect(mesh.triangles).toHaveLength(2 * segments * (sections - 1) + 2 * (segments - 2));
  });

  it('proof 2: dropping a cap opens the mesh — the validator goes RED with the exact hole size', () => {
    const segments = 16;
    const rings = [circleRing(1, segments, 0), circleRing(1, segments, 2)];
    const open = loftSections(rings, { capStart: false, capEnd: true });

    const boundary = [...edgeCensus(open).values()].filter((count) => count !== 2);
    expect(boundary).toHaveLength(segments);

    const verdict = validateMesh(open);
    expect(verdict.watertight).toBe(false);
    expect(verdict.openEdges).toBe(segments);
    expect(verdict.boundaryEdges).toBe(segments);
    expect(verdict.valid).toBe(false);
    // A hole in a sphere is a disk: chi drops from 2 to 1.
    expect(verdict.eulerCharacteristic).toBe(1);
    // Winding is an ORTHOGONAL property and must not be smeared by the hole.
    expect(verdict.consistentWinding).toBe(true);
    expect(verdict.outwardFacing).toBe(false);

    // ...and the same loft WITH the cap is watertight, so the difference is the cap alone.
    expect(validateMesh(loftSections(rings)).watertight).toBe(true);
  });

  it('proof 2b: an unclosed ring leaves a seam the whole length of the loft', () => {
    const segments = 8;
    const rings = [circleRing(1, segments, 0), circleRing(1, segments, 1)];
    const sheet = loftSections(rings, { closeRing: false });
    const verdict = validateMesh(sheet);
    expect(verdict.watertight).toBe(false);
    // Open sheet boundary: two long edges (one per side of the seam) plus both ring rims.
    expect(verdict.boundaryEdges).toBe(2 + 2 * (segments - 1));
  });

  it('orients itself from measurement: clockwise input rings still yield an outward-facing solid', () => {
    const reversed = [circleRing(1, 10, 0), circleRing(1, 10, 2)].map((ring) => [...ring].reverse());
    const mesh = loftSections(reversed);
    expect(meshVolume(mesh)).toBeGreaterThan(0);
    expect(validateMesh(mesh).outwardFacing).toBe(true);
  });

  it('drops a repeated closing point rather than lofting a zero-length edge', () => {
    const ring = circleRing(1, 8, 0);
    const withClose = [...ring, { ...ring[0] }];
    const upper = circleRing(1, 8, 1);
    const mesh = loftSections([withClose, [...upper, { ...upper[0] }]]);
    expect(mesh.vertices).toHaveLength(8 * 2);
    expect(validateMesh(mesh).degenerate).toBe(0);
    expect(validateMesh(mesh).watertight).toBe(true);
  });

  it('refuses inputs that cannot loft', () => {
    expect(() => loftSections([circleRing(1, 8, 0)])).toThrow(/at least 2 sections/);
    expect(() => loftSections([circleRing(1, 8, 0), circleRing(1, 12, 1)])).toThrow(/matching point counts/);
    expect(() =>
      loftSections([
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        circleRing(1, 2, 1),
      ]),
    ).toThrow(/at least 3/);
  });
});

/**
 * An L-shaped ring at height `z`. Its CENTROID (4/3, 4/3) falls in the missing quadrant, i.e.
 * outside the polygon — which is precisely the ring a centroid fan cannot cap, because the wedges
 * it emits there are wound backwards and overlap their neighbours.
 */
function lRing(z: number): Vec3[] {
  return [
    { x: 0, y: 0, z },
    { x: 3, y: 0, z },
    { x: 3, y: 1, z },
    { x: 1, y: 1, z },
    { x: 1, y: 3, z },
    { x: 0, y: 3, z },
  ];
}

/** The L-shape's area: a 3x1 arm plus a 1x2 arm. */
const L_RING_AREA = 3 * 1 + 1 * 2;

/** Ray-cast point-in-polygon over the (x, y) projection — the test's own containment test. */
function insidePolygon(point: Point2D, ring: ReadonlyArray<Vec3>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Twice the signed area of a 2-D triangle, computed in the test rather than borrowed. */
function cross2(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

describe('cap triangulation — the fan replacement', () => {
  it('triangulates a CONCAVE ring into n-2 facets that all lie inside it', () => {
    const ring = lRing(0);
    const triangles = triangulateRing(ring) as Triangle[];
    expect(triangles).not.toBeNull();
    expect(triangles).toHaveLength(ring.length - 2);

    let absoluteArea = 0;
    for (const [a, b, c] of triangles) {
      const twice = cross2(ring[a], ring[b], ring[c]);
      // Wound counter-clockwise with the ring's own Newell normal — never backwards.
      expect(twice).toBeGreaterThan(0);
      absoluteArea += twice / 2;
      const centroid = {
        x: (ring[a].x + ring[b].x + ring[c].x) / 3,
        y: (ring[a].y + ring[b].y + ring[c].y) / 3,
      };
      expect(insidePolygon(centroid, ring), `facet ${a},${b},${c} must lie inside the ring`).toBe(true);
    }
    // The load-bearing number: a centroid fan's signed areas also SUM to the polygon area, because
    // the wedges outside it cancel. Their ABSOLUTE areas do not — they over-cover.
    expect(absoluteArea).toBeCloseTo(L_RING_AREA, 12);
  });

  it('caps a lofted concave solid with facets that all face the same way', () => {
    const mesh = loftSections([lRing(0), lRing(2)]);
    const verdict = validateMesh(mesh);
    expect(verdict.valid).toBe(true);
    expect(meshVolume(mesh)).toBeCloseTo(L_RING_AREA * 2, 12);

    // The caps are the facets whose vertices all share a z — identified here, not assumed.
    const normals = recomputeNormals(mesh);
    const capNormals = mesh.triangles
      .map((triangle, index) => ({ triangle, normal: normals[index] }))
      .filter(({ triangle }) => new Set(triangle.map((i) => mesh.vertices[i].z)).size === 1);
    expect(capNormals).toHaveLength(2 * (lRing(0).length - 2));
    const down = capNormals.filter(({ normal }) => normal.z < 0);
    const up = capNormals.filter(({ normal }) => normal.z > 0);
    // Every root facet points -Z and every tip facet +Z. A centroid fan on this ring produces 2 of
    // 6 facets pointing the wrong way, and no topology check in the validator can see it.
    expect(down).toHaveLength(lRing(0).length - 2);
    expect(up).toHaveLength(lRing(0).length - 2);
    for (const { normal } of down) expect(normal.z).toBeCloseTo(-1, 12);
    for (const { normal } of up) expect(normal.z).toBeCloseTo(1, 12);
  });

  it('refuses a ring with no interior instead of capping it with slivers', () => {
    expect(() => triangulateRing([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])).toThrow(/at least 3/);
    // Collinear: no area at all.
    expect(() =>
      triangulateRing([
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ]),
    ).toThrow(/encloses no area/);
    // A figure-of-eight: a point list that looks like a ring and bounds nothing, because its two
    // lobes carry opposite signs and cancel.
    expect(() =>
      triangulateRing([
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 2, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 0, y: 2, z: 0 },
      ]),
    ).toThrow(/encloses no area/);
  });

  it('orients its facets by the ring normal, so a reversed ring caps the other way', () => {
    const ring = lRing(0);
    const normal = ringNormal(ring);
    expect(normal.z).toBeCloseTo(2 * L_RING_AREA, 12);
    const reversed = [...ring].reverse();
    expect(ringNormal(reversed).z).toBeCloseTo(-2 * L_RING_AREA, 12);
    const triangles = triangulateRing(reversed) as Triangle[];
    for (const [a, b, c] of triangles) expect(cross2(reversed[a], reversed[b], reversed[c])).toBeLessThan(0);
  });
});

describe('validateMesh — each check must be able to go RED on its own', () => {
  it('flags ONE reversed facet as inconsistent winding while the edge counts stay perfect', () => {
    const mesh = cylinder(1, 2, 12);
    const [a, b, c] = mesh.triangles[0];
    const twisted: TriMesh = {
      vertices: mesh.vertices,
      triangles: [[a, c, b] as Triangle, ...mesh.triangles.slice(1)],
    };
    // Reversing a facet changes only the DIRECTIONS its edges are traversed in, never the counts.
    expect([...edgeCensus(twisted).values()].every((count) => count === 2)).toBe(true);

    const verdict = validateMesh(twisted);
    expect(verdict.consistentWinding).toBe(false);
    expect(verdict.valid).toBe(false);
    // ...and the other three checks are untouched, which is what makes this a winding test.
    expect(verdict.watertight).toBe(true);
    expect(verdict.openEdges).toBe(0);
    expect(verdict.degenerate).toBe(0);
    expect(verdict.eulerCharacteristic).toBe(2);
    expect(validateMesh(mesh).consistentWinding).toBe(true);
  });

  it('flags a wholly INSIDE-OUT solid, which is watertight and consistently wound', () => {
    const inverted = flipWinding(cylinder(1, 2, 16));
    const verdict = validateMesh(inverted);
    // Every precondition of `outwardFacing` except the signed volume still holds, so this fixture
    // fails if — and only if — the volume test is still there.
    expect(verdict.watertight).toBe(true);
    expect(verdict.consistentWinding).toBe(true);
    expect(verdict.eulerCharacteristic).toBe(2);
    expect(meshVolume(inverted)).toBeLessThan(0);
    expect(verdict.outwardFacing).toBe(false);
    expect(verdict.valid).toBe(false);
  });

  it('counts an edge shared by three facets as NON-MANIFOLD, not as watertight', () => {
    const mesh = cylinder(1, 2, 10);
    const doubled: TriMesh = { vertices: mesh.vertices, triangles: [...mesh.triangles, mesh.triangles[0]] };
    // The test's own census sees exactly three edges used three times.
    const overused = [...edgeCensus(doubled).values()].filter((count) => count === 3);
    expect(overused).toHaveLength(3);

    const verdict = validateMesh(doubled);
    expect(verdict.nonManifoldEdges).toBe(3);
    expect(verdict.boundaryEdges).toBe(0);
    expect(verdict.openEdges).toBe(3);
    expect(verdict.watertight).toBe(false);
    expect(verdict.valid).toBe(false);
    expect(validateMesh(mesh).nonManifoldEdges).toBe(0);
  });

  it('uses a UNIT-FREE area floor: the same solid gets one verdict in mm, m and km', () => {
    // One healthy facet, one sliver at 1e-13 of the diagonal² (below the 1e-12 floor) and one at
    // 1e-10 (above it). Both are RELATIVE to the part, so the verdict must not move with the unit.
    const at = (scale: number): TriMesh => ({
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: scale, y: 0, z: 0 },
        { x: 0, y: scale, z: 0 },
        { x: scale / 2, y: 2e-13 * scale, z: 0 },
        { x: scale / 2, y: 2e-10 * scale, z: 0 },
      ],
      triangles: [
        [0, 1, 2],
        [0, 1, 3],
        [0, 1, 4],
      ],
    });
    for (const scale of [1e-3, 1, 1e3]) {
      const verdict = validateMesh(at(scale));
      expect(verdict.degenerate, `scale ${scale}`).toBe(1);
      expect(verdict.degenerateTriangles, `scale ${scale}`).toEqual([1]);
    }
  });
});

describe('mesh metrics', () => {
  it('proof 3: lofted volume converges on pi*r^2*h and lands within 1% at high resolution', () => {
    const radius = 1;
    const height = 2;
    const analytic = Math.PI * radius * radius * height;
    const errorAt = (segments: number): number =>
      Math.abs(meshVolume(cylinder(radius, height, segments)) - analytic) / analytic;

    const errors = [8, 16, 32, 64, 128].map(errorAt);
    for (let i = 1; i < errors.length; i += 1) {
      expect(errors[i]).toBeLessThan(errors[i - 1]);
    }
    expect(errorAt(128)).toBeLessThan(0.01);
    // The inscribed prism always UNDER-fills the cylinder — a value above analytic would mean the
    // winding or the cap fan is adding phantom volume.
    expect(meshVolume(cylinder(radius, height, 128))).toBeLessThan(analytic);
  });

  it('proof 3b: sections along the span do not change the volume of a straight loft', () => {
    const coarse = meshVolume(cylinder(1, 2, 32, 2));
    const fine = meshVolume(cylinder(1, 2, 32, 9));
    expect(fine).toBeCloseTo(coarse, 9);
  });

  it('surface area converges on the analytic lateral + cap area', () => {
    const area = meshSurfaceArea(cylinder(1, 2, 256));
    const analytic = 2 * Math.PI * 1 * 2 + 2 * Math.PI * 1 * 1;
    expect(Math.abs(area - analytic) / analytic).toBeLessThan(0.001);
  });

  it('bounds report the real extent of the solid', () => {
    const bounds = meshBounds(cylinder(2, 5, 64));
    expect(bounds.min.z).toBeCloseTo(0, 12);
    expect(bounds.max.z).toBeCloseTo(5, 12);
    expect(bounds.size.x).toBeCloseTo(4, 2);
    expect(bounds.center.z).toBeCloseTo(2.5, 12);
    expect(() => meshBounds({ vertices: [], triangles: [] })).toThrow(/at least one vertex/);
  });

  it('recomputeNormals returns one unit normal per facet, pointing outward on the caps', () => {
    const mesh = cylinder(1, 2, 16);
    const normals = recomputeNormals(mesh);
    expect(normals).toHaveLength(mesh.triangles.length);
    for (const normal of normals) expect(vecLength(normal)).toBeCloseTo(1, 12);
    // The last facets are the +Z cap fan.
    const top = normals[normals.length - 1];
    expect(top.z).toBeCloseTo(1, 9);
    // The first facets are on the side wall: radial, never axial.
    expect(Math.abs(normals[0].z)).toBeLessThan(1e-9);
  });

  it('proof 9: zero-area facets are detected and reported by index', () => {
    const degenerate: TriMesh = {
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      triangles: [
        [0, 1, 3],
        [0, 1, 2], // collinear along +X — zero area
        [0, 1, 1], // repeated vertex — zero area
      ],
    };
    const verdict = validateMesh(degenerate);
    expect(verdict.degenerate).toBe(2);
    expect(verdict.degenerateTriangles).toEqual([1, 2]);
    expect(verdict.valid).toBe(false);

    // A healthy loft has none, so the check is not simply always-true.
    expect(validateMesh(cylinder(1, 2, 24)).degenerate).toBe(0);
  });

  it('a facet index outside the vertex array fails loudly instead of scoring as invalid', () => {
    const broken: TriMesh = { vertices: [{ x: 0, y: 0, z: 0 }], triangles: [[0, 1, 2]] };
    expect(() => validateMesh(broken)).toThrow(/outside the 1-vertex array/);
  });
});

describe('placeSection', () => {
  it('scales about the pivot, twists about it, and lands on the pitch-axis origin', () => {
    const section = { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.2 }] };
    const placed = placeSection(section, {
      origin: { x: 0, y: 0, z: 3 },
      scale: 2,
      rotationRad: Math.PI / 2,
      pivot: { x: 0, y: 0 },
    });
    expect(placed).toHaveLength(3);
    // The pivot itself is the origin.
    expect(placed[0]).toEqual({ x: 0, y: 0, z: 3 });
    // (1,0) scaled x2 then rotated 90 degrees is (0,2).
    expect(placed[1].x).toBeCloseTo(0, 12);
    expect(placed[1].y).toBeCloseTo(2, 12);
    expect(placed[1].z).toBeCloseTo(3, 12);
  });

  it('maps the section plane onto the supplied axes', () => {
    const placed = placeSection(
      { points: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 }] },
      { origin: { x: 0, y: 0, z: 0 }, uAxis: { x: 0, y: 0, z: 1 }, vAxis: { x: 0, y: 1, z: 0 } },
    );
    expect(placed[0]).toEqual({ x: 0, y: 0, z: 1 });
    expect(placed[1]).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('a placed-section loft is watertight end to end', () => {
    const profile = {
      points: Array.from({ length: 20 }, (_, i) => {
        const t = (2 * Math.PI * i) / 20;
        return { x: Math.cos(t), y: 0.3 * Math.sin(t) };
      }),
    };
    const sections = [0, 0.25, 0.5, 0.75, 1].map((f) =>
      placeSection(profile, {
        origin: { x: 0, y: 0, z: f * 4 },
        scale: 1 - 0.5 * f,
        rotationRad: (-15 * Math.PI) / 180 + f * ((25 * Math.PI) / 180),
      }),
    );
    const verdict = validateMesh(loftSections(sections));
    expect(verdict.valid).toBe(true);
    expect(verdict.eulerCharacteristic).toBe(2);
  });
});

describe('STL export', () => {
  it('proof 4: binary STL is exactly 84 + 50 * nTriangles bytes', () => {
    for (const segments of [3, 8, 32]) {
      const mesh = cylinder(1, 1, segments);
      const bytes = toStlBinary(mesh);
      expect(bytes.byteLength).toBe(84 + 50 * mesh.triangles.length);
      expect(bytes.byteLength).toBe(stlBinaryByteLength(mesh.triangles.length));
    }
  });

  it('proof 5: the uint32 at offset 80 equals the facet count', () => {
    const mesh = cylinder(1, 1, 17);
    const bytes = toStlBinary(mesh);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(80, true)).toBe(mesh.triangles.length);
    expect(mesh.triangles.length).toBeGreaterThan(0);
  });

  it('binary STL round-trips the first facet and never claims to be ASCII', () => {
    const mesh = cylinder(2, 3, 6);
    const bytes = toStlBinary(mesh);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const header = String.fromCharCode(...bytes.slice(0, 5));
    expect(header).not.toBe('solid');

    const [a] = mesh.triangles[0];
    expect(view.getFloat32(84 + 12, true)).toBeCloseTo(mesh.vertices[a].x, 5);
    expect(view.getFloat32(84 + 16, true)).toBeCloseTo(mesh.vertices[a].y, 5);
    expect(view.getFloat32(84 + 20, true)).toBeCloseTo(mesh.vertices[a].z, 5);
    // attribute byte count word of facet 0
    expect(view.getUint16(84 + 48, true)).toBe(0);
  });

  it('ASCII STL emits one facet block per triangle and balanced solid/endsolid', () => {
    const mesh = cylinder(1, 1, 5);
    const text = toStlAscii(mesh, 'test blade');
    const count = (pattern: RegExp): number => (text.match(pattern) ?? []).length;
    expect(count(/^\s*facet normal /gm)).toBe(mesh.triangles.length);
    expect(count(/^\s*endfacet$/gm)).toBe(mesh.triangles.length);
    expect(count(/^\s*vertex /gm)).toBe(mesh.triangles.length * 3);
    expect(text.startsWith('solid test_blade\n')).toBe(true);
    expect(text.trimEnd().endsWith('endsolid test_blade')).toBe(true);
  });
});

describe('OBJ export', () => {
  it('proof 6: one v per vertex, one f per triangle, indices 1-BASED', () => {
    const mesh = cylinder(1, 2, 9);
    const text = toObj(mesh, 'blade');
    const lines = text.split('\n');
    const vLines = lines.filter((line) => /^v /.test(line));
    const fLines = lines.filter((line) => /^f /.test(line));
    expect(vLines).toHaveLength(mesh.vertices.length);
    expect(fLines).toHaveLength(mesh.triangles.length);

    const indices = fLines.flatMap((line) =>
      line
        .slice(2)
        .split(/\s+/)
        .map((token) => Number(token.split('//')[0])),
    );
    expect(Math.min(...indices)).toBe(1);
    expect(Math.max(...indices)).toBe(mesh.vertices.length);
    expect(indices.includes(0)).toBe(false);

    // Face 0 must name exactly the mesh's first triangle, shifted by one.
    expect(fLines[0]).toBe(`f ${mesh.triangles[0].map((i) => `${i + 1}//1`).join(' ')}`);
  });

  it('emits one vn per facet and keeps the vertex array indexed (no duplication)', () => {
    const mesh = cylinder(1, 2, 9);
    const text = toObj(mesh);
    expect(text.split('\n').filter((line) => /^vn /.test(line))).toHaveLength(mesh.triangles.length);
    expect(mesh.vertices.length).toBeLessThan(mesh.triangles.length * 3);
  });
});

/** Zero-area facets in an ASCII STL, measured by re-parsing the emitted TEXT. */
function zeroAreaFacetsIn(stl: string): number {
  const corners: number[][] = [];
  let found = 0;
  for (const line of stl.split('\n')) {
    const match = line.trim().match(/^vertex (\S+) (\S+) (\S+)$/);
    if (!match) continue;
    corners.push([Number(match[1]), Number(match[2]), Number(match[3])]);
    if (corners.length < 3) continue;
    const [a, b, c] = corners;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (Math.hypot(cross[0], cross[1], cross[2]) === 0) found += 1;
    corners.length = 0;
  }
  return found;
}

describe('text-format precision', () => {
  it('rounds RELATIVELY, so a sub-micron coordinate is kept rather than quantised away', () => {
    expect(DEFAULT_SIGNIFICANT_DIGITS).toBeGreaterThanOrEqual(9);
    expect(formatFloat(0)).toBe('0');
    expect(formatFloat(-0)).toBe('0');
    for (const value of [1.5e-9, 2.25e-7, 1.23456789012e-7, 1e-5, 12345.6789, -3.5e-8]) {
      const text = formatFloat(value);
      // Exponent notation is what a DXF R12 reader rejects and what some STL readers mis-parse.
      expect(text, `${value} must format plainly`).not.toMatch(/e/i);
      expect(Math.abs(Number(text) - value) / Math.abs(value)).toBeLessThan(1e-11);
    }
    // Two vertices 1e-7 m apart are TWO vertices. On a six-decimal grid they were one, which is
    // how a lofted solid became a file with welded points and zero-area facets.
    expect(formatFloat(0.0000123456)).not.toBe(formatFloat(0.0000124456));
    // The absolute form is still available for the fixed-format writers that want it — and it is
    // exactly the form that welded them.
    expect(formatFloat(0.0000123456, 6)).toBe(formatFloat(0.0000124456, 6));
  });

  it('welds nothing when the whole part is smaller than the old decimal grid', () => {
    // Ring points 3.9e-7 m apart — below a 1e-6 grid, above nothing else.
    const mesh = loftSections([circleRing(2e-6, 32, 0), circleRing(2e-6, 32, 1e-5)]);
    expect(validateMesh(mesh).valid).toBe(true);
    expect(validateMesh(mesh).degenerate).toBe(0);

    const stl = toStlAscii(mesh);
    expect((stl.match(/^\s*facet normal /gm) ?? []).length).toBe(mesh.triangles.length);
    expect(zeroAreaFacetsIn(stl)).toBe(0);

    const vertexLines = toObj(mesh).split('\n').filter((line) => line.startsWith('v '));
    expect(vertexLines).toHaveLength(mesh.vertices.length);
    expect(new Set(vertexLines).size).toBe(mesh.vertices.length);

    const scad = toOpenScad(mesh);
    const pointRows = scad
      .slice(scad.indexOf('points = ['), scad.indexOf('faces = ['))
      .split('\n')
      .filter((line) => /^\s*\[/.test(line))
      .map((line) => line.trim());
    // A polyhedron face naming the same point twice is the CGAL "not a valid 2-manifold" refusal.
    expect(new Set(pointRows).size).toBe(mesh.vertices.length);
  });
});

describe('OpenSCAD export', () => {
  const parameters = {
    radius: 0.45,
    blade_count: 3,
    chords: '[0.12, 0.10, 0.08]',
    twists: '[22.5, 14.0, 8.25]',
    section_digits: '2412',
    pitch: 0.31,
  };

  it('proof 7: every parameter key becomes a named assignment and points matches the vertex count', () => {
    const mesh = cylinder(1, 2, 10);
    const scad = toOpenScad(mesh, { name: 'rotor blade', parameters });

    for (const key of Object.keys(parameters)) {
      expect(scad).toMatch(new RegExp(`^${key} = .+;$`, 'm'));
    }
    expect(scad).toContain('radius = 0.45;');
    expect(scad).toContain('blade_count = 3;');
    // A numeric vector stays a SCAD vector; a non-numeric string is quoted.
    expect(scad).toContain('chords = [0.12, 0.10, 0.08];');
    expect(scad).toContain('section_digits = "2412";');

    const pointsBlock = scad.slice(scad.indexOf('points = ['), scad.indexOf('faces = ['));
    const pointRows = pointsBlock.split('\n').filter((line) => /^\s*\[/.test(line));
    expect(pointRows).toHaveLength(mesh.vertices.length);

    const facesBlock = scad.slice(scad.indexOf('faces = ['));
    const faceRows = facesBlock.split('\n').filter((line) => /^\s*\[/.test(line));
    expect(faceRows).toHaveLength(mesh.triangles.length);

    expect(scad).toContain('polyhedron(');
    expect(scad).toMatch(/^module rotor_blade\(\) \{$/m);
    expect(scad.trimEnd().endsWith('rotor_blade();')).toBe(true);
  });

  it('reverses winding on the way out — OpenSCAD wants faces clockwise from outside', () => {
    const mesh = cylinder(1, 1, 4);
    const scad = toOpenScad(mesh);
    const [a, b, c] = mesh.triangles[0];
    expect(scad).toContain(`[${a}, ${c}, ${b}]`);
  });
});

/** One DXF group: its code and the value line under it. */
interface DxfPair {
  /** The group code. */
  code: number;
  /** The value line. */
  value: string;
}

/** One DXF entity: the type on its code-0 line, plus every group up to the next code 0. */
interface DxfEntity {
  /** Entity type, e.g. POLYLINE / VERTEX / SEQEND. */
  type: string;
  /** The entity's own groups. */
  groups: DxfPair[];
}

/**
 * Parse a DXF into code/value PAIRS. The point of parsing rather than substring-matching is that a
 * coordinate emitted under the wrong group code is still findable in the text — `toContain` cannot
 * tell "the Y ordinate" from "some number somewhere in the file".
 */
function dxfPairs(text: string): DxfPair[] {
  const lines = text.split('\n');
  expect(lines[lines.length - 1], 'the file must end with a newline').toBe('');
  const body = lines.slice(0, -1);
  expect(body.length % 2, 'every group code must have a value line').toBe(0);
  const pairs: DxfPair[] = [];
  for (let i = 0; i < body.length; i += 2) {
    const code = Number(body[i]);
    expect(Number.isInteger(code), `line ${i} "${body[i]}" must be a group code`).toBe(true);
    pairs.push({ code, value: body[i + 1] });
  }
  return pairs;
}

/** Split parsed pairs into entities — a code-0 pair opens one. */
function dxfEntities(pairs: ReadonlyArray<DxfPair>): DxfEntity[] {
  const entities: DxfEntity[] = [];
  for (const pair of pairs) {
    if (pair.code === 0) entities.push({ type: pair.value, groups: [] });
    else if (entities.length > 0) entities[entities.length - 1].groups.push(pair);
  }
  return entities;
}

/** The value carried on one group code of an entity, or undefined when the code is absent. */
function groupValue(entity: DxfEntity, code: number): string | undefined {
  return entity.groups.find((group) => group.code === code)?.value;
}

describe('DXF R12 export', () => {
  const sections = [
    { name: 'station 0', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    { name: 'station 1', points: [{ x: 0, y: 0 }, { x: 0.8, y: 0 }, { x: 0.8, y: 0.6 }], elevation: 2.5 },
  ];

  it('proof 8: structurally valid R12 — balanced sections, one POLYLINE per profile, vertices kept', () => {
    const dxf = toDxfR12(sections);
    const lines = dxf.split('\n');
    const countOf = (token: string): number => lines.filter((line) => line === token).length;

    expect(countOf('SECTION')).toBeGreaterThan(0);
    expect(countOf('SECTION')).toBe(countOf('ENDSEC'));
    expect(countOf('ENTITIES')).toBe(1);
    expect(countOf('EOF')).toBe(1);
    expect(lines[lines.length - 2]).toBe('EOF');

    const entities = dxfEntities(dxfPairs(dxf));
    expect(entities.filter((entity) => entity.type === 'POLYLINE')).toHaveLength(sections.length);
    expect(entities.filter((entity) => entity.type === 'SEQEND')).toHaveLength(sections.length);
    expect(entities.filter((entity) => entity.type === 'VERTEX')).toHaveLength(
      sections[0].points.length + sections[1].points.length,
    );

    // The version token has to be the VALUE of the $ACADVER header variable, not merely present.
    const header = dxfPairs(dxf);
    const acadverAt = header.findIndex((pair) => pair.code === 9 && pair.value === '$ACADVER');
    expect(acadverAt).toBeGreaterThanOrEqual(0);
    expect(header[acadverAt + 1]).toEqual({ code: 1, value: 'AC1009' });

    // Every layer an entity references must be DECLARED in the LAYER table.
    const declared = new Set(
      entities.filter((entity) => entity.type === 'LAYER').map((entity) => groupValue(entity, 2)),
    );
    expect(declared).toContain('STATION_0');
    expect(declared).toContain('STATION_1');
    for (const entity of entities.filter((e) => ['POLYLINE', 'VERTEX', 'SEQEND'].includes(e.type))) {
      expect(declared).toContain(groupValue(entity, 8));
    }
  });

  it('puts every ordinate on the group code an R12 reader reads it from', () => {
    const entities = dxfEntities(dxfPairs(toDxfR12(sections)));
    const drawing = entities.slice(entities.findIndex((entity) => entity.type === 'POLYLINE'));
    let sectionIndex = -1;
    let vertexIndex = 0;
    for (const entity of drawing) {
      if (entity.type === 'POLYLINE') {
        sectionIndex += 1;
        vertexIndex = 0;
        // 66 "vertices follow" is mandatory in R12; without it the profile arrives empty.
        expect(groupValue(entity, 66)).toBe('1');
        expect(groupValue(entity, 70)).toBe('1');
        continue;
      }
      if (entity.type === 'SEQEND') {
        expect(vertexIndex, `section ${sectionIndex} vertex count`).toBe(sections[sectionIndex].points.length);
        continue;
      }
      if (entity.type !== 'VERTEX') continue;
      const section = sections[sectionIndex];
      const point = section.points[vertexIndex];
      const where = `section ${sectionIndex} vertex ${vertexIndex}`;
      // 10 = X, 20 = Y, 30 = Z. A value on any other code is a value the reader never sees.
      expect(Number(groupValue(entity, 10)), `${where} X`).toBeCloseTo(point.x, 9);
      expect(Number(groupValue(entity, 20)), `${where} Y`).toBeCloseTo(point.y, 9);
      expect(Number(groupValue(entity, 30)), `${where} Z`).toBeCloseTo(section.elevation ?? 0, 9);
      // R12 wants fixed-format decimals, never a bare integer and never an exponent.
      for (const code of [10, 20, 30]) expect(groupValue(entity, code), `${where} code ${code}`).toMatch(/^-?\d+\.\d{6}$/);
      // Nothing may be emitted on a neighbouring code R12 does not read for a VERTEX.
      expect(entity.groups.map((group) => group.code).filter((code) => code > 30 && code < 40)).toEqual([]);
      vertexIndex += 1;
    }
    expect(sectionIndex).toBe(sections.length - 1);
  });

  it('carries each profile at its OWN elevation, taken from its vertices not its header', () => {
    const entities = dxfEntities(dxfPairs(toDxfR12(sections)));
    const elevations = entities
      .filter((entity) => entity.type === 'VERTEX')
      .map((entity) => Number(groupValue(entity, 30)));
    expect(elevations.slice(0, sections[0].points.length).every((z) => z === 0)).toBe(true);
    expect(elevations.slice(sections[0].points.length).every((z) => z === 2.5)).toBe(true);
  });

  it('rejects an empty profile rather than emitting a POLYLINE with no vertices', () => {
    expect(() => toDxfR12([{ name: 'empty', points: [] }])).toThrow(/has no points/);
  });
});
