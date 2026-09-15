# Scan, design, manufacture: CAD Studio delivery plan

Requested 2026-09-13 UTC. **Application roadmap with an initial CAD Studio
implementation; the acceptance tasks below remain open.** Scan to Print owns
reconstruction and printing. Create launches Scan to Print; the separate
[CAD Studio](../cad-studio/README.md) application now owns parametric models,
revisions and a package-owned CadQuery worker. Scan to Print also has a contour
handoff to CAD Studio. These initial integrations do not complete this roadmap
or provide a SOLIDWORKS adapter. See the owning application release notes and
[CAD backlog](../cad-studio/BACKLOG.md) for delivered scope and limitations.

## Outcome and first real task

Create a measured, editable part from a scan or an original design, change it by
direct manipulation or Jarvis, review the result, and export the correct revision
for fabrication. Keep the source scan, editable design and final outputs linked.

The first CAD acceptance task is a **mounting plate with four holes**. Set width,
height, thickness, hole diameter and edge offsets; inspect a real solid; change
the hole diameter; undo; save/reopen; export STEP and STL. Independently reimport
STEP and verify solid count, bounding dimensions, volume and hole locations.
Changing parameters must rebuild geometry. Merely writing a parameter list next
to a baked triangle mesh does not satisfy the task.

The first scan-assisted task follows separately: attach a measured reference
scan, align it, explicitly confirm the dimensions used for the plate, and create
the editable part. Scan geometry is evidence; inferred hole sizes and unseen
surfaces are not accepted as measured design intent.

## Original inspected baseline

This table records the inspection before the initial CAD Studio package landed.
It is retained to explain the plan; current CAD capabilities are documented in
the application README linked above.

| Application | Implemented | Missing for this workflow |
|---|---|---|
| Scan to Print | Photos/video frames/PLY to occupancy grid, STL/OBJ, six-view dimensioned SVG, JSON report; configured printer adapters | Editable solids, STEP, sketches/constraints, artifact-source handoff; depth-image HTTP input |
| Create | Studio navigation, manual image projects/layers and eight editable image templates | CAD projects, CAD editor and CAD worker |
| Ocean Lab | Specialist rotor calculations and STL/OBJ/DXF/SCAD exports | General modeling; exported SCAD is a baked polyhedron, not a regenerating parametric design |
| Aero Lab | Specialist Python engineering calculations and fabrication exports | General CAD editor; its own numerical/physical acceptance backlog remains authoritative |
| Embodied | Simulated arm/base/drone, planning and rehearsal | General CAD authoring and physical robot integration |
| oshal-engineering | Software build, test and review orchestration | Mechanical CAD; its agent mesh is unrelated to solid geometry |

Source references: [Scan README](README.md), [reconstruction pipeline](src-routes/engine/pipeline.ts),
[Ocean SCAD exporter](../ocean-lab/src-routes/engine/geometry/export-openscad.ts),
[Aero backlog](../aero-lab/BACKLOG.md), [Embodied architecture](../embodied/docs/ARCHITECTURE.md),
[Create product](../create/PRODUCT.md).

Scan reconstruction currently uses a default 96 and maximum 198 voxels along
the longest photo-derived extent. For a 100 mm object this is approximately
1.04 mm/default or 0.51 mm/maximum spacing. **Voxel spacing is not measurement
accuracy.** Perspective, capture coverage, thresholding and smoothing also affect
the result. The current SVG has overall dimensions and provenance, not complete
manufacturing tolerances or GD&T. A closed mesh alone does not establish fit,
wall thickness, self-intersection freedom or process suitability.

Native synthetic acceptance exposed a separate measurement conflict: photos of
a 60 x 40 x 30 mm object, reconstructed with entered dimensions 80 x 40 x 30 mm,
produced a fresh 70 x 40 x 30 mm mesh with 35,136 facets and 25% front/top
proportion warnings. The [view calibration](src-routes/engine/grid/silhouette-carver.ts)
averages the two axis scales into one uniform scale per view, then intersects
their silhouettes. This is neither stale output nor an exact axis resize. The
[pipeline](src-routes/engine/pipeline.ts) records nominal `sizeMm` separately from
actual `boundsMm`; drawings use nominal dimensions while STL/OBJ contain the
actual mesh. Its `printable` check covers mesh topology, not dimensional fidelity.
Conflicting measurements need review; this example establishes no manufacturing
accuracy claim.

## Engine decision

The initial implementation is the store-owned `cad-studio` application using a
pinned CadQuery/OpenCascade worker for bounded parametric parts. CAD Studio owns
documents and jobs and supplies its own browser editor. Create integration and
the broader acceptance requirements below must be checked independently; an
installed package alone does not establish that every planned workflow works.

CadQuery supplies scripted parametric solids and STEP/STL export, while OSHAL
supplies parameter controls, preview, persistence, authorization and revision
review. Start with a small declarative operation set compiled into trusted worker
functions. Do not accept arbitrary user/model-generated Python for execution.
Run expensive geometry outside the shared API process, with versioned worker
capabilities, bounded resources, cancellation and per-job scratch directories.

FreeCAD is a useful desktop authoring partner. Its native FCStd model preserves
its modeling history; a STEP import does not automatically recreate that history.
An initial STEP exchange with FreeCAD is a geometry handoff, and must be labeled
that way. Full native FreeCAD round trips are a later adapter acceptance task.

SOLIDWORKS is an optional professional integration on a supported, licensed
workstation. Its parts/assemblies/drawings and ScanTo3D are relevant to this
workflow. Connect through an explicitly enrolled worker and supported API/file
operations; preserve native part/assembly documents and derive neutral exports.
Discover installed version, license/add-in availability and supported operations
before advertising actions. A successful mesh import is not proof of an editable
feature tree or unattended ScanTo3D automation. Prove each claimed operation on
the actual installed edition. Buying or activating software is not part of this
proposal's autonomous implementation work.

Onshape is another possible adapter if browser collaboration is preferred. Its
REST API and webhooks are useful integration points. Establish authenticated
document access, supported export behavior and account terms before committing
to that provider. Keep the initial application independent of any paid account.

## Document and interaction contract

1. **One durable owner.** CAD Studio persists project, revision, assets and build
   jobs under existing application authorization and owner isolation. Create
   links to the owning project; it does not copy a competing CAD record.
2. **Editable source.** Each revision records schema version, explicit units,
   coordinate frame, parameter values, bounded operations, source assets and
   worker version. Original uploads remain immutable. Native documents from
   external CAD adapters remain separate assets with their actual format.
3. **Derived outputs.** STEP is solid interchange; STL/OBJ are tessellated output;
   SVG/PDF are drawings. Each output identifies its source revision and build.
   Changing dimensions or geometry makes previous outputs historical. Export
   always shows the revision it uses; print requires current reviewed geometry.
4. **Measurement provenance.** Retain requested and measured/derived/assumed
   extents separately from actual mesh bounds, with units, frame, reconstruction
   resolution and warnings. Expose disagreements for review; nominal drawing
   labels must not be presented as verified geometry. STL has no intrinsic unit
   field: accompany it with explicit millimetre metadata and verify import scale.
5. **Direct controls and Jarvis.** A feature/parts list, central 3D viewport and
   selected-feature properties share the same selection IDs and revision. Jarvis
   drafts a structured operation, such as changing hole diameter to 6 mm, against
   that revision. Preview the change before accepting it; stale jobs cannot
   overwrite newer edits. Parameter entry, undo and export also work manually.
6. **Access levels.** Declare viewer, designer and administrator roles in the
   owning application's imported schema. Separate viewing/downloading, creating,
   changing, deleting and managing access. Manufacturing submission remains a
   distinct explicitly authorized/confirmed operation in Scan to Print. Swarm
   administration alone does not imply access to another owner's design data.
7. **Reproducible execution.** The worker returns structured results and failure
   reasons, a geometry validation report and version information. Bind outputs
   to the exact submitted revision; support idempotent retries and cancellation.
   Derive numeric test tolerances from the kernel/export operation. STEP files
   may carry timestamps: test geometry equivalence, not assumed byte identity.

## Ordered engineering backlog

All rows below are open unless their owning release record explicitly says
otherwise. Implement CAD alongside the existing Video editor track.

Current progress: CAD-02 has an isolated worker and CAD-03 has an application,
feature history and exports. Full mounting-plate/reimport acceptance and the
planned imported viewer/designer roles are still separate requirements. CAD-04
has a direct contour handoff from Scan to Print, but general artifact sources,
measurement review and independently verified dimension changes remain open.
The shared STL viewport is a reusable preview component; it does not prove
kernel, manufacturing or physical accuracy.

| ID | Deliverable | Done when |
|---|---|---|
| CAD-01 | Scan artifacts available to other studios | Extend [B4](BACKLOG.md#b4--artifact-exchange-as-a-source) using the existing artifact contract. Only current owner-authorized STL/OBJ/SVG/report outputs appear; source revision, millimetres and measurement provenance accompany the handoff. Prove changed/revoked/foreign/expired input refusal. |
| CAD-02 | Real CAD worker feasibility | Pin and isolate a CadQuery worker; build the plate/holes fixture; export and independently reimport a valid STEP solid and STL; check bounds, volume, holes, cancellation and resource limits. Record image/dependency versions. No application feature claim before real worker evidence. |
| CAD-03 | First usable CAD Studio | Own private projects/revisions and bounded parameter edits; implement the plate task with real viewport, undo, save/reopen, exports, conflict handling and portal themes. Register the application, imported roles and all applicable Lab cases during installation. |
| CAD-04 | Scan-assisted reference modeling | Import CAD-01 assets, show orientation/scale and provenance, align references, review nominal/actual dimension conflicts and create an editable part alongside the preserved scan. An explicit structured axis resize to 80 x 40 x 30 mm must rebuild the intended geometry; independently reimport STEP/STL and verify those bounds within the declared kernel/export tolerance. Test units and coordinates against known fixtures. |
| CAD-05 | Practical part templates | Add a bracket, spacer and enclosure using the same bounded operations. Constraints refuse impossible wall/diameter/spacing combinations; edited geometry and exported solids pass independent checks. |
| CAD-06 | SOLIDWORKS adapter | Capability-check a licensed enrolled workstation; open a permitted native part, alter a supported dimension, rebuild, save a new native revision and export STEP/STL. Actual SOLIDWORKS round trip passes; missing edition/add-in is reported accurately. |
| CAD-07 | Measurement confidence | Deliver Scan B1/B2 depth inputs/reprojection and B3 scale fiducials separately. Known synthetic shapes and measured physical fixtures expose coverage, scale error and uncertainty; unseen details remain explicit. Include conflicting multi-axis measurements such as the observed nominal 80 mm/actual 70 mm width: display both, retain warnings and require review without claiming manufacturing accuracy. |
| CAD-08 | Print preparation and feedback | Configure a supported slicer and material/printer profile; bind G-code to exact geometry/profile revisions, preview job settings and retain confirmation. Implement B5 actual host progress. Simulator/adapter tests and an authorized physical print are separate acceptance records. |
| CAD-09 | Assemblies and drawings | Add part instances, supported assembly constraints, BOM and drawing views with dimensions/tolerances tied to the selected revision. Verify a small two-part assembly and released export; do not equate the current six-view SVG with this delivery. |
| CAD-10 | Review, analysis and release | Add candidate comparison, deviations from scan, explicit revision release and only validated analysis adapters. Record materials, loads, boundary conditions and solver evidence; connect specialist Aero/Ocean/Embodied workflows only through declared compatible artifacts. |

CAD-01 and CAD-02 can proceed independently. CAD-03 depends on the verified worker;
CAD-04 depends on both. CAD-06 is independent once its workstation prerequisite
exists. The first useful product checkpoint is CAD-03, not completion of all ten.

## Verification and installation

New functionality ships with its owning `testing.catalog` declaration and
`uses: [test-catalog]`. Include model/schema, real kernel, actual PostgreSQL
owner isolation, real-page browser, export reimport and cancellation tests.
Reference helper files and fixtures so changes affect recipe fingerprints.
Separate dependency-free tests from worker/browser/database prerequisites.

A registration count is not an execution result. Record committed source checks,
exact installed source, installed recipe availability/executions and native
user acceptance separately. Preserve other applications and user data during
installation. Hardware actions and live licensed-editor acceptance use dedicated
fixtures and their existing explicit authorization paths. No GitHub Actions are
required or commissioned by this delivery plan.

## Primary product references

Reviewed 2026-09-13 UTC; verify edition and API support when commissioning an
adapter. These describe external products, not implemented OSHAL capabilities.

- [SOLIDWORKS Design capability matrix](https://www.solidworks.com/sites/default/filesd10/25docs11/SOLIDWORKS_Design_Product_Matrix_October_2025.pdf): parts, assemblies, drawings and manufacturing tools vary by edition.
- [SOLIDWORKS 2026 ScanTo3D overview](https://help.solidworks.com/2026/english/SolidWorks/ScanTo3D/c_Scanto3d_overview.htm): scan-to-surface/solid workflow; listed for Design Professional, Premium and Ultimate.
- [SOLIDWORKS scan conversion methods](https://help.solidworks.com/2026/english/SolidWorks/scanto3d/c_two_methods_for_converting_scan_data.htm): preparation, guided/automatic surfacing, deviation analysis and solid construction.
- [CadQuery documentation](https://cadquery.readthedocs.io/en/stable/): parametric Python library and solid/interchange output; UI is separate.
- [FreeCAD features](https://www.freecad.org/features.php): parametric modeling, Python integration and native/neutral formats.
- [Onshape integrations](https://www.onshape.com/en/features/integrations): authenticated REST integrations and event webhooks.
- [Onshape export behavior](https://cad.onshape.com/help/Content/File/exporting_files.htm): exported geometry does not include its source feature/parametric history.
