# Kalshi Prediction Markets — OSHAL app package

`?app=kalshi` — find mispriced event contracts on Kalshi (ADR-094). Every open market is
evaluated like a poker hand: calibrated true probability (learned from Kalshi's own
settled-market tape, beta-shrunk toward price so **no history ⇒ no edge**) versus the ask
plus Kalshi's quadratic taker fee; playable hands are ranked with quarter-Kelly stakes and
explicit risk flags. An empty table means the evaluator folded everything — by design.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface").

## What this package is

- `routes/kalshi-routes.js` (built from `src-routes/kalshi-routes.ts`) — mounted at
  `/api/kalshi` (auth: service-or-oidc; handlers self-gate via `callerSub`):
  - Phase 1: `GET /` (surface), `/scan` (cached ranked hands, 2-min TTL), `/scorecard`,
    `/calibration`, `/status`.
  - Phase 2 (ADR-094): `GET /portfolio`, `POST /orders`, `DELETE /orders/:id`,
    `GET /orders/history` — **confirm-gated and fail-closed**: the live gate reads the
    key's DETECTED exchange (never a client flag); live-exchange orders are refused unless
    `KALSHI_LIVE_ENABLED`; every order, rejection, AND refusal is audited to
    `kalshi_orders` with the justifying hand snapshot.
- `tools/kalshi.html` — the ranked-hand surface (strength badge, side, price, calibrated
  probability, net edge, stake, confidence, risk flags, time-to-close).
- `migrations/074-kalshi-orders.sql` + `075-kalshi-forward-test.sql` — package copies of
  the kernel migrations (order audit + the anti-dredging prediction ledger).

## What stays framework-resident (ADR-093)

The prediction-markets ENGINE (`src/features/prediction-markets` — public client, fee
math, calibration, bet evaluator, RSA-PSS request signing, portfolio, strategy scorecard),
the kalshi connector card + `OSHAL_CRED_KALSHI` broker key, the
`scripts/oshal-kalshi-*.ts` calibration/forward-test CLIs +
`config-seed/kalshi-calibration.json`, and the `tool-kalshi-home` default cockpit tile.
The packaged route imports the engine via `@/` aliases.

## Status

ADR-094 Phase 2 (live order placement) remains blocked on the operator's Kalshi account —
the demo-first, fail-closed posture in this package is byte-identical to the kernel
original. Phase 1 needs no credentials (public data).
