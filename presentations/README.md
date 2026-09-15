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
  email-it), the studio surface (`tools/presentations.html`), and a package copy of
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

## Install

```bash
node scripts/oshal-app.js install presentations
```

No migrations — `oshal_presentations` is lazy DDL carried by the packaged route
(CREATE + owner RLS at the chokepoint). The table stays in place across
install/toggle; uninstall never touches data.

## Test Lab catalog (2.11.2)

[tests/test-lab.yaml](tests/test-lab.yaml) registers every shipped test and preserves the existing `package-readiness` smoke ID. Registration does not execute tests. An authorized operator can run the supported Node suites from the AI Test Lab against a sealed package snapshot; versioned results record the source revision and sandbox cleanup.

| Test entry | Level | Execution boundary |
| --- | --- | --- |
| `tests/presentations-surface-parse.test.js` | unit | Isolated Node runner; synthetic data only |
| `tests/presentations-starters.test.js` | unit | Isolated Node runner; synthetic data only |
| `tests/presentations-destination.test.mjs` | unit | Isolated Node runner; synthetic data only |

These tests do not contact accounts, providers or live business records. Surface syntax and stubbed-handler assertions do not claim browser or connector acceptance. Package readiness remains a separate metadata-only probe.
