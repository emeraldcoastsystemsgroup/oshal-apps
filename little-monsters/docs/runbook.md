# Little Monsters — Local Runbook

How to install, open, verify, rebuild, and debug Little Monsters on a local Docker Desktop
(Windows) oshal deployment.

> **Superseding note (2026-08-05):** the original 2026-06-27 runbook started Little Monsters as
> a kernel-resident compose profile. The app was subsequently carved into this store package.
> The package install/build procedure below replaces that historical startup path; the dated
> record remains available in repository history.

> **Student experience & enhancements:** the student-facing build (master calendar, unified
> Flashcards hub with create/edit, Formula Lab / STEM / Citations / Timelines tools, My Files,
> the rewritten game arcade, the rewards → collection → equippable-avatar loop, the floating
> concierge, anti-cheating tutor, and the Little-Monsters-branded onboarding) is specified and
> tracked in
> [ADR-075](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/075-little-monsters-onboarding-and-enhancements.md).
> Reach the student view at `/cockpit/?app=little-monsters&student=1`.

Related docs:
- [App framework guide](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/swarm-apps-framework.md) — manifest format, ribbon focus mode, dynamic per-row icons, and lifecycle
- [Architecture plan](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/architecture/little-monsters-on-oshal-plan.md) — architecture and sprint history
- [Feature backlog](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/backlog/lm-feature-backlog.md) — remaining framework and app work
- [Package manifest](../oshal-app.yaml) — the app's single source of truth

## What it is

Little Monsters is an **oshal app package**, not framework code. The package-local
[`oshal-app.yaml`](../oshal-app.yaml) declares its education bots, `/api/education` routes,
ticket pipeline, voice config, theme, migrations, and cockpit surfaces. The installer places the
whole package under `deployed-apps/little-monsters`; the app loader validates and activates that
manifest at controller boot.

## Install and start the app

Run these commands from a current oshal core checkout. `oshal-up.sh` performs the ordered
infrastructure/controller/bot startup. Run the package helper inside the controller so its
`CLINE_WORKSPACE_ROOT` places the installed package in the shared `deployed-apps/` volume.

```bash
cd /c/Projects/oshal
bash scripts/oshal-up.sh
docker compose -f docker-compose.oshal-local.yml exec oshal-api \
  node scripts/oshal-app.js install little-monsters
docker compose -f docker-compose.oshal-local.yml restart oshal-api
```

- The install command fetches a committed store ref, validates its `oshal-app.yaml`, resolves app
  dependencies, and atomically replaces the installed package.
- Restarting the controller clears Node's route-module cache and causes the loader to apply the
  installed manifest and its idempotent migrations.
- Source-route changes must be compiled into `routes/*.js` with the package build command in
  [Rebuild and reinstall](#rebuild-and-reinstall); editing `src-routes/*.ts` alone cannot change
  the runtime.

## Open it

```
http://localhost:35457/cockpit/?app=little-monsters
```

`?app=<manifest-name>` is the **toolbar override** ("focus mode"). On page load,
`RibbonNav.js` fetches `/api/ui/profile?name=little-monsters`; the controller synthesises a
ribbon profile from the manifest's `ribbon:` block:

- `ribbon.hideFrameworkItems` subtracts the framework icons (tickets, chat, calendar,
  addressbook, dashboard, echo, logs, operations) — only `settings` survives.
- The manifest's `ui.static` items become the app icons. As-built (2026-06-27): Student
  Dashboard, My Day, Tutor, **Flashcards** (the create/edit/study hub at `/api/education/flashcards-hub`),
  Record, Timelines, Formula Lab, STEM Helpers, Citations, My Files, **Games** (the arcade),
  **My Monsters** (rewards/collection), Presentations, plus Teacher + Voice Settings in the
  bottom tray. The student view (`&student=1`) hides the bottom operator tray and floats the
  single "Little Monster Expert" concierge bubble (`lm-concierge.js`) in place of the right-rail chat.
- `ui.dynamic` generates **one icon per row** of `lm_classes WHERE status = 'active'`
  (tool names `lm-class-{first-8-of-class_id}`), registered into the in-memory dynamic
  tool registry at app activation and served via `/api/tools/dynamic`.
- `ribbon.defaultView: lm-dashboard` opens the Student Dashboard on load.

Plain `/cockpit/` (no param) shows the framework-default ribbon. The URL is the single
source of truth — there is deliberately no localStorage stickiness; bookmark the `?app=` URL.

## Verify

```bash
OSHAL_BASE=http://localhost:35457 bash scripts/oshal-local-checks.sh   # expect 11/11

# From C:\Projects\oshal-apps\little-monsters:
node --test "tests/*.test.cjs"
```

The core checks prove the local services and the app-store separation boundary. The package-local
CJS suites then exercise the installed-byte authorization, privacy, and documentation contracts
without depending on a framework checkout or live LLM provider.

## Troubleshooting

### Cockpit loads partially / ribbon empty / assets hang — but `docker ps` says healthy

Previously blamed on "vpnkit port-forward wedge". Root-caused 2026-06-12: a stale **`wslrelay.exe`
process squatting on the IPv6 loopback (`[::1]`)** for every Docker-published port. Browsers
resolve `localhost` to `::1` first, reach wslrelay instead of Docker's forwarder, and the
connection is accepted but never serviced (no refusal → no IPv4 fallback → hang). Single
`curl` requests often still work (they win the happy-eyeballs race), which makes it look
intermittent.

Diagnose:

```powershell
# If 127.0.0.1 works but localhost doesn't, it's the ::1 squatter:
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:35457/api/health
Get-NetTCPConnection -LocalPort 35457 -State Listen |
  ForEach-Object { "{0}:{1} {2}" -f $_.LocalAddress, $_.LocalPort, (Get-Process -Id $_.OwningProcess).ProcessName }
# Healthy: only com.docker.backend. Broken: wslrelay also bound to ::1.
```

Fix: `Stop-Process -Name wslrelay -Force` (it respawns on demand; Docker is unaffected).
Container bounces (`scripts/api-bounce.sh`) and even full Docker Desktop restarts do **not**
clear it — the process belongs to WSL, not Docker.

### Ribbon shows static icons but no per-class icons

The per-class icons live in an **in-memory** registry populated only when `autoLoadAll()`
activates the app. During a full-stack cold start, Postgres connect timeouts used to fail the
load pass silently. Since commit `2aadff7` the boot retries (3 passes, 15 s apart) and the pg
connect timeout is 10 s, so this self-heals. If it ever recurs: `docker restart oshal-local-api`
once the DB is quiet, then confirm `Dynamic row UIs registered` + `auto-load complete`
`failedCount:0` in `docker logs oshal-local-api`.

### Package edit doesn't show up

The store checkout is not the runtime copy. The controller serves the package under its shared
`deployed-apps/little-monsters` volume, and Node caches loaded route modules. Rebuild source-route
changes, install a committed package ref, and restart the controller. For surface-only changes,
the build step is unnecessary, but reinstall and restart remain required. A browser hard refresh
(Ctrl+Shift+R) clears its own static cache after the runtime copy is current.

### Rebuild and reinstall

From a core checkout with dependencies installed, compile the package's TypeScript route sources,
validate the package, and run all dependency-free package contracts:

```bash
node scripts/oshal-app.js build C:/Projects/oshal-apps/little-monsters --framework .
node scripts/oshal-app.js validate C:/Projects/oshal-apps/little-monsters
node --test "C:/Projects/oshal-apps/little-monsters/tests/*.test.cjs"
```

Commit the package artifact before installing it: the helper fetches a git ref, not uncommitted
working-tree bytes. Re-run `node scripts/oshal-app.js install little-monsters` inside `oshal-api`
as shown above (add `--ref <branch>` when validating a published branch), then restart the
controller. It re-reads the installed `oshal-app.yaml`, so manifest, route, and surface changes
activate together.

### Education ticket flow

Tickets with `ticketType: education` route through the manifest's pipeline
(`workerBot: lecture-scribe`, phases intake → processing → delivery). The dispatcher defers
app-contributed ticket types until the manifest registers — a startup race guard, not an error.
