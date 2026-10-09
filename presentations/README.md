# AI Office (presentations) — OSHAL app package

One outline, three artifacts (ADR-103): a themed **PowerPoint deck**, **Word document**,
or **live Excel workbook** — ten shared themes, twenty layouts, real editable Office
structure. AI drafts the outline from a topic (comms bot), the deck-builder agent guides
and drives the editor, and artifacts save to whichever office world you live in
(Dropbox / Google Drive / OneDrive / GitHub / OSHAL local, ADR-108).

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 2). This is a **"skill with a
surface"** carve — only the surface layer ships here:

- **In this package:** the app manifest, the `/api/presentations/sections` route
  (studio surface, theme/layout catalog, "My decks" list, deck-builder guide chat,
  pptx/docx/xlsx generation, Office import, owner-scoped delete, approval-gated
  email-it and explicit-confirmation Slack file delivery), the studio surface (`tools/presentations.html`), and a package copy of
  the deck-builder persona for the registrar.
- **Stays in the OSHAL kernel:** the deck-generation ENGINE
  (`@/features/presentation-generation` — renderers, themes, layouts, office-import;
  a contracted Tier-0b kernel skill other packages call too), the legacy Presentron
  proxy at `/api/presentations` (framework Settings service-runtime tile), the
  storage-target save layer (ADR-041), the email senders, and the deck-builder bot
  node (container + LOCAL-registry block + core persona, ADR-093 interim).

## Roadmap specs

| Doc | What |
|---|---|
| [docs/meeting-recap-spec.md](docs/meeting-recap-spec.md) | Recording → timeline of text+images → summary with highlighted screenshots → review PPTX. Pipeline proven on the JMN requirement sessions (166 min, three recordings); local-only transcription, faces cropped, one reasoning step. |

## Surfaces

| Tile | URL | What |
|---|---|---|
| AI Office | `/api/presentations/sections/ui` | Guided front door (make → look → start, or talk / upload / one-line draft) over the fine-tune studio: outline → deck/doc/workbook. Deep link: `?kind=pptx\|docx\|xlsx&starter=<id>&theme=<id>&topic=<text>` opens the studio on that purpose (a kind alone lands on the walkthrough's purpose step) |
| Starters | `GET /api/presentations/sections/starters` | The purpose-first starter catalog (`src-routes/office-starters.ts`): per kind, grouped — a document is a resume, a flyer, a letter, a report; a spreadsheet is a budget, a plan, a tracker, an invoice; a deck tells a story, explains, runs a meeting or sells. Served like `/themes` so the studio and the Create front door render one catalog |

The surface opens on a full-screen visual walkthrough — pick the artifact, pick a look
(live-drawn theme cards from the real render catalog), then a starter shape, one typed
line AI drafts end-to-end, a live build with the Guide, or an existing file to remix.
Skip (or Esc) drops to the studio — the detailed outline editor, syntax reference and
options — and ✨ Walkthrough in the studio header brings the front door back. Guarded by
`tests/presentations-surface-parse.test.js` (inline-script parse + walkthrough contract).

## Where your file goes (ADR-043 item A)

The action bar carries a save-target chip such as **Saving to Google Drive / Decks**. It tells
the caller where the next Generate will put the artifact before spending a render. Clicking the
chip opens Options and focuses the existing **Save to** control; choosing an override refreshes
the chip immediately and labels the selection **(just this one)**.

`GET /api/presentations/sections/destination` returns
`{ provider, folder, repo, subfolder, isDefault }` for the authenticated caller. A validated
`?provider=` previews an override without persisting it, anonymous requests return `401` before
any preference read, and resolution failure returns `502` rather than a guessed destination.
Artifacts land beneath the deck-builder bot's `oshal/{bot-id}` subfolder on the resolved target.

`tests/presentations-destination.test.mjs` exercises the compiled route through its framework
seams and pins the surface-to-endpoint contract, including provider-list parity.

## Your brand (2.13.0)

When the signed-in person has a brand kit in Create, the studio reads it in their own session
(`GET /api/create/brand-kit`; without Create access or a kit nothing below happens). It badges
the built-in look nearest the kit as **Closest to your brand**, then asks
`POST /api/presentations/sections/brand-look` for the exact look. The body is
`{ base, colors, fonts }`: the nearest look's id, the kit's five role colors and its heading and
body faces. The kernel's `brandTheme` builds the look from that body: the kit's colors and faces on
the base look's layout, cover and decoration, with the id `brand:<base>`.

**Your brand** then leads both look galleries. It is picked only when nothing else chose a look (a
deep link, a starter, a click or a reopened file). Generate, Email and Slack send the kit as
`brand` in place of a theme id. The server rebuilds and validates the kit on every render, so the
.pptx, .docx and .xlsx come out in the kit's exact colors and faces. The response and the
caller's `oshal_presentations` record name the look `brand:<base>`, so a file's record says it was
drawn in a brand look and on which layout. Reopening a saved brand file picks today's brand look.

An invalid kit is a `400` with `error: invalid_brand_look` and the engine's reason. The check runs
before any outline draft, render, save, record or send. If the brand look cannot be built or
reached, the nearest built-in look stays picked. This needs a framework whose deck engine has
`brandTheme` (core ADR-103 addendum). On an older framework `POST /brand-look` fails, and the
studio keeps the nearest built-in look as in 2.12.

## Install

```bash
node scripts/oshal-app.js install presentations
```

No migrations — `oshal_presentations` is lazy DDL carried by the packaged route
(CREATE + owner RLS at the chokepoint). The table stays in place across
install/toggle; uninstall never touches data.

## Test Lab catalog (2.12.5)

[tests/test-lab.yaml](tests/test-lab.yaml) registers every shipped test and preserves the existing `package-readiness` smoke ID. Registration does not execute tests. An authorized operator can run the supported Node suites from the AI Test Lab against a sealed package snapshot; versioned results record the source revision and sandbox cleanup.

| Test entry | Level | Execution boundary |
| --- | --- | --- |
| `tests/presentations-surface-parse.test.js` | unit | Isolated Node runner; synthetic data only |
| `tests/presentations-starters.test.js` | unit | Isolated Node runner; synthetic data only |
| `tests/presentations-destination.test.mjs` | unit | Isolated Node runner; synthetic data only |
| `tests/presentations-guide.test.mjs` | unit | Isolated Node runner; bounded Guide actions only |
| `tests/presentations-guide-artifact.test.mjs` | integration | Disposable local store; real kernel PPTX renderer; no provider or recipient |
| `tests/presentations-guide-browser.test.mjs` | browser | Disposable Chromium; shipped AI Office DOM, same-origin Guide/Generate and owner-scoped local receipt; no external traffic |
| `tests/presentations-slack-delivery.test.mjs` | integration | Rendered Office artifact handed to an injected owner Slack token; confirmation refusal and no real network |
| `tests/presentations-brand.test.js` | unit | The surface's own brand code in a script context: nearest look, the exact brand look, what renders send, reopening |
| `tests/brand-look-render.core.spec.mjs` | integration | Compiled route with the framework's own deck engine (`OSHAL_CORE_ROOT`); brand colors and faces read back from each generated file; refusals before any draft, save or send |

The Guide-to-artifact acceptance tests prove the signed-in Guide response, editor bridge vocabulary, real PPTX structure, owner-scoped local receipt, and absence of email/delete side effects. The Guide requests direct, non-agentic reasoning because the bot proposes bounded JSON editor actions; the browser applies only validated actions and never gives the bot an editor tool or external send permission. A protected remote turn also requires the controller's configured provider authority stamp. The browser case walks the shipped AI Office HTML from its Guide entry path through the visible editor and Generate control over same-origin loopback HTTP, while rejecting external traffic. The Slack case proves the explicit-confirmation and owner-token handoff with an injected upload seam. These are disposable local proofs: they do not contact accounts, providers, mailboxes or live business records, so they do not claim live connector delivery or external-recipient acceptance. Teams, Twilio and expiry/recipient proof remain open. Package readiness remains a separate metadata-only probe.

## Installed Guide acceptance (2026-09-26)

Core `07b1100f` and Presentations 2.12.5 were installed on the local stack; the
package manifest remained active and the loader reported `presentations` loaded.
In a signed-in owner session, the Guide accepted a fictional three-slide
“Greenhouse Demo Proof” request and replied with a validated editor receipt:
`set the title · wrote 3 slides`. The title and three-slide outline appeared in
the live editor. Generate then reported the Midnight-theme `.pptx` saved to
**OSHAL local**, and `My files` listed `Greenhouse Demo Proof.pptx` for Sep 26.
No email, Slack, external save target, or share action was invoked. This is
live Guide → editor → owner-local artifact proof, not live external-delivery
proof or an assertion that unrelated Jarvis/ticket probes passed.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **128 / 512 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| ai-outline-draft | deck, document or sheet outline | T2 | none | template | not yet measured | none recorded |
| deck-guide | guide chat turn | T2 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
