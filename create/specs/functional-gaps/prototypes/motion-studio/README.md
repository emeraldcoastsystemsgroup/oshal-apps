# Motion Studio — integration in progress

This engine prototype is being built toward the full creative completion goal.
It stays under Create specifications until Motion Studio has reviewed application
routes, UX and authority declarations; it then becomes a proper package. Source
HTTP routes and a working manual UI now exist, with actual-page workflow proof. It is not
registered as an installable application yet. Installed human UX and mounted persistence/assets routes,
installed agent tool/persona registration, cancellation/export jobs, editable cross-app handoffs and installed
acceptance remain required before an application delivery claim.

The pinned engine adapter links the EffectCraft compositor/automation/host crates
at `67434e90388b6dca4417555346fa6850b6f96033`. It uses the actual command registry,
project model and CPU renderer, including the expression host, rather than a
separate approximation of the motion document. Source dependencies and transitive
revisions are captured in engine/Cargo.lock. Code licenses are retained in
engine/licenses; upstream trademark artwork and Adobe assets are not copied.

Current worker protocol: one bounded JSON request on stdin, one JSON result on
stdout. `create`, `catalog`, `inspect`, `edit` and `preview` operate in an isolated
in-memory session. A failed edit batch returns no revised document. Commands that
need filesystem access, scripts, plugin loading, application control or export
adapters are refused. Still raster footage now receives bounded owned bytes
through the in-memory source described below. Proxy/video/audio/model/data footage
remain explicitly unfinished. This is explicit incomplete functionality, not a claim of
complete motion coverage. An engine process is not an authorization boundary;
original-person permissions, immutable revisions and tracked job lifecycles belong
to the original-actor project store and application routes below.

Build and verify without touching another lane's Cargo target:

```sh
CARGO_TARGET_DIR=/tmp/oshal-creative-motion-target cargo build --locked --manifest-path create/specs/functional-gaps/prototypes/motion-studio/engine/Cargo.toml
CARGO_TARGET_DIR=/tmp/oshal-creative-motion-target cargo test --locked --manifest-path create/specs/functional-gaps/prototypes/motion-studio/engine/Cargo.toml
CARGO_TARGET_DIR=/tmp/oshal-creative-motion-target cargo clippy --locked --manifest-path create/specs/functional-gaps/prototypes/motion-studio/engine/Cargo.toml --all-targets -- -D warnings
```

Source proof on the ARM64 host: a real five-second red solid opacity animation
rendered first/middle/last to PNG, decoded center alpha 0/128/253, transparent
outside the layer, byte-identical rerenders, native-document reopen and atomic
batch refusal. That proves the tested compositor slice; it does not establish
human UX, native installation, full Adobe fidelity or all upstream commands.

Upstream's [known gaps](https://github.com/storytold/effectcraft/blob/67434e90388b6dca4417555346fa6850b6f96033/docs/gaps.md)
and the [OSHAL coverage matrix](../../coverage-matrix.md)
remain open inputs. Kernel activation and shared mechanism work are coordinated
with @admin on the kernel COLLABORATE board; this lane does not deploy in parallel.


## Owned persistence adapter

`routes/project-store.mjs` now provides real SQL-backed create/list/read/save,
immutable revision history, export, project deletion, and raster upload/list/read/
unused deletion. Ownership is derived exclusively from the admitted context's
active issuer and subject. Every action checks its named `project.*` permissions,
rechecks the same identity after validation, stamps transaction-local ownership,
and checks current permissions immediately before commit or returning bytes.
Read, create, change, delete and export remain separate grants. Upload requires
create or change. A read withdrawn after fetching returns no private result; a
write withdrawn after inserting rolls back its project, revisions and retry key.

`MotionProjectStore(ctx, {validateDocument, decodeRaster})` requires both trusted
validators. The document validator calls the pinned worker before any write;
raster decoding determines the normalized bytes, MIME and dimensions rather than
accepting caller assertions. Validators run before opening SQL transactions.
The source application adapter wires them to the original-caller engine relay.
Request fields may not choose an owner or invoke a validator. Native installation
and admission of this module and migration remain unverified.

Create accepts `{title, document, assets?, requestKey}`; save also requires
`baseRevision`. Request keys and asset ids are UUIDs. Exact retries return the
original immutable revision, even after later saves; reusing a key with different
validated data refuses. Owner locks serialize quotas and revision admission;
stale or concurrent saves return `motion_revision_conflict` without appending.
Assets referenced by any historical revision cannot be deleted. Deleting a project
removes its revision references; unused asset deletion then frees its quota.

Declared bounds: 2 MiB compact native document, 1,000 projects and 1,000 revisions
per project, 256 MiB total owned revision JSON (conservative reservation), 64 raster
assets / 256 MiB asset bytes, 4 MiB per normalized raster, 8,192 px per side and
33,554,432 pixels, at most 64 distinct assets per revision. These are PostgreSQL source upper limits and the retained native targets.
Native raster admission currently has a lower transitional encoded-row capacity;
native aggregate feasibility is unproved. They are not DGX/browser performance promises. Dimensions, durations,
concurrency, preview/export latency and peak-memory measurements remain required.

The initial migration installs composite owner-qualified foreign keys, forced
RLS, and update refusals for immutable documents/assets. Tests use a non-superuser,
non-bypass-RLS role in a unique schema on **shared disposable PG127.0.0.1:35689**.
The PostgreSQL fixtures clean only their own schema and role; native-host fixtures
clean only their own disposable database. Neither removes the shared container
or accepts a live database address. Original native animation curves survive SQL
save/reopen and render the actual middle-frame alpha128; actual raster decoding
checks persisted pixels. Ownership, retries, concurrent saves/uploads, revoked
read/write grants, immutable history, invalid engine documents and asset deletion
are exercised, rather than inferred from declarations.

```sh
# OSHAL_TEST_POSTGRES must be an explicit URL for the shared disposable PG35689.
# Install fixture pg in the store toolchain and sharp in your isolated fixture deps.
MOTION_ENGINE_BINARY=/tmp/oshal-creative-motion-target/debug/oshal-motion-engine \
MOTION_RASTER_DEPS=/tmp/oshal-create-proof-ZFGNIA \
STORE_CI_TOOLCHAIN=/home/oshal-maintainer/Documents/projects/oshal-apps/scripts/toolchain \
node --test create/specs/functional-gaps/prototypes/motion-studio/tests/project-store.test.mjs
```

Still required: installed native-kernel route/catalog acceptance and owner/grant tests,
native footprint binding and larger-project asset caching, installed human timeline/property acceptance, agent
catalog/tools/persona, export/cancel jobs, editable cross-app lineage, and the full
upstream/Adobe coverage matrix. Source tests now connect stored bytes to editable
native footage, masks and actual renders. Native installation and human/agent
workflow acceptance still remain open.


## In-memory owned raster footage

The worker accepts `assets: [{id, sha256, data}]`, where `data` is base64 of original
owned raster bytes. The package adapter must obtain these bytes through the current
actor's project store; HTTP/agent inputs may select owned IDs, never choose an owner
or forward worker authority. The worker is a computation process, not permission
proof. It verifies canonical UUIDs, exact SHA256 digests, duplicates, encoded and
decoded byte counts, image headers and actual pixel decoding before rendering.
PNG, JPEG and WebP are supported. Pixels feed the pinned compositor's real
`FootageSource`; missing data, external paths and inconsistent native dimensions
refuse before preview. Native source URIs are `oshal-asset:<id>@<sha256>`.

`asset.import {assetId, name?}` creates a native still-footage item and adds its
editable layer with the original core layer command. Core masks, transforms,
keyframes, effects and nested compositions continue to use the same native model.
The actual command catalog exposes this adapter command's closed schema alongside
the pinned core schemas. Required asset references are derived from the native
Footage URIs at persistence, so omitting the request's attachment list cannot make
underlying photo bytes deletable while immutable history still refers to them.

Current per-request transport bounds fit the existing native engine relay: 12 MiB
JSON, 2 MiB native document, up to64 images / 4 MiB each, **6 MiB total compressed
raster bytes**, and **33,554,432 total decoded pixels**. PNG preview output is capped
at8 MiB so its base64 reply fits below the relay's12 MiB ceiling. Storage/library
quotas remain separate from this active-request ceiling. Larger compositions need
a reviewed owned batch/cache transport; they are not silently rendered with missing
images. Native container memory/latency measurements and that cache path remain
open before a full app delivery claim.

Import/export/script/plugin callbacks are disabled as well as command confinement.
The document guard also checks known core file-capable effect controls: inline LUT,
OCIO file-transform data and Mocha shape JSON may render, but filesystem values,
animated external filenames, expression-based filenames, and custom OCIO config
files require a future owned text/config adapter. This covers renderer-level file
fallbacks that ordinary command confinement alone does not guard. Installed-model
rotoscoping and proxy/video/audio transport remain separate unfinished adapters.

Source proof: actual semitransparent raster pixels render inside a native mask,
remain transparent outside it, reopen byte-identically and preserve the original
document on an invalid batch. Digest changes, missing bytes, external paths and
forged dimensions refuse. A real disposable-PG test uploads/decodes a photo,
imports it into an editable native composition, saves without explicit asset IDs,
reopens and renders identical masked PNG bytes, refuses a foreign caller's reuse,
and protects its source through both historical revisions.


## Native relay and graph validation

`engine/bridge.mjs` now speaks the existing `engine.exchange` wire protocol: a
bounded `{bridge:{protocol,buildHash,upstream}}` hello, one
`{id:1,cmd:"motion",args:<worker-request>}` packet, and one result carrying `id:1`.
The package client in `routes/engine-client.mjs` calls only `ctx.intent`; its input
cannot choose a host, executable, owner or alternate transport. This is tested
transport/source integration, not an installed-kernel authorization receipt.

The bridge reserves at most two active slots (configured1..4), starts one isolated
Rust child per accepted request, bounds input/output to the native12MiB ceiling,
and stops computation after45s. Disconnect, timeout and shutdown target only that
connection's actual child handle. A killed child retains its slot until its real
close event; unresponsive children escalate from SIGTERM to SIGKILL. Extra packets,
malformed UTF8/JSON and oversized input are refused before a worker can be admitted.
A later second packet stops the already admitted child rather than starting another.
The child environment excludes inherited credentials and preload/options variables.

Build identity covers exact Cargo manifests/lock, build script, worker/graph/asset
sources, bridge and identity generator. Rust embeds it at build time. The committed
package descriptor must match both the bridge hello and **each worker result**;
changing the executable after startup cannot reuse a prior successful handshake.
Identity is source/version fidelity, not cryptographic attestation of an untrusted
host. The installation must continue to pin the genuine private engine endpoint.
After any runtime-source or formatting change, generate the package descriptor,
build the worker and test their equality before pushing:

```sh
node create/specs/functional-gaps/prototypes/motion-studio/engine/package-identity.mjs > create/specs/functional-gaps/prototypes/motion-studio/routes/engine-identity.json
CARGO_TARGET_DIR=/tmp/oshal-creative-motion-target cargo build --locked --manifest-path create/specs/functional-gaps/prototypes/motion-studio/engine/Cargo.toml
MOTION_ENGINE_BINARY=/tmp/oshal-creative-motion-target/debug/oshal-motion-engine node --test create/specs/functional-gaps/prototypes/motion-studio/tests/engine-bridge.test.mjs
```

The native document guard now rejects composition/folder/parent/matte cycles,
missing or wrongly typed source references, cross-composition parent/matte targets,
zero/aliased item/layer IDs, overdeep graphs and invalid solid/pixel-aspect dimensions.
Composition timing must have positive rational components at most1e9, rate at most
1,000fps, and duration greater than0 and at most24hours; these are declared source
bounds, not yet installed performance promises.
Valid shared subtrees and actual nested compositions still render. The guard runs
before imported models enter the session and after each edit, including imported
raster layers. A depth memo prevents previously visited children from hiding a
longer path introduced by another parent.

Real loopback tests cover actual composed/keyframed pixels through the framed
worker, source mismatch, excess bytes, blocked selectors, malformed input, occupied
slots and result identity. Lifecycle-only fixtures use deliberately stalled real
child processes to prove timeout/disconnect exit and slot reuse; they do not pretend
to render. The sixteen owned-project SQL/raster checks remain a separate regression
on the shared disposable PG35689, with their own schema/role cleanup.

Still open before application delivery: genuine native package/catalog admission and installed SQL acceptance,
container/build/installation packaging through @admin, admitted app authorization and
HTTP/tool contracts, installed timeline/property/keyframe acceptance, agent persona/tools,
durable export/cancel jobs, larger-project owned asset transport, editable Video
lineage and the broader product/format fidelity matrix. No shared engine daemon was
started or installed by this checkpoint; test listeners used ephemeral loopback ports.


## Shared human/agent application runtime

`API.md` freezes the owned HTTP/tool/permission contract. `routes/application.mjs`
now mounts actual CRUD, immutable operations/restores, real PNG preview, separate
export, normalized raster upload/read/delete, metadata, permissions, command schemas
and exact public HTML/JS/CSS assets. The original actor is captured per request;
all delegated authorization and engine calls check that actor, rather than quietly
starting another person's transaction after an await. Admission precedes JSON or
multipart parsing; named grants are checked again before private bytes return.
Identical command retries compute from their immutable base then return the original
saved revision, while a new stale operation cannot clobber later edits.

The manual page creates compositions; adds real text, solid, vector and photo layers;
edits transforms/opacity, masks and keyframes with linear/hold/ease; scrubs actual
frames; reopens saved work; undoes through immutable history; and exports original
JSON. Owned photos can be reused from a library and deleted only when no historical
revision references them. Dynamic command schemas provide more editing controls.
Timeline units come from the pinned engine's actual catalog, not a guessed constant.
Busy status, original-document response fences and newly added layer selection stay
current while requests are in flight. The narrow layout is checked at412px.

Source evidence: seven production-route HTTP tests use real Express/Multer/Sharp,
real framed compositor children and a non-bypass-RLS role on shared PG35689. Three
actual-page Chromium workflows prove real middle-frame alpha128, visible caption
pixels, photo/mask save/reopen, undo, correct five-second timeline units, and a held
red preview that cannot replace a newly opened blue canvas. Fixture actors are
explicit controlled contexts, not installed native-kernel authorization proof.
Each fixture cleans its own schema/role, exact browser child and loopback listeners;
it does not remove the shared database container or access installed data.

```sh
MOTION_ENGINE_BINARY=/tmp/oshal-creative-motion-target/debug/oshal-motion-engine \
MOTION_TEST_DSN_FILE=/path/to/private/disposable-pg35689-url \
STORE_CI_TOOLCHAIN=/home/oshal-maintainer/Documents/projects/oshal-apps/scripts/toolchain \
node --test create/specs/functional-gaps/prototypes/motion-studio/tests/application.test.mjs
# Same fixture variables for tests/workbench.test.mjs; requires installed Chromium.
```

Native migration declarations retain tables, checks, composite owner keys and
immutable triggers. The actual package must declare its PostgreSQL RLS migration
as replaced by `migrations/native/001-motion.sql` on the native kernel, then pass
real package/catalog admission and installed SQL/HTTP acceptance. Small-source native SQL
provisioning and mounted workflows are exercised below; large assets and
aggregate asset/revision growth are not established by those cases. The real candidate manifest, authorization, agent persona and Test Lab declarations
now exist in this prototype folder; no installed catalog entry or deployed screen
is claimed. Extraction still needs reviewed registration, container/install
packaging and native package/installed acceptance; export jobs, large-project transport,
editable Video lineage and full product fidelity remain open beyond this runtime.


## Native runner compatibility

`tests/native-runner.test.mjs` loads the actual application factory in the kernel's
production Node runner and routes through its own Express/Multer compatibility
ports and original-person authorization port. It serves the exact manual assets,
reads the real framed compositor catalog with its actual tick unit, refuses a
protocol proof naming another person before computation, and denies a malformed
preview before parsing when the read grant is absent. Unknown body authority
selectors refuse without reaching the engine. No SQL is exercised by this suite.

The test supplies explicit host authorization proof fixtures and uses the fixture
toolchain's pinned accepts parser. It explicitly selects the kernel Express shim
because that toolchain also contains Express. It does not simulate kernel
catalog/grant admission or establish installed data isolation. Those remain
separate required native and installed acceptance gates. Only owned runner/worker
children and ephemeral loopback listeners are used and closed.

```sh
OSHAL_KERNEL_ROOT=/path/to/oshal-kernel \
STORE_CI_TOOLCHAIN=/path/to/store-toolchain \
MOTION_ENGINE_BINARY=/path/to/reviewed-motion-worker \
node --test create/specs/functional-gaps/prototypes/motion-studio/tests/native-runner.test.mjs
```


## Genuine native SQL workflow acceptance

The source now includes a separate fixture built against the actual kernel
`control`, `packages`, `store`, `sdk` and observability crates. It admits explicit
fixture people through the real control door, links person-scoped storage, and
applies the exact native migration through `Host.schema_migrations`. Original
writer admission and source-digest receipts are enforced by the genuine adapter.
The production Node runner then hosts the unchanged Motion application routes;
every SQL frame reaches that original person's `CtxHost.sql_query`. Rendering
still uses the real framed compositor. This is neither PostgreSQL pretending to
be native SQL nor a replacement query interpreter.

Seven cases exercise native migration completion/replay and read-only provisioning
refusal; real create/edit/retry/stale/restore/reopen and middle-frame alpha128;
foreign read/change/export/delete refusal; direct queries isolated by subject,
issuer and package; forged owner settings; durable immutable triggers and
read-only write refusal; independent change/export/delete route permissions;
and native multipart photo import, masked byte-identical reopen rendering,
foreign source refusal, historical source protection and cascade/unused cleanup.
Identity and named-permission replies remain explicit fixtures. The kernel build
is dependent on the supplied checkout tree state, not a pinned kernel revision.
Cargo dependency pins do not pin that source tree. Actual installed
catalog assignments, application source admission and agent/bot execution still
need their own acceptance evidence before delivery.

Each fixture uses a uniquely named database on **shared disposable
PG127.0.0.1:35689 only**. Rust removes its database on normal completion; the
parent also cleans that exact name after startup errors or child failure. It
never drops another database or removes the shared container. Kernel role
convergence uses the production store contract on this disposable server. No
DSN is printed; a private credential file is required. The builder reads the
actual kernel Cargo pins/lock and writes only an isolated fixture/target under
/tmp; it does not edit the kernel or use its target directory.

```sh
OSHAL_KERNEL_ROOT=/path/to/oshal-kernel \
node create/specs/functional-gaps/prototypes/motion-studio/tests/native-host-build.mjs
OSHAL_KERNEL_ROOT=/path/to/oshal-kernel \
STORE_CI_TOOLCHAIN=/path/to/store-toolchain \
MOTION_ENGINE_BINARY=/path/to/reviewed-motion-worker \
MOTION_TEST_DSN_FILE=/path/to/private/disposable-pg35689-url \
node --test create/specs/functional-gaps/prototypes/motion-studio/tests/native-sql.test.mjs
```

Package extraction has small-source native SQL compatibility evidence and
human/engine source workflows only. Large assets and aggregate asset/revision
growth remain unproven; fixture-supplied admission/permissions and the unpinned
kernel build tree do not prove installed authority or performance. The extraction manifest/authorization, agent tool/persona and source Test Lab
contracts now exist below. It still requires actual registration and
container/install packaging, followed
by @admin's installation and installed human/agent acceptance. Durable exports,
larger owned transport, editable cross-app handoffs and the complete coverage
matrix remain required; passing this store workflow does not close those gaps.


## Reproduced native large-raster storage gap

The original six native workflow cases above use small raster sources. A separate real
boundary probe on ae268824 contradicted coverage of the declared 4 MiB normalized-image
limit: a genuine 1100×1000 PNG of 3,306,930 bytes uploads successfully, but its
4,409,240-byte base64 payload plus row metadata exceeds the native 4 MiB page
bound. Reading the accepted asset through the mounted native application then
returned 503. The follow-up now refuses such native uploads before insertion
with 413, the actual safe normalized-byte capacity for that row/account, and a
plain explanation in the workbench. It accounts for base64, escaped owner
metadata and bounded native envelope overhead. PostgreSQL source limits remain
unchanged. Seven real native cases now prove that refusal leaves list/read/delete
and another small upload usable. This transitional guard does not deliver the
full native 4 MiB target or an installed-ready durable storage contract. The probe cleaned its exact database and process children.

A reviewed original-caller binary/footprint adapter is required. Its consumer
must retain digest/length integrity, original owner and fresh source/grant
checks, immutable history references and atomic metadata/content lifecycle.
The existing 4 MiB image and 256 MiB library limits remain the target; reducing
them does not resolve this requirement. A chunked SQL design also needs proof
against native aggregate loading limits before claiming full library coverage.
The durable T10 kernel transport assignment is requested from @admin on
COLLABORATE, following @dispatch’s review; this lane retains the Motion consumer. Package installation readiness remains
open until accepted large assets can be read, reused and cleaned safely.


## Native aggregate growth remains open

@dispatch independently reproduced whole-collection loading costs: 2.7 MB
assets took about 1.4 seconds at one row and 8.3 seconds at six, then the seventh
timed out under the application 5-second statement timeout and list failed.
The declared 64 assets / 256 MiB library is therefore not reachable in the
current native document-backed design. The revisions table has the same loading
shape; 2 MiB documents across 1,000 revisions are untested and are not claimed
to work. The native-only upload guard prevents single oversized rows from
poisoning the library; it does not solve this aggregate problem. T10 durable
owned package assets and a tested revision growth strategy remain required.

The native SQL fixture now bounds stdout frames before UTF-8/JSON decoding or
whole-line buffering: 12 MiB for its Rust host, 16 MiB for the actual runner.
Oversized unterminated output, malformed UTF-8/JSON, primitive packets and
incomplete final frames refuse; only that fixture's owned child is stopped.
Outbound frames are checked too. Tests cover split UTF-8 and multiple packets.
This fixture correction changes no installed kernel host or package authority.


## Actual extraction and agent contracts

`package-definition.yaml` is the actual candidate manifest for extraction to
Motion Studio. It is deliberately named differently from `oshal-app.yaml` while
this directory remains a prototype: no new marketplace/catalog application is
registered or offered for installation from these files. The declarations load
through the genuine kernel importer. `authorization.yaml` defines six separate
roles and six project permissions, all own-scoped; HTTP, tool and bot bindings
are explicit. Every one of sixteen route tools binds exactly the permissions
of its HTTP route. Source write tools retain approval requirements; GET native
JSON export is still a writer operation because of its export permission.

The motion-editor persona is read by the real importer. It teaches the current
command schemas, actual ids/revisions, fresh-session selection, seconds versus
native tick units, UUID retries, approval results, immutable undo, owner/source
refusals and honest unfinished capabilities. It never claims a source declaration
or fixture is an installed acceptance receipt. Only actually offered runtime
tools may be used. No model/provider/endpoint is bound by the package.

The full pinned catalog measured 214,862 bytes with 423 commands, larger than
the kernel agent observation cap. The manual catalog remains intact; agent
contract supplies the complete compact id/label index and source limits below
60 KiB, and motion-command-schema fetches one exact real schema below the same
budget. Unknown commands and path traversal refuse. This prevents the initial
instructions from disappearing into an oversized observation. Full manual project documents can still exceed observations; agent reads/mutations
now return small receipts and complete immutable structural pages described below.
Installed acceptance of that flow is still required.

Eleven source contract cases use genuine kernel importer/schema/binding functions
and the native runner/SQL/compositor fixture: parsed roles/persona; withholding
unbound/different tool bindings; closed input and byte bounds; complete compact
index/exact schemas; mutation/export classification; real declaration-backed
create/add/read/keyframe/midpoint alpha128/restore/export/delete workflows; and
independent role permissions derived from the parsed catalog. The actual
framework Test Lab loader accepts all fourteen registered source recipes. Native
fixtures now use this real catalog and SDK HTTP resolver instead of a fabricated
view-only binding. Actor/role assignments remain controlled fixtures; the tests
do not execute the production API-tool offering, an actual approval card, a
hosted conversation or installed durable role admission. Those are required
separate acceptance gates, alongside T10 storage and revision growth.

```sh
# First build tests/native-host-build.mjs against the supplied kernel checkout.
OSHAL_KERNEL_ROOT=/path/to/oshal-kernel \
OSHAL_CORE_ROOT=/path/to/framework-source-with-catalog-loader \
STORE_CI_TOOLCHAIN=/path/to/store-toolchain \
MOTION_ENGINE_BINARY=/path/to/reviewed-motion-worker \
MOTION_TEST_DSN_FILE=/path/to/private/disposable-pg35689-url \
node --test create/specs/functional-gaps/prototypes/motion-studio/tests/package-contract.test.mjs
```

Next extraction requires reviewed source registration, engine container/build
packaging, the T10 owned binary consumer and tested revision growth, then
@admin's install and genuine human/agent acceptance. Durable export/cancel,
installed large-project workflows, editable cross-app handoffs and complete product-by-
product fidelity remain in the full goal. This contract checkpoint is not
READY TO DEPLOY and does not redefine completion around the tested examples.


## Complete large-project agent observations

`routes/project-inspection.mjs` returns complete bounded structural pages and
exact long-string/key chunks at an immutable revision. Numeric child paths avoid
unbounded JSON-pointer keys. Every object/array child remains discoverable;
preview prefixes are explicitly incomplete. UTF-16 offsets preserve surrogate
pairs and exact Unicode content. Agent new/edit/restore schemas require receipts,
so a saved large document cannot erase its own id/revision in an oversized reply.
The human editor still receives full documents. Read the receipt, inspect the
needed actual ids/properties, then edit against its optimistic revision.

Project metadata indexes use a collection stamp and refuse when metadata changes
between pages. History indexes use an immutable upper revision. Both source reads
cover declared1000 entries instead of hiding rows beyond100. Native aggregate
storage/performance remain separately unproven; complete metadata paging does not
prove1000 large native documents or revisions will remain usable.

Export receipts return exact digest/length and a protected immutable native JSON
download URL; no full JSON is sent through the agent observation channel. The
bytes stay revision-pinned after a new edit. Fresh original-owner export/read
grants still govern download, and sources remain references rather than a portable
bundle. Returning a link does not create a file or finish durable export jobs.

Eight component cases reconstruct a valid-size two-megabyte JSON document exactly,
including all children, long/escaped keys, prototype-shaped keys and Unicode
strings; inspect invalid offsets/nodes, surrogate boundaries and export receipts;
and recover1000 metadata entries within the60KiB budget while refusing stale
indexes. Eleven package/native cases include a real >64KiB text composition, exact
text recovery, a bounded agent layer addition and digest-identical pinned download,
plus another-owner and revoked-grant refusals. Explicit original-host small-source
seeding tests metadata/history visibility beyond100, not application write quotas
or full-size1000-revision growth. Actual production approval-card/hosted agent
and installed acceptance remain unverified.

```sh
node --test create/specs/functional-gaps/prototypes/motion-studio/tests/project-inspection.test.mjs
# Package/native recipe uses the same explicit fixture variables listed above.
```


## Source-built engine container

The source package now includes a digest-pinned official Rust1.99/Node24.21
multi-stage image, with the exact Cargo lock and upstream revisions. No engine
binary or third-party font binary is committed or published. Text uses the real
core's embedded Inter/JetBrains Mono/Noto Serif fonts; their pinned OFL license
texts and attribution sidecars ship under engine/licenses. The build retains
resolved dependency license/source metadata and available license texts under
/opt/motion-dependency-notices. These receipts identify the supplied texts, not
complete font/glyph or full product fidelity.

Compiled worker, bridge, consumer and image fingerprint the same ordered runtime,
packaging and notice sources with CRLF normalized. An image or installed package
from another source revision refuses. Source container self-test checks the exact
identity,423-command registry/timebase, real center alpha128 animation, masked
owned raster pixels and byte-identical native reopen, plus actual embedded-font
text rendering. A listening socket alone never proves readiness.

The compose service uses its own project and external installation network, no
host ports or host volumes, UID10001, read-only root, bounded /tmp tmpfs, no extra
capabilities, no-new-privileges, PID128 and default1GiB memory. The administrator
installer requires an explicit OSHAL_NETWORK, clears inherited compose variables,
pins -p, reads the project label back, and self-tests against the installed route
identity. It neither edits kernel configuration nor restarts the kernel. Kernel
OSHAL_PACKAGE_ENGINES mapping remains the installation administrator's step.
Unavailable/stale engine replies carry bounded route-owned administrator guidance
and expected hash; the human editor displays the plain detail, not a hardcoded
setup command or a raw engine error code.

```sh
# Source build only; never an installation or live restart.
docker build -t oshal-motion-review:source-packaging \
  -f create/specs/functional-gaps/prototypes/motion-studio/engine/container/Dockerfile \
  create/specs/functional-gaps/prototypes/motion-studio/engine
MOTION_ENGINE_BINARY=/path/to/reviewed-local-worker \
MOTION_CONTAINER_IMAGE=oshal-motion-review:source-packaging \
STORE_CI_TOOLCHAIN=/path/to/store-toolchain \
MOTION_TEST_DSN_FILE=/path/to/private/disposable-pg35689-url \
node --test create/specs/functional-gaps/prototypes/motion-studio/tests/engine-container.test.mjs
```

The container recipe runs the actual image in a uniquely named review container
with network=none, no host ports/volumes and a read-only root. It checks pixel,
source, font and dependency-notice results and deletes that exact container.
Separate mock-Docker cases prove installer decisions and wrong-project refusal;
they do not prove a host installation. Only @admin runs the actual installer,
configures the production relay or deploys. Motion remains a prototype candidate;
source image proof does not close durable storage/revision growth, original
installed admission/approval/hosted agent tasks, export/cancel jobs, editable
handoffs or full product coverage.


## Editable native file import and saved-project copies

The manual Import editable document form accepts a UTF-8 native JSON/.ecproj file
up to4MiB on disk, with the existing2MiB compact project bound enforced after
parsing and real engine validation. Original native compositions/layers/curves,
masks and source references remain editable. Photo references must resolve in
that same person's library; foreign, missing, external-URL or digest-mismatched
sources refuse. A file is not a self-contained portable bundle.

Duplicate composition and the approval-required motion-fork-project tool create
an independent project at revision1 from an actually read original-owned immutable
revision. They preserve document ids inside the new project, leave the source
unchanged and do not copy its whole history. Agent results are bounded receipts,
so even large documents remain usable through the existing inspection tool.
The human export now pins the displayed revision, matching the immutable agent
export link rather than silently exporting a newer concurrently saved version.

Both import and fork require view+read+create. The store keeps read and create
fresh through validation, idempotent retry, SQL writes and commit. Read withdrawn
after insertion rolls back project/revision/retry rows. Source tags are derived
from original file bytes or verified project id/revision and used only in retry
fingerprints, never for identity, grants or paths. Identical retries return the
same independent copy; changed source bytes/version/title with the same key refuse.
Each copy retains its own immutable source references, so deleting the original
does not make a still-referenced photo deletable.

Six source exchange cases exercise actual HTTP/Postgres and native kernel SQL,
pixel-identical import/fork and actual edited pixel changes, foreign/digest/UTF8/
size/authority-selector refusals, read withdrawal before and after insertion,
and real narrow-screen export download→file import→reopen→duplicate controls.
The genuine declaration-backed agent test copies a >64KiB native project with a
bounded receipt and separate read/create requirements. Original actor/role
admission is still a controlled fixture; no production approval card, hosted
conversation or installed package receipt is implied.

Portable source bundles, durable assets/history/export jobs, native aggregate
capacity, editable Video handoffs and installed full human/agent/product acceptance
remain required. This editable Motion-to-Motion roundtrip does not close the
cross-app coverage matrix.

```sh
OSHAL_KERNEL_ROOT=/path/to/oshal-kernel \
STORE_CI_TOOLCHAIN=/path/to/store-toolchain \
MOTION_ENGINE_BINARY=/path/to/reviewed-motion-worker \
MOTION_TEST_DSN_FILE=/path/to/private/disposable-pg35689-url \
node --test create/specs/functional-gaps/prototypes/motion-studio/tests/document-exchange.test.mjs
```


## Lossless native numeric transport

The prior9007199254740993 refusal is replaced by actual precise transport.
`tools/native-json.mjs` parses native integers outside JavaScript's safe range as
BigInt, serializes them as exact JSON numeric tokens and preserves large
floating/exponent token forms. It patches no global JSON or prototype. Worker
requests and replies cross engine.exchange as bounded opaque JSON strings, so
neither the Node bridge nor the outer kernel process frame rounds native values.
The Rust worker still applies its closed request/document/source/graph contracts.

The store reads document::text and parses it losslessly rather than receiving
already-rounded JSON objects. It stores the exact serialized native document,
uses those values in validation/retry hashes, and preserves them through fork,
immutable undo and export. Full HTTP results carry authoritative documentJson;
the old document field is retained for safe values and omitted for wide values.
The browser reads documentJson, holds precise ids internally and uses exact
commandsJson and decimal compId to edit them. Numeric conversions of ticks are
only for displaying seconds; stored ticks are not rewritten by that display.

Agent inspection reports type=integer, valueEncoding=decimal-integer and the
exact value string. Large floating literals use json-number-literal. The
approval-held motion-apply-exact-edits tool takes commandsJson and compId; it
uses the same own read/change HTTP permissions and optimistic UUID/revision
rules as ordinary edits. Legacy numeric arguments that would choose a rounded
wide id refuse; exact arguments are supported, not discarded. Ordinary safe
request/retry contracts remain unchanged.

The human saved preview now uses GET of a stored immutable revision with small
parameters. It does not upload the entire document or require POST writer
admission for a read-only viewer. The source declaration binds view+read; actual
installed Viewer/Reader authority remains an acceptance requirement. Legacy
preview input remains for existing callers. Large output streaming and aggregate
native storage still need T10.

Five codec checks cover i64/u64 endpoints, odd integers, large floating token
forms, prototype-shaped keys and exact agent pages. Three real workflow cases
exercise u64 ids near both2^53 and the u64 limit, odd i64 ticks, actual private
Postgres/native SQL, imported edit pixel changes, fork/restore/export, and a
412px browser import/render/edit/download/reopen. The exact tool is loaded and
validated by the genuine kernel parser; parsed Reader role can fetch saved
preview and cannot edit. Controlled source fixtures are not live role/approval
or hosted agent receipts. Source engine image must be rebuilt because bridge
fingerprint changed; only @admin installs or configures it.

```sh
node --test create/specs/functional-gaps/prototypes/motion-studio/tests/lossless-json.test.mjs
# Same explicit kernel/toolchain/worker/disposablePG variables as the prior suites.
node --test create/specs/functional-gaps/prototypes/motion-studio/tests/lossless-documents.test.mjs
```

Precise numeric transport closes this tested rounding defect. It does not prove
all upstream commands/formats/typography or complete Adobe fidelity. Durable
assets/revision growth, portable source bundles, export/cancel jobs, editable
Video handoffs and installed full product human/agent workflows remain open.


## Durable owned photo consumer (source, pending installation)

The extraction definition opts into `lastingStorage: true`. The administrator
must provide the kernel's existing package-private lasting directory; the
consumer takes its root only from `OSHAL_PACKAGE_DATA_DIR`. It obtains the
original sealed principal with `auth.caller`, whose production host admission
checks current source and original grant, and hashes package, tenant, principal
id, issuer and subject into a private namespace. Request fields cannot select
an owner, root, namespace or file. Named view plus read/upload/delete checks run
before and after I/O and on every 128 KiB chunk. These checks supplement the
kernel's package-only bind; they do not create a generic shared T10 provider.

New photo rows contain a UUID `blob_handle` and null `content_base64`, with an
exactly-one-storage check. Legacy inline rows remain readable. Images retain the
4 MiB normalized limit, 64-entry and 256 MiB metadata quotas. Private immutable
UUID files carry original bytes, exact length and SHA-256; file and directory
fsync finish before any metadata commit attempt. Owner-serialized native SQL
stores small metadata instead of base64 collections. Generic byte storage is
bounded at 64 MiB per object, independently of the lower photo admission limit.
Roots/namespaces must be real private directories; reads reject links, multiple
hard links, public files, wrong size and wrong digest. Missing lasting storage
refuses new native uploads and durable reads with 503, while metadata listing
and legacy inline reads remain available. New native uploads never fall back
to the aggregate inline design. PostgreSQL-only fixtures retain inline storage.

If insertion or fresh admission fails before COMMIT is attempted, rollback
removes only the exclusively created inode. Once COMMIT is attempted, bytes
are retained even when its response is uncertain: deleting them could destroy
a successfully committed asset. History-referenced photos still refuse delete
with 409. Unreferenced metadata deletion commits before private file removal;
failed post-commit cleanup returns `cleanupPending: true`. Process crashes and
uncertain commits can leave orphan files. Namespace accounting refuses new
writes above 320 MiB or 192 files, including orphans; this is a bound rather
than an automatic repair. Durable cleanup/reconciliation with live SQL and
installed crash testing remain open and must precede deployment approval.
The prototype's initial migration has changed because it is uninstalled;
existing installations would need a separate reviewed upgrade migration.

Tests use only private temporary directories and the shared disposable PG35689.
They exercise exact 64 MiB bytes, tenant/principal isolation, unsafe links,
corruption and mid-chunk source/grant withdrawal. The actual native runner
exercise fills all 64 slots with large real normalized PNGs (over 200 MiB),
reopens them after replacing the package process, checks foreign-owner and
Reader denial, and withdraws grants after actual SQL insertion to prove rollback.
The host fixture has controlled source and role admission; it is not proof of
an installed filesystem bind, hosted agent approvals or production crash recovery.

The earlier base64-row refusal and aggregate-photo findings describe the inline
storage path. The new durable source consumer addresses those photo limits;
large revision collections remain unchanged and require their own consumer.
Portable bundles, durable export/cancel jobs, editable Video handoffs, complete
upstream/Adobe fidelity and installed human/agent product coverage remain open.


## Durable revision consumer (source, pending installation)

Canonical lossless UTF8 revision bodies now use a separate private namespace
under the same trusted package lasting root. The namespace includes the original
sealed tenant/principal/issuer/subject and a source-owned revision purpose; HTTP
and agent inputs cannot select it. Photo namespace and handles stay compatible.
Native rows carry only `document_blob`, exact `document_bytes` and SHA256, with
null `document`. Checks allow exactly one inline legacy document or complete
immutable descriptor, and blob handles are unique. Private file reads verify
length/hash and strict UTF8 before lossless parsing. Legacy inline rows remain
readable, including exact numeric SQL text. Native create/save refuses missing
lasting storage instead of falling back to whole-document collections.

The existing 2 MiB document, 1000 project, 1000 revision and 256 MiB total revision
limits stay in force. Quotas sum exact durable bytes and legacy JSONB lengths.
New bodies are fsynced before insertion. The common transaction retains each
new inode once COMMIT is attempted; earlier failed inserts or withdrawn grants
roll it back. Reads use their original action (read, export, change, create or
copy), preserving named permissions throughout I/O. Project deletion commits
metadata and source-reference removal first, then removes only its private
history files; failed cleanup reports `cleanupPending: true`. History metadata
can still be listed when a current body is corrupt, so older undo data can be
read. Neither metadata listing nor an export may choose another original owner.

Photo and revision namespaces each have a 320 MiB physical bound including
orphans. Revision file-count accounting permits the declared project/history
cardinalities rather than inheriting the 192-photo-file recovery limit; byte
quota remains binding. Directory accounting streams entries instead of loading
a potentially large filename array. Crash reconciliation and repeated orphan
recovery remain required, along with installed filesystem/admission verification.
This prototype initial migration still requires a reviewed upgrade migration
for any preexisting installation. No installed or full-product claim follows
from passing the source storage tests.


The full-history source test creates a large canonical caption composition with
real engine commands, then explicitly seeds distinct verified private files and
native metadata up to revision 998 in bounded fixture batches. After replacing
the actual package process it reads current and old documents, exports exact
bytes, restores revision 1 through the real API to produce revision 999, makes a
real visible blue-layer edit to revision 1000, retries the same edit, rejects a
1001st revision, renders real blue pixels, checks foreign-owner and named Reader
refusals, and deletes all 1000 files after committed metadata deletion. More
than 120 MiB of document bodies are represented by less than 200 KiB of selected
native metadata. Separate actual insertion/withdrawal and lost-COMMIT-reply
cases prove rollback versus conservative retention. Corruption leaves metadata
history and earlier documents usable; unavailable storage refuses new writes.
This is cardinality and real-workflow evidence with controlled fixture seeding,
not 1000 hosted agent turns, all project/history combinations at once, or an
installed source/grant/filesystem/crash acceptance claim.


## Process-safe orphan reconciliation (source, pending installed acceptance)

Motion now holds an OS file lease across each original owner's SQL snapshot
and private-file publication: shared for reads, exclusive for writes/recovery. The builtin Node SQLite connection is
used only for its file-lock semantics: no user records, payloads or reference
metadata are stored there. The installed proof runtime is Node 24.21.0; source
installation must provide supported Node 24 with `node:sqlite`. The lock is a
private regular 0600 file in the same original tenant/principal/issuer/subject
namespace used for photos. It is never unlinked by the application. Concurrent readers coexist, including image thumbnails and metadata requests.
A publisher or recovery excludes overlapping readers/writers with 503
`motion_storage_busy`, plain retry detail and `retryAfterMs: 100`; different
principals lock separately.
Lock acquisition never blocks the Node event loop waiting for another holder.
Closing its connection or killing its process releases its lock.
A shared read lease cannot authorize reconciliation or publication. A tiny lock
file may be created as read bookkeeping; user SQL records are never written by
read routes. Private directory, symlink/hard-link, permission and lock-inode
checks run before admission to recovery and before metadata commit.

An admitted write begins its original-person SQL transaction and stamps exact
owner settings before reading live photo and revision UUID references. Under
the still-held lease it scans only that owner's photo and revision namespaces,
preserves every live handle and removes only unreachable UUID files. Source,
identity and named grants are checked freshly during removal, with inode and
link checks before unlinking and a directory flush afterwards. No mtime/age
heuristic, request-provided owner/root/reference set, or global filesystem sweep
is used. Photo handles are now unique in the initial prototype schema as well
as exclusively generated by source code. All production data writers must use
this store/lease protocol; controlled cardinality fixture seeding runs while
those application writes are inactive. Mixed unguarded writers are unsupported
and must not be introduced during integration or upgrade.

A crash during file writing or before metadata publication leaves an orphan
that the next admitted write reclaims. A crash after successful metadata commit
preserves its referenced file even when no reply reached the caller. A crash
after committed deletion leaves no ghost SQL record; the next admitted write
reclaims the unreachable old file. This completes automatic source recovery of
these known orphan cases rather than merely refusing at the physical bound.
Physical/quota bounds, exact digest/length checks, immutable historical source
retention and lossless numeric document transport stay in force. Unsafe locks,
links, replaced inodes or withdrawn authority fail closed. Read-only actors do
not run reconciliation; an admitted writer or deleter triggers it.

Tests SIGKILL only exact owned actual Node package children mid-photo chunk,
after revision fsync before insert, after real native metadata commit before
reply, and after committed history deletion before unlinking. They replace the
package process and prove orphan reclamation versus committed-byte retention,
source/grant and original-principal checks, independent owner locks and overlap
refusal. The Rust native test host is independent of those children; before-
commit crash cases explicitly roll back only the known aborted fixture SQL
connection to model host-drop cleanup. That seam does not prove the installed
host's disconnect/transaction cleanup. All private fixture directories and only
its unique database are cleaned; shared PG35689 and its container remain.

The full 64-large-photo and 1000-real-file history tests, exact native import/
fork/undo/export and real narrow human editing regressions remain required and
are exercised against this consumer. Installed sandbox/admission and host-drop
crash acceptance, whole project/history combinations, upgrade migration,
portable editable bundles, export/cancel jobs, Video handoffs and the broader
product-by-product parity matrix still require separate evidence. Source-only
crash recovery is not an installed or full-product completion claim.


Recovery also fences the database side of process death. A killed process may
have already sent COMMIT to a still-running host. The private file lease alone
cannot settle that in-flight transaction. Every guarded data writer therefore
updates the same exact-owner `motion_blob_epochs` row. Before reclaiming any
file, recovery begins a separate original-owner transaction, advances that
fence, reads all live photo/history references and commits the reference
snapshot. Only then may it unlink unreachable files under the exclusive file
lease. It starts the actual data transaction afterwards and advances the same
fence again before publication. This also allows recovery when orphans would
otherwise exhaust the physical write budget.

The native adapter compares all observed collection revisions when a commit
contains changes; the fence makes that comparison mandatory for recovery.
The real relational projection may instead block a newer fence on the old
publisher's row lock. Either ordering is safe: an unsettled old transaction
blocks recovery without removing its file, or a newer committed fence makes
the old commit conflict. An uncertain recovery-commit reply performs no file
reclamation. The delayed-old-COMMIT test kills the package child while the
original data commit is queued, keeps that exact host transaction alive,
starts a replacement and verifies the safe ordering through genuine native
SQL. In the observed row-lock ordering, the first replacement refuses within
its normal two-second lock timeout with the old file untouched; settling the
old commit and retrying preserves the now-referenced photo. This supplements,
and does not replace, the still-required installed host-drop acceptance.


## Portable editable archive services (source implementation)

`MotionProjectStore.exportBundleTo(id, revision, sink)` and
`importBundle(asyncByteSource, {requestKey, title?})` now implement portable
recipient-owned copies. These are trusted source service methods. They are not
new public HTTP bindings, installed agent tools or a claim that the kernel can
currently carry their full envelope. The generic exchange remains ephemeral
4 MiB per file/16 MiB per owner and the ordinary process response is 8 MiB;
current trusted large-artifact streaming is wired only to Video. A shared
original-reader provider/contract remains requested on COLLABORATE. No format
limit is reduced to make those smaller transports appear complete.

Version 1 is an uncompressed strict USTAR archive named `.motionbundle.tar`.
It contains `manifest.json`, `document.ecproj` and exactly its declared
`assets/<uuid>.png` members in manifest order. The closed manifest records title,
version and exact length/SHA256 of the native document and each normalized image,
including width/height. It contains no caller, tenant, owner, source authority or
filesystem root. Each file uses ordinary 512-byte tar headers/padding and the
archive has two zero end blocks; standard tar listing/read and independently
produced ustar archives are tested. Header structure follows the
[GNU tar format documentation](https://www.gnu.org/software/tar/manual/html_node/Standard.html).

The codec supports all 64 sources at 4 MiB each, the 256 MiB source budget and a
2 MiB native document within a 264 MiB whole-archive bound. Manifest is bounded
at 32 KiB, stream input chunks at 128 KiB and emitted payload chunks at 64 KiB.
No archive pathname is extracted to disk. Unknown names, directories/links,
sparse/PAX/GNU extensions, header/checksum/padding errors, reordered/extra
members, conflicting JSON keys, invalid UTF8, non-ASCII disguised header names,
oversized members and truncated/nonzero trailers refuse. Native document numbers
use the existing lossless codec; no integer bits are rounded. Raster magic,
per-member hashes and lengths are checked before trusted pixel decoding.
Container-capacity fixtures are explicitly opaque PNG-signature bytes; those
prove transport bounds, not valid image/model fidelity. The real store suite
uses actual decoded large PNGs separately.

Export captures the immutable revision and attachment metadata under the
original read/export permissions, shared owner file lease and SQL snapshot.
It verifies each real image and preserves every attached source, including
sources not yet placed on the canvas. It awaits trusted sink backpressure and
rechecks original authority before/after each chunk. Neither the sink nor input
source can select another identity, server path or URL; public transport must
supply them from its original admitted context.

Import requires view/read/create throughout parsing, validation and commit.
It computes an exact whole-archive digest for the request nonce, decodes every
real image, validates dimensions and generates new recipient-owned asset UUIDs.
Every native footage URI must match a supplied image/digest, then is rewritten
to the new id/normalized digest. Composition/layer/property ids, exact ticks,
masks, curves, keyframes and other native graph data stay editable. Trusted
compositor inspection runs before any insertion. Only footage used in the
native graph is supplied to the compositor; supplemental attached images remain
portable without inflating its separate current 6 MiB renderer-input ceiling.
That rendering ceiling is unchanged and is not full larger-graph parity.

A single original-owner SQL/file transaction checks complete project, asset and
revision budgets, writes every image and revision body, saves source references
and records the request nonce. Validation or withdrawn grants before COMMIT roll
back all new rows and only their newly owned files. Existing epoch/file fencing
and uncertain-commit retention/recovery apply. Same verified archive/title/nonce
returns its original snapshot with no duplicate assets; different intent refuses.
A copied recipient can keep editing after the original sender deletes the
project/images. Archive ids have no authority over the sender's data.

Tests transfer actual masked/keyframed footage with near-u64-max ids and odd
wide ticks between two genuine native original-person namespaces, compare real
rendered pixels, edit the recipient copy, exercise immutable source retention,
exact nonce retries and foreign-source refusal, and withdraw read during actual
asset insertion to prove atomic rollback. A real 64-large-PNG attachment library
(over 200 MiB) exports through a backpressured file sink and imports atomically
into the other owner without whole-archive buffering or reduced library limits.
SDK pool/SQL/compositor are real; grant/source admission in this direct-service
fixture is deliberately controlled, not production route admission, a hosted
agent turn, an approval card or installed transport. The human/browser and agent
regressions cover existing bindings; they do not advertise these new methods.
Protected source human/agent bundle transport is now connected below. Video mapping and installed cross-app
acceptance remain separate required integration work.

## Exact-tick render producer source checkpoint

`routes/render-export.mjs` supplies the trusted service
`renderExportTo(ctx, store, projectId, revision, options, sink, runtime)`.
The context and store must match the sealed original active
principal/tenant/issuer/subject. The service pins an immutable document and owned
photo bytes, checks current view/read/export grants before each frame and output
chunk, and preserves native composition data. Options are closed: `format`
(`png-sequence` or `mp4`), optional exact decimal `compId`, decimal-string
`startTick`/`endTick`, and `maxSide`. Multiple compositions require a selection.
The trusted sink/runtime are supplied by the host, never by request fields.

Frames use integer native ticks (254016000000 per second) and the composition's
rational frame rate. The private renderer's `time_ticks` argument bypasses floating
seconds, is exclusive with legacy `time`, and is accepted only by preview. The
legacy preview interface remains supported. The worker/source image must be
rebuilt to match `routes/engine-identity.json`; old workers fail the identity check.

PNG sequences are bounded USTAR archives with `render.json` and numbered frame
members, preserving alpha. MP4 is an actual fixed FFmpeg pipe encode, H264/yuv420p,
opaque with no audio; odd render dimensions are explicitly padded to even output
dimensions. Receipts include source package/project/revision/document digest,
composition ID, rational rate, exact range, frame count, rendered and output
sizes, byte length and output SHA256. PNG frames are lossless; H264 validation
uses decoded pixel tolerances. FFmpeg pipe/fragmentation behavior is documented
by [FFmpeg's format reference](https://www.ffmpeg.org/ffmpeg-formats.html).

This source profile caps the longest side at 4096, each PNG at 8 MiB, output at 264 MiB
and admitted producer runtime at five minutes. It remains subject to the existing
compositor graph/input/slot limits. Cancellation, timeout and error terminate
only this producer's encoder; fresh checks refuse withdrawn grants and context
changes. The trusted sink must settle its pending write on cancellation; this
service does not manufacture authority to detach a sink or retain an expired
request context. Partial output is not a completed artifact: publish only after a
successful receipt and discard incomplete output.

`tests/render-export.test.mjs` uses genuine native SQL/store/compositor and the
local FFmpeg/FFprobe tools with a controlled source/role fixture. A five-second
30fps clip produces 150 frames with real animated opacity, owned masked photo and
text; first/middle/last PNGs match independent previews, and MP4 decodes to the
expected frame count/timing and animation. A separate 30000/1001 clip verifies
fractional timing and 159x89→160x90 padding. Cancellation, deadline, export
withdrawal and a foreign-context/store pairing refuse success. The container
recipe also exercises the exact-tick request through the hardened private bridge.
Twenty-one source Test Lab recipes are registered; this is not installed coverage.

No public render route, agent export-job tool, durable queue or installation is
advertised by this checkpoint. Shared durable artifact/job admission, original
reader re-admission, human/agent progress/cancel controls, Video source-lineage
mapping, @admin installation and installed end-to-end acceptance remain required.
These producer checks do not establish full Motion/Adobe product parity.

## Saved layer organization, parenting and nested timing

The manual workbench now exposes layer rename/visibility/parent settings,
stack up/down, duplicate/delete with history, editable source-start/in/out
fields, and multi-layer precomposition. Check layers in the layer list, name the
nested composition, and optionally trim it to their visible range. The resulting
composition retains editable native layers and keys, opens for editing, and is
also selectable through the composition picker. Parent changes keep placement;
a dependent-parent choice gives a plain refusal. Timing uses the native command's
composition frame grid. Only changed timing fields are sent, preserving untouched
wide tick values and avoiding a save for an unchanged form.

Operations select stable native layer IDs explicitly in their atomic edit batch;
they do not depend on selection left over in a worker session. The existing
base-revision/idempotency/edit route and named change grant govern these controls.
Readers can inspect and preview but cannot use the write controls. Advanced numeric
command inputs use lossless native parsing, retaining wide integer IDs.

`tests/layer-workflows.test.mjs` exercises real browser/HTTP/Postgres/compositor
stack colors, parent compensation/following and cycle refusal, nested eased
opacity and source timing, save/reopen/history undo, narrow layouts, read-only
controls and untouched 9007199254740993 native ticks. A genuine native SQL/runner
case validates the existing exact-edit tool schema, obtains a bounded receipt,
reads the saved nested model and renders it through the Reader route; foreign
owners and withdrawn change grants refuse. Controlled fixture grants and source
admission remain distinct from installed roles, hosted agent approval and installed
acceptance. There are now 22 registered source Test Lab recipes, with the existing
sixteen tools and route/role bindings unchanged.

Shared full-envelope artifact transport, durable original-authority export jobs,
Video lineage, package extraction/admin installation, installed human/agent
acceptance and complete upstream/Adobe functionality remain open.

## Native effect controls and bounded agent schemas

The manual editor now reads the pinned engine's complete effect registry and
exposes saved effect selection, apply, typed scalar/popup/boolean/color/vector
parameters, enable/disable, stack order and removal. Parameters target actual
native property UIDs in the existing saved edit route. Only changed fields are
submitted: untouched colors keep their full numeric precision and existing keys
remain intact. Changing an animated property adds a key at the current composition
time; the form identifies its displayed stored base value. Complex path/text/gradient
values still use advanced editing commands. Full visual curve/path editing and
complete human coverage of every effect remain required beyond this checkpoint.

The complete human editing contract now includes native effect metadata.
`GET /effect-index/:stamp/:offset` supplies bounded pages of 64 entries;
start at `start/0`, then pin the returned registry digest and follow `nextOffset`.
`GET /effect-schema/:effect` returns a complete native parameter schema, including
bounds/defaults and zero-based popup options. Catalog point defaults may be
normalized; inspect an instantiated saved group's actual coordinates and property
UIDs before editing. Both routes require current `project.view`, do not accept
owner selectors, and query a genuine native empty project without reading or
appending customer project data. They re-use the private source-bound compositor;
no new engine transport, ABI, worker identity or host capability is added.

Two source read-only tools, `motion-list-effects` and `motion-effect-schema`, and
matching persona authorizations describe this workflow. They remain auto reads
on the existing view permission; actual edits retain read/change and approval.
The genuine kernel importer accepts 18 tools and 23 Test Lab source recipes. The
importer's supported schema bounds are used; route validation enforces exact
native effect identifiers and start/hex page stamps. Full registry inventory is
not a claim every effect, file-dependent option, GPU flag or floating-point output
has been verified on the installed renderer.

`tests/effects.test.mjs` compares the actual 306-entry registry with every schema
lookup (largest native schema about 25 KiB, complete response below 60 KiB), walks all
stamp-pinned pages, checks read-only tool classification and no customer project
writes, and refuses invalid/stale pages and withdrawn view grants. Real saved
browser workflows render gradient direction/colors, blur alpha fringes, a 50%
shadow outside source bounds and owned green-screen removal preserving red alpha 128.
Enable/order/remove/undo/reopen, native agent UID edits, foreign/withdrawn change,
color precision, timed effect keys and Reader controls are covered. Authority seams
remain controlled source fixtures; hosted approval and installed acceptance are open.

Full-envelope public archive/render transport, durable original-authority jobs,
Video source lineage, package extraction/admin installation and the full
upstream/Adobe product-by-product audit remain unfinished.

The native worker also validates file-backed effect parameters before rendering:
host paths/expressions are refused, supported inline LUT/shape text is retained,
and custom OCIO references require an owned asset adapter. String controls preserve
multiline inline data. A real saved inline LUT pixel test and host-path refusal
with no revision protect this boundary; no filesystem capability is granted.

The Add layer form also creates a full-composition background with actual native
canvas dimensions. A saved edge-to-edge gradient test verifies both corner colors
and opaque coverage; it remains an editable layer/effect rather than a flattened
background image.

## Exact keyframe inspection and visual paths

The timeline now exposes individual key buttons. Selecting one reads the actual
immutable native key, layer/composition timing, temporal/spatial metadata and
before-expression curve samples. The editor changes its value/time/interpolation,
deletes it with history, displays its native layer XY path and saves dragged key
positions. Spatial handles use the core's resolved tangents; manual changes retain
the opposite resolved side before disabling automatic handles. Native roving
retiming remains the core's operation. Linear, hold and easy ease use the real
native commands after exact selection. Standard transform/add-key forms are
disabled while an exact key is selected; close the inspector to use frame-grid
controls. Pointer coordinate conversion uses the actual SVG screen transform.

Four implemented package adapters, not fictional upstream commands, are declared
in the command catalog: `keys.inspectExact`, `keys.selectExact`, `keys.addExact`,
and `keys.patchExact`. Their layer/property/time references are exact decimal
u64/i64 strings. They operate on the real pinned Project/Keyframe/Session, preserve
untouched metadata, use core undo history, refuse collisions/locked or static
writes/unknown fields, and never round selection through floating seconds.
The native format remains unchanged. A value patch retains existing easing;
retiming and native roving rules are explicit. Full visual editing for every
complex key value and all curve modes remains broader fidelity work.

Read-only original-owned routes are now:

- `GET /projects/:id/revisions/:revision/keyframes/:compId/:layer/:prop/:timeTicks`
- `GET /projects/:id/revisions/:revision/preview-ticks/:timeTicks/:compId/:maxSide/:transparent`

Both require current view/read. The new `motion-read-keyframe` source tool is an
auto read; existing exact edit tools still require change and approval. Inspector
references/times use decimal strings (`keyTimeEncoding=decimal-i64`). Numeric
samples come from native interpolation before expressions; the path window
reports its offset/total/completeness, with 64 points around the selected key.
Large key values explicitly set `valueComplete=false` and supply the existing
revision-pinned document inspection instructions instead of presenting truncated
values. Source scopes are not an installed authorization claim.

Actual source tests verify adjacent 9007199254740992/9007199254740993 ticks and wide
u64 layer/property ids, bounded large-text keys, scalar cubic opacity, spatial
cubic samples and rendered pixels, native undo/collision/locked behavior, saved
manual drag/edit/delete/reopen/history, Reader controls and stale key-read/drag
fencing. The native inspector and renderer share exact tick values. The rebuilt
worker/image must match the new engine source identity; old workers fail closed.
There are nineteen source tools and twenty-four Test Lab recipes, pending genuine
hosted approval, package extraction/admin installation and installed acceptance.

Shared full-envelope transport/upload, durable original-authority export jobs,
public exports, editable Video lineage, complete product-by-product fidelity and
installed end-to-end workflows remain open.

## Saved work-area preview

The manual workbench now offers Play/Pause, Loop, Previous frame and Next frame
for the native composition's saved half-open `work_area`. The work-area form
uses existing `comp.workArea` edits and immutable revisions; reopening and undo
preserve the native range. It sends only changed seconds fields, so opening or
submitting an unchanged wide-tick range does not round its stored endpoints.
Native editing still orders the range to cover at least one frame.

Playback starts at the saved work-area start. Frame `i` is rendered at
`start + floor(i * ticksPerSecond * rate.den / rate.num)`, before the exclusive
end, through the existing owned exact-tick preview route. Controls retain native
wide ticks and fractional tick frame spacing. Only one playback frame is requested
at a time; no frame cache or export is created. Pacing waits for each actual PNG
and may be slower than real time. This is manual native preview, with no AI
provider required and no real-time performance claim.

Pause, edit, composition/project changes and hidden tabs abort the playback
request and invalidate late responses. A resumed run waits for the previous run
to settle. Reader roles may preview and step without change/export grants; saving
a work area retains the existing change approval. The server rechecks the
original owned read grant on every frame, including the frame after withdrawal.
The browser's initial permission display is not continuing authority.

Seven real browser/native-SDK/SQL/compositor cases cover native alpha pixels, saved ranges,
reopen/undo, wide ticks and 29fps nonintegral tick steps, unchanged-save behavior,
one in-flight frame, loop/pause, held-frame project switching, read withdrawal,
Reader controls, hidden-tab stop, narrow layout and the declared approval-bound
agent work-area edit with original Reader/foreign/withdrawn admission. Test Lab has twenty-five
source recipes and the same nineteen tools/bindings. Source fixture admission
remains explicit; installation, hosted agent acceptance, full public transport,
durable export jobs, Video lineage and whole-product parity remain open.

## Exact native caption typography

The manual caption panel edits multiline content, actual runtime font family/style,
size, fill/stroke and alpha, spacing, alignment/direction, paragraph boxes and
character flags through the real pinned TextDoc model. Creation now respects the
chosen text color and multiline content. The panel reads native text at the exact
composition playhead; native layer start/stretch mapping determines local key time.
Changing only one field preserves all other attributes, runs, paragraphs and keys.
Reader content stays copyable while writes remain disabled. Font choices come from
`text.fonts` in the actual worker; unavailable stored choices are retained with a
fallback note. This inventory does not prove installed host/image availability or
every glyph/font family's fidelity.

Two implemented package adapters, `text.inspectAt` and `text.patchAt`, use decimal
u64 layer ids and nonnegative i64 composition ticks, the native Source Text property,
TextDoc methods and Session::edit/core undo. The patch accepts supplied native
attributes and optional `[start,end]` Unicode scalar ranges. Browser textarea UTF-16
selection offsets are converted without splitting surrogate pairs. Replacement
inherits native formatting; unrelated character and paragraph styles remain intact.
Unknown attributes, invalid ranges, no-ops, non-text and locked targets refuse.
Explicit fill/stroke enable flags apply after native color/width side effects.
The adapters are declared as package implementations, not upstream registrations.
The complete command inventory is now429 (427prior plus2native text adapters).

GET `/projects/:id/revisions/:revision/text/:compId/:layer/:compTimeTicks/:detail`
requires existing view+read on the original-owned immutable revision. `full` supplies
the complete typed native text for the human panel, bounded by the existing2MiB
native document profile. `bounded` supplies complete values up to32KiB; larger values
identify `valueComplete=false`, exact sourceKeyTimeTicks/valueBytes and the existing
revision-pinned document inspection. The response never pretends omitted text/styles
are complete. Observation is source text before expressions; an expression may
change the final rendered text. Exact playhead ticks survive manual save and undo.

GET `/font-index/:stamp/:offset` uses existing view only and returns at most64actual
families/styles per page, under60KiB, with explicit total/nextOffset/complete and a
native inventory digest. Start with `start/0`; stale digests refuse409. The two auto
read tools, `motion-read-text` and `motion-list-fonts`, bring the declared source tools
to21. Text edits use the existing approval-held motion-apply-exact-edits tool and
unchanged view/read/change roles. Test Lab has26source recipes, including actual
manual/native SDK text workflows. Native fixture roles/source seams remain explicit;
these are not installed approval or hosted agent receipts.

Source coverage includes native glyph color/alpha/paragraph pixels, save/reopen/undo,
Unicode replacement/style preservation, exact neighboring wide ticks and layer-time
mapping, full human/bounded agent large text, original Reader/foreign/withdrawn grants
and stale inspection fencing. Four additional Rust cases exercise native undo,
Unicode ranges, wide keys/timing and refusal/explicit stroke-disable behavior. The
rebuilt source review image exercises the same text adapter and actual bundled font
glyph pixels under no-network/readonly/nonroot/capless confinement. Installation,
full transport/durable jobs/Video lineage, performance across all combinations and
whole upstream/Adobe product fidelity remain open.

The large text proof retains all60000letters in a66000character paragraph with an
explicit300x160box and native single-line composer. The optimized source-built worker
renders its actual visible glyphs in about1.4seconds in the isolated source fixture;
this is not a deployed-host/client performance guarantee. A small content change
uses a minimal native Unicode replacement range instead of resending the full body,
preserving surrounding formatting and existing edit packet limits. The complete
text remains in the immutable document. Before the full-surface fix below, point-text bounds and debug-worker
performance showed separate fidelity failures: the original unbroken60000letter,
1px point-text probe produced an empty native preview in the optimized worker and
exceeded45seconds in debug. The bounded paragraph proof does not establish that
oversized point-text case or all large-layout combinations.

Textareas display normalized line endings. The native range mapping also accounts
for imported CRLF, so typography-only changes and small edits preserve untouched
native line endings, Unicode characters and formatting. Nine text workflow cases
cover these paths, including a66000character caption change that sends less than
1KiB of edit data while retaining the full document.

## Full point-text source surfaces

The exact60000unbrokenletter,1px point-text reproduction now renders visible glyphs
without changing its text, font, layout, project or revision. Its optimized source
preview takes about3.5seconds in the disposable native fixture; this is not an
installed-host/client performance guarantee. Text geometry beyond±20000also renders
through native transforms. Source inspection, saved alpha edits, restore/export and
Reader/foreign/withdrawn grants remain intact.

The pinned renderer intersected glyph bounds with[-20000,+20000], then clamped its
raster width/height to16384. For centered long text this lost the source region that
belongs on canvas. The documented local `effectcraft-render` derivative removes those
coordinate and side clips and allocates the complete native glyph surface when its
pixel area is within33,554,432pixels (512MiB of premultiplied RGBA f32). Full dimensions,
padding and offset retain the original geometry. Nonfinite/overflow/overbudget bounds
set a refusal marker before allocation and skip masks/effects on the placeholder;
the one-request worker rejects the whole frame as `motion_text_surface_limit`.
A refused render never claims a complete clipped/empty PNG. Library requests are
serialized around the marker; production already uses one isolated child per request.

All44original render files are retained from the same67434e9revision.39remain byte
identical; the standalone manifest, text surface sizing, early source refusal and
native raster tests and explicit synthetic full-width cache-key fixture are the five documented changes. Both license texts, original
checksums and changes are retained in `engine/vendor/effectcraft-render/UPSTREAM.md`.
Cargo patches all uses of this crate; all other dependencies keep the original pin.
The container dependency index records the exact upstream origin, `modified=true`,
changes and license texts. Source identity binds every derivative source and license;
`upstream` remains the base revision and catalog metadata names the render derivative.
There are still21tools and429commands; Test Lab now has27source recipes.

Native proofs include complete wide dimensions, finite/overflow/area checks and a
wide text surface whose visible pixels match an independently drawn viewport using
the native glyph geometry. Actual route proofs retain the original60000letter point
caption, large source-coordinate transforms, immutable data, alpha/history/export,
original grants and explicit refusal followed by a valid render. These replace the
previous empty-frame result for the reproduced2Dpoint-text case within this source
profile. The per-character3Dside-clipping follow-up is documented below; other source/effect allocation limits, debug
performance, all large-layout combinations and whole upstream/Adobe fidelity remain
separate requirements. Full transport/jobs/Video lineage and installed acceptance
remain open; no source image or derivative test proves those gates.

## Reviewable native extraction candidate

`node scripts/prepare-native-candidate.mjs <new-private-output-directory>` prepares
an entire Motion package at `<output>/motion-studio`, with a real `oshal-app.yaml`,
source-layout-correct tests/docs and a separate `candidate-receipt.json`. It does
not register, install, reload, deploy, start a container or alter host configuration.
The output root is private0700; source files have standard0644/0755modes so the
reviewed nonroot image can read its sources. The same complete engine bytes retain
the current worker identity; extraction does not require a different compositor.

The receipt records every file's digest/size/mode and an aggregate tree digest,
base source Git commit/dirty status, exact engine identity, explicit `installed:false`,
installation prerequisites and the remaining full-goal gates. Repeated preparation
from the same source is deterministic. Existing destinations are never overwritten;
source links/nonregular files/runtime secret/log data and source mutation during
preparation refuse. Only the newly created private output is removed on failure.
Caches/generated dependency directories are excluded; no source implementation,
authorization, tool, migration, font/license provenance or native project is omitted.

Actual importer proof verifies all21route tools, original own roles/persona and native
migration in the extracted candidate. Actual candidate-owned Node/native-SDK/scoped
SQL/private engine routes create/save/reopen/render an editable caption and reject
foreign/read-withdrawn/change-less callers. These are source proofs with the existing
explicit fixture authority seams; they do not prove live deployment, hosted approvals
or installed access. Test Lab now has29source recipes and the same21tools.

@dispatch reviews the concrete candidate receipt; only@admin performs source
integration/registration/installation and host changes. The administrator must provide
the supported Node24/node:sqlite runtime, managed pinned Sharp dependency, private
lasting directory, matching admitted engine relay and real schema/auth/tool admission.
No credentials are included in the source receipt. Public full-envelope streaming,
upload/export interfaces, durable original-authority render jobs, editable Video
lineage and installed human/agent/source/grant/sandbox/host-drop acceptance remain
required, alongside the full upstream/Adobe product matrix. A correctly extracted
package is not proof those gates have been achieved.


## Saved native mask controls

The manual workspace adds rectangle/ellipse masks and selects saved masks by their
exact native UID. Name, mode, inversion, enable, feather, opacity and expansion
use existing native operations; unchanged fields issue no write. Static native
Bezier paths expose per-vertex positions and incoming/outgoing tangent offsets,
keyboard-selectable path points, segment splitting, vertex deletion and closing.
Duplicate/order/remove retain immutable history; mask and layer locks disable
manual mutations. The same approval-held `motion-apply-exact-edits` tool performs
these native commands without new permissions or bindings.

The panel shows evaluated native values at the current exact time before
expressions. It requires the current immutable revision/time inspection before
saving. The exact-time adapters below handle animated values and retain native
key metadata; an expression may change rendered values. Geometry is shown in
layer coordinates with native cubic tangents.

`tests/mask-workflows.test.mjs` exercises actual browser/native SQL workflows,
rendered alpha and feather fringes, geometry/history, wide UID preservation and
original Reader/foreign/withdrawn checks. Source fixture role/admission seams
remain explicit. Test Lab has30source recipes,22tools and431commands.
Installation, full artifact transport/jobs, editable Video lineage, installed
human/agent acceptance and whole-family fidelity remain required.


## Exact-time native animated masks

`mask.inspectAt` and `mask.patchAt` are package adapters over the pinned native
Session, Property and existing mask commands. Decimal exact references and
composition ticks retain native layer-time mapping. The wrapper sets the native
session Tick directly for these operations because `Session::set_time` snaps to
frames. Reads use native `value_at`; edits use the core's mask implementations,
`set_value_at`, interpolation, key metadata preservation and undo. Locked layers
or masks, malformed/ambiguous references/keys, unsupported operations, forged
selectors, static-only targets and complete no-ops refuse.

The human panel now shows native current-time path/feather/opacity/expansion
values, can begin path animation with `keys.addExact`, and saves points/tangents,
splitting/deletion/closed geometry and settings at the same exact tick. Native
constant vertex count is enabled and reported: topology edits synchronize counts
across other path keys, as the core does. Value edits preserve other keys. An
expression may change rendered values; inspection and edits are before expressions.
Read stamps include project/revision/comp/layer/mask/tick, and old reads are
aborted/fenced on time/project changes. Mutations require the current inspection;
playback disables these controls. Save and undo preserve the selected exact tick.

Owned immutable GET `/projects/:id/revisions/:revision/masks/:compId/:layer/:mask/:compTimeTicks/:detail/:offset`
uses existing view/read. `full/0` supplies complete human geometry; the new auto
`motion-read-mask` tool uses `bounded/{offset}` and returns actual evaluated
64-vertex/tangent and 64-feather-point pages with explicit totals/next offset.
All pages pin the same revision and exact tick; agents must fetch all needed
pages, never infer geometry from base values or a partial page. Existing approval-held
exact edits perform writes; no new permission, role, or approval ceiling.

Source Test Lab has30recipes,22declared tools and431commands (429previous plus
these two real owned adapters). `tests/animated-mask-workflows.test.mjs` and native
unit/container proofs cover actual interpolated values/pixels, exact wide neighbors,
layer-time mapping, preserved keys, history and original Reader/foreign/withdrawn
grants plus held read fencing. These remain source fixtures with explicit
role/admission seams, not installed hosted approval evidence. Full artifact
transport/jobs, editable Video lineage, installation and whole-family fidelity
remain required.


## Full per-character3Dglyph surfaces

The retained native renderer formerly silently side-clamped each character plane
to4096pixels. `per_char_planes` now keeps full native glyph dimensions, offsets
and character matrices when the source fits the32MP f32 profile. It preflights
the sum of all live glyph surfaces for a text layer before allocating any image.
An invalid, overflowing, individually oversized or aggregate-overbudget set flags
the existing whole-frame `motion_text_surface_limit` refusal. It cannot return a
successful partially clipped set of planes. Catalog metadata reports the same
`perCharacterTextSurfacePixels` limit. This is a concrete source memory profile;
other layers/effects/3Dfeatures, many-glyph performance and all-font/hardware
fidelity still require verification.

The human caption panel has a Per-character3D switch backed by the existing
`layer.enablePerChar3D` command, also available through existing approval-held
agent edits. Native enablement makes the layer3D and upgrades existing animators;
disabling character3D leaves the native layer3D switch as the core does. It retains
caption content/styles/keys and immutable save/reopen/undo. Current-revision render
refusal hides the previous preview and clearly states that preview is unavailable;
stale or aborted failures cannot hide a newer workspace frame.

Native large-glyph pixels beyond the former cap match an independently rasterized
viewport from the same real native outline; full renderer tests run serially so
the request-scoped refusal marker is cleared between their independent proofs.
`tests/per-character-text.test.mjs` and the hardened source image exercise the
actual6000px glyph scaled into the canvas, a complete native flat-plane reference,
individual/aggregate refusal and next-request recovery, human toggle/history and
original Reader/foreign/withdrawn checks with real animation alpha. Licenses,
original upstream checksums and dependency pins remain unchanged; derivative
notes/BOM honestly cover the same five modified retained files. Per-character and flat text keep their native
sampling strategies; their antialiasing boundaries may differ. Adaptive sampling
with character transforms/camera perspective remains a separate fidelity gap.

Source Test Lab has31recipes, the same22tools/431commands. These are source
fixtures with explicit role/admission seams, not installed hosted approval receipts.
Installation, shared full-envelope original-reader transport/upload/jobs, editable
Video lineage, installed human/agent/host-drop acceptance and whole-family
upstream/Adobe fidelity remain open.


## Exact-time native variable mask feather

The saved-mask panel adds/selects/edits/removes actual native feather points by
segment, curve parameter0..1, signed radius and tension percent. Positive radius
softens outside and negative radius softens inside. It reads the current native
path inspection, converts stored normalized tension to/from the native percent
command parameter, and sends only changed fields. Reader/locks/playback or a
stale project/revision/mask/tick observation disable/refuse writes; native undo
and saved/reopened data remain editable.

`mask.patchAt` now admits the existing native `mask.featherPoint.add`, `.set` and
`.remove` implementations at the exact native session Tick. Parameters stay
closed and original layer/mask targets are inserted by the adapter. Add uses
segment/t or nearest point; set supports native index/segment/t/point/toward/
radius/tension; remove uses index or `{all:true}`. Forged selectors, invalid
indices/positions/tension, nonfinite radii, ambiguous add/remove targets and
empty set changes refuse. The native core owns contour positioning, radius
interpolation, rendering and path-key metadata. No JS feather shader, shape
substitution or wider permission is introduced.

Existing full/paged native mask reads provide actual evaluated feather data.
The agent uses the same original-owner immutable pages and existing approval-held
exact edit tool;70real points roundtrip through64+6point pages. Native stored
empty feather vectors may be omitted by serde; consumers treat omission as an
empty vector, not invented points. `tests/variable-feather.test.mjs`, native
units and hardened image proof exercise actual inner/outer alpha fringes,
normalized tension, native remove/topology/history, exact wide neighboring keys,
current playhead and Reader/foreign/withdrawn guards. Explicit fixture admission/
role seams remain source evidence, not installed approval receipts.

Source Test Lab has33recipes and the same22tools/431commands/auth/route/bot
bindings. Installation, full original-reader artifact transport/upload/jobs,
editable Video lineage, installed human/agent/host-drop acceptance and whole-family
upstream/Adobe fidelity remain open.


## Request-owned portable transfer staging

`routes/bundle-transfers.mjs` now stages complete editable archives in a private
package-data namespace sealed to the original tenant/principal/issuer/subject.
Construct it and its project store on each fresh admitted request. Import requires
view/read/create; export requires view/read/export. Authority is checked for each
128 KiB disk chunk, and downloads re-read the original immutable source before
and after the bounded payload read. Deleted or withdrawn sources yield no bytes.

Uploads accept at most 1 MiB per request, preserve acknowledged offsets across
restarts, compare exact duplicate retries and reject overlapping/conflicting
chunks. Unknown metadata replies preserve published data; unpublished tails are
replaced on the next admitted append. A stable private OS lease serializes both
processes. Complete import validates the archive digest and uses the existing
atomic recipient-owned copy and idempotency key; an uncertain SQL COMMIT reply
retains staging for a safe retry. Cancel removes staging, not an imported project.

The full 264 MiB archive envelope remains available, with two sessions per sealed
owner and a one-hour lifetime. Export reads align to independently verified 1 MiB
segments. The source tests stage all 64-by-4MiB codec sources plus the exact 2MiB
document without buffering the archive, copy real native captions/masked raster
with identical pixels and independent ownership, and exercise large valid PNG
segments, interrupted producers, foreign/withdrawn grants, unsafe files, process
locks, unpublished tails and uncertain metadata/COMMIT replies. Opaque capacity
fixtures establish storage bounds; they do not establish image/model fidelity.

The subsequent source HTTP/tool/human bindings are described below. Worker
identity is unchanged and installed behavior remains unverified. Source Test Lab
has 35 recipes; installation, durable jobs, editable Video lineage and
installed human/agent/approval/source/grant/host-drop acceptance remain open.


## Human and agent portable bundle controls

The editor's Editable project bundles panel imports a complete archive or uploads
it for an agent to finish. Export bundle pins the displayed revision and includes
all attached owned photos. Agent-prepared links open Download prepared bundle.
The client checks every chunk and the complete archive digest before offering a
file. Uploaded copies have new recipient-owned photo ids and preserve native
captions, masks, curves and editable revisions. Cancel removes temporary staging
and preserves saved compositions; in-flight requests may settle before cancellation
can acquire the source lease, and unknown replies resolve using the same retry key.

Each human upload request carries at most1MiB binary bytes. Download replies carry
at most1MiB bytes as canonical base64 with digest/offset metadata in JSON; the actual
native bridge preserves this representation but discards custom headers. Full264MiB
archives remain available. Browser WebCrypto uses a bounded whole-file digest
buffer, and the Blob download fallback holds the bounded full archive; installed
browser/device memory and host-drop acceptance remain separate gates.

Eight additional original route tools expose export/begin/chunk/import/status/cancel
with bounded receipts. Agent chunks contain at most8192actual bytes, fitting the
16KiB tool argument ceiling. Large human uploads yield an actual staged id for the
agent's approval-held finish operation. Six new mutation tools ask for approval;
two metadata status tools retain existing auto read behavior under their original
create/export grants. All existing permissions/roles/scopes remain unchanged.
There are30bound source tools and35source Test Lab recipes; native command count
remains431 and the engine/image identity is unchanged.

Public source HTTP, UI and agent declarations are now connected. Source fixtures
use actual native SDK/SQL/HTTP codecs and renderer with explicit role/admission
seams. They do not prove hosted approval or installation. Native artifact-adapter
automation for large agent-only files, durable rendering jobs, Video lineage,
installation and all installed/product-by-product acceptance remain required.


Full source human library measurement on this ARM64 host:64valid PNGs of
4,185,864bytes each produced a267,973,120byte portable archive
(~255.6MiB). Actual protected native export plus verified browser download took
94.16s; upload plus atomic recipient import took78.89s.
The owned Chromium process tree peaked at1.66GiB RSS,
sampled every100ms. This measures the actual bounded whole-file WebCrypto/Blob
client fallback, not installed device or worker/container memory. A browser with
approximately2GiB available for this full library profile is required; smaller
device profiles need streaming digest/save support rather than reduced data
limits. All64photos remain recipient-owned, original ids are remapped, and the
native caption pixels match the sender. Source cardinality seeding and role/
admission seams are explicit; hosted approval/installation remain unproven.


## Streaming client checksums and verified file saves

The browser hashes uploads through1MiB Blob slices with incremental SHA256;
no whole-file input buffer is requested. Downloads hash each segment and the
complete archive while receiving bytes, and canonical base64 decoding now uses
one output array instead of per-byte iterator allocations. The ordinary Blob
fallback still provides verified downloads on browsers without a file picker,
while avoiding the former full-archive verification buffer. Full264MiB capacity,
64x4MiB sources, exact2MiB native documents and original grant/source checks remain
unchanged; this does not lower limits to obtain a passing memory measurement.

Where the browser exposes the File System Access picker, Save bundle to file…
lets the person choose a destination during that click's user activation. The
client writes verified chunks to its native writable stream and closes only after
the complete archive digest matches. Refusal, corruption or cancellation before
commit aborts temporary writes. A close failure is reported, rather than treated
as confirmed saved output. No server path or filesystem privilege is supplied by
the request. Existing source authority checks still apply to every fetched chunk.

The checksum implementation follows [NIST FIPS180-4](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf)
and is differentially tested against native crypto, including padding boundaries,
typed views, randomized chunking and all264MiB of streamed data. Native browser
writable commit/abort follows the [File System Standard](https://fs.spec.whatwg.org/);
picker availability and activation come from [File System Access](https://wicg.github.io/file-system-access/).
Tests use real browser file handles/writable streams with an explicitly controlled
picker returning a fixture handle, not an installed native dialog receipt.
Corrupt segments/whole digests, source withdrawal and cancellation preserve the
existing fixture file; no failed transfer reports a saved file. Actual input
hashing never requests a whole-file buffer and fallback bytes remain identical.

Same30source tools/431native commands/permissions/roles/auth/bot/route bindings,
37source TestLab recipes; only the added named checksum static module is served
under the existing view-assets binding. Engine/image identity is unchanged.
Installation and native dialog/device acceptance, large agent-only artifact
adapter, durable render/export jobs, editable Video lineage and all-family
upstream/Adobe fidelity remain open. The current kernel package background-run
port only resumes bot_turn/bot_node and diagnostics; it cannot provide Motion's
engine/SQL/identity continuation. That provider requires coordinated ownership,
not retaining a request context after its authority expires.


Repeated full-library source measurement retains the same267973120byte archive
and64actual4185864byte PNGs. Peak owned Chromium process-tree RSS was
1280920KiB (1.22GiB) for the
verified Blob fallback and1017228KiB
(0.97GiB) for the real native writable-stream path,
compared with the prior1743424KiB (1.66GiB) whole-file
hash implementation. Both complete recipient imports retained all64remapped photos
and identical native caption pixels. These are two source fixture runs sampled
at100ms, executed concurrently on this host; they do not establish installed
low-memory device support or a universal performance bound.

Fallback export/download took85.620s and upload/import
86.895s. Stream save plus bounded fixture file transfer took
96.690s and upload/import91.694s. The stream
picker is explicitly controlled to return a real browser filesystem handle; the
native writable commit/abort and source SDK/SQL/HTTP are actual, while the installed
OS save dialog remains unverified. Measurements are in the retained source review
artifacts named motion-full-human-stream-fallback-measurements.json and
motion-full-human-stream-save-measurements.json. Blob fallback still retains the
bounded archive; unsupported file-picker devices do not gain a disk stream by
assumption. No smaller image/library/archive limit or renderer approximation was
introduced, and all installed/product-by-product gates remain open.


## Exact native scene properties and3Dcontrols

`properties.inspectAt({layer,compTimeTicks})` reads original transform,
cameraOptions and lightOptions leaf values at the exact native layer time.
Layer/property ids are decimalu64 strings and composition time is an exact signed
i64 tick string. The observation reports actual property ids, paths, names, types,
native UI metadata, key counts, static flags, locks and expression flags. Values
are explicitly before expressions; they are not inferred from time-zero base data
or claimed to be the expression-modified rendered values.

`properties.patchAt({layer,compTimeTicks,changes:[{prop,value}]})` admits only
returned leaf targets in those native groups. Inputs are closed; duplicate targets,
missing/foreign properties, nonfinite/invalid values and locked layers refuse.
Changes are prevalidated, retain the core's type coercion/slider rules and use
native prop.set without a floating time parameter: exact session Tick and native
layer_time reach set_value_at. Existing replacement keys preserve interpolation,
easing, spatial handles and labels. Unchanged values report changed:false without
creating history; unrelated axes/properties are untouched. The adapter restores
the previous native playhead and does not alter document formats or upstream
renderer/host algorithms.

Protected GET `/projects/:id/revisions/:revision/properties/:compId/:layer/:compTimeTicks`
requires original own project.view/read. `motion-read-properties` is the matching
bounded read-only agent tool. Mutations use the existing original change/ask
exact-edit route/tool. The human editor reads this same pinned revision/time,
disables stale/held/playback/Reader/locked edits, and sends changed fields only.
IndependentXYZposition/scale, XYZrotation/orientation and opacity preserve native
values. Explicit Link X/Y scale retains ordinary uniform-scaling intent without
forcing untouched Y/Z values; an unrelated opacity edit no longer writes[X,X,100].

The3Dlayer switch uses native layer.setSwitch. Add camera/light uses actual native
layer.newCamera/newLight with the supplied lens/type or light kind; no AI or
surrogate geometry. Camera/light properties are rendered from their native type/UI
metadata and saved through the same exact setter. Native camera zoom changes
projection and ambient intensity changes actual lighting pixels. A35mmcamera
starts at a different projection than the default view; zoom comparisons use the
same actual camera, not the preceding default camera.

Native and browser proofs preserve imported nonuniform axes, unchanged-only writes,
reopen/undo, adjacent ticks beyond2^53 and wide targets, original easing metadata,
Reader/locks/stale-time/foreign/withdrawn boundaries and no revision on malformed
edits. Camera/light rendering uses the original CPU compositor. This source profile
does not establish complete Advanced3D/material/tracking/expression behavior,
all imported formats or hardware/installed parity. Source role/admission seams
remain explicit. Current source catalog is31bound tools/433native commands and
38TestLab recipes. Matching new engine/source/catalog admission is required;
only @admin integrates/registers/installs/deploys.

Durable original-authority rendering jobs, large agent-only artifact transport,
editable Video lineage, installation, installed human/agent/approval/source/grant/
sandbox/host-drop acceptance and the entire product-by-product upstream/Adobe
matrix remain open. Exact scene controls are progress toward that standard, not
a replacement completion standard.

## Exact current-time effect parameters

The source inspector now reads an actual effect instance at an immutable owned
revision and exact decimal composition tick:
`GET /projects/:id/revisions/:revision/effects/:compId/:layer/:effect/:compTimeTicks`.
`effect` is the decimal native instance uid, not an effect catalog name.
`motion-read-effect-properties` uses original own view/read grants and returns
bounded native typed leaves, property ids, key counts, locks and expression flags.
This adds one read-only auto tool (33 source tools including paged value reads); mutation still uses the
existing approval-held exact-edit route and change grant.

`properties.inspectAt` and `properties.patchAt` accept optional `effect`.
Without it they inspect/edit scene properties; with it they restrict targets to
that actual same-layer effect instance, including nested parameter leaves.
Native `value_at` and exact layer-time setters preserve interpolation, neighboring
keys and unmodified parameters. The inspector reports values before expressions.
Human typed effect fields await current project/revision/composition/layer/effect/
tick observations, show animated current values, and send changed-only patches.
Stale selections, playback, Readers and locked layers cannot submit the form.
File-capable effect inputs retain their original owned-source/inline-data checks.

The native catalog remains 433 commands; source Test Lab now has 39 recipes.
Source review tests and installed acceptance are distinct. Complete effect,
expression, Adobe/upstream format/device parity, durable jobs, Video lineage and
installed human/agent approvals remain open.

Large imported effect values retain their full native document capacity. Human
controls read the `/effects/:compId/:layer/:effect/:compTimeTicks/full` binding
(up to the existing 6MiB source reply profile). The bounded agent inspector marks
large values `valueComplete:false` and supplies `motion-read-effect-value` input.
Its `/effects/:compId/:layer/:effect/:compTimeTicks/values/:prop/:offset` route
returns exact 4096-UTF16-unit chunks with safe surrogate boundaries, total length,
encoding and nextOffset. Every chunk freshly rechecks the original owned revision,
read authority and actual native current-time value. Concatenate exact strings or
parse complete `native-json` values preserving native number literals. Partial
values cannot be used as replacements. Existing mutation argument limits remain;
large string replacement still needs a separately reviewed patch/import workflow.

## Native string edits and full human value saves

`properties.patchAt` changes accept exactly one of `value` or
`textPatch:{start,end,text}` alongside the actual decimal `prop` uid. Ranges use
UTF16 units in the native value at the exact composition/layer time and cannot
split surrogate pairs. Native coercion, source confinement, locks, effect target
checks, existing keys/easing and history remain authoritative. Existing agent
exact edits retain their normal change approval and argument bounds; small edits
to large strings now fit those bounds without resending the full value.

Human string controls show bounded sections, search and previous/next navigation.
A local UTF8 text file can replace the entire value; the native data is not
truncated to the visible section. Readers can navigate and copy text while write
controls stay disabled. Large whole replacements use protected
`POST /projects/:id/effect-values` with one multipart `document` JSON envelope:
`{baseRevision,requestKey,compId,layer,effect,compTimeTicks,changes}`. The original
owned read/change grants apply. The closed batch supports at most32 changes and
2MiB native graph/value capacity, validates through the exact native setter, and
publishes one immutable revision. It does not permit owner/path selectors or
external file references. Stable request keys replay a lost success reply.

A giant textarea paste was measured at roughly3.5GiB renderer RSS and remained
busy for minutes; that disposable renderer was intentionally stopped and its
fixture cleaned. Section editing and file replacement avoid rendering the whole
value in a textarea and are source-tested with an actual1.6MiB Unicode LUT.
This is not installed-device or universal memory/performance acceptance.

Complete oversized agent replacements now use approved request-owned value staging;
no tool advertises a2MiB inline argument against the platform's16KiB limit.
Durable jobs, Video lineage, installation and full product-family parity remain
open. This source milestone does not close the requested full objective.

## Full agent value replacement

Five declared tools connect request-owned private staging to a sealed native
string property: `motion-begin-value-upload`, `motion-value-upload-status`,
`motion-append-value-chunk`, `motion-finish-value-upload`, and
`motion-cancel-value-upload` (38 tools total, 41 source Test Lab recipes).
Begin pins original owned project/revision, exact decimal composition/layer/
effect/property ids and tick, UTF8 length, whole SHA256 and stable request key.
Each append contains at most8192 actual bytes in canonical base64 under16KiB
arguments. Exact offset/byte retries are idempotent. Upload changes no project.

Finish validates complete length/digest/UTF8, applies the original native setter
at the sealed time/target, validates source/type/locks and publishes one immutable
revision. Unknown SQL/metadata/HTTP replies retry the same session/key; a partial
upload or invalid batch cannot publish a revision. Cancellation removes only
private staging. Source metadata and fresh original active-principal/read/change
checks guard each disk read/write and final publication; no expired request
callback becomes a background capability. Private regular-file/inode/mode/link
checks, exclusive SQLite OS leases, bounded capacity/expiry and atomic synced
metadata follow the existing reviewed portable-transfer pattern in a separate
namespace. Native graph/value capacity remains2MiB; each namespace has two
sessions and one-hour expiry.

Routes are POST `/value-uploads`, GET `/value-uploads/:transfer`, POST
`/value-uploads/:transfer/chunks`, POST `/value-uploads/:transfer/finish`, and POST
`/value-uploads/:transfer/cancel`. Begin/chunk/finish/cancel retain change/ask;
status metadata is auto under the actual mutating change grant classification.
Existing roles/scopes/bot identity and permissions are unchanged. The engine
catalog/image is unchanged (433 commands). This closes the source transport gap
for full agent string replacement; installation, hosted approvals, durable
renders, Video lineage and full product-family fidelity remain separate gates.


Native render jobs bind a saved original-owner revision and exact decimal composition/ticks. `POST /render-jobs` accepts project, revision, stable requestKey, format (`mp4` or `png-sequence`), and optional compId/startTick/endTick/maxSide. The signed kernel engine continuation enters fresh original authority after the response; no closed request context is reused. `GET /render-jobs` and `GET /render-jobs/:job` report protected receipts, immutable document SHA256 and source lineage; only `ready` publishes a full bytes/SHA256 result. `POST /render-jobs/:job/cancel` removes output only. Render output remains bounded to264MiB, five minutes,4096px; at most2 active/ready owner outputs and16 retry receipts persist for1h. Process failure leaves an interrupted receipt after the deadline; jobs are not automatically restarted after host failure.

The editor starts, polls, cancels, resumes a returned renderJob URL and downloads verified64KiB chunks; a native writable is committed only after the complete digest and final fresh source/grant check. Fallback Blob download buffers the file. Ordinary package HTTP bodies are bounded; no264MiB direct response is promised. `GET /render-jobs/:job/chunks/:offset` provides8192-byte canonical agent segments, and `/artifact-chunks/:offset` provides64KiB verified transport segments. The kernel `motion-render` artifact mode streams those protected segments; contentUrl in the receipt opens the protected download editor. Bundle `/bundle-exports/:transfer/artifact-chunks/:offset` similarly returns64KiB fragments with enclosing1MiB manifest verification. Every operation checks current original own read/export grants and immutable source ownership. Human/agent tools share these routes and source intent. Source-native and controlled bridge proofs are not installed acceptance or full Adobe parity.
