# Intelligent Trades (`trading/`)

Signal-justified stock trading (ADR-052) — carved out of OSHAL core 2026-07-20
(ADR-085 Wave 3, "skill with a surface"). **Install by directory name:**
`node scripts/oshal-app.js install trading` — the app's registered NAME stays
`intelligent-trades` (the exact identity the kernel manifest carried), so
`?app=intelligent-trades` URLs, the default tile, guest-tier records, and the
`intelligent-trades` queue id survive unchanged.

## What this package is

- The four route surfaces the kernel used to hard-mount, byte-identical bodies:
  - `/api/trading` (`service-or-oidc`) — surface + book reads, signal → decision →
    order flow, `POST /trigger` (its route-level live-approval gate ships verbatim:
    live tickets park in `backlog`; paper auto-approves), algo + tuning routes.
  - `/api/trading/autopilot` (`service-or-oidc`) — the operator switch over the
    kernel-resident advisor schedules (the loops themselves stay kernel).
  - `/api/trading/lab` (`service-or-oidc`) — the ADR-092 Strategy Lab (backtests,
    forward walks, regressions, ADR-095 apply/revert with its confirm guard).
  - `/api/trading-charts` (`public`, self-guarded) — the vendored chart lib
    (public MIT asset from `tools/vendor/`) + `GET /bars` (callerSub 401).
- `tools/trading.html` + `tools/vendor/lightweight-charts.js` (the surface).
- Registrar COPIES of the three personas (trading-analyst, trading-research-analyst,
  weather-analyst) — the kernel registry entries + ai-lab personas stay framework-resident.
- The five `trading_*` cli tools over the KERNEL-resident `scripts/oshal-trade-ops.js`.
- `tests/` — the guards that carved WITH their subjects:
  `trading-performance-fallback.spec.ts` (the /performance SPY-base regression) and
  `trading-surface-live-gate.spec.ts` (the surface's live/confirm gates).

## What stays in the OSHAL framework (ADR-093)

The ENGINE and the autopilot: `src/features/trading` (broker adapters, market data,
algorithms, sizing, risk policies), every `src/app/trading-*.ts` module —
`trading-engine.ts` (`placeDecisionOrder` with the env-level `live_blocked` gate:
`TRADING_LIVE_ENABLED` + explicit confirm — kernel-guarded by
`tests/unit/risky-write-guards.spec.ts`), `trading-schema.ts`, the 8
dispatch/reconcile loops, the strategy-lab sim/ops/store, config overrides,
strategy params, the equity/rotation/peaks stores — plus
`trading-routes-helpers.ts`, the bot containers + registries, migrations
034/035/072, all `TRADING_*` env, the schedule pins, `strategy-log.md`, the
watchdog + daily-recap CLIs, and the default ribbon tile.

## Build

```bash
node scripts/oshal-app.js build trading --framework <oshal-checkout>
node scripts/oshal-app.js validate trading
```
