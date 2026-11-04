# Create suite: tool parity

Roger's rule (2026-11-03): every Create application has both on-screen tools and tools for its concierge, so anything made
is editable with the tools we have. Each application should do what the standard industry application does. A tool we need
gets built; a gap goes on the backlog.

Each file measures one application against its industry application: the capability, whether the industry application calls
it basic or pro, whether it exists there on mobile and desktop, our on-screen control, our concierge tool, and a status. Each
file ends with backlog entries (`CREATE-TOOL-<APP>-nn`) that say what done looks like, ordered by what people hit first.

- **both**: a person and the concierge can each do it.
- **UX only**: on screen, and the concierge cannot do it.
- **concierge only**: the concierge can do it, and no screen control does.
- **missing**: neither.

| Application | Rows | Both | UX only | Concierge only | Missing | Backlog entries |
|---|---|---|---|---|---|---|
| [brand-graphics](brand-graphics.md) | 21 | 0 | 12 | 0 | 9 | 12 |
| [create](create.md) | 50 | 20 | 11 | 2 | 17 | 29 |
| [creative-studio](creative-studio.md) | 18 | 1 | 3 | 0 | 14 | 9 |
| [lora](lora.md) | 25 | 1 | 13 | 0 | 11 | 14 |
| [motion-studio](motion-studio.md) | 50 | 31 | 1 | 7 | 11 | 13 |
| [pdf-workbench](pdf-workbench.md) | 50 | 14 | 2 | 5 | 29 | 22 |
| [portrait-studio](portrait-studio.md) | 24 | 0 | 16 | 0 | 8 | 10 |
| [presentations](presentations.md) | 123 | 37 | 26 | 2 | 58 | 21 |
| [publishing-studio](publishing-studio.md) | 30 | 13 | 0 | 5 | 12 | 15 |
| [scan-to-print](scan-to-print.md) | 25 | 4 | 13 | 0 | 8 | 10 |
| [scene-studio](scene-studio.md) | 25 | 13 | 4 | 0 | 8 | 10 |
| [video](video.md) | 50 | 21 | 7 | 1 | 21 | 18 |
| [vids](vids.md) | 22 | 4 | 4 | 1 | 13 | 11 |
| **Total** | 513 | 159 | 112 | 23 | 219 | 194 |

## How far to trust this

Measured from the code at 1.15.3 of Create (store commit 91649a37), 2026-11-03, by reading it. Almost nothing was run, so a
row saying a control exists is not proof it works; `pdf-workbench` and the Office engine in particular were read, not run.

- **"Both" is generous in places.** A typed box counts as a control. Some rows rest on numbers typed by hand, on a generic form,
  or on a text box holding JSON or Python. Each file says which.
- **Presentations.** Its Guide proposals (`set_outline`, `update_slide`, `add_slide`, `update_cell`) are marked `Guide:` and counted
  as concierge. They work only inside the open studio, and only when the person presses Apply. It has three real tools: list,
  create deck, create document. Without the Guide proposals, 17 of its "both" rows become "UX only".
- **Industry columns.** Adobe and Canva pages refused automated reading, so many cells rest on search excerpts, store listings
  or general knowledge. Each file marks those. Treat the mobile columns as partial.
- **Tools that declare but do not run.** `brand-graphics` and `creative-studio` declare `cli` tools, and the native kernel offers
  only `api` tools or exact builtin package tools, so their concierges have none. Read from the code; no live conversation
  confirmed it.

## Since this was measured

- **Create 1.15.4:** a concierge's drawing is checked before its card is held.
- **Create 1.16.0:** a picture from a sentence, on screen and as a tool (`create-generate-image`). The `create` table predates both.
