# ADR0049: Scheduled live discovery

Status: implemented and accepted live, 23 October 2026, on kernel ADR-196 (package connector
reads; kernel PRs 87, 88 and 89). Guarded. Extends ADR0041 (live cluster reads) and closes the
unattended part of R15.

**Live acceptance (owned lab, kernel `dev-5535a761bb29`, app 10be97ee).** A browser turned on
"Keep this cluster current" for the lab cluster and `operations-demo`, every 5 minutes. With no
further browser action, the processing schedule read the cluster through the person's own
Kubernetes connection and saved a 10-asset live scan. The scan was observed at 07:08Z, replacing
the 21:41Z scan from the day before, and the panel said "Last read … saved 10 assets"
(`deploy/evidence/scheduled-discovery.json`, `scheduled-discovery.png`).

The first two live attempts were refused, and the panel showed why each time. Each refusal
found a kernel defect that its tests had missed:
1. Staged installs did not grant the consented `connector.read.kubernetes` (fixed in PR 88).
2. The read was checked against the application's grants instead of the person's connector
   link (fixed in PR 89). The kernel guard now admits the read as the application, and fails
   without the fix.

The Systems live cluster panel (ADR0041) read the cluster only when a person clicked Read. Every
connector action needed a confirmation from a browser. Inventory went stale between clicks, and
correlation (R14) worked from whatever was last saved.

## Decision

**Kernel rail.** Kernel ADR-196 adds the `connector.read` package intent:

- An application granted `connector.read.<connector>` can run that connector's read operations
  through the caller's own connection.
- It goes through the read path, so a write or a confirmed effect (exec, command, branch, pull
  request) is refused.
- The application declares `connector.read.kubernetes` in `uses:`, so the person sees it at
  consent.

**The person's choice.** "Keep this cluster current" in the live cluster panel saves one
setting, from the panel's current selections:

- the Kubernetes account;
- the namespace;
- the recorded cluster;
- the source;
- an interval of 5 minutes to 24 hours.

The setting is revision-checked and stays in the person's own scope.

**On the processing tick.** Discovery runs first, before alert processing, so correlation sees
fresh placement. When the interval has passed, the tick:

1. claims the attempt in a transaction, so two concurrent ticks read once;
2. lists nodes, then that namespace's pods and deployments, through `connector.read`;
3. builds the same scan as the panel's Save. `liveScan` is a copy of the panel's builder, and a
   test asserts that the two copies are identical;
4. saves it in the live collection, so the collector's services and routes are kept.

**Outcome.** The panel shows what the last attempt did. It either saved a number of assets, or
was refused or failed with the kernel's reason. A refused or failed read is not retried until
the next interval.

**Schedule offer.** The offer now says that it refreshes the chosen cluster's inventory if the
person turns that on. The offer still says it authorizes no infrastructure action, which stays
true.

## Not claimed

- More than one cluster or namespace per person. That needs one setting per cluster, and is
  the next step.
- Namespace listing and per-person multi-cluster selection. These need kernel reads that do
  not exist yet.
- Any write. Exec, response plans and promotion keep their fresh confirmations.

## Guards

- `tests/discovery.test.cjs`:
  - the builder is identical to the panel's;
  - the setting rejects bad input and stale revisions;
  - concurrent ticks read once, with exactly the three read operations, the chosen account and
    namespace;
  - the saved scan keeps the collector's routes;
  - nothing runs again within the interval;
  - a refusal is recorded and stops at the first call;
  - there is no read without the kernel port or when the setting is off;
  - another person sees only their own setting.
- `tests/live-cluster.test.cjs`: the shipped panel saves the setting from its selections and
  reads nothing doing so.
- Kernel: `ssh::tests::native::an_application_reads_through_the_persons_connection_but_never_runs_a_command`.
