# payments ("Payments") — an OSHAL app package

1.1.4 adds the family audience view beside the company one (ADR-164 D6): Jarvis (the Home shell) opens this package's first surface with `?audience=family`, and the shared kit paints the same account-scoped card in the family grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

Take payments through your own connected merchant account. Connect Square and/or PayPal on
`/utilities` (the `payments` connector category); the app charges on your behalf with your
per-user brokered token — Square runs a direct card charge, PayPal creates and sends an
invoice. Deterministic I/O: no LLM, no bot. Sandbox by default (`SQUARE_ENV` / `PAYPAL_ENV`).

Carved out of OSHAL core 2026-07-17 (ADR-085 Wave 1 carve #4). This package is the app's
only home.

## What's inside

| Path | What |
|---|---|
| `oshal-app.yaml` | Manifest: one OIDC route, ribbon tile, `ocean` theme, `suite: ai-productivity`, `dependencies.connectors: [square, paypal]`, `guestTier: blocked` request. |
| `src-routes/payments-routes.ts` | TypeScript source (providers / charge / status / history + the lazy `ensurePaymentsSchema`). |
| `routes/payments-routes.js` | **Compiled JS** the loader mounts (`oshal-app build` output). |
| `tools/payments.html` | The surface, served from this package dir. |

## What deliberately stays in core

- **`@/features/payments`** — the adapter slice is a documented kernel skill shared with the
  finance app (finance imports the Stripe `PaymentAdapter` half; this app imports the
  `MerchantPaymentAdapter` registry). The packaged route imports it from core. When finance
  carves (Wave-1 last), the merchant half can be revisited.
- **Square / PayPal OAuth connectors** — core connector-catalog infrastructure
  (`getValidAccessToken` brokered tokens). Deployment env: `SQUARE_ENV`, `SQUARE_CLIENT_ID`,
  `SQUARE_CLIENT_SECRET`, `SQUARE_REDIRECT_URI`, `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`,
  `PAYPAL_CLIENT_SECRET`, `PAYPAL_REDIRECT_URI` (documented in the framework `.env.example`;
  not credentialed = the providers list shows not-connected and nothing can charge).

## Safety posture

Every route is OIDC-gated at mount and self-checks the caller. `POST /charge` additionally
requires the explicit write confirmation (HTTP 428 without it), is idempotency-keyed on
`user_sub:requestId` (a retry never double-charges), and every charge is recorded
owner-scoped in `oshal_merchant_payments` (created lazily with tier-1 owner RLS at the
chokepoint — no install-time migrations).

## Install

```bash
node scripts/oshal-app.js install payments     # from an OSHAL checkout
```

Ships `status: active` (parity with core — the app was live when carved, sandbox-default).

Payments 1.1.2 loads the shared theme bootstrap (`/shared/ui/css/surface-themes.css` + `/shared/ui/js/surface-theme.js`) in `tools/payments.html` and derives its palette from the framework tokens with the previous colors as fallbacks, so the surface follows the operator's chosen cockpit or experience skin whether embedded or opened standalone. No route, data or permission change.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

No model in the loop (T0): every feature of this application is deterministic code.
<!-- oshal-rating:end -->
