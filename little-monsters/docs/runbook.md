# Little Monsters — Local Runbook

How to start, open, verify, and debug the Little Monsters education swarm on a local
Docker Desktop (Windows) deployment. As-built as of 2026-06-27.

> **Student experience & enhancements:** the student-facing build (master calendar, unified
> Flashcards hub with create/edit, Formula Lab / STEM / Citations / Timelines tools, My Files,
> the rewritten game arcade, the rewards → collection → equippable-avatar loop, the floating
> concierge, anti-cheating tutor, and the Little-Monsters-branded onboarding) is specified and
> tracked in [adr/075-little-monsters-onboarding-and-enhancements.md](../adr/075-little-monsters-onboarding-and-enhancements.md).
> Reach the student view at `/cockpit/?app=little-monsters&student=1`.

Related docs:
- [swarm-apps-framework.md](../swarm-apps-framework.md) — the manifest format this app uses (ribbon focus mode, dynamic per-row icons, lifecycle)
- [architecture/little-monsters-on-oshal-plan.md](../architecture/little-monsters-on-oshal-plan.md) — architecture and sprint history
- [backlog/lm-feature-backlog.md](../backlog/lm-feature-backlog.md) — feature backlog
- [../swarm-apps/little-monsters.yaml](../../swarm-apps/little-monsters.yaml) — the manifest itself (the single source of truth)

## What it is

Little Monsters is a **swarm application manifest**, not framework code. The YAML in
`swarm-apps/little-monsters.yaml` declares six education bots (lecture-scribe, class-tutor,
quiz-master, textbook-librarian, study-coach, writing-coach), the `/api/education` routes,
an `education` ticket pipeline, voice config, theming, and the cockpit UI surfaces.
`SwarmAppService.autoLoadAll()` loads it at controller boot; `status: active` in the YAML
activates everything.

## Start the swarm

The six LM bot containers sit behind the compose profile `little-monsters` — without the
profile flag they do not start.

```bash
cd /c/Projects/open-shal-swarm-harness-agent-llm

# 1. Build the image (only needed after src/ TS or dependency changes)
docker build -f Dockerfile.oshal -t oshal-bot:latest .

# 2. Up — base services + build/incident/LM bots, with the dev hot-swap override
OSHAL_API_PORT=35460 docker compose \
  -f docker-compose.oshal-local.yml \
  -f docker-compose.override.yml \
  --profile build --profile incident --profile little-monsters \
  up -d
```

- `docker-compose.override.yml` (gitignored, dev-only) bind-mounts
  `any-bot/server/services/tools/education/` into the controller — **education UI HTML/CSS/JS
  edits on the host serve instantly, no rebuild, no restart** (the routes `sendFile()` per
  request). It also runs `echo-task-manager` as the any-bot runtime with its source bind-mounted.
- Only changes under `src/` (TypeScript controller code) need the image rebuild + an
  `up -d --force-recreate --no-deps oshal-api`.
- Commit before rebuilding — Windows Docker builds occasionally miss uncommitted changes.

## Open it

```
http://localhost:35460/cockpit/?app=little-monsters
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
OSHAL_BASE=http://localhost:35460 bash scripts/oshal-local-checks.sh   # expect 15/15
```

Checks 11–15 are the LM-specific ones (app active, education UI served, tutor LLM reply,
flashcard + quiz generator endpoints). The LM LLM endpoints use Claude (claude-code OAuth
or `ANTHROPIC_API_KEY`).

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
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:35460/api/health
Get-NetTCPConnection -LocalPort 35460 -State Listen |
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

### Front-end edit doesn't show up (esp. via the public tunnel)

Two caches sit in front of the education UI:

- **Bind mounts are hot.** `any-bot/server/services/tools/education/` and `src/pages/` are
  bind-mounted into `oshal-api`, so HTML/CSS/JS edits there serve on the next request — **no
  rebuild**. Only `src/**` TypeScript (routes, services) needs a rebuild + recreate.
- **Cloudflare caches static `.js` on the public tunnel.** `oshal.agenticfederal.us` serves a
  **stale copy of `/api/education/*.js` and `/cockpit/js/*.js`** even when the origin is fresh
  (HTML stays fresh; the PWA service worker does NOT cache `/api/*`). Symptom: a JS-behavior fix
  (mascot suppress, concierge skin, a game rewrite) doesn't take, but the page HTML did update.
  **Fix: bump a cache-bust query** on the script reference (e.g. `mascot.js?v=3`,
  `lm-concierge.js?v=2`, game iframe `index.html?v=2`) — Cloudflare treats the new URL as a miss.
  A hard refresh (Ctrl+Shift+R) clears the browser copy; the `?v=N` bump clears Cloudflare's.

### Rebuild + redeploy the controller (after a `src/**` change)

```bash
docker build -t oshal-bot:latest .          # root Dockerfile → oshal-bot:latest
UI_PROFILE=oshal-framework docker compose -f docker-compose.oshal-local.yml \
  up -d --no-deps --force-recreate oshal-api
```

> Pass `UI_PROFILE=oshal-framework` (the compose default is `oshal-starter`) so recreating the
> api doesn't reset the operator cockpit to the bare starter profile. The `?app=little-monsters`
> URL overrides the profile per-request, so the student view is unaffected either way.
> The container re-reads `swarm-apps/little-monsters.yaml` on boot, so manifest edits (new ribbon
> tools, theme id) take effect on recreate.

### Education ticket flow

Tickets with `ticketType: education` route through the manifest's pipeline
(`workerBot: lecture-scribe`, phases intake → processing → delivery). The dispatcher defers
app-contributed ticket types until the manifest registers — a startup race guard, not an error.
