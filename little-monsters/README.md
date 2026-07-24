# Little Monsters — an OSHAL app package

Voice-first ADHD study companion for K‑12 students: record lectures, auto-generate
flashcards and quizzes, and chat with a Socratic tutor grounded in each class's
textbook via RAG.

This is an **OSHAL app package** ([ADR-085](https://github.com/emeraldcoastsystemsgroup/open-shal/blob/main/docs/adr/085-remote-app-packages-and-registries.md)) —
a self-contained folder installed from git into a swarm and hot-loaded, with **nothing
compiled into the core image**. It is the first app carved out of the OSHAL monolith to
prove the format.

## What's in the package

| Path | What it is |
|---|---|
| `oshal-app.yaml` | The manifest — bots, toolbar/UI, routes, migrations, workflow, theme, settings, dependencies. Every path inside is package-relative. |
| `personas/` | The 6 education bots + the shared `education-foundation` persona. |
| `migrations/` | The app's own schema (`019`–`021`), applied idempotently on install. |
| `ui/education.css` | Shared CSS for the app's surfaces. |
| `routes/` | Compiled-JS Express routes, mounted in-process at activation. **Produced by the build — see [BUILD.md](BUILD.md).** |
| `tools/` | The app's bundled tools. **Produced by the build — see [BUILD.md](BUILD.md).** |

## Dependencies

Little Monsters surfaces a Presentations tab, so it **depends on the `presentations`
app** (declared in `oshal-app.yaml → dependencies.apps`). The installer resolves and
ref-counts it; it is protected from removal while Little Monsters remains installed.

## Theme

`theme: little-monsters` selects an existing OSHAL cockpit skin — the package chooses a
registered theme id, it does not override core CSS.

## Install (once the store installer lands — ADR-085 P3)

```
POST /api/swarm/apps/install-remote { "source": "little-monsters" }
```

Until then it loads via the standard path once its routes are built (see BUILD.md):
`APP_PACKAGE_DYNAMIC_ROUTES=1` + drop the built package into the swarm's `deployed-apps/`.
