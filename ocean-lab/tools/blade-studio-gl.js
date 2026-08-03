/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — Blade Studio's geometry half: the NACA
 *                     |                             | outline, the lofted solid, the four CAD writers, and a
 *                     |                             | hand-rolled WebGL2 viewer. It is a SEPARATE file from the
 *                     |                             | model half for one reason that is not tidiness: both halves
 *                     |                             | are near the 1000-code-line cap on their own, and a surface
 *                     |                             | that cannot be extended without failing the lint gate is a
 *                     |                             | surface nobody extends. The split is drawn where the data
 *                     |                             | dependency already is — everything here consumes a blade
 *                     |                             | spec and produces triangles or bytes; nothing here knows
 *                     |                             | what a Reynolds number is.
 *                     |                             |
 *                     |                             | The renderer is deliberately NOT lifted from the splat
 *                     |                             | viewer in src/api/spaces-viewer.html. Its camera, its
 *                     |                             | resize poll and its input binding are; its context flags
 *                     |                             | are inverted (depth+MSAA on, blending off), because a
 *                     |                             | shaded solid and an alpha-blended point cloud want
 *                     |                             | opposite render state and copying that block verbatim
 *                     |                             | yields a mesh with no depth buffer at all.
 */

/* global window, document */

(function (global) {
  'use strict';

  /* =========================================================================
   * 1. Diagnostics — Pino-shaped, never a bare console.log.
   * ====================================================================== */

  /**
   * @description Emit a structured warning in the shape the platform's Pino logger uses, so a
   * surface warning read out of a browser console lines up with a server log line. Surfaces cannot
   * import '@/shared/logger' (it is a Node module), and a silent catch is worse than a shaped one.
   * @param msg - What went wrong.
   * @param ctx - Structured context; never secrets.
   * @returns Nothing.
   */
  function surfaceWarn(msg, ctx) {
    if (global.console && typeof global.console.warn === 'function') {
      global.console.warn({ module: 'api:blade-studio-gl', msg: msg, ctx: ctx || {} });
    }
  }

  /* =========================================================================
   * 2. Vector and matrix maths — plain arrays, column-major, pure.
   * ====================================================================== */

  /** @description Subtract two 3-vectors. @param a - Left. @param b - Right. @returns a − b. */
  function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  /** @description Add two 3-vectors. @param a - Left. @param b - Right. @returns a + b. */
  function vadd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  /** @description Scale a 3-vector. @param a - Vector. @param s - Scalar. @returns a · s. */
  function vscale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  /** @description Dot product. @param a - Left. @param b - Right. @returns a · b. */
  function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  /** @description Cross product. @param a - Left. @param b - Right. @returns a × b. */
  function vcross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  /** @description Euclidean length. @param a - Vector. @returns |a|. */
  function vlen(a) { return Math.sqrt(vdot(a, a)); }
  /**
   * @description Normalise, guarding the zero vector so a degenerate camera basis yields a finite
   * matrix rather than NaNs that silently blank the canvas.
   * @param a - Vector.
   * @returns Unit vector.
   */
  function vnorm(a) { return vscale(a, 1 / (vlen(a) || 1e-8)); }

  /**
   * @description Column-major OpenGL view matrix. Contains the up-parallel-to-view guard: at the
   * pitch clamp the cross product is still well conditioned, but a caller supplying its own target
   * can reach the degenerate case, and a NaN matrix renders nothing with no error anywhere.
   * @param eye - Camera position.
   * @param center - Look-at point.
   * @param up - World up.
   * @returns 16 numbers, column-major, ready for uniformMatrix4fv with transpose false.
   */
  function lookAt(eye, center, up) {
    var z = vnorm(vsub(eye, center));
    var x = vcross(up, z);
    if (vlen(x) < 1e-6) x = [1, 0, 0];
    x = vnorm(x);
    var y = vcross(z, x);
    return [
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -vdot(x, eye), -vdot(y, eye), -vdot(z, eye), 1
    ];
  }

  /**
   * @description Column-major perspective projection.
   * @param fovy - Vertical field of view, radians.
   * @param aspect - Drawing-buffer width / height (NOT client size).
   * @param near - Near plane.
   * @param far - Far plane.
   * @returns 16 numbers, column-major.
   */
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2);
    var nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }

  /**
   * @description Column-major rotation about the +Y axis — the rotor's own axis in this scene, so
   * this is the only model transform the viewer ever needs. Being a pure rotation is what lets the
   * shader transform normals with `mat3(uModel)` instead of an inverse transpose.
   * @param angleRad - Rotation angle, radians.
   * @returns 16 numbers, column-major.
   */
  function rotationY(angleRad) {
    var c = Math.cos(angleRad);
    var s = Math.sin(angleRad);
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  }

  /* =========================================================================
   * 3. The NACA 4-digit section — mirrors src/features/rotor-design/services/naca-section.ts.
   * ====================================================================== */

  /**
   * @description Thickness-law coefficients. The last term is −0.1036, NOT the −0.1015 of the
   * original open-trailing-edge report: −0.1036 makes the polynomial sum to exactly zero at x = 1,
   * so the trailing edge CLOSES. The open form leaves a ~0.2 %c gap which lofts into a slot down the
   * blade's trailing edge — a non-manifold mesh, which does not slice.
   */
  var THICKNESS_COEFFICIENTS = [0.2969, -0.126, -0.3516, 0.2843, -0.1036];

  /** @description Default chordwise stations per surface. 48 resolves the nose under cosine spacing. */
  var DEFAULT_SECTION_STATIONS = 48;

  /**
   * @description Half-thickness of a NACA 4-digit section, as a fraction of chord.
   * @param x - Chordwise position, 0..1.
   * @param thickness - Maximum thickness fraction.
   * @returns Half-thickness, exactly 0 at x = 0 and x = 1.
   */
  function nacaThickness(x, thickness) {
    var c = THICKNESS_COEFFICIENTS;
    var series = c[0] * Math.sqrt(x) + c[1] * x + c[2] * x * x + c[3] * x * x * x + c[4] * x * x * x * x;
    return 5 * thickness * series;
  }

  /**
   * @description Mean camber ordinate and slope. A section with zero camber degrades to symmetric
   * REGARDLESS of camberPos — that guard is what keeps "NACA 0012", whose second digit is 0, from
   * dividing by zero on the most common section anyone asks for.
   * @param x - Chordwise position, 0..1.
   * @param maxCamber - Maximum camber fraction.
   * @param camberPos - Chordwise position of maximum camber.
   * @returns `{ yc, slope }`, both fractions of chord.
   */
  function nacaCamber(x, maxCamber, camberPos) {
    if (!maxCamber) return { yc: 0, slope: 0 };
    var p = Math.min(Math.max(camberPos, 0.05), 0.95);
    if (x < p) {
      var k = maxCamber / (p * p);
      return { yc: k * (2 * p * x - x * x), slope: 2 * k * (p - x) };
    }
    var k2 = maxCamber / ((1 - p) * (1 - p));
    return { yc: k2 * (1 - 2 * p + 2 * p * x - x * x), slope: 2 * k2 * (p - x) };
  }

  /**
   * @description Cosine-spaced chordwise stations, clustered at both ends. Uniform spacing gives the
   * leading edge the same panel length as mid-chord, which under-resolves the suction peak (spoiling
   * the panel solution downstream) and flattens the printed nose radius.
   * @param count - Station count, at least 3.
   * @returns Ascending stations, exactly 0 first and exactly 1 last.
   */
  function cosineStations(count) {
    var n = Math.max(3, Math.round(count));
    var out = [];
    for (var i = 0; i < n; i += 1) out.push(0.5 * (1 - Math.cos((Math.PI * i) / (n - 1))));
    out[0] = 0;
    out[n - 1] = 1;
    return out;
  }

  /**
   * @description Closed outline of a NACA 4-digit section, chord normalised to 1, traversed
   * trailing edge → upper surface → leading edge → lower surface. The closing point is deliberately
   * NOT repeated and the leading edge is shared rather than duplicated: a repeated point is a
   * zero-length edge, which lofts into a zero-area facet, which is exactly what a slicer refuses.
   * @param spec - `{ maxCamber, camberPos, thickness }` as fractions.
   * @param stationsPerSurface - Chordwise stations per surface.
   * @returns Array of `2·stationsPerSurface − 2` points `{ x, y }`.
   */
  function nacaSection(spec, stationsPerSurface) {
    var stations = cosineStations(stationsPerSurface || DEFAULT_SECTION_STATIONS);
    var upper = [];
    var lower = [];
    for (var i = 0; i < stations.length; i += 1) {
      var x = stations[i];
      var yt = nacaThickness(x, spec.thickness);
      var cam = nacaCamber(x, spec.maxCamber, spec.camberPos);
      var theta = Math.atan(cam.slope);
      var sin = Math.sin(theta);
      var cos = Math.cos(theta);
      upper.push({ x: x - yt * sin, y: cam.yc + yt * cos });
      lower.push({ x: x + yt * sin, y: cam.yc - yt * cos });
    }
    return upper.slice(1).reverse().concat([upper[0]], lower.slice(1, lower.length - 1));
  }

  /* =========================================================================
   * 4. The loft — mirrors src/shared/geometry/mesh-loft.ts and mesh-metrics.ts.
   * ====================================================================== */

  /** @description Chordwise position of the pitch axis. The quarter-chord is a thin section's
   * aerodynamic centre, so twisting about it keeps the twist schedule and the aerodynamic model
   * describing the same blade. */
  var PITCH_AXIS_CHORD_FRACTION = 0.25;

  /**
   * @description Map a 2-D profile into 3-space: scale and rotate about the pivot, then project onto
   * the placement axes and translate. Domain-free by design — a rotor supplies chord/twist/radius.
   * @param points - Profile points `{ x, y }`.
   * @param place - `{ origin, scale, rotationRad, pivot }`.
   * @returns Points in 3-space as `{ x, y, z }`.
   */
  function placeSection(points, place) {
    var cos = Math.cos(place.rotationRad);
    var sin = Math.sin(place.rotationRad);
    return points.map(function (p) {
      var dx = (p.x - place.pivot.x) * place.scale;
      var dy = (p.y - place.pivot.y) * place.scale;
      return {
        x: place.origin.x + dx * cos - dy * sin,
        y: place.origin.y + dx * sin + dy * cos,
        z: place.origin.z
      };
    });
  }

  /**
   * @description Signed volume by the divergence theorem, ⅙ Σ a·(b × c). Signed on purpose: it is
   * the cheapest orientation test there is, and the loft uses its sign to decide whether the caller
   * handed it clockwise rings rather than trusting a handedness convention.
   * @param mesh - `{ vertices, triangles }`.
   * @returns Signed volume in the mesh's cubed units.
   */
  function meshVolume(mesh) {
    var total = 0;
    for (var i = 0; i < mesh.triangles.length; i += 1) {
      var t = mesh.triangles[i];
      var a = mesh.vertices[t[0]];
      var b = mesh.vertices[t[1]];
      var c = mesh.vertices[t[2]];
      total += a.x * (b.y * c.z - b.z * c.y) + a.y * (b.z * c.x - b.x * c.z) + a.z * (b.x * c.y - b.y * c.x);
    }
    return total / 6;
  }

  /**
   * @description Axis-aligned bounds of a vertex cloud.
   * @param mesh - `{ vertices }`.
   * @returns `{ min, max, size }` — or null for an empty mesh, because an empty box has no centre
   * and returning zeros would let an empty export sail through a print-bed check.
   */
  function meshBounds(mesh) {
    if (!mesh || !mesh.vertices.length) return null;
    var mn = { x: Infinity, y: Infinity, z: Infinity };
    var mx = { x: -Infinity, y: -Infinity, z: -Infinity };
    mesh.vertices.forEach(function (v) {
      mn.x = Math.min(mn.x, v.x); mn.y = Math.min(mn.y, v.y); mn.z = Math.min(mn.z, v.z);
      mx.x = Math.max(mx.x, v.x); mx.y = Math.max(mx.y, v.y); mx.z = Math.max(mx.z, v.z);
    });
    return { min: mn, max: mx, size: { x: mx.x - mn.x, y: mx.y - mn.y, z: mx.z - mn.z } };
  }

  /**
   * @description Emit the two facets of every quad between two rings, by INDEX. Adjacent quads name
   * the same vertex indices, so a shared edge is shared by identity and no epsilon can open a seam.
   * @param triangles - Facet list, mutated.
   * @param perRing - Points per ring.
   * @param baseA - Vertex offset of the lower ring.
   * @param baseB - Vertex offset of the upper ring.
   * @returns Nothing.
   */
  function appendStrip(triangles, perRing, baseA, baseB) {
    for (var i = 0; i < perRing; i += 1) {
      var n = (i + 1) % perRing;
      triangles.push([baseA + i, baseA + n, baseB + n]);
      triangles.push([baseA + i, baseB + n, baseB + i]);
    }
  }

  /**
   * @description Fan-cap one end of a loft from an appended centroid vertex. A fan closes ANY simple
   * ring — including the concave trailing edge of an aerofoil, where an ear-clip would have to be
   * correct to avoid a hole.
   * @param vertices - Vertex list, mutated (the centroid is appended).
   * @param triangles - Facet list, mutated.
   * @param ring - The ring being capped.
   * @param base - Vertex offset of that ring.
   * @param end - 'start' or 'end'; the start cap winds the other way so both caps face outward.
   * @returns Nothing.
   */
  function appendCap(vertices, triangles, ring, base, end) {
    var sum = { x: 0, y: 0, z: 0 };
    ring.forEach(function (p) { sum.x += p.x; sum.y += p.y; sum.z += p.z; });
    var c = vertices.length;
    vertices.push({ x: sum.x / ring.length, y: sum.y / ring.length, z: sum.z / ring.length });
    for (var i = 0; i < ring.length; i += 1) {
      var n = (i + 1) % ring.length;
      triangles.push(end === 'start' ? [c, base + n, base + i] : [c, base + i, base + n]);
    }
  }

  /**
   * @description Loft placed sections into an indexed triangle mesh with both ends capped, then
   * MEASURE the orientation and flip the winding if the solid came out inside out. Measuring rather
   * than assuming is why a caller does not have to know this file's handedness to get a printable
   * part.
   * @param sections - Placed sections in span order, all with the same point count.
   * @returns `{ vertices, triangles }`, watertight for simple input profiles.
   */
  function loftSections(sections) {
    var perRing = sections[0].length;
    var vertices = [];
    sections.forEach(function (ring) { ring.forEach(function (p) { vertices.push(p); }); });
    var triangles = [];
    for (var s = 0; s + 1 < sections.length; s += 1) appendStrip(triangles, perRing, s * perRing, (s + 1) * perRing);
    appendCap(vertices, triangles, sections[0], 0, 'start');
    appendCap(vertices, triangles, sections[sections.length - 1], (sections.length - 1) * perRing, 'end');
    var mesh = { vertices: vertices, triangles: triangles };
    if (meshVolume(mesh) < 0) {
      mesh.triangles = triangles.map(function (t) { return [t[0], t[2], t[1]]; });
    }
    return mesh;
  }

  /**
   * @description Loft a blade into a watertight triangle mesh, ready to export and print. One
   * section per design station: scaled by that station's chord, rotated by MINUS its total blade
   * angle (twist plus collective pitch — negative because a nose-up blade rotates its leading edge
   * into the oncoming flow, which is clockwise in the section's own plane), and translated out
   * along +Z to its radius.
   * @param blade - `{ tipRadiusM, hubRadiusM, bladeCount, pitchDeg, stations[] }`.
   * @param sectionPoints - Chordwise stations per surface.
   * @returns `{ vertices, triangles }` in METRES.
   */
  function bladeToMesh(blade, sectionPoints) {
    var n = sectionPoints || DEFAULT_SECTION_STATIONS;
    var sorted = blade.stations.slice().sort(function (a, b) { return a.radiusFrac - b.radiusFrac; });
    var placed = sorted.map(function (st) {
      var angleRad = ((st.twistDeg + blade.pitchDeg) * Math.PI) / 180;
      return placeSection(nacaSection(st.section, n), {
        origin: { x: 0, y: 0, z: st.radiusFrac * blade.tipRadiusM },
        scale: Math.max(st.chordM, 1e-6),
        rotationRad: -angleRad,
        pivot: { x: PITCH_AXIS_CHORD_FRACTION, y: 0 }
      });
    });
    return loftSections(placed);
  }

  /**
   * @description Parse NACA 4-digit text into the fractions the closed-form laws consume. "4412"
   * becomes `{ maxCamber: 0.04, camberPos: 0.4, thickness: 0.12 }` — fractions rather than digits
   * because that is what the thickness and camber laws take, and because a designer sweeping 11.5 %
   * thickness should not have to ask whether the name "NACA 441.5" means anything.
   *
   * The digits set the TIP thickness; the root carries its own control, because a printed root has
   * to carry the whole bending moment and thickening it must not rename the aerofoil family.
   * `camberPos` is floored at one tenth: a literal second digit of 0 on a cambered section would
   * divide by zero in the camber law.
   * @param digits - Four-character NACA designation.
   * @returns `{ maxCamber, camberPos, thickness }`.
   */
  function nacaSpec(digits) {
    var text = String(digits || '').replace(/[^0-9]/g, '');
    var padded = (text + '0012').slice(0, 4);
    var thickness = parseInt(padded.slice(2), 10) / 100;
    return {
      maxCamber: parseInt(padded.charAt(0), 10) / 100,
      camberPos: Math.max(parseInt(padded.charAt(1), 10), 1) / 10,
      thickness: thickness > 0 ? thickness : 0.12
    };
  }

  /**
   * @description Carry root twist out to the tip under the selected law. Hyperbolic is the shape the
   * Betz optimum actually has — `φ = ⅔ atan(1/λ_r)` falls as roughly 1/r — so it is the default;
   * linear is what a machinist would cut; cosine softens the root where a printed blade is thickest.
   * @param law - Law id: 'hyperbolic' | 'linear' | 'cosine'.
   * @param frac - Normalised span position, 0 at the hub and 1 at the tip.
   * @param hubFrac - Hub radius as a fraction of tip radius, the hyperbolic law's inner anchor.
   * @returns Blend weight, 0 at the root and 1 at the tip.
   */
  function twistBlend(law, frac, hubFrac) {
    if (law === 'linear') return frac;
    if (law === 'cosine') return 0.5 * (1 - Math.cos(Math.PI * frac));
    var r0 = Math.max(hubFrac, 1e-3);
    var r = r0 + frac * (1 - r0);
    return (1 / r0 - 1 / r) / (1 / r0 - 1);
  }

  /**
   * @description Build the blade the controls describe: chord linear from root to tip, twist carried
   * out under the selected law, thickness tapering from the structural root value to the aerofoil's
   * own. Thickness is QUANTISED to whole percent — not cosmetic: the panel solve downstream is
   * memoised on the exact section values, so quantising turns thirteen dense factorisations into
   * about six, at a cost (half a percent of chord) far below the accuracy of anything that reads it.
   * @param s - Control state: radii, chords, twists, law, pitch and NACA digits.
   * @returns A `{ tipRadiusM, hubRadiusM, bladeCount, pitchDeg, stations }` blade spec.
   */
  function buildBlade(s) {
    var tipSpec = nacaSpec(s.naca);
    var stations = [];
    var count = 13;
    for (var i = 0; i < count; i += 1) {
      var frac = i / (count - 1);
      var thickness = Math.round((s.rootThickness + frac * (tipSpec.thickness - s.rootThickness)) * 100) / 100;
      stations.push({
        radiusFrac: s.hubFrac + (1 - s.hubFrac) * frac,
        chordM: s.rootChordM + frac * (s.tipChordM - s.rootChordM),
        twistDeg: s.rootTwistDeg + twistBlend(s.twistLaw, frac, s.hubFrac) * (s.tipTwistDeg - s.rootTwistDeg),
        section: { maxCamber: tipSpec.maxCamber, camberPos: tipSpec.camberPos, thickness: thickness }
      });
    }
    return {
      tipRadiusM: s.tipRadiusM, hubRadiusM: s.hubFrac * s.tipRadiusM, bladeCount: s.bladeCount,
      pitchDeg: s.pitchDeg, stations: stations
    };
  }

  /**
   * @description Unit normal of one facet, from the winding. Nothing is cached on the mesh: a normal
   * is a FUNCTION of the winding, and a stored copy is one refactor away from disagreeing with the
   * geometry it claims to describe.
   * @param a - First corner.
   * @param b - Second corner.
   * @param c - Third corner.
   * @returns `[x, y, z]`, the zero vector for a degenerate facet (the STL convention).
   */
  function facetNormal(a, b, c) {
    var n = vcross([b.x - a.x, b.y - a.y, b.z - a.z], [c.x - a.x, c.y - a.y, c.z - a.z]);
    var len = vlen(n);
    return len > 0 ? vscale(n, 1 / len) : [0, 0, 0];
  }

  /* =========================================================================
   * 5. CAD writers — mirror src/shared/geometry/export-*.ts.
   * ====================================================================== */

  /**
   * @description Format for a text CAD file: rounded, trailing zeros dropped, never `-0` (some
   * slicers read it as a NaN sentinel), never exponent notation.
   * @param value - Number to format.
   * @param decimals - Decimal places. Default 6 — a micron at millimetre scale.
   * @returns A plain decimal string.
   */
  function formatFloat(value, decimals) {
    var rounded = Number(value.toFixed(decimals === undefined ? 6 : decimals));
    return String(Object.is(rounded, -0) ? 0 : rounded);
  }

  /**
   * @description Format with the decimal places KEPT. DXF group values are read by fixed-format
   * parsers that are happier with `1.000000` than with `1`, so the DXF writer pays the extra bytes.
   * @param value - Number to format.
   * @returns A fixed-width decimal string.
   */
  function formatFixed(value) { return (Object.is(value, -0) ? 0 : value).toFixed(6); }

  /**
   * @description Sanitise a solid name to a single token. STL and OBJ readers tokenise on
   * whitespace, so a name with a space silently becomes two tokens and `endsolid` stops matching.
   * @param name - Requested name.
   * @returns A single-token name, never empty.
   */
  function sanitizeSolidName(name) {
    var cleaned = String(name || '').trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
    return cleaned.length ? cleaned : 'oshal_blade';
  }

  /**
   * @description Serialise a mesh as BINARY STL — the format every slicer takes. The buffer is
   * allocated at its exact final size (84 + 50n) up front rather than grown: the size is a hard
   * property of the format, so allocating it is also asserting it. The 80-byte header deliberately
   * does not begin with the token `solid`, which readers sniff to decide ASCII vs binary — a binary
   * file starting with it gets parsed as text and rejected as empty.
   * @param mesh - Mesh to write, in metres.
   * @param scale - Multiplier applied to every coordinate. Pass 1000 to emit millimetres.
   * @returns A Uint8Array of exactly `84 + 50 · triangles` bytes.
   */
  function toStlBinary(mesh, scale) {
    var k = scale || 1;
    var count = mesh.triangles.length;
    var buffer = new ArrayBuffer(84 + 50 * count);
    var view = new DataView(buffer);
    var header = 'oshal blade studio binary STL - ' + count + ' facets';
    for (var h = 0; h < 80; h += 1) {
      var code = h < header.length ? header.charCodeAt(h) : 0x20;
      view.setUint8(h, code > 0 && code < 0x80 ? code : 0x20);
    }
    view.setUint32(80, count, true);
    for (var i = 0; i < count; i += 1) {
      var t = mesh.triangles[i];
      var a = mesh.vertices[t[0]];
      var b = mesh.vertices[t[1]];
      var c = mesh.vertices[t[2]];
      var n = facetNormal(a, b, c);
      var at = 84 + 50 * i;
      view.setFloat32(at, n[0], true); view.setFloat32(at + 4, n[1], true); view.setFloat32(at + 8, n[2], true);
      [a, b, c].forEach(function (p, j) {
        var o = at + 12 + j * 12;
        view.setFloat32(o, p.x * k, true);
        view.setFloat32(o + 4, p.y * k, true);
        view.setFloat32(o + 8, p.z * k, true);
      });
      view.setUint16(at + 48, 0, true);
    }
    return new Uint8Array(buffer);
  }

  /**
   * @description Serialise a mesh as Wavefront OBJ. OBJ indices are 1-BASED, which is the single
   * most-repeated bug in every hand-rolled exporter: a 0-based file loads without complaint, drops
   * the last facet and shifts every other one by a vertex, so the model looks *almost* right. The
   * `+ 1` lives in exactly one expression here. Unlike STL, OBJ keeps the mesh indexed, so it is the
   * right handover format to a tool that will keep editing the model.
   * @param mesh - Mesh to write, in metres.
   * @param name - Object name; sanitised to one token.
   * @param scale - Coordinate multiplier (1000 for millimetres).
   * @returns The complete file text.
   */
  function toObj(mesh, name, scale) {
    var k = scale || 1;
    var object = sanitizeSolidName(name);
    var lines = [
      '# oshal blade studio OBJ export',
      '# vertices ' + mesh.vertices.length + ' triangles ' + mesh.triangles.length,
      'o ' + object
    ];
    mesh.vertices.forEach(function (v) {
      lines.push('v ' + formatFloat(v.x * k) + ' ' + formatFloat(v.y * k) + ' ' + formatFloat(v.z * k));
    });
    mesh.triangles.forEach(function (t) {
      var n = facetNormal(mesh.vertices[t[0]], mesh.vertices[t[1]], mesh.vertices[t[2]]);
      lines.push('vn ' + formatFloat(n[0]) + ' ' + formatFloat(n[1]) + ' ' + formatFloat(n[2]));
    });
    mesh.triangles.forEach(function (t, i) {
      lines.push('f ' + (t[0] + 1) + '//' + (i + 1) + ' ' + (t[1] + 1) + '//' + (i + 1) + ' ' + (t[2] + 1) + '//' + (i + 1));
    });
    return lines.join('\n') + '\n';
  }

  /**
   * @description Serialise a mesh as an OpenSCAD module. Two things are load-bearing. The parameter
   * block opens the file with named assignments for the DESIGN inputs so an engineer can read them
   * in CAD — and the header says plainly that SCAD does not re-derive the loft from them, because a
   * parameter that silently does nothing is worse than no parameter. And face winding is REVERSED
   * on the way out: OpenSCAD's polyhedron wants each face clockwise seen from OUTSIDE, the opposite
   * of this file's (and STL's) convention, so emitting our winding verbatim renders the solid inside
   * out and CGAL calls it non-2-manifold.
   * @param mesh - Mesh to write, in metres.
   * @param options - `{ name, parameters, scale }`.
   * @returns The complete `.scad` source.
   */
  function toOpenScad(mesh, options) {
    var opts = options || {};
    var k = opts.scale || 1;
    var name = sanitizeSolidName(opts.name).replace(/[.-]/g, '_');
    var params = opts.parameters || {};
    var lines = [
      '// oshal blade studio - OpenSCAD export (millimetres)',
      '// The parameters below are the design inputs this solid was built from. They are here to',
      '// stay readable and editable in CAD; the polyhedron() is the BAKED loft, so changing a',
      '// parameter documents intent rather than re-lofting the blade.',
      ''
    ];
    Object.keys(params).forEach(function (key) {
      var v = params[key];
      lines.push(key.replace(/[^A-Za-z0-9_]+/g, '_') + ' = ' + (typeof v === 'number' ? formatFloat(v) : '"' + v + '"') + ';');
    });
    lines.push('', 'module ' + name + '() {', '  polyhedron(', '    points = [');
    lines.push(mesh.vertices.map(function (v) {
      return '      [' + formatFloat(v.x * k) + ', ' + formatFloat(v.y * k) + ', ' + formatFloat(v.z * k) + ']';
    }).join(',\n'));
    lines.push('    ],', '    faces = [');
    lines.push(mesh.triangles.map(function (t) { return '      [' + t[0] + ', ' + t[2] + ', ' + t[1] + ']'; }).join(',\n'));
    lines.push('    ],', '    convexity = 10', '  );', '}', '', name + '();');
    return lines.join('\n') + '\n';
  }

  /**
   * @description Emit a DXF group code and its value as the two lines DXF is made of. Every line in
   * the file goes through here so the strict "code line, value line" pairing cannot drift.
   * @param code - Group code.
   * @param value - Value line.
   * @returns The two lines.
   */
  function dxfGroup(code, value) { return [String(code), value]; }

  /**
   * @description Coerce a name into an R12 layer name. R12 predates the relaxed naming of later
   * revisions, so a space or a slash here is a file some importers reject.
   * @param name - Requested name.
   * @param ordinal - Position, used when the name sanitises away entirely.
   * @returns A legal R12 layer name, at most 31 characters.
   */
  function toDxfLayerName(name, ordinal) {
    var cleaned = String(name || '').trim().toUpperCase().replace(/[^A-Z0-9_$-]+/g, '_').replace(/^_+|_+$/g, '');
    return cleaned.length ? cleaned.slice(0, 31) : 'SECTION_' + ordinal;
  }

  /**
   * @description The LAYER table, declaring every layer the entities reference plus R12's layer 0 —
   * an entity on an undeclared layer is where strict importers give up.
   * @param layers - Layer names in use, already sanitised.
   * @returns The TABLES section lines.
   */
  function dxfTables(layers) {
    var unique = ['0'];
    layers.forEach(function (l) { if (unique.indexOf(l) < 0) unique.push(l); });
    var lines = [].concat(
      dxfGroup(0, 'SECTION'), dxfGroup(2, 'TABLES'), dxfGroup(0, 'TABLE'),
      dxfGroup(2, 'LAYER'), dxfGroup(70, String(unique.length))
    );
    unique.forEach(function (layer) {
      lines = lines.concat(
        dxfGroup(0, 'LAYER'), dxfGroup(2, layer), dxfGroup(70, '0'),
        dxfGroup(62, '7'), dxfGroup(6, 'CONTINUOUS')
      );
    });
    return lines.concat(dxfGroup(0, 'ENDTAB'), dxfGroup(0, 'ENDSEC'));
  }

  /**
   * @description Serialise 2-D profiles as a DXF R12 drawing — one POLYLINE per profile, on its own
   * named layer, at its own elevation. R12 is the target on purpose: it is the most widely
   * importable revision there is, and LWPOLYLINE does not exist before R13 (a reader silently drops
   * it). The 66 flag ("vertices follow") is mandatory in R12; without it the profile arrives empty.
   * This is the 2-D companion to the solid writers — what goes to a laser cutter or a draughtsman
   * checking stations against a table, neither of whom wants a triangulated solid.
   * @param sections - `[{ name, elevation, points }]`, points already in the output units.
   * @returns The complete `.dxf` text.
   */
  function toDxfR12(sections) {
    var layers = sections.map(function (s, i) { return toDxfLayerName(s.name, i); });
    var entities = [];
    sections.forEach(function (section, index) {
      var layer = layers[index];
      var elevation = section.elevation || 0;
      entities = entities.concat(
        dxfGroup(0, 'POLYLINE'), dxfGroup(8, layer), dxfGroup(66, '1'),
        dxfGroup(10, formatFixed(0)), dxfGroup(20, formatFixed(0)), dxfGroup(30, formatFixed(elevation)),
        dxfGroup(70, '1')
      );
      section.points.forEach(function (p) {
        entities = entities.concat(
          dxfGroup(0, 'VERTEX'), dxfGroup(8, layer),
          dxfGroup(10, formatFixed(p.x)), dxfGroup(20, formatFixed(p.y)), dxfGroup(30, formatFixed(elevation))
        );
      });
      entities = entities.concat(dxfGroup(0, 'SEQEND'), dxfGroup(8, layer));
    });
    var lines = [].concat(
      dxfGroup(0, 'SECTION'), dxfGroup(2, 'HEADER'), dxfGroup(9, '$ACADVER'), dxfGroup(1, 'AC1009'),
      dxfGroup(9, '$INSBASE'), dxfGroup(10, formatFixed(0)), dxfGroup(20, formatFixed(0)),
      dxfGroup(30, formatFixed(0)), dxfGroup(0, 'ENDSEC'),
      dxfTables(layers),
      dxfGroup(0, 'SECTION'), dxfGroup(2, 'ENTITIES'), entities, dxfGroup(0, 'ENDSEC'), dxfGroup(0, 'EOF')
    );
    return lines.join('\n') + '\n';
  }

  /* =========================================================================
   * 6. The WebGL2 viewer.
   * ====================================================================== */

  /** @description Vertical field of view, radians. */
  var FOVY = (55 * Math.PI) / 180;
  /** @description World up. The rotor's own axis is +Y, so the disc lies in the X–Z plane. */
  var WORLD_UP = [0, 1, 0];
  /** @description Pitch clamp, radians (~86°) — beyond it the view aligns with WORLD_UP. */
  var PITCH_LIMIT = 1.5;

  /**
   * @description Vertex shader. Attribute locations are declared in GLSL rather than looked up by
   * name, so the JS side binds literal 0 and 1. Normals are transformed by `mat3(uModel)` — correct
   * here and ONLY here because every model matrix in this scene is a pure rotation about Y; add a
   * non-uniform scale and this needs an inverse transpose.
   */
  var VERTEX_SOURCE = [
    '#version 300 es',
    'layout(location = 0) in vec3 aPos;',
    'layout(location = 1) in vec3 aNormal;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'uniform mat4 uModel;',
    'out vec3 vNormal;',
    'out vec3 vToEye;',
    'void main() {',
    '  vec4 cam = uView * uModel * vec4(aPos, 1.0);',
    '  vNormal = mat3(uModel) * aNormal;',
    '  vToEye = -cam.xyz;',
    '  gl_Position = uProj * cam;',
    '}'
  ].join('\n');

  /**
   * @description Fragment shader: two-sided Lambert with a hemispheric ambient and a restrained
   * specular, plus an unlit branch for the reference grid. Two-sided (flipping the normal on a back
   * face) rather than back-face culling, so a blade that lofts inverted for some parameter combination
   * still renders as a solid instead of vanishing — a viewer that hides its own failure is worse
   * than one that shows a strange shape.
   */
  var FRAGMENT_SOURCE = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vNormal;',
    'in vec3 vToEye;',
    'uniform int uUnlit;',
    'uniform vec3 uColor;',
    'uniform vec3 uAmbient;',
    'uniform float uAlpha;',
    'out vec4 fragColor;',
    'void main() {',
    '  if (uUnlit == 1) { fragColor = vec4(uColor, uAlpha); return; }',
    '  vec3 n = normalize(vNormal);',
    '  if (!gl_FrontFacing) n = -n;',
    '  vec3 lightDir = normalize(vec3(0.42, 0.78, 0.55));',
    '  float lambert = max(dot(n, lightDir), 0.0);',
    '  float hemi = 0.5 + 0.5 * n.y;',
    '  vec3 eye = normalize(vToEye);',
    '  float spec = pow(max(dot(reflect(-lightDir, n), eye), 0.0), 26.0) * 0.22;',
    '  vec3 col = uAmbient * (0.55 + 0.45 * hemi) + uColor * (0.20 + 0.80 * lambert) + vec3(spec);',
    '  fragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /**
   * @description Compile one shader stage, surfacing the driver's log as a thrown error rather than
   * leaving a black canvas with nothing in the console.
   * @param gl - WebGL2 context.
   * @param type - gl.VERTEX_SHADER or gl.FRAGMENT_SHADER.
   * @param src - GLSL source.
   * @returns The compiled shader.
   */
  function compileShader(gl, type, src) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('Shader compile failed: ' + log);
    }
    return shader;
  }

  /**
   * @description Compile and link the one program this viewer uses, deleting the stages afterwards.
   * @param gl - WebGL2 context.
   * @returns The linked program.
   */
  function linkProgram(gl) {
    var vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
    var fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Shader link failed: ' + gl.getProgramInfoLog(program));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return program;
  }

  /**
   * @description Expand an indexed mesh into a NON-indexed interleaved buffer of position + FACET
   * normal, three vertices per triangle. Flat shading is the deliberate choice: a smooth normal
   * averages across the leading edge and hides exactly the thing this viewer exists to show — the
   * spanwise twist reading as a visible change in facet brightness along the blade.
   * @param mesh - `{ vertices, triangles }`.
   * @returns A Float32Array of 18 floats per triangle.
   */
  function expandForFlatShading(mesh) {
    var out = new Float32Array(mesh.triangles.length * 18);
    var at = 0;
    for (var i = 0; i < mesh.triangles.length; i += 1) {
      var t = mesh.triangles[i];
      var corners = [mesh.vertices[t[0]], mesh.vertices[t[1]], mesh.vertices[t[2]]];
      var n = facetNormal(corners[0], corners[1], corners[2]);
      for (var c = 0; c < 3; c += 1) {
        out[at] = corners[c].x; out[at + 1] = corners[c].y; out[at + 2] = corners[c].z;
        out[at + 3] = n[0]; out[at + 4] = n[1]; out[at + 5] = n[2];
        at += 6;
      }
    }
    return out;
  }

  /**
   * @description Build the build-plate reference grid as a line list in the X–Z plane: a 10 mm
   * lattice with every tenth line (100 mm) carried in the emphasis buffer. Two buffers rather than
   * one because the 10 mm lattice must stay recessive while the 100 mm lines are the thing you
   * actually measure against.
   * @param extentM - Half-width of the plate, metres.
   * @param yM - Height of the plate, metres.
   * @returns `{ minor: Float32Array, major: Float32Array }`, position + a +Y normal per vertex.
   */
  function buildGrid(extentM, yM) {
    var step = 0.01;
    var half = Math.max(1, Math.ceil(extentM / step));
    var minor = [];
    var major = [];
    for (var i = -half; i <= half; i += 1) {
      var p = i * step;
      var edge = half * step;
      var target = i % 10 === 0 ? major : minor;
      target.push(p, yM, -edge, 0, 1, 0, p, yM, edge, 0, 1, 0);
      target.push(-edge, yM, p, 0, 1, 0, edge, yM, p, 0, 1, 0);
    }
    return { minor: new Float32Array(minor), major: new Float32Array(major) };
  }

  /**
   * @description Create a VAO over one interleaved position+normal buffer. Sized once with
   * bufferData at its final length; callers that re-upload the same-sized geometry replace the whole
   * buffer, which at these vertex counts costs less than the bookkeeping to avoid it.
   * @param gl - WebGL2 context.
   * @param data - Interleaved Float32Array, 6 floats per vertex.
   * @returns `{ vao, buffer, count }` where count is the vertex count.
   */
  function createGeometry(gl, data) {
    var vao = gl.createVertexArray();
    var buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
    return { vao: vao, buffer: buffer, count: data.length / 6 };
  }

  /**
   * @description Read a CSS custom property off the document root and parse it to normalised RGB.
   * The GL clear colour is a duplicate of a CSS colour by nature, and a hardcoded hex desynchronises
   * from the surface the moment the operator changes theme — so it is READ, not typed.
   * @param name - Custom property name.
   * @param fallback - `[r, g, b]` 0..1 used when the property is missing or unparseable.
   * @returns `[r, g, b]` in 0..1.
   */
  function readThemeColor(name, fallback) {
    var raw = (global.getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim();
    var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
    if (hex) {
      var body = hex[1].length === 3 ? hex[1].replace(/./g, function (ch) { return ch + ch; }) : hex[1];
      return [0, 2, 4].map(function (o) { return parseInt(body.substr(o, 2), 16) / 255; });
    }
    var rgb = /rgba?\(([^)]+)\)/i.exec(raw);
    if (rgb) {
      var parts = rgb[1].split(',').map(function (v) { return parseFloat(v); });
      if (parts.length >= 3 && parts.every(function (v) { return isFinite(v); })) {
        return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
      }
    }
    return fallback;
  }

  /**
   * @description Match the drawing buffer to the CSS box, capping device pixel ratio at 2 (a 3×
   * phone would quadruple fragment cost for no visible gain). Polled from the render loop rather
   * than driven by a resize listener, which is simpler AND catches CSS-driven reflows — an iframe
   * or a grid change — that a window resize event never fires for.
   * @param canvas - The canvas element.
   * @returns True when the buffer changed size.
   */
  function resizeIfNeeded(canvas) {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    return true;
  }

  /**
   * @description Attach mouse and keyboard orbiting to a canvas.
   *
   * Two bindings are load-bearing and are the reason this is lifted from the splat viewer rather
   * than rewritten: `mousemove`/`mouseup` go on WINDOW (so a fast drag that leaves the canvas keeps
   * tracking) while `mousedown`/`wheel`/`contextmenu` stay on the CANVAS (so the viewer does not
   * steal input from the rest of the page). And `wheel` must be registered `{ passive: false }` or
   * Chrome ignores preventDefault and the host page scrolls while you zoom.
   * @param canvas - The canvas element.
   * @param cam - Mutable camera state.
   * @returns A function that detaches every listener.
   */
  function attachInput(canvas, cam) {
    var dragging = false;
    var dragBtn = 0;
    var lastX = 0;
    var lastY = 0;
    function onDown(e) {
      dragging = true; dragBtn = e.button; lastX = e.clientX; lastY = e.clientY;
      canvas.focus();
      e.preventDefault();
    }
    function onUp() { dragging = false; }
    function onMove(e) {
      if (!dragging) return;
      var dx = e.clientX - lastX;
      var dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (dragBtn === 0) {
        cam.yaw -= dx * 0.005;
        cam.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cam.pitch - dy * 0.005));
        return;
      }
      var f = cam.forward();
      var right = vnorm(vcross(f, WORLD_UP));
      var up = vnorm(vcross(right, f));
      var k = cam.dist * 0.0016;
      cam.target = vadd(cam.target, vadd(vscale(right, -dx * k), vscale(up, dy * k)));
    }
    function onWheel(e) {
      cam.dist = Math.max(cam.scale * 0.05, Math.min(cam.scale * 40 + 1, cam.dist * Math.exp(e.deltaY * 0.001)));
      e.preventDefault();
    }
    function onContext(e) { e.preventDefault(); }
    function onKey(e) {
      var step = 0.12;
      if (e.code === 'ArrowLeft') cam.yaw -= step;
      else if (e.code === 'ArrowRight') cam.yaw += step;
      else if (e.code === 'ArrowUp') cam.pitch = Math.min(PITCH_LIMIT, cam.pitch + step);
      else if (e.code === 'ArrowDown') cam.pitch = Math.max(-PITCH_LIMIT, cam.pitch - step);
      else return;
      e.preventDefault();
    }
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContext);
    canvas.addEventListener('keydown', onKey);
    global.addEventListener('mousemove', onMove);
    global.addEventListener('mouseup', onUp);
    return function () {
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('keydown', onKey);
      global.removeEventListener('mousemove', onMove);
      global.removeEventListener('mouseup', onUp);
    };
  }

  /**
   * @description Fit the camera to a scene of a given bounding diagonal.
   *
   * The fit is `(diag/2) / tan(fovy/2)`, divided by aspect when the viewport is portrait, times a
   * padding factor. It is NOT the splat viewer's `sceneScale · 1.1`: that heuristic is tuned for
   * gaussian clouds whose edges fade out, and a hard-edged blade framed that way has its tips cut
   * off at the frame edge.
   * @param cam - Mutable camera state.
   * @param center - Scene centre `[x, y, z]`.
   * @param diag - Bounding-box diagonal.
   * @param aspect - Viewport aspect ratio.
   * @returns Nothing; the camera is updated in place.
   */
  function frameCamera(cam, center, diag, aspect) {
    var d = diag > 1e-6 ? diag : 1;
    cam.scale = d;
    cam.target = center.slice();
    var fit = (0.5 * d) / Math.tan(FOVY / 2);
    if (aspect < 1) fit /= Math.max(aspect, 0.2);
    cam.dist = fit * 1.18;
  }

  /**
   * @description Bounds of the swept ROTOR, given the bounds of one blade. Rotating a point about
   * +Y sweeps a circle of radius hypot(x, z), so the union over the blade copies is contained in a
   * box of that half-width in both X and Z with Y unchanged. Cheap, and an exact upper bound —
   * which is what a camera fit wants.
   * @param mesh - One blade's mesh.
   * @returns `{ center, diag, radius, bounds }`, or null for an empty mesh.
   */
  function rotorExtent(mesh) {
    var b = meshBounds(mesh);
    if (!b) return null;
    var radius = 0;
    mesh.vertices.forEach(function (v) { radius = Math.max(radius, Math.hypot(v.x, v.z)); });
    var size = { x: 2 * radius, y: b.size.y, z: 2 * radius };
    return {
      center: [0, (b.min.y + b.max.y) / 2, 0],
      diag: Math.hypot(size.x, size.y, size.z),
      radius: radius,
      bounds: b
    };
  }

  /**
   * @description Set every per-draw uniform and issue one draw call.
   * @param gl - WebGL2 context.
   * @param u - Cached uniform locations.
   * @param geom - `{ vao, count }`.
   * @param style - `{ model, unlit, color, ambient, alpha, mode }`.
   * @returns Nothing.
   */
  function drawGeometry(gl, u, geom, style) {
    gl.bindVertexArray(geom.vao);
    gl.uniformMatrix4fv(u.model, false, style.model);
    gl.uniform1i(u.unlit, style.unlit ? 1 : 0);
    gl.uniform3fv(u.color, style.color);
    gl.uniform3fv(u.ambient, style.ambient);
    gl.uniform1f(u.alpha, style.alpha === undefined ? 1 : style.alpha);
    gl.drawArrays(style.mode === 'lines' ? gl.LINES : gl.TRIANGLES, 0, geom.count);
  }

  /**
   * @description Mount a WebGL2 blade viewer on a canvas.
   *
   * Context flags are deliberately the INVERSE of the splat viewer's on the two that matter:
   * `depth: true` (a shaded solid without a depth attachment draws back faces over front ones, and
   * no depthFunc can fix a buffer that does not exist) and `antialias: true` (free quality on an
   * opaque mesh; splats disable it only because their quads are alpha-blended).
   * @param canvas - Canvas element; needs `tabindex` for keyboard orbit.
   * @returns A viewer handle `{ setBlade, setTheme, destroy, supported }`, or a handle with
   * `supported: false` when WebGL2 is unavailable — the caller shows a fallback, never a blank box.
   */
  function mount(canvas) {
    var gl = canvas.getContext('webgl2', {
      alpha: false, antialias: true, depth: true, premultipliedAlpha: false, preserveDrawingBuffer: false
    });
    if (!gl) {
      surfaceWarn('WebGL2 is not available in this browser', {});
      return { supported: false, setBlade: function () {}, setTheme: function () {}, destroy: function () {} };
    }
    var program;
    try {
      program = linkProgram(gl);
    } catch (err) {
      surfaceWarn('blade viewer shader failed', { error: err.message });
      return { supported: false, setBlade: function () {}, setTheme: function () {}, destroy: function () {} };
    }
    return runViewer(canvas, gl, program);
  }

  /**
   * @description Own the mounted viewer's state and render loop. Split from {@link mount} purely so
   * neither function runs past the 50-line limit; nothing here is reachable without a live context.
   * @param canvas - Canvas element.
   * @param gl - WebGL2 context.
   * @param program - The linked program.
   * @returns The viewer handle.
   */
  function runViewer(canvas, gl, program) {
    var u = {
      proj: gl.getUniformLocation(program, 'uProj'),
      view: gl.getUniformLocation(program, 'uView'),
      model: gl.getUniformLocation(program, 'uModel'),
      unlit: gl.getUniformLocation(program, 'uUnlit'),
      color: gl.getUniformLocation(program, 'uColor'),
      ambient: gl.getUniformLocation(program, 'uAmbient'),
      alpha: gl.getUniformLocation(program, 'uAlpha')
    };
    var cam = {
      yaw: 0.85, pitch: -0.34, dist: 0.6, scale: 0.5, target: [0, 0, 0],
      forward: function () {
        return [Math.cos(this.pitch) * Math.sin(this.yaw), Math.sin(this.pitch), Math.cos(this.pitch) * Math.cos(this.yaw)];
      }
    };
    var state = { blade: null, grid: null, gridMajor: null, bladeCount: 3, framed: false, running: true };
    var theme = { clear: [0.04, 0.04, 0.07], blade: [0.16, 0.47, 0.84], ambient: [0.09, 0.10, 0.16], grid: [0.5, 0.5, 0.6] };
    var detach = attachInput(canvas, cam);

    /**
     * @description Re-read the surface's own colours so the GL clear colour and the CSS background
     * cannot drift apart across a live theme switch.
     * @returns Nothing.
     */
    function setTheme() {
      theme.clear = readThemeColor('--bg-primary', theme.clear);
      theme.blade = readThemeColor('--blade-albedo', theme.blade);
      theme.ambient = readThemeColor('--blade-ambient', theme.ambient);
      theme.grid = readThemeColor('--text-muted', theme.grid);
    }

    /**
     * @description Replace the displayed rotor.
     * @param mesh - One blade's indexed mesh, in metres.
     * @param bladeCount - How many copies to draw around the +Y axis.
     * @returns The rotor extent, so the caller can report a printable size without re-measuring.
     */
    function setBlade(mesh, bladeCount) {
      var extent = rotorExtent(mesh);
      if (!extent) return null;
      if (state.blade) gl.deleteBuffer(state.blade.buffer);
      state.blade = createGeometry(gl, expandForFlatShading(mesh));
      state.bladeCount = Math.max(1, Math.round(bladeCount));
      var grid = buildGrid(extent.radius * 1.35, extent.bounds.min.y - extent.radius * 0.28);
      if (state.grid) gl.deleteBuffer(state.grid.buffer);
      if (state.gridMajor) gl.deleteBuffer(state.gridMajor.buffer);
      state.grid = createGeometry(gl, grid.minor);
      state.gridMajor = createGeometry(gl, grid.major);
      if (!state.framed) {
        frameCamera(cam, extent.center, extent.diag, canvas.clientWidth / Math.max(canvas.clientHeight, 1));
        state.framed = true;
      }
      return extent;
    }

    /**
     * @description One frame: poll the size, clear colour AND depth, then draw the grid and one
     * copy of the blade per blade count. rAF is requested FIRST so a mid-frame exception cannot
     * kill the loop.
     * @returns Nothing.
     */
    function render() {
      if (!state.running) return;
      global.requestAnimationFrame(render);
      resizeIfNeeded(canvas);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(theme.clear[0], theme.clear[1], theme.clear[2], 1);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!state.blade) return;
      var eye = vsub(cam.target, vscale(cam.forward(), cam.dist));
      var aspect = canvas.width / Math.max(canvas.height, 1);
      var near = Math.max(1e-4, cam.scale * 0.004);
      gl.useProgram(program);
      gl.uniformMatrix4fv(u.proj, false, perspective(FOVY, aspect, near, (cam.dist + cam.scale) * 8 + 1));
      gl.uniformMatrix4fv(u.view, false, lookAt(eye, cam.target, WORLD_UP));
      var identity = rotationY(0);
      drawGeometry(gl, u, state.grid, { model: identity, unlit: true, color: theme.grid, ambient: theme.ambient, alpha: 0.22, mode: 'lines' });
      drawGeometry(gl, u, state.gridMajor, { model: identity, unlit: true, color: theme.grid, ambient: theme.ambient, alpha: 0.55, mode: 'lines' });
      for (var b = 0; b < state.bladeCount; b += 1) {
        drawGeometry(gl, u, state.blade, {
          model: rotationY((2 * Math.PI * b) / state.bladeCount),
          unlit: false, color: theme.blade, ambient: theme.ambient, mode: 'triangles'
        });
      }
    }

    setTheme();
    global.requestAnimationFrame(render);
    return {
      supported: true,
      setBlade: setBlade,
      setTheme: setTheme,
      resetView: function () { state.framed = false; },
      destroy: function () { state.running = false; detach(); }
    };
  }

  /* =========================================================================
   * 7. The 2-D chart layer — palette, scales, marks and the hover tooltip.
   *
   * These live beside the WebGL viewer rather than beside the physics for one reason: they are
   * RENDERING. Nothing below knows what a Reynolds number is; it knows about pixels, ticks and
   * contrast. Keeping the split on that line is also what keeps either file off the 1000-line cap.
   * ====================================================================== */

  /** @description Canvas label font — the surface's own system sans, never a display face. */
  var FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

  /**
   * @description Parse a CSS colour to `[r, g, b]` 0..255.
   * @param value - A hex or rgb()/rgba() string.
   * @returns The triple, or null when unparseable.
   */
  function parseColor(value) {
    var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
    if (hex) {
      var body = hex[1].length === 3 ? hex[1].replace(/./g, function (c) { return c + c; }) : hex[1];
      return [0, 2, 4].map(function (o) { return parseInt(body.substr(o, 2), 16); });
    }
    var rgb = /rgba?\(([^)]+)\)/i.exec(String(value));
    if (!rgb) return null;
    var parts = rgb[1].split(',').map(function (v) { return parseFloat(v); });
    return parts.length >= 3 ? [parts[0], parts[1], parts[2]] : null;
  }

  /**
   * @description Resolve the drawing palette from the surface's LIVE theme.
   *
   * Light or dark is decided by the relative luminance of the resolved `--bg-primary`, not by
   * enumerating theme ids — there are eleven themes and an id list goes stale on the twelfth. The
   * three categorical slots are the documented validated palette, stepped per mode; they clear the
   * all-pairs CVD gate (worst ΔE 9.2 light / 9.4 dark) and the normal-vision floor (24.0 / 20.9)
   * against these exact surfaces. On the LIGHT surface slots 2 and 3 sit below 3:1, so the relief
   * rule binds and the surface ships both visible direct labels and a full table view.
   * @returns The palette.
   */
  function resolvePalette() {
    var css = global.getComputedStyle(document.documentElement);
    var read = function (name, fallback) { return (css.getPropertyValue(name) || '').trim() || fallback; };
    var plot = read('--bg-primary', '#0a0a12');
    var lin = (parseColor(plot) || [10, 10, 18]).map(function (v) {
      var x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    var light = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] > 0.5;
    return {
      light: light, plot: plot,
      ink: read('--text-primary', light ? '#1a1a2e' : '#eeeef5'),
      dim: read('--text-secondary', light ? '#4a4a6a' : '#a0a0be'),
      muted: read('--text-muted', light ? '#8a8aa0' : '#5c5c78'),
      grid: light ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.09)',
      axis: light ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.22)',
      series: light ? ['#2a78d6', '#eb6834', '#1baf7a'] : ['#3987e5', '#d95926', '#199e70'],
      warning: '#fab219', critical: '#d03b3b'
    };
  }

  /**
   * @description Size a canvas to its CSS box at capped device pixel ratio and return a cleared 2-D
   * context in CSS-pixel coordinates. DPR is capped at 2 — a 3× phone would quadruple fill cost.
   * @param canvas - The canvas element.
   * @returns `{ ctx, w, h }`, or null when the element has no layout yet.
   */
  function fitCanvas(canvas) {
    if (!canvas) return null;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = Math.round(canvas.clientWidth);
    var h = Math.round(canvas.clientHeight);
    if (!(w > 0) || !(h > 0)) return null;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  /**
   * @description Build the value↔pixel mapping for a plot rectangle. A plain object, not a class, so
   * a chart can stash it for the hover layer without re-deriving geometry.
   * @param rect - `{ l, t, w, h }` in CSS pixels.
   * @param x0 - Domain minimum on x.
   * @param x1 - Domain maximum on x.
   * @param y0 - Domain minimum on y.
   * @param y1 - Domain maximum on y.
   * @returns The scale.
   */
  function makeScale(rect, x0, x1, y0, y1) {
    var spanX = (x1 - x0) || 1;
    var spanY = (y1 - y0) || 1;
    return {
      rect: rect, x0: x0, x1: x1, y0: y0, y1: y1,
      x: function (v) { return rect.l + ((v - x0) / spanX) * rect.w; },
      y: function (v) { return rect.t + rect.h - ((v - y0) / spanY) * rect.h; },
      invX: function (px) { return x0 + ((px - rect.l) / rect.w) * spanX; }
    };
  }

  /**
   * @description Round tick positions a reader can hold in their head.
   * @param min - Domain minimum.
   * @param max - Domain maximum.
   * @param target - Approximate tick count.
   * @returns Ascending tick values inside the domain.
   */
  function niceTicks(min, max, target) {
    var span = (max - min) || 1;
    var raw = span / Math.max(target, 2);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1) * mag;
    var ticks = [];
    for (var v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
    return ticks;
  }

  /**
   * @description Draw a panel's recessive frame: hairline gridlines (solid, never dashed), the
   * baseline, tick labels and the two axis titles. Grid and axis are one step off the surface so the
   * data is the only loud thing on the canvas.
   * @param ctx - 2-D context.
   * @param scale - The scale.
   * @param pal - The palette.
   * @param opts - `{ xLabel, yLabel, xTicks, yTicks, format }`.
   * @returns Nothing.
   */
  function drawFrame(ctx, scale, pal, opts) {
    var xs = niceTicks(scale.x0, scale.x1, opts.xTicks || 6);
    var ys = niceTicks(scale.y0, scale.y1, opts.yTicks || 4);
    ctx.save();
    ctx.font = '10.5px ' + FONT;
    ctx.lineWidth = 1;
    ys.forEach(function (v) {
      var y = Math.round(scale.y(v)) + 0.5;
      ctx.strokeStyle = pal.grid;
      ctx.beginPath(); ctx.moveTo(scale.rect.l, y); ctx.lineTo(scale.rect.l + scale.rect.w, y); ctx.stroke();
      ctx.fillStyle = pal.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(opts.format ? opts.format(v) : String(v), scale.rect.l - 6, y);
    });
    ctx.strokeStyle = pal.axis;
    ctx.beginPath();
    ctx.moveTo(scale.rect.l, scale.rect.t + scale.rect.h + 0.5);
    ctx.lineTo(scale.rect.l + scale.rect.w, scale.rect.t + scale.rect.h + 0.5);
    ctx.stroke();
    ctx.fillStyle = pal.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    xs.forEach(function (v) { ctx.fillText(String(v), scale.x(v), scale.rect.t + scale.rect.h + 6); });
    if (opts.xLabel) ctx.fillText(opts.xLabel, scale.rect.l + scale.rect.w / 2, scale.rect.t + scale.rect.h + 21);
    if (opts.yLabel) {
      ctx.textAlign = 'left';
      ctx.fillStyle = pal.dim;
      ctx.fillText(opts.yLabel, scale.rect.l, scale.rect.t - 12);
    }
    ctx.restore();
  }

  /**
   * @description Draw a 2 px polyline through `[x, y]` value pairs, BREAKING the line at any
   * non-finite point so a non-converged blade element leaves a visible gap rather than dragging the
   * curve down to zero and reading as a real result.
   * @param ctx - 2-D context.
   * @param scale - The scale.
   * @param points - `[[x, y], …]` in domain units.
   * @param color - Stroke colour.
   * @returns Nothing.
   */
  function drawSeries(ctx, scale, points, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    var pen = false;
    points.forEach(function (p) {
      if (!isFinite(p[0]) || !isFinite(p[1])) { pen = false; return; }
      var x = scale.x(p[0]);
      var y = scale.y(p[1]);
      if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      pen = true;
    });
    ctx.stroke();
    ctx.restore();
  }

  /**
   * @description Draw a marker with a 2 px ring in the SURFACE colour, so it stays legible where it
   * crosses a line. The ring is the mechanism — never a stroke in another hue, which would add
   * data-weight ink that is not data.
   * @param ctx - 2-D context.
   * @param x - Pixel x.
   * @param y - Pixel y.
   * @param color - Fill colour.
   * @param pal - The palette (for the surface colour).
   * @returns Nothing.
   */
  function drawMarker(ctx, x, y, color, pal) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = pal.plot; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }

  /**
   * @description Draw a direct label in TEXT ink, never the series colour — a light categorical hue
   * is illegible as text on the surface, and identity comes from the coloured mark beside it.
   * @param ctx - 2-D context.
   * @param text - The label.
   * @param x - Pixel x.
   * @param y - Pixel y.
   * @param pal - The palette.
   * @param align - Canvas textAlign.
   * @returns Nothing.
   */
  function drawLabel(ctx, text, x, y, pal, align) {
    ctx.save();
    ctx.font = '600 11px ' + FONT;
    ctx.fillStyle = pal.ink;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /** @description Registered hover targets: `{ canvas, scale, read }` per plot. */
  var hoverTargets = [];

  /**
   * @description Drop every registered hover target. Called before a repaint so a stale scale can
   * never point the tooltip at data that is no longer on screen.
   * @returns Nothing.
   */
  function resetHover() { hoverTargets = []; }

  /**
   * @description Register a plot with the hover layer.
   * @param canvas - The canvas the plot was drawn on.
   * @param scale - Its scale, carrying the plot rectangle.
   * @param read - `(domainX) => string`, the tooltip text for a pointer position.
   * @returns Nothing.
   */
  function registerHover(canvas, scale, read) {
    hoverTargets.push({ canvas: canvas, scale: scale, read: read });
  }

  /**
   * @description Bind the tooltip once. Tooltips ENHANCE — every value they show is also in the
   * table view, so nothing on this surface is gated behind a pointer, which is what makes the layer
   * safe to add by default.
   * @param tip - The tooltip element.
   * @returns Nothing.
   */
  function attachHover(tip) {
    if (!tip) return;
    var hide = function () { tip.hidden = true; };
    document.addEventListener('mousemove', function (event) {
      for (var i = 0; i < hoverTargets.length; i += 1) {
        var target = hoverTargets[i];
        var box = target.canvas.getBoundingClientRect();
        var px = event.clientX - box.left;
        var py = event.clientY - box.top;
        var r = target.scale.rect;
        if (px < r.l || px > r.l + r.w || py < r.t || py > r.t + r.h) continue;
        tip.textContent = target.read(target.scale.invX(px));
        tip.hidden = false;
        tip.style.left = Math.min(event.clientX + 14, global.innerWidth - 280) + 'px';
        tip.style.top = (event.clientY + 16) + 'px';
        return;
      }
      hide();
    });
    global.addEventListener('scroll', hide, true);
  }

  /**
   * @description Trigger a real browser download of generated bytes or text. It sits beside the CAD
   * writers because "make the file" and "hand it to the user" are one job, and splitting them is how
   * an exporter ends up with a MIME type that disagrees with its bytes.
   * @param filename - Suggested filename.
   * @param data - A string or a Uint8Array.
   * @param mime - MIME type.
   * @returns Nothing.
   */
  function download(filename, data, mime) {
    var blob = new global.Blob([data], { type: mime });
    var url = global.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 4000);
  }

  /**
   * @description Station profiles for the DXF drawing: each design station's placed section in
   * MILLIMETRES, at an elevation equal to its radius. This is the 2-D companion to the solid
   * writers — what goes to a laser cutter or to a draughtsman checking a template against a table,
   * neither of whom wants a triangulated solid.
   * @param blade - The blade.
   * @returns `[{ name, elevation, points }]`.
   */
  function stationProfiles(blade) {
    return blade.stations.map(function (st, i) {
      var angle = -((st.twistDeg + blade.pitchDeg) * Math.PI) / 180;
      var cos = Math.cos(angle);
      var sin = Math.sin(angle);
      var chordMm = st.chordM * 1000;
      return {
        name: 'STATION_' + i + '_R' + Math.round(st.radiusFrac * blade.tipRadiusM * 1000),
        elevation: st.radiusFrac * blade.tipRadiusM * 1000,
        points: nacaSection(st.section, DEFAULT_SECTION_STATIONS).map(function (p) {
          var dx = (p.x - PITCH_AXIS_CHORD_FRACTION) * chordMm;
          var dy = p.y * chordMm;
          return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
        })
      };
    });
  }

  /* =========================================================================
   * 8. Public surface.
   * ====================================================================== */

  global.BladeStudioGL = {
    nacaSection: nacaSection,
    nacaSpec: nacaSpec,
    twistBlend: twistBlend,
    buildBlade: buildBlade,
    resolvePalette: resolvePalette,
    fitCanvas: fitCanvas,
    makeScale: makeScale,
    niceTicks: niceTicks,
    drawFrame: drawFrame,
    drawSeries: drawSeries,
    drawMarker: drawMarker,
    drawLabel: drawLabel,
    resetHover: resetHover,
    registerHover: registerHover,
    attachHover: attachHover,
    download: download,
    stationProfiles: stationProfiles,
    cosineStations: cosineStations,
    bladeToMesh: bladeToMesh,
    meshBounds: meshBounds,
    meshVolume: meshVolume,
    rotorExtent: rotorExtent,
    toStlBinary: toStlBinary,
    toObj: toObj,
    toOpenScad: toOpenScad,
    toDxfR12: toDxfR12,
    mount: mount,
    PITCH_AXIS_CHORD_FRACTION: PITCH_AXIS_CHORD_FRACTION,
    DEFAULT_SECTION_STATIONS: DEFAULT_SECTION_STATIONS
  };
}(typeof window !== 'undefined' ? window : this));
