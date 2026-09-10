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

For dashboards and connected actions, assess each app with [the Home extraction ledger](APP-HOME-EXTRACTION-PLAN.md) and [integration work orders](APP-HOME-INTEGRATIONS.md). Context exchanges require source `integrations.offers`, target `integrations.accepts`, and an implemented receiving draft surface. See the [core contract and working declaration](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/apps/app-home-integrations.md). File exchanges retain the artifact registry. Installation dependencies and optional action partners have different meanings.

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

# 4. publish   (copy the folder into THIS repo, add it to marketplace.json + audits/, push)

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

kind: app                       # or `group` — a code-less binding of installed apps (ADR-141):
                                # `toolbar:` borrows member surfaces by app + surface name and
                                # `setup:` drives the kernel setup dashboard; see intelligent-career/
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


readiness:                      # per-user probes a group's setup page asks in the user's session
  - { name: resume, path: /api/my-app/resume/state, readyPointer: /hasResume, detailPointer: /summary }

summary:                        # ADR-145: this app's TILE on the cockpit Home view. One per app.
                                # Same fail-closed rules as readiness: (own mount, canonical path,
                                # session-admitting route, valid RFC 6901 pointers, >=1 pointer).
                                # tiles: <=4 {label<=24, value<=16, tone: neutral|good|warn}
                                # items: <=5 {text<=120, tone, fix: a toolName in THIS app}
                                # `value` is a STRING ("116W-215L", "-$18.24") - a number is DROPPED,
                                # core cannot know your unit or locale. Over-cap truncates; an
                                # unknown tone degrades to neutral and never escalates; a missing or
                                # wrong-typed pointer renders "can't check", never a zero. GET only
                                # and side-effect free - the page calls it on every load. The tile
                                # lands on the shelf named by `suite:`. No summary: still gets a tile,
                                # built from this app's `<App>: ...` jarvis_tasks rows.
  path: /api/my-app/summary
  tilesPointer: /tiles
  itemsPointer: /items

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

artifacts:                      # ADR-139: join the swarm-wide "Send to…" exchange. Both halves
  accepts:                      # are OPTIONAL and independent — declare either, or neither.
    - id: import                # stable per-app slug (lowercase)
      label: Import into My App # what the user sees in the menu
      icon: 📥
      types: [application/pdf, image/*]   # MIME globs you accept ("*/*" takes anything)
      mode: post                # post = act headlessly and toast; open = open your surface
      endpoint: /api/my-app/import-artifact   # post ONLY, must be a root-relative /api/... path
  provides:                     # this app as a SOURCE (parsed + registered; picker is Stage 4a)
    - types: [image/png]
      list: /api/my-app/things  # a route a picker can enumerate the caller's artifacts from
                                # ⛔ `overlay:` is KERNEL-RESERVED — a manifest declaring it FAILS
                                #    the load, so an app can never aim the in-place modal at a page.

theme: midnight                 # a registered cockpit skin id, OR a bundled ui/*.css
sharedCss: ui/my-app.css        # loaded into the app's surfaces
chatBot: my-worker              # the right-rail chat agent when this app is focused
ribbon:
  hideFrameworkItems: [tickets, chat, calendar]
  defaultView: my-home
```

### Joining the artifact exchange — "Send to…" (ADR-139)

Any artifact anywhere in the swarm — an image, a PDF, a video, an export — can be sent to any app
that registers for its type. You get every destination the swarm has, now and later, by declaring
one block; and you offer your own artifacts to every destination by tagging one element. There is
no per-pair integration to write, which is the whole point: N+M, not N×M.

**Bytes never ride the registry.** A dispatch carries a short-TTL, owner-bound **handle**. Normally
it holds a *locator* and the kernel re-fetches it server-side **as the minting caller**, so
ownership is enforced at mint and again at use. Since Amendment D a handle can also carry the bytes
themselves, for a source that has no byte-serving URL to point at. Both kinds redeem identically —
you never need to know which you were handed.

#### As a DESTINATION — `mode: post` (act headlessly, toast the result)

Declare the block above, then take `{ ref }` on your endpoint and redeem it with the shared helper.
That is the whole integration — roughly thirty lines:

```ts
import { redeemArtifactViaRelay } from '@/shared/artifact-exchange';

router.post('/import-artifact', async (req, res) => {
  const sub = callerSub(req);                       // your app's usual caller resolution
  if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
  const got = await redeemArtifactViaRelay({
    port: req.socket.localPort,                     // this server instance, over the loopback
    callerSub: sub,
    ref: String((req.body ?? {}).ref ?? ''),
  });
  if (!got.ok) { res.status(got.status).json({ error: got.error }); return; }
  // got.buffer / got.name / got.type — now do your app's ordinary ingest with them.
  res.json({ ok: true, message: `Imported ${got.name}` });
});
```

Your endpoint keeps its own auth gate and its own confirm gate. A dispatch is one explicit user
gesture; if your action is outward-acting it still asks, exactly as it would from your own UI.

#### As a DESTINATION — `mode: open` (open your surface, pre-loaded)

Declare `mode: open` and no endpoint. The cockpit navigates to
`/cockpit/?app=<your-app>&artifact=<ref>` and forwards the ref to your surface. Read it on boot the
way you read any URL parameter, then fetch
`GET /api/artifacts/handles/<ref>/content` for the bytes. Do not build your own URL scheme — the
navigation contract is fixed (Amendment A) and the per-action `open:` template was deliberately
dropped.

#### As a SOURCE — tag the element, include the script once

```html
<script src="/api/artifacts/send-to.js"></script>
...
<div data-artifact-source="/api/my-app/files/report.pdf"
     data-artifact-type="application/pdf"
     data-artifact-name="Q3-report.pdf">…</div>
```

The component injects the 📤 chip **and** a right-click handler centrally, and a MutationObserver
covers rows you render later. Add `data-artifact-ui="context"` for right-click only, when a tight
button row has no space for a chip.

**If your artifact has no URL** — it is generated in the page, or your route answers a JSON envelope
rather than the file — use `data-artifact-blob` with a `blob:` or `data:` URL instead of
`data-artifact-source` (or call `window.oshalSendTo({ type, name, blob })` directly). Only `blob:`
and `data:` are accepted there; an `http` URL is refused, because it would launder an arbitrary
cross-surface fetch into an artifact.

#### Things that will bite you

- **Never send a partial artifact.** If your surface holds a truncated preview rather than the whole
  file, do not tag it. Ingesting a partial document into a corpus is a defect nobody sees.
- **`overlay:` is kernel-reserved.** A manifest declaring it fails the load, by design.
- **Presentation is not yours to choose.** How the affordance looks is one central decision in
  `send-to.js`; tag the element and inherit it, so it can change everywhere at once.
- **Your surface may be session-only.** Many app mounts reject the service rail, so verify a receive
  path in a browser, not with curl.

Design and every amendment: [ADR-139](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/139-artifact-exchange-send-to-registry.md).
Who is already wired, and the gaps:
[artifact-exchange-coverage](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/apps/artifact-exchange-coverage.md).

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

### Compiling — verify against the framework, not your own stubs

`src-routes/*.ts` is compiled by the **framework's tsc**, and every source-bearing package is
staged into **one** TypeScript program:

```bash
node scripts/security/rebuild-store-routes.mjs --store <store> --framework <oshal checkout>
```

Packages type-check their `@/…` imports against a local `src-routes/core-modules.d.ts` — ambient
`declare module` stubs for the framework surfaces they use. That file is a convenience, and it is
the one thing in a package that can **lie**: nothing checks it against the real framework types.
A stub that declares an export core does not have, or widens a parameter to `any`/`unknown`, lets
the package compile perfectly on its own and fail the shared compile.

Because all packages share one program, that failure is **not** contained — a single package's
drift blocks the build for every other package. (This happened: `marketing-engine` declared a
`QueryablePool` export the framework never had, and the whole-store build was down until it was
fixed.)

So before you publish, compile against the **real** types:

```bash
# stage just your package under the framework and type-check it
mkdir <oshal>/src/__stage && cp <pkg>/src-routes/*.ts <oshal>/src/__stage/
rm -f <oshal>/src/__stage/core-modules.d.ts        # the stubs must NOT participate
cd <oshal> && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
rm -rf <oshal>/src/__stage                          # always clean up
```

Zero errors from your staged files is the bar. Use this single-package form when other packages
have uncommitted work — `rebuild-store-routes.mjs` writes to **every** package's `routes/`.

Keep the stub honest as you go: when a stub and the real type disagree, fix the stub, and prefer
deriving types from what the framework actually exports (`AppContext['pool']`) over re-declaring
them. Emitted `routes/*.js` carry a `sourceMappingURL` comment; never commit the `.js.map`.
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
4. Add a truthful [`audits/<app>.json`](audits/README.md) profile-v1 record and bind it from the
   catalog. A new package begins `pending`; never manufacture a pass or use an uncommitted SHA.
5. Run `node scripts/security/validate-package-audits.mjs` and
   `node --test scripts/security/package-audit.test.mjs`.
6. Commit + push.

### Package-audit rollout

`OSHAL_PACKAGE_AUDIT_MODE=compatible` is the default while the 47-package evidence program runs.
It preserves legacy installs but never returns an unsafe SHA as trusted. In `enforce` mode, the
installer must reject missing, pending, failed, malformed, version-mismatched, and SHA-mismatched
records, then install the exact `sourceSha` returned by the validator instead of mutable `source.ref`.
See [`audits/README.md`](audits/README.md) for the controls, evidence format, and maintainer flow.

## 9. For an LLM asked to "build an OSHAL extension"

For configurable Home data, assess the app in [the extraction ledger](APP-HOME-EXTRACTION-PLAN.md).
Return stable-id data points via optional `summary.metricsPointer` alongside legacy tiles/items.
The catalog permits at most 24 `{id,label,value,tone?,defaultVisible?}` entries; values are strings,
ids are stable package-local identifiers (1–64 alphanumeric/underscore/dot/hyphen characters,
starting alphanumeric), and default visibility is true. Item `metricId` can associate an update
with a fact so hiding the fact also hides that update. Core owns the saved layout and metric
selection; the app owns extraction, freshness, scope and the meaning of each number. Continue
returning up to four legacy tiles for existing group displays. See
[the full contract](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/apps/authoring-app-packages.md#selectable-data-points-on-home).

1. Read this file and [`hello-oshal/`](hello-oshal/) (minimal) and [`little-monsters/`](little-monsters/) (full).
2. `node scripts/oshal-app.js init <name>`.
3. Fill `oshal-app.yaml` (§4). Keep every path package-relative (§3).
4. Write `routes/*.js` as compiled CommonJS exporting the named factories (§5). Self-contained
   if possible; else `@/…` imports for framework modules.
5. Add personas/migrations/ui as the app needs.
6. Declare `summary:` (§4) so the app reports a tile on the cockpit Home view, and
   `readiness:` for anything the user must still set up. An app that reports nothing is
   invisible on the landing page every user sees first.
7. `node scripts/oshal-app.js validate <name>` until clean (routes-not-compiled are warnings).
8. Publish (§8), then `install` (§7).

Never re-declare a bot `agentId` owned by another app. Never reference paths outside the
package. Recurring `schedules` and `autoStart` cost money — declare them only when intended.
