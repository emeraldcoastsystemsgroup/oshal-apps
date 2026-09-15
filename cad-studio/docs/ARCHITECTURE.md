# CAD Studio — architecture and the contract

This document is the contract. It states what a model is, exactly which operations the kernel
performs, in which frame, with which limits, and how the swarm drives it. Everything here is
implemented in `engine/cad_worker.py` and `src-routes/` and asserted by the suites in `tests/` and
`engine/tests/`; nothing is planned or aspirational. If a sentence here and the code disagree, the
code is wrong.

## 1. One model, three editors

```
            person (studio)  ──┐
   concierge (route-backed tools) ─┼──► /api/cad-studio/models/:id/features … ──► validate (contract)
   MCP client (oshal-tools bridge) ─┘                                              │
                                                                                   ▼
        revision N ◄── exports (STEP, STL, 4 SVG views, report) ◄── engine container (OCCT) ◄── base + list
```

- A **model** is `{ base, features[] }`. The list is the parametric history; it is replayed whole
  on every change. There is no other state the geometry depends on.
- A **revision** is one successful rebuild: the exact list, the report, the engine build hash.
  Restoring a revision puts its list back and rebuilds — undo to any point, nothing lost.
- All three editors go through the same routes. The routes validate against the contract
  (§4) *before* the engine runs, so a bad parameter is refused with the field named and the
  kernel never sees it. A parameter the kernel accepts but cannot execute (a fillet larger than
  the edge) is reported per feature (§5) and skipped.

## 2. The world frame (fixed, shared with Scan to Print)

- Right-handed, **Z up**, millimetres.
- The part rests on the bed: `Z = 0` is the bottom of the bounding box.
- The footprint is centred: `X = 0`, `Y = 0` at the bounding-box centre.
- The part's **front faces −Y**.

Every base is placed in this frame after construction (`_rest_on_bed`), and so is the result of
scale, mirror and rotate. Coordinates in feature parameters are absolute in this frame.

## 3. Bases

| kind | parameters | what it builds |
|---|---|---|
| `box` | `sizeX, sizeY, sizeZ` | a box, footprint centred, on the bed |
| `cylinder` | `diameter, height` | a cylinder on the bed, axis Z |
| `sketch` | `plane (XY\|XZ\|YZ), points [[u,v]…] (3..2000), height` | a closed polyline extruded along the plane normal |
| `contours` | `views {front\|top\|right: [[u,v]…]}, size {x,y,z}` | **the scan bridge**: each outline extruded along its viewing axis, the solid is their intersection — the visual hull as a B-rep (front in (X,Z), top in (X,Y), right in (Y,Z), matching Scan to Print's third-angle frames) |
| `mesh` | `stl` (base64, ≤ 64 MB, ≤ 100 000 triangles) | one planar face per triangle, sewn into a shell, closed into a solid (what FreeCAD's `makeShapeFromMesh` does); refused honestly when it does not close |

A mesh base is stored on disk (`base.stl` under the model directory) and referenced from the row
by size and sha256; the bytes go to the engine only at rebuild time.

## 4. Features (in list order)

| type | required | optional | operation |
|---|---|---|---|
| `hole` | `diameter` | `axis (z)`, `x`, `y`, `z`, `depth`, `through` | cylinder cut; through by default, blind from the + side of the axis when `depth` is given |
| `boss` | `diameter`, `height` | `axis (z)`, `x`, `y`, `z`, `from (0)` | cylinder union from `from` along the axis |
| `box-add` / `box-cut` | `size [sx,sy,sz]` | `center [x,y,z]` | box union / subtraction |
| `sketch-extrude` | `points`, `height` | `plane (XY)`, `offset (0)`, `mode (add\|cut)` | closed polyline on a plane extruded; union or cut |
| `revolve` | `points` | `plane (XZ)`, `axis` (one of the plane's two axes; default its second), `degrees (360)`, `mode (add\|cut)` | closed profile revolved about a world axis through the origin; union or cut |
| `sweep` | `points`, `path` | `plane (XY)`, `pathPlane (XZ)`, `mode (add\|cut)` | closed profile swept along an open path polyline starting at the origin; right-corner mitres; union or cut |
| `loft` | `sections [{points, offset}…]` (2..32, distinct offsets) | `plane (XY)`, `ruled (true)`, `mode (add\|cut)` | solid through closed sketches on parallel planes offset along the plane normal; union or cut |
| `fillet` | `radius` | `edges (all)` | round the selected edges |
| `chamfer` | `length` | `edges (all)` | bevel the selected edges |
| `shell` | `thickness` | `openFace (none)` | hollow to a wall thickness, optionally opening one face |
| `cut-plane` | `at` | `axis (z)`, `keep (below\|above)` | intersect with a half-space |
| `scale` | — | `factor` **or** `axis` + `target` | uniform scale (by factor, or to a target extent) |
| `mirror` | — | `plane (YZ)` | mirror through the origin plane, then re-seat |
| `rotate` | `degrees` | `axis (z)` | rotate about an origin axis, then re-seat |
| `translate` | — | `dx`, `dy`, `dz` | move |

Sketch planes and their axes (`PLANE_AXES`, published as `planeAxes`): a profile on `XY` has
u = X, v = Y (normal +Z); on `XZ` u = X, v = Z (normal −Y); on `YZ` u = Y, v = Z (normal +X). A
`revolve` axis must be one of its plane's two axes — the contract refuses any other with
`params.axis`. A `sweep` profile is used where it is drawn, so draw it around the origin: the path
starts there. A `loft` section with no `offset` sits on the plane itself.

Edge selectors: `all`, `vertical` (∥ Z), `horizontal` (⊥ Z), `top` (> Z), `bottom` (< Z),
`parallel-x`, `parallel-y`, `parallel-z`. Face selectors (shell): `none`, `top`, `bottom`,
`front`, `back`, `left`, `right`.

Limits (`LIMITS` in both implementations): 200 features per model, 2000 points per outline,
dimensions 0.01..2000 mm, 32 loft sections. Unknown parameters are **refused** — a typo must never be a silent
no-op for an agent that believes it edited the model.

## 5. Rebuild semantics

1. Build the base. An invalid base is a request-level refusal (HTTP 422 on rebuild; 400 when
   the contract catches it first).
2. For each enabled feature in order: run it; if the kernel throws or returns an empty / invalid
   solid, record `{ok:false, error}` for that feature and **keep the previous solid**. A
   disabled feature records `{ok:true, skipped:true}`. A feature that returns after the
   per-feature budget (`settings.featureBudgetMs`, default 60 000 ms, 1..600 000) is refused the
   same way with `code: "budget_exceeded"` and its measured `ms`: its result is discarded and the
   next feature still runs. The budget is read when the feature returns — one OCCT call holds the
   worker's interpreter, so a boolean is not interrupted mid-call; the request wall clock and
   **cancel** (below) are what stop one.
3. Report: extents (min/max/size), volume, surface area, mass at `densityGcm3` (default 1.24,
   PLA), centre of mass, faces / edges / vertices, validity.
4. Exports: STEP (AP214 via OCCT; the `FILE_NAME` header and the per-session product counter are
   pinned, so equal lists give equal bytes), binary STL (`stlToleranceMm`, default 0.05),
   hidden-line SVG projections for front, top, right and isometric.
5. The api writes the exports into `<data root>/<sha(sub)>/<modelId>/<revision>/` and inserts
   the revision row. On any engine failure the model is marked `failed` with the reason and the
   last built revision stays current and downloadable.
6. **Cancel** — `POST /api/cad-studio/models/:id/cancel`, owner-scoped (another subject gets
   404). A queued rebuild is dropped before it reaches the engine. The running one is stopped by
   closing the engine connection (the bridge kills that worker), and every other caller's queued
   request is sent again on a fresh connection. The request that triggered the rebuild answers
   409 with `build.code: "cancelled"`; the part is recorded `failed` with `cancelled: …` and stays
   at its last good revision, whose artifacts keep serving. The reply is
   `{cancelled, stage: "inflight" | "queued" | null, lastGoodRevision, model}` and is sent only
   after that record is written. The studio offers **Stop rebuild** while the selected part has a
   rebuild in flight. There is no concierge tool for it.

Measured on the reference box (spike, 2026-09-12, this kernel image): base + two features
≈ 0.5 s, STEP 0.64 s, STL 0.1 s, four SVG views 0.42 s — under 2 s per rebuild.

## 6. Engine transport and the build-hash guard

- `engine/container/cad_engine_bridge.py` serves the worker's JSON-lines protocol over TCP
  (7412 inside the stack network only). One connection = one worker process, spawned lazily and
  killed when the connection closes. The first line is `{"bridge": {protocol, buildHash, python}}`.
- `src-routes/engine-client.ts` holds one persistent connection per api process, serialises
  requests, verifies the hello, applies a per-request wall clock (kill = close the socket), and
  reconnects on the next request. A request can carry a tag (owner + model); `cancel(tag)`
  removes a queued one, or closes the connection when it is the one in flight. A stale container (a different build hash than this package's
  `engine/` tree) is `capability_unavailable` with the exact install command; so is a container
  that is not running or not answering.
- `engine-build-hash.ts` and the bridge's `build_hash()` hash the same four files with the same
  framing; `contract-features.test.js` runs both and asserts equality. The same spec reads the
  worker's `FEATURES` registry and `PLANE_AXES` from `cad_worker.py`'s source and requires them to
  equal the contract's, so a feature type added on one side only fails without a kernel.

## 7. How the swarm drives it (the "CAD MCP")

The manifest declares nine route-backed tools (`cad-capabilities`, `cad-list-models`,
`cad-get-model`, `cad-create-model`, `cad-add-feature`, `cad-update-feature`,
`cad-remove-feature`, `cad-move-feature`, `cad-restore-revision`, `cad-rebuild`). The framework
executes them server-side under the caller's identity: the inline concierge (`cad-studio-designer`)
calls them from the chat rail, and the same registrations are what the framework's tool bridge
exposes to MCP clients (`scripts/oshal-tools-mcp.js` in core). Writes are `auto` (no click per
edit) because every write touches only the caller's own list and is reversible through
revisions; nothing leaves the box. The studio polls the open model every 3 s, so an edit made by
the concierge appears without a reload.

## 8. What it does not do (stated, not hidden)

- No sketch constraints, no assemblies, no threads, no text yet (BACKLOG). Sweeps are along
  polylines only (no arcs or splines in a path). Fillets on a mesh base are the kernel's call and often refused — the report says so.
- The STEP is the model; the STL is a tessellation of it at the set tolerance.
- Printing is Scan to Print's job behind its confirmation; this package produces files.
