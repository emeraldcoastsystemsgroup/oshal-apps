# Create image editor

Create 1.5.0 adds manual layered-image editing to the Create workspace. Open
**Create → Image editor**, the **Image design** quick start, or
`/api/create/editor`. Home's saved image cards reopen their exact project.

The historical 1.5.0 installation used published source
`b92013b48d6f705138617b5816c7d49581a28257`. Final native acceptance and four installed
Lab runs totaling 45 checks pass; [installation status](README.md#image-editor-installation-status)
records the deployed core/image, final cleanup and the earlier native checkpoints.

The current **1.6.0** installation adds the image templates below at source
`54c1e7890ee8352ba85e23ff9bfacdf2bbb1d2aa`. Its
[installation record](README.md#image-template-installation-status) separates
37 new plus 93 retained local checks, 58 installed Node checks and native
standalone edit/save/reopen/export acceptance after a recovered origin stall.

This is the first commissioned editor release. Regional AI regeneration, video
timelines, shared projects and desktop-editor interchange remain in [BACKLOG.md](BACKLOG.md).

## Working with a design

1. Upload a PNG, JPEG or WebP, choose an image through **OSHAL files**, or begin
   with text and shapes. Clipboard image paste also adds an independent image layer.
2. Select a layer on the canvas or in the stack. Drag to move; drag its corner to
   resize. Properties provide exact position, size, rotation and opacity. Arrow
   keys nudge one pixel, or ten with Shift.
3. Arrange, duplicate, hide or lock layers. Text remains editable. Rectangle,
   ellipse and freehand drawing layers retain their own properties. Image crop
   percentages select the source region without replacing the original image;
   brightness and contrast remain editable adjustments.
4. Set canvas dimensions and background under **Canvas settings**. On narrow
   screens, expand that disclosure. Zoom affects the workspace preview only.
5. **Save** creates a private project. Subsequent edits autosave after a pause
   when that option is enabled and the role permits changes. Undo/redo is local
   and bounded; saved revisions survive reopening. **My projects → Revisions**
   restores an earlier snapshot as a new edit.
6. Export a PNG, a JPEG, or an **Editable project** JSON file. Export saves pending
   edits first and checks current server export permission. PNG retains alpha;
   JPEG composites transparent pixels onto white. Editable JSON embeds the raster
   assets so supported layers can be imported into another authorized account.

A conflicting save does not overwrite a newer revision. Autosave pauses and the
draft stays in the current canvas. Reopen the saved project or use **Save a copy**.
Network failures stop automatic retries until another edit or an explicit Save.

## Image templates (1.6.0)

Open **Create → New → Image templates**, or choose **Browse image templates** in Image editor.
The gallery contains eight original designs: square announcement, story promo,
presentation title, video thumbnail, event flyer, quote card, product card and
profile banner. Search by name or purpose and filter by category. The preview is
drawn from the same document and renderer used by the canvas.

Choosing a design creates an unsaved project with fresh layer IDs. Text and
shapes remain independent editable objects. It does not replace a saved project;
if the current draft has edits, cancellation preserves it. **Save** creates the
new private project through the existing permission and revision checks. Opening
the gallery does not call a generation provider or save anything.

Read-only roles may browse, but starting a design requires `project.create`.
`?templates=1` opens the gallery; `?template=<exact-catalog-id>` opens one design.
A saved `project` link retains priority; combined template/artifact requests
report an error before fetching the artifact. These are image compositions,
including the video-thumbnail design, not editable video timelines.

The new model and real-browser suites are registered as `editor-templates` and
`editor-templates-browser`. Release-specific installed execution is recorded in
the README; registration itself does not run the browser suite.

## Ownership and permissions

Create owns its manual projects; Portrait and Video retain their generation
pipelines. The browser-native model, history and renderer in `tools/editor/`
have no framework or provider dependency and can be reused by another studio.
Each studio must retain its own admission and persistence boundary.

The installed [authorization catalog](authorization.yaml) exposes `viewer`,
`reader`, `creator`, `editor`, `exporter` and `admin`. Permissions are separately
named `project.view`, `project.read`, `project.create`, `project.change`,
`project.delete` and `project.export`. Roles combine additively through the
existing Access Administration screen. The app `admin` role still reads only
its holder's projects. Swarm management and a legacy `@app-admin` assignment do
not automatically grant these business permissions; upgrades must assign the
new catalog role through normal authorization administration.

For a legacy upgrade, revoke affected grants while the old catalog is still
registered, activate the new package, then preview and apply the intended named
roles. Activation refuses stale catalog assignments. Restoring the exact previous
package restores its normal management path if activation was attempted first;
do not edit authorization tables or silently translate roles.

Every project and asset uses the active framework actor's verified issuer and
subject. No body, query parameter or client identity can select another owner.
This release has no shared-tenant projects. PostgreSQL queries repeat both owner
columns, with transaction-local owner settings for the migration's RLS policy.
Permissions are checked before work and again before committing writes.

Export is a separately admitted application action, not a DRM boundary: someone
allowed to read image pixels can reproduce them outside the application. There
are no generation, sharing, email or printer actions in this manual editor.

## Persistence and limits

The installation migration creates projects, immutable revisions and asset
metadata. Saves use a current `baseRevision` under a row lock; mismatches return
409. Owner-qualified constraints prevent cross-owner asset references.
Create admits one write transaction per shared pool at a time, before checking
out a database client, so the current permission check can use the deployed
two-client pool. At most 32 writers wait for up to five seconds. Permission is
checked again after waiting and before commit; a full or expired queue returns
503 and leaves the browser draft available for an explicit retry. This bounds
Create writes; it does not guarantee capacity for every other application.
Uploaded raster files are normalized through the existing `sharp` dependency.
Files live under `CREATE_PROJECT_DATA_DIR`, or the shared workspace's
`create-projects` directory, in issuer-and-subject-hashed owner directories.
They never live in the installed application package. Back up that directory
together with the application's PostgreSQL tables.

The document is version 1 JSON with canvas dimensions/background, an ordered
layer array, and an immutable image mapping. Stored documents contain canonical
owner-gated asset references; portable exports embed supported raster data.
Unknown fields, arbitrary URLs, SVG/script data, invalid geometry and oversized
documents are refused.

| Boundary | Limit |
|---|---|
| Canvas or source image | 8192 pixels per side and 32 megapixels |
| One uploaded raster | 8 MiB |
| Stored document | 256 KiB |
| Portable JSON import/export | 32 MiB |
| One project | 200 layers, 64 image references |
| Undo snapshots | 50 snapshots within 64 MiB; older history is evicted |
| Account storage | 128 raster assets / 512 MiB; 1000 projects |
| Saved revisions | 1000 per project |
| Waiting writes per shared pool | 32 for up to 5 seconds |

Unattached raster assets can be reclaimed through the owner-scoped cleanup
endpoint after 24 hours. Assets referenced by any retained saved revision are
preserved. A failed upload/import does not create an implicitly shared project.

## Formats and boundaries

| Format | Retained behavior |
|---|---|
| PNG/JPEG/WebP input | Raster layer, normalized dimensions and orientation |
| PNG output | Flattened composition with transparency |
| JPEG output | Flattened composition on white |
| Create v1 JSON | Text, supported shapes, freehand paths, raster assets, layer order/visibility/locks, crop and transforms |
| PSD/AI/SVG or video timelines | Not supported by this release |

Font families use the browser's available fonts; portable files do not embed
fonts. A flat generated image enters as one raster layer. Automatic segmentation,
advanced masks and exact regional generation are separate capabilities.

## Image handoffs and Jarvis context (1.7.0)

Choose **Add image layer in Create** from an image's shared **Send to** menu.
Create opens the editor through the normal workspace navigation, redeems the
current user's temporary artifact handle, and imports PNG, JPEG or WebP through
the existing private upload path. The 8 MiB raster limit still applies. A flat
generated image becomes one independent raster layer; its painted objects do
not become editable text or shapes automatically.

Repeated forwarding of the same handle imports once. Different handles in the
same URL are refused. Consuming a handle preserves unrelated URL parameters and
history state. Missing permission, expired content and late read/upload responses
cannot replace another document or a later manual draft. Imported assets retain
the normal owner checks, save/reopen behavior and unattached-asset cleanup.

Jarvis receives a bounded snapshot of the current project/revision and selected
layer, including selected text where applicable. It receives no image pixels,
asset references or complete project document. Dialogs, loading, missing access
and teardown retire stale context. The editor advertises no mutation capabilities;
confirmed text edits, region regeneration and returning generated child revisions
remain future work.

Both flows use existing core contracts: artifact exchange, surface bridge,
normal owner upload and the editor's shared state. `editor-artifact` and
`editor-context` in the package Test Lab catalog drive the real pages and core
contracts with synthetic local fixtures. From the core checkout, both can be
run together with the catalog-driven host command:

```sh
npm run test:package -- --package ../oshal-apps/create --case editor-context --case editor-artifact --run --report temp/create-integration-results.json
```

## Verification

Every suite is registered in [AI Test Lab](tests/test-lab.yaml). Model/history
tests are sealed Node tests; renderer and workspace tests use real Chromium
pixels and downloads with disposable local fixtures. HTTP tests exercise the
actual package routes; authorization tests use the actual core policy and route
mounter. The PostgreSQL recipe applies the real migration only to an isolated
disposable database. Browser/host recipes are not claimed to run during a
metadata-only installation smoke.

The original 1.5.0 validation passed 163 checks. That installed checkpoint registered 14 Lab cases:
13 declared recipes plus generated readiness. Four installed Node
runs pass 45 checks with exact source attribution and verified cleanup. Other
linked browser and host-dependent runners remain unavailable in the installed
Lab; their local results are separate from these installed checks.
Final native acceptance passes import, save, reopen, JPEG/editable JSON export
and deletion, followed by strict preservation and empty project tables. The
[release record](README.md#image-editor-installation-status) retains the earlier
native checkpoints and the scope of each evidence source.
