# Building an OSHAL extension (app package)

This is the complete, self-contained guide to authoring an installable **OSHAL app package**
— an extension the swarm installs from this repo and hot-loads, with **nothing compiled into
the swarm's core**. It is written to be read by a human *or* an LLM: given only this repo, you
should be able to build a working extension using every available feature.

- Working example to copy: [`hello-oshal/`](hello-oshal/)
- Full reference app (open source): [`little-monsters/`](little-monsters/)
- Architecture & rationale: ADR-085 in the OSHAL repo.

---

## 1. Mental model — it's npm, for swarm apps

| npm | OSHAL extension |
|---|---|
| `package.json` | **`oshal-app.yaml`** (the definition file) |
| package code | `routes/*.js`, `tools/` |
| npm registry | **this repo** + `marketplace.json` |
| `node_modules/` | the swarm's `deployed-apps/` |
| `npm install <pkg>` | `oshal-app install <name>` (`POST /api/swarm/apps/install-remote` is planned, not built) |
| module loader | the swarm's `ManifestRouteMounter` |
| `npm publish` | push a package folder to this repo |

A base swarm ships **empty of apps**. The kernel (ticket system, loader, auth, baseline bots,
APM) is always present; you grow the swarm by installing extensions.

## 2. Quick start

```bash
# 1. scaffold  (from the OSHAL repo, where scripts/oshal-app.js lives)
node scripts/oshal-app.js init my-app

# 2. edit my-app/oshal-app.yaml + add routes/, personas/, ui/, migrations/ as needed

# 3. validate  (also a CI gate — exits non-zero on error)
node scripts/oshal-app.js validate my-app

# 4. publish   (copy the folder into THIS repo, add it to marketplace.json, push)

# 5. install into a swarm
node scripts/oshal-app.js install my-app
```

## 3. Package layout

```
my-app/
  oshal-app.yaml        # the definition file (required)
  personas/*.yaml       # the app's bots' personas (bundled)
  routes/*.js           # compiled-JS Express routes, mounted in-process
  tools/                # bundled tools discovered at load time
  ui/*.html, *.css      # surfaces + optional theme css
  migrations/*.sql      # the app's own schema, applied on install
  README.md
```

**The one hard rule — self-containment.** Every path in the manifest resolves *inside the
package*. No `src/`, `ai-lab/`, `any-bot/`, no absolute paths, no `../`. `oshal-app validate`
enforces this.

## 4. The definition file (`oshal-app.yaml`) — every feature

```yaml
name: my-app                    # slug (required)
suite: ai-productivity          # ADR-097: the app's ONE primary catalog shelf. Value is
                                # validated FAIL-CLOSED at load (ai-productivity | ai-knowledge |
                                # ai-finance | ai-creative | ai-home | ai-engineering | platform);
                                # missing only warns and the app lists under "More".
displayName: My App             # (required)
description: One line.
version: 1.0.0
status: active                  # active | inactive
scope: person                   # person (default) | public | tenant

source:                         # provenance — installer pins sha
  type: git-subdir
  url: https://github.com/<org>/<store-repo>
  path: my-app
  ref: main

dependencies:                   # resolved + ref-counted on install
  apps: [presentations]         # other app packages this one needs
  tools: []                     # existing tools by id
  connectors: []                # connectors by id

settings:                       # typed per-app settings (rendered in a settings panel)
  schema:
    dailyGoalMinutes: { type: integer, default: 30, label: Daily goal }

bots:                           # this app's bots — agentIds unique + NOT owned by another app
  - agentId: 11111111-0000-0000-0000-000000000001
    name: my-worker
    persona: personas/my-worker.yaml
    role: my-domain/worker
    capabilities: [do-a-thing, do-another]
foundation:                     # persona layered under every bot
  persona: personas/foundation.yaml

toolsDir: tools/                # NEW tools this app provides (bundled JS)
                                # Serving bundled assets from route code? See the
                                # "Bundled asset paths" rule right below this block.


ui:                             # toolbar / ribbon surfaces
  static:
    - { toolName: my-home, label: My App, icon: codicon codicon-rocket, iframeUrl: /api/my-app/home, section: top }
  dynamic:                      # one ribbon tile per DB row (optional)
    source: my_things           # table name (identifier-validated)
    where: "status = 'active'"  # tiny allowlisted col = 'literal' clauses only
    toolNameTemplate: "my-{id}"
    labelField: name
    icon: codicon codicon-circle
    iframeUrlTemplate: /api/my-app/thing?id={id}

routes:                         # compiled-JS routes (see §5)
  - { module: routes/my-app-routes.js, factory: createMyAppRoutes, mountPath: /api/my-app, requiresAuth: true, requiresContext: true }

migrations:                     # the app's own schema, applied idempotently on install
  - migrations/001-my-app.sql

ticketType: my-work             # rides the KERNEL queue (the app doesn't own the queue)
workflow:
  name: My Pipeline
  pipeline: my-work
  workerBot: my-worker
  phases: [intake, processing, delivery]

schedules:                      # recurring jobs ("polls") — only run when the scheduler is on
  - { id: nightly, cron: "0 4 * * *", targetAgent: my-worker, prompt: "Do the nightly thing." }

theme: midnight                 # a registered cockpit skin id, OR a bundled ui/*.css
sharedCss: ui/my-app.css        # loaded into the app's surfaces
chatBot: my-worker              # the right-rail chat agent when this app is focused
ribbon:
  hideFrameworkItems: [tickets, chat, calendar]
  defaultView: my-home
```

### Bundled asset paths — capture the package dir at FACTORY time, never at request time

Your routes receive the framework's `AppContext`; when the framework mounts you as a
package it adds **`ctx.appPackageDir`** — the absolute path of YOUR installed package.
Capture it once when your factory runs:

```ts
export function createMyRoutes(ctx: AppContext): Router {
  const assetRoot = ctx.appPackageDir
    ? path.join(ctx.appPackageDir, 'tools')
    : path.resolve(process.cwd(), 'fallback/for/in-repo-dev');
  // …handlers close over assetRoot…
}
```

**Do NOT read `process.env.OSHAL_APP_PACKAGE_DIR` inside a request handler.** That env
var is a load-time-only channel: it is correct while your module is being `require`d,
but afterwards it points at whichever package the framework mounted LAST — with two or
more apps installed, your handler would serve another app's files. Reading it into a
module-level `const` at load time is acceptable as a fallback for older frameworks that
don't provide `ctx.appPackageDir`; reading it per-request is a bug.


Only `name` + `displayName` are required. Everything else is opt-in — a UI-only app declares no
bots; a deterministic app declares no routes; etc.

## 5. Routes — compiled JS, framework imports by alias

Routes are the only server code a package carries.

1. **Ship compiled JS** (`routes/*.js`), not TS — the loader `require()`s them in-process.
2. A route module exports a factory (`createXRoutes(ctx)`) returning an Express handler/router.
3. **Framework imports stay as `@/…`** (`require("@/features/...")`) — *not* rewritten to
   relative paths — so they resolve to the **running framework** wherever the package sits on
   disk. The loader registers `@/` runtime resolution when dynamic routes are enabled. A
   self-contained route (no framework imports) — like `hello-oshal/routes/hello.js` — works with
   zero resolution.
4. `requiresAuth` defaults **on** — a package route is auth-gated unless it declares
   `requiresAuth: false`.

Dynamic mounting is gated by **`APP_PACKAGE_DYNAMIC_ROUTES`** (default off). Off = the loader
never mounts package routes.

## 6. Dependencies + lifecycle

- **Install is automatic:** clone the pinned `source`, run the audit gate, resolve
  `dependencies` (install/enable missing apps, ref-count them), hot-load.
- **Uninstall is manual + dependency-aware:** a reverse-dependency check runs first — removing
  an app another installed app depends on is blocked; you get an impact list and only true
  orphans (ref-count → 0) are offered. Nothing auto-cascades.

Example: `little-monsters` declares `dependencies.apps: [presentations]` (it surfaces a
Presentations tab). Installing it pulls presentations; presentations is protected from removal
while little-monsters remains.

## 7. The CLI (`scripts/oshal-app.js`, also `npm run app`)

| Command | Does |
|---|---|
| `init <name>` | scaffold a new package (folder + starter `oshal-app.yaml` + dirs) |
| `validate <dir>` | lint against the contract (self-contained, files present, agentId unique, deps ok). CI-gate-able. |
| `install <name> [--repo <url>] [--ref <ref>] [--dest <dir>]` | git-subdir-pull a package from a store repo into `deployed-apps/` |

## 8. Publishing to this store

1. `oshal-app validate my-app` → clean.
2. Copy `my-app/` into this repo (a top-level folder = one installable package).
3. Add an entry to [`marketplace.json`](marketplace.json) (name, description, `source`, deps).
4. Commit + push.

## 9. For an LLM asked to "build an OSHAL extension"

1. Read this file and [`hello-oshal/`](hello-oshal/) (minimal) and [`little-monsters/`](little-monsters/) (full).
2. `node scripts/oshal-app.js init <name>`.
3. Fill `oshal-app.yaml` (§4). Keep every path package-relative (§3).
4. Write `routes/*.js` as compiled CommonJS exporting the named factories (§5). Self-contained
   if possible; else `@/…` imports for framework modules.
5. Add personas/migrations/ui as the app needs.
6. `node scripts/oshal-app.js validate <name>` until clean (routes-not-compiled are warnings).
7. Publish (§8), then `install` (§7).

Never re-declare a bot `agentId` owned by another app. Never reference paths outside the
package. Recurring `schedules` and `autoStart` cost money — declare them only when intended.
