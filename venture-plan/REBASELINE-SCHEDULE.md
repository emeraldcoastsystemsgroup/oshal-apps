# Scheduled rebaseline technical specification

Status: package and first-class kernel activation implementation complete with local regression evidence; no live-provider, deployed scheduler, or real forced-RLS execution is claimed.

## Purpose

Scheduled rebaseline refreshes model-authored BOM, market, and operations assumptions, then recomputes the deterministic model. It deliberately omits narration, so one due run has at most three paid bot calls followed by one free code phase.

The feature has three independent default-deny gates:

1. No policy row means `enabled=false`, `dryRun=true`, and a zero cap.
2. A policy remains non-spending while `dryRun=true`.
3. `POST /api/venture-rebaseline/tick` remains globally dry-run unless its service-authenticated caller supplies the exact boolean `execute: true`.

## Owner API

The OIDC-mounted `/api/venture` router exposes:

- `GET /ventures/:id/rebaseline-policy` — returns the stored policy or the non-spending default.
- `PUT /ventures/:id/rebaseline-policy` — accepts only `enabled`, `dryRun`, `cadence`, `weeklyDay`, and `maxCostMicros`. Unknown fields and invalid types are rejected.
- `POST /ventures/:id/rebaseline-policy/preview` — evaluates a supplied `atIso` timestamp, always with the tick-level dry-run override. It writes no row, reserves no run, and calls no bot.

Every lookup and write carries both the authenticated subject and venture id. The policy insert selects through the owned venture row; PostgreSQL also checks the owner relationship and applies forced owner-or-operator RLS.

## Service tick

`POST /api/venture-rebaseline/tick` is mounted with manifest `auth: service`. Its request is:

```json
{
  "atIso": "2026-08-06T12:00:00Z",
  "execute": false
}
```

Omitting `atIso` uses the route-boundary clock. Omitting `execute`, sending a truthy string, or sending any value other than the boolean `true` selects dry-run. The policy scan executes under the kernel's explicit system identity; every downstream query still carries the policy owner's subject. Tick results expose venture ids and outcomes but never owner subjects.

Cadence is a closed enum:

- `nightly` is due once per UTC date.
- `weekly` is due only on `weeklyDay`, where Sunday is `0` and Saturday is `6`.

The deterministic idempotency key is `<cadence>:<UTC YYYY-MM-DD>`. A partial unique index on `(venture_id, schedule_slot)` permits only one scheduled run for that venture and slot, including across process retries.

## Cost authorization and settlement

`maxCostMicros` is a positive integer micro-USD per-run authorization ceiling whenever a policy is both enabled and non-dry-run. The database and TypeScript boundaries cap it at the engine's exact-integer ceiling, `9007199254740000` micro-USD.

Before each bot dispatch, the worker checks the run's measured spend:

- `within-cap` permits the next call.
- `exhausted`, `overshot`, or `capture-failed` refuses it before the provider callback runs.
- A successful provider result must report a finite positive USD cost. It is rounded once into integer micro-USD and all later arithmetic is integer-only.
- A missing, zero, non-finite, thrown, or unsafe settlement becomes `capture-failed`; it is never treated as free.

A provider call is atomic. The call whose returned charge first crosses the cap cannot be recalled or partially unspent. Its measured cost is recorded as `overshot`, and no later bot call begins. This is therefore a hard ceiling on subsequent dispatch, not a claim that a provider can pre-price or interrupt an in-flight request.

After every bot boundary, the worker persists `cost_spent_micros` and `cost_status` on the owner-bound run row. Spend cannot decrease, terminal cost states cannot regress, and PostgreSQL rejects changes to the reserved slot or authorization cap. If an evidence update fails, the in-memory budget fails closed before later calls.

## Run lifecycle

The scheduled run kind is `rebaseline`, with phases:

```text
bom -> market -> ops -> compute
```

The normal per-phase isolation remains: a failed analyst phase is recorded and compute still produces the best available model. A later analyst blocked by the cost gate is marked `skipped`. All progress and close updates match run id, venture id, and owner subject.

Model-authored supply rows are replaced only where their source remains `model-estimate`; human/vendor evidence is retained. Assumption changes append ledger revisions rather than rewriting prior evidence.

## Kernel activation boundary

The package manifest declares `rebaseline-policy-tick` at minute 7 of every hour. It uses the kernel's `target: service-route` execution mode with the exact path `/api/venture-rebaseline/tick`, named export `runScheduledRebaselineTick`, and static body `{ "execute": true }`. It is not routed through an agent, cannot carry a prompt, and cannot select an internal URL. The kernel validates that the path is canonical and belongs to this package's exact `auth: service` mount, realpath-confines the owning compiled route module, verifies the named export, freezes the body, and invokes that handler in-process with the package context. The ordinary HTTP tick remains separately protected by `SWARM_SERVICE_SECRET`.

Hourly evaluation is deliberate. A once-daily instant is easy to miss during a restart; an hourly tick lets the package recover later that UTC day. Cadence and spend do not come from tick frequency. The package's nightly/weekly due calculation and database-unique UTC slot admit at most one scheduled run per venture/slot, while absent, disabled, and dry-run policies remain non-spending. The manifest's `execute: true` crosses only the outer service-tick gate; it does not override those owner policy gates or the measured per-run cap.

Activation retains the privileged handler/body only while the app is active. Deactivation retracts that registry entry before persisted schedule deletion, so even a stale Redis record fails closed. A missing/escaped module, missing export, altered schedule metadata, thrown handler, invalid bounded result, or inactive target records a failed schedule dispatch without falling back to prompt execution. In-process dispatch deliberately avoids loopback HTTP: if dynamic package routes are disabled, a same-path kernel route can never receive the scheduled body by fallthrough.

## Verification contract

The dependency-free compiled-module suites cover default policy, mutation resistance, UTC cadence, unique slots, owner predicates, migration/runtime schema agreement, exact-money boundaries, cap exhaustion/overshoot/capture failure, sanitized service results, and zero dispatch in both dry-run modes. Kernel suites cover manifest target validation, route ownership/auth, confined named-export loading, immutable registry dispatch, invalid results, and deactivation. Package validation additionally checks source/compiled parity and manifest shape. Live provider, protected-branch, deployed scheduler, and real forced-RLS acceptance remain separate evidence gates.

## Change log

| Seq | Author | Description |
|---:|---|---|
| 1 | maintainer@emeraldcoastsystemsgroup.com | Specify the default-deny policy, service tick, UTC idempotency, owner boundary, and measured-cost semantics. |
| 2 | maintainer@emeraldcoastsystemsgroup.com | Document the first-class hourly kernel service-route handler, its module/auth confinement, lifecycle teardown, and remaining live-evidence boundary. |
