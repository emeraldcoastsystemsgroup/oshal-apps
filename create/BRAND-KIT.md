# Create Brand Kit — as built in 1.8.0, and how to continue it

One private brand kit per person: the colors, faces, logo and voice that every Create studio reads.
Built 2026-09-14 on store commit `df09dd73`. This file is the contract and the handover; it describes
only what exists. Anything not built is in the [phased backlog](BACKLOG.md) with its done-when.

## Next steps, in order

**1. Bring the box back (operator).** As of 2026-09-14 03:40 UTC the Docker engine itself is down on
the local box: the `dockerDesktopLinuxEngine` pipe is gone and `docker info` reports zero containers,
after hours of I/O starvation. Start Docker Desktop, then `bash scripts/oshal-up.sh` for the ordered
bring-up. Nothing here needs special handling during that boot: `deployed-apps/create` holds the
restored 1.7.1 and the three studio packages are already staged at 2.12.0 / 1.15.0 / 1.5.0.

**2. Confirm the three studios came up (anyone).** After the boot, the AI Office, Portrait and Video
rows should read those versions. Their brand buttons stay hidden until step 3, which is correct: they
ask `/api/create/brand-kit`, and Create 1.7.1 has no such route.

**3. Install Create 1.8.0 (operator, then anyone).** This is the AUTH-07 sequence below, and it exists
only because the release adds routes and therefore changes the catalog:

```bash
# a. Operator, in /access: revoke your own Create role (preview, then apply).
# b. Install the package and restart once:
git -C <store> -c core.autocrlf=false archive -o /tmp/create.tar <commit> create
docker cp /tmp/create.tar oshal-local-api:/tmp/create.tar
docker exec oshal-local-api sh -c 'tar -czf /app/output/_pkg-backups/create-pre-$(date -u +%Y%m%dT%H%M%SZ).tgz \
  -C /app/workspace-shared/deployed-apps create && rm -rf /tmp/stage && mkdir -p /tmp/stage && \
  tar -xf /tmp/create.tar -C /tmp/stage && \
  cp /app/workspace-shared/deployed-apps/create/.oshal-install.json /tmp/stage/create/.oshal-install.json && \
  rm -rf /app/workspace-shared/deployed-apps/create && mv /tmp/stage/create /app/workspace-shared/deployed-apps/create'
docker restart oshal-local-api            # activates the new catalog and applies migration 002
# c. Operator, in /access: grant the named role again. It now carries brand.read and brand.change.
```

Verify: the boot log shows one `Manifest loaded` for create with no
`authorization_catalog_migration_required`, `create_brand_kits` exists in the database, and the Brand
Kit tile opens at `/api/create/brand`.

**4. Then pick a slice.** In [BACKLOG.md](BACKLOG.md): CREATE-EDIT-11 several kits and a brand set,
CREATE-EDIT-12 the remaining studios, CREATE-EDIT-13 logo variants, CREATE-EDIT-14 recent work with
real previews, CREATE-EDIT-15 blank starts and one-tap formats. The core follow-up that lets AI Office
draw in the brand's exact colors and faces is in the core backlog, dated 2026-09-14, and needs the
operator's approval before anyone touches the renderer.

## The kit

| Field | Contents | Bounds |
|---|---|---|
| `name` | The brand name; goes on a template's signature line and on an empty AI Office cover byline | one line, 80 chars |
| `colors` | Five roles, always present: `primary`, `secondary`, `accent`, `dark` (text), `light` (background) | six-digit hex each |
| `extras` | Named swatches for the editor palette | at most 6, 40-char names |
| `fonts` | `heading` and `body` | the faces that ship with Office on Windows **and** macOS |
| `voice` | How the brand sounds; AI Office can add it to an AI draft | one line, 280 chars |
| `logo` | `{ src, width, height }` pointing at an image the same person uploaded | `/api/create/project-assets/<uuid>` only |

Roles, not a loose palette, are what let a template or another studio apply a brand without guessing.
The whole kit is capped at 8 KB so it can be read on every surface without a size question.

## Storage and ownership

`migrations/002-create-brand-kits.sql` creates `create_brand_kits`: one row per verified issuer and
subject, an optimistic `revision`, and the same exact-owner row security the project tables use
(`create.owner_issuer` / `create.owner_sub`, installed transaction-locally from the verified actor).
`logo_asset_id` is a foreign key into `create_project_assets`, so a logo is an ordinary owned Create
image with the same normalization, quota and storage, and the database refuses a logo that belongs to
someone else. `CreateProjectStore.cleanupAssets` skips an image a kit uses, and both take the same
per-owner advisory lock, so a cleanup and a save can never interleave.

## HTTP surface

Mounted inside the existing project router (`registerBrandKitRoutes`), so the manifest gains no route
entry and the store route inventory is unchanged.

| Route | Needs | Behavior |
|---|---|---|
| `GET /api/create/brand` | `project.view` | The Brand Kit page |
| `GET /api/create/brand-kit` | `project.view`, `brand.read` | `{ kit, revision, updatedAt, canChange, words }`; `kit` is null before a first save |
| `PUT /api/create/brand-kit` | `project.view`, `brand.change` | Body `{ baseRevision, kit }`; 0 for a first save, a stale page gets 409 `brand_revision_conflict` |
| `DELETE /api/create/brand-kit` | `project.view`, `brand.change` | Body `{ baseRevision }` |
| `POST /api/create/brand-kit/logo` | `project.view`, `brand.change` | One image, multipart `image`; returns the owned asset |

`words` carries the colors in plain language (`{ phrase, colors }`), derived server-side from the same
module, because a studio that describes an image to a generator needs words, not hex codes.

## Permissions

`authorization.yaml` declares a separate `brand` resource with `own` scope: `brand.read` is granted to
every role that reads projects (reader, creator, editor, exporter, admin) and `brand.change` to editor
and admin. A viewer-tier role can never write, and the runtime refuses any path the catalog does not
bind. The route rechecks the permission before work and again immediately before the commit.

## One validator, both sides

`tools/editor/brand-kit.mjs` is the single source of truth. The browser imports it; the server imports
the same file by path, keyed by its bytes (`loadBrandModule`), exactly as the project validator does.
So a kit the page accepts is exactly a kit the server stores. It also holds the color work:

- `contrast` / `readableOn` — WCAG contrast, and the brand's own text or background color when it
  reaches 4.5:1, falling back to black or white only when neither does.
- `colorName` / `palettePhrase` / `describeBrandKit` — hex to plain language ("bright violet",
  "coral", "cream").
- `brandProject(project, design.brand, kit)` — dress a fresh template in a brand.

## How a template declares its brand roles

Each design in `tools/editor/templates.mjs` carries a `brand` block:

```js
brand: {
  palette: { '#f8f3e8': 'light', '#153d35': 'dark', '#ef6b3b': 'accent' }, // every template color, by role
  roles: { 'Large garden circle': 'primary' },                            // per-layer override
  signature: { layer: 'Brand signature', text: upper },                   // where the brand name goes
  logo: { x: 820, y: 70, w: 190, h: 90, align: 'right' },                 // the logo slot
}
```

`createBrandedTemplate(id, kit)` then maps every color by role, gives bold text the heading face and
the rest the body face, writes the brand name onto the signature line, fits the logo into its slot
preserving aspect, and re-inks any text that would fall below 3:1 against whatever it now sits on. A
test asserts every color of all eight designs is mapped, for four deliberately different brands.

## What each studio does with it

- **Image editor** — a "Your brand" panel (swatches that recolor the selected layer, or the canvas
  with nothing selected; "Add logo" places the owned image with no new upload), brand and Office faces
  in the font list, and a "Show in my brand" switch in the template gallery that also paints the
  thumbnails.
- **Home** — a "Your brand" band with the name, swatches, faces and logo, or a setup prompt. It is
  read only after Create access resolves, and any refusal hides the band.
- **AI Office** — badges the built-in look nearest the brand (hue, then canvas darkness, then shared
  faces) and picks it only when nothing else chose one; fills an empty cover byline with the brand
  name; adds the brand voice to an AI draft's topic while the switch is on.
- **Portrait Studio / Video Studio** — a "Use my brand colors" button appends the colors, in words, to
  the notes or style field, once, within the field's limit.

Each consumer fetches `/api/create/brand-kit` in the viewer's own session. Without Create access, or
without a kit, every one of them behaves exactly as it did before.

## Files

| Path | Role |
|---|---|
| `migrations/002-create-brand-kits.sql` | The table, its row security and the logo foreign key |
| `src-routes/create-brand-kit-store.ts` | One row per owner, optimistic revisions, owned-logo check |
| `src-routes/create-brand-kit-routes.ts` | The five routes, the `brand` resource, revision validation |
| `tools/create-brand.html` + `tools/editor/brand-page.mjs` + `tools/editor/brand.css` | The Brand Kit page |
| `tools/editor/brand-kit.mjs` | The shared contract: validation, color math, template branding |
| `tools/editor/brand-editor.mjs` | The editor's brand panel, fonts and gallery switch |
| `tools/editor/templates.mjs` | Each design's brand roles + `createBrandedTemplate` |
| `tools/create-home.html` | The "Your brand" band |

## Tests

```bash
cd create
node --test tests/editor/brand-kit.test.mjs                      # 9  the contract and branded templates
OSHAL_CORE_ROOT=<core> node --test tests/brand-api.test.mjs       # 7  real Express/multer/sharp, strict non-writing pool
OSHAL_CORE_ROOT=<core> node --test tests/brand-postgres.test.mjs  # 6  disposable PostgreSQL, needs Docker + postgres:16-alpine
OSHAL_CORE_ROOT=<core> node --test tests/browser/create-brand-proof.mjs   # 5  real Chromium
# The real core policy runtime and route mounter (8 brand cases beside the existing 14):
cd <core> && OSHAL_CORE_ROOT=<core> node node_modules/vitest/vitest.mjs run --config <store>/create/tests/editor/authorization-boundary.config.mjs
```

Sibling packages: `presentations/tests/presentations-brand.test.js` (5),
`portrait-studio/tests/portrait-brand.test.js` (3), `video/tests/video-brand.test.js` (3). Every case is
registered in the owning package's Test Lab catalog.

## Installing it — the catalog gate

**A release that changes `authorization.yaml` cannot activate while an assignment holds the previous
catalog revision.** `catalogRevision` is a hash of `{app, source, catalog}`, so any new route (each one
adds a binding) conflicts, activation throws 409 `authorization_catalog_migration_required`, and the
app does not mount at all. This is the open core gap AUTH-07, not a package fault. Create 1.8.0 hit it
on the local box on 2026-09-14 and was rolled back to 1.7.1 there.

The reviewed sequence, which needs the operator because it touches their own access:

1. In **Access**, revoke the person's Create role (preview, then apply).
2. Install the package files and restart the api once. Activation now registers the new catalog and
   applies migration 002.
3. In **Access**, grant the named role again. It now carries `brand.read` and `brand.change`.

Rolling back is the reverse: restore `/app/output/_pkg-backups/create-pre-<TS>.tgz` over
`deployed-apps/create`, put the previous sha back in `.oshal-install.json`, and restart once.

## Known limits

- AI Office renders its own ten built-in looks. A deck, document or workbook drawn in the brand's exact
  colors and faces needs the core renderer to accept a look; recorded in the core backlog with
  done-when, not implemented.
- One kit per person. No sharing, no team kit, no per-project kit.
- Raster logos only (PNG, JPEG, WebP), one of them, with no dark-background variant.
- Vids, Stories, LoRA and Scan-to-Print do not read the kit yet.

## How to continue

Start with whichever of these the operator wants; each is a self-contained slice.

1. **Several kits and a brand set** (CREATE-EDIT-11). The table already keys on the owner; a kit id
   turns it into a collection. The page needs a switcher and the consumers a chosen-kit parameter.
2. **The rest of the studios** (CREATE-EDIT-12). Vids, Stories and Scan-to-Print read the same
   endpoint; the New screen can draw its cards in the brand.
3. **Logo variants** (CREATE-EDIT-13). A mark for dark surfaces and a square avatar, chosen by the
   contrast of the surface a template places it on.
4. **AI Office in the exact brand** — core, see the core backlog entry from 2026-09-14.

The shared module is the seam: anything that needs to reason about a brand should import it rather
than re-derive color math, and any new consumer should fail closed and silent when the kit is refused.
