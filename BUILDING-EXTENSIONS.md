# Building an OSHAL extension (app package)

This is the complete, self-contained guide to authoring an installable **OSHAL app package**
— an extension the swarm installs from this repo and hot-loads, with **nothing compiled into
the swarm's core**. It is written to be read by a human *or* an LLM: given only this repo, you
should be able to build a working extension using every available feature.

- Working example to copy: [`hello-oshal/`](hello-oshal/)
- Full reference app (open source): [`little-monsters/`](little-monsters/)
- Architecture & rationale: ADR-085 in the OSHAL repo.

**Reuse before implementing.** Inspect the existing package tools, kernel skills,
shared surface components and artifact receivers first. Routine AI work should
supply parameters to those tested contracts. Keep new capability code and its
registered tests for later callers; extract a common UI implementation when two
real consumers need it. UI, concierge and MCP operations should converge on the
same owned handlers rather than maintaining separate business logic. The kernel
[authoring guide](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/apps/authoring-app-packages.md)
links the shared component inventory and existing integration contracts.

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

A package whose compute cannot run in the api process adds an `engine/` directory — see
[section 7](#7-a-package-that-needs-its-own-engine-container).

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
uses: [app-dependencies]        # the floor for the tiered dependencies below (see 6)
dependencies:                   # resolved on install; see 6 for what each tier means
  required:                     # comes with this app — fail-closed
    apps: [presentations]       # other app packages this one cannot run without
    tools: []                   # existing tools by id; must exist at load
    connectors: []              # connectors by id
  optional:                     # this app works without these
    apps: []                    # offered at install; installed only when chosen
    tools: []
    connectors: []

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
  provides:                     # this app as a SOURCE for the shared "Choose from OSHAL" picker
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

Every package with a non-empty `ui.static`, `ui.dynamic`, or ADR-141 group `toolbar` owns a
cockpit surface and must declare the concierge responsible for its right rail. A nonblank
top-level `chatBot`, `workflow.workerBot`, or first `bots[].name` satisfies that contract. A
surface-only package may reference the stable framework `general-bot`; a group may borrow a bot
from a required member. Do not make an optional application required merely to borrow its bot.
Declare the bot name as a direct string and keep these fields in canonical block form: the
zero-dependency gate rejects YAML anchors, aliases, merge keys, tags, duplicate relevant keys and
implicitly typed non-string names rather than guessing how the runtime parser will resolve them.
`node scripts/check-concierge-coverage.mjs` checks the whole manifest tree with no allowlist.

### Joining the artifact exchange — "Send to…" (ADR-139)

#### Choosing an existing file (Stage 4a)

Include `/api/artifacts/picker.js`, then call
`await window.oshalPickArtifact({ accept: ['image/*'], maxBytes: 20971520 })`.
Cancel returns `null`; selection returns `{ref, name, type, expiresAt}` from the existing
owner-bound handle service. Fetch `/api/artifacts/handles/<ref>/content` and feed the bytes into
your existing upload/crop/import path. Selection alone must not start generation or publication.
The shared component owns the dialog, theme, keyboard focus, folder navigation, MIME/size
filtering, cancellation and error states; do not copy its markup into a package.

To appear as a source, declare `artifacts.provides: [{label: 'My files', types: ['image/png'],
list: '/api/my-app/artifacts'}]`. `label` is optional (maximum 60 characters). The listing must
be a read-only, caller-scoped endpoint on your app's authenticated mount. It receives an optional
opaque `cursor` query parameter and returns:

```json
{
  "items": [{"name": "photo.png", "type": "image/png", "size": 2048, "source": "/api/my-app/files/123"}],
  "folders": [{"name": "Photos", "cursor": "photos"}],
  "nextCursor": null
}
```

`items` is required, at most 100 per page. `folders` is optional, at most 100. `size` is optional
and measured in bytes. Cursors are strings up to 4096 characters; omit `nextCursor` or use null
at the end. Every `source` is a same-origin `/api/` URL serving actual bytes with owner checks,
including when the existing handle relay re-fetches it under the caller's trusted identity.
Never return paths on disk, credentials, another user's filenames, or preview JSON as an image.
Listings run in the browser's session, not an elevated proxy. Source discovery hides inactive,
private/invisible and access-denied apps. Connected storage participates through the same registry.

Portrait Studio 1.11.0 is the first adopter and source. Its old bespoke file modal is removed.
Core `tests/unit/artifact-picker.spec.ts` exercises the real HTTP/file/handle/browser path;
the authentication provider and portrait SQL store are explicit fixtures in that test.

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

Declare what your package needs in two tiers. The tier decides what the installer does when the
thing is missing, and what the uninstall guard does when someone removes it:

| | `required` | `optional` |
|---|---|---|
| install | missing apps are installed from the same store; anything unresolvable **fails the install** | never installed unasked — `install <pkg> --with <app>`, `--with-optional`, or the App Loader's checkboxes |
| load | a required tool nothing provides **fails the load** | not checked |
| someone uninstalls the dependency | **blocked** while your app is active (`--force` overrides) | never blocked; your app is listed as losing that integration |
| your app is uninstalled | its required apps that nothing else requires are offered as orphans | never offered |
| `connectors` | part of your app's connector allow-list, and what its setup screens ask for | also part of the allow-list, as an extra |

Put an app under `required` only when yours genuinely cannot run without it. A launcher that
routes to whatever is installed, or a surface that hands work to a partner app when it is there,
belongs under `optional` — otherwise installing your package drags its whole shelf in.

**The connector allow-list is the union of both tiers.** When either tier declares `connectors`,
that union is the complete set of providers your surfaces may offer (`[]` = offer none — a kids'
app never asks for Facebook). Declare the key nowhere and nothing is filtered.

**The tiered form must declare `uses: [app-dependencies]`.** An older core does not understand
`required:` / `optional:`: it would install your package with neither its required dependencies
nor its connector allow-list. Naming the floor makes such a core refuse the package instead, the
same way `test-catalog` does — so publish a tiered manifest only once the core that understands
it is available. The legacy flat form (`dependencies: {apps, tools, connectors}`) is still valid,
needs no floor, and means **all required**.

- **Install is automatic:** clone the pinned `source`, run the audit gate, resolve the required
  tier plus any optional apps the operator chose, then hot-load the dependencies it pulled in
  **before** your package. A required dependency that fails to load leaves your package unloaded
  rather than live-but-broken; a failed optional one is reported and your package still loads.
- **Uninstall is manual + dependency-aware:** a reverse-dependency check runs first — removing an
  app another installed app REQUIRES is blocked; you get an impact list and only true orphans are
  offered. Nothing auto-cascades.

**None of this repo's published packages have been converted yet** - they all still carry the
legacy flat form, which is valid and means all-required. Converting them is planned work that has
to follow the core deploy (a tiered manifest declares the floor, and an older core refuses it): the
plan, the per-package classification and the acceptance criteria live in the core repo at
`docs/backlog/store-dependency-tier-migration.md`. Until that lands, write NEW packages with the
tiered form only if the swarm you are publishing to runs a core that understands it - `oshal-app
init` scaffolds the tiered shape, so delete the `optional:` block and the floor if you must target
an older core.

Example: `little-monsters` requires `presentations` (it surfaces a Presentations tab). Installing
it pulls presentations; presentations is protected from removal while little-monsters remains. A
package that merely hands an outline to `cad-studio` lists it under `optional` instead: the App
Loader offers it as a checkbox, and removing cad-studio later is never blocked by that package.

## 7. A package that needs its own engine container

Some packages cannot compute inside the api process. The api image is Alpine (musl): several
scientific Python stacks publish glibc-only wheels, and native toolchains like a SPICE solver or
an AVR compiler are not on it at all. A package whose numbers come from one of those ships its own
container and dials it over the stack network. Four packages arrived at this shape independently
before it was written down; the differences between them were accidents, not choices, so what
follows is the pattern — and the store CI gate `scripts/check-engine-container-pattern.mjs` holds
every engine package to it.

| package | engine | why a container | alias the route dials |
|---|---|---|---|
| `aero-lab` | AeroSandbox / casadi | `casadi` publishes no musl wheel | `aero-lab-engine:7411` |
| `cad-studio` | CadQuery on the OCCT kernel | OCCT wheels are glibc + link against libGL | `cad-studio-engine:7412` |
| `circuit-lab` | ngspice + avr-gcc / avr8js | apt-installed native toolchains | `circuit-lab-engine:7413` |
| `embodied` | MuJoCo / Gymnasium | glibc-only wheels | `embodied-engine:7413` |

Read any one of them as a worked example; they agree. The port numbers need not be unique across
packages — nothing is published to the host, and each container has its own network namespace.

**The files.** Everything lives under the package, like every other path in a manifest:

```
my-app/
  engine/
    install-engine.sh          # builds the image and starts the container; run on the box
    requirements.txt           # what to install, when your stack has PyPI dependencies at all
    requirements-lock.txt      # a CONSTRAINTS file: the exact versions you validated against
    container/
      Dockerfile               # FROM an official upstream image + the pins above
      compose.yaml             # the engine's OWN compose project
      my_engine_bridge.py      # the long-lived process: JSON lines over TCP
```

**Nothing third-party is committed and no image is published.** The Dockerfile starts from an
official upstream image and installs the exact pins (PyPI, apt, or both); `install-engine.sh`
builds it locally on the box. That keeps the package a source package — the store never carries
someone else's binary.

#### The three properties that are requirements, not options

Each of these was learned by something breaking. They are asserted by the CI gate, so a package
that drops one fails store CI rather than failing on an operator's box.

**1. The compose project is the package's own, and the installer asserts it after `up`.** The
compose file declares `name: oshal-<package>-engine`, and that is not sufficient on its own: the
api container exports `COMPOSE_PROJECT_NAME` for the *core* stack, and an inherited
`COMPOSE_PROJECT_NAME` outranks the compose file's `name:`. Inherited, it silently put the first
engine into the core project, where the next core deploy's `--remove-orphans` swept it. So the
installer unsets the inherited variables, pins `-p "$PROJECT"`, and then reads the label back:

```sh
unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_ROOT
PROJECT=oshal-my-app-engine
OSHAL_NETWORK="$NETWORK" docker compose -p "$PROJECT" -f "$ENGINE_DIR/container/compose.yaml" \
  up -d --no-build --force-recreate

got=$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}')
[ "$got" = "$PROJECT" ] || die "$CONTAINER landed in compose project '$got', not '$PROJECT' - a core deploy would sweep it"
```

Unsetting the variable is not proof; the read-back is. Do both.

**2. The container carries no `oshal.tier` label.** `oshal.tier` is the selector the monitoring
overlay's Prometheus uses to discover scrape targets by docker_sd — a bot service inherits it from
`x-bot-common` and is scraped with no config change. An engine container serves no `/metrics`, so
wearing that label makes it a permanently down target on the core dashboards. Label it with
`oshal.app: <package>` instead, which is descriptive and selects nothing.

**3. A stale container is refused with the install command, never answered.** The package's engine
tree and the tree baked into the running image can differ — the package updated, the container did
not. Answering anyway means returning last week's physics as if it were this week's. So the image
and the package each hash the engine tree the same way, the bridge reports its hash in the hello
frame, and the client refuses a mismatch:

```js
if (hello.buildHash !== this.opts.expectedBuildHash)
  return this.unavailable(`engine container is out of date: it was built from engine ${String(hello.buildHash).slice(0, 12)}, this package ships ${this.opts.expectedBuildHash.slice(0, 12)}`);
```

Hash the *same* file list on both sides, fold CRLF to LF (a Windows checkout and the deployed Linux
copy of one commit must agree), and keep the two implementations cross-checked by a test — see
`cad-studio/routes/engine-build-hash.js` beside `cad-studio/engine/container/cad_engine_bridge.py`.

Two more properties follow from the pattern and are checked with them: the compose file joins the
**external** stack network (`name: ${OSHAL_NETWORK:-oshal-local_oshal}`) under an alias rather than
creating one, and it **publishes no host port** — only containers on the stack network reach the
bridge. Beyond that the engines run `read_only: true`, `cap_drop: [ALL]`,
`no-new-privileges`, a tmpfs `/tmp`, a non-root user and a `mem_limit`; copy that block.

#### The capability route owns the reason and the command

No surface hardcodes setup instructions. The route that reports capabilities answers with the
engine's state, the honest reason it is unavailable, and the exact command that fixes it, and the
surface renders whatever it is given:

```js
// GET /api/my-app/capabilities — 200 with capabilities:null when the engine is down, never a 500
res.json({
  engine: { connected, buildHash, expectedBuildHash, address: 'my-app-engine:7411' },
  capabilities: null,
  reason: 'engine container is out of date: it was built from engine a1b2c3d4e5f6, this package ships 0f9e8d7c6b5a',
  installHint: 'docker exec <api-container> sh /app/workspace-shared/deployed-apps/my-app/engine/install-engine.sh',
});
```

Build the hint rather than writing it out — inside the api container the hostname *is* the
container id, so the command names the box the operator is actually on:

```js
const script = `${engineDir.replace(/\\/g, '/')}/install-engine.sh`;
return fs.existsSync('/.dockerenv') ? `docker exec ${os.hostname()} sh ${script}` : `sh ${script}`;
```

`aero-lab`'s engine-down banner is the behaviour to match: it renders the route's own reason,
which carries the copy-paste command. It used to print a hardcoded venv instruction instead,
which was wrong on every deployed (Alpine) box — that is why setup text lives in no surface.

#### Installation, and the refusal path when it cannot happen

An installed package should end up with a working engine without an operator step. Today it does
not: package install does not yet run a declared post-install command, and no shipped engine builds
itself on the first call. **Until one of those exists, the refusal path is the contract, and it is
explicit** — a package with no engine container stays fully honest rather than half-working:

- capabilities stay `false`/`null` with the reason and the install command, on every surface that
  would have used the engine;
- nothing degrades silently to an approximation unless the package says so in the same payload
  (`embodied` keeps a kinematic truth model and labels it);
- `install-engine.sh` is idempotent, so the same command is the fix for "never installed", "out of
  date" and "container gone".

Run it from the box, where the api container has the docker CLI and the mounted socket:

```sh
docker exec <api-container> sh /app/workspace-shared/deployed-apps/my-app/engine/install-engine.sh
```

The installer should prove the engine before it reports success — start the container, wait for the
bridge to listen, then run one real computation through it (`--selftest`). A container that is up
but answering wrongly is worse than one that is down, because only the down one tells the operator.

## 8. The CLI (`scripts/oshal-app.js`, also `npm run app`)

| Command | Does |
|---|---|
| `init <name>` | scaffold a new package (folder + starter `oshal-app.yaml` + dirs) |
| `validate <dir>` | lint against the contract (self-contained, files present, agentId unique, deps ok). CI-gate-able. |
| `install <name> [--repo <url>] [--ref <ref>] [--dest <dir>] [--with a,b \| --with-optional]` | git-subdir-pull a package from a store repo into `deployed-apps/`, with its required apps and any optional apps you name |

## 9. Publishing to this store

1. `oshal-app validate my-app` → clean.
2. Copy `my-app/` into this repo (a top-level folder = one installable package).
3. Add an entry to [`marketplace.json`](marketplace.json) (name, description, `source`, deps).
4. Add a truthful [`audits/<app>.json`](audits/README.md) profile-v1 record and bind it from the
   catalog. A new package begins `pending`; never manufacture a pass or use an uncommitted SHA.
5. Run `node scripts/security/validate-package-audits.mjs` and
   `node --test scripts/security/package-audit.test.mjs`.
6. Commit the candidate, then run the compatibility gate from the core checkout:
   `node scripts/check-store-compatibility.mjs --store <this-checkout> --store-ref HEAD`.
   It pins both commits, installs core's locked dependencies in a disposable export, and
   compiles every source-bearing package against the actual framework types. Package-local
   ambient stubs cannot supply invented core exports. A failing package is named in the
   retained compiler log; fix it before publishing. Add `--core-ref <release-sha>` to check
   the intended core release. `--dependencies <provisioned-core>` optionally reuses an
   existing dependency installation after matching its manifest and lockfile.
7. Push. The core local-CI `store-compatibility` gate runs the same check; the standalone
   entry is `bash scripts/ci-local.sh --store-compatibility-only` in core. Set
   `OSHAL_STORE_REPO` if these checkouts are not siblings. This is a TypeScript compatibility
   check, not a replacement for package runtime tests, route audits, or compiled-output parity.

`scripts/security/rebuild-store-routes.mjs --check-only --store <store> --framework <core>`
compiles every package in the one shared framework program and then compares each committed
`routes/**/*.js` with the bytes that program emits for its `src-routes` source. It writes nothing:
a mismatch is reported, named file by file with the first line that differs, and the run exits 1.
Regenerate with the same command minus `--check-only`, which rewrites exactly the files that drifted.

The comparison adds no formatting rules of its own. It applies the two the rebuild already applies -
the package-local `sourceMappingURL` policy (a package with its own `src-routes/tsconfig.json` that
does not set `sourceMap: true` has the trailer stripped; every other package keeps it) and a
line-ending fold, so a CRLF working copy of an LF blob is not reported as drift. Everything else,
including the final newline, is compared exactly.

A module the manifest mounts that no TypeScript source emits - a hand-written legacy route - is
checked for its declared factory export and named in the run output as not byte-compared, never
silently skipped. The rebuild keeps such a module; an unsourced module no manifest route names is
still removed as stale.

Use the core wrapper above for release checks: it runs this tool only inside disposable committed
exports, protecting working files even if interrupted.

### Package-audit rollout

`OSHAL_PACKAGE_AUDIT_MODE=compatible` is the default while the 47-package evidence program runs.
It preserves legacy installs but never returns an unsafe SHA as trusted. In `enforce` mode, the
installer must reject missing, pending, failed, malformed, version-mismatched, and SHA-mismatched
records, then install the exact `sourceSha` returned by the validator instead of mutable `source.ref`.
See [`audits/README.md`](audits/README.md) for the controls, evidence format, and maintainer flow.

## 10. For an LLM asked to "build an OSHAL extension"

### Registering package tests with the AI Test Lab

Include the test inventory in the installation contract:

```yaml
uses: [test-catalog] # add this to the package's existing capability dependencies
testing:
  version: 1
  catalog: tests/test-lab.yaml
```

Copy [Hello OSHAL's catalog](hello-oshal/tests/test-lab.yaml) for a smoke plus a real Node HTTP
suite, or [Portrait Studio's catalog](portrait-studio/tests/test-lab.yaml) for custom harnesses,
browser proofs and an explicitly pinned core-owned suite. The
[core contract](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/testing/package-test-catalog.md)
defines the closed schema, stable IDs, expected assertions, prerequisites, side effects, isolation,
cleanup and runner limits. Package test paths must exist inside the package. Core references name
an exact commit and core test files; they never assume a sibling checkout.

Registration happens during activation and reconciles during reload, disable and uninstall.
It does not execute local suites or certify a pass. Eligible existing smoke probes reuse
the core verifier. Supported offline package Node suites run in the Lab's isolated container
runner and local schedules; unavailable runners and fixtures stay visibly pending. See the
[execution guide](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/testing/package-test-execution.md).
Keep arbitrary shell commands out of catalogs, and keep audit records pending until their
separate controls are proven.
The `test-catalog` dependency makes older cores refuse the package instead of silently dropping
its tests. Publish/install catalog-bearing packages only after that core capability is available.

Match the runner to the actual test harness. A test using in-memory query or Express stubs is
a unit test; a real loopback HTTP server is integration coverage. Standalone assertion scripts
run through `node-test` report file-level results. Do not count their inner console messages as
separate Node tests. Keep real database, browser, provider and excluded-data fixture prerequisites
explicit. The isolated runner includes canonical `tools/` surfaces and `src-routes/` source files;
runtime data, generated output and arbitrary sibling checkouts are unavailable.

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
3. Fill `oshal-app.yaml` (§4), including a concierge for every cockpit surface. Keep every path
   package-relative (§3).
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
