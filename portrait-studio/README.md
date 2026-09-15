# Portrait Studio — an OSHAL app package

Version 1.13.0 requires explicit imported application roles. See [authorization and ownership](AUTHORIZATION.md) for independent view/read/create/change/delete grants, legacy ownership migration, and current email/CLI transport limits.

Turn any photo into a portrait worth framing.

**Choose from OSHAL (1.11.0):** Step 1 opens the shared file picker over your connected storage
and registered app sources, including your finished Portrait Studio images. Selecting a photo
loads it into the existing crop stage; it does not generate or publish anything. Folders, Back,
image/size filtering and Cancel are shared framework behavior. The old connected-files modal
and its private filtering/navigation helpers have been removed.

The package also declares a read-only `/api/portrait-studio/artifacts` source, listing only the
caller's completed images, at most 50 per page. It returns owner-scoped image URLs through the
existing short-lived artifact handles. This requires core's ADR-139 Stage 4a picker routes.

- **Professional mode** — upload a photo, crop the head, and pick a **formal
  people profile**: LinkedIn Classic, The Executive, Creative Pro, Black Tie,
  The Graduate (gown + cap + diploma), The Doctor, The Judge, Dress Uniform,
  Editorial B&W, Vintage Tintype, and more.
- **Character mode** — the fun side: the subject's face (a person **or your pet**)
  on a human-type body, hands deliberately in frame, in a themed scene —
  American Gothic gripping a pitchfork, a steel-mill worker in sparks, a
  Renaissance noble, an astronaut, a sea captain, a knight, and more.
- **Group mode** (v1.5.0) — one photo, every face: put a numbered box on each
  head (click a face to add one, or **Find faces** where the browser has a
  detector), pick a **scene** — Superhero Team, Pirate Crew, Samurai Clan,
  Starship Crew, Rock Band, Heist Crew, Knights of the Round Table, Holiday
  Card, Board of Directors, forty in all — and one generation puts the whole
  crew in it. Two to six faces.
- **Everything is interchangeable** — presets are just starting points. Six
  swappable layers on every generation: **200 backgrounds × 110 clothing styles ×
  50 hats × 60 props × 20 finishes × 5 framings** behind **225 presets** (80
  professional profiles, 105 characters, 40 group scenes), validated fail-closed
  server-side (`validateOverrides`); only the free-text notes field is prose, and
  it is sanitized. Those counts are the test-enforced contract
  (`tests/catalog-invariants.spec.js`), not a brochure number. Put the crown on
  the LinkedIn headshot. We won't judge.

## Group mode (v1.5.0)

The image engine takes exactly **one** anchor image, and that contract is not
changed here. Group mode works *inside* it:

1. In the crop stage every face gets its own aspect-locked box — click a face to
   drop a box on it, drag to move, drag a corner to resize, **＋ Add face** for the
   next free spot, **✕ Remove this face** for the active one. Boxes are numbered
   in the order they were added. **Find faces** suggests boxes locally using the
   browser's detector or the bundled worker, including desktop Chromium, Firefox
   and WebKit. Review and adjust every box; detection can miss faces. Manual
   boxes remain available, and cancellation or no matches preserves them.
2. On **Generate** the browser tiles the crops into a **numbered reference
   sheet** — two columns up to four faces, three beyond, each tile with a badge
   — and uploads that single PNG plus a `subjects` count.
3. The route validates the count fail-closed (`validateSubjects`: 2–6, refused
   outside group mode, the multipart field is the only source of truth) and the
   prompt tells the engine exactly what it is looking at: N labeled tiles read
   left-to-right, top-to-bottom; every one of the N in the scene **exactly
   once**, nobody missing, nobody duplicated, no extra people; two hands per
   person; and no badges carried over. The preset's `pose` is the group's
   **arrangement** and always stays; a prop override is applied to every member
   (in the solo modes a prop *replaces* the pose).

The gallery row carries the face count (`subjects`) so a group portrait reads
as one. The sheet is what the model saw, so the row's `source` is honest.

## Getting the photo in (v1.4.0)

Step 1 takes a photo four ways, and all four land in the same interactive crop
stage and pass the same validation (image MIME, 20 MB ceiling):

- **This device** — drop or choose a file, as before.
- **Connected files** — a folder browser over whatever storage the caller has
  connected: OSHAL Storage, Career, Dropbox, Google Drive, GitHub. The studio
  integrates with none of them individually; it reads the framework's one storage
  rail (`/api/files/roots|browse|download`), so a source the operator connects
  later simply appears. Folders and images are listed, everything else is filtered
  — and *counted* ("2 non-image files and 1 over 20 MB hidden") rather than
  silently dropped, because a short list reads as an empty folder. Oversized files
  are refused before the download, not after it.
- **Use camera** — a live in-page preview (`getUserMedia`) with a camera picker
  when the device has more than one. Professional mode opens the front lens,
  Character mode the rear one (pets are rarely selfies). The preview is mirrored
  so lining up feels natural; the *captured frame is not*, because a mirrored
  headshot flips the text on a badge or a shirt.
- **Camera app fallback** — a browser without an in-page camera (or a phone) gets
  the OS camera through `<input capture>` instead, with the right lens preselected.

Nothing is uploaded at capture time: the frame lives in the browser until the crop
is confirmed and **Generate** is pressed, exactly like a dropped file. Closing the
modal — button, Escape, or hiding the tab — stops every track, so the camera light
goes out.

Two honest edges in the picker. **Google Drive can be connected and still look
empty** — the connector holds Google's per-file `drive.file` scope, which only ever
sees files oshal created, not the photos you took; the picker says exactly that
instead of claiming there are no images (widening it is a core decision, tracked in
[BACKLOG.md](BACKLOG.md)). And **HEIC** files off a phone are listed but marked
"may not open here", because most desktop browsers cannot decode them — picking one
gives a message naming the format rather than a bare failure.

The camera needs a **secure context**: `https://` or `localhost`. Opening the
cockpit at a plain `http://192.168.x.x` address hides `navigator.mediaDevices`
entirely, and the surface says so in those words rather than blaming the browser
(that distinction is a tested behaviour, not a nicety — the fix is the origin).
When no camera path exists at all, the control is hidden with a reason instead of
rendered dead.

## How it works

1. The studio surface (`/api/portrait-studio/app`, a ribbon tile) does the
   capture-or-upload + interactive crop client-side and POSTs the cropped PNG
   (in group mode: the numbered reference sheet of every face box).
   The source-selection logic is served at `/api/portrait-studio/capture-module` —
   the same file the test suite requires, so a fallback branch cannot pass in the
   test and differ in the page.
2. The route builds a deterministic prompt from the style catalog
   (`src-routes/portrait-catalog.ts` — identity preservation, exactly two hands,
   no text — encoded once) and hands the photo as the **anchor** to the
   framework's storyboard image provider (`@/features/video-generation`, the
   `media-generation` kernel skill): an image-to-image **edit**, vendor-abstracted
   and fail-closed.
3. Generation runs async; the gallery polls until the portrait flips to `done`.
   Rows live in `ps_portraits` (strictly verified issuer-and-subject filtered), files under
   `$CLINE_WORKSPACE_ROOT/portrait-studio/<issuer-and-subject-hash>/`.

## Image engine configuration (operator)

The engine is chosen by `STORYBOARD_IMAGE_PROVIDER`, same as the Video Studio
storyboard stage — **fail-closed**, never silently falling to a paid vendor.
Unset, the default is demo-aware (ADR-130): `codex-cli` when the deployment
runs `DEMO_MODE=true`, `codex` otherwise. Portrait Studio refuses the subject-only CLI rail; configure a supported platform image provider:

| provider | model | needs |
|---|---|---|
| `codex-cli` (unavailable for this protected package) | the render bot's boot codex model (fleet `gpt-5.5`) via the swarm's own codex harness — **free**, subscription-included | `DEMO_MODE=true` + the caller in `OSHAL_OPERATOR_SUBS` (SEC-05 demo carve, enforced at the bot node) + the app-boot executor; render bot via `STORYBOARD_CLI_IMAGE_BOT_ID` |
| `codex` (non-demo default) | `gpt-image-1` edits | a **platform** OpenAI credential (`OPENAI_API_KEY` / `openAiApiKey`). ⚠ The Codex **ChatGPT-subscription** OAuth token does NOT work here — `/v1/images` rejects subscription tokens. |
| `openrouter` | `google/gemini-2.5-flash-image` (override: `OPENROUTER_IMAGE_MODEL`) | the swarm's OpenRouter key (`OPENROUTER_API_KEY` / `openRouterApiKey`); ~$0.04/image, image-to-image via chat completions |
| `vertex` | `gemini-2.5-flash-image` | a Google token with the cloud-platform scope (explicit opt-in) |
| `comfyui` | local GPU workflow | not wired yet |

Since 1.4.1 the routes pass the caller's sub to the resolver — the `codex-cli`
rail authorizes **per caller**, but this protected package now refuses that rail because it does not carry application permissions.

The surface shows a banner (via `GET /api/portrait-studio/provider`) when the
engine isn't configured. `PORTRAIT_STUDIO_DAILY_CAP` (default 25) caps
generations per user per 24 h.

## Industrial guarantees (v1.2.0)

- **Interrupted generations never strand a spinner** — rows stuck in
  `queued`/`generating` past 10 minutes (api restart, vendor hang) are swept to
  `failed` with an honest reason, at package startup. Gallery reads remain side-effect free.
- **Transient vendor errors retry** — up to 3 attempts with exponential backoff;
  permanent errors (auth, refusal) fail fast rather than tripling the bill. Every
  attempt has a hard deadline (`PORTRAIT_STUDIO_VENDOR_TIMEOUT_MS`, 120 s).
- **Burst control** — a process-wide semaphore bounds concurrent vendor calls
  (`PORTRAIT_STUDIO_MAX_CONCURRENT`, 4) and each user may have at most
  `PORTRAIT_STUDIO_MAX_ACTIVE_PER_USER` (2) portraits in flight (429 beyond).
- **Cost is captured canonically** — the vendor-reported spend lands on the row
  (`cost_usd`) and in `chat_tasks` + `oshal_cost_events` via the media-generation
  skill's `recordStoryboardImageCost`, attributed to the `portrait-artist` bot and
  the owning user — budgets and run traces see it.
- **`GET /provider` tells the truth** — it runs the provider's real credential
  probe (key validity + remaining credit) when one exists, not a key-presence
  check. A dead key reads `configured: false` with the reason.
- **Tested** — `node tests/run.js` (plain node, zero deps, CI-gate-able) covers
  catalog invariants (every preset's layer ids exist, overrides land in prompts,
  fail-closed validation, notes sanitization), the ops primitives
  (retry/backoff semantics, error classification, timeout, semaphore FIFO), and
  the photo-source decisions (live / camera-app / hidden across every capability
  combination, the shared photo rule, honest permission and insecure-page
  messages, lens preference, device labelling and frame box), and the group-mode geometry (face-count rule, sheet
  layout in reading order with no overlaps, box placement clamped into the image,
  detector rectangles expanded into head-and-shoulders crops, left-to-right
  numbering). `tests/browser/camera-proof.js` is the browser proof of the DOM
  wiring: a `node:test` suite that drives real Chromium over its own fake capture
  device, so the Test Lab runs it unattended.
  The framework's `tests/unit/artifact-picker.spec.ts` checks shared source discovery, owner-only
  file/handle access, folder navigation, filtering, cancellation and the actual crop-stage handoff.

## Package layout

Version 1.14.1 registers all package test and authorization fixture files in `tests/test-lab.yaml` and requires the
core `test-catalog` capability. Each custom exported-function suite references its existing
`tests/run.js` launcher and is marked `external`, since it is not a Node test-runner suite.
`tests/browser/camera-proof.js` registers separately as a Node test-runner browser recipe. The shared picker proof remains core-owned,
pinned to core `7ca9d81b6f54e1086bdd8c260f03ecd4d8bbca1a`; it is not copied into this package.
The pure Node cascade suite is eligible for the sealed package runner. Browser, custom-harness
and core-owned suites remain pending their declared runner and fixture requirements. A catalog entry
does not imply that generation, email, a real camera, or a local test runner executed.

Manual isolated proofs from the store root:

```text
node portrait-studio/tests/run.js
node --test portrait-studio/tests/face-cascade.test.js
OSHAL_CORE_ROOT=<core-checkout> node --test portrait-studio/tests/browser/camera-proof.js
```

The camera recipe uses an ephemeral loopback port and Chromium's own fake capture device; Playwright
and the shared picker asset both resolve from `OSHAL_CORE_ROOT` (default: an `oshal` checkout beside
this store), a missing input fails the file loudly rather than skipping, and cleanup runs after
success or failure.

### Proving the camera on real hardware

`--use-fake-device-for-media-stream` is a Chromium capture device, not a page-side stub: the page
calls the browser's real `getUserMedia`, gets a real `MediaStream`, and the `<video>` decodes real
frames, so the permission grant, the track lifecycle and the teardown are the browser's own. What it
cannot cover is a **physical** camera — enumeration across real webcams, a human answering the OS
permission prompt, and real lens and exposure behaviour. That check needs hardware and a person, so
it is deliberately **not** a Lab case: open the installed Portrait Studio in a browser on a machine
with a webcam, take a photo through Step 1, and confirm the preview is live, the snap lands in the
crop stage, and the camera light goes out when the modal closes. The desktop and phone cases in the
recipe remove `navigator.mediaDevices` (and, for the phone, add the HTML Media Capture IDL) — those
are capability shapes proving the fallbacks, not a simulated camera.

For the pinned shared proof, provision the
named core revision and its locked dependencies, set `OSHAL_STORE_REPO` to this store checkout,
then run `npx vitest run tests/unit/artifact-picker.spec.ts` from that core. The installed Lab does
not assume either source checkout is present. Install 1.14.1 only with the matching application authorization and protected artifact relay support.

Version 1.14.1 removes the obsolete subject-only `access.defaultTier: deny` gate,
which ran before named permissions and prevented a correctly assigned manager from
opening the app or seeing its Test Lab cases. The named authorization catalog is
byte-for-byte unchanged from 1.14.0; no role regrant or legacy assignment is needed.
Unassigned, revoked and wrong-issuer callers remain refused. The registered HTTP
fixture now includes the actual core manifest route mounter as well as the named
policy and package handlers, so it covers both admission boundaries.

Installed acceptance on 2026-09-12 verified all eleven current Lab entries for
1.14.1 source `2e10bbb6eb07fc69a9f6b3022b50ae165488f7f4`. A signed-in Lab run of
`local-face-cascade` passed 4/4 with verified cleanup on core `9c5985ed`.
At that checkpoint, a Windows prompt blocked the native image-picker check.
A later native check on core `dd7bcaa4` loaded the licensed local photo through
the actual picker in Group mode. Find faces used the bundled fallback and showed
one editable box while retaining Daylight; no generation was requested. This is
one installed-browser photo check, separate from the broader isolated
Chromium/Firefox/WebKit evidence below. See
[the exact installed receipt and limits](../TEST-LAB-ADOPTION.md#portrait-studio-follow-up-2026-09-12).

For the local detector's actual browser proof, install Chromium, Firefox and WebKit matching
the core's locked Playwright version, set `OSHAL_CORE_ROOT` to that checkout, and run its
Vitest binary with `run --config portrait-studio/tests/face.config.mjs` from the store root.
The suite uses the real protected page, Worker and bundled cascade with a licensed local
photo. It also tests no-face/manual fallback, native failure, cancellation, current permission
checks and the four exact asset routes. The PNG/browser prerequisites are explicit; this is
not a sealed Node suite. No provider, real camera, account or image upload is used.

**Local face finding:** the [pinned MIT model and implementation provenance](tools/face-model/README.md)
describe exact hashes, limits and quality caveats. Detection processes grayscale pixels on
this device and suggests boxes; it does not identify people. The worker is terminated after
completion, cancellation, failure or its eight-second deadline. Edits, photo changes and
permission refreshes invalidate pending results. It works best with clear frontal human
faces; manually box profiles, small faces or pets when needed. The four additional read-only
asset bindings require the existing `portrait.view` permission. Upgrading an installation
with catalog-pinned role assignments requires its normal reviewed role/catalog update.

Standard ADR-085 package: `oshal-app.yaml`, `personas/portrait-artist.yaml`,
`src-routes/*.ts` → compiled `routes/*.js`, `migrations/001-portrait-studio.sql`,
`tools/portrait-studio.html`. Build the package with the canonical compiler against actual core exports (BUILDING-EXTENSIONS section 5). The old ambient declarations are not authoritative and must not participate in the canonical compile. Use an isolated store copy containing this package when rebuilding only Portrait, then copy its verified `routes/` outputs back:

```
node scripts/security/rebuild-store-routes.mjs --store <isolated-store-copy> --framework <core-checkout>
```

Install: `node scripts/oshal-app.js install portrait-studio`
