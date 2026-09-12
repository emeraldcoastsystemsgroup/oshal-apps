# Create (create) — OSHAL app package

The design-tool front door for everything you make with oshal. One rail, one skin,
one home page — "What will you create today?" — over the creative studios that are
already installed: **AI Office** (deck / document / workbook), **Portrait Studio**,
**Video Studio**, **LoRA Studio**, **Vids Studio** and the **Creative Studio** story
pipeline. `create.oshal.ai` lands here.

This is a launcher with a face, not a second copy of any studio. The package ships:

- **the manifest** — the Create rail (`ui.static`): its own Home tile first, then each
  member studio's *own* surface URL, grouped Studios / Pipeline; the console trays
  (tickets, chat, calendar, address book, dashboard, logs, operations), the chat rail
  and the status bar are hidden, Settings and the assistant orb stay;
- **a package-bundled cockpit skin** — [`ui/create.css`](ui/create.css), worn by the
  cockpit while `?app=create` is focused (ADR-085 bundled skin, the Little Monsters
  mechanism): white paper, a lilac→sky→mint wash, one violet accent with a violet→teal
  gradient, a 76px icon-over-label rail, gradient wordmark;
- **the home surface** — [`tools/create-home.html`](tools/create-home.html): hero +
  search, category chips, *Start creating* (ten starter shapes, each opening its
  studio), *Continue creating* (recent saved work across every studio), *Your studios*
  (built from this app's own cockpit profile, so the cards are the rail), *This week*
  (each studio's own counts);
- **the New screen** — [`tools/create-new.html`](tools/create-new.html): the "Create a design"
  flow. A categories rail (Presentations, Documents, Spreadsheets, Portraits, Video, Stories), search,
  purpose chips, and template cards drawn from each studio's own catalog — AI Office publishes what a
  deck, a document and a workbook are each *for* (`GET /api/presentations/sections/starters`), and a
  card opens AI Office already set to that kind, starter and look (`app-navigate` + a validated
  `query`, cockpit ≥ the tool-query change; standalone, the studio URL carries the same query);
- **three routes** — `GET /api/create/new`, `GET /api/create/home` and `GET /api/create/theme.css`,
  static files served from the installed package dir captured at factory time.

## How the home page gets its data (nothing is faked)

| Section | Source | Session |
|---|---|---|
| Your studios | `GET /api/ui/profile?name=create` — the rail this app is rendering right now | viewer's |
| Continue creating / This week | `GET /api/<member>/home-summary` for presentations, portrait-studio, video, lora, vids, creative-studio (the ADR-145 Home probes) | viewer's |
| Start creating | static starters, each pinned by test to a rail tile the manifest declares | — |

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
| AI Office | `/api/presentations/sections/ui` | presentations |
| Portrait | `/api/portrait-studio/app` | portrait-studio |
| Video | `/api/video/ui` | video |
| LoRA | `/api/lora/ui` | lora |
| Vids | `/api/vids/app` | vids |
| Stories | `/api/creative-studio/review` | creative-studio |

## The skin, and what wears it

The cockpit chrome (header, rail, page wash) wears `ui/create.css` the moment
`?app=create` is focused — the profile carries `themeCssUrl`, the cockpit injects it and
sets `data-theme="create"` for that page-load only, so the operator's saved global theme
is untouched on a plain `/cockpit/` visit. The home surface links the same file from
`/api/create/theme.css`.

An iframed member studio derives its palette from the framework tokens through the
shared `surface-theme.js` bootstrap. Cores that include the bundled-skin follow (the
bootstrap reads the same-origin parent's `data-theme` + `#app-package-theme-css` link)
render the studios in the Create skin too; an older core renders them in the operator's
saved theme, which is the framework's pre-existing behaviour — never a broken page.

## Dependencies

`dependencies.apps`: presentations, portrait-studio, video, lora, vids, creative-studio —
resolved npm-style on install; the reverse-dependency guard blocks a member's uninstall
while Create is active. No tools, no connectors, no bots, no schema, no queue, no
summary probe of its own (the members own their evidence — see [HOME.md](HOME.md)).

## Tests

```bash
cd create && node --test "tests/*.test.js"
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
