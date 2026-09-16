# Intelligent Trades — backlog

Deferred work for the `trading/` package (app `intelligent-trades`). Each entry has done-when
criteria. Engine behaviour lives in core (`src/app/trading-*`, `src/features/trading`); entries
that need a core change say so.

## T1 — A Test Lab catalog for the package (priority: low, added 2026-09-14)

The package ships 13 Playwright specs and a framework-coupled node suite
(`tests/realized.core.test.js`) but has no `tests/test-lab.yaml` and no `testing:` block in its
manifest, so the Test Lab cannot list or run any of them. Core's plan tracks it as "Adopt existing
suites" in `docs/backlog/app-test-lab-registration.md` (the `trading` row and section).

**Done when:**
- `tests/test-lab.yaml` registers each suite with the Lab's own prerequisite names
  (`fixture:core-checkout` for node-test, `harness:oshal-core-root` + `core:dependencies` for
  browser cases), and the manifest's `testing:` block points at it.
- The store's manual framework-coupled gate (`scripts/security/run-framework-coupled-tests.mjs`)
  admits every registration — it refuses one core's runner can never admit.
- At least one node-test case and one browser case pass in the real sealed sandbox on the box
  (a real run of seconds, not a sub-second decline); cases that need a live broker are declared
  `external` and stay pending with that reason.

## T2 — Take-profit and trailing still read the venue's wash-sale basis (needs operator sign-off)

The #452 veto moved only the stop-loss decision onto the engine's own cost. Take-profit
(`portfolio.ts` `exitsToRun`), trailing arming and the stored trailing peak floor still use the
venue's average, which after a wash sale carries the disallowed loss — so they fire late or not at
all (the error runs toward holding longer, never toward a phantom exit). Under the `active` policy,
trailing can never fire while it shares a basis with take-profit, and the live book has 0
`trailing_stop` fills. Moving them creates sells, reverses the documented design and the #452
spec that asserts take-profit is untouched.

**Done when:** the operator approves; a pure `decisionBasis(p)` (engine cost where the ledger
covers the position, else the venue's) drives take-profit, trailing gain and the peak floor
together — changing the arming basis without the peak floor produces false trailing exits — with
tests under `RISK_POLICIES.active` (the policy where the path is live) and a real-Postgres
`computeExits` fire asserting the stored peak is floored at the engine basis.

## T3 — Ledger drift keeps the wash-sale veto off ANET and MPC (operator action)

The veto applies only when the engine's replayed quantity equals the venue's. The live ledger
records ANET sells on 2026-08-03 and 2026-08-18 and an MPC sell on 2026-08-03 as `rejected`
(verified 2026-09-14). If, as in the rejected-twin incident, a twin order filled at the venue, the
replay still counts shares the venue sold, the quantities differ, and the veto cannot attach — the
reconcile dry run below is what confirms it; the venue quantity was not readable headlessly. By a
model that matches 156 of 232 past sells, ANET's venue basis after the 08-28 wash sale is about
213.37 against the 187.595 the engine paid on 09-14, which would put its venue stop line above its
recent prices.

**Done when:** the trading page's Reconcile runs as a dry run for ANET and MPC (it needs the
operator's signed-in session: the package's ADR-149 gate refuses service identities), the proposed
bookings are checked against Schwab's history, it is applied, and the next fire logs
`engine cost basis attached` with both names covered.

## T4 — The surface parse guard has been red since the connected-actions handoff (added 2026-09-15)

`tests/trading-html-syntax.spec.ts` parses every `tools/ui/*.js` as a **classic script**, and
`tools/ui/connected-actions.js` (added by `bcbf9df`, "Add saved market evidence and explicit
research handoffs") is an ES module: it opens with `import {receiveHandoff} from
'/cockpit/js/app-handoff.js'`, and `trading.html:288` loads it with `type="module"`, which is
correct. The file is right and the guard's blanket assumption is stale, so the guard fails with
`connected-actions.js: Cannot use import statement outside a module`.

Measured on a pristine `origin/main` checkout at `0bb5d69` on 2026-09-15: **1 failed, 228 passed**,
that one case. It is the guard that exists to catch a syntax error nobody else would catch — a
2026-09-03 blank page was a raw newline in a string literal — so while it is red it is protecting
nothing, and a real break in another module would look like the failure everyone has learned to
skip past.

**Done when:** the spec decides each module's goal (script vs module) from how `trading.html`
actually loads it — `type="module"` parses as a module, everything else as a classic script — with
the mapping asserted in both directions so a module added to the page and never loaded, or loaded
as a module and written as a script, still fails; and the suite reports zero failures on a clean
checkout.
