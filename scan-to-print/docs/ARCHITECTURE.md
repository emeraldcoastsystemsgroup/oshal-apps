# Scan to Print — architecture and the LiDAR building block

This document is the contract. It states exactly what the geometry pipeline computes, in which
frame, with which limits, and where a depth sensor or a LiDAR export plugs in. Everything here is
implemented in `src-routes/engine/` and asserted by `tests/engine-*.test.js`; nothing is planned
or aspirational. If a sentence here and the code disagree, the code is wrong.

## 1. One representation, many sensors

Every input lane ends in the same **occupancy grid** and every output reads from it:

```
photos ──► silhouettes ──► carve ─┐
video  ──► frames ──► (same) ─────┤
depth map / LiDAR range ──► carve ┼──► OCCUPANCY GRID ──► surface nets ──► mesh (STL/OBJ)
point cloud (.ply) ──► voxelise ──┘        (1 = solid)        │
                        + fill                                └──► re-projection ──► drawing (SVG)
                                                                                └──► report (JSON)
```

A voxel is `1` (solid) or `0` (empty) — never a probability. That is what makes the carvers
composable: a silhouette carve, a depth carve and a point-cloud fill can be applied in any order
and the result is the same set of voxels. The tail (`finishFromGrid`) never learns which sensor
spoke.

| Lane | What the sensor asserts | Engine module | Status |
|---|---|---|---|
| Silhouettes | "Nothing along this whole ray" (per view) | `grid/silhouette-carver.ts` | Shipped; photo + video UI |
| Depth map | "Nothing along this ray UNTIL this range" | `grid/depth-carver.ts` | Shipped; exercised with the simulated sensor (`renderDepth`); no depth-image upload UI yet |
| Point cloud | "The surface is HERE" | `grid/point-cloud.ts` | Shipped; `.ply` upload UI (iPhone/iPad LiDAR exports) |

The depth lane is the LiDAR building block. A range image carries the one thing a silhouette
cannot: the distance to the first surface, which is what recovers a cavity the outlines fill.
`carveDepth` removes only the free space **in front of** a measured surface; a pixel with no
return (`NaN`) removes nothing, because a sensor's silence is not emptiness.

## 2. The world frame (fixed)

- Right-handed, **Z up**, millimetres.
- The object rests on the print bed: `Z = 0` is the bottom of the bounding box.
- The footprint is centred: `X = 0`, `Y = 0` at the bounding-box centre.
- The object's **front faces −Y**.

Every sensor projects into this frame. Nothing else in the package defines an axis.

## 3. The six canonical views (`grid/views.ts`)

Each view is a camera basis of signed world axes: `u` = image right, `v` = image **down** (every
decoder has a top-left origin), `look` = viewing direction. The table is fixed and the spec proves
each frame is right-handed (`u × up = −look`):

| View | u (right) | v (down) | look |
|---|---|---|---|
| front | +X | −Z | +Y |
| back | −X | −Z | −Y |
| left | −Y | −Z | +X |
| right | +Y | −Z | −X |
| top | +X | −Y | −Z |
| bottom | +X | +Y | +Z |

These are third-angle neighbours (ASME Y14.3): in the top view the object's front is at the bottom
of the image; in the right view the front is at the left. The drawing lays the views out the same
way, so a person can check the sheet against the photos by eye.

Orthographic projection: `u = sign_u · p[axis_u]`, `v = sign_v · p[axis_v]`. No perspective. The
capture contract is "camera square to the face, far enough back"; the registration step reports
when views disagree about the object's proportions by more than 10 %.

## 4. Silhouette extraction (`raster/silhouette.ts`) — deterministic

1. Decode (sharp), EXIF-rotate, bound to 768 px on the long side, keep as PNG.
2. Background = per-channel **median** of a border frame 3 % of the shorter side.
3. Distance map = Euclidean RGB distance to the background, scaled to 0..255.
4. Threshold = **Otsu** over the distance histogram, floored at 14.
5. 3×3 morphological open then close (radius 1).
6. Keep the **largest 4-connected component**.
7. **Fill holes** (flood the background from the border; unreached = interior).

Same raster → byte-identical mask (asserted). Warnings are produced from the mask alone: no
object, low contrast, very small, fills the frame, touches the edge.

## 5. Registration and carving (`grid/silhouette-carver.ts`)

- Input: one mask per supplied view + 1–3 **known dimensions** (ruler measurements).
- Each mask's bounding box gives pixel extents along the view's `u`/`v` world axes. Extents
  propagate: a view that knows one axis in mm yields the other from the pixel ratio, until nothing
  new resolves. An axis no view can see is **assumed** equal to the first known dimension and
  flagged on the report, the drawing and the UI.
- Per view: mm-per-pixel = mean of the two axis estimates (a >10 % disagreement warns); the mask's
  bounding-box centre is pinned to the object's bounding-box centre `(0, 0, H/2)`.
- Carve: a voxel survives only if its **centre** projects onto the object in **every** supplied
  view. Result: the **visual hull**.
- Voxel edge = largest extent / `resolution` (default 96, max 198; the grid ceiling is 200³).

**Limitation (stated, not hidden):** the visual hull fills anything no outline can see —
cavities, undercuts, holes not aligned with a view. Three views (front, top, right) give a solid;
six give a better one; none give a cavity. That is the depth lane's job.

## 6. Depth carving (`grid/depth-carver.ts`)

```ts
interface DepthMap {
  view: ViewName;            // which canonical view the sensor looked from
  width, height;             // pixels
  mmPerPx;                   // millimetres per pixel
  uCenterPx, vCenterPx;      // pixel of world (uCenterMm, vCenterMm)
  uCenterMm, vCenterMm;      // world coordinates along the view's u / v axes
  planeMm;                   // signed-look-axis coordinate where depth = 0 (the sensor plane)
  data: Float32Array;        // range in mm from the sensor plane; NaN = no return
}
```

`carveDepth(grid, map)`: for each solid voxel, project its centre to a pixel; if the range is
finite and the voxel's depth is **less than range − ½ voxel**, clear it. Behind the surface and
under no-return pixels nothing changes.

`renderDepth(grid, view, {mmPerPx, width, height})` is the honest simulator: it ray-marches the
grid from a canonical view and produces exactly this struct. The spec builds a cup by hollowing a
cylinder, renders its top-view depth, carves the SOLID cylinder with it and asserts the result
equals the hollow grid **to the voxel**. No hardware is in the loop, and no claim is made that
hardware has been.

**To attach a real sensor:** produce this struct from the device (an orthographic re-projection of
its range image into one canonical view, with its plane at a known world coordinate) and call
`refineWithDepth`. That is the whole integration. Perspective range images need a pre-step
(project to the view plane) that is not written yet — see BACKLOG.

## 7. Point-cloud lane (`grid/point-cloud.ts`)

- `parsePly`: minimal bounded PLY reader — ASCII, binary little/big endian; reads `x/y/z` from the
  `vertex` element and skips every other property and element by size; refuses > 5 M points.
- `voxelizePointCloud`: scale (`unitScale`, e.g. 1000 for a metres export), re-orient (`up: 'y'`
  rotates +90° about X so a phone export lands Z-up), centre the footprint on X = Y = 0, rest on
  Z = 0, mark every voxel holding a point. Padding is 2 voxels so the closing pass has room.
- `fillSolidFromSurface`: 6-neighbourhood **close** (dilate, erode), then **flood the exterior**
  from the grid corner; whatever the flood cannot reach is interior and becomes solid.
- A gap wider than the closing radius **leaks**: the flood reaches the inside, nothing fills, and
  `closed: false` is reported (never silently an empty shell).

iPhone / iPad Pro LiDAR: export `.ply` from Scaniverse or Polycam (metres, Y-up), import with
`unitScale = 1000`, `up = y`. The kernel's Spaces app handles room-scale scans; this lane is for
an object you would print.

## 8. Meshing (`mesh/surface-nets.ts`)

Naive surface nets over the binary grid: one vertex per mixed cell at the centroid of its
crossing-edge midpoints; one quad per crossing grid edge joining the four cells around it; winding
chosen by which end of the edge is solid, so normals point from solid to empty.

Precondition: the outermost voxel layer is empty (`clearBorder` runs in `finishFromGrid`). With
it, every quad edge is shared by exactly two quads — the mesh is **watertight by construction**,
and the validator checks it anyway with an index-identity edge census.

Optional Laplacian smoothing (default 2 passes, λ = 0.5) with every vertex clamped to its own
cell, so the surface rounds a staircase but cannot fold through itself.

Measured on the box fixture (60 × 40 × 30 mm, 48 voxels): mesh volume within 0.3 % of the voxel
volume unsmoothed, within 1 % smoothed; χ = 2.

## 9. Outputs

- **STL** (binary, exactly `84 + 50·n` bytes; header never starts with `solid`) and **OBJ**
  (indexed, 1-based) — vendored from the ocean-lab geometry slice.
- **Drawing** (`drawing/engineering-drawing.ts`): A3 landscape in millimetres; third-angle six-view
  layout; outlines are the **re-projection of the grid** (`projectGrid`) traced exactly
  (`drawing/contours.ts`), so drawing and STL are two readings of one solid; overall width and
  height on the front view, depth on the top view; standard scale series; title block with method,
  voxel, volume, facets, printable verdict; notes column with the provenance of every extent and
  the lane's limitation text.
- **Report** (`pipeline.ts` → `ReconstructionReport`): the single JSON the drawing, the UI and the
  concierge all read. `printable` = watertight ∧ consistent winding ∧ outward ∧ no degenerate
  facets. `eulerCharacteristic` is reported separately (2 = one solid; 2n = n shells; 0 = a
  handle).

## 10. Printer boundary (`print/`)

Pluggable hosts behind one adapter interface: **OctoPrint** (multipart `POST /api/files/local`,
accepts STL), **Moonraker/Klipper** (`POST /server/files/upload`, G-code only), **PrusaLink**
(`PUT /api/v1/files/usb/<name>`, G-code only). The API key rides `X-Api-Key`; the base URL is
validated (http/https, no credentials, no loopback/metadata addresses). Slicing is a configured
command (`SCAN_TO_PRINT_SLICER_CMD` with `{input}` `{output}` placeholders, run with `execFile`,
no shell); unconfigured is a reported state, never a substituted program.

Sending is an outward physical action: `POST /jobs/:id/print` requires `confirm: true` (428
otherwise) and the surface asks the person first. Bots can read jobs and printers; no bot tool can
print.

## 11. Determinism, stated as a property

No model, no seed, no randomness, no iteration to a tolerance anywhere in `engine/`. The spec
`engine-reconstruction.test.js` asserts that two runs on the same inputs produce byte-identical
STL, OBJ and SVG; `routes.core.test.js` asserts the same over HTTP after a re-run.

## 12. Known limits (as built)

- Orthographic assumption: tilted or close-up photos skew proportions (reported, not corrected).
- Silhouette registration keys on the bounding box: an object whose silhouette extremes belong to
  different features in different views registers slightly off.
- Depth input is orthographic in a canonical view; perspective range images need a projection
  pre-step.
- Point-cloud interior fill cannot cross a gap wider than one voxel (reported as `closed: false`).
- Surface nets can produce a non-manifold vertex on a 2×2×2 checkerboard configuration; the edge
  census still passes and slicers accept it.
