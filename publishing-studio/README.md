# Publishing Studio

Create original-owned, English print layouts with linked text frames, character and paragraph styles, masters, page numbering, bleed, guides and images. The human workbench and Publishing Editor use the same immutable revision store and edit operations. Read the actual `/editing-contract` before proposing changes. Agent writes, render and export use the original person's current named permissions and held approvals.

This is a bounded first publishing profile, not complete InDesign parity. [PROFILE.md](PROFILE.md) lists the supported document and output limits; [API.md](API.md) describes the HTTP, held-agent and private engine contracts. The package is admitted to the native kernel. Installed human workflow and configured-provider acceptance remain pending the admin-owned engine mapping activation.

The workbench is `/api/publishing-studio/app`. Its editable page canvas is an explicit geometry draft; browser text is not authoritative WYSIWYG typography. Render to see the actual PDF-derived page appearance. Save appends a new immutable revision using `baseRevision`; restore appends a new revision rather than overwriting history. Raster originals are immutable owned assets. A render is a separate job pinned to one document revision and source digest. A202 reply means admitted, not complete. Download PDF only after `ready`; an export permission is separate from reading a preview. Editing a source, withdrawing grants, cancelling or expiry prevents the producer from publishing an obsolete ready result.

Typst0.15.1 is the single authoritative shaping, measurement and linked-story flow engine. Four unmodified, hash-pinned Libertinus Serif faces are embedded. pypdf6.20.1 assembles already-laid-out native pages and page boxes; it does not perform typography. Poppler decodes the exact final PDF for PNG previews and independent tests. No system-font fallback or second preview layout is used. Missing fonts require an explicit style substitution; overset, unsupported text and insufficient image resolution refuse clean output. Original dependency licenses and hashes are in `engine/NOTICE`, `engine/licenses/` and `engine/source-lock.json`.

Acceptance checkpoint (2026-10-13): the original renderer `6f2b523d` is now a published ancestor of completed Source `9069fc629f307a6155ab0e84143a81cffd3096e2`, integrated into `feat/native-application-executors`. All23 Source cases ran without skips, including real Chromium and disposable PostgreSQL/Typst. The normal Store gate passed80 jobs with zero failures; six partial and12 skipped peer jobs are not evidence of Publishing behavior.

The genuine native workflow passed1/1 in267.01s against kernel `2388ff3a5377247de211222d1ef14acd002c620a`, immutable Source `ca3a6834e66540e3545383cd55b644abda90595b` and engine `b35c7b08b843d75880028673cf92d495d6b604a6989e52bed3c02bcb6b068930`. It exercised original-person isolation, real native artifact import, held actions, four-page PDF/PNG output, cancellation, grant withdrawal and source reload. Deterministic provider choice and worker-ready delivery pauses are explicit native test seams. Source9069 changes only returned operation-schema minima after ca3; it was not the native run's source. Native test/provision/helper changes are published as kernel `f234b1c` on `work/publishing-native-integration-20261013`.

The matching private engine and loopback link are installed; app admission and its two own administrator grants preserve all214 pre-existing assignments. Admin must connect the engine through the serialized kernel activation before live render acceptance. These results do not establish a live configured-provider workflow, ordinary-user installed acceptance, or complete InDesign parity.

## Reproduce source proofs

Use Node24+, the pinned Store toolchain, Poppler utilities and the genuine prepared aarch64 renderer. Missing prerequisites fail explicitly. The pure renderer tests do not require a database.

```sh
python3 -I publishing-studio/engine/prepare-runtime.py \
  --root /absolute/new-owned-publishing-runtime \
  --typst-archive /absolute/original/typst-0.15.1-aarch64.tar.xz \
  --wheel-dir /absolute/original/pypdf-wheel-directory
export OSHAL_PUBLISHING_PYTHON=/absolute/new-owned-publishing-runtime/python/bin/python
export OSHAL_PUBLISHING_TYPST=/absolute/new-owned-publishing-runtime/typst
export OSHAL_PUBLISHING_TYPST_ARCHIVE=/absolute/original/typst-0.15.1-aarch64.tar.xz
export OSHAL_PUBLISHING_WHEEL_DIR=/absolute/original/pypdf-wheel-directory
node --test publishing-studio/tests/model.test.mjs \
  publishing-studio/tests/engine-real.test.mjs publishing-studio/tests/engine-adapter.test.mjs
# Set OSHAL_TEST_POSTGRES privately to disposable127.0.0.1:35689 only.
# Set STORE_CI_TOOLCHAIN to the pinned Store scripts/toolchain package directory.
node --test publishing-studio/tests/http-tools.test.mjs \
  publishing-studio/tests/http-runtime.test.mjs publishing-studio/tests/project-store.test.mjs \
  publishing-studio/tests/workbench-browser.test.mjs
```

Offline preparation verifies original archive, binary, wheel and font hashes. The two original-artifact environment paths are mandatory for the genuine bootstrap isolation regression; no test downloads or silently skips them. Invoke the preparer with Python `-I` to protect initial interpreter startup too. Child Python/pip run isolated with inherited pip/Python locations removed, configuration disabled, an explicit owned prefix, no user install/cache and private owned temporary files. The host runtime root stays0700. An explicit `--allow-download` can obtain the pinned upstream archive/wheel. The source suite proves a real four-page brochure, linked story order, saved-model reopen, page boxes, embedded fonts and independent pixel positions. It also exercises malformed model parity, overflow, missing fonts, actual framed producer/client integrity, foreign namespaces, current-grant changes, stage cancellation/expiry and reserved quotas. Temporary reply-delivery and private expiry metadata seams are explicitly named. SQL/HTTP fixtures use actual disposable PostgreSQL and the actual renderer; their grant, native artifact unit and kept-run adapters are source seams, not installed-kernel or provider evidence. The earlier complete Source checkpoint passed20 cases with zero skips, including the real Chromium workbench; later mandatory cases also cover UI races and genuine offline bootstrap isolation; the local receipt is `/tmp/oshal-publishing-hardened-source-20261013.log`. This is not installed or configured-provider acceptance.

## Own private engine installation

An administrator must review and install the matching source before app admission. On the aarch64 engine host, set the existing installation private Docker network and run `OSHAL_NETWORK=... sh publishing-studio/engine/install-engine.sh`. The script builds the exact hash-pinned runtime, verifies the image identity before replacing only its own engine, and checks the running compose project and source identity. It does not modify kernel mappings, permissions, install the app or reload the kernel. The image is nonroot/read only with bounded memory, processes, CPU and one private tmpfs; no host port or filesystem mount is published. Root coordinates a private sidecar forwarder and engine mapping separately.

The backend engine error carries an operator `installHint` and expected build hash; ordinary HTTP errors expose the refusal code rather than an operator command. Actual container build, private mapping, named-role restamping and installed acceptance are separate release steps. No performance claim is inferred from the small four-page source fixture.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **384 / 1536 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| publishing-editing-command | editing command | T1 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->

The reviewed source suite includes delayed create/render responses, unapplied field preservation, independent form drafts and dragging a frame on another facing page. The private image was also built and exercised as UID10001 with a read-only filesystem: genuine four-page PDF, all preview/output SHA checks and framed hello/open/close passed. This image proof does not establish installed app admission or configured-provider acceptance.

## Automatic document handoff — 0.1.1 source

Concierge and Jarvis use the shared kernel document handoff. Publishing Studio automatically
applies valid visible inspector/story fields through their existing editor operations and saves
the resulting revision before the assistant reads it. The same native publication refreshes on
return, keeping its page and selection where they still exist. The embedded chat also performs
this save automatically and stays available while a draft is present. No Save or Reload step
is required. A full manual edit batch saves before continuing with pending fields; failed saves
stop the handoff, and concurrent drafts remain intact with a conflict message. Historical
read-only revisions remain visible when handing a question back.

`tests/browser/document-handoff.test.mjs` uses the actual editor, original-owner PostgreSQL/RLS
and real publication operations with the pinned Typst runtime. Its internal bot reply is an
explicit transport seam; separate native-kernel and installed-provider acceptance are required.
Installed acceptance for this source release is pending.
