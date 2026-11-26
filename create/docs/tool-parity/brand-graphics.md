# Brand Graphics: parity audit against Canva Brand Kit and Adobe Express

`brand-graphics` 1.4.3 turns brief-based brand motion graphics into an in-app workflow with real API concierge tools (`brand_graphic` on `POST /api/brand-graphics/renders`, held for approval, and read-only `brand-graphics-job-status` on `GET /api/brand-graphics/renders`), full brief fields (`title`, `sourceLink`, `voiceover`, `music`), personal brand-kit rendering (`brandStyle: "my-brand" | "oshal"`), and selectable length (`5–60s`), aspect (`16:9`, `9:16`, `1:1`), and MP4 output with in-app `<video>` preview and MP4 download. The brand kit editor people compare with Canva lives in the sibling package `create` (`create/tools/create-brand.html`), so rows below say which package holds each control. It is measured against Canva Brand Kit and Adobe Express, where a kit's colors, fonts and logos flow into every design. Rows 16–21 are full parity in `brand-graphics` 1.4.3; `CREATE-TOOL-BRAND-01`..`-03` are now delivered in `create` `1.20.5` (`create-read-brand-kit`, `create-update-brand-kit`, `create-apply-brand`, and `#applyBrandBtn`); `-08`..`-11` remain open.

## Table

How to read it:
- Our side comes from reading the snapshot. Nothing here was run. `review.html` means `brand-graphics/tools/review.html`. `create-brand.html` means `create/tools/create-brand.html`, `editor.html` means `create/tools/create-editor.html`, and `brand-editor.mjs` is `create/tools/editor/brand-editor.mjs`.
- Why `brand_graphic` counts as not offered: its executor is `cli` in `brand-graphics/oshal-app.yaml`; the native kernel offers concierges only `api` executor tools (`crates/oshald/src/package_api_tools.rs`, `api_executor`) or exact builtin package tools (`crates/packages/src/tool_contract.rs`); and `personas/brand-graphics.yaml` says that in a conversation it holds no tool. I did not run a conversation to confirm.
- Create declares `create-read-brand-kit`, `create-update-brand-kit`, and `create-apply-brand` in `create/oshal-app.yaml` (`1.20.5`).
- Letters in brackets are sources, listed at the end. [K] means general product knowledge, not re-read. Canva's own pages refused automated fetches (HTTP 403), so its facts are third-party and those sources disagree on limits. "n/c" means not confirmed. Tier: basic is on the free plan; pro is paid.

| # | Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|---|
| 1 | Brand name | basic | n/c | Canva: n/c | `#brandName`, `create-brand.html` (in `create`) | `create-read-brand-kit`, `create-update-brand-kit` (in `create` `1.20.5`) | both (`create` `1.20.5`) |
| 2 | Upload a logo | basic (Canva), pro (Express) | n/c | Canva: PNG, JPG, SVG; 2 logos on Free per one guide, none per another [B][E]; Express: Premium [A] | `#uploadLogo`, `#removeLogo`, `create-brand.html` (PNG, JPEG, WebP; no SVG) | `create-update-brand-kit` sets logo from an owned image ref (in `create` `1.20.5`) | both (`create` `1.20.5`) |
| 3 | Brand colors | basic | n/c | Canva Free: 3 color slots [B] | `#roleColors`, `#addExtra`, `create-brand.html`; contrast readout `#contrast` | `create-read-brand-kit`, `create-update-brand-kit` (in `create` `1.20.5`) | both (`create` `1.20.5`) |
| 4 | Pick colors from the logo | basic | n/c | Canva: sample from an uploaded image, tier n/c [B] | `#suggestColors`, `create-brand.html` | none | UX only |
| 5 | Choose brand fonts | basic (Canva), pro (Express) | n/c | Canva: 2 fonts on Free per one guide [B]; Express: Premium [A] | `#headingFont`, `#bodyFont`, `#pairings`, `create-brand.html`: fixed list in `create/tools/editor/brand-kit.mjs` | `create-read-brand-kit`, `create-update-brand-kit` (in `create` `1.20.5`) | both (`create` `1.20.5`) |
| 6 | Upload a custom font | pro | n/c | Canva: Pro [B] | none | none | missing |
| 7 | Brand voice for written copy | pro | n/c | Canva: Brand Voice from writing samples, part of Magic Studio [B] | `#brandVoice`, `create-brand.html` | `create-read-brand-kit`, `create-update-brand-kit` (in `create` `1.20.5`) | both (`create` `1.20.5`) |
| 8 | Start a template in the brand | pro | n/c | Express: brand kit, Premium [A] | `#brandTemplates`, `#openTemplates`, `editor.html` and `create-brand.html` (in `create`) | none | UX only |
| 9 | Put brand colors and logo on a design by hand | pro | n/c | Canva, Express: yes [A][B] | swatches and `#addLogo`, `brand-editor.mjs` (in `create`) | `create-read-brand-kit` + `create-apply-edits` (in `create` `1.20.5`) | both (`create` `1.20.5`) |
| 10 | Apply the brand to a whole existing design in one action | pro | n/c | Canva: Apply Brand Kit through Canva AI; plan n/c [F] | `#applyBrandBtn` ("Apply my brand") in `editor.html` / `brand-editor.mjs` (in `create` `1.20.5`) | `create-apply-brand` (`POST /api/create/projects/{input.id}/apply-brand`, held for approval, in `create` `1.20.5`) | both (`create` `1.20.5`) |
| 11 | Several brand kits | pro | n/c | Canva Pro: several; one guide says both unlimited and 100 [B] | none: `/brand-kit` holds one record per owner (`create/src-routes/create-brand-kit-routes.ts`); `CREATE-EDIT-11` in `create/BACKLOG.md` already names it | none | missing |
| 12 | Logo variants; brand photos, graphics, icons library | pro | n/c | Canva: logo variants; photos, graphics, icons on Pro [B] | none (`CREATE-EDIT-13` in `create/BACKLOG.md` names logo variants) | none | missing |
| 13 | Shared team kit and locked brand templates | pro | n/c | Express: Free can use shared branded templates, Premium can create them and set brand controls [C] | none (the kit is private to one person) | none | missing |
| 14 | Resize a brand design to many formats | pro | n/c | Express: Premium [A]; Canva: Pro [D] | none | none | missing |
| 15 | Make a static on-brand post or banner | basic | n/c | Canva, Express: core use [A][B] | Image editor with brand kit (in `create`); persona for this package says do not select it for static images | none (no brand read) | UX only |
| 16 | Write a brief for a motion clip | basic | n/c | Express: animate and video, details n/c | `#notes`, `#title`, `#sourceUrl`, `#mode`, `#voiceover`, `#music`, `review.html`; all fields sent to `POST /api/brand-graphics/renders` | `brand_graphic` (`POST /api/brand-graphics/renders`, held for approval) and `brand-graphics-source-*` | full parity (`1.4.3`) |
| 17 | Render a brand motion clip | pro | n/c | n/c as a one-brief product | `#render`, `review.html`, posts `POST /api/brand-graphics/renders`; renders MP4 locally via `ffmpeg` or refuses honestly (`worker_unavailable`) queuing nothing | `brand_graphic` (`api` executor on `POST /api/brand-graphics/renders`, `requiresApproval: true`) | full parity (`1.4.3`) |
| 18 | Motion clip in the person's own brand kit | pro | n/c | n/c | `#brandStyle` (`my-brand` / `oshal`), `#brandKit`, `review.html`; reads owner's brand kit with per-owner isolation | `brand_graphic` (`brandStyle: "my-brand" \| "oshal"`) | full parity (`1.4.3`) |
| 19 | Voiceover and music choices on a clip | pro | n/c | Express: video tools, details n/c | `#voiceover`, `#music` (`none`, `clean-pulse`, `warm-ambient`, `broadcast-sting`), `review.html` | `brand_graphic` (`voiceover`, `music`) | full parity (`1.4.3`) |
| 20 | Choose length, aspect and format; preview and edit inside the app | basic | n/c | Express: export formats and 4K on Premium [A] | `#durationSec` (5–60s), `#aspect` (`16:9`, `9:16`, `1:1`), `#format` (`mp4`), inline `<video controls>` preview + Download MP4 in `#records` | `brand_graphic` (`durationSec`, `aspect`, `format`) | full parity (`1.4.3`) |
| 21 | See past jobs and their state | basic | n/c | Canva, Express: yes [K] | `#records`, `#metrics`, `#refresh`, `review.html`; `/api/brand-graphics/renders` & `/api/brand-graphics/home-summary` | `brand-graphics-job-status` (`GET /api/brand-graphics/renders`, `auto`, read-only) | full parity (`1.4.3`) |

## Backlog

Ordered by what people hit first.

- **CREATE-TOOL-BRAND-01: The concierge can read the brand kit.** Delivered in `create` `1.20.5`: read-only `create-read-brand-kit` (`GET /api/create/brand-kit`, `auto`) returns brand name, role/extra colors, fonts, voice, logo reference, revision, and plain-language color words.
  Done when: asked "what are my brand colors and fonts?", the concierge answers from a tool call and the answer matches the Brand Kit page.
- **CREATE-TOOL-BRAND-02: The concierge can change the brand kit.** Delivered in `create` `1.20.5`: approval-held `create-update-brand-kit` (`PUT /api/create/brand-kit`, `ask`) validates with the same shared `brand-kit.mjs` limits and accepts owned `/api/create/project-assets/<uuid>` logo references.
  Done when: "make my accent color #0a84ff" shows a card, and after approval the page and templates show the new color.
- **CREATE-TOOL-BRAND-03: Apply the brand to a design in one action.** Delivered in `create` `1.20.5`: `#applyBrandBtn` ("Apply my brand") in Create's image editor and approval-held `create-apply-brand` (`POST /api/create/projects/{input.id}/apply-brand`) share `applyBrandToProject` in `brand-kit.mjs`, mapping background, shapes, text fonts/colors and placing the owned logo once in one single undo step / revision, returning every layer change.
  Done when: a person presses Apply my brand on a non-branded template; colors and fonts change, the logo appears once, and undo restores all of it. The concierge's result matches.
- **CREATE-TOOL-BRAND-04: Give the concierge real render and job-status tools.** Delivered in `brand-graphics` `1.4.3`: replaced `cli` on `brand_graphic` with an `api` tool on `POST /api/brand-graphics/renders` (`requiresApproval: true`, `defaultAuthMode: ask`), added read-only `brand-graphics-job-status` on `GET /api/brand-graphics/renders`, recorded jobs under Recorded work, and refused with `503 worker_unavailable` queuing nothing when no renderer/worker is available.
- **CREATE-TOOL-BRAND-05: Send everything the form collects, and add voiceover and music.** Delivered in `brand-graphics` `1.4.3`: `title`, `sourceLink`, `voiceover`, and `music` (`none`, `clean-pulse`, `warm-ambient`, `broadcast-sting`) are collected on `review.html`, accepted by `brand_graphic` / `POST /api/brand-graphics/renders`, saved in job records, and passed into the `ffmpeg` render pipeline.
- **CREATE-TOOL-BRAND-06: Motion clips in the person's own brand.** Delivered in `brand-graphics` `1.4.3`: reads the signed-in owner's brand kit (request snapshot, Create brand kit, or owner-scoped saved brand kit) with strict per-owner isolation and explicit `brandStyle: "my-brand" | "oshal"` on screen and in `brand_graphic`, rendering the resolved brand name and colors into the clip.
- **CREATE-TOOL-BRAND-07: Length, aspect and format, and a result that opens here.** Delivered in `brand-graphics` `1.4.3`: `durationSec` (5–60s), `aspect` (`16:9` 1280×720, `9:16` 720×1280, `1:1` 720×720), and `format` (`mp4`) controls on screen and in `brand_graphic`, with in-app `<video controls>` preview and owner-scoped MP4 download (`/api/brand-graphics/renders/:id/download`) under `OSHAL_PACKAGE_DATA_DIR`.
- **CREATE-TOOL-BRAND-08: Multi-format resize for brand designs.** Tracked as CREATE-TOOL-CREATE-18; a brand-graphics surface links to it.
  Done when: a brand design produces square, story and banner copies, with brand fonts and logo intact.
- **CREATE-TOOL-BRAND-09: SVG logo and custom fonts.** Safe SVG handling and an upload with a rights confirmation.
  Done when: an SVG logo stays sharp at 4x export, and an uploaded font appears in the kit and renders in a PNG.
- **CREATE-TOOL-BRAND-10: Several kits and brand assets.** Continues `CREATE-EDIT-11` and `CREATE-EDIT-13`: named kits, logo variants, a library of brand photos and icons, with tools.
  Done when: a person switches kit while viewing templates and the previews change; the concierge can name the kit to use.
- **CREATE-TOOL-BRAND-11: Shared kit and locked brand templates for a team.**
  Done when: an administrator shares a kit, a member uses it and cannot change it, and a locked template refuses edits to locked layers on screen and through the concierge.

## Sources

Read directly unless marked. No source settled which brand controls exist in the Canva or Express phone apps, so those cells stay n/c.

- [A] Adobe Express plan table: https://www.adobe.com/express/fragments/pricing-table/individuals-ff-bundle.plain.html
- [B] It Source Code, Canva Brand Kit setup guide (third party; contradicts itself on kit limits): https://itsourcecode.com/canva/canva-brand-kit-setup/
- [C] Adobe Express individuals and teams comparison: https://www.adobe.com/express/fragments/pricing-table/individuals-and-teams
- [D] Style Factory, Canva Pro vs Free (search excerpt): https://www.stylefactoryproductions.com/blog/canva-pro-vs-free
- [E] Sparxno guide, free kit has no logos or fonts (search excerpt; site did not load on fetch): https://sparxno.com/blog/canva-brand-kit
- [F] Canva help, on-brand designs (search excerpt; page refused fetch): https://www.canva.com/help/create-on-brand-designs/
- Canva's Brand Kit page, for the reader, not read here: https://www.canva.com/en_in/pro/brand-kit/
