# Brand Graphics: parity audit against Canva Brand Kit and Adobe Express

`brand-graphics` 1.1.5 is small: a page where a person writes a brief and asks a Google Vids worker to render one fixed look, the electric "oshal" intro or bumper, and a list of past jobs. It does not read anyone's brand kit. The brand kit people compare with Canva lives in the sibling package `create` (`create/tools/create-brand.html`), so rows below say which package holds each control. It is measured against Canva Brand Kit and Adobe Express, where a kit's colors, fonts and logos flow into every design. This package itself provides 3 of the 21 rows (16, 17, 21), all UX only. Its one declared tool, `brand_graphic`, is not offered to the concierge.

## Table

How to read it:
- Our side comes from reading the snapshot. Nothing here was run. `review.html` means `brand-graphics/tools/review.html`. `create-brand.html` means `create/tools/create-brand.html`, `editor.html` means `create/tools/create-editor.html`, and `brand-editor.mjs` is `create/tools/editor/brand-editor.mjs`.
- Why `brand_graphic` counts as not offered: its executor is `cli` in `brand-graphics/oshal-app.yaml`; the native kernel offers concierges only `api` executor tools (`crates/oshald/src/package_api_tools.rs`, `api_executor`) or exact builtin package tools (`crates/packages/src/tool_contract.rs`); and `personas/brand-graphics.yaml` says that in a conversation it holds no tool. I did not run a conversation to confirm.
- Create declares no brand tool at all (`create/oshal-app.yaml`), and its persona says so.
- Letters in brackets are sources, listed at the end. [K] means general product knowledge, not re-read. Canva's own pages refused automated fetches (HTTP 403), so its facts are third-party and those sources disagree on limits. "n/c" means not confirmed. Tier: basic is on the free plan; pro is paid.

| # | Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|---|
| 1 | Brand name | basic | n/c | Canva: n/c | `#brandName`, `create-brand.html` (in `create`) | none | UX only |
| 2 | Upload a logo | basic (Canva), pro (Express) | n/c | Canva: PNG, JPG, SVG; 2 logos on Free per one guide, none per another [B][E]; Express: Premium [A] | `#uploadLogo`, `#removeLogo`, `create-brand.html` (PNG, JPEG, WebP; no SVG) | none | UX only |
| 3 | Brand colors | basic | n/c | Canva Free: 3 color slots [B] | `#roleColors`, `#addExtra`, `create-brand.html`; contrast readout `#contrast` | none | UX only |
| 4 | Pick colors from the logo | basic | n/c | Canva: sample from an uploaded image, tier n/c [B] | `#suggestColors`, `create-brand.html` | none | UX only |
| 5 | Choose brand fonts | basic (Canva), pro (Express) | n/c | Canva: 2 fonts on Free per one guide [B]; Express: Premium [A] | `#headingFont`, `#bodyFont`, `#pairings`, `create-brand.html`: fixed list in `create/tools/editor/brand-kit.mjs` | none | UX only |
| 6 | Upload a custom font | pro | n/c | Canva: Pro [B] | none | none | missing |
| 7 | Brand voice for written copy | pro | n/c | Canva: Brand Voice from writing samples, part of Magic Studio [B] | `#brandVoice`, `create-brand.html` | none | UX only |
| 8 | Start a template in the brand | pro | n/c | Express: brand kit, Premium [A] | `#brandTemplates`, `#openTemplates`, `editor.html` and `create-brand.html` (in `create`) | none | UX only |
| 9 | Put brand colors and logo on a design by hand | pro | n/c | Canva, Express: yes [A][B] | swatches and `#addLogo`, `brand-editor.mjs` (in `create`) | none: `create-apply-edits` could set a hex, but no tool reads the kit | UX only |
| 10 | Apply the brand to a whole existing design in one action | pro | n/c | Canva: Apply Brand Kit through Canva AI; plan n/c [F] | none | none | missing |
| 11 | Several brand kits | pro | n/c | Canva Pro: several; one guide says both unlimited and 100 [B] | none: `/brand-kit` holds one record per owner (`create/src-routes/create-brand-kit-routes.ts`); `CREATE-EDIT-11` in `create/BACKLOG.md` already names it | none | missing |
| 12 | Logo variants; brand photos, graphics, icons library | pro | n/c | Canva: logo variants; photos, graphics, icons on Pro [B] | none (`CREATE-EDIT-13` in `create/BACKLOG.md` names logo variants) | none | missing |
| 13 | Shared team kit and locked brand templates | pro | n/c | Express: Free can use shared branded templates, Premium can create them and set brand controls [C] | none (the kit is private to one person) | none | missing |
| 14 | Resize a brand design to many formats | pro | n/c | Express: Premium [A]; Canva: Pro [D] | none | none | missing |
| 15 | Make a static on-brand post or banner | basic | n/c | Canva, Express: core use [A][B] | Image editor with brand kit (in `create`); persona for this package says do not select it for static images | none (no brand read) | UX only |
| 16 | Write a brief for a motion clip | basic | n/c | Express: animate and video, details n/c | `#notes`, `#title`, `#sourceUrl`, `#mode`, `review.html`; only the brief and mode are sent | none (persona can help with the wording in prose) | UX only |
| 17 | Render a brand motion clip | pro | n/c | n/c as a one-brief product | `#render`, `review.html`, posts `/api/vids/brand`; needs a signed-in Vids worker | `brand_graphic` declared, not offered (see above) | UX only |
| 18 | Motion clip in the person's own brand kit | pro | n/c | n/c | none: fixed oshal look; `review.html` and `src-routes/` never read the kit | none | missing |
| 19 | Voiceover and music choices on a clip | pro | n/c | Express: video tools, details n/c | none: `voiceover` and `music` exist only in the tool input that is not offered | none usable | missing |
| 20 | Choose length, aspect and format; preview and edit inside the app | basic | n/c | Express: export formats and 4K on Premium [A] | none: the result is a project link in Google Vids | none | missing |
| 21 | See past jobs and their state | basic | n/c | Canva, Express: yes [K] | `#records`, `#metrics`, `#refresh`, `review.html`; `/api/brand-graphics/home-summary` | none | UX only |

## Backlog

Ordered by what people hit first.

- **CREATE-TOOL-BRAND-01: The concierge can read the brand kit.** A read tool in `create`.
  Done when: asked "what are my brand colors and fonts?", the concierge answers from a tool call and the answer matches the Brand Kit page.
- **CREATE-TOOL-BRAND-02: The concierge can change the brand kit.** A held tool over `PUT /api/create/brand-kit`, with the same limits, and logo set from an owned image.
  Done when: "make my accent color #0a84ff" shows a card, and after approval the page and templates show the new color.
- **CREATE-TOOL-BRAND-03: Apply the brand to a design in one action.** Maps text, shape and background layers to kit roles, by button and tool, as one undo step.
  Done when: a person presses Apply my brand on a non-branded template; colors and fonts change, the logo appears once, and undo restores all of it. The concierge's result matches.
- **CREATE-TOOL-BRAND-04: Give the concierge real render and job-status tools.** Replace the `cli` executor with an `api` tool on a route inside this package (the kernel refuses a tool endpoint outside the package's own mounts), held for approval.
  Done when: "make a 10-second intro for the daily recap" shows a card, approving queues a job, and it appears under Recorded work. With no worker it says so and queues nothing. A read tool answers "how did my last build go?" from the same records.
- **CREATE-TOOL-BRAND-05: Send everything the form collects, and add voiceover and music.** Title and source link are collected and dropped today.
  Done when: a job's saved record shows title, source link, voiceover line and music choice, and the render uses them. Fields are available on screen and in the tool.
- **CREATE-TOOL-BRAND-06: Motion clips in the person's own brand.** Read the kit for name, logo and colors instead of the fixed oshal look, with the oshal look as one option.
  Done when: two accounts with different kits get clips showing their own name and colors.
- **CREATE-TOOL-BRAND-07: Length, aspect and format, and a result that opens here.** Choose them first; preview in the app; download an MP4.
  Done when: a person picks 9:16 at 10 seconds and plays and downloads the result from this page, without opening Google Vids.
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
