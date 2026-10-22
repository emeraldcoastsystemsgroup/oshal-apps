# Next supervised Event-to-Action session

Updated 21 October 2026, America/Chicago.

## Current instruction and saved state

The operator briefly authorized Docker startup and overnight iteration, then
withdrew unattended runtime work after observing the machine running hot. On21October the operator explicitly resumed supervised startup and product development
and identified the separate training program as the source of the prior load. Docker
and the owned Operations lab are running again. The
`triagenorth-overnight-improvements` heartbeat remains **PAUSED**; this supervised
resumption does not reactivate that overnight automation.

Historical verification immediately after the stop instruction: `docker.service`, `docker.socket` and
`containerd.service` are inactive/dead; daemon MainPIDs are zero. No `dockerd`,
`containerd` or containerd shim processes were found. The attempted socket start
was denied by host authorization. Several separate Python processes showed high
CPU usage; these observations do not identify the cause of the reported heat.
No unrelated process was terminated and no container data was deleted.

Saved application checkpoints on `feat/native-application-executors`:

| Commit | Saved work |
|---|---|
| `2fa75b19` | Three-week evaluation plan, ADR0018 and pinned dataset receipt. |
| `1e7141f1` | Systems inventory view, exact event links and behavioral tests. |
| `ea03a3a9` | Systems acceptance, ADR0019 and cross-environment failure scenarios. |
| `6311bdcd` | Committed-snapshot verification and coordination receipts. |

All twelve Systems checks passed from exported `ea03a3a9`, with about 25.0 MiB
peak scope memory under the enforced CPU/memory limits. No new feature code or
core changes were made during the brief overnight setup attempt. All saved checkpoints are now published to
`origin/feat/native-application-executors` through the normal full Store gate.
Current source/deployment receipts are in IMPLEMENTATION-STATUS.md. Hooks remain enabled.

## Build order for the next supervised session

1. **Explain and control resource use first.** Identify the high-load processes
   and their owners with the operator. Inspect Docker restart policies before
   starting the daemon. Define a single CPU-only lab profile with host reserve,
   shared-PVC placement, sidecars and startup/rollout headroom. Start only required
   services sequentially while watching CPU, memory pressure, OOM and restarts.
2. **Publish and exercise Systems.** Run required repository checks under bounded
   concurrency, push the saved checkpoints normally, deploy the application and
   verify the browser journey with two differently authorized users. Check narrow
   layouts, keyboard navigation, captured health, partial scans and late responses.
3. **Make the pipeline measurable.** Replay named-source alerts with frozen rules
   through actual percolation, deduplication and correlation. Preserve counts and
   decision IDs at each stage. Add pod replacement, repeated alerts, escalation,
   partial collection and out-of-order delivery scenarios as regression cases.
4. **Finish one evidence-to-action path.** Use the canonical workflow and shared
   workspace to generate the report and remediation script from a bounded evidence
   packet. Bind approval to the exact artifact and target, then perform one scoped
   lab action and record a recovery check that can fail honestly.
5. **Add depth after that path works.** Benchmark the pinned anomaly series, then
   evaluate economical text analysis if the measured resource budget permits it.
   Integrate one external ticket provider, improve replay/topology presentation
   and refresh the deck and Word/PDF/Visio artifacts against demonstrated behavior.

Keep each change small: reproduce, implement, test, document, commit and normal-push.
Record deployed source SHA, image digest, configuration revision and evidence
receipt before and after each deployment. Use a new `git revert` commit for source
rollback on the shared branch; never reset or force-push away another contributor's
work. Redeploy the prior recorded image/configuration separately. A source revert
does not reverse database changes or external actions; such changes need their own
documented rollback or compensation before execution.

## Core versus application work

The operator authorizes core changes when the capability belongs centrally or
repairs a gap in functionality the platform advertises. Document the specific gap,
why application code is the wrong owner, the reusable interface, compatibility,
tests and rollback in an ADR. Keep core changes in separate reviewable commits.
Reuse standard identity, connection, workflow, ticket and workspace facilities;
keep Operations-specific behavior in this package. This boundary authorization
does not override the current runtime stop or authorize GPU use.

Current supervised delivery: dbb862a0/7a119bfc are pushed normally to origin/feat/native-application-executors. The full gate passes with documented prerequisite skips after supplying the existing Publishing runtime. Native retained streams, bounded growth and100→40→4→2 replay pass. Continue from STREAMS-AND-REPLAY.md and its exact remaining gates.

## Completed supervised context/replay increment

The local native application accepts exact mapped OTLP/CloudWatch context, safe
three-bank rotation/growth and durable preprocessed packets. Actual 909.788-second
retention and standard Collector proofs pass. Scenario lab records 100→40→4→2,
actual dependency cards and four packets; server-verified saved cohorts reopen without
new event writes. The BGL severity baseline and sample cache are measured and labeled.
Presentation and design artifacts are regenerated. This closes those specific gates;
canonical automatic ticket/workflow delivery and the rest of the build order remain.
