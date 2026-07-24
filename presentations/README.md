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

## Surfaces

| Tile | URL | What |
|---|---|---|
| AI Office | `/api/presentations/sections/ui` | The studio: outline → deck/doc/workbook |

## Install

```bash
node scripts/oshal-app.js install presentations
```

No migrations — `oshal_presentations` is lazy DDL carried by the packaged route
(CREATE + owner RLS at the chokepoint). The table stays in place across
install/toggle; uninstall never touches data.
