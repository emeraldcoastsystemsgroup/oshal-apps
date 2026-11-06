# Editor foundation review shim

The current full review opens **16 real editors** at `http://127.0.0.1:38821/`.
Start it with `bash scripts/editor-foundation/launch-full-review.sh`; the
[full launcher section](#full-editor-review-launcher) describes its actual
storage, engines and unavailable provider workflows. The older two-editor
workspace below remains available separately on port 38820 with its saved work.

This loopback-only review workspace serves the actual Create and Publishing editor
assets and the shared foundation from the selected kernel platform checkout. It
never proxies production, imports production data, uses a production identity, or
connects an AI provider.

Create uses its real model validation and immutable revisions over a small atomic
JSON review store. Its shape, text, vector and client-side export controls are
real. Raster/PSD upload and generation are explicitly unavailable in this shim.
The JSON store survives restart. This is a named review persistence seam, not
proof of the installed Create SQL/authorization boundary.

Publishing uses its actual mounted application routes, original-person store,
non-bypass-RLS disposable PostgreSQL role, private worker, native Typst layout,
PDF and previews. The test fixture's `alice` identity and continuation transport
are named seams. It creates its own uniquely named database/role, **not an
application database**, and removes them when the server stops. Publishing edits
survive page/browser reload for the lifetime of the server. A fresh server creates
a fresh Publishing review publication. No live provider or approval execution is
simulated.

The required environment is the same as the genuine Publishing source fixture:

- `OSHAL_TEST_POSTGRES` selects only disposable `127.0.0.1:35689`.
- `OSHAL_PUBLISHING_PYTHON` and `OSHAL_PUBLISHING_TYPST` select its prepared pinned runtime.
- `STORE_CI_TOOLCHAIN` names the pinned Store dependencies.
- `OSHAL_PLATFORM_ROOT` selects the kernel checkout's `platform` directory,
  including the new shared editor assets.

On this development host those values are held privately in
`~/.local/state/oshal-editor-foundation/fixture.env`. Do not print or commit them.

```sh
source ~/.local/state/oshal-editor-foundation/fixture.env
node scripts/editor-foundation/review-server.mjs
```

Open `http://127.0.0.1:38820/`. The header switches between the two real editors
and labels the separate review workspace and unavailable AI. The initial
Publishing publication is rendered through the genuine worker before startup
completes. A second instance can select `EDITOR_REVIEW_PORT`; Create's default
state is `~/.local/state/oshal-editor-foundation/review/create-projects.json`.
Stop with Ctrl+C or SIGTERM to close the server/worker and remove its own disposable
Publishing database. Existing user documents and the production and development
kernels on 38788/38789 are untouched.

Run the acceptance checks from this repository:

```sh
source ~/.local/state/oshal-editor-foundation/fixture.env
EDITOR_REVIEW_SCREENSHOT_DIR=/tmp/editor-foundation-proof \
  node --test scripts/editor-foundation/review.test.mjs
```

The browser check starts a separate ephemeral-port server and database and uses a
private temporary Create store. It exercises real contextual-property changes,
undo/redo, save/reopen, handoff identity, real PDF output and phone drawers. It
also verifies provider unavailability and cross-origin write refusal. The review
server is intentionally not a general local application host or a replacement
for installed human/provider acceptance.

The optional `startSourceReviewHub()` export in `source-review-hub.mjs` creates an
independent ephemeral loopback upstream for the broader review host. It returns
`{origin,entries,notice,close}`. Each entry supplies its actual app URL, saved
record ID and library selection label. The host can proxy the four app API
prefixes to this origin and serve shared assets from its selected kernel root.
The host must enforce its own same-origin loopback check and forward content
headers without the browser Origin/Host (as the existing Publishing proxy does).
No current service is restarted by importing this module.

The source upstream mounts the actual Portrait, Brand, Stories and Vids typed routes
and package HTML over one uniquely labeled disposable PostgreSQL container using
an application-owned non-bypass role and FORCE RLS. It seeds original source
through those same HTTP routes, including an exact protected PNG and crop. The
fixed synthetic original person, legacy app-admin decision, empty generated
asset directory and unavailable provider are explicit review seams. Save/reopen,
scene edits and photo asset storage are real; source data is removed on close.
The module does not open, change or stop the existing Publishing fixture.

Besides the environment above, set `OSHAL_EDITOR_SHARP_ROOT` to the exact prepared
Sharp runtime root (the reviewed native Office runtime on this host) if Sharp is
not already resolved by the pinned dependencies. Run its isolated proof with:

```sh
node --test scripts/editor-foundation/source-review-hub.test.mjs
```

That proof also saves and reopens an actual CreateV4 diamond, dashed outline and
shadow through the existing atomic review store. A fresh service process imports
the current validator; existing valid review projects are retained.

## Full editor review launcher

`full-review-server.mjs` composes the current editable Image source, Office's
PowerPoint/Word/Excel, PDF, three source-project apps, Motion, Video, CAD, Scene,
LoRA, Vids and Scan source editing behind one same-origin loopback host. These
16 editors use the new port 38821. Its JSON status at `/review/status` lists each actual mount and the named
unavailable workflows. It never forwards an AI provider request, approval action,
production credential or fixture actor header supplied by a browser.

Image starts from an exclusive copy of the earlier review JSON in a new
`~/.local/state/oshal-editor-foundation/full-review/create-projects.json`; the two
services never write the same file. Current CreateV4 validation accepts native
shape, outline and shadow saves. The earlier service on 38820 and its Publishing
data are preserved. Its current saved models and exact protected image bytes are
backed up under the new private state directory, and current documents are cloned
through actual read/upload/create/revision APIs into a fresh current Publishing
fixture. Historical models remain in the private backup and the earlier originals
remain untouched; new clone IDs are recorded in a receipt. The earlier mixed
UI/backend version is not offered as a working editing link. Every additional SQL/engine fixture owns its unique disposable
schema/database/container and is removed on this server's close. Native engine
images are already local and run with `--pull=never`. Video uses the actual
package ffprobe, tracked FFmpeg encoder and decoded-output verification, never
the browser fixture's marker encoder. LoRA source uses actual SQL and ordinary
source permissions with no registered worker. Desired captions save while
synchronization visibly fails without advancing applied source; no simulated
GPU worker acknowledgement appears. Vids persists actual briefs without dispatching
generation. Scan uses actual owned calibration, ingested photos and bundled
reconstruction, with printer and external-process ports unavailable.

The launcher reads the existing private fixture environment and explicitly selects
the prepared dependency/engine runtimes. Its default local command is:

```sh
bash scripts/editor-foundation/launch-full-review.sh
```

All path defaults can be overridden through their named environment variables in
that short script. `EDITOR_FULL_REVIEW_PORT` selects another loopback port. Do not
run two full-review writers against the same state directory. The module API's
`stateDir` and `sourceCreateFile` options support isolated tests.

The genuine composed acceptance recipe is:

```sh
# Source fixture.env and export the runtime paths as in launch-full-review.sh.
node --test scripts/editor-foundation/full-review.test.mjs
```

It waits for each actual iframe URL and saved record identity, checks resolved
theme tokens and successful primary script/style requests, saves actual CreateV4
appearance without changing the original JSON, exports actual OOXML and a decoded
FFmpeg MP4, checks same-origin admission and verifies the earlier Publishing
service remains available while the current clone is independently editable. No marker outputs, SQL dispatch doubles or provider
success responses are used as acceptance evidence.
