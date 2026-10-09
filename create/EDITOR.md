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
   brightness, contrast and the image filters below remain editable adjustments.
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

## Image filters (1.8.3)

Select an image layer to see its filters under **Selected layer**. **Filter look**
applies a named look in one step: None, Black and white, Vintage, Vivid, Muted or
Soft focus. Each look sets all four filters, so choosing another look replaces the
previous one rather than stacking on it. The sliders adjust each filter directly:

| Filter | Range | Neutral |
|---|---|---|
| Saturation | 0–300 % | 100 % |
| Grayscale | 0–100 % | 0 % |
| Sepia | 0–100 % | 0 % |
| Blur | 0–64 canvas pixels | 0 |

Filters are editable properties of the layer, not a change to the uploaded image.
Every look or slider change is one undoable edit, saves with the project and
round-trips in **Editable project** JSON. PNG and JPEG exports come from the same
renderer as the canvas preview, so the exported pixels match what you see. Blur
softens the layer's edge onto whatever lies beneath it.

A filter at its neutral value is not stored. A project that uses no filter keeps
the 1.8.2 document shape and still opens in earlier releases; a project that uses
one is refused by an earlier release's validator instead of being shown without it.
Values outside the ranges above, non-numbers, unknown filter names and filters on
text, shape or drawing layers are refused. Filters make no provider call and add no
route or permission.

## Region selection (1.8.4)

Choose part of an image to change later. Select an image layer, then **Select region**
in the canvas toolbar:

- drag a **lasso** around the area (the outline closes itself),
- hold **Shift** and drag for a **box**, or
- click the image, or press **Whole image**, to select everything the layer shows.

The region is outlined on the canvas overlay; it is never part of the document,
never saved and never exported. **Clear region** or **Esc** removes it, and opening
another project clears it. The status line beside the canvas states its size in
source pixels and the layer it belongs to.

A region is recorded in the **source image's own pixels**, not screen positions.
Zooming the workspace, moving, resizing or turning the layer afterwards does not
move it onto different pixels; the outline follows the layer. It is clipped to the
part of the image the layer's crop shows. Up to 2000 outline points are kept (a long
lasso is thinned evenly); a region smaller than 64 source pixels is refused.

Before a region is shown, described or used it is checked again. It must be
reselected, and says why, when the layer was deleted, hidden or locked, its image
was replaced, or the crop no longer shows the whole region. A region is refused
before it exists when no image layer is selected and more than one image lies under
the pointer, when the selected layer is not an image, or when that image is locked
or hidden. Brush selection is not part of this release.

Jarvis receives the region in the same read-only editor context: its kind, target
layer, source-pixel bounds, area, point count and whether it is ready or stale (with
the reason). It receives no outline points, pixels or asset references, and still
cannot change the document. Region regeneration itself is the next milestone.

## Changing a region in the editor (1.9.1)

Select an image region (above) and the **Change a region** panel appears beside the
layers. Before anything is sent it states which region and layer will be sent and from
which saved revision (unsaved edits are saved first), and which image service would
answer and what it costs; a role without `project.generate` sees why instead, and
nothing is sent. Write what should change and choose **Regenerate region**.

While the region is regenerating you can keep editing, or **Cancel**. When a candidate
is ready, **Compare and decide** opens the image before and after side by side.
**Accept as a new revision** adds it on top of the revision you hold, as one step that
**Undo** reverses; **Reject** discards it and **Decide later** keeps it waiting. A
failure, a cancellation or a rejection says so and leaves the project unchanged. A
candidate that arrives after you saved newer work is applied on top of that work; if you
locked or replaced its image meanwhile, or another tab saved a newer revision, accepting
is refused with the reason and nothing changes.

## Cost consent for region regeneration (1.9.4)

The read-only `GET /api/create/region-edit-provider` response advertises
`costConsentVersion: 1`. A client relying on this guarantee must require the exact
numeric version before uploading images, creating projects or submitting edits.
Missing or unsupported versions mean unavailable, not permission to try the old API.

The existing region-edit POST accepts optional `maxCostClass: 'free' | 'paid'`.
A supplied value must be one of those exact strings; malformed values return
`400 invalid_region_cost_cap` before project-store work or provider resolution.
An omitted field deliberately retains legacy behavior, including paid generation;
legacy callers do not receive the new cost-cap guarantee.

The cap belongs to that one background job. After it acquires its execution slot,
the server resolves the actual provider and checks its cost class immediately before
calling that same instance. A `free` cap refuses a paid provider; either explicit cap
refuses an unknown class. There is no provider retry or fallback. Refusal after the
POST's `202` is recorded as `status: failed` with
`error: region_edit_cost_cap_exceeded`: no generation call, cost event or candidate
is produced, and the project is unchanged. The admitted failed request still counts
toward the existing daily admission ceiling. This is a cost-class ceiling, not a
dollar limit, price quote or provider/model identity pin.

The editor requires the advertised version and a known displayed class. It captures
that class on the **Regenerate region** click, before saving pending manual edits.
A provider refresh during the save cannot increase that click's cap. A refusal refreshes
the cost disclosure but never resubmits; review it and click again to authorize a new
request. A deliberate manual save made before the refusal remains saved.

No route, permission, catalog binding or migration changes. Regression recipes are
registered in `tests/test-lab.yaml`: HTTP malformed-cap/version checks, real
PostgreSQL queue/provider checks and Chromium click/save/refusal checks.
The 2026-09-29 coordinating runner reports canonical generation complete and actual
compiled-route HTTP **7/7**, real-PostgreSQL **22/22** and actual-Chromium **6/6**
passing, all exit 0 with no skips and verified database-fixture cleanup. The same
three suites passed again (7/7, 22/22, 6/6) on 2026-10-02 after the rebase onto store main.
Provider/accounting boundaries are synthetic; installation and live acceptance
remain pending.
See the [versioned receipts and compiler transport caveat](README.md#region-edit-cost-consent-194).

## Region regeneration (1.9.0)

Create 1.9.0 adds the server half of point, describe, regenerate and accept. A person
selects a region (above), writes an instruction, and receives a **candidate**: a new
copy of the layer's image in which only the region was regenerated. The candidate is
not part of the project until it is accepted; rejecting or cancelling it, or a provider
failure, leaves the project exactly as it was.

**What is sent.** The request names the exact saved revision it was made from, the
region (validated again on the server with the same module the browser runs and
re-checked against that stored revision) and the instruction (1 to 1000 characters). The
provider receives only a crop of the image: the region's bounds plus a quarter of its
size as context. It is an image-to-image edit of that crop through the media-generation
kernel skill (the storyboard image provider Portrait also uses); the provider is not
given a mask, so its answer can differ anywhere in the crop.

**What is kept.** Create resizes the answer onto the crop and blends it into the source
image **only where the region covers**, with sharp. Every pixel outside the region is
copied byte for byte from the source image; a region with a feather softens its edge
inward only. The result is stored as an ordinary owned Create image of the same size.
This is exact outside-region preservation at the compositing boundary; how well the
provider follows the instruction inside the region is the provider's.

**Accepting.** Accepting requires the revision the person currently holds and appends
exactly one new revision on top of it, in which the target layer shows the candidate
image and every other layer, and every other property of that layer, is unchanged.
Manual edits saved while the candidate was generating are therefore kept. A request
that names an older revision is refused (409), so a late candidate can never replace a
newer manual revision. If the target layer was deleted, its image replaced, or the layer
locked in the meantime, acceptance is refused. The edit records its source revision and
the revision it became; the earlier revision and image remain in history.

**Permissions and spend.** Generating is its own permission, `project.generate`
(effect `execute`), carried by the new `generator` role (view, read, generate) and by
`admin`. Existing roles keep their exact meaning. Accepting is `project.change`, like
any save. Vendor-reported spend is recorded in the canonical ledger (`chat_tasks` and
`oshal_cost_events`) against the requesting person and the concierge Create declares
(`general-bot`). Manual editing never resolves a provider or records a cost.

**Command-line image rails (1.9.5).** Under demo mode the kernel's storyboard image
rail is picked by the render bot's own harness (its own provider row, else the swarm
default), and on a render bot that runs Antigravity that is the `antigravity-cli` rail:
agy's own image tool on the render bot. Create accepts that
rail for the deployment operator only. The kernel reports it available only to an
operator caller in demo mode and checks the same thing again at the bot. The
command-line transport still does not carry Create's application permission
(`project.generate`) to the bot, so the rail is not opened to anyone else. Anyone else
sees region regeneration as not configured, and their edit fails
`region_edit_provider_unavailable`. No other provider is tried for them, nothing is
generated, and nothing is charged. Create still checks `project.generate` first, and the
provider must report itself available for the caller before any generation. The
`codex-cli` rail stays refused for everyone.

| Limit | Default | Setting |
|---|---|---|
| Requests in flight | 1 per person | fixed |
| Requests per rolling 24 hours | 25 per person | `CREATE_REGION_EDIT_DAILY_CAP` (1 to 1000) |
| Concurrent provider calls | 2 per API process | `CREATE_REGION_EDIT_MAX_CONCURRENT` (1 to 16) |
| Provider deadline | 120 seconds | `CREATE_REGION_EDIT_TIMEOUT_MS` (10000 to 600000) |
| Unanswered request | reported failed after 10 minutes | fixed |

Permission is checked when the request is admitted, again after the provider answers,
and again before the candidate is stored; revoking `project.generate` meanwhile discards
the result. Unused-upload cleanup keeps a candidate that is generating or waiting for
review and reclaims it once it is rejected.

| Route under `/api/create` | Permission |
|---|---|
| `POST /projects/:id/region-edits` `{sourceRevision, selection, instruction, maxCostClass?}`, 202 | view, read, generate |
| `GET /projects/:id/region-edits/:edit` | view, read |
| `POST /projects/:id/region-edits/:edit/accept` `{baseRevision}`, 201 new revision | view, change |
| `POST /projects/:id/region-edits/:edit/cancel` and `/reject` `{}` | view, read, generate |
| `GET /region-edit-provider` (configured provider, cost class and consent version, no generation) | view, read, generate |

Migration 005 adds the private `create_region_edits` table, forced, with the same
two-arm exact-owner policy as the project tables. The editor panel that uses these
routes is described above.

**Installing 1.9.0.** Adding a permission and a role changes the authorization
catalog in a widening way, so activation is refused until it is reviewed
(`authorization_catalog_migration_required`); the installed Create keeps serving under
its existing grants meanwhile. An application-wide administrator reviews it with
`GET /api/authorization/catalog-migrations?app=create` and approves it with
`POST /api/authorization/catalog-migrations/apply`; the next activation applies it.
Grant `generator` to whoever may spend on region edits.

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
| Create v1 JSON | Text, supported shapes, freehand paths, raster assets, layer order/visibility/locks, crop, image filters and transforms |
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
and teardown retire stale context. The editor advertises no mutation capabilities to Jarvis;
confirmed text edits and assistant-driven region regeneration remain future work.
Region regeneration itself is a person's action in the editor (1.9.1).

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
