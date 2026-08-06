# Kalshi Prediction Markets — OSHAL app package

`?app=kalshi` — find mispriced event contracts on Kalshi (ADR-094). Every open market is
evaluated like a poker hand: calibrated true probability (learned from Kalshi's own
settled-market tape, beta-shrunk toward price so **no history ⇒ no edge**) versus the ask
plus Kalshi's quadratic taker fee; playable hands are ranked with quarter-Kelly stakes and
explicit risk flags. An empty table means the evaluator folded everything — by design.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface").

## The scan is always on, and it is not on the request path (2026-07-30)

Opening this app used to trigger the scan and make you watch it. The api's own log:

```
kalshi scan complete  openPaged=60000  evaluable=6  hands=1  ms=23125
```

23 seconds, because a scan walks 60 pages of 1000 markets at the public tier's ~3 rps — and
the in-process cache died on every api recreate, so the next visitor paid again.

Now a poller owned by this package keeps a snapshot warm:

| | before | now |
|---|---|---|
| when the scan runs | when someone opened the app (2-min cache) | on a configured cadence, default **hourly** |
| what `GET /scan` does | ran the 23s feed walk | reads one row, answers instantly + reports its age |
| where the result lives | process memory (lost on recreate) | `kalshi_scan_snapshots` in Postgres |
| new hands | you had to go look | posted to your **Jarvis** feed (once per hand) |
| where it runs | — | only where this app is installed + ACTIVE |

- **Never blocks.** Before the first snapshot exists, `/scan` returns `awaitingFirstScan: true`
  and the surface says so — an empty table on this surface means "the evaluator folded
  everything", so a not-yet-scanned state must not borrow that wording.
- **"Scan now"** (`POST /scan/run`) asks for an out-of-band walk and returns `202` immediately.
  Single-flighted: the poller tick, the boot catch-up and repeated clicks share one run.
- **Snapshot-clocked, not timer-clocked.** The poller ticks every minute and asks "is the stored
  snapshot older than the cadence?" So a settings change lands within a minute without a restart,
  and a recreate mid-cycle recovers on the next tick instead of skipping the hour.
- **One cycle at a time, deployment-wide.** Per-process single-flight can only see its own process,
  so a cycle also runs under a Postgres advisory lease (`pg_try_advisory_lock`). A second process
  that can't take it serves the existing snapshot instead of walking the same 60 pages; the lease is
  session-scoped, so an api killed mid-cycle releases it automatically. (v1 claimed this property in
  its docs with only the per-process guard behind it — the lease is what makes the claim true.)
- **A toggled-off app goes quiet.** Deactivating the app unmounts the routes but not a timer, so the
  tick checks `swarm_applications.status` first and parks itself (resuming if reactivated). Without
  that, a switched-off app kept scanning and alerting — the runaway ADR-085 P0 describes.
- **A failed cycle backs off** (2^n minutes, capped at 30) instead of retrying a 60-page walk every
  minute against a dead upstream, and `POST /scan/run` is rate-limited (one per 2 min, `429` +
  `Retry-After`) because it is open to any signed-in user and each call spends the deployment's
  share of a ~3 rps public tier.

### What Jarvis gets

New playable hands are written to the user's `jarvis_tasks` feed, which is how background work
reaches Jarvis: he announces it once, and it stays in his OPEN WORK context — so *"what did the
Kalshi scan find?"* is answered from what actually happened rather than a fresh 23-second scan.

Alerts are **first-seen per hand** (`UNIQUE (user_sub, ticker)`): an hourly scan re-finds the same
hand every hour, and re-announcing it is how an always-on feature teaches its owner to ignore it.
They also clear a strength floor, a net-edge floor, and a rolling per-day budget that counts
**announcements, not hands** (each announcement carries a `batch_id`; counting rows made
`alertMaxPerDay: 6` behave like "6 hands/day", i.e. roughly one announcement).

The gate **fails closed**: if the ledger or the budget cannot be read, that user gets no alert this
cycle. Without the dedup set there is no way to tell a new hand from one announced an hour ago, and
guessing means re-announcing everything.

Only users who actually have Kalshi set up are alerted (a saved `kalshi` connection, or saved
settings) — and the copy states the posture: these are **candidates**, stake stays 0% until the
strategy out-scores the market on settled predictions, and **nothing is ever ordered** by the scan.

Outward delivery (email / SMS / Telegram via the notification preference center, topic
`kalshi-edge`) is **off until you turn it on** — an hourly job may not start texting someone
because they once pasted an API key.

### Configuration — the YAML is the source of truth

Every knob is declared in [`oshal-app.yaml`](oshal-app.yaml) under `settings.schema`, and the
package reads its own manifest at activation. Layers, weakest first:

1. in-code defaults (`src-routes/kalshi-scan-config.ts`)
2. **the manifest** — `settings.schema.<key>.default`
3. the deployment row in `kalshi_scan_settings` (`scope_key = '__deployment__'`)
4. the user's row (`scope_key = <sub>`)

`scope:` in the schema decides who may change a key: `deployment` (the cadence — one scan serves
everyone, so it is **operator-only**, a fail-closed 403 otherwise) or `user` (your own alerts).
Values are clamped, never rejected — a bad row degrades the cadence instead of stopping an
always-on scan.

| key | scope | default | what it does |
|---|---|---|---|
| `scanEnabled` | deployment | `true` | master switch for the poller |
| `scanIntervalMinutes` | deployment | `60` | cadence (5 … 1440) |
| `scanOnActivate` | deployment | `true` | one scan ~30s after start, so the first open is warm |
| `scanMaxMarketsPaged` | deployment | `60000` | feed-walk bound (markets paged) |
| `scanMaxMarketsKept` | deployment | `1500` | feed-walk bound (evaluable kept) |
| `staleAfterMinutes` | deployment | `180` | when the served snapshot is labelled STALE |
| `notifyJarvis` | user | `true` | post new hands to your Jarvis feed |
| `notifyOutward` | user | `false` | also send to your notification channel |
| `alertMinEdgeCents` | user | `3` | net-edge floor for an alert |
| `alertMinStrength` | user | `playable` | strength floor (`monster`/`strong`/`playable`) |
| `alertTopN` | user | `5` | hands named in one alert |
| `alertMaxPerDay` | user | `6` | rolling-day alert budget (`0` mutes) |

Change them at runtime on the app's **Settings** tab (`GET`/`PUT /api/kalshi/settings`) — the panel
is rendered *from* the manifest schema, labels and bounds included. Edit the YAML to change what a
fresh install ships with.

**Browser-verified at the package boundary:**
[`tests/kalshi-settings-alerts-browser.test.js`](tests/kalshi-settings-alerts-browser.test.js)
launches real Chromium against an ephemeral local HTTP server that mounts the compiled
`routes/kalshi-routes.js` factory and serves the real `tools/kalshi.html`. A signed, short-lived,
HttpOnly local-session cookie protects the mount. The test drives both tabs, saves and reads the
caller's settings, proves alert isolation across two users, rejects a body-supplied subject,
rejects non-operator deployment writes, and exercises an operator cadence save. Anonymous and
forged sessions receive `401` before the settings store is touched.

The fixture replaces Postgres, the market provider, and the background cron with deterministic
in-memory collaborators because those systems are outside this UI/auth/route contract. It does
**not** claim that a deployed identity provider has been accepted: a production/canary run through
the configured OIDC tenant, recorded against the release commit, remains an external acceptance
step.

**Framework gap (honest):** the store contract documents `settings.schema` as "rendered in a
settings panel", but the kernel does not consume manifest settings yet — nothing in `src/` reads
them. Until it does, this app renders its own panel from its own schema, which is why the schema
carries the `scope` / `min` / `max` / `enum` extensions.

## What this package is

- `routes/kalshi-routes.js` (built from `src-routes/kalshi-routes.ts`) — mounted at
  `/api/kalshi` (auth: service-or-oidc; handlers self-gate via `callerSub`):
  - Phase 1: `GET /` (surface), `/scan` (the stored snapshot + freshness), `POST /scan/run`,
    `/scorecard`, `/calibration`, `/status`, `GET`/`PUT /settings`, `GET /alerts`.
  - Phase 2 (ADR-094): `GET /portfolio`, `POST /orders`, `DELETE /orders/:id`,
    `GET /orders/history` — **confirm-gated and fail-closed**: the live gate reads the
    key's DETECTED exchange (never a client flag); live-exchange orders are refused unless
    `KALSHI_LIVE_ENABLED`; every order, rejection, AND refusal is audited to
    `kalshi_orders` with the justifying hand snapshot.
- `routes/kalshi-scan-engine.js` — the scan itself (moved off the request path), the durable
  snapshot, the manifest+DB config resolution, the settings store, the alert ledger.
- `routes/kalshi-scan-cron.js` — the poller and the alert fan-out (Jarvis feed + opt-in outward).
- `routes/kalshi-scan-config.js` — the pure half: config layering/clamping, freshness math, the
  alert gate. No imports, so `tests/` can cover it with plain `node --test`.
- `tools/kalshi.html` — the surface: ranked hands, freshness line ("scanned 12m ago · next in
  48m"), Scan now, Account, Scorecard, **Alerts**, **Settings**.
- `migrations/074-kalshi-orders.sql` + `075-kalshi-forward-test.sql` — package copies of the
  kernel migrations (order audit + the anti-dredging prediction ledger).
- `migrations/076-kalshi-scan-automation.sql` — **owned by this package**: the snapshot, the
  settings overrides, the alert ledger. `kalshi-scan-engine` also self-heals them, so the app
  works whether or not `APP_PACKAGE_MIGRATIONS` is on.

## What stays framework-resident (ADR-093)

The prediction-markets ENGINE (`src/features/prediction-markets` — public client, fee
math, calibration, bet evaluator, RSA-PSS request signing, portfolio, strategy scorecard),
the kalshi connector card + `OSHAL_CRED_KALSHI` broker key, the
`scripts/oshal-kalshi-*.ts` calibration/forward-test CLIs +
`config-seed/kalshi-calibration.json`, and the `tool-kalshi-home` default cockpit tile.
The packaged routes import the engine via `@/` aliases, and reach Jarvis + the notification
preference center through `@/app/routes/jarvis-task-store` and `@/app/routes/notify-routes`.

## Build & test

```bash
# from an OSHAL checkout — compiles src-routes/*.ts -> routes/*.js (@/ imports preserved)
node scripts/oshal-app.js build <this dir> --framework .
node scripts/oshal-app.js validate <this dir>

# all guards (store-ci installs pinned Playwright/Chromium + Express for the browser contract)
cd <this dir> && node --test "tests/*.test.js"

# local alternative: resolve the same dependencies from a sibling oshal checkout (the default),
# or point explicitly at an installed test-dependency root.
KALSHI_BROWSER_DEPS=/path/to/browser-deps node --test "tests/*.test.js"
```

## Status

Phase 2 (order placement) is shipped and live-verified against the real exchange, demo-first and
confirm-gated. Phase 1 needs no credentials (public market data), which is why the background scan
can run for the whole deployment.

**Read `docs/apps/kalshi/strategy-verdict.md` in the core repo before proposing a strategy.** Three
strategy families have been tested and all three were falsified; the honest state is that the
system *correctly folding* is the win. The background scan makes candidates cheap to watch — it
does not make them tradeable, and the evidence gate still forces stake to 0% until a strategy
out-scores the market on settled predictions.
