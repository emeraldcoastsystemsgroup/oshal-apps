# Systems: observed infrastructure in context

Implemented in source on 21 October 2026 (`1e7141f1`), now included in the
installed and published package after supervised runtime resumption. Twelve focused
checks pass. The Scenario lab/Live context native browser receipt is separate from
the still-open Systems-specific live two-user browser acceptance.

The Systems view reuses the inventory graph and alert records available to the
signed-in user. It helps an operator find a resource, inspect its observed state
and follow the recorded placement, ownership and alert context. Kubernetes is the
first lens; other providers already present in the graph appear in the same view.
It adds no collector, cluster credential, login mechanism or execution authority.

## Operator journey

Open Systems in the application's toolbar, or use the experience's Systems link
(`/api/intelligent-operations/app#systems`). Select a system/cluster, namespace,
resource type and observed health, or search by name, native identity or namespace.
Cards show capture time, native identity, available image/restart facts and recorded
relationships. Counts cover all matching assets; at most 100 cards appear.

Choose **Inspect … in topology** to focus the exact graph asset. Expand related
alert observations to open the original event in Data & decisions. Use Topology's
existing graph time/collection controls to choose historical context, then return
to Systems. Refresh systems rereads the saved records and graph; it does not trigger
a cluster scan. Empty filters and unavailable responses have separate states.

## Evidence and identity boundaries

- Existing `/records` and `/topology` requests carry the current portal session.
  Server-side scope remains authoritative; filters do not authorize access.
- Systems group by provider and native scope. Event association requires the
  provider, scope, native ID and supported resource kind. Ambiguous cloud matches
  remain unlinked even if a display filter hides one candidate.
- Only validated events at or before the selected graph time are associated.
  The latest 200 returned events are a bounded page, not the complete incident
  history. Related alerts establish identity association, not root cause.
- Health, restart counts and lifecycle facts describe observation time. Missing
  health is unknown. Partial collections preserve prior observations; absence is
  not proof of deletion. No unobserved cloud estate or live state is fabricated.
- Refresh and failed access clear Systems rows; access refusal also clears private
  filter values. Late graph responses cannot repopulate a withdrawn view.

## Verification and next acceptance

Twelve focused tests pass against the shipped projection, renderer and controller:
provider/scope collisions, ambiguous cloud IDs, quarantine/future/duplicate events,
timezone ordering, directed placement, partial scans, unknown health, bounded
counts, malformed times/graphs, text-safe rendering and refusal/late-response
clearing. The controller cases use fixture HTTP responses and a small DOM adapter;
they do not constitute browser or live server authorization acceptance.

The suite is registered as `systems-observations` in `tests/test-lab.yaml` and runs
with `node intelligent-operations/tests/systems.test.cjs`. Verification used the
authorized 25%-of-one-core, 256-MiB, no-swap, 16-task, 60-second scope. JavaScript
syntax, unique HTML IDs, manifest parsing and Test Lab registration also passed.

The twelve checks were repeated successfully from an exported committed snapshot
of `ea03a3a9`, with zero skips. The enclosing scope peaked at 26,181,632 bytes
(about 25.0 MiB); its measured CPU quota was 25,000/100,000 microseconds and memory
limit 268,435,456 bytes. This is focused source verification, not the full Store gate.

Next live acceptance: two users with different records; narrow/desktop layouts and
keyboard operation; actual stored Kubernetes scans and pod replacement; refresh
failure and account withdrawal. Continuous discovery and command-based diagnosis
remain separate delivery work. The [three-week plan](THREE-WEEK-PLAN.md) owns the
troubleshooting scenario sequence; [ADR0019](adr/0019-observed-systems-experience.md)
records the application boundary.

## Resource workbench increment — source, 21 October

ADR0032 adds a keyboard-operable resource tree, workload/replica-set/pod/container ownership, one captured-status panel and related alert/topology links. It uses up to 2,000 already returned assets; legacy cards retain their 100-row ceiling. Group rows are not invented inventory. The collector adds measured phase, readiness and waiting/termination facts. Native navigation owns embedded pages; standalone navigation remains. The native resource tree and canonical RCA library are installed and browser-accepted. Selected-pod current status and reviewed execution use the separately configured original-user service described in POD-CONSOLE.md. Saved tree health retains its capture time.
