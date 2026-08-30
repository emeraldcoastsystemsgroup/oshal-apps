# Portrait Studio — an OSHAL app package

Turn any photo into a portrait worth framing.

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
   in the order they were added. Where the browser exposes a face detector
   (`FaceDetector` — Chrome on Android today; desktop Chrome behind a flag) a
   **✨ Find faces** button places them automatically, left to right; elsewhere
   the button never renders and the boxes are placed by hand.
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
   The source-selection logic is served at `/api/portrait-studio/capture.js` —
   the same file the test suite requires, so a fallback branch cannot pass in the
   test and differ in the page.
2. The route builds a deterministic prompt from the style catalog
   (`src-routes/portrait-catalog.ts` — identity preservation, exactly two hands,
   no text — encoded once) and hands the photo as the **anchor** to the
   framework's storyboard image provider (`@/features/video-generation`, the
   `media-generation` kernel skill): an image-to-image **edit**, vendor-abstracted
   and fail-closed.
3. Generation runs async; the gallery polls until the portrait flips to `done`.
   Rows live in `ps_portraits` (strictly `user_sub`-filtered), files under
   `$CLINE_WORKSPACE_ROOT/portrait-studio/<sub-hash>/`.

## Image engine configuration (operator)

The engine is chosen by `STORYBOARD_IMAGE_PROVIDER`, same as the Video Studio
storyboard stage — **fail-closed**, never silently falling to a paid vendor.
Unset, the default is demo-aware (ADR-130): `codex-cli` when the deployment
runs `DEMO_MODE=true`, `codex` otherwise:

| provider | model | needs |
|---|---|---|
| `codex-cli` (demo default) | the render bot's boot codex model (fleet `gpt-5.5`) via the swarm's own codex harness — **free**, subscription-included | `DEMO_MODE=true` + the caller in `OSHAL_OPERATOR_SUBS` (SEC-05 demo carve, enforced at the bot node) + the app-boot executor; render bot via `STORYBOARD_CLI_IMAGE_BOT_ID` |
| `codex` (non-demo default) | `gpt-image-1` edits | a **platform** OpenAI credential (`OPENAI_API_KEY` / `openAiApiKey`). ⚠ The Codex **ChatGPT-subscription** OAuth token does NOT work here — `/v1/images` rejects subscription tokens. |
| `openrouter` | `google/gemini-2.5-flash-image` (override: `OPENROUTER_IMAGE_MODEL`) | the swarm's OpenRouter key (`OPENROUTER_API_KEY` / `openRouterApiKey`); ~$0.04/image, image-to-image via chat completions |
| `vertex` | `gemini-2.5-flash-image` | a Google token with the cloud-platform scope (explicit opt-in) |
| `comfyui` | local GPU workflow | not wired yet |

Since 1.4.1 the routes pass the caller's sub to the resolver — the `codex-cli`
rail authorizes **per caller**, so the `/provider` banner answers for the user
looking at it, and non-operator callers fail closed with the carve hint.

The surface shows a banner (via `GET /api/portrait-studio/provider`) when the
engine isn't configured. `PORTRAIT_STUDIO_DAILY_CAP` (default 25) caps
generations per user per 24 h.

## Industrial guarantees (v1.2.0)

- **Interrupted generations never strand a spinner** — rows stuck in
  `queued`/`generating` past 10 minutes (api restart, vendor hang) are swept to
  `failed` with an honest reason, at boot and lazily on gallery reads.
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
  messages, lens preference, device labelling, frame box, and the connected-asset
  picker's image filter, hidden counts, provider-agnostic breadcrumbs and
  empty-folder causes), and the group-mode geometry (face-count rule, sheet
  layout in reading order with no overlaps, box placement clamped into the image,
  detector rectangles expanded into head-and-shoulders crops, left-to-right
  numbering). `tests/browser/camera-proof.js` is the hand-run browser proof of
  the DOM wiring — see [BACKLOG.md](BACKLOG.md).

## Package layout

Standard ADR-085 package: `oshal-app.yaml`, `personas/portrait-artist.yaml`,
`src-routes/*.ts` → compiled `routes/*.js`, `migrations/001-portrait-studio.sql`,
`tools/portrait-studio.html`. Build with the per-package tsconfig (the same idiom
as marketing-engine — `@/` aliases stay intact for the runtime loader, framework
types come from `src-routes/core-modules.d.ts`):

```
node <oshal checkout>/node_modules/typescript/bin/tsc -p portrait-studio/src-routes/tsconfig.json
cp portrait-studio/routes-build/portrait-*.js portrait-studio/routes/     # never package-smoke.js (canonical copy)
```

Install: `node scripts/oshal-app.js install portrait-studio`
