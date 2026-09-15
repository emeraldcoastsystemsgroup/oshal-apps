# Create (create) — OSHAL app package

The design-tool front door for everything you make with oshal. One rail, one skin,
one home page — "What will you create today?" — over the creative studios that are
already installed: **AI Office** (deck / document / workbook), **Portrait Studio**,
**Video Studio**, **LoRA Studio**, **Vids Studio**, the **Creative Studio** story
pipeline and **3D Scan-to-Print**. `create.oshal.ai` lands here.

Create 1.5.0 adds an owned layered **Image editor** alongside the existing studios.
Open **Create → Image editor** or Home's **Image design** quick start. See
[the editor guide](EDITOR.md) for editing, private project revisions, export and
application roles. The accepted 1.5.0 checkpoint used published
source `b92013b48d6f705138617b5816c7d49581a28257`. Final native acceptance and four
installed Lab runs pass. [Current installation status](#image-editor-installation-status).
Create **1.6.0** adds eight original editable image templates. Open **Create →
New → Image templates**, or **Browse image templates** inside Image editor. Search and filter
real previews, then edit the title, shapes and colors as independent layers.
Version 1.6.0 is installed from published source
`54c1e7890ee8352ba85e23ff9bfacdf2bbb1d2aa`. Native standalone editing and export,
five installed Lab runs and strict preservation pass. See
[the current installation record](#image-template-installation-status).
See [the product direction](PRODUCT.md) and [template workflow](EDITOR.md#image-templates-160).

The 1.6.0 source passes 37 new checks (13 model and 24 real-browser template
cases) plus 93 retained static/HTTP and editor/launcher/theme browser checks.
Two stale starter-count expectations were updated for the additional entry.
Review also reproduced background keyboard/paste edits through the open picker;
the fixes have before/after regression coverage. The catalog now contains
**16 cases: 15 declared recipes plus generated readiness**. Installed execution
and deployment are recorded separately below.

Version **1.7.0** adds two integrations using the existing core components:
**Add image layer in Create** appears in the shared Send to menu for PNG, JPEG
and WebP artifacts, and the editor publishes bounded selected-layer context to
Jarvis. The imported raster becomes an independent editable image layer through
the existing owner-scoped upload path. Selection context advertises no editing
operations; it does not let Jarvis change the document. See
[image handoffs and context](EDITOR.md#image-handoffs-and-jarvis-context-170).
The two new browser recipes are registered in the 18-case catalog. One
catalog-driven host batch passes all **28 checks** across both recipes, including
the real shared dispatch/bridge and compiled asset route. A retained composition,
save/reopen and export browser case also passes. Version 1.7.0 was installed from
`21ea2f691d47daddb7d551f35d7f7cc56679d2d6` on 2026-09-13 with all 76 package files
verified. Its first installed batch exposed a stale Home test adjacency assertion;
two suites passed, the Home suite passed eight of nine cases, and a later suite
was separately cancelled during current-authority validation. That batch is
retained as incomplete.

Version **1.7.1** corrects only that retained test and its metadata. It verifies
access answers, starter gating, the incoming artifact, profile and summaries in
their intended order, including refusal of early/duplicate handoffs. All five
registered Node recipes pass **58 checks in one local batch**. Version 1.7.1 was
installed from `70536e272398d6f6b3e50506c50f963255a918dd` on core `1694a3ca`
on 2026-09-13. All 76 files matched; the prior package was backed up before copy.
The native **Run package suites** action completed all five recipes with
**58/58 passing checks**, verified cleanup and the exact installed image.
Batch `38af33d3-6fc3-423d-92f2-c57ee285a281` finished at 07:32:48 UTC.
Thirteen prerequisite-dependent cases remained unavailable; they are not passes.
The earlier failed batch and the 1.6.0 record below remain historical evidence.

The package ships:

- **the manifest** — the Create rail (`ui.static`): Create (New), Home and Image editor, then each
  member studio's *own* surface URL, grouped Studios / Pipeline; the console trays
  (tickets, chat, calendar, address book, dashboard, logs, operations), the chat rail
  and the status bar are hidden, Settings and the assistant orb stay;
- **a package-bundled cockpit skin** — [`ui/create.css`](ui/create.css), worn by the
  cockpit when **Application colors** is enabled for `?app=create` (ADR-085 bundled skin, the Little Monsters
  mechanism): white paper, a lilac→sky→mint wash, one violet accent with a violet→teal
  gradient, a 76px icon-over-label rail, gradient wordmark;
- **the home surface** — [`tools/create-home.html`](tools/create-home.html): a compact
  introduction, workspace search and one *Browse templates* action; *Continue creating*
  (recent saved work across every studio), *Quick start* (twelve formats in a wrapping
  grid, each opening its studio), *Your studios*
  (built from this app's own cockpit profile, so the cards are the rail), *This week*
  (each studio's own counts);
- **the New screen** — [`tools/create-new.html`](tools/create-new.html): the "Create a design"
  flow. A Home return, format categories (Image designs, Presentations, Documents, Spreadsheets, Portraits, Video, Stories, 3D & print), search,
  purpose chips, and template cards drawn from each studio's own catalog — AI Office publishes what a
  deck, a document and a workbook are each *for* (`GET /api/presentations/sections/starters`), and a
  card opens AI Office already set to that kind, starter and look (`app-navigate` + a validated
  `query`, cockpit ≥ the tool-query change; standalone, the studio URL carries the same query);
- **static entry routes** — `GET /api/create/new`, `GET /api/create/home` and `GET /api/create/theme/create.css`,
  static files served from the installed package dir captured at factory time;
- **the image editor and project API** — `/api/create/editor`, owned immutable
  revisions, raster assets and named permissions. [Architecture and limits](EDITOR.md).

## Image template installation status

Create **1.6.0** is installed from published source
`54c1e7890ee8352ba85e23ff9bfacdf2bbb1d2aa` on the existing core
`2739e2501f8f8919780c8c723dbfea4dd76eccd2`. All 71 installed files match the
published stage. Sixteen Lab cases are registered. Five native-started installed
Node runs pass **58 checks** with exact source/image/revision attribution and
verified cleanup. The first Home run was automatically cancelled by the runner's
access/source guard with no test output; its preserved record is separate from
the successful retry. Browser and host-dependent suites retain their local
evidence and explicit installed-runner prerequisites.

Native acceptance opened the gallery, selected an announcement design, changed
its headline, saved/reopened revision 1 and exported a 1080 × 1080 PNG and
nine-layer editable JSON. The synthetic project was deleted normally. All four
project/asset tables are empty; all 35 application containers are healthy and
the other 58 packages, CRM/configuration and all existing roles/audits are
unchanged. This upgrade did not require another authorization-catalog migration.

The first cockpit iframe request encountered a wider origin/API stall. The
standalone editor completed acceptance after recovery; the separate request
delay remains open. A later native retry also opened the gallery successfully
inside the cockpit. The [release record](https://github.com/emeraldcoastsystemsgroup/oshal/blob/feat/store-compatibility-gate/docs/releases/create-templates-2026-09-13.md)
contains exact runs, receipts, interruption evidence and limits. Video timeline
editing and selected-region AI regeneration remain planned. Later documentation
commits do not change this installed source. Security audit status remains
pending; no GitHub Actions were used.

## How the home page gets its data (nothing is faked)

| Section | Source | Session |
|---|---|---|
| Your studios | `GET /api/ui/profile?name=create` — the rail this app is rendering right now | viewer's |
| Continue creating / This week | `GET /api/<member>/home-summary` for presentations, portrait-studio, video, lora, vids, creative-studio, scan-to-print and Create's owned image projects (the ADR-145 Home probes) | viewer's |
| Quick start | static starters, each pinned by test to a rail tile the manifest declares | — |

Probes are asked from the page in the signed-in user's own session with a 3 s timeout;
a probe that fails renders "can't check", never a zero. Only items that carry actions
(real saved records) become cards — the probes' explanatory footnotes are skipped.
Navigation speaks the ribbon's `app-navigate` dialect (postMessage to the cockpit
shell); opened standalone, a tile falls back to the studio's own URL.

## Access (ADR-149)

Before a studio is offered, the New screen and Home ask the authorization service what the
signed-in person may open (`GET /api/authorization/me?app=<member>`): `legacy` is open; an enforced
package is open only when the person's tier is not deny. A studio that is not provisioned renders
**locked** — it never opens and its Home probe is never asked — with the Access link an administrator
uses (`/access?app=<member>`). A probe that cannot answer is marked "can't check" and left in place.
The rail tiles themselves are manifest-static; opening a locked studio from the rail lands on the
kernel's role-guidance page.

## Surfaces

| Tile | URL | Owner |
|---|---|---|
| Create (New) | `/api/create/new` | this package — categories, purpose chips and template cards; the Office cards come from `GET /api/presentations/sections/starters` (the owning app's catalog) and every card opens its studio on that purpose through `app-navigate` + `query` |
| Home | `/api/create/home` | this package |
| Brand Kit | `/api/create/brand` | this package — the person's brand kit (see below) |
| AI Office | `/api/presentations/sections/ui` | presentations |
| Image editor | `/api/create/editor` | create — manual layered projects |
| Portrait | `/api/portrait-studio/app` | portrait-studio |
| Video | `/api/video/ui` | video |
| LoRA | `/api/lora/ui` | lora |
| 3D Scan-to-Print | `/api/scan-to-print/app` | scan-to-print |
| Vids | `/api/vids/app` | vids |
| Stories | `/api/creative-studio/review` | creative-studio |

## The skin, and what wears it

Since **1.2.2**, Home and New follow the selected portal palette, including Workspace,
through the shared theme bootstrap and CSS. Changing the theme keeps the same document,
search input and studio links. Standalone pages follow the saved choice and changes from
other tabs; with no saved choice they start in Workspace without writing a preference.

Enable **Application colors** in Cockpit Settings to wear the original `ui/create.css`
skin. The profile supplies `themeCssUrl`, and both surfaces retain the package stylesheet
at `/api/create/theme/create.css`. This opt-in never overwrites the saved portal palette;
choosing a portal theme turns application colors off again. The page's initial Create
attribute remains a fallback for a host without the shared bootstrap.

An iframed member studio derives its palette from the framework tokens through the
shared `surface-theme.js` bootstrap. Cores that include the bundled-skin follow (the
bootstrap reads the same-origin parent's `data-theme` + `#app-package-theme-css` link)
render the studios in the Create skin too; an older core renders them in the operator's
saved theme, which is the framework's pre-existing behaviour — never a broken page.

## Brand Kit (1.8.0)

The contract, the file map, every test command, the installation gate and the next slices are in
[BRAND-KIT.md](BRAND-KIT.md).

One private brand kit per person, edited on the **Brand Kit** tile (`/api/create/brand`) and read
by every studio in the viewer's own session. It holds a brand name, five role colors (primary,
secondary, accent, text and background) plus up to six named extras, a heading and a body face
from the fonts that ship with Office on Windows and macOS, a one-line voice, and a logo.

- **Storage.** `migrations/002-create-brand-kits.sql`: one row per verified issuer and subject,
  optimistic revisions, the same exact-owner row security as projects. The logo is an ordinary
  owned Create image (same normalization, quota and storage); the database refuses a logo that
  belongs to someone else, and unused-upload cleanup keeps an image a kit uses.
- **Routes** (inside the project router): `GET /brand-kit` (the kit, its revision, `canChange`
  and the colors in words), `PUT /brand-kit` (`{ baseRevision, kit }`; 0 for a first save, a stale
  page gets 409), `DELETE /brand-kit` and `POST /brand-kit/logo`. The server validates with the
  same `tools/editor/brand-kit.mjs` module the page runs.
- **Permissions.** Its own `brand` resource: `brand.read` for every role that reads projects,
  `brand.change` for editor and admin. Viewer-tier roles never write.
- **Where it shows up.** The image editor opens templates in the brand (colors by role, bold text
  in the heading face, the name on the signature line, the logo in each design's logo slot, and
  text re-inked when it would lose contrast), offers the brand swatches and faces beside every
  layer, and adds the logo as a layer without a new upload. Home shows the kit or a setup prompt.
  AI Office badges the built-in look nearest the brand and picks it when nothing else chose a
  look, fills an empty cover byline with the brand name, and can add the brand voice to AI
  drafts. Portrait Studio and Video Studio offer a **Use my brand colors** button that adds the
  colors, in words, to the notes or style field.
- **Limit.** AI Office renders its own ten built-in looks; drawing a deck in the brand's exact
  colors and fonts needs the renderer to accept a custom look, which is a core change.

## Dependencies

`dependencies.apps`: presentations, portrait-studio, video, lora, vids, creative-studio, scan-to-print —
resolved npm-style on install; the reverse-dependency guard blocks a member's uninstall
while Create is active. Manual editing has no bot or provider dependency. Create
owns the private project schema and image summary; members retain their evidence.
See [HOME.md](HOME.md) and [EDITOR.md](EDITOR.md).

## Planned editing workflow

The [visual creation and editing roadmap](BACKLOG.md) records the next
product direction: clearer page layout, basic image/video editing, a shared
generate/edit/annotate/regenerate loop, and editor handoffs that retain project
history. The manual layered-image foundation is commissioned in 1.5.0; AI region
regeneration, video/audio timelines and deeper editing are the next separate
phases. The roadmap distinguishes source implementation from installed acceptance.

### Workspace layout (1.3.0)

Home prioritizes saved work, with compact studio cards and quick-start formats that
wrap within narrow screens. New is the template browser: each published Office
template appears once, alongside the other studios' existing starting formats.
Categories and purpose filters retain keyboard focus and announce selection. Home's
section shortcuts move focus to the selected section; its search shows an explicit
no-match state and Enter retains the same format query as clicking the starter.

The layout preserves summary sources, locked-studio behavior, exact Office
kind/starter/theme queries and standalone URLs. It introduces no canvas, editor,
generation action, storage or provider integration. Portal palettes and optional
Application colors continue to apply without replacing the current document.
Native installation acceptance for 1.3.0 is recorded in the core
[workspace polish release](https://github.com/emeraldcoastsystemsgroup/oshal/blob/e2c6d9575aaf47835838775bd7828de889881496/docs/releases/workspace-polish-2026-09-12.md).

### 3D Scan-to-Print (1.4.0)

Open **3D Scan-to-Print** from the Studios rail, Home's studio card or Quick start,
or **Create → 3D & print**. Every entry opens the same owning application at
`/api/scan-to-print/app`, through `create-scan-to-print` in Cockpit or the fixed
URL standalone. The launcher supplies no artifact or job parameters.

Create checks the viewer's existing Scan-to-Print access before querying its
owner-scoped Home summary. Denied studios remain locked; unavailable summaries
remain visibly unavailable. Camera capture, uploads, reconstruction, model review
and confirmed printing stay in Scan-to-Print. Create adds no calls to those
actions and grants no application access. Existing platform artifact handoffs
remain with the owning studio.

### Installed acceptance (2026-09-12)

At the earlier 1.4.0 checkpoint, Create was deployed on the local preview from published source
`4244a002dde441eccbf34d02567bea85403bfa18`. All nineteen source files plus the install stamp
matched the staged package. The existing API container restarted without changing the core
`c1be9d5d` image; application loading completed with 77 loaded and no failures.
Create's existing ownership and the other 58 installed packages were preserved.

Signed-in native checks verified Home's Scan-to-Print entries and the New screen's
**3D & print** category. Opening its card loaded Scan-to-Print inside Create with Daylight
retained and unchanged scan/print summary counts. An initial gateway failure recovered on
the subsequent launch; startup resilience remains separate work. Camera capture and physical
printing were not exercised by this launcher acceptance.

The 1.4.0 installed Lab exposed all seven recipes. Its Home, New and local HTTP runs passed
9, 7 and 4 checks respectively, with exact source attribution and verified cleanup.
The three browser recipes remained unavailable in that installed runner; their 32 passing
Chromium checks are separate local evidence. [PR 185](https://github.com/emeraldcoastsystemsgroup/oshal-apps/pull/185)
tracks the release; the current editor run IDs appear below. This accepted preview is distinct
from merging the release to main; package security audit status remains pending.
(Status update 2026-09-14: PR 185 has since merged to `main` as `4e15108`.)

### Image editor installation status

Create **1.5.0 is installed** on the local preview from published source
[b92013b48d6f705138617b5816c7d49581a28257](https://github.com/emeraldcoastsystemsgroup/oshal-apps/tree/b92013b48d6f705138617b5816c7d49581a28257/create).
The running core is `2739e2501f8f8919780c8c723dbfea4dd76eccd2`, with API image
`sha256:e3b80133a6de8289f905b4211bd008ca0d9e2d2e262d94f78e8477334e1556fd`.
Activation has registered **14 Lab cases: 13 declared recipes plus generated
readiness**. Local validation passes **163 checks**, detailed below.

Final native acceptance **passes** on this installed source: import the earlier
portable JSON, save revision 1, reopen through the opaque **My projects** dialog,
export a 20,581-byte JPEG at 1200 × 800 and a 641-byte editable JSON with two
layers, then delete through the ordinary UI and confirm the project list is empty.
This final workflow used no raster assets. Earlier native checkpoints saved
revisions 1 and 2 at `6a49721e`, then reopened, exported and deleted the test
project at `8df99d58`; those observations retain their original source attribution.

Four runs started through the installed native Lab pass **45 checks** on the
source/core/image above, with matching revisions and verified sandbox cleanup:

| Installed suite | Passing checks | Run ID |
|---|---|---|
| Home | 9 | `8e933eb8-8ba8-487b-b69a-5a6eb2cf835c` |
| New | 7 | `b2286091-91b6-4cdc-a8a9-5e8a148856a8` |
| Routes | 5 | `07b3951d-2918-41d5-b99e-8c92b971f772` |
| Editor model/history | 24 | `be4e04f3-1f02-499c-95a8-0049033e82a7` |

The other linked browser and host-dependent runners remain unavailable in the
installed Lab. Their local results are separate evidence; the 163 local checks
are not 163 installed checks. Readiness registration is not an additional run
in the table above.

Final strict preservation passes: all 66 installed Create files match the staged
source, the other 58 packages are unchanged, and all 35 containers are healthy.
Authorization revision 79 and 71 assignments match the approved two-audit role
migration. All four Create project tables contain zero rows after native cleanup.

The installed correction protects the current canvas during slow portable imports,
reports gateway and timeout failures with retry guidance, and uses opaque dialog
and export-menu backgrounds. The editor's request deadline remains 20 seconds.
This is a local preview installation; merge-to-main status and package security
audit completion are separate release records.

## Tests

```bash
cd create && node --test "tests/*.test.js"

# Real Chromium proof, using an adjacent core checkout or OSHAL_CORE_ROOT:
node --test tests/browser/create-theme-proof.mjs
node --test tests/browser/create-workspace-proof.mjs
node --test tests/browser/create-scan-to-print-proof.mjs
node --test tests/browser/create-brand-proof.mjs

# Brand kit contract, HTTP boundary and PostgreSQL (the last needs Docker and postgres:16-alpine):
node --test tests/editor/brand-kit.test.mjs
node --test tests/brand-api.test.mjs tests/brand-postgres.test.mjs
```

- `tests/create-surface.test.js` — every inline script parses; the surface wears the
  bundled skin and reads framework tokens; the skin defines the complete token set and
  scopes every rule to `[data-theme="create"]`; the studio catalog and every starter name
  a rail tile the manifest declares (with matching standalone URLs); every rail tile and
  probe belongs to a declared dependency; the manifest keeps the launcher shape.
- `tests/create-routes.test.js` — real loopback HTTP against the compiled route: the
  surface and skin are served byte-for-byte with `no-store`; a package dir without them
  answers 404 JSON; the package dir is captured at factory time; the readiness smoke
  reports this package's identity.

## Build

`src-routes/*.ts` → `routes/*.js` through the framework's compiler
(`scripts/security/rebuild-store-routes.mjs`, see BUILDING-EXTENSIONS.md §5).

## Test Lab catalog (1.5.0)

[tests/test-lab.yaml](tests/test-lab.yaml) registers every shipped test and preserves the existing `package-readiness` smoke ID. Registration does not execute tests. An authorized operator can run the supported Node suites from the AI Test Lab against a sealed package snapshot; versioned results record the source revision and sandbox cleanup.

| Test entry | Level | Execution boundary |
| --- | --- | --- |
| `tests/create-surface.test.js` | unit | Isolated Node runner; synthetic data only |
| `tests/create-new.test.js` | unit | Isolated Node runner; synthetic data only |
| `tests/create-routes.test.js` | integration | Isolated Node runner; synthetic data only |
| `tests/browser/create-theme-proof.mjs` | browser | Actual Home/New HTML, shared ThemeManager and Chromium; isolated synthetic HTTP |
| `tests/browser/create-workspace-proof.mjs` | browser | Actual responsive layout, keyboard filters, exact handoffs and locked/unavailable studio behavior; isolated synthetic HTTP |
| `tests/browser/create-scan-to-print-proof.mjs` | browser | Actual Home/New 3D navigation, denied access, owner summaries, fixed standalone URL and narrow layout; isolated synthetic HTTP |

The browser suite passes nine cases covering all twelve palettes, explicit Create colors,
search/document retention, actual cross-tab storage events, fresh standalone defaults and
computed label contrast. It requires current core shared theme assets and Chromium.
The two initial palette cases failed before the bootstrap fix; separate label checks
reproduced contrast failures before the scoped color corrections.

The workspace suite adds ten real Chromium checks. Before the refinement, its
regressions reproduced duplicated templates, starter cards outside a narrow
viewport, starting-new content ahead of saved work and the lost format query on
keyboard submission. The earlier 1.4.0 catalog had seven scenarios covering six
test entry files plus readiness. Browser recipes retain explicit Chromium/core prerequisites;
registration does not make those fixtures available in a Node-only runner.

The Scan-to-Print suite adds thirteen Chromium checks for the new launchers,
access-before-summary ordering, denied/empty/unavailable states, standalone
handoffs and narrow light/dark layouts. It reproduced the missing studio and a
faint Midnight preview cube before the fixes. Embedded checks observe Create's
outgoing navigation message; platform artifact forwarding is outside that fixture.

These tests do not contact accounts, providers or live business records. Host browser proof
does not claim native installation or live studio workflow acceptance. Package readiness
remains a separate metadata-only probe.

### Image editor validation (1.5.0)

The installed catalog registers **14 Lab cases: 13 declared recipes plus generated
readiness**. Local validation passes **163 checks**: 21 static/HTTP contracts,
32 retained launcher/theme browser cases, 24 model/history cases, 12 real canvas
renderer cases, 24 complete editor UI cases, 16 editor entry-point cases, 20
project HTTP/PostgreSQL cases and 14 actual core-mounter authorization cases.
Browser suites run serially to avoid competing fixture startup deadlines.

The authorization recipe includes real concurrent writes with PostgreSQL and
the core policy store sharing two connections. Queued and post-insert revocation
preserve permission checks, rollback and cleanup. Browser regressions protect
drafts during slow imports, distinguish gateway/timeouts, and prove that canvas
content cannot show through the Daylight/Midnight dialog and export menu.

From the package directory with `OSHAL_CORE_ROOT` naming a matching core checkout:

```text
node --test tests/editor/model.test.mjs
node --test --test-concurrency=1 tests/editor/renderer-browser.test.mjs tests/browser/create-editor-proof.mjs tests/browser/create-editor-launchers-proof.mjs
node --test --test-concurrency=1 tests/project-api.test.mjs tests/project-postgres.test.mjs
node <core>/node_modules/vitest/vitest.mjs run --config tests/editor/authorization-boundary.config.mjs
```

The PostgreSQL recipe requires Docker and an already available `postgres:16-alpine`
image; it creates and removes a separate fixture container. Its credentials and
data are synthetic. Host-dependent API/PostgreSQL and Vitest recipes are registered
with explicit prerequisites; registration alone does not make them available in
the installed sealed Node runner. Every fixture and cleanup boundary appears in
the catalog. See [EDITOR.md](EDITOR.md) for supported formats and limits.
