# oshal-applications — the OSHAL app store

Installable **app packages** for [OSHAL](https://github.com/emeraldcoastsystemsgroup/open-shal).
This repo is the *store*: each top-level folder is one self-contained app package that a
swarm installs from git and hot-loads — **nothing is compiled into the swarm's core image**.

The model is [ADR-085](https://github.com/emeraldcoastsystemsgroup/open-shal/blob/main/docs/adr/085-remote-app-packages-and-registries.md):
a base swarm ships empty of apps (kernel = ticket system, loader/registries, auth, baseline
bots, APM); you grow it by installing packages from here. This is the same git-subdir
marketplace shape OSHAL already uses for connectors (ADR-067).

## Build an extension

**[BUILDING-EXTENSIONS.md](BUILDING-EXTENSIONS.md)** is the full, self-contained authoring guide
(readable by a human or an LLM) — every `oshal-app.yaml` feature, the routes rules, the
dependency lifecycle, and the CLI. Start from the example, read the reference app.

## Apps

| App | Folder | What it is | Status |
|---|---|---|---|
| **Hello OSHAL** | [`hello-oshal/`](hello-oshal/) | The minimal working example — one route + one ribbon tile. Copy it to start a new extension. | ready |
| **Little Monsters** | [`little-monsters/`](little-monsters/) | Voice-first ADHD study companion (K‑12): lecture capture, flashcards, Socratic RAG tutor. The reference app. | manifest + personas + migrations + theme complete; routes/tools extraction in progress (see its `BUILD.md`) |
| **Portrait Studio** | [`portrait-studio/`](portrait-studio/) | Photo → cropped head → generated portrait: 12 formal people profiles (LinkedIn, Graduate, Judge, …) + 12 character themes (pet's face on a human body — American Gothic pitchfork, steel mill, …), with interchangeable backgrounds × clothing × hats × finishes × framings. Uses the media-generation kernel skill (image-to-image edit). | ready (v1.1.0) — image engine needs the swarm's OpenAI credential |
| **Game Show** | [`game-show/`](game-show/) | TV-style AI game night: one AI host, players join from their phones and take podiums, and one synced state renders as a broadcast big screen / phone buzzer / host desk / spectator view. **Shows are plug-ins, not forks** ([ADR-112](https://github.com/emeraldcoastsystemsgroup/open-shal/blob/main/docs/adr/112-game-shows-as-plugins.md)) — the engine is show-agnostic; a game is one module + one `register()`. Family Feud + Jeopardy ship; a server-authoritative round clock and a host override panel mean no beat hangs and no game wedges. | live on the local swarm; 167 tests (`npm test`). Only P0 left: browser playthrough on real devices |

## What a package contains

- `oshal-app.yaml` — the manifest (bots, toolbar/UI, routes, migrations, workflow, theme,
  `settings`, `dependencies`, `provides`/`uses`). All paths package-relative.
- `personas/` — the app's bots' personas (bundled).
- `routes/` — compiled-JS Express routes, mounted in-process at activation (ADR-085 P1).
- `migrations/` — the app's own schema, applied on install.
- `ui/` — surfaces + shared CSS. `theme` selects an existing cockpit skin.
- `tools/` — the app's bundled tools.

## Catalog

[`marketplace.json`](marketplace.json) is the catalog index — the list the swarm's App
Registry reads to browse/install (each entry is a git-subdir `source`).

## Installing

**Today's working path is the CLI** (from an OSHAL checkout, where `scripts/oshal-app.js` lives):

```bash
node scripts/oshal-app.js install <app-folder>        # e.g. portrait-studio
```

It sparse-clones the pinned git-subdir, validates the package, resolves `dependencies.apps`
npm-style (fail-closed), copies it into the swarm's `deployed-apps/` and stamps
`.oshal-install.json` provenance (repo + ref + sha). The swarm auto-loads `deployed-apps/` on
boot, or hot-load via `POST /api/swarm/apps/load {path}`.

Two deployment notes:
- The install target is `$CLINE_WORKSPACE_ROOT/deployed-apps`. On the Docker stack that dir
  lives inside the `oshal_workspace` volume, and the api container holds **no GitHub
  credentials** — so run the install on the host with `--dest <staging-dir>`, `docker cp` the
  result into `oshal-local-api:/app/workspace-shared/deployed-apps/`, and restart the api.
- `POST /api/swarm/apps/install-remote` (one-call install from the catalog) is **planned, not
  built** — see the swarm-store migration plan (D7) in the OSHAL repo.

Uninstall is dependency-aware (reverse-dep check + orphan-only removal — never auto-cascade):
`node scripts/oshal-app.js uninstall <name>`.
